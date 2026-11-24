-- BARBERAGENDA APP: ejecutar una sola vez en Supabase > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.barber_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.schedules (
  service_date date primary key,
  start_time time not null,
  duration_minutes integer not null check (duration_minutes between 15 and 180),
  capacity integer not null check (capacity between 1 and 30),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint schedules_fit_in_day check (
    extract(epoch from start_time) + ((capacity - 1) * duration_minutes * 60) < 86400
  )
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  appointment_date date not null,
  appointment_time time not null,
  client_name text not null check (char_length(client_name) between 1 and 70),
  client_phone text not null check (char_length(client_phone) between 7 and 25),
  service text not null check (char_length(service) between 1 and 50),
  details text not null default '' check (char_length(details) <= 300),
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now()
);

create unique index if not exists appointments_one_active_per_slot
  on public.appointments (appointment_date, appointment_time)
  where status = 'confirmed';
create index if not exists appointments_by_date
  on public.appointments (appointment_date, appointment_time);

create or replace function public.is_barber_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.barber_admins where user_id = (select auth.uid())
  );
$$;

alter table public.barber_admins enable row level security;
alter table public.schedules enable row level security;
alter table public.appointments enable row level security;

drop policy if exists "barber can see own admin record" on public.barber_admins;
create policy "barber can see own admin record"
  on public.barber_admins for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "anyone can view active schedules" on public.schedules;
drop policy if exists "public can view active schedules" on public.schedules;
create policy "public can view active schedules"
  on public.schedules for select to anon
  using (active);
drop policy if exists "barber can view schedules" on public.schedules;
create policy "barber can view schedules"
  on public.schedules for select to authenticated
  using (active or public.is_barber_admin());
drop policy if exists "barber can add schedules" on public.schedules;
create policy "barber can add schedules"
  on public.schedules for insert to authenticated
  with check (public.is_barber_admin());
drop policy if exists "barber can edit schedules" on public.schedules;
create policy "barber can edit schedules"
  on public.schedules for update to authenticated
  using (public.is_barber_admin()) with check (public.is_barber_admin());
drop policy if exists "barber can remove schedules" on public.schedules;
create policy "barber can remove schedules"
  on public.schedules for delete to authenticated
  using (public.is_barber_admin());

drop policy if exists "barber can see appointments" on public.appointments;
create policy "barber can see appointments"
  on public.appointments for select to authenticated
  using (public.is_barber_admin());
drop policy if exists "barber can update appointments" on public.appointments;
create policy "barber can update appointments"
  on public.appointments for update to authenticated
  using (public.is_barber_admin()) with check (public.is_barber_admin());

grant select on public.schedules to anon, authenticated;
grant select on public.barber_admins to authenticated;
grant select, update on public.appointments to authenticated;
grant insert, update, delete on public.schedules to authenticated;
grant usage on schema public to anon, authenticated;

-- La consulta pública devuelve solo horarios libres, nunca datos de clientes.
create or replace function public.get_available_slots(p_date date)
returns table(slot_time time)
language sql stable security definer set search_path = ''
as $$
  select (s.start_time + make_interval(mins => slots.n * s.duration_minutes))::time
  from public.schedules s
  cross join lateral generate_series(0, s.capacity - 1) as slots(n)
  where s.service_date = p_date
    and s.active
    and (
      p_date > (now() at time zone 'America/Bogota')::date
      or (
        p_date = (now() at time zone 'America/Bogota')::date
        and (s.start_time + make_interval(mins => slots.n * s.duration_minutes))::time
            > (now() at time zone 'America/Bogota')::time
      )
    )
    and not exists (
      select 1 from public.appointments a
      where a.appointment_date = p_date
        and a.appointment_time =
          (s.start_time + make_interval(mins => slots.n * s.duration_minutes))::time
        and a.status = 'confirmed'
    )
  order by slot_time;
$$;

-- Reserva atómica: si dos personas intentan tomar el mismo turno, solo una lo obtiene.
create or replace function public.create_booking(
  p_date date,
  p_time time,
  p_name text,
  p_phone text,
  p_service text,
  p_details text default ''
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  new_id uuid;
  barber_now timestamp := now() at time zone 'America/Bogota';
begin
  if p_date < barber_now::date
     or (p_date = barber_now::date and p_time <= barber_now::time) then
    raise exception 'Ese horario ya pasó.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 70
     or char_length(btrim(coalesce(p_phone, ''))) not between 7 and 25
     or char_length(btrim(coalesce(p_service, ''))) not between 1 and 50
     or char_length(coalesce(p_details, '')) > 300 then
    raise exception 'Revisa los datos de la cita.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.schedules s
    where s.service_date = p_date
      and s.active
      and p_time >= s.start_time
      and mod(
        extract(epoch from (p_time - s.start_time))::integer,
        s.duration_minutes * 60
      ) = 0
      and floor(extract(epoch from (p_time - s.start_time)) / (s.duration_minutes * 60))
          < s.capacity
  ) then
    raise exception 'Ese turno no está disponible.' using errcode = '22023';
  end if;
  insert into public.appointments (
    appointment_date, appointment_time, client_name, client_phone, service, details
  ) values (
    p_date, p_time, btrim(p_name), btrim(p_phone), btrim(p_service), btrim(coalesce(p_details, ''))
  ) returning id into new_id;
  return new_id;
exception
  when unique_violation then
    raise exception 'Ese turno acaba de ser reservado. Elige otro.' using errcode = '23505';
end;
$$;

revoke all on function public.is_barber_admin() from public;
revoke all on function public.get_available_slots(date) from public;
revoke all on function public.create_booking(date, time, text, text, text, text) from public;
grant execute on function public.is_barber_admin() to authenticated;
grant execute on function public.get_available_slots(date) to anon, authenticated;
grant execute on function public.create_booking(date, time, text, text, text, text) to anon, authenticated;

-- Después de crear/iniciar sesión con el correo del barbero, autorízalo así:
-- insert into public.barber_admins (user_id)
-- select id from auth.users where email = 'correo-del-barbero@ejemplo.com'
-- on conflict do nothing;


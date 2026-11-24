"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createClient } from "@/utils/supabase/client";

type Schedule = {
  service_date: string;
  start_time: string;
  duration_minutes: number;
  capacity: number;
  active: boolean;
};

type Appointment = {
  id: string;
  appointment_date: string;
  appointment_time: string;
  client_name: string;
  client_phone: string;
  service: string;
  details: string;
  status: "confirmed" | "cancelled";
};

function todayString() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
}

function prettyDate(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long" })
    .format(new Date(year, month - 1, day));
}

function timeLabel(value: string) {
  return value.slice(0, 5);
}

export default function BarberAgenda() {
  const supabase = useMemo(() => createClient(), []);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedDate, setSelectedDate] = useState(todayString());
  const [slots, setSlots] = useState<string[]>([]);
  const [selectedTime, setSelectedTime] = useState("");
  const [service, setService] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [loginMessage, setLoginMessage] = useState("");
  const [tab, setTab] = useState<"booking" | "agenda">("booking");
  const [configDate, setConfigDate] = useState(todayString());
  const [startTime, setStartTime] = useState("09:00");
  const [duration, setDuration] = useState(30);
  const [capacity, setCapacity] = useState(8);

  const loadSchedules = useCallback(async () => {
    const { data } = await supabase
      .from("schedules")
      .select("service_date,start_time,duration_minutes,capacity,active")
      .eq("active", true)
      .gte("service_date", todayString())
      .order("service_date");
    const rows = (data ?? []) as Schedule[];
    setSchedules(rows);
    setSelectedDate((current) => rows.some((row) => row.service_date === current) ? current : (rows[0]?.service_date ?? current));
    return rows;
  }, [supabase]);

  const loadSlots = useCallback(async (date: string) => {
    if (!date) {
      setSlots([]);
      return;
    }
    const { data, error } = await supabase.rpc("get_available_slots", { p_date: date });
    if (error) {
      setNotice("No se pudieron cargar los horarios. Revisa que hayas ejecutado el esquema de Supabase.");
      setSlots([]);
      return;
    }
    const available = ((data ?? []) as { slot_time: string }[]).map((row) => timeLabel(row.slot_time));
    setSlots(available);
    setSelectedTime((current) => available.includes(current) ? current : "");
  }, [supabase]);

  const loadAppointments = useCallback(async (date: string) => {
    if (!isAdmin || !date) {
      setAppointments([]);
      return;
    }
    const { data, error } = await supabase
      .from("appointments")
      .select("id,appointment_date,appointment_time,client_name,client_phone,service,details,status")
      .eq("appointment_date", date)
      .order("appointment_time");
    if (error) {
      setNotice("No se pudo leer la agenda. Confirma que tu correo esté autorizado como barbero.");
      setAppointments([]);
      return;
    }
    setAppointments((data ?? []) as Appointment[]);
  }, [isAdmin, supabase]);

  const checkAdmin = useCallback(async () => {
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;
    setUserEmail(user?.email ?? "");
    if (!user) {
      setIsAdmin(false);
      return;
    }
    const { data } = await supabase
      .from("barber_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    setIsAdmin(Boolean(data));
    if (!data) setLoginMessage("Este correo todavía no tiene acceso de barbero.");
  }, [supabase]);

  useEffect(() => {
    let mounted = true;
    async function initialize() {
      setLoading(true);
      await loadSchedules();
      await checkAdmin();
      if (mounted) setLoading(false);
    }
    void initialize();
    const { data } = supabase.auth.onAuthStateChange(() => {
      window.setTimeout(() => { void checkAdmin(); }, 0);
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [checkAdmin, loadSchedules, supabase]);

  useEffect(() => {
    void loadSlots(selectedDate);
    const refresh = window.setInterval(() => { void loadSlots(selectedDate); }, 30000);
    return () => window.clearInterval(refresh);
  }, [loadSlots, selectedDate]);
  useEffect(() => { void loadAppointments(selectedDate); }, [loadAppointments, selectedDate]);

  useEffect(() => {
    const schedule = schedules.find((row) => row.service_date === configDate);
    setStartTime(schedule ? timeLabel(schedule.start_time) : "09:00");
    setDuration(schedule?.duration_minutes ?? 30);
    setCapacity(schedule?.capacity ?? 8);
  }, [configDate, schedules]);

  async function sendLoginLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginMessage("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin + "/auth/callback" },
    });
    setLoginMessage(error
      ? "No se pudo enviar el enlace. Revisa el correo y la configuración de Auth."
      : "Te enviamos un enlace de acceso. Ábrelo en este mismo navegador.");
  }

  async function signOut() {
    await supabase.auth.signOut();
    setIsAdmin(false);
    setUserEmail("");
    setAppointments([]);
    setTab("booking");
    setNotice("Sesión cerrada.");
  }

  async function saveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdmin) return;
    setSaving(true);
    setNotice("");
    const { data: booked, error: bookedError } = await supabase
      .from("appointments")
      .select("appointment_time")
      .eq("appointment_date", configDate)
      .eq("status", "confirmed");
    if (bookedError) {
      setNotice("No se pudieron verificar las citas existentes.");
      setSaving(false);
      return;
    }
    const startMinutes = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5));
    const proposedTimes = new Set(Array.from({ length: capacity }, (_, index) => {
      const minutes = startMinutes + index * duration;
      return String(Math.floor(minutes / 60)).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0");
    }));
    if ((booked ?? []).some((row: { appointment_time: string }) => !proposedTimes.has(timeLabel(row.appointment_time)))) {
      setNotice("No se cambió el horario: ya hay citas reservadas fuera de la nueva disponibilidad.");
      setSaving(false);
      return;
    }
    const { error } = await supabase.from("schedules").upsert({
      service_date: configDate,
      start_time: startTime,
      duration_minutes: duration,
      capacity,
      active: true,
    }, { onConflict: "service_date" });
    if (error) {
      setNotice("No se guardó. Verifica la fecha y la cantidad de turnos.");
    } else {
      setNotice("Disponibilidad guardada.");
      await loadSchedules();
      setSelectedDate(configDate);
    }
    setSaving(false);
  }

  async function bookAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDate || !selectedTime || !service) {
      setNotice("Elige una fecha, un servicio y un horario.");
      return;
    }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSaving(true);
    setNotice("");
    const { error } = await supabase.rpc("create_booking", {
      p_date: selectedDate,
      p_time: selectedTime,
      p_name: String(form.get("client_name") ?? "").trim(),
      p_phone: String(form.get("client_phone") ?? "").trim(),
      p_service: service,
      p_details: String(form.get("details") ?? "").trim(),
    });
    if (error) {
      setNotice(error.code === "23505" ? "Ese turno acaba de ocuparse. Selecciona otro." : (error.message || "No se pudo confirmar la cita."));
      await loadSlots(selectedDate);
    } else {
      formElement.reset();
      setService("");
      setSelectedTime("");
      setNotice("¡Cita confirmada! Ya aparece en la agenda del barbero.");
      await loadSlots(selectedDate);
    }
    setSaving(false);
  }

  async function cancelAppointment(id: string) {
    if (!isAdmin || !window.confirm("¿Cancelar esta cita? El turno quedará libre de nuevo.")) return;
    const { error } = await supabase.from("appointments")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("status", "confirmed");
    if (error) {
      setNotice("No se pudo cancelar esta cita.");
    } else {
      setNotice("Cita cancelada; el turno quedó libre.");
      await loadAppointments(selectedDate);
      await loadSlots(selectedDate);
    }
  }

  const activeAppointments = appointments.filter((row) => row.status === "confirmed");
  const dayCapacity = schedules.find((row) => row.service_date === selectedDate)?.capacity ?? 0;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="BARBERAGENDA APP inicio">
          <span className="brand-mark">B</span>
          <span className="brand-name">BARBERAGENDA<small>APP</small></span>
        </a>
        <div className="top-actions">
          {isAdmin ? (
            <>
              <span className="signed-in">{userEmail}</span>
              <button className="button button-quiet" onClick={() => void signOut()}>Salir</button>
            </>
          ) : (
            <button className="button button-quiet" onClick={() => setShowLogin((value) => !value)}>Acceso del barbero</button>
          )}
        </div>
      </header>

      {showLogin && !isAdmin && (
        <section className="login-panel">
          <div><strong>Acceso del barbero</strong><p>Te enviaremos un enlace de acceso a tu correo.</p></div>
          <form onSubmit={sendLoginLink} className="login-form">
            <input aria-label="Correo del barbero" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu-correo@ejemplo.com" required />
            <button className="button button-dark" type="submit">Enviar enlace</button>
          </form>
          {loginMessage && <p className="login-message">{loginMessage}</p>}
        </section>
      )}

      <section className="hero">
        <div>
          <p className="eyebrow">BARBERÍA · CITAS SIN ENREDOS</p>
          <h1>Tu próximo turno,<br /><em>a un clic.</em></h1>
          <p className="hero-copy">Elige el día y la hora. El barbero recibe tus datos y mantiene su agenda organizada.</p>
        </div>
        <div className="hero-badge"><span>✂</span><small>AGENDA<br />AL DÍA</small></div>
      </section>

      {isAdmin && (
        <nav className="tabs" aria-label="Panel">
          <button className={tab === "booking" ? "tab active" : "tab"} onClick={() => setTab("booking")}>Reservar una cita</button>
          <button className={tab === "agenda" ? "tab active" : "tab"} onClick={() => setTab("agenda")}>Agenda del barbero</button>
        </nav>
      )}

      {notice && <div className="notice" role="status">{notice}<button aria-label="Cerrar aviso" onClick={() => setNotice("")}>×</button></div>}

      {tab === "booking" ? (
        <section className="content-grid">
          <div className="booking-card panel">
            <div className="panel-heading">
              <div><span className="step-label">RESERVA EN 3 PASOS</span><h2>Solicitar una cita</h2></div>
              <span className="scissor">✦</span>
            </div>
            {loading ? <p className="muted">Cargando disponibilidad…</p> : schedules.length === 0 ? (
              <div className="empty-state"><span>◷</span><strong>Aún no hay fechas abiertas</strong><p>El barbero publicará aquí los próximos horarios disponibles.</p></div>
            ) : (
              <form onSubmit={bookAppointment}>
                <div className="form-row">
                  <label>FECHA
                    <select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} required>
                      {schedules.map((row) => <option key={row.service_date} value={row.service_date}>{prettyDate(row.service_date)}</option>)}
                    </select>
                  </label>
                  <label>SERVICIO
                    <select value={service} onChange={(event) => setService(event.target.value)} required>
                      <option value="">Selecciona un servicio</option>
                      <option value="Corte">Corte</option>
                      <option value="Barba">Barba</option>
                      <option value="Corte y barba">Corte y barba</option>
                      <option value="Otro">Otro</option>
                    </select>
                  </label>
                </div>
                <div className="field-block">
                  <div className="label-row"><label>HORA DISPONIBLE</label><span>{slots.length} libres</span></div>
                  {slots.length ? (
                    <div className="slot-grid">
                      {slots.map((time) => <button key={time} type="button" className={selectedTime === time ? "slot selected" : "slot"} onClick={() => setSelectedTime(time)}>{time}</button>)}
                    </div>
                  ) : <div className="empty-inline">No quedan turnos para este día. Prueba otra fecha.</div>}
                </div>
                <div className="form-row">
                  <label>NOMBRE<input name="client_name" maxLength={70} placeholder="Tu nombre" required /></label>
                  <label>WHATSAPP / TELÉFONO<input name="client_phone" type="tel" maxLength={25} placeholder="Ej. 300 123 4567" required /></label>
                </div>
                <label className="full-label">DETALLES ADICIONALES <span>OPCIONAL</span>
                  <textarea name="details" maxLength={300} placeholder="Una preferencia que el barbero deba conocer…" />
                </label>
                <button className="button button-dark submit-button" type="submit" disabled={saving || loading || !slots.length}>
                  {saving ? "Guardando…" : "Confirmar mi cita"} <span>↗</span>
                </button>
                <p className="form-footnote">Tus datos se usan para organizar y confirmar esta cita con la barbería.</p>
              </form>
            )}
          </div>
          <aside className="side-panel">
            <div className="side-panel-top"><span className="green-dot" /> DISPONIBILIDAD EN VIVO</div>
            <h3>Sin llamadas.<br />Sin esperas.</h3>
            <p>Los turnos ocupados desaparecen de la lista al reservar. El barbero ve tu nombre, teléfono, servicio y detalles.</p>
            <div className="side-separator" />
            <div className="mini-stat"><span>FECHA ELEGIDA</span><strong>{selectedDate ? prettyDate(selectedDate) : "—"}</strong></div>
            <div className="mini-stat"><span>TURNOS LIBRES</span><strong>{slots.length}</strong></div>
            <div className="side-bottom">BARBERAGENDA <span>APP</span></div>
          </aside>
        </section>
      ) : (
        <section className="dashboard-grid">
          <div className="panel agenda-panel">
            <div className="panel-heading agenda-heading">
              <div><span className="step-label">PANEL PRIVADO</span><h2>Agenda del barbero</h2></div>
              <label className="date-picker">FECHA<input type="date" value={selectedDate} min={todayString()} onChange={(event) => setSelectedDate(event.target.value)} /></label>
            </div>
            <div className="stats-row">
              <div><span>CITAS</span><strong>{activeAppointments.length}</strong></div>
              <div><span>TURNOS LIBRES</span><strong>{slots.length}</strong></div>
              <div><span>CAPACIDAD</span><strong>{dayCapacity}</strong></div>
            </div>
            <div className="appointment-list">
              {activeAppointments.length === 0 ? (
                <div className="empty-state compact"><span>✂</span><strong>No hay citas para este día</strong><p>Cuando reserven, aparecerán aquí.</p></div>
              ) : activeAppointments.map((appointment) => (
                <article className="appointment-row" key={appointment.id}>
                  <time>{timeLabel(appointment.appointment_time)}</time>
                  <div className="appointment-rule" />
                  <div className="appointment-info">
                    <strong>{appointment.client_name}</strong>
                    <span>{appointment.service} · {appointment.client_phone}</span>
                    {appointment.details && <small>Nota: {appointment.details}</small>}
                  </div>
                  <button className="cancel-link" onClick={() => void cancelAppointment(appointment.id)}>Cancelar</button>
                </article>
              ))}
            </div>
          </div>
          <form className="panel schedule-panel" onSubmit={saveSchedule}>
            <span className="step-label">ORGANIZA TU JORNADA</span>
            <h2>Disponibilidad</h2>
            <p className="muted">Abre una fecha y define el número de citas que deseas atender.</p>
            <label>DÍA DE ATENCIÓN<input type="date" min={todayString()} value={configDate} onChange={(event) => setConfigDate(event.target.value)} required /></label>
            <div className="form-row">
              <label>PRIMER TURNO<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required /></label>
              <label>DURACIÓN<select value={duration} onChange={(event) => setDuration(Number(event.target.value))}><option value={30}>30 minutos</option><option value={45}>45 minutos</option><option value={60}>60 minutos</option><option value={90}>90 minutos</option></select></label>
            </div>
            <label>CANTIDAD DE TURNOS<input type="number" min={1} max={30} value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} required /></label>
            <div className="schedule-preview">{capacity} turnos · desde {startTime} · cada {duration} minutos</div>
            <button className="button button-dark submit-button" type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar disponibilidad"}</button>
          </form>
        </section>
      )}
      <footer>BARBERAGENDA APP <span>·</span> Agenda clara, citas sin enredos.</footer>
    </main>
  );
}


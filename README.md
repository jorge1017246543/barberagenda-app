# BARBERAGENDA APP

**Agenda digital para barberías y pequeños negocios de servicios.**

BARBERAGENDA APP permite que un cliente reserve una cita desde un enlace público y que el barbero administre sus horarios y consulte la agenda del día desde el mismo sistema.

> Proyecto de portafolio desarrollado con apoyo de Codex.

## El problema

En negocios pequeños, las citas suelen coordinarse entre llamadas y mensajes. Eso obliga al dueño a responder manualmente, copiar datos a una agenda y confirmar si una hora sigue disponible. El proceso interrumpe el trabajo y puede terminar en reservas duplicadas o citas olvidadas.

## La solución

El cliente abre el enlace de la barbería, consulta fechas y horas disponibles, elige un servicio y confirma su turno con nombre, teléfono y detalles opcionales. El barbero configura cuántos turnos atenderá cada día y ve las reservas ordenadas por hora.

La disponibilidad y las reservas se guardan en una base compartida. La reserva se valida en el servidor y la base de datos impide asignar dos veces el mismo horario. El cliente no necesita crear una cuenta.

## Funcionalidades del MVP

- Reserva pública de citas sin iniciar sesión.
- Consulta de horarios libres por fecha.
- Registro de nombre, teléfono, servicio y notas.
- Configuración de fecha, primera hora, duración y cantidad de turnos.
- Agenda privada del barbero con acceso por enlace enviado al correo.
- Cancelación de citas desde la agenda.
- Actualización periódica de la disponibilidad para los clientes.
- Políticas de seguridad en la base de datos: los datos personales de las citas solo están disponibles para el barbero autorizado.

## Automatización para pequeños negocios

- Reduce la coordinación manual de cada turno.
- Mantiene horarios y reservas en una sola agenda.
- Libera el turno al cancelar una cita.
- Evita que dos clientes confirmen el mismo horario.

## Tecnologías

- Next.js 16 y React
- TypeScript
- Supabase Auth y PostgreSQL
- Row Level Security para proteger las tablas
- Funciones SQL para consultar disponibilidad y crear reservas

## Trabajo con Codex

Codex se utilizó como colaborador de desarrollo para convertir el problema del negocio en un MVP, estructurar la aplicación, preparar la interfaz de reserva, conectar los flujos con Supabase y documentar la puesta en marcha. El alcance y las decisiones del producto se definieron durante el trabajo iterativo del proyecto.

## Ejecutar localmente

1. Instala Node.js LTS.
2. Ejecuta **npm install**.
3. Copia **.env.example** con el nombre **.env.local** y agrega la URL de Supabase y su clave publicable.
4. En Supabase **SQL Editor**, ejecuta **supabase/schema.sql**.
5. En **Authentication → URL Configuration**, permite **http://localhost:3000/auth/callback**.
6. En **Authentication → Providers → Email**, habilita el acceso por enlace de correo.
7. Ejecuta **npm run dev** y abre **http://localhost:3000**.
8. Inicia sesión desde **Acceso del barbero**. Después, agrega su usuario a la lista de administradores con este SQL, reemplazando el correo:

   ~~~sql
   insert into public.barber_admins (user_id)
   select id from auth.users where email = 'correo-del-barbero@ejemplo.com'
   on conflict do nothing;
   ~~~

9. Recarga la página. El barbero podrá publicar fechas y revisar las citas.

## Configuración y seguridad

**.env.local** contiene configuración local y no debe subirse al repositorio. Usa **.env.example** como plantilla. La clave **NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY** está diseñada para usarse desde la aplicación web; las políticas RLS limitan el acceso a los datos.

No incluyas claves **service_role** en el cliente ni en el repositorio.

## Estado y próximos pasos

El MVP permite reservar desde la web y compartir la dirección del sitio una vez desplegado. Este repositorio no incluye todavía un chatbot de WhatsApp ni una URL pública desplegada. Como siguientes mejoras se pueden añadir integración con WhatsApp Business Platform, recordatorios automáticos y soporte para varios barberos.

## Publicación

La aplicación puede desplegarse en un hosting compatible con Next.js, como Vercel. Al importar el proyecto, el proveedor genera una URL para compartir ([guía de Next.js en Vercel](https://vercel.com/docs/frameworks/nextjs)).

Configura **NEXT_PUBLIC_SUPABASE_URL** y **NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY** en el proveedor de hosting. En Supabase, agrega la URL pública como **Site URL** y permite también su ruta **/auth/callback** en las redirecciones.


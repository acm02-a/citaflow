# CitaFlow

**Agendamiento por WhatsApp con IA para PYMEs de LatAm.**
Tu cliente escribe a tu WhatsApp, la IA conversa, agenda la cita y manda
recordatorios para reducir inasistencias. Producto pensado para clínicas,
salones, estudios y consultorios. Un producto de Manto.

> Construido como MVP funcional el 2026-06-24. **Corre de verdad, sin instalar
> nada y sin keys.** Lee abajo qué está hecho y qué falta para comercializarlo
> (te lo digo derecho, sin humo).

## Pruébalo en 10 segundos

```bash
cd citaflow
node server.mjs
```

Luego abre:
- **http://localhost:4000/** — landing comercial (con precios y comparación vs Calendly).
- **http://localhost:4000/book?t=clinica-sonrisa** — página de reserva: escríbele al asistente como si fueras un paciente.
- **http://localhost:4000/login** — entra al panel. Cuenta demo precargada: **demo@citaflow.app / demo1234**. O crea tu propio negocio (alta self-serve).
- **http://localhost:4000/app** — dashboard del negocio (requiere login): citas, estadísticas, recordatorios y un probador del asistente.

Y el test end-to-end sin servidor:
```bash
node test/sim.mjs
```

No necesita `npm install` (cero dependencias). Sin `GROQ_API_KEY` corre en
**modo reglas** (igual agenda); con la key, usa el LLM para conversar libre.

## El ángulo competitivo (por qué puede venderse)

| | CitaFlow | Calendly / links |
|---|---|---|
| Dónde agenda | **Dentro de WhatsApp** (donde el cliente ya está) | Link que hay que abrir |
| Cómo | **Conversa en español con IA** | Formulario rígido, inglés-first |
| Foco | **Bajar inasistencias** (recordatorios) | Solo agendar |
| Mercado | **PYME LatAm** | Genérico/global |

El dolor real de una clínica no es "no tener agenda online" — es **perder plata
por inasistencias** y **perder mensajes en el WhatsApp**. CitaFlow ataca eso.

## Arquitectura

```
server.mjs        Servidor HTTP (node:http, cero deps): API + páginas + webhook WhatsApp.
src/store.mjs     Persistencia multi-tenant (JSON hoy; interfaz lista para Postgres/Supabase).
src/booking.mjs   Motor de cupos puro: horarios libres, anti doble-reserva, recordatorios.
src/brain.mjs     Asistente conversacional: Groq (LLM) con fallback de reglas determinista.
src/auth.mjs      Registro/login (scrypt + tokens HMAC firmados). Sin dependencias.
src/reminders.mjs Job de recordatorios (cron / POST /api/cron/reminders).
src/whatsapp.mjs  Envío por Meta Cloud API (en dev sólo loguea).
public/           Landing, dashboard y widget de reserva (sin build, HTML/CSS/JS).
test/sim.mjs      Simulación end-to-end offline.
```

Diseño clave: la **lógica no depende del canal ni de la base**. Hoy WhatsApp +
JSON; mañana Instagram/web + Postgres, sin reescribir el motor.

## Qué está HECHO (probado)
- Reserva conversacional completa (entiende, ofrece cupos, pide nombre, agenda).
- Anti doble-reserva, cancelación, recordatorios sin reenvío.
- Multi-tenant (varios negocios por `slug`), con aislamiento entre cuentas.
- **Autenticación real** (registro/login, scrypt + tokens firmados, cookie HttpOnly).
- **Alta self-serve**: un negocio se registra, obtiene su panel privado y su link de reservas.
- Dashboard protegido con citas, estados (vino/canceló), estadísticas y **ajustes editables** (servicios, dirección, duración de cita — recalcula cupos al instante).
- **Recordatorios automáticos** (el servidor revisa cada hora las citas de mañana).
- Landing comercial con precios. Webhook de WhatsApp listo para recibir.

## Qué FALTA para comercializarlo (honesto)
Esto es un MVP sólido, **no un SaaS de producción**. Para cobrar hace falta:
1. **Facturación** (Stripe/Culqi/Mercado Pago) para cobrar los planes.
2. **Base real** (migrar el store JSON a Postgres/Supabase — la interfaz ya está lista).
3. **Conectar WhatsApp por negocio** en el onboarding (hoy el alta crea el panel; falta el paso de vincular su número).
4. **WhatsApp Business verificado** + token permanente (lo mismo pendiente del clasificador).
5. **Deploy** (un VPS/Render/Fly) + dominio + HTTPS (y cookies Secure).
6. **Seguridad**: rate-limit, validación de firma del webhook de Meta, backups.

## Roadmap sugerido para llevarlo a mercado
- **Semana 1:** migrar a Supabase + login simple + deploy. Conectar 1 WhatsApp real.
- **Semana 2:** piloto GRATIS con 1 clínica de tu lista ([[prospeccion-clinicas-lima]]). Medir inasistencias antes/después.
- **Semana 3:** con el caso real, cerrar 2-3 pagadas (S/99/mes) y agregar facturación.
- Validado eso, recién invertir en onboarding self-serve y escalar.

> El camino sano: **vender el servicio hecho-a-mano primero** (tú conectas cada
> clínica), validar que pagan y que baja la inasistencia, y *después* automatizar
> el alta. No construyas el self-serve antes de la primera venta.

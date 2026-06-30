/* -------------------------------------------------------------------------- */
/*  CitaRA — servidor (cero dependencias, node:http).                         */
/*  Sirve: landing, dashboard, widget de reservas, API y webhook de WhatsApp.   */
/*  Arranca con:  node server.mjs   (siembra una clínica demo automáticamente). */
/* -------------------------------------------------------------------------- */

import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {join, dirname, extname} from "node:path";
import {fileURLToPath} from "node:url";
import {createHmac, timingSafeEqual} from "node:crypto";

import * as store from "./src/db-store.mjs";
import * as auth from "./src/auth.mjs";
import {availableSlots} from "./src/booking.mjs";
import {respond} from "./src/brain.mjs";
import {runReminders} from "./src/reminders.mjs";
import {seedDemo} from "./src/seed.mjs";
import {chargePlan, PLANS} from "./src/billing.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, "public");
const PORT = process.env.PORT || 4000;
const GROQ_KEY = process.env.GROQ_API_KEY;

if (process.env.SEED_DEMO !== "false") {
  try {
    await seedDemo(); // demo (desactivar en prod con SEED_DEMO=false)
  } catch (e) {
    console.error(`\n⚠️  No se pudo conectar a la base: ${e.message}`);
    console.error("   Revisa SUPABASE_URL y SUPABASE_SERVICE_KEY (del proyecto correcto).\n");
  }
}

/* ------------------------------ helpers ---------------------------------- */

const MIME = {".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon"};

const json = (res, code, data) => {
  res.writeHead(code, {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"});
  res.end(JSON.stringify(data));
};

async function serveFile(res, file) {
  const path = join(PUBLIC, file);
  if (!existsSync(path)) return json(res, 404, {error: "not found"});
  const body = await readFile(path);
  res.writeHead(200, {"Content-Type": MIME[extname(path)] || "application/octet-stream"});
  res.end(body);
}

async function getUser(req) {
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/cf_token=([^;]+)/);
  const bearer = (req.headers.authorization || "").replace(/^Bearer /, "");
  return await auth.verifyToken(m ? decodeURIComponent(m[1]) : bearer);
}
const isHttps = (req) => (req.headers["x-forwarded-proto"] || "").includes("https");
const authCookie = (token, secure) =>
  `cf_token=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${7 * 24 * 3600}; SameSite=Lax${secure ? "; Secure" : ""}`;

// Rate limit simple en memoria para los endpoints de auth (anti fuerza bruta).
const hits = new Map();
function rateLimited(req, max = 10, windowMs = 60000) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "ip").split(",")[0].trim();
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.ts > windowMs) {
    hits.set(ip, {count: 1, ts: now});
    return false;
  }
  rec.count++;
  return rec.count > max;
}

const readRawBody = (req) =>
  new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
  });

const readBody = async (req) => {
  const raw = await readRawBody(req);
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
};

// Verifica que el POST realmente venga de Meta (HMAC-SHA256 con el App Secret
// sobre el body crudo). Sin WHATSAPP_APP_SECRET configurado, deja pasar (dev)
// pero avisa una vez — cualquiera podría falsificar mensajes de WhatsApp si
// esto se queda así en producción.
let warnedNoAppSecret = false;
function verifyMetaSignature(raw, signatureHeader) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    if (!warnedNoAppSecret) {
      console.warn("⚠️  WHATSAPP_APP_SECRET no configurado: el webhook de WhatsApp NO valida la firma de Meta. Configúralo antes de ir a producción.");
      warnedNoAppSecret = true;
    }
    return true;
  }
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const given = signatureHeader.slice(7);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(given, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function slotsFor(tenant) {
  const appts = (await store.listAppointments(tenant.id)).filter((a) => a.status !== "cancelled");
  // Normalizamos a ISO canónico (…000Z) para que calce con el iso de los cupos,
  // sin importar el formato en que la DB devuelva starts_at.
  const booked = new Set(appts.map((a) => {
    const d = new Date(a.starts_at);
    return isNaN(d) ? a.starts_at : d.toISOString();
  }));
  return availableSlots(tenant, booked);
}

async function statsFor(tenantId) {
  const all = await store.listAppointments(tenantId);
  const tenant = await store.getTenantById(tenantId);
  const ticket = tenant?.avg_ticket ?? 80;
  const now = new Date();
  const past = all.filter((a) => new Date(a.starts_at) < now);
  const cancelled = all.filter((a) => a.status === "cancelled").length;
  const done = all.filter((a) => a.status === "done").length;
  const noShow = all.filter((a) => a.status === "no_show").length;
  const upcomingList = all.filter((a) => a.status === "confirmed" && new Date(a.starts_at) >= now);
  const upcoming = upcomingList.length;
  const confirmadas = upcomingList.filter((a) => a.patient_confirmed).length;
  const sinConfirmar = upcoming - confirmadas;
  const reminded = all.filter((a) => a.reminded_at).length;
  const completionRate = past.length ? Math.round((done / past.length) * 100) : null;
  // Tasa de inasistencia sobre lo ya ocurrido (no_show vs. las que tuvieron desenlace).
  const resueltas = done + noShow;
  const noShowRate = resueltas ? Math.round((noShow / resueltas) * 100) : null;
  return {total: all.length, upcoming, confirmadas, sinConfirmar, cancelled, done, noShow, reminded, completionRate, noShowRate, pipelineValue: upcoming * ticket};
}

/* ------------------------------- router ---------------------------------- */

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);
  const method = req.method;

  // Headers de seguridad básicos.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH", "Access-Control-Allow-Headers": "Content-Type"});
    return res.end();
  }

  try {
    // ---------- páginas ----------
    if (method === "GET" && url.pathname === "/") return serveFile(res, "index.html");
    if (method === "GET" && url.pathname === "/app") return serveFile(res, "app.html");
    if (method === "GET" && url.pathname === "/login") return serveFile(res, "login.html");
    if (method === "GET" && url.pathname === "/privacy") return serveFile(res, "privacy.html");
    if (method === "GET" && url.pathname === "/terms") return serveFile(res, "terms.html");
    if (method === "GET" && url.pathname === "/book") return serveFile(res, "book.html");
    if (method === "GET" && parts[0] === "public") return serveFile(res, parts.slice(1).join("/"));
    if (method === "GET" && [".css", ".js"].includes(extname(url.pathname))) return serveFile(res, parts.join("/"));

    // ---------- Auth ----------
    if (parts[0] === "api" && parts[1] === "auth") {
      if (method === "POST" && (parts[2] === "signup" || parts[2] === "login")) {
        if (rateLimited(req)) return json(res, 429, {error: "Demasiados intentos. Espera un minuto."});
      }
      if (method === "POST" && parts[2] === "signup") {
        const r = await auth.signup(await readBody(req));
        if (!r.ok) return json(res, 400, {error: r.error});
        res.setHeader("Set-Cookie", authCookie(r.token, isHttps(req)));
        return json(res, 201, {tenant: {name: r.tenant.name, slug: r.tenant.slug}, token: r.token});
      }
      if (method === "POST" && parts[2] === "login") {
        const r = await auth.login(await readBody(req));
        if (!r.ok) return json(res, 401, {error: r.error});
        res.setHeader("Set-Cookie", authCookie(r.token, isHttps(req)));
        return json(res, 200, {tenant: {name: r.tenant.name, slug: r.tenant.slug}, token: r.token});
      }
      if (method === "POST" && parts[2] === "logout") {
        res.setHeader("Set-Cookie", "cf_token=; HttpOnly; Path=/; Max-Age=0");
        return json(res, 200, {ok: true});
      }
      if (method === "GET" && parts[2] === "me") {
        const u = await getUser(req);
        if (!u) return json(res, 401, {error: "no autenticado"});
        const t = await store.getTenantById(u.tenant_id);
        return json(res, 200, {email: u.email, tenant: {name: t.name, slug: t.slug}});
      }
    }

    // ---------- API pública (widget de reservas) ----------
    if (parts[0] === "api" && parts[1] === "tenants") {
      const tenant = await store.getTenantBySlug(parts[2]);
      if (!tenant) return json(res, 404, {error: "clínica no encontrada"});

      if (method === "GET" && parts.length === 3)
        return json(res, 200, {name: tenant.name, slug: tenant.slug, services: tenant.services, address: tenant.address, slot_minutes: tenant.slot_minutes, avg_ticket: tenant.avg_ticket, plan: tenant.plan});

      if (method === "GET" && parts[3] === "slots")
        return json(res, 200, {slots: (await slotsFor(tenant)).slice(0, 24).map((s) => ({iso: s.iso, label: s.label}))});

      if (method === "POST" && parts[3] === "appointments") {
        const b = await readBody(req);
        if (!b.patient_name || !b.patient_phone || !b.iso) return json(res, 400, {error: "faltan datos"});
        const r = await store.addAppointment({tenant_id: tenant.id, ...b, starts_at: b.iso});
        return r.ok ? json(res, 201, {appointment: r.appointment}) : json(res, 409, {error: "ese horario ya se ocupó"});
      }
    }

    // ---------- chat conversacional (web demo + WhatsApp) ----------
    if (parts[0] === "api" && parts[1] === "chat" && method === "POST") {
      const tenant = await store.getTenantBySlug(parts[2]);
      if (!tenant) return json(res, 404, {error: "clínica no encontrada"});
      const {phone = "web-demo", message = "", name} = await readBody(req);
      const reply = await handleConversation(tenant, phone, message, name);
      return json(res, 200, {reply});
    }

    // ---------- API admin (dashboard, protegida) ----------
    if (parts[0] === "api" && parts[1] === "admin") {
      const tenant = await store.getTenantBySlug(parts[2]);
      if (!tenant) return json(res, 404, {error: "clínica no encontrada"});

      const user = await getUser(req);
      if (!user || user.tenant_id !== tenant.id)
        return json(res, 401, {error: "no autorizado"});

      if (method === "GET" && parts[3] === "appointments")
        return json(res, 200, {appointments: await store.listAppointments(tenant.id, {status: url.searchParams.get("status") || undefined})});

      if (method === "GET" && parts[3] === "stats")
        return json(res, 200, await statsFor(tenant.id));

      if (method === "PATCH" && parts[3] === "appointments" && parts[4]) {
        const b = await readBody(req);
        const updated = await store.updateAppointment(tenant.id, parts[4], {status: b.status});
        return updated ? json(res, 200, {appointment: updated}) : json(res, 404, {error: "cita no encontrada"});
      }

      if (method === "PUT" && parts[3] === "settings") {
        const b = await readBody(req);
        const t = await store.upsertTenant({id: tenant.id, ...b});
        return json(res, 200, {tenant: t});
      }

      if (method === "POST" && parts[3] === "upgrade") {
        const b = await readBody(req);
        if (!PLANS[b.plan]) return json(res, 400, {error: "Plan inválido"});
        const charge = await chargePlan({plan: b.plan, token: b.token, email: user.email});
        if (!charge.ok) return json(res, 402, {error: charge.error});
        const t = await store.upsertTenant({id: tenant.id, plan: b.plan});
        return json(res, 200, {plan: t.plan, simulated: charge.simulated || false});
      }
    }

    // ---------- config pública (claves no sensibles para el frontend) ----------
    if (method === "GET" && url.pathname === "/api/config")
      return json(res, 200, {culqiPublicKey: process.env.CULQI_PUBLIC_KEY || null});

    // ---------- cron de recordatorios ----------
    if (parts[0] === "api" && parts[1] === "cron" && parts[2] === "reminders" && method === "POST") {
      const sent = await runReminders();
      return json(res, 200, {sent});
    }

    // ---------- webhook de WhatsApp (Meta) ----------
    if (parts[0] === "webhook" && parts[1] === "whatsapp") {
      if (method === "GET") { // verificación de Meta (handshake inicial)
        const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
        const tokenOk = !verifyToken || url.searchParams.get("hub.verify_token") === verifyToken;
        if (!tokenOk) return json(res, 403, {error: "verify_token inválido"});
        const challenge = url.searchParams.get("hub.challenge");
        return res.end(challenge || "ok");
      }
      if (method === "POST") {
        const raw = await readRawBody(req);
        if (!verifyMetaSignature(raw, req.headers["x-hub-signature-256"]))
          return json(res, 401, {error: "firma inválida"});
        let body = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch { /* body inválido, se ignora abajo */ }
        await handleWhatsAppWebhook(body);
        return json(res, 200, {received: true});
      }
    }

    return json(res, 404, {error: "ruta no encontrada"});
  } catch (e) {
    console.error("error:", e);
    return json(res, 500, {error: e.message});
  }
});

/* --------------------------- lógica de chat ------------------------------ */

// Próxima cita vigente del paciente (por teléfono), de hoy en adelante.
async function nextApptByPhone(tenantId, phone) {
  const now = new Date();
  return (await store.listAppointments(tenantId, {status: "confirmed"}))
    .find((a) => a.patient_phone === phone && new Date(a.starts_at) >= now) || null;
}

async function handleConversation(tenant, phone, message, name) {
  const convo = await store.getConversation(tenant.id, phone);
  const slots = await slotsFor(tenant);

  // --- Lazo anti-inasistencia: si el paciente CONFIRMA su cita ya agendada. ---
  // Solo si no está a medio reservar (para no pisar el flujo de agendado).
  const stage = convo.pending?.stage;
  const enFlujo = stage === "offered" || stage === "awaiting_name";
  const t = message.toLowerCase();
  const esConfirmacion = /\b(s[ií]|confirm\w*|asistir[eé]|ah[ií] estar[eé]|ahi estare|cuenten conmigo|claro)\b/.test(t) && !/\bno\b|cancel|anular|reprogram|cambiar|mover/.test(t);
  if (!enFlujo && esConfirmacion) {
    const appt = await nextApptByPhone(tenant.id, phone);
    if (appt && !appt.patient_confirmed) {
      await store.updateAppointment(tenant.id, appt.id, {patient_confirmed: true, confirmed_at: new Date().toISOString()});
      const reply = `¡Gracias, ${appt.patient_name}! ✅ Tu cita quedó confirmada. Te esperamos 🌿`;
      const history = [...convo.history, {role: "user", content: message}, {role: "assistant", content: reply}];
      await store.saveConversation(tenant.id, phone, history, convo.pending);
      return reply;
    }
  }

  const {reply, action, pending} = await respond({
    tenant, message, history: convo.history, slots,
    pending: convo.pending, apiKey: GROQ_KEY,
  });

  let finalReply = reply;
  let finalPending = pending;

  if (action?.type === "book" && action.iso) {
    const patient = name || action.name || pending?.name || "Paciente";
    const r = await store.addAppointment({tenant_id: tenant.id, patient_name: patient, patient_phone: phone, service: action.service || pending?.service, starts_at: action.iso});
    if (!r.ok) {
      // El cupo se ocupó entre que lo ofrecimos y reservamos. En vez de dejar la
      // conversación pegada, recalculamos cupos frescos y reofrecemos al toque.
      const fresh = (await slotsFor(tenant)).slice(0, 3);
      if (fresh.length) {
        const lines = fresh.map((s, i) => `${i + 1}. ${s.label}`).join("\n");
        finalReply = `Uy, ese horario justo se ocupó 🙈 Estos están libres:\n${lines}\n¿Cuál prefieres?`;
        // Guardamos el nombre para no volver a pedirlo: al elegir, reserva directo.
        finalPending = {stage: "offered", offered: fresh, service: pending?.service, name: patient};
      } else {
        finalReply = "Uy, ese horario se ocupó y no me quedan cupos esta semana. ¿Te aviso cuando se abran?";
        finalPending = {stage: "new"};
      }
    }
  } else if (action?.type === "cancel") {
    const next = (await store.listAppointments(tenant.id, {status: "confirmed"})).find((a) => a.patient_phone === phone && new Date(a.starts_at) > new Date());
    if (next) await store.updateAppointment(tenant.id, next.id, {status: "cancelled"});
  }

  const history = [...convo.history, {role: "user", content: message}, {role: "assistant", content: finalReply}];
  await store.saveConversation(tenant.id, phone, history, finalPending);
  return finalReply;
}

async function handleWhatsAppWebhook(body) {
  // Estructura de Meta: entry[].changes[].value.messages[]
  try {
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return;
    const phoneId = value?.metadata?.phone_number_id;
    const tenants = await store.listTenants();
    const tenant = tenants.find((t) => t.whatsapp_phone_id === phoneId) || tenants[0];
    if (!tenant) return;
    const name = value?.contacts?.[0]?.profile?.name;
    const reply = await handleConversation(tenant, msg.from, msg.text?.body || "", name);
    const {sendWhatsApp} = await import("./src/whatsapp.mjs");
    await sendWhatsApp(tenant.whatsapp_phone_id, msg.from, reply);
  } catch (e) {
    console.error("webhook parse error:", e.message);
  }
}

// Recordatorios automáticos: revisa cada hora si hay citas para mañana.
const REMINDER_EVERY_MS = 60 * 60 * 1000;
setInterval(() => {
  runReminders().then((sent) => {
    if (sent.length) console.log(`⏰ Recordatorios enviados automáticamente: ${sent.length}`);
  }).catch((e) => console.error("cron recordatorios:", e.message));
}, REMINDER_EVERY_MS);

server.listen(PORT, () => {
  console.log(`\n🗓️  CitaRA corriendo en http://localhost:${PORT}`);
  console.log(`   Landing:   http://localhost:${PORT}/`);
  console.log(`   Dashboard: http://localhost:${PORT}/app`);
  console.log(`   Reservar:  http://localhost:${PORT}/book?t=clinica-sonrisa`);
  console.log(`   IA: ${GROQ_KEY ? "Groq conectado" : "modo offline (reglas) — pon GROQ_API_KEY para el LLM"}\n`);
});

export {server, handleConversation};

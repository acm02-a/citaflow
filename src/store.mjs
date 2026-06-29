/* -------------------------------------------------------------------------- */
/*  Persistencia multi-tenant. Para el MVP usa un archivo JSON (cero deps,      */
/*  corre en cualquier lado). La interfaz está pensada para cambiarse a         */
/*  Postgres/Supabase sin tocar el resto del código: mismas funciones.          */
/* -------------------------------------------------------------------------- */

import {readFileSync, writeFileSync, existsSync, mkdirSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {randomUUID} from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "data");
const DB_FILE = join(DATA_DIR, "db.json");

const EMPTY = {tenants: {}, appointments: [], conversations: {}, users: {}};

function load() {
  if (!existsSync(DB_FILE)) return structuredClone(EMPTY);
  try {
    return {...structuredClone(EMPTY), ...JSON.parse(readFileSync(DB_FILE, "utf8"))};
  } catch {
    return structuredClone(EMPTY);
  }
}

let db = load();

function persist() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, {recursive: true});
  writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

/* ----------------------------- Tenants ----------------------------------- */

export function listTenants() {
  return Object.values(db.tenants);
}
export function getTenantBySlug(slug) {
  return Object.values(db.tenants).find((t) => t.slug === slug) || null;
}
export function getTenantById(id) {
  return db.tenants[id] || null;
}
export function upsertTenant(input) {
  const id = input.id || randomUUID();
  const existing = db.tenants[id] || {};
  db.tenants[id] = {
    id,
    name: input.name ?? existing.name ?? "Negocio",
    slug: input.slug ?? existing.slug ?? id.slice(0, 8),
    timezone: input.timezone ?? existing.timezone ?? "America/Lima",
    hours: input.hours ?? existing.hours ?? {
      1: "09:00-19:00", 2: "09:00-19:00", 3: "09:00-19:00",
      4: "09:00-19:00", 5: "09:00-19:00", 6: "09:00-13:00",
    },
    slot_minutes: input.slot_minutes ?? existing.slot_minutes ?? 30,
    avg_ticket: input.avg_ticket ?? existing.avg_ticket ?? 80,
    services: input.services ?? existing.services ?? ["consulta"],
    address: input.address ?? existing.address ?? "",
    plan: input.plan ?? existing.plan ?? "trial",
    whatsapp_phone_id: input.whatsapp_phone_id ?? existing.whatsapp_phone_id ?? null,
    created_at: existing.created_at ?? new Date().toISOString(),
  };
  persist();
  return db.tenants[id];
}

/* --------------------------- Appointments -------------------------------- */

export function listAppointments(tenantId, {from, status} = {}) {
  return db.appointments
    .filter((a) => a.tenant_id === tenantId)
    .filter((a) => (status ? a.status === status : true))
    .filter((a) => (from ? new Date(a.starts_at) >= from : true))
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
}

/** Reserva atómica: rechaza si el cupo ya está tomado (anti doble-reserva). */
export function addAppointment({tenant_id, patient_name, patient_phone, service, starts_at}) {
  const taken = db.appointments.some(
    (a) => a.tenant_id === tenant_id && a.starts_at === starts_at && a.status !== "cancelled",
  );
  if (taken) return {ok: false, reason: "slot_taken"};

  const appt = {
    id: randomUUID(),
    tenant_id,
    patient_name,
    patient_phone,
    service: service || null,
    starts_at,
    status: "confirmed",
    reminded_at: null,
    patient_confirmed: false,
    confirmed_at: null,
    created_at: new Date().toISOString(),
  };
  db.appointments.push(appt);
  persist();
  return {ok: true, appointment: appt};
}

export function updateAppointment(tenantId, id, patch) {
  const appt = db.appointments.find((a) => a.id === id && a.tenant_id === tenantId);
  if (!appt) return null;
  Object.assign(appt, patch);
  persist();
  return appt;
}

export function allAppointments() {
  return db.appointments;
}

/* --------------------------- Conversations ------------------------------- */

const key = (tenantId, phone) => `${tenantId}:${phone}`;

export function getConversation(tenantId, phone) {
  return db.conversations[key(tenantId, phone)] || {history: [], pending: null};
}
export function saveConversation(tenantId, phone, history, pending) {
  db.conversations[key(tenantId, phone)] = {
    history: history.slice(-12),
    pending: pending ?? null,
    updated_at: new Date().toISOString(),
  };
  persist();
}

/* ------------------------------- Users ----------------------------------- */

export function getUserByEmail(email) {
  return Object.values(db.users).find((u) => u.email === email.toLowerCase()) || null;
}
export function getUserById(id) {
  return db.users[id] || null;
}
export function addUser({email, password_hash, salt, tenant_id}) {
  const id = randomUUID();
  db.users[id] = {id, email: email.toLowerCase(), password_hash, salt, tenant_id, created_at: new Date().toISOString()};
  persist();
  return db.users[id];
}

/** Sólo para tests: reinicia la base en memoria. */
export function _resetForTests() {
  db = structuredClone(EMPTY);
}

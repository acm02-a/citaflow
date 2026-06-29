/* -------------------------------------------------------------------------- */
/*  Adaptador de persistencia a Supabase (Postgres). Misma interfaz que          */
/*  store.mjs pero ASYNC. Se activa solo cuando hay SUPABASE_URL en el entorno    */
/*  (ver db-store.mjs). Tablas con prefijo citaflow_ para convivir con otros      */
/*  productos en el mismo proyecto Supabase.                                     */
/*                                                                              */
/*  Requiere: npm install @supabase/supabase-js  y  SUPABASE_SERVICE_KEY en .env. */
/* -------------------------------------------------------------------------- */

import {createClient} from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: {persistSession: false},
});

const T = {
  tenants: "citaflow_tenants",
  users: "citaflow_users",
  appts: "citaflow_appointments",
  convos: "citaflow_conversations",
};

/* ----- Tenants ----- */
export async function listTenants() {
  const {data} = await sb.from(T.tenants).select("*");
  return data ?? [];
}
export async function getTenantBySlug(slug) {
  const {data} = await sb.from(T.tenants).select("*").eq("slug", slug).maybeSingle();
  return data ?? null;
}
export async function getTenantById(id) {
  const {data} = await sb.from(T.tenants).select("*").eq("id", id).maybeSingle();
  return data ?? null;
}
export async function upsertTenant(input) {
  const {data, error} = await sb.from(T.tenants).upsert(input).select().single();
  if (error) throw error;
  return data;
}

/* ----- Appointments ----- */
export async function listAppointments(tenantId, {from, status} = {}) {
  let q = sb.from(T.appts).select("*").eq("tenant_id", tenantId).order("starts_at");
  if (status) q = q.eq("status", status);
  if (from) q = q.gte("starts_at", from.toISOString());
  const {data} = await q;
  return data ?? [];
}
export async function addAppointment(appt) {
  const {data, error} = await sb.from(T.appts).insert({...appt, status: "confirmed"}).select().single();
  if (error) {
    if (error.code === "23505") return {ok: false, reason: "slot_taken"};
    throw error;
  }
  return {ok: true, appointment: data};
}
export async function updateAppointment(tenantId, id, patch) {
  const {data} = await sb.from(T.appts).update(patch).eq("id", id).eq("tenant_id", tenantId).select().maybeSingle();
  return data ?? null;
}
export async function allAppointments() {
  const {data} = await sb.from(T.appts).select("*");
  return data ?? [];
}

/* ----- Conversations ----- */
export async function getConversation(tenantId, phone) {
  const {data} = await sb.from(T.convos).select("*").eq("tenant_id", tenantId).eq("phone", phone).maybeSingle();
  return data ?? {history: [], pending: null};
}
export async function saveConversation(tenantId, phone, history, pending) {
  await sb.from(T.convos).upsert({
    tenant_id: tenantId, phone, history: history.slice(-12), pending: pending ?? null, updated_at: new Date().toISOString(),
  });
}

/* ----- Users ----- */
export async function getUserByEmail(email) {
  const {data} = await sb.from(T.users).select("*").eq("email", email.toLowerCase()).maybeSingle();
  return data ?? null;
}
export async function getUserById(id) {
  const {data} = await sb.from(T.users).select("*").eq("id", id).maybeSingle();
  return data ?? null;
}
export async function addUser(u) {
  const {data, error} = await sb.from(T.users).insert({...u, email: u.email.toLowerCase()}).select().single();
  if (error) throw error;
  return data;
}

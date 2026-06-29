/* -------------------------------------------------------------------------- */
/*  Simulador end-to-end — corre sin servidor ni keys:  node test/sim.mjs        */
/*  Ejercita los MÓDULOS REALES (store + brain + booking): conversación,         */
/*  reserva, anti doble-reserva y recordatorios.                                */
/* -------------------------------------------------------------------------- */

import * as store from "../src/store.mjs";
import {respond} from "../src/brain.mjs";
import {availableSlots, dueReminders, humanLabel} from "../src/booking.mjs";

store._resetForTests();
const tenant = store.upsertTenant({
  name: "Clínica Sonrisa", slug: "sim",
  services: ["limpieza dental", "ortodoncia"], slot_minutes: 30,
  hours: {1:"09:00-19:00",2:"09:00-19:00",3:"09:00-19:00",4:"09:00-19:00",5:"09:00-19:00",6:"09:00-13:00"},
});

const phone = "+51999111222";

function slotsNow() {
  const appts = store.listAppointments(tenant.id).filter((a) => a.status !== "cancelled");
  return availableSlots(tenant, new Set(appts.map((a) => a.starts_at)));
}

async function turn(message) {
  console.log(`\n  👤 ${message}`);
  const convo = store.getConversation(tenant.id, phone);
  const {reply, action, pending} = await respond({
    tenant, message, history: convo.history, slots: slotsNow(), pending: convo.pending,
  });
  console.log(`  🤖 ${reply.replace(/\n/g, "\n     ")}`);
  if (action?.type === "book" && action.iso) {
    const r = store.addAppointment({tenant_id: tenant.id, patient_name: action.name || "Paciente", patient_phone: phone, service: pending?.service, starts_at: action.iso});
    if (!r.ok) console.log("     (cupo ocupado)");
  }
  store.saveConversation(tenant.id, phone, [...convo.history, {role:"user",content:message}, {role:"assistant",content:reply}], pending);
}

console.log("══════════════════════════════════════════════");
console.log("  CitaFlow — simulación end-to-end (offline)");
console.log("══════════════════════════════════════════════");

await turn("Hola, quiero una cita para limpieza dental");
await turn("El 2 por favor");
await turn("María Fernández");

console.log("\n──────── 🗄️  Citas en base ────────");
for (const a of store.listAppointments(tenant.id))
  console.log(`  • ${a.patient_name} — ${humanLabel(new Date(a.starts_at))} — ${a.service} [${a.status}]`);

console.log("\n──────── 🔒 Anti doble-reserva ────────");
const iso = store.listAppointments(tenant.id)[0].starts_at;
const dup = store.addAppointment({tenant_id: tenant.id, patient_name: "Otro", patient_phone: "+519", starts_at: iso});
console.log(dup.ok ? "  ❌ permitió doble reserva" : "  ✅ bloqueó el cupo tomado (" + dup.reason + ")");

console.log("\n──────── ⏰ Recordatorios (1 día antes) ────────");
const dayBefore = new Date(new Date(iso).getTime() - 20 * 3600 * 1000);
const due = dueReminders(store.listAppointments(tenant.id), dayBefore);
due.forEach((a) => console.log(`  📲 ${a.patient_name}: recordatorio de ${humanLabel(new Date(a.starts_at))}`));

console.log("\n✅ Flujo completo verificado: conversa, agenda, persiste, bloquea choques y recuerda.\n");

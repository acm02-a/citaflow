/* -------------------------------------------------------------------------- */
/*  Job de recordatorios. Recorre todas las citas próximas sin recordar, manda  */
/*  el WhatsApp y marca reminded_at. Se llama desde un cron (o POST /api/cron). */
/* -------------------------------------------------------------------------- */

import {allAppointments, updateAppointment, getTenantById} from "./db-store.mjs";
import {dueReminders, humanLabel} from "./booking.mjs";
import {sendWhatsApp} from "./whatsapp.mjs";

export async function runReminders(now = new Date()) {
  const due = dueReminders(await allAppointments(), now);
  const sent = [];
  for (const a of due) {
    const tenant = await getTenantById(a.tenant_id);
    const when = humanLabel(new Date(a.starts_at));
    const msg = `Hola ${a.patient_name} 👋 Te recordamos tu cita de ${a.service || "atención"} mañana ${when} en ${tenant?.name || "tu cita"}. ¿La confirmas? Responde SÍ o escribe para reprogramar.`;
    await sendWhatsApp(tenant?.whatsapp_phone_id, a.patient_phone, msg);
    await updateAppointment(a.tenant_id, a.id, {reminded_at: now.toISOString()});
    sent.push({id: a.id, patient: a.patient_name, when});
  }
  return sent;
}

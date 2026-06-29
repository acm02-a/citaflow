/* -------------------------------------------------------------------------- */
/*  Motor de cupos — lógica pura (sin red ni DB). Calcula horarios libres a     */
/*  partir del horario del negocio y las citas ya tomadas. Testeable al 100%.   */
/* -------------------------------------------------------------------------- */

const DAYS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function parseRange(range) {
  const toMin = (s) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  };
  const [a, b] = range.split("-");
  return {startMin: toMin(a), endMin: toMin(b)};
}

/** "jueves 4:30 p.m." legible en español. */
export function humanLabel(date) {
  let h = date.getHours();
  const m = date.getMinutes();
  const ampm = h < 12 ? "a.m." : "p.m.";
  h = h % 12 || 12;
  const mm = m === 0 ? "" : ":" + String(m).padStart(2, "0");
  return `${DAYS_ES[date.getDay()]} ${h}${mm} ${ampm}`;
}

/**
 * Cupos libres del negocio para los próximos `days` días.
 * @param tenant {hours, slot_minutes}
 * @param booked Set de ISO strings ocupados
 * @returns [{iso, date, label}]
 */
export function availableSlots(tenant, booked, from = new Date(), days = 7) {
  const slots = [];
  const slotMin = tenant.slot_minutes ?? 30;

  for (let d = 0; d < days; d++) {
    const day = new Date(from);
    day.setDate(from.getDate() + d);
    const range = tenant.hours?.[String(day.getDay())];
    if (!range) continue;

    const {startMin, endMin} = parseRange(range);
    for (let min = startMin; min + slotMin <= endMin; min += slotMin) {
      const slot = new Date(day);
      slot.setHours(0, min, 0, 0);
      if (slot <= from) continue;
      const iso = slot.toISOString();
      if (booked.has(iso)) continue;
      slots.push({iso, date: slot, label: humanLabel(slot)});
    }
  }
  return slots;
}

/** Citas que necesitan recordatorio: confirmadas, dentro de `windowHours`, sin recordar. */
export function dueReminders(appointments, now = new Date(), windowHours = 24) {
  const limit = new Date(now.getTime() + windowHours * 3600 * 1000);
  return appointments.filter(
    (a) =>
      a.status === "confirmed" &&
      !a.reminded_at &&
      new Date(a.starts_at) > now &&
      new Date(a.starts_at) <= limit,
  );
}

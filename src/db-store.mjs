/* -------------------------------------------------------------------------- */
/*  Selector de backend de datos.                                               */
/*  - Con SUPABASE_URL en el entorno  -> usa Supabase (Postgres, producción).    */
/*  - Sin ella                        -> usa el store JSON local (dev/MVP).      */
/*  La interfaz es idéntica; los consumidores usan `await` en todas las llamadas */
/*  (await sobre un valor síncrono también funciona, así el JSON sigue válido).  */
/* -------------------------------------------------------------------------- */

const backend = process.env.SUPABASE_URL
  ? await import("./store-supabase.mjs")
  : await import("./store.mjs");

console.log(`🗄️  Datos: ${process.env.SUPABASE_URL ? "Supabase (citaflow_*)" : "JSON local"}`);

export const {
  listTenants, getTenantBySlug, getTenantById, upsertTenant,
  listAppointments, addAppointment, updateAppointment, allAppointments,
  getConversation, saveConversation,
  getUserByEmail, getUserById, addUser,
} = backend;

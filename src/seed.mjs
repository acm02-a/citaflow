/* -------------------------------------------------------------------------- */
/*  Seed de demo: crea una clínica de ejemplo para poder probar el producto.     */
/*  Idempotente por slug. Async (compatible con backend Supabase).               */
/* -------------------------------------------------------------------------- */

import {getTenantBySlug, upsertTenant} from "./db-store.mjs";
import {ensureUser} from "./auth.mjs";

const DEMO_EMAIL = "demo@citaflow.app";
const DEMO_PASS = "demo1234";

export async function seedDemo() {
  const existing = await getTenantBySlug("clinica-sonrisa");
  if (existing) {
    await ensureUser({email: DEMO_EMAIL, password: DEMO_PASS, tenantId: existing.id});
    return existing;
  }
  const tenant = await upsertTenant({
    name: "Clínica Sonrisa",
    slug: "clinica-sonrisa",
    address: "Av. Larco 675, Miraflores, Lima",
    services: ["limpieza dental", "ortodoncia", "evaluación", "blanqueamiento"],
    slot_minutes: 30,
    hours: {1: "09:00-19:00", 2: "09:00-19:00", 3: "09:00-19:00", 4: "09:00-19:00", 5: "09:00-19:00", 6: "09:00-13:00"},
    plan: "pro",
  });
  await ensureUser({email: DEMO_EMAIL, password: DEMO_PASS, tenantId: tenant.id});
  return tenant;
}

// Permite `npm run seed`
if (process.argv[1]?.endsWith("seed.mjs")) {
  const t = await seedDemo();
  console.log("Seed listo:", t.name, "→ /book?t=" + t.slug);
}

/* -------------------------------------------------------------------------- */
/*  Pagos con Culqi (Perú). En modo dev (sin CULQI_SECRET_KEY) simula el cobro   */
/*  para poder probar el flujo de upgrade sin llaves. En producción crea un       */
/*  cargo real con el token de tarjeta que genera Culqi.js en el front.           */
/*                                                                              */
/*  Planes (en céntimos de sol):                                                 */
/* -------------------------------------------------------------------------- */

export const PLANS = {
  pro: {name: "Pro", amount: 9900, label: "S/99/mes"},
  premium: {name: "Premium", amount: 19900, label: "S/199/mes"},
};

/**
 * Cobra un plan. Si no hay CULQI_SECRET_KEY -> modo simulado (dev).
 * @param token  source_id que genera Culqi.js (tarjeta tokenizada)
 * @returns {ok, chargeId?, simulated?, error?}
 */
export async function chargePlan({plan, token, email}) {
  const p = PLANS[plan];
  if (!p) return {ok: false, error: "Plan inválido"};

  const secret = process.env.CULQI_SECRET_KEY;
  if (!secret) {
    // Dev: no cobramos de verdad, pero dejamos pasar para probar el flujo.
    return {ok: true, simulated: true, chargeId: "dev_" + Date.now()};
  }

  if (!token) return {ok: false, error: "Falta el token de la tarjeta"};
  const res = await fetch("https://api.culqi.com/v2/charges", {
    method: "POST",
    headers: {Authorization: `Bearer ${secret}`, "Content-Type": "application/json"},
    body: JSON.stringify({
      amount: p.amount,
      currency_code: "PEN",
      email: email || "cliente@citaflow.pe",
      source_id: token,
      description: `CitaFlow ${p.name} — 1 mes`,
    }),
  });
  const data = await res.json();
  if (!res.ok) return {ok: false, error: data?.user_message || data?.merchant_message || "Cobro rechazado"};
  return {ok: true, chargeId: data.id};
}

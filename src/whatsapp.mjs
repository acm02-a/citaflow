/* -------------------------------------------------------------------------- */
/*  Envío por WhatsApp Cloud API (Meta). En dev (sin token) sólo loguea, para   */
/*  que todo el flujo sea probable sin credenciales.                            */
/* -------------------------------------------------------------------------- */

export async function sendWhatsApp(phoneId, to, body, token = process.env.WHATSAPP_TOKEN) {
  if (!token || !phoneId) {
    console.log(`📲 [dev] WhatsApp -> ${to}: ${body}`);
    return {ok: true, dev: true};
  }
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"},
    body: JSON.stringify({messaging_product: "whatsapp", to, text: {body}}),
  });
  if (!res.ok) {
    console.error("WhatsApp send error:", await res.text());
    return {ok: false};
  }
  return {ok: true};
}

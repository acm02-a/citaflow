/* -------------------------------------------------------------------------- */
/*  El cerebro conversacional. respond() decide qué contestar y qué acción      */
/*  tomar. Si hay GROQ_API_KEY usa el LLM; si no, cae a un motor de reglas       */
/*  determinista para que el producto sea demoable sin credenciales.            */
/*                                                                              */
/*  Devuelve siempre: { reply, action, pending }                                */
/*    action = {type: 'list_slots'|'book'|'cancel'|'none', iso?, name?}         */
/*    pending = estado de la conversación a medio capturar.                     */
/* -------------------------------------------------------------------------- */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";

export async function respond({tenant, message, history = [], slots, pending, apiKey}) {
  if (apiKey) {
    try {
      return await respondLLM({tenant, message, history, slots, pending, apiKey});
    } catch (e) {
      console.error("Groq falló, uso fallback:", e.message);
    }
  }
  return respondRules({tenant, message, slots, pending});
}

/* ----------------------------- LLM (Groq) -------------------------------- */

function systemPrompt(tenant, slots) {
  const list = slots.slice(0, 6).map((s, i) => `${i + 1}. ${s.label} [iso:${s.iso}]`).join("\n");
  return `Eres el asistente de citas de "${tenant.name}". Español, cálido y breve (máx 2 frases).
Servicios: ${(tenant.services || []).join(", ")}. Dirección: ${tenant.address || "(consultar)"}.
Cupos LIBRES (usa el iso EXACTO al reservar):
${list || "(sin cupos esta semana)"}

Responde SOLO con JSON: {"reply":"...","action":{"type":"list_slots|book|cancel|none","iso":"opcional","name":"nombre del paciente si lo tienes","service":"servicio pedido si lo mencionó"}}
Reglas: ofrece 3 horarios si pide cita; reserva (book) sólo con un horario claro de la lista Y
con el nombre del paciente — ponlo SIEMPRE en action.name (revisa el historial); si falta el
nombre, pídelo con type none; cancela con cancel; nunca inventes horarios ni nombres.`;
}

async function respondLLM({tenant, message, history, slots, pending, apiKey}) {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {"Content-Type": "application/json", Authorization: `Bearer ${apiKey}`},
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.3,
      response_format: {type: "json_object"},
      messages: [
        {role: "system", content: systemPrompt(tenant, slots)},
        ...history,
        {role: "user", content: message},
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const data = await res.json();
  const parsed = parse(data.choices?.[0]?.message?.content);
  // mantenemos un nombre tentativo en pending si lo había
  return {...parsed, pending: pending || null};
}

function parse(raw) {
  if (!raw) return {reply: "¿Me repites, por favor?", action: {type: "none"}};
  try {
    const j = JSON.parse(raw);
    return {reply: j.reply ?? "", action: j.action ?? {type: "none"}};
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return parse(m[0]);
    return {reply: String(raw).slice(0, 300), action: {type: "none"}};
  }
}

/* ----------------------- Fallback determinista --------------------------- */

const NUM = {uno: 1, "1": 1, primer: 1, primero: 1, dos: 2, "2": 2, segund: 2, tres: 3, "3": 3, tercer: 3};

function detectChoice(text, offered) {
  const t = text.toLowerCase();
  // "la última / el último" → último cupo ofrecido
  if (/[uú]ltim[oa]/.test(t)) return offered[offered.length - 1];
  // por número / palabra
  for (const [k, v] of Object.entries(NUM)) {
    if (t.includes(k) && offered[v - 1]) return offered[v - 1];
  }
  // por día de la semana mencionado
  const hit = offered.find((s) => t.includes(s.label.split(" ")[0]));
  return hit || null;
}

/** Horario legible del negocio, agrupando días iguales. */
function horarioHumano(tenant) {
  const D = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const h = tenant.hours || {};
  const pretty = (r) => r.split("-").map((x) => x.replace(/:00$/, "").replace(/^0/, "")).join("–");
  const partes = [];
  for (let i = 1; i <= 6; i++) if (h[i]) partes.push(`${D[i]} ${pretty(h[i])}`);
  if (!h[0]) partes.push("dom cerrado");
  return partes.join(", ");
}

function looksLikeName(text) {
  const t = text.trim();
  return /^[\p{L} ]{3,40}$/u.test(t) && t.split(/\s+/).length <= 4 && !/cita|hola|s[ií]\b|no|gracias|quiero|limpieza/i.test(t);
}

function respondRules({tenant, message, slots, pending}) {
  const t = message.toLowerCase();
  const p = pending || {stage: "new"};

  // 1) Ya eligió horario y le estamos pidiendo el nombre.
  if (p.stage === "awaiting_name" && p.chosenIso) {
    if (looksLikeName(message)) {
      const name = message.trim();
      return {
        reply: `¡Listo, ${name}! ✅ Te agendé el ${labelOf(p.offered, p.chosenIso)}. Te recuerdo un día antes 🌿`,
        action: {type: "book", iso: p.chosenIso, name, service: p.service},
        pending: {stage: "done", service: p.service},
      };
    }
    return {reply: "¿Me confirmas tu nombre completo, por favor?", action: {type: "none"}, pending: p};
  }

  // 2) Le ofrecimos cupos y está eligiendo uno.
  if (p.stage === "offered" && p.offered?.length) {
    const choice = detectChoice(message, p.offered);
    if (choice) {
      if (p.name) {
        return {
          reply: `¡Listo, ${p.name}! ✅ Te agendé el ${labelOf(p.offered, choice.iso)}. Te recuerdo un día antes 🌿`,
          action: {type: "book", iso: choice.iso, name: p.name, service: p.service},
          pending: {stage: "done", service: p.service},
        };
      }
      return {
        reply: "Perfecto. ¿Me confirmas tu nombre completo?",
        action: {type: "none"},
        pending: {...p, stage: "awaiting_name", chosenIso: choice.iso},
      };
    }
  }

  // reprogramar / cambiar / mover cita → cancela la actual y ofrece cupos nuevos
  if (/reprogram|reagend|mover (la|mi)|cambiar (la|mi)|otro (d[ií]a|horario)/.test(t)) {
    const top = slots.slice(0, 3);
    if (!top.length) return {reply: "Cancelé tu cita. Por ahora no tengo otros cupos esta semana, ¿te aviso cuando se abran?", action: {type: "cancel"}, pending: {stage: "new"}};
    const lines = top.map((s, i) => `${i + 1}. ${s.label}`).join("\n");
    return {reply: `Claro, reprogramamos. Estos cupos tengo:\n${lines}\n¿Cuál te viene mejor?`, action: {type: "cancel"}, pending: {stage: "offered", offered: top}};
  }

  // cancelar
  if (/cancel|anular/.test(t)) {
    return {reply: "Hecho, cancelé tu próxima cita. ¿Te agendo otra?", action: {type: "cancel"}, pending: {stage: "new"}};
  }

  // preguntas de info (antes de intención de agendar, para no confundir)
  if (/d[oó]nde|direcci[oó]n|ubicaci[oó]n|quedan|c[oó]mo llego|llegar/.test(t))
    return {reply: `Estamos en ${tenant.address || "(consulta la dirección con la clínica)"}. ¿Te agendo una cita? 🌿`, action: {type: "none"}, pending: p};
  if (/qu[eé] servicios|qu[eé] (hacen|ofrecen|atienden)|qu[eé] tratamient/.test(t))
    return {reply: `Atendemos: ${(tenant.services || []).join(", ")}. ¿Para cuál te agendo?`, action: {type: "none"}, pending: p};
  if (/horario|qu[eé] d[ií]as|abren|atienden|hasta qu[eé] hora|a qu[eé] hora/.test(t))
    return {reply: `Nuestro horario: ${horarioHumano(tenant)}. ¿Quieres que te busque un cupo?`, action: {type: "none"}, pending: p};
  if (/precio|cu[aá]nto (cuesta|vale|sale|es)|cu[aá]nto cobran|tarifa|costo/.test(t))
    return {reply: "El precio depende del servicio; te lo confirma la clínica al agendar. ¿Te reservo una cita para evaluarte? 🌿", action: {type: "none"}, pending: p};

  // intención de agendar / menciona servicio / responde que sí
  const service = (tenant.services || []).find((s) => t.includes(s.split(" ")[0].toLowerCase()));
  const afirma = /\b(s[ií]|ya|dale|de una|ok(?:ey)?|claro|bueno|por\s?fa(?:vor)?|perfecto|quiero|me gustar[ií]a|necesito|ag[eé]nd\w*|res[eé]rva\w*)\b/.test(t);
  if (/cita|agendar|reservar|hora|turno|disponib|cupo|horario/.test(t) || service || afirma) {
    const top = slots.slice(0, 3);
    if (!top.length) return {reply: "Por ahora no tengo cupos esta semana. ¿Te aviso cuando se abran?", action: {type: "none"}, pending: p};
    const lines = top.map((s, i) => `${i + 1}. ${s.label}`).join("\n");
    return {
      reply: `¡Hola! 😊 Para ${service || "tu cita"} tengo:\n${lines}\n¿Cuál te viene bien?`,
      action: {type: "list_slots"},
      pending: {stage: "offered", offered: top, service},
    };
  }

  // agradecimiento / despedida
  if (/gracias|muchas gracias|chau|hasta luego|nos vemos|listo gracias/.test(t))
    return {reply: "¡Un gusto! Cualquier cosa, aquí estoy. Que te vaya bien 🌿", action: {type: "none"}, pending: p};

  // saludo / por defecto
  return {
    reply: `¡Hola! Soy el asistente de ${tenant.name}. ¿Te ayudo a agendar una cita? Dime qué necesitas 🌿`,
    action: {type: "none"},
    pending: p,
  };
}

function labelOf(offered, iso) {
  const s = offered.find((o) => o.iso === iso);
  return s ? s.label : "tu cita";
}

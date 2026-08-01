'use strict';

const { emptyExtraction, INTENTS, CONFIRMATIONS } = require('./schemas');
const {
  normalize, parseDate, parseTime, normalizePhone, branchFromText,
  affirmative, negative,
} = require('./utils');

function infoRequests(text) {
  const n = normalize(text);
  const out = [];
  const push = (type, service_text=null) => {
    if (!out.some(x => x.type === type)) out.push({ type, service_text });
  };
  if (/\b(precio|costo|cuanto cuesta|cuanto sale|valor)\b/.test(n)) push('price', text);
  if (/\b(donde|direccion|ubicacion|como llegar|mapa)\b/.test(n)) push('location');
  if (/\b(horario de atencion|a que hora abren|a que hora cierran|abren|cierran)\b/.test(n)) push('business_hours');
  if (/\b(que servicios|tratamientos|que hacen)\b/.test(n)) push('services');
  if (/\b(promocion|promociones|oferta|descuento)\b/.test(n)) push('promotion');
  if (/\b(telefono|contacto|whatsapp)\b/.test(n) && !normalizePhone(text)) push('contact');
  if (/\b(tarjeta|efectivo|transferencia|formas de pago|metodos de pago)\b/.test(n)) push('payment_methods');
  if (/\b(seguro|aseguranza|insurance)\b/.test(n)) push('insurance');
  if (/\b(cuanto dura|duracion|tiempo tarda)\b/.test(n)) push('duration', text);
  return out;
}

function servicePhrase(text) {
  const n = normalize(text);
  const known = ['consulta','primera consulta','limpieza','resina','extraccion','endodoncia','corona','blanqueamiento','brackets','ortodoncia','implante','protesis','selladores','fluor'];
  return known.find(k => n.includes(k)) || null;
}

function fallbackExtract(text, state = {}) {
  const result = emptyExtraction();
  const n = normalize(text);
  result.updates.branch_key = branchFromText(text);
  result.updates.date = parseDate(text);
  result.updates.preferred_time = parseTime(text);
  result.updates.phone = normalizePhone(text);
  result.updates.service_text = servicePhrase(text);
  result.information_requests = infoRequests(text);

  if (affirmative(text)) result.confirmation = CONFIRMATIONS.YES;
  else if (negative(text)) result.confirmation = CONFIRMATIONS.NO;

  if (/\b(hablar con|persona|humano|asesor|operador)\b/.test(n)) {
    result.primary_intent = INTENTS.HUMAN;
    result.needs_human = true;
  } else if (/\b(reiniciar|empezar de nuevo|nueva cita|otra cita)\b/.test(n)) {
    result.primary_intent = INTENTS.RESTART;
  } else if (/\b(ya no|olvidalo|cancelar proceso|mejor no|no quiero cita)\b/.test(n)) {
    result.primary_intent = INTENTS.CANCEL_FLOW;
  } else if (/^(gracias|muchas gracias|ok gracias)$/.test(n)) {
    result.primary_intent = INTENTS.GRATITUDE;
  } else if (result.information_requests.length) {
    result.primary_intent = INTENTS.INFORMATION;
  } else if (/\b(cita|agendar|reservar|programar|disponibilidad|quiero|necesito|quisiera)\b/.test(n) || result.updates.service_text || state.active) {
    result.primary_intent = INTENTS.BOOKING;
    result.booking_intent = true;
  } else if (/^(hola|buenos dias|buenas tardes|buenas noches|hello)$/.test(n)) {
    result.primary_intent = INTENTS.GREETING;
  }

  if (/\b(me llamo|soy|a nombre de)\b/.test(n)) {
    const name = String(text).replace(/.*?\b(me llamo|soy|a nombre de)\b/i, '').trim();
    if (/^[a-záéíóúñü .'-]{2,80}$/i.test(name)) result.updates.patient = name;
  } else if (state.awaiting === 'patient' && /^[a-záéíóúñü .'-]{2,80}$/i.test(String(text).trim())) {
    result.updates.patient = String(text).trim();
  }

  if (/\b(cambiar|mejor|no pero|prefiero)\b/.test(n)) {
    result.confirmation = CONFIRMATIONS.CHANGE;
    if (result.updates.branch_key) result.correction_fields.push('branch');
    if (result.updates.service_text) result.correction_fields.push('service');
    if (result.updates.date) result.correction_fields.push('date');
    if (result.updates.preferred_time) result.correction_fields.push('time');
  }
  result.confidence = 0.65;
  return result;
}

function cleanJson(text) {
  try { return JSON.parse(text); } catch {}
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function normalizeModelResult(raw, text, state) {
  const fallback = fallbackExtract(text, state);
  if (!raw || typeof raw !== 'object') return fallback;
  const out = emptyExtraction();
  out.primary_intent = raw.primary_intent || fallback.primary_intent;
  out.booking_intent = Boolean(raw.booking_intent || fallback.booking_intent);
  out.information_requests = Array.isArray(raw.information_requests) ? raw.information_requests : fallback.information_requests;
  out.confirmation = ['yes','no','change'].includes(raw.confirmation) ? raw.confirmation : fallback.confirmation;
  out.rejection = raw.rejection || fallback.rejection;
  out.correction_fields = Array.isArray(raw.correction_fields) ? raw.correction_fields : fallback.correction_fields;
  out.needs_human = Boolean(raw.needs_human || fallback.needs_human);
  out.confidence = Number(raw.confidence || 0.8);
  const u = raw.updates || {};
  out.updates.branch_key = branchFromText(u.branch_key || '') || fallback.updates.branch_key;
  out.updates.service_text = u.service_text || fallback.updates.service_text;
  out.updates.date = parseDate(u.date || '') || fallback.updates.date;
  out.updates.preferred_time = parseTime(u.preferred_time || '') || fallback.updates.preferred_time;
  out.updates.patient = u.patient || fallback.updates.patient;
  out.updates.phone = normalizePhone(u.phone) || fallback.updates.phone;
  return out;
}

async function aiExtract(text, state, services) {
  const key = process.env.OPENAI_API_KEY || process.env.AI_API_KEY || '';
  if (!key || String(process.env.RECEPTIONIST_V4_USE_AI || 'true').toLowerCase() === 'false') return null;
  const endpoint = process.env.OPENAI_CHAT_URL || 'https://api.openai.com/v1/chat/completions';
  const model = process.env.RECEPTIONIST_V4_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const prompt = {
    role: 'Recepcionista dental comercial',
    task: 'Extrae intención y entidades. No redactes respuesta. Devuelve JSON.',
    today: new Date().toISOString().slice(0,10),
    state: {
      active: state.active, awaiting: state.awaiting, branch_key: state.branch_key,
      service_name: state.service_name, date: state.date,
      proposed_time: state.proposed_slot?.start_time,
      selected_time: state.selected_slot?.start_time,
      patient: state.patient, has_phone: Boolean(state.phone),
      final_confirmation_pending: state.final_confirmation_pending,
    },
    available_services: services.map(s => s.name).slice(0,30),
    schema: {
      primary_intent:'booking|information|cancel_flow|restart|human_handoff|gratitude|greeting|unknown',
      booking_intent:'boolean',
      information_requests:[{type:'price|location|business_hours|services|promotion|contact|payment_methods|insurance|preparation|duration|other',service_text:'string|null'}],
      updates:{branch_key:'sucursal_1|sucursal_2|null',service_text:'string|null',date:'YYYY-MM-DD|null',preferred_time:'HH:MM|null',patient:'string|null',phone:'string|null'},
      confirmation:'yes|no|change|null',
      rejection:'string|null',
      correction_fields:['branch|service|date|time|patient|phone'],
      needs_human:'boolean',
      confidence:'0..1',
    },
    rules:[
      'Una pregunta de precio puede coexistir con intención de agendar.',
      'Extrae todos los datos presentes aunque no correspondan al paso actual.',
      'Sí confirma únicamente lo último preguntado según state.awaiting.',
      'No inventes fecha, hora, sucursal, precio ni servicio.',
    ],
    message:text,
  };
  const response = await fetch(endpoint, {
    method:'POST',
    headers:{'Content-Type':'application/json', Authorization:`Bearer ${key}`},
    body:JSON.stringify({
      model, temperature:0.1, max_tokens:500,
      response_format:{type:'json_object'},
      messages:[
        {role:'system', content:'Eres un extractor JSON estricto para una recepcionista dental.'},
        {role:'user', content:JSON.stringify(prompt)},
      ],
    }),
  });
  if (!response.ok) throw new Error(`Extractor IA ${response.status}`);
  const payload = await response.json();
  return cleanJson(payload?.choices?.[0]?.message?.content);
}

async function extractIntent(text, state, services=[]) {
  try {
    const raw = await aiExtract(text, state, services);
    return normalizeModelResult(raw, text, state);
  } catch (error) {
    console.warn('⚠️ Extractor IA V4 usó fallback:', error.message);
    return fallbackExtract(text, state);
  }
}

module.exports = { extractIntent, fallbackExtract, infoRequests, servicePhrase };

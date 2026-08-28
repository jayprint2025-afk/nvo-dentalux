
'use strict';

const Memory = require('./conversation-memory');
const Appointment = require('./appointment-tools');
const Grounding = require('./conversation-grounding');
const ObjectivePlanner = require('./booking-objective-planner');
const { f1EventBus } = require('../f1/event-bus');

const SYSTEM_RULES = `
Eres una recepcionista dental humana, cálida, eficiente y profesional.
La conversación es libre. No uses etapas visibles ni frases automáticas repetitivas.

AUTHORITATIVE_FACTS contiene los datos conocidos y es autoritativo.
Nunca vuelvas a pedir un dato presente en AUTHORITATIVE_FACTS.

PRIORIDADES:
1. Responde primero la pregunta actual.
2. Si hay varias preguntas, responde todas.
3. Recolecta datos de cita sutilmente.
4. No inventes información.
5. Una interrupción informativa no cancela el agendamiento.
6. Si rechazan un horario, no lo repitas.
7. No repitas preguntas ni respuestas recientes.
8. No diagnostiques.
9. No crees cita sin resumen completo y confirmación explícita posterior.
10. No afirmes creación hasta que la herramienta confirme.
11. Nunca cambies la fecha solicitada ni busques otro día sin que el paciente lo pida o acepte explícitamente.
12. Los horarios sólo son reales si provienen de TOOL_RESULT de check_availability; nunca inventes disponibilidad.
13. Si preguntan disponibilidad, responde directamente; no recites el horario general salvo que lo pregunten.
14. No muestres fechas ISO al paciente. Usa hoy, mañana o el día de la semana.
15. Muestra horas naturales de 12 horas, por ejemplo 6:00 p. m., no 18:00.
16. Nunca cambies el servicio solicitado por otro tratamiento al ofrecer disponibilidad.
17. El servicio detectado en CURRENT_USER_MESSAGE tiene prioridad sobre sugerencias o servicios ajenos mencionados por el modelo. No sugieras un tratamiento distinto si el paciente no lo pidió.

Devuelve JSON:
{
  "reply":"respuesta natural",
  "state_patch":{"collected":{},"conversation_summary":"","pending_booking":null},
  "action":{"type":"none|check_availability|find_next_available_date|prepare_confirmation|create_appointment|handoff","args":{}},
  "reason":"breve explicación interna"
}
`;

function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function explicitConfirmation(text, state = null) {
  const value = Grounding.normalize(text);

  if (/\b(no|cancelar|cancela|espera|dejame|todavia no|no confirmo|cambiar|corregir)\b/.test(value)) {
    return false;
  }

  const explicit = /\b(si\s*,?\s*(confirma|confirmala|agendala|agenda)|confirmo|todo correcto.*(confirma|agenda)|adelante.*(confirma|agenda)|agenda esa cita|confirma la cita)\b/.test(value);
  if (explicit) return true;

  // Una respuesta breve sólo confirma cuando existe un resumen formal pendiente
  // y el turno anterior pidió expresamente confirmar esa cita.
  const shortAffirmative = /^(si|sí|ok|okay|correcto|esta bien|está bien|perfecto|de acuerdo|adelante)$/.test(value);
  if (!shortAffirmative || !state?.pending_booking) return false;

  const lastReply = String(state?.recent_turns?.slice(-1)?.[0]?.reply || '');
  const confirmationWasRequested =
    /confirm(a|as|ación)|deseas crear esta cita|responde.*confirma la cita/i.test(lastReply) ||
    Boolean(state.pending_booking?.presented_at);

  return confirmationWasRequested;
}

function safePlan(raw) {
  const plan = raw && typeof raw === 'object' ? raw : {};
  const allowed = new Set(['none', 'check_availability', 'find_next_available_date', 'prepare_confirmation', 'create_appointment', 'handoff']);
  return {
    reply: typeof plan.reply === 'string' ? plan.reply.trim() : '',
    state_patch: plan.state_patch && typeof plan.state_patch === 'object' ? plan.state_patch : {},
    action: {
      type: allowed.has(plan.action?.type) ? plan.action.type : 'none',
      args: plan.action?.args && typeof plan.action.args === 'object' ? plan.action.args : {},
    },
    reason: String(plan.reason || ''),
  };
}

async function callModel(messages) {
  const key = process.env.RECEPTIONIST_V5_API_KEY || process.env.OPENAI_API_KEY || '';
  if (!key) throw new Error('Falta RECEPTIONIST_V5_API_KEY');

  const response = await fetch(process.env.OPENAI_CHAT_URL || 'https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.RECEPTIONIST_V5_MODEL || 'gpt-4.1-mini',
      temperature: 0.3,
      max_tokens: 1400,
      response_format: { type: 'json_object' },
      messages,
    }),
  });

  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
  const payload = await response.json();
  return safePlan(parseJson(payload?.choices?.[0]?.message?.content));
}

function contextMessage(knowledge, state, userText, detected, toolResult = null) {
  return JSON.stringify({
    CLINIC_KNOWLEDGE: knowledge,
    AUTHORITATIVE_FACTS: Grounding.knownFacts(knowledge, state.collected),
    DETECTED_FROM_CURRENT_MESSAGE: detected,
    MEMORY: {
      collected: state.collected,
      conversation_summary: state.conversation_summary,
      pending_booking: state.pending_booking,
      recent_turns: state.recent_turns.slice(-10),
      rejected_slots: state.rejected_slots,
      last_tool_result: state.last_tool_result,
      appointment_id: state.appointment_id,
    },
    CURRENT_USER_MESSAGE: userText,
    BOOKING_OBJECTIVE: ObjectivePlanner.objectiveContext(state),
    TOOL_RESULT: toolResult,
  });
}

function confirmationSummary(args, knowledge) {
  const branch = knowledge.branches.find(item => item.branch_key === args.branch_key);
  const service = knowledge.services.find(item => String(item.id) === String(args.service_id));
  return [
    `Paciente: ${args.patient}`,
    `Teléfono: ${args.phone}`,
    `Servicio: ${service?.name || args.service_name || args.service_id}`,
    `Sucursal: ${branch?.name || args.branch_key}`,
    `Fecha: ${args.date}`,
    `Hora: ${String(args.start_time || '').slice(0, 5)}`,
  ].join('\n');
}

function canonicalBookingData(state, pending = null) {
  const source = {
    ...(state?.collected || {}),
    ...(pending && typeof pending === 'object' ? pending : {}),
  };

  return {
    ...source,
    patient: source.patient || source.patient_name || source.name || source.full_name || source.nombre || null,
    phone: source.phone || source.wa_phone || source.telephone || source.telefono || source.contact_phone || null,
    branch_key: source.branch_key || source.sucursal_id || source.branch || null,
    service_id: source.service_id || source.service?.id || null,
    service_name: source.service_name || source.service?.name || null,
    date: source.date || source.appointment_date || null,
    start_time:
      source.start_time ||
      source.exact_time ||
      source.selected_time ||
      source.selected_slot?.start_time ||
      source.current_slot?.start_time ||
      null,
    end_time: source.end_time || source.selected_slot?.end_time || source.current_slot?.end_time || null,
  };
}

function resolveServiceIdentity(data, knowledge) {
  if (!data || typeof data !== 'object') return data;

  const services = Array.isArray(knowledge?.services)
    ? knowledge.services
    : [];

  if (data.service_id) {
    const current = services.find(
      item => String(item.id) === String(data.service_id)
    );
    if (current && !data.service_name) data.service_name = current.name;
    return data;
  }

  const requestedName = String(
    data.service_name ||
    data.service ||
    ''
  ).trim();

  if (!requestedName) return data;

  const normalize = value =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const requested = normalize(requestedName);

  const service = services.find(item => {
    const candidate = normalize(item.name);
    return (
      candidate === requested ||
      candidate.includes(requested) ||
      requested.includes(candidate)
    );
  });

  if (service) {
    data.service_id = service.id;
    data.service_name = service.name;
  }

  return data;
}

function normalizedPendingBooking(state, knowledge) {
  const pending = state?.pending_booking;
  if (!pending || typeof pending !== 'object') return null;

  const data = resolveServiceIdentity(
    canonicalBookingData(state, pending),
    knowledge
  );

  const required = [
    'patient',
    'phone',
    'branch_key',
    'service_id',
    'date',
    'start_time',
  ];

  const missing = required.filter(key => !data[key]);
  if (missing.length) return { data, missing, complete: false };

  const summary = confirmationSummary(data, knowledge);
  const booking_key = data.booking_key || Appointment.bookingKey(data);

  state.pending_booking = {
    ...data,
    booking_key,
    summary,
    presented_at: data.presented_at || new Date().toISOString(),
  };

  return {
    data: state.pending_booking,
    missing: [],
    complete: true,
  };
}

function ensurePendingBookingFromCollected(state, knowledge) {
  if (state?.pending_booking) return normalizedPendingBooking(state, knowledge);

  const data = resolveServiceIdentity(
    canonicalBookingData(state),
    knowledge
  );
  const required = ['patient', 'phone', 'branch_key', 'service_id', 'date', 'start_time'];
  const missing = required.filter(key => !data[key]);
  if (missing.length) return { data, missing, complete: false };

  const lastReply = String(state?.recent_turns?.slice(-1)?.[0]?.reply || '');
  const summaryWasPresented =
    /antes de (crear|agendar)|confirma estos datos|confirmar.*resumen|responde.*confirma la cita/i.test(lastReply) ||
    (
      lastReply.includes(String(data.patient)) &&
      lastReply.includes(String(data.phone)) &&
      lastReply.includes(String(data.date)) &&
      lastReply.includes(String(data.start_time).slice(0, 5))
    );

  if (!summaryWasPresented) return { data, missing: [], complete: false };

  state.pending_booking = {
    ...data,
    booking_key: Appointment.bookingKey(data),
    summary: confirmationSummary(data, knowledge),
    presented_at: new Date().toISOString(),
    recovered_from_history: true,
  };

  return { data: state.pending_booking, missing: [], complete: true };
}

function mergeActionArgs(plan, collected) {
  plan.action.args = { ...collected, ...(plan.action.args || {}) };
  return plan;
}

function deterministicInformation(knowledge, state, intents) {
  const branch = knowledge.branches.find(item => item.branch_key === state.collected.branch_key);
  const service = knowledge.services.find(item => String(item.id) === String(state.collected.service_id));
  const parts = [];

  for (const intent of intents) {
    if (intent === 'location') {
      parts.push(branch?.address ? `La sucursal ${branch.name} está en ${branch.address}.` : knowledge.unknown_information_policy);
    }
    if (intent === 'maps') {
      parts.push(
        branch?.google_maps_url
          ? `Aquí tienes el enlace de Google Maps de ${branch.name}: ${branch.google_maps_url}`
          : branch?.address
            ? `No tengo registrado el enlace de Maps, pero la dirección de ${branch.name} es ${branch.address}.`
            : knowledge.unknown_information_policy
      );
    }
    if (intent === 'price') {
      parts.push(
        service?.price != null
          ? `El costo de ${service.name} es de $${Number(service.price).toLocaleString('es-MX')}.`
          : `No tengo confirmado el precio de ${service?.name || 'ese servicio'} en este momento.`
      );
    }
    if (intent === 'promotion') {
      const promotions = knowledge.promotions.filter(item =>
        (!state.collected.branch_key || item.branch_key === state.collected.branch_key) &&
        (!state.collected.service_id || !item.service_id || String(item.service_id) === String(state.collected.service_id))
      );
      parts.push(
        promotions.length
          ? `Promociones vigentes: ${promotions.map(item => item.title).join(', ')}.`
          : `No tengo promociones vigentes confirmadas${branch ? ` para ${branch.name}` : ''}.`
      );
    }
    if (intent === 'business_hours') {
      parts.push(branch?.business_hours ? `El horario de ${branch.name} es ${branch.business_hours}.` : knowledge.unknown_information_policy);
    }
    if (intent === 'payment_methods') {
      parts.push(branch?.payment_methods ? `Las formas de pago son: ${branch.payment_methods}.` : knowledge.unknown_information_policy);
    }
    if (intent === 'parking') {
      parts.push(branch?.parking_info || knowledge.unknown_information_policy);
    }
  }

  return parts;
}

async function repairPlan({ messages, plan, violations, knowledge, state, userText, detected }) {
  const repair = await callModel([
    ...messages,
    { role: 'assistant', content: JSON.stringify(plan) },
    {
      role: 'user',
      content: JSON.stringify({
        instruction: 'Corrige la respuesta. No vuelvas a pedir datos conocidos. Responde primero el mensaje actual, evita repetir preguntas y conserva la conversación natural.',
        violations,
        AUTHORITATIVE_FACTS: Grounding.knownFacts(knowledge, state.collected),
        DETECTED_FROM_CURRENT_MESSAGE: detected,
        CURRENT_USER_MESSAGE: userText,
      }),
    },
  ]);
  return mergeActionArgs(repair, state.collected);
}


function extractLastExplicitTime(text) {
  const normalized = Grounding.normalize(text);
  const matches = [
    ...normalized.matchAll(
      /\b(?:a las?|mejor a las?|cambial[ao]? a las?|pon(?:la|lo)? a las?)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/g
    ),
  ];

  if (!matches.length) return null;

  const match = matches[matches.length - 1];
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = String(match[3] || '');

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (!meridiem && /\btarde|noche\b/.test(normalized) && hour < 12) hour += 12;

  if (hour > 23 || minute > 59) return null;

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function detectBookingModification({
  userText,
  previousCollected,
  previousPending,
  grounding,
}) {
  if (!previousPending) {
    return { changed: false, fields: {}, changed_fields: [] };
  }

  const fields = {};
  const changedFields = [];
  const before = {
    ...previousCollected,
    ...previousPending,
  };

  const explicitTime = extractLastExplicitTime(userText);
  const detectedDate = grounding?.detected?.date || null;
  const detectedBranch = grounding?.detected?.branch || null;
  const detectedService = grounding?.detected?.service || null;

  if (
    explicitTime &&
    String(explicitTime).slice(0, 5) !==
      String(before.start_time || before.exact_time || '').slice(0, 5)
  ) {
    fields.start_time = explicitTime;
    fields.exact_time = explicitTime;
    changedFields.push('time');
  }

  if (detectedDate && detectedDate !== before.date) {
    fields.date = detectedDate;
    changedFields.push('date');
  }

  if (
    detectedBranch?.branch_key &&
    detectedBranch.branch_key !== before.branch_key
  ) {
    fields.branch_key = detectedBranch.branch_key;
    fields.branch_name = detectedBranch.name || null;
    changedFields.push('branch');
  }

  if (
    detectedService?.id &&
    String(detectedService.id) !== String(before.service_id || '')
  ) {
    fields.service_id = detectedService.id;
    fields.service_name = detectedService.name || null;
    changedFields.push('service');
  }

  return {
    changed: changedFields.length > 0,
    fields,
    changed_fields: changedFields,
  };
}

function invalidateSelectedSlot(state, changes) {
  const keep = {
    patient:
      state.collected.patient ||
      state.collected.patient_name ||
      state.pending_booking?.patient ||
      null,
    patient_name:
      state.collected.patient_name ||
      state.pending_booking?.patient ||
      null,
    phone:
      state.collected.phone ||
      state.pending_booking?.phone ||
      null,
  };

  state.pending_booking = null;
  state.appointment_id = null;
  state.last_tool_result = null;

  delete state.collected.doctor_id;
  delete state.collected.doctor_name;
  delete state.collected.selected_slot;
  delete state.collected.current_slot;
  delete state.collected.end_time;

  state.collected = {
    ...state.collected,
    ...keep,
    ...changes,
  };
}

function updatedConfirmationReply(args, knowledge) {
  return (
    `Actualicé tu solicitud. Antes de agendar, confirma estos datos:\n\n` +
    `${confirmationSummary(args, knowledge)}\n\n` +
    `¿Confirmas que deseas crear esta cita con los datos actualizados?`
  );
}



function rescheduleIntent(text) {
  const value = Grounding.normalize(text);
  return /\b(reagendar|reagenda|reprogramar|reprograma|mover mi cita|mueve mi cita|cambiar mi cita|cambia mi cita|cambiar la fecha|cambiar el dia|cambiar la hora|otra fecha para mi cita|otro horario para mi cita)\b/.test(value);
}

function publishMessengerAppointmentRescheduled(result, ctx) {
  const appointment = result?.appointment;
  const previous = result?.previous;
  if (!appointment?.id) return null;

  const tenantId = String(ctx?.tenant_id || ctx?.clinic_id || '').trim();
  if (!tenantId) return null;

  try {
    return f1EventBus.emit(
      'appointment.rescheduled',
      {
        appointment_id: appointment.id,
        patient: appointment.patient || null,
        phone: appointment.phone || null,
        date: appointment.date || null,
        start_time: appointment.start_time || null,
        status: appointment.status || null,
        doctor_id: appointment.doctor_id || null,
        service_id: appointment.service_id || null,
        previous_date: previous?.date || null,
        previous_start_time: previous?.start_time || null,
        channel: 'messenger',
      },
      {
        tenant_id: tenantId,
        branch_key: appointment.sucursal_id || 'sucursal_1',
        user_id: ctx?.conversationId
          ? `messenger-conversation:${ctx.conversationId}`
          : 'messenger',
        source: 'messenger',
      }
    );
  } catch (error) {
    console.warn('⚠️ Messenger Event Bus appointment.rescheduled:', error.message);
    return null;
  }
}


function publishMessengerAppointmentCancelled(appointment, ctx) {
  if (!appointment?.id) return null;

  const tenantId = String(ctx?.tenant_id || ctx?.clinic_id || '').trim();
  if (!tenantId) return null;

  try {
    return f1EventBus.emit(
      'appointment.cancelled',
      {
        appointment_id: appointment.id,
        patient: appointment.patient || null,
        phone: appointment.phone || null,
        date: appointment.date || null,
        start_time: appointment.start_time || null,
        status: appointment.status || 'Cancelada',
        doctor_id: appointment.doctor_id || null,
        service_id: appointment.service_id || null,
        channel: 'messenger',
      },
      {
        tenant_id: tenantId,
        branch_key: appointment.sucursal_id || 'sucursal_1',
        user_id: ctx?.conversationId
          ? `messenger-conversation:${ctx.conversationId}`
          : 'messenger',
        source: 'messenger',
      }
    );
  } catch (error) {
    console.warn('⚠️ Messenger Event Bus appointment.cancelled:', error.message);
    return null;
  }
}

function affirmativeAction(text) {
  const value = Grounding.normalize(text);
  return /^(si|sí|ok|okay|correcto|esta bien|está bien|confirmo|adelante|de acuerdo)$/.test(value) ||
    /\b(si confirma|confirmo la cancelacion|cancela la cita|si cancelala)\b/.test(value);
}

function publishMessengerAppointmentCreated(created, pending, ctx) {
  if (!created?.id) return null;

  const tenantId = String(
    ctx?.tenant_id ||
    ctx?.clinic_id ||
    ''
  ).trim();

  if (!tenantId) {
    console.warn('⚠️ Messenger Event Bus: tenant_id ausente');
    return null;
  }

  const branchKey = String(
    created?.sucursal_id ||
    created?.branch_key ||
    pending?.branch_key ||
    'sucursal_1'
  ).trim();

  try {
    return f1EventBus.emit(
      'appointment.created',
      {
        appointment_id: created.id,
        patient:
          created.patient ||
          pending?.patient ||
          pending?.patient_name ||
          null,
        phone:
          created.phone ||
          pending?.phone ||
          null,
        date:
          created.date ||
          pending?.date ||
          null,
        start_time:
          created.start_time ||
          pending?.start_time ||
          null,
        status:
          created.status ||
          'Pendiente',
        doctor_id:
          created.doctor_id ||
          pending?.doctor_id ||
          null,
        service_id:
          created.service_id ||
          pending?.service_id ||
          null,
        channel: 'messenger',
      },
      {
        tenant_id: tenantId,
        branch_key: branchKey,
        user_id: ctx?.conversationId
          ? `messenger-conversation:${ctx.conversationId}`
          : 'messenger',
        source: 'messenger',
      }
    );
  } catch (error) {
    // La notificación nunca debe cancelar una cita ya guardada.
    console.warn('⚠️ Messenger Event Bus appointment.created:', error.message);
    return null;
  }
}


function formatNaturalTime(value) {
  const [h0, m0] = String(value || '').slice(0,5).split(':').map(Number);
  if (!Number.isFinite(h0) || !Number.isFinite(m0)) return String(value || '');
  const suffix = h0 >= 12 ? 'p. m.' : 'a. m.';
  const h = h0 % 12 || 12;
  return `${h}:${String(m0).padStart(2,'0')} ${suffix}`;
}

function resolveClinicTimeZone(knowledge, state) {
  const branch = knowledge?.branches?.find(
    item => item.branch_key === state?.collected?.branch_key
  );
  return (
    branch?.timezone ||
    branch?.time_zone ||
    knowledge?.timezone ||
    knowledge?.time_zone ||
    knowledge?.clinic_timezone ||
    'America/Tijuana'
  );
}

function naturalDayLabel(value, timeZone) {
  return Grounding.naturalDateLabel(value, timeZone || 'America/Tijuana');
}

function naturalAvailabilityReply(slots, dateValue, timeZone = 'America/Tijuana') {
  const list = Array.isArray(slots) ? slots : [];
  const day = naturalDayLabel(dateValue, timeZone);

  if (!list.length) {
    return `Por ${day} ya no tengo espacios disponibles. Si gustas, puedo revisar otro día 😊`;
  }

  const toMinutes = value => {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  };

  const unique = [...new Set(
    list.map(slot => String(slot.start_time || '').slice(0, 5)).filter(Boolean)
  )]
    .map(value => ({ value, mins: toMinutes(value) }))
    .filter(item => item.mins != null)
    .sort((a, b) => a.mins - b.mins);

  const dayparts = [
    { label: 'por la mañana', from: 0, to: 12 * 60 },
    { label: 'por la tarde', from: 12 * 60, to: 18 * 60 },
    { label: 'por la noche', from: 18 * 60, to: 24 * 60 },
  ];

  const phrases = [];

  for (const part of dayparts) {
    const items = unique.filter(item => item.mins >= part.from && item.mins < part.to);
    if (!items.length) continue;

    const groups = [];
    for (const item of items) {
      const last = groups[groups.length - 1];
      if (!last || item.mins - last.endMins > 30) {
        groups.push({
          start: item.value,
          end: item.value,
          startMins: item.mins,
          endMins: item.mins,
        });
      } else {
        last.end = item.value;
        last.endMins = item.mins;
      }
    }

    const ranges = groups.map(group => {
      if (group.start === group.end) {
        return `a las ${formatNaturalTime(group.start)}`;
      }
      return `de ${formatNaturalTime(group.start)} a ${formatNaturalTime(group.end)}`;
    });

    phrases.push(`${part.label} ${ranges.join(' y ')}`);
  }

  if (!phrases.length) {
    return `Por ${day} ya no tengo espacios disponibles. Si gustas, puedo revisar otro día 😊`;
  }

  if (phrases.length === 1) {
    return `Claro 😊 Para ${day} tengo disponibilidad ${phrases[0]}. ¿Qué hora te queda mejor?`;
  }

  const last = phrases.pop();
  return `Claro 😊 Para ${day} tengo disponibilidad ${phrases.join(', ')} y ${last}. ¿Qué hora te queda mejor?`;
}
function naturalPriceReply(service) {
  if (!service) return null;
  const price = Number(service.price);
  const duration = Number(service.duration_hours || 0);
  if (!Number.isFinite(price)) return null;

  let reply = `La ${String(service.name || 'atención').toLowerCase()} tiene un costo de $${price.toLocaleString('es-MX')}.`;
  if (Number.isFinite(duration) && duration > 0) {
    const mins = Math.round(duration * 60);
    if (mins === 60) reply += ` La cita dura aproximadamente 1 hora.`;
    else if (mins % 60 === 0) reply += ` La cita dura aproximadamente ${mins / 60} horas.`;
    else reply += ` La cita dura aproximadamente ${mins} minutos.`;
  }
  return `${reply} ¿Quieres que te ayude a agendar?`;
}


async function runAgent(q, ctx, incoming, userText, knowledge) {
  const state = Memory.initialState(incoming);
  ObjectivePlanner.ensureGoal(state);

  const previousCollected = { ...(state.collected || {}) };
  const previousPending = state.pending_booking
    ? { ...state.pending_booking }
    : null;

  const grounding = Grounding.deriveFacts(userText, knowledge, state);
  state.collected = grounding.collected;

  // Cancelación puntual de Messenger: usa estado persistido dentro de collected.
  if (state.collected.booking_mode === 'cancel') {
    const existingTarget = state.collected.cancel_target || null;

    if (existingTarget && affirmativeAction(userText)) {
      const cancelled = await Appointment.cancelAppointment(q, ctx, {
        appointment_id: existingTarget.id,
      });

      publishMessengerAppointmentCancelled(cancelled, ctx);

      delete state.collected.cancel_target;
      state.collected.booking_mode = 'create';
      state.pending_booking = null;
      state.appointment_id = cancelled.id;

      const reply =
        `Listo, cancelé tu cita del ${String(cancelled.date).slice(0, 10)} ` +
        `a las ${String(cancelled.start_time).slice(0, 5)}.`;

      Memory.recordTurn(state, userText, reply, {
        used: 'appointment_cancelled',
        objective: ObjectivePlanner.nextObjective(state),
      });

      return {
        reply,
        state,
        used: 'appointment_cancelled',
        engine_version: 'v5',
      };
    }

    if (existingTarget && Grounding.isNegative(userText)) {
      delete state.collected.cancel_target;
      state.collected.booking_mode = 'create';

      const reply = 'De acuerdo, no hice ningún cambio en tu cita.';
      Memory.recordTurn(state, userText, reply, {
        used: 'appointment_cancellation_declined',
        objective: ObjectivePlanner.nextObjective(state),
      });

      return {
        reply,
        state,
        used: 'appointment_cancellation_declined',
        engine_version: 'v5',
      };
    }

    if (!existingTarget) {
      const found = await Appointment.findFutureAppointment(q, ctx, state.collected);

      if (!found) {
        state.collected.booking_mode = 'create';
        const reply =
          'No encontré una cita futura asociada a tu nombre o teléfono para cancelarla.';

        Memory.recordTurn(state, userText, reply, {
          used: 'cancel_appointment_not_found',
          objective: ObjectivePlanner.nextObjective(state),
        });

        return {
          reply,
          state,
          used: 'cancel_appointment_not_found',
          engine_version: 'v5',
        };
      }

      state.collected.cancel_target = {
        id: found.id,
        patient: found.patient,
        date: found.date,
        start_time: found.start_time,
        sucursal_id: found.sucursal_id,
      };

      const reply =
        `Encontré tu cita del ${String(found.date).slice(0, 10)} ` +
        `a las ${String(found.start_time).slice(0, 5)}. ` +
        `¿Confirmas que deseas cancelarla?`;

      Memory.recordTurn(state, userText, reply, {
        used: 'prepare_cancellation',
        objective: ObjectivePlanner.nextObjective(state),
      });

      return {
        reply,
        state,
        used: 'prepare_cancellation',
        engine_version: 'v5',
      };
    }

    const reply = '¿Confirmas que deseas cancelar esa cita?';
    Memory.recordTurn(state, userText, reply, {
      used: 'awaiting_cancellation_confirmation',
      objective: ObjectivePlanner.nextObjective(state),
    });

    return {
      reply,
      state,
      used: 'awaiting_cancellation_confirmation',
      engine_version: 'v5',
    };
  }

  const bookingModification = detectBookingModification({
    userText,
    previousCollected,
    previousPending,
    grounding,
  });

  if (bookingModification.changed) {
    invalidateSelectedSlot(state, bookingModification.fields);

    console.log('♻️ CAMBIO ANTES DE CONFIRMAR', {
      changed_fields: bookingModification.changed_fields,
      changes: bookingModification.fields,
    });
  }

  if (grounding.detected.negative && state.last_tool_result?.selected_time) {
    state.rejected_slots.push(state.last_tool_result.selected_time);
    state.rejected_slots = [...new Set(state.rejected_slots)].slice(-10);
  }

  const messages = [
    { role: 'system', content: SYSTEM_RULES },
    { role: 'user', content: contextMessage(knowledge, state, userText, grounding.detected) },
  ];

  let plan = mergeActionArgs(await callModel(messages), state.collected);
  Memory.mergeState(state, plan.state_patch);
  state.collected = { ...state.collected, ...grounding.collected };

  // Si el paciente cambia datos después del resumen, la confirmación anterior deja de ser válida.
  if (bookingModification.changed) {
    plan.action = {
      type: 'check_availability',
      args: { ...state.collected },
    };
    plan.reason =
      'Datos modificados antes de confirmar; volver a validar disponibilidad.';
  }

  plan = ObjectivePlanner.applyObjectiveOverride({ state, userText, plan });

  // CURRENT MESSAGE service lock:
  // si el paciente menciona un servicio en este turno, ese servicio manda sobre
  // cualquier sugerencia previa del modelo.
  if (grounding.detected?.service?.id) {
    state.collected.service_id = grounding.detected.service.id;
    state.collected.service_name = grounding.detected.service.name;
    const lockedService = knowledge.services.find(
      item => String(item.id) === String(grounding.detected.service.id)
    );
    if (lockedService?.duration_hours != null) {
      state.collected.duration_hours = lockedService.duration_hours;
    }
    if (plan.action?.args) {
      plan.action.args.service_id = grounding.detected.service.id;
      if (lockedService?.duration_hours != null) {
        plan.action.args.duration_hours = lockedService.duration_hours;
      }
    }
  }



  // La IA redacta libremente, pero no decide si debe volver a preguntar datos ya conocidos.
  // Si el paciente está intentando agendar y ya tenemos sucursal, servicio y fecha,
  // la consulta de disponibilidad es obligatoria.
  const wantsBooking = Grounding.bookingIntent(userText, state.collected);
  const availabilityReady = Grounding.availabilityReady(state.collected);

  if (
    wantsBooking &&
    availabilityReady &&
    !state.pending_booking &&
    !state.appointment_id &&
    plan.action.type === 'none'
  ) {
    plan.action = {
      type: 'check_availability',
      args: { ...state.collected },
    };
    plan.reason = 'Datos mínimos completos; consultar disponibilidad sin repetir preguntas.';
  }

  // Si intenta agendar pero falta un dato, sólo puede preguntar el siguiente dato faltante.
  if (
    wantsBooking &&
    !availabilityReady &&
    plan.action.type === 'none'
  ) {
    const requiredQuestion = Grounding.nextNaturalQuestion(state.collected);
    if (requiredQuestion) {
      plan.reply = requiredQuestion;
      plan.reason = 'Solicitar únicamente el siguiente dato faltante.';
    }
  }

  if (
    !bookingModification.changed &&
    plan.action.type === 'none' &&
    explicitConfirmation(userText, state)
  ) {
    const recovered = state.pending_booking
      ? normalizedPendingBooking(state, knowledge)
      : ensurePendingBookingFromCollected(state, knowledge);

    if (recovered?.complete) {
      plan.action = { type: 'create_appointment', args: { ...recovered.data } };
      plan.reason = 'Confirmación explícita con resumen completo pendiente.';
    }
  }

  let used = plan.action.type || 'none';

  if (plan.action.type === 'check_availability') {
    const args = { ...state.collected, ...plan.action.args };
    if (!args.branch_key || !args.service_id || !args.date) {
      plan.action = { type: 'none', args: {} };
      used = 'availability_missing_data';
    } else {
      const authoritativeService = knowledge.services.find(
        item => String(item.id) === String(args.service_id)
      );
      if (authoritativeService && Number(authoritativeService.duration_hours) > 0) {
        args.duration_hours = Number(authoritativeService.duration_hours);
      }

      const toolResult = await Appointment.checkAvailability(q, ctx, args);
      let slots = Array.isArray(toolResult.slots) ? toolResult.slots : [];
      slots = slots.filter(slot => !state.rejected_slots.includes(String(slot.start_time).slice(0, 5)));

      const requestedTime = String(
        state.collected.exact_time ||
        state.collected.start_time ||
        ''
      ).slice(0, 5);

      const selected =
        (
          requestedTime &&
          slots.find(
            slot =>
              String(slot.start_time || '').slice(0, 5) === requestedTime
          )
        ) ||
        slots[0] ||
        null;
      state.last_tool_result = {
        type: 'check_availability',
        result: { ...toolResult, slots },
        selected_time: selected ? String(selected.start_time).slice(0, 5) : null,
      };

      plan = mergeActionArgs(await callModel([
        ...messages,
        { role: 'assistant', content: JSON.stringify(plan) },
        {
          role: 'user',
          content: contextMessage(knowledge, state, userText, grounding.detected, {
            tool: 'check_availability',
            ...toolResult,
            slots,
            rejected_slots: state.rejected_slots,
          }),
        },
      ]), state.collected);

      Memory.mergeState(state, plan.state_patch);

      // Respuesta determinista y natural: sólo usa disponibilidad verificada.
      plan.reply = naturalAvailabilityReply(
        slots,
        state.collected.date || toolResult.date,
        resolveClinicTimeZone(knowledge, state)
      );

      // Guardar el horario ofrecido aunque el modelo no lo incluya en state_patch.
      if (selected) {
        state.collected.start_time = String(selected.start_time).slice(0, 5);
        state.collected.doctor_id = selected.doctor_id || state.collected.doctor_id || null;
        state.collected.doctor_name = selected.doctor_name || state.collected.doctor_name || null;
        state.collected.selected_slot = {
          ...selected,
          date: selected.date || state.collected.date,
        };
        if (selected.end_time) {
          state.collected.end_time = String(selected.end_time).slice(0, 5);
        }
        ObjectivePlanner.markSlotValidated(state, state.collected.selected_slot);
      }

      // No permitir que una segunda redacción reemplace los horarios verificados.
      if (!selected) {
        ObjectivePlanner.markUnavailable(state, {
          date: state.collected.date,
          reason: 'La clínica está cerrada o no tiene disponibilidad en esa fecha.',
        });
        plan.reply = naturalAvailabilityReply(
          [],
          state.collected.date || toolResult.date,
          resolveClinicTimeZone(knowledge, state)
        );
      }

      if (bookingModification.changed) {
        if (selected) {
          const updatedArgs = resolveServiceIdentity(
            canonicalBookingData({
              collected: {
                ...state.collected,
                start_time: String(selected.start_time).slice(0, 5),
                end_time: selected.end_time
                  ? String(selected.end_time).slice(0, 5)
                  : state.collected.end_time,
                doctor_id: selected.doctor_id || null,
                doctor_name: selected.doctor_name || null,
                selected_slot: selected,
              },
            }),
            knowledge
          );

          const required = [
            'patient',
            'phone',
            'branch_key',
            'service_id',
            'date',
            'start_time',
          ];
          const missing = required.filter(key => !updatedArgs[key]);

          if (!missing.length) {
            state.collected = {
              ...state.collected,
              ...updatedArgs,
            };

            state.pending_booking = {
              ...updatedArgs,
              booking_key: Appointment.bookingKey(updatedArgs),
              summary: confirmationSummary(updatedArgs, knowledge),
              presented_at: new Date().toISOString(),
              updated_after_change: true,
            };

            plan.reply = updatedConfirmationReply(updatedArgs, knowledge);
            plan.action = { type: 'none', args: {} };
            used = 'booking_change_reconfirmed';
          }
        } else {
          state.pending_booking = null;
          plan.action = { type: 'none', args: {} };
          used = 'booking_change_unavailable';
        }
      } else {
        used = 'check_availability';
      }
    }
  }


  // Protección determinista: el modelo no puede saltar a otro día por su cuenta.
  // Sólo se permite buscar una fecha alternativa si el paciente lo pidió o aceptó explícitamente.
  if (plan.action.type === 'find_next_available_date') {
    const normalizedUser = Grounding.normalize(userText);
    const explicitAlternativeConsent = /\b(si|sí|ok|okay|busca|buscar|otro dia|otra fecha|siguiente disponible|cuando haya|proximo disponible|próximo disponible)\b/.test(normalizedUser);
    const previousReplyOfferedAlternative = /siguiente fecha disponible|buscarte.*otra fecha|buscar.*otro dia/i.test(String(state.recent_turns?.slice(-1)?.[0]?.reply || ''));
    if (!explicitAlternativeConsent && !previousReplyOfferedAlternative) {
      plan.action = { type: 'none', args: {} };
      const day = Grounding.naturalDateLabel(
        state.collected.date,
        resolveClinicTimeZone(knowledge, state)
      );
      plan.reply = `Para ${day} no encontré espacios disponibles para ese servicio. Si gustas, puedo revisar otro día 😊`;
      used = 'blocked_unapproved_date_change';
    }
  }

  if (plan.action.type === 'find_next_available_date') {
    const args = { ...state.collected, ...(plan.action.args || {}) };

    if (!args.branch_key || !args.service_id) {
      plan.reply = !args.branch_key
        ? '¿En cuál sucursal deseas atenderte?'
        : '¿Qué servicio necesitas?';
      plan.action = { type: 'none', args: {} };
      used = 'alternative_missing_data';
    } else {
      const baseDate = String(
        args.after_date ||
        state.booking_goal?.last_invalid_date ||
        args.date ||
        new Date().toISOString().slice(0, 10)
      ).slice(0, 10);

      let found = null;

      for (let offset = 1; offset <= 14; offset += 1) {
        const candidate = new Date(`${baseDate}T12:00:00Z`);
        candidate.setUTCDate(candidate.getUTCDate() + offset);
        const candidateDate = candidate.toISOString().slice(0, 10);

        if (state.booking_goal.blocked_dates.includes(candidateDate)) continue;

        const result = await Appointment.checkAvailability(q, ctx, {
          ...args,
          date: candidateDate,
          start_time: null,
          exact_time: null,
        });

        const slots = (Array.isArray(result.slots) ? result.slots : [])
          .filter(slot =>
            !state.rejected_slots.includes(String(slot.start_time || '').slice(0, 5))
          );

        if (slots.length) {
          found = {
            ...slots[0],
            date: slots[0].date || candidateDate,
          };
          break;
        }

        ObjectivePlanner.markUnavailable(state, {
          date: candidateDate,
          reason: 'Sin disponibilidad.',
        });
      }

      if (!found) {
        plan.reply =
          'No encontré disponibilidad durante los próximos 14 días. ' +
          'Puedo ayudarte a probar otro horario o comunicarte con la clínica.';
        plan.action = { type: 'none', args: {} };
        used = 'no_alternative_dates';
      } else {
        state.collected.date = found.date;
        state.collected.start_time = String(found.start_time).slice(0, 5);
        state.collected.exact_time = String(found.start_time).slice(0, 5);
        state.collected.doctor_id = found.doctor_id || null;
        state.collected.doctor_name = found.doctor_name || null;
        state.collected.selected_slot = found;

        ObjectivePlanner.markSlotValidated(state, found);

        const branch = knowledge.branches.find(
          item => item.branch_key === state.collected.branch_key
        );
        const service = knowledge.services.find(
          item => String(item.id) === String(state.collected.service_id)
        );

        plan.reply =
          `La siguiente disponibilidad para ${service?.name || 'el servicio'} ` +
          `en ${branch?.name || state.collected.branch_name || 'la sucursal seleccionada'} ` +
          `es el ${found.date} a las ${String(found.start_time).slice(0, 5)}. ` +
          `¿Te funciona ese horario?`;
        plan.action = { type: 'none', args: {} };
        used = 'alternative_date_offered';
      }
    }
  }

  if (plan.action.type === 'prepare_confirmation') {
    const args = resolveServiceIdentity(
      canonicalBookingData({
        collected: { ...state.collected, ...plan.action.args },
      }),
      knowledge
    );
    const required = ['patient', 'phone', 'branch_key', 'service_id', 'date', 'start_time'];
    const missing = required.filter(key => !args[key]);

    if (missing.length) {
      const labels = {
        patient: 'el nombre del paciente',
        phone: 'un teléfono de contacto',
        branch_key: 'la sucursal',
        service_id: 'el servicio',
        date: 'la fecha',
        start_time: 'el horario',
      };
      plan.reply =
        plan.reply ||
        `Para preparar la confirmación todavía necesito ${missing
          .map(key => labels[key] || key)
          .join(', ')}.`;
    } else {
      const key = Appointment.bookingKey(args);
      state.pending_booking = {
        ...args,
        booking_mode: state.collected.booking_mode || args.booking_mode || 'create',
        booking_key: key,
        summary: confirmationSummary(args, knowledge),
        presented_at: new Date().toISOString(),
      };

      // Siempre mostrar el resumen controlado por el backend.
      // No confiar en una respuesta del modelo que pueda omitir datos.
      plan.reply =
        `Perfecto. Antes de agendar, confirma estos datos:\n\n` +
        `${state.pending_booking.summary}\n\n` +
        `¿Confirmas que deseas crear esta cita?`;
    }
    used = 'prepare_confirmation';
  }

  if (plan.action.type === 'create_appointment') {
    const normalized = state.pending_booking
      ? normalizedPendingBooking(state, knowledge)
      : ensurePendingBookingFromCollected(state, knowledge);
    const pending = normalized?.complete ? normalized.data : null;

    if (!pending) {
      const missing = normalized?.missing || [];
      const labels = {
        patient: 'el nombre del paciente',
        phone: 'un teléfono de contacto',
        branch_key: 'la sucursal',
        service_id: 'el servicio',
        date: 'la fecha',
        start_time: 'el horario',
      };
      plan.reply = missing.length
        ? `Antes de confirmar todavía necesito ${missing
          .map(key => labels[key] || key)
          .join(', ')}.`
        : 'Antes de crear la cita necesito reunir los datos, mostrarte el resumen y recibir tu confirmación.';
      used = 'confirmation_missing_data';
    } else if (!explicitConfirmation(userText, state)) {
      plan.reply =
        `Antes de crearla necesito confirmar este resumen:\n\n` +
        `${pending.summary}\n\n` +
        `Puedes responder “sí, confirma la cita” o simplemente “Ok”.`;
      used = 'confirmation_blocked';
    } else if (state.completed_booking_keys.includes(pending.booking_key)) {
      plan.reply = 'Esa cita ya fue registrada anteriormente; no crearé un duplicado.';
      used = 'duplicate_blocked';
    } else {
      const shouldReschedule =
        pending.booking_mode === 'reschedule' ||
        state.collected.booking_mode === 'reschedule';

      if (shouldReschedule) {
        try {
          const result = await Appointment.rescheduleAppointment(q, ctx, pending);
          const updated = result.appointment;

          publishMessengerAppointmentRescheduled(result, ctx);

          state.appointment_id = updated.id;
          state.pending_booking = null;
          state.collected.booking_mode = 'create';
          state.completed_booking_keys.push(pending.booking_key);

          plan.reply =
            `Listo, tu cita fue reagendada correctamente para el ` +
            `${String(updated.date).slice(0, 10)} a las ` +
            `${String(updated.start_time).slice(0, 5)}. Número de cita: ${updated.id}.`;
          used = 'appointment_rescheduled';
        } catch (error) {
          if (error?.code === 'APPOINTMENT_NOT_FOUND') {
            plan.reply =
              'No encontré una cita futura a tu nombre o teléfono para moverla. ' +
              'Puedo ayudarte a crear una cita nueva, pero necesito que me lo confirmes.';
            used = 'reschedule_appointment_not_found';
          } else {
            throw error;
          }
        }
      } else {
        const created = await Appointment.createAppointment(q, ctx, pending);

        publishMessengerAppointmentCreated(created, pending, ctx);

        state.appointment_id = created.id;
        state.completed_booking_keys.push(pending.booking_key);
        state.pending_booking = null;
        plan.reply = `Listo, tu cita quedó registrada correctamente. Número de cita: ${created.id}.`;
        used = 'appointment_booked';
      }
    }
  }

  if (plan.action.type === 'handoff') {
    state.handoff_requested = true;
    plan.reply = plan.reply || knowledge.unknown_information_policy;
    used = 'handoff';
  }

  const availabilityLanguage = /\b(horario|horarios|disponible|disponibilidad|espacio|espacios)\b/.test(
    Grounding.normalize(userText)
  );

  const filteredInformationIntents = (grounding.detected.information_intents || []).filter(
    intent => !(intent === 'business_hours' && (wantsBooking || availabilityLanguage))
  );

  const deterministicParts = deterministicInformation(
    knowledge,
    state,
    filteredInformationIntents
  );

  if ((grounding.detected.information_intents || []).includes('price')) {
    const authoritativeService = knowledge.services.find(
      item => String(item.id) === String(state.collected.service_id)
    );
    const priceReply = naturalPriceReply(authoritativeService);
    if (priceReply && !wantsBooking) {
      plan.reply = priceReply;
      used = 'natural_price_authoritative';
    }
  }

  for (const part of deterministicParts) {
    if (used === 'natural_price_authoritative' && /^El costo de /i.test(part)) continue;
    if (!plan.reply.includes(part)) plan.reply = plan.reply ? `${part}\n\n${plan.reply}` : part;
  }

  if (!plan.reply) plan.reply = knowledge.unknown_information_policy;

  let violations = Grounding.replyViolations(plan.reply, state, userText);
  if (violations.length) {
    plan = await repairPlan({
      messages,
      plan,
      violations,
      knowledge,
      state,
      userText,
      detected: grounding.detected,
    });
    Memory.mergeState(state, plan.state_patch);
    state.collected = { ...state.collected, ...grounding.collected };
    used = `${used}_repaired`;
    violations = Grounding.replyViolations(plan.reply, state, userText);
  }

  if (violations.length) {
    const facts = Grounding.knownFacts(knowledge, state.collected);
    const summary = [];
    if (facts.branch) summary.push(`Sucursal: ${facts.branch.name}`);
    if (facts.service) summary.push(`Servicio: ${facts.service.name}`);
    if (state.collected.date) summary.push(`Fecha: ${state.collected.date}`);

    plan.reply = deterministicParts.join('\n\n') ||
      `Perfecto, ya tengo registrado: ${summary.join(', ')}. ¿Qué día y horario te acomodan para continuar?`;
    used = `${used}_guarded`;
  }

  Memory.recordTurn(state, userText, plan.reply, { used, objective: ObjectivePlanner.nextObjective(state) });

  return { reply: plan.reply, state, used, engine_version: 'v5' };
}

module.exports = {
  runAgent,
  explicitConfirmation,
  safePlan,
  SYSTEM_RULES,
  deterministicInformation,
  normalizedPendingBooking,
  canonicalBookingData,
  ensurePendingBookingFromCollected,
  resolveServiceIdentity,
  extractLastExplicitTime,
  detectBookingModification,
  invalidateSelectedSlot,
  updatedConfirmationReply,
};

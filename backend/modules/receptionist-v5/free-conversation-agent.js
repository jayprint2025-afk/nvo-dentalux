
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

  // La herramienta devuelve slots verificados cada 30 min. Los agrupamos en bloques
  // continuos para hablar como una recepcionista, no como una lista de intervalos.
  const unique = [...new Set(
    list.map(slot => String(slot.start_time || '').slice(0, 5)).filter(Boolean)
  )]
    .map(value => ({ value, mins: toMinutes(value) }))
    .filter(item => item.mins != null)
    .sort((a, b) => a.mins - b.mins);

  const groups = [];
  for (const item of unique) {
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

  const periodName = mins => {
    if (mins < 12 * 60) return 'Por la mañana';
    if (mins < 18 * 60) return 'Por la tarde';
    return 'Por la noche';
  };

  const phrases = groups.map(group => {
    const period = periodName(group.startMins);
    if (group.start === group.end) {
      return `${period} tengo espacio a las ${formatNaturalTime(group.start)}`;
    }
    return `${period} tengo disponibilidad de ${formatNaturalTime(group.start)} a ${formatNaturalTime(group.end)}`;
  });

  if (phrases.length === 1) {
    return `Claro 😊 Para ${day}, ${phrases[0].charAt(0).toLowerCase()}${phrases[0].slice(1)}. ¿Qué hora te queda mejor?`;
  }

  const last = phrases.pop();
  return `Claro 😊 Para ${day}: ${phrases.join('; ')}; y ${last.charAt(0).toLowerCase()}${last.slice(1)}. ¿Qué hora te queda mejor?`;
}

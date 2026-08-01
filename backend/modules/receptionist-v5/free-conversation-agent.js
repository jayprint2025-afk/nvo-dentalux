
'use strict';

const Memory = require('./conversation-memory');
const Appointment = require('./appointment-tools');
const Grounding = require('./conversation-grounding');

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

Devuelve JSON:
{
  "reply":"respuesta natural",
  "state_patch":{"collected":{},"conversation_summary":"","pending_booking":null},
  "action":{"type":"none|check_availability|prepare_confirmation|create_appointment|handoff","args":{}},
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
  const allowed = new Set(['none', 'check_availability', 'prepare_confirmation', 'create_appointment', 'handoff']);
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
    start_time: source.start_time || source.selected_time || source.selected_slot?.start_time || source.current_slot?.start_time || null,
    end_time: source.end_time || source.selected_slot?.end_time || source.current_slot?.end_time || null,
  };
}

function normalizedPendingBooking(state, knowledge) {
  const pending = state?.pending_booking;
  if (!pending || typeof pending !== 'object') return null;

  const data = canonicalBookingData(state, pending);

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

  const data = canonicalBookingData(state);
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

async function runAgent(q, ctx, incoming, userText, knowledge) {
  const state = Memory.initialState(incoming);
  const grounding = Grounding.deriveFacts(userText, knowledge, state);
  state.collected = grounding.collected;

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

  // La IA redacta libremente, pero no decide si debe volver a preguntar datos ya conocidos.
  // Si el paciente está intentando agendar y ya tenemos sucursal, servicio y fecha,
  // la consulta de disponibilidad es obligatoria.
  const wantsBooking = Grounding.bookingIntent(userText);
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

  if (plan.action.type === 'none' && explicitConfirmation(userText, state)) {
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
      const toolResult = await Appointment.checkAvailability(q, ctx, args);
      let slots = Array.isArray(toolResult.slots) ? toolResult.slots : [];
      slots = slots.filter(slot => !state.rejected_slots.includes(String(slot.start_time).slice(0, 5)));

      const selected = slots[0] || null;
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

      // Guardar el horario ofrecido aunque el modelo no lo incluya en state_patch.
      if (selected) {
        state.collected.start_time = String(selected.start_time).slice(0, 5);
        if (selected.end_time) {
          state.collected.end_time = String(selected.end_time).slice(0, 5);
        }
      }

      // El modelo no puede volver a pedir sucursal, servicio o fecha después de una consulta exitosa.
      const availabilityViolations = Grounding.replyViolations(plan.reply, state, userText);
      if (selected && (
        !plan.reply ||
        availabilityViolations.length ||
        !String(plan.reply).includes(String(selected.start_time).slice(0, 5))
      )) {
        const branch = knowledge.branches.find(
          item => item.branch_key === state.collected.branch_key
        );
        const service = knowledge.services.find(
          item => String(item.id) === String(state.collected.service_id)
        );
        plan.reply =
          `Tengo disponible ${service?.name || 'ese servicio'} en ` +
          `${branch?.name || state.collected.branch_name || 'la sucursal seleccionada'} ` +
          `el ${state.collected.date} a las ${String(selected.start_time).slice(0, 5)}. ` +
          `¿Te funciona ese horario?`;
      } else if (!selected) {
        plan.reply =
          `No encontré horarios disponibles para el ${state.collected.date}` +
          `${state.collected.after_time ? ` después de las ${state.collected.after_time}` : ''}. ` +
          `Puedo buscar otro día u otro rango de horario.`;
      }

      used = 'check_availability';
    }
  }

  if (plan.action.type === 'prepare_confirmation') {
    const args = canonicalBookingData({ collected: { ...state.collected, ...plan.action.args } });
    const required = ['patient', 'phone', 'branch_key', 'service_id', 'date', 'start_time'];
    const missing = required.filter(key => !args[key]);

    if (missing.length) {
      plan.reply = plan.reply || `Para preparar la confirmación todavía necesito: ${missing.join(', ')}.`;
    } else {
      const key = Appointment.bookingKey(args);
      state.pending_booking = {
        ...args,
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
      plan.reply = missing.length
        ? `Antes de confirmar todavía necesito completar: ${missing.join(', ')}.`
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
      const created = await Appointment.createAppointment(q, ctx, pending);
      state.appointment_id = created.id;
      state.completed_booking_keys.push(pending.booking_key);
      state.pending_booking = null;
      plan.reply = `Listo, tu cita quedó registrada correctamente. Número de cita: ${created.id}.`;
      used = 'appointment_booked';
    }
  }

  if (plan.action.type === 'handoff') {
    state.handoff_requested = true;
    plan.reply = plan.reply || knowledge.unknown_information_policy;
    used = 'handoff';
  }

  const deterministicParts = deterministicInformation(
    knowledge,
    state,
    grounding.detected.information_intents
  );

  for (const part of deterministicParts) {
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

  Memory.recordTurn(state, userText, plan.reply, { used });

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
};

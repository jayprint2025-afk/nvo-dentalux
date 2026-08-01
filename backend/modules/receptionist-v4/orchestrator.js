'use strict';

const { INTENTS, CONFIRMATIONS } = require('./schemas');
const { extractIntent } = require('./intent-extractor');
const State = require('./state-manager');
const Tools = require('./tools');
const Reply = require('./response-generator');
const { normalizePhone, isPastDate, formatTime } = require('./utils');

async function orchestrate(q, ctx, incomingState, userText) {
  let state = State.initialState(incomingState);
  if (!state.phone) state.phone = normalizePhone(ctx.phone) || null;

  let serviceList = await Tools.services(q, state.branch_key).catch(() => []);
  const extraction = await extractIntent(userText, state, serviceList);

  if (extraction.needs_human || extraction.primary_intent === INTENTS.HUMAN) {
    state.handoff_requested = true;
    state.awaiting = 'human';
    return finish(state, userText,
      'Claro. Registraré que deseas atención de una persona. Conservaré los datos que ya proporcionaste.',
      'human_handoff');
  }

  if (extraction.primary_intent === INTENTS.RESTART) {
    state = State.reset(state, { phone: state.phone });
    state.active = true;
    state.intent = INTENTS.BOOKING;
    state.awaiting = 'branch';
    return finish(state, userText, Reply.ask('branch', state), 'restart');
  }

  if (extraction.primary_intent === INTENTS.CANCEL_FLOW) {
    state = State.reset(state, { phone: state.phone });
    return finish(state, userText, 'Entendido. Dejé sin efecto el proceso de cita. ¿En qué más puedo ayudarte?', 'cancel_flow');
  }

  if (extraction.primary_intent === INTENTS.GRATITUDE && !state.active) {
    return finish(state, userText, 'Con gusto 😊 Estoy aquí para ayudarte cuando lo necesites.', 'gratitude');
  }

  if (extraction.booking_intent || extraction.primary_intent === INTENTS.BOOKING || state.active) {
    state.active = true;
    state.intent = INTENTS.BOOKING;
  }

  // Branch first because services may be branch-specific.
  if (extraction.updates.branch_key) {
    State.applyUpdates(state, { branch_key: extraction.updates.branch_key });
    serviceList = await Tools.services(q, state.branch_key).catch(() => []);
  }

  let matchedService = null;
  if (extraction.updates.service_text) {
    matchedService = Tools.matchService(serviceList, extraction.updates.service_text);
  }

  const updates = {
    service_id: matchedService?.id || null,
    service_name: matchedService?.name || null,
    date: extraction.updates.date,
    time_preference: extraction.updates.preferred_time,
    patient: extraction.updates.patient,
    phone: extraction.updates.phone,
  };
  State.applyUpdates(state, updates);

  if (state.date && isPastDate(state.date)) {
    state.date = null;
    State.clearAvailability(state);
    state.awaiting = 'date';
    return finish(state, userText, 'Esa fecha ya pasó. ¿Qué día futuro te gustaría?', 'past_date');
  }

  // Informational interruptions never discard booking data.
  let infoAnswers = [];
  if (extraction.information_requests.length) {
    infoAnswers = await Tools.answerInformation(q, ctx, state, extraction.information_requests, serviceList);
  }

  if (!state.active) {
    if (infoAnswers.length) {
      return finish(state, userText, `${infoAnswers.join('\n')}\n\n¿Deseas que te ayude a agendar una cita?`, 'information');
    }
    if (extraction.primary_intent === INTENTS.GREETING) {
      return finish(state, userText, '¡Hola! 😊 Puedo ayudarte con precios, servicios, ubicación o para agendar una cita.', 'greeting');
    }
    return finish(state, userText, 'Con gusto te ayudo. ¿Deseas información o quieres agendar una cita?', 'unknown');
  }

  const missing = State.missingField(state);

  if (infoAnswers.length) {
    const continuation = continuationPrompt(missing, state, serviceList);
    return finish(state, userText, `${infoAnswers.join('\n')}${continuation ? `\n\n${continuation}` : ''}`, 'information_interrupt');
  }

  if (missing === 'branch') {
    state.awaiting = 'branch';
    return finish(state, userText, Reply.ask('branch', state), 'ask_branch');
  }
  if (missing === 'service') {
    state.awaiting = 'service';
    return finish(state, userText, Reply.ask('service', state, serviceList), 'ask_service');
  }
  if (missing === 'date') {
    state.awaiting = 'date';
    return finish(state, userText, Reply.ask('date', state), 'ask_date');
  }

  // A proposed slot is a yes/no decision.
  if (state.proposed_slot && !state.selected_slot) {
    if (extraction.confirmation === CONFIRMATIONS.YES) {
      state.selected_slot = state.proposed_slot;
      state.proposed_slot = null;
      state.awaiting = null;
    } else if ([CONFIRMATIONS.NO, CONFIRMATIONS.CHANGE].includes(extraction.confirmation)) {
      const nextIndex = state.offered_index + 1;
      const next = state.offered_slots[nextIndex];
      if (next) {
        state.offered_index = nextIndex;
        state.proposed_slot = next;
        state.awaiting = 'slot_confirmation';
        return finish(state, userText, `Claro. También tengo a las ${formatTime(next.start_time)}. ¿Te funciona?`, 'offer_next_slot');
      }
      state.date = null;
      State.clearAvailability(state);
      state.awaiting = 'date';
      return finish(state, userText, 'No tengo otra opción ese día. ¿Qué otro día te gustaría?', 'no_more_slots');
    } else {
      state.awaiting = 'slot_confirmation';
      return finish(state, userText, `¿Confirmas el horario de las ${formatTime(state.proposed_slot.start_time)}? También puedes pedir otra hora.`, 'clarify_slot');
    }
  }

  if (!state.selected_slot) {
    const slots = await Tools.availability(q, ctx, state);
    if (!slots.length) {
      state.date = null;
      State.clearAvailability(state);
      state.awaiting = 'date';
      return finish(state, userText, 'No encontré disponibilidad para ese día. ¿Qué otro día te gustaría?', 'no_availability');
    }
    state.offered_slots = slots;
    state.offered_index = 0;
    state.proposed_slot = slots[0];
    state.awaiting = 'slot_confirmation';
    const exactUnavailable = state.time_preference?.kind === 'exact'
      && slots[0].start_time.slice(0,5) !== state.time_preference.value;
    return finish(state, userText, Reply.slotOffer(state, exactUnavailable), 'offer_slot');
  }

  if (!state.phone) {
    state.awaiting = 'phone';
    return finish(state, userText, Reply.ask('phone', state), 'ask_phone');
  }
  if (!state.patient) {
    state.awaiting = 'patient';
    return finish(state, userText, Reply.ask('patient', state), 'ask_patient');
  }

  if (!state.final_confirmation_pending) {
    state.final_confirmation_pending = true;
    state.awaiting = 'final_confirmation';
    return finish(state, userText, Reply.summary(state), 'final_summary');
  }

  if (state.awaiting === 'final_confirmation') {
    if (extraction.confirmation === CONFIRMATIONS.YES) {
      try {
        const created = await Tools.book(q, ctx, state);
        const reply = Reply.booked(created, state);
        state = State.complete(state, created.id);
        return finish(state, userText, reply, created.existing ? 'appointment_existing' : 'appointment_booked');
      } catch (error) {
        if (/Horario ya fue tomado/i.test(error.message)) {
          state.selected_slot = null;
          state.proposed_slot = null;
          state.final_confirmation_pending = false;
          state.awaiting = 'availability';
          return finish(state, userText, 'Ese horario acaba de ocuparse. Buscaré otra opción disponible.', 'slot_taken');
        }
        console.error('❌ Receptionist V4 booking:', error);
        return finish(state, userText,
          'No pude guardar la cita todavía, pero conservé todos los datos. Responde “sí” para volver a intentarlo o pide hablar con una persona.',
          'booking_retry');
      }
    }

    if ([CONFIRMATIONS.NO, CONFIRMATIONS.CHANGE].includes(extraction.confirmation)) {
      state.final_confirmation_pending = false;
      state.awaiting = 'change';
      return finish(state, userText, 'Claro. ¿Qué deseas cambiar: sucursal, servicio, día, hora, nombre o teléfono?', 'ask_change');
    }
    return finish(state, userText, 'Para guardarla necesito tu confirmación. Responde “sí” o dime qué dato deseas cambiar.', 'clarify_final');
  }

  return finish(state, userText, continuationPrompt(State.missingField(state), state, serviceList), 'continue');
}

function continuationPrompt(missing, state, services) {
  if (missing === 'slot_confirmation' && state.proposed_slot) {
    return `Seguimos con tu cita: ¿te funciona a las ${formatTime(state.proposed_slot.start_time)}?`;
  }
  if (missing === 'final_confirmation') return Reply.summary(state);
  return missing ? Reply.ask(missing === 'availability' ? 'availability' : missing, state, services) : '';
}

function finish(state, userText, reply, used) {
  State.trackProgress(state, userText, reply);
  if (state.no_progress_count >= 2 && state.active && !['appointment_booked','appointment_existing'].includes(used)) {
    state.no_progress_count = 0;
    const missing = State.missingField(state);
    reply = `${Reply.resume(state, missing)}\n\n${continuationPrompt(missing, state, [])}\n\nTambién puedes escribir “hablar con una persona”.`;
    used = 'loop_recovery';
  }
  return { reply: String(reply || '').trim(), state, used };
}

module.exports = { orchestrate };

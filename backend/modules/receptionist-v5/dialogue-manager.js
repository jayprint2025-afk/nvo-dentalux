'use strict';

const { GOAL_TYPES: G } = require('./command-schema');
const State = require('./dialogue-state');
const Patterns = require('./conversation-patterns');
const Flow = require('./flow-engine');
const Policy = require('./policy-engine');
const Tools = require('./tool-registry');
const Planner = require('./response-planner');
const Writer = require('./response-writer');
const Safety = require('./safety-policy');
const Telemetry = require('./telemetry');

async function manageTurn(q, ctx, incoming, userText, interpretation, context) {
  let state = State.initialState(incoming);
  const pattern = Patterns.applyGlobalPatterns(state, interpretation);
  state = pattern.state;

  if (pattern.terminal) {
    return finish(
      q,
      ctx,
      state,
      userText,
      interpretation,
      { type: 'cancel_all' },
      context,
      {}
    );
  }

  Flow.applyTurnCommands(state, interpretation, context);

  if (state.pending_questions.length && !State.hasGoal(state, G.INFORMATION)) {
    State.startGoal(state, G.INFORMATION);
  }

  let action = Policy.nextPolicy(state);
  const results = {};

  if (action.type === 'answer_information') {
    const answers = [];
    const unresolved = [];

    for (const question of [...state.pending_questions]) {
      const result = await Tools.answerQuestion(q, ctx, state, question, context);

      if (result.unresolved) {
        unresolved.push({ question, missing: result.unresolved });
      } else {
        answers.push(result.answer);
        State.resolveQuestion(state, item => item.id === question.id, result.answer);
      }
    }

    results.answers = answers;

    if (unresolved.length) {
      const missing = unresolved[0].missing;
      results.unresolved_prompt = missing === 'branch'
        ? '¿De cuál sucursal deseas esa información?'
        : '¿De qué servicio deseas esa información?';

      state.last_system_question = {
        type: 'slot_value',
        slot: missing,
        goal: G.INFORMATION,
      };
    } else {
      State.completeGoal(state, G.INFORMATION, { answered: answers.length });

      if (!State.hasGoal(state, G.BOOKING)) {
        results.answers.push('¿Deseas que también te ayude a agendar una cita?');
      }
    }
  }

  if (action.type === 'check_availability') {
    let slots = await Tools.availability(q, ctx, state);
    const alternative = state.pending_actions.find(item => item.type === 'find_alternative');

    if (alternative?.reference_slot) {
      const reference = minutes(alternative.reference_slot.start_time);
      slots = slots.filter(slot => alternative.direction === 'earlier'
        ? minutes(slot.start_time) < reference
        : minutes(slot.start_time) > reference);
      state.pending_actions = state.pending_actions.filter(item => item !== alternative);
    }

    results.slot = slots[0] || null;
    state.last_offer = results.slot
      ? { slot: results.slot, alternatives: slots.slice(1, 8) }
      : null;
    state.last_system_question = results.slot
      ? { type: 'slot_offer', goal: G.BOOKING }
      : { type: 'slot_value', slot: 'date' };
  }

  if (action.type === 'ask_slot') {
    state.last_system_question = {
      type: 'slot_value',
      slot: action.slot,
      goal: G.BOOKING,
    };
  }

  if (action.type === 'request_booking_confirmation') {
    state.last_system_question = {
      type: 'booking_confirmation',
      goal: G.BOOKING,
    };
  }

  if (action.type === 'create_appointment') {
    const errors = Safety.validateBeforeBooking(state);

    if (errors.length) {
      action = {
        type: 'ask_slot',
        slot: errors[0] === 'confirmation' ? 'selected_slot' : errors[0],
      };
    } else {
      try {
        results.created = await Tools.createAppointment(q, ctx, state);
        action = { type: 'appointment_booked' };
        state.appointment_id = results.created.id;
        state.completed_at = new Date().toISOString();
        State.completeGoal(state, G.BOOKING, {
          appointment_id: results.created.id,
        });
      } catch (error) {
        if (Safety.safeToolError(error) === 'slot_taken') {
          State.clearSlot(state, 'selected_slot');
          delete state.commitments.booking_confirmed;
          action = { type: 'check_availability' };
          const slots = await Tools.availability(q, ctx, state);
          results.slot = slots[0] || null;
        } else {
          console.error('Recepcionista V5 create appointment error:', error);
          action = { type: 'general_help' };
        }
      }
    }
  }

  // This return must apply to every policy action, not only create_appointment.
  return finish(q, ctx, state, userText, interpretation, action, context, results);
}

async function finish(q, ctx, state, userText, interpretation, action, context, results) {
  const plan = Planner.plan(action, state, context, results);
  const reply = await Writer.writeResponse(plan, state, context);

  if (!reply || typeof reply !== 'string') {
    const error = new Error(`V5 response writer returned an invalid reply for action ${action.type}`);
    error.code = 'INVALID_V5_REPLY';
    throw error;
  }

  State.recordTurn(state, userText, interpretation, action, reply);

  await Telemetry.emit(q, ctx, 'v5_turn', {
    action: action.type,
    mode: state.mode,
    pending_questions: state.pending_questions.length,
    active_goals: state.active_goals.map(goal => goal.type),
  });

  return {
    reply,
    state,
    used: action.type,
    engine_version: 'v5',
  };
}

function minutes(time) {
  const [hours, mins] = String(time || '00:00').split(':').map(Number);
  return hours * 60 + mins;
}

module.exports = { manageTurn };

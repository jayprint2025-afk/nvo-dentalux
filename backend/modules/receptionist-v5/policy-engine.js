'use strict';

const { GOAL_TYPES: G } = require('./command-schema');
const State = require('./dialogue-state');

function nextPolicy(state) {
  if (state.transient_act === 'already_booked') return { type: 'already_booked' };
  if (state.transient_act === 'greeting' && !state.active_goals.length) return { type: 'greeting' };
  if (state.transient_act === 'gratitude' && !state.active_goals.length) return { type: 'gratitude' };
  if (state.transient_act === 'out_of_scope' && !state.active_goals.length) return { type: 'out_of_scope' };

  if (state.repair?.type === 'medical_alert') return { type: 'medical_safety' };
  if (State.hasGoal(state, G.HUMAN)) return { type: 'handoff' };
  if (state.repair?.type === 'frustration') return { type: 'repair_frustration' };

  const information = State.hasGoal(state, G.INFORMATION);
  const booking = State.hasGoal(state, G.BOOKING);

  if (information && state.pending_questions.length) {
    return { type: 'answer_information', questions: state.pending_questions };
  }

  if (booking) {
    const missing = State.bookingMissing(state);
    if (missing.length) {
      const next = missing[0];
      if (
        next === 'selected_slot' &&
        State.value(state, 'branch') &&
        State.value(state, 'service') &&
        State.value(state, 'date')
      ) {
        return { type: 'check_availability' };
      }
      return { type: 'ask_slot', slot: next };
    }

    if (!state.commitments.booking_confirmed) {
      return { type: 'request_booking_confirmation' };
    }
    return { type: 'create_appointment' };
  }

  if (information) return { type: 'close_information' };
  return { type: 'general_help' };
}

module.exports = { nextPolicy };

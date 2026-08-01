'use strict';

const { COMMAND_TYPES: C, GOAL_TYPES: G } = require('./command-schema');
const State = require('./dialogue-state');
const Tools = require('./tool-registry');

function applyTurnCommands(state, turn, context) {
  for (const command of turn.commands) {
    if (command.type === C.SET_SLOT && command.slot) {
      let value = command.value;

      if (command.slot === 'service') {
        const matched = Tools.matchService(
          context.services || [],
          value,
          State.value(state, 'clinical_reason')
        );
        if (matched) {
          value = {
            id: String(matched.id),
            name: matched.name,
            duration_hours: matched.duration_hours || 1,
          };
        }
      }

      State.setSlot(state, command.slot, value, {
        confidence: command.confidence || 0.75,
        status: command.confidence >= 0.9 ? 'confirmed' : 'inferred',
      });
    }

    if (command.type === C.CLEAR_SLOT && command.slot) {
      State.clearSlot(state, command.slot);
      delete state.commitments.booking_confirmed;
    }

    if (command.type === C.REQUEST_INFO && command.topic) {
      State.addQuestion(state, { goal: G.INFORMATION, topic: command.topic });
    }

    if (command.type === C.CONFIRM) {
      const last = state.last_system_question;

      if (state.appointment_id && state.last_action?.type === 'appointment_booked') {
        state.transient_act = 'already_booked';
      } else if (last?.type === 'booking_confirmation') {
        state.commitments.booking_confirmed = true;
      } else if (last?.type === 'slot_offer' && state.last_offer?.slot) {
        State.setSlot(state, 'selected_slot', state.last_offer.slot, {
          status: 'confirmed',
          confidence: 1,
        });
      }
    }

    if (command.type === C.REJECT) {
      const last = state.last_system_question;
      if (last?.type === 'slot_offer') {
        State.clearSlot(state, 'selected_slot');
        state.last_offer = { ...(state.last_offer || {}), rejected: true };
      } else if (last?.type === 'booking_confirmation') {
        delete state.commitments.booking_confirmed;
        state.repair = { type: 'booking_revision_requested' };
      }
    }

    if (command.type === C.ASK_ALTERNATIVE && state.last_offer?.slot) {
      state.pending_actions = state.pending_actions.filter(
        item => item.type !== 'find_alternative'
      );
      state.pending_actions.push({
        goal: G.BOOKING,
        type: 'find_alternative',
        direction: command.reference || 'later',
        reference_slot: state.last_offer.slot,
      });
    }
  }
}

module.exports = { applyTurnCommands };

'use strict';

const { normalizePhone } = require('./utils');

function initialState(input = {}) {
  const s = input && typeof input === 'object' ? { ...input } : {};
  return {
    version: 'v4',
    active: Boolean(s.active || s.intent === 'booking'),
    intent: s.intent || null,
    branch_key: s.branch_key || null,
    service_id: s.service_id || null,
    service_name: s.service_name || null,
    date: s.date || null,
    time_preference: s.time_preference || null,
    offered_slots: Array.isArray(s.offered_slots) ? s.offered_slots : [],
    offered_index: Number(s.offered_index || 0),
    proposed_slot: s.proposed_slot || null,
    selected_slot: s.selected_slot || null,
    last_proposed_slot: s.last_proposed_slot || s.proposed_slot || s.selected_slot || null,
    last_selected_slot: s.last_selected_slot || s.selected_slot || null,
    slot_history: Array.isArray(s.slot_history) ? s.slot_history.slice(-10) : [],
    patient: s.patient || null,
    phone: normalizePhone(s.phone) || s.phone || null,
    awaiting: s.awaiting || null,
    final_confirmation_pending: Boolean(s.final_confirmation_pending),
    appointment_id: s.appointment_id || null,
    handoff_requested: Boolean(s.handoff_requested),
    pending_information_requests: Array.isArray(s.pending_information_requests)
      ? s.pending_information_requests
      : [],
    information_branch_key: s.information_branch_key || null,
    turn_count: Number(s.turn_count || 0),
    no_progress_count: Number(s.no_progress_count || 0),
    last_signature: s.last_signature || null,
    recent_messages: Array.isArray(s.recent_messages) ? s.recent_messages.slice(-8) : [],
    recent_replies: Array.isArray(s.recent_replies) ? s.recent_replies.slice(-8) : [],
    completed_at: s.completed_at || null,
  };
}

function signature(s) {
  return JSON.stringify([
    s.active, s.branch_key, s.service_id, s.date,
    s.time_preference, s.proposed_slot?.start_time,
    s.selected_slot?.start_time, s.patient, s.phone,
    s.awaiting, s.final_confirmation_pending, s.appointment_id,
    s.information_branch_key,
    (s.pending_information_requests || []).map(x => x.type).join(','),
  ]);
}

function clearAvailability(s, options = {}) {
  if (s.proposed_slot) {
    s.last_proposed_slot = s.proposed_slot;
    s.slot_history = [...(s.slot_history || []), s.proposed_slot].slice(-10);
  }
  if (s.selected_slot) {
    s.last_selected_slot = s.selected_slot;
    s.slot_history = [...(s.slot_history || []), s.selected_slot].slice(-10);
  }

  s.offered_slots = [];
  s.offered_index = 0;
  s.proposed_slot = null;
  if (!options.keepSelected) s.selected_slot = null;
  s.final_confirmation_pending = false;
}

function applyUpdates(s, updates = {}) {
  const changed = [];
  if (updates.branch_key && updates.branch_key !== s.branch_key) {
    s.branch_key = updates.branch_key;
    s.service_id = null;
    s.service_name = null;
    s.date = null;
    s.time_preference = null;
    clearAvailability(s);
    changed.push('branch');
  }
  if (updates.service_id && updates.service_id !== s.service_id) {
    s.service_id = String(updates.service_id);
    s.service_name = updates.service_name || s.service_name;
    clearAvailability(s);
    changed.push('service');
  } else if (updates.service_name) {
    s.service_name = updates.service_name;
  }
  if (updates.date && updates.date !== s.date) {
    s.date = updates.date;
    clearAvailability(s);
    changed.push('date');
  }
  if (updates.time_preference) {
    const before = JSON.stringify(s.time_preference);
    const after = JSON.stringify(updates.time_preference);
    if (before !== after) {
      s.time_preference = updates.time_preference;
      clearAvailability(s);
      changed.push('time');
    }
  }
  if (updates.patient && updates.patient !== s.patient) {
    s.patient = updates.patient;
    changed.push('patient');
  }
  if (updates.phone && updates.phone !== s.phone) {
    s.phone = updates.phone;
    changed.push('phone');
  }
  return changed;
}

function missingField(s) {
  if (!s.branch_key) return 'branch';
  if (!s.service_id) return 'service';
  if (!s.date) return 'date';
  if (!s.selected_slot) return s.proposed_slot ? 'slot_confirmation' : 'availability';
  if (!s.phone) return 'phone';
  if (!s.patient) return 'patient';
  if (!s.final_confirmation_pending) return 'final_confirmation';
  return null;
}

function reset(s, keep = {}) {
  return initialState({
    phone: keep.phone || null,
    branch_key: keep.branch_key || null,
  });
}

function complete(s, appointmentId) {
  const done = initialState({
    phone: s.phone,
    branch_key: s.branch_key,
  });
  done.appointment_id = appointmentId;
  done.completed_at = new Date().toISOString();
  done.last_completed = {
    appointment_id: appointmentId,
    branch_key: s.branch_key,
    service_name: s.service_name,
    date: s.selected_slot?.date,
    start_time: s.selected_slot?.start_time,
    patient: s.patient,
    phone: s.phone,
  };
  return done;
}

function trackProgress(s, userText, reply) {
  s.turn_count += 1;
  const nextSig = signature(s);
  s.no_progress_count = nextSig === s.last_signature ? s.no_progress_count + 1 : 0;
  s.last_signature = nextSig;
  s.recent_messages = [...s.recent_messages, String(userText || '')].slice(-8);
  s.recent_replies = [...s.recent_replies, String(reply || '')].slice(-8);
  return s;
}


function rememberProposedSlot(s, slot) {
  if (!slot) return;
  s.proposed_slot = slot;
  s.last_proposed_slot = slot;
  s.slot_history = [...(s.slot_history || []), slot].slice(-10);
}

function selectProposedSlot(s) {
  if (!s.proposed_slot) return null;
  s.selected_slot = s.proposed_slot;
  s.last_selected_slot = s.proposed_slot;
  s.last_proposed_slot = s.proposed_slot;
  s.slot_history = [...(s.slot_history || []), s.proposed_slot].slice(-10);
  s.proposed_slot = null;
  return s.selected_slot;
}

function restoreLastSlot(s) {
  const slot =
    s.last_selected_slot ||
    s.last_proposed_slot ||
    (s.slot_history || [])[s.slot_history.length - 1] ||
    null;

  if (!slot) return null;

  s.date = slot.date || s.date;
  s.selected_slot = slot;
  s.last_selected_slot = slot;
  s.proposed_slot = null;
  return slot;
}

module.exports = {
  initialState, signature, clearAvailability, applyUpdates, missingField,
  reset, complete, trackProgress,
  rememberProposedSlot, selectProposedSlot, restoreLastSlot,
};

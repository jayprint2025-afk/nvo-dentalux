'use strict';

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function initialState(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    version: 'v5-free',
    collected: source.collected && typeof source.collected === 'object' ? { ...source.collected } : {},
    conversation_summary: cleanText(source.conversation_summary),
    recent_turns: Array.isArray(source.recent_turns) ? source.recent_turns.slice(-12) : [],
    recent_replies: Array.isArray(source.recent_replies) ? source.recent_replies.slice(-6) : [],
    pending_booking: source.pending_booking && typeof source.pending_booking === 'object'
      ? { ...source.pending_booking }
      : null,
    last_tool_result: source.last_tool_result || null,
    handoff_requested: Boolean(source.handoff_requested),
    appointment_id: source.appointment_id || null,
    completed_booking_keys: Array.isArray(source.completed_booking_keys)
      ? source.completed_booking_keys.slice(-20)
      : [],
    turn_count: Number(source.turn_count || 0),
  };
}

function mergeState(state, patch) {
  if (!patch || typeof patch !== 'object') return state;
  if (patch.collected && typeof patch.collected === 'object') {
    for (const [key, value] of Object.entries(patch.collected)) {
      if (value !== undefined) state.collected[key] = value;
    }
  }
  if (typeof patch.conversation_summary === 'string') {
    state.conversation_summary = cleanText(patch.conversation_summary).slice(0, 2000);
  }
  if (patch.pending_booking === null) state.pending_booking = null;
  else if (patch.pending_booking && typeof patch.pending_booking === 'object') {
    state.pending_booking = { ...(state.pending_booking || {}), ...patch.pending_booking };
  }
  if (typeof patch.handoff_requested === 'boolean') state.handoff_requested = patch.handoff_requested;
  return state;
}

function recordTurn(state, user, reply, meta = {}) {
  state.turn_count += 1;
  state.recent_turns.push({ user: cleanText(user), reply: cleanText(reply), ...meta });
  state.recent_turns = state.recent_turns.slice(-12);
  state.recent_replies.push(cleanText(reply));
  state.recent_replies = state.recent_replies.slice(-6);
}

function normalizedReply(text) {
  return cleanText(text)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, '');
}

function isRepeatedReply(state, reply) {
  const candidate = normalizedReply(reply);
  if (!candidate) return true;
  return state.recent_replies.slice(-2).some(item => normalizedReply(item) === candidate);
}

module.exports={initialState,mergeState,recordTurn,isRepeatedReply,cleanText};

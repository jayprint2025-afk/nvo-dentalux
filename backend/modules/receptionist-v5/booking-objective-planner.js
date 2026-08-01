
'use strict';

const REQUIRED_FIELDS = [
  'branch_key',
  'service_id',
  'date',
  'start_time',
  'patient',
  'phone',
];

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalCollected(collected = {}) {
  return {
    ...collected,
    patient: collected.patient || collected.patient_name || collected.name || null,
    phone: collected.phone || collected.wa_phone || collected.telephone || null,
    start_time:
      collected.start_time ||
      collected.exact_time ||
      collected.selected_time ||
      collected.selected_slot?.start_time ||
      null,
  };
}

function isAffirmative(text) {
  return /^(si|ok|okay|claro|por favor|si por favor|adelante|de acuerdo|esta bien|perfecto)$/.test(
    normalize(text)
  );
}

function ensureGoal(state) {
  if (!state.booking_goal || typeof state.booking_goal !== 'object') {
    state.booking_goal = {
      objective: 'collect_valid_booking',
      blocked_dates: [],
      rejected_times: [],
      awaiting: null,
      invalid_reason: null,
      last_invalid_date: null,
      last_validated_slot: null,
      updated_at: new Date().toISOString(),
    };
  }

  state.booking_goal.blocked_dates = Array.isArray(state.booking_goal.blocked_dates)
    ? state.booking_goal.blocked_dates
    : [];
  state.booking_goal.rejected_times = Array.isArray(state.booking_goal.rejected_times)
    ? state.booking_goal.rejected_times
    : [];

  return state.booking_goal;
}

function missingFields(collected = {}) {
  const c = canonicalCollected(collected);
  return REQUIRED_FIELDS.filter(field => !c[field]);
}

function nextObjective(state) {
  const goal = ensureGoal(state);
  const collected = canonicalCollected(state.collected);

  if (goal.awaiting === 'alternative_date') {
    return { type: 'find_next_available_date', reason: goal.invalid_reason };
  }
  if (!collected.branch_key) return { type: 'collect', field: 'branch_key' };
  if (!collected.service_id) return { type: 'collect', field: 'service_id' };
  if (!collected.date) return { type: 'collect', field: 'date' };
  if (!collected.start_time) return { type: 'check_availability' };
  if (!collected.patient) return { type: 'collect', field: 'patient' };
  if (!collected.phone) return { type: 'collect', field: 'phone' };
  if (!state.pending_booking) return { type: 'prepare_confirmation' };
  return { type: 'wait_confirmation' };
}

function markUnavailable(state, { date, reason = 'no_availability' } = {}) {
  const goal = ensureGoal(state);
  const invalidDate = date || state.collected?.date || null;

  if (invalidDate) {
    goal.blocked_dates = [...new Set([...goal.blocked_dates, invalidDate])].slice(-30);
    goal.last_invalid_date = invalidDate;
  }

  goal.invalid_reason = reason;
  goal.awaiting = 'alternative_date';
  goal.last_validated_slot = null;

  if (state.collected) {
    delete state.collected.start_time;
    delete state.collected.exact_time;
    delete state.collected.end_time;
    delete state.collected.doctor_id;
    delete state.collected.doctor_name;
    delete state.collected.selected_slot;
  }

  state.pending_booking = null;
  return goal;
}

function markSlotValidated(state, slot) {
  const goal = ensureGoal(state);
  goal.awaiting = null;
  goal.invalid_reason = null;
  goal.last_validated_slot = slot
    ? {
        date: slot.date || state.collected?.date || null,
        start_time: String(slot.start_time || '').slice(0, 5),
        doctor_id: slot.doctor_id || null,
      }
    : null;
  return goal;
}

function shouldFindAlternative(state, text) {
  return ensureGoal(state).awaiting === 'alternative_date' && isAffirmative(text);
}

function rejectInvalidDateReuse(state) {
  const goal = ensureGoal(state);
  const date = state.collected?.date;
  return Boolean(date && goal.blocked_dates.includes(date));
}

function applyObjectiveOverride({ state, userText, plan }) {
  const goal = ensureGoal(state);
  const objective = nextObjective(state);

  if (shouldFindAlternative(state, userText)) {
    return {
      ...plan,
      action: {
        type: 'find_next_available_date',
        args: {
          ...state.collected,
          after_date: goal.last_invalid_date || state.collected?.date || null,
        },
      },
      reason: 'El paciente aceptó buscar una fecha alternativa válida.',
    };
  }

  if (rejectInvalidDateReuse(state)) {
    return {
      ...plan,
      action: {
        type: 'find_next_available_date',
        args: {
          ...state.collected,
          after_date: goal.last_invalid_date || state.collected?.date || null,
        },
      },
      reason: 'No reutilizar una fecha previamente marcada como inválida.',
    };
  }

  if (objective.type === 'prepare_confirmation' && plan.action?.type === 'create_appointment') {
    return {
      ...plan,
      action: {
        type: 'prepare_confirmation',
        args: { ...state.collected },
      },
      reason: 'Primero mostrar resumen y esperar confirmación posterior.',
    };
  }

  return plan;
}

function objectiveContext(state) {
  const goal = ensureGoal(state);
  return {
    objective: goal.objective,
    next_objective: nextObjective(state),
    missing_fields: missingFields(state.collected),
    blocked_dates: goal.blocked_dates,
    rejected_times: goal.rejected_times,
    awaiting: goal.awaiting,
    invalid_reason: goal.invalid_reason,
    rules: [
      'No reutilizar fechas bloqueadas.',
      'Un sí responde al objetivo pendiente y no confirma automáticamente una cita.',
      'Crear una cita sólo después de presentar un resumen válido.',
      'Si una fecha no tiene servicio o disponibilidad, buscar una alternativa.',
    ],
  };
}

module.exports = {
  canonicalCollected,
  isAffirmative,
  ensureGoal,
  missingFields,
  nextObjective,
  markUnavailable,
  markSlotValidated,
  shouldFindAlternative,
  rejectInvalidDateReuse,
  applyObjectiveOverride,
  objectiveContext,
};

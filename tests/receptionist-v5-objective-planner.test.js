
'use strict';

const assert = require('assert');
const Planner = require('../backend/modules/receptionist-v5/booking-objective-planner');

const state = {
  collected: {
    branch_key: 'sucursal_2',
    service_id: '53',
    date: '2026-08-02',
  },
};

Planner.markUnavailable(state, {
  date: '2026-08-02',
  reason: 'La clínica no abre los domingos.',
});

assert.equal(state.booking_goal.awaiting, 'alternative_date');
assert(state.booking_goal.blocked_dates.includes('2026-08-02'));
console.log('✅ marca domingo como fecha inválida');

const plan = Planner.applyObjectiveOverride({
  state,
  userText: 'Sí por favor',
  plan: {
    reply: '',
    action: { type: 'none', args: {} },
    reason: '',
  },
});

assert.equal(plan.action.type, 'find_next_available_date');
assert.equal(plan.action.args.after_date, '2026-08-02');
console.log('✅ “Sí por favor” busca otra fecha');

const repeated = Planner.applyObjectiveOverride({
  state: {
    collected: {
      branch_key: 'sucursal_2',
      service_id: '53',
      date: '2026-08-02',
    },
    booking_goal: {
      objective: 'collect_valid_booking',
      blocked_dates: ['2026-08-02'],
      rejected_times: [],
      awaiting: null,
      invalid_reason: null,
      last_invalid_date: '2026-08-02',
      last_validated_slot: null,
    },
  },
  userText: 'Quiero ese día',
  plan: {
    reply: '',
    action: { type: 'check_availability', args: {} },
    reason: '',
  },
});

assert.equal(repeated.action.type, 'find_next_available_date');
console.log('✅ no reutiliza una fecha bloqueada');

const objective = Planner.nextObjective({
  collected: {
    branch_key: 'sucursal_2',
    service_id: '53',
    date: '2026-08-03',
    start_time: '10:00',
    patient_name: 'Luis Eduardo Pérez',
    phone: '1234567890',
  },
  pending_booking: null,
});

assert.equal(objective.type, 'prepare_confirmation');
console.log('✅ exige resumen antes de crear');

console.log('\n4/4 pruebas del planificador pasaron.');

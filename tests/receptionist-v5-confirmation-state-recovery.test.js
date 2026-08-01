'use strict';

const assert = require('assert');
const {
  canonicalBookingData,
  ensurePendingBookingFromCollected,
  explicitConfirmation,
} = require('../backend/modules/receptionist-v5/free-conversation-agent');

const knowledge = {
  branches: [{ branch_key: 'sucursal_2', name: 'Condesa' }],
  services: [{ id: 9, name: 'Primera consulta' }],
  promotions: [],
};

const state = {
  collected: {
    patient_name: 'Jonathan Valdez Rojas',
    wa_phone: '15202713253',
    branch_key: 'sucursal_2',
    service_id: 9,
    date: '2026-08-03',
    selected_slot: { start_time: '11:00', end_time: '12:00' },
  },
  pending_booking: null,
  recent_turns: [{
    reply: 'Primera consulta en Condesa el 2026-08-03 a las 11:00 para Jonathan Valdez Rojas con número 15202713253. Responde “sí, confirma la cita”.'
  }],
};

const data = canonicalBookingData(state);
assert.equal(data.patient, 'Jonathan Valdez Rojas');
assert.equal(data.phone, '15202713253');
assert.equal(data.start_time, '11:00');
console.log('✅ normaliza patient_name, wa_phone y selected_slot');

const recovered = ensurePendingBookingFromCollected(state, knowledge);
assert.equal(recovered.complete, true);
assert(state.pending_booking.summary.includes('Jonathan Valdez Rojas'));
assert(state.pending_booking.summary.includes('Condesa'));
assert(!state.pending_booking.summary.includes('undefined'));
console.log('✅ recupera pending_booking desde collected e historial');

assert.equal(explicitConfirmation('Sí, confirma la cita', state), true);
assert.equal(explicitConfirmation('Si', state), true);
console.log('✅ acepta confirmación exacta y breve');

console.log('\n3/3 pruebas de recuperación pasaron.');

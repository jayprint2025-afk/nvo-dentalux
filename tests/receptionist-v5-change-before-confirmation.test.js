'use strict';

const assert = require('assert');
const {
  extractLastExplicitTime,
  detectBookingModification,
  invalidateSelectedSlot,
  updatedConfirmationReply,
} = require('../backend/modules/receptionist-v5/free-conversation-agent');

const knowledge = {
  branches: [
    { branch_key: 'sucursal_1', name: 'Victoria' },
    { branch_key: 'sucursal_2', name: 'Condesa' },
  ],
  services: [
    { id: '64', name: 'Primera consulta' },
    { id: '62', name: 'Extracción' },
  ],
  promotions: [],
};

assert.equal(
  extractLastExplicitTime('No a las 11, no, a las 10 am por favor'),
  '10:00'
);
assert.equal(extractLastExplicitTime('Mejor a las 2 pm'), '14:00');
console.log('✅ detecta la nueva hora solicitada');

{
  const result = detectBookingModification({
    userText: 'No a las 11, a las 10 am por favor',
    previousCollected: {
      date: '2026-08-03',
      branch_key: 'sucursal_2',
      service_id: '64',
      start_time: '11:00',
    },
    previousPending: {
      patient: 'Jonathan Valdez Rojas',
      phone: '15202713253',
      branch_key: 'sucursal_2',
      service_id: '64',
      date: '2026-08-03',
      start_time: '11:00',
    },
    grounding: {
      detected: {
        date: null,
        branch: null,
        service: null,
      },
    },
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.changed_fields, ['time']);
  assert.equal(result.fields.start_time, '10:00');
  console.log('✅ identifica cambio de hora antes de confirmar');
}

{
  const state = {
    collected: {
      patient_name: 'Jonathan Valdez Rojas',
      phone: '15202713253',
      branch_key: 'sucursal_2',
      service_id: '64',
      date: '2026-08-03',
      start_time: '11:00',
      doctor_id: '43',
      selected_slot: {
        doctor_id: '43',
        start_time: '11:00',
      },
    },
    pending_booking: {
      patient: 'Jonathan Valdez Rojas',
      phone: '15202713253',
      branch_key: 'sucursal_2',
      service_id: '64',
      date: '2026-08-03',
      start_time: '11:00',
      doctor_id: '43',
    },
    appointment_id: null,
    last_tool_result: {
      selected_time: '11:00',
    },
  };

  invalidateSelectedSlot(state, {
    start_time: '10:00',
    exact_time: '10:00',
  });

  assert.equal(state.pending_booking, null);
  assert.equal(state.collected.start_time, '10:00');
  assert.equal(state.collected.exact_time, '10:00');
  assert.equal(state.collected.doctor_id, undefined);
  assert.equal(state.collected.selected_slot, undefined);
  assert.equal(state.collected.patient_name, 'Jonathan Valdez Rojas');
  assert.equal(state.collected.phone, '15202713253');
  console.log('✅ invalida slot viejo y conserva paciente/teléfono');
}

{
  const reply = updatedConfirmationReply(
    {
      patient: 'Jonathan Valdez Rojas',
      phone: '15202713253',
      branch_key: 'sucursal_2',
      service_id: '64',
      service_name: 'Primera consulta',
      date: '2026-08-03',
      start_time: '10:00',
    },
    knowledge
  );

  assert(reply.includes('Hora: 10:00'));
  assert(reply.includes('datos actualizados'));
  assert(reply.includes('¿Confirmas'));
  console.log('✅ genera resumen nuevo y solicita otra confirmación');
}

console.log('\n4/4 pruebas de cambio antes de confirmar pasaron.');

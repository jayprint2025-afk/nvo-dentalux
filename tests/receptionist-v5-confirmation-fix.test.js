
'use strict';

const assert = require('assert');
const {
  explicitConfirmation,
  normalizedPendingBooking,
} = require('../backend/modules/receptionist-v5/free-conversation-agent');

const knowledge = {
  branches: [
    { branch_key: 'sucursal_2', name: 'Condesa' },
  ],
  services: [
    { id: 9, name: 'Primera consulta' },
  ],
  promotions: [],
};

{
  const state = {
    collected: {
      patient: 'Jonathan Valdez Rojas',
      phone: '15202713253',
      branch_key: 'sucursal_2',
      service_id: 9,
      date: '2026-08-03',
      start_time: '11:00',
    },
    pending_booking: {
      patient: 'Jonathan Valdez Rojas',
      phone: '15202713253',
      branch_key: 'sucursal_2',
      service_id: 9,
      date: '2026-08-03',
      start_time: '11:00',
      summary: undefined,
    },
    completed_booking_keys: [],
    recent_turns: [],
  };

  const result = normalizedPendingBooking(state, knowledge);
  assert.equal(result.complete, true);
  assert(!result.data.summary.includes('undefined'));
  assert(result.data.summary.includes('Jonathan Valdez Rojas'));
  assert(result.data.summary.includes('Condesa'));
  assert(result.data.summary.includes('11:00'));
  console.log('✅ reconstruye resumen cuando summary viene undefined');
}

{
  const state = {
    pending_booking: {
      presented_at: new Date().toISOString(),
    },
    recent_turns: [
      {
        reply: '¿Confirmas que deseas crear esta cita?',
      },
    ],
  };

  assert.equal(explicitConfirmation('Ok', state), true);
  assert.equal(explicitConfirmation('Sí', state), true);
  assert.equal(explicitConfirmation('Correcto', state), true);
  assert.equal(explicitConfirmation('No', state), false);
  console.log('✅ acepta respuestas breves sólo con confirmación pendiente');
}

{
  const state = {
    pending_booking: null,
    recent_turns: [],
  };
  assert.equal(explicitConfirmation('Ok', state), false);
  console.log('✅ Ok aislado no crea una cita');
}

console.log('\n3/3 pruebas de confirmación pasaron.');

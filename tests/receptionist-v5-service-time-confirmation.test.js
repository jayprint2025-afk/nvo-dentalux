'use strict';

const assert = require('assert');
const {
  canonicalBookingData,
  ensurePendingBookingFromCollected,
  resolveServiceIdentity,
} = require('../backend/modules/receptionist-v5/free-conversation-agent');

const knowledge = {
  branches: [
    { branch_key: 'sucursal_2', name: 'Condesa' },
  ],
  services: [
    { id: '1', name: 'Extracción' },
    { id: '9', name: 'Primera consulta' },
  ],
  promotions: [],
};

{
  const state = {
    collected: {
      date: '2026-08-03',
      type: 'exact',
      phone: '19728037121',
      service: 'Extracción',
      branch_key: 'sucursal_2',
      exact_time: '11:00',
      branch_name: 'Condesa',
      patient_name: 'Jesús Arturo Caballero',
    },
  };

  const data = resolveServiceIdentity(
    canonicalBookingData(state),
    knowledge
  );

  assert.equal(data.patient, 'Jesús Arturo Caballero');
  assert.equal(data.phone, '19728037121');
  assert.equal(data.service_id, '1');
  assert.equal(data.service_name, 'Extracción');
  assert.equal(data.start_time, '11:00');
  console.log('✅ convierte service y exact_time a service_id y start_time');
}

{
  const state = {
    collected: {
      date: '2026-08-03',
      phone: '19728037121',
      service: 'Extracción',
      branch_key: 'sucursal_2',
      exact_time: '11:00',
      patient_name: 'Jesús Arturo Caballero',
    },
    pending_booking: null,
    recent_turns: [{
      reply:
        'Extracción en Condesa el 2026-08-03 a las 11:00 para ' +
        'Jesús Arturo Caballero con número 19728037121. ' +
        'Responde “sí, confirma la cita”.'
    }],
  };

  const recovered = ensurePendingBookingFromCollected(state, knowledge);

  assert.equal(recovered.complete, true);
  assert.equal(recovered.data.service_id, '1');
  assert.equal(recovered.data.start_time, '11:00');
  assert(!recovered.data.summary.includes('undefined'));
  assert(recovered.data.summary.includes('Extracción'));
  console.log('✅ recuperación queda completa con el estado real');
}

console.log('\n2/2 pruebas de servicio y horario pasaron.');

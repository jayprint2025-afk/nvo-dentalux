
'use strict';

const assert = require('assert');
const Grounding = require('../backend/modules/receptionist-v5/conversation-grounding');
const Memory = require('../backend/modules/receptionist-v5/conversation-memory');

const knowledge = {
  branches: [
    { branch_key: 'sucursal_1', name: 'Victoria', address: 'Anillo Periférico 424 A', google_maps_url: 'https://maps.example/victoria' },
    { branch_key: 'sucursal_2', name: 'Condesa', address: 'Calle Babel #1300, Residencial Condesa', google_maps_url: 'https://maps.example/condesa' },
  ],
  services: [
    { id: 1, name: 'Limpieza dental', price: 350, duration_hours: 1 },
    { id: 9, name: 'Primera consulta', price: null, duration_hours: 1 },
  ],
  promotions: [],
};

const state = input => Memory.initialState(input);

const cases = [
  ['Condesa', 'branch_key', 'sucursal_2'],
  ['La de Victoria', 'branch_key', 'sucursal_1'],
  ['Quiero ir a Condesa', 'branch_key', 'sucursal_2'],
  ['Una limpieza', 'service_id', 1],
  ['Quiero una limpieza dental', 'service_id', 1],
  ['Necesito consulta para brackets', 'service_id', 9],
  ['Mi teléfono es 5202713253', 'phone', '5202713253'],
  ['La cita es para Hannah Sofía', 'patient', 'Hannah Sofía'],
];

for (const [message, key, expected] of cases) {
  const result = Grounding.deriveFacts(message, knowledge, state());
  assert.deepEqual(result.collected[key], expected, message);
  console.log(`✅ guarda respuesta corta: ${message}`);
}

{
  const s = state({ collected: { branch_key: 'sucursal_2', branch_name: 'Condesa' } });
  assert(
    Grounding.replyViolations(
      '¿En qué sucursal te gustaría agendar?',
      s,
      'Una limpieza'
    ).includes('pregunta_sucursal_conocida')
  );
  console.log('✅ bloquea volver a preguntar sucursal conocida');
}

{
  const s = state({
    collected: {
      branch_key: 'sucursal_2',
      service_id: 1,
      service_name: 'Limpieza dental',
    },
  });
  assert(
    Grounding.replyViolations(
      '¿Qué servicio deseas realizar?',
      s,
      'Condesa'
    ).includes('pregunta_servicio_conocido')
  );
  console.log('✅ bloquea volver a preguntar servicio conocido');
}

{
  const s = state({
    recent_replies: ['Tengo disponible a las 11:00. ¿Te funciona?'],
  });
  assert(
    Grounding.replyViolations(
      'Tengo disponible a las 11:00. ¿Te funciona?',
      s,
      'No'
    ).includes('respuesta_muy_repetida')
  );
  console.log('✅ detecta respuesta idéntica repetida');
}

{
  const result = Grounding.deriveFacts(
    'Sí, agéndame en Condesa el lunes después de las 11 para una limpieza',
    knowledge,
    state(),
    {
      now: new Date('2026-08-01T07:00:00Z'),
      timeZone: 'America/Phoenix',
    }
  );
  assert.equal(result.collected.branch_key, 'sucursal_2');
  assert.equal(result.collected.service_id, 1);
  assert.equal(result.collected.date, '2026-08-03');
  assert.equal(result.collected.after_time, '11:00');
  console.log('✅ extrae sucursal, servicio, fecha y rango en un solo mensaje');
}

{
  const intents = Grounding.informationIntents(
    '¿Dónde está Condesa y me mandas el Maps? ¿Tienen promoción?'
  );
  assert.deepEqual(
    intents.sort(),
    ['location', 'maps', 'promotion'].sort()
  );
  console.log('✅ detecta varias preguntas empresariales');
}

console.log('\n13/13 pruebas de memoria y anti-bucle pasaron.');

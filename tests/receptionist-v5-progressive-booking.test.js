
'use strict';

const assert = require('assert');
const Grounding = require('../backend/modules/receptionist-v5/conversation-grounding');
const Memory = require('../backend/modules/receptionist-v5/conversation-memory');

const knowledge = {
  branches: [
    { branch_key: 'sucursal_1', name: 'Victoria' },
    { branch_key: 'sucursal_2', name: 'Condesa' },
  ],
  services: [
    { id: 1, name: 'Limpieza dental', duration_hours: 1 },
    { id: 9, name: 'Primera consulta', duration_hours: 1 },
  ],
  promotions: [],
};

const initial = Memory.initialState();

const turn1 = Grounding.deriveFacts(
  'Sí la de Condesa está bien',
  knowledge,
  initial
);
assert.equal(turn1.collected.branch_key, 'sucursal_2');
console.log('✅ turno 1 conserva Condesa');

const state2 = Memory.initialState({ collected: turn1.collected });
const turn2 = Grounding.deriveFacts(
  'Para una consulta mañana después de las 11 am',
  knowledge,
  state2,
  {
    now: new Date('2026-08-01T07:00:00Z'),
    timeZone: 'America/Phoenix',
  }
);

assert.equal(turn2.collected.branch_key, 'sucursal_2');
assert.equal(turn2.collected.service_id, 9);
assert.equal(turn2.collected.date, '2026-08-02');
assert.equal(turn2.collected.after_time, '11:00');
assert.equal(Grounding.bookingIntent('Para una consulta mañana después de las 11 am'), true);
assert.equal(Grounding.availabilityReady(turn2.collected), true);
assert.deepEqual(Grounding.missingBookingFields(turn2.collected), []);
console.log('✅ turno 2 conserva sucursal y completa servicio, fecha y horario');

assert.equal(
  Grounding.nextNaturalQuestion({
    branch_key: 'sucursal_2',
    service_id: 9,
  }),
  '¿Qué día te gustaría asistir?'
);
console.log('✅ sólo pregunta el dato realmente faltante');

const violations = Grounding.replyViolations(
  'Para la consulta mañana después de las 11, ¿prefieres Victoria o Condesa? ¿Qué horario te conviene?',
  { collected: turn2.collected, recent_replies: [] },
  'Para una consulta mañana después de las 11 am'
);

assert(violations.includes('pregunta_sucursal_conocida'));
assert(violations.includes('pregunta_horario_conocido'));
console.log('✅ bloquea repetir sucursal y horario conocidos');

console.log('\n4/4 pruebas del caso real pasaron.');

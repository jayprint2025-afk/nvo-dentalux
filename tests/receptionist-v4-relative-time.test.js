
'use strict';
const assert = require('assert');
const { fallbackExtract } = require('../backend/modules/receptionist-v4/intent-extractor');

const later = fallbackExtract(
  'Ese horario no me funciona, dame otro un poco más tarde.',
  {
    active: true,
    awaiting: 'final_confirmation',
    selected_slot: { date: '2026-08-03', start_time: '11:00' }
  }
);

assert.equal(later.confirmation, 'no');
assert.equal(later.updates.preferred_time.kind, 'after');
assert.equal(later.updates.preferred_time.min, 661);
assert.equal(later.updates.preferred_time.reference_time, '11:00');
console.log('✅ más tarde parte después de 11:00');

const earlier = fallbackExtract(
  'Mejor dame uno un poco más temprano.',
  {
    active: true,
    awaiting: 'slot_confirmation',
    proposed_slot: { date: '2026-08-03', start_time: '15:00' }
  }
);

assert.equal(earlier.updates.preferred_time.kind, 'before');
assert.equal(earlier.updates.preferred_time.max, 899);
assert.equal(earlier.updates.preferred_time.reference_time, '15:00');
console.log('✅ más temprano termina antes de 15:00');

console.log('\n2/2 pruebas pasaron.');

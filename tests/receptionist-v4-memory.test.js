
'use strict';
const assert = require('assert');
const State = require('../backend/modules/receptionist-v4/state-manager');
const { fallbackExtract } = require('../backend/modules/receptionist-v4/intent-extractor');

const s = State.initialState({
  active: true,
  branch_key: 'sucursal_2',
  service_id: '9',
  service_name: 'Consulta',
  date: '2026-08-01',
  proposed_slot: { date:'2026-08-01', start_time:'12:00', doctor_id:1 },
  patient: 'Jonathan',
  phone: '5202713253'
});

State.rememberProposedSlot(s, s.proposed_slot);
State.clearAvailability(s);
assert.equal(s.last_proposed_slot.start_time, '12:00');
console.log('✅ conserva último horario al limpiar disponibilidad');

const restored = State.restoreLastSlot(s);
assert.equal(restored.start_time, '12:00');
assert.equal(s.selected_slot.start_time, '12:00');
assert.equal(s.date, '2026-08-01');
console.log('✅ recupera “esa hora” después de una limpieza');

const nameCorrection = fallbackExtract(
  'La cita realmente es para Hannah Sofía, no para Jonathan.',
  { active:true, patient:'Jonathan', awaiting:'final_confirmation' }
);
assert.equal(nameCorrection.updates.patient, 'Hannah Sofía');
assert.ok(nameCorrection.correction_fields.includes('patient'));
assert.ok(!nameCorrection.correction_fields.includes('time'));
console.log('✅ cambio de nombre no se confunde con cambio de horario');

const repeated = fallbackExtract('Ya me dijiste eso', {
  active:true, awaiting:'slot_confirmation'
});
assert.equal(repeated.meta_intent, 'already_told');
console.log('✅ detecta queja por repetición sin rechazar horario');

const reference = fallbackExtract('Ok agéndame a esa hora', {
  active:true, awaiting:'slot_confirmation'
});
assert.equal(reference.meta_intent, 'reference_previous');
assert.equal(reference.confirmation, 'yes');
console.log('✅ entiende “agéndame a esa hora”');

console.log('\n5/5 pruebas pasaron.');

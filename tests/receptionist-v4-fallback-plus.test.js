
'use strict';
const assert = require('assert');
const { fallbackExtract, extractPatientName } = require('../backend/modules/receptionist-v4/intent-extractor');

const cases = [
  ['corrección nombre completa', () => {
    const x = fallbackExtract('La cita realmente es para Hannah Sofía, no para Jonathan.', {
      active: true, patient: 'Jonathan', awaiting: 'final_confirmation'
    });
    assert.equal(x.updates.patient, 'Hannah Sofía');
    assert.equal(x.confirmation, 'change');
    assert.ok(x.correction_fields.includes('patient'));
  }],
  ['nombre a nombre de', () => {
    assert.equal(extractPatientName('La cita es a nombre de Ana María.', {}), 'Ana María');
  }],
  ['nombre hija', () => {
    assert.equal(extractPatientName('Mi hija se llama Hannah Sofía.', {}), 'Hannah Sofía');
  }],
  ['nombre directo solicitado', () => {
    assert.equal(extractPatientName('Jonathan Valdez', {awaiting:'patient'}), 'Jonathan Valdez');
  }],
  ['otro horario más tarde', () => {
    const x = fallbackExtract('Ese horario no me funciona, dame otro un poco más tarde.', {
      active:true, awaiting:'slot_confirmation'
    });
    assert.equal(x.confirmation, 'no');
  }],
  ['cambio teléfono', () => {
    const x = fallbackExtract('Mejor cambia el teléfono al 6863112623.', {
      active:true, phone:'5202713253'
    });
    assert.equal(x.updates.phone, '6863112623');
    assert.equal(x.confirmation, 'change');
    assert.ok(x.correction_fields.includes('phone'));
  }],
];

let passed=0;
for (const [name, fn] of cases) {
  try {
    fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (error) {
    console.error(`❌ ${name}: ${error.message}`);
    process.exitCode=1;
  }
}
console.log(`\n${passed}/${cases.length} pruebas pasaron.`);

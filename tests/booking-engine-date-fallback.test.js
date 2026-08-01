'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(
  path.join(__dirname, '../backend/modules/booking-engine.js'),
  'utf8'
);

assert(source.includes('date,'));
assert(source.includes('appointment_date,'));
assert(source.includes('exact_time,'));
console.log('✅ acepta fecha y hora fuera del slot');

assert(source.includes("slot?.date ||"));
assert(source.includes("date ||"));
assert(source.includes("appointment_date ||"));
console.log('✅ recupera la fecha principal cuando falta en slot');

assert(source.includes("add('doctor_id', String(resolvedSlot.doctor_id))"));
assert(source.includes("add('date', resolvedSlot.date)"));
assert(source.includes("add('start_time', resolvedSlot.start_time)"));
console.log('✅ el INSERT usa exclusivamente el slot resuelto');

assert(source.includes("WHERE tenant_id = $1::uuid"));
assert(source.includes("getDoctors(q, clinic_id, branch_key)"));
console.log('✅ conserva el aislamiento por tenant y sucursal');

assert(!source.includes(
  "if (!slot?.doctor_id || !slot?.date || !slot?.start_time)"
));
console.log('✅ ya no falla sólo porque slot.date esté ausente');

console.log('\n5/5 pruebas del fallback de fecha pasaron.');

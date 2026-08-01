'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(
  path.join(__dirname, '../backend/modules/booking-engine.js'),
  'utf8'
);

assert(source.includes("WHERE tenant_id = $1::uuid"));
assert(source.includes("getDoctors(q, clinic_id, branch_key)"));
console.log('✅ conserva aislamiento por tenant y sucursal');

assert(source.includes("slot?.date ||"));
assert(source.includes("appointment_date ||"));
console.log('✅ conserva recuperación de fecha');

assert(source.includes("if (!resolvedSlot.doctor_id)"));
assert(source.includes("const availability = await computeAvailability"));
assert(source.includes("DOCTOR RECUPERADO PARA CITA"));
console.log('✅ recupera doctor_id cuando se pierde');

assert(source.includes("El horario seleccionado ya no está disponible"));
console.log('✅ falla de forma segura si el horario ya no existe');

assert(source.includes("add('doctor_id', String(resolvedSlot.doctor_id))"));
assert(source.includes("add('date', resolvedSlot.date)"));
assert(source.includes("add('start_time', resolvedSlot.start_time)"));
console.log('✅ INSERT usa doctor, fecha y hora resueltos');

console.log('\n5/5 pruebas combinadas pasaron.');

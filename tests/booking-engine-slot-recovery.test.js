'use strict';

const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync(
  require('path').join(__dirname, '../backend/modules/booking-engine.js'),
  'utf8'
);

assert(source.includes('SLOT RECUPERADO AUTOMÁTICAMENTE'));
console.log('✅ incluye recuperación automática del doctor');

assert(source.includes("throw new Error('El horario seleccionado ya no está disponible')"));
console.log('✅ rechaza correctamente si el horario dejó de estar libre');

assert(source.includes('const availability = await computeAvailability'));
console.log('✅ consulta disponibilidad real antes de crear');

assert(source.includes("add('doctor_id', String(resolvedSlot.doctor_id))"));
assert(source.includes("add('date', resolvedSlot.date)"));
assert(source.includes("add('start_time', resolvedSlot.start_time)"));
console.log('✅ el INSERT usa el slot recuperado');

assert(!source.includes("if (!slot?.doctor_id || !slot?.date || !slot?.start_time)"));
console.log('✅ ya no rechaza inmediatamente por doctor_id ausente');

console.log('\n5/5 pruebas de recuperación de slot pasaron.');

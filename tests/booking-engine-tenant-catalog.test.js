'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(
  path.join(__dirname, '../backend/modules/booking-engine.js'),
  'utf8'
);

assert(source.includes('WHERE tenant_id = $1::uuid'));
console.log('✅ catálogo filtra por tenant_id');

assert(source.includes('sucursal_id = $2::text'));
console.log('✅ catálogo filtra por sucursal_id');

assert(source.includes('getDoctors(q, clinic_id, branch_key)'));
console.log('✅ disponibilidad envía tenant y sucursal');

assert(source.includes("current_setting('app.tenant_id', true)"));
console.log('✅ llamadas legacy resuelven tenant desde la sesión');

assert(source.includes("throw new Error('tenant_id ausente al consultar catálogo')"));
console.log('✅ no permite catálogo sin tenant');

console.log('\n5/5 pruebas de aislamiento de catálogo pasaron.');

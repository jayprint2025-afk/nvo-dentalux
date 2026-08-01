'use strict';

const assert = require('assert');
process.env.RECEPTIONIST_V5_USE_AI = 'false';
process.env.CLINIC_TIMEZONE = 'America/Phoenix';

const {
  parseRelativeDate,
  parseTimePreference,
} = require('../backend/modules/receptionist-v5/turn-interpreter');
const Tools = require('../backend/modules/receptionist-v5/tool-registry');

const fixedNow = new Date('2026-08-01T06:00:00.000Z');

assert.equal(
  parseRelativeDate('agéndame el lunes', 'America/Phoenix', fixedNow),
  '2026-08-03'
);
console.log('✅ lunes se convierte al próximo lunes');

assert.deepEqual(
  parseTimePreference('después de las 11'),
  {
    kind: 'after',
    min: 660,
    value: '11:00',
    label: 'después de las 11:00',
  }
);
console.log('✅ después de las 11 genera preferencia horaria');

const state = {
  slots: {
    branch: { value: 'sucursal_2' },
    service: { value: { id: '9', name: 'Primera consulta' } },
    clinical_reason: { value: 'revisión de brackets' },
  },
};

const context = {
  branches: [
    { branch_key: 'sucursal_2', name: 'Condesa', address: 'Calle Babel #1300' },
  ],
  services: [
    { id: '9', name: 'Primera consulta' },
  ],
};

async function q(sql) {
  if (sql.includes('branch_promotions')) {
    const error = new Error('relation does not exist');
    error.code = '42P01';
    throw error;
  }
  if (sql.includes('information_schema.columns')) return { rows: [] };
  return { rows: [] };
}

(async () => {
  const answer = await Tools.answerQuestion(
    q,
    { tenant_id: '00000000-0000-0000-0000-000000000000' },
    state,
    { topic: 'promotion' },
    context
  );

  assert.equal(
    answer.answer,
    'No tengo promociones vigentes confirmadas para Condesa.'
  );
  console.log('✅ promoción sin datos responde claramente');

  console.log('\n3/3 pruebas de fecha, horario y promociones pasaron.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});

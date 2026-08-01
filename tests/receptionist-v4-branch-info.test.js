
'use strict';
const assert = require('assert');
const State = require('../backend/modules/receptionist-v4/state-manager');
const Tools = require('../backend/modules/receptionist-v4/tools');

const q = async (sql, params=[]) => {
  if (/FROM clinic_branches/i.test(sql)) {
    throw new Error('relation "clinic_branches" does not exist');
  }

  if (/FROM branches/i.test(sql)) {
    return {
      rows: [{
        clinic_name: params[0] === 'sucursal_1' ? 'Victoria' : 'Condesa',
        phone: '6863112623',
        whatsapp: '6863112623',
        address: params[0] === 'sucursal_1'
          ? 'Anillo Periférico 424 A, Victoria Residencial'
          : 'Calle Babel #1300, Residencial Condesa',
        business_hours: null
      }]
    };
  }

  if (/FROM clinic_channels/i.test(sql)) return { rows: [] };
  return { rows: [] };
};

(async () => {
  const state = State.initialState({
    active: true,
    branch_key: 'sucursal_2',
    selected_slot: { date:'2026-08-03', start_time:'12:00' },
    pending_information_requests: [{ type:'location' }],
    information_branch_key: 'sucursal_1'
  });

  const result = await Tools.answerInformation(
    q,
    { external_id:'114659410337690' },
    state,
    state.pending_information_requests,
    [],
    { branchKey:'sucursal_1' }
  );

  assert.equal(result.unresolved.length, 0);
  assert.match(result.answers[0], /Victoria/);
  assert.match(result.answers[0], /Anillo Periférico/);
  assert.equal(state.branch_key, 'sucursal_2');
  console.log('✅ responde ubicación de Victoria sin cambiar la cita de Condesa');

  const unresolved = await Tools.answerInformation(
    async () => ({ rows: [] }),
    { external_id:'114659410337690' },
    State.initialState({ active:true }),
    [{ type:'location' }],
    [],
    { branchKey:null }
  );

  assert.equal(unresolved.unresolved.length, 1);
  console.log('✅ pide sucursal sólo cuando realmente falta');

  console.log('\n2/2 pruebas pasaron.');
})();

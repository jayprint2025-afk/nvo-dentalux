'use strict';

process.env.RECEPTIONIST_V5_NATURAL_RESPONSES = 'false';

const assert = require('assert');
const { manageTurn } = require('../backend/modules/receptionist-v5/dialogue-manager');
const State = require('../backend/modules/receptionist-v5/dialogue-state');
const { fallbackInterpret } = require('../backend/modules/receptionist-v5/fallback-interpreter');

const q = async () => ({ rows: [] });
const ctx = {
  tenant_id: '0ec944b7-2385-4a0e-aec6-ba20d76ddcf7',
  clinic_id: '0ec944b7-2385-4a0e-aec6-ba20d76ddcf7',
  conversationId: 5,
};
const context = { branches: [], services: [] };

(async () => {
  const greetingState = State.initialState();
  const greetingTurn = fallbackInterpret('Hola', greetingState);
  const greeting = await manageTurn(q, ctx, greetingState, 'Hola', greetingTurn, context);

  assert.equal(typeof greeting, 'object');
  assert.equal(typeof greeting.reply, 'string');
  assert.ok(greeting.reply.length > 0);
  assert.equal(greeting.engine_version, 'v5');
  assert.equal(greeting.used, 'general_help');
  console.log('✅ saludo devuelve contrato V5 completo');

  const infoState = State.initialState();
  const infoText = '¿Dónde están y cuánto cuesta la consulta?';
  const infoTurn = fallbackInterpret(infoText, infoState);
  const info = await manageTurn(q, ctx, infoState, infoText, infoTurn, context);

  assert.equal(typeof info.reply, 'string');
  assert.ok(info.reply.length > 0);
  assert.equal(info.engine_version, 'v5');
  assert.equal(info.used, 'answer_information');
  console.log('✅ información incompleta también devuelve contrato V5');

  const cancelState = State.initialState({
    active_goals: [{ id: 'booking', type: 'booking', status: 'active' }],
  });
  const cancelTurn = fallbackInterpret('Cancelar', cancelState);
  const cancel = await manageTurn(q, ctx, cancelState, 'Cancelar', cancelTurn, context);

  assert.equal(typeof cancel.reply, 'string');
  assert.equal(cancel.engine_version, 'v5');
  assert.equal(cancel.used, 'cancel_all');
  console.log('✅ cancelación devuelve contrato V5 completo');

  console.log('\n3/3 pruebas de contrato V5 pasaron.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});

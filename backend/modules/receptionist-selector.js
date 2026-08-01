'use strict';
const v5 = require('./receptionist-v5');
async function orchestrate(q, ctx, state, text) {
  const out = await v5.orchestrate(q, ctx, state, text);
  if (!out || typeof out.reply !== 'string' || !out.state || typeof out.state !== 'object') {
    const error = new Error('La Recepcionista V5 libre devolvió una salida inválida');
    error.code = 'INVALID_FREE_AGENT_OUTPUT';
    throw error;
  }
  return { ...out, engine_version: 'v5' };
}
function selectedVersion(){ return 'v5'; }
module.exports={orchestrate,selectedVersion};

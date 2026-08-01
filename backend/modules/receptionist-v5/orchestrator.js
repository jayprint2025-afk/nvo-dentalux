'use strict';
const { loadClinicKnowledge } = require('./clinic-knowledge');
const { runAgent } = require('./free-conversation-agent');
async function orchestrate(q,ctx,state,text) {
  const knowledge=await loadClinicKnowledge(q,ctx);
  return runAgent(q,ctx,state,text,knowledge);
}
module.exports={orchestrate};

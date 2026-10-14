'use strict';
const { loadClinicKnowledge } = require('./clinic-knowledge');
const { runAgent } = require('./free-conversation-agent');
async function orchestrate(q,ctx,state,text) {
  let knowledge;
  try {knowledge=await loadClinicKnowledge(q,ctx);} catch(error) {
    console.error('V5 configuración no disponible:',error.code||error.name);
    const safeState=require('./conversation-memory').initialState(state);
    const reply='En este momento no puedo consultar la información de la clínica. No he creado ni modificado ninguna cita. Puedes intentar de nuevo o contactar a recepción.';
    require('./conversation-memory').recordTurn(safeState,text,reply,{used:'knowledge_unavailable'});
    return {reply,state:safeState,used:'knowledge_unavailable',engine_version:'v5'};
  }
  const mentionedBranch=require('./conversation-grounding').findBranch(text,knowledge.branches);
  const branchKey=mentionedBranch?.branch_key||state?.collected?.branch_key||ctx.branch_key;
  const branch=knowledge.branches.find(b=>b.branch_key===branchKey);
  if(branch?.ai_enabled===false){
    const safeState=require('./conversation-memory').initialState(state);
    const reply='La atención automática no está habilitada para esta sucursal. Por favor, contacta a recepción.';
    return {reply,state:safeState,used:'ai_disabled',engine_version:'v5'};
  }
  try{return await runAgent(q,ctx,state,text,knowledge);}catch(error){
    if(!['AMBIGUOUS_APPOINTMENT','SLOT_UNAVAILABLE'].includes(error.code))throw error;
    const safeState=require('./conversation-memory').initialState(state);
    safeState.collected.booking_mode=require('./conversation-grounding').appointmentActionIntent(text)||safeState.collected.booking_mode;
    if(error.code==='SLOT_UNAVAILABLE'){safeState.pending_booking=null;delete safeState.collected.selected_slot;delete safeState.collected.start_time;delete safeState.collected.exact_time;}
    require('./conversation-memory').recordTurn(safeState,text,error.message,{used:error.code==='SLOT_UNAVAILABLE'?'slot_conflict':'ambiguous_appointment'});
    return {reply:error.message,state:safeState,used:error.code==='SLOT_UNAVAILABLE'?'slot_conflict':'ambiguous_appointment',engine_version:'v5'};
  }
}
module.exports={orchestrate};

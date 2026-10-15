'use strict';
const M=require('./meter');
async function ingestStatuses(req,{resolveChannel,queryForTenant,secret}){
 if(!M.validSignature(req.rawBody,req.get('x-hub-signature-256'),secret))return {verified:false,processed:0};
 let processed=0;
 for(const entry of req.body?.entry||[])for(const change of entry.changes||[]){
  const v=change.value||{},id=v.metadata?.phone_number_id;
  if(!id||!Array.isArray(v.statuses))continue;
  const channel=await resolveChannel(id);
  if(!channel?.tenantId||channel.mode==='jarvis')continue;
  const q=queryForTenant(channel.tenantId);
  for(const status of v.statuses){await M.deliveredWhatsApp(q,{tenant_id:channel.tenantId},status);processed++;}
 }
 return {verified:true,processed};
}
module.exports={ingestStatuses};

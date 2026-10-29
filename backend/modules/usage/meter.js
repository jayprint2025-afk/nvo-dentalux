'use strict';
const {AsyncLocalStorage}=require('async_hooks');
const crypto=require('crypto');
const P=require('./pricing');
const context=new AsyncLocalStorage();
const losses=new Map();
const tenantOf=ctx=>String(ctx?.tenant_id||ctx?.tenantId||ctx?.clinic_id||'');
const safe=async(task)=>{try{return await task();}catch(error){console.error('[HANA/USAGE] medición incompleta:',error.message);return null;}};
async function measured(ctx,task){try{return await task();}catch(error){
 const key=tenantOf(ctx)+':'+P.periodAt();losses.set(key,(losses.get(key)||0)+1);
 console.error('[HANA/USAGE] consumo no guardado:',error.message);return null;
}}
function missingRecords(tenant,period){return losses.get(String(tenant)+':'+period)||0;}
function withContext(q,ctx,work){return context.run({q,ctx},work);}
async function planFor(q,tenant,period){
 const result=await q('SELECT * FROM hana_usage_plans WHERE tenant_id=$1::uuid AND period=$2',[tenant,period]);
 if(result.rows[0])return result.rows[0];
 const previous=await q('SELECT * FROM hana_usage_plans WHERE tenant_id=$1::uuid AND period<$2 ORDER BY period DESC LIMIT 1',[tenant,period]);
 const p=previous.rows[0]||{};
 await q(`INSERT INTO hana_usage_plans(tenant_id,period,included_mxn,monthly_rent_mxn,markup_pct,usd_mxn,rates,configured)
 VALUES($1::uuid,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT DO NOTHING`,[tenant,period,p.included_mxn||0,p.monthly_rent_mxn||0,p.markup_pct||0,p.usd_mxn||null,JSON.stringify(p.rates||{}),!!p.configured]);
 return (await q('SELECT * FROM hana_usage_plans WHERE tenant_id=$1::uuid AND period=$2',[tenant,period])).rows[0];
}
async function record(q,ctx,event){
 const tenant=tenantOf(ctx);if(!tenant)throw new Error('Consumo sin empresa: no se atribuye a otra');
 let when=event.at||new Date(),period=P.periodAt(when);
 // Un reporte tardío completa el mes original, con su plan y tipo de cambio.
 if(event.provider==='openai'&&event.key){
  const previous=(await q(`SELECT occurred_at,period FROM hana_usage_events WHERE tenant_id=$1::uuid AND event_key=$2
   AND provider='openai' AND status='usage_unavailable' AND cost_usd IS NULL AND cost_mxn IS NULL`,[tenant,event.key])).rows[0];
  if(previous){when=previous.occurred_at;period=previous.period;}
 }
 const plan=await planFor(q,tenant,period);
 const price=event.provider==='openai'?P.costForTokens(event.model,event.counters,plan.rates?.openai):null;
 const usd=price?.usd??event.usd??null;
 const mxn=event.mxn??(usd!=null&&plan.usd_mxn?usd*Number(plan.usd_mxn):null);
 await q(`INSERT INTO hana_usage_events(tenant_id,event_key,period,occurred_at,provider,channel,source,model,status,counters,cost_usd,cost_mxn,rating,metadata)
 VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::jsonb,$14::jsonb)
 ON CONFLICT(tenant_id,event_key) DO UPDATE SET
 model=EXCLUDED.model,status=EXCLUDED.status,counters=EXCLUDED.counters,cost_usd=EXCLUDED.cost_usd,
 cost_mxn=EXCLUDED.cost_mxn,rating=EXCLUDED.rating,metadata=hana_usage_events.metadata||EXCLUDED.metadata
 WHERE hana_usage_events.provider='openai' AND EXCLUDED.provider='openai'
 AND hana_usage_events.status='usage_unavailable' AND EXCLUDED.status='measured'
 AND hana_usage_events.cost_usd IS NULL AND hana_usage_events.cost_mxn IS NULL`,[tenant,event.key,period,when,event.provider,event.channel,event.source,event.model||null,event.status||'measured',JSON.stringify(event.counters||{}),usd,mxn,JSON.stringify({rates:price?.rates||null,usd_mxn:plan.usd_mxn||null,tariff_date:P.RATE_DATE}),JSON.stringify(event.metadata||{})]);
 return true;
}
async function recordOpenAI(q,ctx,payload,{channel='hana',source='text',key,kind='text',model}={}){
 const counters=P.tokens(payload.usage,kind);
 return measured(ctx,()=>record(q,ctx,{provider:'openai',channel,source,model:payload.model||model,
  key:'openai:'+String(key||payload.id||crypto.randomUUID()),counters,
  metadata:{usage_present:!!payload.usage},status:counters?'measured':'usage_unavailable'}));
}
async function recordContext(payload,model){
 const c=context.getStore();if(!c)return;
 const channel=['whatsapp','messenger','facebook','instagram'].includes(c.ctx.channel)?(c.ctx.channel==='facebook'?'messenger':c.ctx.channel):'assistant_web';
 return recordOpenAI(c.q,c.ctx,payload,{model,channel,source:'virtual_assistant'});
}
async function acceptedMessage(q,ctx,{id,channel,source='manual',category,market,phoneNumberId}){
 if(!id||!tenantOf(ctx))return;
 return measured(ctx,()=>record(q,ctx,{key:`${channel}:${id}`,provider:'meta',channel,source,status:'accepted',
  metadata:{category:category||null,market:market||null,phone_number_id:phoneNumberId||null}}));
}
function validSignature(raw,signature,secret){
 if(!secret||!Buffer.isBuffer(raw)||!/^sha256=[a-f0-9]{64}$/i.test(signature||''))return false;
 const expected='sha256='+crypto.createHmac('sha256',secret).update(raw).digest('hex');
 return crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(signature));
}
async function deliveredWhatsApp(q,ctx,status){
 return safe(async()=>{
  if(!['delivered','read','failed'].includes(status.status))return;
  const tenant=tenantOf(ctx),key='whatsapp:'+status.id;
  const row=(await q('SELECT * FROM hana_usage_events WHERE tenant_id=$1::uuid AND event_key=$2',[tenant,key])).rows[0];
  if(!row)return; // Solo IDs enviados por esta clínica. Nunca atribuir por nombre/teléfono.
  if(['delivered','read'].includes(row.status)&&row.cost_mxn!=null)return;
  if(['delivered','read'].includes(row.status)&&status.status==='failed')return;
  const timestamp=Number(status.timestamp)*1000;
  const deliveredAt=Number.isFinite(timestamp)&&timestamp>0?new Date(timestamp):row.occurred_at;
  const period=P.periodAt(deliveredAt);
  const pricing=status.pricing||{},plan=await planFor(q,tenant,period),meta=row.metadata||{};
  const category=String(pricing.category||meta.category||'').toLowerCase();
  const rate=plan.rates?.meta?.[`${meta.market}:${category}`];
  const knownFree=pricing.billable===false;
  const charged=pricing.billable===true && Number.isFinite(rate) && rate>=0;
  const failed=status.status==='failed';
  const mxn=failed||knownFree?0:(charged?rate:null);
  await q(`UPDATE hana_usage_events SET status=$3,cost_mxn=$4,rating=$5::jsonb,metadata=metadata||$6::jsonb,period=$7,occurred_at=$8
   WHERE tenant_id=$1::uuid AND event_key=$2 AND (status NOT IN ('delivered','read') OR cost_mxn IS NULL)`,[tenant,key,status.status,mxn,JSON.stringify({category,rate_mxn:charged?rate:null,pricing_model:pricing.pricing_model||null,billable:pricing.billable??null}),JSON.stringify({category,verified_delivery:!failed}),period,deliveredAt]);
 });
}
async function messengerRated(q,ctx,id){
 return safe(async()=>{
  const tenant=tenantOf(ctx),key='messenger:'+id;
  const row=(await q('SELECT * FROM hana_usage_events WHERE tenant_id=$1::uuid AND event_key=$2',[tenant,key])).rows[0];if(!row)return;
  const p=await planFor(q,tenant,row.period),rate=p.rates?.meta?.messenger;
  if(Number.isFinite(rate)&&rate>=0)await q('UPDATE hana_usage_events SET cost_mxn=$3,rating=$4::jsonb WHERE tenant_id=$1::uuid AND event_key=$2 AND cost_mxn IS NULL',[tenant,key,rate,JSON.stringify({configured_message_rate_mxn:rate})]);
 });
}
module.exports={withContext,recordContext,recordOpenAI,record,planFor,safe,acceptedMessage,deliveredWhatsApp,messengerRated,validSignature,tenantOf,missingRecords};

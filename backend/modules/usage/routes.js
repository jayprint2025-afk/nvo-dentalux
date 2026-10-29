'use strict';
const M=require('./meter'),P=require('./pricing');
function validatePlan(body){
 const out={};
 for(const field of ['included_mxn','monthly_rent_mxn','markup_pct','usd_mxn']){
  const n=Number(body[field]);
  if(body[field]==null||body[field]===''||!Number.isFinite(n)||n<0||n>1e9||(field==='usd_mxn'&&n<=0)||(field==='markup_pct'&&n>500))throw new Error('Valor inválido: '+field);
  out[field]=n;
 }
 out.rates={meta:{},openai:{}};
 for(const [key,rate] of Object.entries(body.rates?.meta||{})){
  if(!/^(messenger|[A-Z]{2}:(marketing|utility|authentication|service))$/.test(key)||!Number.isFinite(rate)||rate<0||rate>1000)throw new Error('Tarifa Meta inválida');
  out.rates.meta[key]=rate;
 }
 for(const [model,rates] of Object.entries(body.rates?.openai||{})){
  if(!/^[a-zA-Z0-9._-]{1,100}$/.test(model))throw new Error('Modelo inválido');
  out.rates.openai[model]={};
  for(const [kind,rate] of Object.entries(rates)){
   if(!/^(text|audio)_(input|cached|output)$/.test(kind)||!Number.isFinite(rate)||rate<0||rate>10000)throw new Error('Tarifa OpenAI inválida');
   out.rates.openai[model][kind]=rate;
  }
 }
 return out;
}
function pendingBreakdown(rows){
 const groups=new Map();
 for(const event of rows){
  if(event.cost_mxn!=null)continue;
  let reason='tariff_missing';
  if(event.provider==='openai'&&event.status==='usage_unavailable')reason='tokens_missing';
  else if(event.cost_usd!=null)reason='exchange_missing';
  else if(event.provider==='meta'&&event.channel==='whatsapp'&&!event.metadata?.verified_delivery)reason='delivery_pending';
  else if(event.provider==='meta'&&event.channel==='whatsapp'&&event.rating?.billable==null)reason='billing_pending';
  const key=JSON.stringify([event.channel,event.source,reason]),stamp=new Date(event.occurred_at).getTime();
  const group=groups.get(key)||{channel:event.channel,source:event.source,reason,count:0,first_at:null,last_at:null};group.count++;
  if(Number.isFinite(stamp)){
   const at=new Date(stamp).toISOString();if(!group.first_at||at<group.first_at)group.first_at=at;if(!group.last_at||at>group.last_at)group.last_at=at;
  }
  groups.set(key,group);
 }
 return [...groups.values()];
}
function setupUsageRoutes(app,q,{authRequired,getTenantId}){
 app.use('/api/usage',authRequired);
 app.use('/api/usage',(req,res,next)=>{res.set('Cache-Control','no-store');next();});
 // La selección de otra empresa solo se acepta con el rol firmado de superadministrador.
 const scope=async req=>{
  const requested=req.query.tenant_id;
  if(requested!==undefined&&req.auth?.role!=='superadmin')throw Object.assign(new Error('No puedes seleccionar otra empresa.'),{status:403});
  const tenant=String(requested===undefined?getTenantId(req):requested);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenant))throw Object.assign(new Error('Empresa inválida.'),{status:400});
  if(typeof q.forTenant!=='function')throw Object.assign(new Error('No está disponible el contexto seguro de empresa.'),{status:503});
  const query=q.forTenant(tenant);
  if(!(await query('SELECT id FROM public.tenants WHERE id=$1::uuid',[tenant])).rows.length)throw Object.assign(new Error('Empresa no encontrada.'),{status:404});
  return {tenant,query};
 };
 const period=req=>{const value=String(req.query.period||P.periodAt());if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(value))throw new Error('Mes inválido');return value;};
 app.get('/api/usage',async(req,res)=>{
  try{
   const {tenant,query}=await scope(req),month=period(req),plan=await M.planFor(query,tenant,month);
   const rows=(await query('SELECT * FROM hana_usage_events WHERE tenant_id=$1::uuid AND period=$2 ORDER BY occurred_at',[tenant,month])).rows;
   const sessions=(await query(`SELECT CASE WHEN status IN ('starting','connected','connected_after_gap') AND updated_at<NOW()-INTERVAL '90 seconds' THEN 'monitor_stale' ELSE status END AS status,
    COUNT(*)::integer AS count FROM hana_usage_sessions WHERE tenant_id=$1::uuid AND period=$2 GROUP BY 1`,[tenant,month])).rows;
   const first=(await query('SELECT MIN(occurred_at) AS since FROM hana_usage_events WHERE tenant_id=$1::uuid',[tenant])).rows[0]?.since||null;
   const summary=P.totals(rows,plan);
   const gaps=sessions.filter(s=>!['starting','connected','closed'].includes(s.status)).reduce((n,s)=>n+Number(s.count),0);
   const missing=M.missingRecords(tenant,month);
   const active=sessions.filter(s=>['starting','connected'].includes(s.status)).reduce((n,s)=>n+Number(s.count),0);
   res.json({ok:true,tenant_id:tenant,period:month,plan,summary:{...summary,complete:summary.complete&&gaps===0&&missing===0},sessions,coverage_gaps:gaps,missing_records:missing,measuring_since:first,
    measurement_version:'usage-monitor-v2',pending_details:pendingBreakdown(rows),active_sessions:active,
    can_configure:req.auth?.role==='superadmin',reference_rates:P.OPENAI_RATES,reference_date:P.RATE_DATE,
    notes:['Costo calculado con uso reportado por proveedores; no sustituye su factura.','Meta sin tarifa verificada o sin confirmación de entrega aparece pendiente.','No se reconstruye consumo anterior a la instalación.']});
  }catch(error){res.status(error.status||(error.code==='42P01'?503:400)).json({ok:false,error:error.code==='42P01'?'Falta ejecutar sql/001_usage.sql':error.message});}
 });
 app.put('/api/usage/plan',async(req,res)=>{
  if(req.auth?.role!=='superadmin')return res.status(403).json({ok:false,error:'Solo el administrador comercial puede modificar tarifas y el monto incluido.'});
  try{
   const {tenant,query}=await scope(req),month=period(req);
   if(month!==P.periodAt())return res.status(400).json({ok:false,error:'Solo puede editarse el mes actual.'});
   const p=validatePlan(req.body||{});
   await query(`INSERT INTO hana_usage_plans(tenant_id,period,included_mxn,monthly_rent_mxn,markup_pct,usd_mxn,rates,configured)
    VALUES($1::uuid,$2,$3,$4,$5,$6,$7::jsonb,TRUE) ON CONFLICT(tenant_id,period) DO UPDATE SET
    included_mxn=$3,monthly_rent_mxn=$4,markup_pct=$5,usd_mxn=$6,rates=$7::jsonb,configured=TRUE,updated_at=NOW()`,[tenant,month,p.included_mxn,p.monthly_rent_mxn,p.markup_pct,p.usd_mxn,JSON.stringify(p.rates)]);
   // Recupera conversión pendiente de tokens medidos; las conversiones ya registradas se conservan.
   await query(`UPDATE hana_usage_events SET cost_mxn=cost_usd*$3,rating=rating||$4::jsonb WHERE tenant_id=$1::uuid AND period=$2 AND cost_mxn IS NULL AND cost_usd IS NOT NULL`,[tenant,month,p.usd_mxn,JSON.stringify({usd_mxn:p.usd_mxn})]);
   const pending=(await query('SELECT * FROM hana_usage_events WHERE tenant_id=$1::uuid AND period=$2 AND cost_mxn IS NULL',[tenant,month])).rows;
   for(const event of pending){
    let mxn=null,rating=event.rating||{},usd=event.cost_usd;
    if(event.provider==='meta'&&event.channel==='whatsapp'&&event.metadata?.verified_delivery&&rating.billable===true){
     const rate=p.rates.meta[`${event.metadata.market}:${rating.category}`];
     if(Number.isFinite(rate)){mxn=rate;rating={...rating,rate_mxn:rate};}
    }else if(event.provider==='meta'&&event.channel==='messenger'&&Number.isFinite(p.rates.meta.messenger)){
     mxn=p.rates.meta.messenger;rating={configured_message_rate_mxn:mxn};
    }else if(event.provider==='openai'&&event.status==='measured'){
     const price=P.costForTokens(event.model,event.counters,p.rates.openai);
     if(price){usd=price.usd;mxn=usd*p.usd_mxn;rating={rates:price.rates,usd_mxn:p.usd_mxn};}
    }
    if(mxn!=null)await query('UPDATE hana_usage_events SET cost_mxn=$3,cost_usd=$4,rating=$5::jsonb WHERE tenant_id=$1::uuid AND id=$2 AND cost_mxn IS NULL',[tenant,event.id,mxn,usd,JSON.stringify(rating)]);
   }
   res.json({ok:true});
  }catch(error){res.status(error.status||400).json({ok:false,error:error.message});}
 });
}
module.exports={setupUsageRoutes,validatePlan,pendingBreakdown};

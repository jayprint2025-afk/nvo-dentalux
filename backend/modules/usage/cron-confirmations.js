'use strict';
const crypto=require('crypto');
async function cronAccess(req,res,next,env=process.env,discoverTenants){
 if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false,error:'Usa GET o POST'});
 const secret=String(env.WA_BROADCAST_SECRET||''),supplied=String(req.get('x-cron-secret')||req.query.secret||'');
 if(!secret)return res.status(503).json({ok:false,error:'Falta WA_BROADCAST_SECRET'});
 const a=crypto.createHash('sha256').update(secret).digest(),b=crypto.createHash('sha256').update(supplied).digest();
 if(!supplied||!crypto.timingSafeEqual(a,b))return res.status(401).json({ok:false,error:'Cron no autorizado'});
 let tenants=[...new Set(String(env.WA_CRON_TENANT_IDS||env.WA_CRON_TENANT_ID||'').split(',').map(x=>x.trim()).filter(Boolean))];
 if(discoverTenants){
  try{tenants=await discoverTenants();}catch(e){console.error('[HANA/CRON] descubrimiento:',e.code||'error');return res.status(503).json({ok:false,error:'No se pudieron consultar las empresas del cron'});}
  if(!Array.isArray(tenants))return res.status(503).json({ok:false,error:'Lista de empresas inválida'});
  tenants=[...new Set(tenants)];
  if(!tenants.length)return res.status(200).json({ok:true,sent:0,results:[]});
 }
 if(!tenants.length||tenants.some(x=>!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x)))return res.status(503).json({ok:false,error:'Configura WA_CRON_TENANT_ID o WA_CRON_TENANT_IDS con las empresas autorizadas'});
 req.cronAutoDiscovery=Boolean(discoverTenants);req.cronTenants=tenants;req.auth={tenantId:tenants[0],role:'cron',sub:'cron:confirmations'};next();
}
// Solo descubre identificadores; las consultas de pacientes y credenciales siguen
// ejecutándose con app.tenant_id y el canal propio de cada empresa.
async function discoverActiveTenants(pool){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.tenant_bypass','on',true)");
  const result=await client.query(`SELECT id FROM tenants
   WHERE status='active' AND COALESCE(whatsapp_enabled,TRUE) ORDER BY id`);
  await client.query('COMMIT');
  return result.rows.map(r=>String(r.id));
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
 finally{client.release();}
}
function localDay(now,timezone){
 const p=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const m=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${m.year}-${m.month}-${m.day}`;
}
function options(req,env,now){
 const raw=String(req.query.when||'today'),date=raw==='today'?localDay(now,env.WA_CRON_TIMEZONE||'America/Tijuana'):raw;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw Error('Fecha inválida');
 const branch=String(req.query.sucursal_id||env.SUCURSAL_ID_DEFAULT||'sucursal_1');
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(branch))throw Error('Sucursal inválida');
 const limit=Number(req.query.limit||500);if(!Number.isInteger(limit)||limit<1||limit>1000)throw Error('Límite inválido');
 if(req.query.use_template&&req.query.use_template!=='true')throw Error('El cron automático requiere plantilla aprobada');
 return {when:date,sucursal_id:branch,limit:String(limit),use_template:'true',...(req.query.template?{template:String(req.query.template)}:{})};
}
async function channelFor(q,tenant,branch){
 const {rows}=await q(`SELECT phone_number_id,external_id,config,metadata FROM clinic_channels
  WHERE tenant_id=$1::uuid AND channel='whatsapp' AND COALESCE(active,TRUE) AND COALESCE(is_active,TRUE)
   AND (COALESCE(NULLIF(branch_key,''),NULLIF(sucursal_id,''))=$2 OR COALESCE(NULLIF(branch_key,''),NULLIF(sucursal_id,'')) IS NULL)
   AND COALESCE(config->>'mode',metadata->>'mode','receptionist') NOT IN ('jarvis','sales','detalles') LIMIT 2`,[tenant,branch]);
 if(rows.length!==1)throw Error(rows.length?'Hay varios canales WhatsApp: asigna sucursal a cada uno':'Falta canal WhatsApp registrado para la empresa/sucursal');
 const r=rows[0],c=r.config||{},m=r.metadata||{};
 const phone=String(r.phone_number_id||c.phoneNumberId||c.phone_number_id||m.phoneNumberId||m.phone_number_id||r.external_id||'');
 const token=String(c.accessToken||c.access_token||m.accessToken||m.access_token||'');
 if(!phone||!token)throw Error('Faltan credenciales del canal WhatsApp de esta empresa');
 return {phone,token};
}
function createCronHandler({q,getStore,runWithStore,broadcast,env=process.env,now=()=>new Date()}){
 return async(req,res)=>{
  if(req.auth?.role!=='cron'||!req.cronTenants?.length)return res.status(401).json({ok:false,error:'Cron no autorizado'});
  let query;try{query=options(req,env,now());}catch(e){return res.status(400).json({ok:false,error:e.message});}
  const results=[];
  for(const tenant of req.cronTenants){
   const store={...getStore(),tenantId:tenant,usageSource:'cron_reminders',usageExcluded:false};
   await runWithStore(store,async()=>{
    let claimed=false;
    try{
     const state=(await q('SELECT status,COALESCE(whatsapp_enabled,TRUE) AS enabled FROM tenants WHERE id=$1::uuid',[tenant])).rows[0];
     if(!state||state.status!=='active'||!state.enabled){results.push({tenant_id:tenant,skipped:true,reason:'Empresa o WhatsApp inactivos'});return;}
     if(req.cronAutoDiscovery){
      const connected=await q(`SELECT 1 FROM clinic_channels WHERE tenant_id=$1::uuid AND channel='whatsapp' AND COALESCE(active,TRUE) AND COALESCE(is_active,TRUE) AND COALESCE(config->>'mode',metadata->>'mode','receptionist') NOT IN ('jarvis','sales','detalles') LIMIT 1`,[tenant]);
      if(!connected.rows.length){results.push({tenant_id:tenant,skipped:true,reason:'Sin canal WhatsApp activo'});return;}
     }
     const channel=await channelFor(q,tenant,query.sucursal_id);store.waPhoneNumberId=channel.phone;store.waAccessToken=channel.token;
     // Una ejecución por empresa/sucursal/día, incluso entre distintas instancias.
     const claim=await q(`INSERT INTO hana_whatsapp_cron_runs(tenant_id,branch_key,send_date,status)
      VALUES($1::uuid,$2,$3::date,'running') ON CONFLICT DO NOTHING RETURNING tenant_id`,[tenant,query.sucursal_id,query.when]);
     if(!claim.rows.length){results.push({tenant_id:tenant,skipped:true,reason:'Lote del día ya ejecutado o en proceso'});return;}
     claimed=true;let code=200,body;
     const capture={status(n){code=n;return this;},json(value){body=value;return this;}};
     await broadcast({query,headers:{'x-sucursal':query.sucursal_id},body:{},auth:{tenantId:tenant,role:'cron'},get:()=>undefined},capture);
     const ok=code<400&&body?.ok!==false&&!(body?.errors?.length);
     await q(`UPDATE hana_whatsapp_cron_runs SET status=$4,completed_at=NOW(),sent=$5 WHERE tenant_id=$1::uuid AND branch_key=$2 AND send_date=$3::date`,[tenant,query.sucursal_id,query.when,ok?'completed':'review_required',Number(body?.sent||0)]);
     // No exponer nombres/teléfonos de pacientes ni respuestas con datos sensibles.
     results.push({tenant_id:tenant,ok,sent:Number(body?.sent||0),targeted:Number(body?.targeted||0),status:code});
    }catch(e){
     if(claimed)await q(`UPDATE hana_whatsapp_cron_runs SET status='review_required' WHERE tenant_id=$1::uuid AND branch_key=$2 AND send_date=$3::date`,[tenant,query.sucursal_id,query.when]).catch(()=>{});
     console.error('[HANA/CRON] fallo:',e.code||e.message);
     results.push({tenant_id:tenant,ok:false,error:e.code==='42P01'?'Falta sql/002_whatsapp_cron.sql':e.message});
    }
   });
  }
  const ok=results.every(r=>r.ok!==false);
  return res.status(ok?200:502).json({ok,sent:results.reduce((n,r)=>n+(r.sent||0),0),results});
 };
}
module.exports={discoverActiveTenants,cronAccess,createCronHandler,channelFor,options};

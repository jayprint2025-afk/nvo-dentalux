'use strict';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
function validateProfile(p){
 const bad=()=>{throw Object.assign(Error('Perfil CAMPPlus inválido: revisa las muestras de voz.'),{statusCode:400});};
 if(!p||p.engineVersion!=='campplus-v44'||typeof p.enabled!=='boolean'||!Array.isArray(p.samples)||p.samples.length<1||p.samples.length>10)bad();
 const vector=v=>Array.isArray(v)&&v.length===192&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=10000)&&v.some(n=>n!==0);
 if(!vector(p.centroid))bad();
 const ids=new Set();const samples=p.samples.map(s=>{
  if(!s||typeof s.id!=='string'||!s.id||s.id.length>100||ids.has(s.id)||!vector(s.fingerprint?.values))bad();ids.add(s.id);
  const f=s.fingerprint;if(f.sampleRate!==16000||!Number.isFinite(f.durationMs)||f.durationMs<500||f.durationMs>30000)bad();
  return {id:s.id,createdAt:new Date(s.createdAt).toISOString(),fingerprint:{values:f.values,durationMs:f.durationMs,sampleRate:16000}};
 });
 if(typeof p.displayName!=='string'||!p.displayName.trim()||p.displayName.length>100)bad();
 return {engineVersion:'campplus-v44',displayName:p.displayName.trim(),enabled:p.enabled,createdAt:new Date(p.createdAt).toISOString(),samples,centroid:p.centroid,acceptanceThreshold:0.60};
}
function setupVoiceProfileSync(app,q){
 // /api/f1 already has authRequired. Never accept identity from URL/body.
 app.all('/api/f1/voice-profile',async(req,res)=>{
  const tenant=req.auth?.tenantId,user=req.auth?.sub;
  if(!uuid(tenant)||!uuid(user))return res.status(401).json({ok:false,error:'Inicia sesión para sincronizar tu perfil de voz.'});
  if(req.auth.role==='demo')return res.status(403).json({ok:false,error:'La cuenta demo no puede guardar perfiles biométricos.'});
  res.setHeader('Cache-Control','no-store');
  try{
   const ownQ=q.forTenant?q.forTenant(tenant):q;
   if(req.method==='GET'){
    const row=(await ownQ('SELECT profile,revision,updated_at FROM hana_voice_profiles WHERE tenant_id=$1::uuid AND user_id=$2::uuid',[tenant,user])).rows[0];
    return res.json({ok:true,profile:row?.profile||null,revision:row?.revision||0});
   }
   if(!['PUT','DELETE'].includes(req.method))return res.status(405).json({ok:false,error:'Método no permitido'});
   const expected=req.body?.revision;
   if(!Number.isSafeInteger(expected)||expected<0||expected>=2147483647)return res.status(400).json({ok:false,error:'Versión de perfil inválida.'});
   const profile=req.method==='DELETE'?null:validateProfile(req.body?.profile);
   if(profile)profile.updatedAt=new Date().toISOString();
   const rows=expected===0?(await ownQ(`INSERT INTO hana_voice_profiles(tenant_id,user_id,revision,profile) VALUES($1::uuid,$2::uuid,1,$3::jsonb) ON CONFLICT DO NOTHING RETURNING profile,revision`,[tenant,user,profile===null?null:JSON.stringify(profile)])).rows:
    (await ownQ(`UPDATE hana_voice_profiles SET profile=$3::jsonb,revision=revision+1,updated_at=NOW() WHERE tenant_id=$1::uuid AND user_id=$2::uuid AND revision=$4 RETURNING profile,revision`,[tenant,user,profile===null?null:JSON.stringify(profile),expected])).rows;
   if(!rows.length)return res.status(409).json({ok:false,error:'El perfil cambió en otro dispositivo. Vuelve a abrir el panel antes de guardar.'});
   return res.json({ok:true,profile:rows[0].profile,revision:rows[0].revision});
  }catch(e){return res.status(e.code==='42P01'?503:e.statusCode||400).json({ok:false,error:e.code==='42P01'?'Falta ejecutar sql/003_voice_profiles.sql':e.statusCode?e.message:'No se pudo sincronizar el perfil de voz.'});}
 });
}
module.exports={setupVoiceProfileSync,validateProfile};

'use strict';
const LEGACY_ID='00000000-0000-4000-8000-000000000001';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode});};
function validateProfile(p){
 const vector=v=>Array.isArray(v)&&v.length===192&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=10000)&&v.some(n=>n!==0);
 if(!p||!uuid(p.profileId)||p.engineVersion!=='campplus-v44'||typeof p.enabled!=='boolean'||!Array.isArray(p.samples)||p.samples.length>5)fail('Cada perfil debe contener entre 0 y 5 muestras CAMPPlus.');
 if(typeof p.displayName!=='string'||!p.displayName.trim()||p.displayName.length>100)fail('Escribe el nombre de esta persona.');
 const ids=new Set(),samples=p.samples.map(s=>{
  if(!s||typeof s.id!=='string'||!s.id||s.id.length>100||ids.has(s.id)||!vector(s.fingerprint?.values))fail('Muestra de voz inválida.');ids.add(s.id);
  const f=s.fingerprint;if(f.sampleRate!==16000||!Number.isFinite(f.durationMs)||f.durationMs<500||f.durationMs>30000)fail('Duración o formato de muestra inválidos.');
  return {id:s.id,createdAt:new Date(s.createdAt).toISOString(),fingerprint:{values:f.values,durationMs:f.durationMs,sampleRate:16000}};
 });
 if(samples.length&&!vector(p.centroid))fail('Centroide de voz inválido.');
 return {profileId:p.profileId,engineVersion:'campplus-v44',displayName:p.displayName.trim(),enabled:p.enabled,needsReview:false,createdAt:new Date(p.createdAt).toISOString(),updatedAt:new Date().toISOString(),samples,centroid:samples.length?p.centroid:[],acceptanceThreshold:0.60};
}
function collection(value){
 if(!value)return [];
 if(value.schemaVersion===2&&Array.isArray(value.profiles))return value.profiles;
 // No intentar separar automáticamente voces históricas que pudieron mezclarse.
 return [{...value,profileId:LEGACY_ID,needsReview:value.samples?.length!==5,enabled:value.samples?.length===5&&value.enabled===true}];
}
async function readVoiceProfiles(q,tenant,user){
 const ownQ=q.forTenant?q.forTenant(tenant):q;
 const row=(await ownQ('SELECT profile,revision FROM hana_voice_profiles WHERE tenant_id=$1::uuid AND user_id=$2::uuid',[tenant,user])).rows[0];
 return {profiles:collection(row?.profile),revision:row?.revision||0};
}
function setupVoiceProfileSync(app,q){
 app.all('/api/f1/voice-profile',async(req,res)=>{
  const tenant=req.auth?.tenantId,user=req.auth?.sub;
  if(!uuid(tenant)||!uuid(user))return res.status(401).json({ok:false,error:'Inicia sesión para sincronizar la voz.'});
  if(req.auth.role==='demo')return res.status(403).json({ok:false,error:'La cuenta demo no puede usar perfiles biométricos.'});
  res.setHeader('Cache-Control','no-store');
  try{
   const ownQ=q.forTenant?q.forTenant(tenant):q,current=await readVoiceProfiles(q,tenant,user);
   if(req.method==='GET')return res.json({ok:true,schemaVersion:2,...current});
   if(!['PUT','DELETE'].includes(req.method))return res.status(405).json({ok:false,error:'Método no permitido'});
   const expected=req.body?.revision;
   if(!Number.isSafeInteger(expected)||expected<0||expected>=2147483647)fail('Versión inválida.');
   if(expected!==current.revision)fail('Los perfiles cambiaron en otro dispositivo. Actualiza el panel antes de guardar.',409);
   let profiles=[...current.profiles];
   if(req.body?.importLegacy&&expected===0&&req.method==='PUT'){
    const p=req.body.importLegacy;if(p.engineVersion!=='campplus-v44'||!Array.isArray(p.samples)||p.samples.length>10||!p.samples.length)fail('Perfil anterior inválido.');
    // Validar todos los vectores históricos, sin habilitar un grupo con más de cinco.
    for(let i=0;i<p.samples.length;i+=5)validateProfile({...p,profileId:LEGACY_ID,samples:p.samples.slice(i,i+5)});
    const cleanSamples=p.samples.map(s=>({id:s.id,createdAt:s.createdAt,fingerprint:s.fingerprint}));
    if(new Set(cleanSamples.map(s=>s.id)).size!==cleanSamples.length)fail('Muestras anteriores duplicadas.');
    profiles=collection({engineVersion:'campplus-v44',displayName:p.displayName.trim(),enabled:p.enabled===true,createdAt:new Date(p.createdAt).toISOString(),updatedAt:new Date().toISOString(),samples:cleanSamples,centroid:p.centroid,acceptanceThreshold:0.60});
   }else if(req.method==='DELETE'){
    if(!uuid(req.body?.profileId))fail('Selecciona el perfil que deseas eliminar.');
    if(!profiles.some(p=>p.profileId===req.body.profileId))fail('Perfil no encontrado.',404);
    profiles=profiles.filter(p=>p.profileId!==req.body.profileId);
   }else{
    const next=validateProfile(req.body?.profile);
    if(profiles.some(p=>p.profileId!==next.profileId&&!p.needsReview&&p.displayName.trim().toLocaleLowerCase()===next.displayName.toLocaleLowerCase()))fail('Ya existe un perfil con ese nombre. Selecciónalo en la lista.');
    const existing=profiles.find(p=>p.profileId===next.profileId);
    if(existing)next.createdAt=existing.createdAt;
    profiles=profiles.filter(p=>p.profileId!==next.profileId);profiles.push(next);
    if(profiles.length>20)fail('Se permiten hasta 20 perfiles por cuenta.');
   }
   const serialized=JSON.stringify({schemaVersion:2,profiles});
   const rows=expected===0?(await ownQ(`INSERT INTO hana_voice_profiles(tenant_id,user_id,revision,profile) VALUES($1::uuid,$2::uuid,1,$3::jsonb) ON CONFLICT DO NOTHING RETURNING revision`,[tenant,user,serialized])).rows:
    (await ownQ(`UPDATE hana_voice_profiles SET profile=$3::jsonb,revision=revision+1,updated_at=NOW() WHERE tenant_id=$1::uuid AND user_id=$2::uuid AND revision=$4 RETURNING revision`,[tenant,user,serialized,expected])).rows;
   if(!rows.length)fail('Los perfiles cambiaron en otro dispositivo. Actualiza el panel.',409);
   res.json({ok:true,schemaVersion:2,profiles,revision:rows[0].revision});
  }catch(e){res.status(e.code==='42P01'?503:e.statusCode||400).json({ok:false,error:e.code==='42P01'?'Falta instalar la tabla de perfiles de voz.':e.statusCode?e.message:'No se pudieron sincronizar los perfiles.'});}
 });
}
module.exports={setupVoiceProfileSync,validateProfile,readVoiceProfiles,collection,LEGACY_ID};

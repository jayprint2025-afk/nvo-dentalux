import type {VoiceProfile,VoiceProfileScope} from './types';
export class VoiceProfileCloud {
 private revisions=new Map<string,number>();
 constructor(private apiBase:string){}
 private key(s:VoiceProfileScope){return `${s.tenantId}:${s.userId}`;}
 version(s:VoiceProfileScope){return this.revisions.get(this.key(s))??0;}
 private clean(p:VoiceProfile){return {profileId:p.profileId,engineVersion:p.engineVersion,displayName:p.displayName,enabled:p.enabled,createdAt:p.createdAt,samples:p.samples.map(s=>({id:s.id,createdAt:s.createdAt,fingerprint:s.fingerprint})),centroid:p.centroid};}
 private async request(scope:VoiceProfileScope,method='GET',body?:any):Promise<VoiceProfile[]>{
  const token=localStorage.getItem('dentalux_auth_token')||'';let identity:any;
  try{const part=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');identity=JSON.parse(atob(part));}catch{throw Error('Inicia sesión para cargar tus perfiles.');}
  if(identity.tenantId!==scope.tenantId||identity.sub!==scope.userId)throw Error('Cambió la cuenta o empresa. Abre de nuevo el panel de voz.');
  const controller=new AbortController(),timer=window.setTimeout(()=>controller.abort(),12000);
  try{
   const headers=new Headers();headers.set('Authorization','Bearer '+token);headers.set('Content-Type','application/json');
   const r=await fetch(this.apiBase.replace(/\/$/,'')+'/api/f1/voice-profile',{method,headers,signal:controller.signal,body:body?JSON.stringify(body):undefined});const data=await r.json();
   if(token!==(localStorage.getItem('dentalux_auth_token')||''))throw Error('La sesión cambió durante la sincronización.');
   if(!r.ok||!data.ok)throw Error(data.error||'No se pudieron sincronizar los perfiles.');
   if(data.schemaVersion!==2||!Array.isArray(data.profiles))throw Error('Actualiza el backend para usar perfiles separados.');
   if(!Number.isSafeInteger(data.revision)||data.revision<this.version(scope))throw Error('Llegó una versión antigua. Actualiza el panel.');
   const profiles=data.profiles.map((p:any)=>{
    if(!p.profileId||p.engineVersion!=='campplus-v44'||!Array.isArray(p.samples)||p.samples.length>10||!p.samples.every((s:any)=>s.fingerprint?.values?.length===192&&s.fingerprint.values.every(Number.isFinite)))throw Error('Perfil CAMPPlus incompatible.');
    return {...p,scope:{...scope,profileId:p.profileId},key:[scope.tenantId,scope.userId,scope.branchKey,p.profileId].join(':'),cloudRevision:data.revision,samples:p.samples.map((s:any)=>({...s,audio:new Blob([])}))};
   });this.revisions.set(this.key(scope),data.revision);return profiles;
  }catch(e:any){if(e.name==='AbortError')throw Error('La sincronización tardó demasiado. No se modificaron tus muestras.');throw e;}
  finally{window.clearTimeout(timer);}
 }
 get(s:VoiceProfileScope){return this.request(s);}
 put(p:VoiceProfile){return this.request(p.scope,'PUT',{revision:p.cloudRevision??this.version(p.scope),profile:this.clean(p)});}
 delete(s:VoiceProfileScope,revision:number){return this.request(s,'DELETE',{revision,profileId:s.profileId});}
 importLegacy(p:VoiceProfile){return this.request(p.scope,'PUT',{revision:0,importLegacy:this.clean(p)});}
}

import type {VoiceProfile,VoiceProfileScope} from './types';
export class VoiceProfileCloud {
 private revisions=new Map<string,number>();
 constructor(private apiBase:string){}
 private key(s:VoiceProfileScope){return `${s.tenantId}:${s.userId}`;}
 private async request(scope:VoiceProfileScope,method='GET',profile?:VoiceProfile):Promise<VoiceProfile|null>{
  const token=localStorage.getItem('dentalux_auth_token')||'';
  let identity:any;try{const part=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');identity=JSON.parse(atob(part));}catch{throw Error('Inicia sesión para cargar tu perfil de voz.');}
  if(identity.tenantId!==scope.tenantId||identity.sub!==scope.userId)throw Error('Cambió la cuenta o empresa. Abre de nuevo el panel de voz.');
  const controller=new AbortController(),timer=window.setTimeout(()=>controller.abort(),12000);
  try{
   const headers=new Headers();headers.set('Authorization','Bearer '+token);headers.set('Content-Type','application/json');
   const body=method==='GET'?undefined:JSON.stringify({revision:profile?.cloudRevision??this.revisions.get(this.key(scope))??0,...(profile?{profile:{engineVersion:profile.engineVersion,displayName:profile.displayName,enabled:profile.enabled,createdAt:profile.createdAt,samples:profile.samples.map(s=>({id:s.id,createdAt:s.createdAt,fingerprint:s.fingerprint})),centroid:profile.centroid,acceptanceThreshold:profile.acceptanceThreshold}}:{})});
   const r=await fetch(this.apiBase.replace(/\/$/,'')+'/api/f1/voice-profile',{method,headers,body,signal:controller.signal});const data=await r.json();
   if(token!==(localStorage.getItem('dentalux_auth_token')||''))throw Error('La sesión cambió durante la sincronización.');
   if(!r.ok||!data.ok)throw Error(data.error||'No se pudo sincronizar la voz.');
   if(!Number.isSafeInteger(data.revision)||data.revision<0)throw Error('Respuesta de perfil inválida.');
   if(data.revision<(this.revisions.get(this.key(scope))??0))throw Error('Llegó una versión antigua del perfil. Se conserva la versión más reciente.');
   this.revisions.set(this.key(scope),data.revision);
   if(!data.profile)return null;
   const p=data.profile;
   if(p.engineVersion!=='campplus-v44'||!Array.isArray(p.samples)||p.samples.length>10||!p.samples.every((s:any)=>Array.isArray(s.fingerprint?.values)&&s.fingerprint.values.length===192&&s.fingerprint.values.every(Number.isFinite)))throw Error('El perfil guardado no es compatible con CAMPPlus.');
   return {...p,cloudRevision:data.revision,scope,key:[scope.tenantId,scope.userId,scope.branchKey].join(':'),samples:p.samples.map((s:any)=>({...s,audio:new Blob([])}))};
  }catch(e:any){if(e.name==='AbortError')throw Error('La sincronización tardó demasiado. Revisa tu conexión; el perfil existente se conserva.');throw e;}
  finally{window.clearTimeout(timer);}
 }
 async get(scope:VoiceProfileScope){return this.request(scope);}
 version(scope:VoiceProfileScope){return this.revisions.get(this.key(scope));}
 async put(profile:VoiceProfile){return this.request(profile.scope,'PUT',profile);}
 async delete(scope:VoiceProfileScope){return this.request(scope,'DELETE');}
}

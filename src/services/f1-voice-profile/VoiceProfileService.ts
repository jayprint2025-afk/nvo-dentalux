import {VoiceProfileCloud} from './VoiceProfileCloud';
import {CampPlusSpeakerExtractor} from './CampPlusSpeakerExtractor';
import {VoiceProfileRecorder} from './VoiceProfileRecorder';
import {VoiceProfileStore,voiceProfileKey} from './VoiceProfileStore';
import type {VoiceProfile,VoiceProfileScope,VoiceProfileVerification} from './types';
const EMBEDDING_SIZE=192,REQUIRED_SAMPLES=5;
const OWNER_CENTROID_FLOOR=0.58,OWNER_CONSENSUS_FLOOR=0.54,OWNER_TOP3_FLOOR=0.56,OWNER_REQUIRED_MATCHES=2,DISPLAY_REQUIRED=0.60;
export class VoiceProfileService {
 private readonly store=new VoiceProfileStore();
 private readonly recorder=new VoiceProfileRecorder();
 private readonly extractor=new CampPlusSpeakerExtractor();
 private cloud:VoiceProfileCloud|null;
 private cache=new Map<string,VoiceProfile[]>();
 constructor(apiBase?:string){this.cloud=apiBase?new VoiceProfileCloud(apiBase):null;}
 private async remember(scope:VoiceProfileScope,profiles:VoiceProfile[],local:VoiceProfile[]=[]){
  profiles=profiles.map(p=>({...p,samples:p.samples.map(s=>({...s,audio:local.find(x=>x.profileId===p.profileId)?.samples.find(x=>x.id===s.id)?.audio||s.audio}))}));
  await this.store.putCollection(scope,profiles);this.cache.set(voiceProfileKey(scope),profiles);return profiles;
 }
 async list(scope:VoiceProfileScope):Promise<VoiceProfile[]>{
  const local=await this.store.getCollection(scope);
  if(!this.cloud){this.cache.set(voiceProfileKey(scope),local);return local;}
  let remote=await this.cloud.get(scope);
  if(!remote.length&&this.cloud.version(scope)===0&&local.length){remote=await this.cloud.importLegacy(local[0]);}
  return this.remember(scope,remote,local);
 }
 async load(scope:VoiceProfileScope,_options:any={}):Promise<VoiceProfile|null>{
  const profiles=await this.list(scope);return (scope.profileId?profiles.find(p=>p.profileId===scope.profileId):profiles[0])||null;
 }
 private async persist(p:VoiceProfile){
  const local=await this.store.getCollection(p.scope);
  const profiles=this.cloud?await this.cloud.put(p):[...local.filter(x=>x.profileId!==p.profileId),p];
  const saved=await this.remember(p.scope,profiles,[...local.filter(x=>x.profileId!==p.profileId),p]);
  const found=saved.find(x=>x.profileId===p.profileId);if(!found)throw Error('El servidor no confirmó el perfil.');return found;
 }
 async create(scope:VoiceProfileScope,displayName:string):Promise<VoiceProfile>{
  const profiles=await this.list(scope),name=displayName.trim();if(!name)throw Error('Escribe el nombre de la persona.');
  if(profiles.some(p=>!p.needsReview&&p.displayName.toLocaleLowerCase()===name.toLocaleLowerCase()))throw Error('Ese nombre ya existe. Selecciona su perfil.');
  const id=crypto.randomUUID(),now=new Date().toISOString();
  return this.persist({profileId:id,key:voiceProfileKey(scope)+':'+id,scope:{...scope,profileId:id},displayName:name,engineVersion:'campplus-v44',enabled:true,needsReview:false,samples:[],centroid:[],acceptanceThreshold:DISPLAY_REQUIRED,createdAt:now,updatedAt:now,cloudRevision:this.cloud?.version(scope)});
 }
 async addEnrollmentSample(scope:VoiceProfileScope,displayName:string,onRecordingStarted?:()=>void):Promise<VoiceProfile>{
  if(!scope.profileId)throw Error('Crea o selecciona un perfil antes de grabar.');
  const current=await this.load(scope);if(!current)throw Error('Perfil no encontrado.');
  if(current.needsReview)throw Error('Este perfil anterior requiere revisar o reemplazar sus muestras.');
  if(displayName.trim()!==current.displayName)throw Error('Cambiar el nombre no crea otra persona. Usa Nuevo perfil para registrarla.');
  if(current.samples.length>=5)throw Error('Este perfil ya tiene sus 5 muestras. Usa Reemplazar muestras para volver a registrarlo.');
  const blob=await this.recorder.record(3500,onRecordingStarted),fingerprint=await this.extractor.fromBlob(blob);
  if(current.samples.length&&Math.max(...current.samples.map(s=>this.extractor.similarity(fingerprint.values,s.fingerprint.values)))<OWNER_CONSENSUS_FLOOR)throw Error('La muestra no coincide con las anteriores de esta persona. No se guardó; vuelve a grabar o crea otro perfil.');
  const now=new Date().toISOString(),samples=[...current.samples,{id:crypto.randomUUID(),createdAt:now,fingerprint,audio:blob}];
  return this.persist({...current,samples,centroid:this.robustCentroid(samples.map(s=>s.fingerprint.values)),updatedAt:now});
 }
 async replaceSamples(profile:VoiceProfile){return this.persist({...profile,samples:[],centroid:[],needsReview:false,enabled:true,updatedAt:new Date().toISOString()});}
 async update(profile:VoiceProfile,patch:Partial<Pick<VoiceProfile,'displayName'|'enabled'|'acceptanceThreshold'>>){
  if(profile.needsReview)throw Error('Reemplaza las muestras del perfil anterior antes de habilitarlo.');
  return this.persist({...profile,...patch,displayName:String(patch.displayName??profile.displayName).trim(),acceptanceThreshold:DISPLAY_REQUIRED,updatedAt:new Date().toISOString()});
 }
 async remove(scope:VoiceProfileScope){
  if(!scope.profileId)throw Error('Selecciona el perfil que deseas eliminar.');
  const local=await this.store.getCollection(scope),selected=local.find(p=>p.profileId===scope.profileId);
  if(!selected)throw Error('Perfil no encontrado.');
  const profiles=this.cloud?await this.cloud.delete(scope,selected.cloudRevision??this.cloud.version(scope)):local.filter(p=>p.profileId!==scope.profileId);
  await this.remember(scope,profiles,local);
 }
 private isCompatible(p:VoiceProfile){return p.enabled&&!p.needsReview&&p.engineVersion==='campplus-v44'&&p.samples.length===5&&p.samples.every(s=>s.fingerprint.values.length===EMBEDDING_SIZE);}
 async test(scope:VoiceProfileScope):Promise<VoiceProfileVerification>{
  const p=await this.load(scope);if(!p||!this.isCompatible(p))throw Error('Selecciona un perfil activo con 5 muestras.');
  const fingerprint=await this.extractor.fromBlob(await this.recorder.record(3500));const d=this.verifyFingerprint(p,fingerprint.values);
  return {matched:d.accepted,similarity:d.similarity,requiredSimilarity:DISPLAY_REQUIRED};
 }
 async verifyWakeSamples(scope:VoiceProfileScope,samples:Float32Array,sampleRate:number):Promise<any>{
  const profiles=(this.cache.get(voiceProfileKey(scope))||await this.list(scope)).filter(p=>this.isCompatible(p));
  if(!profiles.length)return {accepted:false,similarity:0,requiredSimilarity:DISPLAY_REQUIRED,profileRequired:true};
  const fingerprint=await this.extractor.fromSamples(samples,sampleRate);
  const decisions=profiles.map(profile=>({profile,decision:this.verifyFingerprint(profile,fingerprint.values)}));
  const accepted=decisions.filter(x=>x.decision.accepted),best=[...decisions].sort((a,b)=>b.decision.similarity-a.decision.similarity)[0];
  if(accepted.length!==1)return {...best.decision,accepted:false,ambiguous:accepted.length>1,requiredSimilarity:DISPLAY_REQUIRED};
  const match=accepted[0];return {...match.decision,accepted:true,profileId:match.profile.profileId,displayName:match.profile.displayName,sampleCount:5,requiredSimilarity:DISPLAY_REQUIRED};
 }
  private verifyFingerprint(profile: VoiceProfile, candidate: number[]) {
    const vectors = profile.samples
      .map((sample) => sample.fingerprint.values)
      .filter((values) => values.length === EMBEDDING_SIZE);
    const centroid = this.robustCentroid(vectors);
    const centroidSimilarity = this.extractor.similarity(candidate, centroid);
    const sampleSimilarities = vectors
      .map((values) => this.extractor.similarity(candidate, values))
      .sort((a, b) => b - a);
    const top = sampleSimilarities.slice(0, Math.min(3, sampleSimilarities.length));
    const top3Mean = top.reduce((sum, value) => sum + value, 0) / Math.max(1, top.length);
    const matchingSamples = sampleSimilarities.filter((value) => value >= OWNER_CONSENSUS_FLOOR).length;
    const secondBest = sampleSimilarities[1] ?? 0;

    // Both conditions matter: global owner similarity + agreement with at least
    // two independent enrollment samples. This rejects a one-off TV/impostor hit.
    const accepted = centroidSimilarity >= OWNER_CENTROID_FLOOR &&
      top3Mean >= OWNER_TOP3_FLOOR &&
      secondBest >= OWNER_CONSENSUS_FLOOR &&
      matchingSamples >= OWNER_REQUIRED_MATCHES;

    // Human-facing score blends robust centroid and repeated-sample evidence.
    const similarity = 0.6 * centroidSimilarity + 0.4 * top3Mean;
    return {
      accepted,
      similarity,
      centroidSimilarity,
      top3Mean,
      matchingSamples,
      requiredMatches: OWNER_REQUIRED_MATCHES,
      sampleSimilarities,
    };
  }

  private robustCentroid(vectors: number[][]): number[] {
    const valid = vectors.filter((v) => v.length === EMBEDDING_SIZE);
    if (!valid.length) return [];
    if (valid.length <= REQUIRED_SAMPLES) return this.extractor.centroid(valid);

    // Rank each enrollment by how well it agrees with the other enrollments.
    // Keep the most coherent set; one accidental/noisy recording cannot drag the
    // owner centroid down for every future wake attempt.
    const ranked = valid.map((vector, index) => {
      const sims = valid
        .map((other, j) => j === index ? -1 : this.extractor.similarity(vector, other))
        .filter((v) => v >= 0)
        .sort((a, b) => b - a);
      const peers = sims.slice(0, Math.min(4, sims.length));
      const agreement = peers.reduce((sum, v) => sum + v, 0) / Math.max(1, peers.length);
      return { vector, agreement };
    }).sort((a, b) => b.agreement - a.agreement);

    const keep = ranked.slice(0, Math.max(REQUIRED_SAMPLES, Math.ceil(valid.length * 0.75)));
    return this.extractor.centroid(keep.map((entry) => entry.vector));
  }
}

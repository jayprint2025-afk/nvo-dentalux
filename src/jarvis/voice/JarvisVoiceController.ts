import {jarvisBase,jarvisToken} from '../lib/jarvisApi';

type Status='idle'|'connecting'|'listening'|'speaking'|'error';
type Callbacks={onStatus?:(s:Status)=>void;onTranscript?:(text:string,who:'user'|'jarvis')=>void;onError?:(e:Error)=>void};

export class JarvisVoiceController{
 private pc:RTCPeerConnection|null=null; private dc:RTCDataChannel|null=null; private stream:MediaStream|null=null;
 private remoteAudio:HTMLAudioElement|null=null; private fishAudio:HTMLAudioElement|null=null; private fishUrl:string|null=null; private ttsSeq=0;
 constructor(private cb:Callbacks={}){}
 async start(){
  if(this.pc) return; this.cb.onStatus?.('connecting');
  try{
   const token=jarvisToken(); if(!token) throw new Error('Sesión requerida');
   this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
   const pc=new RTCPeerConnection(); this.pc=pc; this.stream.getTracks().forEach(t=>pc.addTrack(t,this.stream!));
   // Conservamos el track remoto para que WebRTC negocie normalmente, pero lo silenciamos:
   // OpenAI sigue siendo cerebro Realtime; Fish Audio es la única voz audible.
   const remoteAudio=document.createElement('audio'); remoteAudio.autoplay=true; remoteAudio.muted=true; this.remoteAudio=remoteAudio;
   pc.ontrack=e=>{remoteAudio.srcObject=e.streams[0]};
   const dc=pc.createDataChannel('oai-events'); this.dc=dc; dc.onopen=()=>this.cb.onStatus?.('listening'); dc.onmessage=e=>this.handleEvent(e.data);
   const offer=await pc.createOffer(); await pc.setLocalDescription(offer);
   const r=await fetch(`${jarvisBase}/api/jarvis/realtime/call`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/sdp'},body:offer.sdp||''});
   if(!r.ok) throw new Error(`Realtime ${r.status}: ${await r.text()}`);
   await pc.setRemoteDescription({type:'answer',sdp:await r.text()});
  }catch(e:any){this.stop();this.cb.onStatus?.('error');this.cb.onError?.(e instanceof Error?e:new Error(String(e)));throw e;}
 }
 stop(){
  this.ttsSeq++; this.stopFishAudio(); this.dc?.close();this.pc?.close();this.stream?.getTracks().forEach(t=>t.stop());
  if(this.remoteAudio)this.remoteAudio.srcObject=null;this.dc=null;this.pc=null;this.stream=null;this.remoteAudio=null;this.cb.onStatus?.('idle');
 }
 private splitForSpeech(text:string,maxChars=420){
   const clean=String(text||'').replace(/\s+/g,' ').trim(); if(!clean)return [];
   const sentences=clean.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g)?.map(x=>x.trim()).filter(Boolean)||[clean];
   const chunks:string[]=[]; let current='';
   const push=()=>{if(current.trim()){chunks.push(current.trim());current='';}};
   for(const sentence of sentences){
    if(sentence.length<=maxChars){
     if(!current)current=sentence;
     else if((current+' '+sentence).length<=maxChars)current+=' '+sentence;
     else{push();current=sentence;}
     continue;
    }
    push();
    const words=sentence.split(/\s+/); let hard='';
    for(const word of words){
     if(hard&&(hard+' '+word).length>maxChars){chunks.push(hard);hard=word;}
     else hard=hard?hard+' '+word:word;
    }
    if(hard)chunks.push(hard);
   }
   push(); return chunks;
 }

 private async fetchFishChunk(text:string,seq:number,token:string){
   if(seq!==this.ttsSeq)return null;
   const r=await fetch(`${jarvisBase}/api/jarvis/tts`,{
    method:'POST',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({text})
   });
   if(!r.ok)throw new Error(`Fish TTS ${r.status}: ${await r.text()}`);
   if(seq!==this.ttsSeq)return null;
   const blob=await r.blob(); if(seq!==this.ttsSeq)return null;
   return URL.createObjectURL(blob);
 }

 private async playBufferedUrl(url:string,seq:number){
   if(seq!==this.ttsSeq){URL.revokeObjectURL(url);return false;}
   this.fishUrl=url;
   const audio=new Audio(url); this.fishAudio=audio;
   return await new Promise<boolean>((resolve,reject)=>{
    audio.onended=()=>{
     if(this.fishAudio===audio){this.fishAudio=null;this.fishUrl=null;}
     URL.revokeObjectURL(url);
     resolve(seq===this.ttsSeq);
    };
    audio.onerror=()=>{
     if(this.fishAudio===audio){this.fishAudio=null;this.fishUrl=null;}
     URL.revokeObjectURL(url);
     reject(new Error('Error reproduciendo Fish TTS'));
    };
    audio.play().catch(err=>{
     if(this.fishAudio===audio){this.fishAudio=null;this.fishUrl=null;}
     URL.revokeObjectURL(url);
     reject(err);
    });
   });
 }

 async speak(text:string){
   const chunks=this.splitForSpeech(text); if(!chunks.length)return;
   const seq=++this.ttsSeq; this.stopFishAudio(); this.cb.onStatus?.('speaking');
   const buffered=new Map<number,Promise<string|null>>();
   try{
    const token=jarvisToken(); if(!token)throw new Error('Sesión requerida');

    // Prebuffer: empieza a generar los primeros audios antes de reproducirlos.
    const ensure=(i:number)=>{
     if(i<chunks.length&&!buffered.has(i))buffered.set(i,this.fetchFishChunk(chunks[i],seq,token));
    };
    ensure(0); ensure(1); ensure(2);

    for(let i=0;i<chunks.length;i++){
     if(seq!==this.ttsSeq)return;
     ensure(i); ensure(i+1); ensure(i+2);
     const url=await buffered.get(i)!;
     buffered.delete(i);
     if(!url||seq!==this.ttsSeq){if(url)URL.revokeObjectURL(url);return;}
     const completed=await this.playBufferedUrl(url,seq);
     if(!completed||seq!==this.ttsSeq)return;
    }
    if(seq===this.ttsSeq)this.cb.onStatus?.('listening');
   }catch(err:any){
    if(seq===this.ttsSeq)this.cb.onStatus?.('listening');
    this.stopFishAudio();
    this.cb.onError?.(err instanceof Error?err:new Error(String(err)));
   }finally{
    // Revoca cualquier audio preparado que ya no vaya a reproducirse.
    for(const pending of buffered.values()){
     pending.then(url=>{if(url)URL.revokeObjectURL(url)}).catch(()=>{});
    }
    buffered.clear();
   }
 }
 private stopFishAudio(revoke=true){
  if(this.fishAudio){this.fishAudio.pause();this.fishAudio.src='';this.fishAudio=null;}
  if(revoke&&this.fishUrl){URL.revokeObjectURL(this.fishUrl);this.fishUrl=null;}
 }
 private send(event:any){if(this.dc?.readyState==='open')this.dc.send(JSON.stringify(event));}
 private async handleEvent(raw:string){
  let e:any; try{e=JSON.parse(raw)}catch{return}
  if(e.type==='input_audio_buffer.speech_started'){this.ttsSeq++;this.stopFishAudio();this.cb.onStatus?.('listening');}
  const userText=e.transcript||e.item?.content?.find?.((x:any)=>x.transcript)?.transcript;
  if((e.type||'').includes('input_audio_transcription')&&userText)this.cb.onTranscript?.(String(userText),'user');
  const outText=e.response?.output?.flatMap?.((x:any)=>x.content||[]).map?.((x:any)=>x.transcript||x.text||'').filter(Boolean).join(' ').trim();
  if(e.type==='response.done'){
   if(outText){this.cb.onTranscript?.(outText,'jarvis');await this.speak(outText)} else this.cb.onStatus?.('listening');
  }
  if(e.type==='response.function_call_arguments.done'){
   try{
    const token=jarvisToken(); const r=await fetch(`${jarvisBase}/api/jarvis/actions`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({name:e.name,arguments:e.arguments,call_id:e.call_id})});
    const result=await r.json();
    this.send({type:'conversation.item.create',item:{type:'function_call_output',call_id:e.call_id,output:JSON.stringify(result)}});
    this.send({type:'response.create'});
   }catch(err:any){this.cb.onError?.(err instanceof Error?err:new Error(String(err)));}
  }
 }
}

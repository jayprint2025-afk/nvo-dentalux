import {jarvisBase,jarvisToken} from '../lib/jarvisApi';

type Status='idle'|'connecting'|'listening'|'speaking'|'error';
type Callbacks={onStatus?:(s:Status)=>void;onTranscript?:(text:string,who:'user'|'jarvis')=>void;onError?:(e:Error)=>void};

export class JarvisVoiceController{
 private pc:RTCPeerConnection|null=null; private dc:RTCDataChannel|null=null; private stream:MediaStream|null=null; private audio:HTMLAudioElement|null=null;
 constructor(private cb:Callbacks={}){}
 async start(){
  if(this.pc) return; this.cb.onStatus?.('connecting');
  try{
   const token=jarvisToken(); if(!token) throw new Error('Sesión requerida');
   this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
   const pc=new RTCPeerConnection(); this.pc=pc; this.stream.getTracks().forEach(t=>pc.addTrack(t,this.stream!));
   const audio=document.createElement('audio'); audio.autoplay=true; this.audio=audio; pc.ontrack=e=>{audio.srcObject=e.streams[0]};
   const dc=pc.createDataChannel('oai-events'); this.dc=dc; dc.onopen=()=>this.cb.onStatus?.('listening'); dc.onmessage=e=>this.handleEvent(e.data);
   const offer=await pc.createOffer(); await pc.setLocalDescription(offer);
   const r=await fetch(`${jarvisBase}/api/jarvis/realtime/call`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/sdp'},body:offer.sdp||''});
   if(!r.ok) throw new Error(`Realtime ${r.status}: ${await r.text()}`);
   await pc.setRemoteDescription({type:'answer',sdp:await r.text()});
  }catch(e:any){this.stop();this.cb.onStatus?.('error');this.cb.onError?.(e instanceof Error?e:new Error(String(e)));throw e;}
 }
 stop(){this.dc?.close();this.pc?.close();this.stream?.getTracks().forEach(t=>t.stop());if(this.audio)this.audio.srcObject=null;this.dc=null;this.pc=null;this.stream=null;this.audio=null;this.cb.onStatus?.('idle');}
 private send(event:any){if(this.dc?.readyState==='open')this.dc.send(JSON.stringify(event));}
 private async handleEvent(raw:string){
  let e:any; try{e=JSON.parse(raw)}catch{return}
  if(e.type==='input_audio_buffer.speech_started')this.cb.onStatus?.('listening');
  if(e.type==='response.audio.delta'||e.type==='response.output_audio.delta')this.cb.onStatus?.('speaking');
  if(e.type==='response.done')this.cb.onStatus?.('listening');
  const userText=e.transcript||e.item?.content?.find?.((x:any)=>x.transcript)?.transcript;
  if((e.type||'').includes('input_audio_transcription')&&userText)this.cb.onTranscript?.(String(userText),'user');
  const outText=e.response?.output?.flatMap?.((x:any)=>x.content||[]).map?.((x:any)=>x.transcript||x.text||'').filter(Boolean).join(' ');
  if(e.type==='response.done'&&outText)this.cb.onTranscript?.(outText,'jarvis');
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

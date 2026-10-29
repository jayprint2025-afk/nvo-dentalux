export class VoiceProfileRecorder {
 private busy=false;
 async record(durationMs=3500,onStart?:()=>void):Promise<Blob>{
  if(this.busy)throw Error('Ya hay una grabación en curso.');
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw Error('Este navegador no permite grabar. Abre la app por HTTPS en Chrome o Safari actualizado.');
  this.busy=true;let stream:MediaStream|undefined,recorder:MediaRecorder|undefined,permissionTimer:number|undefined;
  try{
   let abandoned=false;
   const pending=navigator.mediaDevices.getUserMedia({audio:{channelCount:{ideal:1},echoCancellation:true,noiseSuppression:true,autoGainControl:true,sampleRate:{ideal:16000}}});
   const timeout=new Promise<never>((_,reject)=>{permissionTimer=window.setTimeout(()=>{abandoned=true;reject(Error('No se recibió permiso del micrófono. Revisa el permiso y vuelve a intentar.'));},30000);});
   // getUserMedia no es cancelable: liberar también un permiso concedido tarde.
   pending.then(s=>{if(abandoned)s.getTracks().forEach(t=>t.stop());},()=>{});
   stream=await Promise.race([pending,timeout]);window.clearTimeout(permissionTimer);
   const candidates=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4',''];
   for(const mime of candidates){
    if(mime&&typeof MediaRecorder.isTypeSupported==='function'&&!MediaRecorder.isTypeSupported(mime))continue;
    try{recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);break;}catch{/* probar formato nativo */}
   }
   if(!recorder)throw Error('El navegador no pudo iniciar un formato de grabación compatible.');
   const active=recorder,tracks=stream.getAudioTracks();
   const blob=await new Promise<Blob>((resolve,reject)=>{
    const chunks:BlobPart[]=[];let settled=false,stopTimer:number,watchdog:number;
    const finish=(error?:Error)=>{if(settled)return;settled=true;window.clearTimeout(stopTimer);window.clearTimeout(watchdog);document.removeEventListener('visibilitychange',hidden);tracks.forEach(t=>t.removeEventListener('ended',ended));if(error)reject(error);else resolve(new Blob(chunks,{type:active.mimeType||'audio/webm'}));};
    const ended=()=>finish(Error('El micrófono se desconectó. Cierra otras apps que lo estén usando y vuelve a intentar.'));
    const hidden=()=>{if(document.hidden)finish(Error('Se interrumpió la grabación al salir de la app. Mantén la pantalla abierta al grabar.'));};
    active.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    active.onerror=()=>finish(Error('El navegador interrumpió la grabación. Revisa el micrófono y vuelve a intentar.'));
    active.onstop=()=>finish();
    tracks.forEach(t=>t.addEventListener('ended',ended));document.addEventListener('visibilitychange',hidden);
    stopTimer=window.setTimeout(()=>{if(active.state==='recording')active.stop();},durationMs);
    watchdog=window.setTimeout(()=>finish(Error('La grabación no terminó. Vuelve a intentar con el micrófono disponible.')),durationMs+8000);
    try{active.start(250);onStart?.();}catch(e){finish(e instanceof Error?e:Error('No se pudo iniciar la grabación.'));}
   });
   if(blob.size<500)throw Error('La muestra quedó vacía. Di “Oye Hanna”, “Oye Jana” u “Oye Ana” con tu voz natural.');
   return blob;
  }catch(e:any){
   if(e.name==='NotAllowedError'||e.name==='SecurityError')throw Error('Permiso de micrófono bloqueado. Habilítalo en los permisos del sitio y vuelve a intentar.');
   if(e.name==='NotReadableError')throw Error('El micrófono está ocupado. Cierra otras grabaciones o llamadas y vuelve a intentar.');
   if(e.name==='NotFoundError')throw Error('No se encontró un micrófono disponible.');
   throw e;
  }finally{
   window.clearTimeout(permissionTimer);
   if(recorder&&recorder.state!=='inactive'){try{recorder.stop();}catch{}}
   stream?.getTracks().forEach(t=>t.stop());this.busy=false;
  }
 }
}

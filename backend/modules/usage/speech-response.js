'use strict';
// Conserva el MP3 y recoge solo el uso informado por el proveedor.
async function readSpeechResponse(response){
 if(!String(response.headers.get('content-type')||'').includes('text/event-stream')){
  return {buffer:Buffer.from(await response.arrayBuffer()),usage:undefined,contentType:response.headers.get('content-type')||'audio/mpeg'};
 }
 const audio=[];let size=0,usage,done=false,pending='',data=[];
 const decoder=new TextDecoder();
 const dispatch=()=>{
  if(!data.length)return;const payload=JSON.parse(data.join('\n'));data=[];
  if(payload.type==='error'||payload.error)throw Error('El proveedor reportó un error al generar el audio');
  if(payload.type==='speech.audio.delta'){
   if(done||typeof payload.audio!=='string'||!payload.audio.length||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.audio))throw Error('Fragmento de audio inválido');
   const chunk=Buffer.from(payload.audio,'base64');size+=chunk.length;if(size>32*1024*1024)throw Error('Audio demasiado grande');audio.push(chunk);
  }else if(payload.type==='speech.audio.done'){
   if(done)throw Error('Evento final de audio duplicado');done=true;usage=payload.usage;
  }
 };
 const lines=(final=false)=>{
  let idx;while((idx=pending.indexOf('\n'))>=0){const line=pending.slice(0,idx).replace(/\r$/,'');pending=pending.slice(idx+1);if(!line)dispatch();else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));}
  if(pending.length>2*1024*1024)throw Error('Evento de audio demasiado grande');
  if(final){if(pending.startsWith('data:'))data.push(pending.slice(5).replace(/^ /,''));dispatch();}
 };
 if(!response.body)throw Error('El proveedor no devolvió audio');
 for await(const chunk of response.body){pending+=decoder.decode(chunk,{stream:true});lines();}
 pending+=decoder.decode();lines(true);
 if(!done||!size)throw Error('Audio incompleto: falta evento final o contenido');
 return {buffer:Buffer.concat(audio),usage,contentType:'audio/mpeg'};
}
module.exports={readSpeechResponse};

'use strict';
const M=require('./meter'),P=require('./pricing');
const sockets=new Map();
const MONITOR_VERSION='usage-monitor-v2';
function attachRealtime({q,ctx,location,key,model,transcribeModel,WebSocketImpl}){
 const callId=String(location||'').match(/\/realtime\/calls\/(rtc_[A-Za-z0-9_-]+)(?:$|[?#])/)?.[1],tenant=M.tenantOf(ctx);
 if(!callId||!tenant){console.error('[HANA/USAGE] No se recibió un call_id medible');return null;}
 const unique=tenant+':'+callId;if(sockets.has(unique))return sockets.get(unique);
 const period=P.periodAt(),pendingResponses=new Set();
 let ws,attempt=0,ended=false,hadGap=false,released=false,everOpened=false,retryTimer,watchdog,heartbeat,readyTimer,resolveReady,queue=Promise.resolve();
 const ready=new Promise(resolve=>{resolveReady=resolve;});
 const settleReady=value=>{clearTimeout(readyTimer);if(resolveReady){released=true;resolveReady(value);resolveReady=null;}};
 // Solo se reintenta persistencia local. Nunca se vuelve a generar una respuesta facturable.
 const write=task=>{queue=queue.then(async()=>{
  for(let i=0;i<3;i++){try{return await task();}catch(error){if(i===2){hadGap=true;console.error('[HANA/USAGE] No se pudo persistir un evento del monitor:',error.code||'storage_error');}}}
 });return queue;};
 const statusQuery=status=>q(`INSERT INTO hana_usage_sessions(tenant_id,call_id,period,status) VALUES($1::uuid,$2,$3,$4)
 ON CONFLICT(tenant_id,call_id) DO UPDATE SET status=$4,updated_at=NOW()`,[tenant,callId,period,status]);
 const session=status=>write(()=>statusQuery(status==='closed'&&(hadGap||pendingResponses.size)?'coverage_incomplete':status));
 const cleanup=()=>{if(ended)return;ended=true;settleReady(false);clearTimeout(retryTimer);clearTimeout(watchdog);clearInterval(heartbeat);sockets.delete(unique);try{ws?.close();}catch{}};
 const close=()=>{if(ended)return;hadGap=true;session('coverage_incomplete');cleanup();};
 const persistUsage=async(payload,{source,kind,eventKey,fallbackModel})=>{
  const counters=P.tokens(payload.usage,kind);
  await M.record(q,ctx,{key:'openai:'+eventKey,provider:'openai',channel:'realtime',source,
   model:payload.model||fallbackModel,counters,status:counters?'measured':'usage_unavailable',
   metadata:{usage_present:!!payload.usage,monitor_version:MONITOR_VERSION}});
 };
 const handle=async event=>{
  if(event.type==='response.created'){
   if(event.response?.id)pendingResponses.add(event.response.id);
  }else if(event.type==='response.done'){
   const r=event.response||{},id=r.id||event.event_id;
   if(!id){hadGap=true;await statusQuery('coverage_incomplete');return;}
   await persistUsage(r,{source:'voice',kind:'realtime',fallbackModel:model,eventKey:callId+':response:'+id});
   if(r.id)pendingResponses.delete(r.id);
  }else if(event.type==='conversation.item.input_audio_transcription.completed'){
   const id=event.item_id||event.event_id;
   if(!id){hadGap=true;await statusQuery('coverage_incomplete');return;}
   await persistUsage({usage:event.usage},{source:'transcription',kind:'audio',fallbackModel:transcribeModel,eventKey:callId+':transcript:'+id+':'+String(event.content_index??0)});
  }else if(['session.expired','session.ended','session.closed'].includes(event.type)){
   // Los eventos anteriores ya están en la cola; persistirlos antes del cierre.
   await statusQuery(hadGap||pendingResponses.size?'coverage_incomplete':'closed');cleanup();
  }else if(event.type==='error'){
   // Un error de comando (p. ej. cancelar sin respuesta activa) no prueba pérdida del monitor.
   console.error('[HANA/USAGE] Evento de error del proveedor:',String(event.error?.code||'provider_error').slice(0,80));
  }
 };
 const connect=()=>{
  if(ended)return;attempt++;
  try{
   const WS=WebSocketImpl||require('ws');
   const socket=new WS('wss://api.openai.com/v1/realtime?call_id='+encodeURIComponent(callId),{headers:{Authorization:'Bearer '+key},handshakeTimeout:10000});ws=socket;
   socket.on('open',()=>{
    if(ended||socket!==ws)return;
    everOpened=true;settleReady(true);session(hadGap?'connected_after_gap':'connected');clearInterval(heartbeat);
    heartbeat=setInterval(()=>{if(!ended)session(hadGap?'connected_after_gap':'connected');},30000);heartbeat.unref?.();
   });
   socket.on('message',raw=>{
    if(ended||socket!==ws)return;
    try{const event=JSON.parse(String(raw));write(()=>handle(event));}
    catch{hadGap=true;session('coverage_incomplete');}
   });
   socket.on('error',()=>{if(ended||socket!==ws)return;if(released||everOpened)hadGap=true;session('monitor_error');});
   socket.on('close',code=>{
    if(ended||socket!==ws)return;clearInterval(heartbeat);
    if(code===1000){if(!everOpened)hadGap=true;session('closed');cleanup();return;}
    if(released||everOpened)hadGap=true;session('closed_or_gap');
    if(attempt<3){retryTimer=setTimeout(connect,attempt*1000);retryTimer.unref?.();}
    else{session('coverage_incomplete');cleanup();}
   });
  }catch{hadGap=true;session('coverage_incomplete');cleanup();}
 };
 // El endpoint existente espera ready antes de devolver el SDP: tolerar el handshake completo
 // evita liberar la llamada a los 2 s y perder el comienzo mientras conecta el monitor.
 const control={close,ready,drain:async()=>{let previous;do{previous=queue;await previous;}while(previous!==queue);},callId};
 sockets.set(unique,control);session('starting');connect();if(ended)return control;
 if(resolveReady){readyTimer=setTimeout(()=>{hadGap=true;session('coverage_incomplete');settleReady(false);},12000);readyTimer.unref?.();}
 // Este lease solo libera el monitor, no cuelga la llamada ni impone límite a la conversación.
 watchdog=setTimeout(close,24*60*60*1000);watchdog.unref?.();
 return control;
}
module.exports={attachRealtime,MONITOR_VERSION};

'use strict';
const M=require('./meter');
const sockets=new Map();
function attachRealtime({q,ctx,location,key,model,transcribeModel,WebSocketImpl}){
 const match=String(location||'').match(/\/realtime\/calls\/(rtc_[A-Za-z0-9_-]+)(?:$|[?#])/);
 const callId=match?.[1],tenant=M.tenantOf(ctx);if(!callId||!tenant){console.error('[HANA/USAGE] No se recibió un call_id medible');return null;}
 const unique=tenant+':'+callId;if(sockets.has(unique))return sockets.get(unique);
 let ws,attempt=0,ended=false,hadGap=false,retryTimer,watchdog,heartbeat,readyTimer,resolveReady,queue=Promise.resolve();
 const ready=new Promise(resolve=>{resolveReady=resolve;});
 const settleReady=value=>{clearTimeout(readyTimer);resolveReady?.(value);resolveReady=null;};
 const write=task=>{queue=queue.then(()=>M.safe(task));return queue;};
 const session=status=>write(()=>q(`INSERT INTO hana_usage_sessions(tenant_id,call_id,period,status) VALUES($1::uuid,$2,$3,$4)
 ON CONFLICT(tenant_id,call_id) DO UPDATE SET status=$4,updated_at=NOW()`,[tenant,callId,require('./pricing').periodAt(),hadGap&&status==='closed'?'coverage_incomplete':status]));
 const close=()=>{ended=true;settleReady(false);clearTimeout(retryTimer);clearTimeout(watchdog);clearInterval(heartbeat);ws?.close();sockets.delete(unique);};
 const handle=async event=>{
  if(event.type==='response.done'){
   const r=event.response||{};
   const recorded=await M.recordOpenAI(q,ctx,r,{channel:'realtime',source:'voice',model,kind:'realtime',key:callId+':response:'+String(r.id||event.event_id)});
   if(!recorded){hadGap=true;session('coverage_incomplete');}
  }else if(event.type==='conversation.item.input_audio_transcription.completed'){
   await M.recordOpenAI(q,ctx,{usage:event.usage,model:transcribeModel},{channel:'realtime',source:'transcription',kind:'audio',key:callId+':transcript:'+String(event.item_id||event.event_id)+':'+String(event.content_index??0)});
  }else if(event.type==='session.expired'||event.type==='session.ended'){
   session('closed');close();
  }else if(event.type==='error')session('monitor_error');
 };
 const connect=()=>{
  attempt++;
  try{
   const WS=WebSocketImpl||require('ws');
   ws=new WS('wss://api.openai.com/v1/realtime?call_id='+encodeURIComponent(callId),{headers:{Authorization:'Bearer '+key},handshakeTimeout:10000});
   ws.on('open',()=>{settleReady(true);session(hadGap?'connected_after_gap':'connected');clearInterval(heartbeat);heartbeat=setInterval(()=>session(hadGap?'connected_after_gap':'connected'),30000);heartbeat.unref?.();});
   ws.on('message',raw=>{try{const e=JSON.parse(String(raw));write(()=>handle(e));}catch{session('invalid_event');}});
   ws.on('error',()=>{settleReady(false);hadGap=true;session('monitor_error');});
   ws.on('close',code=>{clearInterval(heartbeat);if(ended)return;if(code===1000){session('closed');close();return;}hadGap=true;session('closed_or_gap');if(attempt<3)retryTimer=setTimeout(connect,attempt*1000);else{session('coverage_incomplete');close();}});
  }catch{session('coverage_incomplete');close();}
 };
 const control={close,ready,drain:()=>queue,callId};sockets.set(unique,control);session('starting');connect();
 if(ended)return control;
 // Intentar observar antes de devolver el SDP. Si tarda, no bloquear la voz:
 // declarar el posible hueco de inicio en vez de presentar un total definitivo.
 if(resolveReady){readyTimer=setTimeout(()=>{hadGap=true;session('coverage_incomplete');settleReady(false);},2000);readyTimer.unref?.();}
 // Solo lease del monitor; no limita ni cierra la conversación de voz.
 watchdog=setTimeout(()=>{session('coverage_incomplete');close();},24*60*60*1000);watchdog.unref?.();
 return control;
}
module.exports={attachRealtime};

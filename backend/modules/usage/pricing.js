'use strict';
// USD por millón. Modelos exactos: no aplicar tarifas de un modelo a otro.
const OPENAI_RATES={
 'gpt-realtime':{text_input:4,text_cached:0.40,text_output:16,audio_input:32,audio_cached:0.40,audio_output:64},
 'gpt-4.1-mini':{text_input:0.40,text_cached:0.10,text_output:1.60},
 'gpt-4o-mini-transcribe':{text_input:1.25,audio_input:1.25,text_output:5}
};
const RATE_DATE='2026-10-14';
OPENAI_RATES['gpt-4.1-mini-2025-04-14']=OPENAI_RATES['gpt-4.1-mini'];
OPENAI_RATES['gpt-4o-mini-transcribe-2025-03-20']=OPENAI_RATES['gpt-4o-mini-transcribe'];
OPENAI_RATES['gpt-4o-mini-transcribe-2025-12-15']=OPENAI_RATES['gpt-4o-mini-transcribe'];
function periodAt(date=new Date()) {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit'}).formatToParts(new Date(date));
 return `${parts.find(x=>x.type==='year').value}-${parts.find(x=>x.type==='month').value}`;
}
function number(value){return Number.isFinite(Number(value))&&Number(value)>=0?Number(value):0;}
function tokens(usage,kind='text'){
 if(!usage||usage.type==='duration')return null;
 const rawInput=usage.input_tokens??usage.prompt_tokens,rawOutput=usage.output_tokens??usage.completion_tokens;
 if(rawInput==null||rawOutput==null||!Number.isFinite(rawInput)||!Number.isFinite(rawOutput)||rawInput<0||rawOutput<0)return null;
 const input=usage.input_token_details||usage.prompt_tokens_details||{};
 const output=usage.output_token_details||{};
 const cached=input.cached_tokens_details||{};
 const totalInput=number(usage.input_tokens??usage.prompt_tokens);
 const totalOutput=number(usage.output_tokens??usage.completion_tokens);
 const audioInput=number(input.audio_tokens),audioOutput=number(output.audio_tokens);
 const textInput=number(input.text_tokens??(totalInput-audioInput));
 const textOutput=number(output.text_tokens??(totalOutput-audioOutput));
 const audioCached=number(cached.audio_tokens);
 const textCached=number(cached.text_tokens??(number(input.cached_tokens)-audioCached));
 if(kind!=='text' && (number(input.image_tokens)||number(output.image_tokens)||number(cached.image_tokens)))return null;
 if(audioCached>audioInput||textCached>textInput||textInput+audioInput!==totalInput||textOutput+audioOutput!==totalOutput)return null;
 return {text_input:textInput-textCached,text_cached:textCached,text_output:textOutput,audio_input:audioInput-audioCached,audio_cached:audioCached,audio_output:audioOutput};
}
function costForTokens(model,counters,overrides={}){
 const rates=overrides[model]||OPENAI_RATES[model];
 if(!rates||!counters)return null;
 let cost=0;
 for(const [kind,count] of Object.entries(counters)){
  if(count>0 && !Number.isFinite(rates[kind]))return null;
  cost+=count*(rates[kind]||0)/1e6;
 }
 return {usd:Number(cost.toFixed(12)),rates};
}
function totals(rows,plan){
 const groups={}; let cost=0,usd=0,pending=0,tokensCount=0;
 for(const r of rows){
  const g=groups[r.channel]||=( {channel:r.channel,cost_mxn:0,cost_usd:0,events:0,tokens:0,messages:0,delivered:0,pending:0,sources:{}} );
  const counters=typeof r.counters==='string'?JSON.parse(r.counters):r.counters||{};
  const n=Object.values(counters).reduce((sum,v)=>sum+number(v),0);
  g.events++;g.sources[r.source]=(g.sources[r.source]||0)+1;
  if(r.provider==='openai'){g.tokens+=n;tokensCount+=n;}else{g.messages++;if(['delivered','read'].includes(r.status))g.delivered++;}
  if(r.cost_usd!=null){usd+=Number(r.cost_usd);g.cost_usd+=Number(r.cost_usd);}
  if(r.cost_mxn!=null){cost+=Number(r.cost_mxn);g.cost_mxn+=Number(r.cost_mxn);}else{pending++;g.pending++;}
 }
 const configured=!!plan.configured,retail=cost*(1+number(plan.markup_pct)/100),included=number(plan.included_mxn);
 return {provider_cost_mxn:cost,provider_cost_usd:usd,retail_mxn:retail,included_mxn:included,
  extra_mxn:configured?Math.max(0,retail-included):null,remaining_mxn:configured?Math.max(0,included-retail):null,
  used_pct:configured?(included>0?retail/included*100:(retail>0?100:0)):null,
  exceeded:configured&&retail>included,pending_events:pending,tokens:tokensCount,groups:Object.values(groups),
  complete:configured&&pending===0,currency:'MXN'};
}
module.exports={OPENAI_RATES,RATE_DATE,periodAt,tokens,costForTokens,totals};

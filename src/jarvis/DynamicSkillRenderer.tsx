import React from 'react';
import { X, Zap, Search, Play, Pause, SkipBack, SkipForward, MapPin, ExternalLink, Image as ImageIcon } from 'lucide-react';

export type DynamicCard = { type?:string; title?:string; subtitle?:string; accent?:string; actionLabel?:string; fields?:any[]; components?:any[]; layout?:string; version?:number|string; output?:any };
const safeUrl=(v:any)=>{try{const u=new URL(String(v||''));return ['http:','https:'].includes(u.protocol)?u.toString():'';}catch{return ''}};
const get=(obj:any,path:any)=>String(path||'').split('.').filter(Boolean).reduce((a,k)=>a?.[k],obj);
const val=(x:any,result:any,inputs:any)=> x?.bind ? get({result,inputs},x.bind) : (x?.value ?? x?.text ?? x?.src ?? '');

function MapView({c,result,inputs}:{c:any,result:any;inputs:any}){
 const lat=Number(val({bind:c.lat_bind||c.latitude_bind},result,inputs) ?? c.lat ?? c.latitude);
 const lon=Number(val({bind:c.lon_bind||c.longitude_bind},result,inputs) ?? c.lon ?? c.longitude);
 const zoom=Math.max(2,Math.min(18,Number(c.zoom||13)));
 if(!Number.isFinite(lat)||!Number.isFinite(lon)) return <div className="jv-v3-placeholder"><MapPin/><b>Mapa listo</b><span>La habilidad debe devolver latitud y longitud para visualizarlo.</span></div>;
 const d=0.08*Math.pow(2,13-zoom); const bbox=[lon-d,lat-d,lon+d,lat+d].join('%2C');
 const src=`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lon}`;
 return <div className="jv-v3-map"><iframe title={c.title||'Mapa'} src={src} loading="lazy" referrerPolicy="no-referrer"/><small>© OpenStreetMap contributors</small></div>;
}
function Media({c,result,inputs}:{c:any;result:any;inputs:any}){
 const src=safeUrl(val(c,result,inputs)); if(!src)return <div className="jv-v3-placeholder"><ImageIcon/><span>Contenido multimedia pendiente del runtime.</span></div>;
 const type=String(c.type||'').toLowerCase();
 if(type.includes('audio')) return <audio className="jv-v3-media" src={src} controls preload="metadata"/>;
 if(type.includes('video')) return <video className="jv-v3-media" src={src} controls playsInline preload="metadata" poster={safeUrl(c.poster)}/>;
 return <img className="jv-v3-image" src={src} alt={c.alt||c.title||''}/>;
}
function Component({c,result,inputs,setInputs,onRun,running}:{c:any;result:any;inputs:any;setInputs:(v:any)=>void;onRun:()=>void;running:boolean}){
 const type=String(c?.type||'text').toLowerCase(); const key=String(c.name||c.key||'');
 if(['row','grid','stack','section','panel','group','tabs'].includes(type)) return <div className={`jv-v3-${type}`}>{c.title&&<h3>{c.title}</h3>}{(c.children||c.components||[]).map((x:any,i:number)=><Component key={x.id||i} c={x} result={result} inputs={inputs} setInputs={setInputs} onRun={onRun} running={running}/>)}</div>;
 if(['input','text-input','search','number','date','time','email','url','textarea','select','toggle','checkbox'].includes(type)){
   const value=inputs[key]??c.defaultValue??c.default??''; const update=(v:any)=>setInputs((p:any)=>({...p,[key]:v}));
   if(type==='textarea')return <label className="jv-v3-field"><span>{c.label||key}</span><textarea value={value} placeholder={c.placeholder||''} onChange={e=>update(e.target.value)}/></label>;
   if(type==='select')return <label className="jv-v3-field"><span>{c.label||key}</span><select value={value} onChange={e=>update(e.target.value)}>{(c.options||[]).map((o:any)=><option key={String(o.value??o)} value={o.value??o}>{o.label??o}</option>)}</select></label>;
   if(['toggle','checkbox'].includes(type))return <label className="jv-v3-check"><input type="checkbox" checked={Boolean(value)} onChange={e=>update(e.target.checked)}/><span>{c.label||key}</span></label>;
   return <label className="jv-v3-field"><span>{c.label||key}</span><div>{type==='search'&&<Search/>}<input type={type==='text-input'||type==='search'||type==='input'?'text':type} value={value} placeholder={c.placeholder||''} onChange={e=>update(e.target.value)}/></div></label>;
 }
 if(['button','action'].includes(type)) return <button type="button" className="jv-v3-action" disabled={running} onClick={onRun}><Zap/>{c.label||c.title||'Ejecutar'}</button>;
 if(type==='map')return <MapView c={c} result={result} inputs={inputs}/>;
 if(['audio','audio-player','video','video-player','image','gallery-image'].includes(type))return <Media c={c} result={result} inputs={inputs}/>;
 if(['metric','kpi'].includes(type))return <article className="jv-v3-metric"><small>{c.label||c.title}</small><strong>{String(val(c,result,inputs)??'—')}</strong><span>{c.unit||''}</span></article>;
 if(['progress','meter'].includes(type)){const n=Math.max(0,Math.min(100,Number(val(c,result,inputs)||0)));return <div className="jv-v3-progress"><span>{c.label||''}<b>{n}%</b></span><i><em style={{width:`${n}%`}}/></i></div>}
 if(['list','feed','playlist','timeline','cards'].includes(type)){const arr=get({result,inputs},c.bind)||c.items||[];return <div className={`jv-v3-${type}`}>{Array.isArray(arr)&&arr.map((it:any,i:number)=><article key={it?.id||i}>{it?.image&&<img src={safeUrl(it.image)} alt=""/>}<div><b>{it?.title||it?.name||it?.label||`Elemento ${i+1}`}</b><span>{it?.subtitle||it?.description||it?.text||''}</span></div></article>)}</div>}
 if(type==='table'){const arr=get({result,inputs},c.bind)||c.rows||[];const cols=c.columns||Object.keys(arr?.[0]||{}).slice(0,6);return <div className="jv-v3-table"><table><thead><tr>{cols.map((x:any)=><th key={String(x.key||x)}>{x.label||x.key||x}</th>)}</tr></thead><tbody>{arr.map((r:any,i:number)=><tr key={i}>{cols.map((x:any)=><td key={String(x.key||x)}>{String(r[x.key||x]??'')}</td>)}</tr>)}</tbody></table></div>}
 if(['link','external-link'].includes(type)){const href=safeUrl(val(c,result,inputs)||c.href);return href?<a className="jv-v3-link" href={href} target="_blank" rel="noopener noreferrer">{c.label||c.title||'Abrir'}<ExternalLink/></a>:null}
 if(['player-controls'].includes(type))return <div className="jv-v3-player-controls"><button><SkipBack/></button><button><Play/></button><button><Pause/></button><button><SkipForward/></button></div>;
 const text=val(c,result,inputs); return <div className={`jv-v3-text ${type}`}>{c.label&&<small>{c.label}</small>}<span>{typeof text==='object'?JSON.stringify(text):String(text||c.title||'')}</span></div>;
}

export default function DynamicSkillRenderer({skill,card,result,inputs,setInputs,running,error,onRun,onClose}:{skill:any;card:DynamicCard;result:any;inputs:any;setInputs:(v:any)=>void;running:boolean;error:string;onRun:()=>void;onClose:()=>void}){
 const legacy=(card.fields||[]).map((f:any)=>({type:f.kind==='textarea'?'textarea':f.kind==='select'?'select':'input',...f,key:f.name,name:f.name}));
 const components=(card.components&&card.components.length?card.components:[...legacy,{type:'button',label:card.actionLabel||'Ejecutar habilidad'}]);
 return <div className="jv-skill-card-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className={`jv-skill-runtime-card jv-v3-runtime ${card.accent||'skills'}`}><header><div><span className="jv-skill-runtime-icon"><Zap/></span><div><small>JARVIS · DYNAMIC UI ENGINE V3</small><h2>{card.title||skill.name}</h2></div></div><button onClick={onClose} aria-label="Cerrar"><X/></button></header><p className="jv-skill-runtime-purpose">{card.subtitle||skill.purpose}</p><div className={`jv-v3-layout ${card.layout||'stack'}`}>{components.map((c:any,i:number)=><Component key={c.id||i} c={c} result={result} inputs={inputs} setInputs={setInputs} onRun={onRun} running={running}/>)}</div>{error&&<div className="jv-skill-runtime-error">{error}</div>}{result&&!components.some((c:any)=>c.bind||['map','metric','kpi','list','feed','table','audio','audio-player','video','video-player'].includes(String(c.type).toLowerCase()))&&<div className="jv-skill-generic-result"><small>RESULTADO</small><pre>{typeof result==='string'?result:JSON.stringify(result,null,2)}</pre></div>}</section></div>;
}

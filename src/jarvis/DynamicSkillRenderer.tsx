import React from 'react';
import { X, Zap, Search, Play, Pause, SkipBack, SkipForward, MapPin, ExternalLink, Image as ImageIcon, Maximize2, Minimize2, Navigation, Volume2, VolumeX } from 'lucide-react';

export type DynamicCard = { type?:string; title?:string; subtitle?:string; accent?:string; actionLabel?:string; fields?:any[]; components?:any[]; layout?:string; version?:number|string; output?:any };
const safeUrl=(v:any)=>{try{const u=new URL(String(v||''));return ['http:','https:'].includes(u.protocol)?u.toString():'';}catch{return ''}};
const get=(obj:any,path:any)=>String(path||'').split('.').filter(Boolean).reduce((a,k)=>a?.[k],obj);
const val=(x:any,result:any,inputs:any)=> x?.bind ? get({result,inputs},x.bind) : (x?.value ?? x?.text ?? x?.src ?? '');

const rad=(n:number)=>n*Math.PI/180;
const distanceMeters=(a:{lat:number;lon:number},b:{lat:number;lon:number})=>{
 const R=6371000,dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);
 const x=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
 return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
};
const speak=(text:string)=>{
 if(!('speechSynthesis' in window)||!text)return;
 window.speechSynthesis.cancel();
 const u=new SpeechSynthesisUtterance(text);u.lang='es-MX';u.rate=.96;window.speechSynthesis.speak(u);
};
function instructionEs(step:any){
 const m=step?.maneuver||{},road=step?.name?` en ${step.name}`:'';
 const mod=String(m.modifier||'').toLowerCase();
 const dir=mod.includes('left')?'a la izquierda':mod.includes('right')?'a la derecha':mod.includes('uturn')?'en U':'';
 const type=String(m.type||'').toLowerCase();
 if(type==='depart')return `Inicia la ruta${road}`;
 if(type==='arrive')return 'Has llegado a tu destino';
 if(type==='roundabout'||type==='rotary')return `En la glorieta, continúa${road}`;
 if(type==='turn')return `Gira ${dir}${road}`.replace('Gira  ','Continúa ');
 if(type==='merge')return `Incorpórate ${dir}${road}`;
 if(type==='fork')return `Mantente ${dir}${road}`;
 return `${dir?'Continúa '+dir:'Continúa'}${road}`;
}
function MapView({c,result,inputs}:{c:any,result:any;inputs:any}){
 const lat=Number(val({bind:c.lat_bind||c.latitude_bind},result,inputs) ?? c.lat ?? c.latitude);
 const lon=Number(val({bind:c.lon_bind||c.longitude_bind},result,inputs) ?? c.lon ?? c.longitude);
 const zoom=Math.max(2,Math.min(18,Number(c.zoom||13)));
 const [nav,setNav]=React.useState<any>(null);
 const [navError,setNavError]=React.useState('');
 const [voice,setVoice]=React.useState(true);
 const watchRef=React.useRef<number|null>(null);
 React.useEffect(()=>()=>{if(watchRef.current!=null&&navigator.geolocation)navigator.geolocation.clearWatch(watchRef.current);window.speechSynthesis?.cancel?.();},[]);
 if(!Number.isFinite(lat)||!Number.isFinite(lon)) return <div className="jv-v3-placeholder"><MapPin/><b>Mapa listo</b><span>Busca un destino para visualizarlo.</span></div>;
 const d=0.08*Math.pow(2,13-zoom); const bbox=[lon-d,lat-d,lon+d,lat+d].join('%2C');
 const src=`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lon}`;
 const stopNav=()=>{if(watchRef.current!=null)navigator.geolocation.clearWatch(watchRef.current);watchRef.current=null;setNav(null);window.speechSynthesis?.cancel?.();};
 const startNav=()=>{
   setNavError('');
   if(!navigator.geolocation){setNavError('Este dispositivo no permite obtener la ubicación.');return;}
   navigator.geolocation.getCurrentPosition(async pos=>{
     try{
       const slat=pos.coords.latitude,slon=pos.coords.longitude;
       const url=`https://router.project-osrm.org/route/v1/driving/${slon},${slat};${lon},${lat}?steps=true&overview=false&geometries=geojson`;
       const r=await fetch(url);if(!r.ok)throw new Error(`Ruta ${r.status}`);
       const data=await r.json(),route=data?.routes?.[0];
       if(!route)throw new Error('No encontré una ruta manejable.');
       const steps=(route.legs||[]).flatMap((l:any)=>l.steps||[]);
       const first=instructionEs(steps[0]);
       setNav({distance:route.distance,duration:route.duration,steps,current:0,instruction:first});
       if(voice)speak(first);
       watchRef.current=navigator.geolocation.watchPosition(p=>{
         const here={lat:p.coords.latitude,lon:p.coords.longitude};
         let best=0,bestD=Infinity;
         steps.forEach((s:any,i:number)=>{const loc=s?.maneuver?.location;if(Array.isArray(loc)){const dm=distanceMeters(here,{lat:Number(loc[1]),lon:Number(loc[0])});if(dm<bestD){bestD=dm;best=i;}}});
         const next=Math.min(best+(bestD<45?1:0),Math.max(steps.length-1,0));
         setNav((old:any)=>{
           if(!old)return old;
           if(next!==old.current){const ins=instructionEs(steps[next]);if(voice)speak(ins);return {...old,current:next,instruction:ins};}
           return old;
         });
       },()=>{}, {enableHighAccuracy:true,maximumAge:3000,timeout:12000});
     }catch(e:any){setNavError(e?.message||'No pude calcular la ruta.');}
   },e=>setNavError(e.code===1?'Permite el acceso a tu ubicación para iniciar la navegación.':'No pude obtener tu ubicación.'),{enableHighAccuracy:true,timeout:12000});
 };
 return <div className="jv-v3-map-shell">
   <div className="jv-v3-map"><iframe title={c.title||'Mapa'} src={src} loading="lazy" referrerPolicy="no-referrer"/><small>© OpenStreetMap contributors</small></div>
   <div className="jv-nav-actions">
     {!nav?<button type="button" onClick={startNav}><Navigation/>Cómo llegar desde mi ubicación</button>:<>
       <button type="button" onClick={()=>{setVoice(v=>{if(v)window.speechSynthesis?.cancel?.();else if(nav?.instruction)speak(nav.instruction);return !v;});}}>{voice?<Volume2/>:<VolumeX/>}{voice?'Voz activada':'Voz desactivada'}</button>
       <button type="button" onClick={stopNav}><X/>Terminar ruta</button>
     </>}
   </div>
   {nav&&<div className="jv-nav-panel"><div><Navigation/><strong>{nav.instruction}</strong></div><span>{(nav.distance/1609.344).toFixed(1)} mi · {Math.max(1,Math.round(nav.duration/60))} min aprox.</span><small>La guía usa tu GPS mientras esta pantalla permanezca abierta.</small></div>}
   {navError&&<div className="jv-skill-runtime-error">{navError}</div>}
 </div>;
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
 if(['list','feed','playlist','timeline','cards'].includes(type)){const arr=get({result,inputs},c.bind)||c.items||[];return <div className={`jv-v3-${type}`}>{Array.isArray(arr)&&arr.map((it:any,i:number)=><article key={it?.id||i}>{it?.image&&<img src={safeUrl(it.image)} alt=""/>}<div><b>{it?.title||it?.name||it?.label||`Elemento ${i+1}`}</b><span>{it?.subtitle||it?.description||it?.display_name||it?.text||''}</span></div></article>)}</div>}
 if(type==='table'){const arr=get({result,inputs},c.bind)||c.rows||[];const cols=c.columns||Object.keys(arr?.[0]||{}).slice(0,6);return <div className="jv-v3-table"><table><thead><tr>{cols.map((x:any)=><th key={String(x.key||x)}>{x.label||x.key||x}</th>)}</tr></thead><tbody>{arr.map((r:any,i:number)=><tr key={i}>{cols.map((x:any)=><td key={String(x.key||x)}>{String(r[x.key||x]??'')}</td>)}</tr>)}</tbody></table></div>}
 if(['link','external-link'].includes(type)){const href=safeUrl(val(c,result,inputs)||c.href);return href?<a className="jv-v3-link" href={href} target="_blank" rel="noopener noreferrer">{c.label||c.title||'Abrir'}<ExternalLink/></a>:null}
 if(['player-controls'].includes(type))return <div className="jv-v3-player-controls"><button><SkipBack/></button><button><Play/></button><button><Pause/></button><button><SkipForward/></button></div>;
 const text=val(c,result,inputs); return <div className={`jv-v3-text ${type}`}>{c.label&&<small>{c.label}</small>}<span>{typeof text==='object'?JSON.stringify(text):String(text||c.title||'')}</span></div>;
}

export default function DynamicSkillRenderer({skill,card,result,inputs,setInputs,running,error,onRun,onClose}:{skill:any;card:DynamicCard;result:any;inputs:any;setInputs:(v:any)=>void;running:boolean;error:string;onRun:()=>void;onClose:()=>void}){
 const [fullscreen,setFullscreen]=React.useState(false);
 const legacy=(card.fields||[]).map((f:any)=>({type:f.kind==='textarea'?'textarea':f.kind==='select'?'select':'input',...f,key:f.name,name:f.name}));
 const components=(card.components&&card.components.length?card.components:[...legacy,{type:'button',label:card.actionLabel||'Ejecutar habilidad'}]);
 React.useEffect(()=>{const fn=(e:KeyboardEvent)=>{if(e.key==='Escape'){if(fullscreen)setFullscreen(false);else onClose();}};window.addEventListener('keydown',fn);return()=>window.removeEventListener('keydown',fn)},[fullscreen,onClose]);
 const appType=String(card.runtime_type||card.type||'skill').toLowerCase();
 const appClass=fullscreen?`jv-runtime-app jv-runtime-app-${appType}`:'';
 return <div className={`jv-skill-card-backdrop ${fullscreen?'is-fullscreen':''}`} onPointerDown={e=>{if(!fullscreen&&e.target===e.currentTarget)onClose();}}>
   <section className={`jv-skill-runtime-card jv-v3-runtime ${card.accent||'skills'} ${fullscreen?'jv-runtime-fullscreen':''} ${appClass}`}>
    <header className="jv-runtime-appbar">
      <div><span className="jv-skill-runtime-icon"><Zap/></span><div><small>{fullscreen?'JARVIS · APP MODE':'JARVIS · DYNAMIC UI ENGINE V3'}</small><h2>{card.title||skill.name}</h2></div></div>
      <nav className="jv-runtime-window-actions">
       <button onClick={()=>setFullscreen(v=>!v)} aria-label={fullscreen?'Restaurar':'Pantalla completa'} title={fullscreen?'Restaurar':'Pantalla completa'}>{fullscreen?<Minimize2/>:<Maximize2/>}</button>
       <button onClick={onClose} aria-label="Cerrar" title="Cerrar"><X/></button>
      </nav>
    </header>
    {!fullscreen&&<p className="jv-skill-runtime-purpose">{card.subtitle||skill.purpose}</p>}
    <main className={`jv-runtime-appbody ${appType==='places'?'jv-runtime-places-body':''}`}>
      <div className={`jv-v3-layout ${card.layout||'stack'}`}>{components.map((c:any,i:number)=><Component key={c.id||i} c={c} result={result} inputs={inputs} setInputs={setInputs} onRun={onRun} running={running}/>)}</div>
      {error&&<div className="jv-skill-runtime-error">{error}</div>}
      {result&&!components.some((c:any)=>c.bind||['map','metric','kpi','list','feed','table','audio','audio-player','video','video-player'].includes(String(c.type).toLowerCase()))&&<div className="jv-skill-generic-result"><small>RESULTADO</small><pre>{typeof result==='string'?result:JSON.stringify(result,null,2)}</pre></div>}
    </main>
   </section>
 </div>;
}

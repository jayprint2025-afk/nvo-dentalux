import React from 'react';
import { X, Zap, Search, Play, Pause, SkipBack, SkipForward, MapPin, ExternalLink, Image as ImageIcon, Maximize2, Minimize2, Navigation, Volume2, VolumeX, Crosshair } from 'lucide-react';

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
declare global { interface Window { L?: any; } }

let leafletPromise:Promise<any>|null=null;
function loadLeaflet(){
 if(window.L)return Promise.resolve(window.L);
 if(leafletPromise)return leafletPromise;
 leafletPromise=new Promise((resolve,reject)=>{
   if(!document.querySelector('link[data-jv-leaflet]')){
     const css=document.createElement('link');css.rel='stylesheet';css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';css.setAttribute('data-jv-leaflet','1');document.head.appendChild(css);
   }
   const existing=document.querySelector('script[data-jv-leaflet]') as HTMLScriptElement|null;
   if(existing){existing.addEventListener('load',()=>resolve(window.L));existing.addEventListener('error',reject);return;}
   const js=document.createElement('script');js.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';js.async=true;js.setAttribute('data-jv-leaflet','1');
   js.onload=()=>resolve(window.L);js.onerror=()=>reject(new Error('No pude cargar el motor del mapa.'));
   document.head.appendChild(js);
 });
 return leafletPromise;
}
function MapView({c,result,inputs}:{c:any,result:any;inputs:any}){
 const lat=Number(val({bind:c.lat_bind||c.latitude_bind},result,inputs) ?? c.lat ?? c.latitude);
 const lon=Number(val({bind:c.lon_bind||c.longitude_bind},result,inputs) ?? c.lon ?? c.longitude);
 const zoom=Math.max(2,Math.min(18,Number(c.zoom||13)));
 const [nav,setNav]=React.useState<any>(null);
 const [navError,setNavError]=React.useState('');
 const [voice,setVoice]=React.useState(true);
 const [mapReady,setMapReady]=React.useState(false);
 const mapEl=React.useRef<HTMLDivElement|null>(null);
 const mapRef=React.useRef<any>(null);
 const routeRef=React.useRef<any>(null);
 const userRef=React.useRef<any>(null);
 const destRef=React.useRef<any>(null);
 const watchRef=React.useRef<number|null>(null);
 const lastSpokenRef=React.useRef(-1);
 const latestPosRef=React.useRef<{lat:number;lon:number;heading?:number|null}|null>(null);
 const followingRef=React.useRef(true);

 const makeArrow=(heading=0)=>{
   const L=window.L;if(!L)return undefined;
   return L.divIcon({className:'jv-nav-arrow-wrap',html:`<div class="jv-nav-arrow" style="transform:rotate(${Number.isFinite(heading)?heading:0}deg)"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 3 L54 57 L32 46 L10 57 Z"/></svg></div>`,iconSize:[48,48],iconAnchor:[24,24]});
 };
 const updateUser=(here:{lat:number;lon:number},heading?:number|null)=>{
   const L=window.L,map=mapRef.current;if(!L||!map)return;
   latestPosRef.current={...here,heading};
   const h=Number.isFinite(Number(heading))?Number(heading):0;
   if(!userRef.current) userRef.current=L.marker([here.lat,here.lon],{icon:makeArrow(h),zIndexOffset:1000}).addTo(map);
   else {userRef.current.setLatLng([here.lat,here.lon]);userRef.current.setIcon(makeArrow(h));}
   if(followingRef.current){
     const target=L.latLng(here.lat,here.lon);
     const point=map.project(target,map.getZoom());
     const forward=point.subtract(L.point(0,Math.min(150,Math.max(70,map.getSize().y*.18))));
     map.panTo(map.unproject(forward,map.getZoom()),{animate:true,duration:.45});
   }
 };
 const recenter=()=>{
   const L=window.L,map=mapRef.current,pos=latestPosRef.current;
   if(!L||!map||!pos){setNavError('Aún no tengo una ubicación GPS para centrar.');return;}
   followingRef.current=true;
   setNav((old:any)=>old?{...old,following:true}:old);
   const z=Math.max(map.getZoom(),16);
   const target=L.latLng(pos.lat,pos.lon);
   const point=map.project(target,z);
   const forward=point.subtract(L.point(0,Math.min(150,Math.max(70,map.getSize().y*.18))));
   map.setView(map.unproject(forward,z),z,{animate:true});
 };
 React.useEffect(()=>{
   let dead=false;
   loadLeaflet().then(L=>{
     if(dead||!mapEl.current||mapRef.current)return;
     const map=L.map(mapEl.current,{zoomControl:true,attributionControl:true,preferCanvas:true}).setView(
       Number.isFinite(lat)&&Number.isFinite(lon)?[lat,lon]:[32.6927,-114.6277],zoom
     );
     L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
       maxZoom:19,attribution:'© OpenStreetMap contributors'
     }).addTo(map);
     mapRef.current=map;setMapReady(true);
     map.on('dragstart',()=>{followingRef.current=false;setNav((old:any)=>old?{...old,following:false}:old);});
     map.on('zoomstart',(e:any)=>{if(e?.originalEvent){followingRef.current=false;setNav((old:any)=>old?{...old,following:false}:old);}});
     setTimeout(()=>map.invalidateSize(),60);
   }).catch((e:any)=>setNavError(e?.message||'No pude cargar el mapa interactivo.'));
   return ()=>{dead=true;if(mapRef.current){mapRef.current.remove();mapRef.current=null;}};
 },[]);
 React.useEffect(()=>{
   const L=window.L,map=mapRef.current;if(!L||!mapReady||!Number.isFinite(lat)||!Number.isFinite(lon))return;
   if(destRef.current)destRef.current.setLatLng([lat,lon]);
   else destRef.current=L.marker([lat,lon]).addTo(map).bindPopup(c.title||'Destino');
   if(!nav)map.setView([lat,lon],zoom);
 },[lat,lon,zoom,mapReady]);
 React.useEffect(()=>()=>{if(watchRef.current!=null&&navigator.geolocation)navigator.geolocation.clearWatch(watchRef.current);window.speechSynthesis?.cancel?.();},[]);

 const stopNav=()=>{
   if(watchRef.current!=null)navigator.geolocation.clearWatch(watchRef.current);watchRef.current=null;
   if(routeRef.current){routeRef.current.remove();routeRef.current=null;}
   if(userRef.current){userRef.current.remove();userRef.current=null;}
   lastSpokenRef.current=-1;followingRef.current=true;latestPosRef.current=null;setNav(null);window.speechSynthesis?.cancel?.();
   if(mapRef.current&&Number.isFinite(lat)&&Number.isFinite(lon))mapRef.current.setView([lat,lon],zoom);
 };
 const startNav=()=>{
   setNavError('');
   if(!Number.isFinite(lat)||!Number.isFinite(lon)){setNavError('Primero busca un destino.');return;}
   if(!navigator.geolocation){setNavError('Este dispositivo no permite obtener la ubicación.');return;}
   navigator.geolocation.getCurrentPosition(async pos=>{
     try{
       const slat=pos.coords.latitude,slon=pos.coords.longitude;
       const url=`https://router.project-osrm.org/route/v1/driving/${slon},${slat};${lon},${lat}?steps=true&overview=full&geometries=geojson`;
       const r=await fetch(url);if(!r.ok)throw new Error(`Ruta ${r.status}`);
       const data=await r.json(),route=data?.routes?.[0];
       if(!route)throw new Error('No encontré una ruta manejable.');
       const steps=(route.legs||[]).flatMap((l:any)=>l.steps||[]);
       const coords=route?.geometry?.coordinates||[];
       const first=instructionEs(steps[0]);
       const L=window.L,map=mapRef.current;
       if(L&&map&&coords.length){
         if(routeRef.current)routeRef.current.remove();
         const line=coords.map((xy:any)=>[Number(xy[1]),Number(xy[0])]);
         routeRef.current=L.polyline(line,{className:'jv-live-route-line',weight:7,opacity:.92,lineCap:'round',lineJoin:'round'}).addTo(map);
         map.fitBounds(routeRef.current.getBounds(),{padding:[42,42]});
       }
       followingRef.current=true;
       updateUser({lat:slat,lon:slon},pos.coords.heading);
       setNav({distance:route.distance,duration:route.duration,steps,current:0,instruction:first,following:true});
       lastSpokenRef.current=0;if(voice)speak(first);
       watchRef.current=navigator.geolocation.watchPosition(p=>{
         const here={lat:p.coords.latitude,lon:p.coords.longitude};
         updateUser(here,p.coords.heading);
         let best=0,bestD=Infinity;
         steps.forEach((st:any,i:number)=>{const loc=st?.maneuver?.location;if(Array.isArray(loc)){const dm=distanceMeters(here,{lat:Number(loc[1]),lon:Number(loc[0])});if(dm<bestD){bestD=dm;best=i;}}});
         const next=Math.min(best+(bestD<45?1:0),Math.max(steps.length-1,0));
         setNav((old:any)=>{
           if(!old)return old;
           const ins=instructionEs(steps[next]);
           if(next!==lastSpokenRef.current&&voice){lastSpokenRef.current=next;speak(ins);}
           return {...old,current:next,instruction:ins,lastAccuracy:p.coords.accuracy};
         });
       },e=>setNavError(e.code===1?'Se perdió el permiso de ubicación.':'No pude actualizar tu ubicación.'),{enableHighAccuracy:true,maximumAge:1000,timeout:12000});
     }catch(e:any){setNavError(e?.message||'No pude calcular la ruta.');}
   },e=>setNavError(e.code===1?'Permite el acceso a tu ubicación para iniciar la navegación.':'No pude obtener tu ubicación.'),{enableHighAccuracy:true,timeout:12000});
 };
 return <div className="jv-v3-map-shell jv-live-map-shell">
   <div className="jv-v3-map jv-live-map" ref={mapEl}/>
   {!mapReady&&<div className="jv-map-loading"><Navigation/><span>Cargando mapa interactivo…</span></div>}
   <div className="jv-nav-actions">
     {!nav?<button type="button" onClick={startNav}><Navigation/>Cómo llegar desde mi ubicación</button>:<>
       <button type="button" className={`jv-nav-center ${nav?.following!==false?'is-following':''}`} onClick={recenter}><Crosshair/>{nav?.following!==false?'Siguiendo':'Centrar'}</button>
       <button type="button" onClick={()=>{setVoice(v=>{if(v)window.speechSynthesis?.cancel?.();else if(nav?.instruction)speak(nav.instruction);return !v;});}}>{voice?<Volume2/>:<VolumeX/>}{voice?'Voz activada':'Voz desactivada'}</button>
       <button type="button" onClick={stopNav}><X/>Terminar ruta</button>
     </>}
   </div>
   {nav&&<div className="jv-nav-panel"><div><Navigation/><strong>{nav.instruction}</strong></div><span>{(nav.distance/1609.344).toFixed(1)} mi · {Math.max(1,Math.round(nav.duration/60))} min aprox.</span><small>La flecha azul sigue tu GPS sobre la ruta mientras esta pantalla permanezca abierta.</small></div>}
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

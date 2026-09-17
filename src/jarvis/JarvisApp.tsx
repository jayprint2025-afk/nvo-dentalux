import React from 'react';
import {
  Activity, CalendarDays, Bell, Mail, MessageCircle, Phone, Globe2, Mic,
  ShieldCheck, X, Minus, GripHorizontal, ChevronLeft, ChevronRight,
  Plus, CheckCircle2, Clock3, Send, Search, PhoneCall, Sparkles, FileText, BarChart3, Settings, Home, Sun, Cpu
} from 'lucide-react';
import {jarvisApi} from './lib/jarvisApi';
import {JarvisVoiceController} from './voice/JarvisVoiceController';
import './jarvis.css';

type Health={ok:boolean;central_connected:boolean};
type Reminder={id:string|number;title:string;remind_at:string;notes?:string;priority?:string;status?:string};
type EventItem={id:string|number;title:string;start_at:string;end_at?:string;location?:string;notes?:string;category?:string;status?:string};
type VoiceStatus='idle'|'connecting'|'listening'|'speaking'|'error';
type ModuleId='agenda'|'reminders'|'correo'|'whatsapp'|'llamadas'|'internet';
type Pos={x:number;y:number};

const modules:{id:ModuleId;label:string;sub:string;icon:any;accent:string}[]=[
 {id:'correo',label:'Correo',sub:'Gestiona tu correo',icon:Mail,accent:'cyan'},
 {id:'agenda',label:'Agenda',sub:'Reuniones y compromisos',icon:CalendarDays,accent:'blue'},
 {id:'reminders',label:'Recordatorios',sub:'Nada se te olvida',icon:Bell,accent:'amber'},
 {id:'whatsapp',label:'WhatsApp',sub:'Chats y seguimiento',icon:MessageCircle,accent:'green'},
 {id:'llamadas',label:'Llamadas',sub:'Haz y recibe llamadas',icon:Phone,accent:'violet'},
 {id:'internet',label:'Internet',sub:'Busca y analiza',icon:Globe2,accent:'indigo'},
];

function fmt(v:string){try{return new Date(v).toLocaleString('es-MX',{dateStyle:'medium',timeStyle:'short'})}catch{return v}}
function defaultPos(i:number):Pos{return {x:390+(i%3)*42,y:190+(i%2)*34}}

export default function JarvisApp(){
 const [health,setHealth]=React.useState<Health|null>(null);
 const [items,setItems]=React.useState<Reminder[]>([]);
 const [events,setEvents]=React.useState<EventItem[]>([]);
 const [voiceStatus,setVoiceStatus]=React.useState<VoiceStatus>('idle');
 const [lastText,setLastText]=React.useState('');
 const [selected,setSelected]=React.useState<ModuleId>('reminders');
 const [open,setOpen]=React.useState<ModuleId[]>([]);
 const [positions,setPositions]=React.useState<Partial<Record<ModuleId,Pos>>>({});
 const [carousel,setCarousel]=React.useState(0);
 const voiceRef=React.useRef<JarvisVoiceController|null>(null);

 const loadDashboard=React.useCallback(async()=>{
   try{
     const data:any=await jarvisApi<any>('/api/jarvis/personal/dashboard');
     setItems(Array.isArray(data?.reminders)?data.reminders:[]);
     setEvents(Array.isArray(data?.events)?data.events:[]);
   }catch(e){console.warn('JARVIS dashboard:',e)}
 },[]);

 React.useEffect(()=>{
   let alive=true;
   const safeLoad=async()=>{if(alive)await loadDashboard()};
   jarvisApi<Health>('/api/jarvis/health').then(x=>alive&&setHealth(x)).catch(console.warn);
   safeLoad();
   const timer=window.setInterval(safeLoad,3000);
   const refresh=()=>safeLoad();
   window.addEventListener('focus',refresh);
   window.addEventListener('jarvis:reminders-changed',refresh as EventListener);
   window.addEventListener('jarvis:agenda-changed',refresh as EventListener);
   document.addEventListener('visibilitychange',refresh);
   voiceRef.current=new JarvisVoiceController({
     onStatus:setVoiceStatus,
     onTranscript:(t,w)=>{setLastText(`${w==='jarvis'?'JARVIS':'Tú'}: ${t}`);if(w==='jarvis')window.setTimeout(safeLoad,500)},
     onError:e=>setLastText(`Error: ${e.message}`)
   });
   return()=>{
     alive=false; window.clearInterval(timer);
     window.removeEventListener('focus',refresh);
     window.removeEventListener('jarvis:reminders-changed',refresh as EventListener);
     window.removeEventListener('jarvis:agenda-changed',refresh as EventListener);
     document.removeEventListener('visibilitychange',refresh);
     voiceRef.current?.stop();
   };
 },[loadDashboard]);

 const toggleVoice=async()=>{if(voiceStatus==='idle'||voiceStatus==='error'){try{await voiceRef.current?.start()}catch{}}else voiceRef.current?.stop()};
 const listening=['listening','speaking','connecting'].includes(voiceStatus);
 const voiceTitle=voiceStatus==='connecting'?'Conectando…':voiceStatus==='listening'?'Te escucho…':voiceStatus==='speaking'?'Hablando…':voiceStatus==='error'?'Error de voz':'En espera';

 const activate=(id:ModuleId)=>{
   setSelected(id);
   if(!open.includes(id)){
     setOpen(v=>[...v,id]);
     setPositions(p=>({...p,[id]:p[id]||defaultPos(open.length)}));
   }
 };
 const closePanel=(id:ModuleId)=>setOpen(v=>v.filter(x=>x!==id));
 const resetPanels=()=>{setOpen([]);setPositions({})};

 const beginDrag=(id:ModuleId,e:React.PointerEvent<HTMLDivElement>)=>{
   if((e.target as HTMLElement).closest('button'))return;
   const el=e.currentTarget;
   el.setPointerCapture(e.pointerId);
   const start=positions[id]||defaultPos(0), sx=e.clientX, sy=e.clientY;
   const move=(ev:PointerEvent)=>setPositions(p=>({...p,[id]:{x:Math.max(278,start.x+ev.clientX-sx),y:Math.max(82,start.y+ev.clientY-sy)}}));
   const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)};
   window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);
 };

 const renderPanel=(id:ModuleId)=>{
   if(id==='agenda')return <>{events.length?events.map(x=><div className="jv-row" key={x.id}><CalendarDays/><div><b>{x.title}</b><small>{fmt(x.start_at)}{x.location?` · ${x.location}`:''}</small></div></div>):<div className="jv-panel-empty">No hay eventos próximos.</div>}<button className="jv-action"><Plus/> Crear evento por voz</button></>;
   if(id==='reminders')return <>{items.length?items.map(x=><div className="jv-row" key={x.id}><Clock3/><div><b>{x.title}</b><small>{fmt(x.remind_at)}</small></div><CheckCircle2 className="row-action"/></div>):<div className="jv-panel-empty">No hay recordatorios pendientes.</div>}<button className="jv-action"><Plus/> Crear recordatorio por voz</button></>;
   if(id==='correo')return <><div className="jv-panel-empty">Bandeja inteligente preparada para conectar correo.</div><button className="jv-action"><Mail/> Ver bandeja</button><button className="jv-action secondary"><Send/> Redactar</button></>;
   if(id==='whatsapp')return <><div className="jv-panel-empty">Centro WhatsApp preparado para conversaciones y envíos.</div><button className="jv-action"><MessageCircle/> Conversaciones</button><button className="jv-action secondary"><Send/> Nuevo mensaje</button></>;
   if(id==='llamadas')return <><div className="jv-call-ring"><PhoneCall/></div><div className="jv-panel-empty">Módulo de llamadas preparado.</div><button className="jv-action"><PhoneCall/> Iniciar llamada</button></>;
   return <><div className="jv-search"><Search/><span>Pregunta a JARVIS y los resultados aparecerán aquí.</span></div><button className="jv-action"><Globe2/> Nueva búsqueda</button></>;
 };

 const rotated=modules.map((_,i)=>modules[(i+carousel+modules.length)%modules.length]);

 return <div className="jv-stark">
   <div className="jv-grid"/><div className="jv-scan"/>
   <aside className="jv-side">
     <div className="brand"><span>J</span><div><b>JARVIS</b><small>PERSONAL COMMAND SYSTEM</small></div></div>
     <nav>
       <button className="active"><Home/>Centro de comando</button>
       {modules.map(m=>{const I=m.icon;return <button key={m.id} onClick={()=>activate(m.id)}><I/>{m.label}</button>})}<button><FileText/>Documentos</button><button><BarChart3/>Análisis IA</button><button><Settings/>Configuración</button>
     </nav>
     <div className="lock"><ShieldCheck/><div><b>Owner Lock</b><small>F1 Voice Core reservado</small></div></div><div className="jv-version">JARVIS v1.0<small>Designed for a greater you</small></div>
   </aside>

   <main className="jv-main">
     <header className="jv-header">
       <div><label>COMMAND CENTER</label><h1>JARVIS</h1><p>Asistente personal y empresarial</p></div>
       <div className="jv-topwidgets"><div className="jv-clock"><b>{new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</b><small>{new Date().toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'short',year:'numeric'})}</small></div><div className="jv-weather"><Sun/><div><small>Yuma, AZ</small><b>32°C</b></div></div><div className="jv-user"><span>Y</span><div><b>Yaneth Caballero</b><small>Dentalux2</small></div></div></div>
     </header>

     <div className="jv-world"/><section className="jv-orbit-zone">
       <div className="hud-ring ring-a"/><div className="hud-ring ring-b"/><div className="hud-ring ring-c"/>
       <button className="orbit-arrow left" onClick={()=>setCarousel(v=>(v-1+modules.length)%modules.length)}><ChevronLeft/></button>
       <div className="jv-orbit">
         {rotated.map((m,i)=>{
           const I=m.icon; const slot=i-2.5;
           return <button key={m.id} className={`module-card ${m.accent} ${selected===m.id?'selected':''}`} style={{'--slot':slot} as React.CSSProperties} onClick={()=>activate(m.id)}>
             <I/><b>{m.label}</b><small>{m.sub}</small>
             {m.id==='agenda'&&<em>{events.length} próximos</em>}
             {m.id==='reminders'&&<em>{items.length} activos</em>}
           </button>
         })}
       </div>
       <button className="orbit-arrow right" onClick={()=>setCarousel(v=>(v+1)%modules.length)}><ChevronRight/></button>

       <section className="voice-core">
         <button className={listening?'orb listening':'orb'} onClick={toggleVoice}><Mic/></button>
         <h2>{voiceTitle}</h2>
         <p>{lastText||'Pulsa el núcleo para iniciar JARVIS Realtime.'}</p>
         <div className="tags"><i>Wake: JARVIS</i><i>Voice ID</i><i>Realtime</i><i>Tools</i></div>
       </section>
     </section>

     <section className="jv-summary">
       <article><h3><CalendarDays/>Agenda ejecutiva ({events.length})</h3>{events.length?events.slice(0,3).map(x=><div className="rem" key={x.id}><b>{x.title}</b><small>{fmt(x.start_at)}</small></div>):<div className="empty">Agenda personal/empresarial</div>}</article>
       <article><h3><Bell/>Recordatorios ({items.length})</h3>{items.length?items.slice(0,3).map(x=><div className="rem" key={x.id}><b>{x.title}</b><small>{fmt(x.remind_at)}</small></div>):<div className="empty">Sin recordatorios</div>}</article>
     </section>
   </main>

   <div className="jv-floating-layer">
     {open.map((id,i)=>{
       const m=modules.find(x=>x.id===id)!; const I=m.icon; const pos=positions[id]||defaultPos(i);
       return <section key={id} className={`jv-float ${m.accent} ${selected===id?'focused':''}`} style={{left:pos.x,top:pos.y,zIndex:selected===id?60:40+i}} onPointerDown={e=>{setSelected(id);beginDrag(id,e)}}>
         <header><div><I/><b>{m.label}</b></div><span><GripHorizontal/><button title="Minimizar" onClick={()=>closePanel(id)}><Minus/></button><button title="Cerrar" onClick={()=>closePanel(id)}><X/></button></span></header>
         <div className="jv-float-body">{renderPanel(id)}</div>
       </section>
     })}
   </div>

   {open.length>0&&<button className="jv-reset" onClick={resetPanels}><Sparkles/> Reorganizar paneles</button>}
 </div>
}

import React from 'react';
import {Activity,CalendarDays,Bell,Mail,MessageCircle,Phone,Globe2,Mic,ShieldCheck} from 'lucide-react';
import {jarvisApi} from './lib/jarvisApi';
import {JarvisVoiceController} from './voice/JarvisVoiceController';
import './jarvis.css';
type Health={ok:boolean;central_connected:boolean};
type Reminder={id:string|number;title:string;remind_at:string;notes?:string;priority?:string;status?:string};
type EventItem={id:string|number;title:string;start_at:string;end_at?:string;location?:string;notes?:string;category?:string;status?:string};
type VoiceStatus='idle'|'connecting'|'listening'|'speaking'|'error';
export default function JarvisApp(){
 const [health,setHealth]=React.useState<Health|null>(null),[items,setItems]=React.useState<Reminder[]>([]),[events,setEvents]=React.useState<EventItem[]>([]);
 const [voiceStatus,setVoiceStatus]=React.useState<VoiceStatus>('idle'),[lastText,setLastText]=React.useState('');
 const voiceRef=React.useRef<JarvisVoiceController|null>(null);
 React.useEffect(()=>{
   let alive=true;
   const loadDashboard=async()=>{
     try{
       const data:any=await jarvisApi<any>('/api/jarvis/personal/dashboard');
       if(!alive)return;
       setItems(Array.isArray(data?.reminders)?data.reminders:[]);
       setEvents(Array.isArray(data?.events)?data.events:[]);
     }catch(e){console.warn('JARVIS dashboard:',e)}
   };
   jarvisApi<Health>('/api/jarvis/health').then(setHealth).catch(console.warn);
   loadDashboard();
   const timer=window.setInterval(loadDashboard,3000);
   const refresh=()=>loadDashboard();
   window.addEventListener('focus',refresh);
   window.addEventListener('jarvis:reminders-changed',refresh as EventListener);
   window.addEventListener('jarvis:agenda-changed',refresh as EventListener);
   document.addEventListener('visibilitychange',refresh);
   voiceRef.current=new JarvisVoiceController({
     onStatus:setVoiceStatus,
     onTranscript:(t,w)=>{
       setLastText(`${w==='jarvis'?'JARVIS':'Tú'}: ${t}`);
       if(w==='jarvis')window.setTimeout(loadDashboard,500);
     },
     onError:e=>setLastText(`Error: ${e.message}`)
   });
   return()=>{
     alive=false;
     window.clearInterval(timer);
     window.removeEventListener('focus',refresh);
     window.removeEventListener('jarvis:reminders-changed',refresh as EventListener);
     window.removeEventListener('jarvis:agenda-changed',refresh as EventListener);
     document.removeEventListener('visibilitychange',refresh);
     voiceRef.current?.stop();
   };
 },[]);
 const toggleVoice=async()=>{if(voiceStatus==='idle'||voiceStatus==='error'){try{await voiceRef.current?.start()}catch{}}else voiceRef.current?.stop()};
 const listening=voiceStatus==='listening'||voiceStatus==='speaking'||voiceStatus==='connecting';
 const voiceTitle=voiceStatus==='connecting'?'Conectando…':voiceStatus==='listening'?'Te escucho…':voiceStatus==='speaking'?'Hablando…':voiceStatus==='error'?'Error de voz':'En espera';
 return <div className="jv"><aside><div className="brand"><span>J</span><div><b>JARVIS</b><small>PERSONAL COMMAND SYSTEM</small></div></div><nav>
 <button className="active"><Activity/>Centro de comando</button><button><CalendarDays/>Agenda</button><button><Bell/>Recordatorios</button><button><Mail/>Correo</button><button><MessageCircle/>WhatsApp</button><button><Phone/>Llamadas</button><button><Globe2/>Internet</button>
 </nav><div className="lock"><ShieldCheck/><div><b>Owner Lock</b><small>F1 Voice Core reservado</small></div></div></aside>
 <main><header><div><label>COMMAND CENTER</label><h1>JARVIS</h1><p>Asistente personal y empresarial</p></div><span>{health?.ok?'● Jarvis Server conectado':'○ Esperando servidor'}</span></header>
 <section className="voice"><button className={listening?'orb listening':'orb'} onClick={toggleVoice}><Mic/></button><h2>{voiceTitle}</h2><p>{lastText||'Pulsa el núcleo para iniciar JARVIS Realtime. Después podrás hablar de forma natural.'}</p><div className="tags"><i>Wake: JARVIS</i><i>Voice ID</i><i>Realtime</i><i>Tools</i></div></section>
 <section className="cards"><article><h3><CalendarDays/>Agenda ejecutiva ({events.length})</h3>{events.length?events.slice(0,4).map(x=><div className="rem" key={x.id}><b>{x.title}</b><small>{new Date(x.start_at).toLocaleString()}{x.location?` · ${x.location}`:''}</small></div>):<div className="empty">Agenda personal/empresarial</div>}</article><article><h3><Bell/>Recordatorios ({items.length})</h3>{items.length?items.slice(0,4).map(x=><div className="rem" key={x.id}><b>{x.title}</b><small>{new Date(x.remind_at).toLocaleString()}</small></div>):<div className="empty">Sin recordatorios</div>}</article></section>
 <section className="services">{['Correo','WhatsApp','Llamadas','Internet'].map(x=><div key={x}><b>{x}</b><small>Preparado</small></div>)}</section></main></div>
}

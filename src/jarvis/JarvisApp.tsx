import React from 'react';
import {Activity,CalendarDays,Bell,Mail,MessageCircle,Phone,Globe2,Mic,ShieldCheck} from 'lucide-react';
import {jarvisApi} from './lib/jarvisApi';
import './jarvis.css';
type Health={ok:boolean;central_connected:boolean}; type Reminder={id:string;title:string;due_at:string};
export default function JarvisApp(){
 const [health,setHealth]=React.useState<Health|null>(null),[items,setItems]=React.useState<Reminder[]>([]),[listening,setListening]=React.useState(false);
 React.useEffect(()=>{Promise.all([jarvisApi<Health>('/api/health'),jarvisApi<{items:Reminder[]}>('/api/reminders')]).then(([h,r])=>{setHealth(h);setItems(r.items)}).catch(console.warn)},[]);
 return <div className="jv"><aside><div className="brand"><span>J</span><div><b>JARVIS</b><small>PERSONAL COMMAND SYSTEM</small></div></div><nav>
 <button className="active"><Activity/>Centro de comando</button><button><CalendarDays/>Agenda</button><button><Bell/>Recordatorios</button><button><Mail/>Correo</button><button><MessageCircle/>WhatsApp</button><button><Phone/>Llamadas</button><button><Globe2/>Internet</button>
 </nav><div className="lock"><ShieldCheck/><div><b>Owner Lock</b><small>F1 Voice Core reservado</small></div></div></aside>
 <main><header><div><label>COMMAND CENTER</label><h1>JARVIS</h1><p>Asistente personal y empresarial</p></div><span>{health?.ok?'● Jarvis Server conectado':'○ Esperando servidor'}</span></header>
 <section className="voice"><button className={listening?'orb listening':'orb'} onClick={()=>setListening(!listening)}><Mic/></button><h2>{listening?'Te escucho…':'En espera'}</h2><p>Preparado para montar el motor estable F1/Hanna.</p><div className="tags"><i>Wake: JARVIS</i><i>Voice ID</i><i>Realtime</i><i>Tools</i></div></section>
 <section className="cards"><article><h3><CalendarDays/>Agenda ejecutiva</h3><div className="empty">Agenda personal/empresarial</div></article><article><h3><Bell/>Recordatorios ({items.length})</h3>{items.length?items.slice(0,4).map(x=><div className="rem" key={x.id}><b>{x.title}</b><small>{new Date(x.due_at).toLocaleString()}</small></div>):<div className="empty">Sin recordatorios</div>}</article></section>
 <section className="services">{['Correo','WhatsApp','Llamadas','Internet'].map(x=><div key={x}><b>{x}</b><small>Preparado</small></div>)}</section></main></div>
}

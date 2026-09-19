import jarvisRobot from './assets/jarvis-robot.png';
import jarvisMobile from './assets/jarvis-mobile.png';
import jarvisEarthMobile from './assets/jarvis-earth-mobile.png';
import jarvisModuleBg from './assets/jarvis-module-bg.png';
import React from 'react';
import {
  CalendarDays, Bell, Mail, MessageCircle, Phone, Globe2,
  Lock, X, Minus, GripHorizontal, ChevronLeft, ChevronRight, Maximize2, Minimize2,
  Plus, CheckCircle2, Clock3, Send, Search, PhoneCall, Sparkles,
  FileText, BarChart3, Settings, Home, Sun, Menu, Facebook
} from 'lucide-react';
import { jarvisApi } from './lib/jarvisApi';
import { JarvisVoiceController } from './voice/JarvisVoiceController';
import './jarvis.css';

type Health = { ok: boolean; central_connected: boolean };
type Reminder = { id: string | number; title: string; remind_at: string; notes?: string; priority?: string; status?: string };
type EventItem = { id: string | number; title: string; start_at: string; end_at?: string; location?: string; notes?: string; category?: string; status?: string };
type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error';
type ModuleId = 'agenda' | 'reminders' | 'correo' | 'whatsapp' | 'llamadas' | 'internet' | 'facebook';
type Pos = { x: number; y: number };

type WaMessage = {
  id: string | number;
  wa_message_id?: string | null;
  type: 'incoming' | 'outgoing' | string;
  phone: string;
  message: string;
  status?: string | null;
  timestamp: string;
  contact_name?: string | null;
  manual?: boolean;
};

type WaConversation = {
  phone: string;
  name: string;
  avatar: string;
  preview: string;
  timestamp: string;
  unread: number;
  messages: WaMessage[];
};

/* Orden del arco, igual que en el diseÃ±o:
   Correo · Agenda · Recordatorios · WhatsApp · Llamadas · Internet */
const modules: { id: ModuleId; label: string; sub: string; icon: any; accent: string }[] = [
  { id: 'correo',    label: 'Correo',        sub: 'Gestiona tu correo con IA',   icon: Mail,          accent: 'cyan'   },
  { id: 'agenda',    label: 'Agenda',        sub: 'Reuniones, citas y compromisos', icon: CalendarDays, accent: 'blue'  },
  { id: 'reminders', label: 'Recordatorios', sub: 'Nada se te olvida',           icon: Bell,          accent: 'amber'  },
  { id: 'whatsapp',  label: 'WhatsApp',      sub: 'Chats y seguimiento',         icon: MessageCircle, accent: 'green'  },
  { id: 'llamadas',  label: 'Llamadas',      sub: 'Haz y recibe llamadas con IA', icon: Phone,        accent: 'violet' },
  { id: 'internet',  label: 'Internet',      sub: 'Busca, analiza y resume',     icon: Globe2,        accent: 'indigo' },
  { id: 'facebook',  label: 'Facebook',      sub: 'Publicaciones y mensajes',      icon: Facebook,      accent: 'facebook' },
];

/* MenÃº lateral, en el orden del diseÃ±o */
const navItems: { id: ModuleId | null; label: string; icon: any }[] = [
  { id: 'agenda',    label: 'Agenda',        icon: CalendarDays },
  { id: 'reminders', label: 'Recordatorios', icon: Bell },
  { id: 'correo',    label: 'Correo',        icon: Mail },
  { id: 'whatsapp',  label: 'WhatsApp',      icon: MessageCircle },
  { id: 'llamadas',  label: 'Llamadas',      icon: Phone },
  { id: 'internet',  label: 'Internet',      icon: Globe2 },
  { id: null,        label: 'Documentos',    icon: FileText },
  { id: null,        label: 'Análisis IA',   icon: BarChart3 },
  { id: null,        label: 'Configuración', icon: Settings },
];

const WAVE = [22, 46, 30, 68, 40, 88, 52, 34, 70, 44, 96, 58, 30, 76, 42, 62, 28, 84, 48, 36,
              72, 40, 92, 54, 32, 66, 44, 80, 38, 58, 26, 70, 46, 34, 62, 88, 42, 30, 56, 24];

function fmt(v: string) {
  try { return new Date(v).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return v; }
}
function defaultPos(i: number): Pos { return { x: 390 + (i % 3) * 42, y: 190 + (i % 2) * 34 }; }

const JARVIS_API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');

async function jarvisWhatsAppApi(endpoint: string, options: RequestInit = {}) {
  const normalized = endpoint.startsWith('/api/')
    ? endpoint
    : `/api${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  let token = '';
  let sucursal = 'sucursal_1';
  try {
    token = localStorage.getItem('dentalux_auth_token') || '';
    sucursal = localStorage.getItem('sucursal_actual') || 'sucursal_1';
  } catch {}

  const response = await fetch(`${JARVIS_API_BASE}${normalized}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'x-sucursal': sucursal,
      ...(options.headers || {}),
    },
  });

  if (response.status === 401) {
    try { localStorage.removeItem('dentalux_auth_token'); } catch {}
    window.dispatchEvent(new CustomEvent('dentalux:auth-expired'));
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
  }

  if (response.status === 204) return null;
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

export default function JarvisApp() {
  const [health, setHealth] = React.useState<Health | null>(null);
  const [items, setItems] = React.useState<Reminder[]>([]);
  const [events, setEvents] = React.useState<EventItem[]>([]);
  const [voiceStatus, setVoiceStatus] = React.useState<VoiceStatus>('idle');
  const [lastText, setLastText] = React.useState('');
  const [selected, setSelected] = React.useState<ModuleId>('reminders');
  const [open, setOpen] = React.useState<ModuleId[]>([]);
  const [positions, setPositions] = React.useState<Partial<Record<ModuleId, Pos>>>({});
  const [carousel, setCarousel] = React.useState(0);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [fullscreenModule, setFullscreenModule] = React.useState<ModuleId | null>(null);
  const [waQuery, setWaQuery] = React.useState('');
  const [waChat, setWaChat] = React.useState('');
  const [waDraft, setWaDraft] = React.useState('');
  const [waMessages, setWaMessages] = React.useState<WaMessage[]>([]);
  const [waLoading, setWaLoading] = React.useState(false);
  const [waSending, setWaSending] = React.useState(false);
  const [waError, setWaError] = React.useState('');
  const [now, setNow] = React.useState(() => new Date());
  const voiceRef = React.useRef<JarvisVoiceController | null>(null);
  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const audioRef = React.useRef<AudioContext | null>(null);
  const lastHoverSound = React.useRef(0);
  const carouselSwipe = React.useRef({ x: 0, y: 0, active: false, moved: false, pointerId: -1 });

  const flashUi = React.useCallback((kind: 'open' | 'slide' | 'close' | 'mic' | 'hover') => {
    const stage = stageRef.current;
    if (!stage) return;
    const className = `jv-fx-${kind}`;
    stage.classList.remove(className);
    void stage.offsetWidth;
    stage.classList.add(className);
    window.setTimeout(() => stage.classList.remove(className), 650);
  }, []);

  const playUiSound = React.useCallback((kind: 'open' | 'slide' | 'minimize' | 'close' | 'mic' | 'hover') => {
    try {
      const AudioCtor = window.AudioContext;
      const ctx = audioRef.current || new AudioCtor();
      audioRef.current = ctx;
      if (ctx.state === 'suspended') void ctx.resume();
      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(kind === 'hover' ? 0.025 : 0.07, now + 0.012);
      master.gain.exponentialRampToValueAtTime(0.0001, now + (kind === 'mic' ? 0.42 : 0.24));
      master.connect(ctx.destination);

      const tone = (from: number, to: number, delay = 0, duration = 0.2, type: OscillatorType = 'sine') => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(from, now + delay);
        osc.frequency.exponentialRampToValueAtTime(to, now + delay + duration);
        gain.gain.setValueAtTime(0.0001, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.65, now + delay + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + duration);
        osc.connect(gain); gain.connect(master);
        osc.start(now + delay); osc.stop(now + delay + duration + 0.02);
      };

      if (kind === 'open') { tone(310, 760, 0, .22, 'sine'); tone(620, 1180, .035, .18, 'triangle'); }
      if (kind === 'slide') { tone(950, 430, 0, .16, 'sine'); tone(1250, 720, .025, .13, 'triangle'); }
      if (kind === 'minimize') { tone(620, 260, 0, .21, 'triangle'); }
      if (kind === 'close') { tone(360, 110, 0, .23, 'sine'); }
      if (kind === 'mic') { tone(240, 720, 0, .2, 'sine'); tone(480, 1280, .09, .26, 'triangle'); }
      if (kind === 'hover') { tone(880, 1040, 0, .07, 'sine'); }
      flashUi(kind === 'minimize' ? 'close' : kind);
    } catch { /* Audio no disponible: la interfaz sigue funcionando. */ }
  }, [flashUi]);

  React.useEffect(() => () => { void audioRef.current?.close(); }, []);

  React.useEffect(() => {
    let frame = 0;
    const move = (event: PointerEvent) => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const x = (event.clientX / window.innerWidth - 0.5) * 2;
        const y = (event.clientY / window.innerHeight - 0.5) * 2;
        stageRef.current?.style.setProperty('--jv-px', `${x.toFixed(3)}`);
        stageRef.current?.style.setProperty('--jv-py', `${y.toFixed(3)}`);
      });
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
    };
  }, []);

  const loadDashboard = React.useCallback(async () => {
    try {
      const data: any = await jarvisApi<any>('/api/jarvis/personal/dashboard');
      setItems(Array.isArray(data?.reminders) ? data.reminders : []);
      setEvents(Array.isArray(data?.events) ? data.events : []);
    } catch (e) { console.warn('JARVIS dashboard:', e); }
  }, []);

  React.useEffect(() => {
    let alive = true;
    const safeLoad = async () => { if (alive) await loadDashboard(); };
    jarvisApi<Health>('/api/jarvis/health').then(x => alive && setHealth(x)).catch(console.warn);
    safeLoad();
    const timer = window.setInterval(safeLoad, 3000);
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    const refresh = () => safeLoad();
    window.addEventListener('focus', refresh);
    window.addEventListener('jarvis:reminders-changed', refresh as EventListener);
    window.addEventListener('jarvis:agenda-changed', refresh as EventListener);
    document.addEventListener('visibilitychange', refresh);
    voiceRef.current = new JarvisVoiceController({
      onStatus: setVoiceStatus,
      onTranscript: (t, w) => {
        setLastText(`${w === 'jarvis' ? 'JARVIS' : 'Tú'}: ${t}`);
        if (w === 'jarvis') window.setTimeout(safeLoad, 500);
      },
      onError: e => setLastText(`Error: ${e.message}`)
    });
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.clearInterval(clock);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('jarvis:reminders-changed', refresh as EventListener);
      window.removeEventListener('jarvis:agenda-changed', refresh as EventListener);
      document.removeEventListener('visibilitychange', refresh);
      voiceRef.current?.stop();
    };
  }, [loadDashboard]);

  const loadWhatsApp = React.useCallback(async (silent = false) => {
    if (!silent) setWaLoading(true);
    try {
      const data = await jarvisWhatsAppApi('/api/whatsapp/jarvis/messages?limit=1000');
      const rows = Array.isArray(data) ? data : [];
      setWaMessages(rows);
      setWaError('');
    } catch (e: any) {
      console.error('JARVIS WhatsApp:', e);
      setWaError(e?.message || 'No se pudo cargar WhatsApp');
    } finally {
      if (!silent) setWaLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadWhatsApp();
    const timer = window.setInterval(() => void loadWhatsApp(true), 4000);
    const refresh = () => void loadWhatsApp(true);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [loadWhatsApp]);

  const toggleVoice = async () => {
    playUiSound('mic');
    if (voiceStatus === 'idle' || voiceStatus === 'error') { try { await voiceRef.current?.start(); } catch {} }
    else voiceRef.current?.stop();
  };
  const listening = ['listening', 'speaking', 'connecting'].includes(voiceStatus);
  const voiceTitle =
    voiceStatus === 'connecting' ? 'Conectando…' :
    voiceStatus === 'listening'  ? 'Te escucho…' :
    voiceStatus === 'speaking'   ? 'Hablando…'   :
    voiceStatus === 'error'      ? 'Error de voz' : 'En espera';

  const activate = (id: ModuleId) => {
    playUiSound('open');
    setSelected(id);
    if (!open.includes(id)) {
      setOpen(v => [...v, id]);
      setPositions(p => ({ ...p, [id]: p[id] || defaultPos(open.length) }));
    }
  };
  const closePanel = (id: ModuleId, sound: 'minimize' | 'close' = 'close') => {
    playUiSound(sound);
    setOpen(v => v.filter(x => x !== id));
  };
  const resetPanels = () => { playUiSound('slide'); setOpen([]); setPositions({}); };

  const slideCarousel = (direction: number) => {
    if (!direction) return;
    playUiSound('slide');
    setCarousel(v => (v + direction + modules.length * 10) % modules.length);
  };

  // Swipe real: deslizar horizontalmente equivale a pulsar una flecha.
  const onCarouselPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    carouselSwipe.current = { x: e.clientX, y: e.clientY, active: true, moved: false, pointerId: e.pointerId };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  };
  const onCarouselPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = carouselSwipe.current;
    if (!s.active || s.pointerId !== e.pointerId) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { s.moved = true; e.preventDefault(); }
  };
  const finishCarouselSwipe = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = carouselSwipe.current;
    if (!s.active || s.pointerId !== e.pointerId) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    const shouldRotate = Math.abs(dx) >= 20 && Math.abs(dx) > Math.abs(dy);
    s.active = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    if (shouldRotate) {
      // Ruleta rápida: un gesto largo puede avanzar 2, 3 o 4 módulos de una sola vez.
      const steps = Math.min(4, Math.max(1, Math.round(Math.abs(dx) / 55)));
      slideCarousel(dx < 0 ? steps : -steps);
    }
    window.setTimeout(() => { carouselSwipe.current.moved = false; }, 100);
  };

  const hoverCard = () => {
    const now = performance.now();
    if (now - lastHoverSound.current < 180) return;
    lastHoverSound.current = now;
    playUiSound('hover');
  };

  const beginDrag = (id: ModuleId, e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const start = positions[id] || defaultPos(0), sx = e.clientX, sy = e.clientY;
    const move = (ev: PointerEvent) =>
      setPositions(p => ({ ...p, [id]: { x: Math.max(278, start.x + ev.clientX - sx), y: Math.max(82, start.y + ev.clientY - sy) } }));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const waContacts = React.useMemo<WaConversation[]>(() => {
    const groups = new Map<string, WaMessage[]>();
    for (const msg of waMessages) {
      const phone = String(msg.phone || '').trim();
      if (!phone) continue;
      const arr = groups.get(phone) || [];
      arr.push(msg);
      groups.set(phone, arr);
    }

    return Array.from(groups.entries()).map(([phone, messages]) => {
      messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const last = messages[messages.length - 1];
      const named = [...messages].reverse().find(m => m.contact_name)?.contact_name?.trim();
      const name = named || phone;
      const initials = named
        ? named.split(/\s+/).slice(0, 2).map(x => x[0]?.toUpperCase()).join('')
        : phone.slice(-2);
      return {
        phone,
        name,
        avatar: initials || 'WA',
        preview: last?.message || '',
        timestamp: last?.timestamp || '',
        unread: 0,
        messages,
      };
    }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [waMessages]);

  React.useEffect(() => {
    if (!waChat && waContacts.length) setWaChat(waContacts[0].phone);
    if (waChat && waContacts.length && !waContacts.some(c => c.phone === waChat)) setWaChat(waContacts[0].phone);
  }, [waContacts, waChat]);

  const waFiltered = waContacts.filter(c =>
    (c.name + ' ' + c.phone + ' ' + c.preview).toLowerCase().includes(waQuery.toLowerCase())
  );
  const waCurrent = waContacts.find(c => c.phone === waChat) || waContacts[0] || null;

  const waTime = (v?: string) => {
    if (!v) return '';
    try { return new Date(v).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' }); }
    catch { return ''; }
  };

  const sendWhatsAppMessage = async () => {
    const message = waDraft.trim();
    if (!message || !waCurrent || waSending) return;
    setWaSending(true);
    try {
      await jarvisWhatsAppApi('/api/whatsapp/jarvis/send-message', {
        method: 'POST',
        body: JSON.stringify({ phone: waCurrent.phone, message }),
      });
      setWaDraft('');
      await loadWhatsApp(true);
    } catch (e: any) {
      console.error('JARVIS WhatsApp send:', e);
      setWaError(e?.message || 'No se pudo enviar el mensaje');
    } finally {
      setWaSending(false);
    }
  };

  const newWhatsAppConversation = async () => {
    const phone = window.prompt('Número de WhatsApp del contacto (con lada):')?.trim();
    if (!phone) return;
    const message = window.prompt('Primer mensaje de JARVIS:')?.trim();
    if (!message) return;
    setWaSending(true);
    try {
      const result: any = await jarvisWhatsAppApi('/api/whatsapp/jarvis/send-message', {
        method: 'POST',
        body: JSON.stringify({ phone, message }),
      });
      setWaChat(String(result?.phone || phone));
      await loadWhatsApp(true);
      setWaError('');
    } catch (e: any) {
      setWaError(e?.message || 'No se pudo iniciar la conversación');
    } finally {
      setWaSending(false);
    }
  };

  const renderWhatsAppFull = () => (
    <div className="jv-wa-app">
      <section className="jv-wa-sidebar">
        <div className="jv-wa-brand"><b>WhatsApp</b><span>JARVIS · EN VIVO</span></div>
        <label className="jv-wa-search"><Search/><input value={waQuery} onChange={e=>setWaQuery(e.target.value)} placeholder="Buscar contacto, teléfono o conversación" /></label>
        <div className="jv-wa-list">
          {waLoading && !waContacts.length && <div className="jv-panel-empty">Cargando conversaciones…</div>}
          {waError && !waContacts.length && <div className="jv-panel-empty">{waError}</div>}
          {!waLoading && !waFiltered.length && !waError && <div className="jv-panel-empty">No hay conversaciones de WhatsApp.</div>}
          {waFiltered.map(c => <button key={c.phone} className={`jv-wa-contact ${waChat===c.phone?'active':''}`} onClick={()=>setWaChat(c.phone)}>
            <span className="jv-wa-avatar">{c.avatar}</span>
            <span className="jv-wa-contact-copy"><b>{c.name}</b><small>{c.preview}</small></span>
            <span className="jv-wa-meta"><small>{waTime(c.timestamp)}</small>{c.unread ? <em>{c.unread}</em> : null}</span>
          </button>)}
        </div>
      </section>

      <section className="jv-wa-chat">
        {waCurrent ? <>
          <header className="jv-wa-chat-head">
            <span className="jv-wa-avatar">{waCurrent.avatar}</span>
            <div><b>{waCurrent.name}</b><small>{waCurrent.phone}</small></div>
            <span className="jv-wa-head-actions">
              <button type="button" title="Actualizar" onClick={()=>void loadWhatsApp()}><Sparkles/></button>
              <button type="button"><Search/></button>
            </span>
          </header>
          <div className="jv-wa-messages">
            <div className="jv-wa-day">Canal privado · JARVIS-WA-001</div>
            {waCurrent.messages.map(msg =>
              <div key={String(msg.id)} className={`jv-wa-msg ${msg.type === 'outgoing' ? 'outgoing' : 'incoming'}`}>
                {msg.message || '[mensaje sin texto]'}
                <small>{waTime(msg.timestamp)}{msg.type === 'outgoing' ? ` · ${msg.status || 'enviado'}` : ''}</small>
              </div>
            )}
          </div>
          <form className="jv-wa-compose" onSubmit={e=>{e.preventDefault(); void sendWhatsAppMessage();}}>
            <button type="button" title="Adjuntos">＋</button>
            <input value={waDraft} onChange={e=>setWaDraft(e.target.value)} placeholder="Mensaje" disabled={waSending} />
            <button type="submit" disabled={waSending || !waDraft.trim()} title="Enviar"><Send/></button>
          </form>
        </> : <div className="jv-panel-empty">Selecciona una conversación.</div>}
      </section>
    </div>
  );

  const renderPanel = (id: ModuleId) => {
    if (id === 'agenda') return <>
      {events.length
        ? events.map(x => <div className="jv-row" key={x.id}><CalendarDays /><div><b>{x.title}</b><small>{fmt(x.start_at)}{x.location ? ` · ${x.location}` : ''}</small></div></div>)
        : <div className="jv-panel-empty">No hay eventos próximos.</div>}
      <button className="jv-action"><Plus /> Crear evento por voz</button>
    </>;
    if (id === 'reminders') return <>
      {items.length
        ? items.map(x => <div className="jv-row" key={x.id}><Clock3 /><div><b>{x.title}</b><small>{fmt(x.remind_at)}</small></div><CheckCircle2 className="row-action" /></div>)
        : <div className="jv-panel-empty">No hay recordatorios pendientes.</div>}
      <button className="jv-action"><Plus /> Crear recordatorio por voz</button>
    </>;
    if (id === 'correo') return <>
      <div className="jv-panel-empty">Bandeja inteligente lista para conectar tu correo.</div>
      <button className="jv-action"><Mail /> Ver bandeja</button>
      <button className="jv-action secondary"><Send /> Redactar</button>
    </>;
    if (id === 'whatsapp') return <>
      <div className="jv-wa-mini">
        <label><Search/><input value={waQuery} onChange={e=>setWaQuery(e.target.value)} placeholder="Buscar chat real" /></label>
        {waLoading && !waContacts.length && <div className="jv-panel-empty">Cargando WhatsApp…</div>}
        {waFiltered.slice(0,3).map(c => <button key={c.phone} onClick={()=>{setWaChat(c.phone); setFullscreenModule('whatsapp');}}>
          <span className="jv-wa-avatar">{c.avatar}</span><span><b>{c.name}</b><small>{c.preview}</small></span>
        </button>)}
      </div>
      <button className="jv-action" onClick={()=>setFullscreenModule('whatsapp')}><Maximize2 /> Abrir WhatsApp completo</button>
      <button className="jv-action secondary" onClick={()=>void newWhatsAppConversation()}><Send /> Nuevo mensaje</button>
    </>;
    if (id === 'facebook') return <>
      <div className="jv-panel-empty">Facebook listo para publicaciones, mensajes y seguimiento.</div>
      <button className="jv-action"><Facebook /> Abrir Facebook</button>
    </>;
    if (id === 'llamadas') return <>
      <div className="jv-call-ring"><PhoneCall /></div>
      <div className="jv-panel-empty">Módulo de llamadas listo.</div>
      <button className="jv-action"><PhoneCall /> Iniciar llamada</button>
    </>;
    return <>
      <div className="jv-search"><Search /><span>Pregunta a JARVIS y los resultados aparecerÃ¡n aquí.</span></div>
      <button className="jv-action"><Globe2 /> Nueva búsqueda</button>
    </>;
  };

  // Siempre hay exactamente 6 tarjetas visibles; la séptima queda fuera y entra al girar la ruleta.
  const rotated = Array.from({ length: 6 }, (_, i) => modules[(i + carousel) % modules.length]);

  const badge = (id: ModuleId) => {
    if (id === 'agenda')    return `Hoy ${events.length}`;
    if (id === 'reminders') return `${items.length} activos`;
    if (id === 'internet')  return 'En línea';
    // Correo sigue visual hasta conectar; WhatsApp ya usa datos reales.
    if (id === 'correo')    return '5 nuevos';
    if (id === 'whatsapp')  return waLoading && !waContacts.length ? 'Cargando…' : `${waContacts.length} chats`;
    return null;
  };

  return <div className="jv-stark" ref={stageRef}>
    <div className="jv-grid" />
    <div className="jv-scan" />
    <div className="jv-stars" />
    <div className="jv-horizon" aria-hidden="true"><i /><i /><i /><i /></div>

    {/* ------------------------------ lateral ------------------------------ */}
    <aside className={`jv-side ${menuOpen ? 'menu-open' : ''}`}>
      <button
        className="jv-menu-toggle"
        type="button"
        aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(v => !v)}>
        {menuOpen ? <X /> : <Menu />}
      </button>
      <div className="brand" translate="no">
        <b>JARVIS</b>
        <small>PERSONAL COMMAND SYSTEM</small>
        <i>Asistente personal y empresarial</i>
      </div>
      <nav>
        <button className="active" onClick={() => setMenuOpen(false)}><Home />Centro de comando</button>
        {navItems.map(n => {
          const I = n.icon;
          return <button key={n.label} onClick={() => { if (n.id) activate(n.id); setMenuOpen(false); }}><I />{n.label}</button>;
        })}
      </nav>
      <div className="lock" translate="no">
        <Lock />
        <div><b>Owner Lock</b><small>F1 Voice Core<br />Reservado</small></div>
      </div>
      <div className="jv-version" translate="no">JARVIS v1.0<small>Designed for a greater you</small></div>
    </aside>

    {/* --------------------------- widgets arriba --------------------------- */}
    <div className="jv-topwidgets">
      <div className="jv-clock">
        <b>{now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</b>
        <small>{now.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}</small>
      </div>
      <div className="jv-weather">
        <Sun />
        <div><small>Yuma, AZ</small><b>32°C</b></div>
      </div>
      <div className="jv-user">
        <span>Y</span>
        <div><b>Yaneth Caballero</b><small>Dentalux2</small></div>
      </div>
    </div>

    {/* ------------------------------ principal ----------------------------- */}
    <main className="jv-main">
      <div className="jv-earth" aria-hidden="true" />

      <section className="jv-orbit-zone">
        <div className="hud-ring ring-a" /><div className="hud-ring ring-b" /><div className="hud-ring ring-c" />

        <button className="orbit-arrow left" aria-label="Anterior"
          onClick={() => slideCarousel(-1)}><ChevronLeft /></button>

        <div className="jv-orbit"
          onPointerDown={onCarouselPointerDown}
          onPointerMove={onCarouselPointerMove}
          onPointerUp={finishCarouselSwipe}
          onPointerCancel={finishCarouselSwipe}>
          {rotated.map((m, i) => {
            const I = m.icon, slot = i - 2.5, b = badge(m.id);
            return <button key={m.id}
              className={`module-card ${m.accent} ${selected === m.id ? 'selected' : ''}`}
              style={{ '--slot': slot, '--lift': Math.abs(slot) } as React.CSSProperties}
              onPointerEnter={hoverCard}
              onClick={() => { if (!carouselSwipe.current.moved) activate(m.id); }}>
              <span className="mc-icon"><I /></span>
              <b>{m.label}</b><small>{m.sub}</small>
              {b && <em>{b}</em>}
            </button>;
          })}
        </div>

        <button className="orbit-arrow right" aria-label="Siguiente"
          onClick={() => slideCarousel(1)}><ChevronRight /></button>

        <section className="voice-core">
          <button className={listening ? 'orb listening' : 'orb'} onClick={toggleVoice} aria-label="Activar JARVIS">
            <span className="orb-halo" />
            <span className="orb-arc" />
            <span className="orb-ring" />
            <span className="orb-disc" />
            <svg className="orb-mic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="9" y="2" width="6" height="12" rx="3"/>
              <path d="M5 10a1 1 0 0 1 2 0 5 5 0 0 0 10 0 1 1 0 0 1 2 0 7 7 0 0 1-6 6.93V20h2a1 1 0 0 1 0 2H9a1 1 0 0 1 0-2h2v-3.07A7 7 0 0 1 5 10Z"/>
            </svg>
          </button>
          <h2>{voiceTitle}</h2>
          <p>{lastText || 'Pulsa el núcleo para iniciar JARVIS Realtime.'}</p>
          <div className={listening ? 'jv-wave on' : 'jv-wave'} aria-hidden="true">
            {WAVE.map((h, i) => <span key={i} style={{ height: `${h}%`, animationDelay: `${(i % 9) * 0.08}s`, '--h': `${h}%` } as React.CSSProperties} />)}
          </div>
          <div className="tags"><i>Wake: JARVIS</i><i>Voice ID</i><i>Realtime</i><i>Tools</i></div>
        </section>
      </section>

      <section className="jv-summary">
        <article>
          <h3><CalendarDays />Agenda ejecutiva ({events.length})<a onClick={() => activate('agenda')}>Ver agenda →</a></h3>
          {events.length
            ? events.slice(0, 4).map(x => <div className="rem" key={x.id}>
                <span className="dot"><CalendarDays /></span>
                <div><b>{x.title}</b><small>{fmt(x.start_at)}{x.location ? ` · ${x.location}` : ''}</small></div>
                <ChevronRight className="chev" />
              </div>)
            : <div className="empty">Agenda personal y empresarial</div>}
        </article>
        <article>
          <h3><Bell />Recordatorios ({items.length})<a onClick={() => activate('reminders')}>Ver todos →</a></h3>
          {items.length
            ? items.slice(0, 4).map(x => <div className="rem" key={x.id}>
                <span className="dot"><Clock3 /></span>
                <div><b>{x.title}</b><small>{fmt(x.remind_at)}</small></div>
                <i className={`pri ${x.priority === 'alta' ? 'high' : x.priority === 'baja' ? 'low' : ''}`} />
                <ChevronRight className="chev" />
              </div>)
            : <div className="empty">Sin recordatorios</div>}
        </article>
      </section>
    </main>

    {/* ------------------------------- derecha ------------------------------ */}
    <aside className="jv-right">
      <section className="jv-quote">
        <blockquote>“Un gran asistente convierte tus ideas en resultados.”</blockquote>
        <div className="jv-sign">— JARVIS</div>
        <div className="jv-robot-stage" aria-hidden="true">
          <picture className="jv-robot-picture">
            <source media="(max-width: 760px)" srcSet={jarvisMobile} />
            <img
              className="jv-armor-image"
              src={jarvisRobot}
              alt=""
              draggable={false}
            />
          </picture>
        </div>
        <div className="jv-modes"><b>ANALYZE</b><b>ORGANIZE</b><b>EXECUTE</b><b>SIMPLIFY</b></div>
      </section>
      <section className="jv-status">
        <h4>Estado del sistema</h4>
        <strong><i /> Todo en línea</strong>
        <div className="system-globe" aria-hidden="true"><span /><span /></div>
        <img className="jv-mobile-earth" src={jarvisEarthMobile} alt="" draggable={false} />
        <div className="meters">
          <span>IA<b>100%</b></span>
          <span>Voz<b>100%</b></span>
          <span>Servicios<b>{health?.central_connected ? '100%' : '--'}</b></span>
        </div>
        <small>“La tecnología al servicio de tus metas.”</small>
      </section>
    </aside>

    {/* --------------------------- paneles flotantes -------------------------- */}
    <div className="jv-floating-layer">
      {open.map((id, i) => {
        const m = modules.find(x => x.id === id)!; const I = m.icon; const pos = positions[id] || defaultPos(i);
        return <section key={id}
          className={`jv-float ${m.accent} ${selected === id ? 'focused' : ''}`}
          style={{ left: pos.x, top: pos.y, zIndex: selected === id ? 60 : 40 + i }}
          onPointerDown={e => { setSelected(id); beginDrag(id, e); }}>
          <header>
            <div><I /><b>{m.label}</b></div>
            <span><GripHorizontal />
              <button title="Maximizar" onClick={() => setFullscreenModule(id)}><Maximize2 /></button>
              <button title="Minimizar" onClick={() => closePanel(id, 'minimize')}><Minus /></button>
              <button title="Cerrar" onClick={() => closePanel(id, 'close')}><X /></button>
            </span>
          </header>
          <div className="jv-float-body">{renderPanel(id)}</div>
        </section>;
      })}
    </div>

    {fullscreenModule && (() => {
      const fm = modules.find(x => x.id === fullscreenModule)!;
      const FI = fm.icon;
      return <section className={`jv-module-fullscreen ${fm.accent}`}>
        <header className="jv-module-fullscreen-head">
          <div><FI/><b>{fm.label}</b><small>JARVIS · vista completa</small></div>
          <button title="Restaurar" onClick={()=>setFullscreenModule(null)}><Minimize2/></button>
        </header>
        <div className="jv-module-fullscreen-body" style={{ '--jarvis-module-bg': `url(${jarvisModuleBg})` } as React.CSSProperties}>
          {fullscreenModule === 'whatsapp'
            ? renderWhatsAppFull()
            : <div className="jv-module-coming"><FI/><h2>{fm.label}</h2><p>Interfaz completa pendiente de definir.</p></div>}
        </div>
      </section>;
    })()}

    {open.length > 0 && <button className="jv-reset" onClick={resetPanels}><Sparkles /> Reorganizar paneles</button>}
  </div>;
}

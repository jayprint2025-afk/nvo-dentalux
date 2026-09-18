import jarvisRobot from './assets/jarvis-robot.png';
import jarvisBg from './assets/jarvis-bg.png';
import React from 'react';
import {
  CalendarDays, Bell, Mail, MessageCircle, Phone, Globe2,
  Lock, X, Minus, GripHorizontal, ChevronLeft, ChevronRight,
  Plus, CheckCircle2, Clock3, Send, Search, PhoneCall, Sparkles,
  FileText, BarChart3, Settings, Home, Sun
} from 'lucide-react';
import { jarvisApi } from './lib/jarvisApi';
import { JarvisVoiceController } from './voice/JarvisVoiceController';
import './jarvis.css';

type Health = { ok: boolean; central_connected: boolean };
type Reminder = { id: string | number; title: string; remind_at: string; notes?: string; priority?: string; status?: string };
type EventItem = { id: string | number; title: string; start_at: string; end_at?: string; location?: string; notes?: string; category?: string; status?: string };
type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error';
type ModuleId = 'agenda' | 'reminders' | 'correo' | 'whatsapp' | 'llamadas' | 'internet';
type Pos = { x: number; y: number };

/* Orden del arco, igual que en el diseÃ±o:
   Correo · Agenda · Recordatorios · WhatsApp · Llamadas · Internet */
const modules: { id: ModuleId; label: string; sub: string; icon: any; accent: string }[] = [
  { id: 'correo',    label: 'Correo',        sub: 'Gestiona tu correo con IA',   icon: Mail,          accent: 'cyan'   },
  { id: 'agenda',    label: 'Agenda',        sub: 'Reuniones, citas y compromisos', icon: CalendarDays, accent: 'blue'  },
  { id: 'reminders', label: 'Recordatorios', sub: 'Nada se te olvida',           icon: Bell,          accent: 'amber'  },
  { id: 'whatsapp',  label: 'WhatsApp',      sub: 'Chats y seguimiento',         icon: MessageCircle, accent: 'green'  },
  { id: 'llamadas',  label: 'Llamadas',      sub: 'Haz y recibe llamadas con IA', icon: Phone,        accent: 'violet' },
  { id: 'internet',  label: 'Internet',      sub: 'Busca, analiza y resume',     icon: Globe2,        accent: 'indigo' },
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
  const [now, setNow] = React.useState(() => new Date());
  const voiceRef = React.useRef<JarvisVoiceController | null>(null);

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

  const toggleVoice = async () => {
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
    setSelected(id);
    if (!open.includes(id)) {
      setOpen(v => [...v, id]);
      setPositions(p => ({ ...p, [id]: p[id] || defaultPos(open.length) }));
    }
  };
  const closePanel = (id: ModuleId) => setOpen(v => v.filter(x => x !== id));
  const resetPanels = () => { setOpen([]); setPositions({}); };

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
      <div className="jv-panel-empty">Centro de WhatsApp listo para conversaciones y envíos.</div>
      <button className="jv-action"><MessageCircle /> Conversaciones</button>
      <button className="jv-action secondary"><Send /> Nuevo mensaje</button>
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

  const rotated = modules.map((_, i) => modules[(i + carousel + modules.length) % modules.length]);

  const badge = (id: ModuleId) => {
    if (id === 'agenda')    return `Hoy ${events.length}`;
    if (id === 'reminders') return `${items.length} activos`;
    if (id === 'internet')  return 'En línea';
    // Placeholders visuales hasta conectar correo/WhatsApp
    if (id === 'correo')    return '5 nuevos';
    if (id === 'whatsapp')  return '12 mensajes';
    return null;
  };

  return <div className="jv-stark">
    <div className="jv-grid" />
    <div className="jv-scan" />
    <div className="jv-stars" />
    <div className="jv-horizon" aria-hidden="true"><i /><i /><i /><i /></div>

    {/* ------------------------------ lateral ------------------------------ */}
    <aside className="jv-side">
      <div className="brand" translate="no">
        <b>JARVIS</b>
        <small>PERSONAL COMMAND SYSTEM</small>
        <i>Asistente personal y empresarial</i>
      </div>
      <nav>
        <button className="active"><Home />Centro de comando</button>
        {navItems.map(n => {
          const I = n.icon;
          return <button key={n.label} onClick={() => n.id && activate(n.id)}><I />{n.label}</button>;
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
    <main className="jv-main" style={{ '--jarvis-bg': `url(${jarvisBg})` } as React.CSSProperties}>
      <div className="jv-earth" aria-hidden="true" />

      <section className="jv-orbit-zone">
        <div className="hud-ring ring-a" /><div className="hud-ring ring-b" /><div className="hud-ring ring-c" />

        <button className="orbit-arrow left" aria-label="Anterior"
          onClick={() => setCarousel(v => (v - 1 + modules.length) % modules.length)}><ChevronLeft /></button>

        <div className="jv-orbit">
          {rotated.map((m, i) => {
            const I = m.icon, slot = i - 2.5, b = badge(m.id);
            return <button key={m.id}
              className={`module-card ${m.accent} ${selected === m.id ? 'selected' : ''}`}
              style={{ '--slot': slot, '--lift': Math.abs(slot) } as React.CSSProperties}
              onClick={() => activate(m.id)}>
              <I /><b>{m.label}</b><small>{m.sub}</small>
              {b && <em>{b}</em>}
            </button>;
          })}
        </div>

        <button className="orbit-arrow right" aria-label="Siguiente"
          onClick={() => setCarousel(v => (v + 1) % modules.length)}><ChevronRight /></button>

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
          <img
            className="jv-armor-image"
            src={jarvisRobot}
            alt=""
            draggable={false}
          />
        </div>
        <div className="jv-modes"><b>ANALYZE</b><b>ORGANIZE</b><b>EXECUTE</b><b>SIMPLIFY</b></div>
      </section>
      <section className="jv-status">
        <h4>Estado del sistema</h4>
        <strong><i /> Todo en línea</strong>
        <div className="system-globe" aria-hidden="true"><span /><span /></div>
        <div className="meters">
          <span>IA<b>100%</b></span>
          <span>Voz<b>100%</b></span>
          <span>Servicios<b>{health?.central_connected ? '100%' : '--'}</b></span>
        </div>
        <small>“La tecnologÃ­a al servicio de tus metas.”</small>
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
              <button title="Minimizar" onClick={() => closePanel(id)}><Minus /></button>
              <button title="Cerrar" onClick={() => closePanel(id)}><X /></button>
            </span>
          </header>
          <div className="jv-float-body">{renderPanel(id)}</div>
        </section>;
      })}
    </div>

    {open.length > 0 && <button className="jv-reset" onClick={resetPanels}><Sparkles /> Reorganizar paneles</button>}
  </div>;
}


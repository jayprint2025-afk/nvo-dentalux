import React from "react";
import { MessagesSquare, Send, X, Trash2, Mic, MicOff, Bell, CalendarDays, Volume2 } from "lucide-react";
import { api } from "./lib/api";
import { F1VoiceEngine, type F1VoiceEngineStatus } from "./services/f1-voice";
import { F1AudioSessionController, F1RealtimeClient, type F1AudioSnapshot } from "./services/f1-realtime";

/**
 * AIFloatingWidget
 * - Robot flotante 3D (draggable) que actúa como botón (sin círculo/CTA extra)
 * - Panel de chat con pestañas: Conversaciones | Responder | Ventas
 * - Polling ligero para ver mensajes en tiempo real (WhatsApp/web)
 *
 * Requiere en FRONTEND:
 *  - Colocar el robot en /public/robot-ia.png  (sin compresión, tal cual)
 *
 * Backend:
 *  - GET  /api/ai/conversations
 *  - POST /api/ai/conversations
 *  - GET  /api/ai/conversations/:id/messages
 *  - POST /api/ai/chat
 *  - DELETE /api/ai/conversations/:id
 *  - DELETE /api/ai/conversations
 *
 * Ventas (nuevo):
 *  - GET  /api/sales/health
 *  - GET  /api/sales/leads
 *  - POST /api/sales/leads
 *  - GET  /api/sales/leads/:id/messages
 *  - POST /api/sales/leads/:id/messages
 */

type Conversation = {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
  sucursal_id?: string | null;
};

type Msg = {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  meta?: any;
};

// ===== Ventas (CRM mini) =====
type SalesLead = {
  id: number;
  name?: string | null;
  contact?: string | null;
  source?: string | null;
  status?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
};

type SalesMsg = {
  id: number;
  lead_id: number;
  role: "user" | "assistant" | "system";
  content: string;
  created_at?: string;
  meta?: any;
};

const ROBOT_SRC = "/robot-ia.png"; // <-- poner en /public/robot-ia.png

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}


function decodeJwtIdentity(token: string) {
  try {
    const part = String(token || "").split(".")[1] || "";
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded));
    return {
      tenant: String(payload?.tenantId || payload?.tenant_id || "tenant"),
      user: String(payload?.sub || payload?.user_id || payload?.email || "user"),
    };
  } catch {
    return { tenant: "tenant", user: "user" };
  }
}

function dailyBriefingPlayedKey(date: string, branch: string) {
  const token = localStorage.getItem("dentalux_auth_token") || "";
  const identity = decodeJwtIdentity(token);
  return [
    "f1_daily_briefing_played",
    identity.tenant,
    identity.user,
    branch || "sucursal_1",
    date || "unknown-date",
  ].join(":");
}


function stripInternalJson(content: string): string {
  if (!content) return content;
  const s = String(content);

  // Si termina con un objeto JSON (p.ej. { reply, set: {...} }), lo ocultamos del UI.
  const lastBrace = s.lastIndexOf("{");
  const lastClose = s.lastIndexOf("}");
  if (lastBrace !== -1 && lastClose !== -1 && lastClose > lastBrace) {
    const tail = s.slice(lastBrace, lastClose + 1).trim();
    if (tail.startsWith("{") && tail.endsWith("}")) {
      try {
        const parsed: any = JSON.parse(tail);
        if (parsed && (parsed.reply || parsed.set || parsed.intent || parsed.contact_pref || parsed.contact_value)) {
          return s.slice(0, lastBrace).trim();
        }
      } catch {
        // ignore
      }
    }
  }

  // Por si viene en bloque fenced al final
  return s.replace(/```json[\s\S]*?```\s*$/i, "").trim();
}


export default function AIFloatingWidget(props: { apiBase?: string; sucursalId?: string; dbKey?: string; appId?: string }) {
  const env = (import.meta as any).env || {};
  const API_BASE = (
    props.apiBase ||
    env.VITE_API_BASE ||
    env.VITE_API_URL ||
    env.VITE_BACKEND_URL ||
    env.VITE_SERVER_URL ||
    ""
  ).replace(/\/$/, "");

  if (!API_BASE) {
    console.error('❌ Falta API_BASE. Configura VITE_API_BASE / VITE_BACKEND_URL en este static.');
  }

  const sucursalId = props.sucursalId;
  const dbKey = props.dbKey || (import.meta as any).env?.VITE_AI_DB || undefined;
  const appId = props.appId || (import.meta as any).env?.VITE_APP_ID || undefined;
  const waPhoneNumberId = (import.meta as any).env?.VITE_WA_PHONE_NUMBER_ID || undefined;

  const [open, setOpen] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const [tab, setTab] = React.useState<"f1" | "convs" | "chat" | "ventas">("f1");

  // Robot flotante (draggable) + persistencia
  const ROBOT_SIZE = 92; // grande y visible
  const robotKey = "ai_robot_pos_v1";

  const [robotPos, setRobotPos] = React.useState<{ x: number; y: number }>(() => {
    try {
      const raw = localStorage.getItem(robotKey);
      if (raw) {
        const j = JSON.parse(raw);
        if (typeof j?.x === "number" && typeof j?.y === "number") return j;
      }
    } catch {}
    return { x: Math.max(12, window.innerWidth - (ROBOT_SIZE + 16)), y: Math.max(12, window.innerHeight - (ROBOT_SIZE + 16)) };
  });

  React.useEffect(() => {
    try {
      localStorage.setItem(robotKey, JSON.stringify(robotPos));
    } catch {}
  }, [robotPos]);

  const robotDrag = React.useRef<{
    dragging: boolean;
    dx: number;
    dy: number;
    downX: number;
    downY: number;
    moved: number;
  }>({ dragging: false, dx: 0, dy: 0, downX: 0, downY: 0, moved: 0 });

  const clampRobotPos = React.useCallback((x: number, y: number) => {
    const nx = clamp(x, 8, window.innerWidth - ROBOT_SIZE - 8);
    const ny = clamp(y, 8, window.innerHeight - ROBOT_SIZE - 8);
    return { x: nx, y: ny };
  }, []);

  const onRobotPointerDown = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    (el as any).setPointerCapture?.(e.pointerId);

    robotDrag.current.dragging = true;
    robotDrag.current.dx = e.clientX - robotPos.x;
    robotDrag.current.dy = e.clientY - robotPos.y;
    robotDrag.current.downX = e.clientX;
    robotDrag.current.downY = e.clientY;
    robotDrag.current.moved = 0;
  };

  const onRobotPointerMove = (e: React.PointerEvent) => {
    if (!robotDrag.current.dragging) return;

    const x = e.clientX - robotDrag.current.dx;
    const y = e.clientY - robotDrag.current.dy;

    const moved = Math.hypot(e.clientX - robotDrag.current.downX, e.clientY - robotDrag.current.downY);
    robotDrag.current.moved = Math.max(robotDrag.current.moved, moved);

    setRobotPos(clampRobotPos(x, y));
  };

  const onRobotPointerUp = () => {
    if (!robotDrag.current.dragging) return;
    robotDrag.current.dragging = false;

    // Si casi no se movió, es "tap/click" → abrir/cerrar panel
    if (robotDrag.current.moved < 6) {
      setOpen((current) => {
        const next = !current;
        if (next) {
          setTab("f1");
          setF1UnreadEvents(0);
        }
        return next;
      });
    }
  };

  const closeDrawer = React.useCallback(() => {
    // Cierra con animación suave (se siente que “regresa” al robot)
    setClosing(true);
    window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 180);
  }, []);

  // Data (IA conversaciones)
  const [convs, setConvs] = React.useState<Conversation[]>([]);
  const [loadingConvs, setLoadingConvs] = React.useState(false);
  const [selectedConv, setSelectedConv] = React.useState<Conversation | null>(null);

  const [msgs, setMsgs] = React.useState<Msg[]>([]);
  const [loadingMsgs, setLoadingMsgs] = React.useState(false);

  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  // Data (Ventas)
  const [leads, setLeads] = React.useState<SalesLead[]>([]);
  const [leadsTab, setLeadsTab] = React.useState<'incomplete' | 'complete'>('incomplete');
  const [showLeadReport, setShowLeadReport] = React.useState(false);
  const [loadingLeads, setLoadingLeads] = React.useState(false);
  const [selectedLead, setSelectedLead] = React.useState<SalesLead | null>(null);
  const [leadMsgs, setLeadMsgs] = React.useState<SalesMsg[]>([]);
  const [loadingLeadMsgs, setLoadingLeadMsgs] = React.useState(false);

  const [leadName, setLeadName] = React.useState("");
  const [leadContact, setLeadContact] = React.useState("");
  const [leadNotes, setLeadNotes] = React.useState("");
  const [leadInput, setLeadInput] = React.useState("");
  const [sendingLead, setSendingLead] = React.useState(false);
  const [salesErr, setSalesErr] = React.useState<string | null>(null);

  // ===== F1 Copilot: gestión, resumen diario y voz OpenAI Realtime =====
  type F1Message = { role: "user" | "assistant"; content: string };
  const [f1Summary, setF1Summary] = React.useState<any>(null);
  const [f1Notifications, setF1Notifications] = React.useState<any[]>([]);
  const [f1Messages, setF1Messages] = React.useState<F1Message[]>([]);
  const [f1Input, setF1Input] = React.useState("");
  const [f1Sending, setF1Sending] = React.useState(false);
  const [f1Error, setF1Error] = React.useState<string | null>(null);
  const [f1LiveEvent, setF1LiveEvent] = React.useState<any>(null);
  const [f1UnreadEvents, setF1UnreadEvents] = React.useState(0);
  const [f1StreamConnected, setF1StreamConnected] = React.useState(false);
  const f1StreamAbortRef = React.useRef<AbortController | null>(null);
  const f1StreamRetryRef = React.useRef<number | null>(null);
  const [voiceConnected, setVoiceConnected] = React.useState(false);
  const [voiceConnecting, setVoiceConnecting] = React.useState(false);
  const [voiceTranscript, setVoiceTranscript] = React.useState("");
  const [f1VoiceEngineEnabled, setF1VoiceEngineEnabled] = React.useState(() => {
    return localStorage.getItem("f1_voice_engine_enabled") === "1";
  });
  const [f1VoiceEngineStatus, setF1VoiceEngineStatus] =
    React.useState<F1VoiceEngineStatus>("idle");
  const [f1VoiceEngineDetail, setF1VoiceEngineDetail] = React.useState("");
  const f1VoiceEngineRef = React.useRef<F1VoiceEngine | null>(null);
  const [briefingPlaying, setBriefingPlaying] = React.useState(false);
  const [briefingLoading, setBriefingLoading] = React.useState(false);
  const [briefingText, setBriefingText] = React.useState("");
  const [dailyBriefingEnabled, setDailyBriefingEnabled] = React.useState(() => {
    return localStorage.getItem("f1_daily_briefing_enabled") !== "0";
  });
  const autoBriefingAttemptedRef = React.useRef(false);
  const briefingAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const briefingObjectUrlRef = React.useRef<string | null>(null);
  const peerRef = React.useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = React.useRef<RTCDataChannel | null>(null);
  const executedRealtimeCallsRef = React.useRef<Set<string>>(new Set());
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const mediaRef = React.useRef<MediaStream | null>(null);
  const sessionControllerRef = React.useRef<F1AudioSessionController | null>(null);

  const headers = React.useMemo(() => {
    const h: Record<string, string> = { "content-type": "application/json" };
    const token = localStorage.getItem("dentalux_auth_token") || "";
    if (token) h.Authorization = `Bearer ${token}`;
    if (sucursalId) h["x-sucursal"] = sucursalId;
    if (dbKey) h["x-db"] = String(dbKey);
    if (appId) h["x-app"] = String(appId);
    if (waPhoneNumberId) h["x-wa-phone-number-id"] = String(waPhoneNumberId);
    return h;
  }, [sucursalId, dbKey, appId, waPhoneNumberId]);

  const loadConvs = React.useCallback(async () => {
    try {
      setLoadingConvs(true);
      setErr(null);
      const r = await fetch(`${API_BASE}/api/ai/conversations`, { headers });
      const j = await r.json().catch(() => []);
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setConvs(Array.isArray(j) ? j : []);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoadingConvs(false);
    }
  }, [API_BASE, headers]);

  const loadMsgs = React.useCallback(
    async (conversationId: number) => {
      try {
        setLoadingMsgs(true);
        setErr(null);
        const r = await fetch(`${API_BASE}/api/ai/conversations/${conversationId}/messages`, { headers });
        const j = await r.json().catch(() => []);
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        setMsgs(Array.isArray(j) ? j : []);
      } catch (e: any) {
        setErr(e?.message || String(e));
      } finally {
        setLoadingMsgs(false);
      }
    },
    [API_BASE, headers]
  );

  // Polling ligero (sin spinners)
  const loadConvsSilent = React.useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/ai/conversations`, { headers });
      const j = await r.json().catch(() => []);
      if (r.ok) setConvs(Array.isArray(j) ? j : []);
    } catch {}
  }, [API_BASE, headers]);

  const loadMsgsSilent = React.useCallback(async (conversationId: number) => {
    try {
      const r = await fetch(`${API_BASE}/api/ai/conversations/${conversationId}/messages`, { headers });
      const j = await r.json().catch(() => []);
      if (r.ok) setMsgs(Array.isArray(j) ? j : []);
    } catch {}
  }, [API_BASE, headers]);

  // ===== Ventas API =====
  const loadLeads = React.useCallback(async () => {
    try {
      setLoadingLeads(true);
      setSalesErr(null);

      const r = await fetch(`${API_BASE}/api/sales/leads`, { headers });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);

      const list = Array.isArray(j?.leads) ? j.leads : [];
      setLeads(list);

      // Selección estable: NO cambiar el lead seleccionado en cada refresh (evita "rebote")
      // - Si NO hay seleccionado, elegimos uno según la pestaña actual
      // - Si SÍ hay seleccionado, solo actualizamos su referencia (si aún existe)
      const isCompleteLocal = (l: any) => {
        const status = String(l?.status || "").toLowerCase();
        if (status === "completed") return true;
        if (status === "incomplete") return false;
        const p = l?.profile || {};
        return Boolean(p?.intent && p?.branches && p?.doctors && p?.name && p?.contact_pref && p?.contact_value);
      };

      const pickForTab = () => {
        if (!list.length) return null;
        if (leadsTab === "complete") {
          return list.find((x: any) => isCompleteLocal(x)) || list[0];
        }
        // incompletos
        return list.find((x: any) => !isCompleteLocal(x)) || list[0];
      };

      setSelectedLead((prev: any) => {
        if (!prev) return pickForTab();
        const updated = list.find((x: any) => x.id === prev.id);
        return updated || prev;
      });
    } catch (e: any) {
      setSalesErr(e?.message || String(e));
    } finally {
      setLoadingLeads(false);
    }
  }, [API_BASE, headers, leadsTab]);

const isLeadComplete = React.useCallback((l: any) => {
  const status = String(l?.status || "").toLowerCase();
  if (status === "completed") return true;
  if (status === "incomplete") return false;
  const p = l?.profile || {};
  return Boolean(p?.intent && p?.branches && p?.doctors && p?.name && p?.contact_pref && p?.contact_value);
}, []);

const filteredLeads = React.useMemo(() => {
  return (leads || []).filter((l: any) => {
    const complete = isLeadComplete(l);
    return leadsTab === "complete" ? complete : !complete;
  });
}, [leads, leadsTab, isLeadComplete]);


// Si el usuario cambia de pestaña (Incompletos/Completos), limpiamos la selección
// para evitar saltos visuales y dejar la pantalla lista para un nuevo lead.
React.useEffect(() => {
  if (!selectedLead) return;
  const complete = isLeadComplete(selectedLead);
  const wantsComplete = leadsTab === "complete";
  if (complete !== wantsComplete) setSelectedLead(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [leadsTab]);
const buildLeadReport = React.useCallback(() => {
  const all = leads || [];
  const complete = all.filter(isLeadComplete);
  const incomplete = all.filter((l: any) => !isLeadComplete(l));
  const conv = all.length ? complete.length / all.length : 0;

  const topSources: Record<string, number> = {};
  for (const l of all) {
    const s = String(l?.source || "unknown");
    topSources[s] = (topSources[s] || 0) + 1;
  }
  const sourcesSorted = Object.entries(topSources)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const lines: string[] = [];
  lines.push("📊 REPORTE LEADS (CliniqOne)");
  lines.push(`Total leads: ${all.length}`);
  lines.push(`Completos: ${complete.length}`);
  lines.push(`Incompletos: ${incomplete.length}`);
  lines.push(`Conversión: ${(conv * 100).toFixed(1)}%`);

  if (sourcesSorted.length) {
    lines.push("");
    lines.push("Top fuentes:");
    for (const [k, v] of sourcesSorted) lines.push(`- ${k}: ${v}`);
  }

  lines.push("");
  lines.push("✅ Completos (últimos 15):");
  complete.slice(0, 15).forEach((l: any) => {
    const p = l?.profile || {};
    const name = p?.name || l?.name || "—";
    const branches = p?.branches ?? "—";
    const doctors = p?.doctors ?? "—";
    const contact = p?.contact_value || l?.contact || "—";
    lines.push(`- ${name} | suc: ${branches} | docs: ${doctors} | contacto: ${contact}`);
  });

  lines.push("");
  lines.push("⚠️ Incompletos (últimos 15):");
  incomplete.slice(0, 15).forEach((l: any) => {
    const name = l?.name || `Lead #${l?.id ?? "—"}`;
    const last = new Date(l?.updated_at || l?.created_at || Date.now()).toISOString().slice(0, 10);
    lines.push(`- ${name} | último mov: ${last}`);
  });

  return lines.join("\n");
}, [leads, isLeadComplete]);


  const loadLeadMsgs = React.useCallback(
    async (leadId: number) => {
      try {
        setLoadingLeadMsgs(true);
        setSalesErr(null);
        const r = await fetch(`${API_BASE}/api/sales/leads/${leadId}/messages`, { headers });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        setLeadMsgs(Array.isArray(j?.messages) ? j.messages : []);
      } catch (e: any) {
        setSalesErr(e?.message || String(e));
      } finally {
        setLoadingLeadMsgs(false);
      }
    },
    [API_BASE, headers]
  );

  const createLead = React.useCallback(async () => {
    try {
      setSalesErr(null);
      const r = await fetch(`${API_BASE}/api/sales/leads`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: leadName || null,
          contact: leadContact || null,
          notes: leadNotes || null,
          source: "widget",
          status: "new",
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);

      setLeadName("");
      setLeadContact("");
      setLeadNotes("");

      await loadLeads();
      if (j?.lead?.id) {
        setSelectedLead(j.lead);
        await loadLeadMsgs(j.lead.id);
      }
    } catch (e: any) {
      setSalesErr(e?.message || String(e));
    }
  }, [API_BASE, headers, leadName, leadContact, leadNotes, loadLeads, loadLeadMsgs]);

  const sendLead = React.useCallback(async () => {
    const text = leadInput.trim();
    if (!text || !selectedLead?.id) return;

    try {
      setSendingLead(true);
      setSalesErr(null);

      // UI optimista
      const tempId = Date.now();
      setLeadMsgs((m) => [...m, { id: tempId, lead_id: selectedLead.id, role: "user", content: text, created_at: new Date().toISOString() } as any]);
      setLeadInput("");

      const r = await fetch(`${API_BASE}/api/sales/leads/${selectedLead.id}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message: text, meta: { ui: "AIFloatingWidget" } }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);

      // ✅ v6 backend: reset por inactividad -> limpiar chat y cambiar al nuevo lead
      if (j?.reset && j?.new_lead_id) {
        const newId = Number(j.new_lead_id);
        setLeadMsgs([]);
        await loadLeads();
        setSelectedLead({ id: newId } as any);
        await loadLeadMsgs(newId);
        return;
      }

      await loadLeadMsgs(selectedLead.id);
      await loadLeads();

      // ✅ v6 backend: conversación completada -> limpiar y crear lead nuevo tras unos segundos
      if (j?.completed) {
        const secs = Number(j?.reset_after_seconds ?? 20);
        // deja la pantalla lista inmediatamente para el siguiente cliente
        setLeadMsgs([]);
        setSelectedLead(null);
        setLeadsTab('incomplete');

        window.setTimeout(async () => {
          try {
            const r2 = await fetch(`${API_BASE}/api/sales/leads`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                name: null,
                contact: null,
                notes: "auto-new lead after completion",
                source: "widget",
                status: "new",
              }),
            });
            const j2 = await r2.json().catch(() => ({}));
            if (r2.ok && j2?.lead?.id) {
              setLeadMsgs([]);
              setSelectedLead(j2.lead);
              await loadLeads();
              await loadLeadMsgs(j2.lead.id);
            } else {
              setLeadMsgs([]);
              setSelectedLead(null);
              await loadLeads();
            }
          } catch {
            setLeadMsgs([]);
          }
        }, Math.max(2, secs) * 1000);
      }
    } catch (e: any) {
      setSalesErr(e?.message || String(e));
    } finally {
      setSendingLead(false);
    }
  }, [API_BASE, headers, leadInput, selectedLead?.id, loadLeadMsgs, loadLeads]);

  const loadF1Dashboard = React.useCallback(async () => {
    try {
      setF1Error(null);
      const data: any = await api(`/f1/notifications?branch_key=${encodeURIComponent(sucursalId || "sucursal_1")}`);
      setF1Summary(data?.summary || null);
      setF1Notifications(Array.isArray(data?.notifications) ? data.notifications : []);
    } catch (error: any) {
      setF1Error(error?.message || String(error));
    }
  }, [sucursalId]);


  const applyF1ClientActions = React.useCallback((actions: any[]) => {
    for (const action of actions || []) {
      const result = action?.result || action;
      const clientAction = result?.client_action;
      const clientEvent = result?.client_event;

      if (clientAction?.type === 'navigate' && clientAction?.target) {
        window.dispatchEvent(new CustomEvent('cliniqone:f1-navigate', {
          detail: { target: String(clientAction.target) },
        }));
      }

      if (clientEvent?.type === 'appointments_changed') {
        window.dispatchEvent(new CustomEvent('dentalux:appointments-changed', {
          detail: {
            source: 'f1',
            appointment_id: clientEvent.appointment_id || null,
          },
        }));
      }

      if (clientEvent?.type === 'finance_changed') {
        window.dispatchEvent(new CustomEvent('dentalux:finance-changed', {
          detail: {
            source: 'f1',
            area: clientEvent.area || null,
            movement_id: clientEvent.movement_id || null,
          },
        }));
      }
    }
  }, []);

  const describeF1Event = React.useCallback((event: any) => {
    const payload = event?.payload || {};
    const patient = String(payload?.patient || "La cita");
    const time = payload?.start_time ? String(payload.start_time).slice(0, 5) : "";

    switch (String(event?.name || "")) {
      case "appointment.created":
        return `${patient} fue agendado${time ? ` a las ${time}` : ""}.`;
      case "appointment.confirmed":
        return `${patient} confirmó su cita${time ? ` de las ${time}` : ""}.`;
      case "appointment.cancelled":
        return `La cita de ${patient} fue cancelada${time ? `; se liberó el horario de las ${time}` : ""}.`;
      case "appointment.rescheduled":
        return `La cita de ${patient} fue reagendada${time ? ` para las ${time}` : ""}.`;
      case "appointment.updated":
        return `La cita de ${patient} fue actualizada.`;
      case "payment.created":
        return `Se registró un pago de $${Number(payload?.amount || 0).toFixed(2)} de ${String(payload?.patient || "un paciente")} en ${String(payload?.payment_method || "Caja")}.`;
      case "expense.created":
        return `Se registró un gasto de $${Number(payload?.amount || 0).toFixed(2)} por ${String(payload?.concept || "un concepto")}.`;
      default:
        return "";
    }
  }, []);

  const handleF1LiveEvent = React.useCallback(async (event: any) => {
    if (!event?.name) return;

    setF1LiveEvent(event);
    if (!open || tab !== "f1") {
      setF1UnreadEvents((current) => Math.min(current + 1, 99));
    }
    const message = describeF1Event(event);

    if (message) {
      setF1Messages((current) => [
        ...current.slice(-30),
        { role: "assistant", content: message },
      ]);
    }

    if (String(event.name).startsWith("appointment.")) {
      window.dispatchEvent(new CustomEvent("dentalux:appointments-changed", {
        detail: {
          source: "event-bus",
          event_name: event.name,
          appointment_id: event?.payload?.appointment_id || null,
        },
      }));
    }

    if (event.name === "payment.created" || event.name === "expense.created") {
      window.dispatchEvent(new CustomEvent("dentalux:finance-changed", {
        detail: {
          source: "event-bus",
          event_name: event.name,
          movement_id: event?.payload?.payment_id || event?.payload?.expense_id || null,
        },
      }));
    }

    await loadF1Dashboard();
  }, [describeF1Event, loadF1Dashboard, open, tab]);

  const connectF1EventStream = React.useCallback(() => {
    const token = localStorage.getItem("dentalux_auth_token") || "";
    if (!token || !API_BASE) return () => {};

    f1StreamAbortRef.current?.abort();
    if (f1StreamRetryRef.current != null) {
      window.clearTimeout(f1StreamRetryRef.current);
      f1StreamRetryRef.current = null;
    }

    const controller = new AbortController();
    f1StreamAbortRef.current = controller;
    let stopped = false;

    const start = async () => {
      try {
        const branchKey = sucursalId || "sucursal_1";
        const response = await fetch(
          `${API_BASE}/api/f1/events/stream?branch_key=${encodeURIComponent(branchKey)}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "text/event-stream",
              "x-sucursal": branchKey,
            },
            cache: "no-store",
            signal: controller.signal,
          }
        );

        if (!response.ok || !response.body) {
          throw new Error(`Event Stream HTTP ${response.status}`);
        }

        setF1StreamConnected(true);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let boundary = buffer.indexOf("\n\n");

          while (boundary !== -1) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");

            if (!block.trim() || block.startsWith(":")) continue;

            let eventName = "message";
            const dataLines: string[] = [];

            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) eventName = line.slice(6).trim();
              if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
            }

            if (eventName === "f1-event" && dataLines.length) {
              try {
                const event = JSON.parse(dataLines.join("\n"));
                void handleF1LiveEvent(event);
              } catch {}
            }
          }
        }

        if (!stopped) throw new Error("Event Stream desconectado");
      } catch (error: any) {
        setF1StreamConnected(false);
        if (stopped || error?.name === "AbortError") return;

        f1StreamRetryRef.current = window.setTimeout(() => {
          if (!stopped) void start();
        }, 3000);
      }
    };

    void start();

    return () => {
      stopped = true;
      controller.abort();
      if (f1StreamRetryRef.current != null) {
        window.clearTimeout(f1StreamRetryRef.current);
        f1StreamRetryRef.current = null;
      }
      setF1StreamConnected(false);
    };
  }, [API_BASE, sucursalId, handleF1LiveEvent]);

  React.useEffect(() => {
    const disconnect = connectF1EventStream();
    return disconnect;
  }, [connectF1EventStream]);

  const stopDailyBriefing = React.useCallback(() => {
    const audio = briefingAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.src = "";
    }
    if (briefingObjectUrlRef.current) {
      URL.revokeObjectURL(briefingObjectUrlRef.current);
      briefingObjectUrlRef.current = null;
    }
    setBriefingPlaying(false);
    setBriefingLoading(false);
    if (sessionControllerRef.current?.snapshot.state === "BRIEFING_PLAYING") {
      void sessionControllerRef.current.endBriefing();
    }
  }, []);

  const playDailyBriefing = React.useCallback(async (options?: {
    automatic?: boolean;
    briefingData?: any;
  }) => {
    const automatic = Boolean(options?.automatic);

    if (briefingPlaying || briefingLoading) {
      if (!automatic) stopDailyBriefing();
      return;
    }

    try {
      setBriefingLoading(true);
      setF1Error(null);

      await sessionControllerRef.current?.beginBriefing();

      const token = localStorage.getItem("dentalux_auth_token") || "";
      if (!token) throw new Error("Inicia sesión nuevamente para escuchar el resumen.");

      const branchKey = sucursalId || "sucursal_1";
      const textData: any = options?.briefingData || await api(
        `/f1/daily-briefing?branch_key=${encodeURIComponent(branchKey)}`
      );
      const briefingDate = String(textData?.date || "");
      const playedKey = dailyBriefingPlayedKey(briefingDate, branchKey);

      // La reproducción automática ocurre una sola vez por
      // empresa + usuario + sucursal + fecha.
      if (automatic && localStorage.getItem(playedKey) === "1") return;

      setBriefingText(String(textData?.briefing || ""));

      const response = await fetch(`${API_BASE}/api/f1/daily-briefing/audio`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "x-sucursal": branchKey,
        },
        body: JSON.stringify({
          branch_key: branchKey,
          date: briefingDate || undefined,
        }),
      });

      if (!response.ok) {
        const details = await response.text();
        throw new Error(details || `HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      if (briefingObjectUrlRef.current) URL.revokeObjectURL(briefingObjectUrlRef.current);
      briefingObjectUrlRef.current = objectUrl;

      const audio = briefingAudioRef.current || new Audio();
      briefingAudioRef.current = audio;
      audio.src = objectUrl;
      audio.onended = () => {
        setBriefingPlaying(false);
        if (briefingObjectUrlRef.current) {
          URL.revokeObjectURL(briefingObjectUrlRef.current);
          briefingObjectUrlRef.current = null;
        }
        void sessionControllerRef.current?.endBriefing();
      };
      audio.onerror = () => {
        setBriefingPlaying(false);
        setF1Error("No fue posible reproducir el resumen diario.");
        void sessionControllerRef.current?.endBriefing();
      };

      await audio.play();

      // Marcar únicamente después de que el navegador realmente inició el audio.
      localStorage.setItem(playedKey, "1");
      setBriefingPlaying(true);
    } catch (error: any) {
      stopDailyBriefing();

      // El autoplay puede ser bloqueado por el navegador. En ese caso dejamos
      // disponible el botón manual sin mostrar un error técnico molesto.
      const message = error?.message || String(error);
      if (!automatic || !/play\(\)|autoplay|user gesture|notallowed/i.test(message)) {
        setF1Error(message);
      }
    } finally {
      setBriefingLoading(false);
    }
  }, [
    API_BASE,
    sucursalId,
    briefingPlaying,
    briefingLoading,
    stopDailyBriefing,
    f1VoiceEngineEnabled,
  ]);

  const toggleDailyBriefing = React.useCallback(() => {
    setDailyBriefingEnabled((current) => {
      const next = !current;
      localStorage.setItem("f1_daily_briefing_enabled", next ? "1" : "0");
      if (!next) stopDailyBriefing();
      return next;
    });
  }, [stopDailyBriefing]);

  // Intenta reproducir el briefing una sola vez al día. Debido a las reglas de
  // Chrome/Edge, espera la primera interacción del usuario con la aplicación.
  React.useEffect(() => {
    if (!dailyBriefingEnabled || autoBriefingAttemptedRef.current) return;

    let cancelled = false;
    let timer: number | null = null;

    const begin = async () => {
      if (cancelled || autoBriefingAttemptedRef.current) return;
      autoBriefingAttemptedRef.current = true;

      try {
        const branchKey = sucursalId || "sucursal_1";
        const data: any = await api(
          `/f1/daily-briefing?branch_key=${encodeURIComponent(branchKey)}`
        );
        const playedKey = dailyBriefingPlayedKey(String(data?.date || ""), branchKey);
        if (localStorage.getItem(playedKey) === "1") return;

        timer = window.setTimeout(() => {
          if (!cancelled && !voiceConnected && !voiceConnecting) {
            void playDailyBriefing({ automatic: true, briefingData: data });
          }
        }, 450);
      } catch {
        // No bloquear el resto de F1 si el briefing no está disponible.
      }
    };

    const onFirstInteraction = () => {
      window.removeEventListener("pointerdown", onFirstInteraction, true);
      window.removeEventListener("keydown", onFirstInteraction, true);
      void begin();
    };

    const userActivation = (navigator as any).userActivation;
    if (userActivation?.hasBeenActive) {
      void begin();
    } else {
      window.addEventListener("pointerdown", onFirstInteraction, true);
      window.addEventListener("keydown", onFirstInteraction, true);
    }

    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      window.removeEventListener("pointerdown", onFirstInteraction, true);
      window.removeEventListener("keydown", onFirstInteraction, true);
    };
  }, [
    dailyBriefingEnabled,
    sucursalId,
    voiceConnected,
    voiceConnecting,
    playDailyBriefing,
  ]);

  const sendF1Text = React.useCallback(async () => {
    const message = f1Input.trim();
    if (!message || f1Sending) return;
    const nextHistory: F1Message[] = [...f1Messages, { role: "user", content: message }];
    setF1Messages(nextHistory);
    setF1Input("");
    setF1Sending(true);
    setF1Error(null);
    try {
      const result: any = await api('/f1/chat', {
        method: 'POST',
        body: JSON.stringify({
          message,
          branch_key: sucursalId || 'sucursal_1',
          history: f1Messages.slice(-10),
        }),
      });
      setF1Messages(current => [...current, { role: "assistant", content: String(result?.reply || 'Listo.') }]);
      if (Array.isArray(result?.actions) && result.actions.length) {
        applyF1ClientActions(result.actions);
        await loadF1Dashboard();
      }
    } catch (error: any) {
      setF1Error(error?.message || String(error));
    } finally {
      setF1Sending(false);
    }
  }, [f1Input, f1Sending, f1Messages, sucursalId, loadF1Dashboard, applyF1ClientActions]);

  const executeRealtimeTool = React.useCallback(async (name: string, callId: string, argumentsJson: string) => {
    let args: any = {};
    try { args = JSON.parse(argumentsJson || '{}'); } catch {}
    const output: any = await api('/f1/actions', {
      method: 'POST',
      body: JSON.stringify({ name, arguments: args, call_id: callId, branch_key: sucursalId || 'sucursal_1' }),
    });
    applyF1ClientActions([output]);
    await loadF1Dashboard();
    return output;
  }, [sucursalId, loadF1Dashboard, applyF1ClientActions]);

  const connectVoice = React.useCallback(async () => {
    await sessionControllerRef.current?.startManualConversation();
  }, []);

  React.useEffect(() => {
    const modelUrl = String((import.meta as any).env?.VITE_F1_WAKE_MODEL_URL || "/models/hola-f1/hola-f1.onnx").trim();
    let controller: F1AudioSessionController;
    const engine = new F1VoiceEngine({
      phrase: "Hola F1",
      modelUrl,
      threshold: 0.35,
      cooldownMs: 5000,
      onStatus: (status, detail) => {
        setF1VoiceEngineStatus(status);
        setF1VoiceEngineDetail(String(detail || ""));
      },
      onWake: () => { void controller.wakeDetected(); },
    });
    f1VoiceEngineRef.current = engine;

    const handleSnapshot = (snapshot: F1AudioSnapshot) => {
      const realtime = snapshot.state.startsWith("REALTIME_") && snapshot.state !== "REALTIME_DISCONNECTING";
      setVoiceConnected(realtime && snapshot.state !== "REALTIME_CONNECTING");
      setVoiceConnecting(snapshot.state === "REALTIME_CONNECTING");
      if (snapshot.transcript) setVoiceTranscript(snapshot.transcript);
      setF1VoiceEngineDetail(snapshot.detail);
    };

    controller = new F1AudioSessionController({
      wakeEngine: engine,
      onSnapshot: handleSnapshot,
      onOpenWidget: () => { setOpen(true); setTab("f1"); },
      followupTimeoutMs: 6000,
      inactivityTimeoutMs: 15000,
      maxSessionMs: 120000,
      createRealtimeClient: () => new F1RealtimeClient({
        apiBase: API_BASE,
        branchKey: sucursalId || "sucursal_1",
        getToken: () => localStorage.getItem("dentalux_auth_token") || "",
        callbacks: {
          onConnected: () => controller.onConnected(),
          onGreetingDone: () => controller.onGreetingDone(),
          onUserSpeechStarted: () => controller.onUserSpeechStarted(),
          onUserTranscript: (text) => {
            controller.onUserTranscript(text);
            setF1Messages(current => [...current, { role: "user", content: text }]);
          },
          onAssistantSpeechStarted: () => controller.onAssistantSpeechStarted(),
          onAssistantTranscriptDelta: (delta) => controller.onAssistantTranscriptDelta(delta),
          onAssistantTranscriptDone: (text) => {
            controller.onAssistantTranscriptDone(text);
            setF1Messages(current => [...current, { role: "assistant", content: text }]);
          },
          onResponseDone: () => controller.onResponseDone(),
          onToolCall: ({ name, callId, argumentsJson }) => executeRealtimeTool(name, callId, argumentsJson),
          onError: (error) => { setF1Error(error.message); controller.onRealtimeError(error); },
          onClosed: () => controller.onRealtimeClosed(),
        },
      }),
    });
    sessionControllerRef.current = controller;
    if (f1VoiceEngineEnabled) void controller.enable();

    return () => {
      sessionControllerRef.current = null;
      f1VoiceEngineRef.current = null;
      void controller.dispose();
    };
  }, [API_BASE, sucursalId, executeRealtimeTool]);

  const toggleF1VoiceEngine = React.useCallback(() => {
    setF1VoiceEngineEnabled((current) => {
      const next = !current;
      localStorage.setItem("f1_voice_engine_enabled", next ? "1" : "0");
      if (next) void sessionControllerRef.current?.enable();
      else void sessionControllerRef.current?.disable();
      return next;
    });
  }, []);

  React.useEffect(() => {
    loadF1Dashboard();

    const refreshNow = () => { void loadF1Dashboard(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshNow();
    };

    // Actualización inmediata cuando Agenda crea, confirma, cancela,
    // reagenda o elimina una cita.
    window.addEventListener('dentalux:appointments-changed', refreshNow);
    window.addEventListener('focus', refreshNow);
    document.addEventListener('visibilitychange', onVisibility);

    // Respaldo ligero por si el cambio llegó desde WhatsApp/Messenger.
    const timer = window.setInterval(refreshNow, 10000);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('dentalux:appointments-changed', refreshNow);
      window.removeEventListener('focus', refreshNow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadF1Dashboard]);

  React.useEffect(() => () => stopDailyBriefing(), [stopDailyBriefing]);
  React.useEffect(() => () => {
    f1StreamAbortRef.current?.abort();
    if (f1StreamRetryRef.current != null) {
      window.clearTimeout(f1StreamRetryRef.current);
    }
  }, []);

  // ===== Effects IA =====
  React.useEffect(() => {
    if (!open) return;
    loadConvs();
  }, [open, loadConvs]);

  React.useEffect(() => {
    if (!open) return;
    const t = setInterval(() => loadConvsSilent(), 3000);
    return () => clearInterval(t);
  }, [open, loadConvsSilent]);

  React.useEffect(() => {
    if (!open) return;
    if (selectedConv?.id) loadMsgs(selectedConv.id);
  }, [open, selectedConv?.id, loadMsgs]);

  React.useEffect(() => {
    if (!open) return;
    const id = selectedConv?.id;
    if (!id) return;
    const t = setInterval(() => loadMsgsSilent(id), 2000);
    return () => clearInterval(t);
  }, [open, selectedConv?.id, loadMsgsSilent]);

  // ===== Effects Ventas =====
  React.useEffect(() => {
    if (!open) return;
    if (tab !== "ventas") return;
    loadLeads();
  }, [open, tab, loadLeads]);

  React.useEffect(() => {
    if (!open) return;
    if (tab !== "ventas") return;
    if (!selectedLead?.id) return;
    loadLeadMsgs(selectedLead.id);
  }, [open, tab, selectedLead?.id, loadLeadMsgs]);

  const newConversation = async () => {
    try {
      setErr(null);
      const title = prompt("Nombre de la conversación (opcional):") || "";
      const r = await fetch(`${API_BASE}/api/ai/conversations`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      await loadConvs();
      setSelectedConv(j as Conversation);
      setTab("chat");
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  };

  const deleteConversation = React.useCallback(
    async (id: number) => {
      const c = convs.find((x) => x.id === id);
      const label = c?.title ? `"${c.title}"` : `#${id}`;
      if (!window.confirm(`¿Eliminar la conversación ${label}?\n\nEsto borrará también sus mensajes.`)) return;

      try {
        setErr(null);
        const r = await fetch(`${API_BASE}/api/ai/conversations/${id}`, { method: "DELETE", headers });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);

        if (selectedConv?.id === id) {
          setSelectedConv(null);
          setMsgs([]);
          setTab("convs");
        }
        await loadConvsSilent();
      } catch (e: any) {
        setErr(e?.message || String(e));
      }
    },
    [API_BASE, headers, convs, selectedConv?.id, loadConvsSilent]
  );

  const deleteAllConversations = React.useCallback(async () => {
    if (!window.confirm("¿Eliminar TODAS las conversaciones visibles?\n\nEsta acción no se puede deshacer.")) return;

    try {
      setErr(null);
      const r = await fetch(`${API_BASE}/api/ai/conversations`, { method: "DELETE", headers });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);

      setSelectedConv(null);
      setMsgs([]);
      setTab("convs");
      await loadConvsSilent();
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }, [API_BASE, headers, loadConvsSilent]);

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    try {
      setSending(true);
      setErr(null);

      let convId = selectedConv?.id;
      if (!convId) {
        const r0 = await fetch(`${API_BASE}/api/ai/conversations`, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "Nueva conversación" }),
        });
        const j0 = await r0.json().catch(() => ({}));
        if (!r0.ok) throw new Error(j0?.error || `HTTP ${r0.status}`);
        convId = j0.id;
        setSelectedConv(j0);
        await loadConvs();
      }

      // UI optimista
      const tempId = Date.now();
      setMsgs((m) => [...m, { id: tempId, role: "user", content: text, created_at: new Date().toISOString() } as any]);
      setInput("");

      const r = await fetch(`${API_BASE}/api/ai/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({ conversationId: convId, message: text }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);

      await loadMsgs(convId!);
      await loadConvs();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* Animaciones premium del robot (float + breathe + glow + blink) */}
      <style>
        {`
          @keyframes aiFloatBreathe {
            0%, 100% {
              transform: translateY(2px) scale(0.985);
              filter:
                drop-shadow(0 10px 18px rgba(0, 140, 255, 0.18))
                drop-shadow(0 0 10px rgba(0, 200, 255, 0.14));
            }
            50% {
              transform: translateY(-5px) scale(1);
              filter:
                drop-shadow(0 14px 22px rgba(0, 140, 255, 0.26))
                drop-shadow(0 0 14px rgba(0, 200, 255, 0.20));
            }
          }

          @keyframes aiBlinkOverlay {
            0%, 6%, 100% { opacity: 0; }
            7% { opacity: 0.18; }
            8% { opacity: 0; }
            44%, 45% { opacity: 0; }
            46% { opacity: 0.14; }
            47% { opacity: 0; }
          }

          @keyframes aiGlowPulse {
            0%, 100% {
              box-shadow: 0 0 0 rgba(0,0,0,0);
            }
            50% {
              box-shadow:
                0 0 18px rgba(0, 180, 255, 0.18),
                0 0 42px rgba(60, 120, 255, 0.10);
            }
          }

          .aiRobotWrap {
            position: relative;
            width: 100%;
            height: 100%;
            border-radius: 9999px;
            animation: aiGlowPulse 3.2s ease-in-out infinite;
            will-change: transform, filter, box-shadow;
          }

          .aiRobotImg {
            width: 100%;
            height: 100%;
            object-fit: contain;
            animation: aiFloatBreathe 3.2s ease-in-out infinite;
            transform-origin: 50% 70%;
            will-change: transform, filter;
            pointer-events: none; /* para que el drag/click lo maneje el contenedor */
            user-select: none;
          }

          .aiBlink {
            position: absolute;
            inset: 0;
            pointer-events: none;
            opacity: 0;
            animation: aiBlinkOverlay 6.5s infinite;
            background:
              radial-gradient(ellipse at 50% 30%,
                rgba(0,0,0,0.18),
                rgba(0,0,0,0) 55%);
          }

          /* Ventas mini CRM */
          .salesGrid {
            display: grid;
            grid-template-columns: 260px 1fr;
            height: 100%;
          }
          .salesLeft {
            border-right: 1px solid #e5e7eb;
            padding: 10px;
            overflow: auto;
            background: #fff;
          }
          .salesRight {
            padding: 10px;
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow: hidden;
          }
          .aiDrawer{
            right: 12px;
            bottom: 108px;
            width: min(920px, calc(100vw - 24px));
            height: min(82vh, 760px);
            border-radius: 16px;
            background: rgba(255,255,255,0.98);
            backdrop-filter: blur(10px);
            transform: translateY(0) scale(1);
            opacity: 1;
            transition: transform 180ms ease, opacity 180ms ease;
          }

          .aiDrawer.closing{
            transform: translateY(14px) scale(0.96);
            opacity: 0;
          }

          .aiHeader{
            position: sticky;
            top: 0;
            z-index: 20;
            background: rgba(249,250,251,0.98); /* match bg-gray-50 */
            padding-top: env(safe-area-inset-top);
          }

          /* Botón flotante de minimizar/cerrar SIEMPRE visible en móvil */
          .aiCloseFloat{
            display: none;
          }

          /* Mejor UX en móviles: pantalla completa */

          @media (max-width: 520px){
            .aiDrawer{
              right: 0;
              bottom: 0;
              width: 100vw;
              height: 100vh;
              border-radius: 0;
              border-left: none;
              border-right: none;
              border-bottom: none;
            }

            .aiCloseFloat{
              display: flex;
              position: fixed;
              top: calc(env(safe-area-inset-top) + 10px);
              right: 12px;
              z-index: 60;
              width: 40px;
              height: 40px;
              align-items: center;
              justify-content: center;
              background: rgba(255,255,255,0.92);
              border: 1px solid #e5e7eb;
              border-radius: 12px;
              box-shadow: 0 6px 18px rgba(0,0,0,0.12);
              backdrop-filter: blur(10px);
              -webkit-backdrop-filter: blur(10px);
            }

            .aiCloseFloat:active{
              transform: scale(0.98);
            }

            .salesGrid{
              grid-template-columns: 1fr;
              grid-template-rows: auto 1fr;
            }
            .salesLeft{
              border-right: none;
              border-bottom: 1px solid #e5e7eb;
              max-height: 42vh;
            }
            .salesRight{
              padding: 12px;
            }
          }

          /* Ajustes visuales */
          .salesLeft button{
            border-radius: 10px;
          }
          .salesLeft input{
            border-radius: 12px;
          }
          .bubble{
            max-width: 88%;
            line-height: 1.35;
          }

          .salesItem {
            width: 100%;
            text-align: left;
            border: 1px solid #e5e7eb;
            border-radius: 10px;
            padding: 10px;
            margin-bottom: 8px;
            background: #fafafa;
          }
          .salesItemActive {
            background: #eef2ff;
            border-color: #a5b4fc;
          }
          .salesChat {
            flex: 1;
            overflow: auto;
            padding: 6px;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            background: #fff;
          }
          .salesInputRow {
            margin-top: 8px;
            display: flex;
            gap: 8px;
          }
        `}
      </style>

      {/* Robot flotante (DRAGGABLE) */}
      <div
        className="fixed z-[9999] select-none"
        style={{ left: robotPos.x, top: robotPos.y, width: ROBOT_SIZE, height: ROBOT_SIZE }}
        onPointerDown={onRobotPointerDown}
        onPointerMove={onRobotPointerMove}
        onPointerUp={onRobotPointerUp}
        title="IA"
      >
        <div className="aiRobotWrap">
          <img src={ROBOT_SRC} alt="F1" draggable={false} className="aiRobotImg" />
          <div className="aiBlink" />
          {f1UnreadEvents > 0 && (
            <div
              title={`${f1UnreadEvents} actualización${f1UnreadEvents === 1 ? "" : "es"} nueva${f1UnreadEvents === 1 ? "" : "s"}`}
              style={{
                position: "absolute",
                right: -4,
                top: -4,
                minWidth: 24,
                height: 24,
                borderRadius: 999,
                background: "#dc2626",
                color: "white",
                fontSize: 11,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 6px",
                border: "2px solid white",
                boxShadow: "0 4px 12px rgba(220,38,38,.35)",
              }}
            >
              {f1UnreadEvents > 99 ? "99+" : f1UnreadEvents}
            </div>
          )}
        </div>
      </div>

      {open && (
        <div
          className="fixed inset-0"
          style={{ zIndex: 999998, background: "rgba(0,0,0,0.35)" }}
          onClick={closeDrawer}
        >
          <div
            className={`fixed bg-white shadow-2xl border border-gray-200 overflow-hidden aiDrawer ${closing ? "closing" : ""}`}
            style={{
              zIndex: 999999,
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >

            {/* Close/minimize siempre visible (especialmente en móvil) */}
            <button
              className="aiCloseFloat"
              onClick={closeDrawer}
              aria-label="Minimizar"
              title="Minimizar"
            >
              ×
            </button>

          {/* Header draggable */}
          <div
            className="aiHeader flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 border-b select-none"
            // En iOS (notch), esto empuja los botones a la izquierda para que la X no se esconda.
            style={{ paddingRight: "calc(24px + env(safe-area-inset-right, 0px))" }}
          >
            <div className="flex items-center gap-2">
              <img src={ROBOT_SRC} alt="IA" className="w-7 h-7 object-contain" draggable={false} />
              <span className="text-sm font-semibold text-gray-800">F1 · Asistente CliniqOne</span>
            </div>

            <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
              <button
                className="text-xs px-2 py-1 rounded bg-white border hover:bg-gray-100"
                onClick={() => {
                  if (tab === "ventas") loadLeads();
                  else loadConvs();
                }}
                title="Refrescar"
              >
                ↻
              </button>
            <button
                className="text-xs px-2 py-1 rounded bg-white border hover:bg-gray-100"
                onClick={closeDrawer}
                title="Minimizar"
              >
                ✕
              </button>
              </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b overflow-x-auto">
            <button
              className={`flex-1 min-w-[110px] px-3 py-2 text-sm ${tab === "f1" ? "bg-white font-semibold" : "bg-gray-50"}`}
              onClick={() => {
                setTab("f1");
                setF1UnreadEvents(0);
              }}
            >
              <span className="inline-flex items-center gap-2"><Mic className="w-4 h-4" /> F1 Gestión</span>
            </button>
            <button
              className={`flex-1 min-w-[110px] px-3 py-2 text-sm ${tab === "convs" ? "bg-white font-semibold" : "bg-gray-50"}`}
              onClick={() => setTab("convs")}
            >
              <span className="inline-flex items-center gap-2">
                <MessagesSquare className="w-4 h-4" /> Conversaciones
              </span>
            </button>
            <button
              className={`flex-1 min-w-[110px] px-3 py-2 text-sm ${tab === "chat" ? "bg-white font-semibold" : "bg-gray-50"}`}
              onClick={() => setTab("chat")}
            >
              <span className="inline-flex items-center gap-2">
                <Send className="w-4 h-4" /> Responder
              </span>
            </button>
            <button
              className={`flex-1 min-w-[110px] px-3 py-2 text-sm ${tab === "ventas" ? "bg-white font-semibold" : "bg-gray-50"}`}
              onClick={() => setTab("ventas")}
            >
              <span className="inline-flex items-center gap-2">
                💼 Ventas
              </span>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 min-h-0">
            {tab === "f1" ? (
              <div className="h-full flex flex-col bg-gray-50">
                <div className="p-3 overflow-auto flex-1">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                    <div className="bg-white border rounded-xl p-3"><div className="text-[11px] text-gray-500">Citas hoy</div><div className="text-2xl font-bold text-gray-900">{f1Summary?.counts?.total ?? '—'}</div></div>
                    <div className="bg-white border rounded-xl p-3"><div className="text-[11px] text-gray-500">Confirmadas</div><div className="text-2xl font-bold text-emerald-700">{f1Summary?.counts?.confirmed ?? '—'}</div></div>
                    <div className="bg-white border rounded-xl p-3"><div className="text-[11px] text-gray-500">Pendientes</div><div className="text-2xl font-bold text-amber-700">{f1Summary?.counts?.pending ?? '—'}</div></div>
                    <div className="bg-white border rounded-xl p-3"><div className="text-[11px] text-gray-500">Canceladas</div><div className="text-2xl font-bold text-red-700">{f1Summary?.counts?.cancelled ?? '—'}</div></div>
                  </div>

                  <div className="bg-white border rounded-xl p-3 mb-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2"><Bell className="w-4 h-4" /><span className="text-sm font-semibold">Información de hoy</span></div>
                      <button className="text-xs px-2 py-1 rounded border" onClick={loadF1Dashboard}>Actualizar</button>
                    </div>
                    {f1Notifications.length ? f1Notifications.map(n => <div key={n.id} className="mt-2 text-xs text-gray-700"><b>{n.title}:</b> {n.message}</div>) : <div className="mt-2 text-xs text-gray-500">Sin avisos pendientes.</div>}
                    {f1Summary?.first_appointment && <div className="mt-2 text-xs text-gray-600">Primera cita: {String(f1Summary.first_appointment.start_time || '').slice(0,5)} · {f1Summary.first_appointment.patient}</div>}
                  </div>

                  <div className="mb-3 flex items-center justify-between rounded-xl border bg-white px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold">
                        Actualización en tiempo real
                        {f1UnreadEvents > 0 && (
                          <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                            {f1UnreadEvents} nuevas
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-gray-500">
                        {f1LiveEvent
                          ? describeF1Event(f1LiveEvent) || String(f1LiveEvent?.name || "")
                          : "Esperando movimientos de la clínica…"}
                      </div>
                    </div>
                    <span className={`ml-3 h-2.5 w-2.5 rounded-full ${f1StreamConnected ? "bg-emerald-500" : "bg-amber-400"}`} />
                  </div>

                  <div className="bg-white border rounded-xl p-3 mb-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">Resumen diario por voz</div>
                        <div className="text-[11px] text-gray-500">Escucha el reporte operativo sin encender el micrófono.</div>
                        <label className="mt-1 inline-flex items-center gap-2 text-[11px] text-gray-600 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={dailyBriefingEnabled}
                            onChange={toggleDailyBriefing}
                          />
                          Reproducir automáticamente una vez al día
                        </label>
                      </div>
                      <button
                        onClick={() => playDailyBriefing()}
                        disabled={briefingLoading}
                        className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-white ${briefingPlaying ? 'bg-red-600' : 'bg-emerald-600'} disabled:opacity-60`}
                      >
                        <Volume2 className="w-4 h-4" />
                        {briefingLoading ? 'Preparando…' : briefingPlaying ? 'Detener' : 'Escuchar resumen'}
                      </button>
                    </div>
                    {!!briefingText && (
                      <div className="mt-2 rounded-lg bg-emerald-50 border border-emerald-100 p-2 text-xs text-gray-700">
                        {briefingText}
                      </div>
                    )}
                  </div>

                  <div className="bg-white border rounded-xl p-3 mb-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">F1 Voice Engine</div>
                        <div className="text-[11px] text-gray-500">
                          Motor local preparado para detectar “Hola F1”.
                        </div>
                        <div className="mt-1 text-[11px] text-gray-600">
                          Estado: {f1VoiceEngineStatus}
                          {f1VoiceEngineDetail ? ` · ${f1VoiceEngineDetail}` : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={toggleF1VoiceEngine}
                        className={`rounded-xl px-3 py-2 text-white ${
                          f1VoiceEngineEnabled ? "bg-emerald-600" : "bg-gray-600"
                        }`}
                      >
                        {f1VoiceEngineEnabled ? "Motor activo" : "Activar motor"}
                      </button>
                    </div>
                  </div>

                  <div className="bg-white border rounded-xl p-3 mb-3">
                    <div className="flex items-center justify-between gap-2">
                      <div><div className="text-sm font-semibold">Voz OpenAI Realtime</div><div className="text-[11px] text-gray-500">Habla naturalmente: “F1, agenda a Juan Pérez mañana a las 2”.</div></div>
                      <button onClick={connectVoice} disabled={voiceConnecting} className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-white ${voiceConnected ? 'bg-red-600' : 'bg-indigo-600'} disabled:opacity-60`}>
                        {voiceConnected ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                        {voiceConnecting ? 'Conectando…' : voiceConnected ? 'Terminar' : 'Hablar con F1'}
                      </button>
                    </div>
                    {!!voiceTranscript && <div className="mt-2 rounded-lg bg-gray-50 border p-2 text-xs text-gray-700 whitespace-pre-wrap">{voiceTranscript}</div>}
                    <audio ref={audioRef} autoPlay />
                  </div>

                  <div className="space-y-2">
                    {f1Messages.map((m, index) => <div key={`${m.role}-${index}`} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm border ${m.role === 'user' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-800 border-gray-200'}`}>{m.content}</div></div>)}
                    {!f1Messages.length && <div className="text-center text-sm text-gray-500 py-4">F1 puede consultar y gestionar la agenda por texto o voz.</div>}
                  </div>
                  {f1Error && <div className="mt-2 text-xs text-red-600 whitespace-pre-wrap">{f1Error}</div>}
                </div>
                <div className="p-2 border-t bg-white">
                  <div className="flex gap-2">
                    <input value={f1Input} onChange={e => setF1Input(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') sendF1Text(); }} placeholder="Escribe una orden para F1…" className="flex-1 border rounded-xl px-3 py-2 text-sm" disabled={f1Sending} />
                    <button onClick={sendF1Text} disabled={f1Sending || !f1Input.trim()} className="px-3 py-2 rounded-xl bg-indigo-600 text-white disabled:opacity-60"><Send className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            ) : tab === "convs" ? (
              <div className="h-full p-3 overflow-auto">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-gray-500">{loadingConvs ? "Cargando..." : `${convs.length} conversaciones`}</div>
                  <div className="flex items-center gap-2">
                    <button className="text-xs px-2 py-1 rounded bg-white border hover:bg-gray-100" onClick={deleteAllConversations} title="Eliminar todas las conversaciones">
                      Borrar
                    </button>
                    <button className="text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700" onClick={newConversation}>
                      + Nuevo
                    </button>
                  </div>
                </div>

                {err && <div className="text-xs text-red-600 mb-2">{err}</div>}

                {convs.map((c) => (
                  <div
                    key={c.id}
                    className={`w-full p-2 rounded-lg border mb-2 hover:bg-gray-50 ${selectedConv?.id === c.id ? "border-indigo-400 bg-indigo-50" : "border-gray-200"}`}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        className="flex-1 text-left"
                        onClick={() => {
                          setSelectedConv(c);
                          setTab("chat");
                        }}
                      >
                        <div className="text-sm font-medium text-gray-800 truncate">{c.title || `Conversación #${c.id}`}</div>
                        <div className="text-[11px] text-gray-500">{new Date(c.updated_at || c.created_at).toLocaleString()}</div>
                      </button>

                      <button
                        className="p-2 rounded-lg border bg-white hover:bg-gray-100"
                        title="Eliminar conversación"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          deleteConversation(c.id);
                        }}
                      >
                        <Trash2 className="w-4 h-4 text-gray-600" />
                      </button>
                    </div>
                  </div>
                ))}

                {!loadingConvs && convs.length === 0 && <div className="text-sm text-gray-500 mt-8 text-center">Sin conversaciones.</div>}
              </div>
            ) : tab === "chat" ? (
              <div className="h-full flex flex-col">
                <div className="flex items-center justify-between px-3 py-2 border-b">
                  <div className="text-xs text-gray-700 truncate">
                    {selectedConv ? selectedConv.title || `Conversación #${selectedConv.id}` : "Sin conversación"}
                  </div>
                  <button className="text-xs px-2 py-1 rounded bg-white border hover:bg-gray-100" onClick={newConversation}>
                    + Nueva
                  </button>
                </div>

                <div className="flex-1 p-3 overflow-auto">
                  {err && <div className="text-xs text-red-600 mb-2">{err}</div>}
                  {loadingMsgs && <div className="text-xs text-gray-500">Cargando mensajes...</div>}

                  {msgs.map((m) => (
                    <div key={m.id} className={`mb-2 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[85%] text-sm px-3 py-2 rounded-2xl border ${
                          m.role === "user" ? "bg-indigo-600 text-white border-indigo-600" : "bg-gray-50 text-gray-800 border-gray-200"
                        }`}
                      >
                        <div className="whitespace-pre-wrap">{stripInternalJson(m.content)}</div>
                        <div className={`mt-1 text-[10px] ${m.role === "user" ? "text-indigo-100" : "text-gray-400"}`}>
                          {new Date(m.created_at).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  ))}

                  {!loadingMsgs && msgs.length === 0 && <div className="text-sm text-gray-500 mt-8 text-center">Escribe un mensaje para empezar.</div>}
                </div>

                <div className="p-2 border-t bg-white">
                  <div className="flex gap-2">
                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Escribe aquí..."
                      className="flex-1 border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") send();
                      }}
                      disabled={sending}
                    />
                    <button
                      className="px-3 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
                      onClick={send}
                      disabled={sending}
                      title="Enviar"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="text-[10px] text-gray-400 mt-1">Tip: puedes arrastrar el robot. Toca para abrir/cerrar.</div>
                </div>
              </div>
            ) : (
              // ===== Ventas tab =====
              <div className="salesGrid">
                <div className="salesLeft">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs text-gray-600">{loadingLeads ? "Cargando..." : `${leads.length} leads`}</div>
                    <div className="flex items-center gap-2">
                      <button
                        className={`text-[11px] px-2 py-1 rounded border ${leadsTab === "incomplete" ? "bg-white" : "bg-gray-50"}`}
                        onClick={() => setLeadsTab("incomplete")}
                        title="Ver leads incompletos"
                      >
                        Incompletos
                      </button>
                      <button
                        className={`text-[11px] px-2 py-1 rounded border ${leadsTab === "complete" ? "bg-white" : "bg-gray-50"}`}
                        onClick={() => setLeadsTab("complete")}
                        title="Ver leads completos"
                      >
                        Completos
                      </button>
                      <button
                        className="text-[11px] px-2 py-1 rounded bg-white border hover:bg-gray-100"
                        onClick={() => setShowLeadReport(true)}
                        title="Generar reporte"
                      >
                        Reporte
                      </button>
                    </div>

                    <button
                      className="text-xs px-2 py-1 rounded bg-white border hover:bg-gray-100"
                      onClick={loadLeads}
                      title="Actualizar leads"
                    >
                      ↻
                    </button>
                  </div>

                  {salesErr && <div className="text-[11px] text-red-600 mb-2">{salesErr}</div>}

                  <div className="mb-2">
                    <input
                      value={leadName}
                      onChange={(e) => setLeadName(e.target.value)}
                      placeholder="Nombre"
                      className="w-full border rounded-lg px-2 py-1 text-xs mb-1"
                    />
                    <input
                      value={leadContact}
                      onChange={(e) => setLeadContact(e.target.value)}
                      placeholder="Contacto (tel/email)"
                      className="w-full border rounded-lg px-2 py-1 text-xs mb-1"
                    />
                    <textarea
                      value={leadNotes}
                      onChange={(e) => setLeadNotes(e.target.value)}
                      placeholder="Notas (opcional)"
                      className="w-full border rounded-lg px-2 py-1 text-xs mb-1"
                      rows={2}
                    />
                    <button
                      className="w-full text-xs px-2 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
                      onClick={createLead}
                      disabled={!leadName.trim() && !leadContact.trim()}
                      title="Crear lead"
                    >
                      + Crear lead
                    </button>
                  </div>

                  <div className="mt-2">
                    {filteredLeads.map((l) => {
                      const active = selectedLead?.id === l.id;
                      return (
                        <button
                          key={l.id}
                          className={`salesItem ${active ? "salesItemActive" : ""}`}
                          onClick={() => setSelectedLead(l)}
                          type="button"
                        >
                          <div className="text-xs font-semibold text-gray-800 truncate">{l.name || `Lead #${l.id}`}</div>
                          <div className="text-[11px] text-gray-500 truncate">{l.contact || ""}</div>
                          <div className="text-[10px] text-gray-400">{l.status || "new"}</div>
                        </button>
                      );
                    })}
                    {!loadingLeads && leads.length === 0 && <div className="text-xs text-gray-500 mt-4">Sin leads aún.</div>}
                  </div>
                </div>

                <div className="salesRight">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs text-gray-700 truncate">
                      {selectedLead ? (selectedLead.name || `Lead #${selectedLead.id}`) : "Selecciona un lead"}
                    </div>
                    {selectedLead?.id && (
                      <button
                        className="text-xs px-2 py-1 rounded bg-white border hover:bg-gray-100"
                        onClick={() => loadLeadMsgs(selectedLead.id)}
                        title="Actualizar mensajes"
                      >
                        ↻
                      </button>
                    )}
                  </div>

                  <div className="salesChat">
                    {salesErr && <div className="text-[11px] text-red-600 mb-2">{salesErr}</div>}
                    {loadingLeadMsgs && <div className="text-[11px] text-gray-500">Cargando mensajes...</div>}

                    {leadMsgs.map((m) => (
                      <div key={m.id} className={`mb-2 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[85%] text-xs px-2 py-2 rounded-2xl border ${
                            m.role === "user" ? "bg-indigo-600 text-white border-indigo-600" : "bg-gray-50 text-gray-800 border-gray-200"
                          }`}
                        >
                          <div className="whitespace-pre-wrap">{stripInternalJson(m.content)}</div>
                        </div>
                      </div>
                    ))}

                    {!loadingLeadMsgs && selectedLead && leadMsgs.length === 0 && (
                      <div className="text-xs text-gray-500 mt-6 text-center">Escribe para iniciar la conversación de ventas.</div>
                    )}

                    {!selectedLead && <div className="text-xs text-gray-500 mt-6 text-center">Selecciona un lead.</div>}
                  </div>

                  <div className="salesInputRow">
                    <input
                      value={leadInput}
                      onChange={(e) => setLeadInput(e.target.value)}
                      placeholder="Escribe para vender…"
                      className="flex-1 border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") sendLead();
                      }}
                      disabled={sendingLead || !selectedLead?.id}
                    />
                    <button
                      className="px-3 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
                      onClick={sendLead}
                      disabled={sendingLead || !selectedLead?.id}
                      title="Enviar"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="text-[10px] text-gray-400 mt-1">
                    Ventas usa <code>/api/sales</code> (leads + IA de cierre).
                  </div>
                </div>
              </div>
            )}
          </div>
        
          </div>
        </div>
      )
    }

{showLeadReport && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 999999,
          }}
          onClick={() => setShowLeadReport(false)}
        >
          <div
            style={{
              width: "min(720px, 92vw)",
              maxHeight: "80vh",
              overflow: "auto",
              background: "rgba(255,255,255,0.98)",
              border: "1px solid rgba(0,0,0,0.12)",
              borderRadius: 14,
              padding: 14,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="text-sm font-semibold">Reporte de leads</div>
              <div className="flex-1" />
              <button
                className="text-xs px-2 py-1 rounded bg-white border hover:bg-gray-100"
                onClick={async () => {
                  const txt = buildLeadReport();
                  try { await navigator.clipboard.writeText(txt); } catch {}
                }}
              >
                Copiar
              </button>
              <button className="text-xs px-2 py-1 rounded bg-white border hover:bg-gray-100" onClick={() => setShowLeadReport(false)}>
                Cerrar
              </button>
            </div>

            <textarea
              readOnly
              value={buildLeadReport()}
              className="w-full border rounded-xl p-2 text-[12px]"
              style={{ minHeight: 380, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace" }}
            />
          </div>
        </div>
      )}

    </>
  );
}

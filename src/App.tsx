import React, { useEffect, useMemo, useState } from "react";
import logo from "./assets/logo.png";
import {
  Calendar, DollarSign, BarChart3, Plus, X, Check, Edit, Trash2,
  AlertTriangle, Filter, RefreshCw, Wifi, WifiOff, CreditCard,
  MessageCircle, MessageSquare, Send, Search, Settings, TestTube,
  ArrowUpRight, ArrowDownLeft, Package, User, FileText, Building2  // <- Agregar FileText aquí
} from "lucide-react";
import FacturacionModule from './FacturacionModule';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, PieChart, Pie, Cell, Legend, LabelList
} from "recharts";
import { PatientHistoryModule } from "./PatientHistoryModule";


// ✅ Unifica todo desde ./lib/api (en minúsculas)
import { api, getSucursalActual, setSucursal, testSucursalAPI, debugSucursalConfig } from "./lib/api";

import SucursalSelector from "./components/SucursalSelector";
import {
  ClienteForm,
  FacturaForm,
  REGIMENES_FISCALES,
  USOS_CFDI,
  fetchClientes,
  createCliente,
  fetchFacturas,
  createFactura,
  cancelarFactura,
  fetchConfiguracionSAT,
  updateConfiguracionSAT,
  // 👇 nuevos helpers de Facturama (sustituyen a timbrarFactura)
  facturamaTimbrar,
  facturamaDescargarZip,
  descargarPdfFactura,
  descargarXmlFactura,
} from "./facturacion_electronica";

// 🆕 Nuevos módulos
import { InventoryModule } from './InventoryModule';
import DashboardIntegration from './components/DashboardIntegration';  // ← AGREGAR ESTA LÍNEA
import { MedicalRecordModule, useMedicalRecord } from './MedicalRecordModule';
import AIFloatingWidget from './AIFloatingWidget.tsx';

const SUPERADMIN_EMAIL_FALLBACK = 'nhaelvaldez26@hotmail.com';

function readJwtPayloadsFromStorage(): any[] {
  if (typeof window === 'undefined') return [];
  const payloads: any[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      const value = key ? window.localStorage.getItem(key) : null;
      if (!value || value.split('.').length !== 3) continue;
      try {
        const part = value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = part + '='.repeat((4 - (part.length % 4)) % 4);
        payloads.push(JSON.parse(decodeURIComponent(escape(window.atob(padded)))));
      } catch {}
    }
  } catch {}
  return payloads;
}

function isSuperAdminSession(): boolean {
  return readJwtPayloadsFromStorage().some((payload) =>
    String(payload?.role || '').toLowerCase() === 'superadmin' ||
    String(payload?.email || '').toLowerCase() === SUPERADMIN_EMAIL_FALLBACK
  );
}

// === Hoisted helpers to avoid TDZ for lab summaries ===
function totalAbonado(t: any) {
  try { return (t?.abonos ?? []).reduce((s: number, a: any) => s + Number(a?.monto ?? 0), 0); }
  catch { return 0; }
}
function saldoPendiente(t: any) {
  const pres = Number(t?.presupuesto ?? 0);
  return pres - totalAbonado(t);
}

// Detecta si el dispositivo es táctil (Android, iOS, etc.)
// (Seguro para navegadores que no tienen esas propiedades)
const isTouchDevice =
  typeof window !== "undefined" &&
  (("ontouchstart" in window) ||
   (navigator?.maxTouchPoints ?? 0) > 0 ||
   // @ts-ignore (para navegadores antiguos)
   (navigator?.msMaxTouchPoints ?? 0) > 0);


/* ===== BOTÓN DE PRUEBA: Enviar confirmaciones HOY por WhatsApp ===== */
function BroadcastTodayButton({
  sucursalId,
  label = "Enviar confirmaciones HOY",
  preview = false, // si true, solo hace preview (no envía)
  onAfterSend,     // ⬅️ NUEVO: callback para refrescar el panel
}: {
  sucursalId: string;
  label?: string;
  preview?: boolean;
  onAfterSend?: () => void;
}) {
  const [loading, setLoading] = React.useState(false);
  const [lastResult, setLastResult] = React.useState<string>("");

  const handleSend = async () => {
    try {
      setLoading(true);
      setLastResult("");

      // ✅ Backend base (usa env si existe)
      const API_BASE = (
        (import.meta.env.VITE_API_BASE as string | undefined) ||
        "https://dentalux-sucs.onrender.com"
      ).replace(/\/$/, "");

      const secret = import.meta.env.VITE_WA_BROADCAST_SECRET || "";
      // Multi-app routing (para que cada frontend use su DB/app correctos)
      const inferred = (() => {
        const host = (typeof window !== "undefined" ? window.location.hostname : "") || "";
        if (host.includes("staticdemo")) return { db: "db2", app: "app2" };
        if (host.includes("enterprice") || host.includes("enterprise")) return { db: "db3", app: "app3" };
        return { db: "db1", app: "app1" };
      })();
      const dbKey = (import.meta.env.VITE_DB_KEY || "") || inferred.db;
      const appId = (import.meta.env.VITE_APP_ID || "") || inferred.app;

      const qs = new URLSearchParams({
        when: "today",
        sucursal_id: sucursalId || "sucursal_1",
        limit: "500",
        buttons: "false",         // usamos plantilla
        use_template: "true",
        ...(preview ? { preview: "1" } : {}),
        ...(secret ? { secret } : {}),
        ...(dbKey ? { db: dbKey } : {}),
        ...(appId ? { app_id: appId } : {}),
      });

      const url = `${API_BASE}/api/whatsapp/broadcast/confirmations?${qs.toString()}`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          ...(secret ? { "x-wa-secret": secret, "x-wa-broadcast-secret": secret } : {}),
          ...(dbKey ? { "x-db": dbKey } : {}),
          ...(appId ? { "x-app": appId } : {}),
        },
        credentials: "omit",
      });

      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLastResult(`Error HTTP ${res.status}${json?.error ? `: ${json.error}` : ""}`);
        return;
      }

      const errs = Array.isArray(json?.errors) ? json.errors.length : 0;
      const phoneIssues = Array.isArray(json?.phoneIssues) ? json.phoneIssues.length : 0;

      let resultMsg = preview
        ? `Preview: ${json?.targeted ?? 0} candidatos`
        : `OK: enviados ${json?.sent ?? 0} de ${json?.targeted ?? 0}${errs ? ` | errores: ${errs}` : ""}`;

      // Add warning about phone issues (common in test mode)
      if (phoneIssues > 0 && !preview) {
        resultMsg += `\n⚠️ ${phoneIssues} números no verificados (modo test WhatsApp)`;
        if (json?.warning) {
          resultMsg += `\n${json.warning}`;
        }
      }

      // Log errors for debugging
      if (json?.errors && json.errors.length > 0) {
        console.error("Broadcast errors:", json.errors);
      }
      if (json?.phoneIssues && json.phoneIssues.length > 0) {
        console.warn("Phone verification issues:", json.phoneIssues);
      }

      setLastResult(resultMsg);

      // 🔁 refresca el panel solo si realmente enviamos
      if (!preview) onAfterSend?.();
    } catch (e: any) {
      const errorMsg = String(e?.message || e);
      console.error("Broadcast error:", errorMsg, e);
      setLastResult(`Error: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-3 flex items-center gap-3">
      <button
        className="px-4 py-2 rounded bg-emerald-600 text-white disabled:opacity-60"
        disabled={loading}
        onClick={handleSend}
        title={`Envía confirmaciones HOY en ${sucursalId}`}
      >
        {loading ? "Enviando..." : label}
      </button>
      {!!lastResult && (
        <span className="text-sm text-gray-800 whitespace-pre-wrap">{lastResult}</span>
      )}
    </div>
  );
}
/* ===== FIN BOTÓN DE PRUEBA ===== */







/* ===================== Types ===================== */
type Doctor = {
  id: string;
  name: string;
  color?: string;
};

type Service = {
  id: string;
  name: string;
};

type Appointment = {
  id: number;
  patient: string;
  doctorId: string;
  date: string;
  startTime: string;
  durationHours: number;
  serviceId: string;
  serviceId2?: string; // 🆕 segundo servicio (guardado local)
  phone?: string;
  status?: "Pendiente" | "Confirmada" | "Atendida" | "Cancelada";
};

type Payment = {
  id: number
  appointmentId?: number
  patient: string
  serviceId: string
  amount: number
  paymentMethod: 'efectivo'|'tarjeta_debito'|'tarjeta_credito'|'transferencia'
  date: string
  doctorId: string
}

type Expense = {
  id: number
  concept: string
  amount: number
  date: string
  doctorId?: string
  paymentMethod?: Payment['paymentMethod']
}

type Laboratorio = {
  id: string;
  nombre: string;
  contacto?: string;
};

type TrabajoLaboratorio = {
  id: string;
  paciente: string;
  laboratorioId: string;
  servicioId: string;
  presupuesto: number;
  fechaInicio: string;
  fechaEntregaEstimada: string;
  etapa: string;
  notas?: string;
  abonos: Abono[];
};

type Abono = {
  id: string;
  monto: number;
  fecha: string;
  nota?: string;
  paymentMethod?: Payment['paymentMethod']; // ← NUEVO
};

type PagoLaboratorio = {
  id: string;
  trabajo_id: string;
  monto: number;
  fecha: string;
};

// ===================== WHATSAPP TYPES =====================
type WhatsAppConfig = {
  isEnabled: boolean;
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  webhookUrl: string;
};

type WhatsAppMessage = {
  id: number;
  type: 'outgoing' | 'incoming';
  phone: string;
  patient: string;
  message: string;
  timestamp: string;
  status: string;
  appointmentId?: number;
  manual?: boolean;
};

type WhatsAppStats = {
  totalSent: number;
  totalReceived: number;
  confirmations: number;
  cancellations: number;
};

type SendMessageForm = {
  phone: string;
  message: string;
  template: string;
  isTemplate: boolean;
};

// ===================== FACTURACIÓN ELECTRÓNICA TYPES =====================
type Cliente = {
  id: string;
  rfc: string;
  razon_social: string;
  email: string;
  telefono?: string;
  direccion?: string;
  codigo_postal: string;
  regimen_fiscal: string;
  uso_cfdi: string;
  activo: boolean;
  createdAt: string;
};

type Concepto = {
  id: string;
  clave_prodserv: string; // Catálogo SAT
  clave_unidad: string;   // Catálogo SAT
  descripcion: string;
  valor_unitario: number;
  cantidad: number;
  importe: number;
  descuento?: number;
  objeto_imp: string;     // 01, 02, 03
  impuestos?: {
    traslados?: Array<{
      base: number;
      impuesto: string;  // 002=IVA, 003=IEPS
      tipo_factor: string; // Tasa, Cuota, Exento
      tasa_o_cuota?: number;
      importe?: number;
    }>;
    retenciones?: Array<{
      base: number;
      impuesto: string;
      tipo_factor: string;
      tasa_o_cuota: number;
      importe: number;
    }>;
  };
};

type Factura = {
  id: string;
  folio: number;
  serie?: string;
  fecha: string;
  emisor_rfc: string;
  emisor_nombre: string;
  emisor_regimen: string;
  receptor_id: string;
  receptor_rfc: string;
  receptor_nombre: string;
  receptor_uso_cfdi: string;
  receptor_regimen?: string;
  conceptos: Concepto[];
  subtotal: number;
  descuento?: number;
  total_impuestos_trasladados?: number;
  total_impuestos_retenidos?: number;
  total: number;
  estado: 'borrador' | 'timbrada' | 'cancelada' | 'error';
  uuid?: string;
  fecha_timbrado?: string;
  sello_cfd?: string;
  sello_sat?: string;
  cadena_original?: string;
  qr_code?: string;
  xml_path?: string;
  pdf_path?: string;
  cita_id?: number;
  pago_id?: number;
  notas?: string;
  createdAt: string;
  updatedAt: string;
};

type ConfiguracionSAT = {
  rfc: string;
  razon_social: string;
  regimen_fiscal: string;
  codigo_postal: string;
  cer_path?: string;
  key_path?: string;
  key_password?: string;
  pac_proveedor: 'finkok' | 'facturama' | 'sw_sapien' | 'otro';
  pac_usuario?: string;
  pac_password?: string;
  pac_url_timbrado?: string;
  pac_url_cancelacion?: string;
  serie_facturas?: string;
  ultimo_folio: number;
  ambiente: 'pruebas' | 'produccion';
  activo: boolean;
};


/* ===================== Utils ===================== */
const DOCTOR_PALETTE = ['#3b82f6','#10b981','#ef4444','#8b5cf6','#f59e0b','#06b6d4','#f472b6'];
const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f472b6', '#84cc16', '#f97316', '#ec4899'];

const today = new Date();
const fmtDate = (d: Date) => d.toISOString().slice(0,10);
// Convierte cualquier fecha/ISO a 'YYYY-MM-DD' para inputs y payloads
const toDateInput = (v: any) => {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  
  // Forzar fecha local sin cambio de zona horaria
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
};
 
const normalizeDateForServer = (dateStr: string) => {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  if (dateStr.includes('T')) return dateStr.split('T')[0];
  
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');  
  const day = String(d.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
};
const addDays = (d: Date, n:number) => { const r=new Date(d); r.setDate(r.getDate()+n); return r };
const getWeekStart = (d: Date) => { const r=new Date(d); const day = (r.getDay()+6)%7; r.setDate(r.getDate()-day); r.setHours(0,0,0,0); return r };
const rangeDays = (start: Date, end: Date) => { const days: Date[]=[]; let cur=new Date(start); while(cur<=end){ days.push(new Date(cur)); cur=addDays(cur,1)} return days };
const timeToMins = (t:string)=>{ const [H,M]=t.split(':').map(Number); return H*60+M };
const minsToTime = (m:number)=>{ const H=Math.floor(m/60); const M=m%60; return `${String(H).padStart(2,'0')}:${String(M).padStart(2,'0')}` };
const snapMins30 = (mins: number) => Math.round(mins / 30) * 30;
const addMinutesToTime = (t: string, deltaMins: number) => {
  const m = timeToMins(t) + deltaMins;
  const clamped = Math.max(8*60, Math.min(20*60 - 30, m));
  return minsToTime(snapMins30(clamped));
};


/* ===================== Multi-servicio (localStorage) ===================== */
// Guardamos el 2do servicio por cita en localStorage (no requiere cambios en backend)
const EXTRA_SERVICE_KEY = 'dentalux_extra_service_v1'; // appointmentId -> serviceId2

function loadExtraServiceMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(EXTRA_SERVICE_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return (obj && typeof obj === 'object') ? obj : {};
  } catch {
    return {};
  }
}

function saveExtraServiceMap(map: Record<string, string>) {
  try { localStorage.setItem(EXTRA_SERVICE_KEY, JSON.stringify(map)); } catch {}
}

function getExtraServiceForAppointment(appointmentId: string): string | undefined {
  const map = loadExtraServiceMap();
  const v = map[String(appointmentId)];
  return v ? String(v) : undefined;
}

function setExtraServiceForAppointment(appointmentId: string, serviceId2?: string) {
  const map = loadExtraServiceMap();
  const key = String(appointmentId);
  if (serviceId2) map[key] = String(serviceId2);
  else delete map[key];
  saveExtraServiceMap(map);
}
/* ===================== Fin multi-servicio ===================== */

/* ===================== Data Transform Utils ===================== */
const transformDoctorFromDB = (dbDoctor: any): Doctor => ({
  id: String(dbDoctor.id),
  name: dbDoctor.name,
  color: dbDoctor.color || DOCTOR_PALETTE[0]
});

const transformServiceFromDB = (dbService: any): Service => ({
  id: String(dbService.id),
  name: dbService.name
});

const transformAppointmentFromDB = (dbApt: any): Appointment => ({
  id: Number(dbApt.id),
  patient: dbApt.patient,
  doctorId: String(dbApt.doctor_id),
  date: normalizeDateForServer(dbApt.date), // 👈 USAR normalizeDateForServer
  startTime: dbApt.start_time,
  durationHours: Number(dbApt.duration_hours),
  serviceId: String(dbApt.service_id),
  serviceId2: getExtraServiceForAppointment(String(dbApt.id)),
  phone: dbApt.phone,
  status: dbApt.status
});

const transformPaymentFromDB = (dbPayment: any): Payment => ({
  id: Number(dbPayment.id),
  appointmentId: dbPayment.appointment_id ? Number(dbPayment.appointment_id) : undefined,
  patient: dbPayment.patient,
  serviceId: String(dbPayment.service_id),
  amount: Number(dbPayment.amount),
  paymentMethod: dbPayment.payment_method,
  date: dbPayment.date,
  doctorId: String(dbPayment.doctor_id)
});

const transformExpenseFromDB = (dbExpense: any): Expense => ({
  id: Number(dbExpense.id),
  concept: dbExpense.concept,
  amount: Number(dbExpense.amount),
  date: dbExpense.date,
  doctorId: dbExpense.doctor_id ? String(dbExpense.doctor_id) : undefined,
  paymentMethod: dbExpense.payment_method
});

const transformLaboratorioFromDB = (dbLab: any): Laboratorio => ({
  id: String(dbLab.id),
  nombre: dbLab.nombre || dbLab.name,
  contacto: dbLab.contacto || dbLab.contact
});

const transformTrabajoFromDB = (dbTrabajo: any): TrabajoLaboratorio => ({
  id: String(dbTrabajo.id),
  paciente: dbTrabajo.paciente || dbTrabajo.patient,
  laboratorioId: String(dbTrabajo.laboratorio_id || dbTrabajo.laboratorioId),
  servicioId: String(dbTrabajo.servicio_id || dbTrabajo.servicioId),
  presupuesto: Number(dbTrabajo.presupuesto || dbTrabajo.budget || 0),
  fechaInicio: dbTrabajo.fecha_inicio || dbTrabajo.fechaInicio,
  fechaEntregaEstimada: dbTrabajo.fecha_entrega_estimada || dbTrabajo.fechaEntregaEstimada,
  etapa: dbTrabajo.etapa || dbTrabajo.stage || 'Toma de impresión',
  notas: dbTrabajo.notas || dbTrabajo.notes,
  abonos: (dbTrabajo.abonos || []).map(transformAbonoFromDB)
});

const transformAbonoFromDB = (dbAbono: any): Abono => ({
  id: String(dbAbono.id),
  monto: Number(dbAbono.monto ?? dbAbono.amount ?? 0),
  fecha: dbAbono.fecha ?? dbAbono.date ?? '',
  nota: dbAbono.nota ?? dbAbono.note ?? '',
  // 🆕 Lee las tres variantes que pueden venir del backend
  paymentMethod:
    dbAbono.payment_method ??
    dbAbono.paymentMethod ??
    dbAbono.metodo_pago ??
    undefined,
});

/* ================== Backend CRUD Functions ===================== */

// Doctors
const fetchDoctors = async () => {
  try {
    const data = await api('/doctors');
    return data.map(transformDoctorFromDB);
  } catch (error) {
    console.error('Error fetching doctors:', error);
    throw error;
  }
};

const createDoctor = async (doctorData: Partial<Doctor>) => {
  try {
    const created = await api('/doctors', { 
      method: 'POST', 
      body: JSON.stringify({
        name: doctorData.name,
        color: doctorData.color
      })
    });
    return transformDoctorFromDB(created);
  } catch (error) {
    console.error('Error creating doctor:', error);
    throw error;
  }
};

const updateDoctor = async (id: string, doctorData: Partial<Doctor>) => {
  try {
    const updated = await api(`/doctors/${id}`, { 
      method: 'PUT', 
      body: JSON.stringify(doctorData)
    });
    return transformDoctorFromDB(updated);
  } catch (error) {
    console.error('Error updating doctor:', error);
    throw error;
  }
};

const deleteDoctor = async (id: string) => {
  try {
    await api(`/doctors/${id}`, { method: 'DELETE' });
  } catch (error) {
    console.error('Error deleting doctor:', error);
    throw error;
  }
};

// Services
const fetchServices = async () => {
  try {
    const data = await api('/services');
    return data.map(transformServiceFromDB);
  } catch (error) {
    console.error('Error fetching services:', error);
    throw error;
  }
};

const createService = async (serviceData: Partial<Service>) => {
  try {
    const created = await api('/services', { 
      method: 'POST', 
      body: JSON.stringify({ name: serviceData.name })
    });
    return transformServiceFromDB(created);
  } catch (error) {
    console.error('Error creating service:', error);
    throw error;
  }
};

const deleteService = async (id: string) => {
  try {
    await api(`/services/${id}`, { method: 'DELETE' });
  } catch (error) {
    console.error('Error deleting service:', error);
    throw error;
  }
};

// Appointments
const fetchAppointments = async () => {
  try {
    const data = await api('/appointments');
    return data.map(transformAppointmentFromDB);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    throw error;
  }
};

const createAppointment = async (appointmentData: Partial<Appointment>) => {
  try {
    const created = await api('/appointments', { 
      method: 'POST', 
      body: JSON.stringify({
        patient: appointmentData.patient,
        doctor_id: Number(appointmentData.doctorId),
        date: normalizeDateForServer(appointmentData.date || ''),
        start_time: appointmentData.startTime,
        duration_hours: appointmentData.durationHours,
        service_id: Number(appointmentData.serviceId),
        phone: appointmentData.phone,
        status: appointmentData.status || 'Pendiente'
      })
    });
    return transformAppointmentFromDB(created);
  } catch (error) {
    console.error('Error creating appointment:', error);
    throw error;
  }
};

const updateAppointment = async (id: number, appointmentData: Partial<Appointment>) => {
  try {
    const payload: any = {};
    if (appointmentData.patient !== undefined) payload.patient = appointmentData.patient;
    if (appointmentData.doctorId !== undefined) payload.doctor_id = Number(appointmentData.doctorId);
    if (appointmentData.date !== undefined) payload.date = appointmentData.date;
    if (appointmentData.startTime !== undefined) payload.start_time = appointmentData.startTime;
    if (appointmentData.durationHours !== undefined) payload.duration_hours = appointmentData.durationHours;
    if (appointmentData.serviceId !== undefined) payload.service_id = Number(appointmentData.serviceId);
    if (appointmentData.phone !== undefined) payload.phone = appointmentData.phone;
    if (appointmentData.status !== undefined) payload.status = appointmentData.status;

    const updated = await api(`/appointments/${id}`, { 
      method: 'PUT', 
      body: JSON.stringify(payload)
    });
    return transformAppointmentFromDB(updated);
  } catch (error) {
    console.error('Error updating appointment:', error);
    throw error;
  }
};

const deleteAppointmentById = async (id: number) => {
  try {
    await api(`/appointments/${id}`, { method: 'DELETE' });
  } catch (error) {
    console.error('Error deleting appointment:', error);
    throw error;
  }
};

// Payments
const fetchPayments = async () => {
  try {
    const data = await api('/payments');
    return data.map(transformPaymentFromDB);
  } catch (error) {
    console.error('Error fetching payments:', error);
    throw error;
  }
};

const createPayment = async (paymentData: any) => {
  try {
    const created = await api('/payments', { 
      method: 'POST', 
      body: JSON.stringify(paymentData)
    });
    return transformPaymentFromDB(created);
  } catch (error) {
    console.error('Error creating payment:', error);
    throw error;
  }
};

const updatePayment = async (id: number, paymentData: Partial<Payment>) => {
  try {
    const updated = await api(`/payments/${id}`, { 
      method: 'PUT', 
      body: JSON.stringify({
        patient: paymentData.patient,
        amount: paymentData.amount,
        payment_method: paymentData.paymentMethod,
        date: paymentData.date
      })
    });
    return transformPaymentFromDB(updated);
  } catch (error) {
    console.error('Error updating payment:', error);
    throw error;
  }
};

const deletePayment = async (id: number) => {
  try {
    await api(`/payments/${id}`, { method: 'DELETE' });
  } catch (error) {
    console.error('Error deleting payment:', error);
    throw error;
  }
};

// Expenses
const fetchExpenses = async () => {
  try {
    const data = await api('/expenses');
    return data.map(transformExpenseFromDB);
  } catch (error) {
    console.error('Error fetching expenses:', error);
    throw error;
  }
};

const createExpense = async (expenseData: Partial<Expense>) => {
  try {
    const created = await api('/expenses', { 
      method: 'POST', 
      body: JSON.stringify({
        concept: expenseData.concept,
        amount: expenseData.amount,
        date: expenseData.date,
        doctor_id: expenseData.doctorId ? Number(expenseData.doctorId) : null,
        payment_method: expenseData.paymentMethod
      })
    });
    return transformExpenseFromDB(created);
  } catch (error) {
    console.error('Error creating expense:', error);
    throw error;
  }
};

const updateExpense = async (id: number, expenseData: Partial<Expense>) => {
  try {
    const updated = await api(`/expenses/${id}`, { 
      method: 'PUT', 
      body: JSON.stringify({
        concept: expenseData.concept,
        amount: expenseData.amount,
        date: expenseData.date,
        doctor_id: expenseData.doctorId ? Number(expenseData.doctorId) : null,
        payment_method: expenseData.paymentMethod
      })
    });
    return transformExpenseFromDB(updated);
  } catch (error) {
    console.error('Error updating expense:', error);
    throw error;
  }
};

const deleteExpense = async (id: number) => {
  try {
    await api(`/expenses/${id}`, { method: 'DELETE' });
  } catch (error) {
    console.error('Error deleting expense:', error);
    throw error;
  }
};

// Laboratorios
const fetchLaboratorios = async () => {
  try {
    const data = await api('/laboratorios');
    return data.map(transformLaboratorioFromDB);
  } catch (error) {
  console.warn('Error fetching laboratorios:', error);
  return []; // <- sin labs falsos
}
};

const createLaboratorio = async (laboratorioData: Partial<Laboratorio>) => {
  try {
    const created = await api('/laboratorios', { 
      method: 'POST', 
      body: JSON.stringify({
        nombre: laboratorioData.nombre,
        contacto: laboratorioData.contacto
      })
    });
    return transformLaboratorioFromDB(created);
  } catch (error) {
    console.error('Error creating laboratorio:', error);
    return { id: Date.now().toString(), ...laboratorioData } as Laboratorio;
  }
};

// Trabajos Laboratorio
const fetchTrabajos = async () => {
  try {
    const data = await api('/trabajos-laboratorio');
    return data.map(transformTrabajoFromDB);
  } catch (error) {
    console.warn('Error fetching trabajos, using fallback:', error);
    return [];
  }
};

const createTrabajo = async (trabajoData: Partial<TrabajoLaboratorio>) => {
  try {
    const created = await api('/trabajos-laboratorio', {
      method: 'POST',
      body: JSON.stringify({
  paciente: trabajoData.paciente,
  laboratorio_id: String(trabajoData.laboratorioId),          // FK texto exacto
  servicio_id: Number(trabajoData.servicioId),                 // FK numérico
  presupuesto: Number(trabajoData.presupuesto),
  fecha_inicio: trabajoData.fechaInicio,
  fecha_entrega_estimada: trabajoData.fechaEntregaEstimada,
  etapa: trabajoData.etapa,
  notas: trabajoData.notas,
})
    });
    return transformTrabajoFromDB(created);
  } catch (error) {
    console.error('Error creating trabajo:', error);
    return {
      id: Date.now().toString(),
      ...trabajoData,
      abonos: []
    } as TrabajoLaboratorio;
  }
};

const updateTrabajo = async (id: string, trabajoData: Partial<TrabajoLaboratorio>) => {
  try {
    const updated = await api(`/trabajos-laboratorio/${id}`, { 
      method: 'PATCH', 
      body: JSON.stringify({
        etapa: trabajoData.etapa,
        notas: trabajoData.notas
      })
    });
    return transformTrabajoFromDB(updated);
  } catch (error) {
    console.error('Error updating trabajo:', error);
    return trabajoData;
  }
};

const createAbono = async (trabajoId: string, abonoData: Partial<Abono>) => {
  try {
    const created = await api(`/trabajos-laboratorio/${trabajoId}/abonos`, { 
  method: 'POST', 
  body: JSON.stringify({
    monto: abonoData.monto,
    fecha: abonoData.fecha,
    nota: abonoData.nota,
    payment_method: abonoData.paymentMethod // ← NUEVO
  })
});

    return transformAbonoFromDB(created);
  } catch (error) {
    console.error('Error creating abono:', error);
    return {
 id: Date.now().toString(),
 ...abonoData,
 } as Abono;
  }
};

// ===================== WHATSAPP MODULE FUNCTIONS =====================

// Obtener configuración de WhatsApp
const fetchWhatsappConfig = async () => {
  try {
    const data = await api('/whatsapp/test');
    return {
      isEnabled: data.env.PHONE_NUMBER_ID === 'Set' && data.env.ACCESS_TOKEN === 'Set',
      phoneNumberId: data.env.PHONE_NUMBER_ID === 'Set' ? '✅ Configurado' : '❌ No configurado',
      accessToken: data.env.ACCESS_TOKEN === 'Set' ? '✅ Configurado' : '❌ No configurado',
      verifyToken: data.env.VERIFY_TOKEN || 'dentalux_webhook_2024',
      webhookUrl: data.webhook_example || ''
    };
  } catch (error) {
    console.error('Error fetching WhatsApp config:', error);
    return {
      isEnabled: false,
      phoneNumberId: '❌ Error de conexión',
      accessToken: '❌ Error de conexión',
      verifyToken: 'dentalux_webhook_2024',
      webhookUrl: ''
    };
  }
};

// Simular obtener mensajes (puedes implementar un endpoint real en el backend)
const fetchWhatsappMessages = async () => {
  try {
    // Por ahora simulamos datos - puedes crear un endpoint /api/whatsapp/messages
    const mockMessages: WhatsAppMessage[] = [
      {
        id: 1,
        type: 'outgoing',
        phone: '+5216861234567',
        patient: 'Juan Pérez',
        message: '¡Hola! Tienes una cita programada para mañana a las 10:00 AM. Responde CONFIRMAR para confirmar o CANCELAR para cancelar.',
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        status: 'delivered',
        appointmentId: 123
      },
      {
        id: 2,
        type: 'incoming',
        phone: '+5216861234567',
        patient: 'Juan Pérez',
        message: 'CONFIRMAR',
        timestamp: new Date(Date.now() - 3000000).toISOString(),
        status: 'processed',
        appointmentId: 123
      },
      {
        id: 3,
        type: 'outgoing',
        phone: '+5216865555555',
        patient: 'María González',
        message: 'Recordatorio: Tu cita es hoy a las 2:00 PM.',
        timestamp: new Date(Date.now() - 7200000).toISOString(),
        status: 'sent',
        appointmentId: 124
      }
    ];
    
    return mockMessages;
  } catch (error) {
    console.error('Error fetching WhatsApp messages:', error);
    return [];
  }
};

// Enviar mensaje manual
const sendWhatsappMessage = async (messageData: SendMessageForm) => {
  try {
    const endpoint = messageData.isTemplate ? '/whatsapp/send-template' : '/whatsapp/send-message';
    const payload = messageData.isTemplate 
      ? {
          phone: messageData.phone,
          template: messageData.template,
          bodyParams: [messageData.message] // Parámetros del template
        }
      : {
          phone: messageData.phone,
          message: messageData.message
        };

    await api(endpoint, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    // Crear el mensaje enviado
    const newMessage: WhatsAppMessage = {
      id: Date.now(),
      type: 'outgoing',
      phone: messageData.phone,
      patient: messageData.phone,
      message: messageData.message,
      timestamp: new Date().toISOString(),
      status: 'sent',
      manual: true
    };

    return newMessage;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    throw error;
  }
};

// Buscar cita por teléfono (usando el endpoint debug existente)
const lookupAppointment = async (phone: string) => {
  try {
    const data = await api(`/whatsapp/debug/lookup?phone=${encodeURIComponent(phone)}`);
    return data;
  } catch (error) {
    console.error('Error looking up appointment:', error);
    return null;
  }
};

/* ===================== Reload Functions ===================== */
const useReloadableFetch = <T,>(fetchFn: () => Promise<T>, deps: any[] = []) => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFn();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
      console.error('Error in reloadable fetch:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
  reload();
}, []);

  return { data, loading, error, reload };
};

/* ===================== Main App Component ===================== */
// ==================== PagarLaboratorioUI (componente autónomo) ====================
function PagarLaboratorioUI({
  trabajo,
  onPagar,                  // (trabajoId, monto, fecha?) => Promise<void> | void
}: {
  trabajo: {
    id: string;
    presupuesto: number;
  };
  onPagar: (trabajoId: string, monto: number, fecha?: string) => Promise<void> | void;
}) {
  const [mostrar, setMostrar] = React.useState(false);
  const [monto, setMonto] = React.useState<string>("");
  const [cargando, setCargando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pagos, setPagos] = React.useState<PagoLaboratorio[]>([]);

  const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

  const cargarPagos = React.useCallback(async () => {
    try {
      setError(null);
      // 1) intento con filtro por trabajo (si tu backend lo soporta)
      const r1 = await api(`/pagos-laboratorio?trabajo_id=${encodeURIComponent(trabajo.id)}`);
      if (Array.isArray(r1)) {
        setPagos(r1);
        return;
      }
      // 2) fallback: traer todo y filtrar aquí
      const r2 = await api(`/pagos-laboratorio`);
      setPagos((Array.isArray(r2) ? r2 : []).filter((p: any) => String(p.trabajo_id) === String(trabajo.id)));
    } catch (e) {
      // si falla todo, no truena la UI
      setError("No se pudieron cargar los pagos del laboratorio.");
      setPagos([]);
    }
  }, [trabajo.id]);

  React.useEffect(() => { cargarPagos(); }, [cargarPagos]);

  const totalPagos = React.useMemo(
    () => pagos.reduce((s, p) => s + Number(p?.monto ?? 0), 0),
    [pagos]
  );
  const TBE = Math.max(0, Number(trabajo?.presupuesto ?? 0) - totalPagos);

  const procesarPago = async () => {
    const val = Number(monto);
    if (!val || val <= 0) return;
    setCargando(true);
    try {
      await onPagar(trabajo.id, val, fmtDate(new Date()));
      await cargarPagos();
      setMonto("");
      setMostrar(false);
    } catch (e) {
      setError("No se pudo registrar el pago.");
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => setMostrar((v) => !v)}
          className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-sm flex items-center gap-2"
        >
          <CreditCard className="w-4 h-4" />
          Pagar Laboratorio
        </button>

        {/* Chip TBE */}
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 text-xs font-semibold rounded bg-gray-100 text-gray-700">
            TBE
          </span>
          <span className="px-3 py-1 text-sm font-bold rounded bg-green-50 text-green-600">
            ${TBE.toLocaleString()}
          </span>
        </div>
      </div>

      {mostrar && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            type="number"
            min={0}
            placeholder="Monto a pagar"
            className="px-3 py-2 border rounded"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={procesarPago}
              disabled={cargando}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm disabled:opacity-60"
            >
              {cargando ? "Procesando..." : "Procesar Pago"}
            </button>
            <button
              type="button"
              onClick={() => setMostrar(false)}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 text-sm"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}


type Empresa = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: 'active' | 'suspended';
  ownerName: string;
  ownerEmail: string;
  branchName: string;
  phone: string;
  address: string;
};

const emptyEmpresaForm = {
  name: '', ownerName: '', email: '', password: '', branchName: '',
  phone: '', address: ''
};

function EmpresasModule() {
  const [empresas, setEmpresas] = React.useState<Empresa[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [showForm, setShowForm] = React.useState(false);
  const [editing, setEditing] = React.useState<Empresa | null>(null);
  const [form, setForm] = React.useState(emptyEmpresaForm);
  const [message, setMessage] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('/companies');
      setEmpresas(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setMessage(`Error: ${e?.message || 'No se pudieron cargar las empresas'}`);
    } finally { setLoading(false); }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyEmpresaForm);
    setMessage('');
    setShowForm(true);
  };

  const openEdit = (empresa: Empresa) => {
    setEditing(empresa);
    setForm({
      name: empresa.name, ownerName: empresa.ownerName, email: empresa.ownerEmail,
      password: '', branchName: empresa.branchName, phone: empresa.phone || '',
      address: empresa.address || ''
    });
    setMessage('');
    setShowForm(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const payload = {
        name: form.name, ownerName: form.ownerName, email: form.email,
        password: form.password, branchName: form.branchName,
        phone: form.phone, address: form.address
      };
      if (editing) {
        await api(`/companies/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        setMessage('Empresa actualizada correctamente.');
      } else {
        await api('/companies', { method: 'POST', body: JSON.stringify(payload) });
        setMessage('Empresa creada correctamente.');
      }
      setShowForm(false);
      await load();
    } catch (e: any) {
      setMessage(`Error: ${e?.message || 'No se pudo guardar'}`);
    } finally { setLoading(false); }
  };

  const changeStatus = async (empresa: Empresa, action: 'activate' | 'suspend') => {
    setLoading(true);
    setMessage('');
    try {
      await api(`/companies/${empresa.id}/${action}`, { method: 'PATCH' });
      setMessage(action === 'activate' ? 'Empresa activada.' : 'Empresa suspendida.');
      await load();
    } catch (e: any) {
      setMessage(`Error: ${e?.message || 'No se pudo cambiar el estado'}`);
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><Building2 className="w-6 h-6" /> Empresas</h2>
          <p className="text-sm text-gray-500">Administración de empresas · servicio único de $20 USD al mes.</p>
        </div>
        <button onClick={openNew} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2">
          <Plus className="w-4 h-4" /> Nueva Empresa
        </button>
      </div>

      {message && <div className={`p-3 rounded-lg border text-sm ${message.startsWith('Error') ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'}`}>{message}</div>}

      {showForm && (
        <form onSubmit={save} className="border rounded-xl p-5 bg-gray-50 space-y-4">
          <div className="flex items-center justify-between"><h3 className="font-semibold text-lg">{editing ? 'Editar Empresa' : 'Nueva Empresa'}</h3><button type="button" onClick={() => setShowForm(false)}><X className="w-5 h-5" /></button></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              ['name','Nombre empresa','text'], ['ownerName','Propietario','text'], ['email','Correo','email'],
              ['password', editing ? 'Nueva contraseña temporal (opcional)' : 'Contraseña temporal','password'],
              ['branchName','Primera sucursal','text'], ['phone','Teléfono','text'], ['address','Dirección','text']
            ].map(([key,label,type]) => (
              <label key={key} className={key === 'address' ? 'md:col-span-2' : ''}>
                <span className="block text-sm font-medium text-gray-700 mb-1">{label}</span>
                <input required={!editing || key !== 'password'} type={type} value={(form as any)[key]} onChange={e => setForm(v => ({...v,[key]:e.target.value}))} className="w-full px-3 py-2 border rounded-lg bg-white" />
              </label>
            ))}
          </div>
          <div className="flex gap-2 justify-end"><button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border rounded-lg">Cancelar</button><button disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-60">{loading ? 'Guardando...' : 'Guardar'}</button></div>
        </form>
      )}

      <div className="overflow-x-auto border rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-gray-50"><tr><th className="p-3 text-left">Empresa</th><th className="p-3 text-left">Propietario</th><th className="p-3 text-left">Precio</th><th className="p-3 text-left">Estado</th><th className="p-3 text-left">Acciones</th></tr></thead>
          <tbody>
            {empresas.map(empresa => <tr key={empresa.id} className="border-t"><td className="p-3"><div className="font-medium">{empresa.name}</div><div className="text-xs text-gray-500">{empresa.branchName}</div></td><td className="p-3"><div>{empresa.ownerName}</div><div className="text-xs text-gray-500">{empresa.ownerEmail}</div></td><td className="p-3 font-medium">$20 USD/mes</td><td className="p-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${empresa.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{empresa.status === 'active' ? 'Activa' : 'Suspendida'}</span></td><td className="p-3"><div className="flex flex-wrap gap-2"><button onClick={() => openEdit(empresa)} className="px-3 py-1.5 border rounded flex items-center gap-1"><Edit className="w-3 h-3" /> Editar</button>{empresa.status === 'active' ? <button onClick={() => changeStatus(empresa,'suspend')} className="px-3 py-1.5 border border-red-300 text-red-600 rounded">Suspender</button> : <button onClick={() => changeStatus(empresa,'activate')} className="px-3 py-1.5 border border-green-300 text-green-700 rounded">Activar</button>}</div></td></tr>)}
            {!loading && empresas.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-500">No hay empresas registradas.</td></tr>}
            {loading && <tr><td colSpan={5} className="p-8 text-center text-gray-500">Cargando...</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function App(){
  const isSuperAdmin = React.useMemo(() => isSuperAdminSession(), []);
  // Connection status
  const [isOnline, setIsOnline] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  // Main data states with reload functions
  const { data: doctors, reload: reloadDoctors } = useReloadableFetch(fetchDoctors);
  const { data: services, reload: reloadServices } = useReloadableFetch(fetchServices);
  const { data: appointments, reload: reloadAppointments } = useReloadableFetch(fetchAppointments);
  const { data: payments, reload: reloadPayments } = useReloadableFetch(fetchPayments);
  const { data: expenses, reload: reloadExpenses } = useReloadableFetch(fetchExpenses);
  const { data: laboratorios, reload: reloadLaboratorios } = useReloadableFetch(fetchLaboratorios);
  const { data: trabajos, reload: reloadTrabajos } = useReloadableFetch(fetchTrabajos);

  // UI States
  const [activeTab, setActiveTab] = useState<'agenda'|'pagos'|'analytics'|'laboratorios'|'whatsapp'|'facturacion'|'empresas'>('agenda');

  const [selectedDate, setSelectedDate] = useState<string>(fmtDate(today));
  const [selectedDoctor, setSelectedDoctor] = useState<string>('');
  const [conflictMsg, setConflictMsg] = useState('');
  const [editingApt, setEditingApt] = useState<Appointment|null>(null);



// 🆕 Estados para módulos adicionales
const [showInventory, setShowInventory] = useState(false);
const [showPatientHistory, setShowPatientHistory] = useState(false);
const [showFacturacion, setShowFacturacion] = useState(false);
const [mostrarDashboardGlobal, setMostrarDashboardGlobal] = useState(false);  // ← AGREGAR ESTA LÍNEA


// 🏥 Hook para Expediente Médico Dental Completo
const { 
  showMedicalRecord, 
  selectedPatient: selectedPatientMedical,  // ← Alias para mantener el nombre
  openMedicalRecord, 
  closeMedicalRecord 
} = useMedicalRecord();

// 🔍 DEBUG TEMPORAL
console.log('🩺 MedicalRecord State:', { 
  showMedicalRecord, 
  selectedPatientMedical 
});

// ===================== FACTURACIÓN: STATES =====================
const [clientes, setClientes] = useState<Cliente[]>([]);
const [facturas, setFacturas] = useState<Factura[]>([]);
const [configuracionSAT, setConfiguracionSAT] = useState<ConfiguracionSAT | null>(null);
const [loadingFacturacion, setLoadingFacturacion] = useState(false);
const [factLoading, setFactLoading] = useState(false);
const [factNotification, setFactNotification] = useState('');
const withFactLoading = <T extends any[]>(fn: (...args: T) => Promise<any>) => {
  return async (...args: T) => {
    setFactLoading(true);
    try {
      return await fn(...args);
    } catch (err: any) {
      console.error(err);
      setFactNotification(`Error: ${err?.message || 'desconocido'}`);
      setIsOnline(false);
      throw err;
    } finally {
      setFactLoading(false);
    }
  };
};




// Filtros de facturas
const [filtroFacturas, setFiltroFacturas] = useState({
  desde: fmtDate(addDays(today, -30)),
  hasta: fmtDate(today),
  estado: 'todas'
});

// ===================== FACTURACIÓN: FUNCTIONS =====================
const reloadClientes = async () => {
  try {
    const data = await fetchClientes();
    setClientes(data);
  } catch (error) {
    console.error('Error loading clientes:', error);
    setIsOnline(false);
  }
};

const reloadFacturas = async () => {
  try {
    const filtros = filtroFacturas.estado === 'todas'
      ? { desde: filtroFacturas.desde, hasta: filtroFacturas.hasta }
      : { ...filtroFacturas, estado: filtroFacturas.estado };
    const data = await fetchFacturas(filtros);
    setFacturas(data);
  } catch (error) {
    console.error('Error loading facturas:', error);
    setIsOnline(false);
  }
};

const reloadConfiguracion = async () => {
  try {
    const data = await fetchConfiguracionSAT();
    setConfiguracionSAT(data);
  } catch (error) {
    console.error('Error loading configuración SAT:', error);
    setIsOnline(false);
  }
};
const reloadClientesSafe      = withFactLoading(reloadClientes);
const reloadFacturasSafe      = withFactLoading(reloadFacturas);
const reloadConfiguracionSafe = withFactLoading(reloadConfiguracion);

const handleClienteCreated = async (cliente: Cliente) => {
  try {
    setFactLoading(true);
    await reloadClientes();

    // Notificación suave (sin alert)
    setFactNotification('Cliente creado exitosamente');
    setTimeout(() => setFactNotification(''), 3000);

    console.log('✅ Cliente creado:', cliente.rfc);
  } catch (error) {
    console.error('❌ Error al recargar clientes:', error);
    setFactNotification('Error al actualizar lista de clientes');
    setTimeout(() => setFactNotification(''), 5000);
  } finally {
    setFactLoading(false);
  }
};


const handleFacturaCreated = async (factura: Factura) => {
  try {
    setFactLoading(true);
    await reloadFacturas();

    setFactNotification('Factura creada exitosamente');
    setTimeout(() => setFactNotification(''), 3000);

    console.log('✅ Factura creada:', factura.folio);
  } catch (error) {
    console.error('❌ Error al recargar facturas:', error);
    setFactNotification('Error al actualizar lista de facturas');
    setTimeout(() => setFactNotification(''), 5000);
  } finally {
    setFactLoading(false);
  }
};


const handleTimbrarFactura = async (facturaId: string) => {
  if (!window.confirm('¿Estás seguro de que deseas timbrar esta factura? Una vez timbrada no se puede modificar.')) {
    return;
  }
  setLoadingFacturacion(true);
  try {
    // Timbrado real vía Facturama (sustituye al antiguo timbrarFactura)
    const res = await facturamaTimbrar({ facturaId }); // si tienes sucursalActual: { facturaId, sucursalId: sucursalActual }
    if (!res?.ok) throw new Error(res?.error || 'No se pudo timbrar');

    await reloadFacturas();
    alert('Factura timbrada exitosamente');

    // (Opcional) descarga ZIP (PDF+XML) si vino cfdiId
    if (res.cfdiId) {
      try { await facturamaDescargarZip(res.cfdiId); } catch {}
    }
  } catch (error: any) {
    alert('Error al timbrar factura: ' + (error?.message || 'Error desconocido'));
  } finally {
    setLoadingFacturacion(false);
  }
};

const handleCancelarFactura = async (facturaId: string) => {
  const motivo = window.prompt('Ingresa el motivo de cancelación:');
  if (!motivo) return;

  setLoadingFacturacion(true);
  try {
    await cancelarFactura(facturaId, motivo);
    await reloadFacturas();
    alert('Factura cancelada exitosamente');
  } catch (error: any) {
    alert('Error al cancelar factura: ' + (error?.message || 'Error desconocido'));
  } finally {
    setLoadingFacturacion(false);
  }
};


const updateConfiguracion = async (config: Partial<ConfiguracionSAT>) => {
  try {
    await updateConfiguracionSAT(config);
    await reloadConfiguracion();
    alert('Configuración actualizada exitosamente');
  } catch (error) {
    alert('Error al actualizar configuración: ' + (error instanceof Error ? error.message : 'Error desconocido'));
  }
};


  // Form states
  const [newApt, setNewApt] = useState({ 
    patient:'', doctorId:'', date: fmtDate(today), startTime:'09:00', durationHours:1, serviceId:'', phone:'' 
  });
  
  // Loading states
  const [isCreatingAppointment, setIsCreatingAppointment] = useState(false);
const [sucursalActual, setSucursalActualState] = useState(getSucursalActual)

  // ===================== CAJA MODULE STATES =====================
  const [newPayment, setNewPayment] = useState<{
    appointmentId: string;
    amount: string;
    amount2?: string; // 🆕 monto para 2do servicio
    paymentMethod: Payment['paymentMethod'];
    date: string;
    patientName?: string;
  }>({
    appointmentId: '',
    amount: '',
    amount2: '',
    paymentMethod: 'efectivo',
    date: fmtDate(today),
    patientName: '',
  });

  // 🆕 Cita seleccionada en caja (para saber si tiene 2do servicio)
  const selectedPaymentApt = useMemo(() => {
    if (!newPayment.appointmentId || newPayment.appointmentId === 'sin-cita') return null;
    return appointments.find(a => String(a.id) === String(newPayment.appointmentId)) || null;
  }, [newPayment.appointmentId, appointments]);

  const [newExpense, setNewExpense] = useState({ 
    concept:'', amount:'', date: fmtDate(today), doctorId:'', paymentMethod:'efectivo' as Payment['paymentMethod'] 
  });

  const [cajaRange, setCajaRange] = useState<'dia'|'semana'|'mes'|'rango'>('dia');
  const [cajaAnchor, setCajaAnchor] = useState<string>(fmtDate(today));
     // nuevo: límites para "rango"
  const [cajaFrom, setCajaFrom] = useState<string>(fmtDate(today));
  const [cajaTo, setCajaTo] = useState<string>(fmtDate(today));

  // ===================== LABORATORIO MODULE STATES =====================
  const [newLaboratorio, setNewLaboratorio] = useState({ nombre: '', contacto: '' });
  const [newTrabajo, setNewTrabajo] = useState({
    paciente: '',
    laboratorioId: '',
    servicioId: '',
    presupuesto: '',
    fechaInicio: fmtDate(today),
    fechaEntregaEstimada: fmtDate(addDays(today, 7)),
    etapa: 'Toma de impresión',
    notas: '',
  });
  const [newAbono, setNewAbono] = useState({
  trabajoId: '',
  monto: '',
  fecha: fmtDate(today),
  nota: '',
  paymentMethod: 'efectivo' as Payment['paymentMethod']  // ← NUEVO
});

  const [laboratorioFilter, setLaboratorioFilter] = useState<'todos'|'pendientes'|'entregados'>('todos');
  const [selectedLaboratorioFilter, setSelectedLaboratorioFilter] = useState('');
  const [editingTrabajo, setEditingTrabajo] = useState<TrabajoLaboratorio|null>(null);

  // ===================== WHATSAPP MODULE STATES =====================
  const [whatsappConfig, setWhatsappConfig] = useState<WhatsAppConfig>({
    isEnabled: false,
    phoneNumberId: '',
    accessToken: '',
    verifyToken: '',
    webhookUrl: ''
  });

  const [whatsappMessages, setWhatsappMessages] = useState<WhatsAppMessage[]>([]);
// Filtro del historial (todos / enviados / recibidos)
const [msgFilter, setMsgFilter] = useState<'all' | 'outgoing' | 'incoming'>('all');

// Lista visible: ordenada (más nuevos primero) y filtrada por tipo
const visibleMessages = useMemo(() => {
  const list = Array.isArray(whatsappMessages) ? [...whatsappMessages] : [];
  list.sort(
    (a: any, b: any) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  return list.filter((m) => msgFilter === 'all' || m.type === msgFilter);
}, [whatsappMessages, msgFilter]);

  const [loadingWhatsapp, setLoadingWhatsapp] = useState(false);
  const [whatsappStats, setWhatsappStats] = useState<WhatsAppStats>({
    totalSent: 0,
    totalReceived: 0,
    confirmations: 0,
    cancellations: 0
  });// --- Filtros de periodo para /api/whatsapp/stats ---
const [waRange, setWaRange] =
  useState<'all' | 'today' | '7d' | '30d' | 'custom'>('today');

const [waFrom, setWaFrom] = useState<string>(
  new Date().toISOString().slice(0, 10) // YYYY-MM-DD (hoy)
);
const [waTo, setWaTo] = useState<string>(
  new Date().toISOString().slice(0, 10) // YYYY-MM-DD (hoy)
);

/** Devuelve {from,to} según el rango elegido (all => sin filtro) */
const waFromTo = useMemo(() => {
  if (waRange === 'all') return { from: undefined as string | undefined, to: undefined as string | undefined };

  if (waRange === 'today') {
    const d = new Date().toISOString().slice(0, 10);
    return { from: d, to: d };
  }
  if (waRange === '7d') {
    const s = new Date(); s.setDate(s.getDate() - 6);
    return { from: s.toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) };
  }
  if (waRange === '30d') {
    const s = new Date(); s.setDate(s.getDate() - 29);
    return { from: s.toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) };
  }
  // custom
  return { from: waFrom, to: waTo };
}, [waRange, waFrom, waTo]);


  const [sendMessageForm, setSendMessageForm] = useState<SendMessageForm>({
    phone: '',
    message: '',
    template: '',
    isTemplate: false
  });

  // Check if we're still loading any data
  const allDataLoaded = doctors && services && appointments && payments && expenses && laboratorios && trabajos;

  useEffect(() => {
    if (allDataLoaded) {
      setIsLoading(false);
      setIsOnline(true);
    }
  }, [allDataLoaded]);

  // ===================== Helper Functions =====================
  const DEFAULT_DOC_COLOR = DOCTOR_PALETTE?.[0] || "#3b82f6";
  const docById = (id: any) => doctors?.find(d => String(d.id) === String(id));
  const docColor = (id: any) => docById(id)?.color ?? DEFAULT_DOC_COLOR;
  const docName = (id: any) => docById(id)?.name ?? "Sin doctor";
  const doctorById = (id?: string) => {
    const d = doctors?.find(x => String(x.id) === String(id));
    return d ?? ({ id: "", name: "Sin doctor", color: DEFAULT_DOC_COLOR } as Doctor);
  };
  const serviceById = (id?:string) => services?.find(s=>s.id===id);
  const hasConflict = () => false;

  // ===================== CAJA MODULE CALCULATIONS =====================
  const cajaRangeFromTo = useMemo(() => {
  const base = new Date(cajaAnchor);

  if (cajaRange === 'dia') {
    const d = fmtDate(base);
    return { from: d, to: d };
  }

  if (cajaRange === 'semana') {
    const s = getWeekStart(base);
    return { from: fmtDate(s), to: fmtDate(addDays(s, 6)) };
  }

  if (cajaRange === 'mes') {
    const first = new Date(base.getFullYear(), base.getMonth(), 1);
    const last  = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    return { from: fmtDate(first), to: fmtDate(last) };
  }

  // rango personalizado
  return { from: cajaFrom, to: cajaTo };
}, [cajaRange, cajaAnchor, cajaFrom, cajaTo]);


  const inCajaRange = (dateStr: string) => {
    if (!dateStr) return false;
    let normalizedDate = dateStr;
    if (dateStr.includes('T')) {
      normalizedDate = dateStr.split('T')[0];
    }
    return normalizedDate >= cajaRangeFromTo.from && normalizedDate <= cajaRangeFromTo.to;
  };

  const paymentsCajaRange = useMemo(()=> {
    const filtered = payments?.filter(p => inCajaRange(p.date)) || [];
    return filtered;
  },[payments, cajaRangeFromTo]);
  
  const expensesCajaRange = useMemo(()=> {
    const filtered = expenses?.filter(e => inCajaRange(e.date)) || [];
    return filtered;
  },[expenses, cajaRangeFromTo]);

  const totalCajaPagos = useMemo(()=> paymentsCajaRange.reduce((s,p)=> s+p.amount,0),[paymentsCajaRange]);
  const totalCajaEgresos = useMemo(()=> expensesCajaRange.reduce((s,e)=> s+e.amount,0),[expensesCajaRange]);

  // ===================== LABORATORIO MODULE CALCULATIONS =====================
  const trabajosFiltrados = useMemo(() => {
    if (!trabajos) return [];
    
    let filtered = trabajos;
    if (selectedLaboratorioFilter) {
      filtered = filtered.filter(t => t.laboratorioId === selectedLaboratorioFilter);
    }
    if (laboratorioFilter === 'pendientes') {
      filtered = filtered.filter(t => t.etapa !== 'Entregado');
    } else if (laboratorioFilter === 'entregados') {
      filtered = filtered.filter(t => t.etapa === 'Entregado');
    }
    
    return [...filtered].sort((a, b) => new Date(b.fechaInicio).getTime() - new Date(a.fechaInicio).getTime());
  }, [trabajos, laboratorioFilter, selectedLaboratorioFilter]);

  const estadisticasLab = useMemo(() => {
    if (!trabajos) return {
      trabajosPendientes: 0,
      trabajosEntregados: 0,
      montoTotalPendiente: 0,
      montoTotalAbonado: 0,
      saldoTotalPendiente: 0
    };
    
    const pendientes = trabajos.filter(t => t.etapa !== 'Entregado');
    const entregados = trabajos.filter(t => t.etapa === 'Entregado');
    
    return {
      trabajosPendientes: pendientes.length,
      trabajosEntregados: entregados.length,
      montoTotalPendiente: pendientes.reduce((sum, t) => sum + t.presupuesto, 0),
      montoTotalAbonado: pendientes.reduce((sum, t) => sum + totalAbonado(t), 0),
      saldoTotalPendiente: trabajos.reduce((sum, t) => sum + saldoPendiente(t), 0),
    };
  }, [trabajos]);

  // ===================== WHATSAPP MODULE FUNCTIONS =====================
const loadWhatsappData = async () => {
  setLoadingWhatsapp(true);
  try {
    const API_BASE = (
      (import.meta.env.VITE_API_BASE as string | undefined) ||
      'https://dentalux-sucs.onrender.com'
    ).replace(/\/$/, '');

    const suc = (sucursalActual || 'sucursal_1');

    // --- Query para /stats (fechas + sucursal)
    const statsQS = new URLSearchParams();
    if (waFromTo.from) statsQS.set('from', waFromTo.from);
    if (waFromTo.to)   statsQS.set('to',   waFromTo.to);
    if (suc)           statsQS.set('sucursal_id', suc);

    // --- Query para /messages (límite + sucursal)
    const msgsQS = new URLSearchParams({ limit: '200' });
    if (suc) msgsQS.set('sucursal_id', suc);

    const statsURL = `${API_BASE}/api/whatsapp/stats${statsQS.toString() ? `?${statsQS}` : ''}`;
    const msgsURL  = `${API_BASE}/api/whatsapp/messages?${msgsQS}`;

    // Pide todo en paralelo (SIN headers -> evita CORS)
    const [cfgRes, msgsRes, statsRes] = await Promise.all([
      fetch(`${API_BASE}/api/whatsapp/test`),
      fetch(msgsURL),
      fetch(statsURL),
    ]);

    // --- Config
    const cfg = await cfgRes.json();
    setWhatsappConfig({
      isEnabled:
        !!cfg?.ok &&
        cfg?.env?.PHONE_NUMBER_ID === 'Set' &&
        cfg?.env?.ACCESS_TOKEN === 'Set',
      phoneNumberId: String(cfg?.env?.PHONE_NUMBER_ID || ''),
      accessToken:   String(cfg?.env?.ACCESS_TOKEN || ''),
      verifyToken:   '',
      webhookUrl:    ''
    });
    setIsOnline(!!cfg?.ok);

    // --- Historial (normalizado)
    const rawMsgs = await msgsRes.json();
    const msgs = Array.isArray(rawMsgs)
      ? rawMsgs.map((m: any) => ({
          id: Number(m.id),
          type: m.type || m.direction,   // 'incoming' | 'outgoing'
          phone: m.phone,
          message: m.message || '',
          status: m.status || 'sent',
          appointmentId: m.appointment_id,
          sucursal_id: m.sucursal_id,
          manual: !!m.manual,
          timestamp: m.timestamp || m.created_at,
          contactName: m.contact_name || m.patient || m.contactName || null,
        }))
      : [];
    setWhatsappMessages(msgs);

    // --- Stats del backend (ya filtradas por from/to + sucursal)
    const s = await statsRes.json();
    setWhatsappStats({
      totalSent:     Number(s?.total_sent || 0),
      totalReceived: Number(s?.total_received || 0),
      confirmations: Number(s?.confirmations || 0),
      cancellations: Number(s?.cancellations || 0),
    });
  } catch (error) {
    console.error('Error loading WhatsApp data:', error);
    setIsOnline(false);
  } finally {
    setLoadingWhatsapp(false);
  }
};







  const handleSendMessage = async () => {
  const { phone, message, template, isTemplate } = sendMessageForm;
  if (!phone || (!isTemplate && !message)) return;

  // Normaliza a E.164 México (+521)
  const toE164MX = (v: string) => {
    const d = String(v || "").replace(/\D/g, "");
    if (d.startsWith("521") && d.length === 13) return `+${d}`;
    if (d.startsWith("52")  && d.length === 12) return `+521${d.slice(2)}`;
    if (d.length === 10) return `+521${d}`;
    const last10 = d.slice(-10);
    return last10.length === 10 ? `+521${last10}` : `+${d}`;
  };

  try {
    const API_BASE = (
      (import.meta.env.VITE_API_BASE as string | undefined) ||
      "https://dentalux-sucs.onrender.com"
    ).replace(/\/$/, "");

    // si tu selector de sucursal guarda el nombre humano,
    // no lo mandamos; el backend filtra vacío = todas
    const suc =
      typeof sucursalActual === "string" && /^sucursal_\d+$/i.test(sucursalActual)
        ? sucursalActual
        : "";

    const endpoint = isTemplate
      ? `${API_BASE}/api/whatsapp/send-template${suc ? `?sucursal_id=${encodeURIComponent(suc)}` : ""}`
      : `${API_BASE}/api/whatsapp/send-message${suc ? `?sucursal_id=${encodeURIComponent(suc)}` : ""}`;

    // armamos el payload
    const payload = isTemplate
      ? { phone: toE164MX(phone), template, lang: "es_MX", bodyParams: [] }
      : { phone: toE164MX(phone), message };

    // 🚫 quitamos el header personalizado para evitar preflight complicado
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" }, // mantén JSON
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

    setSendMessageForm({ phone: "", message: "", template: "", isTemplate: false });

    // 🔁 refresca contadores + historial
    await loadWhatsappData();

    alert("Mensaje enviado correctamente");
  } catch (error: any) {
    alert("Error al enviar mensaje: " + (error?.message || "Error desconocido"));
  }
};




  const handleLookupAppointment = async (phone: string) => {
    const result = await lookupAppointment(phone);
    if (result) {
      alert(`Información de citas:\n${JSON.stringify(result, null, 2)}`);
    }
  };

  // Cargar datos de WhatsApp al cambiar al tab
  useEffect(() => {
    if (activeTab === 'whatsapp') {
      loadWhatsappData();
    }
  }, [activeTab]);

// Cargar datos de facturación al cambiar al tab
useEffect(() => {
  if (activeTab === 'facturacion') {
    reloadClientes();
    reloadFacturas();
    reloadConfiguracion();
  }
}, [activeTab, filtroFacturas]);


  // ===================== CRUD Operations with Reload =====================

  // Appointments
  const addAppointment = async ()=>{
    setConflictMsg('');
    if(!newApt.patient || !newApt.doctorId || !newApt.serviceId) return;
    if(hasConflict()) return;

    setIsCreatingAppointment(true);
    
    try {
      const newAppointmentData = await createAppointment({
        patient: newApt.patient,
        doctorId: newApt.doctorId,
        date: newApt.date,
        startTime: newApt.startTime,
        durationHours: Number(newApt.durationHours),
        serviceId: newApt.serviceId,
        phone: newApt.phone,
        status: 'Pendiente'
      });

      await reloadAppointments();
      
      setNewApt({ 
        patient:'', 
        doctorId:'', 
        date: newApt.date,
        startTime:'09:00', 
        durationHours:1, 
        serviceId:'', 
        phone:'' 
      });

      console.log('✅ Cita creada exitosamente:', newAppointmentData);
      
    } catch (error) {
      console.error('❌ Error creating appointment:', error);
      setConflictMsg('Error al crear la cita: ' + (error instanceof Error ? error.message : 'Error desconocido'));
      setIsOnline(false);
      
      try {
        await reloadAppointments();
      } catch (reloadError) {
        console.error('Error al recargar citas:', reloadError);
      }
    } finally {
      setIsCreatingAppointment(false);
    }
  };

  const updateAptStatus = async (id: number, status: Appointment['status']) => {
    try {
      await updateAppointment(id, { status });
      await reloadAppointments();
    } catch (error) {
      console.error('Error updating appointment status:', error);
      setIsOnline(false);
    }
  };

  const deleteAppointment = async (id: number) => {
    try {
      await deleteAppointmentById(id);
      await reloadAppointments();
    } catch (error) {
      console.error('Error deleting appointment:', error);
      setIsOnline(false);
    }
  };

  const saveEditingApt = async ()=>{
    if(!editingApt) return;
    if(hasConflict()) { setConflictMsg('Conflicto de horario.'); return; }
    
    try {
      setExtraServiceForAppointment(String(editingApt.id), editingApt.serviceId2);
      await updateAppointment(editingApt.id, editingApt);
      await reloadAppointments();
      setEditingApt(null);
    } catch (error) {
      console.error('Error updating appointment:', error);
      setConflictMsg('Error al actualizar la cita');
      setIsOnline(false);
    }
  };

// ==================== API REQUEST GLOBAL ====================
// Función central para todas las llamadas al backend (médico, facturación, inventario, etc.)
const apiRequest = async (endpoint: string, options: any = {}) => {
  const { method = 'GET', body, sucursalId: optionSucursalId } = options;
  const currentSucursal = optionSucursalId || getSucursalActual() || 'sucursal_1';

  // URL base para ambientes en Render o local
  const API_BASE =
    window.location.hostname.includes('onrender.com')
      ? 'https://backenddemo-fve8.onrender.com'
      : '';

  const url =
    `${API_BASE}/api` +
    (endpoint.startsWith('/') ? endpoint : `/${endpoint}`);

  const config: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-sucursal': currentSucursal,
    },
  };

  if (body && method !== 'GET') {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(url, config);

  // Si no hay respuesta válida o el backend devolvió error
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${data?.error || response.statusText}`);
  }

  return data;
};


  const setAptTime = async (id: number, date: string, startTime: string) => { 
    try {
      await updateAppointment(id, { date, startTime });
      await reloadAppointments();
    } catch (error) {
      console.error('Error updating appointment time:', error);
      setIsOnline(false);
    }
  };

  const setAptDuration = async (id: number, durationHours: number) => {
    const d = Math.max(0.5, Math.min(6, Math.round(durationHours * 2) / 2));
    try {
      await updateAppointment(id, { durationHours: d });
      await reloadAppointments();
    } catch (error) {
      console.error('Error updating appointment duration:', error);
      setIsOnline(false);
    }
  };

  const handleTimeSlotClick = (time: string) => { 
    setNewApt(prev => ({ ...prev, startTime: time })); 
  };

  // Doctors
  const [newDoctor, setNewDoctor] = useState({
    name: '',
    color: DOCTOR_PALETTE[0],
  });

  const addDoctor = async () => {
    if (!newDoctor.name.trim()) return;
    
    try {
      await createDoctor({
        name: newDoctor.name.trim(),
        color: newDoctor.color
      });
      
      await reloadDoctors();
      setNewDoctor({
        name: '',
        color: DOCTOR_PALETTE[((doctors?.length || 0) + 1) % DOCTOR_PALETTE.length],
      });
    } catch (error) {
      console.error('Error creating doctor:', error);
      setIsOnline(false);
    }
  };

  const removeDoctor = async (id: string) => {
    try {
      await deleteDoctor(id);
      await reloadDoctors();
    } catch (error) {
      console.error('Error deleting doctor:', error);
      setIsOnline(false);
    }
  };

  // Services
  const [newService, setNewService] = useState({ name:'' });
  
  const addService = async ()=>{
    if(!newService.name) return;
    
    try {
      await createService({ name: newService.name });
      await reloadServices();
      setNewService({ name: '' });
    } catch (error) {
      console.error('Error creating service:', error);
      setIsOnline(false);
    }
  };

  const removeService = async (id: string) => {
    try {
      await deleteService(id);
      await reloadServices();
    } catch (error) {
      console.error('Error deleting service:', error);
      setIsOnline(false);
    }
  };

  // ===================== CAJA MODULE FUNCTIONS =====================
  const addPayment = async () => {
    if (!newPayment.amount) return;

    try {
      // Caso: pago sin cita
      if (newPayment.appointmentId === 'sin-cita') {
        if (!newPayment.patientName) return;

        const paymentData = {
          patient: newPayment.patientName,
          service_id: services?.[0]?.id || '1',
          amount: Number(newPayment.amount),
          payment_method: newPayment.paymentMethod,
          date: newPayment.date,
          doctor_id: Number(doctors?.[0]?.id || '1'),
        };

        await createPayment(paymentData);
        await reloadPayments();

        setNewPayment({
          appointmentId: '',
          amount: '',
          amount2: '',
          patientName: '',
          paymentMethod: 'efectivo',
          date: fmtDate(new Date()),
        });
        return;
      }

      // Caso: pago ligado a cita
      const apt = appointments.find(a => String(a.id) === String(newPayment.appointmentId));
      if (!apt) return;

      const base1 = {
        appointment_id: Number(newPayment.appointmentId),
        patient: apt.patient,
        service_id: Number(apt.serviceId),
        amount: Number(newPayment.amount),
        payment_method: newPayment.paymentMethod,
        date: newPayment.date,
        doctor_id: Number(apt.doctorId),
      };

      const batch: any[] = [base1];

      // 🆕 Si la cita tiene 2do servicio, registramos un 2do pago (si hay monto2)
      if (apt.serviceId2) {
        const amt2 = Number(newPayment.amount2 || 0);
        if (amt2 > 0) {
          batch.push({
            ...base1,
            service_id: Number(apt.serviceId2),
            amount: amt2,
          });
        }
      }

      for (const p of batch) {
        await createPayment(p);
      }

      await reloadPayments();

      setNewPayment({
        appointmentId: '',
        amount: '',
        amount2: '',
        patientName: '',
        paymentMethod: 'efectivo',
        date: fmtDate(new Date()),
      });
    } catch (error) {
      console.error('Error creating payment:', error);
      alert('Error al registrar pago');
      setIsOnline(false);
    }
  };


  const addExpense = async ()=>{ 
    if(!newExpense.concept || !newExpense.amount) return; 
    
    try {
      await createExpense({
        concept: newExpense.concept,
        amount: Number(newExpense.amount),
        date: newExpense.date,
        doctorId: newExpense.doctorId || undefined,
        paymentMethod: newExpense.paymentMethod
      });
      
      await reloadExpenses();
      setNewExpense({ concept:'', amount:'', date:newExpense.date, doctorId:'', paymentMethod:'efectivo' });
    } catch (error) {
      console.error('Error creating expense:', error);
      setIsOnline(false);
    }
  };

  // ===================== LABORATORIO MODULE FUNCTIONS =====================
  const addLaboratorio = async () => {
    if (!newLaboratorio.nombre.trim()) return;
    
    try {
      await createLaboratorio({
        nombre: newLaboratorio.nombre.trim(),
        contacto: newLaboratorio.contacto.trim()
      });
      
      await reloadLaboratorios();
      setNewLaboratorio({ nombre: '', contacto: '' });
    } catch (error) {
      console.error('Error creating laboratorio:', error);
      setIsOnline(false);
    }
  };

  // REEMPLAZA TODA tu función addTrabajo por ESTA
const addTrabajo = async () => {
  // Validación mínima de formulario
  if (
    !newTrabajo.paciente ||
    !newTrabajo.laboratorioId ||
    !newTrabajo.servicioId ||
    !newTrabajo.presupuesto
  ) return;

  // Asegura que el laboratorio seleccionado realmente existe (evita FK 23503)
  const labOk = Array.isArray(laboratorios)
    && laboratorios.some(l => String(l.id) === String(newTrabajo.laboratorioId));
  if (!labOk) {
    alert('Selecciona un laboratorio válido (el id no existe en la tabla laboratorios).');
    return;
  }

  // (Opcional) valida servicio si quieres
  // const servOk = Array.isArray(services)
  //   && services.some(s => String(s.id) === String(newTrabajo.servicioId));
  // if (!servOk) { alert('Selecciona un servicio válido.'); return; }

  // Normaliza fechas a 'YYYY-MM-DD' si tienes helper; si no, usa lo que trae el form
  const normDate = (v: any) => {
    // usa toDateInput si lo tienes definido en el archivo
    // @ts-ignore
    if (typeof toDateInput === 'function') return toDateInput(v);
    if (!v) return '';
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const d = new Date(v);
    if (isNaN(d.getTime())) return '';
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };

  // dentro de addTrabajo, reemplaza el payload actual por este:
const payload = {
  paciente: newTrabajo.paciente.trim(),
  laboratorioId: String(newTrabajo.laboratorioId),     // 👈 camelCase
  servicioId: Number(newTrabajo.servicioId),           // 👈 camelCase
  presupuesto: Number(newTrabajo.presupuesto),
  fechaInicio: normDate(newTrabajo.fechaInicio),       // 👈 camelCase
  fechaEntregaEstimada: normDate(newTrabajo.fechaEntregaEstimada),
  etapa: newTrabajo.etapa || 'Toma de impresión',
  notas: newTrabajo.notas?.trim() || null,
};
  try {
    await createTrabajo(payload);        // tu helper ya hace POST /api/trabajos-laboratorio
    await reloadTrabajos();              // refresca la lista

    // Reset del formulario
    setNewTrabajo({
      paciente: '',
      laboratorioId: '',
      servicioId: '',
      presupuesto: '',
      fechaInicio: fmtDate(today),
      fechaEntregaEstimada: fmtDate(addDays(today, 7)),
      etapa: 'Toma de impresión',
      notas: '',
    });
    setIsOnline(true);
  } catch (error) {
    console.error('Error creating trabajo:', error);
    setIsOnline(false);
  }
};


  const addAbonoToTrabajo = async () => {
  if (!newAbono.trabajoId || !newAbono.monto) return;

  try {
    await createAbono(newAbono.trabajoId, {
      monto: Number(newAbono.monto),
      fecha: newAbono.fecha,
      nota: newAbono.nota,
      paymentMethod: newAbono.paymentMethod // ← NUEVO
    });

    await reloadTrabajos();
    setNewAbono({
      trabajoId: '',
      monto: '',
      fecha: fmtDate(today),
      nota: '',
      paymentMethod: 'efectivo' as Payment['paymentMethod'] // ← NUEVO
    });
  } catch (error) {
    console.error('Error creating abono:', error);
    setIsOnline(false);
  }
};

const handleAddAbono = async () => {
  if (!newAbono.trabajoId || !newAbono.monto) return;
  
  try {
    const abonoData = {
      monto: parseFloat(newAbono.monto),
      fecha: newAbono.fecha,
      nota: newAbono.nota,
      metodo_pago: newAbono.metodo_pago || 'efectivo'
    };
    
    await api.post(`/trabajos-laboratorio/${newAbono.trabajoId}/abonos`, abonoData);
    
    // Limpiar formulario
    setNewAbono({
      trabajoId: '',
      monto: '',
      fecha: new Date().toISOString().split('T')[0],
      nota: '',
      metodo_pago: 'efectivo'
    });
    
    // Recargar datos
    await reloadTrabajos();
  } catch (error) {
    console.error('Error adding abono:', error);
  }
};


// ===================== LABORATORIO: pagar laboratorio =====================
const pagarLaboratorio = async (
  trabajoId: string,
  monto: number,
  fecha: string = fmtDate(today)
) => {
  // Validación mínima
  if (!trabajoId || !monto || Number(monto) <= 0) return;

  try {
    // POST directo al backend usando tu helper `api` (ya importado en App.tsx)
    await api('/pagos-laboratorio', {
      method: 'POST',
      body: JSON.stringify({
        trabajo_id: String(trabajoId),
        monto: Number(monto),
        fecha
      })
    });

    // Recarga la lista de trabajos por si el backend refleja cambios
    await reloadTrabajos();
    setIsOnline(true);
  } catch (error) {
    console.error('Error pagando laboratorio:', error);
    setIsOnline(false);
    // (opcional) aquí podrías mostrar un alert si quieres feedback inmediato
    // alert('No se pudo registrar el pago de laboratorio.');
  }
};


  // Helper functions for laboratorios
  const laboratorioById = (id: string) => laboratorios?.find(l => l.id === id);

// Handler para cambio de sucursal
const handleSucursalChange = async (nuevaSucursal: string) => {
  console.log(`🔄 App: Cambiando a sucursal ${nuevaSucursal}`);
  setSucursalActualState(nuevaSucursal);
  
  // Recargar todos los datos cuando cambie la sucursal
  try {
    await Promise.all([
      reloadDoctors(),
      reloadServices(), 
      reloadAppointments(),
      reloadPayments(),
      reloadExpenses(),
      reloadLaboratorios(),
      reloadTrabajos()
    ]);
    console.log('✅ Todos los datos recargados para la nueva sucursal');
  } catch (err) {
    console.error('❌ Error recargando datos:', err);
    setIsOnline(false);
  }
};

  const updateTrabajoLab = async (id: string, data: Partial<TrabajoLaboratorio>) => {
    try {
      await updateTrabajo(id, data);
      await reloadTrabajos();
    } catch (error) {
      console.error('Error updating trabajo:', error);
      setIsOnline(false);
    }
  };
  
  

/* ===================== UI Components ===================== */
// Confirmada y Pendiente usan el color del doctor.
// Solo Atendida (verde) y Cancelada (rojo) sobreescriben ese color.
const blockStylesByStatus = (baseColor: string, status: Appointment['status']) => {
  if (status === 'Atendida') {
    return { background: '#22c55e', color: '#ffffff', border: '2px solid #16a34a' };
  }
  if (status === 'Cancelada') {
    return { background: '#ef4444', color: '#ffffff', border: '2px solid #dc2626' };
  }
  // Confirmada o Pendiente → color del doctor
  return { background: baseColor, color: '#ffffff', border: `2px solid ${baseColor}` };
};


const CornerChecks = ({ status }: { status: Appointment['status'] }) => {
  const count = status === 'Atendida' ? 2 : status === 'Confirmada' ? 1 : 0;
  if (count === 0) return null;
  return (
    <div className="absolute top-1 right-1 flex gap-0.5 text-[10px] leading-none text-white">
      <span>✓</span>
      {count === 2 && <span>✓</span>}
    </div>
  );
};

function StatusMenu({ onPick, onClose }:{ onPick: (s: Appointment['status']) => void, onClose: ()=>void }){
  return (
    <div className="absolute z-20 left-1 -top-24 bg-white border rounded-lg shadow-lg text-xs overflow-hidden min-w-[140px]">
      <div className="px-3 py-2 bg-gray-50 font-semibold text-gray-700 border-b">Cambiar Estado</div>
      <button 
        className="px-3 py-2 hover:bg-purple-50 w-full text-left text-black border-b flex items-center gap-2" 
        onClick={()=>{onPick('Confirmada'); onClose()}}
      >
        <div className="w-3 h-3 rounded-full bg-purple-500"></div>
        Confirmada
      </button>
      <button 
        className="px-3 py-2 hover:bg-green-50 w-full text-left text-black border-b flex items-center gap-2" 
        onClick={()=>{onPick('Atendida'); onClose()}}
      >
        <div className="w-3 h-3 rounded-full bg-green-500"></div>
        Atendida
      </button>
      <button 
        className="px-3 py-2 hover:bg-red-50 w-full text-left text-black border-b flex items-center gap-2" 
        onClick={()=>{onPick('Cancelada'); onClose()}}
      >
        <div className="w-3 h-3 rounded-full bg-red-500"></div>
        Cancelada
      </button>
      <button 
        className="px-3 py-2 hover:bg-yellow-50 w-full text-left text-black flex items-center gap-2" 
        onClick={()=>{onPick('Pendiente'); onClose()}}
      >
        <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
        Pendiente
      </button>
    </div>
  );
}

function TimeSlotsSidebar({ selectedDoctor, onTimeSlotClick }: { selectedDoctor: string, onTimeSlotClick: (time: string) => void }) {
  const startHour = 8;
  const endHour = 20;
  const slots: string[] = [];
  for (let h = startHour; h < endHour; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    slots.push(`${String(h).padStart(2, '0')}:30`);
  }

  if (!selectedDoctor) {
    return (
      <div className="w-64 bg-gray-50 p-4 rounded-lg border">
        <div className="text-center text-gray-500">
          <Calendar className="w-8 h-8 mx-auto mb-2" />
          <p className="text-sm">Selecciona un doctor para ver los horarios disponibles</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-64 bg-white border rounded-xl shadow-sm">
      <div className="p-4 border-b bg-blue-50">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2">
          <Calendar className="w-4 h-4" />
          Horarios Disponibles
        </h3>
        <p className="text-xs text-gray-600 mt-1">Intervalos de 30 minutos</p>
      </div>
      <div className="p-2 max-h-96 overflow-y-auto">
        <div className="grid grid-cols-2 gap-1">
          {slots.map(slot => (
            <button
              key={slot}
              onClick={() => onTimeSlotClick(slot)}
              className="px-2 py-1 text-xs bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded transition-colors text-center font-medium text-blue-700"
            >
              {slot}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ===================== Day View Component ===================== */
type DayViewProps = {
  date: Date,
  items: Appointment[],
  getDoctor: (id:string)=>Doctor,
  serviceById: (id:string)=>Service|undefined,
  onStatus: (id:number, st:Appointment['status'])=>void,
  onEdit: (apt:Appointment)=>void,
  onMove: (id:number, newDate:string, newTime:string)=>void,
  onResize: (id:number, newDuration:number)=>void,
  selectedDoctor: string,
  onDoctorFilter: (doctorId: string) => void,
  doctors: Doctor[],
  onTimeSlotClick: (time: string) => void
}

function DayView({
  date, items, getDoctor, serviceById, onStatus, onEdit, onMove, onResize, selectedDoctor, onDoctorFilter, doctors, onTimeSlotClick
}: DayViewProps){
  const startMins = 8*60, endMins = 20*60, slotPx = 40;
  const slots: {time:string}[] = [];
  for(let m=startMins; m<=endMins; m+=30) slots.push({ time: minsToTime(m) });

  const [drag, setDrag] = React.useState<null | {
    id: number, mode: 'move'|'resize', originY: number, originTime: string, originDuration: number
  }>(null);
  const [openMenuId, setOpenMenuId] = React.useState<number|null>(null);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  const filteredItems = selectedDoctor ? items.filter(a => a.doctorId === selectedDoctor) : items;

  const onPointerDownMove = (e: React.PointerEvent, a: Appointment) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: a.id, mode: 'move', originY: e.clientY, originTime: a.startTime, originDuration: a.durationHours });
  };

  const onPointerDownResize = (e: React.PointerEvent, a: Appointment) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: a.id, mode: 'resize', originY: e.clientY, originTime: a.startTime, originDuration: a.durationHours });
  };

  React.useEffect(() => {
    if (!drag) return;

    const handlePointerMove = (e: PointerEvent) => {
      const dy = e.clientY - drag.originY;
      const deltaSlots = Math.round(dy / slotPx);
      const deltaMins = deltaSlots * 30;

      if (drag.mode === 'move') {
        const newTime = addMinutesToTime(drag.originTime, deltaMins);
        onMove(drag.id, fmtDate(date), newTime);
      } else {
        const newDur = Math.max(0.5, Math.min(6, drag.originDuration + deltaSlots*0.5));
        onResize(drag.id, newDur);
      }
    };

    const handlePointerUp = () => setDrag(null);

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [drag, date, onMove, onResize, slotPx]);

  const docColor = (id: any) => getDoctor(id)?.color ?? DOCTOR_PALETTE[0];

  return (
    <div className="flex gap-2 relative">
      {sidebarOpen && (
        <div className="w-64 space-y-2">
          <div className="bg-white border rounded-xl p-4 shadow-sm">
            <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <Filter className="w-4 h-4" />
              Filtrar por Doctor
            </h3>
            <button
              onClick={() => onDoctorFilter('')}
              className={'w-full text-left px-3 py-2 rounded-lg mb-2 transition-colors ' + (!selectedDoctor ? 'bg-blue-100 text-blue-800 border border-blue-200' : 'hover:bg-gray-50 border border-gray-200')}
            >
              Todos los doctores
            </button>
            <div className="space-y-1">
              {doctors.map(doc => (
                <button
                  key={doc.id}
                  onClick={() => onDoctorFilter(doc.id)}
                  className={'w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center gap-2 ' + (selectedDoctor === doc.id ? 'text-white' : 'hover:bg-gray-50 border border-gray-200')}
                  style={selectedDoctor === doc.id ? { backgroundColor: doc.color } : {}}
                >
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: doc.color }} />
                  <span className="text-sm">{doc.name}</span>
                </button>
              ))}
            </div>
          </div>

          <TimeSlotsSidebar selectedDoctor={selectedDoctor} onTimeSlotClick={onTimeSlotClick} />
        </div>
      )}

      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed left-2 sm:left-4 top-24 sm:top-32 z-30 w-9 h-9 sm:w-10 sm:h-10 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 flex items-center justify-center"
        title={sidebarOpen ? "Ocultar filtros" : "Mostrar filtros"}
      >
        {sidebarOpen ? <X className="w-5 h-5" /> : <Filter className="w-5 h-5" />}
      </button>

      <div className="flex-1">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">{fmtDate(date)} — Vista del día</h3>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            {selectedDoctor && (
              <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 rounded-full">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getDoctor(selectedDoctor)?.color }} />
                <span>Filtrando: {getDoctor(selectedDoctor)?.name}</span>
                <button onClick={() => onDoctorFilter('')} className="ml-1 text-blue-600 hover:text-blue-800">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
        
        <div className="border rounded-xl overflow-hidden select-none bg-white shadow-sm">
          <div className="grid grid-cols-12 bg-gray-50 text-xs text-gray-500 border-b">
            <div className="col-span-2 p-3 font-medium">Hora</div>
            <div className="col-span-10 p-3 font-medium">Citas</div>
          </div>
          <div>
            {slots.map((s, i) => {
              const starting = filteredItems.filter(a => a.startTime === s.time);
              return (
                <div key={i} className="grid grid-cols-12 border-t" style={{height: slotPx}}>
                  <div className="col-span-2 px-3 py-2 text-sm text-gray-600 bg-gray-50 border-r font-medium">{s.time}</div>
                  <div className="col-span-10 relative">
                    <div className="absolute inset-0 px-2">
                      {starting.map((a, laneIdx) => {
  const doc = getDoctor(a.doctorId);
  const styles = blockStylesByStatus(docColor(a.doctorId), a.status);
  
const baseHeight = Math.max(36, (a.durationHours * 60 / 30 * slotPx));
const gap = 3;
const N = starting.length; // cuántas inician en esta hora exacta
const citaHeight = N > 1
  ? Math.floor((slotPx - (N - 1) * gap) / N)
  : baseHeight;
const offsetTop = laneIdx * (citaHeight + gap);
  
  return (
    <div
      key={a.id}
      className="relative rounded-lg p-2 shadow-md cursor-grab active:cursor-grabbing border touch-none"
      style={{ 
        ...styles,
        height: citaHeight,
        width: '100%',
        left: '0%',
        top: offsetTop,
        position: 'absolute',
        zIndex: 20 + laneIdx,
        minHeight: '32px',
      }}
      onPointerDown={(e)=>onPointerDownMove(e,a)}
      title={a.patient + ' • ' + ((serviceById(a.serviceId)?.name) || '')}
      onDoubleClick={!isTouchDevice ? () => onEdit(a) : undefined}
      onClick={isTouchDevice ? (e) => { e.stopPropagation(); onEdit(a); } : undefined}
    >
      <CornerChecks status={a.status} />
      <div className="font-semibold truncate text-white text-xs leading-tight">{a.patient}</div>
      {citaHeight > 32 && (
        <>
          <div className="text-xs opacity-90 truncate text-white leading-tight">{serviceById(a.serviceId)?.name}</div>
          {citaHeight > 40 && a.phone && (
            <div className="text-xs opacity-75 text-white leading-tight">{a.phone}</div>
          )}
        </>
      )}
      <div
        onPointerDown={(e)=>onPointerDownResize(e,a)}
        className="absolute bottom-0 left-0 right-0 h-1 bg-black/20 hover:bg-black/30 rounded-b cursor-ns-resize"
      />
      <button
  onClick={(e)=>{ e.stopPropagation(); setOpenMenuId(openMenuId===a.id?null:a.id) }}
  className={
    "absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full bg-white/90 backdrop-blur-sm " +
    "grid place-items-center text-[9px] hover:bg-white transition-colors font-bold shadow-sm " +
    (a.status === 'Atendida'   ? "text-green-600"  :
     a.status === 'Cancelada'  ? "text-red-600"    :
     a.status === 'Confirmada' ? "text-purple-600" :
                                 "text-yellow-500")
  }
  title="Cambiar estado"
>
  {a.status === 'Atendida' ? '✓✓' :
   a.status === 'Confirmada' ? '✓' :
   a.status === 'Cancelada' ? '✗' : '?'}
</button>
      {openMenuId===a.id && (
        <StatusMenu onPick={(st)=> onStatus(a.id, st)} onClose={()=> setOpenMenuId(null)} />
      )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="text-xs text-gray-500 mt-2">Arrastra para cambiar hora. Usa el borde inferior para ajustar duración (30 min).</div>
      </div>
    </div>
  );
}

/* ===================== Week View Component ===================== */
type WeekViewProps = {
  days: Date[],
  appointments: Appointment[],
  getDoctor: (id:string)=>Doctor,
  serviceById: (id:string)=>Service|undefined,
  onStatus: (id:number, st:Appointment['status'])=>void,
  onEdit: (apt:Appointment)=>void,
  onMove: (id:number, newDate:string, newTime:string)=>void,
  onResize: (id:number, newDuration:number)=>void,
  selectedDoctor: string,
  onDoctorFilter: (doctorId: string) => void,
  doctors: Doctor[],
  onTimeSlotClick: (time: string) => void
}

function WeekView({ days, getDoctor, serviceById, onStatus, onEdit, onMove, onResize, selectedDoctor, onDoctorFilter, doctors, onTimeSlotClick }: WeekViewProps){
const startHour = 8, endHour = 20, slotsPerHour = 2;
const totalSlots = (endHour - startHour) * slotsPerHour;
const slotPx = 40;
const hours = Array.from({length: endHour - startHour}).map((_,i)=> startHour + i);
const fmtWeekday = (d: Date) =>
new Intl.DateTimeFormat('es-MX', { weekday: 'short' })
.format(d)
.replace('.', '');
const fmtHour12 = (h: number) => {
const ampm = h < 12 ? 'am' : 'pm';
const h12 = h % 12 === 0 ? 12 : h % 12;
return `${h12}${ampm}`;
};
const startIndex = (a: Appointment) => {
const [H,M] = a.startTime.split(':').map(Number);
return (H - startHour) * slotsPerHour + (M >= 30 ? 1 : 0);
};
const spanSlots = (a: Appointment) => Math.max(1, Math.round(a.durationHours * slotsPerHour));
const [drag, setDrag] = React.useState<null | {
id: number, mode:'move'|'resize', originY: number, originStartIdx: number, originDuration: number, dayIndex: number
}>(null);
const [openMenuId, setOpenMenuId] = React.useState<number|null>(null);
const [sidebarOpen, setSidebarOpen] = React.useState(false);
const onPointerDownMove = (e: React.PointerEvent, a: Appointment, dayIndex: number) => {
e.preventDefault();
(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
setDrag({ id: a.id, mode: 'move', originY: e.clientY, originStartIdx: startIndex(a), originDuration: a.durationHours, dayIndex });
};
const onPointerDownResize = (e: React.PointerEvent, a: Appointment, dayIndex: number) => {
e.preventDefault();
e.stopPropagation();
(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
setDrag({ id: a.id, mode: 'resize', originY: e.clientY, originStartIdx: startIndex(a), originDuration: a.durationHours, dayIndex });
};
React.useEffect(() => {
if (!drag) return;
const handlePointerMove = (e: PointerEvent) => {
  const dy = e.clientY - drag.originY;
  const deltaSlots = Math.round(dy / slotPx);
  const curDate = fmtDate(days[drag.dayIndex]);

  if (drag.mode === 'move') {
    let newIdx = drag.originStartIdx + deltaSlots;
    const clampedIdx = Math.max(0, Math.min(totalSlots - 1, newIdx));
    const mins = (startHour*60) + clampedIdx*30;
    const newTime = minsToTime(mins);
    onMove(drag.id, curDate, newTime);
  } else {
    let newDur = drag.originDuration + deltaSlots*0.5;
    newDur = Math.max(0.5, Math.min(6, newDur));
    onResize(drag.id, newDur);
  }
};

const handlePointerUp = () => setDrag(null);

window.addEventListener('pointermove', handlePointerMove);
window.addEventListener('pointerup', handlePointerUp);
return () => {
  window.removeEventListener('pointermove', handlePointerMove);
  window.removeEventListener('pointerup', handlePointerUp);
};
}, [drag, days, onMove, onResize, slotPx, totalSlots, startHour]);
const docColor = (id: any) => getDoctor(id)?.color ?? DOCTOR_PALETTE[0];
return (
<div className="flex flex-col lg:flex-row gap-2 relative">
{/* Sidebar móvil como modal */}
{sidebarOpen && (
<div className="fixed inset-0 z-40 lg:hidden">
<div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
<div className="absolute right-0 top-0 bottom-0 w-80 bg-white shadow-xl overflow-y-auto p-4 space-y-4">
<div className="flex justify-between items-center mb-4">
<h3 className="font-semibold text-gray-800">Filtros</h3>
<button onClick={() => setSidebarOpen(false)} className="p-2">
<X className="w-5 h-5" />
</button>
</div>
        <div className="bg-white border rounded-xl p-4 shadow-sm">
          <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <Filter className="w-4 h-4" />
            Filtrar por Doctor
          </h3>
          <button
            onClick={() => { onDoctorFilter(''); setSidebarOpen(false); }}
            className={'w-full text-left px-3 py-2 rounded-lg mb-2 transition-colors ' + (!selectedDoctor ? 'bg-blue-100 text-blue-800 border border-blue-200' : 'hover:bg-gray-50 border border-gray-200')}
          >
            Todos los doctores
          </button>
          <div className="space-y-1">
            {doctors.map(doc => (
              <button
                key={doc.id}
                onClick={() => { onDoctorFilter(doc.id); setSidebarOpen(false); }}
                className={'w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center gap-2 ' + (selectedDoctor === doc.id ? 'text-white' : 'hover:bg-gray-50 border border-gray-200')}
                style={selectedDoctor === doc.id ? { backgroundColor: doc.color } : {}}
              >
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: doc.color }} />
                <span className="text-sm">{doc.name}</span>
              </button>
            ))}
          </div>
        </div>

        <TimeSlotsSidebar selectedDoctor={selectedDoctor} onTimeSlotClick={(time) => { onTimeSlotClick(time); setSidebarOpen(false); }} />
      </div>
    </div>
  )}

  {/* Sidebar desktop */}
  <div className="hidden lg:block lg:w-64 space-y-2">
    <div className="bg-white border rounded-xl p-4 shadow-sm">
      <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
        <Filter className="w-4 h-4" />
        Filtrar por Doctor
      </h3>
      <button
        onClick={() => onDoctorFilter('')}
        className={'w-full text-left px-3 py-2 rounded-lg mb-2 transition-colors ' + (!selectedDoctor ? 'bg-blue-100 text-blue-800 border border-blue-200' : 'hover:bg-gray-50 border border-gray-200')}
      >
        Todos los doctores
      </button>
      <div className="space-y-1">
        {doctors.map(doc => (
          <button
            key={doc.id}
            onClick={() => onDoctorFilter(doc.id)}
            className={'w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center gap-2 ' + (selectedDoctor === doc.id ? 'text-white' : 'hover:bg-gray-50 border border-gray-200')}
            style={selectedDoctor === doc.id ? { backgroundColor: doc.color } : {}}
          >
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: doc.color }} />
            <span className="text-sm">{doc.name}</span>
          </button>
        ))}
      </div>
    </div>

    <TimeSlotsSidebar selectedDoctor={selectedDoctor} onTimeSlotClick={onTimeSlotClick} />
  </div>

  {/* Botón flotante para abrir filtros en móvil */}
  <button
    onClick={() => setSidebarOpen(!sidebarOpen)}
    className="fixed right-4 bottom-4 lg:hidden z-30 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 flex items-center justify-center"
    title="Mostrar filtros"
  >
    <Filter className="w-6 h-6" />
  </button>

  <div className="flex-1 overflow-x-auto">
    <div className="flex items-center justify-between mb-3 px-2">
      <h3 className="text-base sm:text-lg font-semibold">Semana</h3>
      <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-600">
        {selectedDoctor && (
          <div className="flex items-center gap-2 px-2 sm:px-3 py-1 bg-blue-50 rounded-full">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getDoctor(selectedDoctor)?.color }} />
            <span className="hidden sm:inline">Filtrando: {getDoctor(selectedDoctor)?.name}</span>
            <span className="sm:hidden">{getDoctor(selectedDoctor)?.name}</span>
            <button onClick={() => onDoctorFilter('')} className="ml-1 text-blue-600 hover:text-blue-800">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>

    <div className="w-full overflow-x-auto"><div className="min-w-[600px]">
      <div className="grid grid-cols-8 text-xs bg-gray-50 border rounded-t-xl overflow-hidden">
        <div className="p-2 font-medium">Hora</div>
        {days.map((d,i)=> (<div key={i} className="p-2 text-center font-medium">{fmtWeekday(d)}</div>))}
      </div>

      <div className="grid grid-cols-8 border rounded-b-xl relative bg-white">
        <div className="col-span-1 border-r bg-gray-50 relative">
          {hours.map(h=> (
            <div key={h} className="border-t" style={{height: slotPx*slotsPerHour}}>
              <div className="px-2 py-1 text-xs text-gray-600 font-medium">{fmtHour12(h)}</div>
              <div className="border-t mx-2 opacity-30" style={{marginTop: slotPx-1}}/>
            </div>
          ))}
        </div>

        {days.map((d,dayIdx)=>{
          const dayKey = fmtDate(d);
          const filteredItems = appointments.filter(a =>
            a.date === dayKey && (!selectedDoctor || a.doctorId === selectedDoctor)
          );
const groups = new Map<number, Appointment[]>();
          filteredItems.forEach(a=>{ const si = startIndex(a); const arr = groups.get(si) || []; arr.push(a); groups.set(si, arr); });

          return (
            <div key={dayIdx} className="col-span-1 border-l relative" style={{height: totalSlots*slotPx}}>
              {Array.from({length: totalSlots}).map((_,i)=> (<div key={i} className="border-t border-dotted border-gray-200" style={{height: slotPx}}/>))}

              {Array.from(groups.entries()).map(([si, arr])=> arr.map((a, laneIdx)=>{
                const styles = blockStylesByStatus(docColor(a.doctorId), a.status);
                
                const baseHeight = spanSlots(a) * slotPx;
                const gap = 3;
                const N = arr.length;
                const citaHeight = N > 1
                  ? Math.floor((slotPx - (N - 1) * gap) / N)
                  : baseHeight;
                const offsetTop = si * slotPx + laneIdx * (citaHeight + gap);

                return (
                  <div
                    key={a.id}
                    className="absolute text-white text-xs p-1.5 rounded shadow-md cursor-grab active:cursor-grabbing select-none border touch-none"
                    style={{
                      top: offsetTop,
                      left: 2, 
                      width: 'calc(100% - 4px)',
                      height: citaHeight,
                      background: styles.background as string,
                      color: styles.color as string,
                      overflow: 'hidden', 
                      display: 'flex', 
                      flexDirection: 'column', 
                      justifyContent: 'center',
                      zIndex: 20 + laneIdx,
                      minHeight: '28px',
                    }}
                    onPointerDown={(e)=>onPointerDownMove(e,a,dayIdx)}
onDoubleClick={!isTouchDevice ? () => onEdit(a) : undefined}
                        onClick={isTouchDevice ? (e) => { e.stopPropagation(); onEdit(a); } : undefined}
                        title={a.patient + ' • ' + ((serviceById(a.serviceId)?.name)||'')}
                      >
                        <CornerChecks status={a.status} />
                        <div className="font-semibold truncate leading-tight text-[10px] sm:text-xs">{a.patient}</div>
                        {citaHeight > 28 && (
                          <div className="opacity-90 truncate leading-tight text-[9px] sm:text-[10px]">{serviceById(a.serviceId)?.name}</div>
                        )}
                        <div
                          onPointerDown={(e)=>onPointerDownResize(e,a,dayIdx)}
                          className="absolute bottom-0 left-0 right-0 h-1 bg-black/20 hover:bg-black/30 rounded-b cursor-ns-resize"
                        />
                        <button
                          onClick={(e)=>{ e.stopPropagation(); setOpenMenuId(openMenuId===a.id?null:a.id) }}
                          className={
                            "absolute bottom-0.5 right-0.5 w-5 h-5 rounded-full bg-white/90 backdrop-blur-sm " +
                            "grid place-items-center text-[10px] hover:bg-white transition-colors font-bold shadow-sm " +
                            (a.status === 'Atendida'   ? "text-green-600"  :
                             a.status === 'Cancelada'  ? "text-red-600"    :
                             a.status === 'Confirmada' ? "text-purple-600" :
                                                         "text-yellow-500")
                          }
                          title="Cambiar estado"
                        >
                          {a.status === 'Atendida' ? '✓✓' :
                           a.status === 'Confirmada' ? '✓' :
                           a.status === 'Cancelada' ? '✗' : '?'}
                        </button>
                        {openMenuId===a.id && (
                          <StatusMenu onPick={(st)=> onStatus(a.id, st)} onClose={()=> setOpenMenuId(null)} />
                        )}
                      </div>
                    );
                  }))}
                </div>
              );
            })}
          </div>
        </div>
        <div className="text-xs text-gray-500 mt-2 px-2">Toca para editar. Arrastra para mover.</div>
      </div>
    </div>
    </div>
  );
}

  // ===================== Analytics States =====================
type RangeKey = 'semana_actual'|'mes_pasado'|'ult_3_meses'|'todos'|'personalizado';
const [rangeKey, setRangeKey] = useState<RangeKey>('semana_actual');

// 📅 Calcular la semana actual (lunes a domingo)
function getWeekRange() {
  const today = new Date();
  const day = today.getDay(); // 0 = Domingo, 1 = Lunes...
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const format = (d: Date) => d.toISOString().split("T")[0];
  return { from: format(monday), to: format(sunday) };
}

const { from: defaultFrom, to: defaultTo } = getWeekRange();

// 🗓️ Rango por defecto: semana actual (lunes a domingo)
const [from, setFrom] = useState<string>(defaultFrom);
const [to, setTo] = useState<string>(defaultTo);

  const applyQuickRange = (k:RangeKey)=>{
    setRangeKey(k);
    const now = new Date();
    if(k==='semana_actual'){ const s=getWeekStart(now); setFrom(fmtDate(s)); setTo(fmtDate(addDays(s,6))); }
    else if(k==='mes_pasado'){ const m=new Date(now.getFullYear(), now.getMonth()-1, 1); const end=new Date(now.getFullYear(), now.getMonth(), 0); setFrom(fmtDate(m)); setTo(fmtDate(end)); }
    else if(k==='ult_3_meses'){ const start=new Date(now.getFullYear(), now.getMonth()-2, 1); const end=new Date(now.getFullYear(), now.getMonth()+1, 0); setFrom(fmtDate(start)); setTo(fmtDate(end)); }
    else if(k==='todos'){ setFrom('2020-01-01'); setTo(fmtDate(addDays(now, 30))); }
  };
  
  const inRange = (dateStr: string) => {
    if (!dateStr) return false;
    // Extraer solo la fecha del timestamp (formato: 2025-08-20T07:00:00.000Z -> 2025-08-20)
    let normalizedDate = dateStr;
    if (dateStr.includes('T')) {
      normalizedDate = dateStr.split('T')[0];
    }
    return normalizedDate >= from && normalizedDate <= to;
  };

  // ===================== Analytics Calculations =====================
  const paymentsInRange = useMemo(() => payments?.filter(p => inRange(p.date)) || [], [payments, from, to]);
  const expensesInRange = useMemo(() => expenses?.filter(e => inRange(e.date)) || [], [expenses, from, to]);
  
  const ingresosPorDoctor = useMemo(()=> {
    if (!doctors) return [];
    return doctors.map(doc=>({ 
      name: docName(doc.id), 
      total: paymentsInRange.filter(p=>p.doctorId===doc.id).reduce((s,p)=>s+p.amount,0) 
    })).filter(d => d.total > 0);
  },[doctors, paymentsInRange, docName]);
  
  const egresosPorDoctor = useMemo(()=> {
    if (!doctors) return [];
    return doctors.map(doc=>({ 
      name: docName(doc.id), 
      total: expensesInRange.filter(e=>e.doctorId===doc.id).reduce((s,e)=>s+e.amount,0) 
    })).filter(d => d.total > 0);
  },[doctors, expensesInRange, docName]);

  const serviceAgg = useMemo(()=>{
    if (!services) return { top: [], bottom: [], margin: [] };
    
    const counts: Record<string, number> = {};
    const amounts: Record<string, number> = {};
    paymentsInRange.forEach(p=>{
      const name = (services.find(s=>s.id===p.serviceId)?.name) || 'Servicio';
      counts[name] = (counts[name]||0) + 1;
      amounts[name] = (amounts[name]||0) + p.amount;
    });
    const rows = Object.keys(counts).map(name=>({ name, count: counts[name], amount: amounts[name]||0 }));
    const top = rows.slice().sort((a,b)=> b.count-a.count).slice(0,5).filter(s => s.count > 0);
    const bottom = rows.slice().sort((a,b)=> a.count-b.count).slice(0,5).filter(s => s.count > 0);
    const margin = rows.slice().sort((a,b)=> b.amount-a.amount).filter(s => s.amount > 0);
    return { top, bottom, margin };
  },[paymentsInRange, services]);

  const pieIngresosPorMetodo = useMemo(()=>{
    const agg: Record<string, number> = {};
    paymentsInRange.forEach(p => { agg[p.paymentMethod] = (agg[p.paymentMethod] || 0) + p.amount; });
    const label = (m:string)=> m.replace('_',' ').replace('tarjeta','T.').replace('debito','débito').replace('credito','crédito');
    return Object.entries(agg).filter(([k,v]) => v > 0).map(([k,v], i)=> ({ 
      name: label(k), 
      value: v, 
      color: CHART_COLORS[i % CHART_COLORS.length] 
    }));
  },[paymentsInRange]);

  const byDay = useMemo(()=>{
    const map = new Map<string, {ingresos:number, egresos:number}>();
    
    // Normalizar fechas de pagos (extraer solo fecha del timestamp)
    paymentsInRange.forEach(p=>{ 
      let normalizedDate = p.date;
      if (p.date.includes('T')) {
        normalizedDate = p.date.split('T')[0];
      }
      const cur = map.get(normalizedDate) || {ingresos:0, egresos:0}; 
      cur.ingresos += p.amount; 
      map.set(normalizedDate, cur); 
    });
    
    // Normalizar fechas de gastos (extraer solo fecha del timestamp)
    expensesInRange.forEach(e=>{ 
      let normalizedDate = e.date;
      if (e.date.includes('T')) {
        normalizedDate = e.date.split('T')[0];
      }
      const cur = map.get(normalizedDate) || {ingresos:0, egresos:0}; 
      cur.egresos += e.amount; 
      map.set(normalizedDate, cur); 
    });
    
    const days = rangeDays(new Date(from+'T00:00:00'), new Date(to+'T00:00:00'));
    
    // Limitar a máximo 30 días para que la gráfica sea legible
    const limitedDays = days.length > 30 ? days.slice(-30) : days;
    
    return limitedDays.map(d=>{ 
      const dateKey = fmtDate(d);
      const dayName = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][d.getDay()];
      const shortDate = dateKey.slice(5); // MM-DD en lugar de YYYY-MM-DD
      
      return {
        date: dateKey, 
        label: `${dayName} ${shortDate}`, // "Lun 08-20"
        ingresos: map.get(dateKey)?.ingresos || 0, 
        egresos: map.get(dateKey)?.egresos || 0 
      };
    });
  },[paymentsInRange, expensesInRange, from, to]);
  
  const totalWeek = useMemo(() => byDay.reduce((acc,v)=>({ ingresos: acc.ingresos+v.ingresos, egresos: acc.egresos+v.egresos }), {ingresos:0, egresos:0}), [byDay]);
  
  // Calculations with debug
  const selected = useMemo(()=> new Date(selectedDate+'T00:00:00'),[selectedDate]);
  const weekStart = useMemo(()=> getWeekStart(selected),[selected]);
  const weekDays = useMemo(()=> rangeDays(weekStart, addDays(weekStart,6)),[weekStart]);
 
  function aptsOfDate(d: Date){ 
    const key = fmtDate(d); 
    const filtered = appointments?.filter(a => {
      // Normalizar la fecha de la cita (puede venir como ISO string)
      let aptDate = a.date;
      if (aptDate.includes('T')) {
        aptDate = aptDate.split('T')[0]; // Extraer solo la parte de fecha
      }
      return aptDate === key;
    }).sort((a,b)=> timeToMins(a.startTime)-timeToMins(b.startTime)) || [];
    
    return filtered;
  }

  const totalIngresos = payments?.reduce((s,p)=> s+p.amount, 0) || 0;

  useEffect(()=>{ document.title = 'Clinica Dentalux - Sistema Completo'; },[]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
          <p className="text-lg font-semibold text-gray-700">Cargando datos...</p>
        </div>
      </div>
    );
  }

  // Show fallback if no data available
  if (!allDataLoaded) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <WifiOff className="w-8 h-8 mx-auto mb-4 text-red-600" />
          <p className="text-lg font-semibold text-gray-700">Error al cargar datos</p>
          <button 
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

 return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-3 sm:p-6">
      {/* 🆕 MÓDULOS FLOTANTES */}
      {showInventory && <InventoryModule onClose={() => setShowInventory(false)} />}
      {showPatientHistory && <PatientHistoryModule onClose={() => setShowPatientHistory(false)} />}
      {showFacturacion && <FacturacionModule onClose={() => setShowFacturacion(false)} />}
 {/* Dashboard Global Integration */}
      {isSuperAdmin && (
        <DashboardIntegration 
          sucursalActual={getSucursalActual()}
          onClose={() => setMostrarDashboardGlobal(false)}
        />
      )}

      
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-xl mb-6 p-4 sm:p-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-lg">
                <img src={logo} alt="Dentalux Logo" className="h-12 w-auto rounded-xl" />
              </div>
              <div> 
                <span className='font-semibold text-lg'>Clinica Dentalux</span>
                <div className="text-xs text-blue-700 font-medium">Administra tu clínica, haz crecer tu sonrisa · $20 USD/mes</div>
                <div className="flex items-center gap-2 text-sm">
                  {isOnline ? (
                    <>
                      <Wifi className="w-4 h-4 text-green-500" />
                      <span className="text-green-600">Conectado</span>
                    </>
                  ) : (
                    <>
                      <WifiOff className="w-4 h-4 text-red-500" />
                      <span className="text-red-600">Sin conexión</span>
                    </>
                  )}
                  <button 
                    onClick={() => window.location.reload()}
                    className="ml-2 p-1 hover:bg-gray-100 rounded"
                    title="Recargar datos"
                  >
                    <RefreshCw className="w-4 h-4 text-gray-500" />
                  </button>
                </div>
              </div>
            </div>

           {/* SELECTOR DE SUCURSAL */}
            <div className="lg:ml-6 w-full lg:w-auto">
              <SucursalSelector 
                onSucursalChange={handleSucursalChange}
                showDebug={process.env.NODE_ENV === 'development'}
              />
            </div>

            {/* 🆕 BOTONES DE MÓDULOS ADICIONALES */}
            <div className="flex flex-wrap gap-2 sm:gap-3">
              <button
                onClick={() => setShowInventory(true)}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center gap-2 transition-colors"
              >
                <Package className="w-5 h-5" />
                Inventario
              </button>
              
              <button
                onClick={() => setShowPatientHistory(true)}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg flex items-center gap-2 transition-colors"
              >
                <User className="w-5 h-5" />
                Historial
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-4 sm:gap-6">
  <div className="text-center">
    <div className="text-2xl font-bold text-green-600">
      ${totalIngresos.toLocaleString()}
    </div>
    <div className="text-sm text-gray-500">Ingresos Totales</div>
  </div>
  <div className="text-center">
    <div className="text-2xl font-bold text-blue-600">
      {appointments?.filter(a => a.date === fmtDate(today)).length || 0}
    </div>
    <div className="text-sm text-gray-500">Citas Hoy</div>
  </div>
  
 {/* NUEVO BOTÓN DE FACTURACIÓN (OCULTO) */}
{false && (
  <button
    onClick={() => setShowFacturacion(true)}
    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg flex items-center gap-2 transition-colors"
  >
    <FileText className="w-5 h-5" />
    Facturación
  </button>
)}
</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="sticky top-0 z-40 bg-white rounded-2xl shadow-xl mb-6">
          <div className="flex border-b border-gray-200 overflow-x-auto">
            {[
              { id: 'agenda', label: 'Agenda', icon: Calendar },
              { id: 'pagos', label: 'Caja', icon: DollarSign },
              { id: 'analytics', label: 'Productividad', icon: BarChart3 },
              { id: 'laboratorios', label: 'Laboratorios', icon: BarChart3 },
              { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
              ...(isSuperAdmin ? [
                { id: 'facturacion', label: 'Facturación', icon: CreditCard },
                { id: 'empresas', label: 'Empresas', icon: Building2 },
              ] : []),
            ].map(tab => (
  <button 
    key={tab.id as string} 
    onClick={() => !factLoading && setActiveTab(tab.id as any)} // ⭐ Prevenir cambio durante loading
    disabled={factLoading} // ⭐ Deshabilitar tabs
    className={`flex-1 shrink-0 flex items-center justify-center px-4 sm:px-6 py-4 font-medium transition-all ${
      activeTab === tab.id 
        ? 'border-b-2 border-blue-500 text-blue-600 bg-blue-50'
        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
    } ${factLoading ? 'opacity-50 cursor-not-allowed' : ''}`} // ⭐ Visual feedback
  >
    <tab.icon className="w-5 h-5 mr-2" /> 
    {tab.label}
    {factLoading && activeTab === 'facturacion' && (
      <RefreshCw className="w-4 h-4 ml-2 animate-spin" />
    )}
  </button>
))}

          </div>
        </div>

        {/* Content */}
        <div className="bg-white rounded-2xl shadow-xl p-6">
          {/* ========== AGENDA ========== */}
          {activeTab==='agenda' && (
            <div className="space-y-8">
              {conflictMsg && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 border border-red-200">
                  <AlertTriangle className="w-5 h-5"/><span>{conflictMsg}</span>
                  <button onClick={() => setConflictMsg('')} className="ml-auto">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Nueva Cita */}
              <div className="bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl p-6 text-white">
                <h2 className="text-xl font-bold mb-4 flex items-center">
                  <Plus className="w-5 h-5 mr-2"/>
                  Nueva Cita
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                  <input 
                    className="px-3 py-2 rounded text-gray-900" 
                    placeholder="Paciente" 
                    value={newApt.patient} 
                    onChange={e=>setNewApt({...newApt, patient:e.target.value})}
                  />
                  <select 
                    className="px-3 py-2 rounded text-gray-900" 
                    value={newApt.doctorId} 
                    onChange={e=>setNewApt({...newApt, doctorId:e.target.value})}
                  >
                    <option value="">Doctor</option>
                    {doctors.map(d=> (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                  <select 
                    className="px-3 py-2 rounded text-gray-900" 
                    value={newApt.serviceId} 
                    onChange={e=>setNewApt({...newApt, serviceId:e.target.value})}
                  >
                    <option value="">Servicio</option>
                    {services.map(s=> (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <input 
                    type="date" 
                    className="px-3 py-2 rounded text-gray-900" 
                    value={newApt.date} 
                    onChange={e=>setNewApt({...newApt, date:e.target.value})}
                  />
                  <input 
                    type="time" 
                    className="px-3 py-2 rounded text-gray-900" 
                    value={newApt.startTime} 
                    onChange={e=>setNewApt({...newApt, startTime:e.target.value})}
                  />
                  <select 
                    className="px-3 py-2 rounded text-gray-900" 
                    value={newApt.durationHours} 
                    onChange={e=>setNewApt({...newApt, durationHours:Number(e.target.value)})}
                  >
                    <option value={0.5}>30 min</option>
                    <option value={1}>1 hora</option>
                    <option value={1.5}>1.5 horas</option>
                    <option value={2}>2 horas</option>
                    <option value={2.5}>2.5 horas</option>
                    <option value={3}>3 horas</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                  <input 
                    className="px-3 py-2 rounded text-gray-900" 
                    placeholder="Teléfono" 
                    value={newApt.phone} 
                    onChange={e=>setNewApt({...newApt, phone:e.target.value})}
                  />
                  <button 
                    onClick={addAppointment} 
                    disabled={isCreatingAppointment || !newApt.patient || !newApt.doctorId || !newApt.serviceId}
                    className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                      isCreatingAppointment 
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                        : 'bg-white text-blue-600 hover:bg-gray-100'
                    }`}
                  >
                    {isCreatingAppointment ? (
                      <span className="flex items-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Agendando...
                      </span>
                    ) : (
                      'Agendar'
                    )}
                  </button>
                  <div></div>
                </div>
              </div>

              {/* Controles de vista */}
              <div className="flex flex-wrap items-center gap-3">
                <input type="date" className="border px-3 py-2 rounded" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)}/>
              </div>

              {/* Vista de calendario organizada */}
             <WeekView
              days={weekDays}
              appointments={appointments ?? []}
              getDoctor={doctorById}
              serviceById={serviceById}
              onStatus={updateAptStatus}
              onEdit={setEditingApt}
              onMove={setAptTime}
              onResize={setAptDuration}
              selectedDoctor={selectedDoctor}
              onDoctorFilter={setSelectedDoctor}
              doctors={doctors}
              onTimeSlotClick={handleTimeSlotClick}
              />


              {/* Panel de control de estados */}
              <div className="bg-gradient-to-r from-gray-50 to-blue-50 border rounded-xl p-4">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <h4 className="font-semibold text-gray-800">Estados de Citas</h4>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm max-w-full">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                      <span>Pendiente</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                      <span>Confirmada</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-green-500"></div>
                      <span>Atendida</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-red-500"></div>
                      <span>Cancelada</span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 text-xs text-gray-600">
                  💡 Haz clic en el botón "S" de cada cita para cambiar su estado, o arrastra las citas para cambiar horarios
                </div>
              </div>

              {/* CRUD Doctores / Servicios */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="border rounded-xl p-4">
                  <h3 className="font-semibold mb-3">Doctores</h3>
                  <div className="flex flex-wrap gap-2 mb-3">
  <input
    className="px-3 py-2 border rounded-lg flex-1 min-w-[180px]"
    placeholder="Nombre"
    value={newDoctor.name}
    onChange={e=>setNewDoctor({...newDoctor, name:e.target.value})}
  />
  <input
    type="color"
    className="w-12 h-10 border rounded flex-none"
    value={newDoctor.color}
    onChange={e=>setNewDoctor({...newDoctor, color:e.target.value})}
  />
  <button
    className="bg-blue-600 text-white px-4 h-10 rounded-lg hover:bg-blue-700 whitespace-nowrap flex-none"
    onClick={addDoctor}
  >
    <Plus className="w-4 h-4 inline mr-1" />Agregar
  </button>
</div>
                  <ul className="space-y-2 max-h-48 overflow-auto">
                    {doctors.map(d=>(
                    <li key={d.id} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                      <div className="flex items-center gap-2">
                        {/* Punto de color clickeable (abre el selector) */}
                        <label
                          htmlFor={`color-${d.id}`}
                          className="w-3 h-3 rounded-full ring-1 ring-black/10 cursor-pointer block"
                          style={{ background: d.color || '#3b82f6' }}
                          title="Cambiar color"
                        />
                        {/* Selector de color oculto, controlado */}
                        <input
                          id={`color-${d.id}`}
                          type="color"
                          value={d.color || '#3b82f6'}
                          onChange={async (e) => {
                            const newColor = e.target.value;
                            try {
                              await updateDoctor(d.id, { color: newColor }); // guarda en backend
                              await reloadDoctors();                          // refresca la lista
                            } catch (err) {
                              alert('No se pudo actualizar el color del doctor');
                              console.error(err);
                            }
                          }}
                          className="sr-only"
                        />
                        <span>{d.name}</span>
                      </div>

                      <button
                        onClick={()=>removeDoctor(d.id)}
                        className="text-red-600 hover:bg-red-50 p-1 rounded"
                      >
                        <Trash2 className="w-4 h-4"/>
                      </button>
                    </li>

                    ))}
                  </ul>
                </div>
                <div className="border rounded-xl p-4">
                  <h3 className="font-semibold mb-3">Servicios</h3>
                  <div className="flex flex-col sm:flex-row gap-2 mb-3">
                    <input 
                      className="px-3 py-2 border rounded-lg w-full sm:flex-1" 
                      placeholder="Nombre del servicio" 
                      value={newService.name} 
                      onChange={e=>setNewService({name:e.target.value})}
                    />
                    <button 
                      className="bg-blue-600 text-white px-4 rounded-lg hover:bg-blue-700 w-full sm:w-auto" 
                      onClick={addService}
                    >
                      <Plus className="w-4 h-4 inline mr-1"/>Agregar
                    </button>
                  </div>
                  <ul className="space-y-2 max-h-48 overflow-auto">
                    {services.map(s=>(
                      <li key={s.id} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                        <span>{s.name}</span>
                        <button 
                          onClick={()=>removeService(s.id)} 
                          className="text-red-600 hover:bg-red-50 p-1 rounded"
                        >
                          <Trash2 className="w-4 h-4"/>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Modal editar cita */}
              {editingApt && (
                <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
                  <div className="bg-white rounded-xl p-4 w-full max-w-lg max-h-[90vh] overflow-y-auto">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold">Editar cita</h4>
                      <button onClick={()=>setEditingApt(null)} className="p-1 hover:bg-gray-100 rounded">
                        <X className="w-5 h-5"/>
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-gray-500">Paciente</label>
                        <input 
                          className="border px-3 py-2 rounded w-full" 
                          value={editingApt.patient} 
                          onChange={e=>setEditingApt({...editingApt, patient:e.target.value})}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Doctor</label>
                        <select 
                          className="border px-3 py-2 rounded w-full" 
                          value={editingApt.doctorId} 
                          onChange={e=>setEditingApt({...editingApt, doctorId:e.target.value})}
                        >
                          {doctors.map(d=> <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <div className="flex items-center justify-between">
                          <label className="text-xs text-gray-500">Servicio</label>
                          <button
                            type="button"
                            className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 flex items-center gap-1"
                            onClick={()=>{
                              // Si no hay 2do servicio, lo activamos con el mismo valor (o el primero disponible)
                              if (!editingApt.serviceId2) {
                                setEditingApt({
                                  ...editingApt,
                                  serviceId2: editingApt.serviceId || (services?.[0]?.id || ''),
                                });
                              } else {
                                // Si ya existe, lo quitamos
                                setEditingApt({ ...editingApt, serviceId2: undefined });
                              }
                            }}
                            title={editingApt.serviceId2 ? "Quitar 2do servicio" : "Agregar 2do servicio"}
                          >
                            <Plus className="w-3 h-3" /> {editingApt.serviceId2 ? "Quitar" : "Agregar"}
                          </button>
                        </div>

                        <select 
                          className="border px-3 py-2 rounded w-full" 
                          value={editingApt.serviceId} 
                          onChange={e=>setEditingApt({...editingApt, serviceId:e.target.value})}
                        >
                          {services.map(s=> <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>

                        {editingApt.serviceId2 && (
                          <div className="mt-2">
                            <label className="text-xs text-gray-500">Servicio 2</label>
                            <select
                              className="border px-3 py-2 rounded w-full"
                              value={editingApt.serviceId2}
                              onChange={e=>setEditingApt({...editingApt, serviceId2:e.target.value})}
                            >
                              {services.map(s=> <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Estado</label>
                        <select 
                          className="border px-3 py-2 rounded w-full" 
                          value={editingApt.status} 
                          onChange={e=>setEditingApt({...editingApt, status: e.target.value as Appointment['status']})}
                        >
                          <option value="Pendiente">Pendiente</option>
                          <option value="Confirmada">Confirmada</option>
                          <option value="Atendida">Atendida</option>
                          <option value="Cancelada">Cancelada</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Fecha</label>
                        <input 
                          type="date" 
                          className="border px-3 py-2 rounded w-full" 
                          value={editingApt.date} 
                          onChange={e=>setEditingApt({...editingApt, date:e.target.value})}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Hora de inicio</label>
                        <input 
                          type="time" 
                          className="border px-3 py-2 rounded w-full" 
                          value={editingApt.startTime} 
                          onChange={e=>setEditingApt({...editingApt, startTime:e.target.value})}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Duración</label>
                        <select 
                          className="border px-3 py-2 rounded w-full" 
                          value={editingApt.durationHours} 
                          onChange={e=>setEditingApt({...editingApt, durationHours:Number(e.target.value)})}
                        >
                          <option value={0.5}>30 min</option>
                          <option value={1}>1 hora</option>
                          <option value={1.5}>1.5 horas</option>
                          <option value={2}>2 horas</option>
                          <option value={2.5}>2.5 horas</option>
                          <option value={3}>3 horas</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Teléfono</label>
                        <input 
                          className="border px-3 py-2 rounded w-full" 
                          value={editingApt.phone || ''} 
                          onChange={e=>setEditingApt({...editingApt, phone:e.target.value})}
                        />
                      </div>
                    </div>

                    {conflictMsg && (
                      <div className="mt-3 text-sm bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded">
                        {conflictMsg}
                      </div>
                    )}

                   <div className="flex justify-between items-center mt-4">
  <button 
    className="px-4 py-2 rounded bg-red-500 hover:bg-red-600 text-white text-sm flex items-center gap-2"
    onClick={()=>{ 
      if (window.confirm('¿Seguro que quieres eliminar esta cita?')) { 
        deleteAppointment(editingApt.id); 
        setEditingApt(null); 
      } 
    }}
  >
    <Trash2 className="w-4 h-4"/> Eliminar cita
  </button>
  
  <div className="flex gap-2">
    {/* 🆕 BOTÓN DE EXPEDIENTE MÉDICO DENTAL */}
<button 
  className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 text-white text-sm flex items-center gap-2"
  onClick={() => {
    console.log('🔍 Botón clickeado!');
    console.log('🩺 openMedicalRecord:', openMedicalRecord);
    openMedicalRecord({
      name: editingApt.patient,
      phone: editingApt.phone,
      appointmentId: editingApt.id
    });
  }}
  title="Ver Expediente Médico Dental Completo"
>
  <FileText className="w-4 h-4"/> Expediente Médico
</button>
    
    <button 
      className="px-4 py-2 rounded bg-gray-100 hover:bg-gray-200 text-sm" 
      onClick={()=>setEditingApt(null)}
    >
      Cancelar
    </button>
    <button 
      className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm flex items-center gap-2" 
      onClick={saveEditingApt}
    >
      <Check className="w-4 h-4"/> Guardar cambios
    </button>
  </div>
</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========== CAJA MODULE ========== */}
          {activeTab==='pagos' && (
            <div className="space-y-8">
              {/* Pago + Egreso en dos columnas */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

                {/* Registrar Pago (izquierda) */}
                <div className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl p-4 text-white">
                  <h2 className="text-lg font-bold mb-3 flex items-center">
                    <DollarSign className="w-5 h-5 mr-2" />
                    Registrar Pago
                  </h2>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <select
                      className="px-3 py-2 rounded text-gray-900"
                      value={newPayment.appointmentId}
                      onChange={e => setNewPayment({ ...newPayment, appointmentId: e.target.value })}
                    >
                      <option value="">Seleccionar cita</option>
                      {appointments
                        ?.filter((a) => {
                          const st = String(a.status || '').toLowerCase();
                          const activa = st === 'confirmada' || st === 'atendida'; // añade || st === 'pendiente' si también quieres agendadas

                          // ya tiene pago registrado?
                          const yaPagada = (payments || []).some((p) => {
                            const apptId = p.appointmentId ?? p.appointment_id ?? p.appId;
                            return apptId != null && String(apptId) === String(a.id);
                          });

                          return activa && !yaPagada;
                        })
                        .map((a) => {
                          const svcName =
                            (typeof serviceById === 'function' && a.serviceId != null
                              ? serviceById(String(a.serviceId))?.name
                              : undefined) || '—';

                          return (
                            <option key={a.id} value={a.id}>
                              {a.patient} — {svcName}
                            </option>
                          );
                        })}

                    </select>

                    <input
                      type="number"
                      className="px-3 py-2 rounded text-gray-900"
                      placeholder="Monto"
                      value={newPayment.amount}
                      onChange={e => setNewPayment({ ...newPayment, amount: e.target.value })}
                    />

                    {selectedPaymentApt?.serviceId2 && (
                      <input
                        type="number"
                        className="px-3 py-2 rounded text-gray-900"
                        placeholder={`Monto 2 (${serviceById(selectedPaymentApt.serviceId2)?.name || 'Servicio 2'})`}
                        value={newPayment.amount2 || ''}
                        onChange={e => setNewPayment({ ...newPayment, amount2: e.target.value })}
                      />
                    )}

                    <select
                      className="px-3 py-2 rounded text-gray-900"
                      value={newPayment.paymentMethod}
                      onChange={e => setNewPayment({ ...newPayment, paymentMethod: e.target.value as any })}
                    >
                      <option value="efectivo">Efectivo</option>
                      <option value="tarjeta_debito">Tarjeta débito</option>
                      <option value="tarjeta_credito">Tarjeta crédito</option>
                      <option value="transferencia">Transferencia</option>
                    </select>

                    <input
                      type="date"
                      className="px-3 py-2 rounded text-gray-900"
                      value={newPayment.date}
                      onChange={e => setNewPayment({ ...newPayment, date: e.target.value })}
                    />
                  </div>

                  <div className="mt-3 text-center">
                    <button
                      onClick={addPayment}
                      disabled={!newPayment.amount || !newPayment.appointmentId}
                      className={`px-5 py-2 rounded-lg font-medium transition-colors ${
                        (!newPayment.amount || !newPayment.appointmentId)
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-white text-green-700 hover:bg-gray-100'
                      }`}
                    >
                      Registrar Pago
                    </button>
                  </div>
                </div>

                {/* Registrar Egreso (derecha) */}
                <div className="bg-gradient-to-r from-red-500 to-rose-600 rounded-xl p-4 text-white">
                  <h2 className="text-lg font-bold mb-3 flex items-center">
                    <DollarSign className="w-5 h-5 mr-2" />
                    Registrar Egreso
                  </h2>

                  <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                    <input
                      className="px-3 py-2 rounded text-gray-900"
                      placeholder="Concepto"
                      value={newExpense.concept}
                      onChange={e => setNewExpense({ ...newExpense, concept: e.target.value })}
                    />
                    <input
                      className="px-3 py-2 rounded text-gray-900"
                      type="number"
                      placeholder="Monto"
                      value={newExpense.amount}
                      onChange={e => setNewExpense({ ...newExpense, amount: e.target.value })}
                    />
                    <input
                      className="px-3 py-2 rounded text-gray-900"
                      type="date"
                      value={newExpense.date}
                      onChange={e => setNewExpense({ ...newExpense, date: e.target.value })}
                    />
                    <select
                      className="px-3 py-2 rounded text-gray-900"
                      value={newExpense.paymentMethod}
                      onChange={e => setNewExpense({ ...newExpense, paymentMethod: e.target.value as any })}
                    >
                      <option value="efectivo">Efectivo</option>
                      <option value="tarjeta_debito">Tarjeta débito</option>
                      <option value="tarjeta_credito">Tarjeta crédito</option>
                      <option value="transferencia">Transferencia</option>
                    </select>
                    <select
                      className="px-3 py-2 rounded text-gray-900"
                      value={newExpense.doctorId}
                      onChange={e => setNewExpense({ ...newExpense, doctorId: e.target.value })}
                    >
                      <option value="">Doctor (opcional)</option>
                      {doctors?.map(d => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="mt-3 text-center">
                    <button
                      onClick={addExpense}
                      disabled={!newExpense.concept.trim() || !newExpense.amount}
                      className={`px-5 py-2 rounded-lg font-medium transition-colors ${
                        (!newExpense.concept.trim() || !newExpense.amount)
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-white text-red-700 hover:bg-gray-100'
                      }`}
                    >
                      Registrar Egreso
                    </button>
                  </div>
                </div>

              </div>  {/* ← cierre del contenedor grid */}


              {/* Filtros de periodo y totales */}
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="text-sm text-gray-500">Periodo</label>
                  <select 
                    className="border px-3 py-2 rounded block" 
                    value={cajaRange} 
                    onChange={e=>setCajaRange(e.target.value as any)}
                  >
                    <option value="dia">Día</option>
                    <option value="semana">Semana</option>
                    <option value="mes">Mes</option>
                    <option value="rango">Rango</option>
                  </select>
                </div>
                {cajaRange === 'rango' ? (
                  <div className="flex items-end gap-2">
                    <div>
                      <label className="text-sm text-gray-500">Desde</label>
                      <input
                        type="date"
                        className="border px-3 py-2 rounded block"
                        value={cajaFrom}
                        onChange={e => setCajaFrom(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-sm text-gray-500">Hasta</label>
                      <input
                        type="date"
                        className="border px-3 py-2 rounded block"
                        value={cajaTo}
                        onChange={e => setCajaTo(e.target.value)}
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="text-sm text-gray-500">Fecha</label>
                    <input
                      type="date"
                      className="border px-3 py-2 rounded block"
                      value={cajaAnchor}
                      onChange={e => setCajaAnchor(e.target.value)}
                    />
                  </div>
                )}

                
                <button 
                  onClick={() => {
                    const debugInfo = {
                      payments: payments?.length || 0,
                      expenses: expenses?.length || 0,
                      cajaRange,
                      cajaAnchor,
                      cajaRangeFromTo,
                      paymentsCajaRange: paymentsCajaRange.length,
                      expensesCajaRange: expensesCajaRange.length,
                      samplePayment: payments?.[0],
                      sampleExpense: expenses?.[0]
                    };
                    
                    alert(`DEBUG INFO:
            Pagos totales: ${debugInfo.payments}
            Gastos totales: ${debugInfo.expenses}
            Periodo: ${debugInfo.cajaRange}
            Fecha anchor: ${debugInfo.cajaAnchor}
            Rango: ${debugInfo.cajaRangeFromTo.from} a ${debugInfo.cajaRangeFromTo.to}
            Pagos filtrados: ${debugInfo.paymentsCajaRange}
            Gastos filtrados: ${debugInfo.expensesCajaRange}
            Primer pago: ${debugInfo.samplePayment ? `${debugInfo.samplePayment.patient} - ${debugInfo.samplePayment.date} - ${debugInfo.samplePayment.amount}` : 'No hay'}
            Primer gasto: ${debugInfo.sampleExpense ? `${debugInfo.sampleExpense.concept} - ${debugInfo.sampleExpense.date} - ${debugInfo.sampleExpense.amount}` : 'No hay'}`);
                  }}
                  className="px-3 py-2 bg-yellow-500 text-white rounded text-xs"
                >
                  🛠 Debug
                </button>
                
                <div className="ml-auto flex gap-6">
                  <div className="text-center">
                    <div className="text-xs text-gray-500">Ingresos del periodo</div>
                    <div className="text-xl font-bold text-green-600">${totalCajaPagos.toLocaleString()}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-500">Egresos del periodo</div>
                    <div className="text-xl font-bold text-red-600">-${totalCajaEgresos.toLocaleString()}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-500">Balance</div>
                    <div className={`text-xl font-bold ${(totalCajaPagos - totalCajaEgresos) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      ${(totalCajaPagos - totalCajaEgresos).toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Listas por periodo */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                <div>
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <div className="w-4 h-4 bg-green-500 rounded"></div>
                    Ingresos del periodo ({paymentsCajaRange.length})
                    <span className="text-sm text-gray-500">- Total en BD: {payments?.length || 0}</span>
                  </h3>
                  {paymentsCajaRange.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg">
                      <DollarSign className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <p>Sin ingresos en este periodo</p>
                      <button 
                        onClick={() => {
                          alert(`TODOS LOS PAGOS (${payments?.length || 0}):
            ${payments?.slice(0, 5).map(p => `• ${p.patient} - ${p.date} - ${p.amount}`).join('\n') || 'No hay pagos'}
            ${payments && payments.length > 5 ? '...' : ''}`);
                        }}
                        className="mt-2 px-3 py-1 bg-blue-500 text-white rounded text-xs"
                      >
                        Ver todos los pagos
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {paymentsCajaRange.map((p) => (
                        <div
                          key={p.id}
                          className="flex flex-wrap items-center justify-between p-4 border rounded-xl gap-3 bg-white hover:bg-green-50 transition-colors"
                        >
                          <div className="flex-1">
                            <div className="font-medium text-gray-900">{p.patient}</div>
                            <div className="text-sm text-gray-500">
                              {serviceById(p.serviceId)?.name} — {p.date}
                              <span className="ml-2">
                                • {doctors?.find((d) => d.id === p.doctorId)?.name || '—'}
                              </span>
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="text-lg font-bold text-green-600">
                              ${p.amount.toLocaleString()}
                            </div>
                            <div className="text-xs capitalize text-gray-500">
                              {p.paymentMethod.replace('_', ' ')}
                            </div>
                          </div>
                          <button
                            className="px-2 py-1 text-red-600 hover:underline"
                            onClick={async () => {
                              if (confirm('¿Eliminar este ingreso?')) {
                                try {
                                  await deletePayment(p.id);
                                  await reloadPayments();
                                } catch (e) {
                                  alert('No se pudo eliminar: ' + (e?.message || e));
                                }
                              }
                            }}
                          >
                            Eliminar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <div className="w-4 h-4 bg-red-500 rounded"></div>
                    Egresos del periodo ({expensesCajaRange.length})
                    <span className="text-sm text-gray-500">- Total en BD: {expenses?.length || 0}</span>
                  </h3>
                  {expensesCajaRange.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg">
                      <DollarSign className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <p>Sin egresos en este periodo</p>
                      <button 
                        onClick={() => {
                          alert(`TODOS LOS GASTOS (${expenses?.length || 0}):
            ${expenses?.slice(0, 5).map(e => `• ${e.concept} - ${e.date} - ${e.amount}`).join('\n') || 'No hay gastos'}
            ${expenses && expenses.length > 5 ? '...' : ''}`);
                        }}
                        className="mt-2 px-3 py-1 bg-blue-500 text-white rounded text-xs"
                      >
                        Ver todos los gastos
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {expensesCajaRange.map((e) => (
                        <div
                          key={e.id}
                          className="flex flex-wrap items-center justify-between p-4 border rounded-xl gap-3 bg-white hover:bg-red-50 transition-colors"
                        >
                          <div className="flex-1">
                            <div className="font-medium text-gray-900">{e.concept}</div>
                            <div className="text-sm text-gray-500">
                              {e.date}
                              {e.doctorId ? (
                                <span className="ml-2">
                                  • {doctors?.find((d) => d.id === e.doctorId)?.name}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="text-lg font-bold text-red-600">
                              -${e.amount.toLocaleString()}
                            </div>
                            {e.paymentMethod && (
                              <div className="text-xs capitalize text-gray-500">
                                {e.paymentMethod.replace('_', ' ')}
                              </div>
                            )}
                          </div>
                           <button
                            type="button"
                            className="px-2 py-1 text-red-600 hover:underline"
                            onClick={async () => {
                              if (!window.confirm('¿Eliminar este gasto?')) return;
                              try {
                                await deleteExpense(e.id);
                                await reloadExpenses();
                              } catch (err: any) {
                                alert('No se pudo eliminar el gasto: ' + (err?.message || err));
                              }
                            }}
                          >
                            Eliminar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ========== ANALYTICS MODULE ========== */}
          {activeTab==='analytics' && (
            <div className="space-y-8">
              {/* Filtros de Analytics */}
              <div className="bg-gradient-to-r from-purple-500 to-indigo-600 rounded-xl p-6 text-white">
                <h2 className="text-xl font-bold mb-4 flex items-center">
                  <BarChart3 className="w-5 h-5 mr-2"/>
                  Analytics y Productividad
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <label className="text-sm opacity-90">Periodo rápido</label>
                    <select 
                      className="w-full px-3 py-2 rounded text-gray-900" 
                      value={rangeKey}
                      onChange={e => applyQuickRange(e.target.value as RangeKey)}
                    >
                      <option value="semana_actual">Esta semana</option>
                      <option value="mes_pasado">Mes pasado</option>
                      <option value="ult_3_meses">Últimos 3 meses</option>
                      <option value="todos">Todos los datos</option>
                      <option value="personalizado">Personalizado</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm opacity-90">Desde</label>
                    <input 
                      type="date" 
                      className="w-full px-3 py-2 rounded text-gray-900" 
                      value={from}
                      onChange={e => setFrom(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-sm opacity-90">Hasta</label>
                    <input 
                      type="date" 
                      className="w-full px-3 py-2 rounded text-gray-900" 
                      value={to}
                      onChange={e => setTo(e.target.value)}
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <button 
                      onClick={() => applyQuickRange(rangeKey)}
                      className="flex-1 px-4 py-2 bg-white text-purple-600 rounded hover:bg-gray-100 font-medium"
                    >
                      Actualizar
                    </button>
                    <button 
                      onClick={() => {
                        const debugInfo = {
                          totalPayments: payments?.length || 0,
                          totalExpenses: expenses?.length || 0,
                          totalAppointments: appointments?.length || 0,
                          rangeFilter: { from, to, rangeKey },
                          paymentsInRange: paymentsInRange.length,
                          expensesInRange: expensesInRange.length,
                          samplePayment: payments?.[0],
                          sampleExpense: expenses?.[0],
                          sampleAppointment: appointments?.[0],
                          ingresosPorDoctor: ingresosPorDoctor.length,
                          serviceAgg: serviceAgg.top.length
                        };
                        
                        console.log('🔍 DEBUG ANALYTICS:', debugInfo);
                        alert(`🔍 DEBUG ANALYTICS:
            📊 Datos totales:
            - Pagos: ${debugInfo.totalPayments}
            - Gastos: ${debugInfo.totalExpenses}  
            - Citas: ${debugInfo.totalAppointments}

            📅 Filtro actual:
            - Desde: ${debugInfo.rangeFilter.from}
            - Hasta: ${debugInfo.rangeFilter.to}
            - Tipo: ${debugInfo.rangeFilter.rangeKey}

            📈 Datos filtrados:
            - Pagos en rango: ${debugInfo.paymentsInRange}
            - Gastos en rango: ${debugInfo.expensesInRange}
            - Ingresos por doctor: ${debugInfo.ingresosPorDoctor}
            - Servicios analizados: ${debugInfo.serviceAgg}

            ${debugInfo.samplePayment ? `💰 Ejemplo pago: ${debugInfo.samplePayment.patient} - ${debugInfo.samplePayment.date} - ${debugInfo.samplePayment.amount}` : '❌ No hay pagos'}
            ${debugInfo.sampleExpense ? `💸 Ejemplo gasto: ${debugInfo.sampleExpense.concept} - ${debugInfo.sampleExpense.date} - ${debugInfo.sampleExpense.amount}` : '❌ No hay gastos'}
            ${debugInfo.sampleAppointment ? `📅 Ejemplo cita: ${debugInfo.sampleAppointment.patient} - ${debugInfo.sampleAppointment.date}` : '❌ No hay citas'}`);
                      }}
                      className="px-3 py-2 bg-yellow-500 text-white rounded text-xs hover:bg-yellow-600"
                      title="Debug Info"
                    >
                      🛠️
                    </button>
                  </div>
                </div>
              </div>

              {/* Panel de información de datos */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <h4 className="font-semibold text-blue-800 mb-2 flex items-center gap-2">
                  📊 Estado de Datos - Periodo: {from} a {to}
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-blue-600 font-medium">Pagos totales:</span>
                    <div className="text-lg font-bold">{payments?.length || 0}</div>
                  </div>
                  <div>
                    <span className="text-blue-600 font-medium">Gastos totales:</span>
                    <div className="text-lg font-bold">{expenses?.length || 0}</div>
                  </div>
                  <div>
                    <span className="text-blue-600 font-medium">Pagos en periodo:</span>
                    <div className="text-lg font-bold text-green-600">{paymentsInRange.length}</div>
                  </div>
                  <div>
                    <span className="text-blue-600 font-medium">Gastos en periodo:</span>
                    <div className="text-lg font-bold text-red-600">{expensesInRange.length}</div>
                  </div>
                </div>
                {(paymentsInRange.length === 0 && expensesInRange.length === 0) && (
                  <div className="mt-3 p-3 bg-yellow-100 border border-yellow-300 rounded-lg">
                    <p className="text-yellow-800 text-sm">
                      ⚠️ No hay datos en el periodo seleccionado. Prueba:
                    </p>
                    <ul className="text-yellow-700 text-xs mt-1 ml-4">
                      <li>• Cambiar el rango de fechas</li>
                      <li>• Verificar que hay pagos y gastos registrados</li>
                      <li>• Usar el botón 🛠️ para más información</li>
                    </ul>
                  </div>
                )}
              </div>

              {/* KPIs Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white border rounded-xl p-6 text-center shadow-sm">
                  <div className="text-3xl font-bold text-green-600">
                    ${paymentsInRange.reduce((s,p)=> s+p.amount,0).toLocaleString()}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">Ingresos del Periodo</div>
                  <div className="text-xs text-gray-400 mt-2">
                    {paymentsInRange.length} pagos registrados
                  </div>
                </div>
                
                <div className="bg-white border rounded-xl p-6 text-center shadow-sm">
                  <div className="text-3xl font-bold text-red-600">
                    ${expensesInRange.reduce((s,e)=> s+e.amount,0).toLocaleString()}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">Gastos del Periodo</div>
                  <div className="text-xs text-gray-400 mt-2">
                    {expensesInRange.length} gastos registrados
                  </div>
                </div>

                <div className="bg-white border rounded-xl p-6 text-center shadow-sm">
                  <div className={`text-3xl font-bold ${(paymentsInRange.reduce((s,p)=> s+p.amount,0) - expensesInRange.reduce((s,e)=> s+e.amount,0)) >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                    ${(paymentsInRange.reduce((s,p)=> s+p.amount,0) - expensesInRange.reduce((s,e)=> s+e.amount,0)).toLocaleString()}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">Ganancia Neta</div>
                  <div className="text-xs text-gray-400 mt-2">
                    Ingresos - Gastos
                  </div>
                </div>

                <div className="bg-white border rounded-xl p-6 text-center shadow-sm">
                  <div className="text-3xl font-bold text-purple-600">
                    {paymentsInRange.length > 0 ? Math.round(paymentsInRange.reduce((s,p)=> s+p.amount,0) / paymentsInRange.length) : 0}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">Ticket Promedio</div>
                  <div className="text-xs text-gray-400 mt-2">
                    Pago promedio por cita
                  </div>
                </div>
              </div>

              {/* Gráficas principales */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Ingresos por Doctor */}
                <div className="bg-white border rounded-xl p-6 shadow-sm">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-blue-600" />
                    Ingresos por Doctor
                  </h3>
                  {ingresosPorDoctor.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={ingresosPorDoctor}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} />
                        <YAxis />
                        <Tooltip formatter={(value) => [`${Number(value).toLocaleString()}`, 'Ingresos']} />
                        <Bar dataKey="total" fill="#3b82f6" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="text-center py-12 text-gray-500">
                      <BarChart3 className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <p>Sin datos de ingresos en este periodo</p>
                    </div>
                  )}
                </div>

                {/* Métodos de Pago */}
                <div className="bg-white border rounded-xl p-6 shadow-sm">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-green-600" />
                    Métodos de Pago
                  </h3>
                  {pieIngresosPorMetodo.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={pieIngresosPorMetodo}
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          fill="#8884d8"
                          dataKey="value"
                          label={({name, percent}) => `${name} ${(percent * 100).toFixed(0)}%`}
                        >
                          {pieIngresosPorMetodo.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value) => `${Number(value).toLocaleString()}`} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="text-center py-12 text-gray-500">
                      <DollarSign className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <p>Sin datos de métodos de pago</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Evolución temporal */}
              <div className="bg-white border rounded-xl p-6 shadow-sm">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-indigo-600" />
                  Evolución Diaria - Ingresos vs Gastos
                </h3>
                {byDay.length > 0 ? (
                  <ResponsiveContainer width="100%" height={400}>
                    <BarChart data={byDay}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" />
                      <YAxis />
                      <Tooltip formatter={(value, name) => [`${Number(value).toLocaleString()}`, name === 'ingresos' ? 'Ingresos' : 'Gastos']} />
                      <Legend />
                      <Bar dataKey="ingresos" fill="#10b981" name="Ingresos" />
                      <Bar dataKey="egresos" fill="#ef4444" name="Gastos" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    <Calendar className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                    <p>Sin datos para mostrar evolución temporal</p>
                  </div>
                )}
              </div>

              {/* Análisis de Servicios */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Servicios más populares */}
                <div className="bg-white border rounded-xl p-6 shadow-sm">
                  <h3 className="text-lg font-semibold mb-4 text-blue-600">
                    🏆 Servicios más Populares
                  </h3>
                  {serviceAgg.top.length > 0 ? (
                    <div className="space-y-3">
                      {serviceAgg.top.map((s, i) => (
                        <div key={s.name} className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                              {i + 1}
                            </div>
                            <span className="font-medium">{s.name}</span>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-blue-600">{s.count}</div>
                            <div className="text-xs text-gray-500">citas</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <p>Sin datos de servicios</p>
                    </div>
                  )}
                </div>

                {/* Servicios más rentables */}
                <div className="bg-white border rounded-xl p-6 shadow-sm">
                  <h3 className="text-lg font-semibold mb-4 text-green-600">
                    💰 Servicios más Rentables
                  </h3>
                  {serviceAgg.margin.length > 0 ? (
                    <div className="space-y-3">
                      {serviceAgg.margin.slice(0, 5).map((s, i) => (
                        <div key={s.name} className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                              {i + 1}
                            </div>
                            <span className="font-medium">{s.name}</span>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-green-600">${s.amount.toLocaleString()}</div>
                            <div className="text-xs text-gray-500">{s.count} citas</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <p>Sin datos de rentabilidad</p>
                    </div>
                  )}
                </div>

                {/* Resumen del periodo */}
                <div className="bg-white border rounded-xl p-6 shadow-sm">
                  <h3 className="text-lg font-semibold mb-4 text-purple-600">
                    📊 Resumen del Periodo
                  </h3>
                  <div className="space-y-4">
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <div className="text-sm text-gray-500">Total de Citas</div>
                      <div className="text-2xl font-bold text-gray-700">
                        {appointments?.filter(a => inRange(a.date)).length || 0}
                      </div>
                    </div>
                    
                    <div className="p-3 bg-green-50 rounded-lg">
                      <div className="text-sm text-gray-500">Citas Atendidas</div>
                      <div className="text-2xl font-bold text-green-600">
                        {appointments?.filter(a => inRange(a.date) && a.status === 'Atendida').length || 0}
                      </div>
                    </div>
                    
                    <div className="p-3 bg-yellow-50 rounded-lg">
                      <div className="text-sm text-gray-500">Citas Pendientes</div>
                      <div className="text-2xl font-bold text-yellow-600">
                        {appointments?.filter(a => inRange(a.date) && a.status === 'Pendiente').length || 0}
                      </div>
                    </div>
                    
                    <div className="p-3 bg-red-50 rounded-lg">
                      <div className="text-sm text-gray-500">Citas Canceladas</div>
                      <div className="text-2xl font-bold text-red-600">
                        {appointments?.filter(a => inRange(a.date) && a.status === 'Cancelada').length || 0}
                      </div>
                    </div>
                    
                    <div className="border-t pt-3">
                      <div className="text-sm text-gray-500">Tasa de Conversión</div>
                      <div className="text-lg font-bold text-blue-600">
                        {appointments?.filter(a => inRange(a.date)).length > 0 
                          ? Math.round((appointments?.filter(a => inRange(a.date) && a.status === 'Atendida').length || 0) / (appointments?.filter(a => inRange(a.date)).length || 1) * 100)
                          : 0}%
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Rankings de Doctores */}
              <div className="bg-white border rounded-xl p-6 shadow-sm">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-600" />
                  Ranking de Productividad por Doctor
                </h3>
                {doctors && doctors.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-gray-50">
                          <th className="text-left p-3 font-semibold">Posición</th>
                          <th className="text-left p-3 font-semibold">Doctor</th>
                          <th className="text-center p-3 font-semibold">Citas Atendidas</th>
                          <th className="text-center p-3 font-semibold">Ingresos Generados</th>
                          <th className="text-center p-3 font-semibold">Ticket Promedio</th>
                          <th className="text-center p-3 font-semibold">Tasa Conversión</th>
                        </tr>
                      </thead>
                      <tbody>
                        {doctors.map((doctor, index) => {
                          const citasAtendidas = appointments?.filter(a => inRange(a.date) && a.doctorId === doctor.id && a.status === 'Atendida').length || 0;
                          const citasTotales = appointments?.filter(a => inRange(a.date) && a.doctorId === doctor.id).length || 0;
                          const ingresos = paymentsInRange.filter(p => p.doctorId === doctor.id).reduce((sum, p) => sum + p.amount, 0);
                          const ticketPromedio = citasAtendidas > 0 ? ingresos / citasAtendidas : 0;
                          const tasaConversion = citasTotales > 0 ? (citasAtendidas / citasTotales) * 100 : 0;
                          
                          return (
                            <tr key={doctor.id} className="border-b hover:bg-gray-50">
                              <td className="p-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm"
                                       style={{ backgroundColor: doctor.color }}>
                                    {index + 1}
                                  </div>
                                </div>
                              </td>
                              <td className="p-3 font-medium">{doctor.name}</td>
                              <td className="p-3 text-center font-bold text-green-600">{citasAtendidas}</td>
                              <td className="p-3 text-center font-bold text-blue-600">${ingresos.toLocaleString()}</td>
                              <td className="p-3 text-center">${Math.round(ticketPromedio).toLocaleString()}</td>
                              <td className="p-3 text-center">
                                <span className={`px-2 py-1 rounded-full text-xs font-bold ${tasaConversion >= 80 ? 'bg-green-100 text-green-800' : tasaConversion >= 60 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                                  {Math.round(tasaConversion)}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <p>Sin datos de doctores para mostrar</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ========== LABORATORIOS MODULE ========== */}
          {activeTab === 'laboratorios' && (
            <div className="space-y-8">
              {/* Nuevo Laboratorio */}
              <div className="bg-gradient-to-r from-indigo-500 to-blue-600 rounded-xl p-6 text-white">
                <h2 className="text-xl font-bold mb-4 flex items-center">
                  <Plus className="w-5 h-5 mr-2" /> Registrar Laboratorio
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input
                    className="px-3 py-2 rounded text-gray-900"
                    placeholder="Nombre del laboratorio"
                    value={newLaboratorio.nombre}
                    onChange={(e) => setNewLaboratorio({ ...newLaboratorio, nombre: e.target.value })}
                  />
                  <input
                    className="px-3 py-2 rounded text-gray-900"
                    placeholder="Contacto (teléfono/email)"
                    value={newLaboratorio.contacto}
                    onChange={(e) => setNewLaboratorio({ ...newLaboratorio, contacto: e.target.value })}
                  />
                  <button
                    onClick={addLaboratorio}
                    disabled={!newLaboratorio.nombre.trim()}
                    className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                      !newLaboratorio.nombre.trim()
                        ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                        : "bg-white text-indigo-600 hover:bg-gray-100"
                    }`}
                  >
                    Registrar Laboratorio
                  </button>
                </div>
              </div>

              {/* Nuevo Trabajo */}
              <div className="bg-gradient-to-r from-purple-500 to-pink-600 rounded-xl p-6 text-white">
                <h2 className="text-xl font-bold mb-4 flex items-center">
                  <Plus className="w-5 h-5 mr-2" /> Nuevo Trabajo de Laboratorio
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <input
                    className="px-3 py-2 rounded text-gray-900"
                    placeholder="Nombre del paciente"
                    value={newTrabajo.paciente}
                    onChange={(e) => setNewTrabajo({ ...newTrabajo, paciente: e.target.value })}
                  />
                  <select
                    className="px-3 py-2 rounded text-gray-900"
                    value={newTrabajo.laboratorioId}
                    onChange={(e) => setNewTrabajo({ ...newTrabajo, laboratorioId: e.target.value })}
                  >
                    <option value="">Seleccionar laboratorio</option>
                    {laboratorios?.map((lab) => (
                      <option key={lab.id} value={lab.id}>
                        {lab.nombre}
                      </option>
                    )) || []}
                  </select>
                  <select
                    className="px-3 py-2 rounded text-gray-900"
                    value={newTrabajo.servicioId}
                    onChange={(e) => setNewTrabajo({ ...newTrabajo, servicioId: e.target.value })}
                  >
                    <option value="">Tipo de trabajo</option>
                    {services?.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name}
                      </option>
                    )) || []}
                  </select>
                  <input
                    type="number"
                    className="px-3 py-2 rounded text-gray-900"
                    placeholder="Presupuesto"
                    value={newTrabajo.presupuesto}
                    onChange={(e) => setNewTrabajo({ ...newTrabajo, presupuesto: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mt-3">
                  <input
                    type="date"
                    className="px-3 py-2 rounded text-gray-900"
                    value={newTrabajo.fechaInicio}
                    onChange={(e) => setNewTrabajo({ ...newTrabajo, fechaInicio: e.target.value })}
                  />
                  <input
                    type="date"
                    className="px-3 py-2 rounded text-gray-900"
                    value={newTrabajo.fechaEntregaEstimada}
                    onChange={(e) => setNewTrabajo({ ...newTrabajo, fechaEntregaEstimada: e.target.value })}
                  />
                  <select
                    className="px-3 py-2 rounded text-gray-900"
                    value={newTrabajo.etapa}
                    onChange={(e) => setNewTrabajo({ ...newTrabajo, etapa: e.target.value })}
                  >
                    <option value="Toma de impresión">Toma de impresión</option>
                    <option value="En proceso">En proceso</option>
                    <option value="Prueba">Prueba</option>
                    <option value="Ajustes">Ajustes</option>
                    <option value="Terminado">Terminado</option>
                    <option value="Entregado">Entregado</option>
                  </select>
                  <input
                    className="px-3 py-2 rounded text-gray-900"
                    placeholder="Notas adicionales"
                    value={newTrabajo.notas}
                    onChange={(e) => setNewTrabajo({ ...newTrabajo, notas: e.target.value })}
                  />
                  <button
                    onClick={addTrabajo}
                    disabled={!newTrabajo.paciente || !newTrabajo.laboratorioId || !newTrabajo.servicioId || !newTrabajo.presupuesto}
                    className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                      !newTrabajo.paciente || !newTrabajo.laboratorioId || !newTrabajo.servicioId || !newTrabajo.presupuesto
                        ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                        : "bg-white text-purple-600 hover:bg-gray-100"
                    }`}
                  >
                    Crear Trabajo
                  </button>
                </div>
              </div>

              {/* Estadísticas */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                <div className="bg-white border rounded-xl p-6 text-center shadow-sm">
                  <div className="text-3xl font-bold text-orange-600">{estadisticasLab.trabajosPendientes}</div>
                  <div className="text-sm text-gray-500 mt-1">Trabajos Pendientes</div>
                </div>
                <div className="bg-white border rounded-xl p-6 text-center shadow-sm">
                  <div className="text-3xl font-bold text-green-600">{estadisticasLab.trabajosEntregados}</div>
                  <div className="text-sm text-gray-500 mt-1">Trabajos Entregados</div>
                </div>
                <div className="bg-white border rounded-xl p-6 text-center shadow-sm">
                  <div className="text-3xl font-bold text-blue-600">${estadisticasLab.montoTotalPendiente.toLocaleString()}</div>
                  <div className="text-sm text-gray-500 mt-1">Monto Pendiente</div>
                </div>
                <div className="bg-white border rounded-xl p-6 text-center shadow-sm">
                  <div className="text-3xl font-bold text-purple-600">${estadisticasLab.montoTotalAbonado.toLocaleString()}</div>
                  <div className="text-sm text-gray-500 mt-1">Total Abonado</div>
                </div>
                <div className="bg-white border rounded-xl p-6 text-center shadow-sm">
                  <div className="text-3xl font-bold text-red-600">${estadisticasLab.saldoTotalPendiente.toLocaleString()}</div>
                  <div className="text-sm text-gray-500 mt-1">Saldo Pendiente</div>
                </div>
              </div>

              {/* Registrar Abono */}
              <div className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl p-6 text-white">
                <h2 className="text-xl font-bold mb-4 flex items-center">
                  <DollarSign className="w-5 h-5 mr-2" /> Registrar Abono
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                  <select
                    className="px-3 py-2 rounded text-gray-900"
                    value={newAbono.trabajoId}
                    onChange={(e) => setNewAbono({ ...newAbono, trabajoId: e.target.value })}
                  >
                    <option value="">Seleccionar trabajo</option>
                    {trabajosFiltrados
                      .filter((t) => saldoPendiente(t) > 0)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.paciente} - {laboratorioById(t.laboratorioId)?.nombre} - Saldo: ${saldoPendiente(t).toLocaleString()}
                        </option>
                      ))}
                  </select>
          <input
            type="number"
            className="px-3 py-2 rounded text-gray-900"
            placeholder="Monto del abono"
            value={newAbono.monto}
            onChange={(e) => setNewAbono({ ...newAbono, monto: e.target.value })}
          />
          <input
            type="date"
            className="px-3 py-2 rounded text-gray-900"
            value={newAbono.fecha}
            onChange={(e) => setNewAbono({ ...newAbono, fecha: e.target.value })}
          />
          <select
            className="px-3 py-2 rounded text-gray-900"
            value={newAbono.metodo_pago || 'efectivo'}
            onChange={(e) => setNewAbono({ ...newAbono, metodo_pago: e.target.value })}
          >
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="cheque">Cheque</option>
          </select>
          <input
            className="px-3 py-2 rounded text-gray-900"
            placeholder="Nota (opcional)"
            value={newAbono.nota}
            onChange={(e) => setNewAbono({ ...newAbono, nota: e.target.value })}
          />
         <button
  onClick={async () => {
    if (!newAbono.trabajoId || !newAbono.monto) return;
    try {
      // Registrar el abono usando el helper que ya tienes
      await createAbono(String(newAbono.trabajoId), {
        monto: parseFloat(String(newAbono.monto)),
        fecha: newAbono.fecha,
        nota: newAbono.nota,
        // acepta tanto paymentMethod como metodo_pago por si tu estado usa uno u otro
        paymentMethod: (newAbono.paymentMethod ?? newAbono.metodo_pago ?? 'efectivo') as any,
      });

      // Limpiar formulario
      setNewAbono({
        trabajoId: '',
        monto: '',
        fecha: fmtDate(today),
        nota: '',
        // si tu estado usa 'metodo_pago', mantenlo; si usa 'paymentMethod', también quedará cubierto
        metodo_pago: 'efectivo',
        paymentMethod: 'efectivo' as any,
      });

      // Recargar lista de trabajos para reflejar el nuevo abono
      await reloadTrabajos?.();
    } catch (e) {
      console.error('Error adding abono:', e);
      alert('No se pudo registrar el abono.');
    }
  }}
  disabled={!newAbono.trabajoId || !newAbono.monto}
  className={`px-6 py-2 rounded-lg font-medium transition-colors ${
    !newAbono.trabajoId || !newAbono.monto
      ? "bg-gray-300 text-gray-500 cursor-not-allowed"
      : "bg-white text-green-700 hover:bg-gray-100"
  }`}
>
  Registrar Abono
</button>

             </div>
              </div>

              {/* Filtros */}
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <label className="text-sm text-gray-500">Estado</label>
                  <select
                    className="border px-3 py-2 rounded block"
                    value={laboratorioFilter}
                    onChange={(e) => setLaboratorioFilter(e.target.value as any)}
                  >
                    <option value="todos">Todos los trabajos</option>
                    <option value="pendientes">Trabajos pendientes</option>
                    <option value="entregados">Trabajos entregados</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-500">Laboratorio</label>
                  <select
                    className="border px-3 py-2 rounded block"
                    value={selectedLaboratorioFilter}
                    onChange={(e) => setSelectedLaboratorioFilter(e.target.value)}
                  >
                    <option value="">Todos los laboratorios</option>
                    {laboratorios?.map((lab) => (
                      <option key={lab.id} value={lab.id}>
                        {lab.nombre}
                      </option>
                    )) || []}
                  </select>
                </div>
                <div className="ml-auto text-sm text-gray-500">Mostrando {trabajosFiltrados.length} trabajos</div>
              </div>

              {/* Lista de trabajos */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Trabajos de Laboratorio</h3>
                {trabajosFiltrados.length === 0 ? (
                  <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-xl">
                    <div className="text-6xl mb-4">🔬</div>
                    <p className="text-lg">No hay trabajos en esta categoría</p>
                    <p className="text-sm">Registra un nuevo trabajo para comenzar</p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {trabajosFiltrados.map((t) => (
                      <div key={t.id} className="bg-white border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="flex-1 min-w-64">
                            <div className="flex items-center gap-2 mb-2">
                              <h4 className="text-lg font-semibold text-gray-800">{t.paciente}</h4>
                              <span
                                className={`px-2 py-1 rounded-full text-xs font-bold ${
                                  t.etapa === "Entregado"
                                    ? "bg-green-100 text-green-800"
                                    : t.etapa === "Terminado"
                                    ? "bg-blue-100 text-blue-800"
                                    : t.etapa === "En proceso"
                                    ? "bg-yellow-100 text-yellow-800"
                                    : "bg-gray-100 text-gray-800"
                                }`}
                              >
                                {t.etapa}
                              </span>
                            </div>
                            <div className="text-sm text-gray-600 space-y-1">
                              <div>
                                <strong>Laboratorio:</strong> {laboratorioById(t.laboratorioId)?.nombre}
                              </div>
                              <div>
                                <strong>Servicio:</strong> {serviceById(t.servicioId)?.name}
                              </div>
                              <div>
                                <strong>Inicio:</strong> {t.fechaInicio} | <strong>Entrega estimada:</strong> {t.fechaEntregaEstimada}
                              </div>
                              {t.notas && (
                                <div>
                                  <strong>Notas:</strong> {t.notas}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="text-2xl font-bold text-blue-600">${t.presupuesto.toLocaleString()}</div>
                            <div className="text-sm text-gray-500">Presupuesto total</div>
                            <div className="text-sm mt-2">
                              <span className="text-green-600 font-medium">Abonado: ${totalAbonado(t).toLocaleString()}</span>
                            </div>
                            <div className="text-sm">
                              <span className={`font-medium ${saldoPendiente(t) > 0 ? "text-red-600" : "text-green-600"}`}>
                                Saldo: ${saldoPendiente(t).toLocaleString()}
                              </span>
                            </div>
                          </div>

                          <div className="flex gap-2">
                            <button
                              onClick={() => setEditingTrabajo(t)}
                              className="px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm flex items-center gap-2"
                            >
                              <Edit className="w-4 h-4" /> Editar
                            </button>
                            {t.etapa !== "Entregado" && (
                              <button
                                onClick={() => updateTrabajoLab(t.id, { etapa: "Entregado", notas: t.notas })}
                                className="px-3 py-2 bg-green-500 text-white rounded hover:bg-green-600 text-sm flex items-center gap-2"
                              >
                                <Check className="w-4 h-4" /> Marcar Entregado
                              </button>
                            )}
                          </div>
                        </div>

                        <PagarLaboratorioUI
                         trabajo={t}
                          onPagar={(id, monto, fecha) => pagarLaboratorio(id, monto, fecha)}
                          />

                        {/* Historial de abonos */}
                        {t.abonos.length > 0 && (
                          <div className="mt-4 pt-4 border-t">
                            <h5 className="font-medium text-gray-700 mb-2">Historial de Abonos</h5>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                              {t.abonos.map((a) => (
                               <div key={a.id} className="flex items-center justify-between bg-green-50 p-2 rounded">
                               <div>
                                <div className="font-medium text-green-700">${a.monto.toLocaleString()}</div>
                                 <div className="text-xs text-gray-600">{toDateInput(a.fecha)}</div>

                              {/* 🔹 NUEVO: Método de pago si viene del backend */}
                               {a.paymentMethod && (
                              <div className="text-xs text-green-700">
                              {(
                              { efectivo: 'efectivo',
                              transferencia: 'transferencia',
                              tarjeta_debito: 'tarjeta débito',
                             tarjeta_credito: 'tarjeta crédito' } as Record<string,string>
                              )[a.paymentMethod] || a.paymentMethod}
                                  </div>
                                  )}

                                    {/* Nota opcional (igual que antes) */}
                                   {a.nota && <div className="text-xs mt-1 text-gray-700">{a.nota}</div>}
                                 </div>
                                </div>

                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Lista de laboratorios */}
              <div className="bg-white border rounded-xl p-6 shadow-sm">
                <h3 className="text-lg font-semibold mb-4">Laboratorios Registrados</h3>
                {laboratorios && laboratorios.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {laboratorios.map((lab) => (
                      <div key={lab.id} className="border rounded-lg p-4 hover:bg-gray-50">
                        <h4 className="font-semibold text-gray-800">{lab.nombre}</h4>
                        <p className="text-sm text-gray-600">{lab.contacto}</p>
                        <div className="text-xs text-gray-500 mt-2">
                          {trabajos?.filter((t) => t.laboratorioId === lab.id).length || 0} trabajos
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <p>No hay laboratorios registrados</p>
                  </div>
                )}
              </div>

              {/* Modal editar trabajo */}
              {editingTrabajo && (
                <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
                  <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-lg font-semibold">Editar Trabajo</h4>
                      <button onClick={() => setEditingTrabajo(null)} className="p-1 hover:bg-gray-100 rounded">
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="text-sm text-gray-500">Paciente</label>
                        <div className="px-3 py-2 bg-gray-100 rounded font-medium">{editingTrabajo.paciente}</div>
                      </div>

                      <div>
                        <label className="text-sm text-gray-500">Laboratorio</label>
                        <div className="px-3 py-2 bg-gray-100 rounded">{laboratorioById(editingTrabajo.laboratorioId)?.nombre}</div>
                      </div>

                      <div>
                        <label className="text-sm text-gray-500">Etapa actual</label>
                        <select
                          className="border px-3 py-2 rounded w-full"
                          value={editingTrabajo.etapa}
                          onChange={(e) => setEditingTrabajo({ ...editingTrabajo, etapa: e.target.value })}
                        >
                          <option value="Toma de impresión">Toma de impresión</option>
                          <option value="En proceso">En proceso</option>
                          <option value="Prueba">Prueba</option>
                          <option value="Ajustes">Ajustes</option>
                          <option value="Terminado">Terminado</option>
                          <option value="Entregado">Entregado</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-sm text-gray-500">Notas</label>
                        <textarea
                          className="border px-3 py-2 rounded w-full"
                          rows={3}
                          value={editingTrabajo.notas || ""}
                          onChange={(e) => setEditingTrabajo({ ...editingTrabajo, notas: e.target.value })}
                          placeholder="Notas adicionales sobre el trabajo..."
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-gray-500">Presupuesto:</span>
                          <div className="font-bold text-blue-600">${editingTrabajo.presupuesto.toLocaleString()}</div>
                        </div>
                        <div>
                          <span className="text-gray-500">Abonado:</span>
                          <div className="font-bold text-green-600">${totalAbonado(editingTrabajo).toLocaleString()}</div>
                        </div>
                        <div>
                          <span className="text-gray-500">Saldo pendiente:</span>
                          <div className="font-bold text-red-600">${saldoPendiente(editingTrabajo).toLocaleString()}</div>
                        </div>
                        <div>
                          <span className="text-gray-500">Entrega estimada:</span>
                          <div className="font-medium">{editingTrabajo.fechaEntregaEstimada}</div>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 mt-6">
                      <button className="px-4 py-2 rounded bg-gray-100 hover:bg-gray-200 text-sm" onClick={() => setEditingTrabajo(null)}>
                        Cancelar
                      </button>
                      <button
                        className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm flex items-center gap-2"
                        onClick={async () => {
                          await updateTrabajoLab(editingTrabajo.id, { etapa: editingTrabajo.etapa, notas: editingTrabajo.notas });
                          setEditingTrabajo(null);
                        }}
                      >
                        <Check className="w-4 h-4" /> Guardar Cambios
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========== WHATSAPP MODULE ========== */}
          {activeTab === 'whatsapp' && (
            <div className="space-y-8">
              {/* Header con estado */}
              <div className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl p-6 text-white">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold mb-2 flex items-center">
                      <MessageCircle className="w-6 h-6 mr-2" />
                      Panel de WhatsApp
                    </h2>
                    <div className="flex items-center gap-4 text-sm opacity-90">
                      <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${
                        whatsappConfig.isEnabled ? 'bg-green-600' : 'bg-red-600'
                      }`}>
                        <div className={`w-2 h-2 rounded-full ${
                          whatsappConfig.isEnabled ? 'bg-green-300' : 'bg-red-300'
                        }`} />
                        {whatsappConfig.isEnabled ? 'Activo' : 'Inactivo'}
                      </div>
                      <span>Phone ID: {whatsappConfig.phoneNumberId}</span>
                      <span>Access Token: {whatsappConfig.accessToken}</span>
                    </div>
                  </div>
                  
                 <div className="flex items-center gap-3 flex-wrap">
  {/* Periodo */}
  <div className="flex items-center gap-2 bg-white/20 rounded-lg px-3 py-2">
    <span className="text-sm">Periodo:</span>

    <select
      value={waRange}
      onChange={(e) => setWaRange(e.target.value as any)}
      className="text-sm bg-white rounded px-2 py-1"
    >
      <option value="today">Hoy</option>
      <option value="7d">7 días</option>
      <option value="30d">30 días</option>
      <option value="all">Todos</option>
      <option value="custom">Rango</option>
    </select>

    {waRange === 'custom' && (
      <>
        <input
          type="date"
          value={waFrom}
          onChange={(e) => setWaFrom(e.target.value)}
          className="text-sm bg-white rounded px-2 py-1"
        />
        <span className="text-xs opacity-70">→</span>
        <input
          type="date"
          value={waTo}
          onChange={(e) => setWaTo(e.target.value)}
          className="text-sm bg-white rounded px-2 py-1"
        />
      </>
    )}
  </div>

  {/* Botón Actualizar */}
  <button
    onClick={loadWhatsappData}
    disabled={loadingWhatsapp}
    className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg font-medium transition-colors flex items-center gap-2"
  >
    <RefreshCw className={`w-4 h-4 ${loadingWhatsapp ? 'animate-spin' : ''}`} />
    Actualizar
  </button>

  {/* Configurar API */}
  <button
    onClick={() => window.open(`https://developers.facebook.com/apps/`, '_blank')}
    className="px-4 py-2 bg-white text-green-600 hover:bg-gray-100 rounded-lg font-medium"
  >
    Configurar API
  </button>
</div>
                </div>
              </div>
                         {/* BOTONES POR SUCURSAL */}
<div className="flex gap-4 flex-wrap">
  <BroadcastTodayButton
  sucursalId="sucursal_1"
  label="Enviar confirmaciones HOY — Sucursal 1"
  onAfterSend={loadWhatsappData}
/>
<BroadcastTodayButton
  sucursalId="sucursal_2"
  label="Enviar confirmaciones HOY — Sucursal 2"
  onAfterSend={loadWhatsappData}
/>
</div>


                 

              {/* Estadísticas */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white border rounded-xl p-6 text-center shadow-sm">
                  <div className="text-3xl font-bold text-blue-600">{whatsappStats.totalSent}</div>
                  <div className="text-sm text-gray-500 mt-1">Mensajes Enviados</div>
                </div>
                <div className="bg-white border rounded-xl p-6 text-center shadow-sm">
                  <div className="text-3xl font-bold text-green-600">{whatsappStats.totalReceived}</div>
                  <div className="text-sm text-gray-500 mt-1">Mensajes Recibidos</div>
                </div>
                <div className="bg-white border rounded-xl p-6 text-center shadow-sm">
                  <div className="text-3xl font-bold text-emerald-600">{whatsappStats.confirmations}</div>
                  <div className="text-sm text-gray-500 mt-1">Confirmaciones</div>
                </div>
                <div className="bg-white border rounded-xl p-6 text-center shadow-sm">
                  <div className="text-3xl font-bold text-red-600">{whatsappStats.cancellations}</div>
                  <div className="text-sm text-gray-500 mt-1">Cancelaciones</div>
                </div>
              </div>

              {/* Envío manual de mensajes */}
              <div className="bg-white border rounded-xl p-6 shadow-sm">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Send className="w-5 h-5 text-blue-600" />
                  Enviar Mensaje Manual
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <input
                    className="px-3 py-2 border rounded-lg"
                    placeholder="Teléfono (+5216861234567)"
                    value={sendMessageForm.phone}
                    onChange={(e) => setSendMessageForm({...sendMessageForm, phone: e.target.value})}
                  />
                  <input
                    className="px-3 py-2 border rounded-lg"
                    placeholder="Mensaje"
                    value={sendMessageForm.message}
                    onChange={(e) => setSendMessageForm({...sendMessageForm, message: e.target.value})}
                  />
                  <select
                    className="px-3 py-2 border rounded-lg"
                    value={sendMessageForm.template}
                    onChange={(e) => setSendMessageForm({...sendMessageForm, template: e.target.value})}
                  >
                    <option value="">Template (opcional)</option>
                    <option value="appointment_reminder">Recordatorio de Cita</option>
                    <option value="appointment_confirmation">Confirmación de Cita</option>
                  </select>
                  <button
                    onClick={handleSendMessage}
                    disabled={!sendMessageForm.phone || !sendMessageForm.message}
                    className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                      !sendMessageForm.phone || !sendMessageForm.message
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    Enviar
                  </button>
                </div>
              </div>

              {/* Historial de mensajes */}
              <div className="flex items-center gap-2 mb-2">
  <button
    onClick={() => setMsgFilter('all')}
    className={`px-2 py-1 rounded text-xs border ${
      msgFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-white text-gray-700'
    }`}
    title="Ver todos"
  >
    Todos
  </button>

  <button
    onClick={() => setMsgFilter('outgoing')}
    className={`px-2 py-1 rounded text-xs border ${
      msgFilter === 'outgoing' ? 'bg-blue-600 text-white' : 'bg-white text-blue-700'
    }`}
    title="Solo enviados"
  >
    Enviados
  </button>

  <button
    onClick={() => setMsgFilter('incoming')}
    className={`px-2 py-1 rounded text-xs border ${
      msgFilter === 'incoming' ? 'bg-green-600 text-white' : 'bg-white text-green-700'
    }`}
    title="Solo recibidos"
  >
    Recibidos
  </button>
</div>

              <div className="bg-white border rounded-xl shadow-sm">
                <div className="p-6 border-b">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <MessageSquare className="w-5 h-5 text-gray-600" />
                      Historial de Mensajes
                    </h3>
                    <div className="text-sm text-gray-500">
                      {whatsappMessages.length} mensajes
                    </div>
                  </div>
                </div>

                <div className="max-h-96 overflow-y-auto">
                  {loadingWhatsapp ? (
                    <div className="p-8 text-center">
                      <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
                      <p className="text-gray-500">Cargando mensajes...</p>
                    </div>
                  ) : whatsappMessages.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                      <MessageCircle className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <p>No hay mensajes registrados</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {visibleMessages.map((msg) => (
                        <div
                          key={msg.id}
                          className={`p-4 border-l-4 hover:bg-gray-50 ${
                            msg.type === 'outgoing' 
                              ? 'border-l-blue-500 bg-blue-50/30' 
                              : 'border-l-green-500 bg-green-50/30'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <div className={`flex items-center gap-2 px-2 py-1 rounded-full text-xs font-medium ${
                                  msg.type === 'outgoing' 
                                    ? 'bg-blue-100 text-blue-800' 
                                    : 'bg-green-100 text-green-800'
                                }`}>
                                  {msg.type === 'outgoing' ? (
                                    <ArrowUpRight className="w-3 h-3" />
                                  ) : (
                                    <ArrowDownLeft className="w-3 h-3" />
                                  )}
                                  {msg.type === 'outgoing' ? 'Enviado' : 'Recibido'}
                                </div>
                                
                               <div className="text-sm text-gray-600">
                               {(msg.contactName ?? msg.patient) ? (
                               <>
                               <strong>{msg.contactName ?? msg.patient}</strong> — {msg.phone}
                               </>
                               ) : (
                               msg.phone
                               )}
                               </div>

                                
                                {msg.appointmentId && (
                                  <div className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded">
                                    Cita #{msg.appointmentId}
                                  </div>
                                )}
                                
                                {msg.manual && (
                                  <div className="text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded">
                                    Manual
                                  </div>
                                )}
                              </div>
                              
                              <div className="text-gray-800 mb-2 bg-white p-2 rounded border-l-2">
                                "{msg.message}"
                              </div>
                              
                              <div className="flex items-center gap-3 text-xs text-gray-500">
                                <div>{new Date(msg.timestamp).toLocaleString()}</div>
                                <div className={`px-2 py-1 rounded ${
                                  msg.status === 'delivered' ? 'bg-green-100 text-green-800' :
                                  msg.status === 'sent' ? 'bg-blue-100 text-blue-800' :
                                  msg.status === 'processed' ? 'bg-purple-100 text-purple-800' :
                                  'bg-gray-100 text-gray-800'
                                }`}>
                                  {msg.status}
                                </div>
                              </div>
                            </div>

                            <div className="flex gap-2 ml-4">
                              {msg.phone && (
                                <button
                                  onClick={() => handleLookupAppointment(msg.phone)}
                                  className="p-1 hover:bg-gray-100 rounded"
                                  title="Ver citas del paciente"
                                >
                                  <Search className="w-4 h-4 text-gray-600" />
                                </button>
                              )}
                              
                              {msg.type === 'incoming' && msg.message.toUpperCase().includes('CONFIRMAR') && (
                                <div className="flex items-center gap-1">
                                  <Check className="w-4 h-4 text-green-600" />
                                  <span className="text-xs text-green-600 font-medium">Confirmado</span>
                                </div>
                              )}
                              
                              {msg.type === 'incoming' && msg.message.toUpperCase().includes('CANCELAR') && (
                                <div className="flex items-center gap-1">
                                  <X className="w-4 h-4 text-red-600" />
                                  <span className="text-xs text-red-600 font-medium">Cancelado</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Configuración y testing */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white border rounded-xl p-6 shadow-sm">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Settings className="w-5 h-5 text-gray-600" />
                    Configuración
                  </h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <span className="text-sm font-medium">Bot Automático</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          className="sr-only peer"
                          checked={whatsappConfig.isEnabled}
                          onChange={(e) => {
                            // Aquí puedes implementar la lógica para activar/desactivar
                            alert(`Bot ${e.target.checked ? 'activado' : 'desactivado'}`);
                            setWhatsappConfig(prev => ({...prev, isEnabled: e.target.checked}));
                          }}
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                      </label>
                    </div>
                    
                    <div className="text-sm text-gray-600 space-y-2">
                      <div><strong>Webhook URL:</strong> {whatsappConfig.webhookUrl}</div>
                      <div><strong>Verify Token:</strong> {whatsappConfig.verifyToken}</div>
                    </div>
                  </div>
                </div>

                <div className="bg-white border rounded-xl p-6 shadow-sm">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <TestTube className="w-5 h-5 text-gray-600" />
                    Testing y Debug
                  </h3>
                  <div className="space-y-3">
                    <button
                      onClick={loadWhatsappData}
                      className="w-full px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 text-left"
                    >
                      🔍 Verificar Configuración
                    </button>
                    
                    <button
                      onClick={() => window.open('/api/whatsapp/debug/columns', '_blank')}
                      className="w-full px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 text-left"
                    >
                      🗃️ Ver Columnas DB
                    </button>
                    
                    <div className="pt-3">
                      <label className="text-sm font-medium text-gray-700">Buscar citas por teléfono:</label>
                      <div className="flex gap-2 mt-1">
                        <input
                          className="flex-1 px-3 py-2 border rounded-lg text-sm"
                          placeholder="+5216861234567"
                          id="lookup-phone"
                        />
                        <button
                          onClick={async () => {
                            const phoneInput = document.getElementById('lookup-phone') as HTMLInputElement;
                            const phone = phoneInput?.value;
                            if (phone) {
                              await handleLookupAppointment(phone);
                            }
                          }}
                          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"
                        >
                          Buscar
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

{/* ========== EMPRESAS ========== */}
{activeTab === 'empresas' && isSuperAdmin && <EmpresasModule />}

{/* ========== FACTURACIÓN ELECTRÓNICA ========== */}
{activeTab === 'facturacion' && isSuperAdmin && (
  <div className="space-y-8">
    {/* Notificación */}
    {factNotification && (
      <div className={`p-4 rounded-lg border ${
        factNotification.includes('Error') 
          ? 'bg-red-50 border-red-200 text-red-800' 
          : 'bg-green-50 border-green-200 text-green-800'
      }`}>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <span>{factNotification}</span>
          <button 
            onClick={() => setFactNotification('')}
            className="ml-2 text-sm opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      </div>
    )}

    {/* Loading overlay */}
    {factLoading && (
      <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 shadow-xl">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
          <p>Procesando...</p>
        </div>
      </div>
    )}

    {/* Header con estadísticas / estado SAT */}
    <div className="bg-gradient-to-r from-purple-500 to-indigo-600 rounded-xl p-6 text-white">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold mb-2 flex items-center">
            <CreditCard className="w-6 h-6 mr-2" />
            Facturación Electrónica SAT
          </h2>
          <div className="flex items-center gap-4 text-sm opacity-90">
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${
              configuracionSAT?.activo ? 'bg-green-600' : 'bg-red-600'
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                configuracionSAT?.activo ? 'bg-green-300' : 'bg-red-300'
              }`} />
              {configuracionSAT?.activo ? 'Configurado' : 'Sin configurar'}
            </div>
            <span>RFC: {configuracionSAT?.rfc || 'No configurado'}</span>
            <span>Último folio: {configuracionSAT?.ultimo_folio || 1}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => { reloadClientesSafe(); reloadFacturasSafe(); reloadConfiguracionSafe(); }}

            disabled={loadingFacturacion}
            className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loadingFacturacion ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>
      </div>
    </div>

    {/* Estadísticas */}

    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
      <div className="bg-white border rounded-xl p-6 text-center shadow-sm">
        <div className="text-3xl font-bold text-green-600">
          {facturas.filter(f => f.estado === 'timbrada').length}
        </div>
        <div className="text-sm text-gray-500 mt-1">Facturas Timbradas</div>
      </div>
      <div className="bg-white border rounded-xl p-6 text-center shadow-sm">
        <div className="text-3xl font-bold text-yellow-600">
          {facturas.filter(f => f.estado === 'borrador').length}
        </div>
        <div className="text-sm text-gray-500 mt-1">Borradores</div>
      </div>
      <div className="bg-white border rounded-xl p-6 text-center shadow-sm">
        <div className="text-3xl font-bold text-red-600">
          {facturas.filter(f => f.estado === 'cancelada').length}
        </div>
        <div className="text-sm text-gray-500 mt-1">Canceladas</div>
      </div>
      <div className="bg-white border rounded-xl p-6 text-center shadow-sm">
        <div className="text-3xl font-bold text-blue-600">
          {clientes.filter(c => c.activo).length}
        </div>
        <div className="text-sm text-gray-500 mt-1">Clientes Activos</div>
      </div>
    </div>

    {/* Formulario de nuevo cliente */}
    {false && (
  <ClienteForm onClienteCreated={handleClienteCreated} />
)}

    {/* Formulario de nueva factura */}
    <FacturaForm
      clientes={clientes}
      appointments={appointments}
      payments={payments}
      onFacturaCreated={handleFacturaCreated}
    />

    {/* Filtros de facturas */}
    <div className="bg-white border rounded-xl p-6 shadow-sm">
      <h3 className="text-lg font-semibold mb-4">Facturas Emitidas</h3>

      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Desde</label>
          <input
            type="date"
            value={filtroFacturas.desde}
            onChange={(e) => setFiltroFacturas({ ...filtroFacturas, desde: e.target.value })}
            className="px-3 py-2 border rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Hasta</label>
          <input
            type="date"
            value={filtroFacturas.hasta}
            onChange={(e) => setFiltroFacturas({ ...filtroFacturas, hasta: e.target.value })}
            className="px-3 py-2 border rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
          <select
            value={filtroFacturas.estado}
            onChange={(e) => setFiltroFacturas({ ...filtroFacturas, estado: e.target.value })}
            className="px-3 py-2 border rounded-lg"
          >
            <option value="todas">Todas</option>
            <option value="borrador">Borradores</option>
            <option value="timbrada">Timbradas</option>
            <option value="cancelada">Canceladas</option>
            <option value="error">Con error</option>
          </select>
        </div>
        <button
          onClick={reloadFacturas}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Filtrar
        </button>
      </div>

      {/* Lista de facturas */}
      <div className="overflow-x-auto">
        {facturas.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <CreditCard className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>No hay facturas en el período seleccionado</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left p-3">Folio</th>
                <th className="text-left p-3">Fecha</th>
                <th className="text-left p-3">Cliente</th>
                <th className="text-right p-3">Total</th>
                <th className="text-center p-3">Estado</th>
                <th className="text-center p-3">UUID</th>
                <th className="text-center p-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {facturas.map(factura => (
                <tr key={factura.id} className="border-b hover:bg-gray-50">
                  <td className="p-3 font-medium">
                     {factura.serie ? `${factura.serie}-` : ''}
                     {factura.folio ?? '-'}
                    </td>
                 <td className="p-3">
                      {factura.fecha ? new Date(factura.fecha).toLocaleDateString() : '-'}
                    </td>
                  <td className="p-3">
                    <div>
                      <div className="font-medium">{factura.receptor_nombre}</div>
                      <div className="text-xs text-gray-500">{factura.receptor_rfc}</div>
                    </div>
                  </td>
                  <td className="p-3 text-right font-semibold">
                    ${factura.total.toLocaleString()}
                  </td>
                  <td className="p-3 text-center">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      factura.estado === 'timbrada' ? 'bg-green-100 text-green-800' :
                      factura.estado === 'borrador' ? 'bg-yellow-100 text-yellow-800' :
                      factura.estado === 'cancelada' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {factura.estado}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    {factura.uuid ? (
                      <div className="text-xs font-mono bg-gray-100 px-2 py-1 rounded">
                        {factura.uuid.substring(0, 8)}…
                      </div>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                 <td className="p-3 text-right">
  <div className="flex items-center justify-end gap-2">
    {/* Timbrar si está en borrador */}
    {factura.estado === "borrador" && (
      <button
        onClick={() => handleTimbrarFactura(factura.id)}
        className="px-3 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700"
      >
        Timbrar
      </button>
    )}

    {/* Acciones si ya está timbrada */}
{factura.estado === "timbrada" && (
  <>
    {/* PDF: usa enlace directo si existe; si no, botón que llama al backend */}
    {factura.pdf_path ? (
      <a
        href={factura.pdf_path}
        target="_blank"
        rel="noreferrer"
        className="px-2 py-1 text-xs rounded bg-gray-200 hover:bg-gray-300"
        title="Ver/descargar PDF"
      >
        PDF
      </a>
    ) : (
      <button
        className="px-2 py-1 text-xs rounded bg-gray-200 hover:bg-gray-300"
        onClick={() => descargarPdfFactura(factura)}
        title="Descargar PDF"
      >
        PDF
      </button>
    )}

    {/* XML: igual lógica */}
    {factura.xml_path ? (
      <a
        href={factura.xml_path}
        target="_blank"
        rel="noreferrer"
        className="px-2 py-1 text-xs rounded bg-gray-200 hover:bg-gray-300"
        title="Descargar XML"
      >
        XML
      </a>
    ) : (
      <button
        className="px-2 py-1 text-xs rounded bg-gray-200 hover:bg-gray-300"
        onClick={() => descargarXmlFactura(factura)}
        title="Descargar XML"
      >
        XML
      </button>
    )}

    {/* ZIP (PDF+XML) vía cfdi_id/uuid */}
    <button
      className="px-2 py-1 text-xs rounded bg-gray-200 hover:bg-gray-300"
      onClick={() => descargarZipFactura(factura)}
      title="Descargar ZIP (PDF+XML)"
    >
      ZIP
    </button>

    <button
      onClick={() => handleCancelarFactura(factura.id)}
      className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 ml-2"
    >
      Cancelar
    </button>
  </>
)}
  </div>
</td>

                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  </div>
)}

       {/* Footer con estado */}
<div className="mt-4 text-center text-xs text-gray-500 bg-white rounded-lg p-3">
  🗄️ Backend: PostgreSQL • 
  {isOnline ? '🟢 Conectado' : '🔴 Desconectado'} • 
  Última actualización: {new Date().toLocaleTimeString()}
</div>

{/* 🆕 Módulo de Expediente Médico Dental Completo */}
{showMedicalRecord && selectedPatientMedical && (
  <MedicalRecordModule
    patientName={selectedPatientMedical.name}
    patientPhone={selectedPatientMedical.phone}
    appointmentId={selectedPatientMedical.appointmentId}
    isOpen={showMedicalRecord}
    onClose={closeMedicalRecord}
    doctors={doctors}
    apiRequest={apiRequest}
    sucursalId={getSucursalActual() || 'sucursal_1'}
  />
)}
{/* 🤖 Módulo IA flotante */}
{isSuperAdmin && (
  <AIFloatingWidget
    sucursalId={getSucursalActual() || 'sucursal_1'}
    dbKey="db2"
  />
)}


      </div>
    </div>
  );
}

/* ==========================================================================
   OBJETIVOS MODULE v3 (SAFE APPEND, incluye abonos laboratorio y pantalla completa)
   - No toca ninguna función ni bloque existente.
   - Botón flotante 🎯 + panel full-screen friendly.
   - Integra abonos de laboratorio por doctor (con asignación si faltan).
   ========================================================================== */

;(()=>{
  const money = (n)=> (isFinite(n) ? n : 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const inRange = (dateISO, from, to)=>{
    if (!dateISO) return false;
    const d = dateISO.includes('T') ? dateISO.split('T')[0] : dateISO;
    return d >= from && d <= to;
  };
  const getWeekRange = ()=>{
    const now = new Date();
    const day = (now.getDay()+6)%7;
    const start = new Date(now); start.setDate(start.getDate()-day); start.setHours(0,0,0,0);
    const end = new Date(start); end.setDate(end.getDate()+6);
    return { from: start.toISOString().slice(0,10), to: end.toISOString().slice(0,10) };
  };
  const getMonthRange = ()=>{
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth()+1, 0);
    return { from: first.toISOString().slice(0,10), to: last.toISOString().slice(0,10) };
  };

  const OBJ_LS_KEY = 'dentalux_objetivos_v1';
  const LAB_MAP_KEY = 'dentalux_labjob_doctor_map_v1';
  const lsLoad = ()=>{ try{ return JSON.parse(localStorage.getItem(OBJ_LS_KEY)||'[]'); }catch{return [];} };
  const lsSave = (rows)=>{ try{ localStorage.setItem(OBJ_LS_KEY, JSON.stringify(rows)); }catch{} };
  const lsMapLoad = ()=>{ try{ return JSON.parse(localStorage.getItem(LAB_MAP_KEY)||'{}'); }catch{return {};} };
  const lsMapSave = (m)=>{ try{ localStorage.setItem(LAB_MAP_KEY, JSON.stringify(m)); }catch{} };
  const LAB_PAID_KEY = 'dentalux_labjob_paid_v1';
  const paidLoad = () => { try { return JSON.parse(localStorage.getItem(LAB_PAID_KEY) || '{}'); } catch { return {}; } };
  const paidSave = (m: Record<string, boolean>) => { try { localStorage.setItem(LAB_PAID_KEY, JSON.stringify(m)); } catch {} };


// Reemplazar por esta versión
async function objetivosFetch(from, to){
  try{
    const q = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const data = await api(`/objetivos${q}`);
    const arr = Array.isArray(data) ? data : [];
    const mapped = arr.map((r)=> ({
      id: String(r.id ?? r._id ?? `${r.doctorId}-${r.from}-${r.to}`),
      doctorId: String(r.doctorId ?? r.doctor_id ?? r.doctor),
      from: String(r.from),
      to: String(r.to),
      meta: Number(r.meta ?? 0),
      baseSalary: Number(r.baseSalary ?? r.sueldo_base ?? 0),
      abonosNomina: Number(r.abonosNomina ?? r.abonos ?? 0),
      createdAt: String(r.createdAt ?? new Date().toISOString()),
      updatedAt: String(r.updatedAt ?? new Date().toISOString()),
    }));

    // 👇 NUEVO: si backend respondió vacío, usamos lo guardado localmente
    if (mapped.length === 0) {
      return lsLoad().filter(r => r.from === from && r.to === to);
    }
    return mapped;
  }catch(e){
    return lsLoad().filter(r => r.from === from && r.to === to);
  }
}

  async function objetivosUpsert(row){
    try{
      const payload = { doctor_id: Number(row.doctorId), from: row.from, to: row.to, meta: row.meta, sueldo_base: row.baseSalary, abonos: row.abonosNomina };
      const res = row.id?.startsWith?.('ls-')
        ? await api(`/objetivos`, { method:'POST', body: JSON.stringify(payload) })
        : await api(`/objetivos/${row.id}`, { method:'PUT', body: JSON.stringify(payload) });
      return ({
  id: String(res.id ?? row.id),
  doctorId: String(res.doctorId ?? res.doctor_id ?? row.doctorId),
  from: String(res.from ?? row.from),
  to: String(res.to ?? row.to),
  meta: Number(res.meta ?? row.meta),
  baseSalary: Number(res.baseSalary ?? res.sueldo_base ?? row.baseSalary),
  abonosNomina: Number(res.abonosNomina ?? res.abonos ?? row.abonosNomina),
  createdAt: String(res.createdAt ?? row.createdAt ?? new Date().toISOString()),
  updatedAt: String(res.updatedAt ?? new Date().toISOString()),
});

    }catch(e){
      const all = lsLoad();
      let out = row;
      if (row.id && all.find(r=>r.id===row.id)){
        const upd = all.map(r=> r.id===row.id ? { ...row, updatedAt: new Date().toISOString() } : r);
        lsSave(upd);
      }else{
        out = { ...row, id:`ls-${Date.now()}-${Math.random().toString(36).slice(2)}`, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
        lsSave([...all, out]);
      }
      return out;
    }
  }
  async function objetivosDelete(id, from, to){
    try{ await api(`/objetivos/${id}`, { method:'DELETE' }); }
    catch{ lsSave(lsLoad().filter(r => !(r.id===id && r.from===from && r.to===to))); }
  }

  async function fetchDoctorsLight(){
    const rows = await api(`/doctors`);
    return rows.map((d)=> ({ id:String(d.id), name:d.name, color:d.color }));
  }
  async function fetchPaymentsLight(){
    const rows = await api(`/payments`);
    return rows.map((p)=> ({
      id: Number(p.id),
      appointmentId: p.appointment_id ? Number(p.appointment_id) : undefined,
      patient: p.patient,
      serviceId: String(p.service_id),
      amount: Number(p.amount),
      paymentMethod: p.payment_method,
      date: p.date,
      doctorId: String(p.doctor_id),
    }));
  }

 async function fetchLabAbonos(from, to){
  // 1) Traer trabajos de laboratorio (mantiene tus endpoints existentes)
  const jobEndpoints = ['/trabajos-laboratorio','/laboratorio/trabajos','/labjobs'];
  let jobs = [];
  for (const ep of jobEndpoints){
    try{
      const q = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      const res = await api(`${ep}${q}`);
      if (Array.isArray(res)){ jobs = res; break; }
    }catch{}
  }

 // 🔒 Filtro: SOLO trabajos marcados como ENTREGADO en Laboratorio
  jobs = (jobs || []).filter((j) => {
    const etapa = String(j.etapa ?? j.stage ?? j.status ?? j.estado ?? '').trim().toLowerCase();
    return etapa === 'entregado' || etapa === 'entregada' || etapa === 'delivered';
  });

  // 2) Traer pagos de laboratorio y agrupar por trabajo
  const pagoEndpoints = ['/pagos-laboratorio','/laboratorio/pagos','/labpayments'];
  let pagos = [];
  for (const ep of pagoEndpoints){
    try{
      const q = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      const res = await api(`${ep}${q}`);
      if (Array.isArray(res)){ pagos = res; break; }
    }catch{}
  }
  const sumPagosByJob = {};
  pagos.forEach((p)=>{
    const jobId = String(p.trabajo_id ?? p.job_id ?? p.labjob_id ?? p.trabajoId ?? '');
    if (!jobId) return;
    const amt = Number(p.monto ?? p.amount ?? 0);
    sumPagosByJob[jobId] = (sumPagosByJob[jobId] || 0) + (isNaN(amt) ? 0 : amt);
  });

  // 3) Mapa local para doctor asignado (si el backend no lo trae)
  const localMap = lsMapLoad();

  // 4) Construir salida: **UN registro por trabajo** con el **TBE**
  const out = [];
  jobs.forEach((job)=>{
    const jobId = String(job.id ?? job.job_id ?? job._id ?? '');
    if (!jobId) return;

    // Doctor asignado: backend o localStorage
    const doctorId = job.doctor_id != null
      ? String(job.doctor_id)
      : (localMap[jobId] || undefined);

    // Datos de apoyo para la tabla
    // Datos de apoyo para la tabla
const patient  = job.paciente ?? job.patient ?? job.nombre_paciente ?? job.name ?? undefined;

// intentos para resolver el servicio (SIN depender de serviceById)
const serviceIdGuess =
  job.serviceId ?? job.service_id ?? job.servicioId ?? job.servicio_id ?? job?.service?.id;

const svcNameFromFn =
  (typeof serviceById === 'function' && serviceIdGuess)
    ? serviceById(String(serviceIdGuess))?.name
    : undefined;

const service =
  job.servicio ?? job.service ?? job?.service?.name ??   // nombre directo si viene
  svcNameFromFn ??                                       // si existe serviceById, úsalo
  job.tipo ?? job.trabajo ?? job.descripcion ??          // otros campos comunes
  (serviceIdGuess ? String(serviceIdGuess) : undefined); // último recurso: id como texto

const jobTitle = job.titulo ?? job.title ?? undefined;



    // TBE = presupuesto - pagos laboratorio (acumulados)
    const presupuesto = Number(job.presupuesto ?? job.budget ?? 0);
    const pagosAcum   = sumPagosByJob[jobId] || 0;
    const tbe         = Math.max(0, (isNaN(presupuesto)?0:presupuesto) - pagosAcum);

    // Fecha para el filtro del período (tomamos inicio del trabajo)
    const date = String(
      job.fechaInicio ?? job.inicio ?? job.createdAt ?? job.fecha ?? job.date ?? new Date().toISOString()
    );

    // Solo un registro por trabajo (id marcado como -tbe)
    out.push({
      id: `${jobId}-tbe`,
      jobId,
      doctorId,
      amount: tbe,          // <- ESTE es el valor que sumará "Abonos laboratorio"
      date,
      patient,
      service,
      jobTitle,
      isTBE: true
    });
  });

  // Filtrar por período (como ya hacía tu tabla)
  return out.filter(a => inRange(a.date, from, to));
}

  async function assignDoctorForJob(jobId, doctorId){
    try{
      await api(`/trabajos-laboratorio/${jobId}`, { method:'PUT', body: JSON.stringify({ doctor_id: Number(doctorId) }) });
    }catch{
      const m = lsMapLoad(); m[jobId]=doctorId; lsMapSave(m);
    }
  }

  function ObjetivosPanel({ onClose }){
    const week = React.useMemo(()=>getWeekRange(),[]);
    const month = React.useMemo(()=>getMonthRange(),[]);

    const [periodo, setPeriodo] = React.useState('semana');
    const [from, setFrom] = React.useState(week.from);
    const [to, setTo] = React.useState(week.to);
    const [loading, setLoading] = React.useState(true);
    const [err, setErr] = React.useState(null);
    const [mode, setMode] = React.useState('backend');

    // === Tabs ===
    const [activeTab, setActiveTab] = React.useState('objetivos'); // 'objetivos' | 'reportes'
    const [reportSummary, setReportSummary] = React.useState({ rows: [], totals: null });
    const [reportLoading, setReportLoading] = React.useState(false);
    const [reportErr, setReportErr] = React.useState(null);
    const [reportDetailsMap, setReportDetailsMap] = React.useState({}); // doctorId -> { payments, expenses }
    const [selectedReportDoctor, setSelectedReportDoctor] = React.useState(null);


    const [doctors, setDoctors] = React.useState([]);
    const [payments, setPayments] = React.useState([]);
    const [objetivos, setObjetivos] = React.useState([]);
   // EXISTENTE
const [labAbonos, setLabAbonos] = React.useState([]);

// ⬇️ INSERTA ESTO AQUÍ (helpers de "Pagado")
const LAB_PAID_KEY = 'dentalux_labjob_paid_v1';
const paidLoad = () => { try { return JSON.parse(localStorage.getItem(LAB_PAID_KEY) || '{}'); } catch { return {}; } };
const paidSave = (m: Record<string, boolean>) => { try { localStorage.setItem(LAB_PAID_KEY, JSON.stringify(m)); } catch {} };

// EXISTENTE (déjalo tal cual)
const [labPaidMap, setLabPaidMap] = React.useState<Record<string, boolean>>(() => paidLoad());
const toggleLabPaid = React.useCallback((id: string) => {
  setLabPaidMap(prev => {
    const next = { ...prev, [id]: !prev[id] };
    paidSave(next);
    return next;
  });
}, []);



    const [editValues, setEditValues] = React.useState({});
// === Ajustes de doctores para Objetivos (estado + helpers + editor) ===
const DOCTOR_SETTINGS_KEY = 'dentalux_objetivos_doctor_settings_v1';
const DEFAULT_COMISION_PCT = 0.20; // 20%

type DoctorSetting = { visible: boolean; comision: number };
type DoctorSettingsMap = Record<string, DoctorSetting>;

function dsLoad(): DoctorSettingsMap {
  try {
    const raw = localStorage.getItem(DOCTOR_SETTINGS_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    for (const k of Object.keys(obj || {})) {
      const v = obj[k] || {};
      obj[k] = {
        visible: typeof v.visible === 'boolean' ? v.visible : true,
        comision: typeof v.comision === 'number' ? v.comision : DEFAULT_COMISION_PCT,
      };
    }
    return obj || {};
  } catch {
    return {};
  }
}
function dsSave(m: DoctorSettingsMap) {
  try { localStorage.setItem(DOCTOR_SETTINGS_KEY, JSON.stringify(m)); } catch {}
}

const [doctorSettings, setDoctorSettings] = React.useState<DoctorSettingsMap>(dsLoad());

const updateDoctorSetting = React.useCallback((doctorId: string, patch: Partial<DoctorSetting>)=>{
  setDoctorSettings(prev=>{
    const next = {
      ...prev,
      [doctorId]: { visible: true, comision: DEFAULT_COMISION_PCT, ...(prev[doctorId]||{}), ...(patch||{}) }
    };
    dsSave(next);
    return next;
  });
},[]);

// === Mini-componente de edición rápida por doctor ===
function DoctorQuickEdit({ doctor, settings, onChange }:{
  doctor: { id: string; name: string };
  settings?: DoctorSetting;
  onChange: (id: string, patch: Partial<DoctorSetting>) => void;
}){
  const [open, setOpen] = React.useState(false);
  const [pct, setPct] = React.useState(Math.round(((settings?.comision ?? DEFAULT_COMISION_PCT) * 100)));
  const [hide, setHide] = React.useState(!(settings?.visible ?? true));

  React.useEffect(()=>{
    setPct(Math.round(((settings?.comision ?? DEFAULT_COMISION_PCT) * 100)));
    setHide(!(settings?.visible ?? true));
  }, [settings?.comision, settings?.visible]);

  return (
    <div className="relative">
      <button
        onClick={()=>setOpen(o=>!o)}
        className="px-2 py-1 rounded border hover:bg-gray-50 flex items-center gap-1"
        title="Editar comisión u ocultar doctor en esta pantalla"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M12 20h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" strokeWidth="2" fill="none"/>
        </svg>
        Editar
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[240px] rounded-xl border bg-white shadow-xl z-50 p-3">
          <div className="text-sm font-medium mb-2">Editar {doctor.name}</div>

          <label className="text-xs text-gray-600">Comisión (%)</label>
          <input
            className="mt-1 mb-2 w-full px-2 py-1 rounded border"
            type="number" min={0} max={100} step={1}
            value={pct}
            onChange={e=> setPct(Number(e.target.value))}
          />

          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={hide} onChange={e=>setHide(e.target.checked)} />
            Ocultar de esta pantalla
          </label>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              onClick={()=>{ setPct(20); setHide(false); }}
              className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
            >Restaurar</button>
            <button
              onClick={()=>{
                onChange(doctor.id, { comision: (isNaN(pct)?20:pct)/100, visible: !hide });
                setOpen(false);
              }}
              className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 col-span-2"
            >Guardar</button>
          </div>

          <div className="mt-2">
            <button
              onClick={()=>{ onChange(doctor.id, { visible:false }); setOpen(false); }}
              className="text-xs px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50 w-full"
            >Eliminar de esta pantalla</button>
          </div>
        </div>
      )}
    </div>
  );
}

    React.useEffect(()=>{
      const base = {};
      doctors.forEach(d => {
        const cur = objetivos.find(o => o.doctorId===d.id && o.from===from && o.to===to);
        base[d.id] = { meta: cur ? String(cur.meta) : '', base: cur ? String(cur.baseSalary) : '', abonos: cur ? String(cur.abonosNomina) : '' };
      });
      setEditValues(base);
    }, [doctors, objetivos, from, to]);

    React.useEffect(()=>{
      if (periodo==='semana'){ setFrom(week.from); setTo(week.to); }
      if (periodo==='mes'){ setFrom(month.from); setTo(month.to); }
    }, [periodo, week.from, week.to, month.from, month.to]);

    const reloadAll = React.useCallback(async () => {
  setLoading(true);
  setErr(null);
  try {
    // Cargamos doctores, pagos y abonos de laboratorio
    const [docs, pays, lab] = await Promise.all([
      fetchDoctorsLight(),
      fetchPaymentsLight(),
      fetchLabAbonos(from, to),
    ]);
    setDoctors(docs);
    setPayments(pays);
    setLabAbonos(lab);

    // Objetivos: backend si trae filas; si viene vacío, usamos local
    const res = await objetivosFetch(from, to);
    if (Array.isArray(res) && res.length > 0) {
      setObjetivos(res);
      setMode('backend');
    } else {
      const local = lsLoad().filter(r => r.from === from && r.to === to);
      setObjetivos(local);
      setMode('local');
    }
  

    // Reportes (resumen)
    setReportLoading(true);
    setReportErr(null);
    const rep = await reportesFetchSummary(from, to);
    if (rep && Array.isArray(rep.rows)) {
      setReportSummary({ rows: rep.rows || [], totals: rep.totals || null });
    } else {
      setReportSummary({ rows: [], totals: null });
    }
    setReportLoading(false);
} catch (e: any) {
    // Cualquier error (red, 500, etc.) → fallback a local
    setErr(e?.message || 'Error de conexión');
    const local = lsLoad().filter(r => r.from === from && r.to === to);
    setObjetivos(local);
    setMode('local');
  } finally {
    setLoading(false);
  }
}, [from, to]);


// ==============================
// REPORTES (Objetivos)
// ==============================
async function reportesFetchSummary(from, to){
  try{
    const q = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const data = await api(`/objetivos/reportes${q}`);
    return data;
  }catch(e){
    return null;
  }
}

async function reportesFetchDetails(from, to, doctorId){
  try{
    const q = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&doctor_id=${encodeURIComponent(doctorId)}&details=1`;
    const data = await api(`/objetivos/reportes${q}`);
    return data;
  }catch(e){
    return null;
  }
}



    React.useEffect(()=>{ reloadAll(); }, [reloadAll]);

    const ingresosPorDoctor = React.useMemo(()=>{
      const acc = {}; payments.forEach(p => { if (inRange(p.date, from, to)) acc[p.doctorId]=(acc[p.doctorId]||0)+p.amount; });
      return acc;
    }, [payments, from, to]);

    const labAbonosPorDoctor = React.useMemo(() => {
  const acc: Record<string, number> = {};
  labAbonos.forEach(a => {
    if (labPaidMap[a.id]) return;         // ⛔ excluir pagados
    const did = String(a.doctorId || '');
    if (!did) return;
    acc[did] = (acc[did] || 0) + (a.amount || 0);
  });
  return acc;
}, [labAbonos, labPaidMap]);


   const rows = React.useMemo(() => {
 
 // ===== Reemplazo del bloque dentro del useMemo de filas =====
return doctors
  // si un doctor está oculto en esta pantalla, no se muestra
  .filter(d => (doctorSettings?.[d.id]?.visible ?? true))
  .map(d => {
    const cur  = objetivos.find(o => o.doctorId === d.id && o.from === from && o.to === to);
    const meta = cur?.meta ?? 0;
    const base = cur?.baseSalary ?? 0;

    // ingresos del periodo por doctor
    const ingresos = ingresosPorDoctor[d.id] || 0;

    // Suma bruta de TBE/abonos del laboratorio por doctor (igual que antes)
    const abonosLabBruto = labAbonosPorDoctor[d.id] || 0;

    // ✅ Solo tomamos el 20% de TBE para nómina
    const abonosLab = abonosLabBruto * 0.20;

    // ✅ Comisión con % por doctor (fallback 20%)
    const comisionPct = (doctorSettings?.[d.id]?.comision ?? 0.20);
    const comision    = ingresos * comisionPct;

    // Nómina = sueldo base + comisión + 20% de TBE
    const nomina = base + comision + abonosLab;

    const progreso = meta > 0 ? Math.min(100, Math.round((ingresos / meta) * 100)) : 0;

    return { doctor: d, cur, meta, base, abonosLab, ingresos, comision, comisionPct, nomina, progreso };
  });
}, [doctors, objetivos, ingresosPorDoctor, labAbonosPorDoctor, from, to, doctorSettings]);



    const totals = React.useMemo(()=> rows.reduce((a,r)=>{
      a.ingresos+=r.ingresos; a.comision+=r.comision; a.base+=r.base; a.abonos+=r.abonosLab; a.nomina+=r.nomina; return a;
    }, {ingresos:0,comision:0,base:0,abonos:0,nomina:0}), [rows]);

    const saveFor = async (doctorId)=>{
      const v = editValues[doctorId] || {meta:'0',base:'0',abonos:'0'};
      const existing = objetivos.find(o => o.doctorId===doctorId && o.from===from && o.to===to);
      const payload = {
        id: existing?.id || `ls-${Date.now()}`,
        doctorId, from, to,
        meta: Number(v.meta||0),
        baseSalary: Number(v.base||0),
        abonosNomina: Number(v.abonos||0),
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const saved = await objetivosUpsert(payload);
      setObjetivos(prev => {
        const others = prev.filter(o => !(o.doctorId===doctorId && o.from===from && o.to===to));
        return [...others, saved];
      });
    };
    const removeRow = async (row)=>{
      await objetivosDelete(row.id, from, to);
      setObjetivos(prev => prev.filter(o => o.id!==row.id));
    };
    const doctorName = (id)=> doctors.find(d=>d.id===id)?.name || '—';

    return (
      <div className="fixed inset-0 z-[9999] flex items-end md:items-start justify-center">
        <div className="absolute inset-0 bg-black/40" onClick={onClose}/>
        <div className="relative w-full md:w-[1100px] bg-white border rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto">
          <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b">
            <div className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-600 text-white grid place-items-center font-bold">🎯</div>
                <div>
                  <div className="font-semibold text-lg">Módulo de Objetivos</div>
                  <div className="text-xs text-gray-500">Modo: <span className={mode==='backend'?'text-green-600':'text-amber-600'}>{mode==='backend'?'Backend':'LocalStorage'}</span></div>
                </div>
              </div>
              <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100" title="Cerrar">
                <svg viewBox="0 0 24 24" className="w-5 h-5"><path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              </button>
            </div>
            <div className="px-4 pb-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-x-2">
                  <button className={"px-3 py-1.5 rounded-lg border " + (periodo==='semana'?'bg-blue-600 text-white border-blue-600':'bg-white hover:bg-gray-50')} onClick={()=>setPeriodo('semana')}>Semana actual</button>
                  <button className={"px-3 py-1.5 rounded-lg border " + (periodo==='mes'?'bg-blue-600 text-white border-blue-600':'bg-white hover:bg-gray-50')} onClick={()=>setPeriodo('mes')}>Mes actual</button>
                  <button className={"px-3 py-1.5 rounded-lg border " + (periodo==='custom'?'bg-blue-600 text-white border-blue-600':'bg-white hover:bg-gray-50')} onClick={()=>setPeriodo('custom')}>Personalizado</button>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-600">De</label>
                  <input type="date" className="px-2 py-1.5 rounded-lg border" value={from} onChange={e=>setFrom(e.target.value)}/>
                  <label className="text-sm text-gray-600">a</label>
                  <input type="date" className="px-2 py-1.5 rounded-lg border" value={to} onChange={e=>setTo(e.target.value)}/>
                </div>
                <button onClick={reloadAll} className="ml-auto px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700">Actualizar</button>
              </div>
              {err && <div className="mt-2 text-sm text-red-600">⚠️ {err}</div>}
            </div>
          </div>

          {/* Tabs */}
          <div className="px-4 pt-3">
            <div className="inline-flex rounded-xl border bg-white overflow-hidden">
              <button
                className={"px-4 py-2 text-sm " + (activeTab==='objetivos' ? "bg-blue-600 text-white" : "hover:bg-gray-50")}
                onClick={()=>setActiveTab('objetivos')}
              >
                Objetivos
              </button>
              <button
                className={"px-4 py-2 text-sm border-l " + (activeTab==='reportes' ? "bg-blue-600 text-white" : "hover:bg-gray-50")}
                onClick={()=>{
                  setActiveTab('reportes');
                  // Si aún no hay datos, intentamos cargar
                  if (!reportSummary?.rows?.length && !reportLoading) {
                    setReportLoading(true);
                    reportesFetchSummary(from, to).then(rep=>{
                      if (rep && Array.isArray(rep.rows)) setReportSummary({ rows: rep.rows||[], totals: rep.totals||null });
                    }).catch(()=>{}).finally(()=>setReportLoading(false));
                  }
                }}
              >
                Reportes
              </button>
            </div>
          </div>

          {activeTab==='objetivos' && (
            <>
          <div className="p-4 grid md:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl border bg-gray-50">
              <div className="text-xs text-gray-500">Ingresos periodo</div>
              <div className="text-2xl font-semibold text-green-600">${money(totals.ingresos)}</div>
            </div>
            <div className="p-3 rounded-xl border bg-gray-50">
              <div className="text-xs text-gray-500">Comisiones (20%)</div>
              <div className="text-2xl font-semibold text-blue-600">${money(totals.comision)}</div>
            </div>
            <div className="p-3 rounded-xl border bg-gray-50">
              <div className="text-xs text-gray-500">Sueldos base</div>
              <div className="text-2xl font-semibold text-gray-800">${money(totals.base)}</div>
            </div>
            <div className="p-3 rounded-xl border bg-gray-50">
              <div className="text-xs text-gray-500">Nómina total</div>
              <div className="text-2xl font-semibold text-purple-600">${money(totals.nomina)}</div>
            </div>
          </div>

          <div className="px-4 pb-4 overflow-x-auto">
            <table className="min-w-[860px] w-full text-sm">
              <thead>
                <tr className="text-left border-y bg-gray-50">
                  <th className="p-2">Doctor</th>
                  <th className="p-2">Meta ($)</th>
                  <th className="p-2">Ingresos</th>
                  <th className="p-2">Comisión 20%</th>
                  <th className="p-2">Sueldo base</th>
                  <th className="p-2">Abonos laboratorio</th>
                  <th className="p-2">Nómina total</th>
                  <th className="p-2">Progreso</th>
               <th className="p-2">Acciones</th>
</tr>
</thead>
<tbody>
  {rows.map(r => {
    const ev = editValues[r.doctor.id] || { meta:'', base:'', abonos:'' };
    return (
      <tr key={r.doctor.id} className="border-b">
        <td className="p-2">
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ background: r.doctor.color || '#3b82f6' }}
            />
            <div className="font-medium capitalize">{r.doctor.name}</div>
          </div>
        </td>

        <td className="p-2">
          <input
            value={ev.meta}
            onChange={e =>
              setEditValues(v => ({
                ...v,
                [r.doctor.id]: { ...v[r.doctor.id], meta: e.target.value }
              }))
            }
            type="number"
            className="w-28 px-2 py-1 rounded border"
          />
        </td>

        <td className="p-2 font-semibold text-green-700">
          ${money(r.ingresos)}
        </td>

        <td className="p-2">
          <div className="font-semibold text-blue-700">
            ${money(r.comision)}
          </div>
          <div className="text-[10px] text-gray-500">
            {Math.round((r.comisionPct ?? DEFAULT_COMISION_PCT) * 100)}%
          </div>
        </td>

        <td className="p-2">
          <input
            value={ev.base}
            onChange={e =>
              setEditValues(v => ({
                ...v,
                [r.doctor.id]: { ...v[r.doctor.id], base: e.target.value }
              }))
            }
            type="number"
            className="w-28 px-2 py-1 rounded border"
          />
        </td>

        <td className="p-2 font-semibold text-fuchsia-700">
          ${money(r.abonosLab)}
        </td>

        <td className="p-2 font-semibold text-purple-700">
          ${money(r.nomina)}
        </td>

        <td className="p-2">
          <div className="w-40 h-3 rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-3"
              style={{ width: `${r.progreso}%`, background: r.doctor.color || '#3b82f6' }}
            />
          </div>
          <div className="text-xs text-gray-500 mt-1">{r.progreso}%</div>
        </td>

        {/* === Acciones (reemplazado) === */}
        <td className="p-2">
          <div className="relative flex items-center gap-2">
            <DoctorQuickEdit
              doctor={r.doctor}
              settings={doctorSettings[r.doctor.id]}
              onChange={updateDoctorSetting}
            />
            <button
              onClick={() => saveFor(r.doctor.id)}
              className="px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
            >
              Guardar
            </button>
            {r.cur && (
              <button
                onClick={() => removeRow(r.cur)}
                className="px-2 py-1 rounded border hover:bg-gray-50"
              >
                Borrar
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  })}
</tbody>

            </table>
          </div>

          <div className="p-4 border-t space-y-3">
            <div className="text-sm font-semibold">Abonos laboratorio (TBE)</div>
            <div className="overflow-x-auto">
              <table className="min-w-[860px] w-full text-xs">
                <thead>
                  <tr className="text-left border-y bg-gray-50">
                    <th className="p-2">Fecha</th>
                    <th className="p-2">Paciente</th>
                    <th className="p-2">Servicio</th>
                    <th className="p-2">Trabajo</th>
                    <th className="p-2">Doctor</th>
                    <th className="p-2">Monto</th>
                    <th className="p-2">Acciones</th>
                    <th className="p-2 text-center">Pagado</th>
                  </tr>
                </thead>
                <tbody>
  {labAbonos.length === 0 && (
    <tr>
      <td colSpan={8} className="p-4 text-center text-gray-500">Sin abonos en el período.</td>
    </tr>
  )}

  {labAbonos.map(a => {
    // Estado "pagado" guardado en localStorage (sin estados extra)
    const paidMap = (() => {
      try { return JSON.parse(localStorage.getItem('dentalux_labjob_paid_v1') || '{}'); }
      catch { return {}; }
    })();
    const isPaid = !!paidMap[a.id];

    const onTogglePaid = () => {
      try {
        const next = { ...paidMap, [a.id]: !isPaid };
        localStorage.setItem('dentalux_labjob_paid_v1', JSON.stringify(next));
      } catch {}
      // Forzar re-render sin cambiar datos (para que se vea el check/sombreado)
      setLabAbonos(prev => [...prev]);
    };

    return (
      <tr key={a.id} className={`border-b ${isPaid ? 'bg-amber-50 opacity-70' : ''}`}>
        <td className="p-2 whitespace-nowrap">{a.date?.split('T')[0] || '—'}</td>
        <td className="p-2">{a.patient || '—'}</td>
        <td className="p-2">{a.service || '—'}</td>
        <td className="p-2">{a.jobTitle || a.jobId}</td>
        <td className="p-2">
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: (doctors.find(d => d.id === a.doctorId)?.color) || '#9ca3af' }}
            />
            <span>{doctorName(a.doctorId)}</span>
          </div>
        </td>
        <td className="p-2 font-medium">${money(a.amount || 0)}</td>
        <td className="p-2">
          <select
            className="px-2 py-1 rounded border"
            value={a.doctorId || ''}
            onChange={async (e) => {
              const did = e.target.value;
              await assignDoctorForJob(a.jobId, did);
              setLabAbonos(prev =>
                prev.map(x => x.jobId === a.jobId ? { ...x, doctorId: did } : x)
              );
            }}
          >
            <option value="">— Asignar doctor —</option>
            {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </td>

        {/* NUEVO: Pagado */}
        <td className="p-2 text-center">
          <input type="checkbox" checked={isPaid} onChange={onTogglePaid} />
        </td>
      </tr>
    );
  })}
</tbody>

              </table>
            </div>
          </div>

          <div className="p-4 border-t">
            <div className="text-sm font-semibold mb-2">Progreso por doctor</div>
            <div className="grid md:grid-cols-2 gap-2">
              {rows.map(r => (
                <div key={'mini-'+r.doctor.id} className="flex items-center gap-3">
                  <div className="w-24 text-xs truncate">{r.doctor.name}</div>
                  <div className="flex-1 h-2 rounded bg-gray-200 overflow-hidden">
                    <div className="h-2" style={{width:`${r.progreso}%`, background:r.doctor.color||'#3b82f6'}}/>
                  </div>
                  <div className="w-10 text-xs text-right">{r.progreso}%</div>
                </div>
              ))}
            </div>
          </div>

            </>
          )}

          {activeTab==='reportes' && (
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-lg">Reportes</div>
                  <div className="text-xs text-gray-500">Transacciones por doctor (efectivo / tarjeta) + gastos + utilidad neta</div>
                </div>
                <button
                  className="px-3 py-1.5 rounded-lg border hover:bg-gray-50"
                  onClick={async()=>{
                    setReportLoading(true);
                    setReportErr(null);
                    try{
                      const rep = await reportesFetchSummary(from, to);
                      if (rep && Array.isArray(rep.rows)) setReportSummary({ rows: rep.rows||[], totals: rep.totals||null });
                    }catch(e:any){
                      setReportErr(e?.message || 'Error al cargar reportes');
                    }finally{
                      setReportLoading(false);
                    }
                  }}
                >
                  Actualizar reportes
                </button>
              </div>

              {reportErr && <div className="text-sm text-red-600">⚠️ {reportErr}</div>}
              {reportLoading && <div className="text-sm text-gray-600">Cargando reportes…</div>}

              <div className="grid md:grid-cols-5 gap-3">
                <div className="p-3 rounded-xl border bg-gray-50">
                  <div className="text-xs text-gray-500">Ingresos efectivo</div>
                  <div className="text-xl font-semibold text-green-700">${money(reportSummary?.totals?.income_cash || 0)}</div>
                </div>
                <div className="p-3 rounded-xl border bg-gray-50">
                  <div className="text-xs text-gray-500">Ingresos tarjeta</div>
                  <div className="text-xl font-semibold text-green-700">${money(reportSummary?.totals?.income_card || 0)}</div>
                </div>
                <div className="p-3 rounded-xl border bg-gray-50">
                  <div className="text-xs text-gray-500">Ingresos total</div>
                  <div className="text-xl font-semibold text-green-700">${money(reportSummary?.totals?.income_total || 0)}</div>
                </div>
                <div className="p-3 rounded-xl border bg-gray-50">
                  <div className="text-xs text-gray-500">Gastos</div>
                  <div className="text-xl font-semibold text-red-600">${money(reportSummary?.totals?.expense_total || 0)}</div>
                </div>
                <div className="p-3 rounded-xl border bg-gray-50">
                  <div className="text-xs text-gray-500">Utilidad neta</div>
                  <div className="text-xl font-semibold text-blue-700">${money(reportSummary?.totals?.net || 0)}</div>
                </div>
              </div>

              <div className="overflow-x-auto border rounded-xl">
                <table className="min-w-[980px] w-full text-sm">
                  <thead>
                    <tr className="text-left border-b bg-gray-50">
                      <th className="p-2">Doctor</th>
                      <th className="p-2">Efectivo</th>
                      <th className="p-2">Tarjeta</th>
                      <th className="p-2">Ingresos</th>
                      <th className="p-2">Gastos</th>
                      <th className="p-2">Utilidad neta</th>
                      <th className="p-2">Detalles</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(reportSummary?.rows || []).map((r:any)=>(
                      <tr key={String(r.doctor_id)} className="border-b last:border-b-0">
                        <td className="p-2 font-medium">{r.doctor_name || r.name || ('Doctor #' + r.doctor_id)}</td>
                        <td className="p-2">${money(r.income_cash || 0)}</td>
                        <td className="p-2">${money(r.income_card || 0)}</td>
                        <td className="p-2 font-semibold">${money(r.income_total || 0)}</td>
                        <td className="p-2 text-red-600">${money(r.expense_total || 0)}</td>
                        <td className="p-2 font-semibold text-blue-700">${money(r.net || 0)}</td>
                        <td className="p-2">
                          <button
                            className="px-2 py-1 rounded border hover:bg-gray-50 text-xs"
                            onClick={async()=>{
                              const doctorId = String(r.doctor_id);
                              setSelectedReportDoctor(doctorId === selectedReportDoctor ? null : doctorId);
                              if (doctorId !== selectedReportDoctor && !reportDetailsMap?.[doctorId]) {
                                setReportLoading(true);
                                setReportErr(null);
                                try{
                                  const det = await reportesFetchDetails(from, to, doctorId);
                                  if (det) {
                                    setReportDetailsMap((prev:any)=>({
                                      ...prev,
                                      [doctorId]: { payments: det.payments || [], expenses: det.expenses || [] }
                                    }));
                                  }
                                }catch(e:any){
                                  setReportErr(e?.message || 'Error al cargar detalles');
                                }finally{
                                  setReportLoading(false);
                                }
                              }
                            }}
                          >
                            {String(r.doctor_id) === String(selectedReportDoctor) ? 'Ocultar' : 'Ver'}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {(reportSummary?.rows || []).length === 0 && (
                      <tr><td className="p-3 text-gray-500" colSpan={7}>Sin movimientos en este periodo.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {selectedReportDoctor && (
                <div className="border rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">Detalles doctor #{selectedReportDoctor}</div>
                    <button className="px-2 py-1 rounded border hover:bg-gray-50 text-xs" onClick={()=>setSelectedReportDoctor(null)}>Cerrar</button>
                  </div>

                  <div className="mt-3 grid md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-sm font-medium mb-2">Ingresos (payments)</div>
                      <div className="overflow-auto max-h-[260px] border rounded-lg">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-gray-50 border-b">
                              <th className="p-2 text-left">Fecha</th>
                              <th className="p-2 text-left">Paciente</th>
                              <th className="p-2 text-left">Método</th>
                              <th className="p-2 text-right">Monto</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(reportDetailsMap?.[selectedReportDoctor]?.payments || []).map((p:any)=>(
                              <tr key={String(p.id)} className="border-b last:border-b-0">
                                <td className="p-2">{String(p.date||'').slice(0,10)}</td>
                                <td className="p-2">{p.patient || '—'}</td>
                                <td className="p-2">{p.payment_method || '—'}</td>
                                <td className="p-2 text-right">${money(p.amount || 0)}</td>
                              </tr>
                            ))}
                            {(reportDetailsMap?.[selectedReportDoctor]?.payments || []).length === 0 && (
                              <tr><td className="p-2 text-gray-500" colSpan={4}>Sin pagos.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div>
                      <div className="text-sm font-medium mb-2">Gastos (expenses)</div>
                      <div className="overflow-auto max-h-[260px] border rounded-lg">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-gray-50 border-b">
                              <th className="p-2 text-left">Fecha</th>
                              <th className="p-2 text-left">Concepto</th>
                              <th className="p-2 text-left">Método</th>
                              <th className="p-2 text-right">Monto</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(reportDetailsMap?.[selectedReportDoctor]?.expenses || []).map((e:any)=>(
                              <tr key={String(e.id)} className="border-b last:border-b-0">
                                <td className="p-2">{String(e.date||'').slice(0,10)}</td>
                                <td className="p-2">{e.concept || '—'}</td>
                                <td className="p-2">{e.payment_method || '—'}</td>
                                <td className="p-2 text-right">${money(e.amount || 0)}</td>
                              </tr>
                            ))}
                            {(reportDetailsMap?.[selectedReportDoctor]?.expenses || []).length === 0 && (
                              <tr><td className="p-2 text-gray-500" colSpan={4}>Sin gastos.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    );
  }

function DoctorQuickEdit({ doctor, settings, onChange }:{
  doctor: { id: string; name: string };
  settings?: DoctorSetting;
  onChange: (id: string, patch: Partial<DoctorSetting>) => void;
}){
  const [open, setOpen] = React.useState(false);
  const [pct, setPct] = React.useState(Math.round(((settings?.comision ?? DEFAULT_COMISION_PCT) * 100)));
  const [hide, setHide] = React.useState(!(settings?.visible ?? true));
  const [doctorSettings, setDoctorSettings] = React.useState<DoctorSettingsMap>(dsLoad());
  const updateDoctorSetting = React.useCallback((doctorId: string, patch: Partial<DoctorSetting>)=>{
  setDoctorSettings(prev=>{
    const next = { ...prev, [doctorId]: { visible: true, comision: DEFAULT_COMISION_PCT, ...(prev[doctorId]||{}), ...(patch||{}) } };
    dsSave(next);
    return next;
  });
},[]);  

  React.useEffect(()=>{
    setPct(Math.round(((settings?.comision ?? DEFAULT_COMISION_PCT)*100)));
    setHide(!(settings?.visible ?? true));
  }, [settings?.comision, settings?.visible]);

  return (
    <div className="relative">
      <button
        onClick={()=>setOpen(o=>!o)}
        className="px-2 py-1 rounded border hover:bg-gray-50 flex items-center gap-1"
        title="Editar comisión u ocultar doctor en este módulo"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M12 20h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" strokeWidth="2" fill="none"/>
        </svg>
        Editar
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[240px] rounded-xl border bg-white shadow-xl z-50 p-3">
          <div className="text-sm font-medium mb-2">Editar {doctor.name}</div>
          <label className="text-xs text-gray-600">Comisión (%)</label>
          <input
            className="mt-1 mb-2 w-full px-2 py-1 rounded border"
            type="number" min={0} max={100} step={1}
            value={pct}
            onChange={e=> setPct(Number(e.target.value))}
          />
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={hide} onChange={e=>setHide(e.target.checked)} />
            Ocultar de esta pantalla
          </label>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              onClick={()=>{ setPct(20); setHide(false); }}
              className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
            >Restaurar</button>
            <button
              onClick={()=>{
                onChange(doctor.id, { comision: (isNaN(pct)?20:pct)/100, visible: !hide });
                setOpen(false);
              }}
              className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 col-span-2"
            >Guardar</button>
          </div>

          <div className="mt-2">
            <button
              onClick={()=>{ onChange(doctor.id, { visible:false }); setOpen(false); }}
              className="text-xs px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50 w-full"
            >Eliminar de esta pantalla</button>
          </div>
        </div>
      )}
    </div>
  );
}

  function ObjetivosButtonAndPanel(){
    const [open, setOpen] = React.useState(false);
    if (typeof document === 'undefined') return null;
    return (
      <>
        <button
          onClick={()=>setOpen(true)}
          title="Módulo de Objetivos"
          className="fixed z-[9998] bottom-5 right-5 md:bottom-6 md:right-6 rounded-full shadow-2xl px-4 py-3 bg-blue-600 text-white font-semibold hover:bg-blue-700 active:scale-[0.98] transition"
        >
          🎯 Objetivos
        </button>
        {open && <ObjetivosPanel onClose={()=>setOpen(false)} />}
      </>
    );
  }

  if (typeof document !== 'undefined'){
    const ROOT_ID = 'objetivos-floating-root-v3';
    let mounting = false;

    const syncObjetivosForSession = () => {
      const legacy = document.getElementById('objetivos-floating-root');
      if (legacy?.parentElement) legacy.parentElement.removeChild(legacy);

      const existing = document.getElementById(ROOT_ID);
      if (!isSuperAdminSession()) {
        if (existing?.parentElement) existing.parentElement.removeChild(existing);
        return;
      }

      if (existing || mounting) return;
      mounting = true;
      const el = document.createElement('div');
      el.id = ROOT_ID;
      document.body.appendChild(el);

      import('react-dom/client').then((m)=>{
        const root = m.createRoot(el);
        root.render(React.createElement(ObjetivosButtonAndPanel, {}));
      }).catch(()=>{
        const btn = document.createElement('button');
        btn.textContent = '🎯 Objetivos';
        Object.assign(btn.style,{position:'fixed',bottom:'16px',right:'16px',zIndex:'9998',padding:'10px 14px',borderRadius:'9999px',color:'#fff',background:'#2563eb',boxShadow:'0 10px 20px rgba(0,0,0,0.2)'});
        btn.onclick = ()=> alert('No se pudo cargar ReactDOM para el módulo de Objetivos.');
        el.appendChild(btn);
      }).finally(()=>{ mounting = false; });
    };

    syncObjetivosForSession();
    window.addEventListener('storage', syncObjetivosForSession);
    window.setInterval(syncObjetivosForSession, 1200);
  }
})()

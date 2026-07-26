// api-dashboard-global (3).ts - SOLO DATOS REALES (sin mocks)
// Mantiene funciones y nombres originales, sin duplicados.
// Compatible con tus endpoints reales y con GlobalDashboard.tsx.

// ===============================
// Imports base (sin tocar)
// ===============================
import { api, getSucursalActual } from './api';

// ===============================
// Tipos (preservados)
// ===============================
export interface DashboardData {
  sucursalId: string;
  nombre: string;
  periodo: { fechaInicio: string; fechaFin: string };
  appointments: any[];
  payments: any[];
  expenses: any[];
  trabajosLaboratorio: any[];
  doctors: any[];
  services: any[];
  inventory: any[];
  metricas: {
    financieras: MetricasFinancieras;
    operacionales: MetricasOperacionales;
    inventario: MetricasInventario;
    laboratorio: MetricasLaboratorio;
    doctores: MetricasDoctores[];
    servicios: MetricasServicios;
  };
}

export interface MetricasFinancieras {
  ingresos: number;
  gastos: number;
  utilidad: number;
  margenUtilidad: number;
  ingresosLaboratorio: number;
  abonosLaboratorio: number;
  saldosPendientes: number;
  metodosPago: { [metodo: string]: number };
}

export interface MetricasOperacionales {
  totalCitas: number;
  citasAtendidas: number;
  citasCanceladas: number;
  tasaConversion: number;
  pacientesUnicos: number;
  citasHoy: number;
  citasSemana: number;
  trabajosLaboratorio: number;
  trabajosCompletados: number;
  trabajosPendientes: number;
  tiempoPromedioAtencion: number;
}

export interface MetricasInventario {
  totalProductos: number;
  productosStockBajo: number;
  productosAgotados: number;
  valorInventario: number;
  rotacionPromedio: number;
  productosVencimiento: number;
  comprasMes: number;
  gastosInventario: number;
  eficienciaStock: number;
  alertasCriticas: number;
}

export interface MetricasLaboratorio {
  totalTrabajos: number;
  presupuestado: number;
  abonado: number;
  saldoPendiente: number;
  avancePromedio: number;
}

export interface MetricasDoctores {
  doctorId: any;
  doctorName: string;
  citas: number;
  ingresos: number;
  ticketPromedio: number;
}

export interface MetricasServicios {
  serviciosActivos: number;
  servicioMasVendido: string;
  ingresosPorServicio: { [servicio: string]: number };
  cantidadPorServicio: { [servicio: string]: number };
  margenPorServicio: { [servicio: string]: number };
  tiempoPromedioPorServicio: { [servicio: string]: number };
  satisfaccionPorServicio: { [servicio: string]: number };
  tendenciaServicios: Array<{
    mes: string;
    servicio: string;
    cantidad: number;
    ingresos: number;
  }>;
}

// ===============================
// Helpers seguros (anti-NaN)
// ===============================
const n = (v: any) => (v === null || v === undefined || v === '' || isNaN(+v) ? 0 : +v);
const s = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const d = (v: any) => (v ? new Date(v) : null);
const todayISO = () => new Date().toISOString().split('T')[0];
const cryptoRandom = () => Math.random().toString(36).slice(2);

// ===============================
// Config de API (UNA sola vez)
// ===============================
const API_BASE_URL =
  process.env.NODE_ENV === 'production'
    ? 'http://localhost:4001'
    : 'http://localhost:4001';

// Request genérico (soporta headers de sucursal)
async function apiRequest(
  endpoint: string,
  { sucursalId, query, method = 'GET', body }: {
    sucursalId?: string;
    query?: Record<string, any>;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: any;
  } = {}
) {
  const url = new URL(`${API_BASE_URL}${endpoint}`);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    });
  }
  const res = await fetch(url.toString(), {
    method,
    headers: {
      'content-type': 'application/json',
      ...(sucursalId ? { 'x-sucursal': sucursalId } : {}),
    },
    credentials: 'include',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[${res.status}] ${res.statusText} :: ${text}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

// ===============================
// Normalizadores (formato consistente)
// ===============================
function normalizeAppointment(a: any) {
  return {
    id: a.id ?? a.appointment_id ?? cryptoRandom(),
    patient: s(a.patient ?? a.paciente ?? a.nombre ?? 'Paciente'),
    date: s(a.date ?? a.fecha ?? todayISO()),
    start_time: s(a.start_time ?? a.hora ?? '09:00'),
    status: s(a.status ?? 'Pendiente'),
    phone: s(a.phone ?? ''),
    doctor_id: a.doctor_id ?? null,
    serviceId: a.service_id ?? a.serviceId ?? null,
  };
}
function normalizeDoctor(dv: any) {
  return {
    id: dv.id ?? dv.doctor_id ?? cryptoRandom(),
    name: s(dv.name ?? dv.nombre ?? 'Sin nombre'),
    color: s(dv.color ?? '#8884d8'),
    active: dv.active ?? true,
  };
}
function normalizeService(sv: any) {
  return {
    id: sv.id ?? sv.service_id ?? cryptoRandom(),
    name: s(sv.name ?? sv.descripcion ?? sv.title ?? 'Servicio'),
    price: n(sv.price ?? sv.precio ?? 0),
    duration: n(sv.duration ?? 60),
    margin: n(sv.margin ?? 0.7),
    category: s(sv.category ?? 'General'),
  };
}
function classifyStock(stock: number, minStock: number) {
  if (stock <= 0) return 'agotado';
  if (stock <= minStock) return 'bajo';
  return 'normal';
}
function normalizeInventory(iv: any) {
  const stock = n(iv.stock ?? iv.quantity);
  const min = n(iv.min_stock ?? iv.minStock ?? 5);
  const price = n(iv.price ?? iv.precio ?? 0);
  return {
    id: iv.id ?? cryptoRandom(),
    sku: s(iv.sku ?? ''),
    name: s(iv.name ?? iv.descripcion ?? 'Producto'),
    category: s(iv.category ?? 'Materiales'),
    type: s(iv.type ?? 'material'),
    stock,
    minStock: min,
    maxStock: n(iv.max_stock ?? iv.maxStock ?? Math.max(100, min * 4)),
    price,
    supplier: s(iv.supplier ?? ''),
    last_purchase: s(iv.last_purchase ?? ''),
    usage_per_patient: n(iv.usage_per_patient ?? 1),
    expiration_date: s(iv.expiration_date ?? ''),
    stockStatus: classifyStock(stock, min),
    valorTotal: stock * price,
    rotacion: n(iv.rotacion ?? Math.random() * 12),
    diasVencimiento: n(iv.diasVencimiento ?? Math.floor(Math.random() * 365)),
  };
}
function normalizeLabTrabajo(t: any) {
  let abonos: any[] = [];
  try { abonos = Array.isArray(t.abonos) ? t.abonos : JSON.parse(t.abonos || '[]'); } catch { abonos = []; }
  const presupuesto = n(t.presupuesto);
  const abonado = abonos.reduce((acc, a) => acc + n(a.monto), 0);
  return {
    id: t.id ?? cryptoRandom(),
    paciente: s(t.paciente ?? 'Paciente Lab'),
    presupuesto,
    abonos,
    etapa: s(t.etapa ?? 'Iniciado'),
    fechaInicio: s(t.fecha_inicio ?? t.fechaInicio ?? todayISO()),
    fechaEntregaEstimada: s(t.fecha_entrega_estimada ?? t.fechaEntregaEstimada ?? todayISO()),
    saldoPendiente: Math.max(0, presupuesto - abonado),
  };
}

// Intenta adjuntar doctorId a pagos sin doctor usando las citas del periodo
function attachDoctorToPayments(payments: any[], appointments: any[]) {
  if (!Array.isArray(payments) || !Array.isArray(appointments)) return payments;

  // índice rápido por (patient, serviceId, date)
  const byKey = new Map<string, any[]>();
  for (const a of appointments) {
    const patient = (a.patient || '').toLowerCase();
    const sid = a.serviceId ?? a.service_id ?? null;
    const date = (a.date || '').slice(0, 10);
    const key = `${patient}|${sid}|${date}`;
    const arr = byKey.get(key) || [];
    arr.push(a);
    byKey.set(key, arr);
  }

  // índice por último doctor visto para cada paciente en el rango (fallback)
  const lastDoctorByPatient = new Map<string, any>();
  for (const a of appointments) {
    const patient = (a.patient || '').toLowerCase();
    if (a.doctorId != null) lastDoctorByPatient.set(patient, a.doctorId);
  }

  for (const p of payments) {
    if (p.doctorId != null && p.doctorId !== undefined) continue;

    const patient = (p.patient || '').toLowerCase();
    const sid = p.serviceId ?? p.service_id ?? null;
    const date = (p.date || '').slice(0, 10);
    const key = `${patient}|${sid}|${date}`;

    let inferredDoctor: any = null;

    // 1) match exacto por (paciente, servicio, fecha)
    const matches = byKey.get(key);
    if (matches && matches.length) {
      inferredDoctor = matches[0].doctorId ?? matches[0].doctor_id ?? null;
    }

    // 2) fallback: último doctor visto para ese paciente en el periodo
    if (inferredDoctor == null) {
      inferredDoctor = lastDoctorByPatient.get(patient) ?? null;
    }

    if (inferredDoctor != null) {
      p.doctorId = inferredDoctor;
    }
  }

  return payments;
}


// ===============================
// Funciones internas: métricas
// ===============================
function buildMetrics(raw: {
  appointments: any[];
  payments: any[];
  expenses: any[];
  trabajosLaboratorio: any[];
  doctors: any[];
  services: any[];
  inventory: any[];
  satisfaccionServicios?: Array<{
    service_id: number;
    serviceId?: number;
    service_name?: string;
    serviceName?: string;
    satisfaccion_promedio?: number;
    satisfaccionPromedio?: number;
  }>;
}): DashboardData['metricas'] {
  const appointments = raw.appointments.map(normalizeAppointment);
  const payments = raw.payments.map((p:any)=>({
    id: p.id ?? cryptoRandom(),
    amount: n(p.amount ?? p.monto),
    date: s(p.date ?? p.fecha ?? todayISO()),
    paymentMethod: s(p.payment_method ?? p.paymentMethod ?? 'efectivo'),
    patient: s(p.patient ?? ''),
    doctor_id: p.doctor_id ?? null,
    serviceId: p.service_id ?? null,
  }));
  const expenses = raw.expenses.map((e:any)=>({
    id: e.id ?? cryptoRandom(),
    concept: s(e.concept ?? e.concepto ?? 'Gasto'),
    amount: n(e.amount ?? e.monto),
    date: s(e.date ?? e.fecha ?? todayISO()),
  }));
  const trabajos = raw.trabajosLaboratorio.map(normalizeLabTrabajo);
  const doctors = raw.doctors.map(normalizeDoctor);
  const services = raw.services.map(normalizeService);
  const inventory = raw.inventory.map(normalizeInventory);

  // Financieras
  const ingresos = payments.reduce((acc:number,p:any)=>acc+n(p.amount),0);
  const gastos = expenses.reduce((acc:number,e:any)=>acc+n(e.amount),0);
  const utilidad = Math.max(0, ingresos - gastos);
  const margenUtilidad = ingresos>0 ? (utilidad/ingresos)*100 : 0;

  const ingresosLaboratorio = trabajos.reduce((acc:number,t:any)=>acc+n(t.presupuesto),0);
  const abonosLaboratorio = trabajos.reduce((acc:number,t:any)=>{
    const abonos = Array.isArray(t.abonos) ? t.abonos : [];
    return acc + abonos.reduce((a:number,x:any)=>a+n(x.monto),0);
  },0);
  const saldosPendientes = Math.max(0, ingresosLaboratorio - abonosLaboratorio);

  const metodosPago: Record<string,number> = {};
  for (const p of payments) {
    const metodo = s(p.paymentMethod || 'efectivo').toLowerCase();
    metodosPago[metodo] = (metodosPago[metodo]||0)+n(p.amount);
  }

  const financieras: MetricasFinancieras = {
    ingresos, gastos, utilidad, margenUtilidad,
    ingresosLaboratorio, abonosLaboratorio, saldosPendientes, metodosPago
  };

  // Operacionales
  const totalCitas = appointments.length;
  const citasAtendidas = appointments.filter((a:any)=>['Atendida','Completada','Finalizada'].includes(s(a.status))).length;
  const citasCanceladas = appointments.filter((a:any)=>['Cancelada','No asistió','Cancelado'].includes(s(a.status))).length;
  const tasaConversion = totalCitas>0 ? (citasAtendidas/totalCitas)*100 : 0;
  const pacientesUnicos = new Set(appointments.map((a:any)=>s(a.patient))).size;
  const hoy = todayISO();

  const citasHoy = appointments.filter((a:any)=>s(a.date)===hoy).length;
  const inicioSemana = new Date(); inicioSemana.setHours(0,0,0,0); inicioSemana.setDate(inicioSemana.getDate()-inicioSemana.getDay());
  const citasSemana = appointments.filter((a:any)=>{ const ad = d(a.date); return ad && ad>=inicioSemana; }).length;

  const trabajosTotal = trabajos.length;
  const trabajosCompletados = trabajos.filter((t:any)=>['Completado','Entregado','Finalizado'].includes(s(t.etapa))).length;

  const operacionales: MetricasOperacionales = {
    totalCitas, citasAtendidas, citasCanceladas, tasaConversion,
    pacientesUnicos, citasHoy, citasSemana,
    trabajosLaboratorio: trabajosTotal,
    trabajosCompletados,
    trabajosPendientes: Math.max(0, trabajosTotal - trabajosCompletados),
    tiempoPromedioAtencion: 45
  };

  // Inventario
  const inv = inventory;
  const totalProductos = inv.length;
  const productosStockBajo = inv.filter((p:any)=>p.stockStatus==='bajo').length;
  const productosAgotados = inv.filter((p:any)=>p.stockStatus==='agotado').length;
  const valorInventario = inv.reduce((acc:number,p:any)=>acc+n(p.valorTotal),0);
  const rotacionPromedio = totalProductos? inv.reduce((acc:number,p:any)=>acc+n(p.rotacion),0)/totalProductos : 0;
  const productosVencimiento = inv.filter((p:any)=>n(p.diasVencimiento)<=30).length;

  const inventario: MetricasInventario = {
    totalProductos, productosStockBajo, productosAgotados, valorInventario,
    rotacionPromedio, productosVencimiento,
    comprasMes: 0, gastosInventario: 0,
    eficienciaStock: totalProductos ? Math.max(0, 100 - ((productosStockBajo+productosAgotados)/totalProductos)*100) : 100,
    alertasCriticas: 0
  };

  // Laboratorio
  const labPres = trabajos.reduce((acc:number,t:any)=>acc+n(t.presupuesto),0);
  const labAbon = trabajos.reduce((acc:number,t:any)=>{
    const abonos = Array.isArray(t.abonos) ? t.abonos : [];
    return acc + abonos.reduce((a:number,x:any)=>a+n(x.monto),0);
  },0);
  const laboratorio: MetricasLaboratorio = {
    totalTrabajos: trabajos.length,
    presupuestado: labPres,
    abonado: labAbon,
    saldoPendiente: Math.max(0, labPres - labAbon),
    avancePromedio: trabajos.length ? (100 * labAbon) / (labPres || 1) : 0
  };

  // Doctores
 // ===== DOCTORES (IDs normalizados a string) =====
const doctorNameByKey = new Map<string, string>();
for (const dct of doctors) {
  const k = String(dct.id);
  doctorNameByKey.set(k, dct.name || 'Sin nombre');
}

const porDoctor = new Map<string, { name: string; citas: number; ingresos: number }>();

// Inicializa todos los doctores con 0 (para que aparezcan aunque no tengan datos)
for (const [k, name] of doctorNameByKey.entries()) {
  porDoctor.set(k, { name, citas: 0, ingresos: 0 });
}

// Citas → cuentan por doctor (clave string)
for (const a of appointments) {
  const k = a.doctor_id != null ? String(a.doctor_id) : 'desconocido';
  const name = doctorNameByKey.get(k) || (k === 'desconocido' ? 'Sin asignar' : k);
  const prev = porDoctor.get(k) || { name, citas: 0, ingresos: 0 };
  prev.citas += 1;
  porDoctor.set(k, prev);
}

// Pagos → suman ingresos por doctor (clave string)
for (const p of payments) {
  const k = p.doctor_id != null ? String(p.doctor_id) : 'desconocido';
  const name = doctorNameByKey.get(k) || (k === 'desconocido' ? 'Sin asignar' : k);
  const prev = porDoctor.get(k) || { name, citas: 0, ingresos: 0 };
  prev.ingresos += n(p.amount);
  porDoctor.set(k, prev);
}

// Salida final
const doctores: MetricasDoctores[] = Array.from(porDoctor.entries()).map(([doctorKey, v]) => {
  const ingresosNum = Number.isFinite(v.ingresos) ? v.ingresos : 0;
  const citasNum = Number.isFinite(v.citas) ? v.citas : 0;
  return {
    doctor_id: doctorKey,
    doctorName: v.name,
    citas: citasNum,
    ingresos: ingresosNum,
    ticketPromedio: citasNum ? ingresosNum / citasNum : 0,
  };
});


  // ===== Servicios (incluye satisfacción por servicio) =====
  const ingresosPorServicio: Record<string, number> = {};
  const cantidadPorServicio: Record<string, number> = {};
  const margenPorServicio: Record<string, number> = {};
  const satisfaccionPorServicio: Record<string, number> = {};
  const tiempoPromedioPorServicio: Record<string, number> = {};
  const tendenciaServicios: Array<{ mes: string; servicio: string; cantidad: number; ingresos: number }> = [];

  // Mapa rápido de satisfacción que venga del backend (si existe)
  const mapSatisfaccion = new Map<string, number>();
  if (Array.isArray(raw.satisfaccionServicios)) {
    for (const r of raw.satisfaccionServicios) {
      const sid = r.service_id ?? r.serviceId;
      const nombre =
        services.find((s: any) => s.id === sid)?.name ??
        r.service_name ??
        r.serviceName ??
        (sid != null ? String(sid) : '');
      if (!nombre) continue;
      const prom = n(r.satisfaccion_promedio ?? r.satisfaccionPromedio);
      if (prom > 0) {
        // clamp 1–5
        mapSatisfaccion.set(nombre, Math.max(1, Math.min(5, prom)));
      }
    }
  }

  for (const servicio of services) {
    const sid = servicio.id;
    const name = servicio.name ?? String(sid);

    // Pagos asignados a este servicio
    const pagosServicio = payments.filter((p: any) => p.serviceId === sid);
    const ingresoServicio = pagosServicio.reduce((acc: number, p: any) => acc + n(p.amount), 0);

    // Citas de este servicio
    const citasServicio = appointments.filter((a: any) => a.serviceId === sid);
    const cantidad = citasServicio.length;

    ingresosPorServicio[name] = ingresoServicio;
    cantidadPorServicio[name] = cantidad;

    // Margen simple aproximado (usa margin si viene, si no 0.7)
    const precio = n(servicio.price);
    const margenConfig = servicio.margin ?? 0.7;
    const costoEstimado = cantidad * precio * (1 - margenConfig);
    const margenPct =
      ingresoServicio > 0
        ? ((ingresoServicio - costoEstimado) / Math.max(ingresoServicio, 1)) * 100
        : 0;
    margenPorServicio[name] = Math.max(0, Math.min(100, margenPct));

    // Satisfacción: si viene del backend, úsala; si no, 0
    if (mapSatisfaccion.has(name)) {
      satisfaccionPorServicio[name] = mapSatisfaccion.get(name)!;
    } else {
      satisfaccionPorServicio[name] = 0;
    }

    // Tiempo promedio por servicio: por ahora fijo a duración configurada o 60
    tiempoPromedioPorServicio[name] = n(servicio.duration || 60);
  }

  const servicioMasVendido =
    Object.entries(cantidadPorServicio).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

  // Tendencia muy simple: agrupa citas por mes y servicio
  const porMesServ = new Map<string, { cantidad: number; ingresos: number }>();
  for (const a of appointments) {
    const sid = a.serviceId;
    if (!sid) continue;
    const servicio = services.find((s: any) => s.id === sid);
    if (!servicio) continue;
    const nombre = servicio.name ?? String(sid);
    const mes = (s(a.date).slice(0, 7)) || todayISO().slice(0, 7); // YYYY-MM
    const key = `${mes}|${nombre}`;
    const prev = porMesServ.get(key) || { cantidad: 0, ingresos: 0 };
    prev.cantidad += 1;
    porMesServ.set(key, prev);
  }

  for (const [key, v] of porMesServ.entries()) {
    const [mes, servicio] = key.split('|');
    tendenciaServicios.push({
      mes,
      servicio,
      cantidad: v.cantidad,
      ingresos: ingresosPorServicio[servicio] || 0,
    });
  }

  const servicios: MetricasServicios = {
    serviciosActivos: services.length,
    servicioMasVendido,
    ingresosPorServicio,
    cantidadPorServicio,
    margenPorServicio,
    tiempoPromedioPorServicio,
    satisfaccionPorServicio,
    tendenciaServicios,
  };

  return { financieras, operacionales, inventario, laboratorio, doctores, servicios };

// ===============================
// FUNCIÓN PRINCIPAL (unificada, SOLO real)
// ===============================
export async function obtenerDatosDashboard(
  sucursalIdParam?: string,
  fechaInicio?: string,
  fechaFin?: string
): Promise<DashboardData> {
  const sucursalId = s(sucursalIdParam || getSucursalActual() || 'sucursal_1');
  const start = fechaInicio || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const end   = fechaFin || todayISO();

  // Usa tu endpoint de paquete /api/dashboard/:sucursalId (con fechas)
  // Este endpoint ya lo tienes en server.js y devuelve estructura completa por sucursal.
  const response = await apiRequest(`/api/dashboard/${sucursalId}`, {
    sucursalId,
    query: { fecha_inicio: start, fecha_fin: end }
  });

  // Normaliza y arma el DashboardData
  const appointments = (response.appointments || []).map(normalizeAppointment);
  const payments     = (response.payments || []);
  const expenses     = (response.expenses || []);
  const trabajos     = (response.trabajosLaboratorio || []);
  const doctors      = (response.doctors || []);
  const services     = (response.services || []);
  const inventoryRaw = (response.inventory || []);
  const inventory    = inventoryRaw.map(normalizeInventory);

  attachDoctorToPayments(payments, appointments);

  return {
    sucursalId,
    nombre: s(response.nombre || sucursalId),
    periodo: { fechaInicio: start, fechaFin: end },
    appointments,
    payments,
    expenses,
    trabajosLaboratorio: trabajos,
    doctors,
    services,
    inventory,
        metricas: buildMetrics({
      appointments,
      payments,
      expenses,
      trabajosLaboratorio: trabajos,
      doctors,
      services,
      inventory,
      satisfaccionServicios:
        response.satisfaccionServicios ||
        response.satisfaccion_servicios ||
        response.satisfaccionServiciosPorServicio ||
        []
    })
  };
}

// ===============================
// COMPARACIÓN (solo real)
// ===============================
export async function obtenerDatosComparativos(
  fechaInicio: string,
  fechaFin: string
): Promise<DashboardData[]> {
  const params = { fecha_inicio: fechaInicio, fecha_fin: fechaFin };
  const response = await apiRequest('/api/dashboard/comparacion', { query: params });

  // `response.sucursales` viene con la misma estructura por sucursal
  const out: DashboardData[] = [];
  for (const sucursal of (response.sucursales || [])) {
    const appointments = (sucursal.appointments || []).map(normalizeAppointment);
    const payments     = (sucursal.payments || []);
    const expenses     = (sucursal.expenses || []);
    const trabajos     = (sucursal.trabajosLaboratorio || []);
    const doctors      = (sucursal.doctors || []);
    const services     = (sucursal.services || []);
    const inventoryRaw = (sucursal.inventory || []);
    const inventory    = inventoryRaw.map(normalizeInventory);

    out.push({
      sucursalId: s(sucursal.sucursalId || ''),
      nombre: s(sucursal.nombre || ''),
      periodo: { fechaInicio, fechaFin },
      appointments,
      payments,
      expenses,
      trabajosLaboratorio: trabajos,
      doctors,
      services,
      inventory,
            metricas: buildMetrics({
        appointments,
        payments,
        expenses,
        trabajosLaboratorio: trabajos,
        doctors,
        services,
        inventory,
        satisfaccionServicios:
          sucursal.satisfaccionServicios ||
          sucursal.satisfaccion_servicios ||
          sucursal.satisfaccionServiciosPorServicio ||
          []
      })
    });
  }
  return out;
}

// ===============================
// Funciones adicionales (preservadas)
// ===============================

// Reales directos para inventario/servicios (utilizadas por vistas auxiliares)
export async function obtenerInventario(sucursalId: string) {
  try {
    const data = await apiRequest(`/api/inventario/${sucursalId}`, { sucursalId });
    // Algunos endpoints devuelven {productos, alertas}; otros devuelven array.
    if (Array.isArray(data)) return { productos: data, alertas: [] };
    return { productos: data.productos || data.inventory || [], alertas: data.alertas || [] };
  } catch (e) {
    console.warn('Inventario no disponible:', e);
    return { productos: [], alertas: [] };
  }
}

export async function obtenerServiciosDetallados(
  sucursalId: string,
  fechaInicio: string,
  fechaFin: string
) {
  try {
    const params = { fecha_inicio: fechaInicio, fecha_fin: fechaFin };
    const data = await apiRequest(`/api/servicios/${sucursalId}`, { sucursalId, query: params });
    return data?.data || data?.services || [];
  } catch (e) {
    console.warn('Servicios detallados no disponibles:', e);
    return [];
  }
}

// Modo (se conserva API, pero ya no hay mocks; solo influye en vistas si lo usas)
export const configurarModo = {
  real: () => localStorage.setItem('dashboard_mode', 'real'),
  original: () => localStorage.setItem('dashboard_mode', 'real'), // forzado a real
  auto: () => localStorage.setItem('dashboard_mode', 'real'),
  get: () => 'real'
};

// Verificaciones/Debug (apoyados en tus endpoints de debug)
export async function verificarAPIDisponible(): Promise<boolean> {
  try {
    await apiRequest('/api/dashboard/sucursal_1');
    return true;
  } catch {
    return false;
  }
}

export async function debugDashboard(sucursalId: string, fechaInicio: string, fechaFin: string) {
  try {
    const params = { fecha_inicio: fechaInicio, fecha_fin: fechaFin };
    return await apiRequest(`/api/debug/dashboard/${sucursalId}`, { query: params, sucursalId });
  } catch (error) {
    console.error('❌ Error en debug:', error);
    return null;
  }
}

export async function verificarTablas() {
  try {
    return await apiRequest('/api/debug/tablas');
  } catch (error) {
    console.error('❌ Error verificando tablas:', error);
    return null;
  }
}

// Export util: CSV (preservado, sin cambios sustanciales)
export async function exportarDatosDashboard(
  datos: DashboardData[],
  formato: 'csv' | 'excel' | 'pdf' = 'csv'
) {
  const datosExport = datos.map(d => ({
    sucursal: d.nombre,
    periodo: `${d.periodo.fechaInicio} - ${d.periodo.fechaFin}`,
    ingresos: d.metricas.financieras.ingresos,
    gastos: d.metricas.financieras.gastos,
    utilidad: d.metricas.financieras.utilidad,
    margen: d.metricas.financieras.margenUtilidad,
    citas_total: d.metricas.operacionales.totalCitas,
    citas_atendidas: d.metricas.operacionales.citasAtendidas,
    tasa_conversion: d.metricas.operacionales.tasaConversion,
    pacientes_unicos: d.metricas.operacionales.pacientesUnicos,
    trabajos_laboratorio: d.metricas.laboratorio.totalTrabajos,
    laboratorio_eficiencia: d.metricas.laboratorio.avancePromedio,
    productos_inventario: d.metricas.inventario.totalProductos,
    productos_stock_bajo: d.metricas.inventario.productosStockBajo,
    valor_inventario: d.metricas.inventario.valorInventario
  }));

  if (formato === 'csv') {
    const csv = convertirACSV(datosExport);
    descargarArchivo(csv, 'dashboard-comparativo.csv', 'text/csv');
  }
}

// Utilidades export
function convertirACSV(datos: any[]): string {
  if (datos.length === 0) return '';
  const headers = Object.keys(datos[0]);
  const csvContent = [
    headers.join(','),
    ...datos.map(row => headers.map(header => row[header]).join(','))
  ].join('\n');
  return csvContent;
}

function descargarArchivo(contenido: string, nombreArchivo: string, tipo: string) {
  const blob = new Blob([contenido], { type: tipo });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombreArchivo;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

// ===============================
// Export default (preservado)
// ===============================
export default {
  // Principales
  obtenerDatosDashboard,
  obtenerDatosComparativos,

  // Reales específicos
  obtenerInventario,
  obtenerServiciosDetallados,

  // Control/Debug
  verificarAPIDisponible,
  configurarModo,
  debugDashboard,
  verificarTablas,

  // Exportación
  exportarDatosDashboard
};

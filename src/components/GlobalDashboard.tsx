import React, { useState, useEffect, useMemo, useRef } from 'react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import {
  Calendar, DollarSign, BarChart3, Filter, RefreshCw, Users,
  TrendingUp, TrendingDown, TestTube, Package, AlertTriangle,
  CheckCircle, Clock, Target, Zap, Building2, Stethoscope,
  CreditCard, PieChart, Activity, Award, Star,
  Layers, Box, ShoppingCart, Truck, Percent, Eye,
  Settings, Shield, Globe, Wifi, Database, BarChart4,
  ArrowUpCircle, ArrowDownCircle, MinusCircle, Plus,
  Download // ⬅️ vuelve a agregar este
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, PieChart as RechartsPieChart, Pie, Cell, Legend, LineChart, Line,
  AreaChart, Area, ComposedChart, ReferenceLine, RadialBarChart, RadialBar,
  ScatterChart, Scatter, FunnelChart, Funnel, LabelList, TreeMap
} from 'recharts';


// Types
interface SucursalData {
  id: string;
  nombre: string;
  appointments: any[];
  payments: any[];
  expenses: any[];
  trabajosLaboratorio: any[];
  doctors: any[];
  services: any[];
  inventory: any[];
  productosInventario: any[];
  ventasServicios: any[];
  alertasInventario: any[];
  configuracion: {
    metaIngresos: number;
    metaCitas: number;
    metaConversion: number;
    metaInventario: number;
  };
}

interface MetricaFinanciera {
  ingresos: number;
  gastos: number;
  utilidad: number;
  margenUtilidad: number;
  ingresosLaboratorio: number;
  abonosLaboratorio: number;
  saldosPendientes: number;
}

interface MetricaOperacional {
  totalCitas: number;
  citasAtendidas: number;
  citasCanceladas: number;
  tasaConversion: number;
  trabajosLaboratorio: number;
  trabajosCompletados: number;
  trabajosPendientes: number;
  pacientesUnicos: number;
  citasHoy: number;
  citasSemana: number;
  tiempoPromedioAtencion: number;
}

interface MetricaInventario {
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

interface MetricaServicios {
  serviciosActivos: number;
  servicioMasVendido: string;
  ingresosPorServicio: {[servicio: string]: number};
  cantidadPorServicio: {[servicio: string]: number};
  margenPorServicio: {[servicio: string]: number};
  tiempoPromedioPorServicio: {[servicio: string]: number};
  satisfaccionPorServicio: {[servicio: string]: number};
  tendenciaServicios: Array<{mes: string, servicio: string, cantidad: number, ingresos: number}>;
}

interface MetricaAvanzada {
  nps: number; // Net Promoter Score
  ltv: number; // Lifetime Value
  cac: number; // Customer Acquisition Cost
  churnRate: number;
  conversionFunnel: Array<{etapa: string, cantidad: number, porcentaje: number}>;
  kpisPrincipales: Array<{nombre: string, valor: number, meta: number, tendencia: 'up' | 'down' | 'stable'}>;
}

const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#a4de6c', '#ff8042'];
const GRADIENT_COLORS = {
  primary: ['#667eea', '#764ba2'],
  success: ['#11998e', '#38ef7d'],
  warning: ['#f093fb', '#f5576c'],
  info: ['#4facfe', '#00f2fe'],
  danger: ['#fc466b', '#3f5efb'],
  purple: ['#a855f7', '#ec4899'],
  orange: ['#f97316', '#fb923c'],
  emerald: ['#10b981', '#34d399']
};

const CHART_COLORS = {
  sucursal1: '#3b82f6',
  sucursal2: '#10b981',
  accent1: '#f59e0b',
  accent2: '#ef4444',
  accent3: '#8b5cf6',
  accent4: '#06b6d4',
  neutral: '#6b7280',
  background: '#f8fafc'
};


// === Helper LOCAL: obtener datos reales del dashboard desde el backend ===
const API_BASE_URL =
  import.meta.env.PROD
    ? 'https://http://localhost:4001'
    : 'https://http://localhost:4001.';

async function obtenerDatosDashboard(
  sucursalId: string,
  fechaInicio: string,
  fechaFin: string
) {
  const params = new URLSearchParams();
  if (fechaInicio) params.set('fecha_inicio', fechaInicio);
  if (fechaFin) params.set('fecha_fin', fechaFin);

  const url = `${API_BASE_URL}/api/dashboard/${sucursalId}?${params.toString()}`;

  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Error al obtener dashboard (${res.status}): ${text}`);
  }

  return res.json();
}

const GlobalDashboard: React.FC = () => {
  const [sucursalesData, setSucursalesData] = useState<SucursalData[]>([]);
  const [fechaInicio, setFechaInicio] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
  );
  const [fechaFin, setFechaFin] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);
  const [vistaActiva, setVistaActiva] = useState<'resumen' | 'financiero' | 'operacional' | 'laboratorio' | 'doctores' | 'inventario' | 'servicios' | 'avanzado'>('resumen');
  const [metaIngresos, setMetaIngresos] = useState(50000);
  const [sucursalSeleccionada, setSucursalSeleccionada] = useState<string>('todas');
  const exportRef = useRef<HTMLDivElement>(null);
  const [exportando, setExportando] = useState(false);
  const [progresoExport, setProgresoExport] = useState(0);
   // Estados para filtros
  const [showFiltroServicios, setShowFiltroServicios] = useState(false);
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [filtroMargenMin, setFiltroMargenMin] = useState('');
  const [filtroIngresosMin, setFiltroIngresosMin] = useState('');
  // --- Helpers para clasificar servicios por especialidad ---

  // Normaliza cadenas: minúsculas, sin acentos, sin espacios extra
  const normalizar = (v?: string) =>
    (v ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // quita acentos y diacríticos
      .trim();

  // Palabras clave por macro-categoría
  const ESPECIALIDADES_KEYWORDS: Record<string, string[]> = {
    'Ortodoncia': [
      'ortodoncia',
      'brackets',
      'frenillos',
      'alineador',
      'alineadores'
    ],
    'Endodoncia': [
      'endodoncia',
      'endodoncias',
      'endo',
      'conducto',
      'conductos'
    ],
    'Odontopediatría': [
      'pediatr',
      'infantil',
      'niño',
      'niña'
    ],
    'Cirugías': [
      'cirugia',
      'quirurg',
      'extraccion',
      'exodoncia',
      'cordal'
    ],
    'Implantología': [
      'implante',
      'implantes',
      'implantologia'
    ],
    'Periodoncia': [
      'periodoncia',
      'periodontal',
      'encia',
      'encias'
    ],
    'Prótesis': [
      'protesis',
      'corona',
      'puente',
      'placa',
      'parcial',
      'total'
    ],
    'Estética': [
      'estetica',
      'blanqueamiento',
      'carilla',
      'carillas',
      'resina estetica'
    ],
  };

  // Clasifica cada servicio en una macro-categoría
  const clasificarServicio = (servicio: any): string => {
    const nombre = normalizar(servicio.name);
    const categoriaRaw = normalizar(
      (servicio as any).category ?? (servicio as any).categoria ?? ''
    );
    const texto = `${nombre} ${categoriaRaw}`.trim();

    // 1) Sin información
    if (!texto) return 'Sin categoría';

    // 2) Buscar por keywords en nombre + categoría
    for (const [macro, keywords] of Object.entries(ESPECIALIDADES_KEYWORDS)) {
      if (keywords.some((k) => texto.includes(k))) {
        return macro;
      }
    }

    // 3) Si la categoría ya viene "parecida"
    if (categoriaRaw.includes('ortodon')) return 'Ortodoncia';
    if (categoriaRaw.includes('endodon')) return 'Endodoncia';
    if (categoriaRaw.includes('pediatr')) return 'Odontopediatría';
    if (categoriaRaw.includes('cirug')) return 'Cirugías';
    if (categoriaRaw.includes('implant')) return 'Implantología';
    if (categoriaRaw.includes('periodon')) return 'Periodoncia';
    if (categoriaRaw.includes('protes')) return 'Prótesis';
    if (categoriaRaw.includes('estetic')) return 'Estética';

    // 4) Todo lo demás a Odontología General
    return 'Odontología General';
  };
  
 // Categorías visibles en el filtro (siempre presentes)
const ORDEN_CATEGORIAS = [
  'Odontología General',
  'Ortodoncia',
  'Endodoncia',
  'Odontopediatría',
  'Cirugías',
  'Implantología',
  'Periodoncia',
  'Prótesis',
  'Estética',
  'Sin categoría',
];

// Categorías detectadas dinámicamente según servicios
const categoriasDisponibles = useMemo(() => {
  const detectadas = new Set<string>();

  sucursalesData.forEach(s => {
    (s.services ?? []).forEach(sv => {
      detectadas.add(clasificarServicio(sv));
    });
  });

  const union = ORDEN_CATEGORIAS.slice();
  detectadas.forEach(cat => {
    if (!union.includes(cat)) union.push(cat);
  });

  return union;
}, [sucursalesData]);



// --- Utils para exportación PDF ---
const wait = (ms: number) => new Promise(res => setTimeout(res, ms));

const ensureStableCharts = () => {
  // Fija alturas en tiempo de captura para que ResponsiveContainer no colapse
  const charts = document.querySelectorAll('.chart-container, .recharts-wrapper');
  charts.forEach((el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const h = Math.max(300, Math.ceil(rect.height));
    el.style.minHeight = h + 'px';
    el.style.maxHeight = h + 'px';
    el.style.height = h + 'px';
  });
};

const releaseCharts = () => {
  // Restituye alturas al estado normal después de exportar
  const charts = document.querySelectorAll('.chart-container, .recharts-wrapper');
  charts.forEach((el: HTMLElement) => {
    el.style.minHeight = '';
    el.style.maxHeight = '';
    el.style.height = '';
  });
};

const waitForRechartsLayout = async () => {
  // Da tiempo a que ResponsiveContainer calcule width/height
  await wait(100); // micro task cycle
  window.dispatchEvent(new Event('resize'));
  await wait(600);
};

  
  // Simulación de datos (en implementación real, estos vendrían de tu API)
  useEffect(() => {
    cargarDatosSucursales();
  }, [fechaInicio, fechaFin]);

  const cargarDatosSucursales = async () => {
    setLoading(true);
    try {
      // Aquí irían las llamadas reales a tu API para cada sucursal
      const sucursal1Data = await cargarDatosSucursal('sucursal_1');
      const sucursal2Data = await cargarDatosSucursal('sucursal_2');
      
      setSucursalesData([sucursal1Data, sucursal2Data]);
    } catch (error) {
      console.error('Error cargando datos:', error);
    } finally {
      setLoading(false);
    }
  };

 const cargarDatosSucursal = async (sucursalId: string): Promise<SucursalData> => {
  // Declarar fuera del try para poder usarlo en el catch
  let datosReales: any = null;

  try {
    // NUEVA VERSIÓN: Usar datos reales con fallback a mock
    console.log(`🔄 Cargando datos para ${sucursalId}...`);

    // Intentar obtener datos reales primero
    datosReales = await obtenerDatosDashboard(sucursalId, fechaInicio, fechaFin);

    console.log(`✅ Datos reales obtenidos para ${sucursalId}`, datosReales);

    // Convertir la estructura de datos reales a la estructura esperada por el componente
    return {
      id: datosReales.sucursalId ?? sucursalId,
      nombre: datosReales.nombre ?? (sucursalId === 'sucursal_1' ? 'Sucursal Centro' : 'Sucursal Norte'),

      appointments: datosReales.appointments ?? [],
      payments: datosReales.payments ?? [],
      expenses: datosReales.expenses ?? [],
      trabajosLaboratorio: datosReales.trabajosLaboratorio ?? [],

      doctors: datosReales.doctors ?? [],
      services: datosReales.services ?? [],

      inventory: datosReales.inventory ?? [],
      productosInventario: datosReales.productosInventario ?? datosReales.inventory ?? [],

      ventasServicios: convertirServiciosAVentas(
        datosReales.services ?? [],
        datosReales.appointments ?? []
      ),

      alertasInventario: await obtenerAlertasInventario(sucursalId),

      metricas: datosReales.metricas, // si no viene, el cálculo local en los módulos hará fallback

      configuracion: {
        metaIngresos: sucursalId === 'sucursal_1' ? 60000 : 45000,
        metaCitas: sucursalId === 'sucursal_1' ? 300 : 250,
        metaConversion: 85,
        metaInventario: 95,
      },
    };

  } catch (error) {
    console.warn(`⚠️ Error obteniendo datos reales para ${sucursalId}, usando fallback:`, error);
    // Logs defensivos (datosReales puede ser null/undefined)
    console.log('🔍 DEBUG - Datos reales appointments:', datosReales?.appointments?.slice(0, 2));
    console.log('🔍 DEBUG - Datos reales payments:', datosReales?.payments?.slice(0, 2));
    console.log('🔍 DEBUG - Datos reales doctors:', datosReales?.doctors?.slice(0, 2));

    // FALLBACK: Si falla, usar datos simulados (y aprovechar lo que sí haya llegado)
    const apptsFallback = datosReales?.appointments ?? generateMockAppointments(sucursalId);
    const servicesFallback = datosReales?.services ?? generateMockServices();

    return {
      id: sucursalId,
      nombre: sucursalId === 'sucursal_1' ? 'Sucursal Centro' : 'Sucursal Norte',

      appointments: apptsFallback,
      payments: datosReales?.payments ?? generateMockPayments(sucursalId),
      expenses: datosReales?.expenses ?? generateMockExpenses(sucursalId),
      trabajosLaboratorio: datosReales?.trabajosLaboratorio ?? generateMockLaboratorio(sucursalId),

      doctors: datosReales?.doctors ?? generateMockDoctors(sucursalId),
      services: servicesFallback,

      inventory: datosReales?.inventory ?? generateMockInventory(sucursalId),
      productosInventario: datosReales?.inventory ?? generateMockInventory(sucursalId),

      // usa lo que haya (reales o mock) para construir ventasServicios
      ventasServicios: convertirServiciosAVentas(servicesFallback, apptsFallback),

      alertasInventario: generateMockAlertas(sucursalId),

      configuracion: {
        metaIngresos: sucursalId === 'sucursal_1' ? 60000 : 45000,
        metaCitas: sucursalId === 'sucursal_1' ? 300 : 250,
        metaConversion: 85,
        metaInventario: 95,
      },
    };
  }
};


// para convertir servicios a ventas
const convertirServiciosAVentas = (services: any[], appointments: any[]) => {
  if (!services || !appointments) return [];
  
  return services.map(service => {
    const citasDelServicio = appointments.filter(
      (apt) => (apt.serviceId ?? apt.service_id) === service.id
    );
    const cantidadVendida = citasDelServicio.length;
    
    return {
      serviceId: service.id,
      serviceName: service.name,
      cantidadVendida,
      ingresoTotal: cantidadVendida * (service.price || 0),
      precioPromedio: service.price || 0,
      tendenciaMes: Math.random() > 0.5 ? 'up' : 'down',
      // 👇 Por ahora NO generamos satisfacción simulada
      satisfaccionPromedio: 0
    };
  });
};

// Función auxiliar para obtener alertas de inventario
const obtenerAlertasInventario = async (sucursalId: string) => {
  try {
    const API_BASE_URL = process.env.NODE_ENV === 'production' 
      ? 'http://localhost:4001'
      : 'http://localhost:4001';
      
    const response = await fetch(`${API_BASE_URL}/api/inventario/${sucursalId}`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    return data.alertas || [];
    
  } catch (error) {
    console.warn('Error obteniendo alertas de inventario:', error);
    return [];
  }
};

  // Funciones de generación de datos mock (basadas en tu estructura real)
  const generateMockAppointments = (sucursalId: string) => {
    const appointments = [];
    const statuses = ['Atendida', 'Pendiente', 'Cancelada', 'Confirmada'];
    const startDate = new Date(fechaInicio);
    const endDate = new Date(fechaFin);
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dailyAppointments = Math.floor(Math.random() * 15) + 5;
      for (let i = 0; i < dailyAppointments; i++) {
        appointments.push({
          id: Math.random().toString(36),
          patient: `Paciente ${i + 1}`,
          date: d.toISOString().split('T')[0],
          status: statuses[Math.floor(Math.random() * statuses.length)],
          doctor_id: `doctor_${Math.floor(Math.random() * 3) + 1}`,
          service_id: `service_${Math.floor(Math.random() * 5) + 1}`,
          phone: '555-0123'
        });
      }
    }
    return appointments;
  };

  const generateMockPayments = (sucursalId: string) => {
    const payments = [];
    const methods = ['efectivo', 'tarjeta_debito', 'tarjeta_credito', 'transferencia'];
    const startDate = new Date(fechaInicio);
    const endDate = new Date(fechaFin);
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dailyPayments = Math.floor(Math.random() * 10) + 3;
      for (let i = 0; i < dailyPayments; i++) {
        payments.push({
          id: Math.random().toString(36),
          amount: Math.floor(Math.random() * 5000) + 500,
          date: d.toISOString().split('T')[0],
          paymentMethod: methods[Math.floor(Math.random() * methods.length)],
          patient: `Paciente ${i + 1}`,
         doctor_id: `doctor_${Math.floor(Math.random() * 3) + 1}`,    
         service_id: `service_${Math.floor(Math.random() * 5) + 1}`,  // ← Agregar coma
        });
      }
    }
    return payments;
  };

  const generateMockExpenses = (sucursalId: string) => {
    const expenses = [];
    const concepts = ['Materiales', 'Servicios', 'Laboratorio', 'Equipos', 'Otros'];
    const startDate = new Date(fechaInicio);
    const endDate = new Date(fechaFin);
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 7)) {
      const weeklyExpenses = Math.floor(Math.random() * 5) + 2;
      for (let i = 0; i < weeklyExpenses; i++) {
        expenses.push({
          id: Math.random().toString(36),
          concept: concepts[Math.floor(Math.random() * concepts.length)],
          amount: Math.floor(Math.random() * 3000) + 200,
          date: d.toISOString().split('T')[0]
        });
      }
    }
    return expenses;
  };

  const generateMockLaboratorio = (sucursalId: string) => {
    const trabajos = [];
    const etapas = ['Iniciado', 'En progreso', 'Completado', 'Entregado'];
    
    for (let i = 0; i < 20; i++) {
      const presupuesto = Math.floor(Math.random() * 8000) + 2000;
      const abonos = [];
      let totalAbonado = 0;
      
      // Generar abonos
      const numAbonos = Math.floor(Math.random() * 3) + 1;
      for (let j = 0; j < numAbonos; j++) {
        const monto = Math.floor(presupuesto * 0.3 * Math.random()) + 200;
        totalAbonado += monto;
        abonos.push({
          id: Math.random().toString(36),
          monto,
          fecha: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        });
      }
      
      trabajos.push({
        id: Math.random().toString(36),
        paciente: `Paciente Lab ${i + 1}`,
        presupuesto,
        abonos,
        etapa: etapas[Math.floor(Math.random() * etapas.length)],
        fechaInicio: new Date(Date.now() - Math.random() * 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        fechaEntregaEstimada: new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        saldoPendiente: presupuesto - totalAbonado
      });
    }
    return trabajos;
  };

  const generateMockDoctors = (sucursalId: string) => [
  { id: 12, name: 'Paoly', color: '#8884d8' },
  { id: 13, name: 'Angela', color: '#82ca9d' },
  { id: 9, name: 'Yara Caballero', color: '#ffc658' },
  { id: 20, name: 'Dra. Perla Osuna', color: '#ff7300' },
  { id: 14, name: 'Atenea', color: '#a4de6c' },
  { id: 10, name: 'Yaneth Caballero Ruelas', color: '#ff8042' }
];

 const generateMockVentasServicios = (sucursalId: string) => {
  const services = generateMockServices();
  return services.map(service => ({
    serviceId: service.id,
    serviceName: service.name,
    cantidadVendida: Math.floor(Math.random() * 50) + 10,
    ingresoTotal: (Math.floor(Math.random() * 50) + 10) * service.price,
    promedioPorVenta: service.price + (Math.random() * 500 - 250),
    tendenciaMes: Math.random() > 0.5 ? 'up' : 'down',
    satisfaccionPromedio: 0 // 👈 sin satisfacción simulada
  }));
};


  const generateMockAlertas = (sucursalId: string) => {
    const tipos = ['stock_bajo', 'vencimiento', 'mantenimiento', 'calidad'];
    const alertas = [];
    
    for (let i = 0; i < Math.floor(Math.random() * 8) + 2; i++) {
      alertas.push({
        id: Math.random().toString(36),
        tipo: tipos[Math.floor(Math.random() * tipos.length)],
        titulo: `Alerta ${i + 1}`,
        descripcion: `Descripción de la alerta ${i + 1}`,
        prioridad: ['alta', 'media', 'baja'][Math.floor(Math.random() * 3)],
        fecha: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        resuelta: Math.random() > 0.3
      });
    }
    
    return alertas;
  };

  const generateMockServices = () => [
    { id: 'service_1', name: 'Limpieza Dental', price: 800, duration: 60, category: 'Preventivo', margin: 0.7 },
    { id: 'service_2', name: 'Extracción Simple', price: 1200, duration: 45, category: 'Cirugía', margin: 0.6 },
    { id: 'service_3', name: 'Endodoncia', price: 3500, duration: 90, category: 'Especialidad', margin: 0.8 },
    { id: 'service_4', name: 'Corona Dental', price: 5000, duration: 120, category: 'Prótesis', margin: 0.65 },
    { id: 'service_5', name: 'Implante Dental', price: 8000, duration: 150, category: 'Implantología', margin: 0.75 },
    { id: 'service_6', name: 'Blanqueamiento', price: 2500, duration: 90, category: 'Estético', margin: 0.85 },
    { id: 'service_7', name: 'Ortodoncia', price: 15000, duration: 60, category: 'Especialidad', margin: 0.7 },
    { id: 'service_8', name: 'Cirugía Oral', price: 4500, duration: 120, category: 'Cirugía', margin: 0.6 }
  ];

  const generateMockInventory = (sucursalId: string) => {
    const productos = [
      { id: '1', name: 'Anestesia Local', stock: Math.floor(Math.random() * 100), minStock: 20, price: 45, category: 'Medicamentos' },
      { id: '2', name: 'Composite Dental', stock: Math.floor(Math.random() * 50), minStock: 10, price: 180, category: 'Materiales' },
      { id: '3', name: 'Fresas Diamante', stock: Math.floor(Math.random() * 200), minStock: 50, price: 15, category: 'Instrumentos' },
      { id: '4', name: 'Guantes Nitrilo', stock: Math.floor(Math.random() * 500), minStock: 100, price: 0.25, category: 'Protección' },
      { id: '5', name: 'Mascarillas N95', stock: Math.floor(Math.random() * 300), minStock: 50, price: 2.5, category: 'Protección' },
      { id: '6', name: 'Algodón Dental', stock: Math.floor(Math.random() * 150), minStock: 30, price: 8, category: 'Consumibles' },
      { id: '7', name: 'Desinfectante', stock: Math.floor(Math.random() * 80), minStock: 15, price: 35, category: 'Limpieza' },
      { id: '8', name: 'Rayos X Digitales', stock: Math.floor(Math.random() * 20), minStock: 5, price: 450, category: 'Equipos' },
      { id: '9', name: 'Cemento Dental', stock: Math.floor(Math.random() * 40), minStock: 8, price: 120, category: 'Materiales' },
      { id: '10', name: 'Brackets Metálicos', stock: Math.floor(Math.random() * 60), minStock: 15, price: 25, category: 'Ortodoncia' }
    ];
    
    return productos.map(p => ({
      ...p,
      stockStatus: p.stock <= p.minStock ? 'bajo' : p.stock === 0 ? 'agotado' : 'normal',
      valorTotal: p.stock * p.price,
      diasVencimiento: Math.floor(Math.random() * 365),
      rotacion: Math.random() * 12
    }));
  };

// Cálculo de métricas
const calcularMetricasFinancieras = (data: SucursalData): MetricaFinanciera => {
  const ingresos = data.payments.reduce((sum, p) => sum + (Number(p?.amount) || 0), 0);
  const gastos   = data.expenses.reduce((sum, e) => sum + (Number(e?.amount) || 0), 0);
  const utilidad = ingresos - gastos;
  const margenUtilidad = ingresos > 0 ? (utilidad / ingresos) * 100 : 0;

  const ingresosLaboratorio = data.trabajosLaboratorio.reduce(
    (sum, t) => sum + (Number(t?.presupuesto) || 0),
    0
  );

  const abonosLaboratorio = data.trabajosLaboratorio.reduce((sum, t) => {
    const abonos = Array.isArray(t.abonos) ? t.abonos : JSON.parse(t.abonos || '[]');
    return sum + abonos.reduce((abSum: number, a: any) => abSum + (Number(a?.monto) || 0), 0);
  }, 0);

  const saldosPendientes = ingresosLaboratorio - abonosLaboratorio;

  return {
    ingresos,
    gastos,
    utilidad,
    margenUtilidad,
    ingresosLaboratorio,
    abonosLaboratorio,
    saldosPendientes,
  };
};


  const calcularMetricasOperacionales = (data: SucursalData): MetricaOperacional => {
    const totalCitas = data.appointments.length;
    const citasAtendidas = data.appointments.filter(a => a.status === 'Atendida').length;
    const citasCanceladas = data.appointments.filter(a => a.status === 'Cancelada').length;
    const tasaConversion = totalCitas > 0 ? (citasAtendidas / totalCitas) * 100 : 0;
    
    const trabajosLaboratorio = data.trabajosLaboratorio.length;
    const trabajosCompletados = data.trabajosLaboratorio.filter(t => 
      t.etapa === 'Completado' || t.etapa === 'Entregado'
    ).length;
    const trabajosPendientes = trabajosLaboratorio - trabajosCompletados;
    
    const pacientesUnicos = new Set(data.appointments.map(a => a.patient)).size;
    
    // Métricas adicionales
    const hoy = new Date().toISOString().split('T')[0];
    const citasHoy = data.appointments.filter(a => a.date === hoy).length;
    
    const inicioSemana = new Date();
    inicioSemana.setDate(inicioSemana.getDate() - inicioSemana.getDay());
    const citasSemana = data.appointments.filter(a => 
      new Date(a.date) >= inicioSemana
    ).length;

    return {
      totalCitas,
      citasAtendidas,
      citasCanceladas,
      tasaConversion,
      trabajosLaboratorio,
      trabajosCompletados,
      trabajosPendientes,
      pacientesUnicos,
      citasHoy,
      citasSemana,
      tiempoPromedioAtencion: 45 + Math.random() * 30 // Mock
    };
  };

  const calcularMetricasInventario = (data: SucursalData): MetricaInventario => {
  // Usar directamente las métricas que ya vienen del backend
  if (data.metricas && data.metricas.inventario) {
    return {
      totalProductos: data.metricas.inventario.totalProductos || 0,
      productosStockBajo: data.metricas.inventario.productosStockBajo || 0,
      productosAgotados: data.metricas.inventario.productosAgotados || 0,
      valorInventario: data.metricas.inventario.valorInventario || 0,
      rotacionPromedio: data.metricas.inventario.rotacionPromedio || 8.0,
      productosVencimiento: data.metricas.inventario.productosVencimiento || 0,
      comprasMes: data.metricas.inventario.comprasMes || 0,
      gastosInventario: data.metricas.inventario.gastosInventario || 0,
      eficienciaStock: data.metricas.inventario.eficienciaStock || 0,
      alertasCriticas: data.metricas.inventario.alertasCriticas || 0
    };
  }
  
  // Fallback para calcular desde datos de inventario si no vienen las métricas
  const inventario = data.inventory || [];
  const totalProductos = inventario.length;
  const productosStockBajo = inventario.filter(p => p.estado_stock === 'bajo' || p.estado_stock === 'critico').length;
  const productosAgotados = inventario.filter(p => p.estado_stock === 'agotado').length;
  const valorInventario = inventario.reduce((sum, p) => sum + (p.valor_total || 0), 0);
  const alertasCriticas = data.alertasInventario?.filter(a => !a.resuelta).length || 0;

  return {
    totalProductos,
    productosStockBajo,
    productosAgotados,
    valorInventario,
    rotacionPromedio: 8.0,
    productosVencimiento: 0,
    comprasMes: 0,
    gastosInventario: 0,
    eficienciaStock: Math.max(0, 100 - ((productosStockBajo + productosAgotados) / Math.max(totalProductos, 1) * 100)),
    alertasCriticas
  };
};

  const calcularMetricasServicios = (data: SucursalData): MetricaServicios => {
  // Usar métricas del backend solo si traen datos reales
  const m = data.metricas?.servicios;
  const hayDatosBackend =
    m &&
    (Object.keys(m.ingresosPorServicio || {}).length > 0 ||
     Object.keys(m.cantidadPorServicio || {}).length > 0);

  if (hayDatosBackend) {
    return {
      serviciosActivos: m.serviciosActivos || 0,
      servicioMasVendido: m.servicioMasVendido || '',
      ingresosPorServicio: m.ingresosPorServicio || {},
      cantidadPorServicio: m.cantidadPorServicio || {},
      margenPorServicio: m.margenPorServicio || {},
      tiempoPromedioPorServicio: m.tiempoPromedioPorServicio || {},
      satisfaccionPorServicio: m.satisfaccionPorServicio || {},
      tendenciaServicios: m.tendenciaServicios || []
    };
  }
  
  // Fallback para calcular desde datos directos si no vienen las métricas
const servicios = data.services ?? [];
const appointments = data.appointments ?? [];
const payments = data.payments ?? [];

const ingresosPorServicio: Record<string, number> = {};
const cantidadPorServicio: Record<string, number> = {};
const margenPorServicio: Record<string, number> = {};
const satisfaccionPorServicio: Record<string, number> = {};


servicios.forEach((service) => {
  // Soporta serviceId (camel) y service_id (snake)
  const citasServicio = appointments.filter(
    (a) => (a.serviceId ?? a.service_id) === service.id
  );

  // 1) Si el pago ya trae serviceId/service_id, úsalo
  // 2) Si no, cae al appointmentId/appointment_id -> busca su cita y toma el servicio desde ahí
  const pagosServicio = payments.filter((p) => {
    const sidPago = p.serviceId ?? p.service_id;
    if (sidPago) return sidPago === service.id;

    const apptId = p.appointmentId ?? p.appointment_id;
    if (!apptId) return false;

    const cita = appointments.find((a) => a.id === apptId);
    return !!cita && (cita.serviceId ?? cita.service_id) === service.id;
  });

const ingresoTotal = pagosServicio.reduce(
  (sum, p) => sum + (Number(p.amount) || 0),
  0
);
const cantidadVendida = citasServicio.length;

ingresosPorServicio[service.name] = ingresoTotal;
cantidadPorServicio[service.name] = cantidadVendida;

// 🔹 Satisfacción por servicio (0–5)
// En el fallback NO usamos ventasServicios.
// Si el backend trae satisfacción real, ya llega por data.metricas.servicios
// y se toma en la rama "hayDatosBackend" de arriba.
let satisfaccion = 0;

// Clamp entre 0 y 5 (por ahora siempre será 0 hasta que haya datos reales)
satisfaccionPorServicio[service.name] = Math.max(0, Math.min(5, satisfaccion));


// Margen en PORCENTAJE (0–100) porque tu formatPercent espera 0–100
const precio = Number(service.price) || 0;
const costoEstimado = cantidadVendida * precio * 0.3;
const margenPct =
  ingresoTotal > 0
    ? ((ingresoTotal - costoEstimado) / ingresoTotal) * 100
    : 0;

// Clamp por seguridad
margenPorServicio[service.name] = Math.max(0, Math.min(100, margenPct));

  // Clamp por seguridad
  margenPorServicio[service.name] = Math.max(0, Math.min(100, margenPct));
});

// Evita undefined si no hay claves
const keys = Object.keys(cantidadPorServicio);
const servicioMasVendido =
  keys.length === 0
    ? ''
    : keys.reduce(
        (max, k) =>
          (cantidadPorServicio[k] || 0) > (cantidadPorServicio[max] || 0)
            ? k
            : max,
        keys[0]
      );

return {
  serviciosActivos: servicios.length,
  servicioMasVendido,
  ingresosPorServicio,
  cantidadPorServicio,
  margenPorServicio,
  tiempoPromedioPorServicio: {},
  satisfaccionPorServicio,
  tendenciaServicios: [],
};

// 👆 agrega esta línea que cierra la función:
};
    
  // Datos procesados
  const metricas = useMemo(() => {
    return sucursalesData.map(data => ({
      sucursal: data,
      financieras: calcularMetricasFinancieras(data),
      operacionales: calcularMetricasOperacionales(data),
      inventario: calcularMetricasInventario(data),
      servicios: calcularMetricasServicios(data)
    }));
  }, [sucursalesData]);

  const tendenciasGlobales = useMemo(() => {
    if (!sucursalesData.length) {
      return {
        citasDia: 0,
        satisfaccion: 0,
        eficienciaLab: 0,
        rotacionStock: 0,
      };
    }

    // Normaliza fechas sin horas
    const parseDateOnly = (value: any) => {
      const d = new Date(value);
      d.setHours(0, 0, 0, 0);
      return d;
    };

    const start = parseDateOnly(fechaInicio);
    const end = parseDateOnly(fechaFin);

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
      return {
        citasDia: 0,
        satisfaccion: 0,
        eficienciaLab: 0,
        rotacionStock: 0,
      };
    }

    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const totalDays =
      Math.max(1, Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1);
    const halfDays = Math.floor(totalDays / 2);

    // --- 1) Citas/día promedio (segunda mitad vs primera mitad) ---
    let citasTrend = 0;

    if (halfDays > 0) {
      const mid = new Date(start.getTime() + (halfDays - 1) * MS_PER_DAY);
      const start2 = new Date(mid.getTime() + MS_PER_DAY);

      const allAppointments = sucursalesData.flatMap(
        (s) => s.appointments || []
      );

      const inRange = (dateStr: any, a: Date, b: Date) => {
        if (!dateStr) return false;
        const d = parseDateOnly(dateStr);
        return d >= a && d <= b;
      };

      const citas1 = allAppointments.filter((a) =>
        inRange(a.date, start, mid)
      );
      const citas2 = allAppointments.filter((a) =>
        inRange(a.date, start2, end)
      );

      const prom1 = citas1.length / Math.max(1, halfDays);
      const prom2 = citas2.length / Math.max(1, totalDays - halfDays);

      if (prom1 === 0) {
        citasTrend = prom2 > 0 ? 100 : 0;
      } else {
        citasTrend = ((prom2 - prom1) / prom1) * 100;
      }
    }

    // --- 2) Satisfacción cliente (promedio vs objetivo 4.0/5) ---
    let satTrend = 0;
    const todasSatisfacciones: number[] = [];

    metricas.forEach((m) => {
      const vals = Object.values(m.servicios.satisfaccionPorServicio || {});
      vals.forEach((v) => {
        const num = Number(v);
        if (!isNaN(num) && num > 0) {
          todasSatisfacciones.push(num);
        }
      });
    });

    if (todasSatisfacciones.length) {
      const promedio =
        todasSatisfacciones.reduce((acc, n) => acc + n, 0) /
        todasSatisfacciones.length;
      const objetivo = 4; // objetivo en escala 0-5
      // Cada 0.25 arriba/abajo del objetivo = ±5%
      satTrend = (promedio - objetivo) * 20;
    }

    // --- 3) Eficiencia lab (trabajos completados vs total, objetivo 80%) ---
    let effLabTrend = 0;
    let totalTrabajos = 0;
    let totalCompletados = 0;

    metricas.forEach((m) => {
      totalTrabajos += m.operacionales.trabajosLaboratorio || 0;
      totalCompletados += m.operacionales.trabajosCompletados || 0;
    });

    if (totalTrabajos > 0) {
      const eficienciaActual = (totalCompletados / totalTrabajos) * 100;
      const objetivo = 80;
      effLabTrend = eficienciaActual - objetivo;
    }

    // --- 4) Rotación stock (rotación promedio vs objetivo 8x/año) ---
    let rotTrend = 0;
    if (metricas.length) {
      const promRot =
        metricas.reduce(
          (sum, m) => sum + (m.inventario.rotacionPromedio || 0),
          0
        ) / metricas.length;
      const objetivoRot = 8; // objetivo de rotación anual
      if (objetivoRot > 0) {
        rotTrend = ((promRot - objetivoRot) / objetivoRot) * 100;
      }
    }

    const clamp = (v: number) => Math.max(-100, Math.min(100, v));

    return {
      citasDia: clamp(citasTrend),
      satisfaccion: clamp(satTrend),
      eficienciaLab: clamp(effLabTrend),
      rotacionStock: clamp(rotTrend),
    };
  }, [sucursalesData, metricas, fechaInicio, fechaFin]);


  const datosComparativos = useMemo(() => {
    if (metricas.length < 2) return [];
    
    return [
      {
        metrica: 'Ingresos',
        sucursal1: Number(metricas[0]?.financieras?.ingresos) || 0,
sucursal2: Number(metricas[1]?.financieras?.ingresos) || 0,
diferencia: (Number(metricas[1]?.financieras?.ingresos) || 0) - (Number(metricas[0]?.financieras?.ingresos) || 0)

      },
      {
        metrica: 'Utilidad',
        sucursal1: metricas[0].financieras.utilidad,
        sucursal2: metricas[1].financieras.utilidad,
        diferencia: metricas[1].financieras.utilidad - metricas[0].financieras.utilidad
      },
      {
        metrica: 'Citas Atendidas',
        sucursal1: metricas[0].operacionales.citasAtendidas,
        sucursal2: metricas[1].operacionales.citasAtendidas,
        diferencia: metricas[1].operacionales.citasAtendidas - metricas[0].operacionales.citasAtendidas
      },
      {
        metrica: 'Pacientes Únicos',
        sucursal1: metricas[0].operacionales.pacientesUnicos,
        sucursal2: metricas[1].operacionales.pacientesUnicos,
        diferencia: metricas[1].operacionales.pacientesUnicos - metricas[0].operacionales.pacientesUnicos
      }
    ];
  }, [metricas]);

    const formatMoney = (amount: number) =>
    new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
    }).format(amount);

  const formatPercent = (value: number) => `${value.toFixed(1)}%`;

  // NUEVO: porcentaje con signo (+8%, -3%, 0%)
  const formatSignedPercent = (value: number) => {
    if (!isFinite(value)) return '0%';
    const rounded = Math.round(value);
    if (rounded > 0) return `+${rounded}%`;
    if (rounded < 0) return `${rounded}%`; // ya trae el signo -
    return '0%';
  };



  // Componente de Card Métrica Profesional
  const MetricCard = ({ 
    title, 
    value, 
    icon: Icon, 
    trend, 
    trendValue, 
    color = 'blue',
    gradient = false,
    size = 'normal'
  }: {
    title: string;
    value: string | number;
    icon: any;
    trend?: 'up' | 'down' | 'stable';
    trendValue?: string;
    color?: string;
    gradient?: boolean;
    size?: 'normal' | 'large';
  }) => {
    const colorClasses = {
      blue: gradient ? 'bg-gradient-to-br from-blue-500 to-blue-600' : 'bg-blue-500',
      green: gradient ? 'bg-gradient-to-br from-green-500 to-green-600' : 'bg-green-500',
      purple: gradient ? 'bg-gradient-to-br from-purple-500 to-purple-600' : 'bg-purple-500',
      orange: gradient ? 'bg-gradient-to-br from-orange-500 to-orange-600' : 'bg-orange-500',
      red: gradient ? 'bg-gradient-to-br from-red-500 to-red-600' : 'bg-red-500',
      indigo: gradient ? 'bg-gradient-to-br from-indigo-500 to-indigo-600' : 'bg-indigo-500',
    };

    const trendIcons = {
      up: TrendingUp,
      down: TrendingDown,
      stable: MinusCircle
    };

    const TrendIcon = trend ? trendIcons[trend] : null;

    return (
      <div className={`bg-white rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 border border-gray-100 overflow-hidden ${
        size === 'large' ? 'p-8' : 'p-6'
      }`}>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className={`text-gray-600 font-medium ${size === 'large' ? 'text-lg' : 'text-sm'}`}>
              {title}
            </p>
            <p className={`font-bold text-gray-900 mt-2 ${size === 'large' ? 'text-4xl' : 'text-3xl'}`}>
              {typeof value === 'number' ? value.toLocaleString() : value}
            </p>
            {trend && trendValue && (
              <div className={`flex items-center mt-3 ${
                trend === 'up' ? 'text-green-600' : 
                trend === 'down' ? 'text-red-600' : 
                'text-gray-600'
              }`}>
                {TrendIcon && <TrendIcon className="h-4 w-4 mr-1" />}
                <span className="text-sm font-medium">{trendValue}</span>
              </div>
            )}
          </div>
          <div className={`${colorClasses[color as keyof typeof colorClasses]} p-4 rounded-xl shadow-lg`}>
            <Icon className={`text-white ${size === 'large' ? 'h-8 w-8' : 'h-6 w-6'}`} />
          </div>
        </div>
      </div>
    );
  };

// --- Hover badge para ver detalle de alertas ---
const AlertBadge: React.FC<{ count: number; alerts: any[] }> = ({ count, alerts }) => {
  const [open, setOpen] = React.useState(false);

  const pillClass =
    count > 5
      ? "bg-red-100 text-red-800"
      : count > 2
      ? "bg-yellow-100 text-yellow-800"
      : "bg-green-100 text-green-800";

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className={`px-2 py-1 rounded-full text-xs font-medium cursor-default ${pillClass}`}>
        {count} {count === 1 ? "alerta" : "alertas"}
      </span>

      {open && (
        <div className="absolute right-0 top-8 z-50 w-80 max-h-72 overflow-auto
                        bg-white border border-gray-200 rounded-xl shadow-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-900">Detalle de alertas</h4>
            <span className="text-xs text-gray-500">{count} total</span>
          </div>

          {alerts && alerts.length > 0 ? (
            <ul className="space-y-2">
              {alerts.map((a, i) => (
                <li key={i} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full 
                        ${a?.prioridad === "alta" ? "bg-red-500" :
                          a?.prioridad === "media" ? "bg-yellow-500" : "bg-green-500"}`} />
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {a?.titulo || a?.tipo || "Alerta"}
                      </p>
                    </div>
                    <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">
                      {a?.descripcion || "Sin descripción"}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] px-2 py-0.5 rounded-full
                      bg-gray-100 text-gray-700">
                      {a?.fecha || ""}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-gray-600">Sin alertas</div>
          )}
        </div>
      )}
    </div>
  );
};

  // Componente de Gráfico Profesional
  const ChartContainer = ({ 
    title, 
    children, 
    actions,
    description 
  }: { 
    title: string; 
    children: React.ReactNode; 
    actions?: React.ReactNode;
    description?: string;
  }) => (
    <div
  className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden chart-container"
  style={{ pageBreakInside: 'avoid' }}
>

      <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            {description && (
              <p className="text-sm text-gray-600 mt-1">{description}</p>
            )}
          </div>
          {actions && (
            <div className="flex items-center space-x-2">
              {actions}
            </div>
          )}
        </div>
      </div>
      <div className="p-6">
        {children}
      </div>
    </div>
  );

  // Componentes de vista
  const VistaResumen = () => (
    <div className="space-y-8">
      {/* KPIs Principales con diseño moderno */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {metricas.map((metrica, index) => (
          <MetricCard
            key={metrica.sucursal.id}
            title={`${metrica.sucursal.nombre} - Ingresos`}
            value={formatMoney(metrica.financieras.ingresos)}
            icon={DollarSign}
            trend={metrica.financieras.utilidad >= 0 ? 'up' : 'down'}
            trendValue={`${formatPercent(metrica.financieras.margenUtilidad)} margen`}
            color={index === 0 ? 'blue' : 'green'}
            gradient={true}
            size="normal"
          />
        ))}
        
        {/* Métricas adicionales */}
        <MetricCard
          title="Total Pacientes Únicos"
          value={metricas.reduce((sum, m) => sum + m.operacionales.pacientesUnicos, 0)}
          icon={Users}
          trend="up"
          trendValue="+12% vs mes anterior"
          color="purple"
          gradient={true}
        />
        
        <MetricCard
          title="Eficiencia Global"
          value={`${(metricas.reduce((sum, m) => sum + m.operacionales.tasaConversion, 0) / metricas.length).toFixed(1)}%`}
          icon={Target}
          trend="stable"
          trendValue="Dentro de meta"
          color="indigo"
          gradient={true}
        />
      </div>

      {/* Gráficos de comparación modernos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gráfico de Ingresos vs Gastos */}
        <ChartContainer
          title="Análisis Financiero Comparativo"
          description="Ingresos, gastos y utilidad por sucursal"
          actions={
            <button className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-200 transition-colors">
              <Download className="h-4 w-4 inline mr-1" />
              Exportar
            </button>
          }
        >
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={[
              { 
                name: metricas[0]?.sucursal.nombre || 'Sucursal 1', 
                ingresos: metricas[0]?.financieras.ingresos || 0,
                gastos: metricas[0]?.financieras.gastos || 0,
                utilidad: metricas[0]?.financieras.utilidad || 0
              },
              { 
                name: metricas[1]?.sucursal.nombre || 'Sucursal 2', 
                ingresos: metricas[1]?.financieras.ingresos || 0,
                gastos: metricas[1]?.financieras.gastos || 0,
                utilidad: metricas[1]?.financieras.utilidad || 0
              }
            ]}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fill: '#6b7280' }} />
              <YAxis tick={{ fill: '#6b7280' }} />
              <Tooltip 
                formatter={(value: any) => [formatMoney(value), '']}
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
                }}
              />
              <Legend />
              <Bar dataKey="ingresos" fill="#3b82f6" name="Ingresos" radius={[4, 4, 0, 0]} />
              <Bar dataKey="gastos" fill="#ef4444" name="Gastos" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="utilidad" stroke="#10b981" strokeWidth={3} name="Utilidad" />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartContainer>

        {/* Gráfico de Estado Operacional */}
        <ChartContainer
          title="Estado Operacional"
          description="Distribución de citas y conversión"
        >
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={datosComparativos.slice(2)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="metrica" tick={{ fill: '#6b7280' }} />
              <YAxis tick={{ fill: '#6b7280' }} />
              <Tooltip 
                formatter={(value: any) => [value, '']}
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
                }}
              />
              <Area 
                type="monotone" 
                dataKey="sucursal1" 
                stackId="1" 
                stroke="#8884d8" 
                fill="url(#gradientBlue)" 
                name={metricas[0]?.sucursal.nombre}
              />
              <Area 
                type="monotone" 
                dataKey="sucursal2" 
                stackId="2" 
                stroke="#82ca9d" 
                fill="url(#gradientGreen)" 
                name={metricas[1]?.sucursal.nombre}
              />
              <defs>
                <linearGradient id="gradientBlue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="#8884d8" stopOpacity={0.1}/>
                </linearGradient>
                <linearGradient id="gradientGreen" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#82ca9d" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="#82ca9d" stopOpacity={0.1}/>
                </linearGradient>
              </defs>
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>
      </div>

      {/* Dashboard de Métricas Avanzadas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Indicadores de Alerta */}
        <div className="bg-gradient-to-br from-red-50 to-orange-50 rounded-2xl p-6 border border-red-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-red-900">Alertas Activas</h3>
            <AlertTriangle className="h-6 w-6 text-red-600" />
          </div>
          <div className="space-y-3">
            {sucursalesData.map((sucursal, index) => {
              const alertas = sucursal.alertasInventario?.filter(a => !a.resuelta) || [];
              return (
                <div key={sucursal.id} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">{sucursal.nombre}</span>
                  <AlertBadge count={alertas.length} alerts={alertas} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Progreso hacia Metas */}
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-blue-900">Progreso Mensual</h3>
            <Target className="h-6 w-6 text-blue-600" />
          </div>
          <div className="space-y-4">
            {metricas.map((metrica, index) => {
              const progreso = (metrica.financieras.ingresos / metaIngresos) * 100;
              return (
                <div key={metrica.sucursal.id}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium text-gray-700">
                      {metrica.sucursal.nombre}
                    </span>
                    <span className="text-sm text-gray-600">
                      {formatPercent(progreso)}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full transition-all duration-500 ${
                        progreso >= 100 ? 'bg-green-500' : 
                        progreso >= 80 ? 'bg-blue-500' : 
                        progreso >= 60 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${Math.min(progreso, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

                {/* Tendencias Rápidas (con datos reales) */}
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-6 border border-green-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-green-900">Tendencias</h3>
            <TrendingUp className="h-6 w-6 text-green-600" />
          </div>
          <div className="space-y-3">
            {/* Citas/día promedio */}
            {/* FIX MOBILE: apilar header en pantallas pequeñas para evitar overflow */}
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
              <span className="text-sm text-gray-700">Citas/día promedio</span>
              <span
                className={`text-sm font-medium ${
                  tendenciasGlobales.citasDia >= 0
                    ? 'text-green-600'
                    : 'text-red-600'
                }`}
              >
                {formatSignedPercent(tendenciasGlobales.citasDia)}
              </span>
            </div>

            {/* Satisfacción cliente */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Satisfacción cliente</span>
              <span
                className={`text-sm font-medium ${
                  tendenciasGlobales.satisfaccion >= 0
                    ? 'text-green-600'
                    : 'text-red-600'
                }`}
              >
                {formatSignedPercent(tendenciasGlobales.satisfaccion)}
              </span>
            </div>

            {/* Eficiencia lab */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Eficiencia lab</span>
              <span
                className={`text-sm font-medium ${
                  tendenciasGlobales.eficienciaLab >= 0
                    ? 'text-blue-600'
                    : 'text-red-600'
                }`}
              >
                {formatSignedPercent(tendenciasGlobales.eficienciaLab)}
              </span>
            </div>

            {/* Rotación stock */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Rotación stock</span>
              <span
                className={`text-sm font-medium ${
                  tendenciasGlobales.rotacionStock >= 0
                    ? 'text-purple-600'
                    : 'text-red-600'
                }`}
              >
                {formatSignedPercent(tendenciasGlobales.rotacionStock)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabla Comparativa Mejorada */}
      <ChartContainer
        title="Análisis Comparativo Detallado"
        description="Métricas clave comparadas entre sucursales"
        actions={
          <div className="flex space-x-2">
            <button className="px-3 py-1 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
              <Filter className="h-4 w-4 inline mr-1" />
              Filtrar
            </button>
            <button className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-200 transition-colors">
              <Download className="h-4 w-4 inline mr-1" />
              Excel
            </button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Métrica</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">{metricas[0]?.sucursal.nombre}</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">{metricas[1]?.sucursal.nombre}</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Diferencia</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Mejor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {datosComparativos.map((row, index) => (
                <tr key={index} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    {row.metrica}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {row.metrica.includes('Ingresos') || row.metrica.includes('Utilidad') 
                      ? formatMoney(row.sucursal1) 
                      : row.sucursal1.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {row.metrica.includes('Ingresos') || row.metrica.includes('Utilidad') 
                      ? formatMoney(row.sucursal2) 
                      : row.sucursal2.toLocaleString()}
                  </td>
                  <td className={`px-6 py-4 text-sm font-medium ${
                    row.diferencia >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    <div className="flex items-center">
                      {row.diferencia >= 0 ? (
                        <ArrowUpCircle className="h-4 w-4 mr-1" />
                      ) : (
                        <ArrowDownCircle className="h-4 w-4 mr-1" />
                      )}
                      {row.diferencia >= 0 ? '+' : ''}
                      {row.metrica.includes('Ingresos') || row.metrica.includes('Utilidad') 
                        ? formatMoney(Math.abs(row.diferencia)) 
                        : Math.abs(row.diferencia).toLocaleString()}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                      row.sucursal2 > row.sucursal1 
                        ? 'bg-green-100 text-green-800' 
                        : row.sucursal1 > row.sucursal2 
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {row.sucursal2 > row.sucursal1 ? (
                        <>
                          <Star className="h-3 w-3 mr-1" />
                          {metricas[1]?.sucursal.nombre}
                        </>
                      ) : row.sucursal1 > row.sucursal2 ? (
                        <>
                          <Star className="h-3 w-3 mr-1" />
                          {metricas[0]?.sucursal.nombre}
                        </>
                      ) : (
                        'Empate'
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartContainer>
    </div>
  );

  const VistaInventario = () => (
    <div className="space-y-8">
      {/* KPIs de Inventario */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {metricas.map((metrica, index) => (
          <div key={metrica.sucursal.id} className="space-y-4">
            <MetricCard
              title={`${metrica.sucursal.nombre} - Productos`}
              value={metrica.inventario.totalProductos}
              icon={Package}
              trend={metrica.inventario.productosStockBajo > 5 ? 'down' : 'up'}
              trendValue={`${metrica.inventario.productosStockBajo} en stock bajo`}
              color={index === 0 ? 'blue' : 'green'}
              gradient={true}
            />
            
            <MetricCard
              title="Valor Inventario"
              value={formatMoney(metrica.inventario.valorInventario)}
              icon={DollarSign}
              trend="stable"
              trendValue={`${formatPercent(metrica.inventario.eficienciaStock)} eficiencia`}
              color="purple"
              gradient={true}
            />
          </div>
        ))}
      </div>

      {/* Gráficos de Inventario */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Estado del Stock */}
        <ChartContainer
          title="Estado del Stock por Sucursal"
          description="Distribución de productos por estado"
        >
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={metricas.map(m => ({
              name: m.sucursal.nombre,
              normal: m.inventario.totalProductos - m.inventario.productosStockBajo - m.inventario.productosAgotados,
              stock_bajo: m.inventario.productosStockBajo,
              agotados: m.inventario.productosAgotados
            }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fill: '#6b7280' }} />
              <YAxis tick={{ fill: '#6b7280' }} />
              <Tooltip 
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
                }}
              />
              <Legend />
              <Bar dataKey="normal" stackId="a" fill="#10b981" name="Stock Normal" radius={[0, 0, 0, 0]} />
              <Bar dataKey="stock_bajo" stackId="a" fill="#f59e0b" name="Stock Bajo" radius={[0, 0, 0, 0]} />
              <Bar dataKey="agotados" stackId="a" fill="#ef4444" name="Agotados" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>

        {/* Valor del Inventario */}
        <ChartContainer
          title="Valor del Inventario"
          description="Comparación del valor total por sucursal"
        >
          <ResponsiveContainer width="100%" height={300}>
            <RechartsPieChart>
              <Pie
                data={metricas.map((m, index) => ({
                  name: m.sucursal.nombre,
                  value: m.inventario.valorInventario,
                  fill: CHART_COLORS[index === 0 ? 'sucursal1' : 'sucursal2']
                }))}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {metricas.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={CHART_COLORS[index === 0 ? 'sucursal1' : 'sucursal2']} />
                ))}
              </Pie>
              <Tooltip formatter={(value: any) => [formatMoney(value), 'Valor']} />
            </RechartsPieChart>
          </ResponsiveContainer>
        </ChartContainer>
      </div>

      {/* Alertas y Productos Críticos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {metricas.map((metrica, index) => (
          <ChartContainer
            key={metrica.sucursal.id}
            title={`${metrica.sucursal.nombre} - Estado Crítico`}
            description="Productos que requieren atención inmediata"
          >
            <div className="space-y-4">
              {/* Productos con stock bajo */}
              <div className="bg-red-50 rounded-lg p-4 border border-red-200">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium text-red-900">Stock Bajo</h4>
                  <span className="bg-red-100 text-red-800 px-2 py-1 rounded-full text-sm font-medium">
                    {metrica.inventario.productosStockBajo} productos
                  </span>
                </div>
                <div className="space-y-2">
                  {metrica.sucursal.productosInventario
                    ?.filter(p => p.stockStatus === 'bajo')
                    .slice(0, 3)
                    .map(producto => (
                      <div key={producto.id} className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">{producto.name}</span>
                        <span className="text-red-600 font-medium">{producto.stock} restantes</span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Productos por vencer */}
              <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium text-yellow-900">Próximos a Vencer</h4>
                  <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-sm font-medium">
                    {metrica.inventario.productosVencimiento} productos
                  </span>
                </div>
                <div className="space-y-2">
                  {metrica.sucursal.productosInventario
                    ?.filter(p => p.diasVencimiento <= 30)
                    .slice(0, 3)
                    .map(producto => (
                      <div key={producto.id} className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">{producto.name}</span>
                        <span className="text-yellow-600 font-medium">{producto.diasVencimiento} días</span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Rotación lenta */}
              <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium text-blue-900">Rotación Promedio</h4>
                  <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-sm font-medium">
                    {metrica.inventario.rotacionPromedio.toFixed(1)}x/año
                  </span>
                </div>
                <div className="w-full bg-blue-200 rounded-full h-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min((metrica.inventario.rotacionPromedio / 12) * 100, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </ChartContainer>
        ))}
      </div>

      {/* Tabla Detallada de Inventario */}
      <ChartContainer
        title="Inventario Detallado"
        description="Lista completa de productos con alertas"
        actions={
          <div className="flex space-x-2">
            <button className="px-3 py-1 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
              <Filter className="h-4 w-4 inline mr-1" />
              Filtrar
            </button>
            <button className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-200 transition-colors">
              <Download className="h-4 w-4 inline mr-1" />
              Exportar
            </button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Producto</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Categoría</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Stock</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Min. Stock</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Valor</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Estado</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Sucursal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
  {sucursalesData.flatMap(sucursal =>
    (sucursal.productosInventario || []).map((producto: any) => {
      // Normalizar campos que vienen del backend
      const nombre =
        producto.name ??
        producto.nombre ??
        producto.producto ??
        'Sin nombre';

      const categoria =
        producto.category ??
        producto.categoria ??
        producto.tipo ??
        '—';

      const stock =
        Number(
          producto.stock ??
          producto.quantity ??
          producto.cantidad ??
          0
        ) || 0;

      const minStock =
        Number(
          producto.minStock ??
          producto.min_stock ??
          producto.stock_minimo ??
          0
        ) || 0;

      const precio =
        Number(
          producto.price ??
          producto.precio ??
          0
        ) || 0;

      // Si el backend ya manda valor_total lo usamos, si no lo calculamos
      const valor =
        producto.valor_total != null
          ? Number(producto.valor_total) || 0
          : stock * precio;

      const estadoRaw = producto.estado_stock ?? producto.stockStatus;

      const estado =
        estadoRaw ||
        (stock <= 0
          ? 'Agotado'
          : minStock > 0 && stock <= minStock
          ? 'Bajo'
          : 'Normal');

      const chipClasses =
        estado === 'Agotado'
          ? 'bg-red-100 text-red-800'
          : estado === 'Bajo'
          ? 'bg-yellow-100 text-yellow-800'
          : 'bg-green-100 text-green-800';

      return (
        <tr
          key={`${sucursal.id}-${producto.id || producto.sku || nombre}`}
          className="hover:bg-gray-50 transition-colors"
        >
          <td className="px-4 py-3 text-sm font-medium text-gray-900">
            {nombre}
          </td>
          <td className="px-4 py-3 text-sm text-gray-600">
            {categoria}
          </td>
          <td className="px-4 py-3 text-sm text-gray-900">
            {stock.toLocaleString()}
          </td>
          <td className="px-4 py-3 text-sm text-gray-900">
            {minStock.toLocaleString()}
          </td>
          <td className="px-4 py-3 text-sm text-gray-900">
            {formatMoney(valor)}
          </td>
          <td className="px-4 py-3 text-sm">
            <span
              className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${chipClasses}`}
            >
              {estado}
            </span>
          </td>
          <td className="px-4 py-3 text-sm text-gray-600">
            {sucursal.nombre}
          </td>
        </tr>
      );
    })
  )}
</tbody>
          </table>
        </div>
      </ChartContainer>
    </div>
  );

  const VistaServicios = () => (
    <div className="space-y-8">
      {/* KPIs de Servicios */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {metricas.map((metrica, index) => (
          <div key={metrica.sucursal.id} className="space-y-4">
            <MetricCard
              title={`${metrica.sucursal.nombre} - Servicios`}
              value={metrica.servicios.serviciosActivos}
              icon={Stethoscope}
              trend="up"
              trendValue="Todos activos"
              color={index === 0 ? 'blue' : 'green'}
              gradient={true}
            />
            
            <MetricCard
              title="Más Vendido"
              value={metrica.servicios.servicioMasVendido || 'N/A'}
              icon={Star}
              trend="up"
              trendValue="Líder del mes"
              color="orange"
              gradient={true}
              size="normal"
            />
          </div>
        ))}
      </div>

      {/* Gráficos de Servicios */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Ingresos por Servicio */}
        <ChartContainer
          title="Ingresos por Servicio"
          description="Comparación de ingresos entre servicios"
        >
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={Object.entries(metricas[0]?.servicios.ingresosPorServicio || {}).map(([servicio, ingresos]) => ({
              servicio: servicio.length > 15 ? servicio.substring(0, 15) + '...' : servicio,
              sucursal1: ingresos,
              sucursal2: metricas[1]?.servicios.ingresosPorServicio[servicio] || 0
            }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="servicio" tick={{ fill: '#6b7280', fontSize: 12 }} angle={-45} textAnchor="end" height={80} />
              <YAxis tick={{ fill: '#6b7280' }} />
              <Tooltip 
                formatter={(value: any) => [formatMoney(value), '']}
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
                }}
              />
              <Legend />
              <Bar dataKey="sucursal1" fill={CHART_COLORS.sucursal1} name={metricas[0]?.sucursal.nombre} radius={[4, 4, 0, 0]} />
              <Bar dataKey="sucursal2" fill={CHART_COLORS.sucursal2} name={metricas[1]?.sucursal.nombre} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>

        {/* Cantidad por Servicio */}
        <ChartContainer
          title="Volumen de Servicios"
          description="Cantidad de servicios prestados"
        >
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={Object.entries(metricas[0]?.servicios.cantidadPorServicio || {}).map(([servicio, cantidad]) => ({
              servicio: servicio.length > 15 ? servicio.substring(0, 15) + '...' : servicio,
              sucursal1: cantidad,
              sucursal2: metricas[1]?.servicios.cantidadPorServicio[servicio] || 0
            }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="servicio" tick={{ fill: '#6b7280', fontSize: 12 }} angle={-45} textAnchor="end" height={80} />
              <YAxis tick={{ fill: '#6b7280' }} />
              <Tooltip 
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
                }}
              />
              <Legend />
              <Area 
                type="monotone" 
                dataKey="sucursal1" 
                stackId="1" 
                stroke={CHART_COLORS.sucursal1} 
                fill={CHART_COLORS.sucursal1}
                fillOpacity={0.6}
                name={metricas[0]?.sucursal.nombre}
              />
              <Area 
                type="monotone" 
                dataKey="sucursal2" 
                stackId="2" 
                stroke={CHART_COLORS.sucursal2} 
                fill={CHART_COLORS.sucursal2}
                fillOpacity={0.6}
                name={metricas[1]?.sucursal.nombre}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>
      </div>

      {/* Análisis de Márgenes y Satisfacción */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {metricas.map((metrica, index) => (
          <ChartContainer
            key={metrica.sucursal.id}
            title={`${metrica.sucursal.nombre} - Análisis de Servicios`}
            description="Márgenes y satisfacción por servicio"
          >
            <div className="space-y-4">
              {Object.entries(metrica.servicios.margenPorServicio).slice(0, 5).map(([servicio, margen]) => {
                const satisfaccion = metrica.servicios.satisfaccionPorServicio[servicio] || 0;
                const ingresos = metrica.servicios.ingresosPorServicio[servicio] || 0;
                return (
 <div key={servicio} className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
    <div className="mb-3">
      <h4 className="font-medium text-gray-900 text-sm leading-tight mb-1">{servicio}</h4>
      <span className="text-sm text-gray-600">{formatMoney(ingresos)}</span>
    </div>

   {/* Leyendas para diferenciar colores */}
    <div className="flex items-center gap-2 mb-2 text-xs flex-wrap">
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        Margen
      </span>
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-fuchsia-50 text-fuchsia-700">
        <span className="h-2 w-2 rounded-full bg-fuchsia-500" />
        Satisfacción
      </span>
    </div>

    <div className="grid grid-cols-2 gap-4">
      {/* Margen */}
      <div>
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs text-gray-600">Margen</span>
          <span className="text-xs font-medium">{formatPercent(Number(margen))}</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
          <div
            className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
            style={{ width: `${Math.min(Number(margen), 100)}%` }}
          />
        </div>
      </div>

      {/* Satisfacción (0–5) */}
      <div>
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs text-gray-600">Satisfacción</span>
          <span className="text-xs font-medium">{(satisfaccion || 0).toFixed(1)}/5.0</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
          <div
            className="h-2 rounded-full transition-all duration-500 bg-fuchsia-500"
            style={{ width: `${Math.min(((satisfaccion || 0) / 5) * 100, 100)}%` }}
          />
        </div>
      </div>
    </div>
  </div>
);

              })}
            </div>
          </ChartContainer>
        ))}
      </div>

      {/* Tabla de Servicios Detallada */}
      <ChartContainer
        title="Análisis Detallado de Servicios"
        description="Métricas completas por servicio y sucursal"
       actions={
          <div className="flex space-x-2">
<button 
  onClick={() => setShowFiltroServicios(!showFiltroServicios)}
  className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-200 transition-colors"
>
  <Filter className="h-4 w-4 inline mr-1" />
  Filtrar
</button>
          </div>
        }
      >
   {/* Panel de filtros */}
        {showFiltroServicios && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg border">
            <h4 className="font-medium text-gray-900 mb-3">Filtrar Servicios</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Categoría</label>
               <select
  value={filtroCategoria}
  onChange={(e) => setFiltroCategoria(e.target.value)}
  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
>
  <option value="">Todas las categorías</option>
  {categoriasDisponibles.map(cat => (
    <option key={cat} value={cat}>{cat}</option>
  ))}
</select>

              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Margen mínimo (%)</label>
                <input
                  type="number"
                  value={filtroMargenMin}
                  onChange={(e) => setFiltroMargenMin(e.target.value)}
                  placeholder="Ej: 50"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ingresos mínimos</label>
                <input
                  type="number"
                  value={filtroIngresosMin}
                  onChange={(e) => setFiltroIngresosMin(e.target.value)}
                  placeholder="Ej: 1000"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  setFiltroCategoria('');
                  setFiltroMargenMin('');
                  setFiltroIngresosMin('');
                }}
                className="px-3 py-1 bg-gray-100 text-gray-700 rounded text-sm hover:bg-gray-200"
              >
                Limpiar
              </button>
            </div>
          </div>
        )}
        
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Servicio</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Precio Base</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Margen</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Duración</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Categoría</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Ingresos S1</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Ingresos S2</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
           {sucursalesData[0]?.services?.filter(servicio => {
               // Filtro por categoría usando clasificación
if (filtroCategoria) {
  const macro = clasificarServicio(servicio);
  if (macro !== filtroCategoria) return false;
}

// Filtro por margen mínimo
if (filtroMargenMin) {
  const margen = parseFloat(((servicio as any).margin ?? (servicio as any).margen ?? 0).toString());
  if (margen < parseFloat(filtroMargenMin)) return false;
}

// Filtro por ingresos mínimos
if (filtroIngresosMin) {
  const ingresosS1 = metricas[0]?.servicios.ingresosPorServicio[servicio.name] || 0;
  const ingresosS2 = metricas[1]?.servicios.ingresosPorServicio[servicio.name] || 0;
  const total = ingresosS1 + ingresosS2;
  if (total < parseFloat(filtroIngresosMin)) return false;
}

return true;

              }).map(servicio => {
                const ingresosS1 = metricas[0]?.servicios.ingresosPorServicio[servicio.name] || 0;
                const ingresosS2 = metricas[1]?.servicios.ingresosPorServicio[servicio.name] || 0;
                const total = ingresosS1 + ingresosS2;
                
                return (
                  <tr key={servicio.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{servicio.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{formatMoney(servicio.price)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        (servicio.margin || 0.7) >= 0.8 ? 'bg-green-100 text-green-800' :
                        (servicio.margin || 0.7) >= 0.6 ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {formatPercent((servicio.margin || 0.7) * 100)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{servicio.duration || 60} min</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{servicio.category}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{formatMoney(ingresosS1)}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{formatMoney(ingresosS2)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{formatMoney(total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ChartContainer>
    </div>
   );
    const VistaFinanciera = () => (  // ← Agregar esta declaración
    <div className="space-y-6">
      {/* Métricas Financieras */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {metricas.map((metrica, index) => (
          <div key={metrica.sucursal.id} className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              {metrica.sucursal.nombre} - Desempeño Financiero
            </h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Ingresos Totales</span>
                <span className="text-lg font-bold text-green-600">
                  {formatMoney(metrica.financieras.ingresos)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Gastos Totales</span>
                <span className="text-lg font-bold text-red-600">
                  {formatMoney(metrica.financieras.gastos)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Utilidad Neta</span>
                <span className={`text-lg font-bold ${
                  metrica.financieras.utilidad >= 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  {formatMoney(metrica.financieras.utilidad)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Margen de Utilidad</span>
                <span className={`text-lg font-bold ${
                  metrica.financieras.margenUtilidad >= 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  {formatPercent(metrica.financieras.margenUtilidad)}
                </span>
              </div>
              <div className="border-t pt-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Laboratorio - Presupuesto Total</span>
                  <span className="text-md font-semibold">
                    {formatMoney(metrica.financieras.ingresosLaboratorio)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Laboratorio - Abonos Recibidos</span>
                  <span className="text-md font-semibold text-green-600">
                    {formatMoney(metrica.financieras.abonosLaboratorio)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Laboratorio - Saldos Pendientes</span>
                  <span className="text-md font-semibold text-orange-600">
                    {formatMoney(metrica.financieras.saldosPendientes)}
                  </span>
                </div>
              </div>
            </div>
            
            {/* Progreso hacia meta */}
            <div className="mt-6">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-gray-600">Progreso hacia meta mensual</span>
                <span className="text-sm font-medium">
                  {formatPercent((metrica.financieras.ingresos / metaIngresos) * 100)}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className={`h-2 rounded-full ${
                    (metrica.financieras.ingresos / metaIngresos) * 100 >= 100 
                      ? 'bg-green-500' 
                      : (metrica.financieras.ingresos / metaIngresos) * 100 >= 80 
                      ? 'bg-yellow-500' 
                      : 'bg-red-500'
                  }`}
                  style={{ width: `${Math.min((metrica.financieras.ingresos / metaIngresos) * 100, 100)}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Gráfico de Tendencias */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Comparación de Ingresos vs Gastos</h3>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={[
            { name: metricas[0]?.sucursal.nombre, ingresos: metricas[0]?.financieras.ingresos, gastos: metricas[0]?.financieras.gastos, utilidad: metricas[0]?.financieras.utilidad },
            { name: metricas[1]?.sucursal.nombre, ingresos: metricas[1]?.financieras.ingresos, gastos: metricas[1]?.financieras.gastos, utilidad: metricas[1]?.financieras.utilidad }
          ]}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip formatter={(value: any) => [formatMoney(value), '']} />
            <Legend />
            <Bar dataKey="ingresos" fill="#82ca9d" name="Ingresos" />
            <Bar dataKey="gastos" fill="#ff7300" name="Gastos" />
            <Line type="monotone" dataKey="utilidad" stroke="#8884d8" strokeWidth={3} name="Utilidad" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  const VistaOperacional = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {metricas.map((metrica, index) => (
          <div key={metrica.sucursal.id} className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              {metrica.sucursal.nombre} - Métricas Operacionales
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {metrica.operacionales.totalCitas}
                </div>
                <div className="text-sm text-gray-600">Total Citas</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {metrica.operacionales.citasAtendidas}
                </div>
                <div className="text-sm text-gray-600">Atendidas</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">
                  {metrica.operacionales.citasCanceladas}
                </div>
                <div className="text-sm text-gray-600">Canceladas</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">
                  {formatPercent(metrica.operacionales.tasaConversion)}
                </div>
                <div className="text-sm text-gray-600">Tasa Conversión</div>
              </div>
            </div>
            
            <div className="mt-6 pt-4 border-t">
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <div className="text-xl font-bold text-orange-600">
                    {metrica.operacionales.pacientesUnicos}
                  </div>
                  <div className="text-sm text-gray-600">Pacientes Únicos</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-indigo-600">
                    {metrica.operacionales.trabajosLaboratorio}
                  </div>
                  <div className="text-sm text-gray-600">Trabajos Lab</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Gráfico de Estado de Citas */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Estado de Citas por Sucursal</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {metricas.map((metrica, index) => (
            <div key={metrica.sucursal.id}>
              <h4 className="text-md font-medium text-gray-700 mb-2 text-center">
                {metrica.sucursal.nombre}
              </h4>
              <ResponsiveContainer width="100%" height={200}>
                <RechartsPieChart>
                  <Pie
                    data={[
                      { name: 'Atendidas', value: metrica.operacionales.citasAtendidas, fill: '#82ca9d' },
                      { name: 'Pendientes', value: metrica.operacionales.totalCitas - metrica.operacionales.citasAtendidas - metrica.operacionales.citasCanceladas, fill: '#ffc658' },
                      { name: 'Canceladas', value: metrica.operacionales.citasCanceladas, fill: '#ff7300' }
                    ]}
                    cx="50%"
                    cy="50%"
                    outerRadius={60}
                    dataKey="value"
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  >
                    {[0, 1, 2].map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={['#82ca9d', '#ffc658', '#ff7300'][index]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </RechartsPieChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const VistaLaboratorio = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {metricas.map((metrica, index) => (
          <div key={metrica.sucursal.id} className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              {metrica.sucursal.nombre} - Laboratorio
            </h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Trabajos Totales</span>
                <span className="text-lg font-bold">{metrica.operacionales.trabajosLaboratorio}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Completados</span>
                <span className="text-lg font-bold text-green-600">{metrica.operacionales.trabajosCompletados}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Pendientes</span>
                <span className="text-lg font-bold text-orange-600">{metrica.operacionales.trabajosPendientes}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Presupuesto Total</span>
                <span className="text-lg font-bold text-blue-600">
                  {formatMoney(metrica.financieras.ingresosLaboratorio)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Abonos Recibidos</span>
                <span className="text-lg font-bold text-green-600">
                  {formatMoney(metrica.financieras.abonosLaboratorio)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Saldos Pendientes</span>
                <span className="text-lg font-bold text-red-600">
                  {formatMoney(metrica.financieras.saldosPendientes)}
                </span>
              </div>
            </div>

            {/* Progreso de cobros */}
            <div className="mt-6">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-gray-600">Progreso de Cobros</span>
                <span className="text-sm font-medium">
                  {formatPercent((metrica.financieras.abonosLaboratorio / metrica.financieras.ingresosLaboratorio) * 100)}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="h-2 rounded-full bg-blue-500"
                  style={{ 
                    width: `${Math.min((metrica.financieras.abonosLaboratorio / metrica.financieras.ingresosLaboratorio) * 100, 100)}%` 
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Comparación de eficiencia de laboratorio */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Eficiencia de Laboratorio</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={[
            { 
              name: metricas[0]?.sucursal.nombre, 
              completados: metricas[0]?.operacionales.trabajosCompletados,
              pendientes: metricas[0]?.operacionales.trabajosPendientes,
              eficiencia: (metricas[0]?.operacionales.trabajosCompletados / metricas[0]?.operacionales.trabajosLaboratorio) * 100
            },
            { 
              name: metricas[1]?.sucursal.nombre, 
              completados: metricas[1]?.operacionales.trabajosCompletados,
              pendientes: metricas[1]?.operacionales.trabajosPendientes,
              eficiencia: (metricas[1]?.operacionales.trabajosCompletados / metricas[1]?.operacionales.trabajosLaboratorio) * 100
            }
          ]}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="completados" fill="#82ca9d" name="Completados" />
            <Bar dataKey="pendientes" fill="#ffc658" name="Pendientes" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  const VistaDoctores = () => {
  const doctorData = useMemo(() => {
    console.log('🔍 DEBUG - sucursalesData[0].appointments[0]:', sucursalesData[0]?.appointments[0]);
    console.log('🔍 DEBUG - sucursalesData[0].payments[0]:', sucursalesData[0]?.payments[0]);
    console.log('🔍 DEBUG - sucursalesData[0].doctors[0]:', sucursalesData[0]?.doctors[0]);
    
    return sucursalesData.map(sucursal => ({
      sucursal: sucursal.nombre,
      doctores: sucursal.doctors.map(doctor => {
        const citasDoctor = sucursal.appointments.filter(a => a.doctor_id === doctor.id);
        const pagosDoctor = sucursal.payments.filter(p => {
          const appointment = sucursal.appointments.find(a => a.id === p.appointment_id);
          return appointment && appointment.doctor_id === doctor.id;
        });
        const ingresos = pagosDoctor.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
          
          return {
            ...doctor,
            citas: citasDoctor.length,
            citasAtendidas: citasDoctor.filter(c => c.status === 'Atendida').length,
            ingresos,
            tasaConversion: citasDoctor.length > 0 ? (citasDoctor.filter(c => c.status === 'Atendida').length / citasDoctor.length) * 100 : 0
          };
        })
      }));
    }, [sucursalesData]);

// Datos sanitizados para la gráfica de ingresos por doctor
const chartIngresosDoctores = doctorData.flatMap(sucursal => 
  sucursal.doctores.map(doctor => ({
    name: doctor.name,
    ingresosNum: doctor.ingresos
  }))
).filter(item => item.ingresosNum > 0);

    return (
      <div className="space-y-6">
        {doctorData.map((sucursalData, index) => (
          <div key={index} className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              {sucursalData.sucursal} - Desempeño por Doctor
            </h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Doctor
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Citas Totales
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Citas Atendidas
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Tasa Conversión
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Ingresos
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sucursalData.doctores.map((doctor, doctorIndex) => (
                    <tr key={doctorIndex}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div 
                            className="w-4 h-4 rounded-full mr-3"
                            style={{ backgroundColor: doctor.color }}
                          />
                          <div className="text-sm font-medium text-gray-900">
                            {doctor.name}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {doctor.citas}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {doctor.citasAtendidas}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          doctor.tasaConversion >= 80 
                            ? 'bg-green-100 text-green-800' 
                            : doctor.tasaConversion >= 60 
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {formatPercent(doctor.tasaConversion)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {formatMoney(doctor.ingresos)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

         {/* Espacio para forzar la gráfica hacia abajo */}
         <div style={{ height: '400px' }}></div>
         
         {/* Gráfico comparativo de doctores */}
<div className="bg-white rounded-lg shadow p-6">
  <h3 className="text-lg font-medium text-gray-900 mb-4">Comparación de Ingresos por Doctor</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartIngresosDoctores}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip
                formatter={(value: any) => {
                  const n = Number(value);
                  return Number.isFinite(n) ? [formatMoney(n), 'Ingresos'] : [String(value ?? ''), ''];
                }}
              />
              <Legend />
              <Bar dataKey="ingresosNum" name="Ingresos" fill="#8884d8" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  const renderVistaActual = () => {
    switch (vistaActiva) {
      case 'resumen': return <VistaResumen />;
      case 'financiero': return <VistaFinanciera />;
      case 'operacional': return <VistaOperacional />;
      case 'laboratorio': return <VistaLaboratorio />;
      case 'doctores': return <VistaDoctores />;
      case 'inventario': return <VistaInventario />;
      case 'servicios': return <VistaServicios />;
      default: return <VistaResumen />;
    }
  };


const exportToPDF = async () => {
  try {
    setExportando(true);
    setProgresoExport(0);

    // Oculta FAB para que no salga en la captura
    const fab = document.getElementById('fab-export');
    const originalDisplay = fab ? fab.style.display : '';
    if (fab) fab.style.display = 'none';

    // Asegurar layout estable de todos los ResponsiveContainer
    window.scrollTo(0, 0);                 // evita capturas parciales por scroll
    await wait(300);                       // micro pausa
    await waitForRechartsLayout();         // calcula width/height de charts
    window.dispatchEvent(new Event('resize'));
    await wait(400);
    setProgresoExport(10);

    // Fijar alturas de charts (evita blancos/cortes)
    ensureStableCharts();
    setProgresoExport(20);

    const root = document.getElementById('pdf-root') || exportRef.current!;
    if (!root) throw new Error('No se encontró el contenedor del PDF');

    // Captura con alta resolución + opciones de estabilidad
    const canvas = await html2canvas(root, {
      scale: 3,
      useCORS: true,
      allowTaint: false,
      logging: false,
      backgroundColor: '#ffffff',
      // Fuerza dimensiones reales del contenido para evitar “planos” en páginas 7/9/11
      width: root.scrollWidth,
      height: root.scrollHeight,
      windowWidth: Math.max(root.scrollWidth, 1600),
      windowHeight: root.scrollHeight,
      scrollX: 0,
      scrollY: 0,
      imageTimeout: 20000,
      removeContainer: true,
      letterRendering: true,
      // Neutraliza elementos pegajosos/animaciones que suelen provocar zonas en blanco
      onclone: (clonedDoc) => {
        const style = clonedDoc.createElement('style');
        style.textContent = `
          * { animation: none !important; transition: none !important; }
          .sticky { position: static !important; top: auto !important; }
          [class*="sticky top-"] { position: static !important; top: auto !important; }
        `;
        clonedDoc.head.appendChild(style);
      }
    });
    setProgresoExport(70);

    // Libera alturas inmediatamente tras la captura (además del finally)
    releaseCharts();

    // Crear PDF y paginar desplazando la imagen completa (evita cortes de gráficos)
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    const pageHeight = pdf.internal.pageSize.getHeight();

    let position = 0;
    while (position < pdfHeight) {
      pdf.addImage(
        imgData,
        'PNG',
        0,
         -position,
        pdfWidth,
        pdfHeight
      );
      position += pageHeight;
      if (position < pdfHeight) pdf.addPage();
    }

    setProgresoExport(95);
    pdf.save('dashboard-global.pdf');
    setProgresoExport(100);

    // Restaurar FAB
    if (fab) fab.style.display = originalDisplay || '';

  } catch (error: any) {
    alert(`Error al exportar PDF: ${error.message}`);
    setProgresoExport(0);
  } finally {
    // Restablecer estilos de charts por si algo quedó pendiente
    releaseCharts();
    setExportando(false);
  }
};

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-indigo-50">
      {/* Modal de Progreso de Exportación */}
      {exportando && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
            <div className="text-center">
              <div className="mb-4">
                <div className="bg-blue-100 p-4 rounded-full w-16 h-16 mx-auto flex items-center justify-center">
                  <Download className="h-8 w-8 text-blue-600 animate-bounce" />
                </div>
              </div>
              
              <h3 className="text-xl font-bold text-gray-900 mb-2">
                Generando PDF Completo
              </h3>
              
              <p className="text-gray-600 mb-6">
                Capturando todas las vistas del dashboard...
              </p>
              
              {/* Barra de Progreso */}
              <div className="w-full bg-gray-200 rounded-full h-3 mb-4">
                <div 
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 h-3 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${progresoExport}%` }}
                />
              </div>
              
              <div className="flex justify-between text-sm text-gray-500 mb-4">
                <span>Progreso</span>
                <span>{progresoExport}%</span>
              </div>
              
              <div className="text-sm text-gray-700">
                {progresoExport === 0 && "Iniciando exportación..."}
                {progresoExport > 0 && progresoExport < 20 && "Capturando vista de Resumen..."}
                {progresoExport >= 20 && progresoExport < 35 && "Procesando datos Financieros..."}
                {progresoExport >= 35 && progresoExport < 50 && "Analizando métricas Operacionales..."}
                {progresoExport >= 50 && progresoExport < 65 && "Exportando datos de Laboratorio..."}
                {progresoExport >= 65 && progresoExport < 80 && "Compilando información de Doctores..."}
                {progresoExport >= 80 && progresoExport < 95 && "Finalizando Inventario y Servicios..."}
                {progresoExport >= 95 && progresoExport < 100 && "Generando archivo PDF..."}
                {progresoExport === 100 && "¡Completado! Descargando archivo..."}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Header Profesional */}
      <div className="bg-white shadow-xl border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-3 rounded-2xl shadow-lg">
                  <Building2 className="h-8 w-8 text-white" />
                </div>
                <div>
                  <h1 className="text-4xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
                    Dashboard Global
                  </h1>
                  <p className="mt-2 text-lg text-gray-600">
                    Análisis comparativo integral • {fechaInicio} al {fechaFin}
                  </p>
                  <div className="flex items-center mt-2 space-x-4">
                    <div className="flex items-center text-sm text-gray-500">
                      <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
                      Datos en tiempo real
                    </div>
                    <div className="text-sm text-gray-500">
                      {sucursalesData.length} sucursales conectadas
                    </div>
                  </div>
                </div>
              </div>
              {/*
                FIX MOBILE:
                - En pantallas pequeñas, el bloque derecho se apila (evita overflow horizontal)
                - Inputs y botón toman ancho completo y se acomodan con gap
              */}
              <div className="flex flex-col md:flex-row md:items-center md:space-x-4 space-y-4 md:space-y-0 w-full md:w-auto">
                <div className="hidden md:flex items-center space-x-6 bg-gradient-to-r from-gray-50 to-white rounded-2xl px-6 py-4 border border-gray-200 shadow-sm">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">
                      {formatMoney(metricas.reduce((sum, m) => sum + (Number(m?.financieras?.ingresos) || 0), 0))}
                    </div>
                    <div className="text-xs text-gray-600 font-medium">Ingresos Totales</div>
                  </div>
                  <div className="w-px h-8 bg-gray-300"></div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {formatMoney(metricas.reduce((sum, m) => sum + (Number(m?.financieras?.utilidad) || 0), 0))}
                    </div>
                    <div className="text-xs text-gray-600 font-medium">Utilidad Total</div>
                  </div>
                  <div className="w-px h-8 bg-gray-300"></div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-600">
                      {metricas.reduce((sum, m) => sum + m.operacionales.pacientesUnicos, 0)}
                    </div>
                    <div className="text-xs text-gray-600 font-medium">Pacientes Únicos</div>
                  </div>
                </div>
                
                {/* Controles (responsive) */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full md:w-auto">
                  <div className="flex flex-wrap items-center gap-2 bg-white rounded-xl px-4 py-3 border border-gray-200 shadow-sm w-full sm:w-auto">
                    <Calendar className="h-5 w-5 text-gray-400" />
                    <input
                      type="date"
                      value={fechaInicio}
                      onChange={(e) => setFechaInicio(e.target.value)}
                      className="border-0 focus:ring-0 text-sm font-medium text-gray-700 min-w-0 w-full sm:w-auto"
                    />
                    <span className="text-gray-400">a</span>
                    <input
                      type="date"
                      value={fechaFin}
                      onChange={(e) => setFechaFin(e.target.value)}
                      className="border-0 focus:ring-0 text-sm font-medium text-gray-700 min-w-0 w-full sm:w-auto"
                    />
                  </div>
                  <button
                    onClick={cargarDatosSucursales}
                    disabled={loading}
                    className="inline-flex items-center justify-center px-6 py-3 border border-transparent rounded-xl shadow-lg text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 transition-all duration-200 transform hover:scale-105 w-full sm:w-auto"
                  >
                    <RefreshCw className={`h-5 w-5 mr-2 ${loading ? 'animate-spin' : ''}`} />
                    {loading ? 'Actualizando...' : 'Actualizar'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs Mejoradas */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-1 overflow-x-auto py-2">
            {[
              { key: 'resumen', label: 'Resumen', icon: BarChart3, color: 'blue' },
              { key: 'financiero', label: 'Financiero', icon: DollarSign, color: 'green' },
              { key: 'operacional', label: 'Operacional', icon: Activity, color: 'purple' },
              { key: 'laboratorio', label: 'Laboratorio', icon: TestTube, color: 'orange' },
              { key: 'doctores', label: 'Doctores', icon: Stethoscope, color: 'indigo' },
              { key: 'inventario', label: 'Inventario', icon: Package, color: 'red' },
              { key: 'servicios', label: 'Servicios', icon: Star, color: 'emerald' }
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setVistaActiva(tab.key as any)}
                className={`relative flex items-center space-x-3 px-6 py-4 rounded-xl font-medium text-sm transition-all duration-200 transform hover:scale-105 whitespace-nowrap ${
                  vistaActiva === tab.key
                    ? `bg-gradient-to-r from-${tab.color}-500 to-${tab.color}-600 text-white shadow-lg`
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <tab.icon className="h-5 w-5" />
                <span>{tab.label}</span>
                {vistaActiva === tab.key && (
                  <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-white rounded-full shadow-lg"></div>
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Controls Modernos */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="flex items-center space-x-6">
              <div className="flex items-center space-x-3">
                <div className="bg-blue-100 p-2 rounded-lg">
                  <Target className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Meta de Ingresos</label>
                  <input
                    type="number"
                    value={metaIngresos}
                    onChange={(e) => setMetaIngresos(Number(e.target.value))}
                    className="mt-1 block border border-gray-300 rounded-lg px-3 py-2 text-sm w-32 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="50000"
                  />
                </div>
              </div>
              
              <div className="flex items-center space-x-3">
                <div className="bg-green-100 p-2 rounded-lg">
                  <Wifi className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-700">Estado del Sistema</div>
                  <div className="text-xs text-green-600">Conectado • API v2.1</div>
                </div>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
  <div className="flex items-center space-x-2 text-sm text-gray-500">
    <Clock className="h-4 w-4" />
    <span>Última actualización: {new Date().toLocaleString('es-MX')}</span>
  </div>
</div>
</div>
</div>
</div>
      {/* Content */}
      <div
  ref={exportRef}
  id="pdf-root"
  className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12 bg-white"
>
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 bg-white rounded-2xl shadow-lg">
            <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mb-4"></div>
            <div className="text-lg font-medium text-gray-700 mb-2">Cargando datos...</div>
            <div className="text-sm text-gray-500">Procesando información de ambas sucursales</div>
          </div>
        ) : (
          renderVistaActual()
        )}
      </div>

      {/* Floating Action Button (solo el verde) */}
<div className="fixed bottom-6 right-6">
  <button
    id="fab-export"
    onClick={exportToPDF}
    disabled={exportando}
    className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-full p-4 shadow-2xl transition-all duration-200 transform hover:scale-110 disabled:opacity-60"
    title="Descargar PDF"
  >
    <ArrowDownCircle className="h-6 w-6" />
  </button>
</div>
    </div>
  );
};

export default GlobalDashboard;

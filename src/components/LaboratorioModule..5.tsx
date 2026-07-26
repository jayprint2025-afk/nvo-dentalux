import React, { useEffect, useMemo, useState } from "react";
import { Plus, DollarSign, Edit, Check, X, CreditCard } from "lucide-react";
import { api } from '../lib/api';

/**************************** Tipos ****************************/
export type Service = { id: string; name: string };
export type Laboratorio = { id: string; nombre: string; contacto?: string };
export type Abono = { id: string; monto: number; fecha: string; nota?: string };
export type PagoLaboratorio = { id: string; trabajo_id: string; monto: number; fecha: string; };
export type TrabajoLaboratorio = {
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

/**************************** Utils ****************************/
const STORAGE_KEYS = {
  laboratorios: "dentalux_laboratorios",
  trabajos: "dentalux_trabajos",
} as const;

const today = new Date();
const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

const totalAbonado = (t: TrabajoLaboratorio) =>
  t.abonos.reduce((s, a) => s + a.monto, 0);
const saldoPendiente = (t: TrabajoLaboratorio) => t.presupuesto - totalAbonado(t);

/**************************** Store local (fallback) ****************************/
function useLocalLabStore(initial?: {
  laboratorios?: Laboratorio[];
  trabajos?: TrabajoLaboratorio[];
}) {
  const [laboratorios, setLaboratorios] = useState<Laboratorio[]>([]);
  const [trabajos, setTrabajos] = useState<TrabajoLaboratorio[]>([]);
  const [pagosLaboratorio, setPagosLaboratorio] = useState<PagoLaboratorio[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = () => {
      const lsLabs = localStorage.getItem(STORAGE_KEYS.laboratorios);
      const lsJobs = localStorage.getItem(STORAGE_KEYS.trabajos);
      const labs = lsLabs ? (JSON.parse(lsLabs) as Laboratorio[]) : initial?.laboratorios || [];
      const jobs = lsJobs ? (JSON.parse(lsJobs) as TrabajoLaboratorio[]) : initial?.trabajos || [];
      setLaboratorios(labs);
      setTrabajos(jobs);
      setIsLoading(false);
    };
    load();
  }, []);

  const persist = (labs: Laboratorio[], jobs: TrabajoLaboratorio[]) => {
    localStorage.setItem(STORAGE_KEYS.laboratorios, JSON.stringify(labs));
    localStorage.setItem(STORAGE_KEYS.trabajos, JSON.stringify(jobs));
  };

  const addLaboratorio = (payload: Omit<Laboratorio, "id"> | Laboratorio) => {
    const lab: Laboratorio = "id" in payload ? payload as Laboratorio : { id: Date.now().toString(), ...(payload as Omit<Laboratorio,"id">) };
    const next = [...laboratorios, lab];
    setLaboratorios(next);
    persist(next, trabajos);
    return lab;
  };

  const addTrabajo = (payload: Omit<TrabajoLaboratorio, "id" | "abonos"> | TrabajoLaboratorio) => {
    const job: TrabajoLaboratorio = "id" in payload ? payload as TrabajoLaboratorio : { id: Date.now().toString(), abonos: [], ...(payload as Omit<TrabajoLaboratorio,"id"|"abonos">) };
    const next = [job, ...trabajos];
    setTrabajos(next);
    persist(laboratorios, next);
    return job;
  };

  const updateTrabajo = (id: string, updates: Partial<TrabajoLaboratorio>) => {
    const next = trabajos.map((t) => (t.id === id ? { ...t, ...updates } : t));
    setTrabajos(next);
    persist(laboratorios, next);
  };

  const addAbono = (trabajoId: string, abono: Omit<Abono, "id">) => {
    const next = trabajos.map((t) =>
      t.id === trabajoId
        ? { ...t, abonos: [...t.abonos, { id: Date.now().toString(), ...abono }] }
        : t
    );
    setTrabajos(next);
    persist(laboratorios, next);
  };

  return {
    isLoading,
    laboratorios,
    trabajos,
    pagosLaboratorio,
    setPagosLaboratorio,
    addLaboratorio,
    addTrabajo,
    updateTrabajo,
    addAbono,
  } as const;
}

/**************************** Props del módulo ****************************/
export type LaboratorioModuleProps = {
  services?: Service[]; // Para mostrar el nombre del servicio
  initialLaboratorios?: Laboratorio[]; // Opcional: precargar labs
  initialTrabajos?: TrabajoLaboratorio[]; // Opcional: precargar trabajos
  // Callbacks opcionales para enganchar a tu backend. Si no se pasan, usa localStorage.
  onCreateLaboratorio?: (payload: Omit<Laboratorio, "id">) => Promise<Laboratorio> | Laboratorio | void;
  onCreateTrabajo?: (
    payload: Omit<TrabajoLaboratorio, "id" | "abonos">
  ) => Promise<TrabajoLaboratorio | void> | TrabajoLaboratorio | void;
  onUpdateTrabajo?: (id: string, updates: Partial<TrabajoLaboratorio>) => Promise<void> | void;
  onAddAbono?: (trabajoId: string, abono: Omit<Abono, "id">) => Promise<void> | void;
  onAddPagoLaboratorio?: (trabajoId: string, monto: number, fecha: string) => Promise<void> | void;
};

/**************************** Componente ****************************/
export default function LaboratorioModule({
  services = [
    { id: "1", name: "Limpieza dental" },
    { id: "2", name: "Corona" },
    { id: "3", name: "Endodoncia" },
    { id: "4", name: "Implante" },
  ],
  initialLaboratorios,
  initialTrabajos,
  onCreateLaboratorio,
  onCreateTrabajo,
  onUpdateTrabajo,
  onAddAbono,
  onAddPagoLaboratorio,
}: LaboratorioModuleProps) {
  // Store fallback en localStorage
  const store = useLocalLabStore({
    laboratorios: initialLaboratorios,
    trabajos: initialTrabajos,
  });

  const laboratorios = store.laboratorios;
  const trabajos = store.trabajos;
  const pagosLaboratorio = store.pagosLaboratorio;

  // Formularios
  const [newLaboratorio, setNewLaboratorio] = useState({ nombre: "", contacto: "" });
  const [newTrabajo, setNewTrabajo] = useState({
    paciente: "",
    laboratorioId: "",
    servicioId: "",
    presupuesto: "",
    fechaInicio: fmtDate(today),
    fechaEntregaEstimada: fmtDate(addDays(today, 7)),
    etapa: "Toma de impresión",
    notas: "",
  });
  const [newAbono, setNewAbono] = useState({ trabajoId: "", monto: "", fecha: fmtDate(today), nota: "" });

  // Estado UI
  const [laboratorioFilter, setLaboratorioFilter] = useState<"todos" | "pendientes" | "entregados">("todos");
  const [selectedLaboratorioFilter, setSelectedLaboratorioFilter] = useState("");
  const [editingTrabajo, setEditingTrabajo] = useState<TrabajoLaboratorio | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 🆕 Estados para pagar laboratorio
  const [pagoLaboratorioInput, setPagoLaboratorioInput] = useState<{[key: string]: string}>({});
  const [showPagoForm, setShowPagoForm] = useState<{[key: string]: boolean}>({});

  // Helpers
  const serviceById = (id?: string) => services.find((s) => s.id === id);
  const laboratorioById = (id: string) => laboratorios.find((l) => l.id === id);

  // 🆕 Helper para calcular total de pagos de laboratorio por trabajo
  const totalPagosLaboratorio = (trabajoId: string) =>
    pagosLaboratorio.filter(p => p.trabajo_id === trabajoId).reduce((sum, p) => sum + p.monto, 0);

  // 🆕 Helper para calcular resultado de la operación independiente
  const calcularResultadoPagoLab = (trabajo: TrabajoLaboratorio) => {
    const totalPagado = totalPagosLaboratorio(trabajo.id);
    return trabajo.presupuesto - totalPagado;
  };

  // 🆕 Cargar pagos de laboratorio al inicio
  useEffect(() => {
    const loadPagosLaboratorio = async () => {
      try {
        const pagos = await api('/pagos-laboratorio');
store.setPagosLaboratorio(pagos as any);
        if (response.ok) {
          const pagos = await response.json();
          store.setPagosLaboratorio(pagos);
        }
      } catch (error) {
        console.warn('Error cargando pagos laboratorio:', error);
      }
    };
    
    if (!store.isLoading) {
      loadPagosLaboratorio();
    }
  }, [store.isLoading]);

  const trabajosFiltrados = useMemo(() => {
    let filtered = trabajos;
    if (selectedLaboratorioFilter) filtered = filtered.filter((t) => t.laboratorioId === selectedLaboratorioFilter);
    if (laboratorioFilter === "pendientes") filtered = filtered.filter((t) => t.etapa !== "Entregado");
    else if (laboratorioFilter === "entregados") filtered = filtered.filter((t) => t.etapa === "Entregado");
    return [...filtered].sort((a, b) => new Date(b.fechaInicio).getTime() - new Date(a.fechaInicio).getTime());
  }, [trabajos, laboratorioFilter, selectedLaboratorioFilter]);

  const estadisticas = useMemo(() => {
    const pendientes = trabajos.filter((t) => t.etapa !== "Entregado");
    const entregados = trabajos.filter((t) => t.etapa === "Entregado");
    return {
      trabajosPendientes: pendientes.length,
      trabajosEntregados: entregados.length,
      montoTotalPendiente: pendientes.reduce((sum, t) => sum + t.presupuesto, 0),
      montoTotalAbonado: trabajos.reduce((sum, t) => sum + totalAbonado(t), 0),
      saldoTotalPendiente: trabajos.reduce((sum, t) => sum + saldoPendiente(t), 0),
    };
  }, [trabajos]);

  /*********************** Acciones ***********************/
  const handleAddLaboratorio = async () => {
    setErrorMsg(null);
    try {
    if (!newLaboratorio.nombre.trim()) return;
    if (onCreateLaboratorio) {
      const created = await onCreateLaboratorio({ nombre: newLaboratorio.nombre.trim(), contacto: newLaboratorio.contacto.trim() });
      if (created) store.addLaboratorio(created as any);
      else store.addLaboratorio({ nombre: newLaboratorio.nombre.trim(), contacto: newLaboratorio.contacto.trim() });
    } else {
      store.addLaboratorio({ nombre: newLaboratorio.nombre.trim(), contacto: newLaboratorio.contacto.trim() });
    }
    setNewLaboratorio({ nombre: "", contacto: "" });
    } catch (e:any) {
      setErrorMsg(e?.message || 'No se pudo crear el laboratorio');
      // fallback local
      store.addLaboratorio({ nombre: newLaboratorio.nombre.trim(), contacto: newLaboratorio.contacto.trim() });
      setNewLaboratorio({ nombre: "", contacto: "" });
    }
  };

  const handleAddTrabajo = async () => {
    setErrorMsg(null);
    try {
    if (!newTrabajo.paciente || !newTrabajo.laboratorioId || !newTrabajo.servicioId || !newTrabajo.presupuesto) return;
    const payload = {
      paciente: newTrabajo.paciente,
      laboratorioId: newTrabajo.laboratorioId,
      servicioId: newTrabajo.servicioId,
      presupuesto: Number(newTrabajo.presupuesto),
      fechaInicio: newTrabajo.fechaInicio,
      fechaEntregaEstimada: newTrabajo.fechaEntregaEstimada,
      etapa: newTrabajo.etapa,
      notas: newTrabajo.notas,
    } as Omit<TrabajoLaboratorio, "id" | "abonos">;
    if (onCreateTrabajo) {
      const created = await onCreateTrabajo(payload);
      if (created) store.addTrabajo(created as any);
      else store.addTrabajo(payload);
    } else {
      store.addTrabajo(payload);
    }
    setNewTrabajo({
      paciente: "",
      laboratorioId: "",
      servicioId: "",
      presupuesto: "",
      fechaInicio: fmtDate(today),
      fechaEntregaEstimada: fmtDate(addDays(today, 7)),
      etapa: "Toma de impresión",
      notas: "",
    });
    } catch (e:any) {
      setErrorMsg(e?.message || 'No se pudo crear el trabajo, guardado localmente');
      // fallback local si fallo API
      store.addTrabajo(payload);
    }
  };

  const handleAddAbono = async () => {
    if (!newAbono.trabajoId || !newAbono.monto) return;
    const abonoPayload = { monto: Number(newAbono.monto), fecha: newAbono.fecha, nota: newAbono.nota } as Omit<Abono, "id">;
    if (onAddAbono) {
      await onAddAbono(newAbono.trabajoId, abonoPayload);
      store.addAbono(newAbono.trabajoId, abonoPayload);
    } else {
      store.addAbono(newAbono.trabajoId, abonoPayload);
    }
    setNewAbono({ trabajoId: "", monto: "", fecha: fmtDate(today), nota: "" });
  };

  const handleUpdateTrabajo = async (id: string, updates: Partial<TrabajoLaboratorio>) => {
    if (onUpdateTrabajo) await onUpdateTrabajo(id, updates);
    else store.updateTrabajo(id, updates);
  };

  // 🆕 Función para pagar laboratorio
  const handlePagarLaboratorio = async (trabajoId: string) => {
    const monto = Number(pagoLaboratorioInput[trabajoId]);
    if (!monto || monto <= 0) return;

    try {
      if (onAddPagoLaboratorio) {
        await onAddPagoLaboratorio(trabajoId, monto, fmtDate(today));
      } else {
        // Fallback: crear objeto local
        const nuevoPago: PagoLaboratorio = {
          id: Date.now().toString(),
          trabajo_id: trabajoId,
          monto: monto,
          fecha: fmtDate(today)
        };
        store.setPagosLaboratorio(prev => [...prev, nuevoPago]);
      }
      
      // Limpiar formulario
      setPagoLaboratorioInput(prev => ({ ...prev, [trabajoId]: "" }));
      setShowPagoForm(prev => ({ ...prev, [trabajoId]: false }));
    } catch (error) {
      console.error('Error al procesar pago:', error);
      setErrorMsg('Error al procesar el pago');
    }
  };

  if (store.isLoading) {
    return (
      <div className="min-h-[200px] grid place-items-center">
        <div className="text-gray-600 text-sm">Cargando módulo de Laboratorio…</div>
      </div>
    );
  }

  /*********************** UI ***********************/
  return (
    <div className="space-y-8">
      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded">
          {errorMsg}
        </div>
      )}
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
            onClick={handleAddLaboratorio}
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
            {laboratorios.map((lab) => (
              <option key={lab.id} value={lab.id}>
                {lab.nombre}
              </option>
            ))}
          </select>
          <select
            className="px-3 py-2 rounded text-gray-900"
            value={newTrabajo.servicioId}
            onChange={(e) => setNewTrabajo({ ...newTrabajo, servicioId: e.target.value })}
          >
            <option value="">Tipo de trabajo</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
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
            onClick={handleAddTrabajo}
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
          <div className="text-3xl font-bold text-orange-600">{estadisticas.trabajosPendientes}</div>
          <div className="text-sm text-gray-500 mt-1">Trabajos Pendientes</div>
        </div>
        <div className="bg-white border rounded-xl p-6 text-center shadow-sm">
          <div className="text-3xl font-bold text-green-600">{estadisticas.trabajosEntregados}</div>
          <div className="text-sm text-gray-500 mt-1">Trabajos Entregados</div>
        </div>
        <div className="bg-white border rounded-xl p-6 text-center shadow-sm">
          <div className="text-3xl font-bold text-blue-600">${estadisticas.montoTotalPendiente.toLocaleString()}</div>
          <div className="text-sm text-gray-500 mt-1">Monto Pendiente</div>
        </div>
        <div className="bg-white border rounded-xl p-6 text-center shadow-sm">
          <div className="text-3xl font-bold text-purple-600">${estadisticas.montoTotalAbonado.toLocaleString()}</div>
          <div className="text-sm text-gray-500 mt-1">Total Abonado</div>
        </div>
        <div className="bg-white border rounded-xl p-6 text-center shadow-sm">
          <div className="text-3xl font-bold text-red-600">${estadisticas.saldoTotalPendiente.toLocaleString()}</div>
          <div className="text-sm text-gray-500 mt-1">Saldo Pendiente</div>
        </div>
      </div>

      {/* Registrar Abono */}
      <div className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl p-6 text-white">
        <h2 className="text-xl font-bold mb-4 flex items-center">
          <DollarSign className="w-5 h-5 mr-2" /> Registrar Abono
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
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
            onClick={handleAddAbono}
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
            {laboratorios.map((lab) => (
              <option key={lab.id} value={lab.id}>
                {lab.nombre}
              </option>
            ))}
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
                        onClick={() => handleUpdateTrabajo(t.id, { etapa: "Entregado", notas: t.notas })}
                        className="px-3 py-2 bg-green-500 text-white rounded hover:bg-green-600 text-sm flex items-center gap-2"
                      >
                        <Check className="w-4 h-4" /> Marcar Entregado
                      </button>
                    )}
                  </div>
                </div>

                {/* 🆕 PAGAR LABORATORIO */}
                <div className="mt-4 pt-4 border-t">
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => setShowPagoForm(prev => ({ ...prev, [t.id]: !prev[t.id] }))}
                      className="px-4 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-600 text-sm flex items-center gap-2"
                    >
                      <CreditCard className="w-4 h-4" /> Pagar Laboratorio
                    </button>
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-bold bg-gray-100 px-2 py-1 rounded text-gray-700">
                        TBE
                      </div>
                      <div className="text-sm font-bold text-green-600 bg-green-50 px-3 py-1 rounded">
                        ${calcularResultadoPagoLab(t).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  
                  {showPagoForm[t.id] && (
                    <div className="mt-3 p-4 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <input
                          type="number"
                          className="px-3 py-2 rounded border text-gray-900 flex-1"
                          placeholder="Monto a pagar"
                          value={pagoLaboratorioInput[t.id] || ""}
                          onChange={(e) => setPagoLaboratorioInput(prev => ({ ...prev, [t.id]: e.target.value }))}
                        />
                        <button
                          onClick={() => handlePagarLaboratorio(t.id)}
                          disabled={!pagoLaboratorioInput[t.id] || Number(pagoLaboratorioInput[t.id]) <= 0}
                          className={`px-4 py-2 rounded font-medium text-sm ${
                            !pagoLaboratorioInput[t.id] || Number(pagoLaboratorioInput[t.id]) <= 0
                              ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                              : "bg-indigo-600 text-white hover:bg-indigo-700"
                          }`}
                        >
                          Procesar Pago
                        </button>
                        <button
                          onClick={() => setShowPagoForm(prev => ({ ...prev, [t.id]: false }))}
                          className="px-3 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 text-sm"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Historial de abonos */}
                {t.abonos.length > 0 && (
                  <div className="mt-4 pt-4 border-t">
                    <h5 className="font-medium text-gray-700 mb-2">Historial de Abonos</h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {t.abonos.map((a) => (
                        <div key={a.id} className="flex items-center justify-between bg-green-50 p-2 rounded">
                          <div>
                            <div className="font-medium text-green-700">${a.monto.toLocaleString()}</div>
                            <div className="text-xs text-gray-500">{a.fecha}</div>
                            {a.nota && <div className="text-xs text-gray-600">{a.nota}</div>}
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
        {laboratorios.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {laboratorios.map((lab) => (
              <div key={lab.id} className="border rounded-lg p-4 hover:bg-gray-50">
                <h4 className="font-semibold text-gray-800">{lab.nombre}</h4>
                <p className="text-sm text-gray-600">{lab.contacto}</p>
                <div className="text-xs text-gray-500 mt-2">
                  {trabajos.filter((t) => t.laboratorioId === lab.id).length} trabajos
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
                  await handleUpdateTrabajo(editingTrabajo.id, { etapa: editingTrabajo.etapa, notas: editingTrabajo.notas });
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
  );
}
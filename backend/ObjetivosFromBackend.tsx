import React, { useEffect, useMemo, useState } from "react";

/**
 * ObjetivosModule — Integrado con Agenda (doctores) y Caja (pagos)
 * - Config: "Agregar doctor" lista los doctores de la Agenda para importarlos a la tabla.
 * - Resultados: muestra ingresos por doctor desde pagos de Caja (filtro por fechas).
 * - Detalle por doctor: panel desplegable con movimientos por día + acumulado.
 * - Acumulado semanal por doctor vs meta semanal, con selector de semana (hoy / hasta).
 * - 🆕 Reporte Detallado: Totales por doctor por método de pago + totales globales + gastos + neto.
 *
 * Props esperadas (opcionales, el módulo funciona en modo manual si no llegan):
 *   doctorsFromAgenda?: Array<{ id: string; name: string }>
 *   payments?: Array<Payment>
 *
 * Donde Payment es:
 *   {
 *     doctorId: string;
 *     amount: number;
 *     date: string; // YYYY-MM-DD
 *     method?: "efectivo" | "tarjeta" | "transferencia" | "otro";
 *     patient?: string; service?: string; note?: string; id?: string|number
 *   }
 */

// ===== Tipos =====
type DoctorConfig = {
  id: string;
  nombre: string;
  baseMeta: number;
  crecimientoPct: number;
  bonoAlcancePct: number;
  bonoSuperMetaPct: number;
  comisionPct: number;
};

type PaymentMethod = "efectivo" | "tarjeta" | "transferencia" | "otro";

export type Payment = {
  doctorId: string;
  amount: number;
  date: string; // YYYY-MM-DD
  method?: PaymentMethod; // 🆕
  patient?: string;
  service?: string;
  note?: string;
  id?: string | number;
};

type IngresosPorMes = {
  // monthKey YYYY-MM -> { doctorId: ingresos }
  [monthKey: string]: Record<string, number>;
};

type ObjetivosProps = {
  doctorsFromAgenda?: Array<{ id: string; name: string }>;
  payments?: Array<Payment>;
};

type Expense = {
  id: string;
  date: string; // YYYY-MM-DD
  concept: string;
  amount: number;
  paidBy: "efectivo" | "banco"; // banco = tarjeta/transferencia
  note?: string;
};

// ===== Constantes =====
const CONFIG_STORAGE_KEY = "dentalux-config-v2";
const DATA_STORAGE_KEY = "dentalux-ingresos-v1";
const EXPENSES_STORAGE_KEY = "dentalux-expenses-v1"; // 🆕
const CONFIG_PASSWORD = "Dentalux";

const defaultDoctors: DoctorConfig[] = [
  { id: "doc-david", nombre: "David", baseMeta: 100_000, crecimientoPct: 10, bonoAlcancePct: 10, bonoSuperMetaPct: 20, comisionPct: 20 },
  { id: "doc-yara", nombre: "Yara", baseMeta: 100_000, crecimientoPct: 10, bonoAlcancePct: 10, bonoSuperMetaPct: 20, comisionPct: 20 },
  { id: "doc-angela", nombre: "Angela", baseMeta: 100_000, crecimientoPct: 10, bonoAlcancePct: 10, bonoSuperMetaPct: 20, comisionPct: 20 },
  { id: "doc-paoly", nombre: "Paoly", baseMeta: 100_000, crecimientoPct: 10, bonoAlcancePct: 10, bonoSuperMetaPct: 20, comisionPct: 20 },
];

// ===== Utils =====
function useLocalStorage<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // ignore
    }
  }, [key, state]);
  return [state, setState] as const;
}

function monthKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
const mxn = (n: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
const pctTxt = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;
function clampNumber(num: number, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return Number.isFinite(num) ? Math.min(Math.max(num, min), max) : 0;
}
function randomId() {
  return `id-${Math.random().toString(36).slice(2, 10)}`;
}
function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
function parseDate(s: string) {
  return new Date(s + "T00:00:00");
}
function isInRange(dateStr: string, from: string, to: string) {
  const d = parseDate(dateStr);
  return d >= parseDate(from) && d <= parseDate(to);
}
function getWeekStart(d: Date) {
  const r = new Date(d);
  const day = (r.getDay() + 6) % 7; // lunes=0
  r.setDate(r.getDate() - day);
  r.setHours(0, 0, 0, 0);
  return r;
}
function normalizeMethod(m?: PaymentMethod): PaymentMethod | "sin-metodo" {
  if (!m) return "sin-metodo";
  if (m === "efectivo" || m === "tarjeta" || m === "transferencia" || m === "otro") return m;
  return "sin-metodo";
}

// ===== Componente =====
type Tab = "resultados" | "reporte" | "config";
type ModoDatos = "manual" | "pagos";
type SemanaModo = "hoy" | "hasta";

export default function ObjetivosModule({ doctorsFromAgenda, payments }: ObjetivosProps) {
  const [tab, setTab] = useState<Tab>("resultados");
  const [configUnlocked, setConfigUnlocked] = useState(false);

  // Config doctores (persistente en localStorage)
  const [doctores, setDoctores] = useLocalStorage<DoctorConfig[]>(CONFIG_STORAGE_KEY, defaultDoctors);

  // Ingresos manuales por mes (modo manual)
  const [ingresosPorMes, setIngresosPorMes] = useLocalStorage<IngresosPorMes>(DATA_STORAGE_KEY, {});

  // 🆕 Gastos (persistente)
  const [gastos, setGastos] = useLocalStorage<Expense[]>(EXPENSES_STORAGE_KEY, []);

  // Mes + rango de fechas
  const [mes, setMes] = useState<string>(monthKey());
  const monthStart = useMemo(() => new Date(`${mes}-01T00:00:00`), [mes]);
  const monthEnd = useMemo(() => {
    const d = new Date(`${mes}-01T00:00:00`);
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    return d;
  }, [mes]);
  const [desde, setDesde] = useState<string>(fmtDate(monthStart));
  const [hasta, setHasta] = useState<string>(fmtDate(monthEnd));
  useEffect(() => {
    setDesde(fmtDate(monthStart));
    setHasta(fmtDate(monthEnd));
  }, [mes, monthStart, monthEnd]);

  // Modo de datos: pagos (si hay) o manual
  const [modoDatos, setModoDatos] = useState<ModoDatos>(payments && payments.length ? "pagos" : "manual");

  // Mantener ingresos manuales sincronizados con doctores
  useEffect(() => {
    setIngresosPorMes((prev) => {
      const current = { ...(prev[mes] || {}) };
      let changed = false;
      doctores.forEach((d) => {
        if (!(d.id in current)) {
          current[d.id] = 0;
          changed = true;
        }
      });
      Object.keys(current).forEach((id) => {
        if (!doctores.some((d) => d.id === id)) {
          delete current[id];
          changed = true;
        }
      });
      if (!changed) return prev;
      return { ...prev, [mes]: current };
    });
  }, [mes, doctores, setIngresosPorMes]);

  const ingresosMesActual = ingresosPorMes[mes] || {};
  const setIngreso = (doctorId: string, value: number) =>
    setIngresosPorMes((prev) => ({
      ...prev,
      [mes]: { ...(prev[mes] || {}), [doctorId]: clampNumber(value, 0) },
    }));

  // ===== Agregación desde pagos (modo 'pagos') =====
  const ingresosDesdePagos = useMemo(() => {
    if (!payments || payments.length === 0) return {};
    const agg: Record<string, number> = {};
    for (const p of payments) {
      if (!p || typeof p.amount !== "number" || !p.date) continue;
      if (!isInRange(p.date, desde, hasta)) continue;
      const k = p.doctorId;
      agg[k] = (agg[k] || 0) + p.amount;
    }
    return agg;
  }, [payments, desde, hasta]);

  const ingresosFuente: Record<string, number> = useMemo(() => {
    return modoDatos === "pagos" ? ingresosDesdePagos : ingresosMesActual;
  }, [modoDatos, ingresosDesdePagos, ingresosMesActual]);

  // ===== Filas calculadas (tabla principal) =====
  const filas = useMemo(() => {
    return doctores.map((d) => {
      const ingresos = ingresosFuente[d.id] ?? 0;
      const metaProyectada = Math.round(d.baseMeta * (1 + d.crecimientoPct / 100));
      const avancePct = metaProyectada > 0 ? (ingresos / metaProyectada) * 100 : 0;
      const bonoAplicablePct = avancePct >= 120 ? d.bonoSuperMetaPct : avancePct >= 100 ? d.bonoAlcancePct : 0;
      const bono = Math.round((ingresos * bonoAplicablePct) / 100);
      const comision = Math.round((ingresos * d.comisionPct) / 100);
      const faltante = Math.max(0, metaProyectada - ingresos);
      const status: "ok" | "warn" | "bad" = avancePct >= 100 ? "ok" : avancePct >= 70 ? "warn" : "bad";
      return { ...d, ingresos, metaProyectada, avancePct, bonoAplicablePct, bono, comision, faltante, status };
    });
  }, [doctores, ingresosFuente]);

  const totales = useMemo(() => {
    const ingresos = filas.reduce((acc, f) => acc + f.ingresos, 0);
    const meta = filas.reduce((acc, f) => acc + f.metaProyectada, 0);
    const avancePct = meta > 0 ? (ingresos / meta) * 100 : 0;
    const bonos = filas.reduce((acc, f) => acc + f.bono, 0);
    const comisiones = filas.reduce((acc, f) => acc + f.comision, 0);
    return { ingresos, meta, avancePct, bonos, comisiones, faltante: Math.max(0, meta - ingresos) };
  }, [filas]);

  // ====== Semana: 'hoy' o 'hasta' ======
  const [semanaModo, setSemanaModo] = useState<SemanaModo>("hoy");
  const baseDateForWeek = useMemo(() => (semanaModo === "hoy" ? new Date() : parseDate(hasta)), [semanaModo, hasta]);
  const semanaRef = useMemo(() => getWeekStart(baseDateForWeek), [baseDateForWeek]);
  const semanaFin = useMemo(() => {
    const d = new Date(semanaRef);
    d.setDate(d.getDate() + 6);
    return d;
  }, [semanaRef]);
  const desdeSemana = fmtDate(semanaRef);
  const hastaSemana = fmtDate(semanaFin);

  const semanalPorDoctor = useMemo(() => {
    const res: Record<string, { ingresos: number; metaSemanal: number; avancePct: number }> = {};
    for (const d of doctores) {
      const metaMensual = Math.round(d.baseMeta * (1 + d.crecimientoPct / 100));
      const metaSemanal = Math.round(metaMensual / 4.33);
      let ingresosSem = 0;
      if (payments && payments.length) {
        for (const p of payments) {
          if (!p || typeof p.amount !== "number" || !p.date) continue;
          if (!isInRange(p.date, desdeSemana, hastaSemana)) continue;
          if (p.doctorId !== d.id) continue;
          ingresosSem += p.amount;
        }
      }
      const avancePct = metaSemanal > 0 ? (ingresosSem / metaSemanal) * 100 : 0;
      res[d.id] = { ingresos: ingresosSem, metaSemanal, avancePct };
    }
    return res;
  }, [doctores, payments, desdeSemana, hastaSemana]);

  // ===== Navegación & Seguridad =====
  function goConfig() {
    if (configUnlocked) {
      setTab("config");
      return;
    }
    const pass = window.prompt("Introduce la contraseña para abrir Configuración:");
    if (pass === CONFIG_PASSWORD) {
      setConfigUnlocked(true);
      setTab("config");
    } else if (pass !== null) {
      alert("Contraseña incorrecta.");
    }
  }
  function goResultados() {
    setTab("resultados");
  }
  function goReporte() {
    setTab("reporte");
  }

  // ===== Config: importar doctores desde Agenda =====
  const [panelAgregarOpen, setPanelAgregarOpen] = useState(false);
  const setIds = useMemo(() => new Set(doctores.map((d) => d.id)), [doctores]);
  const candidatosAgenda = useMemo(
    () => (doctorsFromAgenda || []).filter((a) => !setIds.has(a.id)),
    [doctorsFromAgenda, setIds]
  );
  const [seleccionados, setSeleccionados] = useState<string[]>([]);

  const toggleSel = (id: string) => setSeleccionados((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const agregarSeleccionados = () => {
    if (!candidatosAgenda.length || !seleccionados.length) return;
    setDoctores((prev) => [
      ...prev,
      ...seleccionados.map((id) => {
        const a = (doctorsFromAgenda || []).find((x) => x.id === id)!;
        return { id: a.id, nombre: a.name, baseMeta: 100_000, crecimientoPct: 10, bonoAlcancePct: 10, bonoSuperMetaPct: 20, comisionPct: 20 };
      }),
    ]);
    setSeleccionados([]);
    setPanelAgregarOpen(false);
  };

  function addDoctorManual() {
    setDoctores((prev) => [
      ...prev,
      { id: randomId(), nombre: "Nuevo(a)", baseMeta: 100_000, crecimientoPct: 10, bonoAlcancePct: 10, bonoSuperMetaPct: 20, comisionPct: 20 },
    ]);
  }
  function removeDoctor(id: string) {
    if (!confirm("¿Eliminar este(a) doctor(a)?")) return;
    setDoctores((prev) => prev.filter((d) => d.id !== id));
  }
  function resetDefault() {
    if (!confirm("¿Restablecer por defecto?")) return;
    setDoctores(defaultDoctors);
  }

  // ===== Detalle por doctor: pagos filtrados por fecha =====
  const pagosFiltradosPorDoc = useMemo(() => {
    const res: Record<string, Payment[]> = {};
    if (payments && payments.length) {
      for (const p of payments) {
        if (!p || typeof p.amount !== "number" || !p.date) continue;
        if (!isInRange(p.date, desde, hasta)) continue;
        const did = p.doctorId;
        (res[did] = res[did] || []).push(p);
      }
      // ordenar por fecha asc
      Object.keys(res).forEach((k) => res[k].sort((a, b) => (a.date as string).localeCompare(b.date as string)));
    }
    return res;
  }, [payments, desde, hasta]);

  const groupByDate = (items: Payment[]) => {
    const map: Record<string, { total: number; items: Payment[] }> = {};
    for (const it of items) {
      const k = it.date;
      if (!map[k]) map[k] = { total: 0, items: [] };
      map[k].total += it.amount || 0;
      map[k].items.push(it);
    }
    const entries = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
    return entries; // [ [date, {total, items}], ... ]
  };

  // Para mostrar/ocultar detalles por fila
  const [openDetailIds, setOpenDetailIds] = useState<string[]>([]);
  const toggleDetail = (id: string) => setOpenDetailIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // ===============================
  // 🆕 REPORTE DETALLADO (por método)
  // ===============================
  const reportePorDoctor = useMemo(() => {
    const base: Record<
      string,
      {
        total: number;
        efectivo: number;
        tarjeta: number;
        transferencia: number;
        otro: number;
        sinMetodo: number;
        pagos: Payment[];
      }
    > = {};

    doctores.forEach((d) => {
      base[d.id] = { total: 0, efectivo: 0, tarjeta: 0, transferencia: 0, otro: 0, sinMetodo: 0, pagos: [] };
    });

    if (!payments || !payments.length) return base;

    for (const p of payments) {
      if (!p || typeof p.amount !== "number" || !p.date) continue;
      if (!isInRange(p.date, desde, hasta)) continue;

      if (!base[p.doctorId]) {
        // si llega un pago con doctorId que no está en config, lo agregamos “al vuelo”
        base[p.doctorId] = { total: 0, efectivo: 0, tarjeta: 0, transferencia: 0, otro: 0, sinMetodo: 0, pagos: [] };
      }

      const m = normalizeMethod(p.method);
      base[p.doctorId].total += p.amount;
      base[p.doctorId].pagos.push(p);

      if (m === "efectivo") base[p.doctorId].efectivo += p.amount;
      else if (m === "tarjeta") base[p.doctorId].tarjeta += p.amount;
      else if (m === "transferencia") base[p.doctorId].transferencia += p.amount;
      else if (m === "otro") base[p.doctorId].otro += p.amount;
      else base[p.doctorId].sinMetodo += p.amount;
    }

    // ordenar pagos por fecha desc para lectura rápida
    Object.keys(base).forEach((k) => base[k].pagos.sort((a, b) => (b.date as string).localeCompare(a.date as string)));

    return base;
  }, [payments, doctores, desde, hasta]);

  const totalesReporte = useMemo(() => {
    let efectivo = 0;
    let tarjeta = 0;
    let transferencia = 0;
    let otro = 0;
    let sinMetodo = 0;
    let total = 0;

    Object.values(reportePorDoctor).forEach((r) => {
      efectivo += r.efectivo;
      tarjeta += r.tarjeta;
      transferencia += r.transferencia;
      otro += r.otro;
      sinMetodo += r.sinMetodo;
      total += r.total;
    });

    return { efectivo, tarjeta, transferencia, otro, sinMetodo, total };
  }, [reportePorDoctor]);

  // ===============================
  // 🆕 GASTOS + NETO
  // ===============================
  const gastosFiltrados = useMemo(() => {
    return (gastos || []).filter((g) => g?.date && isInRange(g.date, desde, hasta));
  }, [gastos, desde, hasta]);

  const totalesGastos = useMemo(() => {
    let efectivo = 0;
    let banco = 0;
    for (const g of gastosFiltrados) {
      if (!g || typeof g.amount !== "number") continue;
      if (g.paidBy === "efectivo") efectivo += g.amount;
      else banco += g.amount;
    }
    return { efectivo, banco, total: efectivo + banco };
  }, [gastosFiltrados]);

  const netos = useMemo(() => {
    const efectivoLibre = totalesReporte.efectivo - totalesGastos.efectivo;
    const bancoBruto = totalesReporte.tarjeta + totalesReporte.transferencia;
    const bancoNeto = bancoBruto - totalesGastos.banco;

    const netoTotal = totalesReporte.total - totalesGastos.total;
    return {
      efectivoLibre,
      bancoBruto,
      bancoNeto,
      netoTotal,
    };
  }, [totalesReporte, totalesGastos]);

  // Form nuevo gasto
  const [gDate, setGDate] = useState<string>(() => fmtDate(new Date()));
  const [gConcept, setGConcept] = useState<string>("");
  const [gAmount, setGAmount] = useState<number>(0);
  const [gPaidBy, setGPaidBy] = useState<"efectivo" | "banco">("efectivo");
  const [gNote, setGNote] = useState<string>("");

  const addGasto = () => {
    const amount = clampNumber(Number(gAmount), 0);
    if (!gDate) return alert("Falta fecha del gasto.");
    if (!gConcept.trim()) return alert("Falta concepto del gasto.");
    if (!amount) return alert("Monto inválido.");

    const nuevo: Expense = {
      id: randomId(),
      date: gDate,
      concept: gConcept.trim(),
      amount,
      paidBy: gPaidBy,
      note: gNote.trim() || undefined,
    };

    setGastos((prev) => [nuevo, ...(prev || [])]);
    setGConcept("");
    setGAmount(0);
    setGNote("");
  };

  const deleteGasto = (id: string) => {
    if (!confirm("¿Eliminar este gasto?")) return;
    setGastos((prev) => (prev || []).filter((g) => g.id !== id));
  };

  // ===== UI =====
  return (
    <div className="app-shell">
      <style>{css}</style>

      <header className="topbar">
        <div className="brand">
          <span className="logo">🦷</span>
          <div className="brand-text">
            <strong>Dentalux</strong>
            <small>Panel de Metas</small>
          </div>
        </div>

        <div className="actions">
          <label className="month">
            <span>Mes:</span>
            <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
          </label>

          <div className="tabs">
            <button className={`tab ${tab === "resultados" ? "active" : ""}`} onClick={goResultados} title="Ver resultados">
              Resultados
            </button>
            <button className={`tab ${tab === "reporte" ? "active" : ""}`} onClick={goReporte} title="Reporte detallado por método + gastos">
              Reporte detallado
            </button>
            <button className={`tab ${tab === "config" ? "active" : ""}`} onClick={goConfig} title="Abrir configuración (Protegido)">
              Configuración 🔒
            </button>
          </div>
        </div>
      </header>

      {(tab === "resultados" || tab === "reporte") && (
        <main className="content">
          {/* Fuente y rango */}
          <section className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <strong>Fuente de datos:</strong>
                <select value={modoDatos} onChange={(e) => setModoDatos(e.target.value as ModoDatos)} disabled={tab === "reporte"}>
                  <option value="pagos" disabled={!payments || !payments.length}>
                    Pagos del sistema {(!payments || !payments.length) ? "(no disponibles)" : ""}
                  </option>
                  <option value="manual">Manual</option>
                </select>
                {tab === "reporte" && <span className="muted">* El reporte detallado usa pagos del sistema (payments).</span>}
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <strong>Desde:</strong>
                <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <strong>Hasta:</strong>
                <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
              </div>

              <div className="muted">Consejo: ajusta "Desde/Hasta" para validar días o periodos.</div>
            </div>
          </section>

          {tab === "resultados" && (
            <>
              {/* Resumen */}
              <section className="summary-cards">
                <div className="card">
                  <div className="card-title">Ingresos (rango)</div>
                  <div className="card-value">{mxn(totales.ingresos)}</div>
                </div>
                <div className="card">
                  <div className="card-title">Meta proyectada</div>
                  <div className="card-value">{mxn(totales.meta)}</div>
                </div>
                <div className="card">
                  <div className="card-title">% Avance general</div>
                  <div className={`pill ${totales.avancePct >= 100 ? "ok" : totales.avancePct >= 70 ? "warn" : "bad"}`}>{pctTxt(totales.avancePct)}</div>
                </div>
                <div className="card">
                  <div className="card-title">Bonos calculados</div>
                  <div className="card-value">{mxn(totales.bonos)}</div>
                </div>
              </section>

              {/* Tabla principal */}
              <section className="table-wrap">
                <div className="table-head">
                  <h2>Detalle por Doctor(a)</h2>
                  <div className="table-actions">
                    <button
                      className="btn"
                      onClick={() => {
                        const headers = ["Doctor", "Ingresos", "Meta Proyectada", "% Avance", "% Bono", "Bono", "% Comisión", "Comisión", "Faltante"];
                        const rows = filas.map((f) => [
                          f.nombre,
                          f.ingresos,
                          f.metaProyectada,
                          (Math.round(f.avancePct * 10) / 10).toFixed(1),
                          f.bonoAplicablePct,
                          f.bono,
                          f.comisionPct,
                          f.comision,
                          f.faltante,
                        ]);
                        const csv = [headers, ...rows]
                          .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
                          .join("\n");
                        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `DetalleDoctores_${desde}_a_${hasta}.csv`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      Exportar CSV
                    </button>
                  </div>
                </div>

                <div className="table">
                  <div className="row header">
                    <div>Doctor(a)</div>
                    <div>Ingresos</div>
                    <div>Meta Proyectada</div>
                    <div>% Avance</div>
                    <div>Progreso</div>
                    <div>% Bono</div>
                    <div>Bono</div>
                    <div>Comisión</div>
                    <div>Faltante</div>
                  </div>

                  {filas.map((f) => {
                    const isOpen = openDetailIds.includes(f.id);
                    const pagosDoc = pagosFiltradosPorDoc[f.id] || [];
                    const grupos = groupByDate(pagosDoc);
                    return (
                      <div key={f.id} style={{ borderBottom: "1px solid #0000" }}>
                        <div className="row body">
                          <div className="cell name">
                            <button className="pill" onClick={() => toggleDetail(f.id)}>
                              {isOpen ? "Ocultar" : "Ver"} movimientos
                            </button>
                            <div className="name-tag">{f.nombre}</div>
                            <div className={`pill ${f.status}`}>{f.status === "ok" ? "✅ En meta" : f.status === "warn" ? "🟡 En camino" : "🔴 Bajo"}</div>
                          </div>
                          <div className="cell">
                            {modoDatos === "manual" ? (
                              <input
                                className="num"
                                type="number"
                                min={0}
                                step={100}
                                value={ingresosMesActual[f.id] ?? 0}
                                onChange={(e) => setIngreso(f.id, Number(e.target.value))}
                              />
                            ) : (
                              <strong>{mxn(f.ingresos)}</strong>
                            )}
                          </div>
                          <div className="cell">{mxn(f.metaProyectada)}</div>
                          <div className="cell">{pctTxt(f.avancePct)}</div>
                          <div className="cell progress">
                            <div className="bar">
                              <div className={`fill ${f.avancePct >= 100 ? "ok" : f.avancePct >= 70 ? "warn" : "bad"}`} style={{ width: `${Math.min(f.avancePct, 130)}%` }} />
                              <span className="bar-mark bar-100" title="Meta 100%" />
                              <span className="bar-mark bar-120" title="Súper meta 120%" />
                            </div>
                          </div>
                          <div className="cell">{f.bonoAplicablePct ? `${f.bonoAplicablePct}%` : "—"}</div>
                          <div className="cell">{mxn(f.bono)}</div>
                          <div className="cell">
                            <div>{mxn(f.comision)}</div>
                            <small className="muted">({f.comisionPct}%)</small>
                          </div>
                          <div className="cell">{f.faltante > 0 ? mxn(f.faltante) : "—"}</div>
                        </div>

                        {/* Panel de movimientos por día */}
                        {isOpen && (
                          <div className="card" style={{ margin: "8px 14px 14px 14px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <strong>Movimientos de {f.nombre}</strong>
                              <span className="muted">
                                Rango: {desde} a {hasta}
                              </span>
                            </div>

                            {(!payments || !payments.length) ? (
                              <div className="muted" style={{ marginTop: 6 }}>
                                No hay pagos del sistema disponibles. Pasa la prop <code>payments</code> desde tu módulo de Caja.
                              </div>
                            ) : pagosDoc.length === 0 ? (
                              <div className="muted" style={{ marginTop: 6 }}>
                                Sin movimientos en el rango.
                              </div>
                            ) : (
                              <div style={{ marginTop: 8 }}>
                                {grupos.map(([fecha, info]) => (
                                  <div key={fecha} style={{ borderTop: "1px solid var(--line)", paddingTop: 8, marginTop: 8 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                      <div>
                                        <strong>{fecha}</strong>
                                      </div>
                                      <div>
                                        <strong>{mxn(info.total)}</strong>
                                      </div>
                                    </div>
                                    <div style={{ marginTop: 6, overflowX: "auto" }}>
                                      <table className="min-w-full" style={{ width: "100%" }}>
                                        <thead>
                                          <tr style={{ background: "rgba(14,165,233,0.06)" }}>
                                            <th style={{ textAlign: "left", padding: "6px 8px" }}>Monto</th>
                                            <th style={{ textAlign: "left", padding: "6px 8px" }}>Paciente</th>
                                            <th style={{ textAlign: "left", padding: "6px 8px" }}>Servicio</th>
                                            <th style={{ textAlign: "left", padding: "6px 8px" }}>Nota</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {info.items.map((p, idx) => (
                                            <tr key={String(p.id ?? idx)} style={{ borderTop: "1px solid #0000" }}>
                                              <td style={{ padding: "6px 8px" }}>{mxn(p.amount)}</td>
                                              <td style={{ padding: "6px 8px" }}>{p.patient ?? "—"}</td>
                                              <td style={{ padding: "6px 8px" }}>{p.service ?? "—"}</td>
                                              <td style={{ padding: "6px 8px" }}>{p.note ?? "—"}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <div className="row footer">
                    <div className="cell name">
                      <strong>TOTAL</strong>
                    </div>
                    <div className="cell">
                      <strong>{mxn(totales.ingresos)}</strong>
                    </div>
                    <div className="cell">
                      <strong>{mxn(totales.meta)}</strong>
                    </div>
                    <div className="cell">
                      <strong>{pctTxt(totales.avancePct)}</strong>
                    </div>
                    <div className="cell" />
                    <div className="cell" />
                    <div className="cell">
                      <strong>{mxn(totales.bonos)}</strong>
                    </div>
                    <div className="cell">
                      <strong>{mxn(totales.comisiones)}</strong>
                    </div>
                    <div className="cell">
                      <strong>{totales.faltante > 0 ? mxn(totales.faltante) : "—"}</strong>
                    </div>
                  </div>
                </div>
              </section>

              {/* ===== Semanal ===== */}
              <section className="card" style={{ marginTop: 18 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                  <h3 style={{ margin: 0 }}>Acumulado semanal por doctor vs meta semanal</h3>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="muted">Basado en:</span>
                    <select value={semanaModo} onChange={(e) => setSemanaModo(e.target.value as SemanaModo)}>
                      <option value="hoy">Hoy (lun-dom)</option>
                      <option value="hasta">Fecha "Hasta" (lun-dom)</option>
                    </select>
                  </div>
                </div>

                <div className="muted" style={{ marginTop: 6 }}>
                  Semana del <strong>{desdeSemana}</strong> al <strong>{hastaSemana}</strong>
                </div>

                {!payments || !payments.length ? (
                  <div className="muted" style={{ marginTop: 8 }}>
                    Para calcular el acumulado semanal real, pasa los <strong>payments</strong> como prop desde tu módulo de Caja.
                  </div>
                ) : null}

                <div style={{ marginTop: 12, overflowX: "auto" }}>
                  <table className="min-w-full" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                    <thead>
                      <tr style={{ background: "rgba(14,165,233,0.06)" }}>
                        <th style={{ textAlign: "left", padding: "10px 12px" }}>Doctor(a)</th>
                        <th style={{ textAlign: "right", padding: "10px 12px" }}>Ingresos semana</th>
                        <th style={{ textAlign: "right", padding: "10px 12px" }}>Meta semanal</th>
                        <th style={{ textAlign: "right", padding: "10px 12px" }}>% Avance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doctores.map((d) => {
                        const s = semanalPorDoctor[d.id] || { ingresos: 0, metaSemanal: 0, avancePct: 0 };
                        const status = s.avancePct >= 100 ? "ok" : s.avancePct >= 70 ? "warn" : "bad";
                        return (
                          <tr key={d.id} style={{ borderTop: "1px solid #d6e0ee" }}>
                            <td style={{ padding: "8px 12px" }}>{d.nombre}</td>
                            <td style={{ padding: "8px 12px", textAlign: "right" }}>{mxn(s.ingresos)}</td>
                            <td style={{ padding: "8px 12px", textAlign: "right" }}>{mxn(s.metaSemanal)}</td>
                            <td style={{ padding: "8px 12px", textAlign: "right" }}>
                              <span className={`pill ${status}`}>{pctTxt(s.avancePct)}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {tab === "reporte" && (
            <>
              {/* Resumen global del reporte */}
              <section className="summary-cards" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
                <div className="card">
                  <div className="card-title">Total efectivo (rango)</div>
                  <div className="card-value">{mxn(totalesReporte.efectivo)}</div>
                </div>
                <div className="card">
                  <div className="card-title">Total tarjeta (rango)</div>
                  <div className="card-value">{mxn(totalesReporte.tarjeta)}</div>
                </div>
                <div className="card">
                  <div className="card-title">Total transferencia (rango)</div>
                  <div className="card-value">{mxn(totalesReporte.transferencia)}</div>
                </div>
                <div className="card">
                  <div className="card-title">Total general (rango)</div>
                  <div className="card-value">{mxn(totalesReporte.total)}</div>
                </div>
              </section>

              {(totalesReporte.sinMetodo > 0 || totalesReporte.otro > 0) && (
                <section className="card" style={{ marginTop: 12 }}>
                  <strong>⚠️ Avisos del reporte</strong>
                  <div className="muted" style={{ marginTop: 6 }}>
                    {totalesReporte.sinMetodo > 0 ? (
                      <div>
                        - Hay <strong>{mxn(totalesReporte.sinMetodo)}</strong> en pagos <strong>Sin método</strong>. Para que se reparta en efectivo/tarjeta/transferencia, asegúrate que tus payments traigan <code>method</code>.
                      </div>
                    ) : null}
                    {totalesReporte.otro > 0 ? (
                      <div>
                        - Hay <strong>{mxn(totalesReporte.otro)}</strong> en pagos con método <strong>“otro”</strong>.
                      </div>
                    ) : null}
                  </div>
                </section>
              )}

              {/* Cards por doctor */}
              <section style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
                {doctores.map((d) => {
                  const r = reportePorDoctor[d.id] || { total: 0, efectivo: 0, tarjeta: 0, transferencia: 0, otro: 0, sinMetodo: 0, pagos: [] };
                  return (
                    <div className="card" key={d.id}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <div>
                          <div className="card-title">Doctor(a)</div>
                          <div style={{ fontSize: 18, fontWeight: 900 }}>{d.nombre}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div className="card-title">Total cobrado</div>
                          <div style={{ fontSize: 18, fontWeight: 900 }}>{mxn(r.total)}</div>
                        </div>
                      </div>

                      <div style={{ marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                        <div className="mini-grid">
                          <div className="mini-item">
                            <div className="mini-label">Efectivo</div>
                            <div className="mini-value">{mxn(r.efectivo)}</div>
                          </div>
                          <div className="mini-item">
                            <div className="mini-label">Tarjeta</div>
                            <div className="mini-value">{mxn(r.tarjeta)}</div>
                          </div>
                          <div className="mini-item">
                            <div className="mini-label">Transferencia</div>
                            <div className="mini-value">{mxn(r.transferencia)}</div>
                          </div>
                          <div className="mini-item">
                            <div className="mini-label">Total general</div>
                            <div className="mini-value">{mxn(r.total)}</div>
                          </div>
                        </div>

                        {(r.sinMetodo > 0 || r.otro > 0) && (
                          <div className="muted" style={{ marginTop: 8 }}>
                            {r.sinMetodo > 0 ? (
                              <div>
                                • <strong>Sin método:</strong> {mxn(r.sinMetodo)}
                              </div>
                            ) : null}
                            {r.otro > 0 ? (
                              <div>
                                • <strong>Otro:</strong> {mxn(r.otro)}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </section>

              {/* ===== Gastos ===== */}
              <section className="card" style={{ marginTop: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <h3 style={{ margin: 0 }}>Gastos (rango seleccionado)</h3>
                    <div className="muted" style={{ marginTop: 4 }}>
                      Se cargan de localStorage. Aquí puedes registrar los que faltaron.
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="muted">Total gastos</div>
                    <div style={{ fontSize: 18, fontWeight: 900 }}>{mxn(totalesGastos.total)}</div>
                    <div className="muted" style={{ marginTop: 2 }}>
                      Efectivo: <strong>{mxn(totalesGastos.efectivo)}</strong> · Banco: <strong>{mxn(totalesGastos.banco)}</strong>
                    </div>
                  </div>
                </div>

                {/* Form registrar gasto */}
                <div className="gasto-form">
                  <div>
                    <div className="mini-label">Fecha</div>
                    <input className="num" type="date" value={gDate} onChange={(e) => setGDate(e.target.value)} />
                  </div>
                  <div>
                    <div className="mini-label">Concepto</div>
                    <input className="num" type="text" value={gConcept} onChange={(e) => setGConcept(e.target.value)} placeholder="Ej: Material, renta, gasolina..." />
                  </div>
                  <div>
                    <div className="mini-label">Monto</div>
                    <input className="num" type="number" min={0} step={10} value={gAmount} onChange={(e) => setGAmount(Number(e.target.value))} />
                  </div>
                  <div>
                    <div className="mini-label">Pagado con</div>
                    <select className="num" value={gPaidBy} onChange={(e) => setGPaidBy(e.target.value as "efectivo" | "banco")}>
                      <option value="efectivo">Efectivo</option>
                      <option value="banco">Banco (tarjeta/transferencia)</option>
                    </select>
                  </div>
                  <div>
                    <div className="mini-label">Nota</div>
                    <input className="num" type="text" value={gNote} onChange={(e) => setGNote(e.target.value)} placeholder="Opcional" />
                  </div>
                  <div style={{ display: "flex", alignItems: "end" }}>
                    <button className="btn primary" onClick={addGasto} style={{ width: "100%" }}>
                      + Agregar gasto
                    </button>
                  </div>
                </div>

                {/* Lista gastos */}
                <div style={{ marginTop: 12, overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "rgba(14,165,233,0.06)" }}>
                        <th style={{ textAlign: "left", padding: "10px 10px" }}>Fecha</th>
                        <th style={{ textAlign: "left", padding: "10px 10px" }}>Concepto</th>
                        <th style={{ textAlign: "right", padding: "10px 10px" }}>Monto</th>
                        <th style={{ textAlign: "left", padding: "10px 10px" }}>Pagado con</th>
                        <th style={{ textAlign: "left", padding: "10px 10px" }}>Nota</th>
                        <th style={{ padding: "10px 10px" }} />
                      </tr>
                    </thead>
                    <tbody>
                      {gastosFiltrados.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="muted" style={{ padding: "12px 10px" }}>
                            No hay gastos registrados en este rango.
                          </td>
                        </tr>
                      ) : (
                        gastosFiltrados.map((g) => (
                          <tr key={g.id} style={{ borderTop: "1px solid var(--line)" }}>
                            <td style={{ padding: "10px 10px" }}>{g.date}</td>
                            <td style={{ padding: "10px 10px" }}>{g.concept}</td>
                            <td style={{ padding: "10px 10px", textAlign: "right", fontWeight: 800 }}>{mxn(g.amount)}</td>
                            <td style={{ padding: "10px 10px" }}>{g.paidBy === "efectivo" ? "Efectivo" : "Banco"}</td>
                            <td style={{ padding: "10px 10px" }}>{g.note ?? "—"}</td>
                            <td style={{ padding: "10px 10px", textAlign: "right" }}>
                              <button className="btn danger" onClick={() => deleteGasto(g.id)}>
                                Eliminar
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* ===== Totales netos ===== */}
              <section className="card" style={{ marginTop: 16 }}>
                <h3 style={{ marginTop: 0 }}>Totales finales (descontando gastos)</h3>
                <div className="mini-grid" style={{ marginTop: 10 }}>
                  <div className="mini-item">
                    <div className="mini-label">Efectivo libre (Efectivo - Gastos efectivo)</div>
                    <div className="mini-value">{mxn(netos.efectivoLibre)}</div>
                  </div>
                  <div className="mini-item">
                    <div className="mini-label">Banco bruto (Tarjeta + Transferencia)</div>
                    <div className="mini-value">{mxn(netos.bancoBruto)}</div>
                  </div>
                  <div className="mini-item">
                    <div className="mini-label">Banco neto (Banco bruto - Gastos banco)</div>
                    <div className="mini-value">{mxn(netos.bancoNeto)}</div>
                  </div>
                  <div className="mini-item">
                    <div className="mini-label">Neto total (Total - Gastos total)</div>
                    <div className="mini-value">{mxn(netos.netoTotal)}</div>
                  </div>
                </div>

                {(totalesReporte.sinMetodo > 0) && (
                  <div className="muted" style={{ marginTop: 10 }}>
                    Nota: Hay pagos “Sin método” por {mxn(totalesReporte.sinMetodo)} que están dentro del Total general. Si quieres que afecten efectivo/tarjeta/transferencia,
                    agrega <code>method</code> en tu módulo de Caja.
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      )}

      {tab === "config" && (
        <main className="content">
          <section className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>Configuración (protegido)</h2>
            <div className="muted">Contraseña correcta: acceso concedido ✅</div>
          </section>

          {/* Agregar doctor: panel con doctores de Agenda */}
          <section className="card" style={{ marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <h3 style={{ margin: 0 }}>Agregar doctor(a)</h3>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" onClick={() => setPanelAgregarOpen((v) => !v)}>
                  {panelAgregarOpen ? "Ocultar" : "Mostrar"} doctores de Agenda
                </button>
                <button className="btn ghost" onClick={addDoctorManual}>
                  + Agregar manual
                </button>
                <button className="btn danger" onClick={resetDefault}>
                  Restablecer default
                </button>
              </div>
            </div>

            {panelAgregarOpen && (
              <div style={{ marginTop: 10 }}>
                {!doctorsFromAgenda || !doctorsFromAgenda.length ? (
                  <div className="muted">
                    No se recibieron doctores desde la Agenda. Pasa la prop <code>doctorsFromAgenda</code> a este módulo.
                  </div>
                ) : (
                  <div>
                    {candidatosAgenda.length === 0 ? (
                      <div className="muted">Todos los doctores de Agenda ya están en la tabla.</div>
                    ) : (
                      <div>
                        <div className="muted" style={{ marginBottom: 6 }}>
                          Pendientes por importar: {candidatosAgenda.length}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 8 }}>
                          {candidatosAgenda.map((c) => (
                            <label
                              key={c.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                border: "1px solid var(--line)",
                                borderRadius: 10,
                                padding: "8px 10px",
                                background: "#fff",
                              }}
                            >
                              <input type="checkbox" checked={seleccionados.includes(c.id)} onChange={() => toggleSel(c.id)} />
                              <span>{c.name}</span>
                            </label>
                          ))}
                        </div>
                        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                          <button className="btn primary" onClick={agregarSeleccionados} disabled={!seleccionados.length}>
                            Agregar seleccionados
                          </button>
                          <button className="btn ghost" onClick={() => setSeleccionados([])} disabled={!seleccionados.length}>
                            Limpiar selección
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Tabla de configuración */}
          <section className="config-table">
            <div className="row header">
              <div>Doctor(a)</div>
              <div>Base (MXN)</div>
              <div>% Crecimiento</div>
              <div>% Bono (≥100%)</div>
              <div>% Bono (≥120%)</div>
              <div>% Comisión</div>
              <div />
            </div>

            {doctores.map((d, idx) => (
              <div className="row body" key={d.id}>
                <div className="cell">
                  <input
                    type="text"
                    value={d.nombre}
                    onChange={(e) => setDoctores((prev) => prev.map((x, i) => (i === idx ? { ...x, nombre: e.target.value } : x)))}
                  />
                </div>
                <div className="cell">
                  <input
                    className="num"
                    type="number"
                    min={0}
                    step={1000}
                    value={d.baseMeta}
                    onChange={(e) =>
                      setDoctores((prev) => prev.map((x, i) => (i === idx ? { ...x, baseMeta: clampNumber(Number(e.target.value), 0) } : x)))
                    }
                  />
                </div>
                <div className="cell">
                  <input
                    className="num"
                    type="number"
                    min={0}
                    max={1000}
                    step={0.5}
                    value={d.crecimientoPct}
                    onChange={(e) =>
                      setDoctores((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, crecimientoPct: clampNumber(Number(e.target.value), 0, 1000) } : x))
                      )
                    }
                  />
                </div>
                <div className="cell">
                  <input
                    className="num"
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={d.bonoAlcancePct}
                    onChange={(e) =>
                      setDoctores((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, bonoAlcancePct: clampNumber(Number(e.target.value), 0, 100) } : x))
                      )
                    }
                  />
                </div>
                <div className="cell">
                  <input
                    className="num"
                    type="number"
                    min={0}
                    max={200}
                    step={0.5}
                    value={d.bonoSuperMetaPct}
                    onChange={(e) =>
                      setDoctores((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, bonoSuperMetaPct: clampNumber(Number(e.target.value), 0, 200) } : x))
                      )
                    }
                  />
                </div>
                <div className="cell">
                  <input
                    className="num"
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={d.comisionPct}
                    onChange={(e) =>
                      setDoctores((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, comisionPct: clampNumber(Number(e.target.value), 0, 100) } : x))
                      )
                    }
                  />
                </div>
                <div className="cell actions">
                  <button className="btn danger" onClick={() => removeDoctor(d.id)}>
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </section>

          <section className="security-note">
            <p>
              <strong>Nota:</strong> Esta protección es local (localStorage). Para producción, agrega auth/roles en tu app.
            </p>
          </section>
        </main>
      )}
    </div>
  );
}

const css = `
:root{
  --bg:#f4f7fb; --muted:#eaf0f8; --panel:#ffffff; --card:#ffffff;
  --text:#0f172a; --text-dim:#475569; --brand:#0ea5e9;
  --ok:#16a34a; --warn:#eab308; --bad:#ef4444; --line:#d6e0ee; --chip:#eef6ff;
}
*{box-sizing:border-box} body{margin:0}
.app-shell{min-height:100vh; background:radial-gradient(800px 400px at 90% -10%, #e0f2ff 0%, #f3f8ff 50%, var(--bg) 100%);
  color:var(--text); font-family: ui-sans-serif,system-ui,Segoe UI,Roboto,Helvetica,Arial,Apple Color Emoji,Segoe UI Emoji; padding-bottom: 32px;}
.topbar{display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid var(--line);
  position:sticky; top:0; backdrop-filter:saturate(1.1) blur(6px); background: linear-gradient(180deg, rgba(255,255,255,0.95), rgba(255,255,255,0.9));
  z-index:10; box-shadow: 0 6px 16px rgba(15,23,42,.06);}
.brand{display:flex; gap:12px; align-items:center} .logo{font-size:26px}
.brand-text{display:flex; flex-direction:column; line-height:1} .brand-text strong{letter-spacing:.3px; color:var(--brand)} .brand-text small{color:var(--text-dim)}
.actions{display:flex; align-items:center; gap:16px}
.month{display:flex; align-items:center; gap:8px; color:var(--text-dim)}
.month input{background:var(--panel); color:var(--text); border:1px solid var(--line); padding:6px 8px; border-radius:10px; outline: none;}
.tabs{display:flex; gap:10px}
.tab{background:linear-gradient(180deg, #e8f5ff, #dff0ff); color:#0b3b5c; border:1px solid var(--line); padding:9px 14px; border-radius:999px; cursor:pointer;
  font-weight:700; letter-spacing:.2px; transition: transform .12s ease, box-shadow .2s ease, filter .2s ease; box-shadow: 0 6px 12px rgba(2, 132, 199, .08);}
.tab:hover{filter:brightness(1.03); transform: translateY(-1px)} .tab.active{outline:2px solid var(--brand); box-shadow: 0 0 0 4px rgba(14,165,233,.15), 0 10px 20px rgba(2,132,199,.12);}
.content{max-width:1100px; margin:22px auto; padding:0 16px}
.summary-cards{display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap:16px;}
.card{background:linear-gradient(180deg, #ffffff, #fafcff); border:1px solid var(--line); border-radius:16px; padding:18px 20px; box-shadow: 0 10px 18px rgba(2,6,23,.06);}
.card-title{color:var(--text-dim); font-weight:700; font-size:12px; letter-spacing:.3px; text-transform:uppercase} .card-value{font-size:22px; font-weight:900; margin-top:6px}
.table-wrap{margin-top:22px} .table-head{display:flex; justify-content:space-between; align-items:center; margin-bottom:12px} .table-head h2{margin:0; color:#0b3b5c}
.table{border:1px solid var(--line); border-radius:14px; overflow:hidden; background: linear-gradient(180deg, rgba(255,255,255,0.66), rgba(255,255,255,0.55)); box-shadow: 0 12px 22px rgba(2,6,23,.05);}
.row{display:grid; grid-template-columns: 1.3fr 1fr 1fr .8fr 1.6fr .8fr 1fr 1fr 1fr; gap:12px; align-items:center}
.row.header, .row.footer{background:rgba(14,165,233,0.06); font-weight:800} .row.header{padding:12px 14px; border-bottom:1px solid var(--line)}
.row.body{padding:12px 14px; border-bottom:1px dashed rgba(2,6,23,0.06)} .row.footer{padding:12px 14px}
.cell{display:flex; align-items:center; gap:8px} .cell.name{gap:10px} .name-tag{font-weight:800}
.muted{color:var(--text-dim); font-size:12px}
.pill{padding:4px 8px; border-radius:999px; font-size:12px; border:1px solid var(--line); background:#f8fbff}
.pill.ok{color:var(--ok); background:#eaf8ef} .pill.warn{color:var(--warn); background:#fff7db} .pill.bad{color:var(--bad); background:#ffe7eb}
.num{width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--line); background:var(--panel); color:var(--text); font-weight:700; outline:none;}
.num:focus{box-shadow: 0 0 0 3px rgba(14,165,233,.18)}
.progress .bar{position:relative; background:#eef6ff; border:1px solid var(--line); height:12px; border-radius:999px; width:100%; overflow:hidden;}
.fill{height:100%; border-right:1px solid #0001; transition:width .35s ease} .fill.ok{background:linear-gradient(90deg, #22c55e, #16a34a)}
.fill.warn{background:linear-gradient(90deg, #facc15, #eab308)} .fill.bad{background:linear-gradient(90deg, #f43f5e, #ef4444)}
.bar-mark{position:absolute; top:-3px; width:2px; height:18px; background:#0b3b5c33;} .bar-100{left:100%} .bar-120{left:120%}
.btn{background:linear-gradient(180deg, #e8f5ff, #dff0ff); color:#0b3b5c; border:1px solid var(--line); padding:10px 14px; border-radius:10px; cursor:pointer; font-weight:800;
  transition: transform .12s ease, box-shadow .2s ease, filter .2s ease; box-shadow: 0 10px 22px rgba(2,6,23,.06);} .btn:hover{filter:brightness(1.03); transform: translateY(-1px)}
.btn.primary{background: linear-gradient(180deg, #38bdf8, #0ea5e9); border-color:#7dd3fc; color:white;}
.btn.danger{background: linear-gradient(180deg, #fecdd3, #fb7185); border-color:#fecdd3; color:#7a0012;} .btn.ghost{background:transparent}
.config-table{margin-top:16px} .config-table .row{grid-template-columns: 1.3fr 1fr 1fr 1fr 1fr 1fr .6fr}
.security-note{margin-top:12px; padding:10px; border:1px dashed var(--line); border-radius:10px; color:var(--text-dim); background:#f8fbff}

/* 🆕 estilos reporte */
.mini-grid{display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap:10px}
.mini-item{border:1px solid var(--line); background:#ffffff; border-radius:12px; padding:10px 12px}
.mini-label{font-size:11px; font-weight:800; letter-spacing:.2px; text-transform:uppercase; color:var(--text-dim)}
.mini-value{margin-top:4px; font-size:16px; font-weight:900}

.gasto-form{margin-top:12px; display:grid; grid-template-columns: 1.1fr 1.6fr .9fr 1.1fr 1.2fr .9fr; gap:10px; align-items:end}
@media (max-width: 980px){
  .summary-cards{grid-template-columns: repeat(2, minmax(0,1fr))}
  .row{grid-template-columns: 1.1fr .9fr .9fr .7fr 1.1fr .7fr .9fr .9fr .9fr}
  .gasto-form{grid-template-columns: 1fr 1fr; }
  .mini-grid{grid-template-columns: 1fr}
}
@media (max-width: 720px){
  .summary-cards{grid-template-columns: 1fr}
  .row.header .cell:nth-child(5), .row.body .cell:nth-child(5){display:none}
  .row{grid-template-columns: 1fr .9fr .9fr .7fr .7fr .9fr .9fr .9fr}
}
`;

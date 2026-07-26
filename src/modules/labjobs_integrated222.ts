import { useEffect, useMemo, useState } from "react";
import {
  listDoctors,
  listPayments,
  getAppState,
  saveAppState,
  Doctor,
  Payment,
} from "../lib/api";

// ----- Tipos locales para metas (persisten en app_state) -----
type DoctorMeta = {
  baseMeta: number;
  crecimientoPct: number;
  bonoAlcancePct: number;
  bonoSuperMetaPct: number;
  comisionPct: number;
};
type MetasPorDoctor = Record<string | number, DoctorMeta>;

function monthBounds(dateISO: string) {
  const d = new Date(dateISO + "-01"); // "YYYY-MM"
  const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); // exclusivo
  const toStr = to.toISOString().slice(0, 10);
  const fromStr = from.toISOString().slice(0, 10);
  return { from: fromStr, to: toStr };
}

export default function Objetivos() {
  // Mes visible en formato "YYYY-MM"
  const [mes, setMes] = useState(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  });

  const [doctores, setDoctores] = useState<Doctor[]>([]);
  const [pagos, setPagos] = useState<Payment[]>([]);
  const [metas, setMetas] = useState<MetasPorDoctor>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Carga inicial: doctores + app_state (metas)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);

        // 1) Doctores
        const ds = await listDoctors();

        // 2) AppState (metas guardadas)
        const appState = await getAppState("default");
        const metasGuardadas: MetasPorDoctor =
          (appState?.state_data?.metasPorDoctor as MetasPorDoctor) ?? {};

        // Normaliza: si algún doctor no tiene metas, crea defaults
        const conDefaults: MetasPorDoctor = { ...metasGuardadas };
        for (const d of ds) {
          const key = d.id;
          if (!conDefaults[key]) {
            conDefaults[key] = {
              baseMeta: 100000,
              crecimientoPct: 10,
              bonoAlcancePct: 10,
              bonoSuperMetaPct: 20,
              comisionPct: 20,
            };
          }
        }

        if (!mounted) return;
        setDoctores(ds);
        setMetas(conDefaults);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || "Error cargando datos iniciales");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Cargar pagos del mes visible
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setError(null);
        const { from, to } = monthBounds(mes);
        const ps = await listPayments({ from, to });
        if (!mounted) return;
        setPagos(ps);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || "Error cargando pagos");
      }
    })();
    return () => {
      mounted = false;
    };
  }, [mes]);

  // Index rápido por doctor
  const ingresosPorDoctor = useMemo(() => {
    const agg = new Map<string | number, number>();
    for (const p of pagos) {
      const key = p.doctor_id;
      const prev = agg.get(key) ?? 0;
      agg.set(key, prev + (Number(p.amount) || 0));
    }
    return agg;
  }, [pagos]);

  // Cálculo de KPIs por doctor
  const filas = useMemo(() => {
    return doctores.map((d) => {
      const meta = metas[d.id];
      const total = ingresosPorDoctor.get(d.id) ?? 0;
      const avance = meta ? Math.min(100, Math.round((total / meta.baseMeta) * 100)) : 0;

      const bonoAlcance = meta ? (avance >= 100 ? (meta.bonoAlcancePct / 100) * total : 0) : 0;
      const bonoSuper = meta ? (avance >= 120 ? (meta.bonoSuperMetaPct / 100) * total : 0) : 0;
      const comision = meta ? (meta.comisionPct / 100) * total : 0;

      return {
        id: d.id,
        nombre: d.name,
        total,
        meta: meta?.baseMeta ?? 0,
        avance,
        bonoAlcance,
        bonoSuper,
        comision,
        color: d.color,
      };
    });
  }, [doctores, metas, ingresosPorDoctor]);

  // Guardar metas en app_state
  async function guardarMetas() {
    try {
      setSaving(true);
      setError(null);
      await saveAppState({
        user_id: "default",
        state_data: { metasPorDoctor: metas },
      });
    } catch (e: any) {
      setError(e?.message || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  function updateMeta(did: string | number, patch: Partial<DoctorMeta>) {
    setMetas((prev) => ({
      ...prev,
      [did]: { ...prev[did], ...patch },
    }));
  }

  if (loading) return <div className="p-4">Cargando objetivos…</div>;
  if (error) return <div className="p-4 text-red-600">Error: {error}</div>;

  return (
    <div className="p-4 space-y-6">
      <header className="flex flex-wrap items-center gap-4">
        <h2 className="text-xl font-semibold">Objetivos por doctor</h2>
        <label className="inline-flex items-center gap-2">
          <span className="text-sm">Mes</span>
          <input
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="border rounded px-2 py-1"
          />
        </label>
        <button
          onClick={guardarMetas}
          className="px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
          disabled={saving}
        >
          {saving ? "Guardando…" : "Guardar metas"}
        </button>
      </header>

      <div className="overflow-x-auto">
        <table className="min-w-[900px] w-full border rounded-xl overflow-hidden">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2">Doctor(a)</th>
              <th className="text-right px-3 py-2">Meta</th>
              <th className="text-right px-3 py-2">Ingresos</th>
              <th className="text-left px-3 py-2">Avance</th>
              <th className="text-right px-3 py-2">% Crec.</th>
              <th className="text-right px-3 py-2">% Bono ≥100%</th>
              <th className="text-right px-3 py-2">% Súper bono</th>
              <th className="text-right px-3 py-2">% Comisión</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const meta = metas[f.id];
              return (
                <tr key={f.id} className="border-t">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-3 h-3 rounded-full"
                        style={{ background: f.color || "#3b82f6" }}
                      />
                      {f.nombre}
                    </div>
                  </td>

                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      value={meta?.baseMeta ?? 0}
                      onChange={(e) => updateMeta(f.id, { baseMeta: Number(e.target.value || 0) })}
                      className="w-28 border rounded px-2 py-1 text-right"
                    />
                  </td>

                  <td className="px-3 py-2 text-right">
                    ${f.total.toLocaleString()}
                  </td>

                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-40 h-2 bg-gray-200 rounded">
                        <div
                          className="h-2 rounded"
                          style={{
                            width: `${Math.min(100, f.avance)}%`,
                            background: f.avance >= 100 ? "#16a34a" : "#3b82f6",
                          }}
                        />
                      </div>
                      <span className="text-sm tabular-nums">{f.avance}%</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      Bonos: ${Math.round(f.bonoAlcance + f.bonoSuper).toLocaleString()} · Comisión: $
                      {Math.round(f.comision).toLocaleString()}
                    </div>
                  </td>

                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      value={meta?.crecimientoPct ?? 0}
                      onChange={(e) =>
                        updateMeta(f.id, { crecimientoPct: Number(e.target.value || 0) })
                      }
                      className="w-20 border rounded px-2 py-1 text-right"
                    />
                  </td>

                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      value={meta?.bonoAlcancePct ?? 0}
                      onChange={(e) =>
                        updateMeta(f.id, { bonoAlcancePct: Number(e.target.value || 0) })
                      }
                      className="w-20 border rounded px-2 py-1 text-right"
                    />
                  </td>

                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      value={meta?.bonoSuperMetaPct ?? 0}
                      onChange={(e) =>
                        updateMeta(f.id, { bonoSuperMetaPct: Number(e.target.value || 0) })
                      }
                      className="w-20 border rounded px-2 py-1 text-right"
                    />
                  </td>

                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      value={meta?.comisionPct ?? 0}
                      onChange={(e) =>
                        updateMeta(f.id, { comisionPct: Number(e.target.value || 0) })
                      }
                      className="w-20 border rounded px-2 py-1 text-right"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500">
        Los ingresos provienen de <code>/api/payments</code> del mes seleccionado. Las metas se
        guardan en <code>app_state</code> por usuario.
      </p>
    </div>
  );
}

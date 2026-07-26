import React, { useEffect, useMemo, useState } from "react";
import { Search, X, Calendar, Phone, DollarSign, FileText, User } from "lucide-react";
import { api } from "./lib/api";

type ApptStatus = "atendida" | "confirmada" | "pendiente" | "cancelada" | string;
type RawAny = Record<string, any>;

type AppointmentRow = {
  id?: number | string;
  date: string; // YYYY-MM-DD
  serviceName: string; // trabajo realizado
  doctorName: string;
  status: ApptStatus;
  notes?: string;
  cost?: number;

  // 🆕 monto informativo (pagos agregados por servicio o fallback a cost)
  monto?: number;
};

type LabJobRow = {
  id: string;
  servicio: string;
  laboratorio: string;
  fechaInicio?: string;
  etapa?: string;
  abonosTotal: number;
};

type PatientRow = {
  key: string; // clave estable para el front (id o phone)
  id?: number | string;
  name: string;
  phone: string;

  appointments: AppointmentRow[];

  lastAttendedDate?: string;
  lastAttendedService?: string;
  statusBadge?: string;

  totalSpent: number;
  labJobs: LabJobRow[];
  labAbonosTotal: number;
};

const norm = (s: any) => String(s ?? "").trim().toLowerCase();
const onlyDigits = (s: any) => String(s ?? "").replace(/\D+/g, "");

const toISODate = (v: any): string => {
  if (!v) return "";
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    const d = new Date(v);
    return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};

const money = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

const pick = (obj: RawAny, keys: string[]) => {
  for (const k of keys) {
    if (obj && obj[k] != null && obj[k] !== "") return obj[k];
  }
  return undefined;
};

const mapStatusToBadge = (status: string) => {
  const st = norm(status);
  if (st === "atendida" || st === "atendido" || st === "done") return "atendida";
  if (st === "confirmada" || st === "confirmado") return "confirmada";
  if (st === "pendiente" || st === "pending") return "pendiente";
  if (st === "cancelada" || st === "cancelado" || st === "canceled") return "cancelada";
  return status || "Sin citas";
};

const statusPillClass = (status: string) => {
  const st = mapStatusToBadge(status);
  if (st === "atendida") return "bg-green-100 text-green-800";
  if (st === "confirmada") return "bg-blue-100 text-blue-800";
  if (st === "pendiente") return "bg-yellow-100 text-yellow-800";
  if (st === "cancelada") return "bg-red-100 text-red-800";
  return "bg-gray-100 text-gray-800";
};

// endpoints reales con /api
const EP = {
  full: "/api/patients-full-history",
  appointments: "/api/appointments",
  services: "/api/services",
  doctors: "/api/doctors",
  payments: "/api/payments",
  labJobs: "/api/trabajos-laboratorio",
  labs: "/api/laboratorios",
};

async function safeFetchArray(path: string): Promise<any[]> {
  try {
    const r = await api(path);
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

export function PatientHistoryModule({ onClose }: { onClose: () => void }) {
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("todos");
  const [selectedPatient, setSelectedPatient] = useState<PatientRow | null>(null);
  const [showModal, setShowModal] = useState(false);

  // 🆕 selección por paciente para ver otras citas en el desplegable
  const [selectedApptByPatient, setSelectedApptByPatient] = useState<Record<string, string>>({});

  useEffect(() => {
    const load = async () => {
      // Lookup maps (si existen)
      const [services, doctors, labs] = await Promise.all([
        safeFetchArray(EP.services),
        safeFetchArray(EP.doctors),
        safeFetchArray(EP.labs),
      ]);

      const serviceNameById = new Map<string, string>();
      services.forEach((s) => {
        const id = String(pick(s, ["id", "service_id", "serviceId"]) ?? "");
        const name = String(pick(s, ["name", "nombre", "service", "servicio"]) ?? "");
        if (id) serviceNameById.set(id, name || id);
      });

      const doctorNameById = new Map<string, string>();
      doctors.forEach((d) => {
        const id = String(pick(d, ["id", "doctor_id", "doctorId"]) ?? "");
        const name = String(pick(d, ["name", "nombre"]) ?? "");
        if (id) doctorNameById.set(id, name || id);
      });

      const labNameById = new Map<string, string>();
      labs.forEach((l) => {
        const id = String(pick(l, ["id", "laboratorio_id", "laboratorioId"]) ?? "");
        const name = String(pick(l, ["nombre", "name"]) ?? "");
        if (id) labNameById.set(id, name || id);
      });

      // 1) Intentar full history
      let rawFull: any[] = [];
      try {
        const r = await api(EP.full);
        if (Array.isArray(r)) rawFull = r;
      } catch {
        // lo resolveremos con /appointments
      }

      // 2) Si falla full history: armar desde /appointments
      let rawAppointments: any[] = [];
      if (!rawFull.length) {
        rawAppointments = await safeFetchArray(EP.appointments);
      }

      // pagos y laboratorio
      const [rawPayments, rawLabJobs] = await Promise.all([safeFetchArray(EP.payments), safeFetchArray(EP.labJobs)]);

      // 🆕 Mapa de pagos por paciente + servicio (para mostrar "monto" por cita)
      // key: `${patientLower}|${serviceNameLower}` => sum(amount)
      const paymentSumByPatientService = new Map<string, number>();
      rawPayments.forEach((pay) => {
        const pName = String(pick(pay, ["patient", "paciente", "patient_name", "nombre_paciente"]) ?? "").trim();
        if (!pName) return;

        const sid = pick(pay, ["service_id", "serviceId", "servicio_id", "servicioId"]);
        const sname =
          (sid != null ? serviceNameById.get(String(sid)) : "") ||
          String(pick(pay, ["service", "servicio", "serviceName", "nombre_servicio"]) ?? "").trim();

        const amount = Number(pick(pay, ["amount", "monto"]) ?? 0);
        if (!Number.isFinite(amount) || amount <= 0) return;

        const key = `${norm(pName)}|${norm(sname)}`;
        paymentSumByPatientService.set(key, (paymentSumByPatientService.get(key) ?? 0) + amount);
      });

      const normalizeAppointment = (a: any): AppointmentRow => {
        const date = toISODate(pick(a, ["date", "fecha", "day", "appointment_date"]));

        const serviceId = pick(a, ["serviceId", "service_id", "servicioId", "servicio_id"]);
        const serviceName =
          String(pick(a, ["serviceName", "service", "servicio", "nombre_servicio"]) ?? "") ||
          (serviceId != null ? serviceNameById.get(String(serviceId)) : "") ||
          "—";

        const doctorId = pick(a, ["doctorId", "doctor_id", "medicoId", "medico_id"]);
        const doctorName =
          String(pick(a, ["doctorName", "doctor", "medico", "nombre_doctor"]) ?? "") ||
          (doctorId != null ? doctorNameById.get(String(doctorId)) : "") ||
          "—";

        const status = String(pick(a, ["status", "estado"]) ?? "pendiente");
        const notes = String(pick(a, ["notes", "nota", "notas", "observaciones"]) ?? "");
        const costRaw = pick(a, ["cost", "costo", "price", "precio"]);
        const cost = costRaw != null ? Number(costRaw) : undefined;

        return {
          id: pick(a, ["id", "appointment_id", "appointmentId"]),
          date: date || "",
          serviceName,
          doctorName,
          status,
          notes: notes || undefined,
          cost: Number.isFinite(cost as any) ? (cost as number) : undefined,
        };
      };

      // 🆕 “inyectar” monto por cita usando pagos agregados por servicio (o fallback al cost)
      const attachMontoToAppointments = (patientName: string, appts: AppointmentRow[]): AppointmentRow[] => {
        const pKey = norm(patientName);
        return appts.map((a) => {
          const payKey = `${pKey}|${norm(a.serviceName)}`;
          const paid = paymentSumByPatientService.get(payKey);
          const monto = paid != null ? paid : Number.isFinite(a.cost as any) ? (a.cost as number) : 0;
          return { ...a, monto };
        });
      };

      const buildFromFull = (): PatientRow[] => {
        return rawFull
          .map((p) => {
            const id = pick(p, ["id", "patient_id", "patientId"]);
            const name = String(pick(p, ["name", "patient", "nombre", "full_name"]) ?? "").trim();
            const phone = String(pick(p, ["phone", "telefono", "tel", "celular"]) ?? "").trim();

            const apptsIn = pick(p, ["appointments", "citas", "historial", "history"]);
            let appointments: AppointmentRow[] = Array.isArray(apptsIn) ? apptsIn.map(normalizeAppointment).filter((x) => x.date) : [];

            appointments.sort((a, b) => (a.date < b.date ? 1 : -1));
            appointments = attachMontoToAppointments(name, appointments);

            const attended = appointments.filter((a) => mapStatusToBadge(a.status) === "atendida");
            const lastAtt = attended.length ? attended[0] : undefined;

            const { labJobs, labAbonosTotal } = buildLabForPatient({ id, name, phone }, rawLabJobs, labNameById, serviceNameById);
            const paymentsTotal = sumPaymentsForPatient({ id, name, phone }, rawPayments);

            const apptCostTotal = appointments.reduce((s, a) => s + (Number.isFinite(a.cost as any) ? (a.cost as number) : 0), 0);
            const totalSpent = (paymentsTotal > 0 ? paymentsTotal : apptCostTotal) + (labAbonosTotal || 0);

            const statusBadge = appointments.length ? mapStatusToBadge(appointments[0].status) : "Sin citas";
            const key = String(id ?? onlyDigits(phone) ?? name);

            return {
              key,
              id: id as any,
              name: name || "—",
              phone: phone || "—",
              appointments,
              lastAttendedDate: lastAtt?.date || "",
              lastAttendedService: lastAtt?.serviceName || "",
              statusBadge,
              totalSpent,
              labJobs,
              labAbonosTotal,
            };
          })
          .filter((p) => p.name && p.name !== "—");
      };

      const buildFromAppointments = (): PatientRow[] => {
        // Agrupa por patient_id si existe; si no, por teléfono; si no, por nombre.
        const buckets = new Map<string, { id?: any; name: string; phone: string; appts: AppointmentRow[] }>();

        rawAppointments.forEach((a) => {
          const pid = pick(a, ["patient_id", "patientId", "patientid"]);
          const pname = String(pick(a, ["patient", "paciente", "patient_name", "nombre_paciente", "name"]) ?? "").trim();
          const pphone = String(pick(a, ["phone", "telefono", "tel", "celular"]) ?? "").trim();

          const key = pid != null ? `id:${pid}` : pphone ? `ph:${onlyDigits(pphone)}` : `nm:${norm(pname)}`;
          if (!buckets.has(key)) buckets.set(key, { id: pid, name: pname || "—", phone: pphone || "—", appts: [] });

          buckets.get(key)!.appts.push(normalizeAppointment(a));
        });

        const out: PatientRow[] = [];
        for (const [key, b] of buckets.entries()) {
          let appointments = b.appts.filter((x) => x.date).sort((a, b2) => (a.date < b2.date ? 1 : -1));
          appointments = attachMontoToAppointments(b.name, appointments);

          const attended = appointments.filter((a) => mapStatusToBadge(a.status) === "atendida");
          const lastAtt = attended.length ? attended[0] : undefined;

          const { labJobs, labAbonosTotal } = buildLabForPatient({ id: b.id, name: b.name, phone: b.phone }, rawLabJobs, labNameById, serviceNameById);
          const paymentsTotal = sumPaymentsForPatient({ id: b.id, name: b.name, phone: b.phone }, rawPayments);

          const apptCostTotal = appointments.reduce((s, a) => s + (Number.isFinite(a.cost as any) ? (a.cost as number) : 0), 0);
          const totalSpent = (paymentsTotal > 0 ? paymentsTotal : apptCostTotal) + (labAbonosTotal || 0);

          const statusBadge = appointments.length ? mapStatusToBadge(appointments[0].status) : "Sin citas";

          out.push({
            key,
            id: b.id,
            name: b.name || "—",
            phone: b.phone || "—",
            appointments,
            lastAttendedDate: lastAtt?.date || "",
            lastAttendedService: lastAtt?.serviceName || "",
            statusBadge,
            totalSpent,
            labJobs,
            labAbonosTotal,
          });
        }

        // Limpieza (sin inventar)
        return out.filter((p) => p.name && p.name !== "—");
      };

      const finalPatients = rawFull.length ? buildFromFull() : buildFromAppointments();
      setPatients(finalPatients);

      console.log("✅ Pacientes cargados:", finalPatients.length, rawFull.length ? "(full-history)" : "(from appointments)");
    };

    load();
  }, []);

  const filteredPatients = useMemo(() => {
    let filtered = [...patients];

    if (searchTerm) {
      const q = norm(searchTerm);
      const qDigits = onlyDigits(searchTerm);

      filtered = filtered.filter((p) => {
        if (norm(p.name).includes(q)) return true;
        if (qDigits && onlyDigits(p.phone).includes(qDigits)) return true;
        if (p.lastAttendedService && norm(p.lastAttendedService).includes(q)) return true;
        return false;
      });
    }

    if (filterStatus !== "todos") {
      filtered = filtered.filter((p) => p.appointments.some((a) => mapStatusToBadge(a.status) === filterStatus));
    }

    return filtered;
  }, [patients, searchTerm, filterStatus]);

  const stats = useMemo(() => {
    const now = new Date();
    const todayISO = now.toISOString().slice(0, 10);

    let total = patients.length;
    let thisMonth = 0;
    let pending = 0;
    let attendedToday = 0;

    patients.forEach((p) => {
      let hasThisMonth = false;

      p.appointments.forEach((a) => {
        const d = new Date(a.date);
        if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) hasThisMonth = true;
        if (mapStatusToBadge(a.status) === "pendiente") pending++;
        if (mapStatusToBadge(a.status) === "atendida" && a.date === todayISO) attendedToday++;
      });

      if (hasThisMonth) thisMonth++;
    });

    return { total, thisMonth, pending, attendedToday };
  }, [patients]);

  // 🆕 obtener la cita seleccionada del dropdown (o la más reciente)
  const getSelectedAppt = (patient: PatientRow): AppointmentRow | null => {
    const sel = selectedApptByPatient[patient.key];
    if (sel) {
      const found = patient.appointments.find((a) => String(a.id ?? "") === sel);
      if (found) return found;
    }
    return patient.appointments.length ? patient.appointments[0] : null;
  };

  return (
    <div className="fixed inset-0 z-[10000] bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="h-full overflow-auto">
        <div className="max-w-7xl mx-auto p-6">
          {/* Header */}
          <div className="bg-white rounded-2xl shadow-xl mb-6 p-6">
            <div className="flex justify-between items-center">
              <h1 className="text-3xl font-bold flex items-center gap-3">
                <User className="w-8 h-8 text-blue-600" />
                Historial de Pacientes
              </h1>
              <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="bg-white rounded-xl shadow-lg p-4 mb-6">
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar por nombre, teléfono o servicio..."
                  className="w-full pl-10 pr-4 py-3 border rounded-lg focus:outline-none focus:border-blue-500"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <select className="px-4 py-3 border rounded-lg" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="todos">Todos</option>
                <option value="atendida">Atendidos</option>
                <option value="confirmada">Confirmados</option>
                <option value="pendiente">Pendientes</option>
              </select>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white p-6 rounded-xl shadow-lg">
              <div className="text-3xl font-bold text-blue-600">{stats.total}</div>
              <div className="text-gray-600">Total Pacientes</div>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-lg">
              <div className="text-3xl font-bold text-green-600">{stats.thisMonth}</div>
              <div className="text-gray-600">Este Mes</div>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-lg">
              <div className="text-3xl font-bold text-yellow-600">{stats.pending}</div>
              <div className="text-gray-600">Pendientes</div>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-lg">
              <div className="text-3xl font-bold text-purple-600">{stats.attendedToday}</div>
              <div className="text-gray-600">Atendidos hoy</div>
            </div>
          </div>

          {/* Patients Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPatients.map((patient) => {
              const selectedAppt = getSelectedAppt(patient);

              return (
                <div
                  key={patient.key}
                  className="bg-white p-6 rounded-xl shadow-lg hover:shadow-xl transition-shadow cursor-pointer"
                  onClick={() => {
                    setSelectedPatient(patient);
                    setShowModal(true);
                  }}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-xl font-bold">{patient.name}</h3>
                      <p className="text-gray-500">ID: {patient.id != null ? `#${String(patient.id).padStart(5, "0")}` : "—"}</p>

                      {/* 🆕 ID de la cita seleccionada (informativo) */}
                      <p className="text-gray-500 text-xs">
                        ID cita: {selectedAppt?.id != null ? `#${String(selectedAppt.id)}` : "—"}
                      </p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusPillClass(patient.statusBadge || "")}`}>
                      {patient.statusBadge || "Sin citas"}
                    </span>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4 text-gray-400" />
                      <span>{patient.phone}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      <span>
                        Atendido: <b>{patient.lastAttendedDate ? patient.lastAttendedDate : "—"}</b>
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-gray-400" />
                      <span>
                        Servicio: <b>{patient.lastAttendedService ? patient.lastAttendedService : "—"}</b>
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-gray-400" />
                      <span>
                        Lab abonos: <b>${money(patient.labAbonosTotal || 0)}</b> • Trabajos: <b>{patient.labJobs?.length ?? 0}</b>
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      <span>{patient.appointments.length} citas totales</span>
                    </div>

                    {/* 🆕 desplegable: todas las citas con ID + trabajo + monto */}
                    {patient.appointments.length > 0 && (
                      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                        <div className="text-xs text-gray-500 mb-1">Citas (ID • trabajo • monto)</div>
                        <select
                          className="w-full px-3 py-2 border rounded-lg text-sm"
                          value={selectedApptByPatient[patient.key] ?? String(patient.appointments[0]?.id ?? "")}
                          onChange={(e) =>
                            setSelectedApptByPatient((prev) => ({
                              ...prev,
                              [patient.key]: e.target.value,
                            }))
                          }
                        >
                          {patient.appointments.map((a, idx) => {
                            const idTxt = a.id != null ? `#${String(a.id)}` : `#${idx + 1}`;
                            const m = a.monto ?? (Number.isFinite(a.cost as any) ? (a.cost as number) : 0);
                            return (
                              <option key={`${String(a.id ?? idx)}`} value={String(a.id ?? "")}>
                                {idTxt} • {a.serviceName} • ${money(m)}
                              </option>
                            );
                          })}
                        </select>

                        {/* mini detalle del seleccionado */}
                        {selectedAppt && (
                          <div className="mt-2 text-xs text-gray-600">
                            <span className="font-semibold">Trabajo:</span> {selectedAppt.serviceName}{" "}
                            <span className="mx-2">|</span>
                            <span className="font-semibold">Monto:</span> ${money(selectedAppt.monto ?? selectedAppt.cost ?? 0)}
                            <span className="mx-2">|</span>
                            <span className="font-semibold">Fecha:</span> {selectedAppt.date || "—"}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-4 border-t">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total gastado:</span>
                      <span className="font-bold text-green-600">${money(patient.totalSpent || 0)}</span>
                    </div>
                  </div>
                </div>
              );
            })}

            {!filteredPatients.length && (
              <div className="col-span-full text-center text-gray-600 bg-white rounded-xl shadow p-8">
                No hay datos para mostrar. Revisa que <b>/api/appointments</b> regrese citas con paciente, o arregla <b>/api/patients-full-history</b>.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal (lo dejo igual) */}
      {showModal && selectedPatient && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[10001]">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-auto">
            <div className="p-6 border-b">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">{selectedPatient.name}</h2>
                <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <p className="text-gray-600">Teléfono</p>
                  <p className="font-semibold">{selectedPatient.phone}</p>
                </div>

                <div>
                  <p className="text-gray-600">Atendido</p>
                  <p className="font-semibold">{selectedPatient.lastAttendedDate ? selectedPatient.lastAttendedDate : "—"}</p>
                </div>

                <div>
                  <p className="text-gray-600">Servicio cobrado</p>
                  <p className="font-semibold">{selectedPatient.lastAttendedService ? selectedPatient.lastAttendedService : "—"}</p>
                </div>

                <div>
                  <p className="text-gray-600">Total Invertido</p>
                  <p className="font-semibold text-green-600">${money(selectedPatient.totalSpent || 0)}</p>
                </div>

                <div className="col-span-2">
                  <p className="text-gray-600">Laboratorio (abonos acumulados)</p>
                  <p className="font-semibold">
                    ${money(selectedPatient.labAbonosTotal || 0)} • {selectedPatient.labJobs?.length ?? 0} trabajos
                  </p>
                </div>
              </div>

              <h3 className="text-xl font-bold mb-4">Historial de Citas</h3>
              <div className="space-y-4">
                {selectedPatient.appointments.map((apt, idx) => (
                  <div key={`${apt.id ?? idx}`} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-semibold text-lg">
                          {apt.serviceName}{" "}
                          <span className="text-sm text-gray-500 font-normal">
                            (ID: {apt.id != null ? `#${String(apt.id)}` : "—"})
                          </span>
                        </p>
                        <p className="text-gray-600">
                          {apt.doctorName} • {apt.date}
                        </p>
                        {!!apt.notes && <p className="mt-2 text-gray-700">{apt.notes}</p>}
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-lg">${money(apt.monto ?? apt.cost ?? 0)}</p>
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${statusPillClass(String(apt.status))}`}>
                          {mapStatusToBadge(String(apt.status))}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                {!selectedPatient.appointments.length && <div className="text-sm text-gray-500">No hay citas registradas.</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Helpers (Lab + Payments) ----------------

function buildLabForPatient(
  p: { id?: any; name: string; phone: string },
  rawLabJobs: any[],
  labNameById: Map<string, string>,
  serviceNameById: Map<string, string>
): { labJobs: LabJobRow[]; labAbonosTotal: number } {
  const pnameN = norm(p.name);
  const pphoneD = onlyDigits(p.phone);

  const jobs = (rawLabJobs || [])
    .filter((j) => {
      const jPid = pick(j, ["patient_id", "patientId"]);
      if (p.id != null && jPid != null && String(jPid) === String(p.id)) return true;

      const jName = norm(pick(j, ["paciente", "patient", "nombre_paciente", "patient_name"]));
      if (pnameN && jName && jName === pnameN) return true;

      const jPhoneD = onlyDigits(pick(j, ["phone", "telefono", "tel", "celular"]));
      if (pphoneD && jPhoneD && jPhoneD.endsWith(pphoneD)) return true;

      return false;
    })
    .map((j) => {
      const jobId = String(pick(j, ["id", "job_id", "_id"]) ?? "");
      const labId = pick(j, ["laboratorioId", "laboratorio_id"]);
      const serviceId = pick(j, ["servicioId", "servicio_id", "serviceId", "service_id"]);

      const servicio =
        (serviceId != null ? serviceNameById.get(String(serviceId)) : "") ||
        String(pick(j, ["servicio", "service", "nombre_servicio"]) ?? "") ||
        "—";

      const laboratorio =
        (labId != null ? labNameById.get(String(labId)) : "") ||
        String(pick(j, ["laboratorio", "lab", "nombre_laboratorio"]) ?? "") ||
        "—";

      const abonosArr = pick(j, ["abonos", "payments", "pagos"]);
      let abonosTotal = 0;
      if (Array.isArray(abonosArr)) {
        abonosArr.forEach((a: any) => {
          const m = Number(pick(a, ["monto", "amount"]) ?? 0);
          abonosTotal += Number.isFinite(m) ? m : 0;
        });
      }

      return {
        id: jobId || `${servicio}-${laboratorio}-${Math.random()}`,
        servicio,
        laboratorio,
        fechaInicio: toISODate(pick(j, ["fechaInicio", "fecha_inicio", "date", "created_at"])),
        etapa: String(pick(j, ["etapa", "stage", "status", "estado"]) ?? ""),
        abonosTotal,
      };
    })
    .filter((j) => j.id);

  const labAbonosTotal = jobs.reduce((s, j) => s + (Number.isFinite(j.abonosTotal) ? j.abonosTotal : 0), 0);
  return { labJobs: jobs, labAbonosTotal };
}

function sumPaymentsForPatient(p: { id?: any; name: string; phone: string }, rawPayments: any[]): number {
  const pnameN = norm(p.name);
  const pphoneD = onlyDigits(p.phone);
  let sum = 0;

  (rawPayments || []).forEach((pay) => {
    const amt = Number(pick(pay, ["amount", "monto"]) ?? 0);
    if (!Number.isFinite(amt) || amt <= 0) return;

    const payPid = pick(pay, ["patient_id", "patientId"]);
    if (p.id != null && payPid != null && String(payPid) === String(p.id)) {
      sum += amt;
      return;
    }

    const payNameN = norm(pick(pay, ["patient", "paciente", "patient_name", "nombre_paciente"]));
    if (pnameN && payNameN && payNameN === pnameN) {
      sum += amt;
      return;
    }

    const payPhoneD = onlyDigits(pick(pay, ["phone", "telefono", "tel", "celular"]));
    if (pphoneD && payPhoneD && payPhoneD.endsWith(pphoneD)) {
      sum += amt;
      return;
    }
  });

  return sum;
}

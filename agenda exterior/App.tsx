import React, { useEffect, useMemo, useState } from "react";
import {
  Calendar, Plus, X, Check, Edit, Trash2, AlertTriangle, 
  Filter, RefreshCw, Wifi, WifiOff
} from "lucide-react";

// ✅ Importar funciones de API
import { api, getSucursalActual, setSucursal } from "./lib/api";
import SucursalSelector from "./components/SucursalSelector";

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
  phone?: string;
  status?: "Pendiente" | "Confirmada" | "Atendida" | "Cancelada";
};

/* ===================== Utils ===================== */
const DOCTOR_PALETTE = ['#3b82f6','#10b981','#ef4444','#8b5cf6','#f59e0b','#06b6d4','#f472b6'];

const today = new Date();
const fmtDate = (d: Date) => d.toISOString().slice(0,10);

const toDateInput = (v: any) => {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  
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

const addDays = (d: Date, n:number) => { 
  const r=new Date(d); 
  r.setDate(r.getDate()+n); 
  return r 
};

const getWeekStart = (d: Date) => { 
  const r=new Date(d); 
  const day = (r.getDay()+6)%7; 
  r.setDate(r.getDate()-day); 
  r.setHours(0,0,0,0); 
  return r 
};

const rangeDays = (start: Date, end: Date) => { 
  const days: Date[]=[]; 
  let cur=new Date(start); 
  while(cur<=end){ 
    days.push(new Date(cur)); 
    cur=addDays(cur,1)
  } 
  return days 
};

const timeToMins = (t:string)=>{ 
  const [H,M]=t.split(':').map(Number); 
  return H*60+M 
};

const minsToTime = (m:number)=>{ 
  const H=Math.floor(m/60); 
  const M=m%60; 
  return `${String(H).padStart(2,'0')}:${String(M).padStart(2,'0')}` 
};

const snapMins30 = (mins: number) => Math.round(mins / 30) * 30;

const addMinutesToTime = (t: string, deltaMins: number) => {
  const m = timeToMins(t) + deltaMins;
  const clamped = Math.max(8*60, Math.min(20*60 - 30, m));
  return minsToTime(snapMins30(clamped));
};

const isTouchDevice =
  typeof window !== "undefined" &&
  (("ontouchstart" in window) ||
   (navigator?.maxTouchPoints ?? 0) > 0 ||
   (navigator?.msMaxTouchPoints ?? 0) > 0);

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
  date: normalizeDateForServer(dbApt.date),
  startTime: dbApt.start_time,
  durationHours: Number(dbApt.duration_hours),
  serviceId: String(dbApt.service_id),
  phone: dbApt.phone,
  status: dbApt.status
});

/* ===================== Backend CRUD Functions ===================== */

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

/* ===================== Reload Hook ===================== */
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
  }, deps);

  return { data, loading, error, reload };
};

/* ===================== UI Components ===================== */
const blockStylesByStatus = (baseColor: string, status: Appointment['status']) => {
  if (status === 'Atendida') {
    return { background: '#22c55e', color: '#ffffff', border: '2px solid #16a34a' };
  }
  if (status === 'Cancelada') {
    return { background: '#ef4444', color: '#ffffff', border: '2px solid #dc2626' };
  }
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

/* ===================== Week View Component ===================== */
type WeekViewProps = {
  days: Date[],
  getItems: (d:Date)=>Appointment[],
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

function WeekView({ days, getItems, getDoctor, serviceById, onStatus, onEdit, onMove, onResize, selectedDoctor, onDoctorFilter, doctors, onTimeSlotClick }: WeekViewProps){
  const startHour = 8, endHour = 20, slotsPerHour = 2;
  const totalSlots = (endHour - startHour) * slotsPerHour;
  const slotPx = 40;
  const hours = Array.from({length: endHour - startHour}).map((_,i)=> startHour + i);

  const fmtWeekday = (d: Date) =>
    new Intl.DateTimeFormat('es-MX', { weekday: 'long' })
      .format(d)
      .replace('.', '')
      .toLowerCase();

  const fmtHour12 = (h: number) => {
    const ampm = h < 12 ? 'am' : 'pm';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12} ${ampm}`;
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
        className="fixed left-4 top-32 z-30 w-10 h-10 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 flex items-center justify-center"
        title={sidebarOpen ? "Ocultar filtros" : "Mostrar filtros"}
      >
        {sidebarOpen ? <X className="w-5 h-5" /> : <Filter className="w-5 h-5" />}
      </button>

      <div className="flex-1">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">Semana (bloques cada 30 min)</h3>
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

        <div className="grid grid-cols-8 text-xs bg-gray-50 border rounded-t-xl overflow-hidden">
          <div className="p-3 font-medium">Hora</div>
          {days.map((d,i)=> (<div key={i} className="p-3 text-center font-medium">{fmtWeekday(d)}</div>))}
        </div>

        <div className="grid grid-cols-8 border rounded-b-xl relative bg-white">
          <div className="col-span-1 border-r bg-gray-50 relative">
            {hours.map(h=> (
              <div key={h} className="border-t" style={{height: slotPx*slotsPerHour}}>
                <div className="px-3 py-2 text-sm text-gray-600 font-medium">{fmtHour12(h)}</div>
                <div className="border-t mx-3 opacity-30" style={{marginTop: slotPx-1}}/>
              </div>
            ))}
          </div>

          {days.map((d,dayIdx)=>{
            const items = getItems(d);
            const filteredItems = selectedDoctor ? items.filter(a => a.doctorId === selectedDoctor) : items;

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
                      <div className="font-semibold truncate leading-tight">{a.patient}</div>
                      {citaHeight > 28 && (
                        <div className="opacity-90 truncate leading-tight">{serviceById(a.serviceId)?.name}</div>
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
        <div className="text-xs text-gray-500 mt-2">Arrastra para cambiar hora. Resize para duración (30 min).
Doble clic para editar.</div>
      </div>
    </div>
  );
}

/* ===================== Main App Component ===================== */
export default function AgendaApp(){
  // Connection status
  const [isOnline, setIsOnline] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  // Main data states with reload functions
  const { data: doctors, reload: reloadDoctors } = useReloadableFetch(fetchDoctors);
  const { data: services, reload: reloadServices } = useReloadableFetch(fetchServices);
  const { data: appointments, reload: reloadAppointments } = useReloadableFetch(fetchAppointments);

  // UI States
  const [selectedDate, setSelectedDate] = useState<string>(fmtDate(today));
  const [selectedDoctor, setSelectedDoctor] = useState<string>('');
  const [conflictMsg, setConflictMsg] = useState('');
  const [editingApt, setEditingApt] = useState<Appointment|null>(null);
  const [sucursalActual, setSucursalActualState] = useState(getSucursalActual());

  // Form states
  const [newApt, setNewApt] = useState({ 
    patient:'', doctorId:'', date: fmtDate(today), startTime:'09:00', durationHours:1, serviceId:'', phone:'' 
  });
  
  const [isCreatingAppointment, setIsCreatingAppointment] = useState(false);

  // New Doctor/Service states
  const [newDoctor, setNewDoctor] = useState({
    name: '',
    color: DOCTOR_PALETTE[0],
  });
  const [newService, setNewService] = useState({ name:'' });

  // Check if all data is loaded
  const allDataLoaded = doctors && services && appointments;

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

  // Calculations
  const selected = useMemo(()=> new Date(selectedDate+'T00:00:00'),[selectedDate]);
  const weekStart = useMemo(()=> getWeekStart(selected),[selected]);
  const weekDays = useMemo(()=> rangeDays(weekStart, addDays(weekStart,6)),[weekStart]);
 
  function aptsOfDate(d: Date){ 
    const key = fmtDate(d); 
    const filtered = appointments?.filter(a => {
      let aptDate = a.date;
      if (aptDate.includes('T')) {
        aptDate = aptDate.split('T')[0];
      }
      return aptDate === key;
    }).sort((a,b)=> timeToMins(a.startTime)-timeToMins(b.startTime)) || [];
    
    return filtered;
  }

  // Handler para cambio de sucursal
  const handleSucursalChange = async (nuevaSucursal: string) => {
    console.log(`🔄 App: Cambiando a sucursal ${nuevaSucursal}`);
    setSucursalActualState(nuevaSucursal);
    
    try {
      await Promise.all([
        reloadDoctors(),
        reloadServices(), 
        reloadAppointments()
      ]);
      console.log('✅ Todos los datos recargados para la nueva sucursal');
    } catch (err) {
      console.error('❌ Error recargando datos:', err);
      setIsOnline(false);
    }
  };

  // ===================== CRUD Operations with Reload =====================

  // Appointments
  const addAppointment = async ()=>{
    setConflictMsg('');
    if(!newApt.patient || !newApt.doctorId || !newApt.serviceId) return;

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
    
    try {
      await updateAppointment(editingApt.id, editingApt);
      await reloadAppointments();
      setEditingApt(null);
    } catch (error) {
      console.error('Error updating appointment:', error);
      setConflictMsg('Error al actualizar la cita');
      setIsOnline(false);
    }
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

  useEffect(()=>{ document.title = 'Sistema de Agenda - Dentalux'; },[]);

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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-xl mb-6 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-lg">
                📅
              </div>
              <div> 
                <span className='font-semibold text-lg'>Sistema de Agenda</span>
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

            <div className="ml-6">
              <SucursalSelector 
                onSucursalChange={handleSucursalChange}
                showDebug={process.env.NODE_ENV === 'development'}
              />
            </div>

            <div className="flex items-center space-x-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {appointments?.filter(a => a.date === fmtDate(today)).length || 0}
                </div>
                <div className="text-sm text-gray-500">Citas Hoy</div>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="bg-white rounded-2xl shadow-xl p-6">
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

            {/* Vista de calendario */}
            <WeekView
              days={weekDays}
              getItems={aptsOfDate}
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
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-gray-800">Estados de Citas</h4>
                <div className="flex items-center gap-4 text-sm">
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
                💡 Haz clic en el botón de estado de cada cita para cambiarlo, o arrastra las citas para cambiar horarios
              </div>
            </div>

            {/* CRUD Doctores / Servicios */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="border rounded-xl p-4">
                <h3 className="font-semibold mb-3">Doctores</h3>
                <div className="flex gap-2 mb-3">
                  <input 
                    className="px-3 py-2 border rounded-lg flex-1" 
                    placeholder="Nombre" 
                    value={newDoctor.name} 
                    onChange={e=>setNewDoctor({...newDoctor, name:e.target.value})}
                  />
                  <input 
                    type="color" 
                    className="w-12 h-10 border rounded" 
                    value={newDoctor.color} 
                    onChange={e=>setNewDoctor({...newDoctor, color:e.target.value})}
                  />
                  <button 
                    className="bg-blue-600 text-white px-4 rounded-lg hover:bg-blue-700" 
                    onClick={addDoctor}
                  >
                    <Plus className="w-4 h-4 inline mr-1"/>Agregar
                  </button>
                </div>
                <ul className="space-y-2 max-h-48 overflow-auto">
                  {doctors.map(d=>(
                    <li key={d.id} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                      <div className="flex items-center gap-2">
                        <label
                          htmlFor={`color-${d.id}`}
                          className="w-3 h-3 rounded-full ring-1 ring-black/10 cursor-pointer block"
                          style={{ background: d.color || '#3b82f6' }}
                          title="Cambiar color"
                        />
                        <input
                          id={`color-${d.id}`}
                          type="color"
                          value={d.color || '#3b82f6'}
                          onChange={async (e) => {
                            const newColor = e.target.value;
                            try {
                              await updateDoctor(d.id, { color: newColor });
                              await reloadDoctors();
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
                <div className="flex gap-2 mb-3">
                  <input 
                    className="px-3 py-2 border rounded-lg flex-1" 
                    placeholder="Nombre del servicio" 
                    value={newService.name} 
                    onChange={e=>setNewService({name:e.target.value})}
                  />
                  <button 
                    className="bg-blue-600 text-white px-4 rounded-lg hover:bg-blue-700" 
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
                      <label className="text-xs text-gray-500">Servicio</label>
                      <select 
                        className="border px-3 py-2 rounded w-full" 
                        value={editingApt.serviceId} 
                        onChange={e=>setEditingApt({...editingApt, serviceId:e.target.value})}
                      >
                        {services.map(s=> <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
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
                    <Trash2 className="w-4 h-4" /> Eliminar cita
                    </button>
                    <div className="flex gap-2">
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
        </div>

        {/* Footer con estado */}
        <div className="mt-4 text-center text-xs text-gray-500 bg-white rounded-lg p-3">
          🗄️ Backend: PostgreSQL • 
          {isOnline ? '🟢 Conectado' : '🔴 Desconectado'} • 
          Última actualización: {new Date().toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
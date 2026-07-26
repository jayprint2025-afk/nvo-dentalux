// apply-pointer-events-autofind-v2.mjs
// Busca recursivamente App.tsx (ignora node_modules, dist, etc) y reemplaza
// DayView/WeekView por versiones con Pointer Events (sin template literals).

import fs from 'node:fs';
import path from 'node:path';

const IGNORE_DIRS = new Set(['node_modules','dist','build','.git','.next','out']);

function findAppTsx(root) {
  const q = [root];
  while (q.length) {
    const dir = q.shift();
    let list;
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const it of list) {
      if (it.isDirectory()) {
        if (IGNORE_DIRS.has(it.name)) continue;
        q.push(path.join(dir, it.name));
      } else if (it.isFile() && it.name === 'App.tsx') {
        return path.join(dir, it.name);
      }
    }
  }
  return null;
}

const project = process.cwd();
let app = path.join(project, 'src', 'App.tsx');
if (!fs.existsSync(app)) {
  const f = findAppTsx(project);
  if (!f) {
    console.error('❌ No se encontró App.tsx. Ejecuta en la raíz del proyecto.');
    process.exit(1);
  }
  app = f;
}

let src = fs.readFileSync(app, 'utf8');

const markDay = '/* ===================== DayView';
const markWeek = '/* ===================== WeekView';
const markApp = '/* ===================== App Principal';

const iDay = src.indexOf(markDay);
const iWeek = src.indexOf(markWeek);
const iApp = src.indexOf(markApp);

if (iDay === -1 || iWeek === -1 || iApp === -1) {
  console.error('❌ Faltan marcadores. Asegúrate que tu App.tsx tenga:');
  console.error('   ' + markDay);
  console.error('   ' + markWeek);
  console.error('   ' + markApp);
  process.exit(2);
}

const DAY_BLOCK = `/* ===================== DayView (iOS/Pointer) ===================== */
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

  const filteredItems = selectedDoctor ? items.filter(a => a.doctorId === selectedDoctor) : items;

  // === Pointer handlers (sirven para mouse y touch) ===
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

  const verticalGap = 6;

  return (
    <div className="flex gap-6">
      {/* Filtros de doctores */}
      <div className="w-48 space-y-2">
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

      {/* Vista del calendario */}
      <div className="flex-1">
        <h3 className="text-lg font-semibold mb-3">{fmtDate(date)} — Vista del día</h3>
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
                        const height = a.durationHours * 60 / 30 * slotPx - (laneIdx ? verticalGap : 0);
                        const top = laneIdx * verticalGap;
                        const doc = getDoctor(a.doctorId);
                        const styles = blockStylesByStatus(doc.color, a.status);
                        return (
                          <div
                            key={a.id}
                            className="relative rounded-lg p-3 shadow-md cursor-grab active:cursor-grabbing border touch-none"
                            style={{ 
                              ...styles,
                              height,
                              width: (100 / starting.length) + '%',
                              left: ((100 / starting.length) * laneIdx) + '%',
                              top,
                              position: 'absolute'
                            }}
                            onPointerDown={(e)=>onPointerDownMove(e,a)}
                            title={a.patient + ' • ' + ((serviceById(a.serviceId)?.name) || '')}
                            onDoubleClick={()=>onEdit(a)}
                          >
                            <CornerChecks status={a.status} />
                            <div className="font-semibold truncate text-white">{a.patient}</div>
                            <div className="text-xs opacity-90 truncate text-white">{serviceById(a.serviceId)?.name}</div>
                            <div className="text-xs opacity-75 text-white">{a.phone}</div>
                            <div
                              onPointerDown={(e)=>onPointerDownResize(e,a)}
                              className="absolute bottom-0 left-0 right-0 h-2 bg-black/20 hover:bg-black/30 rounded-b cursor-ns-resize"
                            />
                            <button
                              onClick={(e)=>{ e.stopPropagation(); setOpenMenuId(openMenuId===a.id?null:a.id) }}
                              className="absolute bottom-1 left-1 w-6 h-6 rounded-full bg-white/20 backdrop-blur-sm text-white grid place-items-center text-xs hover:bg-white/30 transition-colors"
                              title="Cambiar estado"
                            >S</button>
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
`;
const WEEK_BLOCK = `/* ===================== WeekView (iOS/Pointer) ===================== */
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

  const startIndex = (a: Appointment) => {
    const [H,M] = a.startTime.split(':').map(Number);
    return (H - startHour) * slotsPerHour + (M >= 30 ? 1 : 0);
  };
  const spanSlots = (a: Appointment) => Math.max(1, Math.round(a.durationHours * slotsPerHour));

  const [drag, setDrag] = React.useState<null | {
    id: number, mode:'move'|'resize', originY: number, originStartIdx: number, originDuration: number, dayIndex: number
  }>(null);
  const [openMenuId, setOpenMenuId] = React.useState<number|null>(null);

  // === Pointer handlers ===
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

  const verticalGap = 6;

  return (
    <div className="flex gap-6">
      {/* Filtros de doctores */}
      <div className="w-48 space-y-2">
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

      {/* Vista semanal */}
      <div className="flex-1">
        <h3 className="text-lg font-semibold mb-3">Semana (bloques cada 30 min)</h3>
        <div className="grid grid-cols-8 text-xs bg-gray-50 border rounded-t-xl overflow-hidden">
          <div className="p-3 font-medium">Hora</div>
          {days.map((d,i)=> (<div key={i} className="p-3 text-center font-medium">{fmtDate(d).slice(5)}</div>))}
        </div>

        <div className="grid grid-cols-8 border rounded-b-xl relative bg-white">
          <div className="col-span-1 border-r bg-gray-50">
            {hours.map(h=> (
              <div key={h} className="border-t" style={{height: slotPx*slotsPerHour}}>
                <div className="px-3 py-2 text-sm text-gray-600 font-medium">{String(h).padStart(2,'0')}:00</div>
                <div className="border-t mx-3 opacity-30" style={{marginTop: slotPx-1}}/>
              </div>
            ))}
          </div>

          {days.map((d,dayIdx)=>{
            const items = getItems(d);
            const filteredItems = selectedDoctor ? items.filter(a => a.doctorId === selectedDoctor) : items;

            // agrupar por índice de inicio para acomodar en vertical
            const groups = new Map<number, Appointment[]>();
            filteredItems.forEach(a=>{ const si = startIndex(a); const arr = groups.get(si) || []; arr.push(a); groups.set(si, arr); });

            return (
              <div key={dayIdx} className="col-span-1 border-l relative" style={{height: totalSlots*slotPx}}>
                {Array.from({length: totalSlots}).map((_,i)=> (<div key={i} className="border-t border-dotted border-gray-200" style={{height: slotPx}}/>))}

                {Array.from(groups.entries()).map(([si, arr])=> arr.map((a, laneIdx)=>{
                  const doc = getDoctor(a.doctorId);
                  const top = si * slotPx + laneIdx * verticalGap;
                  const height = spanSlots(a) * slotPx - (laneIdx ? verticalGap : 0);
                  const styles = blockStylesByStatus(doc.color, a.status);

                  return (
                    <div
                      key={a.id}
                      className="absolute text-white text-xs p-2 rounded shadow-md cursor-grab active:cursor-grabbing select-none border touch-none"
                      style={{
                        top, left: 2, width: 'calc(100% - 4px)', height,
                        background: styles.background as string,
                        color: styles.color as string,
                        overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center',
                      }}
                      onPointerDown={(e)=>onPointerDownMove(e,a,dayIdx)}
                      onDoubleClick={()=>onEdit(a)}
                      title={a.patient + ' • ' + ((serviceById(a.serviceId)?.name)||'')}
                    >
                      <CornerChecks status={a.status} />
                      <div className="font-semibold truncate">{a.patient}</div>
                      <div className="opacity-90 truncate">{serviceById(a.serviceId)?.name}</div>
                      <div
                        onPointerDown={(e)=>onPointerDownResize(e,a,dayIdx)}
                        className="absolute bottom-0 left-0 right-0 h-2 bg-black/20 hover:bg-black/30 rounded-b cursor-ns-resize"
                      />
                      <button
                        onClick={(e)=>{ e.stopPropagation(); setOpenMenuId(openMenuId===a.id?null:a.id) }}
                        className="absolute bottom-1 left-1 w-5 h-5 rounded-full bg-white/20 backdrop-blur-sm text-white grid place-items-center text-[10px] hover:bg-white/30 transition-colors"
                        title="Cambiar estado"
                      >S</button>
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
        <div className="text-xs text-gray-500 mt-2">Arrastra para cambiar hora. Resize para duración (30 min). Doble clic para editar.</div>
      </div>
    </div>
  );
}
`;

let out = src.slice(0, iDay) + DAY_BLOCK + '\\n\\n' + src.slice(iWeek);
const newWeekIdx = out.indexOf(markWeek);
const newAppIdx = out.indexOf(markApp);
out = out.slice(0, newWeekIdx) + WEEK_BLOCK + '\\n\\n' + out.slice(newAppIdx);

fs.writeFileSync(app, out, 'utf8');
console.log('✅ Actualizado:', app);

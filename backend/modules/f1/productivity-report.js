'use strict';

// Consulta operativa: fechas de cobro y fechas de cita son independientes.
async function productivityActivity(q, ctx, {branch, from, to, doctorId, details}) {
  const params = [ctx.tenant_id, branch, from, to];
  const doctorFilter = alias => doctorId == null ? '' : ` AND ${alias}.doctor_id=$5`;
  if (doctorId != null) params.push(Number(doctorId));
  const scope = alias => `${alias}.tenant_id=$1::uuid AND (${alias}.sucursal_id=$2 OR ${alias}.sucursal_id IS NULL)`;
  const payments = (await q(`
    SELECT p.id,p.appointment_id,p.patient,p.service_id,p.amount,p.payment_method,p.date::text AS date,p.doctor_id,
           d.name AS doctor_name,s.name AS service_name,
           a.id AS linked_appointment_id,a.patient AS appointment_patient,
           a.date::text AS appointment_date,a.status AS appointment_status
      FROM payments p
      LEFT JOIN doctors d ON d.id=p.doctor_id AND d.tenant_id=p.tenant_id
        AND (d.sucursal_id=$2 OR d.sucursal_id IS NULL)
      LEFT JOIN services s ON s.id=p.service_id AND s.tenant_id=p.tenant_id
        AND (s.sucursal_id=$2 OR s.sucursal_id IS NULL)
      LEFT JOIN appointments a ON a.id=p.appointment_id AND a.tenant_id=p.tenant_id
        AND (a.sucursal_id=$2 OR a.sucursal_id IS NULL)
     WHERE ${scope('p')} AND p.date BETWEEN $3::date AND $4::date${doctorFilter('p')}
     ORDER BY p.date,p.id`, params)).rows;
  const expenses = (await q(`
    SELECT e.id,e.concept,e.amount,e.date::text AS date,e.doctor_id,e.payment_method
      FROM expenses e
     WHERE ${scope('e')} AND e.date BETWEEN $3::date AND $4::date${doctorFilter('e')}
     ORDER BY e.date,e.id`,params)).rows;
  const appointments = (await q(`
    SELECT a.id,a.patient,a.date::text AS date,a.start_time::text AS start_time,a.status,a.doctor_id,
           d.name AS doctor_name,a.service_id,s.name AS service_name,
           COALESCE((SELECT SUM(p.amount) FROM payments p
             WHERE p.appointment_id=a.id AND p.tenant_id=a.tenant_id
               AND (p.sucursal_id=$2 OR p.sucursal_id IS NULL)),0)::numeric AS paid_amount_all_dates
      FROM appointments a
      LEFT JOIN doctors d ON d.id=a.doctor_id AND d.tenant_id=a.tenant_id
        AND (d.sucursal_id=$2 OR d.sucursal_id IS NULL)
      LEFT JOIN services s ON s.id=a.service_id AND s.tenant_id=a.tenant_id
        AND (s.sucursal_id=$2 OR s.sucursal_id IS NULL)
     WHERE ${scope('a')} AND a.date BETWEEN $3::date AND $4::date${doctorFilter('a')}
     ORDER BY a.date,a.start_time,a.id`,params)).rows;

  const serviceMap=new Map(), patientMap=new Map(), days=new Map(), methods=new Map();
  const amount = row => Number(row.amount || 0);
  const dateKey = value => value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
  const day = value => {const key=dateKey(value);if(!days.has(key))days.set(key,{date:key,income:0,expenses:0,net:0});return days.get(key);};
  const service = row => {const key=row.service_id==null?'unknown':String(row.service_id);if(!serviceMap.has(key))serviceMap.set(key,{service_id:row.service_id,service_name:row.service_name||'Servicio no identificado',payment_count:0,income:0,appointment_count:0,attended_appointments:0});return serviceMap.get(key);};
  const patient = name => {const key=String(name||'').trim();if(!key)return null;if(!patientMap.has(key))patientMap.set(key,{patient:key,appointment_count:0,attended_appointments:0,payment_count:0,income:0});return patientMap.get(key);};
  const attended = status => ['atendida','atendido','completada','completado'].includes(String(status||'').toLowerCase());
  for(const p of payments){const s=service(p);s.payment_count++;s.income+=amount(p);day(p.date).income+=amount(p);const m=String(p.payment_method||'Sin especificar');methods.set(m,(methods.get(m)||0)+amount(p));const person=patient(p.patient);if(person){person.payment_count++;person.income+=amount(p);}}
  const statusCounts={};
  for(const a of appointments){statusCounts[a.status]=(statusCounts[a.status]||0)+1;const s=service(a);s.appointment_count++;if(attended(a.status))s.attended_appointments++;const person=patient(a.patient);if(person){person.appointment_count++;if(attended(a.status))person.attended_appointments++;}}
  for(const e of expenses)day(e.date).expenses+=amount(e);
  const serviceRows=[...serviceMap.values()];
  const totalAttended=appointments.filter(a=>attended(a.status)).length;
  return {
    period_summary:{appointment_count:appointments.length,attended_appointments:totalAttended,status_counts:statusCounts,attendance_rate_pct:appointments.length?100*totalAttended/appointments.length:0,payment_count:payments.length,expense_count:expenses.length,payments_with_verified_appointment:payments.filter(p=>p.linked_appointment_id!=null).length,payments_without_verified_appointment:payments.filter(p=>p.linked_appointment_id==null).length},
    service_analysis:{services:serviceRows,most_popular_by_payments:serviceRows.filter(s=>s.payment_count>0).sort((a,b)=>b.payment_count-a.payment_count||b.income-a.income).slice(0,5),highest_income:serviceRows.filter(s=>s.income>0).sort((a,b)=>b.income-a.income).slice(0,5),least_popular_by_payments:serviceRows.filter(s=>s.payment_count>0).sort((a,b)=>a.payment_count-b.payment_count).slice(0,5),profit_margin_available:false,note:'El panel clasifica popularidad por número de pagos y rentabilidad por ingresos cobrados. No son citas únicas ni utilidad después de costos; appointment_count cuenta citas separadamente.'},
    payment_methods:[...methods].map(([payment_method,income])=>({payment_method,income})),
    daily_totals:[...days.values()].map(d=>({...d,net:d.income-d.expenses})).sort((a,b)=>a.date.localeCompare(b.date)),
    patients:[...patientMap.values()],
    detail_included:details,
    ...(details?{payments,expenses,appointments}:{}),
    data_notes:['Cobros y gastos se filtran por fecha del movimiento; las citas por fecha de agenda. Un pago puede corresponder a una cita fuera del rango.','paid_amount_all_dates incluye pagos vinculados de cualquier fecha y no debe sumarse al ingreso del período.','Un paciente con pagos no implica una cita atendida. Los nombres no son identificadores únicos de paciente.','Si hay servicios no identificados, no deducir ni inventar el tratamiento. No hay un reporte de ventas de productos en esta herramienta.'],
  };
}
module.exports={productivityActivity};

'use strict';

function localNowParts(timeZone = 'America/Tijuana', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  const map = Object.fromEntries(
    parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value])
  );

  return {
    date: `${map.year}-${map.month}-${map.day}`,
    minutes: Number(map.hour) * 60 + Number(map.minute),
  };
}


const crypto = require('crypto');
const { createAppointmentTransactional } = require('../booking-engine');

function bookingKey(data) {
  return crypto.createHash('sha256').update(JSON.stringify({
    branch_key:data.branch_key,
    service_id:String(data.service_id || ''),
    date:data.date,
    start_time:data.start_time,
    patient:String(data.patient || '').trim().toLowerCase(),
    phone:String(data.phone || '').replace(/\D/g,''),
  })).digest('hex').slice(0,24);
}

function timeToMinutes(value) {
  const [h, m] = String(value || '00:00').slice(0, 5).split(':').map(Number);
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}
function minutesToTime(value) {
  const h = Math.floor(value / 60);
  const m = value % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
function parseBusinessHours(text, date) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const day = new Date(`${date}T12:00:00`).getDay(); // 0 dom ... 6 sáb
  const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const segments = normalized.split(/[;\n]+/).map(v => v.trim()).filter(Boolean);
  const labels = day === 0 ? ['dom','domingo'] : day === 6 ? ['sab','sabado'] : ['l-v','lun-vie','lunes a viernes','lunes-viernes'];
  let chosen = segments.find(seg => labels.some(label => seg.includes(label)));
  if (!chosen && day >= 1 && day <= 5) chosen = segments.find(seg => /lunes|lun|l-v/.test(seg));
  if (!chosen) return null;
  if (/cerrado|no\s+abr/.test(chosen)) return { closed: true };
  const times = [...chosen.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(?:h|hrs?)?/g)]
    .map(m => ({ h:Number(m[1]), m:Number(m[2] || 0) }))
    .filter(x => x.h <= 23 && x.m <= 59)
    .map(x => x.h * 60 + x.m);
  if (times.length < 2) return null;
  return { start: times[0], end: times[1], closed: false };
}
async function checkAvailability(q, ctx, args) {
  const tenantId = String(ctx.tenant_id || ctx.clinic_id || '').trim();
  const branchKey = String(args.branch_key || '').trim();
  const date = String(args.date || '').slice(0,10);
  const serviceId = String(args.service_id || '').trim();
  if (!tenantId || !branchKey || !date) return { slots: [], date, branch_key: branchKey, reason: 'missing_context' };

  const branchResult = await q(
    `SELECT business_hours, booking_enabled, active FROM branches
      WHERE tenant_id=$1::uuid AND branch_key=$2 LIMIT 1`, [tenantId, branchKey]
  );
  const branch = branchResult.rows?.[0];
  if (!branch || branch.active === false || branch.booking_enabled === false) {
    return { slots: [], date, branch_key: branchKey, reason: 'branch_not_bookable' };
  }

  let durationHours = Number(args.duration_hours || 0);
  if (serviceId) {
    const serviceResult = await q(
      `SELECT id, COALESCE(duration_hours,1) AS duration_hours
         FROM services
        WHERE tenant_id=$1::uuid AND sucursal_id=$2 AND id::text=$3
          AND COALESCE(active,TRUE)=TRUE LIMIT 1`,
      [tenantId, branchKey, serviceId]
    );
    if (!serviceResult.rows?.[0]) return { slots: [], date, branch_key: branchKey, reason: 'service_not_in_branch' };
    durationHours = Number(serviceResult.rows[0].duration_hours || durationHours || 1);
  }
  if (!Number.isFinite(durationHours) || durationHours <= 0) durationHours = 1;
  const durationMins = Math.max(30, Math.ceil(durationHours * 60 / 30) * 30);

  const hours = parseBusinessHours(branch.business_hours, date);
  if (hours?.closed) return { slots: [], date, branch_key: branchKey, reason: 'closed' };
  const start = hours?.start ?? 8 * 60;
  const end = hours?.end ?? 20 * 60;

  const doctorsResult = await q(
    `SELECT id, name FROM doctors
      WHERE tenant_id=$1::uuid AND sucursal_id=$2 ORDER BY id`, [tenantId, branchKey]
  );
  const doctors = doctorsResult.rows || [];
  if (!doctors.length) return { slots: [], date, branch_key: branchKey, reason: 'no_doctors' };

  const appointmentsResult = await q(
    `SELECT id, doctor_id, start_time::text AS start_time, COALESCE(duration_hours,1) AS duration_hours, status
       FROM appointments
      WHERE tenant_id=$1::uuid AND sucursal_id=$2 AND date=$3::date
        AND LOWER(COALESCE(status,'')) NOT LIKE '%cancel%'`,
    [tenantId, branchKey, date]
  );
  const busy = appointmentsResult.rows || [];
  const timeZone =
    branch.timezone ||
    branch.time_zone ||
    process.env.CLINIC_TIMEZONE ||
    'America/Tijuana';
  const localNow = localNowParts(timeZone);
  const todayLocal = localNow.date;
  const currentMins = localNow.minutes;
  const minRequested = args.min_start_mins == null ? null : Number(args.min_start_mins);
  const slots = [];

  for (let slotStart = start; slotStart + durationMins <= end; slotStart += 30) {
    if (date === todayLocal && slotStart <= currentMins) continue;
    if (Number.isFinite(minRequested) && slotStart < minRequested) continue;
    const slotEnd = slotStart + durationMins;
    // Modelo actual de agenda de CliniqOne para esta sucursal:
    // una cita ocupa el horario de la sucursal completa. Esto evita dobles reservas
    // aunque existan varios doctores registrados o doctor_id distinto.
    const branchBusy = busy.some(apt => {
      const aptStart = timeToMinutes(apt.start_time);
      const aptDurationHours = Number(apt.duration_hours || 1);
      const aptDurationMins = Math.max(
        30,
        Math.ceil((Number.isFinite(aptDurationHours) && aptDurationHours > 0 ? aptDurationHours : 1) * 60)
      );
      const aptEnd = aptStart + aptDurationMins;
      return slotStart < aptEnd && slotEnd > aptStart;
    });
    if (branchBusy) continue;

    // Conservamos un doctor para guardar la cita, pero la disponibilidad ya fue
    // validada a nivel sucursal.
    const freeDoctor = doctors[0];
    if (!freeDoctor) continue;
    slots.push({
      date,
      start_time: minutesToTime(slotStart),
      end_time: minutesToTime(slotEnd),
      doctor_id: freeDoctor.id,
      doctor_name: freeDoctor.name,
      duration_hours: durationHours,
      verified: true,
    });
    if (slots.length >= Number(args.limit || 20)) break;
  }

  let filtered = slots;
  if (args.after_time) filtered = filtered.filter(slot => slot.start_time >= String(args.after_time).slice(0,5));
  if (args.before_time) filtered = filtered.filter(slot => slot.start_time <= String(args.before_time).slice(0,5));
  if (args.exact_time) filtered = filtered.filter(slot => slot.start_time === String(args.exact_time).slice(0,5));
  return { slots: filtered.slice(0,8), date, branch_key: branchKey, verified: true, source: 'appointments_db' };
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

async function findFutureAppointment(q, ctx, args = {}) {
  const tenantId = String(ctx.tenant_id || ctx.clinic_id || '').trim();
  if (!tenantId) throw new Error('No se pudo identificar la empresa');

  const phone = normalizePhone(args.phone);
  const patient = String(args.patient || '').trim();

  const { rows } = await q(
    `SELECT id, patient, phone, doctor_id, service_id, date,
            start_time::text AS start_time, duration_hours, status,
            sucursal_id, tenant_id
       FROM appointments
      WHERE tenant_id = $1::uuid
        AND date >= CURRENT_DATE
        AND LOWER(COALESCE(status,'')) NOT LIKE '%cancel%'
        AND (
          ($2 <> '' AND regexp_replace(COALESCE(phone,''), '\\D', '', 'g') = $2)
          OR
          ($3 <> '' AND LOWER(TRIM(patient)) = LOWER(TRIM($3)))
        )
      ORDER BY date ASC, start_time ASC, id ASC
      LIMIT 1`,
    [tenantId, phone, patient]
  );

  return rows[0] || null;
}

async function rescheduleAppointment(q, ctx, args = {}) {
  const tenantId = String(ctx.tenant_id || ctx.clinic_id || '').trim();
  if (!tenantId) throw new Error('No se pudo identificar la empresa');

  const current = await findFutureAppointment(q, ctx, args);
  if (!current) {
    const error = new Error('No encontré una cita futura para reagendar');
    error.code = 'APPOINTMENT_NOT_FOUND';
    throw error;
  }

  const branchKey = String(args.branch_key || current.sucursal_id || '').trim();
  const date = String(args.date || '').slice(0, 10);
  const startTime = String(args.start_time || '').slice(0, 5);

  if (!branchKey || !date || !startTime) {
    throw new Error('Faltan sucursal, fecha u hora para reagendar');
  }

  const { rows } = await q(
    `UPDATE appointments
        SET date = $1::date,
            start_time = $2::time,
            doctor_id = COALESCE($3, doctor_id),
            service_id = COALESCE($4, service_id),
            sucursal_id = $5
      WHERE id = $6
        AND tenant_id = $7::uuid
      RETURNING id, patient, phone, doctor_id, service_id, date,
                start_time::text AS start_time, duration_hours, status,
                sucursal_id, tenant_id`,
    [
      date,
      startTime,
      args.doctor_id ? Number(args.doctor_id) : null,
      args.service_id ? Number(args.service_id) : null,
      branchKey,
      current.id,
      tenantId,
    ]
  );

  return {
    appointment: rows[0],
    previous: current,
    rescheduled: true,
  };
}


async function cancelAppointment(q, ctx, args = {}) {
  const tenantId = String(ctx.tenant_id || ctx.clinic_id || '').trim();
  if (!tenantId) throw new Error('No se pudo identificar la empresa');

  const appointmentId = Number(args.appointment_id || args.id);
  if (!Number.isFinite(appointmentId) || appointmentId <= 0) {
    throw new Error('ID de cita inválido');
  }

  const { rows } = await q(
    `UPDATE appointments
        SET status = 'Cancelada'
      WHERE id = $1
        AND tenant_id = $2::uuid
      RETURNING id, patient, phone, doctor_id, service_id, date,
                start_time::text AS start_time, duration_hours, status,
                sucursal_id, tenant_id`,
    [appointmentId, tenantId]
  );

  if (!rows[0]) {
    const error = new Error('No encontré la cita para cancelar');
    error.code = 'APPOINTMENT_NOT_FOUND';
    throw error;
  }

  return rows[0];
}


async function createAppointment(q, ctx, args) {
  return createAppointmentTransactional(q, {
    tenant_id: ctx.tenant_id || ctx.clinic_id,
    clinic_id: ctx.clinic_id || ctx.tenant_id,
    branch_key: args.branch_key,
    patient: args.patient,
    phone: args.phone,
    service_id: args.service_id,
    slot: { date: args.date, start_time: args.start_time, end_time: args.end_time || null },
  });
}

module.exports={checkAvailability,createAppointment,findFutureAppointment,rescheduleAppointment,cancelAppointment,bookingKey};

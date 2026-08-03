'use strict';
const crypto = require('crypto');
const { computeAvailability, createAppointmentTransactional } = require('../booking-engine');

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

async function checkAvailability(q, ctx, args) {
  const result = await computeAvailability(q, {
    clinic_id: ctx.tenant_id || ctx.clinic_id,
    branch_key: args.branch_key,
    date: args.date,
    duration_hours: Number(args.duration_hours || 1),
    limit: Number(args.limit || 20),
    min_start_mins: args.min_start_mins == null ? null : Number(args.min_start_mins),
  });
  let slots = Array.isArray(result?.slots) ? result.slots : [];
  if (args.after_time) slots = slots.filter(slot => String(slot.start_time).slice(0,5) >= String(args.after_time).slice(0,5));
  if (args.before_time) slots = slots.filter(slot => String(slot.start_time).slice(0,5) <= String(args.before_time).slice(0,5));
  if (args.exact_time) slots = slots.filter(slot => String(slot.start_time).slice(0,5) === String(args.exact_time).slice(0,5));
  return { slots: slots.slice(0,8), date: args.date, branch_key: args.branch_key };
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

module.exports={checkAvailability,createAppointment,findFutureAppointment,rescheduleAppointment,bookingKey};

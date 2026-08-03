'use strict';
const crypto = require('crypto');
const { computeAvailability, createAppointmentTransactional } = require('../booking-engine');

// Evita que dos webhooks simultáneos creen la misma cita dentro de esta instancia.
// La cola se libera siempre, incluso si la creación falla.
const appointmentCreationQueues = new Map();

async function withAppointmentCreationLock(key, task) {
  const lockKey = String(key);
  const previous = appointmentCreationQueues.get(lockKey) || Promise.resolve();

  let release;
  const current = new Promise(resolve => { release = resolve; });
  appointmentCreationQueues.set(lockKey, previous.catch(() => {}).then(() => current));

  await previous.catch(() => {});

  try {
    return await task();
  } finally {
    release();
    if (appointmentCreationQueues.get(lockKey) === current) {
      appointmentCreationQueues.delete(lockKey);
    }
  }
}


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

async function createAppointment(q, ctx, args) {
  const tenantId = String(ctx.tenant_id || ctx.clinic_id || '').trim();
  if (!tenantId) throw new Error('No se pudo identificar la empresa para crear la cita');

  const normalizedArgs = {
    ...args,
    branch_key: String(args.branch_key || '').trim(),
    patient: String(args.patient || '').trim(),
    phone: String(args.phone || '').replace(/\D/g, ''),
    date: String(args.date || '').slice(0, 10),
    start_time: String(args.start_time || '').slice(0, 5),
  };

  const key = `${tenantId}:${bookingKey(normalizedArgs)}`;

  return withAppointmentCreationLock(key, async () => {
    // Verificación idempotente antes del INSERT. Si el mismo webhook fue procesado
    // de nuevo, devolvemos la cita existente en vez de crear otra.
    const existing = await q(
      `SELECT id, patient, phone, doctor_id, service_id, date,
              start_time::text AS start_time, duration_hours, status,
              sucursal_id, tenant_id
         FROM appointments
        WHERE tenant_id = $1::uuid
          AND sucursal_id = $2
          AND date = $3::date
          AND start_time::time = $4::time
          AND COALESCE(service_id::text, '') = COALESCE($5::text, '')
          AND LOWER(TRIM(patient)) = LOWER(TRIM($6))
          AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $7
        ORDER BY id DESC
        LIMIT 1`,
      [
        tenantId,
        normalizedArgs.branch_key,
        normalizedArgs.date,
        normalizedArgs.start_time,
        normalizedArgs.service_id || null,
        normalizedArgs.patient,
        normalizedArgs.phone,
      ]
    );

    if (existing.rows[0]) {
      return {
        ...existing.rows[0],
        verified: true,
        deduplicated: true,
      };
    }

    const created = await createAppointmentTransactional(q, {
      tenant_id: tenantId,
      clinic_id: ctx.clinic_id || tenantId,
      branch_key: normalizedArgs.branch_key,
      patient: normalizedArgs.patient,
      phone: normalizedArgs.phone,
      service_id: normalizedArgs.service_id,
      slot: {
        date: normalizedArgs.date,
        start_time: normalizedArgs.start_time,
        end_time: args.end_time || null,
      },
    });

    return {
      ...created,
      deduplicated: false,
    };
  });
}

module.exports={checkAvailability,createAppointment,bookingKey};

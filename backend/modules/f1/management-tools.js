'use strict';

const {
  getDoctors,
  getServices,
  computeAvailability,
  createAppointmentTransactional,
} = require('../booking-engine');

function text(value) {
  return value == null ? '' : String(value).trim();
}

function localDate(timeZone = process.env.TZ || 'America/Tijuana', offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const noonUtc = new Date(Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day) + offsetDays, 12));
  return noonUtc.toISOString().slice(0, 10);
}

function normalizeStatus(value) {
  return text(value).toLowerCase();
}

async function todaySummary(q, ctx, args = {}) {
  const date = text(args.date) || localDate(ctx.timezone);
  const branch = text(args.branch_key || ctx.branch_key) || null;
  const tenantId = ctx.tenant_id;
  const params = [tenantId, date];
  let branchSql = '';
  if (branch) {
    params.push(branch);
    branchSql = ` AND (a.sucursal_id = $3 OR a.sucursal_id IS NULL)`;
  }

  const { rows } = await q(`
    SELECT a.id, a.patient, a.phone, a.date, a.start_time::text AS start_time,
           a.status, a.doctor_id, d.name AS doctor_name, s.name AS service_name
      FROM appointments a
      LEFT JOIN doctors d ON d.id = a.doctor_id
      LEFT JOIN services s ON s.id = a.service_id
     WHERE a.tenant_id = $1::uuid
       AND a.date = $2::date
       ${branchSql}
     ORDER BY a.start_time ASC, a.id ASC
  `, params);

  const counts = { total: rows.length, pending: 0, confirmed: 0, attended: 0, cancelled: 0 };
  for (const row of rows) {
    const status = normalizeStatus(row.status);
    if (status.includes('cancel')) counts.cancelled += 1;
    else if (status.includes('confirm')) counts.confirmed += 1;
    else if (status.includes('atendid') || status.includes('complet')) counts.attended += 1;
    else counts.pending += 1;
  }

  return {
    date,
    branch_key: branch,
    counts,
    first_appointment: rows[0] || null,
    last_appointment: rows.length ? rows[rows.length - 1] : null,
    appointments: rows,
  };
}

async function listDoctors(q, ctx, args = {}) {
  return { doctors: await getDoctors(q, ctx.tenant_id, text(args.branch_key || ctx.branch_key) || null) };
}

async function listServices(q, ctx, args = {}) {
  return { services: await getServices(q, ctx.tenant_id, text(args.branch_key || ctx.branch_key) || null) };
}

async function checkAvailability(q, ctx, args = {}) {
  const branchKey = text(args.branch_key || ctx.branch_key);
  if (!branchKey) throw new Error('Falta la sucursal');
  if (!args.date) throw new Error('Falta la fecha');

  const result = await computeAvailability(q, {
    clinic_id: ctx.tenant_id,
    branch_key: branchKey,
    date: text(args.date),
    duration_hours: Number(args.duration_hours || 1),
    limit: Number(args.limit || 80),
    min_start_mins: null,
  });

  let slots = Array.isArray(result.slots) ? result.slots : [];
  if (args.exact_time) {
    const exact = text(args.exact_time).slice(0, 5);
    slots = slots.filter(slot => text(slot.start_time).slice(0, 5) === exact);
  }
  if (args.doctor_id) slots = slots.filter(slot => String(slot.doctor_id) === String(args.doctor_id));
  return { date: args.date, branch_key: branchKey, slots: slots.slice(0, 20) };
}

async function createAppointment(q, ctx, args = {}) {
  const branchKey = text(args.branch_key || ctx.branch_key);
  const required = ['patient', 'service_id', 'date', 'start_time'];
  const missing = required.filter(key => !text(args[key]));
  if (!branchKey) missing.push('branch_key');
  if (missing.length) throw new Error(`Faltan datos: ${missing.join(', ')}`);

  let selectedSlot = {
    date: text(args.date),
    start_time: text(args.start_time).slice(0, 5),
    duration_hours: Number(args.duration_hours || 1),
    doctor_id: args.doctor_id ? String(args.doctor_id) : null,
    doctor_name: args.doctor_name || null,
  };

  if (!selectedSlot.doctor_id) {
    const available = await checkAvailability(q, ctx, {
      branch_key: branchKey,
      date: selectedSlot.date,
      exact_time: selectedSlot.start_time,
      duration_hours: selectedSlot.duration_hours,
      limit: 100,
    });
    if (!available.slots.length) throw new Error('Ese horario no está disponible');
    selectedSlot = { ...selectedSlot, ...available.slots[0] };
  }

  const created = await createAppointmentTransactional(q, {
    tenant_id: ctx.tenant_id,
    clinic_id: ctx.tenant_id,
    branch_key: branchKey,
    patient: text(args.patient),
    phone: text(args.phone) || null,
    service_id: String(args.service_id),
    slot: selectedSlot,
  });

  return { ok: true, appointment: created };
}

async function findAppointments(q, ctx, args = {}) {
  const tenantId = ctx.tenant_id;
  const branch = text(args.branch_key || ctx.branch_key) || null;
  const patient = text(args.patient);
  const date = text(args.date);
  const params = [tenantId];
  const where = ['a.tenant_id = $1::uuid'];
  if (branch) { params.push(branch); where.push(`(a.sucursal_id = $${params.length} OR a.sucursal_id IS NULL)`); }
  if (patient) { params.push(`%${patient}%`); where.push(`a.patient ILIKE $${params.length}`); }
  if (date) { params.push(date); where.push(`a.date = $${params.length}::date`); }
  const { rows } = await q(`
    SELECT a.id, a.patient, a.phone, a.date, a.start_time::text AS start_time,
           a.status, a.doctor_id, a.service_id, d.name AS doctor_name, s.name AS service_name
      FROM appointments a
      LEFT JOIN doctors d ON d.id=a.doctor_id
      LEFT JOIN services s ON s.id=a.service_id
     WHERE ${where.join(' AND ')}
     ORDER BY a.date DESC, a.start_time ASC
     LIMIT 30
  `, params);
  return { appointments: rows };
}

async function cancelAppointment(q, ctx, args = {}) {
  const id = Number(args.appointment_id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('appointment_id inválido');
  const { rows } = await q(`
    UPDATE appointments
       SET status='Cancelada'
     WHERE id=$1 AND tenant_id=$2::uuid
     RETURNING id, patient, date, start_time::text AS start_time, status
  `, [id, ctx.tenant_id]);
  if (!rows[0]) throw new Error('Cita no encontrada');
  return { ok: true, appointment: rows[0] };
}

async function rescheduleAppointment(q, ctx, args = {}) {
  const id = Number(args.appointment_id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('appointment_id inválido');
  if (!args.date || !args.start_time) throw new Error('Faltan fecha u hora');

  const { rows: currentRows } = await q(`
    SELECT id, patient, phone, service_id, doctor_id, sucursal_id
      FROM appointments
     WHERE id=$1 AND tenant_id=$2::uuid
     LIMIT 1
  `, [id, ctx.tenant_id]);
  const current = currentRows[0];
  if (!current) throw new Error('Cita no encontrada');

  const branchKey = text(args.branch_key || current.sucursal_id || ctx.branch_key);
  const available = await checkAvailability(q, ctx, {
    branch_key: branchKey,
    date: text(args.date),
    exact_time: text(args.start_time).slice(0, 5),
    doctor_id: args.doctor_id || current.doctor_id,
    duration_hours: Number(args.duration_hours || 1),
  });
  if (!available.slots.length) throw new Error('Ese horario no está disponible');
  const slot = available.slots[0];

  const { rows } = await q(`
    UPDATE appointments
       SET date=$1::date, start_time=$2, doctor_id=$3, sucursal_id=$4, status='Pendiente'
     WHERE id=$5 AND tenant_id=$6::uuid
     RETURNING id, patient, date, start_time::text AS start_time, doctor_id, status
  `, [args.date, slot.start_time, slot.doctor_id, branchKey, id, ctx.tenant_id]);
  return { ok: true, appointment: rows[0] };
}

const handlers = {
  get_today_summary: todaySummary,
  list_doctors: listDoctors,
  list_services: listServices,
  check_availability: checkAvailability,
  create_appointment: createAppointment,
  find_appointments: findAppointments,
  cancel_appointment: cancelAppointment,
  reschedule_appointment: rescheduleAppointment,
};

async function executeTool(q, ctx, name, args) {
  const handler = handlers[name];
  if (!handler) throw new Error(`Herramienta F1 no permitida: ${name}`);
  return handler(q, ctx, args || {});
}

module.exports = { executeTool, handlers, localDate };

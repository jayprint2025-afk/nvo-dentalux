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

module.exports={checkAvailability,createAppointment,bookingKey};

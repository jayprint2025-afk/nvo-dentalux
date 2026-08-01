'use strict';

const { getServices, computeAvailability, createAppointmentTransactional } = require('../booking-engine');
const { getClinicBranch, getBranchDisplayName } = require('../tenant-context');
const { normalize, timeToMinutes } = require('./utils');

async function services(q, branchKey) {
  return getServices(q, branchKey);
}

function matchService(list, text) {
  const n = normalize(text);
  if (!n) return null;
  let best = null;
  for (const s of list || []) {
    const name = normalize(s.name);
    let score = 0;
    if (n === name) score = 100;
    else if (n.includes(name) || name.includes(n)) score = 80;
    else {
      const words = name.split(' ').filter(w => w.length > 3);
      score = words.filter(w => n.includes(w)).length * 10;
    }
    if (!best || score > best.score) best = { ...s, score };
  }
  return best?.score > 0 ? best : null;
}

async function availability(q, ctx, state) {
  const result = await computeAvailability(q, {
    clinic_id: ctx.tenant_id || ctx.clinic_id,
    branch_key: state.branch_key,
    date: state.date,
    duration_hours: Number(state.duration_hours || 1),
    limit: Number(process.env.RECEPTIONIST_V4_SLOT_LIMIT || 30),
    min_start_mins: null,
  });
  let slots = Array.isArray(result.slots) ? result.slots : [];
  const pref = state.time_preference;
  if (pref?.kind === 'exact') {
    const exact = slots.filter(s => timeToMinutes(s.start_time) === pref.minutes);
    if (exact.length) slots = exact;
    else slots = [...slots].sort((a,b) =>
      Math.abs(timeToMinutes(a.start_time)-pref.minutes) -
      Math.abs(timeToMinutes(b.start_time)-pref.minutes)
    );
  } else if (pref?.kind === 'range') {
    const range = slots.filter(s => {
      const m = timeToMinutes(s.start_time);
      return m >= pref.min && m <= pref.max;
    });
    if (range.length) slots = range;
  }
  return slots;
}

async function book(q, ctx, state) {
  return createAppointmentTransactional(q, {
    tenant_id: ctx.tenant_id || ctx.clinic_id,
    clinic_id: ctx.clinic_id || ctx.tenant_id,
    branch_key: state.branch_key,
    patient: state.patient,
    phone: state.phone,
    service_id: state.service_id,
    slot: state.selected_slot,
  });
}

async function servicePrice(q, serviceId) {
  if (!serviceId) return null;
  const { rows: cols } = await q(`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='services'
  `);
  const names = new Set((cols || []).map(r => r.column_name));
  const priceCol = ['price','precio','cost','costo','amount','monto'].find(c => names.has(c));
  if (!priceCol) return null;
  const { rows } = await q(`SELECT ${priceCol} AS price FROM services WHERE id=$1 LIMIT 1`, [serviceId]);
  const value = rows?.[0]?.price;
  return value === null || value === undefined ? null : Number(value);
}

async function answerInformation(q, ctx, state, requests, serviceList) {
  const answers = [];
  for (const req of requests || []) {
    if (req.type === 'price') {
      const match = state.service_id
        ? serviceList.find(s => String(s.id) === String(state.service_id))
        : matchService(serviceList, req.service_text);
      const price = await servicePrice(q, match?.id);
      if (match && Number.isFinite(price)) answers.push(`El costo de ${match.name} es de $${price.toLocaleString('es-MX')}.`);
      else if (match) answers.push(`No tengo un precio confirmado para ${match.name} en este momento; puedo ayudarte a solicitarlo sin inventar una cantidad.`);
      else answers.push('¿De qué servicio deseas conocer el precio?');
    } else if (req.type === 'services') {
      const names = serviceList.slice(0,8).map(s => s.name).filter(Boolean);
      answers.push(names.length ? `Manejamos servicios como ${names.join(', ')}.` : 'Puedo ayudarte con consultas, limpiezas y otros tratamientos dentales.');
    } else if (['location','business_hours','contact'].includes(req.type)) {
      const branch = await getClinicBranch(q, ctx.external_id, state.branch_key).catch(() => null);
      if (req.type === 'location') answers.push(branch?.address ? `La sucursal ${getBranchDisplayName(state.branch_key)} está en ${branch.address}.` : 'Dime qué sucursal te interesa para darte la ubicación correcta.');
      if (req.type === 'business_hours') answers.push(branch?.business_hours ? `El horario es ${branch.business_hours}.` : 'El horario puede variar por sucursal; dime cuál te interesa.');
      if (req.type === 'contact') answers.push(branch?.phone || branch?.whatsapp ? `Puedes comunicarte al ${branch.phone || branch.whatsapp}.` : 'Puedes continuar por este mismo medio y con gusto te ayudamos.');
    } else if (req.type === 'payment_methods') {
      answers.push('Normalmente se aceptan efectivo, tarjeta y transferencia; la disponibilidad exacta puede variar por sucursal.');
    } else if (req.type === 'insurance') {
      answers.push('La aceptación de seguro depende del plan y de la sucursal; necesito que el equipo confirme tu cobertura.');
    } else if (req.type === 'promotion') {
      answers.push('Las promociones pueden cambiar; puedo ayudarte a revisar la promoción vigente para el tratamiento que necesitas.');
    } else if (req.type === 'duration') {
      answers.push('La duración depende del tratamiento y de la valoración clínica; al agendar puedo reservar el tiempo correspondiente.');
    } else {
      answers.push('Con gusto reviso esa información para ti.');
    }
  }
  return answers;
}

module.exports = { services, matchService, availability, book, answerInformation };

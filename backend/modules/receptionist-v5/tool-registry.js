'use strict';

const {
  getServices,
  computeAvailability,
  createAppointmentTransactional,
} = require('../booking-engine');
const State = require('./dialogue-state');

const normalize = text => String(text || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

async function loadBranches(q, ctx) {
  const tenantId = ctx.tenant_id || ctx.clinic_id;
  try {
    const { rows } = await q(
      `SELECT branch_key, name, address, phone,
              COALESCE(whatsapp, phone) AS whatsapp,
              business_hours, google_maps_url, directions,
              payment_methods, parking_info,
              ai_enabled, booking_enabled, active
         FROM branches
        WHERE tenant_id=$1::uuid
          AND COALESCE(active, TRUE)=TRUE
        ORDER BY branch_key`,
      [tenantId]
    );
    return rows || [];
  } catch {
    const { rows } = await q(
      `SELECT branch_key, name, address, phone,
              phone AS whatsapp,
              NULL::text AS business_hours,
              NULL::text AS google_maps_url,
              NULL::text AS directions,
              NULL::text AS payment_methods,
              NULL::text AS parking_info,
              TRUE AS ai_enabled,
              TRUE AS booking_enabled,
              active
         FROM branches
        WHERE tenant_id=$1::uuid
          AND COALESCE(active, TRUE)=TRUE
        ORDER BY branch_key`,
      [tenantId]
    );
    return rows || [];
  }
}

const loadServices = (q, branchKey) => getServices(q, branchKey);

function matchService(list, reference, reason = null) {
  const ref = normalize(reference?.reference || reference?.name || reference || '');
  const clinicalReason = normalize(reason || '');
  let best = null;

  for (const service of list || []) {
    const name = normalize(service.name);
    let score =
      ref && name === ref ? 100 :
      ref && (name.includes(ref) || ref.includes(name)) ? 80 :
      0;

    if (clinicalReason.includes('bracket') || clinicalReason.includes('ortodon')) {
      if (/consulta|valoracion|revision|diagnostico/.test(name)) score += 35;
      if (/ortodoncia|bracket/.test(name) && !/consulta|valoracion|revision/.test(name)) score -= 10;
    }

    if (!best || score > best.score) best = { ...service, score };
  }

  return best?.score > 0 ? best : null;
}

async function servicePrice(q, tenantId, serviceId) {
  const columns = (
    await q(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name='services'`
    )
  ).rows || [];

  const names = new Set(columns.map(row => row.column_name));
  const column = ['price', 'precio', 'cost', 'costo', 'amount', 'monto']
    .find(name => names.has(name));

  if (!column) return null;

  const { rows } = await q(
    `SELECT ${column} AS price
       FROM services
      WHERE tenant_id=$1::uuid AND id=$2
      LIMIT 1`,
    [tenantId, serviceId]
  ).catch(() =>
    q(`SELECT ${column} AS price FROM services WHERE id=$1 LIMIT 1`, [serviceId])
  );

  const value = rows?.[0]?.price;
  return value == null ? null : Number(value);
}

async function activePromotions(q, tenantId, branchKey, serviceId = null) {
  // La tabla es opcional. La falta de tabla significa que no hay promociones configuradas,
  // no que debamos responder con una frase genérica.
  try {
    const { rows } = await q(
      `SELECT title, description, start_date, end_date
         FROM branch_promotions
        WHERE tenant_id=$1::uuid
          AND branch_key=$2
          AND COALESCE(active, TRUE)=TRUE
          AND (start_date IS NULL OR start_date <= CURRENT_DATE)
          AND (end_date IS NULL OR end_date >= CURRENT_DATE)
          AND ($3::text IS NULL OR service_id::text=$3::text OR service_id IS NULL)
        ORDER BY start_date DESC NULLS LAST, title`,
      [tenantId, branchKey, serviceId ? String(serviceId) : null]
    );
    return rows || [];
  } catch (error) {
    if (error?.code !== '42P01' && error?.code !== '42703') {
      console.warn('⚠️ No se pudieron consultar promociones:', error.message);
    }
    return [];
  }
}

async function answerQuestion(q, ctx, state, question, context) {
  const tenantId = ctx.tenant_id || ctx.clinic_id;
  const branchKey = State.value(state, 'branch');
  const serviceValue = State.value(state, 'service');
  const branch = (context.branches || []).find(item => item.branch_key === branchKey);
  const service = serviceValue?.id
    ? (context.services || []).find(item => String(item.id) === String(serviceValue.id))
    : matchService(
        context.services || [],
        serviceValue,
        State.value(state, 'clinical_reason')
      );

  switch (question.topic) {
    case 'location':
      if (!branchKey) return { unresolved: 'branch' };
      return {
        answer: branch?.address
          ? `La sucursal ${branch.name || branchKey} está en ${branch.address}.`
          : `No tengo registrada la dirección de ${branch?.name || 'esa sucursal'}.`,
      };

    case 'business_hours':
      if (!branchKey) return { unresolved: 'branch' };
      return {
        answer: branch?.business_hours
          ? `El horario de ${branch.name || branchKey} es ${branch.business_hours}.`
          : `No tengo confirmado el horario de ${branch?.name || 'esa sucursal'}.`,
      };

    case 'contact':
      if (!branchKey) return { unresolved: 'branch' };
      return {
        answer: branch?.phone
          ? `El contacto de ${branch.name || branchKey} es ${branch.phone}.`
          : 'Puedes continuar por este mismo medio.',
      };

    case 'payment_methods':
      if (!branchKey) return { unresolved: 'branch' };
      return {
        answer: branch?.payment_methods
          ? `Formas de pago: ${branch.payment_methods}.`
          : `No tengo confirmadas las formas de pago de ${branch?.name || 'esa sucursal'}.`,
      };

    case 'parking':
      if (!branchKey) return { unresolved: 'branch' };
      return {
        answer: branch?.parking_info
          || `No tengo información confirmada sobre estacionamiento en ${branch?.name || 'esa sucursal'}.`,
      };

    case 'price': {
      if (!service) return { unresolved: 'service' };
      const price = await servicePrice(q, tenantId, service.id);
      return {
        answer: Number.isFinite(price)
          ? `El costo de ${service.name} es de $${price.toLocaleString('es-MX')}.`
          : `No tengo un precio confirmado para ${service.name}; prefiero no inventarte una cantidad.`,
      };
    }

    case 'promotion': {
      if (!branchKey) return { unresolved: 'branch' };
      const promotions = await activePromotions(
        q,
        tenantId,
        branchKey,
        service?.id || null
      );
      if (!promotions.length) {
        return {
          answer: `No tengo promociones vigentes confirmadas para ${branch?.name || branchKey}.`,
        };
      }
      return {
        answer: `Promociones vigentes en ${branch?.name || branchKey}: ${
          promotions
            .map(promo => `${promo.title}${promo.description ? ` — ${promo.description}` : ''}`)
            .join('; ')
        }.`,
      };
    }

    case 'services':
      return {
        answer: context.services?.length
          ? `Manejamos servicios como ${context.services.slice(0, 10).map(item => item.name).join(', ')}.`
          : 'No tengo disponible el catálogo de servicios.',
      };

    case 'duration':
      return {
        answer: 'La duración depende del tratamiento y de la valoración clínica.',
      };

    case 'insurance':
      return {
        answer: 'La cobertura depende del plan; el equipo debe confirmarla.',
      };

    default:
      return {
        answer: 'No tengo esa información confirmada en este momento.',
      };
  }
}

function minutes(time) {
  const [hours, mins] = String(time || '00:00').slice(0, 5).split(':').map(Number);
  return hours * 60 + mins;
}

async function availability(q, ctx, state) {
  const service = State.value(state, 'service');
  const result = await computeAvailability(q, {
    clinic_id: ctx.tenant_id || ctx.clinic_id,
    branch_key: State.value(state, 'branch'),
    date: State.value(state, 'date'),
    duration_hours: Number(service?.duration_hours || 1),
    limit: Number(process.env.RECEPTIONIST_V5_SLOT_LIMIT || 40),
    min_start_mins: null,
  });

  let slots = Array.isArray(result.slots) ? result.slots : [];
  const preference = State.value(state, 'time_preference');

  if (preference?.kind === 'exact') {
    slots = slots.filter(slot =>
      String(slot.start_time).slice(0, 5) === String(preference.value).slice(0, 5)
    );
  } else if (preference?.kind === 'after') {
    slots = slots.filter(slot => minutes(slot.start_time) >= Number(preference.min));
  } else if (preference?.kind === 'before') {
    slots = slots.filter(slot => minutes(slot.start_time) <= Number(preference.max));
  } else if (preference?.kind === 'range') {
    slots = slots.filter(slot => {
      const value = minutes(slot.start_time);
      return value >= Number(preference.min) && value <= Number(preference.max);
    });
  }

  return slots;
}

const createAppointment = (q, ctx, state) =>
  createAppointmentTransactional(q, {
    tenant_id: ctx.tenant_id || ctx.clinic_id,
    clinic_id: ctx.clinic_id || ctx.tenant_id,
    branch_key: State.value(state, 'branch'),
    patient: State.value(state, 'patient'),
    phone: State.value(state, 'phone'),
    service_id: State.value(state, 'service')?.id,
    slot: State.value(state, 'selected_slot'),
  });

module.exports = {
  loadBranches,
  loadServices,
  matchService,
  answerQuestion,
  availability,
  createAppointment,
  servicePrice,
  activePromotions,
};

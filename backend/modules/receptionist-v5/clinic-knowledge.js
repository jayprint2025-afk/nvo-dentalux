'use strict';
const { getServices } = require('../booking-engine');

async function loadBranches(q, tenantId) {
  try {
    const { rows } = await q(
      `SELECT branch_key,name,address,phone,COALESCE(whatsapp,phone) AS whatsapp,
              business_hours,google_maps_url,directions,payment_methods,parking_info,
              ai_enabled,booking_enabled
         FROM branches
        WHERE tenant_id=$1::uuid AND COALESCE(active,TRUE)=TRUE
        ORDER BY branch_key`,
      [tenantId]
    );
    return rows || [];
  } catch (error) {
    console.warn('V5 knowledge branches:', error.message);
    return [];
  }
}

async function loadAllServices(q, branches) {
  const map = new Map();
  for (const branch of branches) {
    try {
      const services = await getServices(q, branch.branch_key);
      for (const service of services || []) {
        const key = String(service.id || service.name);
        if (!map.has(key)) map.set(key, service);
      }
    } catch (error) {
      console.warn('V5 knowledge services:', error.message);
    }
  }
  return [...map.values()];
}

async function loadPromotions(q, tenantId) {
  try {
    const { rows } = await q(
      `SELECT branch_key,title,description,start_date,end_date,service_id
         FROM branch_promotions
        WHERE tenant_id=$1::uuid AND COALESCE(active,TRUE)=TRUE
          AND (start_date IS NULL OR start_date<=CURRENT_DATE)
          AND (end_date IS NULL OR end_date>=CURRENT_DATE)
        ORDER BY branch_key,title`,
      [tenantId]
    );
    return rows || [];
  } catch (error) {
    if (!['42P01','42703'].includes(error.code)) console.warn('V5 knowledge promotions:', error.message);
    return [];
  }
}

async function loadClinicKnowledge(q, ctx) {
  const tenantId = String(ctx.tenant_id || ctx.clinic_id);
  const branches = await loadBranches(q, tenantId);
  const services = await loadAllServices(q, branches);
  const promotions = await loadPromotions(q, tenantId);
  const urgentPhone = branches.find(branch => branch.phone)?.phone || null;
  return {
    tenant_id: tenantId,
    branches,
    services: services.map(service => ({
      id: service.id,
      name: service.name,
      price: service.price ?? service.precio ?? service.cost ?? service.costo ?? null,
      duration_hours: service.duration_hours ?? service.duration ?? null,
    })),
    promotions,
    unknown_information_policy: urgentPhone
      ? `Ese dato no lo tengo confirmado en este momento. Si lo necesitas con urgencia, puedes llamar a la clínica al ${urgentPhone}.`
      : 'Ese dato no lo tengo confirmado en este momento. Si lo necesitas con urgencia, puedes llamar directamente a la clínica.',
  };
}

module.exports={loadClinicKnowledge};

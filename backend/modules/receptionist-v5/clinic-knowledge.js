'use strict';

async function loadBranches(q,tenantId) {
  const {rows}=await q(`SELECT b.* FROM branches b WHERE b.tenant_id=$1::uuid
    AND COALESCE((to_jsonb(b)->>'active')::boolean,TRUE)=TRUE ORDER BY b.branch_key`,[tenantId]);
  return (rows||[]).map(b=>({...b,whatsapp:b.whatsapp||b.phone||null,ai_enabled:b.ai_enabled!==false,booking_enabled:b.booking_enabled!==false}));
}
async function loadAllServices(q,tenantId,branches) {
  const services=[];
  for(const branch of branches){
    const {rows}=await q(`SELECT s.* FROM services s WHERE s.tenant_id=$1::uuid
      AND (s.sucursal_id=$2 OR s.sucursal_id IS NULL)
      AND COALESCE((to_jsonb(s)->>'active')::boolean,TRUE)=TRUE ORDER BY s.name`,[tenantId,branch.branch_key]);
    for(const item of rows||[])services.push({...item,branch_key:branch.branch_key});
  }
  return services;
}

async function loadPromotions(q, tenantId, branches = []) {
  let structured = [];
  try {
    const { rows } = await q(
      `SELECT id,branch_key,title,description,start_date,end_date,service_id
         FROM branch_promotions
        WHERE tenant_id=$1::uuid AND COALESCE(active,TRUE)=TRUE
          AND (start_date IS NULL OR start_date<=CURRENT_DATE)
          AND (end_date IS NULL OR end_date>=CURRENT_DATE)
        ORDER BY branch_key,title`,
      [tenantId]
    );
    structured = rows || [];
  } catch (error) {
    if (!['42P01','42703'].includes(error.code)) console.warn('V5 knowledge promotions:', error.message);
  }

  // Configuración actual del panel: branches.promotions (una promoción por línea).
  // Se incorpora como fuente autoritativa para que V5 no dependa de que exista
  // un registro duplicado en branch_promotions.
  const merged = [...structured];
  const normalize = value => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const seen = new Set(merged.map(item => `${String(item.branch_key || '')}|${normalize(item.title)}`));

  for (const branch of branches || []) {
    const branchKey = String(branch?.branch_key || '').trim();
    const lines = String(branch?.promotions || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    for (const title of lines) {
      const key = `${branchKey}|${normalize(title)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({
        branch_key: branchKey,
        title,
        description: '',
        start_date: null,
        end_date: null,
        service_id: null,
        source: 'branches.promotions',
      });
    }
  }

  return merged;
}

async function loadClinicKnowledge(q, ctx) {
  const tenantId = String(ctx.tenant_id || ctx.clinic_id);
  const branches = await loadBranches(q, tenantId);
  const services = await loadAllServices(q, tenantId, branches);
  const promotions = await loadPromotions(q, tenantId, branches);
  const doctors=(await q(`SELECT id,name,sucursal_id FROM doctors WHERE tenant_id=$1::uuid ORDER BY id`,[tenantId])).rows||[];
  const urgentPhone = branches.find(branch => branch.phone)?.phone || null;
  return {
    tenant_id: tenantId,
    branches,
    doctors,
    services: services.map(service => ({
      id: service.id,
      name: service.name,
      price: service.price ?? service.precio ?? service.cost ?? service.costo ?? null,
      duration_hours: service.duration_hours ?? service.duration ?? null,
      description: service.description || '',
      branch_key: service.branch_key || service.sucursal_id || null,
    })),
    promotions,
    unknown_information_policy: urgentPhone
      ? `Ese dato no lo tengo confirmado en este momento. Si lo necesitas con urgencia, puedes llamar a la clínica al ${urgentPhone}.`
      : 'Ese dato no lo tengo confirmado en este momento. Si lo necesitas con urgencia, puedes llamar directamente a la clínica.',
  };
}

module.exports={loadClinicKnowledge};

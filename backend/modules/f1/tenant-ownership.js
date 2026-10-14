'use strict';
const references = {
  record_id: 'expedientes_medicos', expediente_id: 'expedientes_medicos',
  appointment_id: 'appointments', doctor_id: 'doctors', service_id: 'services',
  laboratory_id: 'laboratorios', laboratorio_id: 'laboratorios',
  work_id: 'lab_trabajos', inventory_id: 'inventory',
  payment_id: 'payments', expense_id: 'expenses', objective_id: 'objetivos',
  treatment_id: 'tratamientos_dentales', consent_id: 'consentimientos_informados',
  history_id: 'historia_clinica_dental', document_id:'documentos_radiografias', odontogram_id:'odontograma', invoice_id: 'facturas',
};
async function assertTenantReferences(q, tenantId, args = {}) {
  if (!tenantId) throw Object.assign(new Error('Sesión de empresa requerida'), {statusCode:401});
  const checked = new Map();
  for (const [field, table] of Object.entries(references)) {
    const id = args[field];
    if (id === undefined || id === null || id === '') continue;
    const key = `${table}:${id}`;
    if (checked.has(key)) continue;
    const {rows} = await q(`SELECT * FROM ${table} WHERE id=$1 AND tenant_id=$2::uuid LIMIT 1`, [id, tenantId]);
    if (!rows[0]) throw Object.assign(new Error(`${field}: registro no encontrado en esta empresa`), {statusCode:404});
    const row = rows[0];
    if (row.expediente_id != null) {
      const parent = await q('SELECT id FROM expedientes_medicos WHERE id=$1 AND tenant_id=$2::uuid', [row.expediente_id,tenantId]);
      if (!parent.rows[0] || (args.record_id != null && String(row.expediente_id)!==String(args.record_id))) {
        throw Object.assign(new Error('El registro clínico no pertenece al expediente de esta empresa'), {statusCode:404});
      }
    }
    checked.set(key,row);
  }
}
module.exports = {assertTenantReferences};

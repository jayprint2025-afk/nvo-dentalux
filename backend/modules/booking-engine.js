// modules/booking-engine.js
// Motor de agenda (NO IA). Todo entra con clinic_id + branch_key.
// Compatible con esquemas legacy donde appointments NO tiene clinic_id y/o sucursal (texto).

function pad2(n) { return String(n).padStart(2, '0'); }
function asText(v) { return (v === null || v === undefined) ? '' : String(v); }

function timeToMins(hhmm) {
  const [H, M] = String(hhmm).split(':').map(Number);
  return (H * 60) + (M || 0);
}
function minsToTime(mins) {
  const H = Math.floor(mins / 60);
  const M = mins % 60;
  return `${pad2(H)}:${pad2(M)}`;
}
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// ====== introspección de columnas (cache en memoria) ======
let _apptColsCache = null;
async function getAppointmentsColumns(q) {
  if (_apptColsCache) return _apptColsCache;
  const { rows } = await q(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'appointments'`
  );
  const set = new Set((rows || []).map(r => String(r.column_name)));
  _apptColsCache = {
    hasTenantId: set.has('tenant_id'),
    hasClinicId: set.has('clinic_id'),
    hasSucursalId: set.has('sucursal_id'),
    hasSucursal: set.has('sucursal'),
    hasStatus: set.has('status'),
    // por si manejas otro nombre
    hasPaciente: set.has('paciente'),
    hasPatient: set.has('patient'),
  };
  return _apptColsCache;
}

// ====== servicios / doctores aislados por tenant + sucursal ======
async function resolveTenantId(q, explicitTenantId = null) {
  const direct = String(explicitTenantId || '').trim();
  if (direct) return direct;

  const { rows } = await q(
    `SELECT NULLIF(current_setting('app.tenant_id', true), '') AS tenant_id`
  );

  const tenantId = String(rows?.[0]?.tenant_id || '').trim();
  if (!tenantId) {
    throw new Error('tenant_id ausente al consultar catálogo');
  }

  return tenantId;
}

function resolveCatalogArgs(tenantOrBranch, maybeBranch) {
  if (maybeBranch !== undefined) {
    return {
      tenant_id: tenantOrBranch,
      branch_key: maybeBranch,
    };
  }

  // Compatibilidad con llamadas anteriores getServices(q, branch_key).
  // El tenant se obtiene de app.tenant_id configurado por la ruta SaaS.
  return {
    tenant_id: null,
    branch_key: tenantOrBranch,
  };
}

async function getDoctors(q, tenantOrBranch, maybeBranch) {
  const args = resolveCatalogArgs(tenantOrBranch, maybeBranch);
  const tenantId = await resolveTenantId(q, args.tenant_id);

  const { rows } = await q(
    `SELECT id, name
       FROM doctors
      WHERE tenant_id = $1::uuid
        AND ($2::text IS NULL OR sucursal_id = $2::text)
      ORDER BY id ASC`,
    [tenantId, args.branch_key]
  );

  return (rows || []).map(r => ({
    id: String(r.id),
    name: r.name,
  }));
}

async function getServices(q, tenantOrBranch, maybeBranch) {
  const args = resolveCatalogArgs(tenantOrBranch, maybeBranch);
  const tenantId = await resolveTenantId(q, args.tenant_id);

  const { rows } = await q(
    `SELECT id, name
       FROM services
      WHERE tenant_id = $1::uuid
        AND ($2::text IS NULL OR sucursal_id = $2::text)
      ORDER BY id ASC`,
    [tenantId, args.branch_key]
  );

  return (rows || []).map(r => ({
    id: String(r.id),
    name: r.name,
  }));
}

async function getAppointmentsForDay(q, { clinic_id, branch_key, date }) {
  const cols = await getAppointmentsColumns(q);

  const where = [];
  const params = [];

  // tenant_id: aislamiento SaaS explícito cuando la columna existe.
  // clinic_id contiene el tenant UUID autenticado desde ai-saas-routes.
  if (cols.hasTenantId) {
    if (!clinic_id) throw new Error('tenant_id ausente al consultar disponibilidad');
    params.push(String(clinic_id));
    where.push(`tenant_id = $${params.length}::uuid`);
  }

  // Compatibilidad con esquemas que también conservan clinic_id.
  if (cols.hasClinicId) {
    params.push(String(clinic_id));
    where.push(`clinic_id = $${params.length}`);
  }

  // date
  params.push(date);
  where.push(`date = $${params.length}`);

  // sucursal / sucursal_id (solo si existe la columna)
  if (branch_key != null) {
    const ors = [];
    if (cols.hasSucursalId) {
      params.push(String(branch_key));
      ors.push(`sucursal_id = $${params.length}::text`);
    }
    if (cols.hasSucursal) {
      params.push(String(branch_key));
      ors.push(`sucursal = $${params.length}::text`);
    }
    if (ors.length) where.push(`(${ors.join(' OR ')})`);
  }

  // status != Cancelada (si existe status)
  if (cols.hasStatus) {
    where.push(`UPPER(COALESCE(status,'')) NOT IN ('CANCELADA','CANCELADO','CANCELED','CANCELLED')`);
  }

  const sql = `
    SELECT id,
           doctor_id,
           start_time::text AS start_time,
           COALESCE(duration_hours, 1) AS duration_hours,
           ${cols.hasStatus ? 'status' : "''::text AS status"}
      FROM appointments
     WHERE ${where.join(' AND ')}
  `;

  const { rows } = await q(sql, params);

  return (rows || []).map(r => ({
    id: Number(r.id),
    doctor_id: String(r.doctor_id),
    start_time: String(r.start_time).slice(0, 5),
    duration_hours: Number(r.duration_hours || 1),
    status: r.status || '',
  }));
}

// Calcula slots libres (08:00-20:00 paso 30min)
async function computeAvailability(q, { clinic_id, branch_key, date, duration_hours = 1, limit = 50, min_start_mins = null }) {
  const doctors = await getDoctors(q, clinic_id, branch_key);
  if (!doctors.length) return { slots: [], doctors: [] };

  const durationMins = Math.max(30, Math.round(Number(duration_hours) * 60));
  const dayStart = 8 * 60;
  const dayEnd = 20 * 60;
  const effectiveStart = Number.isFinite(min_start_mins) ? Math.max(dayStart, Math.min(dayEnd, Math.round(min_start_mins))) : dayStart;

  const appts = await getAppointmentsForDay(q, { clinic_id, branch_key, date });

  const byDoctor = new Map();
  for (const d of doctors) byDoctor.set(d.id, []);
  for (const a of appts) {
    if (!byDoctor.has(a.doctor_id)) byDoctor.set(a.doctor_id, []);
    const s = timeToMins(a.start_time);
    const e = s + Math.round(a.duration_hours * 60);
    byDoctor.get(a.doctor_id).push([s, e, a.id]);
  }
  for (const [k, list] of byDoctor.entries()) list.sort((x, y) => x[0] - y[0]);

  const slots = [];
  for (let t = effectiveStart; t + durationMins <= dayEnd; t += 30) {
    const slotStart = t;
    const slotEnd = t + durationMins;

    for (const d of doctors) {
      const intervals = byDoctor.get(d.id) || [];
      let ok = true;
      for (const [s, e] of intervals) {
        if (overlaps(slotStart, slotEnd, s, e)) { ok = false; break; }
      }
      if (ok) {
        slots.push({
          clinic_id,
          sucursal_id: branch_key,
          date,
          start_time: minsToTime(slotStart),
          duration_hours,
          doctor_id: d.id,
          doctor_name: d.name,
        });
        break;
      }
    }

    if (slots.length >= limit) break;
  }

  return { slots, doctors };
}

// ====== INSERT transaccional (SaaS-safe + legacy compatible) ======
async function createAppointmentTransactional(q, {
  tenant_id,
  clinic_id,
  branch_key,
  patient,
  phone,
  service_id,
  date,
  appointment_date,
  start_time,
  exact_time,
  selected_time,
  duration_hours,
  slot,
}) {
  const cols = await getAppointmentsColumns(q);
  const resolvedTenantId = String(tenant_id || clinic_id || '').trim();

  if (!resolvedTenantId) throw new Error('tenant_id ausente al crear la cita');
  if (!branch_key) throw new Error('sucursal ausente al crear la cita');
  if (!service_id) throw new Error('servicio ausente al crear la cita');

  // Corrección puntual: durante una modificación antes de confirmar,
  // el slot conserva doctor y hora, mientras la fecha permanece en el
  // objeto principal de la reserva. Unificamos ambos sin alterar el flujo.
  const resolvedSlot = {
    ...(slot && typeof slot === 'object' ? slot : {}),
    date:
      slot?.date ||
      date ||
      appointment_date ||
      null,
    start_time: String(
      slot?.start_time ||
      start_time ||
      exact_time ||
      selected_time ||
      ''
    ).slice(0, 5),
    duration_hours: Number(
      slot?.duration_hours ||
      duration_hours ||
      1
    ),
  };

  if (
    !resolvedSlot.date ||
    !resolvedSlot.start_time
  ) {
    console.error('❌ SLOT INCOMPLETO AL CREAR CITA', {
      doctor_id: resolvedSlot.doctor_id || null,
      date: resolvedSlot.date || null,
      start_time: resolvedSlot.start_time || null,
    });
    throw new Error('horario incompleto al crear la cita');
  }

  // Recuperación robusta: si entre la selección y la confirmación se perdió
  // doctor_id, buscar nuevamente el mismo horario dentro del tenant y sucursal.
  if (!resolvedSlot.doctor_id) {
    const availability = await computeAvailability(q, {
      clinic_id: resolvedTenantId,
      branch_key,
      date: resolvedSlot.date,
      duration_hours: resolvedSlot.duration_hours || 1,
      limit: 200,
      min_start_mins: null,
    });

    const recovered = (availability.slots || []).find(candidate =>
      String(candidate.start_time || '').slice(0, 5) ===
      String(resolvedSlot.start_time || '').slice(0, 5)
    );

    if (!recovered?.doctor_id) {
      console.error('❌ NO SE PUDO RECUPERAR DOCTOR', {
        tenant_id: resolvedTenantId,
        branch_key,
        date: resolvedSlot.date,
        start_time: resolvedSlot.start_time,
        available_slots: (availability.slots || []).map(item => ({
          doctor_id: item.doctor_id,
          start_time: item.start_time,
        })),
      });
      throw new Error('El horario seleccionado ya no está disponible');
    }

    resolvedSlot.doctor_id = recovered.doctor_id;
    resolvedSlot.doctor_name = recovered.doctor_name || null;
    resolvedSlot.end_time = recovered.end_time || resolvedSlot.end_time || null;
    resolvedSlot.duration_hours = Number(
      recovered.duration_hours ||
      resolvedSlot.duration_hours ||
      1
    );

    console.log('♻️ DOCTOR RECUPERADO PARA CITA', {
      tenant_id: resolvedTenantId,
      branch_key,
      doctor_id: resolvedSlot.doctor_id,
      doctor_name: resolvedSlot.doctor_name,
      date: resolvedSlot.date,
      start_time: resolvedSlot.start_time,
    });
  }

  // nombre de columna de paciente (tu app legacy suele usar patient)
  const patientCol = cols.hasPatient ? 'patient' : (cols.hasPaciente ? 'paciente' : 'patient');

  await q('BEGIN');
  try {
    // lock de slot si existe clinic_id; si no, lock por doctor+date+time
    const lockWhere = [];
    const lockParams = [];

    if (cols.hasTenantId) {
      if (!resolvedTenantId) throw new Error('tenant_id ausente al confirmar la cita');
      lockParams.push(resolvedTenantId);
      lockWhere.push(`tenant_id=$${lockParams.length}::uuid`);
    }

    if (cols.hasClinicId) {
      lockParams.push(String(clinic_id));
      lockWhere.push(`clinic_id=$${lockParams.length}`);
    }
    lockParams.push(String(resolvedSlot.doctor_id));
    lockWhere.push(`doctor_id=$${lockParams.length}`);
    lockParams.push(resolvedSlot.date);
    lockWhere.push(`date=$${lockParams.length}`);
    lockParams.push(resolvedSlot.start_time);
    lockWhere.push(`start_time=$${lockParams.length}`);

    if (cols.hasStatus) lockWhere.push(`UPPER(COALESCE(status,'')) NOT IN ('CANCELADA','CANCELADO','CANCELED','CANCELLED')`);

    const { rows: exists } = await q(
      `SELECT id FROM appointments WHERE ${lockWhere.join(' AND ')} FOR UPDATE`,
      lockParams
    );
    const p = asText(patient).trim() || 'Paciente';

    if (exists.length) {
      const duplicateParams = [];
      const duplicateWhere = [];

      if (cols.hasTenantId) {
        duplicateParams.push(resolvedTenantId);
        duplicateWhere.push(`tenant_id = $${duplicateParams.length}::uuid`);
      } else if (cols.hasClinicId) {
        duplicateParams.push(String(clinic_id || resolvedTenantId));
        duplicateWhere.push(`clinic_id = $${duplicateParams.length}`);
      }

      duplicateParams.push(String(resolvedSlot.doctor_id));
      duplicateWhere.push(`doctor_id = $${duplicateParams.length}`);
      duplicateParams.push(resolvedSlot.date);
      duplicateWhere.push(`date = $${duplicateParams.length}`);
      duplicateParams.push(resolvedSlot.start_time);
      duplicateWhere.push(`start_time = $${duplicateParams.length}`);
      duplicateParams.push(phone ? String(phone) : null);
      duplicateWhere.push(`COALESCE(phone,'') = COALESCE($${duplicateParams.length},'')`);

      const { rows: duplicateRows } = await q(
        `SELECT id, ${patientCol} AS patient, date, start_time, doctor_id
           FROM appointments
          WHERE ${duplicateWhere.join(' AND ')}
          ORDER BY id DESC
          LIMIT 1`,
        duplicateParams
      );

      if (duplicateRows?.[0]?.id) {
        await q('COMMIT');
        return {
          ...duplicateRows[0],
          tenant_id: resolvedTenantId || null,
          branch_key: String(branch_key || ''),
          verified: true,
          existing: true,
        };
      }

      throw new Error('Horario ya fue tomado');
    }

    // Construcción de INSERT por columnas existentes:
    const colNames = [];
    const values = [];
    const params = [];

    function add(col, val) {
      colNames.push(col);
      params.push(val);
      values.push(`$${params.length}`);
    }

    if (cols.hasTenantId) {
      if (!resolvedTenantId) throw new Error('tenant_id ausente al crear la cita');
      add('tenant_id', resolvedTenantId);
    }
    if (cols.hasClinicId) add('clinic_id', String(clinic_id || resolvedTenantId));

    // sucursal: intentamos guardar branch_key en donde exista
    if (cols.hasSucursalId) add('sucursal_id', String(branch_key));
    if (cols.hasSucursal) add('sucursal', String(branch_key));

    add(patientCol, p);
    add('phone', phone ? String(phone) : null);
    add('doctor_id', String(resolvedSlot.doctor_id));
    add('date', resolvedSlot.date);
    add('start_time', resolvedSlot.start_time);
    add('duration_hours', Number(resolvedSlot.duration_hours || 1));
    add('service_id', String(service_id));

    if (cols.hasStatus) add('status', 'Pendiente');

    const { rows } = await q(
      `INSERT INTO appointments (${colNames.join(', ')})
       VALUES (${values.join(', ')})
       RETURNING id, ${patientCol} as patient, date, start_time, doctor_id`,
      params
    );

    const inserted = rows?.[0];
    if (!inserted?.id) throw new Error('No se pudo confirmar la cita');

    const verifyParams = [inserted.id];
    let verifyWhere = 'id = $1';
    if (cols.hasTenantId) {
      verifyParams.push(resolvedTenantId);
      verifyWhere += ` AND tenant_id = $2::uuid`;
    }

    const { rows: verifiedRows } = await q(
      `SELECT id, ${patientCol} AS patient, date, start_time, doctor_id
         FROM appointments
        WHERE ${verifyWhere}
        LIMIT 1`,
      verifyParams
    );

    if (!verifiedRows?.[0]?.id) {
      throw new Error('La cita se insertó pero no pudo verificarse para esta empresa');
    }

    await q('COMMIT');

    return {
      id: verifiedRows[0].id,
      patient: verifiedRows[0].patient,
      date: verifiedRows[0].date,
      start_time: verifiedRows[0].start_time,
      doctor_id: verifiedRows[0].doctor_id,
      tenant_id: resolvedTenantId || null,
      branch_key: String(branch_key || ''),
      verified: true,
    };
  } catch (e) {
    await q('ROLLBACK').catch(() => {});
    throw e;
  }
}

module.exports = {
  getDoctors,
  getServices,
  computeAvailability,
  createAppointmentTransactional,
  resolveTenantId,
};

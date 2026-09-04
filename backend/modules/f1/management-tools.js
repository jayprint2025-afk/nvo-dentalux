'use strict';

const {
  getDoctors,
  getServices,
  computeAvailability,
  createAppointmentTransactional,
} = require('../booking-engine');
const { buildOperationsReport } = require('./operations-director');
const { f1EventBus } = require('./event-bus');

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


function emitAppointmentEvent(name, appointment, ctx, extra = {}) {
  try {
    return f1EventBus.emit(
      name,
      {
        appointment_id: appointment?.id || null,
        patient: appointment?.patient || null,
        date: appointment?.date || null,
        start_time: appointment?.start_time || null,
        status: appointment?.status || null,
        doctor_id: appointment?.doctor_id || null,
        service_id: appointment?.service_id || null,
        ...extra,
      },
      {
        tenant_id: ctx.tenant_id,
        branch_key: ctx.branch_key || appointment?.sucursal_id || 'sucursal_1',
        user_id: ctx.user_id || null,
        source: 'f1',
      }
    );
  } catch (error) {
    // El Event Bus nunca debe bloquear una operación clínica ya confirmada en BD.
    console.warn('⚠️ F1 Event Bus: no se pudo publicar evento de agenda:', error.message);
    return null;
  }
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
  const visibleSlots = slots.slice(0, 20);
  return {
    date: args.date,
    branch_key: branchKey,
    slots: visibleSlots,
    assistant_message: visibleSlots.length
      ? `Encontré ${visibleSlots.length} horarios disponibles para el ${args.date}.`
      : `No encontré horarios disponibles para el ${args.date}.`,
  };
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

  const appointment = created || {};
  emitAppointmentEvent('appointment.created', appointment, {
    ...ctx,
    branch_key: branchKey,
  }, {
    requested_patient: text(args.patient),
  });

  const patient = text(appointment.patient || args.patient);
  const date = text(appointment.date || selectedSlot.date);
  const startTime = text(appointment.start_time || selectedSlot.start_time).slice(0, 5);
  const doctorName = text(appointment.doctor_name || selectedSlot.doctor_name);
  return {
    ok: true,
    appointment,
    assistant_message:
      `Perfecto. Agendé a ${patient} para el ${date} a las ${startTime}` +
      `${doctorName ? ` con ${doctorName}` : ''}. La cita quedó registrada correctamente.` ,
    client_event: { type: 'appointments_changed', appointment_id: appointment.id || null },
  };
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
  return {
    appointments: rows,
    assistant_message: rows.length
      ? `Encontré ${rows.length} cita${rows.length === 1 ? '' : 's'}${patient ? ` para ${patient}` : ''}.`
      : `No encontré citas${patient ? ` para ${patient}` : ''} en la sucursal actual.`,
  };
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
  emitAppointmentEvent('appointment.cancelled', rows[0], ctx);
  return {
    ok: true,
    appointment: rows[0],
    assistant_message: `La cita de ${rows[0].patient} del ${rows[0].date} a las ${text(rows[0].start_time).slice(0, 5)} fue cancelada correctamente.`,
    client_event: { type: 'appointments_changed', appointment_id: rows[0].id },
  };
}

async function rescheduleAppointment(q, ctx, args = {}) {
  const id = Number(args.appointment_id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('appointment_id inválido');
  if (!args.date || !args.start_time) throw new Error('Faltan fecha u hora');

  const { rows: currentRows } = await q(`
    SELECT id, patient, phone, service_id, doctor_id, sucursal_id, date, start_time::text AS start_time
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

  emitAppointmentEvent('appointment.rescheduled', rows[0], {
    ...ctx,
    branch_key: branchKey,
  }, {
    previous_date: current.date || null,
    previous_start_time: current.start_time || null,
  });

  return {
    ok: true,
    appointment: rows[0],
    assistant_message: `La cita de ${rows[0].patient} fue reagendada para el ${rows[0].date} a las ${text(rows[0].start_time).slice(0, 5)}.`,
    client_event: { type: 'appointments_changed', appointment_id: rows[0].id },
  };
}


function normalizePaymentMethod(value) {
  const raw = text(value).toLowerCase();
  if (!raw) return '';
  if (raw.includes('efect')) return 'Efectivo';
  if (raw.includes('transfer')) return 'Transferencia';
  if (raw.includes('tarjet') || raw.includes('card')) return 'Tarjeta';
  return text(value);
}

function moneyValue(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function emitFinanceEvent(name, payload, ctx, branchKey) {
  try {
    return f1EventBus.emit(name, payload, {
      tenant_id: ctx.tenant_id,
      branch_key: branchKey || ctx.branch_key || 'sucursal_1',
      user_id: ctx.user_id || null,
      source: 'f1',
    });
  } catch (error) {
    console.warn(`⚠️ F1 Event Bus ${name}:`, error.message);
    return null;
  }
}

async function getIncomeSummary(q, ctx, args = {}) {
  const branch = text(args.branch_key || ctx.branch_key) || 'sucursal_1';
  const dateFrom = text(args.date_from || args.date || localDate(ctx.timezone));
  const dateTo = text(args.date_to || args.date || dateFrom);

  const { rows } = await q(`
    SELECT
      COALESCE(SUM(amount),0)::numeric AS total,
      COALESCE(SUM(amount) FILTER (
        WHERE LOWER(COALESCE(payment_method,'')) LIKE '%efect%'
      ),0)::numeric AS cash,
      COALESCE(SUM(amount) FILTER (
        WHERE LOWER(COALESCE(payment_method,'')) LIKE '%transfer%'
      ),0)::numeric AS transfer,
      COALESCE(SUM(amount) FILTER (
        WHERE LOWER(COALESCE(payment_method,'')) LIKE '%tarjet%'
           OR LOWER(COALESCE(payment_method,'')) LIKE '%card%'
      ),0)::numeric AS card,
      COUNT(*)::integer AS movements
    FROM payments
    WHERE tenant_id=$1::uuid
      AND date BETWEEN $2::date AND $3::date
      AND (sucursal_id=$4 OR sucursal_id IS NULL)
  `, [ctx.tenant_id, dateFrom, dateTo, branch]);

  const row = rows[0] || {};
  const total = moneyValue(row.total);
  const cash = moneyValue(row.cash);
  const transfer = moneyValue(row.transfer);
  const card = moneyValue(row.card);

  return {
    date_from: dateFrom,
    date_to: dateTo,
    branch_key: branch,
    total,
    methods: { cash, transfer, card },
    movements: Number(row.movements || 0),
    assistant_message:
      `Del ${dateFrom} al ${dateTo} se registraron $${total.toFixed(2)} en ingresos: ` +
      `$${cash.toFixed(2)} en efectivo, $${transfer.toFixed(2)} por transferencia ` +
      `y $${card.toFixed(2)} con tarjeta.`,
  };
}

async function getExpenseSummary(q, ctx, args = {}) {
  const branch = text(args.branch_key || ctx.branch_key) || 'sucursal_1';
  const dateFrom = text(args.date_from || args.date || localDate(ctx.timezone));
  const dateTo = text(args.date_to || args.date || dateFrom);

  const { rows } = await q(`
    SELECT COALESCE(SUM(amount),0)::numeric AS total,
           COUNT(*)::integer AS movements
    FROM expenses
    WHERE tenant_id=$1::uuid
      AND date BETWEEN $2::date AND $3::date
      AND (sucursal_id=$4 OR sucursal_id IS NULL)
  `, [ctx.tenant_id, dateFrom, dateTo, branch]);

  const row = rows[0] || {};
  const total = moneyValue(row.total);

  return {
    date_from: dateFrom,
    date_to: dateTo,
    branch_key: branch,
    total,
    movements: Number(row.movements || 0),
    assistant_message:
      `Del ${dateFrom} al ${dateTo} se registraron $${total.toFixed(2)} en gastos.`,
  };
}

async function getDailyNet(q, ctx, args = {}) {
  const income = await getIncomeSummary(q, ctx, args);
  const expenses = await getExpenseSummary(q, ctx, args);
  const net = income.total - expenses.total;

  return {
    date_from: income.date_from,
    date_to: income.date_to,
    branch_key: income.branch_key,
    income: income.total,
    expenses: expenses.total,
    net,
    assistant_message:
      `El resultado neto del periodo es $${net.toFixed(2)}: ` +
      `$${income.total.toFixed(2)} de ingresos menos ` +
      `$${expenses.total.toFixed(2)} de gastos.`,
  };
}

async function listRecentPayments(q, ctx, args = {}) {
  const branch = text(args.branch_key || ctx.branch_key) || 'sucursal_1';
  const limit = Math.max(1, Math.min(Number(args.limit || 10), 30));

  const { rows } = await q(`
    SELECT id, appointment_id, patient, service_id, amount,
           payment_method, date, doctor_id, sucursal_id
    FROM payments
    WHERE tenant_id=$1::uuid
      AND (sucursal_id=$2 OR sucursal_id IS NULL)
    ORDER BY date DESC, id DESC
    LIMIT $3
  `, [ctx.tenant_id, branch, limit]);

  return {
    payments: rows,
    assistant_message: rows.length
      ? `Encontré ${rows.length} pago${rows.length === 1 ? '' : 's'} reciente${rows.length === 1 ? '' : 's'}.`
      : 'No encontré pagos recientes en la sucursal actual.',
  };
}

async function registerPayment(q, ctx, args = {}) {
  const patient = text(args.patient);
  const amount = moneyValue(args.amount);
  const paymentMethod = normalizePaymentMethod(args.payment_method);
  const date = text(args.date) || localDate(ctx.timezone);
  const branch = text(args.branch_key || ctx.branch_key) || 'sucursal_1';

  if (!patient) throw new Error('Falta el nombre del paciente');
  if (amount <= 0) throw new Error('El monto debe ser mayor a 0');
  if (!paymentMethod) throw new Error('Falta el método de pago');

  // Regla operativa de Caja: no registrar un ingreso ligado a una cita
  // mientras la cita no esté Atendida/Completada.
  const matches = await resolvePaymentAppointment(q, ctx, args, patient, date, branch);
  if (!matches.length) {
    return {
      ok: false,
      prerequisite_required: true,
      prerequisite: 'appointment_required',
      assistant_message: `Antes de registrar el ingreso necesito identificar la cita de ${patient} correspondiente al ${date}. No encontré una cita coincidente en esta sucursal.`,
    };
  }
  if (!args.appointment_id && matches.length > 1) {
    return {
      ok: false,
      prerequisite_required: true,
      prerequisite: 'appointment_selection_required',
      appointments: matches,
      assistant_message: `Encontré más de una cita para ${patient} el ${date}. Indícame cuál corresponde al ingreso para evitar registrar el pago en la cita equivocada.`,
    };
  }
  const paymentAppointment = matches[0];
  if (!isAttendedStatus(paymentAppointment.status)) {
    return {
      ok: false,
      prerequisite_required: true,
      prerequisite: 'appointment_must_be_attended',
      appointment: paymentAppointment,
      suggested_action: {
        tool: 'update_appointment_status',
        args: { appointment_id: paymentAppointment.id, status: 'Atendida' },
      },
      assistant_message: `Antes de registrar el ingreso, la cita de ${paymentAppointment.patient} debe estar en estado Atendida. Actualmente está ${paymentAppointment.status || 'sin estado'}. ¿Quieres que la cambie a Atendida?`,
    };
  }

  args = {
    ...args,
    appointment_id: paymentAppointment.id,
    service_id: args.service_id || paymentAppointment.service_id,
    doctor_id: args.doctor_id || paymentAppointment.doctor_id,
  };

  if (args.confirmed !== true) {
    return {
      ok: false,
      confirmation_required: true,
      pending_action: {
        tool: 'register_payment',
        args: {
          ...args,
          patient,
          amount,
          payment_method: paymentMethod,
          date,
          branch_key: branch,
          confirmed: true,
        },
      },
      assistant_message:
        `Voy a registrar un pago de $${amount.toFixed(2)} de ${patient} ` +
        `en ${paymentMethod}. ¿Confirmas?`,
    };
  }

  const { rows } = await q(`
    INSERT INTO payments (
      appointment_id, patient, service_id, amount, payment_method,
      date, doctor_id, sucursal_id, tenant_id
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid)
    RETURNING *
  `, [
    args.appointment_id || null,
    patient,
    args.service_id ? Number(args.service_id) : null,
    amount,
    paymentMethod,
    date,
    args.doctor_id ? Number(args.doctor_id) : null,
    branch,
    ctx.tenant_id,
  ]);

  const payment = rows[0];

  emitFinanceEvent('payment.created', {
    payment_id: payment.id,
    patient: payment.patient,
    amount: payment.amount,
    payment_method: payment.payment_method,
    date: payment.date,
  }, ctx, branch);

  return {
    ok: true,
    payment,
    assistant_message:
      `Pago registrado correctamente: $${amount.toFixed(2)} de ${patient} en ${paymentMethod}.`,
    client_event: {
      type: 'finance_changed',
      area: 'payments',
      movement_id: payment.id,
    },
  };
}

async function registerExpense(q, ctx, args = {}) {
  const concept = text(args.concept);
  const amount = moneyValue(args.amount);
  const date = text(args.date) || localDate(ctx.timezone);
  const paymentMethod = normalizePaymentMethod(args.payment_method) || null;
  const branch = text(args.branch_key || ctx.branch_key) || 'sucursal_1';

  if (!concept) throw new Error('Falta el concepto del gasto');
  if (amount <= 0) throw new Error('El monto debe ser mayor a 0');

  if (args.confirmed !== true) {
    return {
      ok: false,
      confirmation_required: true,
      pending_action: {
        tool: 'register_expense',
        args: {
          ...args,
          concept,
          amount,
          payment_method: paymentMethod,
          date,
          branch_key: branch,
          confirmed: true,
        },
      },
      assistant_message:
        `Voy a registrar un gasto de $${amount.toFixed(2)} por ${concept}. ¿Confirmas?`,
    };
  }

  const { rows } = await q(`
    INSERT INTO expenses (
      concept, amount, date, doctor_id, payment_method,
      sucursal_id, tenant_id
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7::uuid)
    RETURNING *
  `, [
    concept,
    amount,
    date,
    args.doctor_id ? Number(args.doctor_id) : null,
    paymentMethod,
    branch,
    ctx.tenant_id,
  ]);

  const expense = rows[0];

  emitFinanceEvent('expense.created', {
    expense_id: expense.id,
    concept: expense.concept,
    amount: expense.amount,
    payment_method: expense.payment_method,
    date: expense.date,
  }, ctx, branch);

  return {
    ok: true,
    expense,
    assistant_message:
      `Gasto registrado correctamente: $${amount.toFixed(2)} por ${concept}.`,
    client_event: {
      type: 'finance_changed',
      area: 'expenses',
      movement_id: expense.id,
    },
  };
}



function normalizeAppointmentStatus(value) {
  const raw = text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (raw.includes('pend')) return 'Pendiente';
  if (raw.includes('confirm')) return 'Confirmada';
  if (raw.includes('cancel')) return 'Cancelada';
  if (raw.includes('atendid') || raw.includes('complet')) return 'Atendida';
  return '';
}

async function updateAppointmentStatus(q, ctx, args = {}) {
  const id = Number(args.appointment_id);
  const status = normalizeAppointmentStatus(args.status);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('appointment_id inválido');
  if (!status) throw new Error('Estado inválido. Usa Pendiente, Confirmada, Cancelada o Atendida');

  const { rows } = await q(`
    UPDATE appointments
       SET status=$1
     WHERE id=$2 AND tenant_id=$3::uuid
     RETURNING id, patient, date, start_time::text AS start_time, status, doctor_id, service_id, sucursal_id
  `, [status, id, ctx.tenant_id]);

  const appointment = rows[0];
  if (!appointment) throw new Error('Cita no encontrada');

  const eventName =
    status === 'Confirmada' ? 'appointment.confirmed' :
    status === 'Cancelada' ? 'appointment.cancelled' :
    'appointment.updated';
  emitAppointmentEvent(eventName, appointment, ctx);

  return {
    ok: true,
    appointment,
    assistant_message: `Listo. La cita de ${appointment.patient} quedó en estado ${status}.`,
    client_event: { type: 'appointments_changed', appointment_id: appointment.id },
  };
}

async function getPatientHistory(q, ctx, args = {}) {
  const patient = text(args.patient);
  const branch = text(args.branch_key || ctx.branch_key) || 'sucursal_1';
  const limit = Math.max(1, Math.min(Number(args.limit || 20), 50));
  if (!patient) throw new Error('Falta el nombre del paciente');

  const { rows } = await q(`
    SELECT a.id, a.patient, a.phone, a.email, a.date,
           a.start_time::text AS start_time, a.status,
           a.doctor_id, d.name AS doctor_name,
           a.service_id, s.name AS service_name,
           COALESCE((
             SELECT SUM(p.amount)::numeric
               FROM payments p
              WHERE p.tenant_id=a.tenant_id
                AND p.appointment_id=a.id
           ),0)::numeric AS paid_amount
      FROM appointments a
      LEFT JOIN doctors d ON d.id=a.doctor_id
      LEFT JOIN services s ON s.id=a.service_id
     WHERE a.tenant_id=$1::uuid
       AND (a.sucursal_id=$2 OR a.sucursal_id IS NULL)
       AND a.patient ILIKE $3
     ORDER BY a.date DESC, a.start_time DESC, a.id DESC
     LIMIT $4
  `, [ctx.tenant_id, branch, `%${patient}%`, limit]);

  const lastVisit = rows.find(row => {
    const st = normalizeStatus(row.status);
    return st.includes('atendid') || st.includes('complet');
  }) || rows[0] || null;

  return {
    patient_query: patient,
    appointments: rows,
    last_visit: lastVisit,
    assistant_message: lastVisit
      ? `La visita más reciente que encontré para ${lastVisit.patient} fue el ${String(lastVisit.date).slice(0,10)} por ${lastVisit.service_name || 'servicio no especificado'}${lastVisit.doctor_name ? ` con ${lastVisit.doctor_name}` : ''}; estado ${lastVisit.status}.`
      : `No encontré historial de citas para ${patient} en la sucursal actual.`,
  };
}

async function getPatientLastVisit(q, ctx, args = {}) {
  const result = await getPatientHistory(q, ctx, { ...args, limit: 10 });
  return {
    patient_query: result.patient_query,
    last_visit: result.last_visit,
    assistant_message: result.assistant_message,
  };
}

async function resolvePaymentAppointment(q, ctx, args, patient, date, branch) {
  if (args.appointment_id) {
    const { rows } = await q(`
      SELECT id, patient, date, status, doctor_id, service_id, sucursal_id
        FROM appointments
       WHERE id=$1 AND tenant_id=$2::uuid
       LIMIT 1
    `, [Number(args.appointment_id), ctx.tenant_id]);
    return rows;
  }

  const { rows } = await q(`
    SELECT id, patient, date, status, doctor_id, service_id, sucursal_id
      FROM appointments
     WHERE tenant_id=$1::uuid
       AND (sucursal_id=$2 OR sucursal_id IS NULL)
       AND patient ILIKE $3
       AND date=$4::date
     ORDER BY start_time DESC, id DESC
     LIMIT 3
  `, [ctx.tenant_id, branch, patient, date]);
  return rows;
}

function isAttendedStatus(value) {
  const st = normalizeStatus(value);
  return st.includes('atendid') || st.includes('complet');
}

async function listLaboratories(q, ctx, args = {}) {
  const branch = text(args.branch_key || ctx.branch_key) || 'sucursal_1';
  const { rows } = await q(`
    SELECT id, nombre, contacto, sucursal_id
      FROM laboratorios
     WHERE tenant_id=$1::uuid
       AND (sucursal_id=$2 OR sucursal_id IS NULL)
     ORDER BY nombre ASC
     LIMIT 100
  `, [ctx.tenant_id, branch]);
  return {
    laboratories: rows,
    assistant_message: rows.length
      ? `Encontré ${rows.length} laboratorio${rows.length === 1 ? '' : 's'} registrado${rows.length === 1 ? '' : 's'}.`
      : 'No hay laboratorios registrados en esta sucursal.',
  };
}

async function createLaboratory(q, ctx, args = {}) {
  const name = text(args.name || args.nombre);
  const contact = text(args.contact || args.contacto) || null;
  const branch = text(args.branch_key || ctx.branch_key) || 'sucursal_1';
  if (!name) throw new Error('Falta el nombre del laboratorio');

  const { rows } = await q(`
    INSERT INTO laboratorios (nombre, contacto, sucursal_id, tenant_id)
    VALUES ($1,$2,$3,$4::uuid)
    RETURNING id, nombre, contacto, sucursal_id
  `, [name, contact, branch, ctx.tenant_id]);

  const laboratory = rows[0];
  try {
    f1EventBus.emit('laboratory.created', {
      laboratory_id: laboratory.id,
      name: laboratory.nombre,
    }, {
      tenant_id: ctx.tenant_id,
      branch_key: branch,
      user_id: ctx.user_id || null,
      source: 'f1',
    });
  } catch (_) {}

  return {
    ok: true,
    laboratory,
    assistant_message: `Laboratorio ${laboratory.nombre} creado correctamente.`,
    client_event: { type: 'laboratories_changed', laboratory_id: laboratory.id },
  };
}

async function listLabWorks(q, ctx, args = {}) {
  const branch = text(args.branch_key || ctx.branch_key) || 'sucursal_1';
  const patient = text(args.patient);
  const laboratoryId = args.laboratory_id ? Number(args.laboratory_id) : null;
  const params = [ctx.tenant_id, branch];
  const where = [
    'lt.tenant_id=$1::uuid',
    '(lt.sucursal_id=$2 OR lt.sucursal_id IS NULL)',
  ];
  if (patient) { params.push(`%${patient}%`); where.push(`lt.paciente ILIKE $${params.length}`); }
  if (laboratoryId) { params.push(laboratoryId); where.push(`lt.laboratorio_id=$${params.length}`); }

  const { rows } = await q(`
    SELECT lt.id, lt.paciente, lt.laboratorio_id, l.nombre AS laboratorio,
           lt.servicio_id, s.name AS servicio,
           lt.presupuesto, lt.fecha_inicio, lt.fecha_entrega_estimada,
           lt.etapa, lt.notas, lt.sucursal_id,
           COALESCE((
             SELECT SUM(la.monto)::numeric
               FROM lab_abonos la
              WHERE la.trabajo_id=lt.id
           ),0)::numeric AS total_abonado
      FROM lab_trabajos lt
      LEFT JOIN laboratorios l ON l.id=lt.laboratorio_id
      LEFT JOIN services s ON s.id=lt.servicio_id
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(lt.fecha_entrega_estimada, lt.fecha_inicio) DESC, lt.id DESC
     LIMIT 50
  `, params);

  return {
    works: rows,
    assistant_message: rows.length
      ? `Encontré ${rows.length} trabajo${rows.length === 1 ? '' : 's'} de laboratorio.`
      : 'No encontré trabajos de laboratorio con esos datos.',
  };
}

async function createLabWork(q, ctx, args = {}) {
  const patient = text(args.patient || args.paciente);
  const labId = Number(args.laboratory_id || args.laboratorio_id);
  const budget = moneyValue(args.budget ?? args.presupuesto);
  const startDate = text(args.start_date || args.fecha_inicio) || localDate(ctx.timezone);
  const dueDate = text(args.due_date || args.fecha_entrega_estimada) || null;
  const stage = text(args.stage || args.etapa) || 'Toma de impresión';
  const notes = text(args.notes || args.notas) || null;
  const branch = text(args.branch_key || ctx.branch_key) || 'sucursal_1';
  const serviceId = args.service_id ? Number(args.service_id) : null;

  if (!patient) throw new Error('Falta el paciente');
  if (!Number.isSafeInteger(labId) || labId <= 0) throw new Error('Falta seleccionar un laboratorio válido');
  if (budget < 0) throw new Error('El presupuesto no puede ser negativo');

  const lab = (await q(`
    SELECT id,nombre FROM laboratorios
     WHERE id=$1 AND tenant_id=$2::uuid
       AND (sucursal_id=$3 OR sucursal_id IS NULL)
     LIMIT 1
  `, [labId, ctx.tenant_id, branch])).rows[0];
  if (!lab) throw new Error('Laboratorio no encontrado en esta empresa');

  const { rows } = await q(`
    INSERT INTO lab_trabajos (
      paciente,laboratorio_id,servicio_id,presupuesto,fecha_inicio,
      fecha_entrega_estimada,etapa,notas,sucursal_id,tenant_id
    )
    VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10::uuid)
    RETURNING *
  `, [patient, labId, serviceId, budget, startDate, dueDate, stage, notes, branch, ctx.tenant_id]);

  const work = rows[0];
  return {
    ok: true,
    work,
    assistant_message: `Trabajo de laboratorio creado para ${patient} con ${lab.nombre}${dueDate ? `, entrega estimada ${dueDate}` : ''}.`,
    client_event: { type: 'laboratory_changed', work_id: work.id },
  };
}

async function updateLabWorkStage(q, ctx, args = {}) {
  const workId = text(args.work_id || args.trabajo_id);
  const stage = text(args.stage || args.etapa);
  const notes = args.notes !== undefined ? text(args.notes) : null;
  if (!workId) throw new Error('Falta el identificador del trabajo');
  if (!stage) throw new Error('Falta la etapa nueva');

  const { rows } = await q(`
    UPDATE lab_trabajos
       SET etapa=$1,
           notas=CASE WHEN $2::text IS NULL THEN notas ELSE $2::text END
     WHERE id=$3 AND tenant_id=$4::uuid
     RETURNING *
  `, [stage, notes, workId, ctx.tenant_id]);
  const work = rows[0];
  if (!work) throw new Error('Trabajo de laboratorio no encontrado');
  return {
    ok: true,
    work,
    assistant_message: `El trabajo de ${work.paciente} quedó en etapa ${work.etapa}.`,
    client_event: { type: 'laboratory_changed', work_id: work.id },
  };
}

async function registerLabPayment(q, ctx, args = {}) {
  const workId = text(args.work_id || args.trabajo_id);
  const amount = moneyValue(args.amount || args.monto);
  const date = text(args.date || args.fecha) || localDate(ctx.timezone);
  const note = text(args.note || args.nota) || null;
  const branch = text(args.branch_key || ctx.branch_key) || 'sucursal_1';
  if (!workId) throw new Error('Falta el trabajo de laboratorio');
  if (amount <= 0) throw new Error('El abono debe ser mayor a 0');

  const work = (await q(`
    SELECT id,paciente,presupuesto FROM lab_trabajos
     WHERE id=$1 AND tenant_id=$2::uuid
     LIMIT 1
  `, [workId, ctx.tenant_id])).rows[0];
  if (!work) throw new Error('Trabajo de laboratorio no encontrado');

  const { rows } = await q(`
    INSERT INTO lab_abonos (trabajo_id,monto,fecha,nota,sucursal_id,tenant_id)
    VALUES ($1,$2,$3::date,$4,$5,$6::uuid)
    RETURNING *
  `, [workId, amount, date, note, branch, ctx.tenant_id]);

  const total = Number((await q(`
    SELECT COALESCE(SUM(monto),0)::numeric AS total
      FROM lab_abonos
     WHERE trabajo_id=$1
  `, [workId])).rows[0]?.total || 0);

  return {
    ok: true,
    payment: rows[0],
    work_id: workId,
    total_paid: total,
    balance: Math.max(0, moneyValue(work.presupuesto) - total),
    assistant_message: `Abono de laboratorio registrado por $${amount.toFixed(2)} para ${work.paciente}. Total abonado: $${total.toFixed(2)}.`,
    client_event: { type: 'laboratory_changed', work_id: workId },
  };
}

async function listInventory(q, ctx, args = {}) {
  const branch = text(args.branch_key || ctx.branch_key) || 'sucursal_1';
  const query = text(args.query || args.search);
  const params = [ctx.tenant_id, branch];
  let filter = '';
  if (query) {
    params.push(`%${query}%`);
    filter = ` AND (name ILIKE $3 OR COALESCE(sku,'') ILIKE $3 OR COALESCE(category,'') ILIKE $3)`;
  }
  const { rows } = await q(`
    SELECT id,sku,name,category,type,quantity,min_stock,max_stock,price,supplier,
           last_purchase,usage_per_patient,expiration_date,sucursal_id
      FROM inventory
     WHERE tenant_id=$1::uuid
       AND (sucursal_id=$2 OR sucursal_id IS NULL)
       ${filter}
     ORDER BY name ASC
     LIMIT 100
  `, params);
  return {
    inventory: rows,
    assistant_message: rows.length
      ? `Encontré ${rows.length} producto${rows.length === 1 ? '' : 's'} en inventario.`
      : 'No encontré productos de inventario con esos datos.',
  };
}

async function updateInventoryStock(q, ctx, args = {}) {
  const id = Number(args.inventory_id || args.id);
  const quantity = Number(args.quantity);
  const branch = text(args.branch_key || ctx.branch_key) || 'sucursal_1';
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Producto de inventario inválido');
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('La cantidad debe ser 0 o mayor');

  const { rows } = await q(`
    UPDATE inventory
       SET quantity=$1
     WHERE id=$2 AND tenant_id=$3::uuid
       AND (sucursal_id=$4 OR sucursal_id IS NULL)
     RETURNING id,name,quantity,min_stock,max_stock,sucursal_id
  `, [quantity, id, ctx.tenant_id, branch]);
  const item = rows[0];
  if (!item) throw new Error('Producto de inventario no encontrado');
  return {
    ok: true,
    item,
    assistant_message: `Inventario actualizado. ${item.name} quedó con ${item.quantity} unidades.`,
    client_event: { type: 'inventory_changed', inventory_id: item.id },
  };
}

function normalizePhoneForWhatsApp(value) {
  return text(value).replace(/[^\d]/g, '');
}

async function sendWhatsAppMessage(q, ctx, args = {}) {
  const to = normalizePhoneForWhatsApp(args.phone || args.to);
  const message = text(args.message);
  if (!to) throw new Error('Falta el número de WhatsApp del destinatario');
  if (!message) throw new Error('Falta el mensaje');

  let phoneNumberId = text(args.phone_number_id);
  if (!phoneNumberId) {
    try {
      const { rows } = await q(`
        SELECT COALESCE(phone_number_id,external_id) AS phone_number_id
          FROM clinic_channels
         WHERE tenant_id=$1::uuid
           AND LOWER(COALESCE(channel,''))='whatsapp'
           AND COALESCE(active,TRUE)=TRUE
           AND COALESCE(is_active,TRUE)=TRUE
           AND (branch_key=$2 OR sucursal_id=$2 OR branch_key IS NULL)
         ORDER BY CASE WHEN branch_key=$2 OR sucursal_id=$2 THEN 0 ELSE 1 END, id DESC
         LIMIT 1
      `, [ctx.tenant_id, ctx.branch_key || 'sucursal_1']);
      phoneNumberId = text(rows[0]?.phone_number_id);
    } catch (_) {}
  }

  const token = text(
    process.env.WHATSAPP_ACCESS_TOKEN ||
    process.env.WHATSAPP_TOKEN ||
    process.env.META_WHATSAPP_TOKEN
  );
  if (!phoneNumberId) throw new Error('No hay un número de WhatsApp configurado para esta sucursal');
  if (!token) throw new Error('No está configurado el token de WhatsApp en el servidor');

  const version = text(process.env.META_GRAPH_VERSION) || 'v23.0';
  const response = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message },
    }),
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = { raw }; }
  if (!response.ok) throw new Error(`WhatsApp no pudo enviar el mensaje (${response.status})`);

  return {
    ok: true,
    to,
    message_id: data?.messages?.[0]?.id || null,
    assistant_message: `Mensaje enviado por WhatsApp al ${to}.`,
  };
}

function openModule(_q, _ctx, args = {}) {
  const raw = text(args.module).toLowerCase();
  const aliases = {
    agenda: 'agenda', citas: 'agenda', calendario: 'agenda',
    caja: 'pagos', pagos: 'pagos', ingresos: 'pagos', egresos: 'pagos',
    reportes: 'analytics', reporte: 'analytics', productividad: 'analytics', dashboard: 'analytics',
    laboratorio: 'laboratorios', laboratorios: 'laboratorios',
    whatsapp: 'whatsapp', mensajes: 'whatsapp',
    facturacion: 'facturacion', factura: 'facturacion',
    empresas: 'empresas', empresa: 'empresas',
    inventario: 'inventario',
    expediente: 'expediente', pacientes: 'expediente', paciente: 'expediente',
  };
  const target = aliases[raw];
  if (!target) throw new Error(`Módulo no reconocido: ${raw || 'vacío'}`);
  return {
    ok: true,
    client_action: { type: 'navigate', target },
    assistant_message: `Abriendo ${raw}.`,
  };
}

async function operationsReport(q, ctx, args = {}) {
  return buildOperationsReport(q, ctx, args);
}


// ==============================
// F1 V3 — Operación ampliada de módulos
// ==============================
function branchOf(ctx, args = {}) { return text(args.branch_key || ctx.branch_key) || 'sucursal_1'; }
function safeNum(value, fallback = null) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function requireConfirm(args, message) {
  if (args.confirmed !== true) return { requires_confirmation:true, assistant_message:message };
  return null;
}
function skuBase(name) {
  return text(name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,18) || 'ITEM';
}
function inferInventoryCategory(name) {
  const v=text(name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if (/resina|composite|adhesivo|bond/.test(v)) return 'resina';
  if (/anest|lidocaina|mepivacaina|articaina|aguja/.test(v)) return 'anestesia';
  if (/endo|guta|lima|hipoclorito/.test(v)) return 'endodoncia';
  if (/ortodon|bracket|arco|ligadura/.test(v)) return 'ortodoncia';
  if (/guante|cubre|gasa|vaso|eyector|babero|rollo|algodon/.test(v)) return 'desechable';
  if (/pinza|espejo|explorador|elevador|forceps|pieza|instrument/.test(v)) return 'instrumental';
  return null;
}

async function getInventoryAlerts(q, ctx, args={}) {
  const branch=branchOf(ctx,args);
  const {rows}=await q(`SELECT id,sku,name,category,type,quantity,min_stock,max_stock,price,supplier,last_purchase,usage_per_patient,expiration_date,sucursal_id,
    CASE WHEN COALESCE(quantity,0)<=0 THEN 'critico' WHEN COALESCE(quantity,0)<=COALESCE(min_stock,0) THEN 'bajo' ELSE 'normal' END AS stock_status
    FROM inventory WHERE tenant_id=$1::uuid AND (sucursal_id=$2 OR sucursal_id IS NULL)
    ORDER BY CASE WHEN COALESCE(quantity,0)<=0 THEN 0 WHEN COALESCE(quantity,0)<=COALESCE(min_stock,0) THEN 1 ELSE 2 END, name`,[ctx.tenant_id,branch]);
  const critical=rows.filter(r=>r.stock_status==='critico'), low=rows.filter(r=>r.stock_status==='bajo'), normal=rows.filter(r=>r.stock_status==='normal');
  return {summary:{total:rows.length,critical:critical.length,low:low.length,normal:normal.length},critical,low,normal,
    assistant_message:`Inventario: ${rows.length} productos; ${critical.length} críticos/agотados, ${low.length} bajos y ${normal.length} en nivel normal.`};
}

async function getInventoryItem(q,ctx,args={}){
  const branch=branchOf(ctx,args), query=text(args.query); if(!query) throw new Error('Falta el producto a buscar');
  const {rows}=await q(`SELECT id,sku,name,category,type,quantity,min_stock,max_stock,price,supplier,last_purchase,usage_per_patient,expiration_date,sucursal_id,
    CASE WHEN COALESCE(quantity,0)<=0 THEN 'critico' WHEN COALESCE(quantity,0)<=COALESCE(min_stock,0) THEN 'bajo' ELSE 'normal' END AS stock_status
    FROM inventory WHERE tenant_id=$1::uuid AND (sucursal_id=$2 OR sucursal_id IS NULL)
    AND (LOWER(name)=LOWER($3) OR LOWER(COALESCE(sku,''))=LOWER($3) OR name ILIKE $4 OR COALESCE(sku,'') ILIKE $4 OR COALESCE(category,'') ILIKE $4)
    ORDER BY CASE WHEN LOWER(name)=LOWER($3) OR LOWER(COALESCE(sku,''))=LOWER($3) THEN 0 ELSE 1 END,LENGTH(name) LIMIT 10`,[ctx.tenant_id,branch,query,`%${query}%`]);
  return {matches:rows,item:rows.length===1?rows[0]:null,ambiguous:rows.length>1,assistant_message:rows.length===0?`No encontré ${query} en inventario.`:rows.length===1?`${rows[0].name}: ${rows[0].quantity} unidades; mínimo ${rows[0].min_stock}; estado ${rows[0].stock_status}.`:`Encontré ${rows.length} coincidencias para ${query}.`};
}

async function createInventoryItem(q,ctx,args={}){
  const branch=branchOf(ctx,args), name=text(args.name); if(!name) throw new Error('Falta el nombre del producto');
  const category=text(args.category)||inferInventoryCategory(name);
  const type=text(args.type)||'material';
  if(!category) return {needs_input:true,missing:['category'],allowed_categories:['instrumental','desechable','anestesia','resina','endodoncia','ortodoncia'],assistant_message:`Para agregar ${name}, ¿en qué categoría lo registro: instrumental, desechable, anestesia, resina, endodoncia u ortodoncia?`};
  let sku=text(args.sku);
  if(!sku){ const base=skuBase(name); let candidate=base, i=2; while((await q(`SELECT 1 FROM inventory WHERE tenant_id=$1::uuid AND (sucursal_id=$2 OR sucursal_id IS NULL) AND LOWER(sku)=LOWER($3) LIMIT 1`,[ctx.tenant_id,branch,candidate])).rows[0]) candidate=`${base}-${i++}`; sku=candidate; }
  const quantity=Math.max(0,safeNum(args.quantity,0)), min=Math.max(0,safeNum(args.min_stock,10)), max=Math.max(min,safeNum(args.max_stock,100));
  const {rows}=await q(`INSERT INTO inventory(sku,name,category,type,quantity,min_stock,max_stock,price,supplier,usage_per_patient,expiration_date,last_purchase,sucursal_id,tenant_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CURRENT_DATE,$12,$13::uuid) RETURNING *`,[sku,name,category,type,quantity,min,max,Math.max(0,safeNum(args.price,0)),text(args.supplier)||null,Math.max(.01,safeNum(args.usage_per_patient,1)),text(args.expiration_date)||null,branch,ctx.tenant_id]);
  return {ok:true,item:rows[0],assistant_message:`Producto agregado: ${name}, SKU ${sku}, existencia ${quantity}.`,client_event:{type:'inventory_changed',inventory_id:rows[0].id}};
}

async function updateInventoryItem(q,ctx,args={}){
  const id=Number(args.inventory_id), branch=branchOf(ctx,args); if(!Number.isSafeInteger(id)||id<=0) throw new Error('Producto inválido');
  const fields={sku:args.sku,name:args.name,category:args.category,type:args.type,quantity:args.quantity,min_stock:args.min_stock,max_stock:args.max_stock,price:args.price,supplier:args.supplier,usage_per_patient:args.usage_per_patient,expiration_date:args.expiration_date};
  const sets=[],vals=[]; for(const [k,v] of Object.entries(fields)){ if(v!==undefined){ vals.push(v===''?null:v); sets.push(`${k}=$${vals.length}`); }}
  if(!sets.length) throw new Error('No hay cambios que aplicar'); vals.push(id,ctx.tenant_id,branch);
  const {rows}=await q(`UPDATE inventory SET ${sets.join(', ')} WHERE id=$${vals.length-2} AND tenant_id=$${vals.length-1}::uuid AND (sucursal_id=$${vals.length} OR sucursal_id IS NULL) RETURNING *`,vals);
  if(!rows[0]) throw new Error('Producto no encontrado'); return {ok:true,item:rows[0],assistant_message:`Actualicé ${rows[0].name}.`,client_event:{type:'inventory_changed',inventory_id:id}};
}

async function adjustInventoryStock(q,ctx,args={}){
  const id=Number(args.inventory_id), delta=Number(args.delta), branch=branchOf(ctx,args); if(!Number.isSafeInteger(id)||!Number.isFinite(delta)) throw new Error('Datos de inventario inválidos');
  const {rows}=await q(`UPDATE inventory SET quantity=GREATEST(0,COALESCE(quantity,0)+$1) WHERE id=$2 AND tenant_id=$3::uuid AND (sucursal_id=$4 OR sucursal_id IS NULL) RETURNING id,name,quantity,min_stock,max_stock`,[delta,id,ctx.tenant_id,branch]);
  if(!rows[0]) throw new Error('Producto no encontrado'); return {ok:true,item:rows[0],assistant_message:`${rows[0].name} quedó con ${rows[0].quantity} unidades.`,client_event:{type:'inventory_changed',inventory_id:id}};
}

async function deleteInventoryItem(q,ctx,args={}){
  const id=Number(args.inventory_id), branch=branchOf(ctx,args); const chk=await q(`SELECT id,name FROM inventory WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[id,ctx.tenant_id,branch]); if(!chk.rows[0]) throw new Error('Producto no encontrado');
  const c=requireConfirm(args,`Vas a eliminar definitivamente ${chk.rows[0].name} del inventario. ¿Confirmas?`); if(c)return c;
  await q(`DELETE FROM inventory WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[id,ctx.tenant_id,branch]); return {ok:true,assistant_message:`Eliminé ${chk.rows[0].name} del inventario.`,client_event:{type:'inventory_changed',inventory_id:id}};
}

async function createDoctor(q,ctx,args={}){ const branch=branchOf(ctx,args),name=text(args.name);if(!name)throw new Error('Falta el nombre del doctor');const {rows}=await q(`INSERT INTO doctors(name,color,sucursal_id,tenant_id) VALUES($1,$2,$3,$4::uuid) RETURNING *`,[name,text(args.color)||null,branch,ctx.tenant_id]);return{ok:true,doctor:rows[0],assistant_message:`Doctor ${name} creado.`,client_event:{type:'doctors_changed',doctor_id:rows[0].id}}; }
async function updateDoctor(q,ctx,args={}){const branch=branchOf(ctx,args),id=Number(args.doctor_id);const {rows}=await q(`UPDATE doctors SET name=COALESCE($1,name),color=COALESCE($2,color) WHERE id=$3 AND tenant_id=$4::uuid AND (sucursal_id=$5 OR sucursal_id IS NULL) RETURNING *`,[text(args.name)||null,text(args.color)||null,id,ctx.tenant_id,branch]);if(!rows[0])throw new Error('Doctor no encontrado');return{ok:true,doctor:rows[0],assistant_message:`Actualicé al doctor ${rows[0].name}.`,client_event:{type:'doctors_changed',doctor_id:id}};}
async function deleteDoctor(q,ctx,args={}){const branch=branchOf(ctx,args),id=Number(args.doctor_id);const r=await q(`SELECT id,name FROM doctors WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[id,ctx.tenant_id,branch]);if(!r.rows[0])throw new Error('Doctor no encontrado');const c=requireConfirm(args,`¿Confirmas eliminar al doctor ${r.rows[0].name}?`);if(c)return c;try{await q(`DELETE FROM doctors WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[id,ctx.tenant_id,branch]);}catch(e){if(e.code==='23503')return{blocked:true,assistant_message:'No puedo eliminar ese doctor porque tiene citas, pagos, gastos u otros registros relacionados. Primero deben reasignarse o conservarse.'};throw e;}return{ok:true,assistant_message:`Doctor ${r.rows[0].name} eliminado.`,client_event:{type:'doctors_changed',doctor_id:id}};}
async function createService(q,ctx,args={}){const branch=branchOf(ctx,args),name=text(args.name);if(!name)throw new Error('Falta el nombre del servicio');const {rows}=await q(`INSERT INTO services(name,price,duration_hours,description,active,sucursal_id,tenant_id) VALUES($1,$2,$3,$4,$5,$6,$7::uuid) RETURNING *`,[name,args.price==null?null:Number(args.price),safeNum(args.duration_hours,1),text(args.description),args.active!==false,branch,ctx.tenant_id]);return{ok:true,service:rows[0],assistant_message:`Servicio ${name} creado.`,client_event:{type:'services_changed',service_id:rows[0].id}};}
async function updateService(q,ctx,args={}){const branch=branchOf(ctx,args),id=Number(args.service_id);const fields={name:args.name,price:args.price,duration_hours:args.duration_hours,description:args.description,active:args.active},sets=[],vals=[];for(const[k,v]of Object.entries(fields)){if(v!==undefined){vals.push(v);sets.push(`${k}=$${vals.length}`)}}if(!sets.length)throw new Error('No hay cambios');vals.push(id,ctx.tenant_id,branch);const{rows}=await q(`UPDATE services SET ${sets.join(',')} WHERE id=$${vals.length-2} AND tenant_id=$${vals.length-1}::uuid AND (sucursal_id=$${vals.length} OR sucursal_id IS NULL) RETURNING *`,vals);if(!rows[0])throw new Error('Servicio no encontrado');return{ok:true,service:rows[0],assistant_message:`Servicio ${rows[0].name} actualizado.`,client_event:{type:'services_changed',service_id:id}};}
async function deleteService(q,ctx,args={}){const branch=branchOf(ctx,args),id=Number(args.service_id);const r=await q(`SELECT id,name FROM services WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[id,ctx.tenant_id,branch]);if(!r.rows[0])throw new Error('Servicio no encontrado');const c=requireConfirm(args,`¿Confirmas eliminar el servicio ${r.rows[0].name}?`);if(c)return c;try{await q(`DELETE FROM services WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[id,ctx.tenant_id,branch]);}catch(e){if(e.code==='23503')return{blocked:true,assistant_message:'No puedo eliminar ese servicio porque está relacionado con citas, trabajos u otros registros. Puedes desactivarlo en lugar de eliminarlo.'};throw e;}return{ok:true,assistant_message:`Servicio ${r.rows[0].name} eliminado.`,client_event:{type:'services_changed',service_id:id}};}

async function updateAppointmentFull(q,ctx,args={}){const id=Number(args.appointment_id),branch=branchOf(ctx,args);const cur=(await q(`SELECT * FROM appointments WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[id,ctx.tenant_id,branch])).rows[0];if(!cur)throw new Error('Cita no encontrada');
  if(args.date||args.start_time||args.doctor_id){const availability=await checkAvailability(q,ctx,{branch_key:branch,date:text(args.date)||String(cur.date).slice(0,10),exact_time:text(args.start_time)||text(cur.start_time).slice(0,5),doctor_id:args.doctor_id||cur.doctor_id,duration_hours:safeNum(args.duration_hours,cur.duration_hours||1),limit:100});const conflict=availability.slots.filter(s=>String(s.doctor_id)===String(args.doctor_id||cur.doctor_id)&&text(s.start_time).slice(0,5)===(text(args.start_time)||text(cur.start_time).slice(0,5)));if(!conflict.length && (args.date||args.start_time||args.doctor_id)) return{blocked:true,assistant_message:'Ese cambio de horario/doctor no aparece disponible. Puedo buscarte alternativas.'};}
  const fields={patient:args.patient,phone:args.phone,doctor_id:args.doctor_id,service_id:args.service_id,date:args.date,start_time:args.start_time,duration_hours:args.duration_hours,status:args.status},sets=[],vals=[];for(const[k,v]of Object.entries(fields)){if(v!==undefined){vals.push(v);sets.push(`${k}=$${vals.length}`)}}if(!sets.length)throw new Error('No hay cambios');vals.push(id,ctx.tenant_id,branch);const{rows}=await q(`UPDATE appointments SET ${sets.join(',')} WHERE id=$${vals.length-2} AND tenant_id=$${vals.length-1}::uuid AND (sucursal_id=$${vals.length} OR sucursal_id IS NULL) RETURNING *`,vals);emitAppointmentEvent('appointment.updated',rows[0],ctx);return{ok:true,appointment:rows[0],assistant_message:`Cita de ${rows[0].patient} actualizada.`,client_event:{type:'appointments_changed',appointment_id:id}};}
async function deleteAppointmentFull(q,ctx,args={}){const id=Number(args.appointment_id),r=await q(`SELECT id,patient,date,start_time FROM appointments WHERE id=$1 AND tenant_id=$2::uuid`,[id,ctx.tenant_id]);if(!r.rows[0])throw new Error('Cita no encontrada');const c=requireConfirm(args,`¿Confirmas eliminar definitivamente la cita de ${r.rows[0].patient}?`);if(c)return c;try{await q(`DELETE FROM appointments WHERE id=$1 AND tenant_id=$2::uuid`,[id,ctx.tenant_id]);}catch(e){if(e.code==='23503')return{blocked:true,assistant_message:'No puedo eliminar la cita porque tiene pagos u otros registros relacionados. Puedes marcarla Cancelada.'};throw e;}return{ok:true,assistant_message:`Cita de ${r.rows[0].patient} eliminada.`,client_event:{type:'appointments_changed',appointment_id:id}};}

async function listExpenses(q,ctx,args={}){const branch=branchOf(ctx,args),limit=Math.min(100,Math.max(1,Number(args.limit)||20));const{rows}=await q(`SELECT id,concept,amount,date,doctor_id,payment_method,sucursal_id FROM expenses WHERE tenant_id=$1::uuid AND (sucursal_id=$2 OR sucursal_id IS NULL) ORDER BY date DESC,id DESC LIMIT $3`,[ctx.tenant_id,branch,limit]);return{expenses:rows,assistant_message:`Encontré ${rows.length} gastos recientes.`};}
async function updatePayment(q,ctx,args={}){const branch=branchOf(ctx,args),id=Number(args.payment_id),r=(await q(`SELECT * FROM payments WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[id,ctx.tenant_id,branch])).rows[0];if(!r)throw new Error('Ingreso no encontrado');const c=requireConfirm(args,`Vas a modificar el ingreso #${id} de ${r.patient} por $${r.amount}. ¿Confirmas?`);if(c)return c;const f={patient:args.patient,amount:args.amount,payment_method:args.payment_method,date:args.date},sets=[],vals=[];for(const[k,v]of Object.entries(f)){if(v!==undefined){vals.push(v);sets.push(`${k}=$${vals.length}`)}}if(!sets.length)throw new Error('No hay cambios');vals.push(id,ctx.tenant_id,branch);const{rows}=await q(`UPDATE payments SET ${sets.join(',')} WHERE id=$${vals.length-2} AND tenant_id=$${vals.length-1}::uuid AND (sucursal_id=$${vals.length} OR sucursal_id IS NULL) RETURNING *`,vals);return{ok:true,payment:rows[0],assistant_message:'Ingreso actualizado.',client_event:{type:'payments_changed',payment_id:id}};}
async function deletePayment(q,ctx,args={}){const branch=branchOf(ctx,args),id=Number(args.payment_id),r=(await q(`SELECT * FROM payments WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[id,ctx.tenant_id,branch])).rows[0];if(!r)throw new Error('Ingreso no encontrado');const c=requireConfirm(args,`¿Confirmas eliminar el ingreso #${id} de ${r.patient} por $${r.amount}?`);if(c)return c;await q(`DELETE FROM payments WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[id,ctx.tenant_id,branch]);return{ok:true,assistant_message:'Ingreso eliminado.',client_event:{type:'payments_changed',payment_id:id}};}
async function updateExpense(q,ctx,args={}){const branch=branchOf(ctx,args),id=Number(args.expense_id),r=(await q(`SELECT * FROM expenses WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[id,ctx.tenant_id,branch])).rows[0];if(!r)throw new Error('Gasto no encontrado');const c=requireConfirm(args,`Vas a modificar el gasto #${id} (${r.concept}) por $${r.amount}. ¿Confirmas?`);if(c)return c;const f={concept:args.concept,amount:args.amount,date:args.date,doctor_id:args.doctor_id,payment_method:args.payment_method},sets=[],vals=[];for(const[k,v]of Object.entries(f)){if(v!==undefined){vals.push(v);sets.push(`${k}=$${vals.length}`)}}if(!sets.length)throw new Error('No hay cambios');vals.push(id,ctx.tenant_id,branch);const{rows}=await q(`UPDATE expenses SET ${sets.join(',')} WHERE id=$${vals.length-2} AND tenant_id=$${vals.length-1}::uuid AND (sucursal_id=$${vals.length} OR sucursal_id IS NULL) RETURNING *`,vals);return{ok:true,expense:rows[0],assistant_message:'Gasto actualizado.',client_event:{type:'expenses_changed',expense_id:id}};}
async function deleteExpense(q,ctx,args={}){const branch=branchOf(ctx,args),id=Number(args.expense_id),r=(await q(`SELECT * FROM expenses WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[id,ctx.tenant_id,branch])).rows[0];if(!r)throw new Error('Gasto no encontrado');const c=requireConfirm(args,`¿Confirmas eliminar el gasto #${id} (${r.concept}) por $${r.amount}?`);if(c)return c;await q(`DELETE FROM expenses WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[id,ctx.tenant_id,branch]);return{ok:true,assistant_message:'Gasto eliminado.',client_event:{type:'expenses_changed',expense_id:id}};}

async function updateLaboratory(q,ctx,args={}){const branch=branchOf(ctx,args),id=Number(args.laboratory_id);const{rows}=await q(`UPDATE laboratorios SET nombre=COALESCE($1,nombre),contacto=COALESCE($2,contacto) WHERE id=$3 AND tenant_id=$4::uuid AND (sucursal_id=$5 OR sucursal_id IS NULL) RETURNING *`,[text(args.name)||null,text(args.contact)||null,id,ctx.tenant_id,branch]);if(!rows[0])throw new Error('Laboratorio no encontrado');return{ok:true,laboratory:rows[0],assistant_message:`Laboratorio ${rows[0].nombre} actualizado.`,client_event:{type:'laboratory_changed',laboratory_id:id}};}
async function deleteLaboratory(q,ctx,args={}){const branch=branchOf(ctx,args),id=Number(args.laboratory_id),lab=(await q(`SELECT * FROM laboratorios WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[id,ctx.tenant_id,branch])).rows[0];if(!lab)throw new Error('Laboratorio no encontrado');const works=(await q(`SELECT COUNT(*)::int count FROM lab_trabajos WHERE laboratorio_id=$1 AND tenant_id=$2::uuid`,[id,ctx.tenant_id])).rows[0].count;if(works>0)return{blocked:true,related_works:works,assistant_message:`No puedo eliminar ${lab.nombre} porque tiene ${works} trabajo(s) asociado(s). Primero debes reasignarlos o eliminar esos trabajos.`};const c=requireConfirm(args,`¿Confirmas eliminar el laboratorio ${lab.nombre}?`);if(c)return c;await q(`DELETE FROM laboratorios WHERE id=$1 AND tenant_id=$2::uuid`,[id,ctx.tenant_id]);return{ok:true,assistant_message:`Laboratorio ${lab.nombre} eliminado.`,client_event:{type:'laboratory_changed',laboratory_id:id}};}
async function updateLabWork(q,ctx,args={}){const branch=branchOf(ctx,args),id=text(args.work_id);if(!id)throw new Error('Falta el trabajo');const f={paciente:args.patient,laboratorio_id:args.laboratory_id,servicio_id:args.service_id,presupuesto:args.budget,fecha_inicio:args.start_date,fecha_entrega_estimada:args.due_date,etapa:args.stage,notas:args.notes},sets=[],vals=[];for(const[k,v]of Object.entries(f)){if(v!==undefined){vals.push(v);sets.push(`${k}=$${vals.length}`)}}if(!sets.length)throw new Error('No hay cambios');vals.push(id,ctx.tenant_id,branch);const{rows}=await q(`UPDATE lab_trabajos SET ${sets.join(',')} WHERE id=$${vals.length-2} AND tenant_id=$${vals.length-1}::uuid AND (sucursal_id=$${vals.length} OR sucursal_id IS NULL) RETURNING *`,vals);if(!rows[0])throw new Error('Trabajo no encontrado');return{ok:true,work:rows[0],assistant_message:`Trabajo de ${rows[0].paciente} actualizado.`,client_event:{type:'laboratory_changed',work_id:id}};}
async function deleteLabWork(q,ctx,args={}){const branch=branchOf(ctx,args),id=text(args.work_id),work=(await q(`SELECT * FROM lab_trabajos WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[id,ctx.tenant_id,branch])).rows[0];if(!work)throw new Error('Trabajo no encontrado');const c=requireConfirm(args,`¿Confirmas eliminar el trabajo de laboratorio de ${work.paciente} y sus abonos asociados?`);if(c)return c;await q(`DELETE FROM lab_abonos WHERE trabajo_id=$1 AND tenant_id=$2::uuid`,[id,ctx.tenant_id]);await q(`DELETE FROM pagos_laboratorio WHERE trabajo_id=$1 AND tenant_id=$2::uuid`,[id,ctx.tenant_id]).catch(()=>{});await q(`DELETE FROM lab_trabajos WHERE id=$1 AND tenant_id=$2::uuid`,[id,ctx.tenant_id]);return{ok:true,assistant_message:'Trabajo de laboratorio eliminado.',client_event:{type:'laboratory_changed',work_id:id}};}
async function listLabPayments(q,ctx,args={}){const branch=branchOf(ctx,args),id=text(args.work_id),work=(await q(`SELECT id,paciente,presupuesto FROM lab_trabajos WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[id,ctx.tenant_id,branch])).rows[0];if(!work)throw new Error('Trabajo no encontrado');const{rows}=await q(`SELECT id,monto,fecha,nota,metodo_pago FROM lab_abonos WHERE trabajo_id=$1 AND tenant_id=$2::uuid ORDER BY fecha,id`,[id,ctx.tenant_id]);const total=rows.reduce((s,r)=>s+Number(r.monto||0),0),budget=Number(work.presupuesto||0);return{work,payments:rows,total_paid:total,balance:Math.max(0,budget-total),assistant_message:`${work.paciente}: abonado $${total.toFixed(2)} de $${budget.toFixed(2)}; saldo $${Math.max(0,budget-total).toFixed(2)}.`};}

async function findMedicalRecordRow(q,ctx,patient,branch){const{rows}=await q(`SELECT * FROM expedientes_medicos WHERE tenant_id=$1::uuid AND (sucursal_id=$2 OR sucursal_id IS NULL) AND (LOWER(nombre_paciente)=LOWER($3) OR nombre_paciente ILIKE $4 OR COALESCE(telefono,'') LIKE $4) ORDER BY CASE WHEN LOWER(nombre_paciente)=LOWER($3) THEN 0 ELSE 1 END,created_at DESC LIMIT 10`,[ctx.tenant_id,branch,patient,`%${patient}%`]);return rows;}
async function getMedicalRecord(q,ctx,args={}){const branch=branchOf(ctx,args),patient=text(args.patient);if(!patient)throw new Error('Falta el paciente');const matches=await findMedicalRecordRow(q,ctx,patient,branch);if(!matches.length)return{found:false,assistant_message:`No encontré expediente médico de ${patient}. Puedo crear uno si lo necesitas.`};if(matches.length>1&&matches[0].nombre_paciente.toLowerCase()!==patient.toLowerCase())return{ambiguous:true,matches:matches.map(x=>({id:x.id,name:x.nombre_paciente,phone:x.telefono})),assistant_message:`Encontré ${matches.length} expedientes parecidos. Dime cuál paciente deseas.`};const e=matches[0];const [h,o,t,c,d]=await Promise.all([q(`SELECT * FROM historia_clinica_dental WHERE expediente_id=$1 AND tenant_id=$2::uuid ORDER BY created_at DESC LIMIT 1`,[e.id,ctx.tenant_id]),q(`SELECT * FROM odontograma WHERE expediente_id=$1 AND tenant_id=$2::uuid ORDER BY diente_numero`,[e.id,ctx.tenant_id]),q(`SELECT * FROM tratamientos_dentales WHERE expediente_id=$1 AND tenant_id=$2::uuid ORDER BY fecha DESC,created_at DESC`,[e.id,ctx.tenant_id]),q(`SELECT * FROM consentimientos_informados WHERE expediente_id=$1 AND tenant_id=$2::uuid ORDER BY fecha_consentimiento DESC,created_at DESC`,[e.id,ctx.tenant_id]),q(`SELECT id,tipo,nombre,descripcion,fecha_toma,doctor_id,created_at FROM documentos_radiografias WHERE expediente_id=$1 AND tenant_id=$2::uuid ORDER BY fecha_toma DESC,created_at DESC`,[e.id,ctx.tenant_id])]);return{found:true,record:e,clinical_history:h.rows[0]||null,odontogram:o.rows,treatments:t.rows,consents:c.rows,documents:d.rows,assistant_message:`Expediente de ${e.nombre_paciente} encontrado con ${t.rows.length} tratamientos, ${o.rows.length} dientes registrados y ${d.rows.length} documentos.`};}
async function createMedicalRecord(q,ctx,args={}){const branch=branchOf(ctx,args),patient=text(args.patient);if(!patient)throw new Error('Falta el nombre del paciente');const existing=await findMedicalRecordRow(q,ctx,patient,branch);if(existing.some(x=>x.nombre_paciente.toLowerCase()===patient.toLowerCase()))return{blocked:true,record:existing[0],assistant_message:`Ya existe un expediente para ${patient}. Puedo actualizarlo en lugar de crear otro.`};const{rows}=await q(`INSERT INTO expedientes_medicos(paciente_id,nombre_paciente,telefono,email,fecha_nacimiento,edad,genero,direccion,ocupacion,estado_civil,contacto_emergencia,telefono_emergencia,sucursal_id,tenant_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::uuid) RETURNING *`,[`f1_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,patient,text(args.phone)||null,text(args.email)||null,text(args.birth_date)||null,args.age??null,text(args.gender)||null,text(args.address)||null,text(args.occupation)||null,text(args.marital_status)||null,text(args.emergency_contact)||null,text(args.emergency_phone)||null,branch,ctx.tenant_id]);if(args.appointment_id){await q(`INSERT INTO expediente_citas(expediente_id,appointment_id,tenant_id,sucursal_id) VALUES($1,$2,$3::uuid,$4) ON CONFLICT(tenant_id,appointment_id) DO UPDATE SET expediente_id=EXCLUDED.expediente_id,sucursal_id=EXCLUDED.sucursal_id`,[rows[0].id,Number(args.appointment_id),ctx.tenant_id,branch]);}return{ok:true,record:rows[0],assistant_message:`Expediente médico creado para ${patient}.`,client_event:{type:'medical_record_changed',record_id:rows[0].id}};}
async function updateMedicalRecord(q,ctx,args={}){const branch=branchOf(ctx,args),id=Number(args.record_id),f={nombre_paciente:args.patient,telefono:args.phone,email:args.email,fecha_nacimiento:args.birth_date,edad:args.age,genero:args.gender,direccion:args.address,ocupacion:args.occupation,estado_civil:args.marital_status,contacto_emergencia:args.emergency_contact,telefono_emergencia:args.emergency_phone},sets=[],vals=[];for(const[k,v]of Object.entries(f)){if(v!==undefined){vals.push(v===''?null:v);sets.push(`${k}=$${vals.length}`)}}if(!sets.length)throw new Error('No hay cambios');sets.push('updated_at=NOW()');vals.push(id,ctx.tenant_id,branch);const{rows}=await q(`UPDATE expedientes_medicos SET ${sets.join(',')} WHERE id=$${vals.length-2} AND tenant_id=$${vals.length-1}::uuid AND (sucursal_id=$${vals.length} OR sucursal_id IS NULL) RETURNING *`,vals);if(!rows[0])throw new Error('Expediente no encontrado');return{ok:true,record:rows[0],assistant_message:`Expediente de ${rows[0].nombre_paciente} actualizado.`,client_event:{type:'medical_record_changed',record_id:id}};}
async function upsertClinicalHistory(q,ctx,args={}){const branch=branchOf(ctx,args),recordId=Number(args.record_id);const f=[args.appointment_id||null,ctx.tenant_id,text(args.reason),text(args.current_illness),text(args.personal_history),text(args.family_history),text(args.dental_history),text(args.harmful_habits),text(args.allergies),text(args.current_medications),text(args.extraoral_exam),text(args.intraoral_exam),text(args.presumptive_diagnosis),text(args.treatment_plan),text(args.observations),args.doctor_id||null,text(args.date)||localDate(ctx.timezone),branch];let row;if(args.history_id){const{rows}=await q(`UPDATE historia_clinica_dental SET appointment_id=$1,motivo_consulta=$3,enfermedad_actual=$4,antecedentes_personales=$5,antecedentes_familiares=$6,antecedentes_odontologicos=$7,habitos_nocivos=$8,alergias=$9,medicamentos_actuales=$10,examen_extraoral=$11,examen_intraoral=$12,diagnostico_presuntivo=$13,plan_tratamiento=$14,observaciones=$15,doctor_id=$16,fecha_registro=$17,sucursal_id=$18 WHERE id=$19 AND expediente_id=$20 AND tenant_id=$2::uuid RETURNING *`,[...f,Number(args.history_id),recordId]);row=rows[0];}else{const{rows}=await q(`INSERT INTO historia_clinica_dental(expediente_id,appointment_id,tenant_id,motivo_consulta,enfermedad_actual,antecedentes_personales,antecedentes_familiares,antecedentes_odontologicos,habitos_nocivos,alergias,medicamentos_actuales,examen_extraoral,examen_intraoral,diagnostico_presuntivo,plan_tratamiento,observaciones,doctor_id,fecha_registro,sucursal_id) VALUES($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,[recordId,...f]);row=rows[0];}if(!row)throw new Error('No se pudo actualizar la historia clínica');return{ok:true,history:row,assistant_message:'Historia clínica actualizada.',client_event:{type:'medical_record_changed',record_id:recordId}};}
async function upsertOdontogramTooth(q,ctx,args={}){const branch=branchOf(ctx,args),recordId=Number(args.record_id),tooth=Number(args.tooth_number);if(tooth<11||tooth>48)throw new Error('Número de diente inválido');const{rows}=await q(`INSERT INTO odontograma(expediente_id,appointment_id,tenant_id,diente_numero,estado,superficie,observaciones,fecha_registro,doctor_id,sucursal_id) VALUES($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(expediente_id,diente_numero) DO UPDATE SET appointment_id=EXCLUDED.appointment_id,tenant_id=EXCLUDED.tenant_id,estado=EXCLUDED.estado,superficie=EXCLUDED.superficie,observaciones=EXCLUDED.observaciones,fecha_registro=EXCLUDED.fecha_registro,doctor_id=EXCLUDED.doctor_id,sucursal_id=EXCLUDED.sucursal_id RETURNING *`,[recordId,args.appointment_id||null,ctx.tenant_id,tooth,text(args.status),text(args.surface)||null,text(args.observations)||null,text(args.date)||localDate(ctx.timezone),args.doctor_id||null,branch]);return{ok:true,tooth:rows[0],assistant_message:`Diente ${tooth} actualizado a ${args.status}.`,client_event:{type:'medical_record_changed',record_id:recordId}};}
async function addDentalTreatment(q,ctx,args={}){const branch=branchOf(ctx,args),recordId=Number(args.record_id),procedure=text(args.procedure);if(!procedure)throw new Error('Falta el procedimiento');const{rows}=await q(`INSERT INTO tratamientos_dentales(expediente_id,appointment_id,tenant_id,fecha,diente_numero,procedimiento,descripcion,materiales_usados,duracion_minutos,costo,estado,observaciones,doctor_id,sucursal_id) VALUES($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,[recordId,args.appointment_id||null,ctx.tenant_id,text(args.date)||localDate(ctx.timezone),args.tooth_number||null,procedure,text(args.description)||null,text(args.materials)||null,args.duration_minutes??null,args.cost??null,text(args.status)||'planificado',text(args.observations)||null,args.doctor_id||null,branch]);return{ok:true,treatment:rows[0],assistant_message:`Tratamiento ${procedure} registrado.`,client_event:{type:'medical_record_changed',record_id:recordId}};}
async function updateDentalTreatment(q,ctx,args={}){const branch=branchOf(ctx,args),id=Number(args.treatment_id),f={fecha:args.date,diente_numero:args.tooth_number,procedimiento:args.procedure,descripcion:args.description,materiales_usados:args.materials,duracion_minutos:args.duration_minutes,costo:args.cost,estado:args.status,observaciones:args.observations,doctor_id:args.doctor_id},sets=[],vals=[];for(const[k,v]of Object.entries(f)){if(v!==undefined){vals.push(v);sets.push(`${k}=$${vals.length}`)}}if(!sets.length)throw new Error('No hay cambios');vals.push(id,ctx.tenant_id,branch);const{rows}=await q(`UPDATE tratamientos_dentales SET ${sets.join(',')} WHERE id=$${vals.length-2} AND tenant_id=$${vals.length-1}::uuid AND (sucursal_id=$${vals.length} OR sucursal_id IS NULL) RETURNING *`,vals);if(!rows[0])throw new Error('Tratamiento no encontrado');return{ok:true,treatment:rows[0],assistant_message:'Tratamiento actualizado.',client_event:{type:'medical_record_changed',record_id:rows[0].expediente_id}};}
async function deleteDentalTreatment(q,ctx,args={}){const branch=branchOf(ctx,args),id=Number(args.treatment_id),r=(await q(`SELECT * FROM tratamientos_dentales WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[id,ctx.tenant_id,branch])).rows[0];if(!r)throw new Error('Tratamiento no encontrado');const c=requireConfirm(args,`¿Confirmas eliminar el tratamiento ${r.procedimiento}?`);if(c)return c;await q(`DELETE FROM tratamientos_dentales WHERE id=$1 AND tenant_id=$2::uuid`,[id,ctx.tenant_id]);return{ok:true,assistant_message:'Tratamiento eliminado.',client_event:{type:'medical_record_changed',record_id:r.expediente_id}};}
async function createInformedConsent(q,ctx,args={}){const branch=branchOf(ctx,args),recordId=Number(args.record_id),tt=text(args.treatment_type);if(!tt)throw new Error('Falta el tipo de tratamiento');const{rows}=await q(`INSERT INTO consentimientos_informados(expediente_id,appointment_id,tenant_id,tipo_tratamiento,descripcion_tratamiento,riesgos_beneficios,alternativas,costo_estimado,fecha_consentimiento,firma_paciente,firma_doctor,testigo_nombre,testigo_identificacion,doctor_id,sucursal_id) VALUES($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,[recordId,args.appointment_id||null,ctx.tenant_id,tt,text(args.treatment_description)||null,text(args.risks_benefits)||null,text(args.alternatives)||null,args.estimated_cost??null,text(args.date)||localDate(ctx.timezone),args.patient_signed===true,args.doctor_signed===true,text(args.witness_name)||null,text(args.witness_id)||null,args.doctor_id||null,branch]);return{ok:true,consent:rows[0],assistant_message:`Consentimiento de ${tt} creado.`,client_event:{type:'medical_record_changed',record_id:recordId}};}
async function updateConsentSignatures(q,ctx,args={}){const branch=branchOf(ctx,args),id=Number(args.consent_id);const{rows}=await q(`UPDATE consentimientos_informados SET firma_paciente=COALESCE($1,firma_paciente),firma_doctor=COALESCE($2,firma_doctor) WHERE id=$3 AND tenant_id=$4::uuid AND (sucursal_id=$5 OR sucursal_id IS NULL) RETURNING *`,[args.patient_signed===undefined?null:args.patient_signed,args.doctor_signed===undefined?null:args.doctor_signed,id,ctx.tenant_id,branch]);if(!rows[0])throw new Error('Consentimiento no encontrado');return{ok:true,consent:rows[0],assistant_message:'Firmas del consentimiento actualizadas.',client_event:{type:'medical_record_changed',record_id:rows[0].expediente_id}};}
async function getMedicalStatistics(q,ctx,args={}){const branch=branchOf(ctx,args);const s=(await q(`SELECT COUNT(DISTINCT e.id)::int total_expedientes,COUNT(DISTINCT h.id)::int total_historias,COUNT(DISTINCT t.id)::int total_tratamientos,COUNT(DISTINCT c.id)::int total_consentimientos,COUNT(DISTINCT d.id)::int total_documentos FROM expedientes_medicos e LEFT JOIN historia_clinica_dental h ON h.expediente_id=e.id AND h.tenant_id=e.tenant_id LEFT JOIN tratamientos_dentales t ON t.expediente_id=e.id AND t.tenant_id=e.tenant_id LEFT JOIN consentimientos_informados c ON c.expediente_id=e.id AND c.tenant_id=e.tenant_id LEFT JOIN documentos_radiografias d ON d.expediente_id=e.id AND d.tenant_id=e.tenant_id WHERE e.tenant_id=$1::uuid AND (e.sucursal_id=$2 OR e.sucursal_id IS NULL)`,[ctx.tenant_id,branch])).rows[0];const o=(await q(`SELECT estado,COUNT(*)::int cantidad FROM odontograma WHERE tenant_id=$1::uuid AND (sucursal_id=$2 OR sucursal_id IS NULL) GROUP BY estado ORDER BY cantidad DESC`,[ctx.tenant_id,branch])).rows;return{...s,odontogram:o,assistant_message:`Expedientes: ${s.total_expedientes}; historias: ${s.total_historias}; tratamientos: ${s.total_tratamientos}; consentimientos: ${s.total_consentimientos}; documentos: ${s.total_documentos}.`};}
async function listMedicalDocuments(q,ctx,args={}){const branch=branchOf(ctx,args),id=Number(args.record_id);const{rows}=await q(`SELECT id,tipo,nombre,descripcion,fecha_toma,doctor_id,created_at,CASE WHEN LENGTH(COALESCE(datos_base64,''))>100 THEN true ELSE false END tiene_datos,url FROM documentos_radiografias WHERE expediente_id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL) ORDER BY fecha_toma DESC,created_at DESC`,[id,ctx.tenant_id,branch]);return{documents:rows,assistant_message:`El expediente tiene ${rows.length} documento(s), fotografía(s) o radiografía(s).`};}

async function sendWhatsAppToPatient(q,ctx,args={}){const branch=branchOf(ctx,args),patient=text(args.patient),message=text(args.message);if(!patient||!message)throw new Error('Falta paciente o mensaje');const {rows}=await q(`SELECT patient AS name,phone,MAX(date) last_date FROM appointments WHERE tenant_id=$1::uuid AND (sucursal_id=$2 OR sucursal_id IS NULL) AND patient ILIKE $3 AND NULLIF(regexp_replace(COALESCE(phone,''),'\\D','','g'),'') IS NOT NULL GROUP BY patient,phone UNION ALL SELECT nombre_paciente AS name,telefono AS phone,NULL::date last_date FROM expedientes_medicos WHERE tenant_id=$1::uuid AND (sucursal_id=$2 OR sucursal_id IS NULL) AND nombre_paciente ILIKE $3 AND NULLIF(regexp_replace(COALESCE(telefono,''),'\\D','','g'),'') IS NOT NULL LIMIT 10`,[ctx.tenant_id,branch,`%${patient}%`]);const unique=[];for(const r of rows){if(!unique.some(x=>normalizePhoneForWhatsApp(x.phone)===normalizePhoneForWhatsApp(r.phone)))unique.push(r);}if(!unique.length)return{needs_input:true,missing:['phone'],assistant_message:`No encontré un teléfono registrado para ${patient}. Dime el número de WhatsApp.`};if(unique.length>1)return{ambiguous:true,matches:unique.map(x=>({name:x.name,phone:x.phone})),assistant_message:`Encontré más de un teléfono para ${patient}. Dime cuál deseas usar.`};return sendWhatsAppMessage(q,ctx,{phone:unique[0].phone,message});}


// ============================================================================
// PRODUCTIVIDAD / OBJETIVOS + FACTURACIÓN (F1 V4)
// Todo acceso se aísla por tenant_id + sucursal_id.
// ============================================================================

function branchOfF1(ctx,args={}) { return text(args.branch_key || ctx.branch_key) || 'sucursal_1'; }
function pctFraction(value) {
  if (value == null || value === '') return null;
  let n=Number(value); if(!Number.isFinite(n)) throw new Error('Porcentaje inválido');
  if(n>1) n=n/100;
  if(n<0 || n>1) throw new Error('El porcentaje debe estar entre 0 y 100%');
  return n;
}
async function ensureDoctorInTenant(q,ctx,doctorId,branch){
  const id=Number(doctorId); if(!Number.isFinite(id)) throw new Error('Doctor inválido');
  const {rows}=await q(`SELECT id,name,color FROM doctors WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL) LIMIT 1`,[id,ctx.tenant_id,branch]);
  if(!rows[0]) throw new Error('El doctor no pertenece a esta empresa/sucursal');
  return rows[0];
}

async function getProductivitySummary(q,ctx,args={}){
  const branch=branchOfF1(ctx,args), from=text(args.from), to=text(args.to);
  if(!from||!to) return {needs_input:true,missing:[!from?'from':null,!to?'to':null].filter(Boolean),assistant_message:'Dime el rango de fechas que quieres revisar.'};
  let doctor=null; if(args.doctor_id!=null) doctor=await ensureDoctorInTenant(q,ctx,args.doctor_id,branch);
  const docs=doctor?[doctor]:(await q(`SELECT id,name,color FROM doctors WHERE tenant_id=$1::uuid AND (sucursal_id=$2 OR sucursal_id IS NULL) ORDER BY name`,[ctx.tenant_id,branch])).rows;
  const params=[ctx.tenant_id,branch,from,to], doctorCond=args.doctor_id!=null?' AND doctor_id=$5':''; if(args.doctor_id!=null) params.push(Number(args.doctor_id));
  const pays=(await q(`SELECT doctor_id,payment_method,SUM(amount)::numeric total FROM payments WHERE tenant_id=$1::uuid AND (sucursal_id=$2 OR sucursal_id IS NULL) AND date >= $3::date AND date <= $4::date${doctorCond} GROUP BY doctor_id,payment_method`,params)).rows;
  const exps=(await q(`SELECT doctor_id,SUM(amount)::numeric total FROM expenses WHERE tenant_id=$1::uuid AND (sucursal_id=$2 OR sucursal_id IS NULL) AND date >= $3::date AND date <= $4::date${doctorCond} GROUP BY doctor_id`,params)).rows;
  const objs=(await q(`SELECT id,doctor_id,meta,sueldo_base,abonos,periodo_inicio,periodo_fin FROM objetivos WHERE tenant_id=$1::uuid AND (sucursal_id=$2 OR sucursal_id IS NULL) AND (periodo_fin IS NULL OR periodo_fin >= $3::date) AND (periodo_inicio IS NULL OR periodo_inicio <= $4::date)${doctorCond} ORDER BY created_at DESC`,params)).rows;
  const settings=(await q(`SELECT doctor_id,visible,comision_pct FROM objetivos_doctor_settings WHERE tenant_id=$1::uuid AND sucursal_id=$2`,[ctx.tenant_id,branch])).rows;
  const payMap=new Map(), expMap=new Map(), objMap=new Map(), setMap=new Map();
  for(const r of pays){const k=String(r.doctor_id);const x=payMap.get(k)||{cash:0,card:0,transfer:0,other:0,total:0};const amt=Number(r.total||0),m=normalizeStatus(r.payment_method);x.total+=amt;if(m.includes('efect')||m.includes('cash'))x.cash+=amt;else if(m.includes('tarj')||m.includes('card')||m.includes('credit')||m.includes('debit'))x.card+=amt;else if(m.includes('trans'))x.transfer+=amt;else x.other+=amt;payMap.set(k,x)}
  for(const r of exps)expMap.set(String(r.doctor_id),Number(r.total||0));
  for(const r of objs)if(!objMap.has(String(r.doctor_id)))objMap.set(String(r.doctor_id),r);
  for(const r of settings)setMap.set(String(r.doctor_id),r);
  const rows=docs.map(d=>{const k=String(d.id),p=payMap.get(k)||{cash:0,card:0,transfer:0,other:0,total:0},expense=expMap.get(k)||0,o=objMap.get(k)||null,st=setMap.get(k)||null,goal=Number(o?.meta||0),net=p.total-expense,progress=goal>0?(p.total/goal)*100:null,missing=goal>0?Math.max(0,goal-p.total):null,commissionPct=st?Number(st.comision_pct||0):null;return{doctor_id:d.id,doctor_name:d.name,income:p.total,income_cash:p.cash,income_card:p.card,income_transfer:p.transfer,income_other:p.other,expenses:expense,net,objective:o,goal,progress_pct:progress,missing_to_goal:missing,visible:st?.visible!==false,commission_pct:commissionPct,estimated_commission:commissionPct!=null?p.total*commissionPct:null}});
  const totals=rows.reduce((a,r)=>({income:a.income+r.income,expenses:a.expenses+r.expenses,net:a.net+r.net,goal:a.goal+r.goal}),{income:0,expenses:0,net:0,goal:0});
  if(args.include_details===true && args.doctor_id!=null){const detp=(await q(`SELECT id,appointment_id,patient,service_id,amount,payment_method,date,doctor_id FROM payments WHERE tenant_id=$1::uuid AND (sucursal_id=$2 OR sucursal_id IS NULL) AND doctor_id=$3 AND date BETWEEN $4::date AND $5::date ORDER BY date,id`,[ctx.tenant_id,branch,Number(args.doctor_id),from,to])).rows;const dete=(await q(`SELECT id,concept,amount,date,doctor_id,payment_method FROM expenses WHERE tenant_id=$1::uuid AND (sucursal_id=$2 OR sucursal_id IS NULL) AND doctor_id=$3 AND date BETWEEN $4::date AND $5::date ORDER BY date,id`,[ctx.tenant_id,branch,Number(args.doctor_id),from,to])).rows;return{from,to,rows,totals,payments:detp,expenses:dete,assistant_message:`Productividad de ${doctor.name}: ingresos $${rows[0]?.income||0}, gastos $${rows[0]?.expenses||0}, neto $${rows[0]?.net||0}.`};}
  return{from,to,rows,totals,assistant_message:`Del ${from} al ${to}: ingresos $${totals.income.toFixed(2)}, gastos $${totals.expenses.toFixed(2)}, neto $${totals.net.toFixed(2)}.`};
}

async function listObjectivesF1(q,ctx,args={}){const branch=branchOfF1(ctx,args),params=[ctx.tenant_id,branch],conds=['o.tenant_id=$1::uuid','(o.sucursal_id=$2 OR o.sucursal_id IS NULL)'];if(args.from){params.push(text(args.from));conds.push(`(o.periodo_fin IS NULL OR o.periodo_fin >= $${params.length}::date)`)}if(args.to){params.push(text(args.to));conds.push(`(o.periodo_inicio IS NULL OR o.periodo_inicio <= $${params.length}::date)`)}if(args.doctor_id!=null){await ensureDoctorInTenant(q,ctx,args.doctor_id,branch);params.push(Number(args.doctor_id));conds.push(`o.doctor_id=$${params.length}`)}const{rows}=await q(`SELECT o.id,o.doctor_id,d.name doctor_name,o.meta,o.sueldo_base,o.abonos,o.periodo_inicio,o.periodo_fin,o.created_at FROM objetivos o LEFT JOIN doctors d ON d.id=o.doctor_id AND d.tenant_id=o.tenant_id WHERE ${conds.join(' AND ')} ORDER BY COALESCE(o.periodo_inicio,o.created_at) DESC,o.id DESC`,params);return{objectives:rows,assistant_message:`Encontré ${rows.length} objetivo(s).`};}
async function createObjectiveF1(q,ctx,args={}){const branch=branchOfF1(ctx,args);if(args.doctor_id==null||args.meta==null)return{needs_input:true,missing:[args.doctor_id==null?'doctor_id':null,args.meta==null?'meta':null].filter(Boolean),assistant_message:'Necesito el doctor y el monto de la meta.'};const d=await ensureDoctorInTenant(q,ctx,args.doctor_id,branch),start=text(args.period_start)||null,end=text(args.period_end)||null;const ex=(await q(`SELECT id FROM objetivos WHERE tenant_id=$1::uuid AND sucursal_id=$2 AND doctor_id=$3 AND periodo_inicio IS NOT DISTINCT FROM $4::date AND periodo_fin IS NOT DISTINCT FROM $5::date LIMIT 1`,[ctx.tenant_id,branch,Number(args.doctor_id),start,end])).rows[0];if(ex)return{ok:false,conflict:true,objective_id:ex.id,assistant_message:`Ya existe una meta para ${d.name} en ese período.`};const{rows}=await q(`INSERT INTO objetivos(doctor_id,meta,sueldo_base,abonos,periodo_inicio,periodo_fin,sucursal_id,tenant_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8::uuid) RETURNING *`,[Number(args.doctor_id),Number(args.meta),Number(args.base_salary||0),Number(args.abonos||0),start,end,branch,ctx.tenant_id]);return{ok:true,objective:rows[0],assistant_message:`Meta de ${d.name} creada por $${Number(args.meta).toFixed(2)}.`,client_event:{type:'productivity_changed'}};}
async function updateObjectiveF1(q,ctx,args={}){const branch=branchOfF1(ctx,args),id=Number(args.objective_id);const cur=(await q(`SELECT o.*,d.name doctor_name FROM objetivos o LEFT JOIN doctors d ON d.id=o.doctor_id WHERE o.id=$1 AND o.tenant_id=$2::uuid AND (o.sucursal_id=$3 OR o.sucursal_id IS NULL)`,[id,ctx.tenant_id,branch])).rows[0];if(!cur)throw new Error('Objetivo no encontrado');if(args.doctor_id!=null)await ensureDoctorInTenant(q,ctx,args.doctor_id,branch);const f={doctor_id:args.doctor_id!=null?Number(args.doctor_id):undefined,meta:args.meta,sueldo_base:args.base_salary,abonos:args.abonos,periodo_inicio:args.period_start,periodo_fin:args.period_end},sets=[],vals=[];for(const[k,v]of Object.entries(f)){if(v!==undefined){vals.push(v);sets.push(`${k}=$${vals.length}`)}}if(!sets.length)return{needs_input:true,assistant_message:'Dime qué dato de la meta quieres cambiar.'};vals.push(id,ctx.tenant_id,branch);const{rows}=await q(`UPDATE objetivos SET ${sets.join(',')} WHERE id=$${vals.length-2} AND tenant_id=$${vals.length-1}::uuid AND (sucursal_id=$${vals.length} OR sucursal_id IS NULL) RETURNING *`,vals);return{ok:true,objective:rows[0],assistant_message:'Objetivo actualizado.',client_event:{type:'productivity_changed'}};}
async function deleteObjectiveF1(q,ctx,args={}){const branch=branchOfF1(ctx,args),id=Number(args.objective_id),cur=(await q(`SELECT o.id,o.meta,d.name doctor_name FROM objetivos o LEFT JOIN doctors d ON d.id=o.doctor_id WHERE o.id=$1 AND o.tenant_id=$2::uuid AND (o.sucursal_id=$3 OR o.sucursal_id IS NULL)`,[id,ctx.tenant_id,branch])).rows[0];if(!cur)throw new Error('Objetivo no encontrado');const c=requireConfirm(args,`¿Confirmas eliminar la meta de ${cur.doctor_name||'este doctor'} por $${Number(cur.meta||0).toFixed(2)}?`);if(c)return c;await q(`DELETE FROM objetivos WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[id,ctx.tenant_id,branch]);return{ok:true,assistant_message:'Objetivo eliminado.',client_event:{type:'productivity_changed'}};}
async function getDoctorProductivitySettings(q,ctx,args={}){const branch=branchOfF1(ctx,args);if(args.doctor_id!=null)await ensureDoctorInTenant(q,ctx,args.doctor_id,branch);const params=[ctx.tenant_id,branch],cond=args.doctor_id!=null?' AND d.id=$3':'';if(args.doctor_id!=null)params.push(Number(args.doctor_id));const{rows}=await q(`SELECT d.id doctor_id,d.name doctor_name,COALESCE(s.visible,true) visible,COALESCE(s.comision_pct,0.20)::numeric comision_pct FROM doctors d LEFT JOIN objetivos_doctor_settings s ON s.doctor_id=d.id AND s.tenant_id=d.tenant_id AND s.sucursal_id=$2 WHERE d.tenant_id=$1::uuid AND (d.sucursal_id=$2 OR d.sucursal_id IS NULL)${cond} ORDER BY d.name`,params);return{settings:rows,assistant_message:`Configuración de productividad de ${rows.length} doctor(es).`};}
async function updateDoctorProductivitySettings(q,ctx,args={}){const branch=branchOfF1(ctx,args),d=await ensureDoctorInTenant(q,ctx,args.doctor_id,branch);let pct=args.commission_pct!==undefined?pctFraction(args.commission_pct):null;const existing=(await q(`SELECT visible,comision_pct FROM objetivos_doctor_settings WHERE tenant_id=$1::uuid AND sucursal_id=$2 AND doctor_id=$3`,[ctx.tenant_id,branch,Number(args.doctor_id)])).rows[0];const visible=args.visible!==undefined?Boolean(args.visible):(existing?.visible??true);if(pct==null)pct=Number(existing?.comision_pct??0.20);const{rows}=await q(`INSERT INTO objetivos_doctor_settings(tenant_id,sucursal_id,doctor_id,visible,comision_pct) VALUES($1::uuid,$2,$3,$4,$5) ON CONFLICT(tenant_id,sucursal_id,doctor_id) DO UPDATE SET visible=EXCLUDED.visible,comision_pct=EXCLUDED.comision_pct,updated_at=NOW() RETURNING doctor_id,visible,comision_pct`,[ctx.tenant_id,branch,Number(args.doctor_id),visible,pct]);return{ok:true,setting:{...rows[0],doctor_name:d.name},assistant_message:`Configuración de ${d.name} actualizada: comisión ${(pct*100).toFixed(1)}%.`,client_event:{type:'productivity_changed'}};}

async function getBillingConfigF1(q,ctx,args={}){const branch=branchOfF1(ctx,args);const{rows}=await q(`SELECT rfc,razon_social,regimen_fiscal,codigo_postal,pac_proveedor,serie_facturas,ultimo_folio,ambiente,activo,logo_url,cer_file IS NOT NULL tiene_cer,key_file IS NOT NULL tiene_key,COALESCE(key_password,'')<>'' tiene_password FROM facturacion_configuracion WHERE tenant_id=$1::uuid AND sucursal_id=$2 LIMIT 1`,[ctx.tenant_id,branch]);const cfg=rows[0]||{rfc:'',razon_social:'',regimen_fiscal:'',codigo_postal:'',pac_proveedor:'facturama',serie_facturas:'',ultimo_folio:1,ambiente:'pruebas',activo:false,tiene_cer:false,tiene_key:false,tiene_password:false};return{config:cfg,certificates_ready:Boolean(cfg.tiene_cer&&cfg.tiene_key&&cfg.tiene_password),assistant_message:cfg.rfc?`Configuración fiscal: ${cfg.razon_social||''}, RFC ${cfg.rfc}, régimen ${cfg.regimen_fiscal||'sin configurar'}.`:'La configuración fiscal todavía no tiene RFC registrado.'};}
async function updateBillingConfigF1(q,ctx,args={}){const branch=branchOfF1(ctx,args),current=(await getBillingConfigF1(q,ctx,{branch_key:branch})).config;const rfc=text(args.rfc)||current.rfc,bn=text(args.business_name)||current.razon_social,tr=text(args.tax_regime)||current.regimen_fiscal,pc=text(args.postal_code)||current.codigo_postal;if(!rfc||!bn||!tr||!pc)return{needs_input:true,missing:[!rfc?'rfc':null,!bn?'business_name':null,!tr?'tax_regime':null,!pc?'postal_code':null].filter(Boolean),assistant_message:'Para guardar la configuración fiscal necesito RFC, razón social, régimen fiscal y código postal.'};const{rows}=await q(`INSERT INTO facturacion_configuracion(tenant_id,sucursal_id,rfc,razon_social,regimen_fiscal,codigo_postal,pac_proveedor,serie_facturas,ultimo_folio,ambiente,activo,updated_at) VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()) ON CONFLICT(tenant_id,sucursal_id) DO UPDATE SET rfc=EXCLUDED.rfc,razon_social=EXCLUDED.razon_social,regimen_fiscal=EXCLUDED.regimen_fiscal,codigo_postal=EXCLUDED.codigo_postal,pac_proveedor=EXCLUDED.pac_proveedor,serie_facturas=EXCLUDED.serie_facturas,ambiente=EXCLUDED.ambiente,activo=EXCLUDED.activo,updated_at=NOW() RETURNING rfc,razon_social,regimen_fiscal,codigo_postal,pac_proveedor,serie_facturas,ultimo_folio,ambiente,activo`,[ctx.tenant_id,branch,rfc.toUpperCase(),bn,tr,pc,text(args.pac_provider)||current.pac_proveedor||'facturama',args.invoice_series!==undefined?text(args.invoice_series):(current.serie_facturas||''),Number(current.ultimo_folio||1),args.environment||current.ambiente||'pruebas',args.active!==undefined?Boolean(args.active):(current.activo!==false)]);return{ok:true,config:rows[0],assistant_message:'Configuración fiscal actualizada.',client_event:{type:'billing_changed'}};}
async function listTaxClientsF1(q,ctx,args={}){const branch=branchOfF1(ctx,args),query=text(args.query),limit=Math.min(Math.max(Number(args.limit||50),1),100),params=[ctx.tenant_id,branch],cond=query?' AND (rfc ILIKE $3 OR razon_social ILIKE $3 OR COALESCE(email,\'\') ILIKE $3 OR COALESCE(telefono,\'\') ILIKE $3)':'';if(query)params.push(`%${query}%`);params.push(limit);const{rows}=await q(`SELECT id,rfc,razon_social,email,telefono,direccion,uso_cfdi,codigo_postal,regimen_fiscal,created_at FROM facturacion_clientes WHERE tenant_id=$1::uuid AND (sucursal_id=$2 OR sucursal_id IS NULL)${cond} ORDER BY created_at DESC LIMIT $${params.length}`,params);return{clients:rows,assistant_message:`Encontré ${rows.length} cliente(s) fiscal(es).`};}
async function createTaxClientF1(q,ctx,args={}){const branch=branchOfF1(ctx,args),rfc=text(args.rfc).toUpperCase(),bn=text(args.business_name);if(!rfc||!bn)return{needs_input:true,missing:[!rfc?'rfc':null,!bn?'business_name':null].filter(Boolean),assistant_message:'Necesito RFC y razón social para crear el cliente fiscal.'};const dupe=(await q(`SELECT id,razon_social FROM facturacion_clientes WHERE tenant_id=$1::uuid AND sucursal_id=$2 AND UPPER(rfc)=UPPER($3) LIMIT 1`,[ctx.tenant_id,branch,rfc])).rows[0];if(dupe)return{ok:false,conflict:true,client:dupe,assistant_message:`Ese RFC ya está registrado como ${dupe.razon_social}.`};const{rows}=await q(`INSERT INTO facturacion_clientes(rfc,razon_social,email,telefono,direccion,uso_cfdi,codigo_postal,regimen_fiscal,sucursal_id,tenant_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid) RETURNING *`,[rfc,bn,text(args.email)||null,text(args.phone)||null,text(args.address)||null,text(args.cfdi_use)||null,text(args.postal_code)||null,text(args.tax_regime)||null,branch,ctx.tenant_id]);return{ok:true,client:rows[0],assistant_message:`Cliente fiscal ${bn} creado.`,client_event:{type:'billing_changed'}};}
async function updateTaxClientF1(q,ctx,args={}){const branch=branchOfF1(ctx,args),id=String(args.client_id),f={rfc:args.rfc?text(args.rfc).toUpperCase():undefined,razon_social:args.business_name,email:args.email,telefono:args.phone,direccion:args.address,uso_cfdi:args.cfdi_use,codigo_postal:args.postal_code,regimen_fiscal:args.tax_regime},sets=[],vals=[];for(const[k,v]of Object.entries(f)){if(v!==undefined){vals.push(v);sets.push(`${k}=$${vals.length}`)}}if(!sets.length)return{needs_input:true,assistant_message:'Dime qué dato fiscal quieres modificar.'};vals.push(id,ctx.tenant_id,branch);const{rows}=await q(`UPDATE facturacion_clientes SET ${sets.join(',')} WHERE id=$${vals.length-2} AND tenant_id=$${vals.length-1}::uuid AND (sucursal_id=$${vals.length} OR sucursal_id IS NULL) RETURNING *`,vals);if(!rows[0])throw new Error('Cliente fiscal no encontrado');return{ok:true,client:rows[0],assistant_message:'Cliente fiscal actualizado.',client_event:{type:'billing_changed'}};}
async function listTaxProductsF1(q,ctx,args={}){const branch=branchOfF1(ctx,args),query=text(args.query),limit=Math.min(Math.max(Number(args.limit||50),1),100),params=[ctx.tenant_id,branch],cond=query?' AND (COALESCE(nombre,\'\') ILIKE $3 OR descripcion ILIKE $3 OR COALESCE(codigo_interno,\'\') ILIKE $3 OR COALESCE(clave_prod_serv,\'\') ILIKE $3)':'';if(query)params.push(`%${query}%`);params.push(limit);const{rows}=await q(`SELECT id,nombre,codigo_interno,descripcion,clave_prod_serv,unidad,objeto_imp,precio,created_at FROM facturacion_productos WHERE tenant_id=$1::uuid AND (sucursal_id=$2 OR sucursal_id IS NULL)${cond} ORDER BY created_at DESC LIMIT $${params.length}`,params);return{products:rows,assistant_message:`Encontré ${rows.length} producto(s)/servicio(s) fiscal(es).`};}
async function createTaxProductF1(q,ctx,args={}){const branch=branchOfF1(ctx,args),name=text(args.name||args.description);if(!name)return{needs_input:true,missing:['name'],assistant_message:'Dime el nombre o descripción del producto fiscal.'};const{rows}=await q(`INSERT INTO facturacion_productos(nombre,codigo_interno,descripcion,clave_prod_serv,unidad,objeto_imp,precio,sucursal_id,tenant_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid) RETURNING *`,[name,text(args.internal_code)||null,text(args.description)||name,text(args.sat_product_key)||null,text(args.unit_key)||null,text(args.tax_object)||null,Number(args.price||0),branch,ctx.tenant_id]);return{ok:true,product:rows[0],assistant_message:`Producto fiscal ${name} creado.`,client_event:{type:'billing_changed'}};}
async function updateTaxProductF1(q,ctx,args={}){const branch=branchOfF1(ctx,args),id=String(args.product_id),f={nombre:args.name,codigo_interno:args.internal_code,descripcion:args.description,clave_prod_serv:args.sat_product_key,unidad:args.unit_key,objeto_imp:args.tax_object,precio:args.price},sets=[],vals=[];for(const[k,v]of Object.entries(f)){if(v!==undefined){vals.push(v);sets.push(`${k}=$${vals.length}`)}}if(!sets.length)return{needs_input:true,assistant_message:'Dime qué dato del producto fiscal quieres cambiar.'};vals.push(id,ctx.tenant_id,branch);const{rows}=await q(`UPDATE facturacion_productos SET ${sets.join(',')} WHERE id=$${vals.length-2} AND tenant_id=$${vals.length-1}::uuid AND (sucursal_id=$${vals.length} OR sucursal_id IS NULL) RETURNING *`,vals);if(!rows[0])throw new Error('Producto fiscal no encontrado');return{ok:true,product:rows[0],assistant_message:'Producto fiscal actualizado.',client_event:{type:'billing_changed'}};}
async function deleteTaxProductF1(q,ctx,args={}){const branch=branchOfF1(ctx,args),id=String(args.product_id),r=(await q(`SELECT id,COALESCE(nombre,descripcion) nombre FROM facturacion_productos WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[id,ctx.tenant_id,branch])).rows[0];if(!r)throw new Error('Producto fiscal no encontrado');const c=requireConfirm(args,`¿Confirmas eliminar ${r.nombre} del catálogo fiscal?`);if(c)return c;await q(`DELETE FROM facturacion_productos WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[id,ctx.tenant_id,branch]);return{ok:true,assistant_message:'Producto fiscal eliminado.',client_event:{type:'billing_changed'}};}
async function listInvoicesF1(q,ctx,args={}){const branch=branchOfF1(ctx,args),params=[ctx.tenant_id,branch],conds=['tenant_id=$1::uuid','(sucursal_id=$2 OR sucursal_id IS NULL)'];if(args.from){params.push(text(args.from));conds.push(`created_at::date >= $${params.length}::date`)}if(args.to){params.push(text(args.to));conds.push(`created_at::date <= $${params.length}::date`)}if(args.status){let st=normalizeStatus(args.status);if(st==='timbradas')st='timbrada';else if(st==='canceladas')st='cancelada';else if(st==='borradores')st='borrador';else if(st==='todas')st='';if(st){params.push(st);conds.push(`LOWER(COALESCE(estado,''))=$${params.length}`)}}if(args.query){params.push(`%${text(args.query)}%`);conds.push(`(cliente ILIKE $${params.length} OR COALESCE(uuid,'') ILIKE $${params.length} OR COALESCE(folio::text,'') ILIKE $${params.length})`)}params.push(Math.min(Math.max(Number(args.limit||50),1),100));const{rows}=await q(`SELECT id,cliente,tipo,forma_pago,metodo_pago,cita_id,notas,total,created_at,estado,uuid,serie,folio,fecha_timbrado FROM facturas WHERE ${conds.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length}`,params);return{invoices:rows,assistant_message:`Encontré ${rows.length} factura(s).`};}
async function getInvoiceF1(q,ctx,args={}){const branch=branchOfF1(ctx,args),id=String(args.invoice_id),f=(await q(`SELECT * FROM facturas WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL) LIMIT 1`,[id,ctx.tenant_id,branch])).rows[0];if(!f)throw new Error('Factura no encontrada');const c=(await q(`SELECT id,descripcion,cantidad,valor_unitario,importe,clave_prod_serv,unidad,objeto_imp FROM factura_conceptos WHERE factura_id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL) ORDER BY id`,[id,ctx.tenant_id,branch])).rows;return{invoice:{...f,concepts:c},assistant_message:`Factura de ${f.cliente} por $${Number(f.total||0).toFixed(2)}; estado ${f.estado||'borrador'}.`};}
function normalizeInvoiceConcepts(concepts){return(Array.isArray(concepts)?concepts:[]).map(c=>{const q=Math.max(Number(c.quantity||1),0),uv=Number(c.unit_value||0),amt=c.amount!=null?Number(c.amount):q*uv;return{description:text(c.description)||'Concepto',quantity:q,unit_value:uv,amount:amt,sat_product_key:text(c.sat_product_key)||null,unit_key:text(c.unit_key)||null,tax_object:text(c.tax_object)||null}})}
async function createInvoiceF1(q,ctx,args={}){const branch=branchOfF1(ctx,args),client=text(args.client),type=text(args.type);if(!client||!type)return{needs_input:true,missing:[!client?'client':null,!type?'type':null].filter(Boolean),assistant_message:'Necesito cliente y tipo de factura.'};if(args.appointment_id){const ap=(await q(`SELECT id,patient,status FROM appointments WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[Number(args.appointment_id),ctx.tenant_id,branch])).rows[0];if(!ap)return{ok:false,assistant_message:'La cita indicada no pertenece a esta empresa/sucursal.'}}const concepts=normalizeInvoiceConcepts(args.concepts),calc=concepts.reduce((a,c)=>a+c.amount,0),total=args.total!=null?Number(args.total):calc;if(!concepts.length && !(total>0))return{needs_input:true,missing:['concepts_or_total'],assistant_message:'Necesito al menos un concepto o el total de la factura.'};const{rows}=await q(`INSERT INTO facturas(cliente,tipo,forma_pago,metodo_pago,cita_id,notas,total,sucursal_id,tenant_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid) RETURNING *`,[client,type,text(args.payment_form)||null,text(args.payment_method)||null,args.appointment_id||null,text(args.notes)||null,total,branch,ctx.tenant_id]);const f=rows[0];for(const c of concepts)await q(`INSERT INTO factura_conceptos(factura_id,descripcion,cantidad,valor_unitario,importe,clave_prod_serv,unidad,objeto_imp,sucursal_id,tenant_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid)`,[f.id,c.description,c.quantity,c.unit_value,c.amount,c.sat_product_key,c.unit_key,c.tax_object,branch,ctx.tenant_id]);return{ok:true,invoice:{...f,concepts},assistant_message:`Factura creada para ${client} por $${total.toFixed(2)}.`,client_event:{type:'billing_changed'}};}
async function updateInvoiceF1(q,ctx,args={}){const branch=branchOfF1(ctx,args),id=String(args.invoice_id),current=(await getInvoiceF1(q,ctx,{invoice_id:id,branch_key:branch})).invoice;if(['timbrada','cancelada'].includes(normalizeStatus(current.estado)) && !args.confirmed)return{ok:false,blocked:true,assistant_message:`La factura está ${current.estado}; no modificaré sus datos fiscales directamente.`};if(args.appointment_id){const ap=(await q(`SELECT id FROM appointments WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[Number(args.appointment_id),ctx.tenant_id,branch])).rows[0];if(!ap)throw new Error('La cita no pertenece a esta empresa/sucursal')}const f={cliente:args.client,tipo:args.type,forma_pago:args.payment_form,metodo_pago:args.payment_method,cita_id:args.appointment_id,notas:args.notes,total:args.total},sets=[],vals=[];for(const[k,v]of Object.entries(f)){if(v!==undefined){vals.push(v);sets.push(`${k}=$${vals.length}`)}}let out=current;if(sets.length){vals.push(id,ctx.tenant_id,branch);out=(await q(`UPDATE facturas SET ${sets.join(',')} WHERE id=$${vals.length-2} AND tenant_id=$${vals.length-1}::uuid AND (sucursal_id=$${vals.length} OR sucursal_id IS NULL) RETURNING *`,vals)).rows[0]}if(Array.isArray(args.concepts)){const concepts=normalizeInvoiceConcepts(args.concepts);await q(`DELETE FROM factura_conceptos WHERE factura_id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[id,ctx.tenant_id,branch]);for(const c of concepts)await q(`INSERT INTO factura_conceptos(factura_id,descripcion,cantidad,valor_unitario,importe,clave_prod_serv,unidad,objeto_imp,sucursal_id,tenant_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid)`,[id,c.description,c.quantity,c.unit_value,c.amount,c.sat_product_key,c.unit_key,c.tax_object,branch,ctx.tenant_id]);if(args.total===undefined){const total=concepts.reduce((a,c)=>a+c.amount,0);out=(await q(`UPDATE facturas SET total=$1 WHERE id=$2 AND tenant_id=$3::uuid RETURNING *`,[total,id,ctx.tenant_id])).rows[0]}}return{ok:true,invoice:out,assistant_message:'Factura actualizada.',client_event:{type:'billing_changed'}};}
async function deleteInvoiceF1(q,ctx,args={}){const branch=branchOfF1(ctx,args),id=String(args.invoice_id),f=(await getInvoiceF1(q,ctx,{invoice_id:id,branch_key:branch})).invoice;const c=requireConfirm(args,`¿Confirmas eliminar definitivamente la factura de ${f.cliente} por $${Number(f.total||0).toFixed(2)}?`);if(c)return c;if(normalizeStatus(f.estado)==='timbrada')return{ok:false,blocked:true,assistant_message:'Una factura timbrada no debe eliminarse. Debe cancelarse fiscalmente.'};await q(`DELETE FROM factura_conceptos WHERE factura_id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[id,ctx.tenant_id,branch]);await q(`DELETE FROM facturas WHERE id=$1 AND tenant_id=$2::uuid AND (sucursal_id=$3 OR sucursal_id IS NULL)`,[id,ctx.tenant_id,branch]);return{ok:true,assistant_message:'Factura eliminada.',client_event:{type:'billing_changed'}};}
async function cancelInvoiceF1(q,ctx,args={}){const branch=branchOfF1(ctx,args),id=String(args.invoice_id),f=(await getInvoiceF1(q,ctx,{invoice_id:id,branch_key:branch})).invoice;const c=requireConfirm(args,`¿Confirmas cancelar la factura de ${f.cliente}${f.folio?` folio ${f.folio}`:''}?`);if(c)return c;if(normalizeStatus(f.estado)==='cancelada')return{ok:true,invoice:f,assistant_message:'La factura ya estaba cancelada.'};const{rows}=await q(`UPDATE facturas SET estado='cancelada',status=COALESCE(status,'Cancelada'),cancelada_at=NOW(),motivo_cancelacion=COALESCE($1,motivo_cancelacion) WHERE id=$2 AND tenant_id=$3::uuid AND (sucursal_id=$4 OR sucursal_id IS NULL) RETURNING *`,[text(args.reason)||null,id,ctx.tenant_id,branch]);return{ok:true,invoice:rows[0],assistant_message:'Factura marcada como cancelada en CliniqOne. Si estaba timbrada, verifica también la confirmación fiscal del PAC.',client_event:{type:'billing_changed'}};}
async function stampInvoiceF1(q,ctx,args={}){const branch=branchOfF1(ctx,args),id=String(args.invoice_id),f=(await getInvoiceF1(q,ctx,{invoice_id:id,branch_key:branch})).invoice;const c=requireConfirm(args,`¿Confirmas timbrar fiscalmente la factura de ${f.cliente} por $${Number(f.total||0).toFixed(2)}?`);if(c)return c;if(normalizeStatus(f.estado)==='timbrada'&&f.uuid)return{ok:true,invoice:f,assistant_message:`La factura ya está timbrada con UUID ${f.uuid}.`};const cfg=await getBillingConfigF1(q,ctx,{branch_key:branch});if(!cfg.config.rfc||!cfg.config.razon_social||!cfg.config.regimen_fiscal||!cfg.config.codigo_postal)return{ok:false,blocked:true,assistant_message:'Faltan datos fiscales del emisor. Completa RFC, razón social, régimen y código postal antes de timbrar.'};const base=text(process.env.F1_INTERNAL_API_BASE||process.env.RENDER_EXTERNAL_URL||process.env.PUBLIC_BASE_URL).replace(/\/$/,'');if(!base||!ctx.authorization)return{ok:false,blocked:true,assistant_message:'El timbrado requiere el conector PAC del backend y una sesión autenticada. No marcaré la factura como timbrada sin respuesta real del PAC.'};let lastErr='';for(const path of ['/api/facturama/timbrar','/facturama/timbrar']){try{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','Authorization':ctx.authorization,'x-sucursal':branch},body:JSON.stringify({factura_id:id,sucursal_id:branch})});const raw=await r.text();let data={};try{data=raw?JSON.parse(raw):{}}catch{data={raw}}if(!r.ok){lastErr=data?.error||data?.message||`HTTP ${r.status}`;continue}const uuid=data?.uuid||data?.Uuid||data?.cfdi_uuid||data?.data?.uuid||data?.factura?.uuid;const cfdiId=data?.cfdi_id||data?.id||data?.facturama?.Id||data?.data?.id;if(!uuid&&!cfdiId&&!data?.ok){lastErr='El PAC no devolvió confirmación verificable';continue}const updated=(await q(`UPDATE facturas SET estado='timbrada',uuid=COALESCE($1,uuid),cfdi_id=COALESCE($2,cfdi_id),fecha_timbrado=COALESCE(fecha_timbrado,NOW()) WHERE id=$3 AND tenant_id=$4::uuid AND (sucursal_id=$5 OR sucursal_id IS NULL) RETURNING *`,[uuid||null,cfdiId||null,id,ctx.tenant_id,branch])).rows[0];return{ok:true,invoice:updated,pac_response:data,assistant_message:uuid?`Factura timbrada correctamente. UUID ${uuid}.`:'Factura timbrada correctamente por el PAC.',client_event:{type:'billing_changed'}}}catch(e){lastErr=e.message}}return{ok:false,pac_error:lastErr,assistant_message:`No pude confirmar el timbrado con el PAC${lastErr?`: ${lastErr}`:''}. La factura no se reportará como timbrada.`};}
async function getInvoiceDownloadLinksF1(q,ctx,args={}){const branch=branchOfF1(ctx,args),f=(await getInvoiceF1(q,ctx,args)).invoice,ref=f.cfdi_id||f.uuid||f.id;if(!ref)return{ok:false,assistant_message:'La factura no tiene identificador fiscal disponible para descarga.'};const enc=encodeURIComponent(String(ref)),qs=`?sucursal=${encodeURIComponent(branch)}`;return{ok:true,invoice_id:f.id,reference:ref,links:{pdf:`/api/facturama/${enc}/pdf${qs}`,xml:`/api/facturama/${enc}/xml${qs}`,zip:`/api/facturama/${enc}/zip${qs}`},assistant_message:'Preparé las rutas de descarga de PDF, XML y ZIP.'};}


const handlers = {
  get_productivity_summary: getProductivitySummary,
  list_objectives: listObjectivesF1,
  create_objective: createObjectiveF1,
  update_objective: updateObjectiveF1,
  delete_objective: deleteObjectiveF1,
  get_doctor_productivity_settings: getDoctorProductivitySettings,
  update_doctor_productivity_settings: updateDoctorProductivitySettings,
  get_billing_config: getBillingConfigF1,
  update_billing_config: updateBillingConfigF1,
  list_tax_clients: listTaxClientsF1,
  create_tax_client: createTaxClientF1,
  update_tax_client: updateTaxClientF1,
  list_tax_products: listTaxProductsF1,
  create_tax_product: createTaxProductF1,
  update_tax_product: updateTaxProductF1,
  delete_tax_product: deleteTaxProductF1,
  list_invoices: listInvoicesF1,
  get_invoice: getInvoiceF1,
  create_invoice: createInvoiceF1,
  update_invoice: updateInvoiceF1,
  delete_invoice: deleteInvoiceF1,
  cancel_invoice: cancelInvoiceF1,
  stamp_invoice: stampInvoiceF1,
  get_invoice_download_links: getInvoiceDownloadLinksF1,

  get_inventory_alerts: getInventoryAlerts,
  get_inventory_item: getInventoryItem,
  create_inventory_item: createInventoryItem,
  update_inventory_item: updateInventoryItem,
  adjust_inventory_stock: adjustInventoryStock,
  delete_inventory_item: deleteInventoryItem,
  create_doctor: createDoctor,
  update_doctor: updateDoctor,
  delete_doctor: deleteDoctor,
  create_service: createService,
  update_service: updateService,
  delete_service: deleteService,
  update_appointment: updateAppointmentFull,
  delete_appointment: deleteAppointmentFull,
  list_expenses: listExpenses,
  update_payment: updatePayment,
  delete_payment: deletePayment,
  update_expense: updateExpense,
  delete_expense: deleteExpense,
  update_laboratory: updateLaboratory,
  delete_laboratory: deleteLaboratory,
  update_lab_work: updateLabWork,
  delete_lab_work: deleteLabWork,
  list_lab_payments: listLabPayments,
  get_medical_record: getMedicalRecord,
  create_medical_record: createMedicalRecord,
  update_medical_record: updateMedicalRecord,
  upsert_clinical_history: upsertClinicalHistory,
  upsert_odontogram_tooth: upsertOdontogramTooth,
  add_dental_treatment: addDentalTreatment,
  update_dental_treatment: updateDentalTreatment,
  delete_dental_treatment: deleteDentalTreatment,
  create_informed_consent: createInformedConsent,
  update_consent_signatures: updateConsentSignatures,
  get_medical_statistics: getMedicalStatistics,
  list_medical_documents: listMedicalDocuments,
  send_whatsapp_to_patient: sendWhatsAppToPatient,
  open_module: openModule,
  get_operations_report: operationsReport,
  get_income_summary: getIncomeSummary,
  get_expense_summary: getExpenseSummary,
  get_daily_net: getDailyNet,
  list_recent_payments: listRecentPayments,
  register_payment: registerPayment,
  register_expense: registerExpense,
  get_today_summary: todaySummary,
  list_doctors: listDoctors,
  list_services: listServices,
  check_availability: checkAvailability,
  create_appointment: createAppointment,
  find_appointments: findAppointments,
  cancel_appointment: cancelAppointment,
  reschedule_appointment: rescheduleAppointment,
  update_appointment_status: updateAppointmentStatus,
  get_patient_history: getPatientHistory,
  get_patient_last_visit: getPatientLastVisit,
  list_laboratories: listLaboratories,
  create_laboratory: createLaboratory,
  list_lab_works: listLabWorks,
  create_lab_work: createLabWork,
  update_lab_work_stage: updateLabWorkStage,
  register_lab_payment: registerLabPayment,
  list_inventory: listInventory,
  update_inventory_stock: updateInventoryStock,
  send_whatsapp_message: sendWhatsAppMessage,
};

async function executeTool(q, ctx, name, args) {
  const handler = handlers[name];
  if (!handler) throw new Error(`Herramienta F1 no permitida: ${name}`);
  return handler(q, ctx, args || {});
}

module.exports = { executeTool, handlers, localDate };

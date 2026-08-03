'use strict';

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function localDate(timeZone = process.env.TZ || 'America/Tijuana', offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const noonUtc = new Date(Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day) + offsetDays, 12));
  return noonUtc.toISOString().slice(0, 10);
}

function money(value) {
  return Number(value || 0);
}

async function safeQuery(q, sql, params = [], fallback = []) {
  try {
    const result = await q(sql, params);
    return result.rows || fallback;
  } catch (error) {
    console.warn('⚠️ F1 Operations query omitida:', error.message);
    return fallback;
  }
}

function addAlert(alerts, priority, area, title, message, action = null) {
  alerts.push({
    id: `${area}-${priority}-${alerts.length + 1}`,
    priority,
    area,
    title,
    message,
    action,
  });
}

async function buildOperationsReport(q, ctx, args = {}) {
  const tenantId = ctx.tenant_id;
  const branch = clean(args.branch_key || ctx.branch_key) || 'sucursal_1';
  const today = clean(args.date) || localDate(ctx.timezone);
  const yesterday = localDate(ctx.timezone, -1);

  const appointments = await safeQuery(q, `
    SELECT id, patient, date, start_time::text AS start_time, status
      FROM appointments
     WHERE tenant_id=$1::uuid
       AND date=$2::date
       AND (sucursal_id=$3 OR sucursal_id IS NULL)
     ORDER BY start_time ASC
  `, [tenantId, today, branch]);

  const paymentRows = await safeQuery(q, `
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE date=$2::date),0)::numeric AS today_total,
      COALESCE(SUM(amount) FILTER (WHERE date=$3::date),0)::numeric AS yesterday_total,
      COALESCE(SUM(amount) FILTER (WHERE date=$2::date AND LOWER(COALESCE(payment_method,'')) LIKE '%efect%'),0)::numeric AS cash,
      COALESCE(SUM(amount) FILTER (WHERE date=$2::date AND LOWER(COALESCE(payment_method,'')) LIKE '%transfer%'),0)::numeric AS transfer,
      COALESCE(SUM(amount) FILTER (WHERE date=$2::date AND LOWER(COALESCE(payment_method,'')) LIKE '%tarjet%'),0)::numeric AS card
      FROM payments
     WHERE tenant_id=$1::uuid
       AND (sucursal_id=$4 OR sucursal_id IS NULL)
       AND date IN ($2::date,$3::date)
  `, [tenantId, today, yesterday, branch], [{}]);

  const expenseRows = await safeQuery(q, `
    SELECT COALESCE(SUM(amount),0)::numeric AS today_total
      FROM expenses
     WHERE tenant_id=$1::uuid
       AND date=$2::date
       AND (sucursal_id=$3 OR sucursal_id IS NULL)
  `, [tenantId, today, branch], [{}]);

  const labRows = await safeQuery(q, `
    SELECT id, paciente, fecha_entrega_estimada, etapa
      FROM lab_trabajos
     WHERE tenant_id=$1::uuid
       AND (sucursal_id=$2 OR sucursal_id IS NULL)
       AND COALESCE(LOWER(etapa),'') NOT LIKE '%entreg%'
       AND fecha_entrega_estimada IS NOT NULL
       AND fecha_entrega_estimada <= $3::date
     ORDER BY fecha_entrega_estimada ASC
     LIMIT 20
  `, [tenantId, branch, today]);

  const inventoryRows = await safeQuery(q, `
    SELECT id, name, quantity, min_stock, expiration_date
      FROM inventory
     WHERE tenant_id=$1::uuid
       AND (sucursal_id=$2 OR sucursal_id IS NULL)
       AND (
         COALESCE(quantity,0) <= COALESCE(min_stock,0)
         OR (expiration_date IS NOT NULL AND expiration_date <= ($3::date + INTERVAL '30 days'))
       )
     ORDER BY
       CASE WHEN COALESCE(quantity,0)=0 THEN 0 ELSE 1 END,
       quantity ASC
     LIMIT 20
  `, [tenantId, branch, today]);

  const status = appointments.reduce((acc, item) => {
    const value = clean(item.status).toLowerCase();
    if (value.includes('cancel')) acc.cancelled += 1;
    else if (value.includes('confirm')) acc.confirmed += 1;
    else if (value.includes('atendid') || value.includes('complet')) acc.attended += 1;
    else acc.pending += 1;
    return acc;
  }, { total: appointments.length, confirmed: 0, pending: 0, attended: 0, cancelled: 0 });

  const payments = paymentRows[0] || {};
  const expenses = expenseRows[0] || {};
  const finance = {
    income_today: money(payments.today_total),
    income_yesterday: money(payments.yesterday_total),
    expenses_today: money(expenses.today_total),
    net_today: money(payments.today_total) - money(expenses.today_total),
    methods: {
      cash: money(payments.cash),
      transfer: money(payments.transfer),
      card: money(payments.card),
    },
  };

  const overdueLabs = labRows.filter(row => String(row.fecha_entrega_estimada).slice(0,10) < today);
  const dueTodayLabs = labRows.filter(row => String(row.fecha_entrega_estimada).slice(0,10) === today);
  const outOfStock = inventoryRows.filter(row => Number(row.quantity || 0) <= 0);
  const lowStock = inventoryRows.filter(row => Number(row.quantity || 0) > 0 && Number(row.quantity || 0) <= Number(row.min_stock || 0));

  const alerts = [];
  addAlert(alerts, 'info', 'agenda', `${status.total} citas hoy`,
    `${status.confirmed} confirmadas, ${status.pending} pendientes y ${status.cancelled} canceladas.`,
    { type: 'navigate', target: 'agenda' });

  if (status.pending > 0) {
    addAlert(alerts, status.pending >= 5 ? 'attention' : 'important', 'agenda', 'Confirmaciones pendientes',
      `${status.pending} cita${status.pending === 1 ? '' : 's'} todavía requieren confirmación.`,
      { type: 'navigate', target: 'agenda' });
  }
  if (status.cancelled >= 3) {
    addAlert(alerts, 'attention', 'agenda', 'Cancelaciones elevadas',
      `Hoy se registran ${status.cancelled} cancelaciones. Conviene revisar los espacios disponibles.`);
  }

  addAlert(alerts, 'info', 'caja', 'Resultado de caja',
    `Ingresos de hoy: $${finance.income_today.toFixed(2)}. Gastos: $${finance.expenses_today.toFixed(2)}. Neto: $${finance.net_today.toFixed(2)}.`,
    { type: 'navigate', target: 'pagos' });

  if (finance.income_yesterday > 0 && finance.income_today < finance.income_yesterday * 0.6) {
    addAlert(alerts, 'important', 'caja', 'Ingresos por debajo de ayer',
      `Hoy llevas $${finance.income_today.toFixed(2)}, frente a $${finance.income_yesterday.toFixed(2)} de ayer.`);
  }
  if (overdueLabs.length) {
    addAlert(alerts, 'critical', 'laboratorio', 'Trabajos de laboratorio vencidos',
      `${overdueLabs.length} trabajo${overdueLabs.length === 1 ? '' : 's'} tienen fecha de entrega vencida.`,
      { type: 'navigate', target: 'laboratorios' });
  } else if (dueTodayLabs.length) {
    addAlert(alerts, 'attention', 'laboratorio', 'Entregas de laboratorio hoy',
      `${dueTodayLabs.length} trabajo${dueTodayLabs.length === 1 ? '' : 's'} deben entregarse hoy.`,
      { type: 'navigate', target: 'laboratorios' });
  }
  if (outOfStock.length) {
    addAlert(alerts, 'critical', 'inventario', 'Productos agotados',
      `${outOfStock.length} producto${outOfStock.length === 1 ? '' : 's'} están en cero.`,
      { type: 'navigate', target: 'inventario' });
  }
  if (lowStock.length) {
    addAlert(alerts, 'attention', 'inventario', 'Inventario bajo',
      `${lowStock.length} producto${lowStock.length === 1 ? '' : 's'} están en el mínimo o por debajo.`,
      { type: 'navigate', target: 'inventario' });
  }

  const priorityOrder = { critical: 0, attention: 1, important: 2, info: 3 };
  alerts.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const recommendations = [];
  if (status.pending) recommendations.push(`Contactar a ${status.pending} paciente${status.pending === 1 ? '' : 's'} pendiente${status.pending === 1 ? '' : 's'} de confirmar.`);
  if (status.cancelled) recommendations.push('Revisar los espacios liberados por cancelaciones para ofrecerlos a pacientes en espera.');
  if (overdueLabs.length) recommendations.push('Dar prioridad a los trabajos de laboratorio vencidos.');
  if (outOfStock.length || lowStock.length) recommendations.push('Preparar una reposición de los materiales señalados.');
  if (!recommendations.length) recommendations.push('La operación del día no presenta alertas críticas.');

  return {
    generated_at: new Date().toISOString(),
    date: today,
    tenant_id: tenantId,
    branch_key: branch,
    greeting: `Resumen operativo de ${ctx.user_name || 'la clínica'}`,
    agenda: { ...status, first_appointment: appointments[0] || null, appointments },
    finance,
    laboratory: {
      due_today: dueTodayLabs.length,
      overdue: overdueLabs.length,
      items: labRows,
    },
    inventory: {
      low_stock: lowStock.length,
      out_of_stock: outOfStock.length,
      items: inventoryRows,
    },
    alerts,
    recommendations,
    highest_priority: alerts[0]?.priority || 'info',
    assistant_message: [
      `Hoy tienes ${status.total} citas: ${status.confirmed} confirmadas y ${status.pending} pendientes.`,
      `Ingresos: $${finance.income_today.toFixed(2)}; gastos: $${finance.expenses_today.toFixed(2)}.`,
      overdueLabs.length ? `Hay ${overdueLabs.length} trabajos de laboratorio vencidos.` : '',
      outOfStock.length ? `Hay ${outOfStock.length} productos agotados.` : lowStock.length ? `Hay ${lowStock.length} productos con inventario bajo.` : '',
    ].filter(Boolean).join(' '),
  };
}

module.exports = { buildOperationsReport };

// backend/rules/engine.js
// Motor de reglas conversacional sin dependencias externas

function nowPartsInTZ(tz = 'America/Tijuana') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', hour12: false, weekday: 'long',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());

  const get = (type) => parts.find(p => p.type === type)?.value;
  const hour = Number(get('hour'));
  const weekdayName = get('weekday');
  const map = { Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6, Sunday:7 };
  const weekday = map[weekdayName] || 1;

  const yyyy = get('year');
  const mm   = get('month');
  const dd   = get('day');
  const isoDate = `${yyyy}-${mm}-${dd}`;

  return { hour, weekday, isoDate };
}

function inHourRange(hour, [fromH, toH]) {
  return (fromH <= toH) ? (hour >= fromH && hour < toH) : (hour >= fromH || hour < toH);
}

// Suma n días a una fecha ISO (YYYY-MM-DD) y regresa ISO
function addDaysIso(isoYYYYMMDD, n) {
  const d = new Date(isoYYYYMMDD + 'T00:00:00');
  d.setDate(d.getDate() + Number(n || 0));
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function loadActiveRules(q, sucursalId) {
  const r = await q(
    `SELECT id, name, priority, match, action, cooldown_secs, sucursal_id
       FROM whatsapp_rules
      WHERE active = TRUE AND (sucursal_id IS NULL OR sucursal_id = $1)
      ORDER BY priority ASC, created_at ASC`,
    [sucursalId]
  );
  return r.rows || [];
}

async function passesCooldown(q, ruleId, phone, cooldownSecs) {
  if (!cooldownSecs) return true;
  const r = await q(
    `SELECT 1
       FROM whatsapp_rule_execs
      WHERE rule_id=$1 AND phone=$2
        AND executed_at >= NOW() - ($3::text || ' seconds')::interval
      LIMIT 1`,
    [ruleId, phone, String(cooldownSecs)]
  );
  return !r.rows?.[0];
}

async function markExec(q, ruleId, phone, sucursalId) {
  await q(
    `INSERT INTO whatsapp_rule_execs (rule_id, phone, sucursal_id) VALUES ($1,$2,$3)`,
    [ruleId, phone, sucursalId]
  );
}

// Obtiene una cita por últimos 10 dígitos; opcionalmente para una fecha exacta (YYYY-MM-DD)
async function getApptSnapshot({ q, last10s, sucursalId, phoneColumn='phone', forIsoDate=null }) {
  const params = [last10s, sucursalId || null];
  const dateFilter = forIsoDate ? `AND date::date = $3::date` : '';
  if (forIsoDate) params.push(forIsoDate);

  const sql = `
    SELECT id, date, start_time, status, sucursal_id
      FROM appointments
     WHERE RIGHT(regexp_replace(COALESCE(${phoneColumn}::text, ''), '\\D', '', 'g'), 10) = ANY($1)
       AND ($2::text IS NULL OR sucursal_id = $2)
       ${dateFilter}
  ORDER BY date DESC, start_time DESC
     LIMIT 1`;

  try {
    const r = await q(sql, params);
    return r.rows?.[0] || null;
  } catch (e) {
    // No tumbes el webhook si la tabla/columna no existe o hay mismatch:
    console.error('rules:getApptSnapshot error:', e.message);
    return null;
  }
}

function matchText(text, cond) {
  const t = String(text || '').toLowerCase();
  if (cond.text_contains) {
    const ok = cond.text_contains.some(s => t.includes(String(s).toLowerCase()));
    if (!ok) return false;
  }
  if (cond.regex) {
    const re = new RegExp(cond.regex, 'i');
    if (!re.test(t)) return false;
  }
  return true;
}

async function evalCond({ q, text, phone, sucursalId, tz, cond, buildPhoneVariants, phoneColumn }) {
  // Texto
  if (!matchText(text, cond)) return false;

  // Sucursal
  if (cond.sucursal_in && !cond.sucursal_in.includes(sucursalId)) return false;

  const { hour, weekday, isoDate } = nowPartsInTZ(tz);

  // Día / hora
  if (cond.day_of_week && !cond.day_of_week.includes(weekday)) return false;
  if (cond.hour_range && !inHourRange(hour, cond.hour_range)) return false;

  // Condiciones de cita
  const needsApptCheck =
    cond.has_appointment_today != null ||
    cond.has_appointment_in_days != null ||
    !!cond.appointment_status_in;

  if (needsApptCheck) {
    const variants = buildPhoneVariants(phone);
    const last10s = Array.from(new Set(
      variants.map(v => String(v).replace(/\D/g, '').slice(-10)).filter(Boolean)
    ));

    // Cita hoy
    let apptToday = null;
    if (cond.has_appointment_today != null) {
      apptToday = await getApptSnapshot({ q, last10s, sucursalId, phoneColumn, forIsoDate: isoDate });
      if (cond.has_appointment_today === true && !apptToday) return false;
      if (cond.has_appointment_today === false && apptToday) return false;
    }

    // Cita en N días (p. ej. 1 = mañana)
    let apptN = null;
    if (cond.has_appointment_in_days != null) {
      const targetIso = addDaysIso(isoDate, Number(cond.has_appointment_in_days));
      apptN = await getApptSnapshot({ q, last10s, sucursalId, phoneColumn, forIsoDate: targetIso });
      if (!apptN) return false;
    }

    // Status requerido (si se pide)
    if (cond.appointment_status_in) {
      // Prioriza el appt del bloque que se evaluó, si existe; si no, busca cualquiera
      const apptRef = apptN || apptToday ||
        await getApptSnapshot({ q, last10s, sucursalId, phoneColumn, forIsoDate: null });
      if (!(apptRef && cond.appointment_status_in.includes(apptRef.status))) return false;
    }
  }

  return true;
}

async function executeAction({ action, senders, to }) {
  switch (action.type) {
    case 'send_text':
      await senders.sendWhatsAppText({ to, text: action.body || '' });
      return true;

    case 'send_template':
      await senders.sendWhatsAppTemplate({
        to,
        template: action.template,
        lang: action.lang || 'es_MX',
        bodyParams: action.bodyParams || [],
        headerParams: action.headerParams || []
      });
      return true;

    case 'send_buttons':
      if (!senders.sendWhatsAppButtons) return false;
      await senders.sendWhatsAppButtons({
        to,
        body: action.body || '',
        buttons: action.buttons || [] // [{ id, title }]
      });
      return true;

    default:
      return false;
  }
}

async function evaluateAndExecute({
  q, text, from, sucursalId,
  buildPhoneVariants,
  senders, timezone='America/Tijuana',
  phoneColumn='phone'
}) {
  if (String(process.env.RULES_ENABLED || 'true') === 'false') return false;

  const rules = await loadActiveRules(q, sucursalId);

  for (const r of rules) {
    const groups = {
      any : (r.match?.any  || []),
      all : (r.match?.all  || []),
      none: (r.match?.none || []),
    };

    // any
    let anyOk = groups.any.length === 0;
    for (const c of groups.any) {
      if (await evalCond({ q, text, phone: from, sucursalId, tz: timezone, cond: c, buildPhoneVariants, phoneColumn })) { anyOk = true; break; }
    }
    if (!anyOk) continue;

    // all
    let allOk = true;
    for (const c of groups.all) {
      const ok = await evalCond({ q, text, phone: from, sucursalId, tz: timezone, cond: c, buildPhoneVariants, phoneColumn });
      if (!ok) { allOk = false; break; }
    }
    if (!allOk) continue;

    // none
    let noneOk = true;
    for (const c of groups.none) {
      const ok = await evalCond({ q, text, phone: from, sucursalId, tz: timezone, cond: c, buildPhoneVariants, phoneColumn });
      if (ok) { noneOk = false; break; }
    }
    if (!noneOk) continue;

    // cooldown
    if (!(await passesCooldown(q, r.id, from, r.cooldown_secs))) continue;

    // ejecutar
    const done = await executeAction({ action: r.action, senders, to: from });
    if (done) {
      await markExec(q, r.id, from, sucursalId);
      return true;
    }
  }
  return false;
}

module.exports = { evaluateAndExecute };

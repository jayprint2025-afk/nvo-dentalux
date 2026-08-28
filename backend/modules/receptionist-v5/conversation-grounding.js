
'use strict';

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[¿?¡!.,;:()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value) {
  return new Set(normalize(value).split(' ').filter(token => token.length > 2));
}

function overlapScore(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const item of left) if (right.has(item)) common += 1;
  return common / Math.max(left.size, right.size);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findBranch(text, branches = []) {
  const n = normalize(text);
  let best = null;
  for (const branch of branches) {
    const candidates = [
      branch.name,
      branch.branch_key,
      branch.alias,
      ...(Array.isArray(branch.aliases) ? branch.aliases : []),
    ].filter(Boolean);

    let score = 0;
    for (const candidate of candidates) {
      const c = normalize(candidate);
      if (!c) continue;
      if (n === c) score = Math.max(score, 100);
      else if (new RegExp(`\\b${escapeRegex(c)}\\b`).test(n)) score = Math.max(score, 90);
      else score = Math.max(score, overlapScore(n, c) * 60);
    }
    if (!best || score > best.score) best = { branch, score };
  }
  return best?.score >= 45 ? best.branch : null;
}

function serviceAliases(name) {
  const n = normalize(name);
  const values = [n];

  // Un tratamiento que diga "sin limpieza" NO debe convertirse en alias de "limpieza".
  // Esto evita que "Aplicación de barniz de flúor (sin limpieza)" gane cuando
  // el paciente pide una limpieza dental.
  if (/limpieza|profilaxis/.test(n) && !/sin limpieza/.test(n)) {
    values.push('limpieza', 'limpieza dental', 'profilaxis');
  }
  if (/consulta|valoracion|revision|diagnostico/.test(n)) values.push('consulta', 'valoracion', 'revision', 'primera consulta');
  if (/ortodon|bracket/.test(n)) values.push('brackets', 'ortodoncia', 'revision de brackets');
  if (/resina|relleno/.test(n)) values.push('resina', 'relleno', 'empaste');
  if (/extraccion|sacar muela/.test(n)) values.push('extraccion', 'sacar muela');
  return [...new Set(values)];
}

function findService(text, services = []) {
  const n = normalize(text);
  let best = null;
  for (const service of services) {
    let score = 0;
    for (const alias of serviceAliases(service.name)) {
      if (n === alias) score = Math.max(score, 100);
      else if (new RegExp(`\\b${escapeRegex(alias)}\\b`).test(n)) score = Math.max(score, 88);
      else score = Math.max(score, overlapScore(n, alias) * 70);
    }
    const serviceName = normalize(service.name);

    // Si el paciente pide limpieza, nunca seleccionar un servicio que explícitamente diga
    // "sin limpieza". Dar preferencia a Profilaxis/limpieza real.
    if (/\blimpieza\b|\bprofilaxis\b/.test(n)) {
      if (/sin limpieza/.test(serviceName)) score -= 200;
      if (/profilaxis/.test(serviceName)) score += 30;
      else if (/\blimpieza\b/.test(serviceName)) score += 15;
    }

    if (/bracket|ortodon/.test(n) && /consulta|valoracion|revision|diagnostico/.test(serviceName)) {
      score += 20;
    }
    if (!best || score > best.score) best = { service, score };
  }
  return best?.score >= 45 ? best.service : null;
}

function extractPhone(text) {
  const matches = String(text || '').match(/(?:\+?\d[\d\s().-]{8,}\d)/g) || [];
  for (const match of matches) {
    const digits = match.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 15) return digits;
  }
  return null;
}

function extractPatient(text) {
  const raw = String(text || '').trim();
  const patterns = [
    /(?:la cita (?:es|ser[aá]) para|es para|a nombre de|mi nombre es|me llamo)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{1,60})/i,
    /(?:para mi hija|para mi hijo)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{1,60})/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) {
      return match[1]
        .replace(/\b(?:y|con|tel[eé]fono|para|en)\b.*$/i, '')
        .trim();
    }
  }
  return null;
}

function dateParts(timeZone, now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const map = Object.fromEntries(
    parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value])
  );
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

function addDays(base, days) {
  const date = new Date(base);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseDate(text, timeZone = 'America/Tijuana', now = new Date()) {
  const n = normalize(text);
  const local = dateParts(timeZone, now);
  const base = new Date(Date.UTC(local.year, local.month - 1, local.day));

  // Cuando el mensaje contiene palabras contradictorias por una corrección del paciente,
  // se prioriza la referencia más específica/futura: "pasado mañana" > "mañana" > "hoy".
  if (/\bpasado manana\b/.test(n)) return addDays(base, 2);
  if (/\bmanana\b/.test(n)) return addDays(base, 1);
  if (/\bhoy\b/.test(n)) return addDays(base, 0);

  const weekdays = {
    domingo: 0, lunes: 1, martes: 2, miercoles: 3,
    jueves: 4, viernes: 5, sabado: 6,
  };
  const weekday = Object.keys(weekdays).find(day => new RegExp(`\\b${day}\\b`).test(n));
  if (weekday) {
    let delta = (weekdays[weekday] - base.getUTCDay() + 7) % 7;
    if (delta === 0) delta = 7;
    return addDays(base, delta);
  }

  const iso = n.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) {
    return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;
  }
  return null;
}


function naturalDateLabel(dateValue, timeZone = 'America/Tijuana', now = new Date()) {
  const raw = String(dateValue || '').slice(0, 10);
  if (!raw) return 'ese día';

  const local = dateParts(timeZone, now);
  const base = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const today = base.toISOString().slice(0, 10);
  const tomorrow = addDays(base, 1);

  if (raw === today) return 'hoy';
  if (raw === tomorrow) return 'mañana';

  const target = new Date(`${raw}T12:00:00Z`);
  if (Number.isNaN(target.getTime())) return 'ese día';
  return target.toLocaleDateString('es-MX', { weekday: 'long', timeZone: 'UTC' });
}

function parseTimePreference(text) {
  const n = normalize(text);
  const match = n.match(/\b(?:a las?|despues de las?|antes de las?|desde las?)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (!match) {
    if (/\bpor la manana\b/.test(n)) return { type: 'range', after_time: '08:00', before_time: '12:00' };
    if (/\bpor la tarde\b/.test(n)) return { type: 'range', after_time: '12:00', before_time: '18:00' };
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3];

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (!meridiem && /\btarde|noche\b/.test(n) && hour < 12) hour += 12;

  const value = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  if (/\bdespues de|desde\b/.test(n)) return { type: 'after', after_time: value };
  if (/\bantes de\b/.test(n)) return { type: 'before', before_time: value };
  return { type: 'exact', exact_time: value };
}

function informationIntents(text) {
  const n = normalize(text);
  const intents = [];
  if (/\bdonde|direccion|ubicacion|ubica|hubica\b/.test(n)) intents.push('location');
  if (/\bmaps|mapa|google maps|como llegar|enlace\b/.test(n)) intents.push('maps');
  if (/\bprecio|cuanto cuesta|costo|cuanto sale\b/.test(n)) intents.push('price');
  if (/\bpromocion|promociones|descuento|oferta\b/.test(n)) intents.push('promotion');
  if (/\bhorario|a que hora|abren|cierran\b/.test(n)) intents.push('business_hours');
  if (/\bpago|tarjeta|efectivo|transferencia\b/.test(n)) intents.push('payment_methods');
  if (/\bestacionamiento|parking\b/.test(n)) intents.push('parking');
  return [...new Set(intents)];
}

function isNegative(text) {
  const n = normalize(text);
  return /^(no|nop|nel|no gracias)$/.test(n) ||
    /\bno me sirve|no funciona|otro horario|mas tarde|mas temprano|prefiero otro\b/.test(n);
}

function appointmentActionIntent(text) {
  const n = normalize(text);

  if (/\b(cancelar|cancela|cancelame|anular|anula|eliminar|elimina)\b.{0,40}\b(cita|consulta)\b/.test(n) ||
      /\b(ya no puedo asistir|no podre asistir|no voy a poder ir|quiero cancelar)\b/.test(n)) {
    return 'cancel';
  }

  if (/\b(reagendar|reagenda|reprogramar|reprograma)\b/.test(n) ||
      /\b(mover|mueve|cambiar|cambia)\b.{0,40}\b(cita|fecha|dia|hora|horario)\b/.test(n) ||
      /\b(otra fecha|otro dia|otro horario)\b.{0,30}\b(cita|consulta)?\b/.test(n)) {
    return 'reschedule';
  }

  return null;
}


function deriveFacts(text, knowledge, state, options = {}) {
  const collected = { ...(state.collected || {}) };
  const appointmentAction = appointmentActionIntent(text);

  if (appointmentAction) {
    collected.booking_mode = appointmentAction;
  }
  const branch = findBranch(text, knowledge.branches);
  const service = findService(text, knowledge.services);
  const phone = extractPhone(text);
  const patient = extractPatient(text);

  const rememberedBranch =
    branch ||
    knowledge.branches.find(item => item.branch_key === collected.branch_key) ||
    null;

  const clinicTimeZone =
    options.timeZone ||
    rememberedBranch?.timezone ||
    rememberedBranch?.time_zone ||
    knowledge?.timezone ||
    knowledge?.time_zone ||
    knowledge?.clinic_timezone ||
    'America/Tijuana';

  const date = parseDate(text, clinicTimeZone, options.now || new Date());
  const time = parseTimePreference(text);

  if (branch) {
    collected.branch_key = branch.branch_key;
    collected.branch_name = branch.name;
  }
  if (service) {
    collected.service_id = service.id;
    collected.service_name = service.name;
    if (service.duration_hours != null) collected.duration_hours = service.duration_hours;
  }
  if (phone) collected.phone = phone;
  if (patient) collected.patient = patient;
  if (date) collected.date = date;
  if (time) Object.assign(collected, time);

  return {
    collected,
    detected: {
      branch: branch ? { branch_key: branch.branch_key, name: branch.name } : null,
      service: service ? { id: service.id, name: service.name } : null,
      phone,
      patient,
      date,
      time,
      information_intents: informationIntents(text),
      appointment_action: appointmentAction,
      negative: isNegative(text),
    },
  };
}

function knownFacts(knowledge, collected) {
  const branch = knowledge.branches.find(item => item.branch_key === collected.branch_key) || null;
  const service = knowledge.services.find(item => String(item.id) === String(collected.service_id)) || null;
  const promotions = knowledge.promotions.filter(item =>
    (!collected.branch_key || item.branch_key === collected.branch_key) &&
    (!collected.service_id || !item.service_id || String(item.service_id) === String(collected.service_id))
  );
  return { branch, service, promotions, collected };
}

function similarity(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function replyViolations(reply, state, userText) {
  const n = normalize(reply);
  const violations = [];

  if (
    state.collected.branch_key &&
    (
      /\b(cual|que)\s+sucursal|en que sucursal|prefieres.*sucursal/.test(n) ||
      /\bprefieres\b.{0,80}\bo\b/.test(n)
    )
  ) {
    violations.push('pregunta_sucursal_conocida');
  }
  if (state.collected.service_id && /\bque servicio|cual servicio|que tratamiento|que deseas realizar/.test(n)) {
    violations.push('pregunta_servicio_conocido');
  }
  if (state.collected.date && /\bque dia|cual dia|cuando te gustaria/.test(n)) {
    violations.push('pregunta_fecha_conocida');
  }
  if (
    (state.collected.after_time || state.collected.before_time || state.collected.exact_time) &&
    /\bque horario|a que hora|que hora|cual horario|horario te conviene/.test(n)
  ) {
    violations.push('pregunta_horario_conocido');
  }
  if (state.collected.patient && /\ba nombre de quien|como se llama el paciente|nombre del paciente/.test(n)) {
    violations.push('pregunta_paciente_conocido');
  }
  if (state.collected.phone && /\btelefono|numero de contacto/.test(n) && /\bcual|compartir|proporcionar|me das/.test(n)) {
    violations.push('pregunta_telefono_conocido');
  }

  const last = state.recent_replies?.slice(-1)[0];
  if (last && similarity(last, reply) >= 0.78) violations.push('respuesta_muy_repetida');

  if (isNegative(userText) && state.last_tool_result?.selected_time) {
    const offered = String(state.last_tool_result.selected_time || '');
    if (offered && n.includes(offered.slice(0, 5))) violations.push('reofrece_horario_rechazado');
  }

  return violations;
}


function bookingIntent(text) {
  const n = normalize(text);
  return /\b(agendar|agenda|agendame|ajendame|cita|consulta|limpieza|valoracion|revision|tratamiento|puedo|disponible)\b/.test(n) &&
    (
      /\b(hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(n) ||
      /\b(a las?|despues de las?|antes de las?|por la manana|por la tarde)\b/.test(n) ||
      /\b(quiero|necesito|me gustaria|para una|para un)\b/.test(n)
    );
}

function availabilityReady(collected = {}) {
  return Boolean(
    collected.branch_key &&
    collected.service_id &&
    collected.date
  );
}

function missingBookingFields(collected = {}) {
  const fields = [];
  if (!collected.branch_key) fields.push('branch_key');
  if (!collected.service_id) fields.push('service_id');
  if (!collected.date) fields.push('date');
  return fields;
}

function nextNaturalQuestion(collected = {}) {
  const missing = missingBookingFields(collected);
  if (missing[0] === 'branch_key') return '¿En cuál sucursal te gustaría atenderte?';
  if (missing[0] === 'service_id') return '¿Qué servicio necesitas?';
  if (missing[0] === 'date') return '¿Qué día te gustaría asistir?';
  return null;
}

module.exports = {
  normalize,
  findBranch,
  findService,
  extractPhone,
  extractPatient,
  parseDate,
  naturalDateLabel,
  parseTimePreference,
  informationIntents,
  appointmentActionIntent,
  deriveFacts,
  knownFacts,
  replyViolations,
  similarity,
  isNegative,
  bookingIntent,
  availabilityReady,
  missingBookingFields,
  nextNaturalQuestion,
};

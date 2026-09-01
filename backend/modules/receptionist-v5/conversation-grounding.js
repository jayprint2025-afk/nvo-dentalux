
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

function genericPatientDescription(value) {
  const n = normalize(value);
  if (!n) return false;
  return /^(?:una?|el|la)?\s*(?:nina|nino|menor|bebe|paciente|persona)(?:\s+de\s+\d{1,2}\s+anos?)?\b/.test(n) ||
    /^(?:mi\s+)?(?:hija|hijo)(?:\s+de\s+\d{1,2}\s+anos?)?\b/.test(n);
}

function extractPatientAge(text) {
  const n = normalize(text);
  const match = n.match(/\b(?:nina|nino|menor|hija|hijo|paciente)?\s*(?:de\s+)?(\d{1,2})\s+anos?\b/);
  if (!match) return null;
  const age = Number(match[1]);
  return Number.isInteger(age) && age >= 0 && age <= 120 ? age : null;
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
      const candidate = match[1]
        .replace(/\b(?:y|con|tel[eé]fono|para|en)\b.*$/i, '')
        .trim();
      if (candidate && !genericPatientDescription(candidate)) return candidate;
    }
  }

  // Respuesta común al pedir nombre + teléfono:
  // "hector jimenez 6867865525"
  // Si el mensaje contiene un teléfono, tomar como nombre únicamente el texto
  // alfabético que queda antes/después de quitar el número.
  const phone = extractPhone(raw);
  if (phone) {
    const withoutPhone = raw
      .replace(/(?:\+?\d[\d\s().-]{8,}\d)/g, ' ')
      // Si hora + teléfono + nombre vienen en el mismo mensaje, quitar primero la hora.
      // Ejemplo: "4 pm 6731234554 Jessica" -> "Jessica", no "pm Jessica".
      .replace(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|am|pm)\b/gi, ' ')
      .replace(/\b(?:am|pm|a\s*m|p\s*m)\b/gi, ' ')
      .replace(/\b(?:mi nombre es|me llamo|soy|nombre|telefono|teléfono|numero|número|contacto|es)\b/gi, ' ')
      .replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const words = withoutPhone.split(/\s+/).filter(Boolean);
    const oneWordStop = new Set(['si', 'no', 'ok', 'okay', 'gracias', 'extraccion', 'limpieza', 'profilaxis', 'cita']);
    if (
      words.length >= 1 &&
      words.length <= 6 &&
      words.every(word => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'-]+$/.test(word)) &&
      !(words.length === 1 && oneWordStop.has(normalize(words[0])))
    ) {
      if (!genericPatientDescription(withoutPhone)) return withoutPhone;
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


function normalizeStoredDate(dateValue, timeZone = 'America/Tijuana', now = new Date()) {
  const raw = String(dateValue || '').trim();
  if (!raw) return null;

  // Si ya está normalizada, conservarla sólo si realmente representa una fecha válida.
  const iso = raw.match(/^\s*(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\s*$/);
  if (iso) {
    const normalized = `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;
    const check = new Date(`${normalized}T12:00:00Z`);
    if (
      !Number.isNaN(check.getTime()) &&
      check.getUTCFullYear() === Number(iso[1]) &&
      check.getUTCMonth() + 1 === Number(iso[2]) &&
      check.getUTCDate() === Number(iso[3])
    ) return normalized;
    return null;
  }

  // Reutilizamos la misma semántica de parseDate para estados antiguos como
  // date: "mañana". "ese día" permanece sin resolver: nunca inventamos una fecha.
  return parseDate(raw, timeZone, now);
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

function parseTimePreference(text, previous = {}) {
  const n = normalize(text);
  // Aceptar tanto "a las 4 pm" como una corrección breve "4 pm".
  // La forma breve exige AM/PM explícito para no confundir edades, teléfonos u otros números.
  const match = n.match(
    /\b(?:(?:como|aprox(?:imadamente)?|alrededor de|cerca de|tipo)\s+)?(?:a las?|despues de las?|antes de las?|desde las?)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/
  ) || n.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);

  if (!match) {
    // Para agenda dental tratamos "por la tarde" como 13:00-18:00.
    // Así no ofrecemos 12:00 como primera opción cuando el paciente dice "por la tarde".
    if (/\bpor la manana\b/.test(n)) {
      return { type: 'range', after_time: '08:00', before_time: '12:00' };
    }
    if (/\bpor la tarde\b/.test(n)) {
      return { type: 'range', after_time: '13:00', before_time: '18:00' };
    }
    if (/\bpor la noche\b/.test(n)) {
      return { type: 'range', after_time: '18:00', before_time: '21:00' };
    }
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3];

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  // Si el paciente dice "como a las 4" después de haber pedido "por la tarde",
  // conservar el contexto y entender 16:00, no 04:00.
  const previousAfter = String(previous.after_time || '').slice(0, 5);
  const previousBefore = String(previous.before_time || '').slice(0, 5);
  const previousMeridiemContext = String(previous.meridiem_context || '').toLowerCase();
  const previousRangeIsAfternoon =
    previousAfter >= '12:00' ||
    previousBefore >= '13:00' ||
    previousMeridiemContext === 'pm';

  if (
    !meridiem &&
    hour < 12 &&
    (/\btarde|noche\b/.test(n) || previousRangeIsAfternoon)
  ) {
    hour += 12;
  }

  const value = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  if (/\bdespues de|desde\b/.test(n)) return { type: 'after', after_time: value };
  if (/\bantes de\b/.test(n)) return { type: 'before', before_time: value };

  return {
    type: 'exact',
    exact_time: value,
    approximate: /\b(como|aprox|aproximadamente|alrededor|cerca|tipo|mas o menos)\b/.test(n),
  };
}

function informationIntents(text) {
  const n = normalize(text);
  const intents = [];
  if (/\bdonde|direccion|ubicacion|ubica|hubica\b/.test(n)) intents.push('location');
  if (/\bmaps|mapa|google maps|como llegar|enlace\b/.test(n)) intents.push('maps');
  if (/\bprecio|cuanto cuesta|costo|cuanto sale\b/.test(n)) intents.push('price');
  if (/\b(cuanto tarda|cuanto dura|duracion|tiempo tarda|tiempo dura)\b/.test(n)) intents.push('duration');
  if (/\b(necesito llevar|debo llevar|llevar algo|ir preparada|ir preparado|preparacion|prepararme|antes de la cita)\b/.test(n)) intents.push('preparation');
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
  const branchMention = findBranch(text, knowledge.branches);
  const infoIntents = informationIntents(text);
  const branchIsInformationalOnly = Boolean(
    branchMention &&
    infoIntents.length &&
    !bookingIntent(text, collected) &&
    !appointmentAction
  );
  const branch = branchIsInformationalOnly ? null : branchMention;

  const targetBranchKey = branch?.branch_key || collected.branch_key || null;
  const servicePool = targetBranchKey
    ? knowledge.services.filter(item => item.branch_key === targetBranchKey)
    : knowledge.services;

  let service = findService(text, servicePool);
  const rememberedServiceName =
    collected.service_name ||
    knowledge.services.find(item => String(item.id) === String(collected.service_id || ''))?.name ||
    null;

  // Si el paciente selecciona/cambia sucursal sin repetir el tratamiento,
  // volver a resolver el mismo servicio DENTRO de la nueva sucursal.
  if (branch && !service && rememberedServiceName) {
    service = findService(
      rememberedServiceName,
      knowledge.services.filter(item => item.branch_key === branch.branch_key)
    );
  }

  const phone = extractPhone(text);
  const patient = extractPatient(text);
  const patientAge = extractPatientAge(text);

  // Limpiar estados persistidos que hayan confundido una descripción
  // ("una niña de 9 años") con el nombre real del paciente.
  if (collected.patient && genericPatientDescription(collected.patient)) {
    delete collected.patient;
  }
  if (collected.patient_name && genericPatientDescription(collected.patient_name)) {
    delete collected.patient_name;
  }

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

  const currentNow = options.now || new Date();

  // Sanea estados persistidos por versiones anteriores. Esto es clave cuando el
  // siguiente mensaje sólo es "sí": aun sin mencionar fecha, "mañana" debe
  // convertirse a YYYY-MM-DD antes de preparar/crear la cita.
  if (collected.date) {
    const normalizedStoredDate = normalizeStoredDate(collected.date, clinicTimeZone, currentNow);
    if (normalizedStoredDate) collected.date = normalizedStoredDate;
  }

  const date = parseDate(text, clinicTimeZone, currentNow);
  const time = parseTimePreference(text, collected);

  if (branch) {
    collected.branch_key = branch.branch_key;
    collected.branch_name = branch.name;
  }

  if (service) {
    collected.service_name = service.name;

    // service_id es una identidad propia de cada sucursal.
    // Sin sucursal elegida conservamos el concepto/nombre, pero NO amarramos
    // la conversación al registro de la primera sucursal encontrada.
    if (targetBranchKey) {
      collected.service_id = service.id;
      if (service.duration_hours != null) collected.duration_hours = service.duration_hours;
    } else {
      delete collected.service_id;
      delete collected.duration_hours;
    }
  } else if (branch && rememberedServiceName) {
    // La sucursal cambió y el servicio anterior no existe allí: no conservar
    // un ID perteneciente a otra sucursal.
    delete collected.service_id;
    delete collected.duration_hours;
    collected.service_name = rememberedServiceName;
  }
  if (phone) collected.phone = phone;
  if (patient) collected.patient = patient;
  if (patientAge != null) collected.patient_age = patientAge;
  if (date) collected.date = date;
  if (time) {
    if (time.type === 'exact') {
      // Conservar el contexto AM/PM aunque eliminemos el rango anterior.
      // Ejemplo: "por la tarde" -> "como a las 4" -> "sí, a las 5".
      // El tercer mensaje debe seguir interpretándose como 5:00 p. m.
      const exactHour = Number(String(time.exact_time || '').slice(0, 2));
      if (Number.isFinite(exactHour)) {
        collected.meridiem_context = exactHour >= 12 ? 'pm' : 'am';
      }

      // El paciente ya eligió una hora: no conservar filtros anteriores como
      // "por la tarde", porque pueden interferir en la validación exacta.
      delete collected.after_time;
      delete collected.before_time;
      delete collected.start_time;
      delete collected.selected_time;
      delete collected.selected_slot;
      delete collected.end_time;
    } else if (time.type === 'range') {
      const afterHour = Number(String(time.after_time || '').slice(0, 2));
      const beforeHour = Number(String(time.before_time || '').slice(0, 2));
      if (
        (Number.isFinite(afterHour) && afterHour >= 12) ||
        (Number.isFinite(beforeHour) && beforeHour > 12)
      ) {
        collected.meridiem_context = 'pm';
      } else if (
        Number.isFinite(beforeHour) &&
        beforeHour <= 12
      ) {
        collected.meridiem_context = 'am';
      }

      delete collected.exact_time;
      delete collected.start_time;
      delete collected.selected_time;
      delete collected.selected_slot;
      delete collected.end_time;
    }
    Object.assign(collected, time);
  }

  return {
    collected,
    detected: {
      branch: branch ? { branch_key: branch.branch_key, name: branch.name } : null,
      information_branch: branchIsInformationalOnly && branchMention
        ? { branch_key: branchMention.branch_key, name: branchMention.name }
        : null,
      service: service
        ? { id: targetBranchKey ? service.id : null, name: service.name }
        : null,
      phone,
      patient,
      patient_age: patientAge,
      date,
      time,
      information_intents: infoIntents,
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


function bookingIntent(text, collected = {}) {
  const n = normalize(text);

  const hasDate =
    /\b(hoy|manana|pasado manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(n);

  const asksAvailability =
    /\b(disponible|disponibilidad|espacio|espacios|lugar|lugares|se podra|se puede|tienen lugar|hay lugar)\b/.test(n) ||
    (/\b(horario|horarios|hora|horas)\b/.test(n) &&
      /\b(hoy|manana|pasado manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|cita|agendar|disponible|lugar|espacio)\b/.test(n));

  const explicitBooking =
    /\b(agendar|agenda|agendame|ajendame|cita|consulta|limpieza|valoracion|revision|tratamiento|quiero|necesito|me gustaria)\b/.test(n);

  // Si ya conocemos el servicio, una consulta de disponibilidad o una hora concreta
  // conserva el contexto de la cita aunque el paciente no repita "agendar" o "cita".
  const timePreference = parseTimePreference(text, collected);
  if (collected.service_id && asksAvailability && (hasDate || collected.date)) return true;
  if (collected.service_id && collected.date && timePreference) return true;

  return explicitBooking && (
    hasDate ||
    asksAvailability ||
    /\b(a las?|despues de las?|antes de las?|por la manana|por la tarde|para una|para un)\b/.test(n)
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
  extractPatientAge,
  genericPatientDescription,
  parseDate,
  normalizeStoredDate,
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

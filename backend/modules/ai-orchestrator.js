// modules/ai-orchestrator.js
// Recepcionista IA v2: conversación estable, una pregunta por turno,
// horarios de uno en uno y creación únicamente tras confirmación explícita.

const { normBranch, getBranchDisplayName } = require('./tenant-context');
const { ensureStateDefaults, isBookingExpired, resetBooking } = require('./conversation-state');
const { getServices, computeAvailability, createAppointmentTransactional } = require('./booking-engine');
const { generateAIReply } = require('../ai/assistant');

function asText(value) {
  return value === null || value === undefined ? '' : String(value);
}

function normalizeForMatch(value) {
  return asText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePhone(raw) {
  const digits = asText(raw).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('521') && digits.length >= 13) return digits.slice(3, 13);
  if (digits.startsWith('52') && digits.length >= 12) return digits.slice(2, 12);
  if (digits.length === 10) return digits;
  return digits.length > 10 ? digits.slice(-10) : null;
}

function getPhoenixDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Phoenix',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

function datePartsToIso({ year, month, day }) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDaysIso(days) {
  const current = getPhoenixDateParts();
  const utc = new Date(Date.UTC(current.year, current.month - 1, current.day + days, 12, 0, 0));
  return utc.toISOString().slice(0, 10);
}

function parseDateFromText(text) {
  const raw = asText(text).trim();
  const normalized = normalizeForMatch(raw);

  const isoMatch = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const slashMatch = raw.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
  if (slashMatch) {
    const now = getPhoenixDateParts();
    let year = slashMatch[3] ? Number(slashMatch[3]) : now.year;
    if (year < 100) year += 2000;
    const month = Number(slashMatch[1]);
    const day = Number(slashMatch[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return datePartsToIso({ year, month, day });
    }
  }

  if (/\b(hoy|today)\b/.test(normalized)) return addDaysIso(0);
  if (/\b(pasado manana)\b/.test(normalized)) return addDaysIso(2);
  if (/\b(manana|tomorrow)\b/.test(normalized)) return addDaysIso(1);

  const weekdays = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
  };

  const todayIso = addDaysIso(0);
  const today = new Date(`${todayIso}T12:00:00Z`);
  for (const [name, targetDay] of Object.entries(weekdays)) {
    if (new RegExp(`\\b${name}\\b`).test(normalized)) {
      let add = targetDay - today.getUTCDay();
      if (add <= 0) add += 7;
      return addDaysIso(add);
    }
  }

  return null;
}

function isPastDate(isoDate) {
  return Boolean(isoDate && isoDate < addDaysIso(0));
}

function isAffirmative(text) {
  const value = normalizeForMatch(text);
  return /^(si|sip|simon|claro|ok|okay|va|sale|perfecto|correcto|confirmo|confirmar|adelante|me funciona|esta bien|yes|dale|listo|asi esta bien|ese esta bien)$/.test(value)
    || /\b(si me funciona|si confirmo|quiero confirmar|queda confirmado|confirmada|confirmado|ese horario esta bien|de acuerdo|agendala|agendalo|reservala|reservalo)\b/.test(value);
}

function isNegative(text) {
  const value = normalizeForMatch(text);
  return /^(no|nop|nel|no gracias|ese no|esa no|no puedo|no me funciona|cambialo|cambiar)$/.test(value)
    || /\b(otro horario|otra hora|otro dia|otra fecha|otra sucursal|otro servicio|mas tarde|mas temprano|no me sirve|no puedo a esa hora|prefiero otra|quiero cambiar)\b/.test(value);
}

function cancelIntent(text) {
  return /\b(ya no|no me interesa|cancelar proceso|olvidalo|mejor no|ya no quiero|salir|reiniciar|menu)\b/i.test(normalizeForMatch(text));
}

function restartIntent(text) {
  const value = normalizeForMatch(text);
  return /^(reiniciar|empezar de nuevo|volver a empezar|nueva cita|otra cita|menu principal)$/.test(value);
}

function humanHandoffIntent(text) {
  const value = normalizeForMatch(text);
  return /\b(hablar con una persona|hablar con alguien|asesor|recepcionista humana|humano|operador|atencion personal|que me llamen)\b/.test(value);
}

function gratitudeOnly(text) {
  const value = normalizeForMatch(text);
  return /^(gracias|muchas gracias|ok gracias|perfecto gracias|muy amable)$/.test(value);
}

function looksLikeBookingIntent(text) {
  const value = normalizeForMatch(text);
  return /\b(agendar|agenda|reservar|programar|hacer una cita|quiero cita|necesito cita|sacar cita|consulta)\b/.test(value)
    || looksLikeServiceRequest(text);
}

function looksLikeServiceRequest(text) {
  const value = normalizeForMatch(text);
  return /\b(primera consulta|consulta|valoracion|revision|diagnostico|limpieza|profilaxis|resina|resinas|rayos x|radiografia|extraccion|endodoncia|placa|corona|zirconia|cirugia|blanqueamiento|brackets|ortodoncia)\b/.test(value);
}

function isInformationRequest(text) {
  const value = normalizeForMatch(text);

  // Las preguntas informativas tienen prioridad aunque también mencionen
  // un servicio: "¿cuánto cuesta una consulta?" no es una orden de agendar.
  return /\b(direccion|ubicacion|donde|como llegar|mapa|telefono|whatsapp|contacto|horario|horarios|abre|cierra|promocion|oferta|precio|precios|costo|costos|cuanto cuesta|cuanto sale|que valor)\b/.test(value)
    || /\b(cuanto|que precio|que costo)\b.*\b(consulta|limpieza|resina|extraccion|endodoncia|corona|blanqueamiento|brackets|ortodoncia)\b/.test(value);
}

function findServiceByText(services, text) {
  const value = normalizeForMatch(text);
  if (!value) return null;

  const groups = [
    { keys: ['primera consulta', 'consulta', 'valoracion', 'revision', 'diagnostico'], names: ['consulta', 'valoracion', 'revision', 'diagnostico'] },
    { keys: ['limpieza', 'profilaxis'], names: ['limpieza', 'profilaxis'] },
    { keys: ['resina', 'resinas', 'relleno'], names: ['resina', 'relleno'] },
    { keys: ['rx', 'rayos x', 'radiografia'], names: ['rx', 'rayos', 'radiografia'] },
    { keys: ['extraccion', 'sacar muela', 'sacar diente'], names: ['extraccion'] },
    { keys: ['endodoncia'], names: ['endodoncia'] },
    { keys: ['placa removible', 'placa'], names: ['placa'] },
    { keys: ['corona zirconia', 'zirconia', 'corona'], names: ['corona', 'zirconia'] },
    { keys: ['cirugia'], names: ['cirugia'] },
    { keys: ['blanqueamiento'], names: ['blanqueamiento'] },
    { keys: ['brackets', 'ortodoncia'], names: ['bracket', 'ortodoncia'] },
  ];

  let best = null;
  for (const service of services || []) {
    const name = normalizeForMatch(service.name);
    if (!name) continue;

    let score = 0;
    if (value.includes(name)) score = 3000 + name.length;
    else if (name.includes(value) && value.length >= 4) score = 2000 + value.length;

    for (const group of groups) {
      const userHas = group.keys.some((key) => value.includes(normalizeForMatch(key)));
      const serviceHas = group.names.some((key) => name.includes(normalizeForMatch(key)));
      if (userHas && serviceHas) score = Math.max(score, 2500 + name.length);
    }

    if (score && (!best || score > best.score)) {
      best = { id: String(service.id), name: service.name, score };
    }
  }

  return best;
}

function extractName(text, stage) {
  if (stage !== 'collect_name') return null;
  const raw = asText(text).trim().replace(/^a nombre de\s+/i, '');
  if (!/^[a-záéíóúñü.' -]{2,80}$/i.test(raw)) return null;
  if (isAffirmative(raw) || isNegative(raw) || looksLikeBookingIntent(raw)) return null;
  return raw.replace(/\s+/g, ' ').trim();
}

function parseTimePreference(text) {
  const raw = asText(text);
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(raw) || /\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/.test(raw)) return null;
  const value = normalizeForMatch(raw);

  // Una hora explícita siempre tiene prioridad sobre "por la mañana/tarde".
  const match = value.match(/\b(?:a\s+las?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    let meridiem = match[3] || null;

    if (hour > 23 || minute > 59) return null;

    if (!meridiem) {
      if (/\b(manana|temprano)\b/.test(value)) meridiem = 'am';
      else if (/\b(tarde|noche)\b/.test(value)) meridiem = 'pm';
    }

    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (!meridiem && hour >= 1 && hour <= 7) hour += 12;

    const target = hour * 60 + minute;
    const normalizedTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

    return {
      label: `a las ${formatTime(normalizedTime)}`,
      min: target,
      max: target,
      target,
      exact: true,
      requested_time: normalizedTime,
    };
  }

  if (/\b(en la manana|por la manana|temprano)\b/.test(value)) {
    return { label: 'por la mañana', min: 8 * 60, max: 12 * 60, exact: false };
  }
  if (/\b(medio dia|mediodia)\b/.test(value)) {
    return { label: 'al mediodía', min: 11 * 60, max: 14 * 60, exact: false };
  }
  if (/\b(en la tarde|por la tarde)\b/.test(value)) {
    return { label: 'por la tarde', min: 12 * 60, max: 18 * 60, exact: false };
  }
  if (/\b(en la noche|por la noche)\b/.test(value)) {
    return { label: 'por la tarde-noche', min: 17 * 60, max: 20 * 60, exact: false };
  }

  return null;
}

function timeToMins(time) {
  const [hour, minute] = asText(time).slice(0, 5).split(':').map(Number);
  return hour * 60 + (minute || 0);
}

function formatTime(time) {
  const [hourRaw, minuteRaw] = asText(time).slice(0, 5).split(':');
  const hour = Number(hourRaw);
  const minute = String(minuteRaw || '00').padStart(2, '0');
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

function formatDateSpanish(value) {
  if (!value) return '';

  let date;

  if (value instanceof Date) {
    date = new Date(value.getTime());
  } else {
    const raw = asText(value).trim();
    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);

    if (isoMatch) {
      date = new Date(Date.UTC(
        Number(isoMatch[1]),
        Number(isoMatch[2]) - 1,
        Number(isoMatch[3]),
        12, 0, 0
      ));
    } else {
      date = new Date(raw);
    }
  }

  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    console.warn('⚠️ Fecha inválida recibida al cerrar cita:', value);
    return asText(value).slice(0, 10);
  }

  return new Intl.DateTimeFormat('es-MX', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function clearSlotState(state) {
  state.options = [];
  state.slot_index = 0;
  state.current_slot = null;
  state.selected_slot = null;
  state.slot_rejections = 0;
  state.confirmation_requested = false;
  state.exact_time_unavailable = false;
  return state;
}

function cleanReset(state, keep = {}) {
  const reset = resetBooking(state, keep);
  reset.pending_service_text = null;
  reset.service_name = null;
  reset.selected_slot = null;
  reset.current_slot = null;
  reset.slot_index = 0;
  reset.slot_rejections = 0;
  reset.confirmation_requested = false;
  reset.time_pref = null;
  reset.exact_time_unavailable = false;
  return reset;
}

function startBooking(state, ctx, text) {
  const fresh = cleanReset(state, {
    branch_key: state.branch_key || null,
    phone: normalizePhone(state.phone || ctx.phone) || state.phone || ctx.phone || null,
  });
  fresh.stage = 'collect_branch';
  fresh.intent = 'booking';
  fresh.booking_started_at_ms = Date.now();
  fresh.pending_service_text = looksLikeServiceRequest(text) ? text : null;
  return fresh;
}

function servicePrompt(services) {
  const names = (services || []).slice(0, 4).map((service) => service.name).filter(Boolean);
  const examples = names.length ? names.join(', ') : 'consulta, limpieza o resina';
  return `Con gusto 😊 ¿Qué tratamiento necesitas? Por ejemplo: ${examples}.`;
}

function branchPrompt() {
  return 'Claro 😊 ¿En cuál sucursal deseas atenderte: Victoria o Condesa?';
}

function datePrompt(branchKey) {
  return `Perfecto, en sucursal ${getBranchDisplayName(branchKey)}. ¿Qué día te gustaría tu cita?`;
}

function slotPrompt(slot) {
  return `Tengo disponibilidad el ${formatDateSpanish(slot.date)} a las ${formatTime(slot.start_time)}. ¿Te funciona ese horario?`;
}

function summaryPrompt(state) {
  return [
    'Perfecto 😊 Antes de registrarla, confirmemos:',
    `• Nombre: ${state.patient}`,
    `• Servicio: ${state.service_name || 'Tratamiento solicitado'}`,
    `• Fecha: ${formatDateSpanish(state.selected_slot.date)}`,
    `• Hora: ${formatTime(state.selected_slot.start_time)}`,
    `• Sucursal: ${getBranchDisplayName(state.branch_key)}`,
    '',
    '¿Confirmas que deseas agendar esta cita?',
  ].join('\n');
}

async function logTenantEvent(q, ctx, event, payload = {}) {
  try {
    const tenantId = String(ctx?.tenant_id || ctx?.clinic_id || '').trim();
    if (!tenantId) return;
    await q(
      `INSERT INTO ai_logs(tenant_id, clinic_id, conversation_id, event, payload)
       VALUES ($1::uuid, $1::text, $2, $3, $4::jsonb)`,
      [tenantId, ctx.conversationId || null, String(event), JSON.stringify(payload || {})],
    );
  } catch (error) {
    console.warn('⚠️ logTenantEvent ignored:', error.message);
  }
}


function pendingBookingPrompt(state, services = []) {
  if (!state || state.intent !== 'booking') return '';

  if (!state.branch_key) {
    return branchPrompt();
  }

  if (!state.service_id) {
    return servicePrompt(services);
  }

  if (!state.date) {
    return datePrompt(state.branch_key);
  }

  if (state.stage === 'offer_slot' && state.current_slot) {
    return `Seguimos con tu cita: tengo disponible a las ${formatTime(state.current_slot.start_time)}. ¿Te funciona ese horario?`;
  }

  if (state.stage === 'collect_name') {
    return 'Para continuar con la cita, ¿a nombre de quién la registramos?';
  }

  if (state.stage === 'collect_phone') {
    return 'Para continuar, ¿qué número de teléfono deseas dejar para el recordatorio?';
  }

  if (state.stage === 'final_confirm' && state.selected_slot) {
    return finalConfirmationText(state);
  }

  return '';
}

function joinInformationAndResume(infoReply, resumePrompt) {
  const info = asText(infoReply).trim();
  const resume = asText(resumePrompt).trim();

  if (!resume) return info;
  if (!info) return resume;

  // Evita que el modelo repita exactamente la pregunta pendiente.
  const normalizedInfo = normalizeForMatch(info);
  const normalizedResume = normalizeForMatch(resume);
  if (normalizedInfo.includes(normalizedResume)) return info;

  return `${info}\n\n${resume}`;
}

async function friendlyAIReply(ctx, state, userText) {
  try {
    const aiResponse = await generateAIReply({
      userText,
      context: {
        role: 'Recepcionista profesional y amable de una clínica dental',
        objective: state.intent === 'booking' ? 'Ayudar sin perder el flujo de la cita' : 'Atender la pregunta del paciente',
        conversationState: state.stage || 'idle',
        knownData: {
          branch: state.branch_key || null,
          service: state.service_name || null,
          date: state.date || null,
          patient: state.patient || null,
        },
        rules: [
          'Responde en español, con tono cálido y profesional.',
          'No inventes precios, horarios, doctores, direcciones ni promociones.',
          'Responde primero y directamente la pregunta informativa del paciente.',
          'Si pregunta un precio y no está en el contexto disponible, dilo con honestidad y no inventes una cantidad.',
          'No repitas saludos ni preguntas ya contestadas.',
          'Usa máximo tres oraciones breves.',
          'No muestres calendarios ni listas de doctores.',
        ],
        clinic_id: ctx.clinic_id,
        channel: ctx.channel,
      },
    });
    return aiResponse?.text || aiResponse || '¡Hola! 😊 ¿En qué puedo ayudarte hoy?';
  } catch (error) {
    console.error('❌ AI fallback error:', error.message);
    return '¡Hola! 😊 Con gusto te ayudo. ¿Deseas información o agendar una cita?';
  }
}

async function loadAndFilterSlots(q, ctx, state) {
  const preference = state.time_pref || null;
  const { slots } = await computeAvailability(q, {
    clinic_id: ctx.clinic_id,
    branch_key: state.branch_key,
    date: state.date,
    duration_hours: Number(state.duration_hours || 1),
    limit: Number(process.env.AI_AVAILABILITY_LIMIT || 50),
    min_start_mins: preference?.exact ? null : (preference?.min ?? null),
  });

  const allSlots = Array.isArray(slots) ? slots : [];
  let filtered = allSlots;
  state.exact_time_unavailable = false;

  if (preference?.exact && preference?.target != null) {
    const exactMatches = allSlots.filter((slot) => timeToMins(slot.start_time) === preference.target);

    if (exactMatches.length) {
      filtered = exactMatches;
    } else {
      state.exact_time_unavailable = true;
      filtered = [...allSlots]
        .sort((a, b) => {
          return Math.abs(timeToMins(a.start_time) - preference.target)
            - Math.abs(timeToMins(b.start_time) - preference.target);
        })
        .slice(0, 5);
    }
  } else {
    if (preference?.max != null) {
      const withinRange = filtered.filter((slot) => timeToMins(slot.start_time) <= preference.max);
      if (withinRange.length) filtered = withinRange;
    }

    if (preference?.target != null) {
      filtered = [...filtered].sort((a, b) => {
        return Math.abs(timeToMins(a.start_time) - preference.target)
          - Math.abs(timeToMins(b.start_time) - preference.target);
      });
    }
  }

  state.options = filtered;
  state.slot_index = 0;
  state.current_slot = filtered[0] || null;
  return filtered;
}

function advanceSlot(state) {
  const options = Array.isArray(state.options) ? state.options : [];
  const nextIndex = Number(state.slot_index || 0) + 1;
  state.slot_index = nextIndex;
  state.slot_rejections = Number(state.slot_rejections || 0) + 1;
  state.current_slot = options[nextIndex] || null;
  return state.current_slot;
}

function applyRevisionRequest(state, text) {
  const value = normalizeForMatch(text);

  if (/\b(sucursal|victoria|condesa)\b/.test(value)) {
    state.branch_key = normBranch(text) || null;
    state.date = null;
    clearSlotState(state);
    state.stage = state.branch_key ? 'collect_date' : 'collect_branch';
    return true;
  }

  if (/\b(servicio|tratamiento|limpieza|consulta|resina|extraccion|endodoncia|corona)\b/.test(value)) {
    state.service_id = null;
    state.service_name = null;
    state.pending_service_text = text;
    clearSlotState(state);
    state.stage = 'collect_service';
    return true;
  }

  if (/\b(dia|fecha|hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(value)) {
    state.date = parseDateFromText(text);
    clearSlotState(state);
    state.stage = state.date ? 'offer_slot' : 'collect_date';
    return true;
  }

  if (/\b(hora|horario|temprano|tarde|noche)\b/.test(value)) {
    state.time_pref = parseTimePreference(text);
    state.selected_slot = null;
    state.current_slot = null;
    state.options = [];
    state.slot_index = 0;
    state.stage = 'offer_slot';
    return true;
  }

  if (/\b(nombre|paciente)\b/.test(value)) {
    state.patient = null;
    state.stage = 'collect_name';
    return true;
  }

  return false;
}


function bookingFingerprint(state) {
  return JSON.stringify({
    stage: state.stage || null,
    branch: state.branch_key || null,
    service: state.service_id || null,
    date: state.date || null,
    time: state.current_slot?.start_time || state.selected_slot?.start_time || state.time_pref?.requested_time || null,
    patient: state.patient || null,
    phone: state.phone || null,
  });
}

function missingBookingField(state) {
  if (!state.branch_key) return 'branch';
  if (!state.service_id) return 'service';
  if (!state.date) return 'date';
  if (!state.selected_slot && !state.current_slot) return 'slot';
  if (!state.selected_slot) return 'slot_confirmation';
  if (!state.phone) return 'phone';
  if (!state.patient) return 'name';
  return 'final_confirmation';
}

function recoveryPrompt(state) {
  const missing = missingBookingField(state);
  const known = [
    state.branch_key ? `sucursal ${getBranchDisplayName(state.branch_key)}` : null,
    state.service_name ? `servicio ${state.service_name}` : null,
    state.date ? `fecha ${formatDateSpanish(state.date)}` : null,
    (state.selected_slot || state.current_slot)?.start_time
      ? `hora ${formatTime((state.selected_slot || state.current_slot).start_time)}`
      : null,
    state.patient ? `nombre ${state.patient}` : null,
    state.phone ? `teléfono terminado en ${String(state.phone).slice(-4)}` : null,
  ].filter(Boolean);

  const prefix = known.length
    ? `Tengo registrado: ${known.join(', ')}.`
    : 'Vamos a continuar con tu cita.';

  const questions = {
    branch: '¿Prefieres sucursal Victoria o Condesa?',
    service: '¿Qué servicio o tratamiento necesitas?',
    date: '¿Qué día te gustaría asistir?',
    slot: '¿Qué hora prefieres aproximadamente?',
    slot_confirmation: `¿Confirmas el horario de las ${formatTime(state.current_slot?.start_time)}?`,
    phone: '¿Qué número de 10 dígitos deseas dejar para la confirmación?',
    name: '¿A nombre de quién registro la cita?',
    final_confirmation: '¿Confirmas todos los datos para guardar la cita en la agenda?',
  };

  return `${prefix}\n\n${questions[missing]}`;
}

function applyLoopProtection(result, userText) {
  const state = ensureStateDefaults(result?.state || {});
  const normalizedUser = normalizeForMatch(userText);
  const fingerprint = bookingFingerprint(state);
  const promptKey = String(result?.used || state.stage || 'reply');
  const reply = asText(result?.reply).trim();

  state.turn_count = Number(state.turn_count || 0) + 1;

  if (normalizedUser && normalizedUser === state.last_user_text) {
    state.same_user_text_count = Number(state.same_user_text_count || 0) + 1;
  } else {
    state.same_user_text_count = 0;
  }

  if (promptKey === state.last_prompt_key && fingerprint === state.last_fingerprint) {
    state.same_prompt_count = Number(state.same_prompt_count || 0) + 1;
  } else {
    state.same_prompt_count = 0;
  }

  state.recent_user_messages = [...(state.recent_user_messages || []), normalizedUser].slice(-6);
  state.recent_replies = [...(state.recent_replies || []), reply].slice(-6);
  state.prompt_history = [...(state.prompt_history || []), promptKey].slice(-12);

  state.last_user_text = normalizedUser;
  state.last_prompt_key = promptKey;
  state.last_fingerprint = fingerprint;
  state.last_reply = reply;

  if (state.same_prompt_count >= 2) {
    state.same_prompt_count = 0;
    return {
      ...result,
      reply: `${recoveryPrompt(state)}\n\nTambién puedes escribir “hablar con una persona”.`,
      state,
      used: 'loop_recovery',
    };
  }

  if (state.same_user_text_count >= 2) {
    state.same_user_text_count = 0;
    return {
      ...result,
      reply: `${recoveryPrompt(state)}\n\nParece que no interpreté bien tu respuesta. Puedes responder con una frase breve o pedir hablar con una persona.`,
      state,
      used: 'repeated_user_recovery',
    };
  }

  if (state.turn_count >= 35 && state.intent === 'booking') {
    state.turn_count = 0;
    return {
      ...result,
      reply: `${recoveryPrompt(state)}\n\nLa conversación se ha extendido bastante; no perderé los datos que ya me diste.`,
      state,
      used: 'long_conversation_recovery',
    };
  }

  return { ...result, state };
}

async function orchestrateCore(q, ctx, incomingState, userText) {
  let state = ensureStateDefaults(incomingState);
  const text = asText(userText).trim();

  if (humanHandoffIntent(text)) {
    state.handoff_requested = true;
    return {
      reply: 'Claro. Voy a dejar registrada tu solicitud para que una persona del equipo continúe contigo. Mientras tanto, conservaré los datos que ya proporcionaste.',
      state,
      used: 'human_handoff',
    };
  }

  if (restartIntent(text)) {
    const reset = cleanReset(state, {
      phone: normalizePhone(state.phone || ctx.phone) || state.phone || ctx.phone || null,
      branch_key: null,
    });
    return {
      reply: 'Empecemos de nuevo 😊 ¿En qué sucursal deseas tu cita: Victoria o Condesa?',
      state: { ...reset, intent: 'booking', stage: 'collect_branch', booking_started_at_ms: Date.now() },
      used: 'booking_restarted',
    };
  }

  if (gratitudeOnly(text) && state.stage === 'idle') {
    return { reply: 'Con gusto 😊 Estoy aquí para ayudarte cuando lo necesites.', state, used: 'gratitude' };
  }

  console.log('🤖 RECEPTIONIST V2', {
    text,
    stage: state.stage,
    branch: state.branch_key,
    date: state.date,
    service: state.service_id,
    slot: state.current_slot?.start_time || state.selected_slot?.start_time || null,
    time_pref: state.time_pref || null,
  });

  if (isBookingExpired(state)) {
    state = cleanReset(state, {
      branch_key: state.branch_key,
      phone: normalizePhone(state.phone || ctx.phone) || state.phone || ctx.phone || null,
    });
    await logTenantEvent(q, ctx, 'booking_expired', {});
  }

  if (cancelIntent(text)) {
    const reset = cleanReset(state, { phone: normalizePhone(state.phone || ctx.phone) || state.phone || ctx.phone || null });
    return { reply: 'Entendido 😊 Dejé sin efecto el proceso de cita. ¿En qué más puedo ayudarte?', state: reset, used: 'booking_cancelled' };
  }

  if (!state.phone) state.phone = normalizePhone(ctx.phone);

  const inBooking = state.intent === 'booking' || (state.stage && state.stage !== 'idle');

  if (!inBooking) {
    if (isInformationRequest(text)) {
      const reply = await friendlyAIReply(ctx, state, text);
      state.last_info_provided = true;
      state.last_info_question = normalizeForMatch(text);
      state.last_info_at = new Date().toISOString();
      return { reply, state, used: 'information_ai' };
    }

    if (looksLikeBookingIntent(text)) {
      state = startBooking(state, ctx, text);
    } else {
      const reply = await friendlyAIReply(ctx, state, text);
      state.last_info_provided = false;
      return { reply, state, used: 'friendly_ai' };
    }
  }

  // Extraer datos explícitos en cualquier turno sin volver a preguntarlos.
  const branch = normBranch(text);
  if (branch) state.branch_key = branch;

  const parsedDate = parseDateFromText(text);
  const preference = parseTimePreference(text);

  const dateChanged = Boolean(parsedDate && !isPastDate(parsedDate) && parsedDate !== state.date);
  const timeChanged = Boolean(
    preference &&
    (
      preference.target !== state.time_pref?.target ||
      preference.min !== state.time_pref?.min ||
      preference.max !== state.time_pref?.max
    )
  );

  if (dateChanged || timeChanged) {
    clearSlotState(state);
  }

  if (parsedDate && !isPastDate(parsedDate)) {
    state.date = parsedDate;
  }

  if (preference && ['collect_date', 'offer_slot', 'revise_confirmation'].includes(state.stage)) {
    state.time_pref = preference;
  }

  // Captura datos útiles aunque el paciente los envíe antes de que se soliciten.
  const phoneAnywhere = normalizePhone(text);
  if (phoneAnywhere && /\d/.test(text)) {
    state.phone = phoneAnywhere;
  }

  if (!state.patient && !isAffirmative(text) && !isNegative(text) && !isInformationRequest(text)) {
    const possibleName = asText(text).trim().replace(/^a nombre de\s+/i, '');
    if (/^[a-záéíóúñü.' -]{2,80}$/i.test(possibleName)
        && !looksLikeBookingIntent(possibleName)
        && !normBranch(possibleName)
        && !parseDateFromText(possibleName)
        && !parseTimePreference(possibleName)) {
      if (state.stage === 'collect_name' || /\b(me llamo|soy|a nombre de)\b/i.test(text)) {
        state.patient = possibleName.replace(/^(me llamo|soy|a nombre de)\s+/i, '').trim();
      }
    }
  }

  // Una pregunta informativa puede aparecer en cualquier momento del agendamiento.
  // Se responde sin reiniciar el estado ni convertirla por error en una nueva etapa.
  if (inBooking && isInformationRequest(text)) {
    const servicesForInfo = state.branch_key
      ? await getServices(q, state.branch_key)
      : [];

    // Si menciona un servicio, lo recordamos, pero no avanzamos como si hubiera
    // respondido una pregunta diferente.
    const mentionedService = findServiceByText(servicesForInfo, text);
    if (mentionedService && !state.service_id) {
      state.service_id = mentionedService.id;
      state.service_name = mentionedService.name;
      state.pending_service_text = null;
    }

    const infoReply = await friendlyAIReply(ctx, state, text);
    const resumePrompt = pendingBookingPrompt(state, servicesForInfo);

    state.last_info_provided = true;
    state.last_info_question = normalizeForMatch(text);
    state.last_info_at = new Date().toISOString();

    return {
      reply: joinInformationAndResume(infoReply, resumePrompt),
      state,
      used: 'booking_information_interruption',
    };
  }

  if (state.stage === 'revise_confirmation') {
    if (!applyRevisionRequest(state, text)) {
      return {
        reply: 'Claro 😊 ¿Qué deseas cambiar: el día, la hora, la sucursal, el tratamiento o el nombre?',
        state,
        used: 'ask_revision',
      };
    }
  }

  if (!state.branch_key) {
    state.stage = 'collect_branch';
    return { reply: branchPrompt(), state, used: 'ask_branch' };
  }

  const services = await getServices(q, state.branch_key);
  const serviceMatch = findServiceByText(services, text) || findServiceByText(services, state.pending_service_text);
  if (serviceMatch) {
    if (state.service_id && state.service_id !== serviceMatch.id) clearSlotState(state);
    state.service_id = serviceMatch.id;
    state.service_name = serviceMatch.name;
    state.pending_service_text = null;
  }

  if (!state.service_id) {
    state.stage = 'collect_service';
    return { reply: servicePrompt(services), state, used: 'ask_service' };
  }

  if (!state.date) {
    state.stage = 'collect_date';
    return { reply: datePrompt(state.branch_key), state, used: 'ask_date' };
  }

  if (isPastDate(state.date)) {
    state.date = null;
    clearSlotState(state);
    state.stage = 'collect_date';
    return { reply: 'Esa fecha ya pasó 😊 ¿Qué día futuro te gustaría?', state, used: 'ask_future_date' };
  }

  // Respuesta a un horario que ya fue ofrecido.
  if (state.stage === 'offer_slot' && state.current_slot) {
    if (isAffirmative(text)) {
      state.selected_slot = state.current_slot;
      state.current_slot = null;
      state.stage = state.patient ? 'final_confirm' : 'collect_name';
    } else if (isNegative(text)) {
      const next = advanceSlot(state);
      if (next) {
        return { reply: `Claro 😊 También tengo a las ${formatTime(next.start_time)}. ¿Ese horario te funciona?`, state, used: 'offer_next_slot' };
      }

      state.date = null;
      clearSlotState(state);
      state.stage = 'collect_date';
      return { reply: 'Por ese día ya no tengo otra opción disponible. ¿Qué otro día te gustaría?', state, used: 'ask_another_date' };
    } else {
      if (!parsedDate && !preference) {
        return {
          reply: `Para asegurarme 😊 ¿te funciona el horario de las ${formatTime(state.current_slot.start_time)}? Puedes responder “sí” o pedir otra hora.`,
          state,
          used: 'clarify_slot',
        };
      }
    }
  }

  if (!state.selected_slot) {
    if (!state.current_slot || !Array.isArray(state.options) || !state.options.length) {
      const slots = await loadAndFilterSlots(q, ctx, state);
      if (!slots.length) {
        state.date = null;
        clearSlotState(state);
        state.stage = 'collect_date';
        return { reply: 'No encontré disponibilidad ese día 😕 ¿Qué otro día te gustaría?', state, used: 'no_slots' };
      }
    }

    state.stage = 'offer_slot';

    if (state.exact_time_unavailable && state.time_pref?.requested_time) {
      return {
        reply: `A las ${formatTime(state.time_pref.requested_time)} no tengo espacio disponible ese día. La opción más cercana es a las ${formatTime(state.current_slot.start_time)}. ¿Te funciona?`,
        state,
        used: 'offer_nearest_slot',
      };
    }

    return { reply: slotPrompt(state.current_slot), state, used: 'offer_one_slot' };
  }

  if (!state.phone) {
    const phone = normalizePhone(text);
    if (phone) state.phone = phone;
  }
  if (!state.phone) {
    state.stage = 'collect_phone';
    return { reply: '¿A qué número de 10 dígitos te enviamos la confirmación?', state, used: 'ask_phone' };
  }

  if (state.stage === 'collect_phone') {
    const phone = normalizePhone(text);
    if (!phone) {
      return { reply: 'Por favor envíame el número con 10 dígitos 😊', state, used: 'ask_phone_retry' };
    }
    state.phone = phone;
  }

  const patientName = extractName(text, state.stage);
  if (patientName) state.patient = patientName;

  if (!state.patient) {
    state.stage = 'collect_name';
    return { reply: 'Perfecto 😊 ¿A nombre de quién agendamos la cita?', state, used: 'ask_name' };
  }

  if (state.stage !== 'final_confirm') {
    state.stage = 'final_confirm';
    state.confirmation_requested = true;
    return { reply: summaryPrompt(state), state, used: 'request_final_confirmation' };
  }

  if (!isAffirmative(text)) {
    const containsCorrection =
      Boolean(normBranch(text))
      || Boolean(parseDateFromText(text))
      || Boolean(parseTimePreference(text))
      || Boolean(findServiceByText(services, text))
      || /\b(nombre|telefono|numero)\b/.test(normalizeForMatch(text));

    if (isNegative(text) || containsCorrection) {
      state.stage = 'revise_confirmation';
      if (applyRevisionRequest(state, text)) {
        if (state.stage === 'collect_branch') return { reply: branchPrompt(), state, used: 'revise_branch' };
        if (state.stage === 'collect_service') return { reply: servicePrompt(services), state, used: 'revise_service' };
        if (state.stage === 'collect_date') return { reply: datePrompt(state.branch_key), state, used: 'revise_date' };
        // Para fecha/hora ya indicada, el siguiente bloque calculará una nueva opción.
      } else {
        return {
          reply: 'No hay problema 😊 ¿Qué deseas cambiar: el día, la hora, la sucursal, el tratamiento o el nombre?',
          state,
          used: 'revise_confirmation',
        };
      }
    }

    return {
      reply: 'Para registrar la cita necesito tu confirmación 😊 Responde “sí, confirmo” o dime qué deseas cambiar.',
      state,
      used: 'clarify_final_confirmation',
    };
  }

  try {
    const resolvedTenantId = String(ctx?.tenant_id || ctx?.clinic_id || '').trim();
    if (!resolvedTenantId) {
      throw new Error('No se pudo identificar la empresa para crear la cita');
    }

    const created = await createAppointmentTransactional(q, {
      tenant_id: resolvedTenantId,
      clinic_id: ctx.clinic_id || resolvedTenantId,
      branch_key: state.branch_key,
      patient: state.patient,
      phone: state.phone,
      service_id: state.service_id,
      slot: state.selected_slot,
    });

    if (!created?.id || !created?.verified) {
      throw new Error('La cita no pudo verificarse en la agenda');
    }

    const branchName = getBranchDisplayName(state.branch_key);
    const serviceName = state.service_name;
    const keptPhone = state.phone;
    const keptBranch = state.branch_key;
    const reset = cleanReset(state, { phone: keptPhone, branch_key: keptBranch });

    await logTenantEvent(q, ctx, 'appointment_booked', {
      appointment_id: created.id,
      branch_key: keptBranch,
      service_id: state.service_id,
      date: created.date,
      start_time: created.start_time,
    });

    const confirmedDate = formatDateSpanish(created.date);
    const confirmedTime = formatTime(created.start_time);

    return {
      reply: [
        '✅ Tu cita quedó confirmada.',
        `• Nombre: ${created.patient}`,
        serviceName ? `• Servicio: ${serviceName}` : null,
        `• Fecha: ${confirmedDate}`,
        `• Hora: ${confirmedTime}`,
        `• Sucursal: ${branchName}`,
        '',
        'Te esperamos 😊',
      ].filter(Boolean).join('\n'),
      state: reset,
      used: 'appointment_booked',
    };
  } catch (error) {
    if (/horario ya fue tomado/i.test(error.message)) {
      clearSlotState(state);
      state.stage = 'offer_slot';
      const slots = await loadAndFilterSlots(q, ctx, state);
      if (slots.length) {
        return {
          reply: `Ese horario acaba de ocuparse, pero tengo disponible a las ${formatTime(state.current_slot.start_time)}. ¿Te funciona?`,
          state,
          used: 'slot_taken_offer_next',
        };
      }
      state.date = null;
      state.stage = 'collect_date';
      return { reply: 'Ese horario acaba de ocuparse y ya no veo más espacios ese día. ¿Qué otro día te gustaría?', state, used: 'slot_taken_no_more' };
    }

    console.error('❌ Error final al crear cita desde IA:', {
      message: String(error?.message || error),
      tenantId: String(ctx?.tenant_id || ctx?.clinic_id || ''),
      branch: state.branch_key,
      date: state.selected_slot?.date || state.date,
      time: state.selected_slot?.start_time || null,
      serviceId: state.service_id,
    });

    state.stage = 'final_confirm';
    state.confirmation_requested = true;

    return {
      reply: 'Tuve un problema al guardar la cita en la agenda. No se perdió la información. Por favor responde “sí” para intentarlo nuevamente o dime si deseas cambiar algún dato.',
      state,
      used: 'appointment_create_retry',
    };
  }
}

async function orchestrate(q, ctx, incomingState, userText) {
  const result = await orchestrateCore(q, ctx, incomingState, userText);
  return applyLoopProtection(result, userText);
}

module.exports = {
  orchestrate,
  __test: {
    normalizeForMatch,
    parseDateFromText,
    parseTimePreference,
    normalizePhone,
    isAffirmative,
    isNegative,
    isInformationRequest,
    looksLikeBookingIntent,
    bookingFingerprint,
    missingBookingField,
    recoveryPrompt,
  },
};

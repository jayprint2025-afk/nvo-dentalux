// modules/ai-orchestrator.js
const { normBranch, getBranchDisplayName } = require('./tenant-context');
const { ensureStateDefaults, isBookingExpired, resetBooking, logEvent } = require('./conversation-state');
const { getServices, computeAvailability, createAppointmentTransactional } = require('./booking-engine');
const { generateAIReply } = require('../ai/assistant');

function asText(v) { return (v === null || v === undefined) ? '' : String(v); }
function normalizeForMatch(v) {
  return asText(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function parseDateFromText(text) {
  const t = asText(text).toLowerCase().trim();
  const m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date();
  if (/(^|\s)(hoy|today)(\s|$)/i.test(t)) return d.toISOString().slice(0,10);
  if (/(^|\s)(ma[ñn]ana|tomorrow)(\s|$)/i.test(t)) { d.setDate(d.getDate()+1); return d.toISOString().slice(0,10); }
  if (/(^|\s)(pasado\s*ma[ñn]ana)(\s|$)/i.test(t)) { d.setDate(d.getDate()+2); return d.toISOString().slice(0,10); }
  const days = { lunes:1, martes:2, miercoles:3, miércoles:3, jueves:4, viernes:5, sabado:6, sábado:6, domingo:0 };
  for (const [name,target] of Object.entries(days)) {
    if (new RegExp(`(^|\\s)${name}(\\s|$)`, 'i').test(t)) {
      const now = new Date(); let add = target - now.getDay(); if (add <= 0) add += 7; now.setDate(now.getDate()+add); return now.toISOString().slice(0,10);
    }
  }
  return null;
}
function normalizePhone(raw) {
  const digits = asText(raw).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('521') && digits.length >= 13) return digits.slice(3,13);
  if (digits.startsWith('52') && digits.length >= 12) return digits.slice(2,12);
  if (digits.length === 10) return digits;
  return digits.slice(-10) || null;
}
function isAffirmative(text) { return /^(s[ií]|si|claro|ok|va|sale|perfecto|correcto|yes|adelante)$/i.test(asText(text).trim()); }
function cancelIntent(text) { return /(ya no|no me interesa|cancelar|olvidalo|olvídalo|mejor no|ya no quiero|salir|reiniciar|menu)/i.test(asText(text)); }
function looksLikeBookingIntent(text) {
  const t = normalizeForMatch(text);
  if (/\b(agendar|agenda|reservar|programar|cita|consulta|quiero agendar|quiero cita|necesito cita)\b/.test(t)) return true;
  return looksLikeServiceRequest(text);
}
function looksLikeServiceRequest(text) {
  const t = normalizeForMatch(text);
  return /\b(primera consulta|consulta|valoracion|revision|diagnostico|limpieza|profilaxis|resina|resinas|rx|rayos x|radiografia|extraccion|endodoncia|placa|corona|zirconia|cirugia)\b/.test(t);
}
function findServiceIdByText(services, text) {
  const t = normalizeForMatch(text);
  if (!t) return null;
  const groups = [
    { keys:['primera consulta','consulta','valoracion','revision','diagnostico'], names:['consulta','valoracion','revision','diagnostico'] },
    { keys:['limpieza','profilaxis'], names:['limpieza','profilaxis'] },
    { keys:['resina','resinas'], names:['resina'] },
    { keys:['rx','rayos x','radiografia'], names:['rx','rayos','radiografia'] },
    { keys:['extraccion','sacar muela','sacar diente'], names:['extraccion'] },
    { keys:['endodoncia'], names:['endodoncia'] },
    { keys:['placa removible','placa'], names:['placa'] },
    { keys:['corona zirconia','zirconia','corona'], names:['corona','zirconia'] },
    { keys:['cirugia'], names:['cirugia'] },
  ];
  let best = null;
  for (const s of services || []) {
    const name = normalizeForMatch(s.name);
    if (!name) continue;
    if (t.includes(name) || name.includes(t)) {
      const score = 1000 + Math.max(t.length, name.length);
      if (!best || score > best.score) best = { id:String(s.id), score };
    }
    for (const g of groups) {
      const userHas = g.keys.some(k => t.includes(normalizeForMatch(k)));
      const serviceHas = g.names.some(n => name.includes(normalizeForMatch(n)));
      if (userHas && serviceHas) {
        const score = 2000 + name.length;
        if (!best || score > best.score) best = { id:String(s.id), score };
      }
    }
  }
  return best?.id || null;
}
function isInformationRequest(text) {
  const t = normalizeForMatch(text);
  if (/\b(direccion|ubicacion|donde|como llegar|mapa|telefono|whatsapp|contacto|horario|horarios|abre|cierra|promocion|oferta|precio|costo)\b/.test(t) && !looksLikeBookingIntent(text)) return true;
  return false;
}
function buildSlotsText(slots) {
  if (!slots.length) return `No encontré horarios disponibles ese día 😕\n¿Quieres probar otro día?`;
  const lines = slots.map((s, i) => `${i+1}) ${s.date} ${s.start_time} (Dr. ${s.doctor_name})`);
  return `Listo ✅ Encontré estos horarios disponibles:\n${lines.join('\n')}\n\nResponde con el número para agendar.`;
}
function askServiceText(services) {
  const top = (services || []).slice(0, 12).map(s => `- ${s.name}`).join('\n') || '- primera consulta\n- Limpieza\n- Resina\n- Extracción';
  return `Perfecto ✅\n¿Qué tratamiento necesitas?\n\nServicios frecuentes:\n${top}\n\nEscríbelo tal cual (ej: "primera consulta").`;
}
async function fallbackAI(ctx, state, userText) {
  try {
    const aiResponse = await generateAIReply({ userText, context: { conversationState: state.stage || 'idle', clinic_id: ctx.clinic_id, channel: ctx.channel } });
    return aiResponse?.text || aiResponse || '¡Hola! 😊 ¿En qué puedo ayudarte hoy?';
  } catch (e) {
    console.error('❌ AI fallback error:', e.message);
    return '¡Hola! 😊 ¿En qué puedo ayudarte hoy? (citas, horarios, ubicación)';
  }
}

async function orchestrate(q, ctx, state, userText) {
  state = ensureStateDefaults(state);
  const text = asText(userText).trim();
  console.log('🤖 ORCHESTRATOR STABLE', { text, stage: state.stage, branch: state.branch_key, date: state.date, service: state.service_id, phone: state.phone || ctx.phone });

  if (isBookingExpired(state)) {
    state = resetBooking(state, { branch_key: state.branch_key, phone: state.phone || ctx.phone });
    await logEvent(q, { clinic_id: ctx.clinic_id, conversation_id: ctx.conversationId, event: 'booking_expired', payload: {} });
  }
  if (cancelIntent(text)) {
    const reset = resetBooking(state, { phone: state.phone || ctx.phone });
    return { reply: 'Entendido 😊 cancelé el proceso. ¿En qué más puedo ayudarte?', state: reset, used: 'cancel' };
  }

  // Actualizar datos naturales en cualquier turno.
  const b = normBranch(text);
  if (b) state.branch_key = b;
  const d = parseDateFromText(text);
  if (d) state.date = d;
  if (!state.phone && ctx.phone) state.phone = normalizePhone(ctx.phone) || ctx.phone;

  // Si está en flujo de agenda, NUNCA caer al saludo genérico.
  const inBooking = state.stage && state.stage !== 'idle';

  if (!inBooking && isInformationRequest(text)) {
    const reply = await fallbackAI(ctx, state, text);
    state.last_info_provided = true;
    return { reply, state, used: 'info_ai' };
  }

  if (!inBooking && looksLikeBookingIntent(text)) {
    state.stage = 'collect_branch';
    state.booking_started_at_ms = Date.now();
    state.pending_service_text = looksLikeServiceRequest(text) ? text : state.pending_service_text;
  } else if (!inBooking) {
    const reply = await fallbackAI(ctx, state, text);
    return { reply, state, used: 'ai_chat' };
  }

  // Si el usuario dijo "sí" dentro del flujo, sólo repetimos la siguiente pregunta necesaria.
  // No se manda al fallback.

  if (!state.branch_key) {
    state.stage = 'collect_branch';
    return { reply: 'Claro 😊 ¿En cuál sucursal te atendemos?\n1) Victoria\n2) Condesa\n\nResponde con 1 o 2.', state, used: 'ask_branch' };
  }

  const services = await getServices(q, state.branch_key);
  // FIX DIRECTO: si estamos esperando tratamiento, procesarlo aquí
  if (state.stage === 'collect_service' && !state.service_id) {
    let sid = findServiceIdByText(services, text);

    if (!sid && /primera\s+consulta|consulta|valoracion|valoraci[oó]n|revision|revisi[oó]n/i.test(text)) {
      const svc = services.find(s => {
        const n = normalizeForMatch(s.name);
        return n.includes('consulta') || n.includes('valoracion') || n.includes('revision');
      });
      if (svc) sid = String(svc.id);
    }

    if (sid) {
      state.service_id = sid;
      state.pending_service_text = null;
    } else {
      state.stage = 'collect_service';
      return {
        reply: askServiceText(services),
        state,
        used: 'ask_service_retry'
      };
    }
  }
  if (!state.service_id) {
    const sid = findServiceIdByText(services, text) || findServiceIdByText(services, state.pending_service_text);
    if (sid) { state.service_id = sid; state.pending_service_text = null; }
  }

  if (!state.date) {
    state.stage = 'collect_date';
    return { reply: `Perfecto, sucursal ${getBranchDisplayName(state.branch_key)} ✅\n¿Para qué día te gustaría tu cita? (ej: 2026-05-05, hoy o mañana)`, state, used: 'ask_date' };
  }

  if (!state.service_id) {
    state.stage = 'collect_service';
    return { reply: askServiceText(services), state, used: 'ask_service' };
  }

  // Si venimos de mostrar opciones, primero intentar seleccionar por número.
  const pick = text.match(/^\s*(\d{1,2})\s*$/);
  if (pick && Array.isArray(state.options) && state.options.length) {
    const idx = Number(pick[1]) - 1;
    if (idx >= 0 && idx < state.options.length) {
      state.selected_slot = state.options[idx];
      state.options = [];
      state.stage = 'confirm';
    }
  }

  if (!state.selected_slot) {
    state.stage = 'offer_slots';
    const { slots } = await computeAvailability(q, {
      clinic_id: ctx.clinic_id,
      branch_key: state.branch_key,
      date: state.date,
      duration_hours: Number(state.duration_hours || 1),
      limit: Number(process.env.AI_AVAILABILITY_LIMIT || 50),
      min_start_mins: state.min_start_mins ?? null,
    });
    state.options = slots;
    return { reply: buildSlotsText(slots), state, used: 'offer_slots' };
  }

  if (!state.phone && ctx.phone) state.phone = normalizePhone(ctx.phone) || ctx.phone;
  if (!state.phone) {
    state.stage = 'confirm';
    return { reply: '📱 ¿A qué número te enviamos el recordatorio? (10 dígitos)', state, used: 'ask_phone' };
  }

  if (!state.patient) {
    const looksName = /^[a-záéíóúñ\s]{3,60}$/i.test(text) && !/\d/.test(text) && !isAffirmative(text) && !looksLikeBookingIntent(text);
    if (looksName) state.patient = text;
  }
  if (!state.patient) {
    state.stage = 'confirm';
    return { reply: '¿A nombre de quién agendamos? (solo tu nombre 😊)', state, used: 'ask_name' };
  }

  const created = await createAppointmentTransactional(q, {
    clinic_id: ctx.clinic_id,
    branch_key: state.branch_key,
    patient: state.patient,
    phone: state.phone,
    service_id: state.service_id,
    slot: state.selected_slot,
  });

  const branch = getBranchDisplayName(state.branch_key);
  const reset = resetBooking(state, { phone: state.phone, branch_key: state.branch_key });
  return {
    reply: `✅ Tu cita quedó registrada:\n• Nombre: ${created.patient}\n• Fecha: ${created.date}\n• Hora: ${String(created.start_time).slice(0,5)}\n• Sucursal: ${branch}\n\nTe esperamos 😊`,
    state: reset,
    used: 'booked'
  };
}

module.exports = { orchestrate };

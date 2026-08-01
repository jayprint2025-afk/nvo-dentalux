'use strict';

const { sanitizeTurn } = require('./command-schema');
const { fallbackInterpret } = require('./fallback-interpreter');

function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[¿?¡!.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function localDateParts(timeZone = 'America/Phoenix', now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function isoDateInZoneOffset(days, timeZone = 'America/Phoenix', now = new Date()) {
  const base = localDateParts(timeZone, now);
  const utc = new Date(Date.UTC(base.year, base.month - 1, base.day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

function parseRelativeDate(text, timeZone = 'America/Phoenix', now = new Date()) {
  const n = normalize(text);
  if (/\bpasado manana\b/.test(n)) return isoDateInZoneOffset(2, timeZone, now);
  if (/\bmanana\b/.test(n)) return isoDateInZoneOffset(1, timeZone, now);
  if (/\bhoy\b/.test(n)) return isoDateInZoneOffset(0, timeZone, now);

  const weekdays = {
    domingo: 0, lunes: 1, martes: 2, miercoles: 3,
    jueves: 4, viernes: 5, sabado: 6,
  };
  const found = Object.keys(weekdays).find(name => new RegExp(`\\b${name}\\b`).test(n));
  if (!found) return null;

  const base = localDateParts(timeZone, now);
  const baseUtc = new Date(Date.UTC(base.year, base.month - 1, base.day));
  const currentDay = baseUtc.getUTCDay();
  let delta = (weekdays[found] - currentDay + 7) % 7;

  if (delta === 0 || /\bproximo\b/.test(n)) delta = delta === 0 ? 7 : delta;
  return isoDateInZoneOffset(delta, timeZone, now);
}

function parseClock(text) {
  const n = normalize(text);
  let match = n.match(/\b(?:a las?|desde las?|despues de las?|antes de las?)\s*(\d{1,2})(?:\s*(?::|y)\s*(\d{2}))?\s*(am|pm|a m|p m)?\b/);
  if (!match) match = n.match(/\b(\d{1,2})(?::(\d{2}))\s*(am|pm|a m|p m)?\b/);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = String(match[3] || '').replace(/\s/g, '');

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (!meridiem && /\b(tarde|noche)\b/.test(n) && hour < 12) hour += 12;
  if (!meridiem && /\bmediodia\b/.test(n)) hour = 12;

  if (hour > 23 || minute > 59) return null;
  return {
    value: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    minutes: hour * 60 + minute,
  };
}

function parseTimePreference(text) {
  const n = normalize(text);
  const clock = parseClock(text);
  if (!clock) {
    if (/\bpor la manana\b/.test(n)) return { kind: 'range', min: 480, max: 720, label: 'por la mañana' };
    if (/\bpor la tarde\b/.test(n)) return { kind: 'range', min: 720, max: 1080, label: 'por la tarde' };
    return null;
  }

  if (/\b(despues de|mas tarde de|a partir de)\b/.test(n)) {
    return { kind: 'after', min: clock.minutes, value: clock.value, label: `después de las ${clock.value}` };
  }
  if (/\b(antes de|mas temprano de)\b/.test(n)) {
    return { kind: 'before', max: clock.minutes, value: clock.value, label: `antes de las ${clock.value}` };
  }
  return { kind: 'exact', value: clock.value, min: clock.minutes, max: clock.minutes, label: `a las ${clock.value}` };
}

function commandKey(command) {
  return JSON.stringify([
    command.type, command.goal, command.slot, command.topic,
    command.value, command.reference,
  ]);
}

function enrichDeterministically(turn, text, context = {}) {
  const existing = new Set(turn.commands.map(commandKey));
  const add = command => {
    const key = commandKey(command);
    if (!existing.has(key)) {
      turn.commands.push(command);
      existing.add(key);
    }
  };

  const timeZone = context.timeZone || process.env.CLINIC_TIMEZONE || 'America/Phoenix';
  const date = parseRelativeDate(text, timeZone);
  const timePreference = parseTimePreference(text);

  if (date) add({ type: 'set_slot', slot: 'date', value: date, confidence: 0.99 });
  if (timePreference) {
    add({
      type: 'set_slot',
      slot: 'time_preference',
      value: timePreference,
      confidence: 0.99,
    });
  }

  return turn;
}

function stateView(state) {
  return {
    mode: state.mode,
    active_goals: state.active_goals.map(goal => goal.type),
    slots: Object.fromEntries(
      Object.entries(state.slots).map(([name, value]) => [
        name,
        { value: value.value, status: value.status },
      ])
    ),
    pending_questions: state.pending_questions.map(question => ({
      goal: question.goal,
      topic: question.topic,
      slot: question.slot,
    })),
    last_system_question: state.last_system_question,
    last_offer: state.last_offer,
    recent_turns: state.recent_turns.slice(-5).map(turn => ({
      user: turn.user,
      reply: turn.reply,
      action: turn.action?.type,
    })),
  };
}

async function interpretTurn(text, state, context = {}) {
  const fallback = enrichDeterministically(fallbackInterpret(text, state), text, context);
  const key =
    process.env.RECEPTIONIST_V5_API_KEY ||
    process.env.RECEPTIONIST_V4_API_KEY ||
    process.env.OPENAI_API_KEY ||
    '';

  if (!key || String(process.env.RECEPTIONIST_V5_USE_AI || 'true').toLowerCase() === 'false') {
    return fallback;
  }

  const timeZone = context.timeZone || process.env.CLINIC_TIMEZONE || 'America/Phoenix';
  const prompt = {
    instruction: [
      'Return JSON only.',
      'Emit commands, not a user-facing reply.',
      'Information and booking may coexist.',
      'Do not start booking merely because a service is mentioned.',
      'Use last_system_question for short answers.',
      'Corrections change only the corrected slot.',
      'Do not invent facts.',
      'Extract relative dates such as hoy, mañana and weekdays.',
      'Extract time preferences such as después de las 11, antes de las 4 and por la tarde.',
      'For a weekday without an explicit date, use the next occurrence in the clinic timezone.',
    ],
    clinic_time_zone: timeZone,
    current_date: isoDateInZoneOffset(0, timeZone),
    state: stateView(state),
    branches: context.branches || [],
    services: (context.services || []).map(service => ({ id: service.id, name: service.name })),
    message: text,
  };

  try {
    const response = await fetch(
      process.env.OPENAI_CHAT_URL || 'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: process.env.RECEPTIONIST_V5_MODEL || 'gpt-4.1-mini',
          temperature: 0,
          max_tokens: 900,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: 'Strict JSON command interpreter for a professional dental receptionist.',
            },
            { role: 'user', content: JSON.stringify(prompt) },
          ],
        }),
      }
    );

    if (!response.ok) throw new Error(`V5 interpreter HTTP ${response.status}`);

    const payload = await response.json();
    const ai = enrichDeterministically(
      sanitizeTurn(parseJson(payload?.choices?.[0]?.message?.content)),
      text,
      context
    );

    const seen = new Set(ai.commands.map(commandKey));
    for (const command of fallback.commands) {
      const keyValue = commandKey(command);
      if (!seen.has(keyValue)) {
        ai.commands.push(command);
        seen.add(keyValue);
      }
    }

    return ai;
  } catch (error) {
    console.warn('⚠️ Recepcionista V5 interpreter fallback:', error.message);
    return fallback;
  }
}

module.exports = {
  interpretTurn,
  stateView,
  parseRelativeDate,
  parseTimePreference,
};

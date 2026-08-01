'use strict';

function asText(v) {
  return v === null || v === undefined ? '' : String(v);
}

function normalize(v) {
  return asText(v)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s:/.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function phoenixParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.CLINIC_TIMEZONE || 'America/Phoenix',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

function isoFromParts({ year, month, day }) {
  return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function addDays(days) {
  const p = phoenixParts();
  return new Date(Date.UTC(p.year, p.month - 1, p.day + days, 12)).toISOString().slice(0, 10);
}

function parseDate(text) {
  const raw = asText(text).trim();
  const n = normalize(raw);
  const iso = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const slash = raw.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (slash) {
    const p = phoenixParts();
    let year = slash[3] ? Number(slash[3]) : p.year;
    if (year < 100) year += 2000;
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    // Spanish-first DD/MM; if first > 12 it is certainly day.
    const day = first;
    const month = second;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) return isoFromParts({ year, month, day });
  }

  if (/\bpasado manana\b/.test(n)) return addDays(2);
  if (/\bmanana\b/.test(n)) return addDays(1);
  if (/\bhoy\b/.test(n)) return addDays(0);

  const weekdays = { domingo:0, lunes:1, martes:2, miercoles:3, jueves:4, viernes:5, sabado:6 };
  const current = phoenixParts();
  const noon = new Date(Date.UTC(current.year, current.month - 1, current.day, 12));
  for (const [word, target] of Object.entries(weekdays)) {
    if (new RegExp(`\\b${word}\\b`).test(n)) {
      let delta = target - noon.getUTCDay();
      if (delta <= 0) delta += 7;
      return new Date(noon.getTime() + delta * 86400000).toISOString().slice(0,10);
    }
  }
  return null;
}

function isPastDate(iso) {
  if (!iso) return false;
  return iso < addDays(0);
}

function normalizePhone(raw) {
  const source = asText(raw);

  // Busca primero bloques que parezcan teléfonos dentro de una frase.
  const candidates = source.match(/(?:\+?\d[\d\s().-]{8,20}\d)/g) || [];
  const normalizedCandidates = candidates
    .map(candidate => candidate.replace(/\D/g, ''))
    .filter(Boolean);

  // También considera la entrada completa cuando sólo contiene el número.
  const allDigits = source.replace(/\D/g, '');
  if (allDigits) normalizedCandidates.push(allDigits);

  for (const digits of normalizedCandidates) {
    if (digits.startsWith('521') && digits.length >= 13) return digits.slice(3, 13);
    if (digits.startsWith('52') && digits.length >= 12) return digits.slice(2, 12);
    if (digits.startsWith('1') && digits.length === 11) return digits.slice(1);
    if (digits.length === 10) return digits;
    if (digits.length > 10) {
      const tail = digits.slice(-10);
      if (tail.length === 10) return tail;
    }
  }

  return null;
}

function parseTime(text) {
  const n = normalize(text);
  const m = n.match(/\b(?:a\s+las?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (!m) {
    if (/\bmanana|temprano\b/.test(n)) return { kind:'range', min:480, max:720, label:'por la mañana' };
    if (/\btarde\b/.test(n)) return { kind:'range', min:720, max:1080, label:'por la tarde' };
    if (/\bnoche\b/.test(n)) return { kind:'range', min:1020, max:1200, label:'por la tarde-noche' };
    return null;
  }
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  let mer = m[3] || null;
  if (h > 23 || min > 59) return null;
  if (!mer) {
    if (/\bmanana|temprano\b/.test(n)) mer='am';
    if (/\btarde|noche\b/.test(n)) mer='pm';
  }
  if (mer === 'pm' && h < 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;
  if (!mer && h >= 1 && h <= 7) h += 12;
  const minutes = h * 60 + min;
  return {
    kind:'exact', minutes,
    value:`${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`,
  };
}

function timeToMinutes(v) {
  const m = asText(v).match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

function formatTime(v) {
  const mins = timeToMinutes(v);
  if (!Number.isFinite(mins)) return asText(v).slice(0,5);
  const h24 = Math.floor(mins / 60);
  const mm = mins % 60;
  const mer = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(mm).padStart(2,'0')} ${mer}`;
}

function formatDate(value) {
  if (!value) return '';
  let date;
  if (value instanceof Date) date = value;
  else {
    const m = asText(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    date = m
      ? new Date(Date.UTC(Number(m[1]), Number(m[2])-1, Number(m[3]), 12))
      : new Date(value);
  }
  if (Number.isNaN(date.getTime())) return asText(value).slice(0,10);
  return new Intl.DateTimeFormat('es-MX', {
    timeZone:'UTC', weekday:'long', day:'numeric', month:'long', year:'numeric'
  }).format(date);
}

function branchFromText(text) {
  const n = normalize(text);
  if (/\bvictoria|sucursal 1|sucursal_1\b/.test(n)) return 'sucursal_1';
  if (/\bcondesa|sucursal 2|sucursal_2\b/.test(n)) return 'sucursal_2';
  return null;
}

function affirmative(text) {
  const n = normalize(text);
  return /^(si|sip|simon|claro|ok|okay|va|sale|perfecto|correcto|confirmo|confirmar|dale|listo|adelante|agendala|reservala|yes)$/.test(n)
    || /\b(si confirmo|si me funciona|ese horario|esta bien|de acuerdo|quiero confirmar|agendala|reservala)\b/.test(n);
}

function negative(text) {
  const n = normalize(text);
  return /^(no|nop|nel|no gracias|ese no|esa no)$/.test(n)
    || /\b(otra hora|otro horario|otro dia|no me funciona|no puedo|mas tarde|mas temprano|quiero cambiar)\b/.test(n);
}

module.exports = {
  asText, normalize, parseDate, isPastDate, normalizePhone, parseTime,
  timeToMinutes, formatTime, formatDate, branchFromText, affirmative, negative,
};

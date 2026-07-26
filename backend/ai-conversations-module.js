/**
 * ai-conversations-module.js
 * Módulo IA (se importa desde tu server central server.js)
 *
 * Exporta:
 *  - createAiTables(q)
 *  - setupAiRoutes(app, q)
 *
 * Objetivo (FIX):
 *  - Que el chat pueda consultar disponibilidad REAL (tabla appointments) filtrando por sucursal
 *  - Que proponga opciones antes de agendar
 *  - Que al elegir, inserte la cita y quede reflejada en /api/appointments (agenda)
 *
 * Requisitos:
 *  - q(sql, params?) => { rows }
 *  - app = express()
 *
 * ENV:
 *  - OPENAI_API_KEY (NO lo pongas en frontend)
 *  - AI_MODEL (opcional) default: gpt-4o-mini
 *  - AI_TIMEOUT_MS (opcional) default: 15000
 */

const DEFAULT_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';

/* ===================== DB (migraciones mínimas IA) ===================== */
async function createAiTables(q) {
  await q(`
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id SERIAL PRIMARY KEY,
      title TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      sucursal_id TEXT DEFAULT NULL,
      phone_number_id TEXT DEFAULT NULL
    )
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS ai_messages (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER REFERENCES ai_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      meta JSONB DEFAULT '{}'::jsonb
    )
  `);

  // 🆕 Estado conversacional para flujo de agendado (idempotente)
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS state JSONB DEFAULT '{}'::jsonb`);

  // 🆕 Aislamiento por número de WhatsApp (phone_number_id)
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS phone_number_id TEXT DEFAULT NULL`);

  await q(`CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages(conversation_id, created_at)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_ai_conversations_updated ON ai_conversations(updated_at DESC)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_ai_conversations_phone ON ai_conversations(phone_number_id)`);


  /* ===================== Clinic branches (perfil por sucursal) ===================== */
  await q(`
    CREATE TABLE IF NOT EXISTS clinic_branches (
      id BIGSERIAL PRIMARY KEY,
      phone_number_id TEXT NOT NULL,
      branch_key TEXT NOT NULL,
      clinic_name TEXT NOT NULL,
      phone TEXT,
      whatsapp TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      country TEXT DEFAULT 'MX',
      google_maps_url TEXT,
      business_hours JSONB,
      notes TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (phone_number_id, branch_key)
    )
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_clinic_branches_lookup ON clinic_branches(phone_number_id, branch_key)`);

  // Seed Dentalux (auto) - no requiere inserts manuales
  await q(
    `INSERT INTO clinic_branches
      (phone_number_id, branch_key, clinic_name, phone, whatsapp, address, city, state, google_maps_url, business_hours, notes, is_active)
     VALUES
      ($1,'sucursal_1','Dentalux Victoria','6863112623','6863112623',
       'Anillo Periferico 424 A, Victoria Residencial','Mexicali','Baja California',
       'https://maps.app.goo.gl/gQZL1s4xnj2XvHj48?g_st=ic',
       '{"mon":["09:00-19:00"],"tue":["09:00-19:00"],"wed":["09:00-19:00"],"thu":["09:00-19:00"],"fri":["09:00-19:00"],"sat":["09:00-19:00"]}'::jsonb,
       'Horario general: 9am a 7pm', TRUE),
      ($1,'sucursal_2','Dentalux Condesa','6673434222','6673434222',
       'Calle Babel #1300, Residencial Condesa','Mexicali','Baja California',
       'https://maps.app.goo.gl/APHKAQpqEMPaVpgH6?g_st=ic',
       '{"mon":["08:30-20:00"],"tue":["08:30-20:00"],"wed":["08:30-20:00"],"thu":["08:30-20:00"],"fri":["08:30-20:00"],"sat":["08:30-20:00"]}'::jsonb,
       'Horario general: 8:30am a 8pm', TRUE)
     ON CONFLICT (phone_number_id, branch_key) DO UPDATE
       SET clinic_name      = EXCLUDED.clinic_name,
           phone           = EXCLUDED.phone,
           whatsapp        = EXCLUDED.whatsapp,
           address         = EXCLUDED.address,
           city            = EXCLUDED.city,
           state           = EXCLUDED.state,
           country         = EXCLUDED.country,
           google_maps_url = EXCLUDED.google_maps_url,
           business_hours  = EXCLUDED.business_hours,
           notes           = EXCLUDED.notes,
           is_active       = TRUE,
           updated_at      = NOW()`,
    [process.env.AI_DEFAULT_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || '903268306212311']
  );

  // Compatibilidad: también sembramos el perfil usando WABA_ID/identificador viejo si existe.
  const compatPhoneIds = [
    process.env.AI_DEFAULT_WABA_ID,
    process.env.WHATSAPP_WABA_ID,
    process.env.WABA_ID,
    '704780742729954'
  ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

  for (const compatId of compatPhoneIds) {
    if (String(compatId) === String(process.env.AI_DEFAULT_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || '903268306212311')) continue;
    await q(
      `INSERT INTO clinic_branches
        (phone_number_id, branch_key, clinic_name, phone, whatsapp, address, city, state, google_maps_url, business_hours, notes, is_active)
       VALUES
        ($1,'sucursal_1','Dentalux Victoria','6863112623','6863112623',
         'Anillo Periferico 424 A, Victoria Residencial','Mexicali','Baja California',
         'https://maps.app.goo.gl/gQZL1s4xnj2XvHj48?g_st=ic',
         '{"mon":["09:00-19:00"],"tue":["09:00-19:00"],"wed":["09:00-19:00"],"thu":["09:00-19:00"],"fri":["09:00-19:00"],"sat":["09:00-19:00"]}'::jsonb,
         'Horario general: 9am a 7pm', TRUE),
        ($1,'sucursal_2','Dentalux Condesa','6673434222','6673434222',
         'Calle Babel #1300, Residencial Condesa','Mexicali','Baja California',
         'https://maps.app.goo.gl/APHKAQpqEMPaVpgH6?g_st=ic',
         '{"mon":["08:30-20:00"],"tue":["08:30-20:00"],"wed":["08:30-20:00"],"thu":["08:30-20:00"],"fri":["08:30-20:00"],"sat":["08:30-20:00"]}'::jsonb,
         'Horario general: 8:30am a 8pm', TRUE)
       ON CONFLICT (phone_number_id, branch_key) DO UPDATE
         SET clinic_name      = EXCLUDED.clinic_name,
             phone           = EXCLUDED.phone,
             whatsapp        = EXCLUDED.whatsapp,
             address         = EXCLUDED.address,
             city            = EXCLUDED.city,
             state           = EXCLUDED.state,
             country         = EXCLUDED.country,
             google_maps_url = EXCLUDED.google_maps_url,
             business_hours  = EXCLUDED.business_hours,
             notes           = EXCLUDED.notes,
             is_active       = TRUE,
             updated_at      = NOW()`,
      [compatId]
    );
  }
}

/* ===================== Helpers ===================== */
function pickSucursal(req) {
  return (
    req.query?.sucursal ||
    req.query?.sucursal_id ||
    req.headers?.['x-sucursal'] ||
    req.body?.sucursal_id ||
    null
  );
}


function pickPhoneNumberId(req) {
  return (
    req.query?.phone_number_id ||
    req.query?.wa_phone_number_id ||
    req.headers?.['x-wa-phone-number-id'] ||
    req.headers?.['x-phone-number-id'] ||
    null
  );
}

function safeJson(v, fallback) {
  try { return JSON.parse(v); } catch { return fallback; }
}

function asText(v) { return (v === null || v === undefined) ? '' : String(v); }

function normSucursal(v) {
  const s = asText(v).trim().toLowerCase();
  if (!s) return null;
  if (s === '1' || s === 's1' || s === 'sucursal1' || s === 'sucursal_1' || s.includes('sucursal 1')) return 'sucursal_1';
  if (s === '2' || s === 's2' || s === 'sucursal2' || s === 'sucursal_2' || s.includes('sucursal 2')) return 'sucursal_2';
  if (s.startsWith('sucursal_')) return s;
  return null;
}


// ---- Phone helpers (store phone in appointments) ----
function normalizePhone(raw) {
  // Guarda el teléfono en BD con formato "estable" para matching y envíos:
  // - MX: 10 dígitos (local)  -> 6863112623
  // - US/CA: 11 dígitos con 1 -> 12147285048
  //
  // Entradas típicas:
  // - WhatsApp inbound: wa_id suele venir como 521XXXXXXXXXX (MX) o 1XXXXXXXXXX (US)
  // - También puede venir como +521..., +1..., o sólo 10 dígitos.
  const s = asText(raw).trim();
  if (!s) return null;

  const DEFAULT_10_DIGIT_COUNTRY = (process.env.AI_ASSUME_10_DIGIT_COUNTRY || process.env.WA_ASSUME_10_DIGIT_COUNTRY || 'MX').toUpperCase(); // MX | US
  let digits = s.replace(/\D/g, '');
  if (digits.length < 10) return null;

  // US/CA: si viene con 1 + 10, guardamos 11
  if (digits.length >= 11 && digits.startsWith('1')) {
    return '1' + digits.slice(1, 11);
  }

  // MX: compatibilidad con 521/52 (guardamos local10)
  if (digits.startsWith('521') && digits.length >= 13) return digits.slice(3, 13);
  if (digits.startsWith('52')  && digits.length >= 12) return digits.slice(2, 12);

  // Si son 10 dígitos "pelados": usar país default
  if (digits.length === 10) {
    if (DEFAULT_10_DIGIT_COUNTRY === 'US') return '1' + digits;
    return digits; // MX
  }

  // Si vienen más de 11 dígitos (casos raros), intento: tomar últimos 10 como local
  const local10 = digits.slice(-10);
  if (local10.length === 10 && /^\d{10}$/.test(local10)) {
    if (DEFAULT_10_DIGIT_COUNTRY === 'US') return '1' + local10;
    return local10;
  }

  return null;
}

function normTxt(s) {
  return String(s || '').trim().toLowerCase();
}

function detectBranchChoice(userText) {
  const t = normTxt(userText);

  // elección por número
  if (/^\s*1\s*$/.test(t)) return 'sucursal_1';
  if (/^\s*2\s*$/.test(t)) return 'sucursal_2';

  // por nombre
  const hasVictoria = /\bvictoria\b/.test(t);
  const hasCondesa = /\bcondesa\b/.test(t);

  if (hasVictoria && !hasCondesa) return 'sucursal_1';
  if (hasCondesa && !hasVictoria) return 'sucursal_2';

  return null;
}

function mentionsOtherBranch(userText, currentBranch) {
  const t = normTxt(userText);
  const mV = /\bvictoria\b/.test(t);
  const mC = /\bcondesa\b/.test(t);
  if (!currentBranch) return (mV || mC);

  if (currentBranch === 'sucursal_1' && mC) return true;
  if (currentBranch === 'sucursal_2' && mV) return true;
  return false;
}

function branchDisplayName(branchKey) {
  return branchKey === 'sucursal_1' ? 'Dentalux Victoria' : 'Dentalux Condesa';
}

function initialBranchMessage() {
  return (
`¡Hola! 👋 Bienvenido a Dentalux 🦷

Contamos con dos sucursales en Mexicali.
Para brindarte información exacta (ubicación, horarios y citas),
¿en cuál sucursal te gustaría atenderte?

1️⃣ Dentalux Victoria
2️⃣ Dentalux Condesa

Puedes responder con el número o el nombre de la sucursal 😊`
  );
}

function askSwitchBranchMessage() {
  return (
`Claro 😊 también contamos con otra sucursal.

¿Deseas que continuemos con:
1️⃣ Dentalux Victoria
2️⃣ Dentalux Condesa?

Responde con el número o el nombre 🙌`
  );
}

// Preguntas que requieren sucursal para responder exacto
function needsBranchForAnswer(userText) {
  const t = normTxt(userText);
  return (
    /\bdirecci[oó]n\b|\bubic|ubica|donde\s+est[aá]n|maps\b/.test(t) ||
    /\bhorario|horarios|abren|cierran\b/.test(t) ||
    /\bagendar|cita|disponibilidad|disponibles\b/.test(t)
  );
}

function isLikelyRealPhone(raw) {
  const s = asText(raw).trim();
  if (!s) return false;
  const digits = s.replace(/\D/g, '');
  // WhatsApp wa_id suele ser 521XXXXXXXXXX (13) o 1XXXXXXXXXX (11) o local MX (10)
  if (digits.length < 10) return false;
  if (digits.length > 13) return false; // evita PSID de Messenger u otros ids largos
  // Acepta 10 (MX), 11 (US/CA con 1), 12 (52+10), 13 (521+10)
  return true;
}

function pickUserPhoneFromReq(req) {
  // Importante: en Messenger, x-from es el PSID (NO es teléfono). No lo uses como teléfono.
  const candidates = [
    req.body?.phone,
    req.body?.wa_from,
    req.headers?.['x-wa-from'],
    req.body?.from, // solo si parece teléfono real
  ];
  for (const c of candidates) {
    if (isLikelyRealPhone(c)) return c;
  }
  return null;
}




// ===== Clinic branch profile helpers (por phone_number_id + sucursal) =====
const CLINIC_BRANCH_CACHE = new Map(); // key -> { data, expMs }

async function getClinicBranch(q, phoneNumberId, branchKey) {
  if (!phoneNumberId || !branchKey) return null;
  const { rows } = await q(
    `SELECT clinic_name, phone, whatsapp, address, city, state, country,
            google_maps_url, business_hours, notes
       FROM clinic_branches
      WHERE phone_number_id = $1
        AND branch_key = $2
        AND is_active = TRUE
      LIMIT 1`,
    [String(phoneNumberId), String(branchKey)]
  );
  return rows?.[0] || null;
}

async function getClinicBranchCached(q, phoneNumberId, branchKey, ttlMs = 5 * 60 * 1000) {
  // Nota: en WhatsApp el identificador es phone_number_id.
  // En Messenger a veces llega un page_id (u otro id). Si no hay perfil para ese id,
  // caemos a un "default" configurado para reutilizar la misma información oficial.
  const primaryId = phoneNumberId || '';
  const fallbackId =
    (process.env.AI_DEFAULT_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WA_PHONE_NUMBER_ID || '').toString();

  const now = Date.now();

  async function getCached(id) {
    const key = `${id || ''}::${branchKey || ''}`;
    const hit = CLINIC_BRANCH_CACHE.get(key);
    if (hit && hit.expMs > now) return hit.data;
    const data = await getClinicBranch(q, id, branchKey);
    CLINIC_BRANCH_CACHE.set(key, { data, expMs: now + ttlMs });
    return data;
  }

  // 1) intenta con el id recibido (WA phone_number_id o FB page_id)
  let data = await getCached(primaryId);

  // 2) fallback: si no hay datos y hay default y es diferente
  if (!data && fallbackId && fallbackId !== primaryId) {
    data = await getCached(fallbackId);
  }

  return data;
}

function formatBusinessHours(businessHours, fallbackNote = '') {
  if (!businessHours || typeof businessHours !== 'object') return fallbackNote || '';
  const daysOrder = ['mon','tue','wed','thu','fri','sat','sun'];
  const dayLabel = { mon:'Lun', tue:'Mar', wed:'Mié', thu:'Jue', fri:'Vie', sat:'Sáb', sun:'Dom' };
  const parts = [];
  for (const d of daysOrder) {
    const v = businessHours[d];
    if (Array.isArray(v) && v.length) parts.push(`${dayLabel[d]} ${v.join(',')}`);
  }
  return parts.join(' | ') || (fallbackNote || '');
}

function formatClinicProfileText(p) {
  if (!p) return '';
  const lines = [];
  lines.push(`Clínica: ${p.clinic_name}`);
  if (p.phone) lines.push(`Teléfono: ${p.phone}`);
  if (p.whatsapp) lines.push(`WhatsApp: ${p.whatsapp}`);
  const addr = [p.address, p.city, p.state, p.country].filter(Boolean).join(', ');
  if (addr) lines.push(`Dirección: ${addr}`);
  if (p.google_maps_url) lines.push(`Google Maps: ${p.google_maps_url}`);
  const hours = formatBusinessHours(p.business_hours, p.notes || '');
  if (hours) lines.push(`Horario: ${hours}`);
  return lines.join('\n');
}


async function assertConversationAccess(q, conversationId, phoneNumberId) {
  if (!conversationId) return false;
  const REQUIRE = (process.env.WA_REQUIRE_PHONE_NUMBER_ID || 'true').toLowerCase() === 'true';
  if (REQUIRE && !phoneNumberId) return false;

  const includeLegacy = (process.env.AI_INCLUDE_LEGACY_NULL_PHONE || 'false').toLowerCase() === 'true';

  const { rows } = await q(
    `SELECT 1
       FROM ai_conversations
      WHERE id = $1
        AND (
          $2::text IS NULL
          OR phone_number_id = $2::text
          OR (phone_number_id IS NULL AND $3::bool)
        )
      LIMIT 1`,
    [Number(conversationId), phoneNumberId ? String(phoneNumberId) : null, includeLegacy]
  );

  // Si REQUIRE y no hay phoneNumberId, ya retornamos false arriba.
  // Si viene phoneNumberId, debe coincidir (a menos que sea legacy permitido).
  if (!rows?.length) return false;
  return true;
}

function pad2(n) { return String(n).padStart(2, '0'); }

function ymd(d) {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  return `${yyyy}-${mm}-${dd}`;
}


// === Timezone-safe date helpers (avoid off-by-one when server tz != clinic tz) ===
const DEFAULT_TIMEZONE = 'America/Chihuahua';

function todayYmdInTz(tz = DEFAULT_TIMEZONE) {
  // en-CA outputs YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function utcDateFromYmd(ymdStr) {
  const m = String(ymdStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
  return new Date(Date.UTC(y, mo, d));
}

function ymdUTC(d) {
  if (!(d instanceof Date) || isNaN(d)) return null;
  const yyyy = d.getUTCFullYear();
  const mm = pad2(d.getUTCMonth() + 1);
  const dd = pad2(d.getUTCDate());
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateValue(v) {
  if (!v) return '';
  // pg puede devolver DATE como string 'YYYY-MM-DD' o como Date
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  return String(v);
}

function parseDateFromText(text) {
  const t = asText(text).toLowerCase();

  // yyyy-mm-dd
  let m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // dd/mm/yyyy
  m = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m) return `${m[3]}-${pad2(Number(m[2]))}-${pad2(Number(m[1]))}`;

  // Usamos la fecha "de hoy" en zona America/Chihuahua para evitar corrimientos (PST/UTC)
  const todayStr = todayYmdInTz(DEFAULT_TIMEZONE);
  const today = utcDateFromYmd(todayStr) || new Date();

  if (t.includes('hoy')) return ymdUTC(today) || todayStr;
  // "mañana" puede significar "tomorrow" o "en la mañana" (turno). Si dice "en/por/la mañana", NO es fecha.
  if (t.includes('mañana') || t.includes('manana')) {
    if (/\b(en|por|a)\s+la\s+(mañana|manana)\b/.test(t) || /\bla\s+(mañana|manana)\b/.test(t)) {
      // se interpreta como preferencia de horario, no como día "tomorrow"
    } else {
      const d = new Date(today.getTime());
      d.setUTCDate(d.getUTCDate() + 1);
      return ymdUTC(d);
    }
  }

  // "el 5 de febrero" (muy básico)
  m = t.match(/\bel\s+(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/);
  if (m) {
    const months = {
      enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
      julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
    };
    const dd = Number(m[1]);
    const mm = months[m[2]];
    const d = new Date(Date.UTC(today.getUTCFullYear(), mm, dd));
    // si ya pasó este año, empuja al siguiente
    if (d < today) d.setUTCFullYear(d.getUTCFullYear() + 1);
    return ymdUTC(d);
  }


  // Días de la semana (ej: "lunes", "el lunes", "próximo lunes")
  m = t.match(/\b(este\s+|el\s+|proximo\s+|próximo\s+)?(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/);
  if (m) {
    const target = m[2];
    const map = {
      domingo: 0,
      lunes: 1,
      martes: 2,
      miercoles: 3, 'miércoles': 3,
      jueves: 4,
      viernes: 5,
      sabado: 6, 'sábado': 6
    };
    const norm = target.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    const targetDow = map[target] ?? map[norm];
    if (Number.isFinite(targetDow)) {
      const d = new Date(today.getTime());
      const todayDow = d.getUTCDay(); // 0=dom (UTC)
      let delta = (targetDow - todayDow + 7) % 7;
      // si dicen "el lunes" y hoy es lunes, tomamos el siguiente lunes
      if (delta === 0) delta = 7;
      d.setUTCDate(d.getUTCDate() + delta);
      return ymdUTC(d);
    }
  }

  return null;
}

function parseTimeFromText(text) {
  const t = asText(text).toLowerCase().replace(/\./g, '').trim();

  // HH:MM
  let m = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m) return `${pad2(Number(m[1]))}:${m[2]}`;

  // "2 pm", "2pm", "2 p m"
  m = t.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (m) {
    let h = Number(m[1]);
    const ap = m[2];
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return `${pad2(h)}:00`;
  }

  // "a las 2", "2 de la tarde"
  m = t.match(/\b(a\s*las\s*)?(\d{1,2})\b/);
  if (m) {
    let h = Number(m[2]);
    if (t.includes('tarde') || t.includes('noche')) {
      if (h < 12) h += 12;
    }
    if (h >= 0 && h <= 23) return `${pad2(h)}:00`;
  }

  return null;
}

function parseTimePreference(text) {
  const t = asText(text).toLowerCase();

  // Si hay hora explícita, no forzamos preferencia
  if (parseTimeFromText(t)) return null;

  // Reglas simples (puedes ajustar)
  if (t.includes('noche') || t.includes('en la noche') || t.includes('después de las 6') || t.includes('despues de las 6')) {
    return { label: 'noche', minStartMins: 18 * 60 };
  }
  if (t.includes('tarde') || t.includes('más tarde') || t.includes('mas tarde') || t.includes('después de las 3') || t.includes('despues de las 3')) {
    return { label: 'tarde', minStartMins: 12 * 60 };
  }
  if (t.includes('temprano') || t.includes('en la mañana') || t.includes('en la manana') || t.includes('mañana temprano') || t.includes('manana temprano')) {
    return { label: 'mañana', minStartMins: 8 * 60 };
  }

  return null;
}

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

async function loadConversation(q, conversationId) {
  const { rows } = await q(
    `SELECT id, title, sucursal_id, state
     FROM ai_conversations
     WHERE id = $1`,
    [conversationId]
  );
  return rows[0] || null;
}

async function saveConversationState(q, conversationId, state) {
  await q(
    `UPDATE ai_conversations
     SET state = $2::jsonb, updated_at = NOW()
     WHERE id = $1`,
    [conversationId, JSON.stringify(state || {})]
  );
}

async function getDoctors(q, sucursalId) {
  const { rows } = await q(
    `SELECT id, name
     FROM doctors
     WHERE ($1::text IS NULL OR sucursal_id = $1::text)
     ORDER BY id ASC`,
    [sucursalId]
  );
  return rows.map(r => ({ id: Number(r.id), name: r.name }));
}

async function getServices(q, sucursalId) {
  const { rows } = await q(
    `SELECT id, name
     FROM services
     WHERE ($1::text IS NULL OR sucursal_id = $1::text)
     ORDER BY id ASC`,
    [sucursalId]
  );
  return rows.map(r => ({ id: Number(r.id), name: r.name }));
}

function findServiceIdByText(services, text) {
  const t = asText(text).toLowerCase();
  if (!t) return null;
  // match exact/contains (prioriza más largo)
  const scored = services
    .map(s => {
      const n = asText(s.name).toLowerCase();
      let score = 0;
      if (t === n) score += 100;
      if (t.includes(n)) score += Math.min(80, n.length);
      if (n.includes(t)) score += Math.min(60, t.length);
      return { ...s, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.id ?? null;
}

async function getAppointmentsForDay(q, { sucursalId, date, doctorId }) {
  const params = [date, sucursalId, doctorId ?? null];
  const { rows } = await q(
    `SELECT id,
            doctor_id,
            start_time::text AS start_time,
            COALESCE(duration_hours, 1) AS duration_hours,
            status
     FROM appointments
     WHERE date = $1
       AND ($2::text IS NULL OR sucursal_id = $2::text)
       AND ($3::int  IS NULL OR doctor_id = $3::int)
       AND COALESCE(status,'') <> 'Cancelada'`,
    params
  );
  return rows.map(r => ({
    id: Number(r.id),
    doctor_id: Number(r.doctor_id),
    start_time: String(r.start_time).slice(0,5),
    duration_hours: Number(r.duration_hours || 1),
    status: r.status || ''
  }));
}

/**
 * Calcula slots disponibles reales por sucursal (y por doctores de esa sucursal).
 * - Ventana: 08:00 a 20:00
 * - Paso: 30 min
 * - Duración: durationHours (default 1)
 */
async function computeAvailability(q, { sucursalId, date, durationHours = 1, limit = 12, minStartMins = null }) {
  const doctors = await getDoctors(q, sucursalId);
  if (!doctors.length) return { slots: [], doctors };

  const durationMins = Math.max(30, Math.round(Number(durationHours) * 60));
  const dayStart = 8 * 60;
  const dayEnd = 20 * 60;

  const effectiveStart = Number.isFinite(minStartMins) ? Math.max(dayStart, Math.min(dayEnd, Math.round(minStartMins))) : dayStart;

  // traer todas las citas del día (por sucursal) y agrupar por doctor
  const appts = await getAppointmentsForDay(q, { sucursalId, date, doctorId: null });
  const byDoctor = new Map();
  for (const d of doctors) byDoctor.set(d.id, []);
  for (const a of appts) {
    if (!byDoctor.has(a.doctor_id)) byDoctor.set(a.doctor_id, []);
    const s = timeToMins(a.start_time);
    const e = s + Math.round(a.duration_hours * 60);
    byDoctor.get(a.doctor_id).push([s, e, a.id]);
  }

  // normaliza: ordena intervalos
  for (const [k, list] of byDoctor.entries()) list.sort((x, y) => x[0] - y[0]);

  const slots = [];
  for (let t = effectiveStart; t + durationMins <= dayEnd; t += 30) {
    const slotStart = t;
    const slotEnd = t + durationMins;

    // busca primer doctor que lo tenga libre
    for (const d of doctors) {
      const intervals = byDoctor.get(d.id) || [];
      let ok = true;
      for (const [s, e] of intervals) {
        if (overlaps(slotStart, slotEnd, s, e)) { ok = false; break; }
      }
      if (ok) {
        slots.push({
          date,
          start_time: minsToTime(slotStart),
          duration_hours: durationHours,
          doctor_id: d.id,
          doctor_name: d.name,
          sucursal_id: sucursalId,
        });
        break;
      }
    }

    if (slots.length >= limit) break;
  }

  return { slots, doctors };
}

async function createAppointmentFromSlot(q, { patient, phone, serviceId, slot }) {
  const payload = {
    patient: String(patient || '').trim() || 'Paciente',
    phone: phone ? String(phone) : null,
    doctor_id: Number(slot.doctor_id),
    date: slot.date,
    start_time: slot.start_time,
    duration_hours: Number(slot.duration_hours || 1),
    service_id: Number(serviceId),
    status: 'Pendiente',
    sucursal_id: slot.sucursal_id,
  };

  const { rows } = await q(
    `INSERT INTO appointments(patient, doctor_id, date, start_time, duration_hours, service_id, phone, status, sucursal_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, patient, doctor_id, date, start_time, duration_hours, service_id, phone, status, sucursal_id`,
    [
      payload.patient,
      payload.doctor_id,
      payload.date,
      payload.start_time,
      payload.duration_hours,
      payload.service_id,
      payload.phone,
      payload.status,
      payload.sucursal_id
    ]
  );

  return rows[0];
}

async function updateAppointmentFromSlot(q, { appointmentId, serviceId, slot }) {
  const id = Number(appointmentId);
  if (!Number.isFinite(id)) throw new Error('appointmentId inválido para reagendar');

  const payload = {
    doctor_id: Number(slot.doctor_id),
    date: slot.date,
    start_time: slot.start_time,
    duration_hours: Number(slot.duration_hours || 1),
    service_id: Number(serviceId),
    sucursal_id: slot.sucursal_id,
  };

  const { rows } = await q(
    `UPDATE appointments
        SET doctor_id = $1,
            date = $2,
            start_time = $3,
            duration_hours = $4,
            service_id = $5,
            sucursal_id = $6
      WHERE id = $7
      RETURNING id, patient, doctor_id, date, start_time, duration_hours, service_id, phone, status, sucursal_id`,
    [
      payload.doctor_id,
      payload.date,
      payload.start_time,
      payload.duration_hours,
      payload.service_id,
      payload.sucursal_id,
      id
    ]
  );

  if (!rows[0]) throw new Error('No encontré la cita para reagendar (id no existe)');
  return rows[0];
}

function buildOptionsText(slots, { dateLabel = null } = {}) {
  if (!slots.length) return 'No encontré horarios disponibles en ese día 😕. ¿Quieres que busque otro día o en otro horario (mañana/tarde/noche)?';
  const lines = slots.map((s, i) => `${i + 1}) ${s.date} ${String(s.start_time).slice(0,5)} (Dr. ${s.doctor_name})`);
  const head = dateLabel ? `Listo ✅ Para *${dateLabel}* encontré estos horarios:` : 'Listo ✅ Encontré estos horarios:';
  return `${head}\n${lines.join('\n')}\n\nResponde con el número (1-${slots.length}) para agendar.`;
}


function shouldEnterBookingFlow(userText, state) {
  const t = asText(userText).toLowerCase();
  if (state?.mode === 'booking') return true;
  return (
    t.includes('agendar') ||
    t.includes('agenda') ||
    t.includes('cita') ||
    t.includes('dispon') ||
    t.includes('horario') ||
    t.includes('turno')
  );
}

// ==============================
// Interrupciones (anti-robot)
// ==============================
function detectUrgency(text) {
  const t = asText(text).toLowerCase();
  // Frases frecuentes de urgencia (no diagnóstico)
  const hits = [
    'no aguanto', 'ya no aguanto', 'me duele mucho', 'dolor insoportable',
    'urgencia', 'urgente', 'se me hinch', 'inflamad', 'sangr', 'fiebre',
    'me golpe', 'trauma', 'se me rompio', 'se me quebró', 'se me quebró',
  ];
  return hits.some(h => t.includes(h));
}

function detectComplaint(text) {
  const t = asText(text).toLowerCase();
  return (
    t.includes('eso no me sirve') ||
    t.includes('no me sirve') ||
    t.includes('no sirve') ||
    t === 'no' ||
    t.includes('no puedes') ||
    t.includes('no hay') ||
    t.includes('no tienes')
  );
}

function inOfficeHours(now = new Date()) {
  // Horario base: 08:00 - 20:00
  const h = now.getHours();
  return h >= 8 && h < 20;
}

function tomorrowYmd(now = new Date()) {
  const todayStr = todayYmdInTz(DEFAULT_TIMEZONE);
  const today = utcDateFromYmd(todayStr) || new Date();
  const d = new Date(today.getTime());
  d.setUTCDate(d.getUTCDate() + 1);
  return ymdUTC(d) || todayStr;
}

/* ===================== OpenAI (fallback) ===================== */
function extractTextFromResponsesAPI(json) {
  const out = json?.output;
  if (!Array.isArray(out)) return '';
  const texts = [];
  for (const item of out) {
    const contentArr = item?.content;
    if (Array.isArray(contentArr)) {
      for (const c of contentArr) {
        if (typeof c?.text === 'string') texts.push(c.text);
        if (typeof c?.content === 'string') texts.push(c.content);
      }
    }
    if (typeof item?.text === 'string') texts.push(item.text);
  }
  return texts.join('\n').trim();
}

async function callOpenAI({ model, messages, timeoutMs = 15000 }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY no está configurada en el servidor');
    err.status = 500;
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: messages.map(m => ({ role: m.role, content: String(m.content || '') })),
      })
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error?.message || `OpenAI error HTTP ${res.status}`;
      const e = new Error(msg);
      e.status = res.status;
      e.openai = json;
      throw e;
    }

    const text = extractTextFromResponsesAPI(json);
    return { text: text || '', raw: json, used: 'responses' };
  } catch (e) {
    // fallback a chat completions
    const controller2 = new AbortController();
    const timer2 = setTimeout(() => controller2.abort(), timeoutMs);
    try {
      const res2 = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: controller2.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: messages.map(m => ({ role: m.role, content: String(m.content || '') })),
        })
      });

      const json2 = await res2.json().catch(() => ({}));
      if (!res2.ok) {
        const msg = json2?.error?.message || `OpenAI error HTTP ${res2.status}`;
        const err = new Error(msg);
        err.status = res2.status;
        err.openai = json2;
        throw err;
      }

      const text = json2?.choices?.[0]?.message?.content || '';
      return { text, raw: json2, used: 'chat_completions' };
    } finally {
      clearTimeout(timer2);
    }
  } finally {
    clearTimeout(timer);
  }
}

/* ===================== Rutas ===================== */
function setupAiRoutes(app, q) {
  // Lista conversaciones (últimas 50)
  app.get('/api/ai/conversations', async (req, res) => {
    try {
      const suc = normSucursal(pickSucursal(req));
      const phoneNumberId = String(pickPhoneNumberId(req) || '').trim() || null;

      const REQUIRE = (process.env.WA_REQUIRE_PHONE_NUMBER_ID || 'true').toLowerCase() === 'true';
      if (REQUIRE && !phoneNumberId) {
        return res.status(400).json({ error: 'phone_number_id requerido (header x-wa-phone-number-id)' });
      }

      const SHARE_SUC = (process.env.AI_SHARE_ACROSS_SUCURSALS || 'true').toLowerCase() === 'true';
      const SHARE_PHONE = (process.env.AI_SHARE_ACROSS_PHONE_NUMBERS || 'false').toLowerCase() === 'true';
      const includeLegacy = (process.env.AI_INCLUDE_LEGACY_NULL_PHONE || 'false').toLowerCase() === 'true';

      const where = [];
      const params = [];
      if (!SHARE_SUC) {
        params.push(suc);
        where.push(`($${params.length}::text IS NULL OR sucursal_id = $${params.length}::text OR sucursal_id IS NULL)`);
      }
      if (!SHARE_PHONE) {
        params.push(phoneNumberId);
        params.push(includeLegacy);
        // Si phoneNumberId viene, debe coincidir. Si no viene, se filtra a 0 salvo legacy permitido (pero REQUIRE normalmente lo evita)
        where.push(`(phone_number_id = $${params.length-1}::text OR (phone_number_id IS NULL AND $${params.length}::bool))`);
      }

      const sql = `
        SELECT id, title, created_at, updated_at, sucursal_id, phone_number_id
          FROM ai_conversations
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY updated_at DESC
         LIMIT 50
      `;

      const { rows } = await q(sql, params);
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Crea conversación
  app.post('/api/ai/conversations', async (req, res) => {
    try {
      const title = String(req.body?.title || '').slice(0, 200);
      const suc = normSucursal(pickSucursal(req));
      const phoneNumberId = String(pickPhoneNumberId(req) || '').trim() || null;

      const REQUIRE = (process.env.WA_REQUIRE_PHONE_NUMBER_ID || 'true').toLowerCase() === 'true';
      if (REQUIRE && !phoneNumberId) {
        return res.status(400).json({ error: 'phone_number_id requerido (header x-wa-phone-number-id)' });
      }

      const { rows } = await q(
        `INSERT INTO ai_conversations(title, sucursal_id, phone_number_id, state)
         VALUES ($1, $2, $3, '{}'::jsonb)
         RETURNING id, title, created_at, updated_at, sucursal_id, phone_number_id`,
        [title, suc, phoneNumberId]
      );
      res.json(rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });



  // 🗑️ Eliminar una conversación (y sus mensajes por ON DELETE CASCADE)
  app.delete('/api/ai/conversations/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });

      const phoneNumberId = String(pickPhoneNumberId(req) || '').trim() || null;
      const ok = await assertConversationAccess(q, id, phoneNumberId);
      if (!ok) return res.status(404).json({ error: 'Conversación no encontrada' });

      const { rowCount } = await q(`DELETE FROM ai_conversations WHERE id = $1`, [id]);
      if (!rowCount) return res.status(404).json({ error: 'Conversación no encontrada' });

      res.json({ ok: true, deleted: id });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // 🗑️ Eliminar todas las conversaciones visibles (si viene x-sucursal, filtra por esa sucursal)
  app.delete('/api/ai/conversations', async (req, res) => {
    try {
      const suc = normSucursal(pickSucursal(req));
      const phoneNumberId = String(pickPhoneNumberId(req) || '').trim() || null;

      const REQUIRE = (process.env.WA_REQUIRE_PHONE_NUMBER_ID || 'true').toLowerCase() === 'true';
      if (REQUIRE && !phoneNumberId) {
        return res.status(400).json({ error: 'phone_number_id requerido (header x-wa-phone-number-id)' });
      }

      const { rowCount } = await q(
        `DELETE FROM ai_conversations
          WHERE ($1::text IS NULL OR sucursal_id = $1::text)
            AND phone_number_id = $2::text`,
        [suc, phoneNumberId]
      );
      res.json({ ok: true, deleted: rowCount, sucursal_id: suc || null, phone_number_id: phoneNumberId });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Mensajes de una conversación
  app.get('/api/ai/conversations/:id/messages', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });

      const phoneNumberId = String(pickPhoneNumberId(req) || '').trim() || null;
      const ok = await assertConversationAccess(q, id, phoneNumberId);
      if (!ok) return res.status(404).json({ error: 'conversación no encontrada' });

      const { rows } = await q(
        `SELECT id, role, content, created_at, meta
           FROM ai_messages
          WHERE conversation_id = $1
          ORDER BY created_at ASC`,
        [id]
      );
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // =============================
  // 🆕 Disponibilidad real (API)
  // =============================
  app.get('/api/ai/availability', async (req, res) => {
    try {
      const sucursalId = normSucursal(req.query?.sucursal_id || pickSucursal(req));
      const date = String(req.query?.date || '').slice(0, 10);
      const durationHours = Number(req.query?.duration_hours || 1);
      const limit = Number(req.query?.limit || 6);

      if (!sucursalId) return res.status(400).json({ error: 'Falta sucursal_id (sucursal_1/sucursal_2)' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date inválida (YYYY-MM-DD)' });

      const out = await computeAvailability(q, { sucursalId, date, durationHours, limit });
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // =============================
  // 🆕 Agendar (API)
  // =============================
  app.post('/api/ai/book', async (req, res) => {
    try {
      const sucursalId = normSucursal(req.body?.sucursal_id || pickSucursal(req));
      const date = String(req.body?.date || '').slice(0, 10);
      const start_time = String(req.body?.start_time || '').slice(0, 5);
      const durationHours = Number(req.body?.duration_hours || 1);
      const serviceId = Number(req.body?.service_id);
      const patient = String(req.body?.patient || '').trim();
      const phone = req.body?.phone ? String(req.body.phone) : null;
      const doctorId = req.body?.doctor_id ? Number(req.body.doctor_id) : null;

      if (!sucursalId) return res.status(400).json({ error: 'Falta sucursal_id (sucursal_1/sucursal_2)' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date inválida (YYYY-MM-DD)' });
      if (!/^\d{2}:\d{2}$/.test(start_time)) return res.status(400).json({ error: 'start_time inválido (HH:MM)' });
      if (!Number.isFinite(serviceId)) return res.status(400).json({ error: 'service_id inválido' });
      if (!patient) return res.status(400).json({ error: 'patient requerido' });

      // Verificar disponibilidad (elige doctor o busca uno libre)
      let slot;
      if (doctorId) {
        // valida libre con ese doctor
        const { slots } = await computeAvailability(q, { sucursalId, date, durationHours, limit: 1000 });
        slot = slots.find(s => s.doctor_id === doctorId && s.start_time === start_time);
        if (!slot) return res.status(409).json({ error: 'Horario no disponible para ese doctor.' });
      } else {
        const { slots } = await computeAvailability(q, { sucursalId, date, durationHours, limit: 1000 });
        slot = slots.find(s => s.start_time === start_time);
        if (!slot) return res.status(409).json({ error: 'Horario no disponible.' });
      }

      const created = await createAppointmentFromSlot(q, { patient, phone, serviceId, slot });
      res.json({ ok: true, appointment: created });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // =============================
  // Chat (con flujo real de agenda)
  // =============================
  app.post('/api/ai/chat', async (req, res) => {
    try {
      const conversationId = Number(req.body?.conversationId);
      const userText = String(req.body?.message || '').trim();
      const model = String(req.body?.model || DEFAULT_MODEL);
      const timeoutMs = Number(req.body?.timeoutMs || process.env.AI_TIMEOUT_MS || 15000);

      if (!Number.isFinite(conversationId)) return res.status(400).json({ error: 'conversationId inválido' });
      if (!userText) return res.status(400).json({ error: 'message vacío' });

      const phoneNumberId = String(pickPhoneNumberId(req) || '').trim() || null;
      const REQUIRE = (process.env.WA_REQUIRE_PHONE_NUMBER_ID || 'true').toLowerCase() === 'true';
      if (REQUIRE && !phoneNumberId) {
        return res.status(400).json({ error: 'phone_number_id requerido (header x-wa-phone-number-id)' });
      }
      const okAccess = await assertConversationAccess(q, conversationId, phoneNumberId);
      if (!okAccess) return res.status(404).json({ error: 'Conversación no encontrada' });


      const conv = await loadConversation(q, conversationId);
      if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

      const state = (conv.state && typeof conv.state === 'object') ? conv.state : safeJson(conv.state, {});
      const incomingSucursal = normSucursal(pickSucursal(req));
      // Nota: para canales como Messenger, NO queremos que un header x-sucursal fijo
      // (ej. siempre sucursal_1) sobreescriba la sucursal elegida por el usuario en el flujo.
      if (!state.sucursal_id) {
        state.sucursal_id = incomingSucursal || normSucursal(conv.sucursal_id) || null;
      } else if (incomingSucursal && String(incomingSucursal) !== String(state.sucursal_id)) {
        // Dejamos el estado como está (prioridad a la elección del usuario)
        // console.log('ℹ️ Ignorando x-sucursal (no coincide con state.sucursal_id):', incomingSucursal, '!=', state.sucursal_id);
      }

// 📞 Captura teléfono si viene en el request (WhatsApp / UI / integraciones)
const inboundPhone = normalizePhone(pickUserPhoneFromReq(req));
if (inboundPhone && !state.phone) state.phone = inboundPhone;


      // Guardar mensaje user
      await q(
        `INSERT INTO ai_messages(conversation_id, role, content, meta)
         VALUES ($1, 'user', $2, $3::jsonb)`,
        [conversationId, userText, JSON.stringify({ source: 'webapp' })]
      );

      // ====== 0) Selección de sucursal (WhatsApp) sin trabar conversación ======
      if (state.branch_locked === undefined) state.branch_locked = false;
      if (state.branch_prompted === undefined) state.branch_prompted = false;
      if (state.branch_switch_pending === undefined) state.branch_switch_pending = false;

      // Si viene sucursal desde UI (selector), la fijamos
      if (incomingSucursal) {
        state.branch_locked = true;
        state.branch_prompted = true;
        state.branch_switch_pending = false;
      }
      // Si venimos de una respuesta de urgencia (preguntamos AGENDAR / ASESOR)
      if (state.awaiting_urgent_action) {
        const wantsAdvisor = /\b(asesor|humano|recep|recepci[oó]n|llamar|tel[eé]fono)\b/.test(t);
        const wantsBooking = /\b(agendar|cita|si|sí|ok|vale)\b/.test(t);

        if (wantsAdvisor) {
          const clinic = state.sucursal_id ? getClinicInfo(state.sucursal_id) : null;
          const reply = clinic
            ? `Claro 😊 Puedes comunicarte directo a *${clinic.name}* al ☎️ ${clinic.phone}.`
            : `Claro 😊 ¿En cuál sucursal te atendemos? Responde 1 (Victoria) o 2 (Condesa).`;
          state.awaiting_urgent_action = false;
          await q(
            `INSERT INTO ai_messages(conversation_id, role, content, meta)
             VALUES ($1, 'assistant', $2, $3::jsonb)`,
            [conversationId, reply, JSON.stringify({ flow: 'urgent', step: 'advisor' })]
          );
          await saveConversationState(q, conversationId, state);
          return res.json({ conversationId, reply, used: 'urgent_advisor' });
        }

        if (wantsBooking) {
          state.awaiting_urgent_action = false;
          state.mode = 'booking';
          // seguimos al flujo normal de booking abajo
        } else {
          // Si contestó otra cosa, quitamos el flag y seguimos normal (FAQ / conversación)
          state.awaiting_urgent_action = false;
        }
      }



      const respondAndSave = async (reply, used) => {
        await q(
          `INSERT INTO ai_messages(conversation_id, role, content, meta)
           VALUES ($1, 'assistant', $2, $3::jsonb)`,
          [conversationId, reply, JSON.stringify({ used: used || 'branch' })]
        );
        await saveConversationState(q, conversationId, state);
        return res.json({ conversationId, reply, used: used || 'branch' });
      };

      // 0.1) Si el usuario elige sucursal (1/2, victoria/condesa) la fijamos
      const chosenBranch = detectBranchChoice(userText);
      if (chosenBranch) {
        state.sucursal_id = chosenBranch;
        state.branch_locked = true;
        state.branch_prompted = true;
        state.branch_switch_pending = false;

        const reply = `¡Perfecto! 😊 Te atiendo en *${branchDisplayName(chosenBranch)}*. ¿Cómo puedo ayudarte?`;
        return await respondAndSave(reply, 'branch_chosen');
      }

      // 0.2) Si ya hay sucursal y el usuario menciona la otra, preguntamos si desea cambiar (sin cambiar automático)
      if (state.sucursal_id && state.branch_locked && mentionsOtherBranch(userText, state.sucursal_id)) {
        if (!state.branch_switch_pending) {
          state.branch_switch_pending = true;
          return await respondAndSave(askSwitchBranchMessage(), 'branch_switch_prompt');
        }
        // Si insiste sin elegir, no trabamos: seguimos con flujo normal
      } else {
        // Si el mensaje normal no menciona la otra sucursal, limpiamos el pending
        state.branch_switch_pending = false;
      }

      // 0.3) Si aún no hay sucursal y la pregunta requiere sucursal, pedimos elegir (sin loop infinito)
      if (!state.sucursal_id && needsBranchForAnswer(userText)) {
        if (!state.branch_prompted) {
          state.branch_prompted = true;
          return await respondAndSave(initialBranchMessage(), 'branch_initial');
        }
        return await respondAndSave('¿Te atiendes en *Victoria* o *Condesa*? (responde 1 o 2) 😊', 'branch_reminder');
      }

// ====== 0) Interrupciones globales (urgencia / queja) ======
      const isUrgent = detectUrgency(userText);
      const isComplaint = detectComplaint(userText);

      if (isUrgent) {
        // 🚑 Urgencia: respondemos primero (sin forzar flujo de agendado)
        state.urgent = true;

        // Si aún no eligieron sucursal, pedimos sucursal para ubicar rápido (pero sin iniciar booking)
        if (!state.sucursal_id) {
          const reply =
            `😟 Entiendo, siento que estés pasando por dolor.
` +
            `Para ayudarte mejor, ¿en cuál sucursal te atendemos?

` +
            `1) Sucursal 1 (Victoria)
` +
            `2) Sucursal 2 (Condesa)

` +
            `Responde con 1 o 2.`;
          await q(
            `INSERT INTO ai_messages(conversation_id, role, content, meta) VALUES ($1,'assistant',$2,$3::jsonb)`,
            [conversationId, reply, JSON.stringify({ flow: 'urgent', step: 'ask_sucursal' })]
          );
          await saveConversationState(q, conversationId, state);
          return res.json({ conversationId, reply, used: 'urgent_branch' });
        }

        // Ya hay sucursal: damos info de urgencias + cómo proceder
        const clinic = getClinicInfo(state.sucursal_id);
        const reply =
          `😟 Entiendo. Atendemos urgencias (dolor agudo, abscesos, fracturas) y buscamos aliviar el dolor y tratar la causa.

` +
          `📍 *${clinic.name}*
` +
          `${clinic.address}
` +
          `☎️ ${clinic.phone}
` +
          `🗺️ ${clinic.maps}
` +
          `⏰ ${clinic.hours_text}

` +
          `Si quieres, te agendo una *valoración lo antes posible*. Responde: *AGENDAR*.
` +
          `Si prefieres hablar con alguien, responde: *ASESOR*.`;
        await q(
          `INSERT INTO ai_messages(conversation_id, role, content, meta) VALUES ($1,'assistant',$2,$3::jsonb)`,
          [conversationId, reply, JSON.stringify({ flow: 'urgent', step: 'info' })]
        );
        // Marcamos que estamos esperando una decisión (sin activar booking)
        state.awaiting_urgent_action = true;
        await saveConversationState(q, conversationId, state);
        return res.json({ conversationId, reply, used: 'urgent_info' });
      }

if (isComplaint && state?.mode === 'booking') {
        const reply =
          `Entiendo 🙏 Para ayudarte rápido dime una de estas opciones:\n` +
          `1) *Urgencia* (me duele mucho / no aguanto)\n` +
          `2) *Agendar* (hoy/mañana)\n` +
          `3) *Cambiar* una cita\n\n` +
          `Responde con 1, 2 o 3 (o escribe directamente: "urgencia" / "mañana en la tarde").`;
        await q(`INSERT INTO ai_messages(conversation_id, role, content, meta) VALUES ($1,'assistant',$2,$3::jsonb)`,
          [conversationId, reply, JSON.stringify({ flow: 'booking', step: 'help_fast' })]);
        await saveConversationState(q, conversationId, state);
        return res.json({ conversationId, reply, used: 'interrupt_complaint' });
      }

      // ====== 1) Booking flow (DB real) ======
      
if (shouldEnterBookingFlow(userText, state)) {
        const prevMode = state.mode;
        state.mode = 'booking';

        // Intento: reagendar (si el usuario acaba de agendar y pide cambiar)
        const lt = userText.toLowerCase();
        const wantsReschedule =
          lt.includes('cambiar') ||
          lt.includes('reagendar') ||
          lt.includes('re-agendar') ||
          lt.includes('mover') ||
          lt.includes('otro horario') ||
          lt.includes('cambiar horario') ||
          lt.includes('cambiar la cita');

        const wantsNew =
          lt.includes('agendar otra') ||
          lt.includes('otra cita') ||
          lt.includes('nueva cita');

        // ✅ Si el usuario entra a agendar desde otro contexto (ej: preguntó dirección y luego "quiero agendar"),
        // limpiamos campos de agenda para evitar arrastrar start_time/opciones viejas.
        const freshBooking = (prevMode !== 'booking') && !wantsReschedule;
        if (freshBooking) {
          const keepSucursal = state.sucursal_id || null;
          state.intent = null;
          state.date = null;
          state.service_id = null;
          state.start_time = null;
          state.doctor_id = null;
          state.options = [];
          state.patient = null;
          state.phone = null;
          state.time_pref = null;
          state.min_start_mins = null;
          state.duration_hours = 1;
          state.sucursal_id = keepSucursal;
        }

        if (wantsNew) {
          // limpiar contexto de la última cita
          state.intent = null;
          state.last_appointment_id = null;
          state.last_date = null;
          state.last_service_id = null;
          state.last_patient = null;
          state.last_phone = null;
        }

        if (wantsReschedule && state.last_appointment_id) {
          state.intent = 'reschedule';
          // Por defecto, reagendar en el mismo día/servicio si no especifican otro
          state.date = state.date || state.last_date || state.date || null;
          state.service_id = state.service_id || state.last_service_id || null;
          state.patient = state.patient || state.last_patient || null;
          state.phone = state.phone || state.last_phone || null;
        } else if (!state.intent) {
          state.intent = 'book';
        }

        // extraer datos del mensaje
        const maybeSuc = normSucursal(userText);
        if (maybeSuc) state.sucursal_id = maybeSuc;

        const d = parseDateFromText(userText);
        if (d) state.date = d;

        
const t = parseTimeFromText(userText);
        if (t) state.start_time = t;

        // Preferencia de horario (mañana/tarde/noche / "más tarde")
        const pref = parseTimePreference(userText);
        if (pref) {
          state.time_pref = pref.label;
          state.min_start_mins = pref.minStartMins;
          // si estaban viendo opciones tempranas y piden "más tarde", mostramos más tarde
          if (Array.isArray(state.options) && state.options.length && (userText.toLowerCase().includes('más tarde') || userText.toLowerCase().includes('mas tarde') || userText.toLowerCase().includes('tarde'))) {
            const last = state.options[state.options.length - 1];
            const next = timeToMins(last.start_time) + 30;
            state.min_start_mins = Math.max(state.min_start_mins || 0, next);
          }
          // al cambiar preferencia, recalculamos opciones
          state.options = [];
          state.start_time = state.start_time || null;
          state.doctor_id = null;
        }
        // nombre (muy simple): si ponen "soy X" o "mi nombre es X"
        const low = userText.toLowerCase();
        let mName = low.match(/\b(mi nombre es|soy)\s+([a-záéíóúñ\s]{3,60})/i);
        if (mName) state.patient = String(mName[2]).trim().split(/\s+/).slice(0, 4).join(' ');

        // ✅ FIX: si estamos esperando nombre y el usuario solo escribe su nombre (sin "soy")
        const expectingName =
          state.mode === 'booking' &&
          state.date && state.start_time && state.service_id &&
          !state.patient;

        if (expectingName) {
          const tName = userText.trim();
          const looksLikeName = /^[a-záéíóúñ\s]{3,60}$/i.test(tName) && !/\d/.test(tName);
          if (looksLikeName) state.patient = tName.split(/\s+/).slice(0, 4).join(' ');
        }

        // teléfono si viene
        const mPhone = userText.match(/\b(\+?\d[\d\s\-]{8,16}\d)\b/);
        if (mPhone) state.phone = normalizePhone(mPhone[1]) || state.phone;
const durationHours = Number(state.duration_hours || 1);
        state.duration_hours = durationHours;

        // servicios
        const services = await getServices(q, state.sucursal_id);
        if (services.length) {
          if (!state.service_id) {
            const sid = findServiceIdByText(services, userText);
            if (sid) state.service_id = sid;
          }
        }

        // Si el usuario respondió con un número (selección de opción)
        const pick = userText.match(/^\s*(\d{1,2})\s*$/);
        if (pick && Array.isArray(state.options) && state.options.length) {
          const idx = Number(pick[1]) - 1;
          if (idx >= 0 && idx < state.options.length) {
            const chosen = state.options[idx];
            state.date = chosen.date;
            state.start_time = chosen.start_time;
            state.doctor_id = chosen.doctor_id;
          }
        }

        // Validaciones paso a paso
        if (!state.sucursal_id) {
          if (!state.intro_sent) {
            state.intro_sent = true;
            const reply =
              "¡Hola! 😊 Soy tu asistente.\n" +
              "Con gusto te ayudo a agendar tu cita.\n\n" +
              "¿En cuál sucursal te atendemos?\n" +
              "1) Sucursal 1\n" +
              "2) Sucursal 2\n\n" +
              "Responde con 1 o 2.";
            await q(`INSERT INTO ai_messages(conversation_id, role, content, meta) VALUES ($1,'assistant',$2,$3::jsonb)`,
              [conversationId, reply, JSON.stringify({ flow: 'booking', step: 'intro_sucursal' })]);
            await saveConversationState(q, conversationId, state);
            return res.json({ conversationId, reply, used: 'db_flow' });
          }

          const reply = "¿En cuál sucursal te atendemos? Responde con 1 (Sucursal 1) o 2 (Sucursal 2).";
          await q(`INSERT INTO ai_messages(conversation_id, role, content, meta) VALUES ($1,'assistant',$2,$3::jsonb)`,
            [conversationId, reply, JSON.stringify({ flow: 'booking', step: 'ask_sucursal' })]);
          await saveConversationState(q, conversationId, state);
          return res.json({ conversationId, reply, used: 'db_flow' });
        }

        if (!state.date) {
          const reply = "😊 ¿Para qué día te gustaría tu cita? (ej: hoy, mañana o 2026-01-25)";
          await q(`INSERT INTO ai_messages(conversation_id, role, content, meta) VALUES ($1,'assistant',$2,$3::jsonb)`,
            [conversationId, reply, JSON.stringify({ flow: 'booking', step: 'ask_date' })]);
          await saveConversationState(q, conversationId, state);
          return res.json({ conversationId, reply, used: 'db_flow' });
        }

        if (!state.service_id) {
          
const top = services.slice(0, 8).map(s => `- ${s.name}`).join('\n');
          const dateLabel = state.date || 'ese día';
          const reply =
            `Perfecto ✅\n` +
            `1) ¿Qué tratamiento/servicio necesitas? (ej: Limpieza, Resina, Extracción)\n\n` +
            `Servicios frecuentes:\n${top}\n\n` +
            `2) ¿En qué horario te acomoda para *${dateLabel}*?\n` +
            `- mañana (8am-12pm)\n` +
            `- tarde (12pm-5pm)\n` +
            `- noche (5pm-8pm)\n` +
            `- cualquiera\n\n` +
            `Puedes responder en un solo mensaje, por ejemplo: "Resina en la tarde".`;
          await q(`INSERT INTO ai_messages(conversation_id, role, content, meta) VALUES ($1,'assistant',$2,$3::jsonb)`,
            [conversationId, reply, JSON.stringify({ flow: 'booking', step: 'ask_service' })]);
          await saveConversationState(q, conversationId, state);
          return res.json({ conversationId, reply, used: 'db_flow' });
        }

        // Si no hay hora aún, proponer opciones reales
        if (!state.start_time) {
          const { slots } = await computeAvailability(q, {
            sucursalId: state.sucursal_id,
            date: state.date,
            durationHours: state.duration_hours,
            minStartMins: Number.isFinite(state.min_start_mins) ? state.min_start_mins : null,
            limit: 12
          });
          state.options = slots;
          const reply = buildOptionsText(slots, { dateLabel: state.date });
          await q(`INSERT INTO ai_messages(conversation_id, role, content, meta) VALUES ($1,'assistant',$2,$3::jsonb)`,
            [conversationId, reply, JSON.stringify({ flow: 'booking', step: 'offer_slots' })]);
          await saveConversationState(q, conversationId, state);
          return res.json({ conversationId, reply, used: 'db_flow' });
        }

        // Si falta nombre del paciente
        if (!state.patient) {
          const reply = "¿A nombre de quién agendamos la cita? (escribe tu nombre)";
          await q(`INSERT INTO ai_messages(conversation_id, role, content, meta) VALUES ($1,'assistant',$2,$3::jsonb)`,
            [conversationId, reply, JSON.stringify({ flow: 'booking', step: 'ask_patient' })]);
          await saveConversationState(q, conversationId, state);
          return res.json({ conversationId, reply, used: 'db_flow' });
        }

        
// Si falta teléfono del paciente (para registrar en agenda)
const expectingPhone =
  state.mode === 'booking' &&
  state.date && state.start_time && state.service_id &&
  state.patient && !state.phone;

if (expectingPhone) {
  const reply = "¿Me compartes tu número de teléfono para confirmar la cita? (ej: 6863112623)";
  await q(`INSERT INTO ai_messages(conversation_id, role, content, meta) VALUES ($1,'assistant',$2,$3::jsonb)`,
    [conversationId, reply, JSON.stringify({ flow: 'booking', step: 'ask_phone' })]);
  await saveConversationState(q, conversationId, state);
  return res.json({ conversationId, reply, used: 'db_flow' });
}

// Verifica que el horario pedido exista como disponible
        const { slots } = await computeAvailability(q, {
          sucursalId: state.sucursal_id,
          date: state.date,
          durationHours: state.duration_hours,
          limit: 1000
        });

        let slot = slots.find(s => s.start_time === state.start_time);
        if (state.doctor_id) slot = slots.find(s => s.start_time === state.start_time && s.doctor_id === Number(state.doctor_id)) || slot;

        if (!slot) {
          // Ofrecer opciones alternativas
          const { slots: alt } = await computeAvailability(q, {
            sucursalId: state.sucursal_id,
            date: state.date,
            durationHours: state.duration_hours,
            minStartMins: Number.isFinite(state.min_start_mins) ? state.min_start_mins : null,
            limit: 12
          });
          state.options = alt;
          state.start_time = null;
          state.doctor_id = null;
          const reply = "Ese horario ya no está disponible 🙏. " + buildOptionsText(alt, { dateLabel: state.date });
          await q(`INSERT INTO ai_messages(conversation_id, role, content, meta) VALUES ($1,'assistant',$2,$3::jsonb)`,
            [conversationId, reply, JSON.stringify({ flow: 'booking', step: 'not_available_offer' })]);
          await saveConversationState(q, conversationId, state);
          return res.json({ conversationId, reply, used: 'db_flow' });
        }

        
  // Crear / Reagendar cita en BD
  let resultAppt = null;
  if (state.intent === 'reschedule' && state.last_appointment_id) {
    resultAppt = await updateAppointmentFromSlot(q, {
      appointmentId: state.last_appointment_id,
      serviceId: state.service_id,
      slot
    });
  } else {
    resultAppt = await createAppointmentFromSlot(q, {
      patient: state.patient,
      phone: state.phone || null,
      serviceId: state.service_id,
      slot
    });
  }

  // reset state (pero guardamos contexto de la última cita para reagendar)
  const doneState = { ...state };
  doneState.mode = null;
  doneState.options = [];
  doneState.start_time = null;
  doneState.doctor_id = null;
  doneState.min_start_mins = null;
  doneState.time_pref = null;

  doneState.last_appointment_id = resultAppt.id;
  doneState.last_date = resultAppt.date;
  doneState.last_service_id = resultAppt.service_id;
  doneState.last_patient = resultAppt.patient || doneState.patient || null;
  doneState.last_phone = resultAppt.phone || doneState.phone || null;

  doneState.intent = null;

  const isRescheduled = (state.intent === 'reschedule' && state.last_appointment_id);

  // 🏥 Datos oficiales de la sucursal (si están cargados)
  const branchProfile = await getClinicBranchCached(q, phoneNumberId, resultAppt.sucursal_id);
  const branchExtra = branchProfile
    ? (
      `\n\n📍 ${branchProfile.clinic_name}` +
      (branchProfile.address ? `\n${[branchProfile.address, branchProfile.city, branchProfile.state].filter(Boolean).join(', ')}` : '') +
      (branchProfile.phone ? `\n☎️ ${branchProfile.phone}` : '') +
      (branchProfile.google_maps_url ? `\n🗺️ ${branchProfile.google_maps_url}` : '') +
      (branchProfile.business_hours || branchProfile.notes ? `\n⏰ ${formatBusinessHours(branchProfile.business_hours, branchProfile.notes || '')}` : '')
    )
    : '';

  const reply =

    (isRescheduled ? `✅ Listo, tu cita fue *reagendada*.` : `✅ Listo, tu cita quedó agendada.`) + `\n` +
    `ID cita: ${resultAppt.id}\n` +
    `Sucursal: ${resultAppt.sucursal_id}\n` +
    `Fecha: ${formatDateValue(resultAppt.date)}\n` +
    `Hora: ${String(resultAppt.start_time).slice(0,5)}\n` +
    `Estado: ${resultAppt.status}` + `${branchExtra}\n\n` +
    `¿Te gustaría *cambiar el horario* o *agendar otra cita*?`;

  await q(`INSERT INTO ai_messages(conversation_id, role, content, meta) VALUES ($1,'assistant',$2,$3::jsonb)`,
    [conversationId, reply, JSON.stringify({ flow: 'booking', step: isRescheduled ? 'rescheduled' : 'booked', appointment_id: resultAppt.id })]);

  await saveConversationState(q, conversationId, doneState);
  return res.json({ conversationId, reply, used: 'db_flow', appointment_id: resultAppt.id });
}

      // ====== 2) Fallback: OpenAI (con historial) ======
      const hist = await q(
        `SELECT role, content
         FROM ai_messages
         WHERE conversation_id = $1
         ORDER BY created_at DESC
         LIMIT 30`,
        [conversationId]
      );

      const history = (hist.rows || []).reverse().map(r => ({
        role: r.role,
        content: r.content
      }));

      const clinicProfile = await getClinicBranchCached(q, phoneNumberId, state.sucursal_id);
      const clinicText = formatClinicProfileText(clinicProfile);

      const systemPrompt =
        'Eres un asistente de recepción para una clínica dental. Responde claro y breve.\n\n' +
        (clinicText ? ('DATOS OFICIALES DE LA SUCURSAL (NO INVENTAR):\n' + clinicText + '\n\n') : '') +
        'REGLAS:\n' +
        '- Si te preguntan por dirección/ubicación/teléfono/horario, responde EXACTAMENTE con los datos oficiales.\n' +
        '- Si no hay datos oficiales, di que lo confirmas en recepción.\n' +
        '- Si preguntan por disponibilidad/agenda, pide que usen el flujo de agendado.\n' +
        '- No recetes antibióticos ni dosis; recomienda valoración presencial.';

      const messages = [
        {
          role: 'system',
          content: systemPrompt
        },
        ...history,
        { role: 'user', content: userText }
      ];

      const out = await callOpenAI({ model, messages, timeoutMs });
      const assistantText = String(out.text || '').trim() || 'Sin respuesta.';

      await q(
        `INSERT INTO ai_messages(conversation_id, role, content, meta)
         VALUES ($1, 'assistant', $2, $3::jsonb)`,
        [conversationId, assistantText, JSON.stringify({ used: out.used })]
      );

      await q(`UPDATE ai_conversations SET updated_at = NOW(), phone_number_id = COALESCE(phone_number_id, $2) WHERE id = $1`, [conversationId, phoneNumberId]);
      return res.json({ conversationId, reply: assistantText, used: out.used });
    } catch (e) {
      const status = e.status && Number.isFinite(e.status) ? e.status : 500;
      res.status(status).json({ error: e.message || String(e) });
    }
  });

  // Endpoint rápido: crear + chatear (con mismo flujo)
  app.post('/api/ai/chat/new', async (req, res) => {
    try {
      const title = String(req.body?.title || 'Nueva conversación').slice(0, 200);
      const suc = normSucursal(pickSucursal(req));
      const { rows } = await q(
        `INSERT INTO ai_conversations(title, sucursal_id, state) VALUES ($1,$2,'{}'::jsonb) RETURNING id`,
        [title, suc]
      );
      const conversationId = rows[0].id;

      // Si mandan message en la misma llamada, reusar el endpoint /api/ai/chat
      const msg = String(req.body?.message || '').trim();
      if (!msg) return res.json({ conversationId });

      // Llamada interna: fabricamos req/res minimal
      req.body.conversationId = conversationId;
      return app._router.handle(req, res, () => {});
    } catch (e) {
      const status = e.status && Number.isFinite(e.status) ? e.status : 500;
      res.status(status).json({ error: e.message || String(e) });
    }
  });
}

module.exports = {
  createAiTables,
  setupAiRoutes,
};

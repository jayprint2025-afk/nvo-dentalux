// backend/routes/whatsapp.js
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { evaluateAndExecute } = require('../rules/engine'); // motor de reglas

// ⬇️ garantiza que /webhook (POST) tenga body JSON
router.use(express.json({ type: ['application/json', 'application/*+json'] }));// ===================== IA Booking via WhatsApp =====================
// Si está activo, cualquier mensaje (que NO sea CONFIRMAR/CANCELAR/REPROGRAMAR/FAQ) se procesa con /api/ai/chat
const WA_AI_ENABLED = (process.env.WA_AI_ENABLED || 'true').toLowerCase() === 'true';
// Base interna para llamar a tu mismo server (Render/Local)
const INTERNAL_BASE_URL =
  process.env.INTERNAL_BASE_URL ||
  process.env.RENDER_EXTERNAL_URL || // fallback (puede funcionar también)
  `http://127.0.0.1:${process.env.PORT || 10000}`;


// ✅ Forzar DB para tráfico WhatsApp (evita caer a DB1 por default)
// Valores válidos: db1 | db2 | db3
const WA_FORCE_DB = String(process.env.WA_FORCE_DB || '').toLowerCase().trim();
function forcedDbKeyDefault() {
  if (WA_FORCE_DB === 'db1' || WA_FORCE_DB === '1') return 'db1';
  if (WA_FORCE_DB === 'db3' || WA_FORCE_DB === '3') return 'db3';
  if (WA_FORCE_DB === 'db2' || WA_FORCE_DB === '2') return 'db2';
  // Si no se especifica, preferimos DB2 si existe (tu caso WhatsApp), si no DB1.
  return process.env.DATABASE_URL_DB2 ? 'db2' : 'db1';
}


// ✅ Número de sucursales que deben mostrarse en el selector de WhatsApp (por app)
 // Para dentalux-sucsursales normalmente son 2: sucursal_1 y sucursal_2.
const WA_SUCURSAL_COUNT = Math.min(3, Math.max(2, Number(process.env.WA_SUCURSAL_COUNT || 2)));

function sucLabel(suc) {
  if (suc === 'sucursal_1') return 'Sucursal 1';
  if (suc === 'sucursal_2') return 'Sucursal 2';
  if (suc === 'sucursal_3') return 'Sucursal 3';
  return 'Sucursal';
}

function sucMenuText() {
  const lines = [
    `${timeGreeting()} 📍 ¿Con qué sucursal deseas agendar?`,
    '',
    '1) Sucursal 1',
    '2) Sucursal 2',
  ];
  if (WA_SUCURSAL_COUNT >= 3) lines.push('3) Sucursal 3');
  lines.push('', `Responde con ${WA_SUCURSAL_COUNT >= 3 ? '1, 2 o 3' : '1 o 2'}.`);
  return lines.join('\n');
}


// Busca o crea una conversación IA ligada a un teléfono (SaaS-compatible)
// IMPORTANTE: este flujo usa el sistema NUEVO /api/ai/chat.
// Por eso la conversación debe tener clinic_id/channel/external_id y además guardar wa_phone en state.
async function ensureAiConversationForPhone({ phone, sucursalId, phoneNumberId, dbKey }) {
  const p = String(phone || '').trim();
  if (!p) return null;

  const externalId = String(
    phoneNumberId ||
    process.env.WHATSAPP_PHONE_NUMBER_ID ||
    process.env.AI_DEFAULT_PHONE_NUMBER_ID ||
    ''
  ).trim();

  const channel = 'whatsapp';
  let clinicId = String(process.env.AI_CLINIC_ID || process.env.CLINIC_ID || 'dentalux').trim() || 'dentalux';

  // Asegurar columnas SaaS en DB actual sin romper tablas existentes.
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS tenant_id UUID`).catch(()=>{});
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS clinic_id TEXT`).catch(()=>{});
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS channel TEXT`).catch(()=>{});
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS external_id TEXT`).catch(()=>{});
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS sucursal_id TEXT`).catch(()=>{});
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS phone_number_id TEXT`).catch(()=>{});
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS state JSONB DEFAULT '{}'::jsonb`).catch(()=>{});
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`).catch(()=>{});

  // Resolver clinic_id desde clinic_channels si existe.
  if (externalId) {
    try {
      const c = await q(
        `SELECT clinic_id
           FROM clinic_channels
          WHERE channel = $1 AND external_id = $2
          LIMIT 1`,
        [channel, externalId]
      );
      if (c.rows[0]?.clinic_id) clinicId = String(c.rows[0].clinic_id);
      else {
        await q(
          `INSERT INTO clinic_channels (clinic_id, channel, external_id)
           VALUES ($1,$2,$3)
           ON CONFLICT (channel, external_id) DO NOTHING`,
          [clinicId, channel, externalId]
        ).catch(()=>{});
      }
    } catch (_) {}
  }

  const baseState = {
    wa_phone: p,
    phone: p,
    source: 'whatsapp',
    sucursal_id: sucursalId || null,
    wa_sucursal: sucursalId || null,
  };

  // Primero buscar conversación SaaS para este teléfono + número de WhatsApp.
  let found = await q(
    `SELECT id, state, phone_number_id, clinic_id, channel, external_id, sucursal_id
       FROM ai_conversations
      WHERE state->>'wa_phone' = $1
        AND COALESCE(channel, $2) = $2
        AND ($3::text = '' OR COALESCE(external_id, phone_number_id, $3) = $3)
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT 1`,
    [p, channel, externalId, currentTenantId()]
  );

  // Compatibilidad: si existe una conversación legacy por teléfono, la convertimos a SaaS.
  if (!found.rows[0]?.id) {
    found = await q(
      `SELECT id, state, phone_number_id, clinic_id, channel, external_id, sucursal_id
         FROM ai_conversations
        WHERE state->>'wa_phone' = $1
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 1`,
      [p, currentTenantId()]
    );
  }

  if (found.rows[0]?.id) {
    const convId = Number(found.rows[0].id);
    const oldState = (found.rows[0].state && typeof found.rows[0].state === 'object') ? found.rows[0].state : {};
    const mergedState = {
      ...oldState,
      ...Object.fromEntries(Object.entries(baseState).filter(([,v]) => v !== null && v !== undefined && v !== '')),
    };
    // No borrar stage si ya existe: el orquestador depende de esto entre turnos.
    if (oldState.stage && !mergedState.stage) mergedState.stage = oldState.stage;

    await q(
      `UPDATE ai_conversations
          SET tenant_id = $7,
               clinic_id = COALESCE(clinic_id, $2),
              channel = COALESCE(channel, $3),
              external_id = COALESCE(external_id, $4),
              phone_number_id = COALESCE(phone_number_id, $4),
              sucursal_id = COALESCE($5, sucursal_id),
              state = $6::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [convId, clinicId, channel, externalId || null, sucursalId || null, JSON.stringify(mergedState), currentTenantId()]
    );
    return convId;
  }

  const title = `WhatsApp ${p.slice(-10)}`;
  const created = await q(
    `INSERT INTO ai_conversations(title, clinic_id, channel, external_id, sucursal_id, phone_number_id, state, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
     RETURNING id`,
    [title, clinicId, channel, externalId || null, sucursalId || null, externalId || null, JSON.stringify(baseState), currentTenantId()]
  );

  console.log('✨ [ensureAiConversation] Nueva conversación SaaS creada:', {
    conversation_id: created.rows[0]?.id,
    clinic_id: clinicId,
    channel,
    external_id: externalId,
    phone: p,
    dbKey: dbKey || null,
  });

  return Number(created.rows[0]?.id);
}

// 🔄 Reset / borrar conversación IA (para pruebas y soporte)
async function resetAiConversationByPhone(phone, { deleteMessages = false } = {}) {
  const convId = await ensureAiConversationForPhone({ phone, sucursalId: null, phoneNumberId: null });
  if (!convId) return null;

  if (deleteMessages) {
    try { await q(`DELETE FROM ai_messages WHERE conversation_id = $1`, [convId]); } catch (e) { /* ignore */ }
  }

  // Limpia estado y sucursal para que vuelva a preguntar
  try {
    await q(
      `UPDATE ai_conversations
       SET state = '{}'::jsonb,
           sucursal_id = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [convId]
    );
  } catch (e) {
    // fallback si tu tabla no tiene updated_at/sucursal_id (no debería)
    await q(`UPDATE ai_conversations SET state = '{}'::jsonb WHERE id = $1`, [convId]);
  }
  return convId;
}

// Lee conversación + estado por teléfono (en la DB actual)
async function getAiConversationByPhone(phone) {
  const p = String(phone || '').trim();
  if (!p) return null;
  const r = await q(
    `SELECT id, title, sucursal_id, state
       FROM ai_conversations
      WHERE state->>'wa_phone' = $1
       AND ($2::text IS NULL OR phone_number_id = $2::text OR (phone_number_id IS NULL AND $2::text IS NOT NULL))
      ORDER BY updated_at DESC
      LIMIT 1`,
    [p]
  );
  return r.rows[0] || null;
}


// Lee conversación por id (en la DB actual)
async function getAiConversationById(conversationId) {
  const id = Number(conversationId);
  if (!id) return null;
  const r = await q(
    `SELECT id, title, clinic_id, channel, external_id, sucursal_id, phone_number_id, state
       FROM ai_conversations
      WHERE id = $1
      LIMIT 1`,
    [id]
  );
  return r.rows[0] || null;
}

async function setAiConversationSucursal(conversationId, sucursalId) {
  await q(
    `UPDATE ai_conversations
        SET sucursal_id = $2,
            state = jsonb_set(COALESCE(state, '{}'::jsonb), '{wa_sucursal}', to_jsonb($2::text), true),
            updated_at = NOW()
      WHERE id = $1`,
    [conversationId, sucursalId]
  );
}

function parseSucursalSelection(text) {
  const t = String(text || '').trim().toLowerCase();
  if (/^(1|sucursal\s*1|suc\s*1|s1)$/.test(t)) return 'sucursal_1';
  if (/^(2|sucursal\s*2|suc\s*2|s2)$/.test(t)) return 'sucursal_2';
  if (WA_SUCURSAL_COUNT >= 3 && /^(3|sucursal\s*3|suc\s*3|s3)$/.test(t)) return 'sucursal_3';
  return null;
}

function wantsChangeSucursal(text) {
  const t = String(text || '').trim().toLowerCase();
  return /(cambiar sucursal|otra sucursal|cambio sucursal|seleccionar sucursal|elegir sucursal)/.test(t);
}

async function requireSucursalSelection({ from, text, conversationId }) {
  const conv = await getAiConversationById(conversationId);
  const waSuc = conv?.state?.wa_sucursal || conv?.sucursal_id || null;

  if (wantsChangeSucursal(text)) {
    await setAiConversationSucursal(conversationId, null).catch(()=>{});
    const body = sucMenuText();
    await safeReply(from, body);
    await logWa({ direction:'outgoing', phone: from, message: '[wa_select_sucursal]', status:'sent', sucursalId: null, manual:false });
    await logAiMessage(conversationId, 'assistant', body, { source:'whatsapp', flow:'sucursal_select', step:'ask' }).catch(()=>{});
    return { ok: false, asked: true };
  }

  // Si el usuario envía 1/2(/3) en cualquier momento, lo tratamos como selección.
  // Esto evita que la IA reciba un "1" y responda "mensaje incompleto".
  const picked = parseSucursalSelection(text);
  if (picked) {
    if (picked !== waSuc) {
      await setAiConversationSucursal(conversationId, picked);
    }
    return { ok: true, sucursalId: picked, justSelected: true };
  }

  if (waSuc) return { ok: true, sucursalId: waSuc };

  const body = sucMenuText();
  await safeReply(from, body);
  await logWa({ direction:'outgoing', phone: from, message: '[wa_select_sucursal]', status:'sent', sucursalId: null, manual:false });
  return { ok: false, asked: true };
}


// Llama al handler IA del mismo backend (usa booking flow real con BD)
async function callAiChatInternal({ conversationId, message, phone, sucursalId, dbKey, phoneNumberId }) {
  const url = `${INTERNAL_BASE_URL}/api/ai/chat`;
  const payload = {
    conversationId,
    message,
    phone: phone || null,
    sucursal_id: sucursalId || null,
    // opcional: { model: process.env.AI_MODEL }
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${jwt.sign({ sub: 'whatsapp-webhook', tenantId: currentTenantId(), role: 'service' }, process.env.JWT_SECRET, { expiresIn: '2m' })}`,
      'x-channel': 'whatsapp', // Required for tenant resolution

      ...(phone ? { 'x-wa-phone': String(phone) } : {}),
      ...(phoneNumberId ? { 'x-wa-phone-number-id': String(phoneNumberId) } : {}),
    },
    body: JSON.stringify(payload),
  });

  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = json?.error || `IA error (${r.status})`;
    return { ok: false, reply: msg };
  }
  return { ok: true, reply: String(json?.reply || '').trim() || 'Sin respuesta.' };
}

// --- DB (pg) ---
// Un solo backend con 2 bases:
//   DATABASE_URL_DB1=... (default)
//   DATABASE_URL_DB2=... (opcional)
// Si no están, usa DATABASE_URL como DB1 (compatibilidad)
const { Pool } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');

const DB1_URL = process.env.DATABASE_URL_DB1 || process.env.DATABASE_URL;
const DB2_URL = ''; // SaaS CliniqOne: una sola BD, aislamiento por tenant_id
if (!DB1_URL) throw new Error('DATABASE_URL_DB1/DATABASE_URL no está definida');

const sslCfg = process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false;
const poolDB1 = new Pool({ connectionString: DB1_URL, ssl: sslCfg });
const poolDB2 = DB2_URL ? new Pool({ connectionString: DB2_URL, ssl: sslCfg }) : null;

const DB3_URL = ''; // SaaS CliniqOne: una sola BD, aislamiento por tenant_id
const poolDB3 = DB3_URL ? new Pool({ connectionString: DB3_URL, ssl: sslCfg }) : null;

const als = new AsyncLocalStorage();

function dbName(pool) {
  if (pool === poolDB1) return 'db1';
  if (pool === poolDB2) return 'db2';
  if (pool === poolDB3) return 'db3';
  return 'unknown';
}

function pickOne(v) { return (Array.isArray(v) ? v[v.length - 1] : v); }
function getSucursalFromReq(req) {
  return (
    pickOne(req.headers['x-sucursal-id']) ||
    pickOne(req.headers['x-sucursal']) ||
    pickOne(req.query?.sucursal_id) ||
    (req.body && pickOne(req.body.sucursal_id)) ||
    process.env.SUCURSAL_ID_DEFAULT ||
    'sucursal_1'
  );
}
function pickDbKey(req) {
  // ✅ WhatsApp (Meta) no manda ORIGIN/x-app. Forzamos DB por env WA_FORCE_DB.
  if (req && (req.path === '/webhook' || String(req.originalUrl || '').includes('/api/whatsapp/webhook'))) {
    return forcedDbKeyDefault();
  }
  const forced = String(pickOne(req.headers['x-db']) || pickOne(req.query?.db) || '').toLowerCase();
  if (forced === 'db3' || forced === '3') return 'db3';
  if (forced === 'db2' || forced === '2') return 'db2';
  if (forced === 'db1' || forced === '1') return 'db1';

  // ✅ Enrutamiento por X-APP (frontend manda VITE_APP_ID)
  const xApp = String(pickOne(req.headers['x-app']) || pickOne(req.query?.app) || pickOne(req.query?.app_id) || '').toLowerCase();
  if (xApp === 'app3') return 'db3';
  if (xApp === 'app2') return 'db2';
  if (xApp === 'app1') return 'db1';

  // ✅ Enrutamiento por ORIGIN/REFERER (cuando ambas apps usan el mismo backend)
  const origin = String(req.headers.origin || '').toLowerCase();
  const referer = String(req.headers.referer || '').toLowerCase();
  const hay = `${origin} ${referer}`.trim();
  const m1 = String(process.env.DB1_ORIGINS_MATCH || 'backenddemo-fve8').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  const m2 = String(process.env.DB2_ORIGINS_MATCH || 'dentalux-sucs,dentalux-sucursales').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  const m3 = String(process.env.DB3_ORIGINS_MATCH || 'app3').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (hay) {
    if (m3.some(s => hay.includes(s))) return 'db3';
    if (m2.some(s => hay.includes(s))) return 'db2';
    if (m1.some(s => hay.includes(s))) return 'db1';
  }

  const suc = String(getSucursalFromReq(req) || '').toLowerCase();
  if (suc === 'sucursal_3' || suc === '3') return 'db3';
  if (suc === 'sucursal_2' || suc === '2') return 'db2';
  return 'db1';
}
function poolForReq(req) {
  const key = pickDbKey(req);
  if (key === 'db3' && poolDB3) return poolDB3;
  if (key === 'db2' && poolDB2) return poolDB2;
  return poolDB1;
}


// Ejecuta una función usando un dbKey específico (para que WhatsApp no caiga a DB1 por falta de headers)
function poolForKey(dbKey) {
  const k = String(dbKey || '').toLowerCase();
  if (k === 'db3' && poolDB3) return poolDB3;
  if (k === 'db2' && poolDB2) return poolDB2;
  return poolDB1;
}
function runWithDbKey(dbKey, fn) {
  const p = poolForKey(dbKey);
  return als.run({ pool: p, dbKey: String(dbKey || dbName(p)) }, fn);
}


// q() usa el pool del contexto de la request (ALS)
async function q(text, params = []) {
  const store = als.getStore();
  const p = store?.pool || poolDB1;
  const tenantId = store?.tenantId || null;
  if (!tenantId) return p.query(text, params);
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [String(tenantId)]);
    const result = await client.query(text, params);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function qBypass(text, params = []) {
  const client = await poolDB1.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_bypass', 'on', true)`);
    const result = await client.query(text, params);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

function currentTenantId() {
  return als.getStore()?.tenantId || null;
}

function requireTenantId(req) {
  const tenantId = req?.auth?.tenantId || currentTenantId();
  if (!tenantId) {
    const error = new Error('No se pudo identificar la empresa autenticada');
    error.statusCode = 401;
    throw error;
  }
  return String(tenantId);
}

// ===================== Depósito / anticipo (defensivo multi-DB) =====================
// Algunas BDs NO tienen las columnas require_deposit_confirm/deposit_instructions.
// Para que el mismo backend sirva a todas las apps, primero verificamos si existe la columna
// antes de hacer SELECT a esas columnas.

const _depositFlagCache = new Map(); // key: dbKey -> boolean

function currentDbKey() {
  const store = als.getStore();
  return String(store?.dbKey || dbName(store?.pool || poolDB1) || 'db1');
}

async function hasDepositFlagColumn() {
  const key = currentDbKey();
  if (_depositFlagCache.has(key)) return _depositFlagCache.get(key);

  try {
    const r = await q(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name='clinic_branches'
          AND column_name='require_deposit_confirm'
      ) AS has_flag
    `);
    const hasFlag = r.rows[0]?.has_flag === true;
    _depositFlagCache.set(key, hasFlag);
    console.log('🏦 [deposit] has_flag (cached):', { dbKey: key, hasFlag });
    return hasFlag;
  } catch (e) {
    // Si falla el check, nos vamos a seguro: NO requerir depósito
    console.warn('⚠️ [deposit] has_flag check failed, defaulting false:', { dbKey: key, err: e.message });
    _depositFlagCache.set(key, false);
    return false;
  }
}

// ✅ Helper genérico: detectar si una columna existe (defensivo multi-DB)
const _colExistsCache = new Map(); // key: dbKey|table|col -> boolean
async function hasColumn(tableName, columnName) {
  const key = `${currentDbKey()}|${tableName}|${columnName}`;
  if (_colExistsCache.has(key)) return _colExistsCache.get(key);
  try {
    const r = await q(
      `SELECT EXISTS (
         SELECT 1
           FROM information_schema.columns
          WHERE table_schema='public'
            AND table_name=$1
            AND column_name=$2
       ) AS ok`,
      [String(tableName), String(columnName)]
    );
    const ok = r.rows[0]?.ok === true;
    _colExistsCache.set(key, ok);
    return ok;
  } catch (e) {
    _colExistsCache.set(key, false);
    return false;
  }
}

const WABA_ID =
  process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ||
  process.env.WHATSAPP_WABA_ID ||
  process.env.WABA_ID ||
  '';

async function getDepositConfig({ branchKey }) {
  const hasFlag = await hasDepositFlagColumn();
  if (!hasFlag) return { requireDeposit: false, depositInstructions: null, depositAmount: null };

  try {
    // Nota: en tus tablas "phone_number_id" guarda el WABA_ID (ej: 7047...), no el PHONE_NUMBER_ID (9032...).
    // Por eso priorizamos WABA_ID; si no existe, caemos a "cualquier match" por branch_key.
    const r = await q(
      `SELECT require_deposit_confirm, deposit_instructions, deposit_amount
         FROM clinic_branches
        WHERE branch_key = $1
          AND is_active = true
          AND ($2::text = '' OR phone_number_id = $2::text OR phone_number_id IS NULL)
        ORDER BY id DESC
        LIMIT 1`,
      [String(branchKey), String(WABA_ID || '')]
    );
    const row = r.rows[0] || {};
    return {
      requireDeposit: row.require_deposit_confirm === true,
      depositInstructions: row.deposit_instructions || null,
      depositAmount: row.deposit_amount ?? null,
    };
  } catch (e) {
    // Si algo falla, no bloquear el flujo
    console.warn('⚠️ [deposit] getDepositConfig failed, defaulting false:', { branchKey, err: e.message });
    return { requireDeposit: false, depositInstructions: null, depositAmount: null };
  }
}

async function findLatestDepositRefFromMessages(phone, { hours = 72 } = {}) {
  // Buscamos algo como: "REF 123456" o "Ref: 123456"
  try {
    const r = await q(
      `SELECT message, created_at
         FROM whatsapp_messages
        WHERE phone = $1
          AND direction = 'incoming'
          AND created_at >= (NOW() - ($2::text || '72 hours')::interval)
          AND (upper(message) LIKE 'REF%' OR upper(message) LIKE 'DEPOSIT_REF%')
        ORDER BY id DESC
        LIMIT 1`,
      [phone, `${Number(hours)} hours`]
    );
    const msg = r.rows[0]?.message ? String(r.rows[0].message) : '';
    const m = msg.match(/^\s*(?:REF|DEPOSIT_REF)\s*[:\-]?\s*(.+)\s*$/i);
    const ref = m ? String(m[1]).trim() : null;
    return { ref, raw: msg || null, created_at: r.rows[0]?.created_at || null };
  } catch (e) {
    return { ref: null, raw: null, created_at: null };
  }
}

// ✅ Buscar REF en cualquiera de las DBs (db1/db2/db3). Esto evita que el gate falle si el webhook cayó en otra DB.
async function findLatestDepositRefFromMessagesMultiDb(phone, { hours = 72 } = {}) {
  const pools = [poolDB1, poolDB2, poolDB3].filter(Boolean);
  let best = { ref: null, raw: null, created_at: null, db: null };

  for (const p of pools) {
    try {
      const r = await p.query(
        `SELECT message, created_at
           FROM whatsapp_messages
          WHERE phone = $1
            AND direction = 'incoming'
            AND created_at >= (NOW() - ($2::interval))
            AND (upper(message) LIKE 'REF%' OR upper(message) LIKE 'DEPOSIT_REF%')
          ORDER BY id DESC
          LIMIT 1`,
        [phone, `${Number(hours)} hours`]
      );

      const msg = r.rows[0]?.message ? String(r.rows[0].message) : '';
      const m = msg.match(/^\s*(?:REF|DEPOSIT_REF)\s*[:\-]?\s*(.+)\s*$/i);
      const ref = m ? String(m[1]).trim() : null;
      const created_at = r.rows[0]?.created_at || null;

      if (ref && created_at) {
        if (!best.created_at || new Date(created_at) > new Date(best.created_at)) {
          best = { ref, raw: msg, created_at, db: dbName(p) };
        }
      }
    } catch (e) {
      // ignore; puede no existir tabla o esquema en alguna DB
    }
  }

  return best;
}

async function findNextPendingAppointmentForPhone(phoneE164, sucursalId) {
  const variants = buildPhoneVariants(phoneE164);
  const digitVariants = variants.map(onlyDigits).filter(Boolean);

  // Tratamos de encontrar la próxima cita PENDIENTE (hoy o futura)
  const whereSuc = IGNORE_SUC ? 'TRUE' : 'sucursal_id = $2 OR sucursal_id IS NULL';
  const sql = `
    SELECT id, date, start_time, sucursal_id
      FROM ${APPT_TABLE}
     WHERE (${PHONE_COL_DIGITS}) = ANY($1)
       AND (${whereSuc})
       AND (UPPER(COALESCE(status,'')) = 'PENDIENTE' OR UPPER(COALESCE(status,'')) = 'PENDING')
       AND date >= CURRENT_DATE
     ORDER BY date ASC, start_time ASC
     LIMIT 1
  `;
  const params = IGNORE_SUC ? [digitVariants] : [digitVariants, sucursalId];
  const r = await q(sql, params);
  return r.rows[0] || null;
}

// ===================== Fin depósito / anticipo =====================


// 🔀 Multi-DB helper: intenta en el pool actual y, si no encuentra... (modo WhatsApp sin contexto)
async function findOneAcrossDbs(sql, params) {
  const store = als.getStore();
  const primary = store?.pool || poolDB1;

  const pools = [primary, poolDB1, poolDB2, poolDB3].filter(Boolean);
  const uniq = [];
  const seen = new Set();
  for (const p of pools) {
    if (!seen.has(p)) {
      seen.add(p);
      uniq.push(p);
    }
  }

  for (const p of uniq) {
    const r = await p.query(sql, params);
    if (r.rows && r.rows[0]) {
      return { appt: r.rows[0], pool: p, rows_count: r.rows.length };
    }
  }

  return { appt: null, pool: primary, rows_count: 0 };
}

// Middleware: cada request corre con su DB seleccionada
router.use((req, _res, next) => {
  const p = poolForReq(req);
  const key = pickDbKey(req);
  return als.run({ pool: p, dbKey: key, tenantId: req.auth?.tenantId || null }, next);
});

// ===================== Helpers base =====================

// ¿Estamos esperando hora+nombre? (mejorado, evita salir del contexto por mensajes viejos)
async function detectAgendarContext(q, phoneE164) {
  const r = await q(
    `SELECT id, direction, message
       FROM whatsapp_messages
      WHERE phone = $1
        AND created_at >= (NOW() - INTERVAL '45 minutes')
      ORDER BY id DESC
      LIMIT 50`,
    [phoneE164]
  );

  const rows = r.rows || [];

  // Recorremos de MÁS nuevo a MÁS viejo y devolvemos el primer marcador que encontremos.
  // Si lo primero es "Agendé tu cita...", ya no estamos pidiendo hora+nombre.
  for (const x of rows) {
    const dir = String(x.direction || '').toLowerCase();
    const msg = String(x.message || '');

    if (dir === 'outgoing' && /Agend[ée]\s+tu\s+cita/i.test(msg)) {
      return null;
    }
    if (dir === 'outgoing' && /Perfecto,\s*hoy/i.test(msg))           return { when: 'hoy' };
    if (dir === 'outgoing' && /Para\s+ma[ñn]ana/i.test(msg))          return { when: 'manana' };
    if (dir === 'incoming' && /\bAGENDAR_HOY\b/i.test(msg))           return { when: 'hoy' };
    if (dir === 'incoming' && /\bAGENDAR_MANANA\b/i.test(msg))        return { when: 'manana' };
    if (dir === 'incoming' && /^\s*hoy\s*$/i.test(msg))               return { when: 'hoy' };
    if (dir === 'incoming' && /^\s*ma[ñn]ana\s*$/i.test(msg))         return { when: 'manana' };
  }
  return null;
}

// Parsea "15:30 Juan Pérez" o "3:30 pm Juan Pérez"
function parseHoraYNombre(text) {
  const t = String(text || '').trim();
  const re = /(?:^|\s)(\d{1,2})(?::|\.)(\d{2})(?:\s*(am|pm|a\.m\.|p\.m\.)\b)?/i;
  const m = t.match(re);
  if (!m) return null;
  let hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ampm = (m[3] || '').toLowerCase();

  if (ampm) {
    if (ampm.startsWith('p') && hh < 12) hh += 12;
    if (ampm.startsWith('a') && hh === 12) hh = 0;
  }
  if (hh > 23 || mm > 59) return null;

  const time = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00`;
  const name = t.slice(m.index + m[0].length).trim() || null;
  return { time, name };
}

function ymdOffset(days = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10); // YYYY-MM-DD
}

// Normaliza teléfonos (MX/US) a E.164 y genera variantes para matching
// Nota: WhatsApp Cloud API espera el número en formato internacional (normalmente SIN '+').
// Por compatibilidad, aquí mantenemos toE164 con '+' y al enviar usamos onlyDigits(to).
const DEFAULT_10_DIGIT_COUNTRY = (process.env.WA_ASSUME_10_DIGIT_COUNTRY || 'MX').toUpperCase(); // MX | US

function onlyDigits(s) { return String(s || '').replace(/\D/g, ''); }

// Normaliza a E.164 (MX/US). Devuelve con '+'.
function toE164(raw) {
  if (!raw) return '';
  const d = onlyDigits(raw);

  // US: 1 + 10 dígitos
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  if (d.length === 10 && DEFAULT_10_DIGIT_COUNTRY === 'US') return `+1${d}`;

  // MX: compatibilidad con 521
  if (d.startsWith('521') && d.length === 13) return `+${d}`;
  if (d.startsWith('52')  && d.length === 12) return `+521${d.slice(2)}`;
  if (d.length === 10) return `+521${d}`; // default MX

  // fallback: toma los últimos 10 y lo asume MX
  const local10 = d.slice(-10);
  if (/^\d{10}$/.test(local10)) return `+521${local10}`;

  // último recurso: regresa con '+'
  return d ? `+${d}` : '';
}


// Para enviar por WhatsApp Cloud API (Meta) se recomienda MX sin el '1' (52 + 10 dígitos).
// Devuelve formato E.164 con '+'.
function toE164ForWhatsApp(raw) {
  if (!raw) return '';
  const d = onlyDigits(raw);
  if (!d) return '';

  // US: 1 + 10 dígitos
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;

  // MX: acepta 52 + 10 dígitos
  if (d.length === 12 && d.startsWith('52')) return `+${d}`;

  // MX: si viene como 521XXXXXXXXXX, conviértelo a 52XXXXXXXXXX
  if (d.length === 13 && d.startsWith('521')) return `+52${d.slice(3)}`;

  // Local 10 dígitos: decide por país por default
  if (d.length === 10) {
    if (DEFAULT_10_DIGIT_COUNTRY === 'US') return `+1${d}`;
    return `+52${d}`;
  }

  // fallback: últimos 10
  const local10 = d.slice(-10);
  if (/^\d{10}$/.test(local10)) {
    if (DEFAULT_10_DIGIT_COUNTRY === 'US') return `+1${local10}`;
    return `+52${local10}`;
  }

  return d ? `+${d}` : '';
}

// Extrae local10 tanto para MX como para US
function local10FromAny(e164OrRaw) {
  const d = onlyDigits(e164OrRaw);
  // +521XXXXXXXXXX / 521XXXXXXXXXX
  if (d.startsWith('521') && d.length >= 13) return d.slice(3, 13);
  // +52XXXXXXXXXX / 52XXXXXXXXXX
  if (d.startsWith('52')  && d.length >= 12) return d.slice(2, 12);
  // +1XXXXXXXXXX / 1XXXXXXXXXX
  if (d.startsWith('1')   && d.length >= 11) return d.slice(1, 11);
  // si ya son 10
  if (d.length === 10) return d;
  return d.slice(-10);
}
// Decide cómo guardar el teléfono en BD:
// - MX: 10 dígitos (local)
// - US: 11 dígitos con '1' al inicio
function phoneForDb(raw) {
  const d = onlyDigits(raw);
  if (!d) return '';
  // si ya viene con +1 / 1 (WhatsApp US)
  if (d.length >= 11 && d.startsWith('1')) return '1' + d.slice(1, 11);
  // si viene con 521 o 52 (WhatsApp MX)
  if (d.startsWith('521') && d.length >= 13) return d.slice(3, 13); // local10
  if (d.startsWith('52')  && d.length >= 12) return d.slice(2, 12); // local10
  // si viene 10 dígitos sin país, por default MX (configurable)
  if (d.length === 10) {
    if (DEFAULT_10_DIGIT_COUNTRY === 'US') return '1' + d;
    return d;
  }
  // otros casos: tomar últimos 10 como local (mejor esfuerzo)
  if (d.length > 10) return d.slice(-10);
  return d;
}

// Backward-compat: en código legacy se usa mxLocal10(). Aquí decidimos correctamente MX/US.
function mxLocal10(raw) { return phoneForDb(raw); }


// Variantes para buscar citas por teléfono (sirve para CONFIRMAR/CANCELAR y para joins)
function buildPhoneVariants(raw) {
  const e164 = toE164(raw);
  const digits = onlyDigits(e164); // sin '+'
  const local10 = local10FromAny(e164);

  // Detectar país desde el número original (si viene con prefijo)
  const rawDigits = onlyDigits(raw);
  const isUS = (rawDigits.length >= 11 && rawDigits.startsWith('1')) || (digits.length === 11 && digits.startsWith('1'));
  const isMX = rawDigits.startsWith('52') || rawDigits.startsWith('521') || digits.startsWith('52') || digits.startsWith('521');

  const variants = new Set([e164, digits, local10].filter(Boolean));

  // Agregar variantes solo del país detectado para evitar choques MX/US por mismos 10 dígitos
  if (local10 && local10.length === 10) {
    if (isMX && !isUS) {
      variants.add('52' + local10);
      variants.add('+52' + local10);
      variants.add('521' + local10);
      variants.add('+521' + local10);
    } else if (isUS && !isMX) {
      variants.add('1' + local10);
      variants.add('+1' + local10);
    } else {
      // desconocido: usa default (preferible MX)
      if (DEFAULT_10_DIGIT_COUNTRY === 'US') {
        variants.add('1' + local10);
        variants.add('+1' + local10);
      } else {
        variants.add('52' + local10);
        variants.add('+52' + local10);
        variants.add('521' + local10);
        variants.add('+521' + local10);
      }
    }
  }

  return Array.from(variants);
}


const hhmm = (t) => String(t || '').slice(0, 5);
const yyyymmdd = (d) => new Date(d).toISOString().slice(0, 10);
// DD/MM/YYYY (UTC)
const dateMx = (d) => {
  const dt = new Date(d);
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = dt.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

// ===== Persona amigable: saludos y textos cordiales (ADICIÓN) =====
const BRAND_NAME = process.env.BRAND_NAME || 'Dentalux';
const DEFAULT_TZ = process.env.TZ || 'America/Tijuana';

function timeGreeting(tz = DEFAULT_TZ) {
  const now = new Date();
  try {
    const hour = Number(now.toLocaleString('en-US', { hour: '2-digit', hour12: false, timeZone: tz }));
    if (hour < 12) return '¡Buenos días!';
    if (hour < 19) return '¡Buenas tardes!';
    return '¡Buenas noches!';
  } catch {
    const hour = now.getUTCHours();
    if (hour < 12) return '¡Buenos días!';
    if (hour < 19) return '¡Buenas tardes!';
    return '¡Buenas noches!';
  }
}
function friendlyText(body = '', opts = {}) {
  const t = timeGreeting();
  const tone = {
    generic: (b) => `${t} ${b}\n\nSi prefieres, puedo pasarte con un asesor humano 😊`,
    faq:     (b) => `${t} ${b}\n\n¿Te ayudo a *agendar una valoración* o quieres saber *precios*?`,
    agendarPrompt: (when) =>
      `${t} ${when === 'hoy' ? 'Perfecto, hoy' : '¡Listo! Para mañana'} 🙌\n` +
      `¿Qué hora te acomoda? (ej. 15:30) y tu *nombre completo*, por favor.`,
    booked: (fecha, hora, nombre) =>
      `${t} *Agendé tu cita* para ${fecha} a las ${hora}${nombre ? ` a nombre de ${nombre}` : ''}. ¿Confirmas?`,
    confirmOk: () =>
      `✅ ¡Gracias! Tu cita ha sido confirmada correctamente.

Para reprogramar, cancelar o resolver cualquier duda, comunícate directamente con tu consultorio.

Este número se utiliza exclusivamente para notificaciones y confirmaciones automáticas, por lo que no recibe consultas ni mensajes de atención.`,
    cancelOk: () =>
      `❌ Tu cita ha sido cancelada.

Para agendar nuevamente o solicitar información comunícate directamente con tu consultorio.

Este número únicamente envía notificaciones automáticas.`,
  };
  if (opts.kind && typeof tone[opts.kind] === 'function') {
    return tone[opts.kind](...(opts.args || []));
  }
  return tone.generic(body);
}



// ===== Fin helpers amigables =====

// ===== Respuestas humanas: smalltalk + empatía =====
function detectSmalltalkIntent(tRaw='') {
  const t = String(tRaw || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

  // saludos
  if (/^(hola|buen[oa]s?|que tal|hey|holi)/.test(t)) return { kind:'greet' };
  // despedidas / agradecimientos
  if (/^(gracias|muchas gracias|mil gracias|grx|grcs)\b/.test(t)) return { kind:'thanks' };
  if (/^(adios|hasta luego|nos vemos|bye)/.test(t)) return { kind:'bye' };

  // costos/precios genérico cuando no hay FAQ directa
  if (/(precio|costo|cuanto vale|cuanto cuesta)/.test(t)) return { kind:'price_generic' };

  // dolor/miedo/ansiedad
  if (/(me duele|dolor|hinchad[ao]|sangra|miedo|ansiedad|nervios)/.test(t)) return { kind:'empathy' };

  // ubicación / horarios
  if (/(ubicaci[oó]n|direccion|como llegar|donde estan)/.test(t)) return { kind:'location' };
  if (/(horario|abren|cierran|a que hora)/.test(t)) return { kind:'hours' };

  return null;
}

async function replySmalltalk({ to, kind, q, inferSucursalIdByPhone }) {
  const suc = await inferSucursalIdByPhone(to);
  const bodyByKind = {
    greet: () => friendlyText('Soy el asistente virtual de la clínica. ¿Te ayudo a *agendar una valoración*, resolver *precios* o platicamos con un *asesor humano*?', { kind:'faq' }),
    thanks: () => friendlyText('¡Con gusto! Si necesitas algo más, aquí estoy. ¿Quieres *agendar ahora*?', { kind:'generic' }),
    bye: () => friendlyText('¡Hasta pronto! Si se te ofrece, mándame “Agendar” y te aparto un lugar. 😊', { kind:'generic' }),
    price_generic: () => friendlyText('Los costos pueden variar según el caso. La *valoración* nos permite definir el plan y presupuesto exacto. ¿Agendamos hoy o mañana?', { kind:'faq' }),
    empathy: () => friendlyText('Lamento que te sientas así. Nuestro equipo es muy cuidadoso y puede atenderte con anestesia y opciones para tu comodidad. ¿Agendamos una valoración breve para ver qué te conviene?', { kind:'generic' }),
    location: () => friendlyText(`Estamos en la sucursal *${suc}*. Si gustas te comparto ubicación por WhatsApp y te agendo una visita. ¿Hoy o mañana?`, { kind:'generic' }),
    hours: () => friendlyText('Nuestro horario es de *08:00 a 20:00*. ¿Qué hora te acomoda para una valoración?', { kind:'generic' }),
  };
  const body = (bodyByKind[kind] || bodyByKind.greet)();

  const data = await sendInteractiveButtons({
    to,
    body,
    buttons: [
      { id: 'AGENDAR_HOY', title: 'Agendar hoy' },
      { id: 'AGENDAR_MANANA', title: 'Mañana' },
      { id: 'AGENDAR_ASESOR', title: 'Asesor' }
    ]
  });

  await logWa({
    direction: 'outgoing',
    phone: to,
    message: `[smalltalk:${kind}]`,
    status: 'sent',
    sucursalId: suc,
    waMessageId: data?.messages?.[0]?.id || null,
    manual: false,
  });
}


// === Inferir sucursal por teléfono (último OUTGOING con sucursal conocida) ===
async function inferSucursalIdByPhone(phone) {
  const r1 = await q(
    `SELECT sucursal_id FROM whatsapp_messages
      WHERE phone = $1 AND direction = 'outgoing' AND sucursal_id IS NOT NULL
      ORDER BY id DESC LIMIT 1`,
    [phone]
  );
  if (r1.rows[0]?.sucursal_id) return r1.rows[0].sucursal_id;

  const r2 = await q(
    `SELECT sucursal_id FROM whatsapp_messages
      WHERE phone = $1 AND sucursal_id IS NOT NULL
      ORDER BY id DESC LIMIT 1`,
    [phone]
  );
  if (r2.rows[0]?.sucursal_id) return r2.rows[0].sucursal_id;

  return process.env.SUCURSAL_ID_DEFAULT || 'sucursal_1';
}

// === Buscar cita ATENDIDA sin satisfacción ligada a un teléfono ===
async function findLastAttendedWithoutSatisfaction(phoneE164) {
  const variants = buildPhoneVariants(phoneE164);

  const sql = `
    SELECT
      a.id,
      a.sucursal_id,
      a.service_id
      FROM ${APPT_TABLE} a
      LEFT JOIN satisfaccion_servicio s
        ON s.appointment_id = a.id
     WHERE ${PHONE_COL} = ANY($1)
       AND UPPER(COALESCE(a.status, '')) = 'ATENDIDA'
       AND s.id IS NULL
       AND a.date >= (CURRENT_DATE - INTERVAL '7 days')
     ORDER BY a.date DESC, a.start_time DESC
     LIMIT 1
  `;

  const r = await q(sql, [variants]);
  return r.rows[0] || null;
}



// === Logger seguro a whatsapp_messages ===
async function logWa({
  direction, phone, message, status = 'sent',
  appointmentId = null, sucursalId = null, waMessageId = null, manual = false, tenantId = null,
}) {
  try {
    await q(
      `INSERT INTO whatsapp_messages
         (direction, phone, message, status, appointment_id, sucursal_id, wa_message_id, manual, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [direction, phone, message, status, appointmentId, sucursalId, waMessageId, manual, tenantId || currentTenantId()]
    );
  } catch (e) {
    console.error('logWa fail:', e.message);
  }
}

// === Logger a ai_messages (para que el widget web vea el chat de WhatsApp en tiempo real) ===
async function logAiMessage(conversationId, role, content, meta = {}) {
  try {
    const cid = Number(conversationId);
    if (!Number.isFinite(cid)) return;
    await q(
      `INSERT INTO ai_messages(conversation_id, role, content, meta, tenant_id)
       VALUES ($1,$2,$3,$4::jsonb,$5)`,
      [cid, String(role), String(content || ''), JSON.stringify(meta || {}), currentTenantId()]
    );
    await q(`UPDATE ai_conversations SET updated_at = NOW() WHERE id = $1`, [cid]).catch(()=>{});
  } catch (e) {
    console.error('logAiMessage fail:', e.message);
  }
}


// --- Idempotencia por wamid ---
async function ensureProcessedTable() {
  await q(`
    CREATE TABLE IF NOT EXISTS wa_processed (
      wamid TEXT PRIMARY KEY,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
}
async function alreadyProcessed(wamid) {
  if (!wamid) return false;
  await ensureProcessedTable();
  const r = await qBypass(`SELECT 1 FROM wa_processed WHERE wamid = $1 LIMIT 1`, [wamid]);
  return !!r.rows[0];
}
async function markProcessed(wamid) {
  if (!wamid) return;
  await ensureProcessedTable();
  await qBypass(`INSERT INTO wa_processed (wamid) VALUES ($1) ON CONFLICT DO NOTHING`, [wamid]);
}

// --- WhatsApp / Config ---
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN    = process.env.WHATSAPP_ACCESS_TOKEN;
const VERIFY_TOKEN    = process.env.VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || 'dentalux_webhook_2024';
const WA_CONFIRM_TEMPLATE = process.env.WA_CONFIRM_TEMPLATE || '';
const WA_TEMPLATE_LANG    = process.env.WA_TEMPLATE_LANG || 'es_MX';

// Rol del backend: 'router' (solo reenvía/filtra) o 'full' (procesa todo)
const WHATSAPP_ROLE  = process.env.WHATSAPP_ROLE || 'full';
// IMPORTANTE: antes esto se activaba automáticamente cuando WHATSAPP_ROLE=router
// y podía ignorar respuestas CONFIRMAR/CANCELAR si el context_id de Meta no coincidía.
// Lo dejamos desactivado por defecto para que confirme por ID o por teléfono.
const STRICT_CONTEXT = String(process.env.WA_STRICT_CONTEXT || 'false').toLowerCase() === 'true';


// Columna de teléfono configurable
const RAW_PHONE_COL = process.env.APPT_PHONE_COLUMN || 'phone';
const PHONE_COL = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(RAW_PHONE_COL) ? RAW_PHONE_COL : 'phone';
// Versión SQL de la columna de teléfono, solo dígitos
const PHONE_COL_DIGITS = `regexp_replace(${PHONE_COL}, '\\\\D', '', 'g')`;


// Ventanas y flags
const LOOKBACK_DAYS = Number(process.env.APPT_LOOKBACK_DAYS || 7);
const IGNORE_SUC = (process.env.APPT_IGNORE_SUCURSAL || 'false').toLowerCase() === 'true';
const CROSS_SUC_FALLBACK = (process.env.APPT_CROSS_SUC_FALLBACK || 'false').toLowerCase() === 'true';
const MULTI_CONFIRM = (process.env.APPT_MULTI_CONFIRM || 'false').toLowerCase() === 'true';
const MULTI_MAX = Math.max(1, Number(process.env.APPT_MULTI_MAX || 10));

// Nombres/tablas
const APPT_TABLE            = process.env.APPT_TABLE || 'appointments';
const APPT_NAME_COLUMN      = process.env.APPT_NAME_COLUMN || 'patient';
const CONTACTS_TABLE        = process.env.CONTACTS_TABLE || APPT_TABLE;
const CONTACTS_NAME_COLUMN  = process.env.CONTACTS_NAME_COLUMN || APPT_NAME_COLUMN;
const CONTACTS_PHONE_COLUMN = process.env.CONTACTS_PHONE_COLUMN || process.env.APPT_PHONE_COLUMN || 'phone';

// --- WhatsApp senders ---
async function waPost(payload, { context = '' } = {}) {
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    throw new Error('WHATSAPP env vars missing (PHONE_NUMBER_ID / ACCESS_TOKEN)');
  }
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await r.json().catch(() => ({}));

  // Log SIEMPRE lo más útil para depurar (sin imprimir el token)
  try {
    console.log('📤 [whatsapp] POST /messages', {
      context,
      to: payload?.to,
      type: payload?.type,
      status: r.status,
      ok: r.ok,
      // Meta normalmente regresa { messages: [{ id }] } si aceptó el envío
      hasMessageId: Boolean(data?.messages?.[0]?.id),
      response: data,
    });
  } catch {}

  if (!r.ok) {
    // Enhanced error logging for debugging
    const errorDetails = {
      status: r.status,
      to: payload?.to,
      error: data?.error,
      errorMessage: data?.error?.message,
      errorType: data?.error?.type,
      errorCode: data?.error?.code,
      errorSubcode: data?.error?.error_subcode,
      fullResponse: data,
    };
    console.error('❌ [whatsapp] API Error:', errorDetails);
    
    // Check if it's a phone number issue (common error codes)
    if (data?.error?.code === 131030 || data?.error?.code === 131031 || 
        data?.error?.code === 131026 || data?.error?.code === 131047 || 
        data?.error?.message?.includes('recipient phone number') ||
        data?.error?.message?.includes('is not a WhatsApp user')) {
      throw new Error(`WhatsApp number error (${payload?.to}): ${data?.error?.message || 'Invalid or unverified number'}`);
    }
    
    throw new Error(`WhatsApp API ${r.status}: ${JSON.stringify(data)}`);
  }

  // IMPORTANTE: 200/201 no garantiza entrega, pero SÍ debe traer un message id
  if (!data?.messages?.[0]?.id) {
    throw new Error(`WhatsApp API returned OK but without message id: ${JSON.stringify(data)}`);
  }

  return data;
}
function sendWhatsAppText({ to, text }) {
  const toDigits = onlyDigits(toE164ForWhatsApp(to));
  return waPost({ messaging_product: 'whatsapp', to: toDigits, type: 'text', text: { body: text } });
}
function sendWhatsAppButtons({ to, bodyText, apptId }) {
  const toDigits = onlyDigits(toE164ForWhatsApp(to));
  return waPost({
    messaging_product: 'whatsapp',
    to: toDigits,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: [
          { type: 'reply', reply: { id: `CONFIRMAR ${apptId}`, title: 'Confirmar' } },
          { type: 'reply', reply: { id: `CANCELAR ${apptId}`,  title: 'Cancelar'  } }
        ]
      }
    }
  });
}
// genérico para motor de reglas o FAQs
async function sendInteractiveButtons({ to, body, buttons }) {
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: (buttons || []).slice(0, 3).map(b => ({
          type: 'reply',
          reply: { id: String(b.id), title: String(b.title).slice(0, 20) }
        }))
      }
    }
  };
  return waPost(payload);
}
function sendWhatsAppTemplate({ to, template, lang = WA_TEMPLATE_LANG, bodyParams = [], headerParams = [] }) {
  const toDigits = onlyDigits(toE164ForWhatsApp(to));
  const components = [];
  if (headerParams.length) components.push({ type:'header', parameters: headerParams.map(t => ({ type:'text', text:String(t) })) });
  if (bodyParams.length)   components.push({ type:'body',   parameters: bodyParams.map(t => ({ type:'text', text:String(t) })) });
  const payload = {
    messaging_product: 'whatsapp',
    to: toDigits,
    type: 'template',
    template: { name: template, language: { code: lang }, components: components.length ? components : undefined }
  };
  return waPost(payload);
}
async function safeReply(to, text) {
  try { await sendWhatsAppText({ to, text }); } catch (e) { console.error('[WA safeReply]', String(e?.message || e)); }
}

// === FAQs: búsqueda y respuesta ===
async function matchFaq(q, text, sucursalId) {
  const T = String(text || '').trim();
  if (!T) return null;

  // Normaliza simple; si tienes la extensión unaccent en DB, se usa en SQL
  const needle = T.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const sql = `
    SELECT id, slug, title, answer_text, price_text, buttons, media_link
      FROM whatsapp_faqs
     WHERE active = TRUE
       AND (sucursal_id IS NULL OR sucursal_id = $2)
       AND EXISTS (
         SELECT 1
           FROM unnest(patterns) p
          WHERE unaccent($1) ILIKE '%' || unaccent(p) || '%'
       )
     ORDER BY priority DESC, id ASC
     LIMIT 1
  `;
  // Si no tienes unaccent, cambiar a: WHERE ($1) ILIKE '%' || p || '%'
  const r = await q(sql, [needle, sucursalId || null]);
  return r.rows[0] || null;
}

// FAQ responder
// Por defecto responde con TEXTO (sin botones) para no interrumpir la conversación.
// Solo muestra botones si:
//  - el FAQ trae botones explícitos en BD, o
//  - el usuario está pidiendo agendar / horarios / disponibilidad / precios / costos.
async function sendFaqAnswer({ faq, to, incomingText = '' }) {
  const main = (faq.answer_text && faq.answer_text.trim())
    ? faq.answer_text
    : `Te cuento sobre *${faq.title}*. ¿Te ayudo a agendar o prefieres ver precios?`;

  const body = friendlyText(main, { kind: 'faq' });

  // ¿El usuario realmente está buscando agendar o precios?
  const wantsButtons = /\b(agend|cita|horario|disponib|precio|cost|cu[aá]nto)\b/i.test(String(incomingText || ''));

  // Botones explícitos en DB (si existen)
  let explicitButtons = [];
  try {
    const parsed = Array.isArray(faq.buttons) ? faq.buttons : JSON.parse(faq.buttons || '[]');
    explicitButtons = (parsed || []).slice(0, 3).map(b => ({
      id: String(b.id),
      title: String(b.title).slice(0, 20)
    }));
  } catch {
    explicitButtons = [];
  }

  // Si NO hay botones explícitos y el usuario NO los pidió, responde en texto normal
  if (!explicitButtons.length && !wantsButtons) {
    await safeReply(to, body);
    await logWa({
      direction: 'outgoing',
      phone: to,
      message: `[faq:${faq.slug}] ${faq.title}`,
      status: 'sent',
      appointmentId: null,
      sucursalId: await inferSucursalIdByPhone(to),
      waMessageId: null,
      manual: false,
    });
    return true;
  }

  // Caso con botones: si no hay botones explícitos, ponemos CTA mínimos
  const buttons = explicitButtons.length
    ? explicitButtons
    : [
        { id: 'AGENDAR_HOY', title: 'Agendar' },
        { id: `FAQ_PRECIOS_${faq.slug}`, title: 'Precios' }
      ];

  const data = await sendInteractiveButtons({ to, body, buttons });

  await logWa({
    direction: 'outgoing',
    phone: to,
    message: `[faq:${faq.slug}] ${faq.title}`,
    status: 'sent',
    appointmentId: null,
    sucursalId: await inferSucursalIdByPhone(to),
    waMessageId: (data && data.messages && data.messages[0] && data.messages[0].id) || null,
    manual: false,
  });
  return true;
}

// ===================== Endpoints básicos =====================
function requireRulesAdmin(req, res, next) {
  const need = process.env.RULES_ADMIN_SECRET;
  if (!need) return next();
  const got = req.get('x-rules-secret') || req.query.secret;
  if (got !== need) return res.status(401).json({ error: 'unauthorized' });
  next();
}

router.get('/test', (_req, res) => {
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.json({
    ok: true,
    env: {
      PHONE_NUMBER_ID: !!PHONE_NUMBER_ID ? 'Set' : 'Missing',
      ACCESS_TOKEN: !!ACCESS_TOKEN ? 'Set' : 'Missing',
      VERIFY_TOKEN: VERIFY_TOKEN ? '(set)' : '(default)',
      SUCURSAL_ID_DEFAULT: process.env.SUCURSAL_ID_DEFAULT || 'sucursal_1',
      APPT_PHONE_COLUMN: PHONE_COL,
      APPT_LOOKBACK_DAYS: LOOKBACK_DAYS,
      APPT_IGNORE_SUCURSAL: IGNORE_SUC,
      APPT_CROSS_SUC_FALLBACK: CROSS_SUC_FALLBACK,
      APPT_MULTI_CONFIRM: MULTI_CONFIRM,
      APPT_MULTI_MAX: MULTI_MAX,
      WA_CONFIRM_TEMPLATE: WA_CONFIRM_TEMPLATE || '(no set)',
      WA_TEMPLATE_LANG,
    },
  });
});

router.get('/debug/columns', async (_req, res) => {
  try {
    const r = await q(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'appointments'
        ORDER BY ordinal_position`
    );
    res.json({ ok: true, columns: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.get('/debug/lookup', async (req, res) => {
  try {
    const phone = (req.query.phone || '').trim();
    if (!phone) return res.status(400).json({ ok:false, error:'phone requerido (+52...)' });
    const e164 = toE164(phone);
    const variants = buildPhoneVariants(e164);
    const sucursalId = (req.query.sucursal_id || process.env.SUCURSAL_ID_DEFAULT || 'sucursal_1').trim();
    const days = Number(req.query.days || LOOKBACK_DAYS);
    const whereSuc = IGNORE_SUC ? 'TRUE' : 'sucursal_id = $2 OR sucursal_id IS NULL';

    const distinct = await q(
      `SELECT DISTINCT ${PHONE_COL} AS phone, sucursal_id, date, start_time, status
         FROM appointments
        WHERE ${PHONE_COL} = ANY($1)
        ORDER BY date DESC, start_time DESC
        LIMIT 50`,
      [variants]
    );
    const rFuture = await q(
      `SELECT id, date, start_time, status, sucursal_id
         FROM appointments
        WHERE ${PHONE_COL} = ANY($1)
          AND (${whereSuc})
          AND date >= CURRENT_DATE
        ORDER BY date ASC, start_time ASC
        LIMIT 1`,
      IGNORE_SUC ? [variants] : [variants, sucursalId]
    );
    const rRecent = await q(
      `SELECT id, date, start_time, status, sucursal_id
         FROM appointments
        WHERE ${PHONE_COL} = ANY($1)
          AND (${whereSuc})
          AND date >= (CURRENT_DATE - INTERVAL '${days} days')
        ORDER BY date DESC, start_time DESC
        LIMIT 1`,
      IGNORE_SUC ? [variants] : [variants, sucursalId]
    );

    res.json({
      ok: true,
      query: { input_phone: phone, e164, variants, sucursalId, days, ignore_sucursal: IGNORE_SUC },
      future_pick: rFuture.rows[0] || null,
      recent_pick: rRecent.rows[0] || null,
      where_phone_appears: distinct.rows
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});

// Resuelve el tenant de un mensaje entrante sin confiar en headers del frontend.
async function resolveIncomingTenant({ from, contextId, text }) {
  const digits = onlyDigits(from);
  const variants = buildPhoneVariants(from).map(onlyDigits).filter(Boolean);

  if (contextId) {
    const r = await qBypass(`SELECT tenant_id FROM whatsapp_messages WHERE wa_message_id=$1 AND tenant_id IS NOT NULL ORDER BY id DESC LIMIT 1`, [contextId]);
    if (r.rows[0]?.tenant_id) return { tenantId: String(r.rows[0].tenant_id), source: 'context' };
  }

  const m = String(text || '').match(/^(?:CONFIRMAR|CANCELAR)\s+(\d+)$/i);
  if (m) {
    const r = await qBypass(`SELECT DISTINCT tenant_id FROM appointments WHERE id=$1 AND tenant_id IS NOT NULL`, [Number(m[1])]);
    if (r.rows.length === 1) return { tenantId: String(r.rows[0].tenant_id), source: 'appointment_id' };
  }

  const recent = await qBypass(`
    SELECT DISTINCT tenant_id
      FROM whatsapp_messages
     WHERE tenant_id IS NOT NULL
       AND regexp_replace(COALESCE(phone,''), '\\D', '', 'g') = ANY($1::text[])
       AND direction='outgoing'
       AND created_at >= NOW() - INTERVAL '30 days'
     LIMIT 3`, [variants.length ? variants : [digits]]);
  if (recent.rows.length === 1) return { tenantId: String(recent.rows[0].tenant_id), source: 'recent_outgoing' };
  if (recent.rows.length > 1) return { tenantId: null, reason: 'ambiguous_recent_outgoing' };

  const appts = await qBypass(`
    SELECT DISTINCT tenant_id
      FROM appointments
     WHERE tenant_id IS NOT NULL
       AND regexp_replace(COALESCE(phone,''), '\\D', '', 'g') = ANY($1::text[])
       AND date >= CURRENT_DATE - INTERVAL '7 days'
     LIMIT 3`, [variants.length ? variants : [digits]]);
  if (appts.rows.length === 1) return { tenantId: String(appts.rows[0].tenant_id), source: 'appointment_phone' };
  if (appts.rows.length > 1) return { tenantId: null, reason: 'ambiguous_appointments' };
  return { tenantId: null, reason: 'tenant_not_found' };
}

async function saveUnroutedMessage({ wamid, from, contextId, reason, payload }) {
  await qBypass(`INSERT INTO wa_unrouted_messages(wamid,phone,context_message_id,reason,payload) VALUES($1,$2,$3,$4,$5::jsonb)`,
    [wamid || null, from || null, contextId || null, reason, JSON.stringify(payload || {})]);
}

// ===================== Webhook verify =====================
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === (VERIFY_TOKEN || '')) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// ===================== Webhook receive =====================
router.post('/webhook', async (req, res) => {
  try {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📥 WEBHOOK RECEIVED');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Meta puede mandar varios entry/changes en un mismo webhook.
    // No debemos tomar solamente [0], porque el primer change puede ser un status
    // y el mensaje entrante real puede venir en otro change.
    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    const allChanges = entries.flatMap(entry =>
      Array.isArray(entry?.changes) ? entry.changes : []
    );

    const messageChange =
      allChanges.find(change =>
        Array.isArray(change?.value?.messages) &&
        change.value.messages.length > 0
      ) || null;

    const statusChange =
      allChanges.find(change =>
        Array.isArray(change?.value?.statuses) &&
        change.value.statuses.length > 0
      ) || null;

    // Priorizar siempre el change que contiene messages.
    // Si este webhook solo trae statuses, usamos ese value únicamente para registrarlo
    // y responder 200 sin tratarlo como mensaje entrante.
    const selectedChange = messageChange || statusChange || allChanges[0] || null;
    const a = selectedChange?.value || null;
    const phoneNumberId = String(a?.metadata?.phone_number_id || '').trim() || null;

    console.log('🧭 WEBHOOK CHANGE SCAN:', {
      entries: entries.length,
      changes: allChanges.length,
      has_message_change: !!messageChange,
      has_status_change: !!statusChange,
      selected_type: messageChange ? 'message' : (statusChange ? 'status' : 'unknown')
    });
    const aiPhoneNumberId = phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.AI_DEFAULT_PHONE_NUMBER_ID || null;

    console.log('📱 PHONE_NUMBER_ID:', {
      received: phoneNumberId,
      env_allowed: process.env.WA_ALLOWED_PHONE_NUMBER_IDS
    });

    // ✅ Aislamiento por phone_number_id con auto-allow del ID actual
    const currentPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const allowedCsv = String(process.env.WA_ALLOWED_PHONE_NUMBER_IDS || '').trim();
    
    if (allowedCsv) {
      const allowed = allowedCsv.split(',').map(s => s.trim()).filter(Boolean);
      
      if (phoneNumberId) {
        // Auto-permitir si coincide con el phone_number_id actual
        if (phoneNumberId === currentPhoneNumberId) {
          console.log('✅ PHONE_NUMBER_ID MATCHES CURRENT - ALLOWING');
        }
        // O si está en la lista explícita
        else if (allowed.includes(phoneNumberId)) {
          console.log('✅ PHONE_NUMBER_ID IN ALLOWED LIST - ALLOWING');
        }
        // De lo contrario, rechazar con mensaje útil
        else {
          console.log('⚠️ PHONE_NUMBER_ID NOT RECOGNIZED:', {
            received: phoneNumberId,
            current: currentPhoneNumberId,
            allowed: allowedCsv
          });
          console.log('💡 TIP: Update WA_ALLOWED_PHONE_NUMBER_IDS to include:', phoneNumberId);
          return res.sendStatus(200); // ignorar eventos de otros números
        }
      } else if (allowed.length) {
        console.log('🚫 NO PHONE_NUMBER_ID BUT FILTER ACTIVE - IGNORING');
        return res.sendStatus(200);
      }
    }

    const msg   = a?.messages?.[0];
    console.log('📨 MESSAGE STRUCTURE:', {
      has_message: !!msg,
      msg_type: msg?.type,
      msg_id: msg?.id,
      from: msg?.from,
      context_id: msg?.context?.id,
      button_reply_id: msg?.interactive?.button_reply?.id,
      button_reply_title: msg?.interactive?.button_reply?.title,
      text_body: msg?.text?.body
    });
    
    if (!msg) {
      const statuses = Array.isArray(a?.statuses) ? a.statuses : [];
      console.log('ℹ️ WEBHOOK SOLO DE STATUS - SIN MENSAJE ENTRANTE:', {
        statuses: statuses.map(s => ({
          id: s?.id || null,
          status: s?.status || null,
          recipient_id: s?.recipient_id || null
        }))
      });
      return res.sendStatus(200);
    }

    const wamid = msg.id || msg.message_id || null;
    console.log('🔑 WAMID:', wamid);
    
    // Idempotencia por wamid (en la MISMA DB que usaremos para WhatsApp)
    if (WA_AI_ENABLED) {
      const forcedKey0 = forcedDbKeyDefault();
      const seen = await runWithDbKey(forcedKey0, () => alreadyProcessed(wamid));
      if (seen) {
        console.log('⚠️ WAMID ALREADY PROCESSED - RETURNING');
        return res.sendStatus(200);
      }
      console.log('✅ WAMID NOT SEEN BEFORE');
    } else {
      if (await alreadyProcessed(wamid)) {
        console.log('⚠️ WAMID ALREADY PROCESSED - RETURNING');
        return res.sendStatus(200);
      }
      console.log('✅ WAMID NOT SEEN BEFORE');
    }

    const from = toE164(msg.from);
    const contextId = msg.context?.id || msg.context?.message_id || null;  // 🆕 AQUÍ

    console.log('👤 FROM:', from);
    console.log('🔗 CONTEXT_ID:', contextId);

    // Texto normalizado
    let text = '';

    switch (msg.type) {
      case 'text':        text = (msg.text?.body || '').trim(); break;
      case 'button':      text = (msg.button?.text || msg.button?.payload || '').trim(); break;
      case 'interactive':
        if (msg.interactive?.type === 'button_reply') {
          // IMPORTANTE: priorizar el ID porque ahí puede venir el folio (ej. "CONFIRMAR 1186")
          text = (msg.interactive?.button_reply?.id || msg.interactive?.button_reply?.title || '').trim();
        } else if (msg.interactive?.type === 'list_reply') {
          text = (msg.interactive?.list_reply?.title || msg.interactive?.list_reply?.id || '').trim();
        }
        break;
      default:            text = '';
    }
    
    console.log('📝 TEXT EXTRACTED (before mapping):', text);

    // Mapear botones de "agendar" a comandos internos
    if (msg.type === 'interactive' && msg.interactive?.button_reply) {
      const bid = (msg.interactive.button_reply.id || '').trim();
      if (bid === 'AGENDAR_HOY')    text = 'AGENDAR_HOY';
      if (bid === 'AGENDAR_MANANA') text = 'AGENDAR_MANANA';
      if (bid === 'AGENDAR_ASESOR') text = 'AGENDAR_ASESOR';
    }
    // Mapea texto plano "hoy"/"mañana" (solo para flujo viejo sin IA)
    if (!WA_AI_ENABLED) {
      if (/^\s*hoy\s*$/i.test(text))       text = 'AGENDAR_HOY';
      if (/^\s*ma[ñn]ana\s*$/i.test(text)) text = 'AGENDAR_MANANA';
    }

    // Mapea IDs genéricos del motor de reglas
    if (msg.type === 'interactive' && msg.interactive?.button_reply) {
      const bid = (msg.interactive.button_reply.id || '').trim();
      if (bid === 'BTN_CONFIRMAR')   text = 'CONFIRMAR';
      if (bid === 'BTN_REPROGRAMAR') text = 'REPROGRAMAR';
      // Si el botón trae el comando con folio, NO lo colapses a solo "CONFIRMAR".
      // Ej: "CONFIRMAR 1186" debe preservarse para que el regex extraiga idHint.
      if (/^CONFIRMAR\b/i.test(bid)) text = bid;
      if (/^CANCELAR\b/i.test(bid))  text = bid;
    }
    
    console.log('📝 TEXT AFTER BUTTON MAPPING:', text);

    const tenantResolution = await resolveIncomingTenant({ from, contextId, text });
    if (!tenantResolution.tenantId) {
      console.error('🚫 Mensaje WhatsApp sin tenant único:', tenantResolution.reason);
      await saveUnroutedMessage({ wamid, from, contextId, reason: tenantResolution.reason, payload: req.body }).catch(() => {});
      await markProcessed(wamid);
      return res.sendStatus(200);
    }
    const waStore = als.getStore();
    if (waStore) waStore.tenantId = tenantResolution.tenantId;
    console.log('🔐 Tenant WhatsApp resuelto:', { tenantId: tenantResolution.tenantId, source: tenantResolution.source });

    
    
    
    // ===================== Depósito: capturar referencia (REF ...) =====================
    // IMPORTANTE: esto va ANTES del passthrough a IA.
    if (text && /^\s*REF\b/i.test(text)) {
      const sucKey0 = await inferSucursalIdByPhone(from).catch(() => (process.env.SUCURSAL_ID_DEFAULT || 'sucursal_1'));
      const cfg0 = await getDepositConfig({ branchKey: sucKey0 });
      console.log('🏦 [deposit] Incoming REF detected (early):', { from, sucKey: sucKey0, requireDeposit: cfg0.requireDeposit });

      // Extract reference number from text - flexible: works with or without space
      // Accepts: "REF 123456", "REF123456", "ref ABC123", etc.
      const refMatch = text.match(/REF\s*([A-Z0-9]+)/i);
      const refNum = refMatch ? refMatch[1] : text.replace(/REF\s*/i, '').trim();
      
      // Validate reference format
      function validateRef(ref) {
        if (ref.length < 4) return { valid: false, error: 'muy corta (mínimo 4 caracteres)' };
        if (ref.length > 20) return { valid: false, error: 'muy larga (máximo 20 caracteres)' };
        if (!/^[A-Z0-9]+$/i.test(ref)) {
          return { valid: false, error: 'contiene caracteres inválidos (solo letras y números)' };
        }
        return { valid: true };
      }
      
      const validation = validateRef(refNum);
      if (!validation.valid) {
        const errorMsg = `❌ La referencia "${refNum}" es ${validation.error}.\n\n` +
          `Por favor envía una referencia válida:\n` +
          `• Mínimo 4 caracteres\n` +
          `• Máximo 20 caracteres\n` +
          `• Solo letras y números\n\n` +
          `Ejemplos: REF 123456 o REF123456`;
        
        await waPost({
          to: fromDigits,
           
          type: 'text', 
          text: { body: errorMsg } 
        });
        await markProcessed(wamid);
        console.log('⚠️ Invalid REF format, sent correction message');
        return res.sendStatus(200);
      }

      // Store REF in whatsapp_messages table
      try {
        await logWa({
          direction: 'incoming',
          phone: from,
          message: `REF ${refNum}`,
          status: 'received',
          sucursalId: sucKey0,
          waMessageId: wamid,
          manual: false,
        });
        console.log('✅ REF stored in whatsapp_messages:', { ref: refNum, phone: from });
      } catch (err) {
        console.error('❌ Error storing REF:', err.message);
      }

      // Find next pending appointment for this phone
      const appt = await findNextPendingAppointmentForPhone(from, sucKey0).catch(() => null);

      if (appt?.id) {
        // Send confirmation message with NEW interactive buttons
        const branchDisplayName = getBranchDisplayName(appt.sucursal_id || sucKey0);
        
        const buttonMsg = {
          type: 'interactive',
          interactive: {
            type: 'button',
            body: {
              text: `📅 *Cita #${appt.id}*\n📆 ${dateMx(appt.date)} a las ${hhmm(appt.start_time)}\n🏥 Sucursal ${branchDisplayName}\n\n✅ Referencia recibida: *${refNum}*`
            },
            action: {
              buttons: [
                {
                  type: 'reply',
                  reply: {
                    id: 'CONFIRMAR',
                    title: '✅ Confirmar'
                  }
                },
                {
                  type: 'reply',
                  reply: {
                    id: 'CANCELAR',
                    title: '❌ Cancelar'
                  }
                }
              ]
            }
          }
        };

        await waPost({ to: fromDigits, ...buttonMsg });
        console.log('📤 NEW buttons sent after REF');
      } else {
        // No appointment found, just acknowledge REF
        await safeReply(from, `${timeGreeting()} ¡Gracias! Tu referencia *${refNum}* ha sido recibida. ✅\n\nSi tienes una cita pendiente, escribe *CONFIRMAR* para confirmarla.`);
      }

      await markProcessed(wamid);
      console.log('✅ WEBHOOK COMPLETED (REF PATH)');
      return res.sendStatus(200);
    }
    // ===================== Fin depósito REF (early) =====================

// ===================== AI Chat passthrough (NO botones aquí) =====================
    // Este archivo SOLO debe encargarse de confirmaciones/cancelaciones y de reenviar mensajes al módulo IA.
    // Si NO es un comando de confirmación/cancelación, lo enviamos al módulo IA y respondemos con texto plano.
    const isConfirmCmd = /^(CONFIRMAR|CANCELAR)(?:\s+\d+)?$/i.test(text);
    
    console.log('🎯 IS CONFIRM COMMAND:', {
      text,
      isConfirmCmd,
      regex_pattern: '^(CONFIRMAR|CANCELAR)(?:\\s+\\d+)?$'
    });

    // ===================== Gate de depósito: BLOQUEAR CONFIRMAR/CANCELAR si no hay REF =====================
    // Si esta sucursal requiere anticipo, NO permitimos cambiar estatus con botón hasta que exista un REF reciente.
    if (isConfirmCmd) {
      const sucKeyGate = await inferSucursalIdByPhone(from).catch(() => (process.env.SUCURSAL_ID_DEFAULT || 'sucursal_1'));
      const cfgGate = await getDepositConfig({ branchKey: sucKeyGate });
      if (cfgGate.requireDeposit) {
        const foundRef = await findLatestDepositRefFromMessagesMultiDb(from, { hours: 72 });
        console.log('🛑 [deposit] Gate check for CONFIRMAR/CANCELAR:', { from, sucKey: sucKeyGate, requireDeposit: true, hasRef: !!foundRef.ref, ref: foundRef.ref, ref_db: foundRef.db });

        if (!foundRef.ref) {
          const instr =
            cfgGate.depositInstructions
              ? String(cfgGate.depositInstructions).trim()
              : 'Para confirmar tu cita necesitamos un anticipo.\n\nResponde con: *REF 123456* (tu referencia) y enseguida te habilito la confirmación.';
          await safeReply(from, `${timeGreeting()} ${instr}`);
          await markProcessed(wamid);
          return res.sendStatus(200);
        }
      }
    }
    // ===================== Fin gate depósito =====================


    if (!isConfirmCmd) {
      console.log('➡️ NOT A CONFIRM COMMAND - ROUTING TO AI');
      try {
        const dbKey = forcedDbKeyDefault();
        // No fijamos sucursal aquí: el módulo IA decide/solicita sucursal según phone_number_id y contexto.
        const conv = await ensureAiConversationForPhone({ phone: from, sucursalId: null, phoneNumberId, dbKey });
        const aiResp = await callAiChatInternal({
          conversationId: (conv && (conv.conversationId || conv.id)) || conv,
          message: text || '',
          phone: from,
          sucursalId: null,
          dbKey,
          phoneNumberId
        });

        const reply = (aiResp && aiResp.reply) ? aiResp.reply : 'Perfecto 😊 ¿En qué puedo ayudarte?';
        await safeReply(from, reply);
        console.log('✅ AI RESPONSE SENT');
      } catch (err) {
        console.error('❌ Error reenviando a módulo IA:', err?.message || err);
        await safeReply(from, 'Ups, tuve un problema técnico. ¿Puedes intentar de nuevo en un momento?');
      }
      await markProcessed(wamid);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ WEBHOOK COMPLETED (AI PATH)');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      return res.sendStatus(200);
    }
    
    console.log('✅ IS CONFIRM COMMAND - PROCEEDING TO CONFIRMATION LOGIC');

// ===================== RESET / CAMBIO DE SUCURSAL (para pruebas) =====================
    // Comandos:
    // - "RESET IA" / "RESET" / "REINICIAR": limpia estado para que vuelva a preguntar y ofrezca selector.
    // - "BORRAR CHAT" / "ELIMINAR CONVERSACION": borra mensajes + reinicia estado.
    // - "CAMBIAR SUCURSAL": reinicia estado (sin borrar mensajes).
    if (/^\s*(cambiar\s+sucursal)\s*$/i.test(text)) {
      await resetAiConversationByPhone(from, { deleteMessages: false });
      await sendWhatsAppText({ to: from, text: '✅ Listo. Vamos a elegir sucursal otra vez.\n\n📍 ¿Con qué sucursal deseas agendar?\n1) Sucursal 1\n2) Sucursal 2\n3) Sucursal 3\n\nResponde con 1, 2 o 3.' });
      await markProcessed(wamid);
      return res.sendStatus(200);
    }

    if (/^\s*(reset(\s+ia)?|reiniciar)\s*$/i.test(text)) {
      await resetAiConversationByPhone(from, { deleteMessages: false });
      await sendWhatsAppText({ to: from, text: '✅ Listo. Reinicié tu conversación para probar de nuevo.\n\n📍 ¿Con qué sucursal deseas agendar?\n1) Sucursal 1\n2) Sucursal 2\n3) Sucursal 3\n\nResponde con 1, 2 o 3.' });
      await markProcessed(wamid);
      return res.sendStatus(200);
    }

    if (/^\s*(borrar\s+chat|eliminar\s+conversaci[oó]n|eliminar\s+conversaciones)\s*$/i.test(text)) {
      await resetAiConversationByPhone(from, { deleteMessages: true });
      await sendWhatsAppText({ to: from, text: '🗑️ Listo. Borré el historial y reinicié el chat.\n\n📍 ¿Con qué sucursal deseas agendar?\n1) Sucursal 1\n2) Sucursal 2\n3) Sucursal 3\n\nResponde con 1, 2 o 3.' });
      await markProcessed(wamid);
      return res.sendStatus(200);
    }

// ----- Manejo de "FAQ_PRECIOS_*" (ADICIÓN y FIX duplicado msgPrice)
    if (/^FAQ_PRECIOS_/i.test(text)) {
      const slug = text.replace(/^FAQ_PRECIOS_/i, '').trim().toLowerCase();
      const r = await q(`SELECT title, price_text FROM whatsapp_faqs WHERE slug = $1 AND active = TRUE LIMIT 1`, [slug]);

      if (r.rows[0]) {
        const t = r.rows[0];
        const msgPrice = friendlyText(
          t.price_text
            ? `💵 *${t.title}*\n${t.price_text}`
            : `💵 *${t.title}*\nEl costo exacto se confirma en evaluación.`,
          { kind: 'faq' }
        );

        const data = await sendInteractiveButtons({
          to: from,
          body: msgPrice,
          buttons: [
            { id: 'AGENDAR_HOY', title: 'Agendar' },
            { id: 'AGENDAR_ASESOR', title: 'Asesor' }
          ]
        });

        await logWa({
          direction: 'outgoing',
          phone: from,
          message: `[faq_price:${slug}]`,
          status: 'sent',
          sucursalId: await inferSucursalIdByPhone(from),
          waMessageId: (data && data.messages && data.messages[0] && data.messages[0].id) || null,
          manual: false,
        });
      } else {
        await safeReply(from, friendlyText('Los costos pueden variar según el caso. La valoración confirma el plan y presupuesto. ¿Deseas agendar?', { kind: 'faq' }));
      }
      await markProcessed(wamid);
      return res.sendStatus(200);
    }

    // Comandos de agendar (sin pasar por motor)
    if (!WA_AI_ENABLED && /^AGENDAR_HOY$/i.test(text)) {
      const outText = friendlyText('', { kind: 'agendarPrompt', args: ['hoy'] });
      await sendWhatsAppText({ to: from, text: outText });
      await logWa({ direction: 'outgoing', phone: from, message: outText, status: 'sent' });
      await markProcessed(wamid);
      return res.sendStatus(200);
    }
    if (!WA_AI_ENABLED && /^AGENDAR_MANANA$/i.test(text)) {
      const outText = friendlyText('', { kind: 'agendarPrompt', args: ['manana'] });
      await sendWhatsAppText({ to: from, text: outText });
      await logWa({ direction: 'outgoing', phone: from, message: outText, status: 'sent' });
      await markProcessed(wamid);
      return res.sendStatus(200);
    }
    if (/^AGENDAR_ASESOR$/i.test(text)) {
      await sendWhatsAppText({
        to: from,
        text: `${timeGreeting()} Te contacto con un asesor en breve para resolver todo 😊\nSi lo prefieres, también puedo ayudarte a agendar por aquí.`
      });
      await markProcessed(wamid);
      return res.sendStatus(200);
    }
// === FAQ fast-path (antes de smalltalk/agendar) ===
if (!/^(CONFIRMAR|CANCELAR|REPROGRAMAR|FAQ_PRECIOS_)/i.test(text)) {
  const sucursalForIncoming = await inferSucursalIdByPhone(from);
  const faqFast = await matchFaq(q, text, sucursalForIncoming);
  if (faqFast) {
    await sendFaqAnswer({ faq: faqFast, to: from, incomingText: text });
    await markProcessed(wamid);
    return res.sendStatus(200);
  }
}


    // Si NO es comando directo, intenta modo "agendar" (hora + nombre)
// Small talk / empatía (solo cuando NO usamos IA global)
// Cuando WA_AI_ENABLED=true, dejamos que la IA maneje todo (incluye smalltalk y flujo de cita)
if (!WA_AI_ENABLED && !/^(CONFIRMAR|CANCELAR|REPROGRAMAR|FAQ_PRECIOS_)/i.test(text)) {
  const st = detectSmalltalkIntent(text);
  if (st) {
    await replySmalltalk({ to: from, kind: st.kind, q, inferSucursalIdByPhone });
    await markProcessed(wamid);
    return res.sendStatus(200);
  }
}

    // ===================== IA: conversación WhatsApp en tiempo real =====================
// Si no es confirmación/cancelación, dejamos que la IA revise disponibilidad REAL por sucursal y agende en BD.
// ✅ IMPORTANTE:
// - Guardamos TODO en ai_messages para que el widget web lo vea.
// - Al elegir sucursal (1/2/3) NO mandamos ese "1" a la IA (si no, responde "mensaje incompleto").
// - No usamos AGENDAR_HOY/AGENDAR_MANANA cuando WA_AI_ENABLED=true; la IA entiende "hoy/mañana".
if (WA_AI_ENABLED && !/^(CONFIRMAR|CANCELAR|REPROGRAMAR|FAQ_PRECIOS_)\b/i.test(text)) {
  const forcedKey = forcedDbKeyDefault();

  // Todo el flujo de WhatsApp IA ocurre dentro de la DB forzada (db1/db2/db3)
  return runWithDbKey(forcedKey, async () => {
    const conversationId = await ensureAiConversationForPhone({ phone: from, sucursalId: null, phoneNumberId: aiPhoneNumberId });
    if (!conversationId) {
      await safeReply(from, 'No pude iniciar la conversación. Intenta de nuevo por favor.');
      await markProcessed(wamid);
      return res.sendStatus(200);
    }

    // Log del mensaje entrante en ai_messages (para UI)
    await logAiMessage(conversationId, 'user', text, { source:'whatsapp', wa_phone: from, wamid }).catch(()=>{});

    // ✅ Dejamos que el módulo /api/ai/chat maneje el flujo completo (incluye selección de sucursal cuando aplique).
    //    Importante: esto evita el mensaje anclado "¿Con qué sucursal deseas agendar?" en cada reinicio.
    //    Si el usuario pide cambiar sucursal, limpiamos el valor y la IA lo solicitará cuando sea necesario.
    if (wantsChangeSucursal(text)) {
      await setAiConversationSucursal(conversationId, null).catch(()=>{});
    }

    // Tomamos sucursal actual desde la conversación (si existe). Si es null, la IA decidirá si pedirla o no.
    const convNow = await getAiConversationById(conversationId).catch(()=>null);
    const sucForAi = convNow?.state?.wa_sucursal || convNow?.sucursal_id || null;

    const ai = await callAiChatInternal({
      conversationId,
      message: text,
      phone: from,
      sucursalId: sucForAi,
      dbKey: forcedKey,
      phoneNumberId: aiPhoneNumberId,
    });

    await safeReply(from, ai.reply);

    await logWa({
      direction: 'outgoing',
      phone: from,
      message: ai.reply,
      status: ai.ok ? 'sent' : 'failed',
      sucursalId: sucForAi,
      appointmentId: null,
      waMessageId: null,
      manual: false,
    });

    await logAiMessage(conversationId, 'assistant', ai.reply, { source:'whatsapp', used:'ai_chat' }).catch(()=>{});

    await markProcessed(wamid);
    return res.sendStatus(200);
  });
}
if (!/^(CONFIRMAR|CANCELAR|REPROGRAMAR)\b/i.test(text)) {
      const agendarCtx = await detectAgendarContext(q, from);
      if (agendarCtx) {
        const parsed = parseHoraYNombre(text);
        if (!parsed) {
          await sendWhatsAppText({
            to: from,
            text: `${timeGreeting()} ¿Podrías enviarme la hora en formato HH:MM y tu nombre? Ej: 15:30 Juan Pérez`
          });
          await markProcessed(wamid);
          return res.sendStatus(200);
        }

        const { time, name } = parsed;
        const when = agendarCtx.when; // 'hoy' | 'manana'
        const date = when === 'manana' ? ymdOffset(1) : ymdOffset(0);

        const [H] = time.split(':').map(Number);
        if (H < 8 || H > 20) {
          await sendWhatsAppText({
            to: from,
            text: `${timeGreeting()} Nuestro horario es de 08:00 a 20:00. ¿Te parece una hora dentro de ese rango?`
          });
          await markProcessed(wamid);
          return res.sendStatus(200);
        }

        const sucursalForIncoming_agendar = await inferSucursalIdByPhone(from);

        const phoneLocal10 = phoneForDb(from);
        const insertSql = `
          INSERT INTO ${APPT_TABLE}
            (${PHONE_COL}, ${APPT_NAME_COLUMN}, date, start_time, status, sucursal_id)
          VALUES ($1, $2, $3, $4, 'Pendiente', $5)
          RETURNING id
        `;
        const ins = await q(insertSql, [phoneLocal10, name || 'Paciente', date, time, sucursalForIncoming_agendar]);
        const apptId = ins.rows[0]?.id;

        const ddmmyyyy = dateMx(date);
        const hhmmText = time.slice(0,5);
        const body = friendlyText(`${when === 'manana' ? 'mañana' : 'hoy'} ${ddmmyyyy}`, {
          kind: 'booked',
          args: [ddmmyyyy, hhmmText, name]
        });

        // 🏦 Depósito opcional por sucursal (solo si la BD tiene la columna)


        const cfg = await getDepositConfig({ branchKey: sucursalForIncoming_agendar });


        let data = null;


        if (cfg.requireDeposit) {


          const instr = cfg.depositInstructions


            ? String(cfg.depositInstructions).trim()


            : 'Para confirmar tu cita necesitamos un anticipo. Responde con: *REF 123456* (tu referencia) y enseguida te habilito el botón de Confirmar.';


        


          console.log('🏦 [deposit] Booking created -> requesting deposit ref:', { apptId, sucursal: sucursalForIncoming_agendar });


          await safeReply(from, `${timeGreeting()} ${instr}`);


        } else {


          data = await sendWhatsAppButtons({ to: from, bodyText: body, apptId });


        }

        const outMarker = cfg.requireDeposit ? (body + ' [deposit_required]') : (body + ' [buttons:CONFIRMAR/CANCELAR]');

        try {
          await logWa({
            direction: 'outgoing',
            phone: from,
            message: outMarker,
            status: 'sent',
            appointmentId: apptId,
            sucursalId: sucursalForIncoming_agendar,
            waMessageId: (data && data.messages && data.messages[0] && data.messages[0].id) || null,
            manual: false,
          });
        } catch (e) {
          console.error('log outgoing (agendar) fail', e.message);
        }

        await markProcessed(wamid);
        return res.sendStatus(200);
      }
    }

    // 🔍 DEBUG 1
    console.log('🔍 WEBHOOK DEBUG:', {
      from_original: msg.from,
      from_e164: from,
      text_extracted: text,
      message_type: msg.type,
      timestamp: new Date().toISOString()
    });

    const sucursalForIncoming = await inferSucursalIdByPhone(from);

    // 🏢 DEBUG 2
    console.log('🏢 SUCURSAL DEBUG:', {
      phone: from,
      sucursal_inferida: sucursalForIncoming,
      IGNORE_SUC: IGNORE_SUC,
      CROSS_SUC_FALLBACK: CROSS_SUC_FALLBACK,
      LOOKBACK_DAYS: LOOKBACK_DAYS
    });

    // Log INCOMING
    try {
      await logWa({
        direction: 'incoming',
        phone: from,
        message: text,
        status: 'received',
        sucursalId: sucursalForIncoming,
        manual: false,
      });
    } catch (e) { console.error('log incoming fail', e.message); }

// 🔗 Buscar mensaje de contexto (plantilla o botones de confirmación)
    let contextAppt = null;
    if (contextId) {
      console.log('🔍 [CONTEXT] Buscando mensaje de contexto:', {
        context_id: contextId,
        phone_number_id: phoneNumberId,
        from: from
      });
      
      try {
        // 1) intentar en la DB seleccionada para esta request
        const rCtx = await q(
          `SELECT appointment_id, sucursal_id, direction, created_at
             FROM whatsapp_messages
            WHERE wa_message_id = $1
            ORDER BY id DESC
            LIMIT 1`,
          [contextId]
        );
        contextAppt = rCtx.rows[0] || null;
        
        if (contextAppt) {
          console.log('✅ [CONTEXT] Encontrado en DB primaria:', {
            appointment_id: contextAppt.appointment_id,
            sucursal_id: contextAppt.sucursal_id,
            direction: contextAppt.direction,
            created_at: contextAppt.created_at
          });
        } else {
          console.log('⚠️ [CONTEXT] No encontrado en DB primaria');
        }

        // 2) si no existe, intentar en otras DBs y "mover" el contexto a esa DB
        if (!contextAppt) {
          const store = als.getStore();
          const primary = store?.pool || poolDB1;
          const others = [poolDB1, poolDB2, poolDB3].filter(Boolean).filter(p => p !== primary);

          console.log('🔍 [CONTEXT] Buscando en otras DBs:', {
            pools_to_search: others.map(dbName)
          });

          for (const candidate of others) {
            const rCtx2 = await candidate.query(
              `SELECT appointment_id, sucursal_id, direction, created_at
                 FROM whatsapp_messages
                WHERE wa_message_id = $1
                ORDER BY id DESC
                LIMIT 1`,
              [contextId]
            );
            contextAppt = rCtx2.rows[0] || null;

            if (contextAppt && store) {
              store.pool = candidate;
              store.dbKey = dbName(candidate);
              console.log('🔁 CONTEXT ENCONTRADO EN OTRA DB, CAMBIANDO POOL:', {
                context_id: contextId,
                db_used: store.dbKey,
                appointment_id: contextAppt.appointment_id,
                sucursal_id: contextAppt.sucursal_id
              });
              break;
            }
          }
          
          if (!contextAppt) {
            console.log('❌ [CONTEXT] No encontrado en ninguna DB');
          }
        }
      } catch (e) {
        console.error('❌ CONTEXT LOOKUP ERROR:', e.message, e.stack);
      }
    } else {
      console.log('ℹ️ [CONTEXT] Sin context_id en el mensaje');
    }

    // === Encuesta de satisfacción: capturar respuestas 1–5 ===
    const matchRating = text && text.trim().match(/^([1-5])$/);
    if (matchRating) {
      const rating = Number(matchRating[1]);

       try {
    const apptRow = await findLastAttendedWithoutSatisfaction(from);

    if (apptRow && apptRow.id) {
      if (!apptRow.service_id) {
        console.log('⚠️ Cita atendida sin service_id, no se puede guardar satisfacción', {
          appointment_id: apptRow.id,
          rating,
        });
      } else {
        await q(
          `INSERT INTO satisfaccion_servicio (appointment_id, service_id, rating, sucursal_id)
           VALUES ($1, $2, $3, $4)`,
          [
            apptRow.id,
            apptRow.service_id,
            rating,
            apptRow.sucursal_id || sucursalForIncoming
          ]
        );
        console.log('✅ Satisfacción guardada:', {
          appointment_id: apptRow.id,
          service_id: apptRow.service_id,
          rating,
          sucursal_id: apptRow.sucursal_id || sucursalForIncoming,
        });
      }
    } else {
      console.log('ℹ️ Respuesta de satisfacción sin cita ATENDIDA reciente:', {
        phone: from,
        rating,
      });
    }
  } catch (e) {
    console.error('💥 Error guardando satisfacción:', e.message);
  }


      const thanks =
`${timeGreeting()} Muchas gracias por calificarnos con *${rating}/5* 🙌
Seguiremos mejorando para que tu experiencia sea cada vez más agradable.`;

      await safeReply(from, thanks);
      await markProcessed(wamid);
      return res.sendStatus(200);
    }



// ===================== Depósito: capturar referencia (REF ...) =====================
// (movido arriba para que NO pase por IA)
// ===================== Fin depósito REF =====================
       const sucursalId = sucursalForIncoming;

    // Intentar machear CONFIRMAR / CANCELAR (con o sin ID numérico)
    const m = text
      ? text.toUpperCase().match(/^(CONFIRMAR|CANCELAR)(?:\s+(\d+))?$/)
      : null;

    // 🎯 DEBUG 3
    console.log('🎯 PATTERN DEBUG:', {
      text_original: text,
      text_upper: text?.toUpperCase?.() || '',
      pattern_matched: !!m,
      action: m?.[1],
      id_hint: m?.[2],
      regex_used: '^(CONFIRMAR|CANCELAR)(?:\\s+(\\d+))?$'
    });

    // 🛑 Si viene respondiendo a un mensaje (contextId)
    //     pero en ESTA base no existe ese wa_message_id,
    //     ignoramos CONFIRMAR/CANCELAR para que lo procese el backend correcto.
    if (STRICT_CONTEXT && contextId && !contextAppt && m) {
  console.log('🚫 [ROUTER] CONTEXT SIN MATCH; IGNORANDO CONFIRMAR/CANCELAR:', {
    from,
    context_id: contextId,
    text,
    sucursalId
  });
  await markProcessed(wamid);
  return res.sendStatus(200);
}

    // ===== Hook de FAQ antes del motor de reglas =====
    if (!m) {
      const faq = await matchFaq(q, text, sucursalForIncoming);
      if (faq) {
        await sendFaqAnswer({ faq, to: from, incomingText: text });
        await markProcessed(wamid);
        return res.sendStatus(200);
      }
    }
    // ================================================


    if (!m) {
      // ⚙️ Motor de reglas conversacional
      const handled = await evaluateAndExecute({
        q,
        text,
        from,
        sucursalId: sucursalForIncoming,
        phoneColumn: PHONE_COL,
        buildPhoneVariants,
        senders: {
          sendWhatsAppText,
          sendWhatsAppTemplate,
          sendWhatsAppButtons: sendInteractiveButtons,
        },
        timezone: process.env.TZ || 'America/Tijuana'
      });
      if (!handled) {
        console.log('ℹ️ Motor de reglas: sin match.');
      }
      await markProcessed(wamid);
      return res.sendStatus(200);
    }

    const action = m[1];
    let idHint = m[2] ? Number(m[2]) : null;

    // Si el paciente responde al mensaje/botón de WhatsApp, Meta manda context_id.
    // Si ya encontramos ese mensaje en whatsapp_messages, usamos su appointment_id
    // para actualizar EXACTAMENTE esa cita, aunque el texto venga solo como CONFIRMAR.
    if (!idHint && contextAppt && contextAppt.appointment_id) {
      idHint = Number(contextAppt.appointment_id);
      console.log('✅ [CONTEXT] Usando appointment_id del mensaje respondido:', {
        appointment_id: idHint,
        context_sucursal: contextAppt.sucursal_id || null
      });
    }

    // Respaldo para plantillas de WhatsApp:
    // algunos quick-reply llegan como CONFIRMAR/CANCELAR sin folio y sin context_id útil.
    // En ese caso buscamos el último mensaje saliente con appointment_id enviado
    // recientemente al mismo número, en cualquiera de las DB configuradas.
    if (!idHint && /^(CONFIRMAR|CANCELAR)$/i.test(action)) {
      const incomingDigits = onlyDigits(from);
      const store = als.getStore();
      const primary = store?.pool || poolDB1;
      const pools = [primary, poolDB1, poolDB2, poolDB3].filter(Boolean);
      const uniqPools = [];
      const seenPools = new Set();

      for (const p of pools) {
        if (!seenPools.has(p)) {
          seenPools.add(p);
          uniqPools.push(p);
        }
      }

      let latestOutgoing = null;
      let latestPool = null;

      for (const candidate of uniqPools) {
        try {
          const rLast = await candidate.query(
            `SELECT appointment_id, sucursal_id, wa_message_id, created_at
               FROM whatsapp_messages
              WHERE direction = 'outgoing'
                AND appointment_id IS NOT NULL
                AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $1
                AND created_at >= NOW() - INTERVAL '72 hours'
              ORDER BY created_at DESC, id DESC
              LIMIT 1`,
            [incomingDigits]
          );

          const row = rLast.rows[0] || null;
          if (
            row &&
            (!latestOutgoing ||
              new Date(row.created_at).getTime() > new Date(latestOutgoing.created_at).getTime())
          ) {
            latestOutgoing = row;
            latestPool = candidate;
          }
        } catch (eLast) {
          console.log('⚠️ [LAST OUTGOING] No se pudo buscar en una DB:', {
            db: dbName(candidate),
            error: String(eLast?.message || eLast)
          });
        }
      }

      if (latestOutgoing?.appointment_id) {
        idHint = Number(latestOutgoing.appointment_id);

        if (store && latestPool) {
          store.pool = latestPool;
          store.dbKey = dbName(latestPool);
        }

        if (!sucursalForIncoming && latestOutgoing.sucursal_id) {
          sucursalForIncoming = latestOutgoing.sucursal_id;
        }

        console.log('✅ [LAST OUTGOING] Cita recuperada desde último recordatorio:', {
          appointment_id: idHint,
          sucursal_id: latestOutgoing.sucursal_id || null,
          wa_message_id: latestOutgoing.wa_message_id || null,
          created_at: latestOutgoing.created_at,
          db_used: latestPool ? dbName(latestPool) : null,
          phone_digits: incomingDigits
        });
      } else {
        console.log('⚠️ [LAST OUTGOING] No se encontró recordatorio reciente con appointment_id:', {
          phone: from,
          phone_digits: incomingDigits
        });
      }
    }

    const newStatus = (action === 'CONFIRMAR') ? 'Confirmada' : 'Cancelada';

// ===================== Depósito: bloquear CONFIRMAR si falta referencia =====================
if (action === 'CONFIRMAR') {
  const sucKey = sucursalId || (process.env.SUCURSAL_ID_DEFAULT || 'sucursal_1');
  const cfg = await getDepositConfig({ branchKey: sucKey });

  if (cfg.requireDeposit) {
    const refInfo = await findLatestDepositRefFromMessagesMultiDb(from, { hours: 72 });
    console.log('🏦 [deposit] Confirm attempt:', {
      from,
      sucKey,
      requireDeposit: true,
      hasRef: Boolean(refInfo?.ref),
      ref: refInfo?.ref || null
    });

    if (!refInfo?.ref) {
      const instr = cfg.depositInstructions
        ? String(cfg.depositInstructions).trim()
        : 'Para confirmar tu cita necesitamos el *anticipo*.\nResponde con: *REF 123456* (tu número de referencia) y enseguida te habilito el botón de Confirmar.';
      await safeReply(from, `${timeGreeting()} Antes de confirmar, necesitamos tu referencia de depósito/transferencia.\n\n${instr}`);
      await markProcessed(wamid);
      return res.sendStatus(200);
    }
  }
}
// ===================== Fin depósito CONFIRMAR =====================


    // 📋 DEBUG 4
    console.log('⚡ PROCESANDO COMANDO:', {
      action, idHint, newStatus, sucursalId, IGNORE_SUC, PHONE_COL
    });

    // Con ID explícito
    if (idHint) {
      const whereSuc = IGNORE_SUC ? 'TRUE' : 'sucursal_id = $3 OR sucursal_id IS NULL';

      // 🧠 Dual-DB: el webhook de WhatsApp no trae x-app. Si el pool "activo" no corresponde,
      // el UPDATE por ID puede caer en la base equivocada. Para evitarlo, intentamos en ambas.
      const store = als.getStore();
      const primaryPool = store?.pool || poolDB1;

      // 🧠 Multi-DB: el webhook de WhatsApp no trae x-app. Para evitar caer en la base equivocada,
      // intentamos el UPDATE por ID en todas las bases configuradas (db1/db2/db3).
      const pools = [primaryPool, poolDB1, poolDB2, poolDB3].filter(Boolean);
      const uniq = [];
      const seen = new Set();
      for (const p of pools) {
        if (!seen.has(p)) { seen.add(p); uniq.push(p); }
      }

      const sqlUpdate = `UPDATE appointments SET status = $1 WHERE id = $2 AND (${whereSuc}) RETURNING id,date,start_time,sucursal_id`;
      const params = IGNORE_SUC ? [newStatus, idHint] : [newStatus, idHint, sucursalId];

      console.log('🎯 UPDATE CON ID (multi-db):', {
        appointment_id: idHint,
        whereSuc_clause: whereSuc,
        params,
        pools_to_try: uniq.map(dbName)
      });

      let r = { rows: [] };
      let usedPool = null;
      for (const p of uniq) {
        const rr = await p.query(sqlUpdate, params);
        if (rr.rows && rr.rows.length) {
          r = rr;
          usedPool = p;
          break;
        }
      }

      // Respaldo multi-tenant:
      // La cita puede existir pero tener otro identificador interno de sucursal
      // (por ejemplo "victoria" en lugar de "sucursal_1").
      // Para no actualizar una cita equivocada con el mismo ID en otra DB,
      // validamos también que el teléfono de la cita coincida con quien respondió.
      if (!r.rows.length) {
        const incomingPhoneDigits = onlyDigits(from);
        console.log('🔁 FALLBACK ID + TELÉFONO SIN FILTRO DE SUCURSAL:', {
          appointment_id: idHint,
          phone_digits: incomingPhoneDigits,
          phone_column: PHONE_COL,
          dbs: uniq.map(dbName)
        });

        for (const p of uniq) {
          try {
            const rr = await p.query(
              `UPDATE appointments
                  SET status = $1
                WHERE id = $2
                  AND RIGHT(
                        regexp_replace(COALESCE(${PHONE_COL}::text, ''), '\\D', '', 'g'),
                        10
                      ) = RIGHT($3::text, 10)
                RETURNING id,date,start_time,sucursal_id`,
              [newStatus, idHint, incomingPhoneDigits]
            );

            if (rr.rows && rr.rows.length) {
              r = rr;
              usedPool = p;
              console.log('✅ CITA ENCONTRADA POR ID + TELÉFONO:', {
                appointment_id: idHint,
                db_used: dbName(p),
                sucursal_real: rr.rows[0]?.sucursal_id || null
              });
              break;
            }
          } catch (fallbackErr) {
            console.log('⚠️ FALLBACK ID + TELÉFONO FALLÓ EN DB:', {
              db: dbName(p),
              error: String(fallbackErr?.message || fallbackErr)
            });
          }
        }
      }

      if (!usedPool) usedPool = primaryPool;

      // Si encontramos en otra DB, ajustamos el pool del contexto para coherencia
      if (store && usedPool && store.pool !== usedPool) {
        store.pool = usedPool;
      }
      console.log('🎯 BÚSQUEDA CON ID EXPLÍCITO:', {
        appointment_id: idHint,
        whereSuc_clause: whereSuc,
        sql_params: IGNORE_SUC ? [newStatus, idHint] : [newStatus, idHint, sucursalId]
      });

      console.log('💾 RESULTADO UPDATE CON ID:', {
        rows_affected: r.rows.length,
        appointment_found: !!r.rows[0],
        appointment_data: r.rows[0] || null
      });

      const appt = r.rows[0];
      if (!appt) {
        console.log('❌ NO SE ENCONTRÓ CITA CON ID:', idHint);
        await safeReply(from, friendlyText(`No encontré la cita con ID ${idHint}${IGNORE_SUC ? '' : ` en ${sucursalId}`}.`));
        await markProcessed(wamid);
        return res.sendStatus(200);
      }

      const msgOk = (action === 'CONFIRMAR')
        ? friendlyText('', { kind: 'confirmOk', args: [appt.id, dateMx(appt.date), hhmm(appt.start_time), appt.sucursal_id || sucursalId] })
        : friendlyText('', { kind: 'cancelOk',  args: [appt.id, dateMx(appt.date), hhmm(appt.start_time), appt.sucursal_id || sucursalId] });

      console.log('✅ ÉXITO CON ID - Enviando respuesta:', msgOk);
      await safeReply(from, msgOk);
      await markProcessed(wamid);
      return res.sendStatus(200);
    }

    // Sin ID → heurística (usando SOLO DÍGITOS para evitar problemas de formato)
const variants = buildPhoneVariants(from);                // originales
const digitVariants = variants.map(onlyDigits).filter(Boolean);  // solo dígitos
const whereSuc = IGNORE_SUC ? 'TRUE' : 'sucursal_id = $2 OR sucursal_id IS NULL';

// 🧠 IMPORTANTE (dual-DB): cuando NO hay idHint, buscamos la cita en la DB seleccionada
// y si no aparece, intentamos en la otra DB.
// Esto resuelve el caso "WhatsApp siempre cae al mismo backend" con 2 bases separadas.
const store = als.getStore();
let primaryPool = store?.pool || poolDB1;
let secondaryPool = null;
if (poolDB2) secondaryPool = (primaryPool === poolDB1) ? poolDB2 : poolDB1;

async function selectOneAppt(pool, sql, params) {
  const rr = await pool.query(sql, params);
  return { row: rr.rows[0] || null, rows: rr.rows || [] };
}

async function findApptAcrossDbs(sql, params, sql2, params2) {
  // 1) intenta en pool primario
  let out = await selectOneAppt(primaryPool, sql, params);
  if (out.row) return { appt: out.row, pool: primaryPool, meta: { tried: 'primary', rows: out.rows } };

  // 2) si hay pool secundario, intenta también
  if (secondaryPool) {
    const out2 = await selectOneAppt(secondaryPool, sql2 || sql, params2 || params);
    if (out2.row) return { appt: out2.row, pool: secondaryPool, meta: { tried: 'secondary', rows: out2.rows } };
  }
  return { appt: null, pool: null, meta: { tried: 'both', rows: [] } };
}

console.log('📞 BÚSQUEDA HEURÍSTICA:', {
  phone_input: from,
  phone_variants: variants,
  digit_variants: digitVariants,
  sucursal_for_search: sucursalId,
  whereSuc_clause: whereSuc,
  PHONE_COL: PHONE_COL,
  PHONE_COL_DIGITS: PHONE_COL_DIGITS
});

const sqlFuture = `SELECT id,date,start_time,sucursal_id,status FROM appointments
        WHERE ${PHONE_COL_DIGITS} = ANY($1) AND (${whereSuc}) AND date >= CURRENT_DATE
        ORDER BY date ASC,start_time ASC LIMIT 1`;

const pFuture = IGNORE_SUC ? [digitVariants] : [digitVariants, sucursalId];
let f1 = await findOneAcrossDbs(sqlFuture, pFuture);
let appt = f1.appt;
let apptPool = f1.pool;

console.log('🔮 BÚSQUEDA FUTURA:', {
  found: !!appt,
  rows_count: f1.rows_count,
  appointment: appt,
  db_used: dbName(apptPool)
});

if (!appt) {
  const sqlRecent = `SELECT id,date,start_time,sucursal_id,status FROM appointments
          WHERE ${PHONE_COL_DIGITS} = ANY($1) AND (${whereSuc})
            AND date >= (CURRENT_DATE - INTERVAL '${LOOKBACK_DAYS} days')
          ORDER BY date DESC,start_time DESC LIMIT 1`;

  const pRecent = IGNORE_SUC ? [digitVariants] : [digitVariants, sucursalId];
  const f2 = await findOneAcrossDbs(sqlRecent, pRecent);
  appt = f2.appt;
  apptPool = f2.pool;

  console.log('🕐 BÚSQUEDA RECIENTE:', {
    found: !!appt,
    rows_count: f2.rows_count,
    appointment: appt,
    lookback_days: LOOKBACK_DAYS,
    db_used: appt ? dbName(apptPool) : null
  });
}

// Fallback adicional: si la config dice CROSS_SUC_FALLBACK, buscamos sin filtrar por sucursal.
// En dual-DB esto también se intenta en ambas.
if (!appt && CROSS_SUC_FALLBACK) {
  const sqlAll = `SELECT id,date,start_time,sucursal_id,status FROM appointments
          WHERE ${PHONE_COL_DIGITS} = ANY($1) AND date >= CURRENT_DATE
          ORDER BY date ASC,start_time ASC LIMIT 1`;
  const f3 = await findOneAcrossDbs(sqlAll, [digitVariants]);
  appt = f3.appt;
  apptPool = f3.pool;

  console.log('🔄 CROSS-SUCURSAL FALLBACK:', {
    found: !!appt,
    rows_count: f3.rows_count,
    appointment: appt,
    db_used: appt ? dbName(apptPool) : null
  });
}

    if (!appt) {
      console.log('❌ NO SE ENCONTRÓ NINGUNA CITA:', { phone: from, variants, sucursal: sucursalId });
      await safeReply(from, friendlyText(`No encontré citas vigentes asociadas a tu número${IGNORE_SUC ? '' : ` en ${sucursalId}`}.`));
      await markProcessed(wamid);
      return res.sendStatus(200);
    }

    console.log('✅ CITA ENCONTRADA - Antes del UPDATE:', {
      appointment_id: appt.id,
      current_status: appt.status || null,
      new_status: newStatus,
      appointment_data: appt
    });
    // 🔒 Candado extra: si requiere anticipo, NO confirmar sin REF (aunque llegue por botón/template)
    if (action === 'CONFIRMAR') {
      try {
        const branchKeyForGate = String(appt.sucursal_id || sucursalId || process.env.SUCURSAL_ID_DEFAULT || 'sucursal_1');
        const depCfg = await getDepositConfig({ branchKey: branchKeyForGate });
        if (depCfg.requireDeposit) {
          const foundRef = await findLatestDepositRefFromMessagesMultiDb(from, { hours: 72 });
          if (!foundRef?.ref) {
            const instr = depCfg.depositInstructions
              ? String(depCfg.depositInstructions).trim()
              : 'Para confirmar tu cita necesitamos tu referencia. Envía: *REF 123456* (tu referencia) y después presiona *Confirmar*.';
            await safeReply(from, `${timeGreeting()} ${instr}`);
            await markProcessed(wamid);
            return res.sendStatus(200);
          }
        }
      } catch (eGate) {
        // si el gate falla, NO bloqueamos (pero logeamos)
        console.warn('⚠️ [deposit] extra gate failed:', eGate?.message || eGate);
      }
    }

    // ✅ Dual-DB: actualiza en la MISMA base donde encontramos la cita
    await (apptPool || (als.getStore()?.pool || poolDB1)).query(
      `UPDATE appointments SET status = $1 WHERE id = $2`,
      [newStatus, appt.id]
    );

    console.log('💾 UPDATE COMPLETADO:', {
      appointment_id: appt.id,
      status_changed_to: newStatus,
      success: true
    });

    const msgOk = (action === 'CONFIRMAR')
      ? friendlyText('', { kind: 'confirmOk', args: [appt.id, dateMx(appt.date), hhmm(appt.start_time), appt.sucursal_id || sucursalId] })
      : friendlyText('', { kind: 'cancelOk',  args: [appt.id, dateMx(appt.date), hhmm(appt.start_time), appt.sucursal_id || sucursalId] });

    console.log('✅ PROCESO EXITOSO - Enviando respuesta:', msgOk);
    await safeReply(from, msgOk);
    
    // 🔔 Admin notification for confirmations
    if (action === 'CONFIRMAR') {
      try {
        const adminToRaw = String(process.env.WA_ADMIN_NOTIFY_PHONE || '').trim();
        const adminTo = adminToRaw ? onlyDigits(adminToRaw) : '';
        const notifyOn = String(process.env.WA_ADMIN_NOTIFY_ON_CONFIRM || 'true').toLowerCase() === 'true';

        if (notifyOn && adminTo) {
          // Buscar REF real (si existe) en cualquier DB (últimas 72h)
          const refInfo = await findLatestDepositRefFromMessagesMultiDb(from, { hours: 72 }).catch(() => ({ ref: null }));

          // Intentar resolver nombre del paciente (si la tabla tiene columna)
          let patientName = appt.patient_name || appt.patient || appt.name || null;
          if (!patientName) {
            try {
              if (await hasColumn(APPT_TABLE, 'patient_name')) {
                const rr = await (apptPool || (als.getStore()?.pool || poolDB1)).query(
                  `SELECT patient_name FROM ${APPT_TABLE} WHERE id = $1 LIMIT 1`,
                  [appt.id]
                );
                patientName = rr.rows[0]?.patient_name || null;
              } else if (await hasColumn(APPT_TABLE, 'patient')) {
                const rr = await (apptPool || (als.getStore()?.pool || poolDB1)).query(
                  `SELECT patient FROM ${APPT_TABLE} WHERE id = $1 LIMIT 1`,
                  [appt.id]
                );
                patientName = rr.rows[0]?.patient || null;
              } else if (await hasColumn(APPT_TABLE, 'name')) {
                const rr = await (apptPool || (als.getStore()?.pool || poolDB1)).query(
                  `SELECT name FROM ${APPT_TABLE} WHERE id = $1 LIMIT 1`,
                  [appt.id]
                );
                patientName = rr.rows[0]?.name || null;
              }
            } catch (_) {}
          }

          const branchName = sucLabel(appt.sucursal_id || sucursalId);

          const adminMsg =
            `🔔 *NUEVA CONFIRMACIÓN*

` +
            `📅 Cita #${appt.id}
` +
            `👤 Paciente: ${patientName || 'N/A'}
` +
            `📆 ${dateMx(appt.date)} a las ${hhmm(appt.start_time)}
` +
            `🏥 Sucursal: ${branchName}
` +
            `📱 Paciente: ${from}
` +
            `✅ Referencia: ${refInfo?.ref ? refInfo.ref : 'SIN REF'}
`;

          await sendWhatsAppText({ to: adminTo, text: adminMsg });
          console.log('✅ Admin notification sent to:', adminTo);
        }
      } catch (adminErr) {
        console.warn('⚠️ Failed to send admin notification:', adminErr.message);
      }
    }

    await markProcessed(wamid);
    return res.sendStatus(200);

  } catch (e) {
    console.error('💥 WEBHOOK ERROR GENERAL:', {
      error_message: e.message,
      error_stack: e.stack,
      timestamp: new Date().toISOString()
    });
    return res.sendStatus(200);
  }
});

// ===================== utilitarios =====================
router.post('/send-message', async (req, res) => {
  try {
    const { phone, message } = req.body || {};
    if (!phone || !message) return res.status(400).json({ ok:false, error:'phone and message are required' });
    const data = await sendWhatsAppText({ to: phone, text: message });
    const suc = getSucursalFromReq(req);
    try {
      await logWa({
        direction: 'outgoing',
        phone: toE164(phone),
        message,
        status: 'sent',
        sucursalId: suc,
        waMessageId: (data && data.messages && data.messages[0] && data.messages[0].id) || null,
        manual: true,
      });
    } catch (e) { console.error('log outgoing fail', e.message); }
    res.json({ ok:true, data });
  } catch (err) {
    res.status(500).json({ ok:false, error: String(err?.message || err) });
  }
});

router.post('/send-template', async (req, res) => {
  try {
    const { phone, template, lang = WA_TEMPLATE_LANG, bodyParams = [], headerParams = [] } = req.body || {};
    if (!phone || !template) return res.status(400).json({ ok:false, error:'phone y template son requeridos' });
    const data = await sendWhatsAppTemplate({ to: phone, template, lang, bodyParams, headerParams });
    const suc = getSucursalFromReq(req);
    try {
      await logWa({
        direction: 'outgoing',
        phone: toE164(phone),
        message: `[template:${template}]`,
        status: 'sent',
        sucursalId: suc,
        waMessageId: (data && data.messages && data.messages[0] && data.messages[0].id) || null,
        manual: true,
      });
    } catch (e) { console.error('log outgoing fail (tpl)', e.message); }
    res.json({ ok:true, data });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});

router.post('/send-image', async (req, res) => {
  try {
    const { phone, link, caption = '' } = req.body || {};
    if (!phone || !link) return res.status(400).json({ ok:false, error:'phone y link son requeridos' });
    const data = await waPost({ messaging_product: 'whatsapp', to: phone, type: 'image', image: { link, caption } });
    res.json({ ok:true, data });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});

// ===================== Encuesta de satisfacción por cita atendida =====================
router.post('/survey/appointment-attended', async (req, res) => {
  try {
    const { appointment_id } = req.body || {};
    if (!appointment_id) {
      return res.status(400).json({ ok: false, error: 'appointment_id es requerido' });
    }

    const r = await q(
      `SELECT id,
              ${APPT_NAME_COLUMN} AS patient,
              ${PHONE_COL}       AS phone,
              sucursal_id,
              service_id,
              date
         FROM ${APPT_TABLE}
        WHERE id = $1
        LIMIT 1`,
      [appointment_id]
    );

    const a = r.rows[0];
    if (!a) {
      return res.status(404).json({ ok: false, error: 'cita_no_encontrada' });
    }
    if (!a.phone || !String(a.phone).trim()) {
      return res.status(400).json({ ok: false, error: 'la cita no tiene teléfono válido' });
    }

    const to = toE164(a.phone);
    if (!to) {
      return res.status(400).json({ ok: false, error: 'invalid_phone', phone_raw: a.phone });
    }
    const nombre = a.patient || 'paciente';

    const body =
`${timeGreeting()} ${nombre}, gracias por tu visita a ${BRAND_NAME} 😊

En una escala del *1 al 5*, donde:
*1* = mala experiencia
*5* = experiencia excelente

¿CÓMO CALIFICARÍAS TU EXPERIENCIA DE HOY?
Responde solo con un número del 1 al 5.`;

    const data = await sendWhatsAppText({ to, text: body });

    try {
      await logWa({
        direction: 'outgoing',
        phone: to,
        message: '[encuesta_satisfaccion_enviada] ' + body,
        status: 'sent',
        appointmentId: a.id,
        sucursalId: a.sucursal_id || null,
        waMessageId: data?.messages?.[0]?.id || null,
        manual: false,
      });
    } catch (e) {
      console.error('log outgoing encuesta falló:', e.message);
    }

    return res.json({ ok: true, sent_to: to, appointment_id });
  } catch (e) {
    console.error('POST /survey/appointment-attended error:', e.message);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});


// --- Broadcast HOY ---
router.post('/broadcast/confirmations', async (req, res) => {
  try {
    const REQUIRED = process.env.WA_BROADCAST_SECRET || '';
    const provided = String(req.query.secret || req.headers['x-wa-secret'] || '');
    if (REQUIRED && provided !== REQUIRED) return res.status(401).json({ ok: false, error: 'unauthorized' });

    const tenantId = requireTenantId(req);
    const sucursalId = getSucursalFromReq(req);
    const limit = Math.max(1, Math.min(Number(req.query.limit || 500), 1000));

    const useTemplate = String(req.query.use_template || 'true').toLowerCase() === 'true';
    const useButtons  = String(req.query.buttons || 'false').toLowerCase() === 'true';
    const tplName     = String(req.query.template || WA_CONFIRM_TEMPLATE || '');

    const when = String(req.query.when || 'today').toLowerCase();
    let dateExpr = `CURRENT_DATE`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(when)) dateExpr = `'${when}'::date`;

    const IGNORE = (process.env.APPT_IGNORE_SUCURSAL || 'false').toLowerCase() === 'true';
    const whereSuc = IGNORE
      ? 'TRUE'
      : '(sucursal_id = $2::text OR sucursal_id IS NULL)';
    const limitPlaceholder = IGNORE ? '$2' : '$3';

    const sql = `
      SELECT DISTINCT ON (${PHONE_COL})
             id, patient, ${PHONE_COL} AS phone, date, start_time, sucursal_id, service_id, status
        FROM appointments
       WHERE tenant_id = $1
         AND UPPER(status) = 'PENDIENTE'
         AND (date::date = ${dateExpr})
         AND ${PHONE_COL} IS NOT NULL
         AND TRIM(${PHONE_COL}) <> ''
         AND (${whereSuc})
       ORDER BY ${PHONE_COL}, date ASC, start_time ASC
       LIMIT ${limitPlaceholder}
    `;
    const params = IGNORE
      ? [tenantId, limit]
      : [tenantId, sucursalId, limit];
    const r = await q(sql, params);
    const rows = r.rows || [];

    if (String(req.query.preview || '') === '1') {
      return res.json({
        ok: true,
        preview: true,
        targeted: rows.length,
        rows_sample: rows.map(a => ({
          id: a.id, patient: a.patient, phone: a.phone, date: a.date, start_time: a.start_time, status: a.status, sucursal_id: a.sucursal_id, service_id: a.service_id,
        })),
      });
    }

    if (rows.length === 0) {
      return res.json({ ok: true, targeted: 0, sent: 0, detail: 'No hay citas Pendiente para HOY con teléfono válido.' });
    }

    if (useTemplate && !tplName) {
      return res.status(400).json({ ok:false, error:'Falta WA_CONFIRM_TEMPLATE o query ?template=' });
    }

    let sent = 0;
    const errors = [];
    const phoneIssues = []; // Track phone-related issues specifically

    for (const a of rows) {
      try {
        const to = toE164(a.phone);
        const fechaMx = dateMx(a.date);
        const hora  = hhmm(a.start_time);
        const suc   = a.sucursal_id || sucursalId || '(sin sucursal)';

        // Log phone formatting for debugging
        console.log(`📞 [broadcast] Processing appointment ${a.id}:`, {
          raw_phone: a.phone,
          formatted_e164: to,
          patient: a.patient,
        });

        if (useTemplate) {
          const data = await sendWhatsAppTemplate({
            to,
            template: tplName,
            lang: WA_TEMPLATE_LANG,
            // Ahora solo 4 variables, en este orden:
            // {{1}} = nombre, {{2}} = fecha, {{3}} = hora, {{4}} = folio
            bodyParams: [a.patient || '', fechaMx, hora, String(a.id)],
          });

          await logWa({
            direction: 'outgoing',
            phone: to,
            message: `[template:${tplName}]`,
            status: 'sent',
            appointmentId: a.id,
            sucursalId: a.sucursal_id || sucursalId,
            waMessageId: (data && data.messages && data.messages[0] && data.messages[0].id) || null,
            manual: false,
          });

        } else if (useButtons) {
          const bodyText = `Hola ${a.patient || ''} 👋
¿Puedes confirmar tu cita *HOY* ${fechaMx} a las ${hora}?
Sucursal: ${suc}`;
          const data = await sendWhatsAppButtons({ to, bodyText, apptId: a.id });

          await logWa({
            direction: 'outgoing',
            phone: to,
            message: '[buttons:CONFIRMAR/CANCELAR]',
            status: 'sent',
            appointmentId: a.id,
            sucursalId: a.sucursal_id || sucursalId,
            waMessageId: (data && data.messages && data.messages[0] && data.messages[0].id) || null,
            manual: false,
          });

        } else {
          const text =
`Hola ${a.patient || ''} 👋
¿Puedes confirmar tu cita *HOY* ${fechaMx} a las ${hora}?
Sucursal: ${suc}
Responde *CONFIRMAR ${a.id}* o *CANCELAR ${a.id}*.`;

          const data = await sendWhatsAppText({ to, text });

          await logWa({
            direction: 'outgoing',
            phone: to,
            message: text,
            status: 'sent',
            appointmentId: a.id,
            sucursalId: a.sucursal_id || sucursalId,
            waMessageId: (data && data.messages && data.messages[0] && data.messages[0].id) || null,
            manual: false,
          });
        }

        // 💳 Depósito (solo si está activado para esta sucursal en ESTA DB)
        try {
          const branchKeyForDeposit = String(a.sucursal_id || sucursalId || process.env.SUCURSAL_ID_DEFAULT || 'sucursal_1');
          const depCfg = await getDepositConfig({ branchKey: branchKeyForDeposit });
          if (depCfg.requireDeposit && depCfg.depositInstructions) {
            const depMsg =
`💳 *Anticipo requerido de $300 Mxn para confirmar*
${depCfg.depositInstructions}

Cuando realices el pago, responde con tu referencia (ej: *REF 123456*).
Después escribe *Confirmar* en el mensaje de la cita.`;
            await sendWhatsAppText({ to, text: depMsg });
            await logWa({
              direction: 'outgoing',
              phone: to,
              message: '[deposit_instructions]',
              status: 'sent',
              appointmentId: a.id,
              sucursalId: a.sucursal_id || sucursalId,
              waMessageId: null,
              manual: false,
            });
            console.log('💳 [deposit] Instructions sent to', { to, appointmentId: a.id, branchKey: branchKeyForDeposit });
          }
        } catch (eDep) {
          console.log('⚠️ [deposit] Could not send instructions (non-fatal):', String(eDep?.message || eDep));
        }


        sent++;
        console.log(`✅ [broadcast] Successfully sent to ${to} (appointment ${a.id})`);
      } catch (e) {
        const errorMsg = String(e?.message || e);
        console.error(`❌ [broadcast] Failed to send to ${a.phone} (appointment ${a.id}):`, errorMsg);
        
        // Track phone-specific errors separately for better diagnostics
        if (errorMsg.includes('phone number') || errorMsg.includes('not a WhatsApp user') || 
            errorMsg.includes('unverified') || errorMsg.includes('Invalid') ||
            e?.message?.includes('131030') || e?.message?.includes('131031')) {
          phoneIssues.push({ 
            id: a.id, 
            phone: a.phone, 
            error: 'Phone number issue (may be unverified or not WhatsApp user)',
            details: errorMsg 
          });
        }
        
        errors.push({ id: a.id, phone: a.phone, error: errorMsg });
      }
    }

    const result = { 
      ok: true, 
      targeted: rows.length, 
      sent, 
      errors,
      summary: {
        total_appointments: rows.length,
        successfully_sent: sent,
        failed: errors.length,
        phone_issues: phoneIssues.length,
      }
    };
    
    // Add phone issues to response if any
    if (phoneIssues.length > 0) {
      result.phoneIssues = phoneIssues;
      result.warning = 'Some messages failed due to phone number issues. This typically happens when numbers are not verified in WhatsApp Business API test mode.';
    }
    
    console.log('📊 [broadcast] Summary:', result.summary);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ===================== Panel: mensajes =====================
router.get('/messages', async (req, res) => {
  try {
    const tenantId = requireTenantId(req);
    const limit = Math.max(1, Math.min(Number(req.query.limit || 200), 1000));
    const suc = getSucursalFromReq(req) || null;

    const sql = suc
      ? `SELECT id, wa_message_id, direction AS type, phone, message, status,
                appointment_id, sucursal_id, manual, created_at AS timestamp
           FROM whatsapp_messages
          WHERE tenant_id = $2 AND (sucursal_id = $3 OR sucursal_id IS NULL)
          ORDER BY created_at DESC
          LIMIT $1`
      : `SELECT id, wa_message_id, direction AS type, phone, message, status,
                appointment_id, sucursal_id, manual, created_at AS timestamp
           FROM whatsapp_messages
          WHERE tenant_id = $2
          ORDER BY created_at DESC
          LIMIT $1`;

    const { rows } = await q(sql, suc ? [limit, tenantId, String(suc)] : [limit, tenantId]);

    const apptIds = [...new Set(rows.map(r => r.appointment_id).filter(Boolean))];
    const phones  = [...new Set(rows.map(r => r.phone).filter(Boolean))];

    const namesByAppt  = {};
    const namesByPhone = {};

    if (apptIds.length) {
      try {
        const r = await q(
          `SELECT id, ${APPT_NAME_COLUMN} AS name
             FROM ${APPT_TABLE}
            WHERE id = ANY($1::int[])`,
          [apptIds]
        );
        r.rows.forEach(a => { namesByAppt[a.id] = a.name; });
      } catch (e) {
        console.warn('[whatsapp/messages] join por appointment_id omitido:', e.message);
      }
    }

    if (phones.length) {
      try {
        const last10s = [...new Set(
          phones.map(p => onlyDigits(p)).map(d => d.slice(-10)).filter(v => v && v.length === 10)
        )];

        if (last10s.length) {
          const r = await q(
            `SELECT ${CONTACTS_NAME_COLUMN} AS name,
                    ${CONTACTS_PHONE_COLUMN} AS phone
               FROM ${CONTACTS_TABLE}
              WHERE RIGHT(regexp_replace(${CONTACTS_PHONE_COLUMN}, '\\D', '', 'g'), 10) = ANY($1)
              LIMIT 2000`,
            [last10s]
          );
          r.rows.forEach(row => {
            const key = onlyDigits(row.phone).slice(-10);
            if (key && key.length === 10) namesByPhone[key] = row.name;
          });
        }
      } catch (e) {
        console.warn('[whatsapp/messages] lookup por teléfono last10 omitido:', e.message);
      }
    }

    const enriched = rows.map(r => {
      const byAppt  = r.appointment_id ? namesByAppt[r.appointment_id] : null;
      const key10   = onlyDigits(r.phone).slice(-10);
      const byPhone = key10 ? (namesByPhone[key10] || null) : null;
      return { ...r, contact_name: byAppt || byPhone || null };
    });

    res.set('Content-Type', 'application/json; charset=utf-8');
    res.json(enriched);
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// ===================== Panel: stats =====================
router.get('/stats', async (req, res) => {
  try {
    const tenantId = requireTenantId(req);
    const suc = getSucursalFromReq(req) || null;

    const clauses = ['tenant_id = $1'];
    const params = [tenantId];
    if (suc) {
      clauses.push(`(sucursal_id = $${params.length + 1} OR sucursal_id IS NULL)`);
      params.push(String(suc));
    }
    let idx = params.length;

    const range = String(req.query.range || '').toLowerCase();
    const fromStr = String(req.query.from || '');
    const toStr   = String(req.query.to   || '');

    if (range === 'today') {
      clauses.push(`created_at::date = CURRENT_DATE`);
    } else if (range === 'yesterday') {
      clauses.push(`created_at::date = (CURRENT_DATE - INTERVAL '1 day')`);
    } else if (/^\d+d$/.test(range)) {
      const d = Math.max(1, Math.min(parseInt(range, 10) || 1, 365));
      clauses.push(`created_at >= (CURRENT_DATE - INTERVAL '${d} days')`);
    } else {
      if (/^\d{4}-\d{2}-\d{2}$/.test(fromStr)) {
        idx += 1; clauses.push(`created_at >= $${idx}::date`); params.push(fromStr);
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
        idx += 1; clauses.push(`created_at < ($${idx}::date + INTERVAL '1 day')`); params.push(toStr);
      }
    }

    const where = clauses.length ? clauses.join(' AND ') : 'TRUE';

    const { rows } = await q(
      `SELECT
         COALESCE(SUM((direction='outgoing')::int),0) AS total_sent,
         COALESCE(SUM((direction='incoming')::int),0) AS total_received,
         COALESCE(SUM((direction='incoming' AND upper(message) LIKE 'CONFIRMAR%')::int),0) AS confirmations,
         COALESCE(SUM((direction='incoming' AND upper(message) LIKE 'CANCELAR%')::int),0)  AS cancellations
       FROM whatsapp_messages
       WHERE ${where}`,
      params
    );

    res.set('Content-Type', 'application/json; charset=utf-8');
    res.json(rows[0] || { total_sent:0, total_received:0, confirmations:0, cancellations:0 });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// ===================== Reglas: CRUD & Test =====================
router.get('/rules', requireRulesAdmin, async (req, res) => {
  try {
    const { sucursal_id = null, active, qtext } = req.query;
    const where = [];
    const params = [];
    if (active !== undefined) {
      params.push(String(active).toLowerCase() === 'true');
      where.push(`active = $${params.length}`);
    }
    if (sucursal_id) {
      params.push(sucursal_id);
      where.push(`(sucursal_id = $${params.length})`);
    }
    if (qtext) {
      params.push(`%${qtext}%`);
      where.push(`(name ILIKE $${params.length})`);
    }
    const sql = `
      SELECT id, name, active, priority, match, action, cooldown_secs, sucursal_id, created_at, updated_at
        FROM whatsapp_rules
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY active DESC, priority ASC, created_at ASC`;
    const r = await q(sql, params);
    res.json(r.rows);
  } catch (e) {
    console.error('GET /rules', e);
    res.status(500).json({ error: 'failed_list_rules' });
  }
});

router.post('/rules/test', requireRulesAdmin, async (req, res) => {
  try {
    const { text = '', from = '', sucursal_id = null } = req.body || {};
    const hits = [];
    const senders = {
      sendWhatsAppText: async ({ to, text }) => { hits.push({ type: 'send_text', to, text }); },
      sendWhatsAppTemplate: async ({ to, template, lang, bodyParams, headerParams }) => {
        hits.push({ type: 'send_template', to, template, lang, bodyParams, headerParams });
      },
      sendWhatsAppButtons: async ({ to, body, buttons }) => { hits.push({ type: 'send_buttons', to, body, buttons }); },
    };

    const handled = await evaluateAndExecute({
      q, text, from,
      sucursalId: sucursal_id,
      phoneColumn: PHONE_COL,
      buildPhoneVariants,
      senders,
      timezone: process.env.TZ || 'America/Tijuana'
    });
    res.json({ handled, simulated_actions: hits });
  } catch (e) {
    console.error('POST /rules/test', e);
    res.status(500).json({ error: 'failed_test' });
  }
});

router.put('/rules/:id', requireRulesAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    const r = await q(
      `UPDATE whatsapp_rules
          SET name          = COALESCE($2, name),
              active        = COALESCE($3, active),
              priority      = COALESCE($4, priority),
              match         = COALESCE($5, match),
              action        = COALESCE($6, action),
              cooldown_secs = COALESCE($7, cooldown_secs),
              sucursal_id   = COALESCE($8, sucursal_id),
              updated_at    = NOW()
        WHERE id = $1
        RETURNING *`,
      [
        id,
        req.body.name,
        req.body.active,
        req.body.priority,
        req.body.match,
        req.body.action,
        req.body.cooldown_secs,
        req.body.sucursal_id
      ]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'rule_not_found' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error('PUT /rules/:id', e);
    res.status(500).json({ error: 'failed_update_rule' });
  }
});

router.delete('/rules/:id', requireRulesAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    await q(`DELETE FROM whatsapp_rules WHERE id=$1`, [id]);
  } catch (e) {
    console.error('DELETE /rules/:id', e);
    return res.status(500).json({ error: 'failed_delete_rule' });
  }
  res.status(204).end();
});

router.post('/rules/reorder', requireRulesAdmin, async (req, res) => {
  try {
    const { items = [] } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items_required' });
    await q('BEGIN');
    for (const it of items) {
      await q(`UPDATE whatsapp_rules SET priority=$2, updated_at=NOW() WHERE id=$1`, [String(it.id), Number(it.priority)]);
    }
    await q('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await q('ROLLBACK').catch(() => {});
    console.error('POST /rules/reorder', e);
    res.status(500).json({ error: 'failed_reorder' });
  }
});

// 👇 Exponer helpers para que server.js pueda usarlos
router.sendWhatsAppText = sendWhatsAppText;
router.sendWhatsAppTemplate = sendWhatsAppTemplate;
router.logWa = logWa;


module.exports = router;

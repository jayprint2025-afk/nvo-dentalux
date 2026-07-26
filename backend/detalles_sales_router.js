'use strict';

const express = require('express');
const { Pool } = require('pg');

const DEFAULT_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 15000);

// =====================
// Config: BRAND + PRICING (override via env)
// =====================
const BRAND_NAME = (process.env.DETALLES_BRAND_NAME || process.env.BRAND_NAME || 'Detalles').trim() || 'Detalles';


// =====================
// Helpers
// =====================
function pickDatabaseUrl(opts = {}) {
  return (
    (opts.databaseUrl && String(opts.databaseUrl)) ||
    process.env.SALES_DATABASE_URL ||
    process.env.DATABASE_URL_DB2 ||
    process.env.DATABASE_URL_DB3 ||
    process.env.DATABASE_URL ||
    ''
  );
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

function coerceText(x) {
  return (x === undefined || x === null) ? '' : String(x);
}

// Sanitiza: evita que el historial "infecte" con Dentalux/Dentalite
function sanitizeBrand(text) {
  return coerceText(text)
    .replace(/\bDentalux\b/gi, BRAND_NAME)
    .replace(/\bDentalite\b/gi, BRAND_NAME)
    .replace(/\bDentalux\s*serv\.?\b/gi, BRAND_NAME);

// Extrae telÃ©fono (MX/US) para contacto (WhatsApp). Acepta +52, 52, 10 dÃ­gitos, etc.
function tryExtractPhone(text) {
  const t = coerceText(text);

  // Busca nÃºmeros en el texto
  const m = t.match(/\+?\d[\d\s\-\(\)]{8,}\d/g);
  if (!m) return null;

  // Normaliza: solo dÃ­gitos
  const candidates = m
    .map(x => (x || '').replace(/\D/g, ''))
    .filter(x => x.length >= 10 && x.length <= 13);

  if (!candidates.length) return null;

  // Preferir 10 dÃ­gitos si existe
  const ten = candidates.find(x => x.length == 10);
  return ten || candidates[0];
}

}

// Extrae nÃºmeros como "2 sucursales"
function tryExtractBranches(text) {
  const t = coerceText(text).toLowerCase();
  const m = t.match(/(\d+)\s*(sucursal|sucursales|consultorio|consultorios)\b/);
  if (m) return Number(m[1]);
  return null;
}

function looksLikePriceQuestion(text) {
  const t = coerceText(text).toLowerCase();
  return /(precio|costo|cu[aÃ¡]nto\s+cuesta|mensual|renta|plan)/.test(t);
}

function looksLikeAllFeatures(text) {
  const t = coerceText(text).toLowerCase();
  return /(todas\s+las\s+funcionalidades|todo|completo|full|todas)/.test(t);
}


function buildSystemPrompt(lead) {
  const profile = (lead && lead.profile && typeof lead.profile === 'object') ? lead.profile : {};
  const anticipoPct = Number(process.env.DETALLES_ANTICIPO_PCT || process.env.ANTICIPO_PCT || 50);

  return [
    `Eres el asistente oficial de ${BRAND_NAME}.`,
    ``,
    `🎁 Giro del negocio:`,
    `Arreglos y detalles personalizados para ocasiones especiales (flores, globos, chocolates, combos, etc.).`,
    `Todo es BAJO PEDIDO y con anticipo para apartar fecha.`,
    ``,
    `✅ Objetivo:`,
    `- Cotizar rápido`,
    `- Capturar datos del pedido`,
    `- Cerrar con anticipo`,
    ``,
    `📝 Haz preguntas UNA por UNA (no listes todas de golpe). Orden sugerido:`,
    `1) ¿Para qué ocasión es? (cumpleaños, 14 de febrero, aniversario, otra)`,
    `2) ¿Para qué fecha y hora lo necesitas?`,
    `3) ¿Es entrega a domicilio o pickup? (si entrega: colonia/zona y referencia)`,
    `4) Presupuesto aproximado`,
    `5) ¿Qué estilo prefieres? (colores, flores, globos, chocolates, elegante, etc.)`,
    `6) Texto para tarjeta (opcional)`,
    `7) Teléfono/WhatsApp para confirmar`,
    ``,
    `💳 Anticipo:`,
    `Para apartar se requiere anticipo del ${anticipoPct}%. Cuando confirme, indícale que un asesor le enviará los datos de pago.`,
    ``,
    `⚠️ Reglas:`,
    `- No hables de software, clínicas ni suscripciones.`,
    `- No menciones CliniqOne ni Dentalux.`,
    `- Responde en español, tono amable y vendedor, directo (1–6 líneas).`,
    `- Si el usuario pide precio sin dar datos, primero pregunta ocasión + fecha + presupuesto.`,
    ``,
    (profile.phone ? `Teléfono ya capturado: ${profile.phone}.` : `Teléfono aún no capturado: debes pedirlo antes de cerrar.`),
  ].join('\n');
}


async function callOpenAI(messages, model = DEFAULT_MODEL) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');

  const body = {
    model,
    messages,
    temperature: 0.3,
    max_tokens: 260,
  };

  const r = await withTimeout(fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  }), AI_TIMEOUT_MS);

  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = j?.error?.message || `openai_error_${r.status}`;
    const e = new Error(err);
    e.status = r.status;
    e.payload = j;
    throw e;
  }
  return (j?.choices?.[0]?.message?.content || '').trim();
}

// =====================
// DB: ensure tables
// =====================
async function ensureTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_leads (
      id BIGSERIAL PRIMARY KEY,
      name TEXT,
      contact TEXT,
      source TEXT DEFAULT 'web',
      notes TEXT,
      stage TEXT DEFAULT 'new',
      profile JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS contact_pref TEXT;`);
  await pool.query(`ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS contact_value TEXT;`);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
         WHERE schemaname='public'
           AND indexname='sales_leads_contact_pref_value_idx'
      ) THEN
        CREATE INDEX sales_leads_contact_pref_value_idx
          ON sales_leads (contact_pref, contact_value);
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_messages (
      id BIGSERIAL PRIMARY KEY,
      lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user','assistant')),
      content TEXT NOT NULL,
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
         WHERE schemaname='public'
           AND indexname='sales_messages_lead_id_idx'
      ) THEN
        CREATE INDEX sales_messages_lead_id_idx ON sales_messages (lead_id);
      END IF;
    END $$;
  `);
}

// =====================
// Router
// =====================
function createDetallesSalesRouter(options = {}) {
  const router = express.Router();

  const databaseUrl = pickDatabaseUrl(options);
  if (!databaseUrl) console.log('â ï¸ [detalles] No hay databaseUrl. Define SALES_DATABASE_URL o DATABASE_URL_DB2.');

  const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

  ensureTables(pool).then(
    () => console.log('â [detalles] Tablas listas (sales_leads + sales_messages).'),
    (e) => console.error('â [detalles] ensureTables error:', e)
  );

  router.get('/health', async (_req, res) => {
    try {
      const r = await pool.query('SELECT 1 AS ok');
      return res.json({ ok: true, db: r.rows[0]?.ok === 1, brand: BRAND_NAME, model: DEFAULT_MODEL });
    } catch {
      return res.status(500).json({ ok: false, error: 'db_error' });
    }
  });

  // POST /api/sales/leads/ensure
  router.post('/leads/ensure', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const b = req.body || {};
      const contact_pref = (b.contact_pref ? String(b.contact_pref) : '').trim().toLowerCase();
      const contact_value = (b.contact_value ? String(b.contact_value) : '').trim();

      if (!contact_pref || !contact_value) return res.status(400).json({ error: 'missing_contact' });

      const existing = await pool.query(
        `SELECT * FROM sales_leads WHERE contact_pref=$1 AND contact_value=$2 ORDER BY id DESC LIMIT 1`,
        [contact_pref, contact_value]
      );

      if (existing.rowCount) return res.json({ lead: existing.rows[0], existed: true });

      const created = await pool.query(
        `INSERT INTO sales_leads (contact_pref, contact_value, notes, profile, source)
         VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING *`,
        [contact_pref, contact_value, b.notes ? String(b.notes) : null, JSON.stringify(b.profile || {}), contact_pref]
      );

      return res.json({ lead: created.rows[0], existed: false });
    } catch (e) {
      console.error('[detalles] /leads/ensure error:', e);
      return res.status(500).json({ error: 'server_error' });
    }
  });

  // POST /api/sales/leads/:id/messages (IA + precios claros + marca fija)
  router.post('/leads/:id/messages', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const message = sanitizeBrand(coerceText(req.body?.message)).trim();
      const meta = req.body?.meta || {};

      if (!id || id <= 0) return res.status(400).json({ error: 'bad_lead_id' });
      if (!message) return res.status(400).json({ error: 'message requerido' });

      const leadRes = await pool.query(`SELECT * FROM sales_leads WHERE id=$1`, [id]);
      const lead = leadRes.rows[0];
      if (!lead) return res.status(404).json({ error: 'lead no existe' });

      // Guarda mensaje usuario
      await pool.query(
        `INSERT INTO sales_messages (lead_id, role, content, meta) VALUES ($1,'user',$2,$3::jsonb)`,
        [id, message, JSON.stringify(meta || {})]
      );

      const profile = (lead.profile && typeof lead.profile === 'object') ? lead.profile : {};

      // Extract branches
      const branches = tryExtractBranches(message);
      if (branches) profile.branches = branches;
      
      // Extract phone for follow-up (WhatsApp / llamada)
      const phone = (typeof tryExtractPhone === 'function') ? tryExtractPhone(message) : null;
      if (phone) profile.phone = phone;


      // Historial corto para la IA (y sanitiza marcas viejas)
      const histRes = await pool.query(
        `SELECT role, content FROM sales_messages WHERE lead_id=$1 ORDER BY id DESC LIMIT 12`,
        [id]
      );
      const history = histRes.rows.reverse().map(h => ({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: sanitizeBrand(h.content)
      }));

      // Construir prompt IA
      const messages = [{ role: 'system', content: buildSystemPrompt({ ...lead, profile }) }, ...history];

      let reply = '';
      try {
        reply = await callOpenAI(messages, DEFAULT_MODEL);
      } catch (err) {
        console.error('â [detalles] openai error:', err?.message || err);
        reply = `Perfecto â Â¿QuÃ© es lo principal que quieres resolver en ${BRAND_NAME}? (agenda, expediente, cobros, recordatorios)`;
      }

      reply = sanitizeBrand(reply);

      await pool.query(`UPDATE sales_leads SET profile=$2::jsonb, updated_at=NOW() WHERE id=$1`, [id, JSON.stringify(profile)]).catch(()=>{});
      await pool.query(
        `INSERT INTO sales_messages (lead_id, role, content, meta) VALUES ($1,'assistant',$2,$3::jsonb)`,
        [id, reply, JSON.stringify({ engine: 'openai', model: DEFAULT_MODEL, brand: BRAND_NAME })]
      );

      return res.json({ reply, stage: 'chat' });
    } catch (e) {
      console.error('[detalles] /leads/:id/messages error:', e);
      return res.status(500).json({ error: 'server_error' });
    }
  });

  return router;
}

module.exports = { createDetallesSalesRouter };

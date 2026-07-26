'use strict';

const express = require('express');
const { Pool } = require('pg');

const DEFAULT_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 15000);

// =====================
// Config: BRAND + PRICING (override via env)
// =====================
const BRAND_NAME = (process.env.BRAND_NAME || 'CliniqOne').trim() || 'CliniqOne';


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
  const knownBranches = profile.branches || profile.num_branches || null;

  const featuresCatalog = [
    'Agenda inteligente (citas sincronizadas web y celular)',
    'Caja y facturaciÃ³n (ingresos/egresos + CFDI con Facturama)',
    'Productividad y anÃ¡lisis (grÃ¡ficas, ingresos por doctor y mÃ©todos de pago)',
    'Dashboard global multi-sucursal (KPIs, ingresos, gastos y rendimiento)',
    'Metas y objetivos (indicadores reales)',
    'Laboratorio (trabajos, abonos y entregas)',
    'Inventario dental (control automÃ¡tico de insumos)',
    'Expediente clÃ­nico/mÃ©dico + odontograma digital',
    'Consentimientos informados digitales',
    'WhatsApp automÃ¡tico (recordatorios y confirmaciÃ³n con un clic)',
    'Multi-sucursal'
  ].join(', ');


  

  const MODULES_DETAIL_BLOCK = `
ð¦ MÃ³dulos incluidos (descripciÃ³n corta)

â¢ Agenda inteligente: agenda de citas desde web/celular, control de horarios y recordatorios.
â¢ Caja y facturaciÃ³n: registro de ingresos/egresos, cortes y facturaciÃ³n CFDI con Facturama.
â¢ Productividad y anÃ¡lisis: mÃ©tricas, grÃ¡ficas, ingresos por doctor y mÃ©todos de pago.
â¢ Dashboard global: resumen de KPIs por sucursal (ingresos, gastos, rendimiento) en un solo lugar.
â¢ Metas y objetivos: seguimiento de objetivos con indicadores reales.
â¢ Laboratorio: control de trabajos, abonos, fechas de entrega y estatus.
â¢ Inventario dental: control de insumos y consumos (alertas/stock para reabasto).
â¢ Expediente + odontograma: historial del paciente, tratamientos, notas y odontograma digital.
â¢ Consentimientos digitales: plantillas y firma/aceptaciÃ³n de consentimientos informados.
â¢ WhatsApp automÃ¡tico: confirmaciÃ³n y recordatorios de citas con un clic.
â¢ Multi-sucursal: varias sucursales en una sola cuenta con reportes y dashboard global.
`.trim();
const PRICING_BLOCK = `
ð° Planes y precios (CliniqOne)

Cuando el cliente pregunte por precio/planes/costos, responde con estos 3 planes (claro y directo):

ð¦ Plan BÃ¡sico â $890 MXN / mes (1 sucursal | doctores ilimitados)
Incluye:
â¢ Agenda inteligente
â¢ Caja (solo control de gastos/egresos; SIN facturaciÃ³n CFDI)
â¢ Expediente clÃ­nico + odontograma digital
â¢ WhatsApp: recordatorios y confirmaciÃ³n de citas

ð¦ Plan Medio â $1,090 MXN / mes (1 sucursal | doctores ilimitados)
Incluye TODO lo del BÃ¡sico, mÃ¡s:
â¢ Inventario dental
â¢ Productividad y anÃ¡lisis
â¢ Metas y objetivos

ð¦ Plan Normal (Completo) â $1,290 MXN / mes (1 sucursal | doctores ilimitados)
Incluye TODOS los mÃ³dulos.
ð PromociÃ³n de lanzamiento:
â¢ 2 sucursales por $1,490 MXN / mes

ð² WhatsApp (en todos los planes)
â¢ Incluye 100 mensajes al mes por sucursal
â¢ Mensajes adicionales: $0.80 MXN por mensaje
â¢ Sin paquetes forzosos ni recargas obligatorias

ð§¾ FacturaciÃ³n electrÃ³nica (CFDI)
â¢ Incluida dentro del Plan Normal (Completo)
â¢ Se cobra $5 MXN por factura emitida
â¢ Si no se factura, no se cobra

ð Demo
â¢ El demo es general para conocer el sistema.
â¢ Si el cliente comparte su disponibilidad, confirma que lo registraste y que un asesor lo contactarÃ¡ para confirmar la demo.
`.trim();

  return [
    `Eres el asistente oficial de CliniqOne.`,
    `MUY IMPORTANTE:`,
    `- El software se llama SIEMPRE "CliniqOne".`,
    `- NUNCA menciones "Dentalux" ni "Dentalite" aunque aparezcan en el historial.`,
    `- No respondas con frases genÃ©ricas tipo: "varÃ­a", "depende", "segÃºn funcionalidades".`,
    `Estilo: profesional, directo y claro. No repitas preguntas ya contestadas.`,
    ``,
    `Producto (resumen): ${featuresCatalog}.`,
    ``,
    MODULES_DETAIL_BLOCK,
    
    PRICING_BLOCK,
    ``,
    `Reglas de conversaciÃ³n (OBLIGATORIAS):`,
    `1) Si el usuario pregunta precio/costo: DA CIFRA EXACTA PRIMERO (usa promo si aplica).`,
    `1b) Si preguntan por planes: presenta BÃ¡sico ($890), Medio ($1,090) y Normal ($1,290) + promo 2 sucursales $1,490.`,
    `1c) Si preguntan por caja/gastos: en BÃ¡sico es solo control de gastos; en Normal incluye caja + facturaciÃ³n CFDI (y $5 por factura).`,
    `1d) RecomendaciÃ³n automÃ¡tica de plan:`,
    `- Si el cliente pide solo agenda/recordatorios/expediente/odontograma o control bÃ¡sico de gastos: recomienda Plan BÃ¡sico ($890).`,
    `- Si el cliente menciona inventario, productividad, metas/objetivos o quiere medir resultados: recomienda Plan Medio ($1,090).`,
    `- Si el cliente menciona facturaciÃ³n CFDI, laboratorio, dashboard global, reportes multi-sucursal o tiene/planea 2+ sucursales: recomienda Plan Normal ($1,290) o promo 2 sucursales $1,490.`,
    `- Si no estÃ¡ claro, haz 1 pregunta para decidir ("Â¿vas a facturar CFDI?" o "Â¿cuÃ¡ntas sucursales tienes?").`,
    `1e) Cierre cuando el cliente dice "me interesa" / "ok me interesa": NO repitas el plan completo. Solo confirma y avanza al siguiente paso con 1 pregunta (nombre del consultorio, telÃ©fono y/o disponibilidad para demo).`,
    `1f) Captura de contacto (OBLIGATORIO): si el cliente acepta la demo o da su disponibilidad, pide el nÃºmero de WhatsApp/telÃ©fono si aÃºn no lo tenemos (ej: "Â¿Me compartes tu nÃºmero para que el asesor te confirme la demo?").`,
    `1g) ConfirmaciÃ³n de demo (OBLIGATORIO): cuando el cliente da dÃ­a/hora, responde: (a) â confirmaciÃ³n, (b) repetir dÃ­a/hora, (c) pedir telÃ©fono si falta, (d) cierre: "un asesor te contactarÃ¡ para confirmar".`,



    `2) Si el usuario indica 2 sucursales: aplica la promociÃ³n: 2 sucursales por $1,490 MXN/mes.`,
    `3) Si dicen "todas las funcionalidades": confirma que ya vienen incluidas (no cobras extra por mÃ³dulos).`,
    `4) Siempre menciona WhatsApp: 100 mensajes/mes/sucursal + $0.80 por mensaje extra; sin paquetes forzosos.`,
    `5) Si preguntan facturaciÃ³n: $5 por factura; sin renta; si no se factura, no se cobra.`,
    `6) Ofrece demo SOLO despuÃ©s de contestar precio (y explicaciÃ³n breve).`,
    `7) Responde corto (1â6 lÃ­neas).`,
    `7b) DespuÃ©s de dar precio o recomendaciÃ³n, cierra con 1 pregunta corta para avanzar (ej: Â¿CuÃ¡ntas sucursales tienes? Â¿Vas a facturar CFDI?).`,
    `8) Si el usuario pregunta por "todos los mÃ³dulos" o "lista completa": enumera TODOS los mÃ³dulos y aclara que van incluidos (sin cobros extra por mÃ³dulo).`,
    `9) Si preguntan por un mÃ³dulo especÃ­fico: explica QUÃ HACE ese mÃ³dulo en 1â3 lÃ­neas usando la descripciÃ³n corta del catÃ¡logo (sin inventar funciones fuera de la lista).`,
    `10) Caja/Gastos: si preguntan por caja, ingresos, egresos o control de gastos, confirma que SÃ existe "Caja y facturaciÃ³n" e incluye ingresos/egresos + CFDI con Facturama.`,
    ``,
    (profile.phone ? `TelÃ©fono ya capturado: ${profile.phone}.` : `TelÃ©fono: aÃºn no capturado; debes pedirlo si aceptan demo o dejan disponibilidad.`),
    knownBranches
      ? `Dato ya conocido: el cliente tiene ${knownBranches} sucursales/consultorios.`
      : `Dato: aÃºn no sabemos cuÃ¡ntas sucursales/consultorios tiene.`,
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
function createCliniqOneSalesRouter(options = {}) {
  const router = express.Router();

  const databaseUrl = pickDatabaseUrl(options);
  if (!databaseUrl) console.log('â ï¸ [sales] No hay databaseUrl. Define SALES_DATABASE_URL o DATABASE_URL_DB2.');

  const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

  ensureTables(pool).then(
    () => console.log('â [sales] Tablas listas (sales_leads + sales_messages).'),
    (e) => console.error('â [sales] ensureTables error:', e)
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
      console.error('[sales] /leads/ensure error:', e);
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
        console.error('â [sales] openai error:', err?.message || err);
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
      console.error('[sales] /leads/:id/messages error:', e);
      return res.status(500).json({ error: 'server_error' });
    }
  });

  return router;
}

module.exports = { createCliniqOneSalesRouter };

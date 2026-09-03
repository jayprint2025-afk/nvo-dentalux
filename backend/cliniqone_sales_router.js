'use strict';

const express = require('express');
const { Pool } = require('pg');
const SalesV5 = require('./modules/sales-v5');

function pickDatabaseUrl(opts = {}) {
  return String(
    opts.databaseUrl ||
    process.env.SALES_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.DATABASE_URL_DB1 ||
    ''
  ).trim();
}

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
      contact_pref TEXT,
      contact_value TEXT,
      ai_paused BOOLEAN DEFAULT FALSE,
      assigned_to TEXT,
      score INTEGER DEFAULT 0,
      next_step TEXT,
      outcome TEXT,
      last_message_at TIMESTAMPTZ,
      unread_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const alters = [
    `ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS contact_pref TEXT`,
    `ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS contact_value TEXT`,
    `ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS ai_paused BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS assigned_to TEXT`,
    `ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS score INTEGER DEFAULT 0`,
    `ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS next_step TEXT`,
    `ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS outcome TEXT`,
    `ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ`,
    `ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS unread_count INTEGER DEFAULT 0`
  ];
  for (const sql of alters) await pool.query(sql);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_messages (
      id BIGSERIAL PRIMARY KEY,
      lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user','assistant')),
      actor TEXT DEFAULT 'ai',
      content TEXT NOT NULL,
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE sales_messages ADD COLUMN IF NOT EXISTS actor TEXT DEFAULT 'ai'`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_leads_contact_idx ON sales_leads(contact_pref,contact_value)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_messages_lead_idx ON sales_messages(lead_id,id)`);
}

function createCliniqOneSalesRouter(options = {}) {
  const router = express.Router();
  const databaseUrl = pickDatabaseUrl(options);
  if (!databaseUrl) throw new Error('No hay base de datos para Sales V5');

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  ensureTables(pool)
    .then(() => console.log('✅ [sales-v5] esquema listo'))
    .catch(error => console.error('❌ [sales-v5] esquema:', error));

  const adminAuth = [
    options.authRequired || ((_req, _res, next) => next()),
    options.superAdminOnly || ((_req, _res, next) => next())
  ];

  router.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, engine: 'sales-v5' });
    } catch (error) {
      res.status(500).json({ ok: false, error: 'db_error' });
    }
  });

  // Public/channel entry point.
  router.post('/leads/ensure', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const pref = String(req.body?.contact_pref || '').trim().toLowerCase();
      const value = String(req.body?.contact_value || '').trim();
      if (!pref || !value) return res.status(400).json({ error: 'missing_contact' });

      const existing = await pool.query(
        `SELECT * FROM sales_leads WHERE contact_pref=$1 AND contact_value=$2 ORDER BY id DESC LIMIT 1`,
        [pref, value]
      );
      if (existing.rows[0]) return res.json({ lead: existing.rows[0], existed: true });

      const { rows } = await pool.query(
        `INSERT INTO sales_leads(contact_pref,contact_value,source,notes,profile,stage,last_message_at)
         VALUES($1,$2,$3,$4,$5::jsonb,'new',NOW()) RETURNING *`,
        [pref, value, pref, req.body?.notes ? String(req.body.notes) : null, JSON.stringify(req.body?.profile || {})]
      );
      res.json({ lead: rows[0], existed: false });
    } catch (error) {
      console.error('[sales-v5] ensure', error);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/leads/:id/messages', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const leadId = Number(req.params.id);
      const text = String(req.body?.message || '').trim();
      const meta = req.body?.meta && typeof req.body.meta === 'object' ? req.body.meta : {};
      if (!leadId || !text) return res.status(400).json({ error: 'message_required' });

      const leadRes = await pool.query(`SELECT * FROM sales_leads WHERE id=$1`, [leadId]);
      const lead = leadRes.rows[0];
      if (!lead) return res.status(404).json({ error: 'lead_not_found' });

      await pool.query(
        `INSERT INTO sales_messages(lead_id,role,actor,content,meta) VALUES($1,'user','lead',$2,$3::jsonb)`,
        [leadId, text, JSON.stringify(meta)]
      );
      await pool.query(
        `UPDATE sales_leads SET last_message_at=NOW(), unread_count=unread_count+1, updated_at=NOW() WHERE id=$1`,
        [leadId]
      );

      if (lead.ai_paused) {
        return res.json({ reply: '', paused: true, stage: lead.stage || 'manual' });
      }

      const result = await SalesV5.processTurn(pool, lead, text);

      await pool.query(
        `INSERT INTO sales_messages(lead_id,role,actor,content,meta)
         VALUES($1,'assistant','ai',$2,$3::jsonb)`,
        [leadId, result.reply, JSON.stringify({ engine:'sales-v5', intent:result.intent, stage:result.stage, score:result.score })]
      );

      res.json({
        reply: result.reply,
        stage: result.stage,
        score: result.score,
        profile: result.profile,
        engine: 'sales-v5'
      });
    } catch (error) {
      console.error('[sales-v5] message', error);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // Superadmin inbox.
  router.get('/admin/leads', ...adminAuth, async (req, res) => {
    const q = String(req.query.q || '').trim();
    const params = [];
    let where = '';
    if (q) {
      params.push(`%${q}%`);
      where = `WHERE COALESCE(name,'') ILIKE $1 OR COALESCE(contact_value,'') ILIKE $1 OR COALESCE(profile->>'clinic_name','') ILIKE $1`;
    }
    const { rows } = await pool.query(
      `SELECT id,name,contact_pref,contact_value,source,stage,profile,ai_paused,assigned_to,
              score,next_step,outcome,last_message_at,unread_count,created_at,updated_at
         FROM sales_leads
         ${where}
        ORDER BY COALESCE(last_message_at,updated_at,created_at) DESC
        LIMIT 250`,
      params
    );
    res.json(rows);
  });

  router.get('/admin/leads/:id', ...adminAuth, async (req, res) => {
    const leadId = Number(req.params.id);
    const lead = (await pool.query(`SELECT * FROM sales_leads WHERE id=$1`, [leadId])).rows[0];
    if (!lead) return res.status(404).json({ error: 'lead_not_found' });

    const messages = (await pool.query(
      `SELECT id,role,actor,content,meta,created_at FROM sales_messages WHERE lead_id=$1 ORDER BY id ASC`,
      [leadId]
    )).rows;

    await pool.query(`UPDATE sales_leads SET unread_count=0 WHERE id=$1`, [leadId]);
    res.json({ lead: { ...lead, unread_count: 0 }, messages });
  });

  router.patch('/admin/leads/:id', ...adminAuth, express.json({ limit:'1mb' }), async (req, res) => {
    const leadId = Number(req.params.id);
    const current = (await pool.query(`SELECT * FROM sales_leads WHERE id=$1`, [leadId])).rows[0];
    if (!current) return res.status(404).json({ error:'lead_not_found' });

    const profile = { ...(current.profile || {}), ...(req.body?.profile || {}) };
    const { rows } = await pool.query(
      `UPDATE sales_leads
          SET name=COALESCE($2,name), stage=COALESCE($3,stage), profile=$4::jsonb,
              outcome=COALESCE($5,outcome), updated_at=NOW()
        WHERE id=$1 RETURNING *`,
      [leadId, req.body?.name || null, req.body?.stage || null, JSON.stringify(profile), req.body?.outcome || null]
    );
    res.json(rows[0]);
  });

  router.post('/admin/leads/:id/takeover', ...adminAuth, async (req, res) => {
    const leadId = Number(req.params.id);
    const actor = String(req.auth?.email || req.auth?.sub || 'superadmin');
    const { rows } = await pool.query(
      `UPDATE sales_leads SET ai_paused=TRUE,assigned_to=$2,stage='manual',updated_at=NOW() WHERE id=$1 RETURNING *`,
      [leadId, actor]
    );
    if (!rows[0]) return res.status(404).json({ error:'lead_not_found' });
    res.json(rows[0]);
  });

  router.post('/admin/leads/:id/release', ...adminAuth, async (req, res) => {
    const leadId = Number(req.params.id);
    const { rows } = await pool.query(
      `UPDATE sales_leads SET ai_paused=FALSE,assigned_to=NULL,
              stage=CASE WHEN stage='manual' THEN 'qualified' ELSE stage END,updated_at=NOW()
        WHERE id=$1 RETURNING *`,
      [leadId]
    );
    if (!rows[0]) return res.status(404).json({ error:'lead_not_found' });
    res.json(rows[0]);
  });

  router.post('/admin/leads/:id/reply', ...adminAuth, express.json({ limit:'1mb' }), async (req, res) => {
    try {
      const leadId = Number(req.params.id);
      const text = String(req.body?.message || '').trim();
      if (!text) return res.status(400).json({ error:'message_required' });
      const lead = (await pool.query(`SELECT * FROM sales_leads WHERE id=$1`, [leadId])).rows[0];
      if (!lead) return res.status(404).json({ error:'lead_not_found' });

      let delivered = false;
      let deliveryError = null;

      if (lead.contact_pref === 'messenger' && typeof options.sendMessenger === 'function') {
        const lastMeta = (await pool.query(
          `SELECT meta FROM sales_messages WHERE lead_id=$1 AND role='user' ORDER BY id DESC LIMIT 1`,
          [leadId]
        )).rows[0]?.meta || {};
        try {
          await options.sendMessenger(lead.contact_value, text, lastMeta.pageId || lastMeta.page_id || '');
          delivered = true;
        } catch (error) {
          deliveryError = error.message || 'messenger_send_failed';
        }
      }

      await pool.query(
        `INSERT INTO sales_messages(lead_id,role,actor,content,meta)
         VALUES($1,'assistant','admin',$2,$3::jsonb)`,
        [leadId, text, JSON.stringify({ delivered, deliveryError })]
      );
      await pool.query(`UPDATE sales_leads SET ai_paused=TRUE,stage='manual',updated_at=NOW() WHERE id=$1`, [leadId]);

      res.json({ ok:true, delivered, deliveryError });
    } catch (error) {
      console.error('[sales-v5] admin reply', error);
      res.status(500).json({ error:'server_error' });
    }
  });

  return router;
}

module.exports = { createCliniqOneSalesRouter };

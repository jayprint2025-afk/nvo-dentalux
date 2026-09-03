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

  await pool.query(`CREATE TABLE IF NOT EXISTS sales_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query(`INSERT INTO sales_settings(key,value) VALUES('offer',$1::jsonb) ON CONFLICT(key) DO NOTHING`, [JSON.stringify({ price_mxn:1490, billing_period:'mes' })]);

  await pool.query(`CREATE TABLE IF NOT EXISTS sales_onboarding (
    id BIGSERIAL PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    clinic_name TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    tenant_id UUID,
    user_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_onboarding_lead_idx ON sales_onboarding(lead_id,id)`);
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

  const publicAppBase = String(options.publicAppBaseUrl || process.env.PUBLIC_APP_URL || process.env.FRONTEND_ORIGIN || process.env.RENDER_EXTERNAL_URL || '').split(',')[0].trim().replace(/\/$/, '');
  function slugify(value) {
    return String(value || 'clinica').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50) || 'clinica';
  }
  async function uniqueSlug(client, name) {
    const base = slugify(name); let slug = base; let i = 2;
    while ((await client.query(`SELECT 1 FROM tenants WHERE slug=$1 LIMIT 1`, [slug])).rows[0]) slug = `${base}-${i++}`;
    return slug;
  }


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


  router.get('/admin/settings', ...adminAuth, async (_req,res) => {
    const row = (await pool.query(`SELECT value,updated_at FROM sales_settings WHERE key='offer'`)).rows[0];
    res.json({ offer: row?.value || { price_mxn:1490, billing_period:'mes' }, updated_at: row?.updated_at || null });
  });

  router.put('/admin/settings', ...adminAuth, express.json({limit:'1mb'}), async (req,res) => {
    const price = Number(req.body?.price_mxn);
    if (!Number.isFinite(price) || price <= 0) return res.status(400).json({error:'invalid_price'});
    const offer = { price_mxn: Math.round(price), billing_period:'mes' };
    const {rows} = await pool.query(`INSERT INTO sales_settings(key,value,updated_at) VALUES('offer',$1::jsonb,NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW() RETURNING value,updated_at`, [JSON.stringify(offer)]);
    res.json({offer:rows[0].value,updated_at:rows[0].updated_at});
  });

  router.get('/onboarding/:token/page', async (req,res) => {
    const token = String(req.params.token || '');
    const row = (await pool.query(`SELECT email,owner_name,clinic_name,expires_at,completed_at FROM sales_onboarding WHERE token=$1 LIMIT 1`,[token])).rows[0];
    const invalid = !row || row.completed_at || new Date(row.expires_at || 0) <= new Date();
    const safe = (v) => String(v || '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    if (invalid) return res.status(row?.completed_at ? 409 : row ? 410 : 404).send('<!doctype html><meta charset="utf-8"><title>CliniqOne</title><div style="font-family:Arial;max-width:520px;margin:80px auto;padding:30px"><h1>CliniqOne</h1><p>Este enlace de registro no está disponible o ya fue utilizado.</p></div>');
    res.type('html').send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Crear acceso · CliniqOne</title><style>body{margin:0;background:#eef4fb;font-family:Arial,sans-serif;color:#172033}.card{max-width:520px;margin:7vh auto;background:white;border-radius:24px;box-shadow:0 20px 60px #1f4f7c22;overflow:hidden}.head{padding:34px;background:linear-gradient(135deg,#078ecb,#3158c8);color:white}.body{padding:30px}label{display:block;font-weight:700;margin:16px 0 7px}input{box-sizing:border-box;width:100%;padding:13px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px}button{width:100%;margin-top:22px;padding:14px;border:0;border-radius:11px;background:#078ecb;color:white;font-size:16px;font-weight:700;cursor:pointer}.muted{color:#64748b;font-size:14px}.err{color:#b91c1c;margin-top:12px}.ok{color:#047857;margin-top:12px}</style></head><body><div class="card"><div class="head"><h1 style="margin:0">CliniqOne</h1><p>Tu clínica, todo en un solo lugar</p></div><div class="body"><h2>Crea tu acceso</h2><p class="muted">${safe(row.clinic_name)} · ${safe(row.email)}</p><label>Contraseña</label><input id="p1" type="password" minlength="8" autocomplete="new-password" placeholder="Mínimo 8 caracteres"><label>Confirmar contraseña</label><input id="p2" type="password" minlength="8" autocomplete="new-password"><button id="go">Crear mi cuenta</button><div id="msg"></div></div></div><script>const token=${JSON.stringify(token)};document.getElementById('go').onclick=async()=>{const m=document.getElementById('msg'),p1=document.getElementById('p1').value,p2=document.getElementById('p2').value;m.className='err';if(p1.length<8){m.textContent='La contraseña debe tener mínimo 8 caracteres.';return}if(p1!==p2){m.textContent='Las contraseñas no coinciden.';return}document.getElementById('go').disabled=true;try{const r=await fetch('/api/sales/onboarding/'+encodeURIComponent(token)+'/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:p1})});const j=await r.json();if(!r.ok)throw new Error(j.error||'No se pudo crear la cuenta');m.className='ok';m.innerHTML='<b>Cuenta creada correctamente.</b><br>Ya puedes iniciar sesión en CliniqOne con ${safe(row.email)}.';document.getElementById('go').style.display='none'}catch(e){m.textContent=e.message;document.getElementById('go').disabled=false}}</script></body></html>`);
  });

  router.get('/onboarding/:token', async (req,res) => {
    const token = String(req.params.token || '');
    const row = (await pool.query(`SELECT so.id,so.email,so.owner_name,so.clinic_name,so.expires_at,so.completed_at,sl.id AS lead_id FROM sales_onboarding so JOIN sales_leads sl ON sl.id=so.lead_id WHERE so.token=$1 LIMIT 1`,[token])).rows[0];
    if (!row) return res.status(404).json({error:'invalid_link'});
    if (row.completed_at) return res.status(409).json({error:'already_completed'});
    if (new Date(row.expires_at) <= new Date()) return res.status(410).json({error:'expired_link'});
    res.json({email:row.email,owner_name:row.owner_name,clinic_name:row.clinic_name,expires_at:row.expires_at});
  });

  router.post('/onboarding/:token/complete', express.json({limit:'1mb'}), async (req,res) => {
    const token = String(req.params.token || '');
    const password = String(req.body?.password || '');
    if (password.length < 8) return res.status(400).json({error:'password_too_short'});
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query(`SELECT * FROM sales_onboarding WHERE token=$1 FOR UPDATE`,[token])).rows[0];
      if (!row) { await client.query('ROLLBACK'); return res.status(404).json({error:'invalid_link'}); }
      if (row.completed_at) { await client.query('ROLLBACK'); return res.status(409).json({error:'already_completed'}); }
      if (new Date(row.expires_at) <= new Date()) { await client.query('ROLLBACK'); return res.status(410).json({error:'expired_link'}); }
      if ((await client.query(`SELECT 1 FROM users WHERE lower(email)=lower($1) LIMIT 1`,[row.email])).rows[0]) { await client.query('ROLLBACK'); return res.status(409).json({error:'email_exists'}); }
      const bcrypt = require('bcryptjs');
      const slug = await uniqueSlug(client,row.clinic_name);
      const tenant = (await client.query(`INSERT INTO tenants(name,slug,status,plan) VALUES($1,$2,'active','cliniqone_complete') RETURNING id`,[row.clinic_name,slug])).rows[0];
      const user = (await client.query(`INSERT INTO users(name,email,password_hash,active) VALUES($1,lower($2),$3,TRUE) RETURNING id`,[row.owner_name,row.email,await bcrypt.hash(password,12)])).rows[0];
      await client.query(`INSERT INTO tenant_users(tenant_id,user_id,role,active) VALUES($1,$2,'owner',TRUE)`,[tenant.id,user.id]);
      await client.query(`INSERT INTO branches(tenant_id,name,branch_key,active) VALUES($1,'Sucursal principal','sucursal_1',TRUE)`,[tenant.id]);
      await client.query(`UPDATE sales_onboarding SET completed_at=NOW(),tenant_id=$2,user_id=$3 WHERE id=$1`,[row.id,tenant.id,user.id]);
      await client.query(`UPDATE sales_leads SET stage='won',outcome='registered',profile=jsonb_set(jsonb_set(COALESCE(profile,'{}'::jsonb),'{onboarding_completed}','true'::jsonb,true),'{onboarding_url}','null'::jsonb,true),score=100,next_step='Ingresar a CliniqOne',updated_at=NOW() WHERE id=$1`,[row.lead_id]);
      await client.query('COMMIT');
      res.status(201).json({ok:true,login_email:row.email,tenant_id:tenant.id});
    } catch(error) {
      await client.query('ROLLBACK').catch(()=>{});
      console.error('[sales-v5] onboarding complete',error);
      res.status(500).json({error:'server_error'});
    } finally { client.release(); }
  });

  return router;
}

module.exports = { createCliniqOneSalesRouter };

// modules/ai-saas-routes.js
const { resolveClinicContext } = require('./tenant-context');
const { safeJson, loadConversation, saveState, logEvent } = require('./conversation-state');
const { orchestrate } = require('./ai-orchestrator');

async function ensureSaasTables(q) {
  // clinic_channels: mapea canal + external_id -> clinic_id
  await q(`
    CREATE TABLE IF NOT EXISTS clinic_channels (
      clinic_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      external_id TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(channel, external_id)
    )
  `);
  await q(`ALTER TABLE clinic_channels ADD COLUMN IF NOT EXISTS phone_number_id TEXT`).catch(()=>{});
  await q(`ALTER TABLE clinic_channels ADD COLUMN IF NOT EXISTS waba_id TEXT`).catch(()=>{});
  await q(`ALTER TABLE clinic_channels ADD COLUMN IF NOT EXISTS db_key TEXT`).catch(()=>{});
  await q(`ALTER TABLE clinic_channels ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE`).catch(()=>{});
  await q(`ALTER TABLE clinic_channels ADD COLUMN IF NOT EXISTS sucursal_id TEXT`).catch(()=>{});
  await q(`ALTER TABLE clinic_channels ADD COLUMN IF NOT EXISTS name TEXT`).catch(()=>{});
  await q(`ALTER TABLE clinic_channels ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`).catch(()=>{});

  // conversaciones + mensajes + logs
  await q(`
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id BIGSERIAL PRIMARY KEY,
      title TEXT,
      clinic_id TEXT,
      channel TEXT,
      external_id TEXT,
      sucursal_id TEXT,
      state JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // compat: si ya existía ai_conversations sin columnas nuevas, agregarlas
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS clinic_id TEXT`);
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS channel TEXT`);
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS external_id TEXT`);
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS sucursal_id TEXT`);
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS state JSONB DEFAULT '{}'::jsonb`);
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS phone_number_id TEXT`).catch(()=>{});
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS title TEXT`).catch(()=>{});

  // Crear índice DESPUÉS de asegurar que las columnas existen
  await q(`CREATE INDEX IF NOT EXISTS idx_ai_conversations_tenant ON ai_conversations(clinic_id, channel, external_id)`);

  await q(`
    CREATE TABLE IF NOT EXISTS ai_messages (
      id BIGSERIAL PRIMARY KEY,
      conversation_id BIGINT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await q(`CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages(conversation_id)`);

  await q(`
    CREATE TABLE IF NOT EXISTS ai_logs (
      id BIGSERIAL PRIMARY KEY,
      clinic_id TEXT,
      conversation_id BIGINT,
      event TEXT NOT NULL,
      payload JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await q(`ALTER TABLE ai_logs ADD COLUMN IF NOT EXISTS event TEXT`).catch(()=>{});
  await q(`ALTER TABLE ai_logs ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb`).catch(()=>{});
  await q(`CREATE INDEX IF NOT EXISTS idx_ai_logs_conv ON ai_logs(conversation_id)`);
}


function setupAiSaasRoutes(app, q) {
  // crea tablas necesarias (idempotente)
  ensureSaasTables(q).catch(e => console.error('❌ ensureSaasTables:', e.message));

  // Crear conversación (SaaS)
  app.post('/api/ai/conversations', async (req, res) => {
    try {
      const ctx = await resolveClinicContext(q, req);
      if (!ctx) return res.status(400).json({ error: 'Falta tenant (x-channel + x-wa-phone-number-id / x-page-id)' });

      const { rows } = await q(
        `INSERT INTO ai_conversations(title, clinic_id, channel, external_id, state)
         VALUES ($1, $2, $3, $4, '{}'::jsonb)
         RETURNING id, title, clinic_id, channel, external_id, created_at, updated_at`,
        [String(req.body?.title || 'Chat'), ctx.clinic_id, ctx.channel, ctx.external_id]
      );

      res.json(rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Chat
  app.post('/api/ai/chat', async (req, res) => {
    try {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📨 /api/ai/chat REQUEST RECEIVED');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Headers:', {
        'x-channel': req.headers['x-channel'],
        'x-wa-phone-number-id': req.headers['x-wa-phone-number-id'],
        'x-page-id': req.headers['x-page-id']
      });
      
      const conversationId = Number(req.body?.conversationId);
      const userText = String(req.body?.message || '').trim();
      if (!Number.isFinite(conversationId)) return res.status(400).json({ error: 'conversationId inválido' });
      if (!userText) return res.status(400).json({ error: 'message vacío' });

      const ctx0 = await resolveClinicContext(q, req);
      console.log('🏢 Tenant Resolution:', ctx0 ? 
        { clinic_id: ctx0.clinic_id, channel: ctx0.channel, external_id: ctx0.external_id } : 
        '❌ NULL - No tenant found!');
      
      if (!ctx0) {
        console.error('❌ TENANT RESOLUTION FAILED - Missing x-channel or external_id');
        return res.status(400).json({ error: 'Falta tenant (x-channel + x-wa-phone-number-id / x-page-id)' });
      }

      let conv = await loadConversation(q, conversationId);
      if (!conv) {
        console.error('❌ Conversation not found:', conversationId);
        return res.status(404).json({ error: 'Conversación no encontrada' });
      }

      // Compatibilidad: conversaciones legacy creadas desde whatsapp.js pueden venir sin tenant.
      // En vez de rechazarlas, las normalizamos al tenant resuelto por headers.
      if (!conv.clinic_id || !conv.channel || !conv.external_id) {
        await q(
          `UPDATE ai_conversations
              SET clinic_id = COALESCE(clinic_id, $2),
                  channel = COALESCE(channel, $3),
                  external_id = COALESCE(external_id, $4),
                  phone_number_id = COALESCE(phone_number_id, $4),
                  updated_at = NOW()
            WHERE id = $1`,
          [conversationId, ctx0.clinic_id, ctx0.channel, ctx0.external_id]
        );
        conv = await loadConversation(q, conversationId);
      }

      // Seguridad tenant: solo bloqueamos si hay clinic_id diferente.
      if (conv.clinic_id && String(conv.clinic_id || '') !== String(ctx0.clinic_id || '')) {
        console.error('❌ TENANT MISMATCH:', { 
          conv_clinic_id: conv.clinic_id, 
          request_clinic_id: ctx0.clinic_id 
        });
        return res.status(403).json({ error: 'Tenant mismatch (clinic_id)' });
      }

      const state = safeJson(conv.state, {});
      // Persistir datos de WhatsApp dentro del state para no perder el hilo entre turnos.
      if (req.body?.phone && !state.phone) state.phone = String(req.body.phone);
      if (req.body?.phone) state.wa_phone = String(req.body.phone);
      if (req.body?.sucursal_id && !state.branch_key) state.branch_key = String(req.body.sucursal_id);

      const ctx = { ...ctx0, conversationId, phone: req.body?.phone || state.phone || state.wa_phone || null };

      // guardar mensaje user
      await q(
        `INSERT INTO ai_messages(conversation_id, role, content, meta)
         VALUES ($1,'user',$2,$3::jsonb)`,
        [conversationId, userText, JSON.stringify({ clinic_id: ctx.clinic_id, channel: ctx.channel, external_id: ctx.external_id })]
      );

      const out = await orchestrate(q, ctx, state, userText);

      // guardar assistant + state
      await q(
        `INSERT INTO ai_messages(conversation_id, role, content, meta)
         VALUES ($1,'assistant',$2,$3::jsonb)`,
        [conversationId, out.reply, JSON.stringify({ used: out.used || 'saas' })]
      );

      await saveState(q, conversationId, out.state);

      try {
        await logEvent(q, {
          clinic_id: ctx.clinic_id,
          conversation_id: conversationId,
          event: 'chat_turn',
          payload: { used: out.used, text_len: userText.length }
        });
      } catch (logErr) {
        console.warn('⚠️ ai_logs falló, pero NO se cancela la respuesta:', logErr.message);
      }

      console.log('✅ Response sent:', { used: out.used, reply_length: out.reply?.length });
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      res.json({ conversationId, reply: out.reply, used: out.used });
    } catch (e) {
      console.error('❌ ERROR in /api/ai/chat:', e);
      res.status(500).json({ error: e.message || String(e) });
    }
  });
}

module.exports = { setupAiSaasRoutes };

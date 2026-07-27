// modules/ai-saas-routes.js
// CliniqOne SaaS: aislamiento estricto por tenant_id obtenido exclusivamente del JWT.
const { safeJson, saveState, logEvent } = require('./conversation-state');
const { orchestrate } = require('./ai-orchestrator');

function tenantFromAuth(req) {
  const tenantId = req?.auth?.tenantId;
  if (!tenantId) {
    const error = new Error('No se pudo identificar la empresa de la sesión');
    error.statusCode = 401;
    throw error;
  }
  return String(tenantId);
}

function normalizeChannel(value) {
  const v = String(value || '').trim().toLowerCase();
  return v === 'whatsapp' ? 'whatsapp' : 'web';
}

async function ensureSaasTables(q) {
  await q(`
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id BIGSERIAL PRIMARY KEY,
      tenant_id UUID,
      title TEXT,
      clinic_id TEXT,
      channel TEXT,
      external_id TEXT,
      sucursal_id TEXT,
      phone_number_id TEXT,
      state JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS tenant_id UUID`);
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS clinic_id TEXT`);
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS channel TEXT`);
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS external_id TEXT`);
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS sucursal_id TEXT`);
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS phone_number_id TEXT`);
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS state JSONB DEFAULT '{}'::jsonb`);
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS title TEXT`);
  await q(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
  await q(`CREATE INDEX IF NOT EXISTS idx_ai_conversations_tenant_updated ON ai_conversations(tenant_id, updated_at DESC)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_ai_conversations_tenant_channel ON ai_conversations(tenant_id, channel, external_id)`);

  await q(`
    CREATE TABLE IF NOT EXISTS ai_messages (
      id BIGSERIAL PRIMARY KEY,
      tenant_id UUID,
      conversation_id BIGINT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await q(`ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS tenant_id UUID`);
  await q(`CREATE INDEX IF NOT EXISTS idx_ai_messages_tenant_conv ON ai_messages(tenant_id, conversation_id, created_at)`);

  await q(`
    CREATE TABLE IF NOT EXISTS ai_logs (
      id BIGSERIAL PRIMARY KEY,
      tenant_id UUID,
      clinic_id TEXT,
      conversation_id BIGINT,
      event TEXT NOT NULL,
      payload JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await q(`ALTER TABLE ai_logs ADD COLUMN IF NOT EXISTS tenant_id UUID`);
  await q(`ALTER TABLE ai_logs ADD COLUMN IF NOT EXISTS clinic_id TEXT`);
  await q(`ALTER TABLE ai_logs ADD COLUMN IF NOT EXISTS event TEXT`);
  await q(`ALTER TABLE ai_logs ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb`);
  await q(`CREATE INDEX IF NOT EXISTS idx_ai_logs_tenant_conv ON ai_logs(tenant_id, conversation_id, created_at DESC)`);
}

async function loadTenantConversation(q, tenantId, conversationId) {
  const { rows } = await q(
    `SELECT id, tenant_id, title, clinic_id, channel, external_id,
            sucursal_id, phone_number_id, state, created_at, updated_at
       FROM ai_conversations
      WHERE id = $1 AND tenant_id = $2::uuid
      LIMIT 1`,
    [conversationId, tenantId]
  );
  return rows[0] || null;
}

function setupAiSaasRoutes(app, q) {
  ensureSaasTables(q).catch((error) => {
    console.error('❌ ensureSaasTables:', error.message);
    process.exitCode = 1;
  });

  app.post('/api/ai/conversations', async (req, res) => {
    try {
      const tenantId = tenantFromAuth(req);
      const channel = normalizeChannel(req.body?.channel);
      const externalId = channel === 'whatsapp'
        ? String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim() || null
        : null;

      const { rows } = await q(
        `INSERT INTO ai_conversations
           (tenant_id, title, clinic_id, channel, external_id, phone_number_id, state)
         VALUES ($1::uuid, $2, $1::text, $3, $4, $4, '{}'::jsonb)
         RETURNING id, tenant_id, title, clinic_id, channel, external_id, created_at, updated_at`,
        [tenantId, String(req.body?.title || 'Chat'), channel, externalId]
      );
      return res.status(201).json(rows[0]);
    } catch (error) {
      return res.status(error.statusCode || 500).json({ error: error.message || String(error) });
    }
  });

  app.post('/api/ai/chat', async (req, res) => {
    try {
      const tenantId = tenantFromAuth(req);
      const conversationId = Number(req.body?.conversationId);
      const userText = String(req.body?.message || '').trim();

      if (!Number.isSafeInteger(conversationId) || conversationId <= 0) {
        return res.status(400).json({ error: 'conversationId inválido' });
      }
      if (!userText) return res.status(400).json({ error: 'message vacío' });

      const conv = await loadTenantConversation(q, tenantId, conversationId);
      if (!conv) {
        // No revelar si el ID existe en otra empresa.
        return res.status(404).json({ error: 'Conversación no encontrada' });
      }

      const state = safeJson(conv.state, {});
      const authenticatedPhone = String(req.body?.phone || state.phone || state.wa_phone || '').trim() || null;
      const requestedBranch = String(req.body?.sucursal_id || '').trim();
      if (authenticatedPhone) {
        state.phone = authenticatedPhone;
        state.wa_phone = authenticatedPhone;
      }
      if (requestedBranch && !state.branch_key) state.branch_key = requestedBranch;

      const ctx = {
        tenant_id: tenantId,
        clinic_id: tenantId, // compatibilidad con booking-engine; nunca proviene del frontend
        channel: conv.channel || 'whatsapp',
        external_id: conv.external_id || conv.phone_number_id || null,
        conversationId,
        phone: authenticatedPhone,
      };

      await q(
        `INSERT INTO ai_messages(tenant_id, conversation_id, role, content, meta)
         VALUES ($1::uuid, $2, 'user', $3, $4::jsonb)`,
        [tenantId, conversationId, userText, JSON.stringify({ tenant_id: tenantId, channel: ctx.channel })]
      );

      const out = await orchestrate(q, ctx, state, userText);
      if (!out || typeof out.reply !== 'string') {
        throw new Error('La IA produjo una respuesta inválida');
      }

      await q(
        `INSERT INTO ai_messages(tenant_id, conversation_id, role, content, meta)
         VALUES ($1::uuid, $2, 'assistant', $3, $4::jsonb)`,
        [tenantId, conversationId, out.reply, JSON.stringify({ used: out.used || 'saas', tenant_id: tenantId })]
      );

      // saveState es seguro por RLS; reforzamos además que la conversación ya fue validada por tenant.
      await saveState(q, conversationId, out.state);

      try {
        await logEvent(q, {
          tenant_id: tenantId,
          clinic_id: tenantId,
          conversation_id: conversationId,
          event: 'chat_turn',
          payload: { used: out.used, text_len: userText.length }
        });
      } catch (logError) {
        console.warn('⚠️ ai_logs falló sin cancelar la respuesta:', logError.message);
      }

      return res.json({ conversationId, reply: out.reply, used: out.used });
    } catch (error) {
      console.error('❌ ERROR /api/ai/chat:', error);
      return res.status(error.statusCode || 500).json({ error: error.message || String(error) });
    }
  });
}

module.exports = { setupAiSaasRoutes };

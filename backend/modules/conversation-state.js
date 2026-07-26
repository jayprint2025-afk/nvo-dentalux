// modules/conversation-state.js
// Carga/guarda state, timeout, y utilidades de log

function safeJson(v, fallback) {
  try {
    if (typeof v === 'object' && v) return v;
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

async function loadConversation(q, conversationId) {
  const { rows } = await q(
    `SELECT id, clinic_id, channel, external_id, sucursal_id, state
       FROM ai_conversations
      WHERE id = $1
      LIMIT 1`,
    [Number(conversationId)]
  );
  return rows?.[0] || null;
}

async function saveState(q, conversationId, state) {
  console.log('💾 SAVING STATE:', { conversationId, last_info_provided: state?.last_info_provided, stage: state?.stage });
  await q(
    `UPDATE ai_conversations
        SET state = $2::jsonb,
            updated_at = NOW()
      WHERE id = $1`,
    [Number(conversationId), JSON.stringify(state || {})]
  );
  console.log('✅ STATE SAVED');
}

function ensureStateDefaults(state) {
  const s = state && typeof state === 'object' ? state : {};
  if (!s.stage) s.stage = 'idle'; // idle | collect_branch | collect_date | collect_service | offer_slots | confirm | done
  if (!s.created_at_ms) s.created_at_ms = Date.now();
  return s;
}

function isBookingExpired(state, ttlMs = 10 * 60 * 1000) {
  const started = Number(state?.booking_started_at_ms || 0);
  if (!started) return false;
  return (Date.now() - started) > ttlMs;
}

function resetBooking(state, keep = {}) {
  return {
    ...state,
    stage: 'idle',
    intent: null,
    booking_started_at_ms: null,
    branch_key: keep.branch_key || null,
    date: null,
    service_id: null,
    patient: null,
    phone: keep.phone || null,
    duration_hours: 1,
    time_pref: null,
    min_start_mins: null,
    options: [],
    last_reply: null,
  };
}

async function logEvent(q, { clinic_id, conversation_id, event, payload }) {
  try {
    await q(`CREATE TABLE IF NOT EXISTS ai_logs (
      id BIGSERIAL PRIMARY KEY,
      clinic_id TEXT,
      conversation_id BIGINT,
      event TEXT,
      payload JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await q(`ALTER TABLE ai_logs ADD COLUMN IF NOT EXISTS event TEXT`).catch(()=>{});
    await q(`ALTER TABLE ai_logs ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb`).catch(()=>{});
    await q(
      `INSERT INTO ai_logs(clinic_id, conversation_id, event, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [clinic_id || null, conversation_id || null, String(event), JSON.stringify(payload || {})]
    );
  } catch (e) {
    // El log nunca debe romper una respuesta de WhatsApp.
    console.warn('⚠️ logEvent ignored:', e.message);
  }
}

module.exports = {
  safeJson,
  loadConversation,
  saveState,
  ensureStateDefaults,
  isBookingExpired,
  resetBooking,
  logEvent,
};

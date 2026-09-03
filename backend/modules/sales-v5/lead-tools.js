'use strict';
const crypto = require('crypto');

async function updateLead(pool, leadId, { profile, stage, score, nextStep }) {
  const { rows } = await pool.query(
    `UPDATE sales_leads
        SET profile=$2::jsonb,
            stage=COALESCE($3,stage),
            score=COALESCE($4,score),
            next_step=COALESCE($5,next_step),
            updated_at=NOW(),
            last_message_at=NOW()
      WHERE id=$1
      RETURNING *`,
    [leadId, JSON.stringify(profile || {}), stage || null, Number.isFinite(score) ? score : null, nextStep || null]
  );
  return rows[0] || null;
}

function calculateScore(profile = {}, stage = '') {
  let score = 10;
  if (profile.phone) score += 10;
  if (profile.email) score += 15;
  if (profile.clinic_name) score += 10;
  if (profile.branches) score += 10;
  score += Math.min(20, (profile.pain_points || []).length * 7);
  score += Math.min(15, (profile.interested_features || []).length * 5);
  if (profile.buying_intent === 'medium') score += 10;
  if (profile.buying_intent === 'high') score += 25;
  if (stage === 'won') score = 100;
  return Math.max(0, Math.min(100, score));
}

module.exports = { updateLead, calculateScore };


async function getOffer(pool) {
  const { DEFAULT_OFFER, normalizeOffer } = require('./sales-knowledge');
  try {
    const { rows } = await pool.query(`SELECT value FROM sales_settings WHERE key='offer' LIMIT 1`);
    return normalizeOffer(rows[0]?.value || DEFAULT_OFFER);
  } catch { return normalizeOffer(DEFAULT_OFFER); }
}

async function createOnboarding(pool, lead, profile = {}) {
  if (!profile.email || !profile.clinic_name || !profile.name) return null;
  const existing = await pool.query(
    `SELECT token, expires_at, completed_at FROM sales_onboarding WHERE lead_id=$1 ORDER BY id DESC LIMIT 1`, [lead.id]
  );
  let token = existing.rows[0]?.token;
  if (!token || existing.rows[0]?.completed_at || new Date(existing.rows[0]?.expires_at || 0) <= new Date()) {
    token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sales_onboarding(lead_id,token,email,owner_name,clinic_name,expires_at)
       VALUES($1,$2,$3,$4,$5,NOW()+INTERVAL '72 hours')`,
      [lead.id, token, String(profile.email).toLowerCase(), profile.name, profile.clinic_name]
    );
  }
  const base = String(process.env.PUBLIC_APP_URL || process.env.FRONTEND_ORIGIN || process.env.RENDER_EXTERNAL_URL || '').split(',')[0].trim().replace(/\/$/, '');
  if (!base) return { token, url: `/api/sales/onboarding/${token}/page` };
  return { token, url: `${base}/api/sales/onboarding/${encodeURIComponent(token)}/page` };
}

module.exports.getOffer = getOffer;
module.exports.createOnboarding = createOnboarding;

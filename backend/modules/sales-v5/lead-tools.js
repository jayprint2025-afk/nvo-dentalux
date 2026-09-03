'use strict';

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

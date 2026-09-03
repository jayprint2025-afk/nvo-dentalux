'use strict';

const State = require('./conversation-state');
const { interpret } = require('./turn-interpreter');
const Planner = require('./sales-objective-planner');
const { writeReply } = require('./response-writer');
const { loadHistory } = require('./conversation-memory');
const LeadTools = require('./lead-tools');
const Telemetry = require('./telemetry');

async function processTurn(pool, lead, text) {
  const turn = interpret(text);
  let profile = State.mergeProfile(lead.profile || {}, turn.profile_patch || {});

  const offer = await LeadTools.getOffer(pool);
  const recommendation = Planner.recommendPlan(profile);
  if (recommendation) profile = State.mergeProfile(profile, { recommended_plan: recommendation });

  let stage = Planner.stageFor(profile, turn);
  let objective = Planner.objectiveFor(profile, turn);

  if ((turn.intent === 'close' || profile.buying_intent === 'high') && profile.clinic_name && profile.name && profile.email && !profile.onboarding_url) {
    const onboarding = await LeadTools.createOnboarding(pool, lead, profile);
    if (onboarding?.url) {
      profile = State.mergeProfile(profile, { onboarding_url: onboarding.url, onboarding_token_created: true, next_step: 'Completar registro seguro' });
    }
  }

  if (profile.onboarding_url) {
    stage = 'onboarding';
    objective = 'Compartir el enlace seguro de onboarding directamente en esta conversación. No prometer envío por correo.';
  }
  const score = LeadTools.calculateScore(profile, stage);
  profile = State.mergeProfile(profile, { next_step: objective });

  await LeadTools.updateLead(pool, lead.id, { profile, stage, score, nextStep: objective });

  const history = await loadHistory(pool, lead.id, 18);
  let reply;
  try {
    reply = await writeReply({ profile, turn, objective, history, offer });
  } catch (error) {
    Telemetry.log('writer_error', { lead_id: lead.id, message: error.message });
    const { fallback } = require('./response-writer');
    reply = fallback(profile, turn, objective, offer);
  }

  Telemetry.log('turn', { lead_id: lead.id, intent: turn.intent, stage, score });
  return { reply, profile, stage, score, objective, intent: turn.intent };
}

module.exports = { processTurn };

'use strict';

const State = require('./conversation-state');
const { interpret } = require('./turn-interpreter');
const Planner = require('./sales-objective-planner');
const { writeReply } = require('./response-writer');
const { loadHistory } = require('./conversation-memory');
const LeadTools = require('./lead-tools');
const Telemetry = require('./telemetry');

function cleanShortAnswer(text, max = 100) {
  const value = String(text || '').trim().replace(/\s+/g, ' ');
  if (!value || value.length > max) return null;
  if (/https?:\/\//i.test(value)) return null;
  return value.replace(/^[\s,:;.-]+|[\s,:;.-]+$/g, '').trim() || null;
}

function looksLikeActionReply(text) {
  const value = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  if (!value) return true;

  // Estas respuestas expresan intención de compra o avance, no son nombres.
  // Evita guardar "Quiero contratar" como nombre de la empresa cuando un lead
  // existente conserva next_step de una conversación anterior.
  return /^(?:quiero\s+(?:contratar|probar|registrarme|registrar|empezar|continuar)|me\s+interesa(?:\s+mucho)?|crear\s+(?:mi\s+)?cuenta|contratar|registrarme|si|sí|ok|okay|dale|listo|continua|continúa|procede|adelante|hazlo|mandamelo|mándamelo|enviamelo|envíamelo)[.! ]*$/.test(value);
}

function absorbPendingAnswer(lead, profile, turn) {
  const pending = String(lead?.next_step || lead?.profile?.next_step || '').toLowerCase();
  const raw = cleanShortAnswer(turn?.text);
  if (!raw || looksLikeActionReply(raw)) return profile;

  // El intérprete reconoce "mi clínica se llama X", pero muchos prospectos
  // contestan simplemente "Dentalux". Usamos el objetivo anterior para saber
  // qué dato estaba esperando el agente.
  if (!profile.clinic_name && /nombre de la cl[ií]nica|cl[ií]nica o consultorio/.test(pending)) {
    return State.mergeProfile(profile, { clinic_name: raw });
  }

  if (!profile.name && /nombre del responsable/.test(pending)) {
    return State.mergeProfile(profile, { name: raw });
  }

  // El correo se conserva únicamente si el intérprete ya validó su formato.
  return profile;
}

async function processTurn(pool, lead, text) {
  const turn = interpret(text);
  let profile = State.mergeProfile(lead.profile || {}, turn.profile_patch || {});
  profile = absorbPendingAnswer(lead, profile, turn);

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

'use strict';

function recommendPlan(profile = {}) {
  const branches = Number(profile.branches || 0);
  const interests = (profile.interested_features || []).join(' ').toLowerCase();
  const pains = (profile.pain_points || []).join(' ').toLowerCase();

  if (branches >= 2 || /factur|laboratorio|multi|dashboard/.test(interests + ' ' + pains)) return branches >= 2 ? 'promo_2_branches' : 'complete';
  if (/inventario|productividad|meta|report/.test(interests + ' ' + pains)) return 'medium';
  if (/agenda|whatsapp|expediente|odontograma/.test(interests + ' ' + pains)) return 'basic';
  return null;
}

function stageFor(profile = {}, turn = {}) {
  if (turn.intent === 'close' || profile.buying_intent === 'high') return 'high_intent';
  if ((profile.pain_points || []).length || (profile.interested_features || []).length) return 'qualified';
  if (turn.intent === 'pricing' || turn.intent === 'features' || turn.intent === 'competition' || turn.intent === 'objection') return 'presenting';
  return 'discovery';
}

function objectiveFor(profile = {}, turn = {}) {
  if (turn.intent === 'close') return 'Obtener correo, nombre de clínica y confirmar que desea iniciar registro/prueba, sin pedir contraseña por chat.';
  if (turn.intent === 'objection') return 'Resolver la objeción con información concreta y hacer una sola pregunta de avance.';
  if (turn.intent === 'competition') return 'Comparar sin inventar datos del competidor; descubrir qué problema quiere resolver.';
  if (turn.intent === 'pricing') return 'Dar precios exactos primero y recomendar el plan más lógico usando los datos ya conocidos.';
  if (!(profile.pain_points || []).length) return 'Descubrir el principal problema operativo del prospecto con una pregunta natural.';
  if (!profile.branches) return 'Entender el tamaño del consultorio y número de sucursales sin convertir la conversación en formulario.';
  return 'Conectar el problema detectado con beneficios concretos de CliniqOne y avanzar hacia prueba o registro.';
}

module.exports = { recommendPlan, stageFor, objectiveFor };

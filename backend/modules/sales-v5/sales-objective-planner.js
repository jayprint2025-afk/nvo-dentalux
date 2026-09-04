'use strict';
function recommendPlan() { return 'cliniqone_complete'; }
function stageFor(profile = {}, turn = {}) {
  if (profile.onboarding_completed) return 'won';
  if (profile.onboarding_token_created) return 'onboarding';
  if (turn.intent === 'close' || profile.buying_intent === 'high') return 'high_intent';
  if ((profile.pain_points || []).length || (profile.interested_features || []).length) return 'qualified';
  if (['pricing','features','competition','objection'].includes(turn.intent)) return 'presenting';
  return 'discovery';
}
function objectiveFor(profile = {}, turn = {}) {
  if (profile.onboarding_completed) return 'Dar bienvenida y orientar al acceso de CliniqOne.';
  if (profile.onboarding_url) return 'Indicar que su acceso seguro está listo y compartir el enlace sin pedir contraseña por chat.';
  if (turn.intent === 'close' || profile.buying_intent === 'high') {
    if (!profile.clinic_name) return 'Obtener el nombre de la clínica o consultorio.';
    if (!profile.name) return 'Obtener el nombre del responsable.';
    if (!profile.email) return 'Obtener el correo que usará para ingresar a CliniqOne.';
    return 'Crear el onboarding seguro y compartir el enlace para que el cliente cree personalmente su contraseña.';
  }
  if (turn.intent === 'pricing') return 'Dar el único precio vigente y explicar brevemente que incluye doctores y sucursales ilimitados y los asistentes IA.';
  if (turn.intent === 'features') return 'Responder con conocimiento experto y concreto sobre las funciones solicitadas. Si pide todos los módulos o detalles, explicar el alcance completo sin omitir Expediente, Inventario, asistentes IA ni recordatorios/confirmaciones automáticas.';
  if (turn.intent === 'objection') return 'Resolver la objeción con información concreta y hacer una sola pregunta de avance.';
  if (turn.intent === 'competition') return 'Comparar sin inventar datos del competidor y conectar la necesidad con CliniqOne.';
  if (!(profile.pain_points || []).length) return 'Descubrir el principal problema operativo del prospecto con una pregunta natural.';
  return 'Conectar la necesidad detectada con CliniqOne y avanzar hacia el registro/prueba.';
}
module.exports = { recommendPlan, stageFor, objectiveFor };

'use strict';
function recommendPlan(profile = {}) {
  const interests = (profile.interested_features || []).join(' ').toLowerCase();
  return /(ia|whatsapp automatico|facebook|messenger|instagram|hanna|recordatorio|confirmacion)/.test(interests) ? 'cliniqone_ai' : 'cliniqone';
}
function stageFor(profile = {}, turn = {}) {
  if (profile.sale_closed || profile.customer_status === 'customer' || profile.onboarding_completed) return 'won';
  if (profile.onboarding_token_created || profile.customer_status === 'onboarding') return 'onboarding';
  if (turn.intent === 'close' || profile.buying_intent === 'high') return 'high_intent';
  if ((profile.pain_points || []).length || (profile.interested_features || []).length) return 'qualified';
  if (['pricing','features','competition','objection'].includes(turn.intent)) return 'presenting'; return 'discovery';
}
function objectiveFor(profile = {}, turn = {}) {
  if (profile.sale_closed || profile.customer_status === 'customer' || profile.onboarding_completed) return 'Atender al cliente en modo postventa: resolver su duda y guiarlo en acceso, configuración o uso. No volver a venderle el mismo plan ni iniciar otro onboarding. Solo tratar una nueva venta si pide explícitamente un upgrade, otra cuenta o contratación adicional.';
  if (profile.onboarding_url && profile.onboarding_link_shared) return 'Atender en modo postventa/onboarding: responder la pregunta actual y guiar al cliente. No repetir el enlace ni reiniciar la venta salvo que pida explícitamente el enlace, un upgrade u otra contratación.';
  if (profile.onboarding_url) return 'Compartir una sola vez el enlace seguro para crear su contraseña y después continuar atendiendo normalmente.';
  if (turn.intent === 'close' || profile.buying_intent === 'high') {
    if (!profile.clinic_name) return 'Obtener el nombre de la clínica o consultorio.'; if (!profile.name) return 'Obtener el nombre del responsable.'; if (!profile.email) return 'Obtener el correo que usará para ingresar a CliniqOne.';
    return 'Crear el onboarding seguro y compartir el enlace para que el cliente cree personalmente su contraseña.';
  }
  if (turn.intent === 'pricing') return 'Explicar los dos planes vigentes: CliniqOne $799 y CliniqOne AI $1,490 MXN/mes, diferenciando claramente automatización e IA.';
  if (turn.intent === 'features') return 'Responder con conocimiento experto y aclarar en cuál de los dos planes está disponible cada función solicitada.';
  if (turn.intent === 'objection') return 'Resolver la objeción con información concreta y hacer una sola pregunta de avance.';
  if (turn.intent === 'competition') return 'Comparar sin inventar datos del competidor y conectar la necesidad con CliniqOne.';
  if (!(profile.pain_points || []).length) return 'Descubrir el principal problema operativo del prospecto con una pregunta natural.';
  return 'Conectar la necesidad detectada con el plan CliniqOne o CliniqOne AI que corresponda y avanzar hacia el registro.';
}
module.exports = { recommendPlan, stageFor, objectiveFor };

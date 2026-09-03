'use strict';

const DEFAULT_OFFER = Object.freeze({
  brand: 'CliniqOne',
  promise: 'Tu clínica, todo en un solo lugar.',
  price_mxn: 1490,
  billing_period: 'mes',
  doctors: 'ilimitados',
  branches: 'ilimitadas',
  ai_channels: ['WhatsApp', 'Facebook Messenger'],
  features: ['Agenda','Caja','Productividad','Laboratorios','Administración de sucursales','Asistente virtual IA para WhatsApp','Asistente virtual IA para Facebook Messenger']
});

const COMPETITOR_POLICY = {
  rule: 'Nunca inventes características, precios ni defectos de competidores. Si no existe una comparación verificada, explica las fortalezas comprobadas de CliniqOne y ofrece comparar punto por punto con lo que el prospecto usa.',
  verified: {}
};

function normalizeOffer(value = {}) {
  const price = Number(value.price_mxn);
  return { ...DEFAULT_OFFER, ...(value || {}), price_mxn: Number.isFinite(price) && price > 0 ? price : DEFAULT_OFFER.price_mxn };
}

function summarizeKnowledge(offerValue = {}) {
  const offer = normalizeOffer(offerValue);
  return [
    `Marca: ${offer.brand}.`,
    `Propuesta: ${offer.promise}`,
    `Oferta comercial actual: un solo producto completo por $${offer.price_mxn.toLocaleString('es-MX')} MXN al ${offer.billing_period}.`,
    `Doctores: ${offer.doctors}. Sucursales: ${offer.branches}.`,
    `Asistentes virtuales IA incluidos para ${offer.ai_channels.join(' y ')}.`,
    `Módulos incluidos actualmente: ${offer.features.join(', ')}.`,
    'No existen planes Básico, Medio o Completo. No preguntes qué plan desea el prospecto.',
    'No prometas IA o mensajería ilimitada; los asistentes están incluidos y la política de uso puede definirse comercialmente.',
    `Competencia: ${COMPETITOR_POLICY.rule}`
  ].join('\n');
}

module.exports = { DEFAULT_OFFER, COMPETITOR_POLICY, normalizeOffer, summarizeKnowledge };

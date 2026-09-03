'use strict';

const { summarizeKnowledge } = require('./sales-knowledge');
const { rules } = require('./sales-policy');

const DEFAULT_MODEL = process.env.SALES_AI_MODEL || process.env.AI_MODEL || 'gpt-4o-mini';
const API_KEY = process.env.OPENAI_API_KEY || '';
const TIMEOUT = Number(process.env.SALES_AI_TIMEOUT_MS || process.env.AI_TIMEOUT_MS || 18000);

function timeoutFetch(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function onboardingReply(profile = {}) {
  const url = String(profile.onboarding_url || '').trim();
  if (!url) return null;
  return `Excelente ✅ Tu registro seguro de CliniqOne ya está listo.\n\nAquí puedes crear personalmente tu contraseña y activar tu cuenta:\n${url}\n\nEste enlace es personal; no compartas tu contraseña por este chat.`;
}

function fallback(profile, turn, objective, offer = {}) {
  const onboarding = onboardingReply(profile);
  if (onboarding) return onboarding;
  const price = Number(offer.price_mxn || 1490).toLocaleString('es-MX');
  if (turn.intent === 'pricing') {
    return `CliniqOne tiene un solo precio: $${price} MXN al mes. Incluye la plataforma, doctores y sucursales ilimitados, además de los asistentes virtuales IA para WhatsApp y Facebook Messenger.`;
  }
  if (turn.intent === 'close') {
    if (profile.onboarding_url) return `Tu registro seguro ya está listo. Crea personalmente tu contraseña aquí: ${profile.onboarding_url}`;
    if (!profile.clinic_name) return 'Excelente. Para preparar tu acceso, ¿cómo se llama tu clínica o consultorio?';
    if (!profile.name) return '¿A nombre de quién preparo el acceso?';
    if (!profile.email) return 'Excelente. ¿Qué correo quieres utilizar para tu cuenta de CliniqOne? La contraseña la crearás tú de forma segura, no por este chat.';
    return 'Excelente. Ya tengo los datos principales para preparar tu registro. La contraseña la crearás tú directamente en el acceso seguro de CliniqOne.';
  }
  return `Puedo ayudarte a evaluar CliniqOne según lo que realmente necesitas. ${objective}`;
}

async function writeReply({ profile, turn, objective, history = [], offer = {} }) {
  const onboarding = onboardingReply(profile);
  if (onboarding) return onboarding;
  if (!API_KEY) return fallback(profile, turn, objective, offer);

  const system = [
    'Eres el ejecutivo comercial oficial de CliniqOne.',
    ...rules().map((r, i) => `${i + 1}. ${r}`),
    '',
    summarizeKnowledge(offer),
    '',
    `OBJETIVO DE ESTE TURNO: ${objective}`,
    `PERFIL CONOCIDO: ${JSON.stringify(profile)}`
  ].join('\n');

  const messages = [
    { role: 'system', content: system },
    ...history.slice(-16).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }))
  ];

  const response = await timeoutFetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      temperature: 0.25,
      max_tokens: 360,
      messages
    })
  }, TIMEOUT);

  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error?.message || `openai_${response.status}`);
  return String(json?.choices?.[0]?.message?.content || '').trim() || fallback(profile, turn, objective, offer);
}

module.exports = { writeReply, fallback, onboardingReply, DEFAULT_MODEL };

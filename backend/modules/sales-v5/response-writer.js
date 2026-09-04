'use strict';

const { summarizeKnowledge, PRODUCT_MODULES } = require('./sales-knowledge');
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

function formatModule(key, compact = false) {
  const mod = PRODUCT_MODULES[key];
  if (!mod) return '';
  if (compact) return `• ${mod.name}: ${mod.facts[0]}`;
  return `**${mod.name}**\n${mod.facts.map(f => `• ${f}`).join('\n')}`;
}

function wantsAllModules(text = '') {
  const n = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /(todo|todos los modulos|que contiene|que incluye|alcance|con detalles|detalle completo|como funciona.*app|informacion completa)/.test(n);
}

function requestedModuleKeys(text = '') {
  const n = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const keys = [];
  if (/(\bagenda\b|\bcitas?\b|recordatorio|confirmacion)/.test(n)) keys.push('agenda');
  if (/(expediente|odontograma|historial medico|historial clinico)/.test(n)) keys.push('expediente');
  if (/(caja|ingreso|egreso|pago)/.test(n)) keys.push('caja');
  if (/(productividad|reporte|grafica|rendimiento)/.test(n)) keys.push('productividad');
  if (/(laboratorio|trabajo dental|protesis)/.test(n)) keys.push('laboratorios');
  if (/(inventario|stock|insumo|material)/.test(n)) keys.push('inventario');
  if (/(sucursal|multi.?sucursal|doctores)/.test(n)) keys.push('sucursales');
  if (/(\bia\b|inteligencia artificial|whatsapp|messenger|facebook|asistente virtual)/.test(n)) keys.push('ia');
  if (/(capacitacion|soporte|ayuda para usar)/.test(n)) keys.push('soporte');
  return Array.from(new Set(keys));
}

function featureFallback(turn = {}, offer = {}) {
  const price = Number(offer.price_mxn || 1490).toLocaleString('es-MX');
  const allKeys = ['agenda','expediente','caja','productividad','laboratorios','inventario','sucursales','ia','soporte'];
  const keys = wantsAllModules(turn.text) ? allKeys : requestedModuleKeys(turn.text);
  const selected = keys.length ? keys : allKeys;
  const intro = wantsAllModules(turn.text)
    ? `Claro. CliniqOne es una plataforma integral para administrar la operación de la clínica en un solo lugar. La oferta actual es de $${price} MXN al mes, con doctores y sucursales ilimitados.`
    : 'Sí. Esa función forma parte de CliniqOne. Te explico exactamente cómo trabaja:';
  const body = selected.map(k => formatModule(k, false)).filter(Boolean).join('\n\n');
  return `${intro}\n\n${body}\n\nTodo está pensado para que agenda, atención clínica, administración y comunicación con pacientes trabajen conectadas, no como herramientas aisladas.`;
}

function fallback(profile, turn, objective, offer = {}) {
  const onboarding = onboardingReply(profile);
  if (onboarding) return onboarding;
  const price = Number(offer.price_mxn || 1490).toLocaleString('es-MX');

  if (turn.intent === 'pricing') {
    return `CliniqOne tiene una sola oferta completa por $${price} MXN al mes. Incluye Agenda inteligente, Expediente clínico y odontograma, Caja, Productividad, Laboratorios dentales, Inventario, administración de sucursales, asistentes virtuales IA para WhatsApp y Facebook Messenger y recordatorios/confirmaciones automáticas. Los doctores y sucursales están contemplados como ilimitados en la oferta actual.`;
  }

  if (turn.intent === 'features' || requestedModuleKeys(turn.text).length || wantsAllModules(turn.text)) {
    return featureFallback(turn, offer);
  }

  if (turn.intent === 'competition') {
    return `Puedo compararlo punto por punto con el sistema que utilizas, pero prefiero no atribuirle funciones o limitaciones que no estén verificadas. De CliniqOne sí puedo confirmarte que integra Agenda, Expediente clínico y odontograma, Caja, Productividad, Laboratorios dentales, Inventario, sucursales y asistentes IA para WhatsApp y Facebook Messenger, además de recordatorios y confirmaciones automáticas. ¿Qué sistema utilizas actualmente y qué función es la más importante para ti?`;
  }

  if (turn.intent === 'objection') {
    const n = String(turn.text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/(caro|mucho dinero|precio alto)/.test(n)) {
      return `Entiendo que quieras justificar la inversión. La oferta actual de CliniqOne es de $${price} MXN al mes e integra en una sola plataforma Agenda, Expediente clínico, Caja, Productividad, Laboratorios dentales, Inventario, sucursales, asistentes IA y confirmaciones automáticas. La comparación útil es contra lo que hoy te cuesta operar esas tareas por separado o de forma manual.`;
    }
    if (/(perder.*datos|miedo.*datos|migrar)/.test(n)) {
      return 'Es una preocupación válida. No te prometería una migración automática sin revisar primero cómo tienes organizada tu información actual. Lo correcto es confirmar ese punto antes de comprometer un alcance que no esté documentado.';
    }
    return 'Puedo resolver esa duda con información concreta de CliniqOne. No voy a prometerte una función o resultado que no esté confirmado.';
  }

  if (turn.intent === 'demo') {
    return 'Puedo explicarte el flujo completo de CliniqOne y ayudarte a validar si cubre tu operación. Si deseas avanzar al registro, el acceso se genera mediante un enlace seguro donde tú mismo creas tu contraseña.';
  }

  if (turn.intent === 'close' || profile.buying_intent === 'high') {
    if (profile.onboarding_url) return `Tu registro seguro ya está listo. Crea personalmente tu contraseña aquí: ${profile.onboarding_url}`;
    if (!profile.clinic_name) return 'Perfecto. Para preparar correctamente tu acceso, ¿cómo se llama tu clínica o consultorio?';
    if (!profile.name) return 'Gracias. ¿Cuál es el nombre del responsable de la cuenta?';
    if (!profile.email) return 'Perfecto. ¿Qué correo quieres utilizar para ingresar a CliniqOne? Tu contraseña la crearás personalmente en el enlace seguro; nunca te la pediré por este chat.';
    return 'Ya tengo los datos necesarios para generar tu registro seguro de CliniqOne.';
  }

  if (/(capacitacion|soporte)/i.test(turn.text || '')) {
    return formatModule('soporte');
  }

  return `Con gusto. Puedo explicarte CliniqOne de forma puntual según la operación de tu clínica. ${objective}`;
}

async function writeReply({ profile, turn, objective, history = [], offer = {} }) {
  const onboarding = onboardingReply(profile);
  if (onboarding) return onboarding;
  if (!API_KEY) return fallback(profile, turn, objective, offer);

  const system = [
    'Eres la ejecutiva comercial oficial y especialista de producto de CliniqOne.',
    'Tu credibilidad depende de responder con dominio real del producto, precisión y criterio consultivo. El cliente nunca debe sentir que conoce mejor CliniqOne que tú.',
    ...rules().map((r, i) => `${i + 1}. ${r}`),
    '',
    summarizeKnowledge(offer),
    '',
    'FORMA DE CONECTAR CON EL PROSPECTO:',
    '- Reconoce brevemente la necesidad concreta que expresó y relaciónala con funciones reales de CliniqOne.',
    '- Explica primero el valor operativo y después la función; evita enumeraciones vacías.',
    '- Si pide detalle, desarrolla todos los módulos relevantes y su alcance sin omisiones.',
    '- Si el cliente corrige o recuerda una función, responde con seguridad y precisión; no parezcas sorprendido por tu propio producto.',
    '- No presiones el registro mientras el prospecto siga haciendo preguntas informativas. La confianza y claridad van antes del cierre.',
    '- Cuando detectes decisión real de avanzar, conduce el cierre paso a paso y solicita solo un dato faltante por turno.',
    '- Nunca declares que una cuenta fue creada hasta que exista el enlace de onboarding o el proceso haya sido completado.',
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
      temperature: 0.12,
      max_tokens: 1000,
      messages
    })
  }, TIMEOUT);

  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error?.message || `openai_${response.status}`);
  return String(json?.choices?.[0]?.message?.content || '').trim() || fallback(profile, turn, objective, offer);
}

module.exports = { writeReply, fallback, onboardingReply, featureFallback, DEFAULT_MODEL };

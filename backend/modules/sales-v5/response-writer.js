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

function onboardingReply(profile = {}, turn = {}) {
  const url = String(profile.onboarding_url || '').trim();
  if (!url) return null;
  const n = String(turn.text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const explicitlyRequestsLink = /(reenvi|reenvia|manda.*(?:link|enlace|acceso)|envia.*(?:link|enlace|acceso)|donde.*(?:entro|ingreso|acceso)|(?:link|enlace).*(?:registro|acceso|contrasena)|perdi.*(?:link|enlace)|no encuentro.*(?:link|enlace))/.test(n);
  if (profile.onboarding_link_shared && !explicitlyRequestsLink) return null;
  return `Excelente ✅ Tu registro seguro de CliniqOne ya está listo.\n\nAquí puedes crear personalmente tu contraseña y activar tu cuenta:\n${url}\n\nEste enlace es personal; no compartas tu contraseña por este chat.`;
}

function isPostSale(profile = {}) {
  return Boolean(profile.sale_closed || profile.customer_status === 'customer' || profile.onboarding_completed || (profile.onboarding_url && profile.onboarding_link_shared));
}

function isExplicitNewCommercialIntent(text = '') {
  const n = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /(cambiar(?:me)? al plan|subir(?:me)? al plan|upgrade|actualizar.*plan|quiero.*(?:plan ai|cliniqone ai)|contratar.*(?:otra|otro|adicional)|otra cuenta|otra empresa|segunda cuenta|cuenta adicional)/.test(n);
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
  if (/(mensaje.*manual|whatsapp manual)/.test(n)) keys.push('whatsapp_manual');
  if (/(recordatorio|confirmacion|automatic)/.test(n)) keys.push('automatizaciones');
  if (/(hanna|asistente personal|voz)/.test(n)) keys.push('hanna');
  if (/(\bia\b|inteligencia artificial|whatsapp|messenger|facebook|instagram|asistente virtual)/.test(n)) keys.push('ia_pacientes');
  if (/(capacitacion|soporte|ayuda para usar)/.test(n)) keys.push('soporte');
  return Array.from(new Set(keys));
}

function featureFallback(turn = {}, offer = {}) {
  const allKeys = ['agenda','expediente','caja','productividad','laboratorios','inventario','sucursales','whatsapp_manual','automatizaciones','ia_pacientes','hanna','soporte'];
  const keys = wantsAllModules(turn.text) ? allKeys : requestedModuleKeys(turn.text);
  const selected = keys.length ? keys : allKeys;
  const intro = wantsAllModules(turn.text)
    ? 'Claro. CliniqOne tiene dos opciones: CliniqOne por $799 MXN/mes para la administración completa de la clínica, y CliniqOne AI por $1,490 MXN/mes, que agrega automatización, asistentes virtuales y Hanna. En ambos puedes agregar doctores y sucursales sin costo adicional.'
    : 'Sí. Te explico exactamente cómo funciona y en qué plan está disponible:';
  const body = selected.map(k => formatModule(k, false)).filter(Boolean).join('\n\n');
  return `${intro}\n\n${body}`;
}

function fallback(profile, turn, objective, offer = {}) {
  const onboarding = onboardingReply(profile, turn);
  if (onboarding) return onboarding;
  const postSale = isPostSale(profile);
  const newCommercialIntent = isExplicitNewCommercialIntent(turn.text);

  if (postSale && newCommercialIntent) {
    return 'Claro. Como ya eres cliente, no necesitas repetir el registro. Si quieres cambiar a CliniqOne AI o contratar una cuenta adicional, puedo orientarte con esa nueva solicitud sin reiniciar tu onboarding actual. Dime cuál de esas opciones necesitas y seguimos desde ahí.';
  }

  if (postSale && !newCommercialIntent && turn.intent === 'close') {
    return 'Claro. Tu registro ya quedó generado, así que no necesitas volver a contratar ni repetir el proceso. Dime qué duda tienes o qué necesitas configurar y te guío desde aquí.';
  }

  if (turn.intent === 'pricing') {
    return 'Tenemos dos opciones: **CliniqOne por $799 MXN/mes**, con Agenda, Caja, Expediente/odontograma/consentimientos, historial, Inventario, Productividad, Laboratorio, Multisucursal y WhatsApp manual; y **CliniqOne AI por $1,490 MXN/mes**, que incluye todo lo anterior más recordatorios automáticos, asistentes IA para WhatsApp, Facebook Messenger e Instagram, y Hanna por voz. En ambos puedes agregar doctores y sucursales sin costo adicional.';
  }

  if (turn.intent === 'features' || requestedModuleKeys(turn.text).length || wantsAllModules(turn.text)) {
    return featureFallback(turn, offer);
  }

  if (turn.intent === 'competition') {
    return `Puedo compararlo punto por punto con el sistema que utilizas, pero prefiero no atribuirle funciones o limitaciones que no estén verificadas. De CliniqOne sí puedo confirmarte que integra Agenda, Expediente clínico y odontograma, Caja, Productividad, Laboratorios dentales, Inventario, sucursales y WhatsApp manual; el plan CliniqOne AI agrega asistentes IA para WhatsApp, Facebook Messenger e Instagram, recordatorios automáticos y Hanna por voz. ¿Qué sistema utilizas actualmente y qué función es la más importante para ti?`;
  }

  if (turn.intent === 'objection') {
    const n = String(turn.text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/(caro|mucho dinero|precio alto)/.test(n)) {
      return 'Entiendo que quieras justificar la inversión. Puedes empezar con CliniqOne por $799 MXN/mes para toda la administración de la clínica, o elegir CliniqOne AI por $1,490 MXN/mes si necesitas automatización, asistentes virtuales y Hanna. En ambos puedes agregar doctores y sucursales sin costo adicional.';
    }
    if (/(perder.*datos|miedo.*datos|migrar)/.test(n)) {
      return 'Es una preocupación válida. No te prometería una migración automática sin revisar primero cómo tienes organizada tu información actual. Lo correcto es confirmar ese punto antes de comprometer un alcance que no esté documentado.';
    }
    return 'Puedo resolver esa duda con información concreta de CliniqOne. No voy a prometerte una función o resultado que no esté confirmado.';
  }

  if (turn.intent === 'demo') {
    return 'Puedo explicarte el flujo completo de CliniqOne y ayudarte a validar si cubre tu operación. Si deseas avanzar al registro, el acceso se genera mediante un enlace seguro donde tú mismo creas tu contraseña.';
  }

  if ((turn.intent === 'close' || profile.buying_intent === 'high') && !postSale) {
    if (profile.onboarding_url && !profile.onboarding_link_shared) return `Tu registro seguro ya está listo. Crea personalmente tu contraseña aquí: ${profile.onboarding_url}`;
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
  const onboarding = onboardingReply(profile, turn);
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
    '- Si el enlace de onboarding ya fue compartido, NO lo repitas automáticamente. Continúa atendiendo cualquier pregunta, duda, objeción o consulta del cliente con normalidad.',
    '- Solo vuelve a compartir el enlace si el cliente lo pide explícitamente o dice que lo perdió/no lo encuentra.',
    '- Haber iniciado o completado onboarding nunca termina la atención: sigue respondiendo y guiando al cliente.',
    '- Cuando PERFIL CONOCIDO indique onboarding_link_shared=true, sale_closed=true, customer_status=customer u onboarding_completed=true, trata al usuario como CLIENTE, no como prospecto nuevo.',
    '- En modo cliente/postventa NO vuelvas a venderle el mismo plan, NO solicites otra vez clínica/nombre/correo y NO inicies otro onboarding por frases ambiguas como “sí”, “dale”, “me interesa” o “envíamelo”.',
    '- En postventa responde dudas de planes, funciones, acceso, configuración y uso con el mismo nivel profesional y amable.',
    '- Solo abre una nueva acción comercial después de la venta si el cliente pide EXPLÍCITAMENTE un upgrade a CliniqOne AI, otra cuenta/empresa o una contratación adicional.',
    '',
    `ESTADO COMERCIAL: ${isPostSale(profile) ? 'CLIENTE / POSTVENTA' : 'PROSPECTO'}`,
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

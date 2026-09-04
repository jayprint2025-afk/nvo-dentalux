'use strict';

function norm(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}

function extractEmail(text) {
  return String(text || '').match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0]?.toLowerCase() || null;
}

function extractPhone(text) {
  const found = String(text || '').match(/\+?\d[\d\s().-]{8,}\d/g) || [];
  const values = found.map(v => v.replace(/\D/g,'')).filter(v => v.length >= 10 && v.length <= 13);
  return values.find(v => v.length === 10) || values[0] || null;
}

function extractBranches(text) {
  const n = norm(text);
  const m = n.match(/(\d+)\s*(?:sucursal|sucursales|consultorio|consultorios|clinica|clinicas)\b/);
  return m ? Number(m[1]) : null;
}

function inferIntent(text) {
  const n = norm(text);
  if (/(quiero probar|quiero registr|me registro|crear cuenta|empezar|contratar|lo quiero|me interesa mucho|envia(?:melo|lo)?|mand(?:a|ame)lo|m[aá]ndamelo|ok dale|dale|listo|hazlo|continua|contin[uú]a|procede|adelante)/.test(n)) return 'close';
  if (/(precio|costo|cuanto cuesta|planes|mensualidad)/.test(n)) return 'pricing';
  if (/(compar|vs\b|versus|agenda.?pro|dentidesk|doctoralia|software que uso|otro programa)/.test(n)) return 'competition';
  if (/(demo|demostracion|ver el sistema|prueba)/.test(n)) return 'demo';
  if (/(funcion|modulo|incluye|que hace|puede hacer|whatsapp|inventario|factur|laboratorio|agenda|expediente|odontograma)/.test(n)) return 'features';
  if (/(caro|mucho dinero|no quiero cambiar|miedo|dificil|complicado|ya tengo|no me convence)/.test(n)) return 'objection';
  return 'conversation';
}

function inferSignals(text) {
  const n = norm(text);
  const patch = {};
  const pain = [];
  const interests = [];
  const objections = [];

  if (/(cancel|no llegan|no asisten|confirm)/.test(n)) pain.push('cancelaciones/confirmaciones');
  if (/(dos sucursales|2 sucursales|varias sucursales|multi.?sucursal)/.test(n)) pain.push('multi-sucursal');
  if (/(productividad|produce cada doctor|rendimiento|reportes|metricas|graficas)/.test(n)) pain.push('productividad/reportes');
  if (/(inventario|stock|insumos)/.test(n)) pain.push('inventario');
  if (/(factur|cfdi)/.test(n)) interests.push('facturación CFDI');
  if (/(whatsapp|recordatorio|confirmacion)/.test(n)) interests.push('WhatsApp automático');
  if (/(\bia\b|inteligencia artificial|messenger|facebook)/.test(n)) interests.push('IA');
  if (/(\bagenda\b|\bcitas?\b)/.test(n)) interests.push('agenda');
  if (/(expediente|odontograma)/.test(n)) interests.push('expediente/odontograma');
  if (/(caro|precio alto|mucho dinero)/.test(n)) objections.push('precio');
  if (/(no quiero cambiar|migrar|cambiar de sistema)/.test(n)) objections.push('cambio de sistema');
  if (/(miedo.*datos|perder.*datos)/.test(n)) objections.push('migración de datos');

  if (pain.length) patch.pain_points = pain;
  if (interests.length) patch.interested_features = interests;
  if (objections.length) patch.objections = objections;

  const branches = extractBranches(text);
  if (branches) patch.branches = branches;
  const phone = extractPhone(text);
  if (phone) patch.phone = phone;
  const email = extractEmail(text);
  if (email) patch.email = email;

  const raw = String(text || '').trim();
  const nameMatch = raw.match(/(?:me llamo|mi nombre es|soy)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ .'-]{1,60})/i);
  if (nameMatch?.[1]) patch.name = nameMatch[1].trim().replace(/[,.].*$/, '').trim();
  const clinicMatch = raw.match(/(?:mi (?:clinica|clínica|consultorio) (?:se llama|es)|(?:clinica|clínica|consultorio):?)\s+([A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ .&'-]{2,80})/i);
  if (clinicMatch?.[1]) patch.clinic_name = clinicMatch[1].trim().split(/\s+y\s+mi\s+(?:correo|email|telefono|teléfono|whatsapp|nombre)\b/i)[0].replace(/[,.].*$/, '').trim();

  const software = String(text || '').match(/(?:uso|utilizo|trabajo con)\s+([A-Za-z0-9 ._-]{2,40})/i)?.[1]?.trim();
  if (software && software.length <= 40) patch.current_software = software;

  // Intención alta solo cuando el prospecto expresa una acción real de cierre.
  // "Me interesa el inventario" o "me interesa saber más" es interés comercial,
  // pero no debe disparar el registro antes de responder sus dudas.
  if (/(quiero probar|quiero registr|me registro|contratar|crear cuenta|lo quiero|me interesa mucho|adelante|procede|hazlo|mandamelo|mándamelo|enviamelo|envíamelo)/.test(n)) patch.buying_intent = 'high';
  else if (/(me interesa|precio|demo|compar|planes)/.test(n)) patch.buying_intent = 'medium';

  return patch;
}

function interpret(text) {
  return {
    text: String(text || '').trim(),
    normalized: norm(text),
    intent: inferIntent(text),
    profile_patch: inferSignals(text)
  };
}

module.exports = { interpret, norm, extractEmail, extractPhone, extractBranches };

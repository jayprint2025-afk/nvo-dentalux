'use strict';

const {
  COMMAND_TYPES: C,
  GOAL_TYPES: G,
  emptyTurn,
} = require('./command-schema');

function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[¿?¡!.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const push = (turn, command) => turn.commands.push(command);

function branch(text) {
  const n = normalize(text);
  if (/\b(victoria|sucursal\s*1|sucursal_1|la primera)\b/.test(n)) return 'sucursal_1';
  if (/\b(condesa|sucursal\s*2|sucursal_2|la segunda)\b/.test(n)) return 'sucursal_2';
  return null;
}

function phone(text) {
  const candidates = String(text || '').match(/(?:\+?\d[\d\s().-]{8,}\d)/g) || [];
  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 15) return digits;
  }
  return null;
}

function cleanPatient(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\b(no para|en vez de|mejor que sea)\b.*$/i, '')
    .trim();
}

function patient(text) {
  const raw = String(text || '').trim();
  const patterns = [
    /\b(?:la cita|la consulta|la reservacion)\s+(?:realmente\s+)?(?:es|seria|sera)\s+para\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{2,80}?)(?=\s+(?:y|con|mi telefono|telefono|celular|no para|en vez de)\b|[.,;]|$)/i,
    /\b(?:realmente\s+)?(?:es|seria|sera)\s+para\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{2,80}?)(?=\s+(?:y|con|mi telefono|telefono|celular|no para|en vez de)\b|[.,;]|$)/i,
    /\b(?:a nombre de|ponla a nombre de|cambiala a nombre de|cambialo a nombre de|para mi hija|para mi hijo|para)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{2,80}?)(?=\s+(?:y|con|mi telefono|telefono|celular|no para|en vez de)\b|[.,;]|$)/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) {
      const value = cleanPatient(match[1]);
      if (value.length >= 2) return value;
    }
  }
  return null;
}

function service(text) {
  const n = normalize(text);

  if (/\b(brackets?|ortodoncia|frenos)\b/.test(n) && /\b(consulta|valoracion|revision|revisar|checar|diagnostico)\b/.test(n)) {
    return { reference: 'consulta', clinical_reason: 'revisión de brackets' };
  }

  const synonyms = [
    ['consulta', /\b(consulta|valoracion|valoracion dental|revision|revisar|checar|diagnostico)\b/],
    ['limpieza', /\b(limpieza|profilaxis|sarro)\b/],
    ['resina', /\b(resina|relleno|empaste)\b/],
    ['extraccion', /\b(extraccion|sacar una muela|sacar el diente)\b/],
    ['endodoncia', /\b(endodoncia|conducto|tratamiento de conducto)\b/],
    ['corona', /\b(corona|funda dental)\b/],
    ['blanqueamiento', /\b(blanqueamiento|aclaramiento)\b/],
    ['ortodoncia', /\b(brackets?|ortodoncia|frenos)\b/],
    ['implante', /\b(implante)\b/],
    ['protesis', /\b(protesis|dentadura)\b/],
    ['selladores', /\b(selladores?)\b/],
    ['fluor', /\b(fluor)\b/],
  ];

  for (const [reference, pattern] of synonyms) {
    if (pattern.test(n)) return { reference, clinical_reason: null };
  }
  return null;
}

function topics(text) {
  const n = normalize(text);
  const output = [];
  const add = topic => {
    if (!output.includes(topic)) output.push(topic);
  };

  if (/\b(precio|precios|costo|costos|cuanto cuesta|cuanto sale|valor)\b/.test(n)) add('price');
  if (/\b(donde|direccion|ubicacion|ubican|hubican|como llegar|mapa)\b/.test(n)) add('location');
  if (/\b(horario|horarios|abren|cierran|atienden)\b/.test(n)) add('business_hours');
  if (/\b(promocion|promociones|oferta|ofertas|descuento|descuentos)\b/.test(n)) add('promotion');
  if (/\b(tarjeta|efectivo|transferencia|formas de pago|metodos de pago|pagar)\b/.test(n)) add('payment_methods');
  if (/\b(seguro|aseguranza|insurance)\b/.test(n)) add('insurance');
  if (/\b(cuanto dura|duracion|tiempo tarda|cuanto tiempo)\b/.test(n)) add('duration');
  if (/\b(estacionamiento|parking|donde estacionar)\b/.test(n)) add('parking');
  if (/\b(telefono|whatsapp|contacto|numero)\b/.test(n) && !phone(text)) add('contact');
  if (/\b(que servicios|tratamientos manejan|que hacen|servicios tienen)\b/.test(n)) add('services');
  if (/\b(preparacion|como me preparo|que debo hacer antes)\b/.test(n)) add('preparation');
  if (/\b(politica|cancelacion|cancelar cita|tolerancia|retardo)\b/.test(n)) add('policies');
  if (/\b(especialista|especialistas|ortodoncista|endodoncista)\b/.test(n)) add('specialists');

  return output;
}

function isBookingRequest(n) {
  return /\b(agendar|agendarme|agendame|ajendar|ajendarme|ajendame|reservar|reservame|hacer una cita|sacar una cita|quiero una cita|quiero cita|necesito una cita|necesito cita|disponibilidad|apartame|apartar una cita|programar una cita)\b/.test(n);
}

function fallbackInterpret(text, state = {}) {
  const n = normalize(text);
  const turn = emptyTurn();
  turn.confidence = 0.72;

  if (/^(cancelar|cancela|cancelalo|cancelala|olvidalo|ya no quiero|mejor no|deten|detener|salir)$/.test(n)) {
    push(turn, { type: C.CANCEL_ALL, confidence: 0.99 });
    turn.conversation_act = 'cancel';
    return turn;
  }

  if (/\b(hablar con una persona|hablar con alguien|humano|asesor|operador|recepcionista real)\b/.test(n)) {
    push(turn, { type: C.HANDOFF, goal: G.HUMAN, confidence: 0.98 });
  }

  if (/\b(dificultad para respirar|no puedo respirar|sangrado abundante|hinchazon severa|traumatismo|golpe fuerte|dolor insoportable|me duele demasiado)\b/.test(n)) {
    push(turn, { type: C.MEDICAL_ALERT, reason: text, confidence: 0.96 });
    turn.sentiment = 'urgent';
  }

  if (/\b(ya me dijiste|me estas repitiendo|otra vez lo mismo|no me entiendes|no estas entendiendo|ya te dije)\b/.test(n)) {
    push(turn, { type: C.FRUSTRATION, reason: text, confidence: 0.95 });
    turn.sentiment = 'frustrated';
  }

  if (/^(hola|holis|buenos dias|buenas tardes|buenas noches|hey|que tal)$/.test(n)) {
    push(turn, { type: C.GREETING, confidence: 0.98 });
    turn.conversation_act = 'greeting';
  }

  if (/^(gracias|muchas gracias|perfecto gracias|ok gracias|te agradezco)$/.test(n)) {
    push(turn, { type: C.GRATITUDE, confidence: 0.98 });
    turn.conversation_act = 'gratitude';
  }

  const informationTopics = topics(text);
  if (informationTopics.length) {
    push(turn, { type: C.START_GOAL, goal: G.INFORMATION });
    informationTopics.forEach(topic => push(turn, { type: C.REQUEST_INFO, topic }));
  }

  const booking = isBookingRequest(n);
  if (booking) push(turn, { type: C.START_GOAL, goal: G.BOOKING });

  const selectedBranch = branch(text);
  if (selectedBranch) {
    push(turn, { type: C.SET_SLOT, slot: 'branch', value: selectedBranch, confidence: 0.99 });
  }

  const selectedService = service(text);
  if (selectedService) {
    push(turn, {
      type: C.SET_SLOT,
      slot: 'service',
      value: { reference: selectedService.reference },
      confidence: 0.86,
    });
    if (selectedService.clinical_reason) {
      push(turn, {
        type: C.SET_SLOT,
        slot: 'clinical_reason',
        value: selectedService.clinical_reason,
        confidence: 0.94,
      });
    }
  }

  const selectedPhone = phone(text);
  if (selectedPhone) {
    push(turn, { type: C.SET_SLOT, slot: 'phone', value: selectedPhone, confidence: 0.99 });
  }

  const selectedPatient = patient(text);
  if (selectedPatient) {
    push(turn, { type: C.SET_SLOT, slot: 'patient', value: selectedPatient, confidence: 0.98 });
  }

  const affirmative = /^(si|sí|claro|correcto|confirmo|confirmar|esta bien|ok|okay|de acuerdo|por favor|adelante|hazlo)$/.test(n)
    || /\b(agendame a esa hora|ajendame a esa hora|esa hora esta bien|confirmo esa hora|confirma la cita|si confirma|si confirmo|todo esta correcto|los datos estan correctos)\b/.test(n);

  const negative = /^(no|no gracias|esa no|ese no|ninguno)$/.test(n)
    || /\b(otro horario|otra hora|mas tarde|mas temprano|no me funciona|no puedo a esa hora|cambiala de hora)\b/.test(n);

  if (affirmative) {
    push(turn, { type: C.CONFIRM, reference: 'last_system_question' });
  } else if (negative) {
    push(turn, { type: C.REJECT, reference: 'last_system_question' });
    if (/\b(otro horario|otra hora|mas tarde|mas temprano|no me funciona|no puedo a esa hora)\b/.test(n)) {
      push(turn, {
        type: C.ASK_ALTERNATIVE,
        reference: /\btemprano\b/.test(n) ? 'earlier' : 'later',
      });
    }
  }

  if (!turn.conversation_act || turn.conversation_act === 'unknown') {
    turn.conversation_act = informationTopics.length && booking
      ? 'multiple_request'
      : informationTopics.length
        ? 'information_request'
        : booking
          ? 'booking_request'
          : turn.commands.length
            ? 'update'
            : 'unknown';
  }

  return turn;
}

module.exports = {
  fallbackInterpret,
  normalize,
  branch,
  phone,
  patient,
  service,
  topics,
};

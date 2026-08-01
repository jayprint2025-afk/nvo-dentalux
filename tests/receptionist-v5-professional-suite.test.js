'use strict';

const assert = require('assert');
const Module = require('module');

let createdCount = 0;
let slotTakenOnce = false;
let technicalFailure = false;

const services = [
  { id: '9', name: 'Primera consulta', duration_hours: 1 },
  { id: '2', name: 'Ortodoncia / brackets', duration_hours: 1 },
  { id: '3', name: 'Limpieza dental', duration_hours: 1 },
  { id: '4', name: 'Resina', duration_hours: 1 },
];

const slots = [
  { date: '2026-08-03', start_time: '09:00' },
  { date: '2026-08-03', start_time: '10:00' },
  { date: '2026-08-03', start_time: '11:00' },
  { date: '2026-08-03', start_time: '12:00' },
  { date: '2026-08-03', start_time: '13:00' },
  { date: '2026-08-03', start_time: '15:00' },
];

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === '../booking-engine') {
    return {
      getServices: async () => services,
      computeAvailability: async () => ({ slots }),
      createAppointmentTransactional: async (_q, payload) => {
        if (technicalFailure) throw new Error('database unavailable');
        if (slotTakenOnce) {
          slotTakenOnce = false;
          throw new Error('El horario ya fue tomado');
        }
        createdCount += 1;
        return {
          id: 100 + createdCount,
          patient: payload.patient,
          date: payload.slot.date,
          start_time: payload.slot.start_time,
        };
      },
    };
  }
  return originalLoad.apply(this, arguments);
};

process.env.RECEPTIONIST_V5_USE_AI = 'false';
process.env.CLINIC_TIMEZONE = 'America/Phoenix';

const { orchestrate } = require('../backend/modules/receptionist-v5');
const selector = require('../backend/modules/receptionist-selector');
const fallback = require('../backend/modules/receptionist-v5/fallback-interpreter');
const { parseRelativeDate, parseTimePreference } = require('../backend/modules/receptionist-v5/turn-interpreter');

const tenant = '0ec944b7-2385-4a0e-aec6-ba20d76ddcf7';
const ctx = { tenant_id: tenant, clinic_id: tenant, phone: '5202713253' };

async function q(sql, params = []) {
  if (/FROM branches/i.test(sql)) {
    assert.equal(params[0], tenant, 'branches debe filtrar por tenant');
    return { rows: [
      { branch_key: 'sucursal_1', name: 'Victoria', address: 'Anillo Periférico 424 A', business_hours: 'L-V 9 a 6', payment_methods: 'Efectivo y tarjeta', parking_info: 'Estacionamiento al frente' },
      { branch_key: 'sucursal_2', name: 'Condesa', address: 'Calle Babel #1300, Residencial Condesa', business_hours: 'L-V 9 a 6', payment_methods: 'Efectivo, tarjeta y transferencia', parking_info: null },
    ] };
  }
  if (/information_schema\.columns/i.test(sql)) return { rows: [{ column_name: 'price' }] };
  if (/SELECT price AS price/i.test(sql)) return { rows: [{ price: 200 }] };
  if (/branch_promotions/i.test(sql)) {
    assert.equal(params[0], tenant, 'promotions debe filtrar por tenant');
    if (params[1] === 'sucursal_2') return { rows: [{ title: 'Valoración de ortodoncia', description: 'Pregunta por disponibilidad' }] };
    return { rows: [] };
  }
  return { rows: [] };
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`✅ ${name}`);
}

function command(turn, type, slotOrTopic, value) {
  return turn.commands.find(c => c.type === type && (c.slot === slotOrTopic || c.topic === slotOrTopic) && (value === undefined || JSON.stringify(c.value) === JSON.stringify(value)));
}

(async () => {
  // Selector V5 only.
  await test('selector siempre devuelve v5', async () => assert.equal(selector.selectedVersion(ctx), 'v5'));

  // Greetings and courtesy.
  for (const text of ['Hola', 'Holis', 'Buenos días', 'Buenas tardes', 'Buenas noches', 'Qué tal']) {
    await test(`saludo: ${text}`, async () => assert.ok(command(fallback.fallbackInterpret(text), 'greeting')));
  }
  for (const text of ['Gracias', 'Muchas gracias', 'Ok gracias']) {
    await test(`gratitud: ${text}`, async () => assert.ok(command(fallback.fallbackInterpret(text), 'gratitude')));
  }

  // Branches, services, phones and names.
  await test('detecta Victoria', async () => assert.equal(fallback.branch('la de Victoria'), 'sucursal_1'));
  await test('detecta Condesa', async () => assert.equal(fallback.branch('sucursal Condesa'), 'sucursal_2'));
  await test('detecta sucursal 2', async () => assert.equal(fallback.branch('la sucursal 2'), 'sucursal_2'));
  await test('teléfono USA', async () => assert.equal(fallback.phone('(520) 271-3253'), '5202713253'));
  await test('teléfono México', async () => assert.equal(fallback.phone('+52 686 311 2623'), '526863112623'));
  await test('nombre con acentos', async () => assert.equal(fallback.patient('La cita es para Hannah Sofía y mi teléfono es 5202713253'), 'Hannah Sofía'));
  await test('corrección de nombre', async () => assert.equal(fallback.patient('La cita realmente es para Hannah Sofía, no para Jonathan.'), 'Hannah Sofía'));
  await test('nombre a nombre de', async () => assert.equal(fallback.patient('Ponla a nombre de María José.'), 'María José'));
  await test('brackets se mapea a consulta', async () => assert.equal(fallback.service('quiero una revisión de brackets').reference, 'consulta'));
  await test('limpieza por sinónimo', async () => assert.equal(fallback.service('quiero quitarme el sarro').reference, 'limpieza'));
  await test('resina por empaste', async () => assert.equal(fallback.service('necesito un empaste').reference, 'resina'));

  // Information topics.
  const topicCases = {
    price: 'cuánto cuesta', location: 'dónde se ubican', business_hours: 'qué horarios tienen',
    promotion: 'hay promociones', payment_methods: 'aceptan tarjeta', insurance: 'aceptan aseguranza',
    duration: 'cuánto dura', parking: 'tienen estacionamiento', contact: 'cuál es su teléfono',
    services: 'qué servicios tienen', preparation: 'cómo me preparo', policies: 'política de cancelación',
    specialists: 'tienen ortodoncista',
  };
  for (const [topic, text] of Object.entries(topicCases)) {
    await test(`tema informativo ${topic}`, async () => assert.ok(fallback.topics(text).includes(topic)));
  }

  // Booking variants and typo tolerance.
  for (const text of ['quiero agendar', 'agéndame', 'ajéndame', 'quiero una cita', 'necesito cita', 'apártame una cita', 'quiero disponibilidad']) {
    await test(`intención de cita: ${text}`, async () => assert.ok(command(fallback.fallbackInterpret(text), 'start_goal')));
  }

  // Dates and times.
  const fixed = new Date('2026-08-01T06:00:00Z');
  await test('fecha hoy', async () => assert.equal(parseRelativeDate('hoy', 'America/Phoenix', fixed), '2026-07-31'));
  await test('fecha mañana', async () => assert.equal(parseRelativeDate('mañana', 'America/Phoenix', fixed), '2026-08-01'));
  await test('fecha pasado mañana', async () => assert.equal(parseRelativeDate('pasado mañana', 'America/Phoenix', fixed), '2026-08-02'));
  await test('próximo lunes', async () => assert.equal(parseRelativeDate('el lunes', 'America/Phoenix', fixed), '2026-08-03'));
  await test('fecha ISO', async () => assert.equal(parseRelativeDate('2026-08-15', 'America/Phoenix', fixed), '2026-08-15'));
  await test('fecha dd/mm', async () => assert.equal(parseRelativeDate('15/08/2026', 'America/Phoenix', fixed), '2026-08-15'));
  await test('hora exacta 11', async () => assert.equal(parseTimePreference('a las 11').value, '11:00'));
  await test('hora 5 de la tarde', async () => assert.equal(parseTimePreference('a las 5 de la tarde').value, '17:00'));
  await test('hora 11 y media', async () => assert.equal(parseTimePreference('a las 11 y media').value, '11:30'));
  await test('después de las 11', async () => assert.equal(parseTimePreference('después de las 11').kind, 'after'));
  await test('antes de las 4', async () => assert.equal(parseTimePreference('antes de las 4').kind, 'before'));
  await test('por la mañana', async () => assert.equal(parseTimePreference('por la mañana').kind, 'range'));
  await test('por la tarde', async () => assert.equal(parseTimePreference('por la tarde').min, 720));

  // Safety, handoff, frustration and cancellation.
  await test('alerta médica', async () => assert.ok(command(fallback.fallbackInterpret('Tengo dificultad para respirar'), 'medical_alert')));
  await test('handoff humano', async () => assert.ok(command(fallback.fallbackInterpret('Quiero hablar con una persona'), 'handoff')));
  await test('frustración', async () => assert.ok(command(fallback.fallbackInterpret('Ya me dijiste eso'), 'frustration')));
  await test('cancelar todo', async () => assert.ok(command(fallback.fallbackInterpret('Cancelar'), 'cancel_all')));
  await test('confirmación natural', async () => assert.ok(command(fallback.fallbackInterpret('Sí, confirma la cita'), 'confirm')));
  await test('rechazo horario', async () => assert.ok(command(fallback.fallbackInterpret('Ese horario no me funciona, dame otro más tarde'), 'reject')));

  // Full information response.
  let state = {};
  let out = await orchestrate(q, ctx, state, 'Quiero saber dónde está Condesa, cuánto cuesta una consulta y si tienen promoción porque quiero revisarme los brackets.');
  await test('respuesta múltiple de información', async () => {
    assert.equal(out.used, 'answer_information');
    assert.match(out.reply, /Calle Babel/i);
    assert.match(out.reply, /\$200/);
    assert.match(out.reply, /Valoración de ortodoncia/i);
    assert.equal(out.state.slots.branch.value, 'sucursal_2');
    assert.equal(out.state.slots.service.value.id, '9');
  });
  state = out.state;

  // Booking keeps context and date/time.
  out = await orchestrate(q, ctx, state, 'Sí, agéndame ahí para el lunes después de las 11.');
  await test('agenda sin repetir día', async () => {
    assert.notEqual(out.used, 'ask_slot');
    assert.equal(out.state.slots.date.value, '2026-08-03');
    assert.equal(out.state.slots.time_preference.value.kind, 'after');
    assert.equal(out.state.last_offer.slot.start_time, '11:00');
  });
  state = out.state;

  out = await orchestrate(q, ctx, state, 'Ese horario no me funciona, dame otro más tarde.');
  await test('alternativa posterior', async () => assert.equal(out.state.last_offer.slot.start_time, '12:00'));
  state = out.state;

  out = await orchestrate(q, ctx, state, 'Sí');
  await test('acepta horario ofrecido', async () => assert.equal(out.state.slots.selected_slot.value.start_time, '12:00'));
  state = out.state;

  out = await orchestrate(q, ctx, state, 'La cita realmente es para Hannah Sofía, no para Jonathan, y mi teléfono es 5202713253.');
  await test('captura nombre y teléfono sin perder contexto', async () => {
    assert.equal(out.state.slots.patient.value, 'Hannah Sofía');
    assert.equal(out.state.slots.phone.value, '5202713253');
    assert.equal(out.state.slots.branch.value, 'sucursal_2');
    assert.equal(out.used, 'request_booking_confirmation');
  });
  state = out.state;

  const beforeCreate = createdCount;
  out = await orchestrate(q, ctx, state, 'Sí, confirma la cita.');
  await test('crea exactamente una cita', async () => {
    assert.equal(out.used, 'appointment_booked');
    assert.equal(createdCount, beforeCreate + 1);
    assert.ok(out.state.appointment_id);
  });
  state = out.state;

  out = await orchestrate(q, ctx, state, 'Sí');
  await test('confirmación repetida no duplica cita', async () => assert.equal(createdCount, beforeCreate + 1));

  // Greeting and gratitude responses.
  out = await orchestrate(q, ctx, {}, 'Holis');
  await test('saludo profesional', async () => { assert.equal(out.used, 'greeting'); assert.match(out.reply, /asistente virtual/i); });
  out = await orchestrate(q, ctx, {}, 'Muchas gracias');
  await test('respuesta de cortesía', async () => assert.equal(out.used, 'gratitude'));

  // Safety response.
  out = await orchestrate(q, ctx, {}, 'Tengo dificultad para respirar');
  await test('respuesta segura sin diagnóstico', async () => { assert.equal(out.used, 'medical_safety'); assert.match(out.reply, /atención urgente/i); });

  // Human handoff.
  out = await orchestrate(q, ctx, {}, 'Quiero hablar con una persona');
  await test('respuesta de escalamiento humano', async () => assert.equal(out.used, 'handoff'));

  // Cancel resets booking but preserves known phone.
  let cancelState = (await orchestrate(q, ctx, {}, 'Agéndame consulta en Condesa el lunes a las 12')).state;
  out = await orchestrate(q, ctx, cancelState, 'Cancelar');
  await test('cancelación limpia proceso', async () => {
    assert.equal(out.used, 'cancel_all');
    assert.equal(out.state.active_goals.length, 0);
    assert.equal(out.state.slots.phone.value, '5202713253');
  });

  // Exact time unavailable offers nearest alternative.
  out = await orchestrate(q, ctx, {}, 'Agéndame una consulta en Condesa el lunes a las 14:00');
  await test('hora exacta no disponible ofrece alternativa', async () => {
    assert.equal(out.used, 'check_availability');
    assert.match(out.reply, /No está disponible exactamente/i);
    assert.equal(out.state.last_offer.slot.start_time, '15:00');
  });

  // Slot taken recovery.
  let recovery = {};
  recovery = (await orchestrate(q, ctx, recovery, 'Agéndame una consulta en Condesa el lunes a las 12')).state;
  recovery = (await orchestrate(q, ctx, recovery, 'Sí')).state;
  recovery = (await orchestrate(q, ctx, recovery, 'La cita es para Ana López y mi teléfono es 5202713253')).state;
  slotTakenOnce = true;
  out = await orchestrate(q, ctx, recovery, 'Sí, confirma la cita');
  await test('horario tomado ofrece otro sin perder datos', async () => {
    assert.equal(out.used, 'check_availability');
    assert.ok(out.state.last_offer?.slot);
    assert.equal(out.state.slots.patient.value, 'Ana López');
  });

  // Technical failure never claims booking.
  let failure = {};
  failure = (await orchestrate(q, ctx, failure, 'Agéndame una consulta en Condesa el lunes a las 12')).state;
  failure = (await orchestrate(q, ctx, failure, 'Sí')).state;
  failure = (await orchestrate(q, ctx, failure, 'La cita es para Luis Pérez y mi teléfono es 5202713253')).state;
  technicalFailure = true;
  out = await orchestrate(q, ctx, failure, 'Sí, confirma la cita');
  technicalFailure = false;
  await test('error técnico no confirma cita falsa', async () => {
    assert.equal(out.used, 'technical_error');
    assert.doesNotMatch(out.reply, /quedó registrada/i);
  });

  // Contract checks on representative inputs.
  for (const text of ['Hola', 'Quiero precio de limpieza', 'Agéndame en Victoria mañana', 'Cancelar', 'Gracias']) {
    out = await orchestrate(q, ctx, {}, text);
    await test(`contrato válido: ${text}`, async () => {
      assert.equal(out.engine_version, 'v5');
      assert.equal(typeof out.reply, 'string');
      assert.ok(out.reply.length > 0);
      assert.equal(out.state.version, 'v5');
    });
  }

  console.log(`\n${passed}/${passed} pruebas profesionales V5 pasaron.`);
})().catch(error => {
  console.error('\n❌ Suite profesional V5 falló');
  console.error(error);
  process.exit(1);
});

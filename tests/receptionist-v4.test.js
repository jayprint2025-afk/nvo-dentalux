'use strict';
const assert = require('assert');
const U = require('../backend/modules/receptionist-v4/utils');
const { fallbackExtract } = require('../backend/modules/receptionist-v4/intent-extractor');
const State = require('../backend/modules/receptionist-v4/state-manager');
const Tools = require('../backend/modules/receptionist-v4/tools');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('fecha lunes', () => assert.match(U.parseDate('el lunes'), /^\d{4}-\d{2}-\d{2}$/));
test('fecha mañana', () => assert.match(U.parseDate('mañana'), /^\d{4}-\d{2}-\d{2}$/));
test('hora 11 am', () => assert.equal(U.parseTime('a las 11 am').value, '11:00'));
test('hora 5 tarde', () => assert.equal(U.parseTime('a las 5 de la tarde').value, '17:00'));
test('rango mañana', () => assert.equal(U.parseTime('por la mañana').kind, 'range'));
test('teléfono México', () => assert.equal(U.normalizePhone('+52 686 311 2623'), '6863112623'));
test('teléfono USA', () => assert.equal(U.normalizePhone('+1 520 271 3253'), '5202713253'));
test('sucursal Condesa', () => assert.equal(U.branchFromText('mejor en Condesa'), 'sucursal_2'));
test('afirmativo natural', () => assert.equal(U.affirmative('sí agéndala'), true));
test('negativo otra hora', () => assert.equal(U.negative('prefiero otra hora'), true));

test('precio + booking coexistente', () => {
  const x = fallbackExtract('Quiero consulta el lunes a las 11, ¿cuánto cuesta?', {});
  assert.equal(x.primary_intent, 'information');
  assert.equal(x.booking_intent, true);
  assert.equal(x.information_requests[0].type, 'price');
  assert.equal(x.updates.service_text, 'consulta');
  assert.ok(x.updates.date);
  assert.equal(x.updates.preferred_time.value, '11:00');
});

test('mensaje completo extrae todo', () => {
  const x = fallbackExtract('Quiero limpieza en Condesa el martes a las 4 pm, soy Ana, 6863112623', {});
  assert.equal(x.updates.branch_key, 'sucursal_2');
  assert.equal(x.updates.service_text, 'limpieza');
  assert.ok(x.updates.date);
  assert.equal(x.updates.preferred_time.value, '16:00');
  assert.equal(x.updates.phone, '6863112623');
});

test('handoff', () => assert.equal(fallbackExtract('quiero hablar con una persona', {}).needs_human, true));
test('restart', () => assert.equal(fallbackExtract('empezar de nuevo', {}).primary_intent, 'restart'));
test('cancel flow', () => assert.equal(fallbackExtract('ya no quiero cita', {}).primary_intent, 'cancel_flow'));

test('missing branch', () => assert.equal(State.missingField(State.initialState({active:true})), 'branch'));
test('missing service', () => assert.equal(State.missingField(State.initialState({active:true,branch_key:'sucursal_1'})), 'service'));
test('missing date', () => assert.equal(State.missingField(State.initialState({active:true,branch_key:'sucursal_1',service_id:'1'})), 'date'));
test('missing phone after slot', () => assert.equal(State.missingField(State.initialState({
  active:true,branch_key:'sucursal_1',service_id:'1',date:'2026-08-03',
  selected_slot:{date:'2026-08-03',start_time:'11:00'}
})), 'phone'));
test('missing final', () => assert.equal(State.missingField(State.initialState({
  active:true,branch_key:'sucursal_1',service_id:'1',date:'2026-08-03',
  selected_slot:{date:'2026-08-03',start_time:'11:00'},phone:'6863112623',patient:'Ana'
})), 'final_confirmation'));

test('branch change clears downstream', () => {
  const s = State.initialState({active:true,branch_key:'sucursal_1',service_id:'1',date:'2026-08-03',selected_slot:{start_time:'11:00'}});
  State.applyUpdates(s,{branch_key:'sucursal_2'});
  assert.equal(s.service_id,null); assert.equal(s.date,null); assert.equal(s.selected_slot,null);
});

test('date change clears slot', () => {
  const s = State.initialState({active:true,branch_key:'sucursal_1',service_id:'1',date:'2026-08-03',selected_slot:{start_time:'11:00'}});
  State.applyUpdates(s,{date:'2026-08-04'});
  assert.equal(s.selected_slot,null);
});

test('match service', () => {
  const s = Tools.matchService([{id:1,name:'Primera Consulta'},{id:2,name:'Limpieza Dental'}], 'consulta');
  assert.equal(s.id,1);
});

test('progress loop count', () => {
  const s = State.initialState({active:true,branch_key:'sucursal_1'});
  State.trackProgress(s,'hola','pregunta');
  State.trackProgress(s,'hola','pregunta');
  assert.ok(s.no_progress_count >= 1);
});

test('complete resets active state', () => {
  const s = State.initialState({active:true,branch_key:'sucursal_1',phone:'6863112623',service_name:'Consulta',selected_slot:{date:'2026-08-03',start_time:'11:00'}});
  const done = State.complete(s,99);
  assert.equal(done.active,false); assert.equal(done.appointment_id,99);
});

(async () => {
  let passed=0;
  for (const [name,fn] of tests) {
    try { await fn(); passed++; console.log(`✅ ${name}`); }
    catch(e) { console.error(`❌ ${name}: ${e.message}`); process.exitCode=1; }
  }
  console.log(`\n${passed}/${tests.length} pruebas pasaron.`);
})();

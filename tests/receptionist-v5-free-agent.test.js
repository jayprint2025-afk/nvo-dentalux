'use strict';
const assert=require('assert');
const Agent=require('../backend/modules/receptionist-v5/free-conversation-agent');
const Memory=require('../backend/modules/receptionist-v5/conversation-memory');
const Appointment=require('../backend/modules/receptionist-v5/appointment-tools');

let passed=0;
function test(name,fn){Promise.resolve().then(fn).then(()=>{passed++;console.log('✅',name)}).catch(e=>{console.error('❌',name,e);process.exitCode=1});}

const yes=['sí, confirma la cita','si confirmala','agenda esa cita','todo correcto, confirma','adelante agenda'];
const no=['ok','creo que sí','déjame ver','no','cancelar','todavía no','espera'];
for(const value of yes)test(`confirmación explícita: ${value}`,()=>assert.equal(Agent.explicitConfirmation(value),true));
for(const value of no)test(`bloquea confirmación ambigua: ${value}`,()=>assert.equal(Agent.explicitConfirmation(value),false));

for(let i=0;i<10;i++)test(`memoria conserva dato ${i+1}`,()=>{
 const s=Memory.initialState({collected:{branch_key:'sucursal_2'}});
 Memory.mergeState(s,{collected:{[`field_${i}`]:`value_${i}`}});
 assert.equal(s.collected.branch_key,'sucursal_2');assert.equal(s.collected[`field_${i}`],`value_${i}`);
});

const replies=['Tengo disponible a las 11:00.','La sucursal Condesa está en Babel #1300.','¿Qué día te gustaría?'];
for(const reply of replies)test(`detecta repetición: ${reply}`,()=>{
 const s=Memory.initialState({recent_replies:[reply]});assert.equal(Memory.isRepeatedReply(s,reply),true);
});
for(const reply of replies)test(`permite respuesta diferente: ${reply}`,()=>{
 const s=Memory.initialState({recent_replies:['Otra respuesta']});assert.equal(Memory.isRepeatedReply(s,reply),false);
});

test('booking key estable',()=>{
 const a={branch_key:'sucursal_2',service_id:9,date:'2026-08-03',start_time:'11:00',patient:'Hannah',phone:'5202713253'};
 assert.equal(Appointment.bookingKey(a),Appointment.bookingKey({...a}));
});
test('booking key cambia con horario',()=>{
 const a={branch_key:'sucursal_2',service_id:9,date:'2026-08-03',start_time:'11:00',patient:'Hannah',phone:'5202713253'};
 assert.notEqual(Appointment.bookingKey(a),Appointment.bookingKey({...a,start_time:'12:00'}));
});

for(const action of ['none','check_availability','prepare_confirmation','create_appointment','handoff'])test(`normaliza acción ${action}`,()=>{
 const p=Agent.safePlan({reply:'Hola',state_patch:{},action:{type:action,args:{}}});assert.equal(p.action.type,action);assert.equal(p.reply,'Hola');
});

test('estado inicial V5 libre',()=>assert.equal(Memory.initialState({}).version,'v5-free'));
test('limita historial a 12 turnos',()=>{
 const s=Memory.initialState({});for(let i=0;i<20;i++)Memory.recordTurn(s,`u${i}`,`r${i}`);assert.equal(s.recent_turns.length,12);
});
test('limita respuestas a 6',()=>{
 const s=Memory.initialState({});for(let i=0;i<20;i++)Memory.recordTurn(s,`u${i}`,`r${i}`);assert.equal(s.recent_replies.length,6);
});
test('pending booking se fusiona',()=>{
 const s=Memory.initialState({pending_booking:{date:'2026-08-03'}});Memory.mergeState(s,{pending_booking:{start_time:'11:00'}});assert.equal(s.pending_booking.date,'2026-08-03');assert.equal(s.pending_booking.start_time,'11:00');
});
test('pending booking se limpia',()=>{
 const s=Memory.initialState({pending_booking:{date:'x'}});Memory.mergeState(s,{pending_booking:null});assert.equal(s.pending_booking,null);
});

test('reglas obligan responder pregunta actual',()=>assert(Agent.SYSTEM_RULES.includes('Responde primero')));
test('reglas prohíben inventar',()=>assert(Agent.SYSTEM_RULES.includes('No inventes')));
test('reglas exigen confirmación',()=>assert(Agent.SYSTEM_RULES.includes('confirmación explícita')));
test('reglas prohíben repetición',()=>assert(Agent.SYSTEM_RULES.includes('No repitas')));
test('reglas permiten interrupción',()=>assert(Agent.SYSTEM_RULES.includes('interrupción informativa')));
test('reglas prohíben diagnóstico',()=>assert(Agent.SYSTEM_RULES.includes('No diagnostiques')));


const patches=[
 {collected:{patient:'Hannah'}},
 {collected:{phone:'5202713253'}},
 {collected:{branch_key:'sucursal_2'}},
 {collected:{service_id:9}},
 {collected:{date:'2026-08-03'}},
 {collected:{start_time:'11:00'}},
];
patches.forEach((patch,index)=>test(`aplica parche conversacional ${index+1}`,()=>{
 const s=Memory.initialState({});Memory.mergeState(s,patch);const [k,v]=Object.entries(patch.collected)[0];assert.equal(s.collected[k],v);
}));

test('normaliza plan vacío',()=>{const p=Agent.safePlan(null);assert.equal(p.action.type,'none');assert.equal(p.reply,'');});
test('normaliza espacios en respuesta',()=>{const p=Agent.safePlan({reply:'  Hola  '});assert.equal(p.reply,'Hola');});
test('estado conserva citas completadas',()=>{const s=Memory.initialState({completed_booking_keys:['abc']});assert.deepEqual(s.completed_booking_keys,['abc']);});
test('estado conserva appointment id',()=>{const s=Memory.initialState({appointment_id:77});assert.equal(s.appointment_id,77);});

process.on('beforeExit',()=>{
 if(!process.exitCode){console.log(`\n${passed}/${passed} pruebas del agente libre pasaron.`);if(passed<50){console.error('Se esperaban al menos 50 pruebas');process.exitCode=1;}}
});

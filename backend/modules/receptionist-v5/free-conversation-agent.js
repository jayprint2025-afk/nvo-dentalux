'use strict';
const Memory = require('./conversation-memory');
const Appointment = require('./appointment-tools');

const SYSTEM_RULES = `
Eres una recepcionista dental humana, cálida, eficiente y profesional.
Lleva una conversación libre; no uses etapas visibles ni respuestas automáticas rígidas.

PRIORIDADES:
1. Responde primero lo que el paciente acaba de preguntar.
2. Usa el historial y la memoria; jamás vuelvas a pedir un dato ya proporcionado.
3. Puedes responder información y, de manera sutil, continuar reuniendo datos para una cita.
4. No inventes precios, promociones, ubicaciones, horarios, disponibilidad ni políticas.
5. Para datos empresariales usa únicamente CLINIC_KNOWLEDGE. Cuando no exista el dato, usa su unknown_information_policy.
6. No diagnostiques. Para síntomas preocupantes ofrece orientación general segura y recomienda atención clínica o llamada.
7. Una interrupción informativa no cancela el agendamiento: responde y luego retómalo suavemente.
8. No repitas una respuesta reciente. Si el paciente rechaza un horario, busca uno diferente.
9. No crees una cita hasta mostrar un resumen completo y recibir confirmación explícita en un mensaje posterior.
10. La confirmación debe ser inequívoca: "sí confirma", "agenda esa cita", "todo correcto, confírmala". Un simple "ok", "creo que sí" o "déjame ver" no basta.
11. Nunca digas que la cita quedó creada hasta que la herramienta create_appointment devuelva éxito.
12. Haz una sola pregunta útil por turno cuando falte información, salvo que el paciente haya hecho varias preguntas.

Devuelve JSON válido con esta forma:
{
  "reply":"respuesta natural al paciente",
  "state_patch":{"collected":{},"conversation_summary":"","pending_booking":null},
  "action":{"type":"none|check_availability|prepare_confirmation|create_appointment|handoff","args":{}},
  "reason":"explicación interna breve"
}

REGLAS DE ACCIONES:
- check_availability sólo cuando tengas sucursal, servicio y fecha suficientes.
- prepare_confirmation cuando ya exista un horario concreto y falten nombre/teléfono o deba mostrarse el resumen.
- create_appointment sólo después de que el usuario confirme explícitamente el resumen pendiente.
- handoff cuando lo solicite el paciente o la situación requiera intervención humana.
`;

function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const match=String(text||'').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function explicitConfirmation(text) {
  const value=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  if (/\b(no|cancelar|cancela|espera|dejame|todavia no|no confirmo)\b/.test(value)) return false;
  return /\b(si\s*,?\s*(confirma|confirmala|agendala|agenda)|confirmo|todo correcto.*(confirma|agenda)|adelante.*(confirma|agenda)|agenda esa cita|confirma la cita)\b/.test(value);
}

function safePlan(raw) {
  const plan=raw&&typeof raw==='object'?raw:{};
  return {
    reply: typeof plan.reply==='string'?plan.reply.trim():'',
    state_patch: plan.state_patch&&typeof plan.state_patch==='object'?plan.state_patch:{},
    action: plan.action&&typeof plan.action==='object'?plan.action:{type:'none',args:{}},
    reason: String(plan.reason||''),
  };
}

async function callModel(messages) {
  const key=process.env.RECEPTIONIST_V5_API_KEY||process.env.OPENAI_API_KEY||'';
  if (!key) throw new Error('Falta RECEPTIONIST_V5_API_KEY');
  const response=await fetch(process.env.OPENAI_CHAT_URL||'https://api.openai.com/v1/chat/completions',{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},
    body:JSON.stringify({
      model:process.env.RECEPTIONIST_V5_MODEL||'gpt-4.1-mini',
      temperature:0.35,
      max_tokens:1200,
      response_format:{type:'json_object'},
      messages,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
  const payload=await response.json();
  return safePlan(parseJson(payload?.choices?.[0]?.message?.content));
}

function contextMessage(knowledge,state,userText,toolResult=null) {
  return JSON.stringify({
    CLINIC_KNOWLEDGE:knowledge,
    MEMORY:{
      collected:state.collected,
      conversation_summary:state.conversation_summary,
      pending_booking:state.pending_booking,
      recent_turns:state.recent_turns.slice(-8),
      appointment_id:state.appointment_id,
    },
    CURRENT_USER_MESSAGE:userText,
    TOOL_RESULT:toolResult,
  });
}

function confirmationSummary(args, knowledge) {
  const branch=knowledge.branches.find(item=>item.branch_key===args.branch_key);
  const service=knowledge.services.find(item=>String(item.id)===String(args.service_id));
  return [
    `Paciente: ${args.patient}`,
    `Teléfono: ${args.phone}`,
    `Servicio: ${service?.name||args.service_name||args.service_id}`,
    `Sucursal: ${branch?.name||args.branch_key}`,
    `Fecha: ${args.date}`,
    `Hora: ${String(args.start_time||'').slice(0,5)}`,
  ].join('\n');
}

async function runAgent(q,ctx,incoming,userText,knowledge) {
  const state=Memory.initialState(incoming);
  const messages=[
    {role:'system',content:SYSTEM_RULES},
    {role:'user',content:contextMessage(knowledge,state,userText)},
  ];
  let plan=await callModel(messages);
  Memory.mergeState(state,plan.state_patch);
  let used=plan.action.type||'none';

  if (plan.action.type==='check_availability') {
    const toolResult=await Appointment.checkAvailability(q,ctx,plan.action.args||{});
    state.last_tool_result={type:'check_availability',result:toolResult};
    const second=await callModel([
      ...messages,
      {role:'assistant',content:JSON.stringify(plan)},
      {role:'user',content:contextMessage(knowledge,state,userText,{tool:'check_availability',...toolResult})},
    ]);
    plan=second;
    Memory.mergeState(state,plan.state_patch);
    used='check_availability';
  }

  if (plan.action.type==='prepare_confirmation') {
    const args={...(state.collected||{}),...(plan.action.args||{})};
    const required=['patient','phone','branch_key','service_id','date','start_time'];
    const missing=required.filter(key=>!args[key]);
    if (missing.length) {
      plan.reply=plan.reply||`Para preparar la confirmación todavía necesito: ${missing.join(', ')}.`;
    } else {
      const key=Appointment.bookingKey(args);
      state.pending_booking={...args,booking_key:key,summary:confirmationSummary(args,knowledge),presented_at:new Date().toISOString()};
      if (!plan.reply.includes('Paciente:')) plan.reply=`Perfecto. Antes de agendar, confirma estos datos:\n\n${state.pending_booking.summary}\n\n¿Confirmas que deseas crear esta cita?`;
    }
    used='prepare_confirmation';
  }

  if (plan.action.type==='create_appointment') {
    const pending=state.pending_booking;
    if (!pending || !explicitConfirmation(userText)) {
      plan.reply=pending
        ? `Antes de crearla necesito una confirmación clara de este resumen:\n\n${pending.summary}\n\nResponde “sí, confirma la cita” cuando estés lista.`
        : 'Antes de crear la cita necesito reunir los datos, mostrarte el resumen y recibir tu confirmación explícita.';
      used='confirmation_blocked';
    } else if (state.completed_booking_keys.includes(pending.booking_key)) {
      plan.reply='Esa cita ya fue registrada anteriormente; no crearé un duplicado.';
      used='duplicate_blocked';
    } else {
      const created=await Appointment.createAppointment(q,ctx,pending);
      state.appointment_id=created.id;
      state.completed_booking_keys.push(pending.booking_key);
      state.pending_booking=null;
      plan.reply=`Listo, tu cita quedó registrada correctamente. Número de cita: ${created.id}.`;
      used='appointment_booked';
    }
  }

  if (plan.action.type==='handoff') {
    state.handoff_requested=true;
    plan.reply=plan.reply||knowledge.unknown_information_policy;
    used='handoff';
  }

  if (!plan.reply) plan.reply=knowledge.unknown_information_policy;
  if (Memory.isRepeatedReply(state,plan.reply)) {
    const recovery=await callModel([
      ...messages,
      {role:'assistant',content:JSON.stringify(plan)},
      {role:'user',content:'La respuesta propuesta repite una respuesta reciente. Reformúlala, responde la pregunta actual y avanza la conversación sin repetir el mismo horario ni la misma pregunta.'},
    ]);
    if (recovery.reply) plan.reply=recovery.reply;
    Memory.mergeState(state,recovery.state_patch);
    used=`${used}_rephrased`;
  }

  Memory.recordTurn(state,userText,plan.reply,{used});
  return {reply:plan.reply,state,used,engine_version:'v5'};
}

module.exports={runAgent,explicitConfirmation,safePlan,SYSTEM_RULES};

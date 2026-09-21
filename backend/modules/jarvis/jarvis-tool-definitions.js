'use strict';

const { tools: cliniqOneTools } = require('../f1/tool-definitions');

const personalTools = [
  {
    type: 'function',
    name: 'personal_create_event',
    description: 'Crea una reunión, compromiso o evento PERSONAL/EMPRESARIAL del usuario en la Agenda personal de JARVIS. NO es una cita de paciente. Crea además un recordatorio 10 minutos antes por defecto.',
    parameters: { type:'object', properties:{ title:{type:'string'}, start_at:{type:'string',description:'Fecha/hora local ISO, por ejemplo 2026-09-21T09:00:00'}, end_at:{type:'string'}, location:{type:'string'}, notes:{type:'string'}, category:{type:'string'}, reminder_minutes_before:{type:'number',default:10} }, required:['title','start_at'] }
  },
  {
    type: 'function',
    name: 'personal_create_reminder',
    description: 'Crea SOLO un recordatorio personal. Úsala para pagar, llamar, comprar, hacer una tarea o cualquier “recuérdame…”. NO crea cita clínica ni evento salvo que el usuario lo pida.',
    parameters: { type:'object', properties:{ title:{type:'string'}, remind_at:{type:'string',description:'Fecha/hora local ISO'}, notes:{type:'string'}, priority:{type:'string',enum:['baja','normal','alta']}, insist_after_minutes:{type:'number',default:5} }, required:['title','remind_at'] }
  },
  {
    type: 'function',
    name: 'personal_acknowledge',
    description: 'Marca uno o varios recordatorios/compromisos como enterados para detener la insistencia.',
    parameters: { type:'object', properties:{ reminder_ids:{type:'array',items:{type:['string','number']}}, event_ids:{type:'array',items:{type:['string','number']}} } }
  },
  {
    type: 'function',
    name: 'personal_get_agenda',
    description: 'Consulta la Agenda personal y los recordatorios de JARVIS para una fecha o rango.',
    parameters: { type:'object', properties:{ from:{type:'string'}, to:{type:'string'} } }
  },
];

// JARVIS conserva CliniqOne como sistema/herramienta subordinada, no como agenda por defecto.
const tools = [...personalTools, ...cliniqOneTools];
module.exports = { tools, personalTools };

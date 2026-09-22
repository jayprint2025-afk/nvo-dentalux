'use strict';

const { tools: cliniqOneTools } = require('../f1/tool-definitions');
const { skillTools } = require('./jarvis-skill-tools');

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

  {
    type: 'function',
    name: 'find_whatsapp_contact',
    description: 'Busca PRIMERO un contacto en la libreta propia de WhatsApp de JARVIS. Úsala siempre que el usuario mencione un contacto por nombre antes de pedir un número o consultar CliniqOne. Si no existe, devuelve que se requiere confirmación antes de buscar en sistemas externos.',
    parameters: { type:'object', properties:{ query:{type:'string',description:'Nombre o teléfono del contacto guardado en la tarjeta WhatsApp de JARVIS'} }, required:['query'] }
  },
  {
    type: 'function',
    name: 'send_whatsapp_message',
    description: 'Envía un WhatsApp desde JARVIS. Si el usuario proporciona un nombre de contacto, usa contact_name y JARVIS lo resuelve contra SU libreta de contactos. No pidas el número si el contacto existe. No uses historial de CliniqOne como fuente primaria.',
    parameters: { type:'object', properties:{ contact_name:{type:'string',description:'Nombre del contacto guardado en JARVIS'}, phone:{type:'string',description:'Número solo cuando el usuario lo proporciona explícitamente o no usa un contacto guardado'}, message:{type:'string',description:'Texto exacto que se enviará'} }, required:['message'] }
  },
];

// JARVIS conserva CliniqOne como sistema/herramienta subordinada, no como agenda por defecto.
const personalToolNames = new Set(personalTools.map(tool => tool.name));

// Estas herramientas de CliniqOne NO se exponen a la sesión general de JARVIS
// porque pueden competir con la libreta propia de WhatsApp de JARVIS.
// El historial clínico nunca debe usarse para resolver un contacto personal.
const blockedDelegatedTools = new Set([
  'list_whatsapp_messages',
]);

const delegatedCliniqOneTools = cliniqOneTools.filter(tool =>
  !personalToolNames.has(tool.name) &&
  !blockedDelegatedTools.has(tool.name)
);

const tools = [...personalTools, ...skillTools, ...delegatedCliniqOneTools];
module.exports = { tools, personalTools };

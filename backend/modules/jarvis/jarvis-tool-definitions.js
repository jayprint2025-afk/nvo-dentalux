'use strict';

const { tools: cliniqOneTools } = require('../f1/tool-definitions');

const personalTools = [
  {
    type:'function', name:'personal_create_event',
    description:'Crea una reunión, compromiso o evento PERSONAL/EMPRESARIAL del usuario en la Agenda personal de JARVIS. NO es una cita de paciente.',
    parameters:{type:'object',properties:{title:{type:'string'},start_at:{type:'string'},end_at:{type:'string'},location:{type:'string'},notes:{type:'string'},category:{type:'string'},reminder_minutes_before:{type:'number',default:10}},required:['title','start_at']}
  },
  {
    type:'function', name:'personal_create_reminder',
    description:'Crea SOLO un recordatorio personal de JARVIS.',
    parameters:{type:'object',properties:{title:{type:'string'},remind_at:{type:'string'},notes:{type:'string'},priority:{type:'string',enum:['baja','normal','alta']},insist_after_minutes:{type:'number',default:5}},required:['title','remind_at']}
  },
  {
    type:'function', name:'personal_acknowledge',
    description:'Marca recordatorios o compromisos como enterados.',
    parameters:{type:'object',properties:{reminder_ids:{type:'array',items:{type:['string','number']}},event_ids:{type:'array',items:{type:['string','number']}}}}
  },
  {
    type:'function', name:'personal_get_agenda',
    description:'Consulta Agenda personal y recordatorios de JARVIS para un rango.',
    parameters:{type:'object',properties:{from:{type:'string'},to:{type:'string'}}}
  },
  {
    type:'function', name:'find_whatsapp_contact',
    description:'Busca PRIMERO un contacto en la tarjeta/libreta central de WhatsApp de JARVIS, no en CliniqOne.',
    parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}
  },
  {
    type:'function', name:'send_whatsapp_message',
    description:'Envía un WhatsApp desde el canal central de JARVIS a un teléfono o contacto resuelto en su propia tarjeta.',
    parameters:{type:'object',properties:{phone:{type:'string'},contact_name:{type:'string'},message:{type:'string'}},required:['message']}
  },
  {
    type:'function', name:'jarvis_get_module_report',
    description:'Valida UNA tarjeta central de JARVIS. Úsala para Agenda, Recordatorios, WhatsApp central, Correo, Llamadas o Internet. Nunca sustituye una tarjeta central con datos de CliniqOne.',
    parameters:{type:'object',properties:{module:{type:'string',enum:['agenda','recordatorios','whatsapp','correo','llamadas','internet']},days:{type:'number',default:7},limit:{type:'number',default:250}},required:['module']}
  },
  {
    type:'function', name:'jarvis_get_cards_report',
    description:'Genera el reporte de las tarjetas CENTRALES de JARVIS: Correo, Agenda, Recordatorios, WhatsApp, Llamadas e Internet. Valida cada fuente por separado y marca como no conectado lo que todavía no tenga integración real.',
    parameters:{type:'object',properties:{modules:{type:'array',items:{type:'string',enum:['agenda','recordatorios','whatsapp','correo','llamadas','internet']}},days:{type:'number',default:7},limit:{type:'number',default:250}}}
  }
];

const tools=[...personalTools,...cliniqOneTools];
module.exports={tools,personalTools};

'use strict';

const jarvisTools = [
  {
    type:'function',
    name:'create_personal_event',
    description:'Crea un evento en la agenda personal/empresarial de JARVIS. No usar para citas de pacientes de CliniqOne.',
    parameters:{type:'object',properties:{
      title:{type:'string'},start_at:{type:'string',description:'Fecha/hora ISO local, por ejemplo 2026-09-18T16:00:00'},
      end_at:{type:'string'},location:{type:'string'},notes:{type:'string'},category:{type:'string'}
    },required:['title','start_at']}
  },
  {
    type:'function',
    name:'list_personal_events',
    description:'Lista eventos de la agenda personal/empresarial de JARVIS por rango de fechas.',
    parameters:{type:'object',properties:{from:{type:'string'},to:{type:'string'},limit:{type:'number'}}}
  },
  {
    type:'function',
    name:'update_personal_event',
    description:'Actualiza un evento personal existente de JARVIS.',
    parameters:{type:'object',properties:{
      event_id:{type:'number'},title:{type:'string'},start_at:{type:'string'},end_at:{type:'string'},
      location:{type:'string'},notes:{type:'string'},category:{type:'string'},status:{type:'string'}
    },required:['event_id']}
  },
  {
    type:'function',
    name:'delete_personal_event',
    description:'Elimina un evento personal. Requiere confirmación explícita del usuario.',
    parameters:{type:'object',properties:{event_id:{type:'number'},confirmed:{type:'boolean'}},required:['event_id','confirmed']}
  },
  {
    type:'function',
    name:'create_personal_reminder',
    description:'Crea un recordatorio personal de JARVIS.',
    parameters:{type:'object',properties:{
      title:{type:'string'},remind_at:{type:'string',description:'Fecha/hora ISO local'},
      notes:{type:'string'},priority:{type:'string',enum:['low','normal','high']}
    },required:['title','remind_at']}
  },
  {
    type:'function',
    name:'list_personal_reminders',
    description:'Lista recordatorios personales pendientes o completados.',
    parameters:{type:'object',properties:{status:{type:'string',enum:['pending','completed','all']},from:{type:'string'},to:{type:'string'},limit:{type:'number'}}}
  },
  {
    type:'function',
    name:'complete_personal_reminder',
    description:'Marca un recordatorio personal como completado.',
    parameters:{type:'object',properties:{reminder_id:{type:'number'}},required:['reminder_id']}
  },
  {
    type:'function',
    name:'delete_personal_reminder',
    description:'Elimina un recordatorio personal. Requiere confirmación explícita.',
    parameters:{type:'object',properties:{reminder_id:{type:'number'},confirmed:{type:'boolean'}},required:['reminder_id','confirmed']}
  },
  {
    type:'function',
    name:'get_personal_dashboard',
    description:'Obtiene agenda ejecutiva y recordatorios personales para mostrar en el Command Center.',
    parameters:{type:'object',properties:{from:{type:'string'},to:{type:'string'}}}
  }
];

module.exports = { jarvisTools };

'use strict';

const tools = [

  {
    type: 'function',
    name: 'open_module',
    description: 'Abre un módulo de la aplicación CliniqOne para el usuario. Úsala cuando el usuario diga abre, ve a, llévame a o muéstrame un módulo.',
    parameters: {
      type: 'object',
      properties: {
        module: {
          type: 'string',
          enum: ['agenda','caja','reportes','laboratorio','whatsapp','facturacion','empresas','inventario','expediente'],
        },
      },
      required: ['module'],
    },
  },
  {
    type: 'function', name: 'get_today_summary',
    description: 'Obtiene el resumen y listado de citas de hoy o de una fecha.',
    parameters: { type: 'object', properties: { date: { type: 'string', description: 'Fecha YYYY-MM-DD' }, branch_key: { type: 'string' } } },
  },
  {
    type: 'function', name: 'list_doctors', description: 'Lista doctores de la sucursal activa.',
    parameters: { type: 'object', properties: { branch_key: { type: 'string' } } },
  },
  {
    type: 'function', name: 'list_services', description: 'Lista servicios de la sucursal activa.',
    parameters: { type: 'object', properties: { branch_key: { type: 'string' } } },
  },
  {
    type: 'function', name: 'check_availability', description: 'Consulta horarios disponibles antes de crear o reagendar una cita.',
    parameters: {
      type: 'object', properties: {
        branch_key: { type: 'string' }, date: { type: 'string' }, exact_time: { type: 'string' },
        doctor_id: { type: ['string','number'] }, duration_hours: { type: 'number' }, limit: { type: 'number' },
      }, required: ['date'],
    },
  },
  {
    type: 'function', name: 'create_appointment', description: 'Crea una cita cuando ya están completos paciente, servicio, fecha y hora.',
    parameters: {
      type: 'object', properties: {
        patient: { type: 'string' }, phone: { type: 'string' }, branch_key: { type: 'string' },
        service_id: { type: ['string','number'] }, date: { type: 'string' }, start_time: { type: 'string' },
        doctor_id: { type: ['string','number'] }, doctor_name: { type: 'string' }, duration_hours: { type: 'number' },
      }, required: ['patient','service_id','date','start_time'],
    },
  },
  {
    type: 'function', name: 'find_appointments', description: 'Busca citas por paciente o fecha.',
    parameters: { type: 'object', properties: { patient: { type: 'string' }, date: { type: 'string' }, branch_key: { type: 'string' } } },
  },
  {
    type: 'function', name: 'cancel_appointment', description: 'Cancela una cita por su identificador. Debe confirmar verbalmente con el usuario antes de usarla.',
    parameters: { type: 'object', properties: { appointment_id: { type: 'number' } }, required: ['appointment_id'] },
  },
  {
    type: 'function', name: 'reschedule_appointment', description: 'Reagenda una cita existente. Debe verificar disponibilidad antes.',
    parameters: {
      type: 'object', properties: { appointment_id: { type: 'number' }, date: { type: 'string' }, start_time: { type: 'string' }, branch_key: { type: 'string' }, doctor_id: { type: ['string','number'] } },
      required: ['appointment_id','date','start_time'],
    },
  },
];

module.exports = { tools };

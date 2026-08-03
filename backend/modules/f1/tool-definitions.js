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
  {
    type: 'function',
    name: 'remember_context',
    description: 'Guarda una preferencia o dato operativo cuando el usuario pide explícitamente recordarlo. Usa session para una tarea temporal, day para el día actual, user para una preferencia personal permanente y company para una regla general de la empresa.',
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['session','day','user','company'] },
        key: { type: 'string' },
        value: {},
      },
      required: ['scope','key','value'],
    },
  },
  {
    type: 'function',
    name: 'forget_context',
    description: 'Olvida una memoria cuando el usuario lo solicita explícitamente.',
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['session','day','user','company'] },
        key: { type: 'string' },
      },
      required: ['scope'],
    },
  },
  {
    type: 'function',
    name: 'list_context_memory',
    description: 'Consulta qué contexto recuerda F1 para la sesión, el usuario y la empresa.',
    parameters: { type: 'object', properties: {} },
  },

  {
    type: 'function',
    name: 'get_operations_report',
    description: 'Genera el reporte operativo proactivo de la empresa y sucursal actuales: agenda, caja, laboratorio, inventario, prioridades y recomendaciones. Úsala cuando el usuario pida resumen, situación, pendientes, alertas o reporte del día.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Fecha YYYY-MM-DD; por defecto hoy.' },
        branch_key: { type: 'string' },
      },
    },
  },

  {
    type: 'function',
    name: 'get_income_summary',
    description: 'Consulta ingresos por un día o periodo y desglosa efectivo, transferencia y tarjeta.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Fecha única YYYY-MM-DD.' },
        date_from: { type: 'string', description: 'Fecha inicial YYYY-MM-DD.' },
        date_to: { type: 'string', description: 'Fecha final YYYY-MM-DD.' },
        branch_key: { type: 'string' },
      },
    },
  },
  {
    type: 'function',
    name: 'get_expense_summary',
    description: 'Consulta el total de gastos por un día o periodo.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        branch_key: { type: 'string' },
      },
    },
  },
  {
    type: 'function',
    name: 'get_daily_net',
    description: 'Calcula el neto de Caja: ingresos menos gastos para un día o periodo.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        branch_key: { type: 'string' },
      },
    },
  },
  {
    type: 'function',
    name: 'list_recent_payments',
    description: 'Lista los pagos más recientes de la sucursal activa.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        branch_key: { type: 'string' },
      },
    },
  },
  {
    type: 'function',
    name: 'register_payment',
    description: 'Registra un pago. Primero debe usarse con confirmed=false para pedir confirmación. Solo después de una confirmación explícita debe usarse con confirmed=true.',
    parameters: {
      type: 'object',
      properties: {
        patient: { type: 'string' },
        amount: { type: 'number' },
        payment_method: {
          type: 'string',
          enum: ['Efectivo', 'Transferencia', 'Tarjeta'],
        },
        date: { type: 'string' },
        appointment_id: { type: ['number', 'string'] },
        service_id: { type: ['number', 'string'] },
        doctor_id: { type: ['number', 'string'] },
        branch_key: { type: 'string' },
        confirmed: { type: 'boolean' },
      },
      required: ['patient', 'amount', 'payment_method', 'confirmed'],
    },
  },
  {
    type: 'function',
    name: 'register_expense',
    description: 'Registra un gasto. Primero debe usarse con confirmed=false para pedir confirmación. Solo después de una confirmación explícita debe usarse con confirmed=true.',
    parameters: {
      type: 'object',
      properties: {
        concept: { type: 'string' },
        amount: { type: 'number' },
        payment_method: { type: 'string' },
        date: { type: 'string' },
        doctor_id: { type: ['number', 'string'] },
        branch_key: { type: 'string' },
        confirmed: { type: 'boolean' },
      },
      required: ['concept', 'amount', 'confirmed'],
    },
  },

];

module.exports = { tools };

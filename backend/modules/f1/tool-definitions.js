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

  {
    type: 'function',
    name: 'update_appointment_status',
    description: 'Cambia el estado real de una cita a Pendiente, Confirmada, Cancelada o Atendida. Úsala cuando el usuario ordene confirmar, marcar atendida, regresar a pendiente o cancelar una cita ya identificada.',
    parameters: {
      type: 'object',
      properties: {
        appointment_id: { type: 'number' },
        status: { type: 'string', enum: ['Pendiente','Confirmada','Cancelada','Atendida'] },
      },
      required: ['appointment_id','status'],
    },
  },
  {
    type: 'function',
    name: 'get_patient_history',
    description: 'Consulta en tiempo real el historial de citas de un paciente, servicios, doctor, estado y pagos ligados. Úsala para revisar historial o expediente operativo.',
    parameters: {
      type: 'object',
      properties: { patient: { type: 'string' }, branch_key: { type: 'string' }, limit: { type: 'number' } },
      required: ['patient'],
    },
  },
  {
    type: 'function',
    name: 'get_patient_last_visit',
    description: 'Obtiene la última visita/cita conocida de un paciente y el servicio o trabajo realizado, con doctor y estado.',
    parameters: {
      type: 'object',
      properties: { patient: { type: 'string' }, branch_key: { type: 'string' } },
      required: ['patient'],
    },
  },
  {
    type: 'function',
    name: 'list_laboratories',
    description: 'Lista los laboratorios dentales registrados en la sucursal.',
    parameters: { type: 'object', properties: { branch_key: { type: 'string' } } },
  },
  {
    type: 'function',
    name: 'create_laboratory',
    description: 'Crea un nuevo laboratorio dental. Si falta el nombre, solicítalo antes de ejecutar.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        contact: { type: 'string' },
        branch_key: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    type: 'function',
    name: 'list_lab_works',
    description: 'Busca trabajos de laboratorio por paciente o laboratorio y muestra etapa, presupuesto, entrega y abonos.',
    parameters: {
      type: 'object',
      properties: {
        patient: { type: 'string' },
        laboratory_id: { type: ['number','string'] },
        branch_key: { type: 'string' },
      },
    },
  },
  {
    type: 'function',
    name: 'create_lab_work',
    description: 'Crea un trabajo de laboratorio dental. Reúne paciente y laboratorio; solicita datos faltantes necesarios antes de ejecutar.',
    parameters: {
      type: 'object',
      properties: {
        patient: { type: 'string' },
        laboratory_id: { type: ['number','string'] },
        service_id: { type: ['number','string'] },
        budget: { type: 'number' },
        start_date: { type: 'string' },
        due_date: { type: 'string' },
        stage: { type: 'string' },
        notes: { type: 'string' },
        branch_key: { type: 'string' },
      },
      required: ['patient','laboratory_id'],
    },
  },
  {
    type: 'function',
    name: 'update_lab_work_stage',
    description: 'Actualiza la etapa de un trabajo de laboratorio ya identificado.',
    parameters: {
      type: 'object',
      properties: {
        work_id: { type: 'string' },
        stage: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['work_id','stage'],
    },
  },
  {
    type: 'function',
    name: 'register_lab_payment',
    description: 'Registra un abono de un trabajo de laboratorio y calcula total abonado y saldo restante.',
    parameters: {
      type: 'object',
      properties: {
        work_id: { type: 'string' },
        amount: { type: 'number' },
        date: { type: 'string' },
        note: { type: 'string' },
        branch_key: { type: 'string' },
      },
      required: ['work_id','amount'],
    },
  },
  {
    type: 'function',
    name: 'list_inventory',
    description: 'Consulta inventario real, stock, mínimos, máximos, proveedor y caducidad. Permite buscar por nombre, SKU o categoría.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, branch_key: { type: 'string' } },
    },
  },
  {
    type: 'function',
    name: 'update_inventory_stock',
    description: 'Establece la existencia actual de un producto de inventario ya identificado.',
    parameters: {
      type: 'object',
      properties: {
        inventory_id: { type: 'number' },
        quantity: { type: 'number' },
        branch_key: { type: 'string' },
      },
      required: ['inventory_id','quantity'],
    },
  },
  {
    type: 'function',
    name: 'send_whatsapp_message',
    description: 'Envía un mensaje real por WhatsApp desde el canal configurado de la empresa. Si falta teléfono o mensaje, solicítalo.',
    parameters: {
      type: 'object',
      properties: {
        phone: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['phone','message'],
    },
  },


  // ===== Inventario avanzado =====
  { type:'function', name:'get_inventory_alerts', description:'Resume inventario en tiempo real separando agotados/críticos, bajos y normales; incluye cantidades, mínimo, máximo, proveedor y caducidad.', parameters:{type:'object',properties:{branch_key:{type:'string'}}}},
  { type:'function', name:'get_inventory_item', description:'Busca un producto exacto o aproximado por nombre, SKU o categoría y devuelve todos sus datos.', parameters:{type:'object',properties:{query:{type:'string'},branch_key:{type:'string'}},required:['query']}},
  { type:'function', name:'create_inventory_item', description:'Crea un producto nuevo aunque todavía no exista. Nombre es obligatorio; si falta SKU se genera uno único. Si faltan categoría o tipo y no se pueden inferir, pregunta solo esos datos y continúa.', parameters:{type:'object',properties:{name:{type:'string'},sku:{type:'string'},category:{type:'string',enum:['instrumental','desechable','anestesia','resina','endodoncia','ortodoncia']},type:{type:'string',enum:['equipment','material']},quantity:{type:'number'},min_stock:{type:'number'},max_stock:{type:'number'},price:{type:'number'},supplier:{type:'string'},usage_per_patient:{type:'number'},expiration_date:{type:'string'},branch_key:{type:'string'}},required:['name']}},
  { type:'function', name:'update_inventory_item', description:'Edita datos de un producto de inventario: nombre, SKU, categoría, tipo, cantidad, mínimos/máximos, precio, proveedor, consumo o caducidad.', parameters:{type:'object',properties:{inventory_id:{type:'number'},sku:{type:'string'},name:{type:'string'},category:{type:'string'},type:{type:'string'},quantity:{type:'number'},min_stock:{type:'number'},max_stock:{type:'number'},price:{type:'number'},supplier:{type:'string'},usage_per_patient:{type:'number'},expiration_date:{type:['string','null']},branch_key:{type:'string'}},required:['inventory_id']}},
  { type:'function', name:'adjust_inventory_stock', description:'Aumenta o disminuye existencias por una cantidad relativa, por ejemplo +20 o -3. Nunca permite stock negativo.', parameters:{type:'object',properties:{inventory_id:{type:'number'},delta:{type:'number'},branch_key:{type:'string'}},required:['inventory_id','delta']}},
  { type:'function', name:'delete_inventory_item', description:'Elimina definitivamente un producto. Debe pedir confirmación explícita antes; usar confirmed=true solo después de confirmar.', parameters:{type:'object',properties:{inventory_id:{type:'number'},confirmed:{type:'boolean'},branch_key:{type:'string'}},required:['inventory_id','confirmed']}},

  // ===== Doctores y servicios =====
  { type:'function', name:'create_doctor', description:'Crea un doctor en la sucursal activa. Solicita el nombre si falta.', parameters:{type:'object',properties:{name:{type:'string'},color:{type:'string'},branch_key:{type:'string'}},required:['name']}},
  { type:'function', name:'update_doctor', description:'Edita nombre o color de un doctor ya identificado.', parameters:{type:'object',properties:{doctor_id:{type:'number'},name:{type:'string'},color:{type:'string'},branch_key:{type:'string'}},required:['doctor_id']}},
  { type:'function', name:'delete_doctor', description:'Elimina un doctor solo si no tiene referencias bloqueantes. Pide confirmación explícita.', parameters:{type:'object',properties:{doctor_id:{type:'number'},confirmed:{type:'boolean'},branch_key:{type:'string'}},required:['doctor_id','confirmed']}},
  { type:'function', name:'create_service', description:'Crea un servicio/tratamiento con nombre, precio, duración, descripción y estado activo.', parameters:{type:'object',properties:{name:{type:'string'},price:{type:'number'},duration_hours:{type:'number'},description:{type:'string'},active:{type:'boolean'},branch_key:{type:'string'}},required:['name']}},
  { type:'function', name:'update_service', description:'Edita un servicio existente incluyendo nombre, precio, duración, descripción o estado.', parameters:{type:'object',properties:{service_id:{type:'number'},name:{type:'string'},price:{type:'number'},duration_hours:{type:'number'},description:{type:'string'},active:{type:'boolean'},branch_key:{type:'string'}},required:['service_id']}},
  { type:'function', name:'delete_service', description:'Elimina un servicio solo después de confirmación explícita y si no existen referencias que lo bloqueen.', parameters:{type:'object',properties:{service_id:{type:'number'},confirmed:{type:'boolean'},branch_key:{type:'string'}},required:['service_id','confirmed']}},

  // ===== Agenda avanzada =====
  { type:'function', name:'update_appointment', description:'Edita una cita existente: paciente, teléfono, doctor, servicio, fecha, hora, duración o estado. Si cambia fecha/hora/doctor verifica disponibilidad primero.', parameters:{type:'object',properties:{appointment_id:{type:'number'},patient:{type:'string'},phone:{type:'string'},doctor_id:{type:['number','string']},service_id:{type:['number','string']},date:{type:'string'},start_time:{type:'string'},duration_hours:{type:'number'},status:{type:'string'},branch_key:{type:'string'}},required:['appointment_id']}},
  { type:'function', name:'delete_appointment', description:'Elimina definitivamente una cita. Debe pedir confirmación explícita; para solo cancelar usa update_appointment_status.', parameters:{type:'object',properties:{appointment_id:{type:'number'},confirmed:{type:'boolean'}},required:['appointment_id','confirmed']}},

  // ===== Caja avanzada =====
  { type:'function', name:'list_expenses', description:'Lista gastos recientes con concepto, monto, fecha, doctor y método de pago.', parameters:{type:'object',properties:{limit:{type:'number'},branch_key:{type:'string'}}}},
  { type:'function', name:'update_payment', description:'Corrige un ingreso existente. Requiere confirmación explícita antes de modificar datos financieros.', parameters:{type:'object',properties:{payment_id:{type:'number'},patient:{type:'string'},amount:{type:'number'},payment_method:{type:'string'},date:{type:'string'},confirmed:{type:'boolean'},branch_key:{type:'string'}},required:['payment_id','confirmed']}},
  { type:'function', name:'delete_payment', description:'Elimina un ingreso existente. Requiere confirmación explícita.', parameters:{type:'object',properties:{payment_id:{type:'number'},confirmed:{type:'boolean'},branch_key:{type:'string'}},required:['payment_id','confirmed']}},
  { type:'function', name:'update_expense', description:'Corrige un gasto existente. Requiere confirmación explícita antes de modificar datos financieros.', parameters:{type:'object',properties:{expense_id:{type:'number'},concept:{type:'string'},amount:{type:'number'},date:{type:'string'},doctor_id:{type:['number','string']},payment_method:{type:'string'},confirmed:{type:'boolean'},branch_key:{type:'string'}},required:['expense_id','confirmed']}},
  { type:'function', name:'delete_expense', description:'Elimina un gasto existente. Requiere confirmación explícita.', parameters:{type:'object',properties:{expense_id:{type:'number'},confirmed:{type:'boolean'},branch_key:{type:'string'}},required:['expense_id','confirmed']}},

  // ===== Laboratorio avanzado =====
  { type:'function', name:'update_laboratory', description:'Edita nombre o contacto de un laboratorio dental.', parameters:{type:'object',properties:{laboratory_id:{type:'number'},name:{type:'string'},contact:{type:'string'},branch_key:{type:'string'}},required:['laboratory_id']}},
  { type:'function', name:'delete_laboratory', description:'Elimina un laboratorio únicamente si no tiene trabajos asociados. Pide confirmación.', parameters:{type:'object',properties:{laboratory_id:{type:'number'},confirmed:{type:'boolean'},branch_key:{type:'string'}},required:['laboratory_id','confirmed']}},
  { type:'function', name:'update_lab_work', description:'Edita cualquier dato de un trabajo de laboratorio: paciente, laboratorio, servicio, presupuesto, fechas, etapa o notas.', parameters:{type:'object',properties:{work_id:{type:'string'},patient:{type:'string'},laboratory_id:{type:['number','string']},service_id:{type:['number','string']},budget:{type:'number'},start_date:{type:'string'},due_date:{type:'string'},stage:{type:'string'},notes:{type:'string'},branch_key:{type:'string'}},required:['work_id']}},
  { type:'function', name:'delete_lab_work', description:'Elimina un trabajo de laboratorio y sus abonos asociados solo después de confirmación explícita.', parameters:{type:'object',properties:{work_id:{type:'string'},confirmed:{type:'boolean'},branch_key:{type:'string'}},required:['work_id','confirmed']}},
  { type:'function', name:'list_lab_payments', description:'Lista los abonos de un trabajo de laboratorio y calcula total abonado y saldo.', parameters:{type:'object',properties:{work_id:{type:'string'},branch_key:{type:'string'}},required:['work_id']}},

  // ===== Expediente clínico completo =====
  { type:'function', name:'get_medical_record', description:'Consulta el expediente clínico completo de un paciente: datos personales, historia clínica, odontograma, tratamientos, consentimientos y documentos. No inventa campos ausentes.', parameters:{type:'object',properties:{patient:{type:'string'},branch_key:{type:'string'}},required:['patient']}},
  { type:'function', name:'create_medical_record', description:'Crea un expediente médico dental nuevo. Solo nombre es obligatorio; reúne o solicita datos adicionales según lo que el usuario quiera registrar.', parameters:{type:'object',properties:{patient:{type:'string'},phone:{type:'string'},email:{type:'string'},birth_date:{type:'string'},age:{type:'number'},gender:{type:'string',enum:['masculino','femenino','otro']},address:{type:'string'},occupation:{type:'string'},marital_status:{type:'string'},emergency_contact:{type:'string'},emergency_phone:{type:'string'},appointment_id:{type:'number'},branch_key:{type:'string'}},required:['patient']}},
  { type:'function', name:'update_medical_record', description:'Actualiza datos personales del expediente médico de un paciente identificado por expediente.', parameters:{type:'object',properties:{record_id:{type:'number'},patient:{type:'string'},phone:{type:'string'},email:{type:'string'},birth_date:{type:'string'},age:{type:'number'},gender:{type:'string'},address:{type:'string'},occupation:{type:'string'},marital_status:{type:'string'},emergency_contact:{type:'string'},emergency_phone:{type:'string'},branch_key:{type:'string'}},required:['record_id']}},
  { type:'function', name:'upsert_clinical_history', description:'Crea o actualiza la historia clínica dental del expediente: motivo, enfermedad actual, antecedentes, hábitos, alergias, medicamentos, examen, diagnóstico, plan y observaciones.', parameters:{type:'object',properties:{record_id:{type:'number'},history_id:{type:'number'},appointment_id:{type:'number'},reason:{type:'string'},current_illness:{type:'string'},personal_history:{type:'string'},family_history:{type:'string'},dental_history:{type:'string'},harmful_habits:{type:'string'},allergies:{type:'string'},current_medications:{type:'string'},extraoral_exam:{type:'string'},intraoral_exam:{type:'string'},presumptive_diagnosis:{type:'string'},treatment_plan:{type:'string'},observations:{type:'string'},doctor_id:{type:['number','string']},date:{type:'string'},branch_key:{type:'string'}},required:['record_id']}},
  { type:'function', name:'upsert_odontogram_tooth', description:'Crea o actualiza un diente del odontograma. Estados válidos: sano, cariado, obturado, extraido, endodoncia, corona, implante, protesis.', parameters:{type:'object',properties:{record_id:{type:'number'},appointment_id:{type:'number'},tooth_number:{type:'number'},status:{type:'string',enum:['sano','cariado','obturado','extraido','endodoncia','corona','implante','protesis']},surface:{type:'string'},observations:{type:'string'},date:{type:'string'},doctor_id:{type:['number','string']},branch_key:{type:'string'}},required:['record_id','tooth_number','status']}},
  { type:'function', name:'add_dental_treatment', description:'Registra un tratamiento dental en el expediente.', parameters:{type:'object',properties:{record_id:{type:'number'},appointment_id:{type:'number'},date:{type:'string'},tooth_number:{type:'number'},procedure:{type:'string'},description:{type:'string'},materials:{type:'string'},duration_minutes:{type:'number'},cost:{type:'number'},status:{type:'string',enum:['planificado','en_progreso','completado','cancelado']},observations:{type:'string'},doctor_id:{type:['number','string']},branch_key:{type:'string'}},required:['record_id','procedure']}},
  { type:'function', name:'update_dental_treatment', description:'Actualiza un tratamiento dental ya registrado.', parameters:{type:'object',properties:{treatment_id:{type:'number'},date:{type:'string'},tooth_number:{type:'number'},procedure:{type:'string'},description:{type:'string'},materials:{type:'string'},duration_minutes:{type:'number'},cost:{type:'number'},status:{type:'string'},observations:{type:'string'},doctor_id:{type:['number','string']},branch_key:{type:'string'}},required:['treatment_id']}},
  { type:'function', name:'delete_dental_treatment', description:'Elimina un tratamiento dental solo después de confirmación explícita.', parameters:{type:'object',properties:{treatment_id:{type:'number'},confirmed:{type:'boolean'},branch_key:{type:'string'}},required:['treatment_id','confirmed']}},
  { type:'function', name:'create_informed_consent', description:'Crea un consentimiento informado en el expediente. Solicita el tipo de tratamiento si falta.', parameters:{type:'object',properties:{record_id:{type:'number'},appointment_id:{type:'number'},treatment_type:{type:'string'},treatment_description:{type:'string'},risks_benefits:{type:'string'},alternatives:{type:'string'},estimated_cost:{type:'number'},date:{type:'string'},patient_signed:{type:'boolean'},doctor_signed:{type:'boolean'},witness_name:{type:'string'},witness_id:{type:'string'},doctor_id:{type:['number','string']},branch_key:{type:'string'}},required:['record_id','treatment_type']}},
  { type:'function', name:'update_consent_signatures', description:'Actualiza firma de paciente y/o doctor en un consentimiento informado.', parameters:{type:'object',properties:{consent_id:{type:'number'},patient_signed:{type:'boolean'},doctor_signed:{type:'boolean'},branch_key:{type:'string'}},required:['consent_id']}},
  { type:'function', name:'get_medical_statistics', description:'Consulta estadísticas reales de expedientes, historias, tratamientos, consentimientos, documentos y odontograma de la sucursal.', parameters:{type:'object',properties:{branch_key:{type:'string'}}}},
  { type:'function', name:'list_medical_documents', description:'Lista documentos, fotografías y radiografías registrados en un expediente sin descargar archivos pesados.', parameters:{type:'object',properties:{record_id:{type:'number'},branch_key:{type:'string'}},required:['record_id']}},

  // ===== WhatsApp por paciente =====
  { type:'function', name:'send_whatsapp_to_patient', description:'Busca el teléfono real de un paciente en agenda/expediente y envía un WhatsApp. Si hay varias coincidencias ambiguas, devuelve opciones para que F1 pregunte cuál.', parameters:{type:'object',properties:{patient:{type:'string'},message:{type:'string'},branch_key:{type:'string'}},required:['patient','message']}},


  // ===== Productividad / Objetivos =====
  { type:'function', name:'get_productivity_summary', description:'Consulta productividad real por rango de fechas: ingresos, gastos, neto y desglose por doctor. Puede filtrar por doctor.', parameters:{type:'object',properties:{from:{type:'string'},to:{type:'string'},doctor_id:{type:['number','string']},include_details:{type:'boolean'},branch_key:{type:'string'}},required:['from','to']}},
  { type:'function', name:'list_objectives', description:'Lista metas/objetivos configurados por doctor y período en la sucursal actual.', parameters:{type:'object',properties:{from:{type:'string'},to:{type:'string'},doctor_id:{type:['number','string']},branch_key:{type:'string'}}}},
  { type:'function', name:'create_objective', description:'Crea una meta para un doctor. Requiere doctor y meta; puede incluir sueldo base, abonos y período.', parameters:{type:'object',properties:{doctor_id:{type:['number','string']},meta:{type:'number'},base_salary:{type:'number'},abonos:{type:'number'},period_start:{type:'string'},period_end:{type:'string'},branch_key:{type:'string'}},required:['doctor_id','meta']}},
  { type:'function', name:'update_objective', description:'Actualiza una meta existente: doctor, monto de meta, sueldo base, abonos o período.', parameters:{type:'object',properties:{objective_id:{type:'number'},doctor_id:{type:['number','string']},meta:{type:'number'},base_salary:{type:'number'},abonos:{type:'number'},period_start:{type:'string'},period_end:{type:'string'},branch_key:{type:'string'}},required:['objective_id']}},
  { type:'function', name:'delete_objective', description:'Elimina una meta/objetivo. Requiere confirmación explícita.', parameters:{type:'object',properties:{objective_id:{type:'number'},confirmed:{type:'boolean'},branch_key:{type:'string'}},required:['objective_id','confirmed']}},
  { type:'function', name:'get_doctor_productivity_settings', description:'Consulta visibilidad y porcentaje de comisión configurado para los doctores de Productividad.', parameters:{type:'object',properties:{doctor_id:{type:['number','string']},branch_key:{type:'string'}}}},
  { type:'function', name:'update_doctor_productivity_settings', description:'Cambia visibilidad y/o porcentaje de comisión de un doctor. comision_pct puede darse como 0.25 o 25 y se normaliza a 25%.', parameters:{type:'object',properties:{doctor_id:{type:['number','string']},visible:{type:'boolean'},commission_pct:{type:'number'},branch_key:{type:'string'}},required:['doctor_id']}},

  // ===== Facturación / Fiscal =====
  { type:'function', name:'get_billing_config', description:'Consulta la configuración fiscal real de la empresa/sucursal: RFC, razón social, régimen, CP, serie, ambiente y estado de certificados.', parameters:{type:'object',properties:{branch_key:{type:'string'}}}},
  { type:'function', name:'update_billing_config', description:'Actualiza datos fiscales del emisor. No inventa RFC, razón social, régimen ni código postal; solicita los faltantes cuando sean necesarios.', parameters:{type:'object',properties:{rfc:{type:'string'},business_name:{type:'string'},tax_regime:{type:'string'},postal_code:{type:'string'},pac_provider:{type:'string'},invoice_series:{type:'string'},environment:{type:'string',enum:['pruebas','produccion']},active:{type:'boolean'},branch_key:{type:'string'}}}},
  { type:'function', name:'list_tax_clients', description:'Lista o busca clientes fiscales por RFC, razón social, email o teléfono.', parameters:{type:'object',properties:{query:{type:'string'},limit:{type:'number'},branch_key:{type:'string'}}}},
  { type:'function', name:'create_tax_client', description:'Crea un cliente fiscal. RFC y razón social son obligatorios; puede registrar email, teléfono, dirección, uso CFDI, CP y régimen fiscal.', parameters:{type:'object',properties:{rfc:{type:'string'},business_name:{type:'string'},email:{type:'string'},phone:{type:'string'},address:{type:'string'},cfdi_use:{type:'string'},postal_code:{type:'string'},tax_regime:{type:'string'},branch_key:{type:'string'}},required:['rfc','business_name']}},
  { type:'function', name:'update_tax_client', description:'Actualiza datos de un cliente fiscal ya identificado.', parameters:{type:'object',properties:{client_id:{type:['number','string']},rfc:{type:'string'},business_name:{type:'string'},email:{type:'string'},phone:{type:'string'},address:{type:'string'},cfdi_use:{type:'string'},postal_code:{type:'string'},tax_regime:{type:'string'},branch_key:{type:'string'}},required:['client_id']}},
  { type:'function', name:'list_tax_products', description:'Lista o busca productos/servicios del catálogo fiscal por nombre, descripción, código interno o clave SAT.', parameters:{type:'object',properties:{query:{type:'string'},limit:{type:'number'},branch_key:{type:'string'}}}},
  { type:'function', name:'create_tax_product', description:'Crea un producto o servicio fiscal. Requiere nombre/descripción; puede incluir código interno, clave SAT, unidad, objeto de impuesto y precio.', parameters:{type:'object',properties:{name:{type:'string'},internal_code:{type:'string'},description:{type:'string'},sat_product_key:{type:'string'},unit_key:{type:'string'},tax_object:{type:'string'},price:{type:'number'},branch_key:{type:'string'}},required:['name']}},
  { type:'function', name:'update_tax_product', description:'Actualiza un producto/servicio del catálogo fiscal.', parameters:{type:'object',properties:{product_id:{type:['number','string']},name:{type:'string'},internal_code:{type:'string'},description:{type:'string'},sat_product_key:{type:'string'},unit_key:{type:'string'},tax_object:{type:'string'},price:{type:'number'},branch_key:{type:'string'}},required:['product_id']}},
  { type:'function', name:'delete_tax_product', description:'Elimina un producto/servicio fiscal. Requiere confirmación explícita.', parameters:{type:'object',properties:{product_id:{type:['number','string']},confirmed:{type:'boolean'},branch_key:{type:'string'}},required:['product_id','confirmed']}},
  { type:'function', name:'list_invoices', description:'Lista facturas por fecha/estado y muestra cliente, total, estado, folio y UUID.', parameters:{type:'object',properties:{from:{type:'string'},to:{type:'string'},status:{type:'string'},query:{type:'string'},limit:{type:'number'},branch_key:{type:'string'}}}},
  { type:'function', name:'get_invoice', description:'Obtiene una factura completa y sus conceptos.', parameters:{type:'object',properties:{invoice_id:{type:'string'},branch_key:{type:'string'}},required:['invoice_id']}},
  { type:'function', name:'create_invoice', description:'Crea una factura/borrador con cliente, tipo, forma/método de pago, cita opcional, notas, total y conceptos. Si faltan datos esenciales devuelve qué falta.', parameters:{type:'object',properties:{client:{type:'string'},type:{type:'string',enum:['ingreso','egreso']},payment_form:{type:'string'},payment_method:{type:'string'},appointment_id:{type:'number'},notes:{type:'string'},total:{type:'number'},concepts:{type:'array',items:{type:'object',properties:{description:{type:'string'},quantity:{type:'number'},unit_value:{type:'number'},amount:{type:'number'},sat_product_key:{type:'string'},unit_key:{type:'string'},tax_object:{type:'string'}},required:['description']}},branch_key:{type:'string'}},required:['client','type']}},
  { type:'function', name:'update_invoice', description:'Actualiza una factura existente y opcionalmente reemplaza sus conceptos completos.', parameters:{type:'object',properties:{invoice_id:{type:'string'},client:{type:'string'},type:{type:'string'},payment_form:{type:'string'},payment_method:{type:'string'},appointment_id:{type:'number'},notes:{type:'string'},total:{type:'number'},concepts:{type:'array',items:{type:'object',properties:{description:{type:'string'},quantity:{type:'number'},unit_value:{type:'number'},amount:{type:'number'},sat_product_key:{type:'string'},unit_key:{type:'string'},tax_object:{type:'string'}},required:['description']}},branch_key:{type:'string'}},required:['invoice_id']}},
  { type:'function', name:'delete_invoice', description:'Elimina definitivamente una factura/borrador. Requiere confirmación explícita.', parameters:{type:'object',properties:{invoice_id:{type:'string'},confirmed:{type:'boolean'},branch_key:{type:'string'}},required:['invoice_id','confirmed']}},
  { type:'function', name:'cancel_invoice', description:'Cancela una factura. Requiere confirmación explícita y puede incluir motivo.', parameters:{type:'object',properties:{invoice_id:{type:'string'},reason:{type:'string'},confirmed:{type:'boolean'},branch_key:{type:'string'}},required:['invoice_id','confirmed']}},
  { type:'function', name:'stamp_invoice', description:'Timbrado fiscal real mediante el conector PAC/Facturama existente. Requiere confirmación explícita y no declara éxito si no recibe respuesta válida del PAC.', parameters:{type:'object',properties:{invoice_id:{type:'string'},confirmed:{type:'boolean'},branch_key:{type:'string'}},required:['invoice_id','confirmed']}},
  { type:'function', name:'get_invoice_download_links', description:'Devuelve rutas seguras para descargar PDF, XML o ZIP de una factura timbrada usando su identificador/UUID.', parameters:{type:'object',properties:{invoice_id:{type:'string'},branch_key:{type:'string'}},required:['invoice_id']}},


  // ===== F1 V5: sucursales, dashboard, WhatsApp e inventario/laboratorio restantes =====
  { type:'function', name:'list_branches', description:'Lista las sucursales activas de la empresa con nombre, teléfono, dirección y estado de IA/agenda.', parameters:{type:'object',properties:{}}},
  { type:'function', name:'select_branch', description:'Solicita al cliente cambiar la sucursal activa después de verificar que pertenece a la empresa.', parameters:{type:'object',properties:{branch_key:{type:'string'}},required:['branch_key']}},
  { type:'function', name:'get_dashboard_summary', description:'Obtiene un resumen ejecutivo tenant-safe de una sucursal: citas, pacientes, ingresos, gastos, neto, inventario y laboratorio para un periodo.', parameters:{type:'object',properties:{branch_key:{type:'string'},from:{type:'string'},to:{type:'string'}}}},
  { type:'function', name:'compare_branches', description:'Compara productividad operativa y financiera entre sucursales de la misma empresa.', parameters:{type:'object',properties:{branch_keys:{type:'array',items:{type:'string'}},from:{type:'string'},to:{type:'string'}}}},
  { type:'function', name:'apply_inventory_formula', description:'Descuenta de inventario los consumos de una fórmula de tratamiento de forma transaccional usando la ruta oficial del backend.', parameters:{type:'object',properties:{items:{type:'array',items:{type:'object',properties:{item:{type:'string'},quantity:{type:'number'}},required:['item','quantity']}},branch_key:{type:'string'}},required:['items']}},
  { type:'function', name:'get_whatsapp_status', description:'Verifica si el canal WhatsApp de la sucursal está configurado y activo sin exponer tokens.', parameters:{type:'object',properties:{branch_key:{type:'string'}}}},
  { type:'function', name:'list_whatsapp_messages', description:'Consulta historial real de WhatsApp filtrable por dirección, teléfono y fechas.', parameters:{type:'object',properties:{direction:{type:'string',enum:['all','incoming','outgoing']},phone:{type:'string'},from:{type:'string'},to:{type:'string'},limit:{type:'number'},branch_key:{type:'string'}}}},
  { type:'function', name:'get_whatsapp_stats', description:'Obtiene totales de mensajes enviados/recibidos y señales de confirmaciones/cancelaciones en un periodo.', parameters:{type:'object',properties:{from:{type:'string'},to:{type:'string'},branch_key:{type:'string'}}}},
  { type:'function', name:'lookup_appointments_by_phone', description:'Busca citas de un paciente usando su teléfono, útil desde el historial de WhatsApp.', parameters:{type:'object',properties:{phone:{type:'string'},branch_key:{type:'string'}},required:['phone']}},
  { type:'function', name:'send_whatsapp_template', description:'Envía una plantilla de WhatsApp existente por el endpoint oficial de CliniqOne.', parameters:{type:'object',properties:{phone:{type:'string'},template:{type:'string'},language:{type:'string'},body_params:{type:'array',items:{type:'string'}},branch_key:{type:'string'}},required:['phone','template']}},
  { type:'function', name:'send_today_confirmations', description:'Envía en lote confirmaciones de citas por WhatsApp para hoy. Primero informa cuántas citas alcanzará y exige confirmación explícita.', parameters:{type:'object',properties:{date:{type:'string'},limit:{type:'number'},confirmed:{type:'boolean'},branch_key:{type:'string'}},required:['confirmed']}},
  { type:'function', name:'list_laboratory_payouts', description:'Consulta pagos reales hechos al laboratorio (pagos_laboratorio), separados de los abonos del trabajo, y calcula TBE cuando se indica un trabajo.', parameters:{type:'object',properties:{work_id:{type:'string'},branch_key:{type:'string'}}}},
  { type:'function', name:'register_laboratory_payout', description:'Registra un pago real al laboratorio en pagos_laboratorio. Requiere confirmación explícita y devuelve TBE restante.', parameters:{type:'object',properties:{work_id:{type:'string'},amount:{type:'number'},date:{type:'string'},confirmed:{type:'boolean'},branch_key:{type:'string'}},required:['work_id','amount','confirmed']}},

];

module.exports = { tools };

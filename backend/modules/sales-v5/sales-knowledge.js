'use strict';

const DEFAULT_OFFER = Object.freeze({
  brand: 'CliniqOne',
  promise: 'Tu clínica, todo en un solo lugar.',
  price_mxn: 1490,
  billing_period: 'mes',
  doctors: 'ilimitados',
  branches: 'ilimitadas',
  ai_channels: ['WhatsApp', 'Facebook Messenger'],
  features: [
    'Agenda inteligente',
    'Expediente clínico y odontograma',
    'Caja',
    'Productividad y reportes',
    'Laboratorios dentales',
    'Inventario',
    'Administración de sucursales',
    'Asistente virtual IA para WhatsApp',
    'Asistente virtual IA para Facebook Messenger',
    'Recordatorios y confirmaciones automáticas de citas'
  ]
});

const PRODUCT_MODULES = Object.freeze({
  agenda: {
    name: 'Agenda inteligente',
    facts: [
      'Permite crear, editar y eliminar citas.',
      'Registra paciente, doctor, servicio, estado, fecha, hora de inicio, duración y teléfono.',
      'La cita se conecta con el expediente médico del paciente.',
      'Trabaja con recordatorios y confirmaciones automáticas de citas.',
      'Cuando el paciente responde a una confirmación automática, el sistema puede actualizar el estado de la cita de Pendiente a Confirmada o Cancelada según la respuesta recibida.'
    ]
  },
  expediente: {
    name: 'Expediente clínico',
    facts: [
      'Centraliza la información clínica y general del paciente.',
      'Incluye historial médico y odontograma para el seguimiento odontológico.',
      'Se accede al expediente desde la operación de la agenda para mantener la atención ligada al paciente.',
      'Permite conservar el seguimiento clínico en un solo sistema en lugar de manejar información dispersa.'
    ]
  },
  caja: {
    name: 'Caja',
    facts: [
      'Lleva control de ingresos y egresos de la clínica.',
      'Permite relacionar la operación económica con la actividad registrada en el sistema.',
      'Facilita consultar movimientos para tener mayor control administrativo.'
    ]
  },
  productividad: {
    name: 'Productividad',
    facts: [
      'Presenta indicadores y gráficas de productividad.',
      'Ayuda a revisar el desempeño de la clínica y de los doctores con información registrada en la operación.',
      'Está orientado a convertir los datos diarios de la clínica en información útil para administración y seguimiento.'
    ]
  },
  laboratorios: {
    name: 'Laboratorios dentales',
    facts: [
      'No es un módulo de análisis clínicos: está diseñado para controlar trabajos enviados a laboratorios dentales.',
      'Permite registrar laboratorio, paciente, servicio, presupuesto, fechas, etapa del trabajo y notas.',
      'Da seguimiento al flujo del trabajo desde la toma o envío hasta la entrega.',
      'Permite registrar abonos y pagos relacionados con trabajos de laboratorio.'
    ]
  },
  inventario: {
    name: 'Inventario',
    facts: [
      'Controla materiales, insumos e instrumental de la clínica.',
      'Registra existencias y niveles mínimos/máximos de stock para facilitar la detección de faltantes.',
      'Puede registrar datos como categoría, tipo, precio, proveedor, última compra, consumo estimado y fecha de caducidad cuando corresponda.',
      'Ayuda a tener visibilidad del inventario en lugar de depender de controles manuales separados.'
    ]
  },
  sucursales: {
    name: 'Administración de sucursales',
    facts: [
      'CliniqOne está preparado para trabajar con múltiples sucursales dentro de la misma plataforma.',
      'La oferta comercial contempla sucursales ilimitadas y doctores ilimitados.',
      'La información operativa se organiza por empresa y sucursal para evitar mezclar configuraciones.'
    ]
  },
  ia: {
    name: 'Asistentes virtuales IA',
    facts: [
      'Incluye asistentes virtuales para WhatsApp y Facebook Messenger.',
      'Atienden conversaciones de pacientes y pueden apoyar el proceso de agenda, cancelación y reagendado según la configuración de la clínica.',
      'Trabajan conectados con la operación de la clínica para que la conversación no sea un chatbot aislado.',
      'Los recordatorios y confirmaciones automáticas complementan la atención: una respuesta de confirmación o cancelación puede reflejarse en el estado de la cita.'
    ]
  },
  soporte: {
    name: 'Capacitación y soporte',
    facts: [
      'CliniqOne contempla capacitación y soporte para acompañar a la clínica en el aprendizaje y uso de la plataforma.'
    ]
  }
});

const COMPETITOR_POLICY = {
  rule: 'Nunca inventes características, precios ni defectos de competidores. Si no existe una comparación verificada, explica las fortalezas comprobadas de CliniqOne y ofrece comparar punto por punto con lo que el prospecto usa.',
  verified: {}
};

function normalizeOffer(value = {}) {
  const price = Number(value.price_mxn);
  return { ...DEFAULT_OFFER, ...(value || {}), price_mxn: Number.isFinite(price) && price > 0 ? price : DEFAULT_OFFER.price_mxn };
}

function moduleKnowledge() {
  return Object.values(PRODUCT_MODULES)
    .map(m => `${m.name}:\n- ${m.facts.join('\n- ')}`)
    .join('\n\n');
}

function summarizeKnowledge(offerValue = {}) {
  const offer = normalizeOffer(offerValue);
  return [
    `Marca: ${offer.brand}.`,
    `Propuesta: ${offer.promise}`,
    `Oferta comercial actual: un solo producto completo por $${offer.price_mxn.toLocaleString('es-MX')} MXN al ${offer.billing_period}.`,
    `Doctores: ${offer.doctors}. Sucursales: ${offer.branches}.`,
    `Asistentes virtuales IA incluidos para ${offer.ai_channels.join(' y ')}.`,
    `Módulos/capacidades incluidos actualmente: ${offer.features.join(', ')}.`,
    '',
    'CONOCIMIENTO OFICIAL DEL PRODUCTO:',
    moduleKnowledge(),
    '',
    'REGLAS DE PRECISIÓN DEL PRODUCTO:',
    '- Si preguntan por todos los módulos, enumera TODOS los módulos/capacidades anteriores; no omitas Expediente ni Inventario.',
    '- Si preguntan por un módulo, explica concretamente qué hace y cómo ayuda; no respondas con frases vagas.',
    '- Laboratorios significa laboratorios DENTALES y seguimiento de trabajos; nunca lo describas como pruebas o análisis clínicos.',
    '- Explica que las confirmaciones automáticas pueden cambiar el estado de una cita a Confirmada o Cancelada según la respuesta del paciente.',
    '- Distingue asistentes IA de recordatorios automáticos: son capacidades relacionadas, pero no son lo mismo.',
    '- No afirmes una función que no aparezca en este conocimiento oficial.',
    '- Si te preguntan un detalle no documentado, di con seguridad que ese detalle específico debe confirmarse; no improvises.',
    '- No existen planes Básico, Medio o Completo. No preguntes qué plan desea el prospecto.',
    '- No prometas IA o mensajería ilimitada; los asistentes están incluidos y la política de uso puede definirse comercialmente.',
    `Competencia: ${COMPETITOR_POLICY.rule}`
  ].join('\n');
}

module.exports = { DEFAULT_OFFER, PRODUCT_MODULES, COMPETITOR_POLICY, normalizeOffer, summarizeKnowledge, moduleKnowledge };

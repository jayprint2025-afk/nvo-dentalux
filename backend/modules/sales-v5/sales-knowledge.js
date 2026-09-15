'use strict';

const DEFAULT_OFFER = Object.freeze({
  brand: 'CliniqOne',
  promise: 'Tu clínica, todo en un solo lugar.',
  billing_period: 'mes',
  doctors: 'ilimitados',
  branches: 'ilimitadas',
  patients: 'ilimitados',
  plans: {
    cliniqone: {
      name: 'CliniqOne',
      price_mxn: 799,
      description: 'Sistema completo para administrar la clínica, sin asistentes virtuales automáticos ni Hanna.'
    },
    cliniqone_ai: {
      name: 'CliniqOne AI',
      price_mxn: 1490,
      description: 'Todo CliniqOne más automatización, asistentes virtuales de pacientes y Hanna.'
    }
  }
});

const BASE_FEATURES = [
  'Agenda inteligente', 'Caja', 'Expediente clínico, historial médico y odontograma', 'Consentimientos',
  'Historial de pacientes y citas', 'Inventario', 'Productividad y reportes', 'Laboratorios dentales',
  'Administración multisucursal', 'Mensajes manuales de WhatsApp'
];
const AI_FEATURES = [
  'Recordatorios y confirmaciones automáticas por WhatsApp', 'Asistente virtual IA para WhatsApp',
  'Asistente virtual IA para Facebook Messenger', 'Asistente virtual IA para Instagram',
  'Hanna, asistente personal por voz para operar CliniqOne'
];

const PRODUCT_MODULES = Object.freeze({
  agenda: { name: 'Agenda inteligente', facts: ['Permite crear, editar y eliminar citas.', 'Registra paciente, doctor, servicio, estado, fecha, hora de inicio, duración y teléfono.', 'La cita se conecta con el expediente del paciente.', 'En CliniqOne AI trabaja además con recordatorios y confirmaciones automáticas por WhatsApp.'] },
  expediente: { name: 'Expediente clínico, odontograma y consentimientos', facts: ['Centraliza la información clínica y general del paciente.', 'Incluye historial médico, odontograma y seguimiento odontológico.', 'Incluye gestión de consentimientos vinculados al paciente y su atención.', 'Se conecta con la agenda y conserva el historial del paciente en un solo sistema.'] },
  caja: { name: 'Caja', facts: ['Lleva control de ingresos y egresos de la clínica.', 'Permite relacionar la operación económica con la actividad registrada.', 'Facilita consultar movimientos para mayor control administrativo.'] },
  productividad: { name: 'Productividad y reportes', facts: ['Presenta indicadores y gráficas de productividad.', 'Permite revisar el desempeño de la clínica y de los doctores con la información registrada.', 'Convierte datos diarios en información útil para administración y seguimiento.'] },
  laboratorios: { name: 'Laboratorios dentales', facts: ['Controla trabajos enviados a laboratorios dentales; no se refiere a análisis clínicos.', 'Permite registrar laboratorio, paciente, servicio, presupuesto, fechas, etapa y notas.', 'Da seguimiento al trabajo hasta la entrega y permite registrar abonos y pagos.'] },
  inventario: { name: 'Inventario', facts: ['Controla materiales, insumos e instrumental.', 'Registra existencias y niveles mínimos/máximos de stock.', 'Puede registrar categoría, tipo, precio, proveedor, última compra, consumo estimado y caducidad cuando corresponda.'] },
  sucursales: { name: 'Multisucursal', facts: ['Permite trabajar con múltiples sucursales dentro de la misma plataforma.', 'Actualmente no se cobra extra por agregar doctores o sucursales: ambos se ofrecen sin límite.', 'La información se organiza por empresa y sucursal para evitar mezclar configuraciones.'] },
  whatsapp_manual: { name: 'Mensajes manuales de WhatsApp', facts: ['CliniqOne permite comunicación manual por WhatsApp como parte del plan CliniqOne de $799.', 'No confundir mensajes manuales con el asistente virtual de WhatsApp ni con recordatorios automáticos, que pertenecen a CliniqOne AI.'] },
  automatizaciones: { name: 'Recordatorios y confirmaciones automáticas', facts: ['Disponibles en CliniqOne AI.', 'Automatizan recordatorios por WhatsApp relacionados con las citas.', 'La respuesta del paciente puede actualizar una cita de Pendiente a Confirmada o Cancelada según confirme o cancele.'] },
  ia_pacientes: { name: 'Asistentes virtuales para pacientes', facts: ['Disponibles en CliniqOne AI para WhatsApp, Facebook Messenger e Instagram.', 'Atienden conversaciones de los pacientes de la clínica y apoyan agenda, cancelación y reagendado según la configuración.', 'Son asistentes de cada clínica/doctor; NO son AI Sales.'] },
  hanna: { name: 'Hanna', facts: ['Disponible en CliniqOne AI.', 'Hanna es el asistente personal interno de CliniqOne y se utiliza mediante voz.', 'Puede ayudar al usuario a realizar acciones y operar funciones del sistema mediante comandos de voz.', 'Hanna es el mismo asistente que anteriormente se identificaba como F1; Hanna es el comando/nombre actual.', 'No es un asistente de atención a pacientes.'] },
  soporte: { name: 'Capacitación y soporte', facts: ['CliniqOne contempla capacitación y soporte para acompañar a la clínica en el aprendizaje y uso de la plataforma.'] }
});

const COMPETITOR_POLICY = { rule: 'Nunca inventes características, precios ni defectos de competidores. Si no existe una comparación verificada, explica las fortalezas comprobadas de CliniqOne y ofrece comparar punto por punto con lo que el prospecto usa.', verified: {} };

function normalizeOffer(value = {}) {
  // Los precios/planes oficiales viven en código. Conservamos solo metadatos inocuos de una configuración antigua.
  return { ...DEFAULT_OFFER, brand: value.brand || DEFAULT_OFFER.brand, promise: value.promise || DEFAULT_OFFER.promise };
}
function moduleKnowledge() { return Object.values(PRODUCT_MODULES).map(m => `${m.name}:\n- ${m.facts.join('\n- ')}`).join('\n\n'); }
function summarizeKnowledge(offerValue = {}) {
  const offer = normalizeOffer(offerValue); const basic = offer.plans.cliniqone; const ai = offer.plans.cliniqone_ai;
  return [
    `Marca: ${offer.brand}.`, `Propuesta: ${offer.promise}`,
    `PLAN 1 — ${basic.name}: $${basic.price_mxn.toLocaleString('es-MX')} MXN al mes. ${basic.description}`,
    `Incluye: ${BASE_FEATURES.join(', ')}.`,
    `PLAN 2 — ${ai.name}: $${ai.price_mxn.toLocaleString('es-MX')} MXN al mes. ${ai.description}`,
    `Funciones adicionales AI: ${AI_FEATURES.join(', ')}.`,
    `En ambos planes: doctores ${offer.doctors}, sucursales ${offer.branches} y pacientes ${offer.patients}; actualmente no hay cargo adicional por cantidad de doctores o sucursales.`,
    '', 'CONOCIMIENTO OFICIAL DEL PRODUCTO:', moduleKnowledge(), '',
    'REGLAS COMERCIALES Y DE PRECISIÓN:',
    '- Existen exactamente dos planes vigentes: CliniqOne $799 MXN/mes y CliniqOne AI $1,490 MXN/mes.',
    '- CliniqOne $799 contiene el sistema administrativo completo y mensajes manuales de WhatsApp; NO incluye recordatorios automáticos, asistentes virtuales de WhatsApp/Facebook/Instagram ni Hanna.',
    '- CliniqOne AI $1,490 incluye TODO lo del plan CliniqOne más recordatorios/confirmaciones automáticas, IA de WhatsApp, Facebook Messenger, Instagram y Hanna.',
    '- AI Sales pertenece a la empresa CliniqOne y vende CliniqOne; NO es una función o asistente que se entregue al doctor.',
    '- Hanna es el asistente personal interno por voz. Los asistentes de WhatsApp/Facebook/Instagram atienden pacientes. No mezcles sus funciones.',
    '- No cobres ni sugieras cargos adicionales por doctores o sucursales en la oferta actual.',
    '- No prometas mensajería, tokens o consumo de IA ilimitados. Tampoco inventes límites: si preguntan por políticas de uso no documentadas, indica que deben confirmarse.',
    '- Si preguntan por todos los módulos, enumera todas las capacidades relevantes sin omitir expediente, consentimientos, inventario, laboratorio, multisucursal y WhatsApp manual.',
    '- Laboratorios significa laboratorios DENTALES y seguimiento de trabajos; nunca análisis clínicos.',
    '- No afirmes funciones que no aparezcan en este conocimiento oficial.',
    `Competencia: ${COMPETITOR_POLICY.rule}`
  ].join('\n');
}
module.exports = { DEFAULT_OFFER, BASE_FEATURES, AI_FEATURES, PRODUCT_MODULES, COMPETITOR_POLICY, normalizeOffer, summarizeKnowledge, moduleKnowledge };

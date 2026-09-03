'use strict';

const PRODUCT = {
  brand: 'CliniqOne',
  promise: 'Tu clínica, todo en un solo lugar.',
  plans: [
    {
      key: 'basic',
      name: 'Básico',
      price_mxn: 890,
      branches: 1,
      doctors: 'ilimitados',
      features: ['Agenda inteligente','Caja básica de gastos/egresos','Expediente clínico + odontograma','WhatsApp: recordatorios y confirmaciones']
    },
    {
      key: 'medium',
      name: 'Medio',
      price_mxn: 1090,
      branches: 1,
      doctors: 'ilimitados',
      features: ['Todo lo del Básico','Inventario dental','Productividad y análisis','Metas y objetivos']
    },
    {
      key: 'complete',
      name: 'Normal (Completo)',
      price_mxn: 1290,
      branches: 1,
      doctors: 'ilimitados',
      features: ['Todos los módulos','Facturación CFDI','Laboratorio','Dashboard global','Reportes multi-sucursal']
    }
  ],
  launch_promo: { branches: 2, price_mxn: 1490, label: '2 sucursales por $1,490 MXN/mes' },
  whatsapp: { included_per_branch: 100, extra_message_mxn: 0.80 },
  invoicing: { per_invoice_mxn: 5, included_plan: 'complete' },
  modules: [
    ['Agenda inteligente','Citas sincronizadas, control de horarios y recordatorios.'],
    ['Caja y facturación','Ingresos/egresos y CFDI con Facturama en el plan completo.'],
    ['Productividad y análisis','Gráficas, ingresos por doctor y métodos de pago.'],
    ['Dashboard global','KPIs por sucursal: ingresos, gastos y rendimiento.'],
    ['Metas y objetivos','Seguimiento de objetivos con indicadores reales.'],
    ['Laboratorio','Trabajos, abonos, fechas de entrega y estatus.'],
    ['Inventario dental','Control de insumos, stock y reabasto.'],
    ['Expediente + odontograma','Historial clínico, tratamientos, notas y odontograma digital.'],
    ['Consentimientos digitales','Plantillas y aceptación/firma de consentimientos.'],
    ['WhatsApp automático','Recordatorios y confirmaciones de citas.'],
    ['Multi-sucursal','Varias sucursales dentro de una sola cuenta.'],
    ['IA recepcionista','Atención conversacional para resolver dudas y apoyar el flujo de citas en los canales configurados.']
  ]
};

const COMPETITOR_POLICY = {
  rule: 'Nunca inventes características, precios ni defectos de competidores. Si no existe una comparación verificada, explica las fortalezas comprobadas de CliniqOne y ofrece comparar punto por punto con lo que el prospecto usa.',
  verified: {}
};

function summarizeKnowledge() {
  const modules = PRODUCT.modules.map(([name, desc]) => `${name}: ${desc}`).join(' | ');
  return [
    `Marca: ${PRODUCT.brand}.`,
    `Propuesta: ${PRODUCT.promise}`,
    `Planes: Básico $890 MXN/mes; Medio $1,090 MXN/mes; Normal Completo $1,290 MXN/mes.`,
    `Promoción: ${PRODUCT.launch_promo.label}.`,
    `WhatsApp: ${PRODUCT.whatsapp.included_per_branch} mensajes/mes por sucursal; adicionales $${PRODUCT.whatsapp.extra_message_mxn.toFixed(2)} MXN.`,
    `CFDI: $${PRODUCT.invoicing.per_invoice_mxn} MXN por factura emitida dentro del plan completo.`,
    `Módulos: ${modules}.`,
    `Competencia: ${COMPETITOR_POLICY.rule}`
  ].join('\n');
}

module.exports = { PRODUCT, COMPETITOR_POLICY, summarizeKnowledge };

'use strict';

function number(value) {
  return Number(value || 0);
}

function plural(value, singular, pluralValue) {
  return Number(value) === 1 ? singular : pluralValue;
}

function greetingForTime(timeZone = process.env.F1_TIMEZONE || process.env.TZ || 'America/Tijuana') {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).format(new Date()));

  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function buildDailyBriefingText(report, ctx = {}) {
  const agenda = report?.agenda || {};
  const finance = report?.finance || {};
  const laboratory = report?.laboratory || {};
  const inventory = report?.inventory || {};
  const recommendations = Array.isArray(report?.recommendations) ? report.recommendations : [];

  const total = number(agenda.total);
  const confirmed = number(agenda.confirmed);
  const pending = number(agenda.pending);
  const cancelled = number(agenda.cancelled);
  const income = number(finance.income_today);
  const expenses = number(finance.expenses_today);
  const overdue = number(laboratory.overdue);
  const dueToday = number(laboratory.due_today);
  const outOfStock = number(inventory.out_of_stock);
  const lowStock = number(inventory.low_stock);

  const userName = String(ctx.user_name || '').trim();
  const greeting = `${greetingForTime(ctx.timezone)}${userName && userName !== 'Usuario' ? `, ${userName}` : ''}.`;

  const parts = [
    greeting,
    `Este es tu resumen de la sucursal actual.`,
    `Hoy tienes ${total} ${plural(total, 'cita', 'citas')}: ${confirmed} confirmadas, ${pending} pendientes y ${cancelled} canceladas.`,
  ];

  if (agenda.first_appointment?.start_time) {
    const patient = String(agenda.first_appointment.patient || 'paciente').trim();
    const time = String(agenda.first_appointment.start_time).slice(0, 5);
    parts.push(`La primera cita es a las ${time}, con ${patient}.`);
  }

  parts.push(`Los ingresos registrados hoy son ${income.toFixed(2)} pesos y los gastos son ${expenses.toFixed(2)} pesos.`);

  if (overdue > 0) {
    parts.push(`Atención: hay ${overdue} ${plural(overdue, 'trabajo de laboratorio vencido', 'trabajos de laboratorio vencidos')}.`);
  } else if (dueToday > 0) {
    parts.push(`Hay ${dueToday} ${plural(dueToday, 'trabajo de laboratorio para entregar hoy', 'trabajos de laboratorio para entregar hoy')}.`);
  } else {
    parts.push('No hay trabajos de laboratorio vencidos.');
  }

  if (outOfStock > 0) {
    parts.push(`Atención: hay ${outOfStock} ${plural(outOfStock, 'producto agotado', 'productos agotados')}.`);
  } else if (lowStock > 0) {
    parts.push(`Hay ${lowStock} ${plural(lowStock, 'producto con inventario bajo', 'productos con inventario bajo')}.`);
  } else {
    parts.push('No hay productos agotados ni alertas de inventario bajo.');
  }

  if (recommendations.length) {
    parts.push(`Recomendación: ${String(recommendations[0]).replace(/\.$/, '')}.`);
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

async function synthesizeDailyBriefing(input) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    const error = new Error('Falta OPENAI_API_KEY');
    error.statusCode = 503;
    throw error;
  }

  const text = String(input || '').trim();
  if (!text) {
    const error = new Error('El briefing está vacío');
    error.statusCode = 400;
    throw error;
  }

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.F1_TTS_MODEL || 'gpt-4o-mini-tts',
      voice: process.env.F1_TTS_VOICE || process.env.F1_VOICE || 'marin',
      input: text.slice(0, 4096),
      response_format: 'mp3',
      speed: Number(process.env.F1_TTS_SPEED || 1),
      instructions: 'Habla en español mexicano, con tono profesional, amable y ejecutivo. Lee cifras y horarios con claridad.',
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    const error = new Error(`OpenAI TTS ${response.status}: ${details}`);
    error.statusCode = response.status;
    throw error;
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: response.headers.get('content-type') || 'audio/mpeg',
  };
}

module.exports = {
  buildDailyBriefingText,
  synthesizeDailyBriefing,
};

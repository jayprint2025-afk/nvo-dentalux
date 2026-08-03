'use strict';

const { executeTool, localDate } = require('./management-tools');
const { tools } = require('./tool-definitions');

// Idempotencia de acciones Realtime por empresa + call_id.
// Evita ejecutar dos veces la misma herramienta cuando OpenAI emite
// response.output_item.done y después vuelve a incluirla en response.done.
const actionExecutions = new Map();

async function executeActionOnce(key, task) {
  if (!key) return task();
  const existing = actionExecutions.get(key);
  if (existing) return existing;

  const promise = Promise.resolve().then(task);
  actionExecutions.set(key, promise);
  setTimeout(() => {
    if (actionExecutions.get(key) === promise) actionExecutions.delete(key);
  }, 10 * 60 * 1000).unref?.();

  try {
    return await promise;
  } catch (error) {
    actionExecutions.delete(key);
    throw error;
  }
}

function parseArgs(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function buildContext(req, getTenantId, getSucursal) {
  return {
    tenant_id: getTenantId(req),
    branch_key: String(req.body?.branch_key || req.query?.branch_key || getSucursal(req) || 'sucursal_1'),
    timezone: process.env.F1_TIMEZONE || process.env.TZ || 'America/Tijuana',
    user_id: req.auth?.sub || null,
    user_name: req.auth?.name || req.auth?.email || 'Usuario',
  };
}

function instructions(ctx) {
  return `Eres F1, el Asistente Inteligente de gestión de CliniqOne. Hablas español mexicano, con voz profesional, clara y breve.
Tu usuario ya inició sesión en la empresa y sucursal actuales. Sucursal activa: ${ctx.branch_key}. Fecha local de hoy: ${localDate(ctx.timezone)}.
Puedes consultar agenda, doctores, servicios, disponibilidad, crear, buscar, reagendar y cancelar citas usando exclusivamente las herramientas disponibles.
No inventes identificadores, doctores, servicios, horarios ni resultados. Consulta herramientas cuando necesites datos reales.
Para crear una cita reúne paciente, servicio, fecha y hora; teléfono es recomendable pero no obligatorio para el usuario interno.
Distingue preguntas informativas de órdenes: “¿cómo agendo un paciente?” pide instrucciones y NO solicita crear una cita; “agenda/agéndame a...” sí es una orden de ejecución.
Antes de cancelar una cita pide confirmación explícita. Para crear o reagendar, confirma claramente el resultado después de que la herramienta responda.
No puedes crear empresas ni modificar empresas. Esa acción continúa reservada al superadministrador.
Cuando el usuario diga “mañana”, interpreta la fecha local de la clínica. Responde con texto y voz de forma natural y concisa.`;
}

function isHowToBookingQuestion(text) {
  const value = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  return /^(como|de que manera|que pasos|donde)\s+(agendo|agendar|programo|programar|creo|crear)\b/.test(value)
    || /\bcomo se (agenda|programa|crea) una cita\b/.test(value);
}

function bookingHelpReply() {
  return [
    'Para agendar un paciente en CliniqOne:',
    '1. Abre Agenda.',
    '2. Selecciona el día y horario.',
    '3. Presiona Nueva cita.',
    '4. Captura paciente, doctor, servicio, teléfono y duración.',
    '5. Guarda la cita.',
    '',
    'También puedes pedírmelo directamente, por ejemplo: “F1, agenda a Juan Pérez mañana a las 2 para limpieza”.'
  ].join('\n');
}

async function callChatModel({ messages, ctx }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Falta OPENAI_API_KEY');
  const model = process.env.F1_TEXT_MODEL || 'gpt-4.1-mini';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [{ role: 'system', content: instructions(ctx) }, ...messages],
      tools: tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
      tool_choice: 'auto',
    }),
  });
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
  return response.json();
}

function setupF1Routes(app, q, deps) {
  const { authRequired, getTenantId, getSucursal } = deps;
  app.use('/api/f1', authRequired);

  app.get('/api/f1/today-summary', async (req, res) => {
    try {
      const ctx = buildContext(req, getTenantId, getSucursal);
      const result = await executeTool(q, ctx, 'get_today_summary', { date: req.query.date, branch_key: req.query.branch_key });
      res.json(result);
    } catch (error) {
      res.status(error.statusCode || error.status || 500).json({ error: error.message });
    }
  });

  app.get('/api/f1/notifications', async (req, res) => {
    try {
      const ctx = buildContext(req, getTenantId, getSucursal);
      const summary = await executeTool(q, ctx, 'get_today_summary', {});
      const notifications = [];
      if (summary.counts.total) notifications.push({ id: `today-${summary.date}`, type: 'agenda', title: `${summary.counts.total} citas hoy`, message: `${summary.counts.confirmed} confirmadas y ${summary.counts.pending} pendientes.` });
      if (summary.counts.pending) notifications.push({ id: `pending-${summary.date}`, type: 'warning', title: 'Citas pendientes', message: `${summary.counts.pending} citas aún están pendientes.` });
      res.json({ notifications, summary });
    } catch (error) {
      res.status(error.statusCode || error.status || 500).json({ error: error.message });
    }
  });

  app.post('/api/f1/actions', async (req, res) => {
    try {
      const ctx = buildContext(req, getTenantId, getSucursal);
      const name = String(req.body?.name || '');
      const args = parseArgs(req.body?.arguments ?? req.body?.args);
      const callId = String(req.body?.call_id || req.body?.callId || '').trim();
      const actionKey = callId ? `${ctx.tenant_id}:${callId}` : null;
      const result = await executeActionOnce(
        actionKey,
        () => executeTool(q, ctx, name, args)
      );
      res.json({ ok: true, name, call_id: callId || null, result });
    } catch (error) {
      res.status(error.statusCode || error.status || 400).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/f1/chat', async (req, res) => {
    try {
      const ctx = buildContext(req, getTenantId, getSucursal);
      const text = String(req.body?.message || '').trim();
      if (!text) return res.status(400).json({ error: 'Mensaje vacío' });
      if (isHowToBookingQuestion(text)) {
        return res.json({ reply: bookingHelpReply(), actions: [] });
      }
      const history = Array.isArray(req.body?.history) ? req.body.history.slice(-12) : [];
      const messages = [...history, { role: 'user', content: text }];
      let payload = await callChatModel({ messages, ctx });
      let assistant = payload.choices?.[0]?.message || {};
      const toolCalls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
      const executed = [];

      if (toolCalls.length) {
        const follow = [...messages, assistant];
        for (const call of toolCalls) {
          const name = call.function?.name;
          const args = parseArgs(call.function?.arguments);
          try {
            const result = await executeTool(q, ctx, name, args);
            executed.push({ name, args, result });
            follow.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true, result }) });
          } catch (error) {
            executed.push({ name, args, error: error.message });
            follow.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: error.message }) });
          }
        }
        payload = await callChatModel({ messages: follow, ctx });
        assistant = payload.choices?.[0]?.message || {};
      }

      res.json({ reply: String(assistant.content || 'Listo.').trim(), actions: executed });
    } catch (error) {
      res.status(error.statusCode || error.status || 500).json({ error: error.message });
    }
  });

  app.post('/api/f1/realtime/call', require('express').text({ type: 'application/sdp', limit: '1mb' }), async (req, res) => {
    try {
      const ctx = buildContext(req, getTenantId, getSucursal);
      const key = process.env.OPENAI_API_KEY;
      if (!key) return res.status(503).json({ error: 'Falta OPENAI_API_KEY' });
      if (!req.body || typeof req.body !== 'string') return res.status(400).json({ error: 'Oferta SDP vacía' });

      const session = {
        type: 'realtime',
        model: process.env.F1_REALTIME_MODEL || 'gpt-realtime',
        instructions: instructions(ctx),
        output_modalities: ['audio'],
        audio: {
          input: {
            transcription: {
              model: process.env.F1_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
              language: 'es',
            },
            turn_detection: {
              type: 'semantic_vad',
              eagerness: 'medium',
              create_response: true,
              interrupt_response: true,
            },
          },
          output: { voice: process.env.F1_VOICE || 'marin', speed: 1 },
        },
        tools,
        tool_choice: 'auto',
        max_output_tokens: 700,
      };

      // Construir multipart/form-data manualmente para garantizar que OpenAI
      // reciba exactamente los campos `sdp` y `session` con sus content-types.
      const boundary = `----CliniqOneF1${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
      const multipartBody = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name=\"sdp\"\r\n` +
          `Content-Type: application/sdp\r\n\r\n`,
          'utf8'
        ),
        Buffer.from(req.body, 'utf8'),
        Buffer.from(
          `\r\n--${boundary}\r\n` +
          `Content-Disposition: form-data; name=\"session\"\r\n` +
          `Content-Type: application/json\r\n\r\n` +
          `${JSON.stringify(session)}\r\n` +
          `--${boundary}--\r\n`,
          'utf8'
        ),
      ]);

      console.log('🎙️ F1 Realtime: enviando oferta SDP', {
        tenant_id: ctx.tenant_id,
        branch_key: ctx.branch_key,
        sdp_bytes: Buffer.byteLength(req.body, 'utf8'),
        multipart_bytes: multipartBody.length,
      });

      const upstream = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(multipartBody.length),
        },
        body: multipartBody,
      });
      const body = await upstream.text();
      console.log('🎙️ F1 Realtime: respuesta OpenAI', {
        tenant_id: ctx.tenant_id,
        branch_key: ctx.branch_key,
        status: upstream.status,
        ok: upstream.ok,
      });
      if (!upstream.ok) return res.status(upstream.status).type('text/plain').send(body);
      const location = upstream.headers.get('location');
      if (location) res.setHeader('x-openai-call-location', location);
      res.status(201).type('application/sdp').send(body);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  console.log('✅ F1 Copilot: resumen, acciones, texto y voz Realtime activos');
}

module.exports = { setupF1Routes };

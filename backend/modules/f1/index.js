'use strict';

const { executeTool, localDate } = require('./management-tools');
const { tools } = require('./tool-definitions');
const { contextText, executeMemoryTool, observeToolResult, setSessionValue } = require('./memory-store');
const { buildOperationsReport } = require('./operations-director');
const { buildDailyBriefingText, synthesizeDailyBriefing } = require('./daily-briefing');
const { f1EventBus } = require('./event-bus');
const { realtimeVoiceProfile } = require('./voice-profile');

// Idempotencia de acciones Realtime por empresa + call_id.
// Evita ejecutar dos veces la misma herramienta cuando OpenAI emite
// response.output_item.done y después vuelve a incluirla en response.done.
const actionExecutions = new Map();


// ===== Wake phrase verifier (V14: HANA) =====
// El ONNX/VAD solo propone candidatos. La activación final se confirma
// transcribiendo una ventana corta y exigiendo que la frase EMPIECE con la
// palabra clave. Así podemos mantener un prefiltro sensible sin despertar por
// golpes, tos, conversaciones o palabras no relacionadas.
const wakeVerifyRate = new Map();

function normalizeWakeTranscript(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchWakePhrase(value) {
  const text = normalizeWakeTranscript(value);
  if (!text) return { accepted: false, normalized: text, phrase: '' };

  // V14: la única palabra de activación es "Hana" y debe aparecer al INICIO.
  // No aceptamos "Ana" como alias: en una clínica puede ser un nombre real y
  // causaría falsos positivos. El prompt del transcriptor sesga la ortografía
  // correcta hacia "Hana" cuando esa es realmente la palabra pronunciada.
  const match = /^hana\b/.test(text);
  return {
    accepted: match,
    normalized: text,
    phrase: match ? 'hana' : '',
  };
}

function pcm16Base64ToWav(base64, sampleRate) {
  const pcm = Buffer.from(String(base64 || ''), 'base64');
  if (!pcm.length || pcm.length % 2 !== 0) throw new Error('Audio PCM16 inválido');
  const sr = Number(sampleRate || 16000);
  if (sr !== 16000) throw new Error('Wake verifier requiere audio a 16 kHz');
  const maxBytes = sr * 2 * 5; // máximo 5 segundos mono PCM16
  if (pcm.length > maxBytes) throw new Error('Ventana de audio demasiado grande');
  if (pcm.length < sr * 2 * 0.20) throw new Error('Ventana de audio demasiado corta');

  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(sr, 24);
  wav.writeUInt32LE(sr * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}

function allowWakeVerifyAttempt(ctx) {
  const key = `${ctx.tenant_id || 'tenant'}:${ctx.user_id || 'user'}:${ctx.branch_key || 'branch'}`;
  const now = Date.now();
  const state = wakeVerifyRate.get(key) || { windowStart: now, count: 0, lastAt: 0 };
  if (now - state.windowStart >= 60_000) {
    state.windowStart = now;
    state.count = 0;
  }
  if (now - state.lastAt < 250) return false;
  if (state.count >= 40) return false;
  state.lastAt = now;
  state.count += 1;
  wakeVerifyRate.set(key, state);
  return true;
}

async function transcribeWakeCandidate(wavBuffer) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Falta OPENAI_API_KEY');
  const model = process.env.F1_WAKE_TRANSCRIBE_MODEL || process.env.F1_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
  const boundary = `----CliniqOneWake${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const field = (name, value) => Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    'utf8'
  );
  const body = Buffer.concat([
    field('model', model),
    field('language', 'es'),
    field('prompt', 'Transcribe literalmente en español. La palabra clave posible es “Hana”, escrita H-A-N-A. Si realmente escuchas esa palabra al inicio, escríbela exactamente como Hana. No conviertas otros sonidos en Hana y no completes ni inventes palabras si el audio contiene ruido, respiración, golpes o silencio.'),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="wake.wav"\r\nContent-Type: audio/wav\r\n\r\n`, 'utf8'),
    wavBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);

  const upstream = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
  });
  const text = await upstream.text();
  if (!upstream.ok) throw new Error(`Wake transcription ${upstream.status}: ${text.slice(0, 500)}`);
  let parsed = {};
  try { parsed = JSON.parse(text); } catch {}
  return String(parsed?.text || '').trim();
}

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
    authorization: String(req.headers?.authorization || ''),
  };
}

function instructions(ctx, memoryContext = '') {
  return `Eres F1, el Asistente Inteligente de gestión de CliniqOne. Hablas español mexicano, con voz profesional, clara y breve.
Tu usuario ya inició sesión en la empresa y sucursal actuales. Sucursal activa: ${ctx.branch_key}. Fecha local de hoy: ${localDate(ctx.timezone)}.
Puedes consultar agenda, doctores, servicios, disponibilidad, crear, buscar, reagendar y cancelar citas; también puedes analizar la operación diaria mediante el reporte de operaciones.
También puedes consultar ingresos, gastos, neto, métodos de pago y pagos recientes; registrar, corregir y eliminar pagos/gastos con confirmación; cambiar estados y editar citas; administrar doctores y servicios; gestionar laboratorios, trabajos y abonos; administrar inventario completo; consultar y actualizar expediente clínico, historia, odontograma, tratamientos y consentimientos; gestionar Productividad/Objetivos por doctor; administrar clientes y catálogo fiscal, configuración de facturación, facturas y conceptos; y enviar mensajes por WhatsApp cuando el canal esté configurado.
No inventes identificadores, doctores, servicios, horarios ni resultados. Consulta herramientas cuando necesites datos reales.
Para crear una cita reúne paciente, servicio, fecha y hora; teléfono es recomendable pero no obligatorio para el usuario interno.
Distingue preguntas informativas de órdenes: “¿cómo agendo un paciente?” pide instrucciones y NO solicita crear una cita; “agenda/agéndame a...” sí es una orden de ejecución.
Antes de cancelar una cita pide confirmación explícita. Para crear o reagendar, confirma claramente el resultado después de que la herramienta responda.
Para registrar pagos o gastos, llama primero la herramienta con confirmed=false y espera confirmación explícita. Solo después ejecútala con confirmed=true.
Regla crítica de ingresos: un pago ligado a una cita solo puede registrarse si la cita está Atendida/Completada. Si está Pendiente o Confirmada, explica cordialmente el requisito, ofrece cambiarla a Atendida y, si el usuario acepta, ejecuta primero update_appointment_status y después continúa el pago.
Trabaja como asistente operativo por objetivos: si una orden requiere varios pasos o faltan datos, no abandones. Consulta herramientas, pide únicamente el dato faltante y continúa hasta completar el objetivo. Nunca digas que una acción quedó hecha si una herramienta no devolvió éxito.
Para historial operativo usa get_patient_history/get_patient_last_visit. Para expediente clínico usa get_medical_record y las herramientas médicas; jamás inventes antecedentes, alergias, diagnósticos, odontograma o tratamientos.
Inventario: si preguntan por críticos/bajos usa get_inventory_alerts. Crítico significa cantidad 0 o menor; bajo significa cantidad mayor a 0 y menor o igual al mínimo. Si piden un producto específico usa get_inventory_item. Si piden agregar un producto inexistente usa create_inventory_item; si la herramienta devuelve needs_input pregunta únicamente lo faltante y continúa.
Para laboratorio identifica laboratorio/trabajo antes de modificarlo. Distingue entre abonos del trabajo (lab_abonos) y pagos realmente hechos al laboratorio (pagos_laboratorio/TBE); usa las herramientas específicas para cada caso.
Para WhatsApp puedes usar send_whatsapp_to_patient si te dan nombre o send_whatsapp_message si te dan teléfono. También puedes revisar estado, historial, estadísticas, buscar citas por teléfono, enviar plantillas y enviar confirmaciones en lote. Los envíos masivos requieren confirmación explícita.
Sucursales y dashboard: puedes listar sucursales, cambiar la sucursal del cliente mediante select_branch y comparar indicadores entre sucursales. Nunca mezcles datos de tenants.
Inventario por fórmula: cuando el usuario diga que un tratamiento consumió varios materiales, usa apply_inventory_formula para descontarlos juntos y reporta faltantes.
Productividad: para preguntas de metas, avance, ingresos, gastos, neto, faltante o comisión usa las herramientas de productividad. Si el usuario nombra al doctor pero no su ID, primero usa list_doctors. No inventes porcentajes ni metas.
Facturación: antes de crear una factura reúne cliente, tipo y al menos un concepto o un total coherente. Para datos fiscales faltantes usa las herramientas de clientes/configuración y pregunta solo lo imprescindible. Timbrar, cancelar o eliminar facturas exige confirmación explícita. Nunca afirmes que un CFDI fue timbrado si el conector PAC real no devolvió éxito y UUID/CFDI válido.
Para acciones destructivas o correcciones financieras exige confirmación explícita cuando la herramienta lo indique. Si una operación está bloqueada por relaciones de datos, explica el motivo y ofrece la alternativa segura.
No puedes crear empresas ni modificar empresas. Esa acción continúa reservada al superadministrador.
Cuando el usuario diga “mañana”, interpreta la fecha local de la clínica. Responde con texto y voz de forma natural y concisa.
Comportamiento de voz profesional: prioriza respuestas habladas de 1 a 4 frases cuando la tarea ya quedó resuelta; si hay muchos datos, resume primero y ofrece el dato esencial sin recitar tablas completas. Nunca termines una frase a la mitad ni cierres una respuesta con una idea incompleta. Si necesitas más espacio para explicar, termina primero la oración actual y continúa de forma breve.
Tolerancia a pausas: una pausa natural, respiración, duda, muletilla o silencio breve dentro de una instrucción no significa necesariamente que el usuario terminó. Interpreta el mensaje completo antes de actuar y no te precipites por fragmentos parciales.
Ruido ambiental: ignora golpes, respiración, instrumental, conversaciones lejanas, sílabas aisladas, transcripciones sin sentido y fragmentos que no expresen una intención clara. No ejecutes herramientas ni confirmes acciones basándote únicamente en ruido o texto incompleto.
Palabra clave de activación: “Hana”. Una vez que la sesión Realtime ya está activa, no exijas repetir la palabra clave para cada instrucción.
Usa la memoria solo como contexto; nunca inventes datos faltantes. Si el usuario dice explícitamente “recuerda”, “guarda esta preferencia” u “olvida”, usa las herramientas de memoria. No guardes información clínica sensible como memoria permanente salvo petición explícita.

${memoryContext}`;
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

async function callChatModel({ messages, ctx, memoryContext = '' }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Falta OPENAI_API_KEY');
  const model = process.env.F1_TEXT_MODEL || 'gpt-4.1-mini';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [{ role: 'system', content: instructions(ctx, memoryContext) }, ...messages],
      tools: tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
      tool_choice: 'auto',
    }),
  });
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
  return response.json();
}

async function executeF1Tool(q, ctx, name, args = {}) {
  const memoryResult = await executeMemoryTool(q, ctx, name, args);
  if (memoryResult) return memoryResult;
  const result = await executeTool(q, ctx, name, args);
  observeToolResult(ctx, name, args, result);
  return result;
}

function setupF1Routes(app, q, deps) {
  const { authRequired, getTenantId, getSucursal } = deps;
  app.use('/api/f1', authRequired);

  // F1-011B: historial reciente del Event Bus, aislado por empresa y sucursal.
  // Sirve para validar que Agenda está publicando sus movimientos.
  app.get('/api/f1/events', async (req, res) => {
    try {
      const ctx = buildContext(req, getTenantId, getSucursal);
      const events = f1EventBus.getHistory({
        tenant_id: ctx.tenant_id,
        branch_key: req.query.branch_key || ctx.branch_key,
        name: req.query.name || '',
        limit: req.query.limit || 50,
      });
      res.json({
        ok: true,
        tenant_id: ctx.tenant_id,
        branch_key: req.query.branch_key || ctx.branch_key,
        events,
      });
    } catch (error) {
      res.status(error.statusCode || error.status || 500).json({ error: error.message });
    }
  });

  // F1-011C: stream SSE autenticado y aislado por empresa + sucursal.
  app.get('/api/f1/events/stream', (req, res) => {
    let unsubscribe = null;
    let heartbeat = null;

    try {
      const ctx = buildContext(req, getTenantId, getSucursal);
      const branchKey = String(req.query.branch_key || ctx.branch_key || 'sucursal_1');

      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      const send = (eventName, payload) => {
        if (res.writableEnded || res.destroyed) return;
        res.write(`event: ${eventName}\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      send('connected', {
        ok: true,
        tenant_id: ctx.tenant_id,
        branch_key: branchKey,
        connected_at: new Date().toISOString(),
      });

      unsubscribe = f1EventBus.on(
        '*',
        (event) => send('f1-event', event),
        {
          tenant_id: ctx.tenant_id,
          branch_key: branchKey,
        }
      );

      heartbeat = setInterval(() => {
        if (!res.writableEnded && !res.destroyed) {
          res.write(`: heartbeat ${Date.now()}\n\n`);
        }
      }, 25000);
      heartbeat.unref?.();

      const cleanup = () => {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
      };

      req.on('close', cleanup);
      req.on('aborted', cleanup);
      res.on('close', cleanup);
      res.on('finish', cleanup);
    } catch (error) {
      if (!res.headersSent) {
        res.status(error.statusCode || error.status || 500).json({ error: error.message });
      } else if (!res.writableEnded) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      }
      if (unsubscribe) unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    }
  });

  app.get('/api/f1/today-summary', async (req, res) => {
    try {
      const ctx = buildContext(req, getTenantId, getSucursal);
      const result = await executeF1Tool(q, ctx, 'get_today_summary', { date: req.query.date, branch_key: req.query.branch_key });
      res.json(result);
    } catch (error) {
      res.status(error.statusCode || error.status || 500).json({ error: error.message });
    }
  });

  app.get('/api/f1/notifications', async (req, res) => {
    try {
      const ctx = buildContext(req, getTenantId, getSucursal);
      const report = await buildOperationsReport(q, ctx, {
        date: req.query.date,
        branch_key: req.query.branch_key,
      });
      res.json({
        notifications: report.alerts,
        summary: {
          date: report.date,
          branch_key: report.branch_key,
          counts: report.agenda,
          first_appointment: report.agenda.first_appointment,
        },
        operations_report: report,
      });
    } catch (error) {
      res.status(error.statusCode || error.status || 500).json({ error: error.message });
    }
  });

  app.get('/api/f1/operations-report', async (req, res) => {
    try {
      const ctx = buildContext(req, getTenantId, getSucursal);
      const report = await buildOperationsReport(q, ctx, {
        date: req.query.date,
        branch_key: req.query.branch_key,
      });
      res.json(report);
    } catch (error) {
      res.status(error.statusCode || error.status || 500).json({ error: error.message });
    }
  });

  // F1-010 Paso 1: genera el texto del briefing diario.
  // Todavía no se reproduce automáticamente; eso se conectará en el Paso 2.
  app.get('/api/f1/daily-briefing', async (req, res) => {
    try {
      const ctx = buildContext(req, getTenantId, getSucursal);
      const report = await buildOperationsReport(q, ctx, {
        date: req.query.date,
        branch_key: req.query.branch_key,
      });
      const briefing = buildDailyBriefingText(report, ctx);
      res.json({
        ok: true,
        date: report.date,
        tenant_id: ctx.tenant_id,
        branch_key: report.branch_key,
        briefing,
        highest_priority: report.highest_priority,
      });
    } catch (error) {
      res.status(error.statusCode || error.status || 500).json({ error: error.message });
    }
  });

  // Genera el MP3 en el backend para no exponer OPENAI_API_KEY al navegador.
  app.post('/api/f1/daily-briefing/audio', async (req, res) => {
    try {
      const ctx = buildContext(req, getTenantId, getSucursal);
      const report = await buildOperationsReport(q, ctx, {
        date: req.body?.date,
        branch_key: req.body?.branch_key,
      });
      const briefing = buildDailyBriefingText(report, ctx);
      const audio = await synthesizeDailyBriefing(briefing);

      res.setHeader('Content-Type', audio.contentType);
      res.setHeader('Content-Length', String(audio.buffer.length));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-F1-Briefing-Date', report.date);
      res.status(200).send(audio.buffer);
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
        () => executeF1Tool(q, ctx, name, args)
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
      setSessionValue(ctx, 'last_user_message', text, 'user');
      const memoryContext = await contextText(q, ctx);
      if (isHowToBookingQuestion(text)) {
        return res.json({ reply: bookingHelpReply(), actions: [] });
      }
      const history = Array.isArray(req.body?.history) ? req.body.history.slice(-12) : [];
      const messages = [...history, { role: 'user', content: text }];
      const conversation = [...messages];
      const executed = [];
      let assistant = {};

      // Un comando escrito puede requerir varias herramientas consecutivas:
      // por ejemplo listar servicios -> consultar disponibilidad -> crear cita.
      // Procesar hasta que el modelo entregue texto final evita responder “Listo”
      // antes de que la acción realmente se haya ejecutado.
      for (let round = 0; round < 6; round += 1) {
        const payload = await callChatModel({ messages: conversation, ctx, memoryContext });
        assistant = payload.choices?.[0]?.message || {};
        conversation.push(assistant);

        const toolCalls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
        if (!toolCalls.length) break;

        for (const call of toolCalls) {
          const name = call.function?.name;
          const args = parseArgs(call.function?.arguments);
          const callId = String(call.id || '').trim();
          const actionKey = callId ? `${ctx.tenant_id}:text:${callId}` : null;
          try {
            const result = await executeActionOnce(
              actionKey,
              () => executeF1Tool(q, ctx, name, args)
            );
            executed.push({ name, args, call_id: callId || null, result });
            conversation.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify({ ok: true, result }),
            });
          } catch (error) {
            executed.push({ name, args, call_id: callId || null, error: error.message });
            conversation.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify({ ok: false, error: error.message }),
            });
          }
        }
      }

      const successfulMessages = executed
        .map(action => action?.result?.assistant_message)
        .filter(Boolean);
      const modelReply = String(assistant?.content || '').trim();
      const reply = successfulMessages.length
        ? String(successfulMessages[successfulMessages.length - 1])
        : modelReply || (executed.length ? 'La acción fue procesada.' : 'No pude completar la solicitud.');

      res.json({ reply, actions: executed });
    } catch (error) {
      res.status(error.statusCode || error.status || 500).json({ error: error.message });
    }
  });


  app.post('/api/f1/wake/verify', async (req, res) => {
    try {
      const ctx = buildContext(req, getTenantId, getSucursal);
      if (!allowWakeVerifyAttempt(ctx)) {
        return res.status(429).json({ ok: false, accepted: false, reason: 'rate_limited' });
      }
      const wav = pcm16Base64ToWav(req.body?.pcm16_base64, req.body?.sample_rate || 16000);
      const transcript = await transcribeWakeCandidate(wav);
      const match = matchWakePhrase(transcript);
      res.json({
        ok: true,
        accepted: match.accepted,
        transcript,
        normalized: match.normalized,
        phrase: match.phrase || null,
        reason: match.accepted ? 'wake_phrase_verified' : 'wake_phrase_missing',
      });
    } catch (error) {
      // Falla cerrada: si no podemos verificar, NO activamos F1.
      res.status(error.statusCode || error.status || 503).json({
        ok: false,
        accepted: false,
        reason: 'verification_unavailable',
        error: error.message,
      });
    }
  });

  app.get('/api/f1/realtime/profile', (req, res) => {
    const profile = realtimeVoiceProfile();
    res.json({
      ok: true,
      profile: 'professional-v6',
      wake_words: ['Hana'],
      vad: { type: 'semantic_vad', eagerness: profile.vadEagerness, interrupt_response: false },
      noise_reduction: profile.noiseReduction,
      max_output_tokens: profile.maxOutputTokens,
      voice_speed: profile.voiceSpeed,
      note: 'V14 usa HANA como única palabra de activación. El cliente propone candidatos de voz y /api/f1/wake/verify autoriza únicamente transcripciones que empiecen con Hana.',
    });
  });

  app.post('/api/f1/realtime/call', require('express').text({ type: 'application/sdp', limit: '1mb' }), async (req, res) => {
    try {
      const ctx = buildContext(req, getTenantId, getSucursal);
      const key = process.env.OPENAI_API_KEY;
      if (!key) return res.status(503).json({ error: 'Falta OPENAI_API_KEY' });
      if (!req.body || typeof req.body !== 'string') return res.status(400).json({ error: 'Oferta SDP vacía' });
      const memoryContext = await contextText(q, ctx);

      const voiceProfile = realtimeVoiceProfile();
      const session = {
        type: 'realtime',
        model: process.env.F1_REALTIME_MODEL || 'gpt-realtime',
        instructions: instructions(ctx, memoryContext),
        output_modalities: ['audio'],
        audio: {
          input: {
            transcription: {
              model: process.env.F1_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
              language: 'es',
              // Ayuda a reconocer correctamente la palabra clave y términos propios
              // sin forzarla cuando solo existe ruido ambiental.
              prompt: process.env.F1_TRANSCRIBE_PROMPT || 'CliniqOne. F1. Efe uno. Agenda, pacientes, doctores, tratamientos, inventario, laboratorio y WhatsApp.',
            },
            noise_reduction: {
              type: voiceProfile.noiseReduction,
            },
            turn_detection: {
              type: 'semantic_vad',
              // LOW es deliberado: tolera pausas naturales y reduce cortes
              // prematuros en instrucciones largas o dictadas con calma.
              eagerness: voiceProfile.vadEagerness,
              create_response: true,
              // El ruido ambiental no debe interrumpir una respuesta en curso.
              interrupt_response: false,
            },
          },
          output: {
            voice: process.env.F1_VOICE || 'marin',
            speed: voiceProfile.voiceSpeed,
          },
        },
        tools,
        tool_choice: 'auto',
        // 700 podía truncar audio antes de terminar una frase. Dejamos margen
        // amplio y controlamos la concisión desde las instrucciones, no por corte duro.
        max_output_tokens: voiceProfile.maxOutputTokens,
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

  console.log('✅ F1 Copilot: contexto multiempresa, resumen, acciones, texto y voz Realtime activos');
}

module.exports = { setupF1Routes };

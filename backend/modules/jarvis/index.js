'use strict';

const express = require('express');
const { tools: rawTools } = require('./jarvis-tool-definitions');
const { executeTool, ensurePersonalTables } = require('./jarvis-management-tools');
const { jarvisInstructions } = require('./jarvis-instructions');

const BLOCKED_REALTIME_TOOLS = new Set([
  'list_whatsapp_messages',
  'send_whatsapp_to_patient',
]);

const tools = (Array.isArray(rawTools) ? rawTools : []).filter((tool) =>
  tool &&
  typeof tool.name === 'string' &&
  !BLOCKED_REALTIME_TOOLS.has(tool.name)
);

function realtimeToolNames() {
  return tools.map((tool) => tool.name);
}

function buildContext(req, getTenantId, getSucursal) {
  return {
    tenant_id: getTenantId(req),
    branch_key: String(req.body?.branch_key || req.query?.branch_key || getSucursal(req) || 'sucursal_1'),
    user_id: req.auth?.sub || null,
    user_name: req.auth?.name || req.auth?.email || 'Usuario',
    authorization: String(req.headers?.authorization || ''),
    timezone: process.env.JARVIS_TIMEZONE || process.env.F1_TIMEZONE || process.env.TZ || 'America/Tijuana',
  };
}

function normalizeWake(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function transcribeWake(wavBuffer) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Falta OPENAI_API_KEY');
  const model = process.env.JARVIS_TRANSCRIBE_MODEL || process.env.F1_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
  const boundary = `----JarvisWake${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const field = (name, value) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8');
  const body = Buffer.concat([
    field('model', model), field('language', 'es'),
    field('prompt', 'Transcribe literalmente. La palabra clave posible es â€œJARVISâ€. No inventes JARVIS ante silencio, ruido, respiraciÃ³n o golpes.'),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="wake.wav"\r\nContent-Type: audio/wav\r\n\r\n`, 'utf8'),
    wavBuffer, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);
  const upstream = await fetch('https://api.openai.com/v1/audio/transcriptions', { method:'POST', headers:{Authorization:`Bearer ${key}`,'Content-Type':`multipart/form-data; boundary=${boundary}`,'Content-Length':String(body.length)}, body });
  const text = await upstream.text();
  if (!upstream.ok) throw new Error(`Wake transcription ${upstream.status}: ${text.slice(0,300)}`);
  try { return String(JSON.parse(text)?.text || '').trim(); } catch { return ''; }
}

function pcm16Base64ToWav(base64, sampleRate=16000) {
  const pcm = Buffer.from(String(base64 || ''), 'base64');
  const sr = Number(sampleRate || 16000);
  if (!pcm.length || pcm.length % 2) throw new Error('Audio PCM16 invÃ¡lido');
  if (sr !== 16000) throw new Error('Wake verifier requiere 16 kHz');
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF',0); wav.writeUInt32LE(36+pcm.length,4); wav.write('WAVE',8); wav.write('fmt ',12);
  wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(sr,24);
  wav.writeUInt32LE(sr*2,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36);
  wav.writeUInt32LE(pcm.length,40); pcm.copy(wav,44); return wav;
}

function setupJarvisRoutes(app, q, deps={}) {
  const { authRequired, getTenantId, getSucursal } = deps;
  if (!app || typeof q !== 'function' || !authRequired || !getTenantId || !getSucursal) throw new Error('Dependencias JARVIS incompletas');

  app.use('/api/jarvis', authRequired);

  app.get('/api/jarvis/health', (req,res) => res.json({ ok:true, service:'jarvis', central_connected:true, wake_word:'JARVIS', voice:'realtime-v1' }));

  // Agenda personal y recordatorios propios de JARVIS.
  app.get('/api/jarvis/personal/dashboard', async (req,res) => {
    try {
      const ctx=buildContext(req,getTenantId,getSucursal); await ensurePersonalTables(q);
      const ev=await q(`SELECT * FROM jarvis_personal_events WHERE tenant_id=$1::uuid AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND status<>'cancelled' AND start_at>=NOW()-interval '1 day' ORDER BY start_at LIMIT 100`,[ctx.tenant_id,ctx.user_id||null]);
      const rr=await q(`SELECT * FROM jarvis_personal_reminders WHERE tenant_id=$1::uuid AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND status NOT IN ('cancelled','acknowledged') AND remind_at>=NOW()-interval '1 day' ORDER BY remind_at LIMIT 100`,[ctx.tenant_id,ctx.user_id||null]);
      res.json({ok:true,events:ev.rows,reminders:rr.rows});
    } catch(error){ res.status(500).json({ok:false,error:error.message}); }
  });

  // Devuelve avisos vencidos una sola vez: primer aviso y, si no hubo ACK, una insistencia 5 min despuÃ©s.
  app.get('/api/jarvis/personal/due', async (req,res) => {
    try {
      const ctx=buildContext(req,getTenantId,getSucursal); await ensurePersonalTables(q);
      const first=await q(`UPDATE jarvis_personal_reminders SET notified_at=NOW(),updated_at=NOW() WHERE id IN (SELECT id FROM jarvis_personal_reminders WHERE tenant_id=$1::uuid AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND status='pending' AND acknowledged_at IS NULL AND notified_at IS NULL AND remind_at<=NOW() ORDER BY remind_at LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING *, 'first'::text AS alert_kind`,[ctx.tenant_id,ctx.user_id||null]);
      const insist=await q(`UPDATE jarvis_personal_reminders SET insisted_at=NOW(),updated_at=NOW() WHERE id IN (SELECT id FROM jarvis_personal_reminders WHERE tenant_id=$1::uuid AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND status='pending' AND acknowledged_at IS NULL AND notified_at IS NOT NULL AND insisted_at IS NULL AND insist_at<=NOW() ORDER BY insist_at LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING *, 'insist'::text AS alert_kind`,[ctx.tenant_id,ctx.user_id||null]);
      const alerts=[...first.rows,...insist.rows];
      res.json({ok:true,alerts});
    } catch(error){ res.status(500).json({ok:false,error:error.message}); }
  });

  app.post('/api/jarvis/personal/acknowledge', async (req,res) => {
    try { const ctx=buildContext(req,getTenantId,getSucursal); const result=await executeTool(q,ctx,'personal_acknowledge',req.body||{}); res.json(result); }
    catch(error){ res.status(400).json({ok:false,error:error.message}); }
  });

  app.post('/api/jarvis/actions', async (req,res) => {
    try {
      const ctx = buildContext(req,getTenantId,getSucursal);
      const name = String(req.body?.name || '');
      const args = typeof req.body?.arguments === 'string' ? JSON.parse(req.body.arguments || '{}') : (req.body?.arguments || req.body?.args || {});

      // Guardia central: aunque una sesiÃ³n vieja/cachÃ© intente usar herramientas
      // clÃ­nicas para resolver contactos, JARVIS no las ejecutarÃ¡.
      if (name === 'list_whatsapp_messages' || name === 'send_whatsapp_to_patient') {
        console.warn('[JARVIS ACTION BLOCKED]', { name, reason: 'Use JARVIS WhatsApp contacts first' });
        return res.status(409).json({
          ok:false,
          error:'Esta acciÃ³n no estÃ¡ disponible para resolver contactos de JARVIS. Use find_whatsapp_contact y despuÃ©s send_whatsapp_message.'
        });
      }

      console.log('[JARVIS ACTION]', { name, args });
      const result = await executeTool(q, ctx, name, args);
      res.json({ok:true,name,result});
    } catch(error) { res.status(error.statusCode || error.status || 400).json({ok:false,error:error.message}); }
  });

  app.post('/api/jarvis/wake/verify', async (req,res) => {
    try {
      const wav = pcm16Base64ToWav(req.body?.pcm16_base64, req.body?.sample_rate || 16000);
      const transcript = await transcribeWake(wav);
      const normalized = normalizeWake(transcript);
      const accepted = /^jarvis\b/.test(normalized);
      res.json({ok:true,accepted,transcript,normalized,phrase:accepted?'jarvis':null});
    } catch(error) { res.status(503).json({ok:false,accepted:false,error:error.message}); }
  });

  app.get('/api/jarvis/realtime/profile', (req,res) => res.json({ok:true,wake_words:['JARVIS'],voice:process.env.JARVIS_VOICE || process.env.F1_VOICE || 'marin',model:process.env.JARVIS_REALTIME_MODEL || process.env.F1_REALTIME_MODEL || 'gpt-realtime'}));


  // Fish Audio TTS: la API key permanece exclusivamente en el backend.
  app.post('/api/jarvis/tts', express.json({limit:'64kb'}), async (req,res) => {
    try {
      const key = process.env.FISH_API_KEY;
      const referenceId = process.env.FISH_REFERENCE_ID;
      const model = process.env.FISH_TTS_MODEL || 's2.1-pro';
      const text = String(req.body?.text || '').replace(/\s+/g,' ').trim();
      if (!key) return res.status(503).json({ok:false,error:'Falta FISH_API_KEY'});
      if (!referenceId) return res.status(503).json({ok:false,error:'Falta FISH_REFERENCE_ID'});
      if (!text) return res.status(400).json({ok:false,error:'Texto vacÃ­o'});
      if (text.length > 5000) return res.status(400).json({ok:false,error:'Texto demasiado largo'});

      const upstream = await fetch('https://api.fish.audio/v1/tts', {
        method:'POST',
        headers:{
          Authorization:`Bearer ${key}`,
          'Content-Type':'application/json',
          model,
        },
        body:JSON.stringify({
          text,
          reference_id:referenceId,
          format:'mp3',
          sample_rate:44100,
          mp3_bitrate:128,
          latency:process.env.FISH_TTS_LATENCY || 'balanced',
          temperature:Number(process.env.FISH_TTS_TEMPERATURE || 0.7),
          top_p:Number(process.env.FISH_TTS_TOP_P || 0.7),
          prosody:{
            speed:Number(process.env.FISH_TTS_SPEED || 1),
            volume:Number(process.env.FISH_TTS_VOLUME || 0),
            normalize_loudness:true,
          },
          normalize:true,
        }),
      });
      if (!upstream.ok) {
        const detail = await upstream.text().catch(()=> '');
        console.error('[JARVIS FISH TTS]', upstream.status, detail.slice(0,500));
        return res.status(upstream.status).json({ok:false,error:`Fish TTS ${upstream.status}`,detail:detail.slice(0,500)});
      }
      const audio = Buffer.from(await upstream.arrayBuffer());
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
      res.setHeader('Content-Length', String(audio.length));
      res.setHeader('Cache-Control','no-store');
      return res.status(200).send(audio);
    } catch(error) {
      console.error('[JARVIS FISH TTS ERROR]', error);
      return res.status(500).json({ok:false,error:error.message});
    }
  });

  app.post('/api/jarvis/realtime/call', express.text({type:'application/sdp',limit:'1mb'}), async (req,res) => {
    try {
      const ctx = buildContext(req,getTenantId,getSucursal);
      const key = process.env.OPENAI_API_KEY;
      if (!key) return res.status(503).json({error:'Falta OPENAI_API_KEY'});
      if (!req.body || typeof req.body !== 'string') return res.status(400).json({error:'Oferta SDP vacÃ­a'});
      console.log('[JARVIS REALTIME TOOLS]', realtimeToolNames());

      const session = {
        type:'realtime', model:process.env.JARVIS_REALTIME_MODEL || process.env.F1_REALTIME_MODEL || 'gpt-realtime',
        instructions:jarvisInstructions(ctx), output_modalities:['audio'],
        audio:{input:{transcription:{model:process.env.JARVIS_TRANSCRIBE_MODEL || process.env.F1_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',language:'es',prompt:'JARVIS. Asistente personal y empresarial. Agenda, recordatorios, correo, WhatsApp, llamadas e Internet.'},noise_reduction:{type:'near_field'},turn_detection:{type:'semantic_vad',eagerness:'low',create_response:true,interrupt_response:false}},output:{voice:process.env.JARVIS_VOICE || process.env.F1_VOICE || 'marin',speed:1.0}},
        tools, tool_choice:'auto', max_output_tokens:4000,
      };
      const boundary=`----JarvisRealtime${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
      const body=Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="sdp"\r\nContent-Type: application/sdp\r\n\r\n`),Buffer.from(req.body),
        Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="session"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(session)}\r\n--${boundary}--\r\n`)
      ]);
      const upstream=await fetch('https://api.openai.com/v1/realtime/calls',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':`multipart/form-data; boundary=${boundary}`,'Content-Length':String(body.length)},body});
      const answer=await upstream.text();
      if(!upstream.ok) return res.status(upstream.status).type('text/plain').send(answer);
      res.status(201).type('application/sdp').send(answer);
    } catch(error){res.status(500).json({error:error.message});}
  });

  const names = realtimeToolNames();
  console.log('[JARVIS CORE TOOLS]', names);
  if (!names.includes('find_whatsapp_contact') || !names.includes('send_whatsapp_message')) {
    console.error('[JARVIS CORE ERROR] Faltan herramientas propias de WhatsApp:', {
      find_whatsapp_contact: names.includes('find_whatsapp_contact'),
      send_whatsapp_message: names.includes('send_whatsapp_message')
    });
  }
  console.log('âœ… JARVIS Core V3: filtro central de tools + agenda personal + recordatorios + WhatsApp JARVIS');
}

module.exports={setupJarvisRoutes};


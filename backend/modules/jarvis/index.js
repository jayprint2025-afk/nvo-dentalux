'use strict';

const express = require('express');
const { tools } = require('../f1/tool-definitions');
const { executeTool } = require('../f1/management-tools');
const { jarvisInstructions } = require('./jarvis-instructions');
const { jarvisTools } = require('./jarvis-tools');
const { executeJarvisPersonalTool, ensureJarvisPersonalSchema } = require('./jarvis-personal-agenda');

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
    field('prompt', 'Transcribe literalmente. La palabra clave posible es “JARVIS”. No inventes JARVIS ante silencio, ruido, respiración o golpes.'),
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
  if (!pcm.length || pcm.length % 2) throw new Error('Audio PCM16 inválido');
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

  // JARVIS Personal V1 — agenda ejecutiva + recordatorios persistentes
  ensureJarvisPersonalSchema(q).catch((error) => {
    console.error('❌ No se pudo preparar JARVIS Personal V1:', error);
  });

  app.get('/api/jarvis/health', (req,res) => res.json({ ok:true, service:'jarvis', central_connected:true, wake_word:'JARVIS', voice:'realtime-v1' }));

  app.post('/api/jarvis/actions', async (req,res) => {
    try {
      const ctx = buildContext(req,getTenantId,getSucursal);
      const name = String(req.body?.name || '');
      const args = typeof req.body?.arguments === 'string' ? JSON.parse(req.body.arguments || '{}') : (req.body?.arguments || req.body?.args || {});
      const result = jarvisTools.some((tool) => tool.name === name)
        ? await executeJarvisPersonalTool(q, ctx, name, args)
        : await executeTool(q, ctx, name, args);
      res.json({ok:true,name,result});
    } catch(error) { res.status(error.statusCode || error.status || 400).json({ok:false,error:error.message}); }
  });

  app.get('/api/jarvis/personal/dashboard', async (req,res) => {
    try {
      const ctx = buildContext(req,getTenantId,getSucursal);
      const result = await executeJarvisPersonalTool(q, ctx, 'get_personal_dashboard', {
        from: req.query?.from,
        to: req.query?.to,
      });
      res.json({ok:true,...result});
    } catch(error) {
      res.status(error.statusCode || error.status || 400).json({ok:false,error:error.message});
    }
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

  app.get('/api/jarvis/realtime/profile', (req,res) => res.json({ok:true,wake_words:['JARVIS'],voice:process.env.JARVIS_VOICE || 'cedar',model:process.env.JARVIS_REALTIME_MODEL || process.env.F1_REALTIME_MODEL || 'gpt-realtime'}));

  app.post('/api/jarvis/realtime/call', express.text({type:'application/sdp',limit:'1mb'}), async (req,res) => {
    try {
      const ctx = buildContext(req,getTenantId,getSucursal);
      const key = process.env.OPENAI_API_KEY;
      if (!key) return res.status(503).json({error:'Falta OPENAI_API_KEY'});
      if (!req.body || typeof req.body !== 'string') return res.status(400).json({error:'Oferta SDP vacía'});
      const session = {
        type:'realtime', model:process.env.JARVIS_REALTIME_MODEL || process.env.F1_REALTIME_MODEL || 'gpt-realtime',
        instructions:jarvisInstructions(ctx), output_modalities:['audio'],
        audio:{input:{transcription:{model:process.env.JARVIS_TRANSCRIBE_MODEL || process.env.F1_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',language:'es',prompt:'JARVIS. Asistente personal y empresarial. Agenda, recordatorios, correo, WhatsApp, llamadas e Internet.'},noise_reduction:{type:'near_field'},turn_detection:{type:'semantic_vad',eagerness:'low',create_response:true,interrupt_response:false}},output:{voice:process.env.JARVIS_VOICE || 'cedar',speed:1.0}},
        tools:[...tools, ...jarvisTools], tool_choice:'auto', max_output_tokens:1200,
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

  console.log('✅ JARVIS Core V1: Realtime + wake JARVIS + herramientas F1 montados');
}

module.exports={setupJarvisRoutes};

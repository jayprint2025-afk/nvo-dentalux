'use strict';

const v4 = require('./receptionist-v4');
const v5 = require('./receptionist-v5');

function csvEnv(name) {
  return String(process.env[name] || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function selectedVersion(ctx) {
  const configured = String(
    process.env.RECEPTIONIST_ENGINE_VERSION ||
    process.env.RECEPTIONIST_VERSION ||
    'v5'
  ).trim().toLowerCase();

  const tenantId = String(ctx?.tenant_id || ctx?.clinic_id || '').trim();
  const allowlist = csvEnv('RECEPTIONIST_V5_TENANTS');
  const denylist = csvEnv('RECEPTIONIST_V5_DISABLED_TENANTS');

  console.log('RECEPCIONISTA SELECTOR', {
    configured,
    tenantId,
    allowlist,
    denylist,
    allowed: allowlist.length === 0 || allowlist.includes(tenantId),
    denied: denylist.includes(tenantId),
  });

  if (denylist.includes(tenantId)) return 'v4';
  if (configured === 'v5') {
    return allowlist.length === 0 || allowlist.includes(tenantId) ? 'v5' : 'v4';
  }
  if (configured === 'v4' || configured === 'v3') return 'v4';
  if (allowlist.length > 0) return allowlist.includes(tenantId) ? 'v5' : 'v4';
  return 'v5';
}

function assertValidOutput(out, version) {
  if (!out || typeof out !== 'object') {
    const error = new Error(`${version} devolvió una salida vacía o inválida`);
    error.code = 'INVALID_RECEPTIONIST_OUTPUT';
    throw error;
  }
  if (typeof out.reply !== 'string' || !out.reply.trim()) {
    const error = new Error(`${version} no devolvió reply como texto`);
    error.code = 'INVALID_RECEPTIONIST_REPLY';
    error.details = {
      outputType: typeof out,
      keys: Object.keys(out || {}),
      used: out?.used || null,
      engine_version: out?.engine_version || null,
    };
    throw error;
  }
  if (!out.state || typeof out.state !== 'object') {
    const error = new Error(`${version} no devolvió state válido`);
    error.code = 'INVALID_RECEPTIONIST_STATE';
    throw error;
  }
  return out;
}

async function orchestrate(q, ctx, state, text) {
  const version = selectedVersion(ctx);
  const tenantId = String(ctx?.tenant_id || ctx?.clinic_id || '');

  console.log('MOTOR SELECCIONADO', { tenantId, version });

  if (version === 'v4') {
    const out = assertValidOutput(await v4.orchestrate(q, ctx, state, text), 'V4');
    return { ...out, engine_version: 'v4' };
  }

  try {
    const raw = await v5.orchestrate(q, ctx, state, text);
    console.log('V5 OUTPUT DIAGNOSTIC', {
      outputType: typeof raw,
      isNull: raw === null,
      keys: raw && typeof raw === 'object' ? Object.keys(raw) : [],
      replyType: typeof raw?.reply,
      used: raw?.used || null,
    });
    const out = assertValidOutput(raw, 'V5');
    return { ...out, engine_version: 'v5' };
  } catch (error) {
    console.error('Recepcionista V5 falló:', {
      message: error?.message,
      code: error?.code || null,
      details: error?.details || null,
      stack: error?.stack,
      tenantId,
    });

    const fallbackEnabled = String(
      process.env.RECEPTIONIST_V5_FALLBACK_TO_V4 || 'true'
    ).trim().toLowerCase() !== 'false';

    if (!fallbackEnabled) throw error;

    const fallback = assertValidOutput(
      await v4.orchestrate(q, ctx, state, text),
      'V4 fallback'
    );

    return {
      ...fallback,
      engine_version: 'v4-fallback',
      v5_error: error?.message || String(error),
    };
  }
}

module.exports = { orchestrate, selectedVersion, assertValidOutput };

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

  const tenantId = String(
    ctx?.tenant_id ||
    ctx?.clinic_id ||
    ''
  ).trim();

  const allowlist = csvEnv('RECEPTIONIST_V5_TENANTS');
  const denylist = csvEnv('RECEPTIONIST_V5_DISABLED_TENANTS');

  console.log('🧭 RECEPCIONISTA SELECTOR', {
    configured,
    tenantId,
    allowlist,
    denylist,
    allowed: allowlist.length === 0 || allowlist.includes(tenantId),
    denied: denylist.includes(tenantId),
  });

  if (denylist.includes(tenantId)) return 'v4';

  if (configured === 'v5') {
    if (allowlist.length === 0) return 'v5';
    return allowlist.includes(tenantId) ? 'v5' : 'v4';
  }

  if (configured === 'v4' || configured === 'v3') return 'v4';

  if (allowlist.length > 0) {
    return allowlist.includes(tenantId) ? 'v5' : 'v4';
  }

  return 'v5';
}

async function orchestrate(q, ctx, state, text) {
  const version = selectedVersion(ctx);

  console.log('🧭 MOTOR SELECCIONADO', {
    tenantId: String(ctx?.tenant_id || ctx?.clinic_id || ''),
    version,
  });

  if (version === 'v4') {
    const out = await v4.orchestrate(q, ctx, state, text);
    return {
      ...out,
      engine_version: 'v4',
    };
  }

  try {
    const out = await v5.orchestrate(q, ctx, state, text);
    return {
      ...out,
      engine_version: 'v5',
    };
  } catch (error) {
    console.error('❌ Recepcionista V5 falló:', {
      message: error?.message,
      stack: error?.stack,
      tenantId: String(ctx?.tenant_id || ctx?.clinic_id || ''),
    });

    const fallbackEnabled = String(
      process.env.RECEPTIONIST_V5_FALLBACK_TO_V4 || 'true'
    ).trim().toLowerCase() !== 'false';

    if (fallbackEnabled) {
      const out = await v4.orchestrate(q, ctx, state, text);
      return {
        ...out,
        engine_version: 'v4-fallback',
        v5_error: error?.message || String(error),
      };
    }

    throw error;
  }
}

module.exports = {
  orchestrate,
  selectedVersion,
};

'use strict';

const v3 = require('./ai-orchestrator');
const v4 = require('./receptionist-v4');

function csvSet(value) {
  return new Set(String(value || '').split(',').map(x => x.trim()).filter(Boolean));
}

function versionFor(ctx) {
  const forced = String(process.env.RECEPTIONIST_VERSION || 'v3').toLowerCase();
  const tenant = String(ctx?.tenant_id || ctx?.clinic_id || '');
  const v4Tenants = csvSet(process.env.RECEPTIONIST_V4_TENANTS);
  const v3Tenants = csvSet(process.env.RECEPTIONIST_V3_TENANTS);
  if (v3Tenants.has(tenant)) return 'v3';
  if (v4Tenants.has(tenant)) return 'v4';
  return forced === 'v4' ? 'v4' : 'v3';
}

async function orchestrate(q, ctx, state, text) {
  const version = versionFor(ctx);
  const engine = version === 'v4' ? v4 : v3;
  const out = await engine.orchestrate(q, ctx, state, text);
  return { ...out, engine_version: version };
}

module.exports = { orchestrate, versionFor };

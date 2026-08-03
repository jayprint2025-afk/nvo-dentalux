'use strict';

const SESSION_TTL_MS = Number(process.env.F1_SESSION_MEMORY_MINUTES || 30) * 60 * 1000;
const MAX_SESSION_ITEMS = Number(process.env.F1_SESSION_MEMORY_ITEMS || 30);
const sessionMemory = new Map();
let schemaReady = false;

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function sessionKey(ctx) {
  return [ctx.tenant_id, ctx.user_id || 'user', ctx.branch_key || 'sucursal_1'].join(':');
}

function getSession(ctx) {
  const key = sessionKey(ctx);
  const now = Date.now();
  const current = sessionMemory.get(key);
  if (!current || current.expiresAt <= now) {
    const fresh = { values: {}, timeline: [], updatedAt: now, expiresAt: now + SESSION_TTL_MS };
    sessionMemory.set(key, fresh);
    return fresh;
  }
  current.expiresAt = now + SESSION_TTL_MS;
  return current;
}

function setSessionValue(ctx, key, value, source = 'system') {
  const memory = getSession(ctx);
  memory.values[clean(key)] = value;
  memory.timeline.push({ key: clean(key), value, source, at: new Date().toISOString() });
  if (memory.timeline.length > MAX_SESSION_ITEMS) {
    memory.timeline.splice(0, memory.timeline.length - MAX_SESSION_ITEMS);
  }
  memory.updatedAt = Date.now();
  memory.expiresAt = Date.now() + SESSION_TTL_MS;
  return memory;
}

function clearSession(ctx, key) {
  const memory = getSession(ctx);
  if (key) delete memory.values[clean(key)];
  else {
    memory.values = {};
    memory.timeline = [];
  }
  memory.updatedAt = Date.now();
  return memory;
}

async function ensureSchema(q) {
  if (schemaReady) return;
  await q(`
    CREATE TABLE IF NOT EXISTS f1_memories (
      id BIGSERIAL PRIMARY KEY,
      tenant_id UUID NOT NULL,
      user_key TEXT NOT NULL DEFAULT '*',
      branch_key TEXT NOT NULL DEFAULT '*',
      scope TEXT NOT NULL CHECK (scope IN ('day','user','company')),
      memory_key TEXT NOT NULL,
      memory_value JSONB NOT NULL DEFAULT '{}'::jsonb,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, user_key, branch_key, scope, memory_key)
    )
  `);
  await q(`CREATE INDEX IF NOT EXISTS idx_f1_memories_lookup ON f1_memories(tenant_id, user_key, branch_key, scope)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_f1_memories_expiry ON f1_memories(expires_at)`);
  schemaReady = true;
}

function dbIdentity(ctx, scope) {
  if (scope === 'company') return { userKey: '*', branchKey: '*' };
  if (scope === 'user') return { userKey: clean(ctx.user_id) || 'user', branchKey: '*' };
  return { userKey: clean(ctx.user_id) || 'user', branchKey: clean(ctx.branch_key) || 'sucursal_1' };
}

function expiryFor(scope) {
  if (scope !== 'day') return null;
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

async function remember(q, ctx, args = {}) {
  const scope = clean(args.scope || 'session').toLowerCase();
  const key = clean(args.key);
  const value = args.value;
  if (!key) throw new Error('Falta la clave de memoria');
  if (!['session', 'day', 'user', 'company'].includes(scope)) throw new Error('Tipo de memoria no válido');

  if (scope === 'session') {
    setSessionValue(ctx, key, value, 'user');
    return { ok: true, scope, key, value, assistant_message: `Lo recordaré durante esta sesión: ${key}.` };
  }

  await ensureSchema(q);
  const { userKey, branchKey } = dbIdentity(ctx, scope);
  const expiresAt = expiryFor(scope);
  await q(`
    INSERT INTO f1_memories (
      tenant_id, user_key, branch_key, scope, memory_key, memory_value, expires_at, created_at, updated_at
    ) VALUES ($1::uuid,$2,$3,$4,$5,$6::jsonb,$7::timestamptz,NOW(),NOW())
    ON CONFLICT (tenant_id, user_key, branch_key, scope, memory_key)
    DO UPDATE SET memory_value=EXCLUDED.memory_value, expires_at=EXCLUDED.expires_at, updated_at=NOW()
  `, [ctx.tenant_id, userKey, branchKey, scope, key, JSON.stringify({ value }), expiresAt]);

  const label = scope === 'day' ? 'por el resto del día' : scope === 'user' ? 'como preferencia de tu usuario' : 'para esta empresa';
  return { ok: true, scope, key, value, assistant_message: `De acuerdo. Lo recordaré ${label}: ${key}.` };
}

async function forget(q, ctx, args = {}) {
  const scope = clean(args.scope || 'session').toLowerCase();
  const key = clean(args.key);
  if (scope === 'session') {
    clearSession(ctx, key || null);
    return { ok: true, scope, key: key || null, assistant_message: key ? `Olvidé ${key} de esta sesión.` : 'Limpié la memoria de esta sesión.' };
  }
  if (!['day', 'user', 'company'].includes(scope)) throw new Error('Tipo de memoria no válido');
  await ensureSchema(q);
  const { userKey, branchKey } = dbIdentity(ctx, scope);
  const params = [ctx.tenant_id, userKey, branchKey, scope];
  let keySql = '';
  if (key) {
    params.push(key);
    keySql = ` AND memory_key=$5`;
  }
  await q(`DELETE FROM f1_memories WHERE tenant_id=$1::uuid AND user_key=$2 AND branch_key=$3 AND scope=$4${keySql}`, params);
  return { ok: true, scope, key: key || null, assistant_message: key ? `Olvidé ${key}.` : `Limpié la memoria ${scope}.` };
}

async function list(q, ctx) {
  await ensureSchema(q);
  await q(`DELETE FROM f1_memories WHERE tenant_id=$1::uuid AND expires_at IS NOT NULL AND expires_at <= NOW()`, [ctx.tenant_id]);
  const userKey = clean(ctx.user_id) || 'user';
  const branchKey = clean(ctx.branch_key) || 'sucursal_1';
  const { rows } = await q(`
    SELECT scope, memory_key, memory_value, expires_at, updated_at
      FROM f1_memories
     WHERE tenant_id=$1::uuid
       AND (
         (scope='company' AND user_key='*' AND branch_key='*') OR
         (scope='user' AND user_key=$2 AND branch_key='*') OR
         (scope='day' AND user_key=$2 AND branch_key=$3)
       )
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY CASE scope WHEN 'company' THEN 1 WHEN 'user' THEN 2 ELSE 3 END, updated_at DESC
  `, [ctx.tenant_id, userKey, branchKey]);
  return {
    session: getSession(ctx).values,
    persistent: rows.map(row => ({
      scope: row.scope,
      key: row.memory_key,
      value: row.memory_value?.value,
      expires_at: row.expires_at,
      updated_at: row.updated_at,
    })),
  };
}

async function contextText(q, ctx) {
  const memories = await list(q, ctx);
  const lines = [];
  const sessionEntries = Object.entries(memories.session || {});
  if (sessionEntries.length) {
    lines.push('Contexto temporal de la sesión:');
    for (const [key, value] of sessionEntries.slice(-15)) lines.push(`- ${key}: ${JSON.stringify(value)}`);
  }
  if (memories.persistent.length) {
    lines.push('Memoria autorizada de la empresa/usuario/día:');
    for (const item of memories.persistent.slice(0, 30)) lines.push(`- [${item.scope}] ${item.key}: ${JSON.stringify(item.value)}`);
  }
  return lines.length ? lines.join('\n') : 'No hay memoria adicional guardada.';
}

function observeToolResult(ctx, name, args, result) {
  setSessionValue(ctx, 'last_tool', name, 'tool');
  if (name === 'open_module') setSessionValue(ctx, 'current_module', args.module || result?.client_action?.target, 'tool');
  if (name === 'get_today_summary') setSessionValue(ctx, 'last_topic', 'agenda', 'tool');
  const appointment = result?.appointment || result?.appointments?.[0];
  if (appointment) {
    setSessionValue(ctx, 'last_appointment', {
      id: appointment.id,
      patient: appointment.patient,
      date: appointment.date,
      start_time: appointment.start_time,
      status: appointment.status,
    }, 'tool');
    if (appointment.patient) setSessionValue(ctx, 'last_patient', appointment.patient, 'tool');
  }
}

async function executeMemoryTool(q, ctx, name, args) {
  if (name === 'remember_context') return remember(q, ctx, args);
  if (name === 'forget_context') return forget(q, ctx, args);
  if (name === 'list_context_memory') {
    const memories = await list(q, ctx);
    return { ok: true, memories, assistant_message: 'Estas son las memorias disponibles para tu sesión y empresa.' };
  }
  return null;
}

module.exports = {
  contextText,
  executeMemoryTool,
  observeToolResult,
  setSessionValue,
  clearSession,
};

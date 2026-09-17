'use strict';

let schemaReady = null;

async function ensureJarvisPersonalSchema(q) {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await q(`CREATE TABLE IF NOT EXISTS jarvis_personal_events (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ,
      location TEXT,
      notes TEXT,
      category TEXT DEFAULT 'personal',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await q(`CREATE INDEX IF NOT EXISTS idx_jarvis_events_owner_start
      ON jarvis_personal_events (tenant_id, user_id, start_at)`);

    await q(`CREATE TABLE IF NOT EXISTS jarvis_personal_reminders (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      remind_at TIMESTAMPTZ NOT NULL,
      notes TEXT,
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'pending',
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await q(`CREATE INDEX IF NOT EXISTS idx_jarvis_reminders_owner_time
      ON jarvis_personal_reminders (tenant_id, user_id, remind_at)`);
    return true;
  })().catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}

function owner(ctx) {
  const tenant = String(ctx?.tenant_id || '').trim();
  if (!tenant) throw new Error('Tenant JARVIS no disponible');
  return { tenant, user: String(ctx?.user_id || '').trim() };
}
function iso(v, name) {
  if (!v) throw new Error(`Falta ${name}`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`${name} inválido`);
  return d.toISOString();
}
function rows(r){ return Array.isArray(r) ? r : (r?.rows || []); }

async function executeJarvisPersonalTool(q, ctx, name, args={}) {
  await ensureJarvisPersonalSchema(q);
  const {tenant,user} = owner(ctx);

  if (name === 'create_personal_event') {
    const start = iso(args.start_at,'start_at');
    const end = args.end_at ? iso(args.end_at,'end_at') : null;
    const r = await q(`INSERT INTO jarvis_personal_events
      (tenant_id,user_id,title,start_at,end_at,location,notes,category)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [tenant,user,String(args.title||'').trim(),start,end,args.location||null,args.notes||null,args.category||'personal']);
    return {created:true,event:rows(r)[0]};
  }

  if (name === 'list_personal_events') {
    const from = args.from ? iso(args.from,'from') : new Date().toISOString();
    const to = args.to ? iso(args.to,'to') : new Date(Date.now()+30*86400000).toISOString();
    const limit = Math.min(Math.max(Number(args.limit)||100,1),250);
    const r = await q(`SELECT * FROM jarvis_personal_events
      WHERE tenant_id=$1 AND user_id=$2 AND status<>'deleted' AND start_at >= $3 AND start_at <= $4
      ORDER BY start_at ASC LIMIT $5`,[tenant,user,from,to,limit]);
    return {events:rows(r)};
  }

  if (name === 'update_personal_event') {
    const id = Number(args.event_id); if(!id) throw new Error('event_id inválido');
    const allowed = {title:'title',start_at:'start_at',end_at:'end_at',location:'location',notes:'notes',category:'category',status:'status'};
    const sets=[], vals=[tenant,user,id]; let p=4;
    for (const [k,col] of Object.entries(allowed)) if (Object.prototype.hasOwnProperty.call(args,k)) {
      let v=args[k]; if ((k==='start_at'||k==='end_at') && v) v=iso(v,k);
      sets.push(`${col}=$${p++}`); vals.push(v ?? null);
    }
    if(!sets.length) throw new Error('No hay cambios para aplicar');
    sets.push('updated_at=NOW()');
    const r=await q(`UPDATE jarvis_personal_events SET ${sets.join(',')}
      WHERE tenant_id=$1 AND user_id=$2 AND id=$3 RETURNING *`,vals);
    if(!rows(r)[0]) throw new Error('Evento no encontrado');
    return {updated:true,event:rows(r)[0]};
  }

  if (name === 'delete_personal_event') {
    if(args.confirmed !== true) return {requires_confirmation:true,message:'Confirma que deseas eliminar este evento.'};
    const r=await q(`DELETE FROM jarvis_personal_events WHERE tenant_id=$1 AND user_id=$2 AND id=$3 RETURNING id,title`,
      [tenant,user,Number(args.event_id)]);
    if(!rows(r)[0]) throw new Error('Evento no encontrado');
    return {deleted:true,event:rows(r)[0]};
  }

  if (name === 'create_personal_reminder') {
    const r=await q(`INSERT INTO jarvis_personal_reminders
      (tenant_id,user_id,title,remind_at,notes,priority)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [tenant,user,String(args.title||'').trim(),iso(args.remind_at,'remind_at'),args.notes||null,args.priority||'normal']);
    return {created:true,reminder:rows(r)[0]};
  }

  if (name === 'list_personal_reminders') {
    const status=String(args.status||'pending');
    const from=args.from?iso(args.from,'from'):new Date(Date.now()-86400000).toISOString();
    const to=args.to?iso(args.to,'to'):new Date(Date.now()+90*86400000).toISOString();
    const limit=Math.min(Math.max(Number(args.limit)||100,1),250);
    const vals=[tenant,user,from,to,limit];
    const statusSql=status==='all'?'':` AND status='${status==='completed'?'completed':'pending'}'`;
    const r=await q(`SELECT * FROM jarvis_personal_reminders
      WHERE tenant_id=$1 AND user_id=$2 AND remind_at >= $3 AND remind_at <= $4 ${statusSql}
      ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END, remind_at ASC LIMIT $5`,vals);
    return {reminders:rows(r)};
  }

  if (name === 'complete_personal_reminder') {
    const r=await q(`UPDATE jarvis_personal_reminders SET status='completed',completed_at=NOW(),updated_at=NOW()
      WHERE tenant_id=$1 AND user_id=$2 AND id=$3 RETURNING *`,[tenant,user,Number(args.reminder_id)]);
    if(!rows(r)[0]) throw new Error('Recordatorio no encontrado');
    return {completed:true,reminder:rows(r)[0]};
  }

  if (name === 'delete_personal_reminder') {
    if(args.confirmed !== true) return {requires_confirmation:true,message:'Confirma que deseas eliminar este recordatorio.'};
    const r=await q(`DELETE FROM jarvis_personal_reminders WHERE tenant_id=$1 AND user_id=$2 AND id=$3 RETURNING id,title`,
      [tenant,user,Number(args.reminder_id)]);
    if(!rows(r)[0]) throw new Error('Recordatorio no encontrado');
    return {deleted:true,reminder:rows(r)[0]};
  }

  if (name === 'get_personal_dashboard') {
    const from=args.from?iso(args.from,'from'):new Date().toISOString();
    const to=args.to?iso(args.to,'to'):new Date(Date.now()+7*86400000).toISOString();
    const ev=await q(`SELECT * FROM jarvis_personal_events WHERE tenant_id=$1 AND user_id=$2
      AND status<>'deleted' AND start_at >= $3 AND start_at <= $4 ORDER BY start_at ASC LIMIT 50`,[tenant,user,from,to]);
    const rem=await q(`SELECT * FROM jarvis_personal_reminders WHERE tenant_id=$1 AND user_id=$2
      AND status='pending' AND remind_at <= $3 ORDER BY remind_at ASC LIMIT 50`,[tenant,user,to]);
    return {events:rows(ev),reminders:rows(rem),range:{from,to}};
  }

  throw new Error(`Herramienta personal JARVIS no soportada: ${name}`);
}

module.exports = { ensureJarvisPersonalSchema, executeJarvisPersonalTool };

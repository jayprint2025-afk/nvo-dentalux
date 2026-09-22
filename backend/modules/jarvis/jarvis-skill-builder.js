'use strict';

function t(v){ return v == null ? '' : String(v).trim(); }

async function ensureSkillTables(q){
  await q(`CREATE TABLE IF NOT EXISTS jarvis_skill_drafts (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL,
    user_id TEXT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    request TEXT NOT NULL,
    purpose TEXT,
    proposed_card JSONB NOT NULL DEFAULT '{}'::jsonb,
    proposed_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
    required_services JSONB NOT NULL DEFAULT '[]'::jsonb,
    estimated_cost TEXT NOT NULL DEFAULT 'free',
    status TEXT NOT NULL DEFAULT 'draft',
    risk_level TEXT NOT NULL DEFAULT 'low',
    notes TEXT,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_jarvis_skill_drafts_owner
    ON jarvis_skill_drafts(tenant_id,user_id,status,created_at DESC)`);
}

function slugify(v){
  return t(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80) || 'skill';
}

function normalizeJson(v,fallback){
  if(v == null) return fallback;
  if(typeof v === 'object') return v;
  try { return JSON.parse(String(v)); } catch { return fallback; }
}

async function createSkillDraft(q,ctx,args={}){
  await ensureSkillTables(q);
  const name=t(args.name);
  const request=t(args.request);
  if(!name) throw new Error('Falta el nombre de la habilidad');
  if(!request) throw new Error('Falta describir qué debe hacer la habilidad');

  const requiredServices=normalizeJson(args.required_services,[]);
  const estimatedCost=(t(args.estimated_cost)||'free').toLowerCase();
  const paid = estimatedCost !== 'free' || (Array.isArray(requiredServices) && requiredServices.some(x => {
    const s=typeof x==='string'?x:JSON.stringify(x);
    return /paid|pago|subscription|suscrip|billing|costo/i.test(s);
  }));

  const status=paid ? 'blocked_cost_review' : 'draft';
  const riskLevel=t(args.risk_level)||'low';

  const {rows}=await q(`INSERT INTO jarvis_skill_drafts
    (tenant_id,user_id,name,slug,request,purpose,proposed_card,proposed_tools,required_services,estimated_cost,status,risk_level,notes)
    VALUES($1::uuid,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13)
    RETURNING *`,
    [ctx.tenant_id,ctx.user_id||null,name,slugify(name),request,t(args.purpose)||null,
     JSON.stringify(normalizeJson(args.proposed_card,{})),
     JSON.stringify(normalizeJson(args.proposed_tools,[])),
     JSON.stringify(requiredServices),
     estimatedCost,status,riskLevel,t(args.notes)||null]);

  const skill=rows[0];
  return {
    ok:true, skill,
    requires_authorization:true,
    executable:false,
    assistant_message: paid
      ? `Preparé la propuesta "${name}", pero detecté posible costo externo. Quedó bloqueada para revisión y no instalaré ni contrataré nada sin autorización.`
      : `Preparé la propuesta "${name}" como borrador. No se ha instalado ni publicado nada. Puede revisarla y autorizarla cuando lo desee.`,
    client_event:{type:'jarvis_skills_changed'}
  };
}

async function listSkillDrafts(q,ctx,args={}){
  await ensureSkillTables(q);
  const status=t(args.status);
  const params=[ctx.tenant_id,ctx.user_id||null];
  let extra='';
  if(status){ params.push(status); extra=` AND status=$${params.length}`; }
  const {rows}=await q(`SELECT * FROM jarvis_skill_drafts
    WHERE tenant_id=$1::uuid AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL))
    ${extra} ORDER BY created_at DESC LIMIT 50`,params);
  return {ok:true,skills:rows,count:rows.length};
}

async function getSkillDraft(q,ctx,args={}){
  await ensureSkillTables(q);
  const id=Number(args.id);
  if(!Number.isSafeInteger(id)) throw new Error('Falta un ID de habilidad válido');
  const {rows}=await q(`SELECT * FROM jarvis_skill_drafts
    WHERE tenant_id=$1::uuid AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND id=$3
    LIMIT 1`,[ctx.tenant_id,ctx.user_id||null,id]);
  if(!rows[0]) throw new Error('No encontré esa propuesta de habilidad');
  return {ok:true,skill:rows[0]};
}

async function approveSkillDraft(q,ctx,args={}){
  await ensureSkillTables(q);
  const id=Number(args.id);
  if(!Number.isSafeInteger(id)) throw new Error('Falta un ID de habilidad válido');

  const current=await getSkillDraft(q,ctx,{id});
  const skill=current.skill;
  if(skill.status==='blocked_cost_review'){
    return {ok:false,requires_cost_authorization:true,skill,
      assistant_message:'Esta propuesta indica un posible servicio de pago. No puede aprobarse con la autorización normal. Requiere revisión explícita de costo.'};
  }
  if(!['draft','validated'].includes(skill.status)){
    return {ok:false,skill,assistant_message:`La propuesta está en estado "${skill.status}" y no puede aprobarse desde este paso.`};
  }

  const {rows}=await q(`UPDATE jarvis_skill_drafts
    SET status='approved',approved_at=NOW(),updated_at=NOW()
    WHERE tenant_id=$1::uuid AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND id=$3
    RETURNING *`,[ctx.tenant_id,ctx.user_id||null,id]);

  return {
    ok:true,skill:rows[0],executable:false,
    assistant_message:`Autorización registrada para "${rows[0].name}". Aún no se modificó código, GitHub ni Render; la instalación seguirá siendo un paso separado.`,
    client_event:{type:'jarvis_skills_changed'}
  };
}

async function rejectSkillDraft(q,ctx,args={}){
  await ensureSkillTables(q);
  const id=Number(args.id);
  if(!Number.isSafeInteger(id)) throw new Error('Falta un ID de habilidad válido');
  const {rows}=await q(`UPDATE jarvis_skill_drafts
    SET status='rejected',notes=COALESCE(NULLIF($4,''),notes),updated_at=NOW()
    WHERE tenant_id=$1::uuid AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND id=$3
    RETURNING *`,[ctx.tenant_id,ctx.user_id||null,id,t(args.reason)]);
  if(!rows[0]) throw new Error('No encontré esa propuesta de habilidad');
  return {ok:true,skill:rows[0],assistant_message:`La propuesta "${rows[0].name}" fue rechazada y no se instalará.`,client_event:{type:'jarvis_skills_changed'}};
}

const skillHandlers={
  skill_create_draft:createSkillDraft,
  skill_list_drafts:listSkillDrafts,
  skill_get_draft:getSkillDraft,
  skill_approve_draft:approveSkillDraft,
  skill_reject_draft:rejectSkillDraft,
};

async function executeSkillTool(q,ctx,name,args={}){
  const fn=skillHandlers[name];
  if(!fn) return null;
  return fn(q,ctx,args);
}

module.exports={ensureSkillTables,skillHandlers,executeSkillTool};

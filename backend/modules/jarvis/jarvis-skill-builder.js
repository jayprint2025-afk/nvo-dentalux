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


function isWeatherSkill(skill={}){
  const haystack=[
    skill.name,skill.slug,skill.request,skill.purpose,skill.notes,
    JSON.stringify(skill.proposed_tools||[]),
    JSON.stringify(skill.required_services||[])
  ].filter(Boolean).join(' ');
  return /clima|weather|meteorolog|pron[oó]stico/i.test(haystack);
}

async function installApprovedSkill(q,ctx,args={}){
  await ensureSkillTables(q);
  let skill=null;
  if(args.id!=null){
    const got=await getSkillDraft(q,ctx,{id:args.id});
    skill=got.skill;
  }else if(t(args.name)){
    const {rows}=await q(`SELECT * FROM jarvis_skill_drafts
      WHERE tenant_id=$1::uuid AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL))
      AND LOWER(name)=LOWER($3) ORDER BY created_at DESC LIMIT 1`,
      [ctx.tenant_id,ctx.user_id||null,t(args.name)]);
    skill=rows[0]||null;
  }
  if(!skill) throw new Error('No encontré la habilidad a instalar');
  if(String(skill.estimated_cost||'free').toLowerCase()!=='free'){
    return {ok:false,executable:false,requires_cost_confirmation:true,skill,
      assistant_message:'La habilidad no puede instalarse automáticamente porque su costo no está confirmado como gratuito.'};
  }
  if(!['approved','active'].includes(skill.status)){
    return {ok:false,executable:false,skill,
      assistant_message:`La habilidad está en estado "${skill.status}" y debe estar aprobada antes de instalarse.`};
  }
  if(!isWeatherSkill(skill)){
    return {ok:false,executable:false,unsupported_runtime:true,skill,
      assistant_message:'Esta propuesta fue aprobada, pero JARVIS todavía no tiene un runtime seguro incluido para ejecutarla.'};
  }
  const {rows}=await q(`UPDATE jarvis_skill_drafts SET status='active',updated_at=NOW()
    WHERE tenant_id=$1::uuid AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND id=$3
    RETURNING *`,[ctx.tenant_id,ctx.user_id||null,skill.id]);
  return {ok:true,executable:true,installed:true,skill:rows[0],
    runtime:'weather_open_meteo',
    assistant_message:`La habilidad "${rows[0].name}" quedó instalada y activa.`,
    client_event:{type:'jarvis_skills_changed'}};
}

function weatherCodeText(code){
  const m={
    0:'cielo despejado',1:'principalmente despejado',2:'parcialmente nublado',3:'nublado',
    45:'niebla',48:'niebla con escarcha',51:'llovizna ligera',53:'llovizna moderada',
    55:'llovizna intensa',61:'lluvia ligera',63:'lluvia moderada',65:'lluvia intensa',
    71:'nieve ligera',73:'nieve moderada',75:'nieve intensa',80:'chubascos ligeros',
    81:'chubascos moderados',82:'chubascos intensos',95:'tormenta eléctrica',
    96:'tormenta con granizo ligero',99:'tormenta con granizo fuerte'
  };
  return m[Number(code)]||'condiciones variables';
}

async function fetchJson(url){
  const res=await fetch(url,{headers:{'user-agent':'JARVIS/1.0'}});
  if(!res.ok) throw new Error(`Servicio externo respondió HTTP ${res.status}`);
  return res.json();
}

async function runWeatherSkill(skill,args={}){
  const location=t(args.location||args.city);
  if(!location) return {ok:false,needs_input:'location',assistant_message:'¿De qué ciudad desea consultar el clima?'};

  const geoUrl='https://geocoding-api.open-meteo.com/v1/search?name='+
    encodeURIComponent(location)+'&count=1&language=es&format=json';
  const geo=await fetchJson(geoUrl);
  const place=geo && Array.isArray(geo.results) ? geo.results[0] : null;
  if(!place) return {ok:false,assistant_message:`No pude localizar "${location}". Indíqueme otra ciudad o agregue estado/país.`};

  const forecastUrl='https://api.open-meteo.com/v1/forecast?latitude='+
    encodeURIComponent(place.latitude)+'&longitude='+encodeURIComponent(place.longitude)+
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m'+
    '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto';
  const data=await fetchJson(forecastUrl);
  const c=data.current||{};
  const resolved=[place.name,place.admin1,place.country].filter(Boolean).join(', ');

  return {
    ok:true,executable:true,runtime:'weather_open_meteo',
    skill:{id:skill.id,name:skill.name},
    location:resolved,
    current:{
      temperature_f:c.temperature_2m,
      apparent_temperature_f:c.apparent_temperature,
      humidity_percent:c.relative_humidity_2m,
      wind_mph:c.wind_speed_10m,
      weather_code:c.weather_code,
      condition:weatherCodeText(c.weather_code),
      observed_at:c.time||null
    },
    assistant_message:`En ${resolved}, la temperatura actual es ${c.temperature_2m} °F, sensación de ${c.apparent_temperature} °F, con ${weatherCodeText(c.weather_code)}. Humedad ${c.relative_humidity_2m}% y viento de ${c.wind_speed_10m} mph.`
  };
}

async function runSkill(q,ctx,args={}){
  await ensureSkillTables(q);
  let skill=null;
  if(args.id!=null){
    const got=await getSkillDraft(q,ctx,{id:args.id});
    skill=got.skill;
  }else{
    const wanted=t(args.name);
    const {rows}=await q(`SELECT * FROM jarvis_skill_drafts
      WHERE tenant_id=$1::uuid AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL))
      AND status='active'
      ORDER BY created_at DESC LIMIT 50`,[ctx.tenant_id,ctx.user_id||null]);
    skill = wanted
      ? rows.find(s=>String(s.name).toLowerCase()===wanted.toLowerCase()) || rows.find(isWeatherSkill)
      : rows.find(isWeatherSkill) || rows[0];
  }
  if(!skill) return {ok:false,executable:false,assistant_message:'No encontré una habilidad activa que pueda ejecutar esa petición.'};
  if(skill.status!=='active') return {ok:false,executable:false,skill,
    assistant_message:`La habilidad "${skill.name}" no está activa.`};
  if(isWeatherSkill(skill)) return runWeatherSkill(skill,args);
  return {ok:false,executable:false,unsupported_runtime:true,skill,
    assistant_message:`La habilidad "${skill.name}" está activa, pero no tiene un runtime ejecutable disponible.`};
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
  if(!['draft','validated','approved'].includes(skill.status)){
    if(skill.status==='active') return {ok:true,skill,executable:true,installed:true,
      assistant_message:`La habilidad "${skill.name}" ya está instalada y activa.`};
    return {ok:false,skill,assistant_message:`La propuesta está en estado "${skill.status}" y no puede aprobarse desde este paso.`};
  }

  let approved=skill;
  if(skill.status!=='approved'){
    const {rows}=await q(`UPDATE jarvis_skill_drafts
      SET status='approved',approved_at=NOW(),updated_at=NOW()
      WHERE tenant_id=$1::uuid AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND id=$3
      RETURNING *`,[ctx.tenant_id,ctx.user_id||null,id]);
    approved=rows[0];
  }

  const installed=await installApprovedSkill(q,ctx,{id:approved.id});
  if(installed.ok && installed.executable) return installed;
  return {...installed,skill:approved};
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
  skill_install_approved:installApprovedSkill,
  skill_run:runSkill,
};

async function executeSkillTool(q,ctx,name,args={}){
  const fn=skillHandlers[name];
  if(!fn) return null;
  return fn(q,ctx,args);
}

module.exports={ensureSkillTables,skillHandlers,executeSkillTool};

'use strict';

const { executeTool: executeCliniqOneTool } = require('../f1/management-tools');

function t(v){ return v == null ? '' : String(v).trim(); }
function idList(v){ return Array.isArray(v) ? v.map(Number).filter(Number.isSafeInteger) : []; }

async function ensurePersonalTables(q){
  // CREATE TABLE IF NOT EXISTS NO agrega columnas faltantes a tablas antiguas.
  // Por eso esta función también actúa como migración idempotente/autorreparable.
  await q(`CREATE TABLE IF NOT EXISTS jarvis_personal_events (
    id BIGSERIAL PRIMARY KEY, tenant_id UUID NOT NULL, user_id TEXT,
    title TEXT NOT NULL, start_at TIMESTAMPTZ NOT NULL, end_at TIMESTAMPTZ,
    location TEXT, notes TEXT, category TEXT DEFAULT 'personal', status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  await q(`ALTER TABLE jarvis_personal_events
    ADD COLUMN IF NOT EXISTS tenant_id UUID,
    ADD COLUMN IF NOT EXISTS user_id TEXT,
    ADD COLUMN IF NOT EXISTS title TEXT,
    ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS location TEXT,
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'personal',
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);

  await q(`CREATE TABLE IF NOT EXISTS jarvis_personal_reminders (
    id BIGSERIAL PRIMARY KEY, tenant_id UUID NOT NULL, user_id TEXT,
    event_id BIGINT,
    title TEXT NOT NULL, remind_at TIMESTAMPTZ NOT NULL, notes TEXT,
    priority TEXT DEFAULT 'normal', status TEXT DEFAULT 'pending',
    insist_at TIMESTAMPTZ, notified_at TIMESTAMPTZ, insisted_at TIMESTAMPTZ, acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  await q(`ALTER TABLE jarvis_personal_reminders
    ADD COLUMN IF NOT EXISTS tenant_id UUID,
    ADD COLUMN IF NOT EXISTS user_id TEXT,
    ADD COLUMN IF NOT EXISTS event_id BIGINT,
    ADD COLUMN IF NOT EXISTS title TEXT,
    ADD COLUMN IF NOT EXISTS remind_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal',
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS insist_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS insisted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);

  // Normaliza filas antiguas antes de crear índices.
  await q(`UPDATE jarvis_personal_events
    SET category=COALESCE(category,'personal'),
        status=COALESCE(status,'active'),
        created_at=COALESCE(created_at,NOW()),
        updated_at=COALESCE(updated_at,NOW())
    WHERE category IS NULL OR status IS NULL OR created_at IS NULL OR updated_at IS NULL`);

  await q(`UPDATE jarvis_personal_reminders
    SET priority=COALESCE(priority,'normal'),
        status=COALESCE(status,'pending'),
        created_at=COALESCE(created_at,NOW()),
        updated_at=COALESCE(updated_at,NOW())
    WHERE priority IS NULL OR status IS NULL OR created_at IS NULL OR updated_at IS NULL`);

  await q(`CREATE INDEX IF NOT EXISTS idx_jarvis_personal_events_due
    ON jarvis_personal_events(tenant_id,user_id,start_at)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_jarvis_personal_reminders_due
    ON jarvis_personal_reminders(tenant_id,user_id,status,remind_at,insist_at)`);

  // Agrega la FK si la instalación antigua todavía no la tenía.
  await q(`DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname='jarvis_personal_reminders_event_id_fkey'
        AND conrelid='jarvis_personal_reminders'::regclass
    ) THEN
      ALTER TABLE jarvis_personal_reminders
      ADD CONSTRAINT jarvis_personal_reminders_event_id_fkey
      FOREIGN KEY (event_id) REFERENCES jarvis_personal_events(id) ON DELETE CASCADE;
    END IF;
  END $$`);
}
function userWhere(ctx, start=1){
  return { sql:`tenant_id::text=$${start}::text AND (user_id=$${start+1} OR (user_id IS NULL AND $${start+1} IS NULL))`, params:[ctx.tenant_id, ctx.user_id || null] };
}

async function createEvent(q,ctx,args={}){
  await ensurePersonalTables(q);
  if(!t(args.title)) throw new Error('Falta el título de la reunión o evento');
  if(!t(args.start_at)) throw new Error('Falta la fecha y hora del evento');
  const mins = Number.isFinite(Number(args.reminder_minutes_before)) ? Math.max(0,Number(args.reminder_minutes_before)) : 10;
  const {rows} = await q(`INSERT INTO jarvis_personal_events(tenant_id,user_id,title,start_at,end_at,location,notes,category)
    VALUES($1,$2,$3,$4::timestamptz,NULLIF($5,'')::timestamptz,$6,$7,$8) RETURNING *`,
    [ctx.tenant_id,ctx.user_id||null,t(args.title),t(args.start_at),t(args.end_at),t(args.location)||null,t(args.notes)||null,t(args.category)||'personal']);
  const event=rows[0];
  const rr=await q(`INSERT INTO jarvis_personal_reminders(tenant_id,user_id,event_id,title,remind_at,notes,priority,insist_at)
    VALUES($1,$2,$3,$4,$5::timestamptz - ($6::text || ' minutes')::interval,$7,'normal',$5::timestamptz - ($6::text || ' minutes')::interval + interval '5 minutes') RETURNING *`,
    [ctx.tenant_id,ctx.user_id||null,event.id,`Evento: ${event.title}`,event.start_at,mins,t(args.notes)||null]);
  return {ok:true,event,reminder:rr.rows[0],assistant_message:`Listo. Programé ${event.title} y el aviso ${mins} minutos antes.`,client_event:{type:'jarvis_personal_changed'}};
}

async function createReminder(q,ctx,args={}){
  await ensurePersonalTables(q);
  if(!t(args.title)) throw new Error('Falta el título del recordatorio');
  if(!t(args.remind_at)) throw new Error('Falta la fecha y hora del recordatorio');
  const mins=Number.isFinite(Number(args.insist_after_minutes))?Math.max(1,Number(args.insist_after_minutes)):5;
  const {rows}=await q(`INSERT INTO jarvis_personal_reminders(tenant_id,user_id,title,remind_at,notes,priority,insist_at)
    VALUES($1,$2,$3,$4::timestamptz,$5,$6,$4::timestamptz + ($7::text || ' minutes')::interval) RETURNING *`,
    [ctx.tenant_id,ctx.user_id||null,t(args.title),t(args.remind_at),t(args.notes)||null,t(args.priority)||'normal',mins]);
  return {ok:true,reminder:rows[0],assistant_message:`Listo. Programé el recordatorio: ${rows[0].title}.`,client_event:{type:'jarvis_personal_changed'}};
}

async function acknowledge(q,ctx,args={}){
  await ensurePersonalTables(q);
  const reminderIds=idList(args.reminder_ids); const eventIds=idList(args.event_ids);
  let reminders=[];
  if(!reminderIds.length && !eventIds.length){
    const r=await q(`UPDATE jarvis_personal_reminders SET status='acknowledged',acknowledged_at=NOW(),updated_at=NOW() WHERE tenant_id::text=$1::text AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND status='pending' AND acknowledged_at IS NULL AND notified_at IS NOT NULL AND remind_at<=NOW()+interval '30 minutes' RETURNING *`,[ctx.tenant_id,ctx.user_id||null]);
    reminders=r.rows;
  }
  if(reminderIds.length){ const r=await q(`UPDATE jarvis_personal_reminders SET status='acknowledged',acknowledged_at=NOW(),updated_at=NOW() WHERE tenant_id::text=$1::text AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND id=ANY($3::bigint[]) RETURNING *`,[ctx.tenant_id,ctx.user_id||null,reminderIds]); reminders=r.rows; }
  if(eventIds.length){ const r=await q(`UPDATE jarvis_personal_reminders SET status='acknowledged',acknowledged_at=NOW(),updated_at=NOW() WHERE tenant_id::text=$1::text AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND event_id=ANY($3::bigint[]) RETURNING *`,[ctx.tenant_id,ctx.user_id||null,eventIds]); reminders=[...reminders,...r.rows]; }
  return {ok:true,acknowledged:reminders.length,assistant_message:'Entendido. Quedó confirmado de enterado y detuve la insistencia.'};
}

async function getAgenda(q,ctx,args={}){
  await ensurePersonalTables(q);
  const from=t(args.from)||new Date().toISOString(); const to=t(args.to)||new Date(Date.now()+7*864e5).toISOString();
  const ev=await q(`SELECT * FROM jarvis_personal_events WHERE tenant_id::text=$1::text AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND start_at BETWEEN $3::timestamptz AND $4::timestamptz AND status<>'cancelled' ORDER BY start_at`,[ctx.tenant_id,ctx.user_id||null,from,to]);
  const rr=await q(`SELECT * FROM jarvis_personal_reminders WHERE tenant_id::text=$1::text AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND remind_at BETWEEN $3::timestamptz AND $4::timestamptz AND status<>'cancelled' ORDER BY remind_at`,[ctx.tenant_id,ctx.user_id||null,from,to]);
  return {ok:true,from,to,events:ev.rows,reminders:rr.rows};
}



// ===================== JARVIS WhatsApp central =====================
// JARVIS consulta primero SU directorio. CliniqOne solo se consulta si el usuario
// lo autoriza explícitamente con allow_external_lookup=true.
async function ensureJarvisWhatsAppContacts(q){
  await q(`CREATE TABLE IF NOT EXISTS jarvis_whatsapp_contacts (
    id BIGSERIAL PRIMARY KEY, tenant_id UUID NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, phone)
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_jarvis_wa_contacts_name
    ON jarvis_whatsapp_contacts(tenant_id, lower(name), updated_at DESC)`);
}
function normalizeName(v){ return t(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); }

async function findJarvisWhatsAppContact(q,ctx,args={}){
  const query=t(args.query||args.contact_name||args.name||args.phone);
  if(!query) throw new Error('Falta el nombre o teléfono del contacto');
  const digits=query.replace(/\D/g,'');
  const channelId='JARVIS-WA-001';

  // IMPORTANTE: usar la MISMA fuente que la tarjeta/panel de WhatsApp de JARVIS.
  // Los contactos reales se guardan en jarvis_whatsapp_threads.contact_name.
  const {rows}=await q(`SELECT id, contact_name AS name, phone, claimed_at AS created_at, updated_at
    FROM jarvis_whatsapp_threads
    WHERE tenant_id::text=$1::text
      AND channel_id=$2
      AND COALESCE(hidden,FALSE)=FALSE
      AND (
        ($3<>'' AND regexp_replace(phone, '\\D', '', 'g') LIKE '%'||$3||'%')
        OR lower(COALESCE(contact_name,'')) LIKE '%'||lower($4)||'%'
      )
    ORDER BY
      CASE
        WHEN lower(COALESCE(contact_name,''))=lower($4) THEN 0
        WHEN lower(COALESCE(contact_name,'')) LIKE lower($4)||'%' THEN 1
        ELSE 2
      END,
      updated_at DESC, id DESC
    LIMIT 20`,[ctx.tenant_id,channelId,digits,query]);

  const exact=rows.filter(r=>normalizeName(r.name)===normalizeName(query) || (digits && String(r.phone||'').replace(/\D/g,'')===digits));
  const matches=exact.length?exact:rows;
  if(matches.length===1) return {ok:true,source:'jarvis_central',contact:matches[0],contacts:matches,assistant_message:`Encontré a ${matches[0].name} en tus contactos de JARVIS.`};
  if(matches.length>1) return {ok:true,source:'jarvis_central',contacts:matches,requires_selection:true,assistant_message:`Encontré ${matches.length} contactos que coinciden. Indícame cuál quieres usar.`};
  return {ok:true,source:'jarvis_central',contacts:[],not_found:true,requires_external_confirmation:true,
    assistant_message:`No encontré “${query}” en tus contactos de JARVIS. Puedo buscarlo en CliniqOne u otra herramienta, pero necesito tu confirmación primero.`};
}

async function sendJarvisWhatsAppMessage(q,ctx,args={}){
  const message=t(args.message); if(!message) throw new Error('Falta el mensaje');
  let phone=t(args.phone); let contact=null;
  const contactName=t(args.contact_name||args.name||args.query);
  if(!phone && contactName){
    const found=await findJarvisWhatsAppContact(q,ctx,{query:contactName});
    if(found.requires_selection || found.not_found) return found;
    contact=found.contact; phone=contact.phone;
  }
  // Compatibilidad: si el modelo puso un nombre en phone, resolverlo como contacto.
  if(phone && !/\d/.test(phone)){
    const found=await findJarvisWhatsAppContact(q,ctx,{query:phone});
    if(found.requires_selection || found.not_found) return found;
    contact=found.contact; phone=contact.phone;
  }
  if(!phone) throw new Error('Falta el contacto o número de WhatsApp');

  const base=t(process.env.INTERNAL_BASE_URL||process.env.RENDER_EXTERNAL_URL)||`http://127.0.0.1:${process.env.PORT||10000}`;
  const headers={'content-type':'application/json'};
  if(t(ctx.authorization)) headers.authorization=t(ctx.authorization);
  const r=await fetch(`${base}/api/whatsapp/jarvis/send-message`,{method:'POST',headers,body:JSON.stringify({phone,message})});
  const raw=await r.text(); let data={}; try{data=raw?JSON.parse(raw):{};}catch{data={raw};}
  if(!r.ok || data?.ok===false) throw new Error(data?.error||`No se pudo enviar el WhatsApp (${r.status})`);
  return {ok:true,source:'jarvis_central',contact:contact||null,phone:data?.phone||phone,message_id:data?.data?.messages?.[0]?.id||null,
    assistant_message:`Mensaje enviado por WhatsApp${contact?.name?` a ${contact.name}`:` al ${data?.phone||phone}`}.`,client_event:{type:'jarvis_whatsapp_changed'}};
}



// ===================== JARVIS Internet central V1 =====================
const dns = require('node:dns').promises;
const net = require('node:net');

async function ensureInternetHistory(q){
  await q(`CREATE TABLE IF NOT EXISTS jarvis_internet_history (
    id BIGSERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT,
    operation TEXT NOT NULL,
    query TEXT,
    url TEXT,
    title TEXT,
    result_count INTEGER DEFAULT 0,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_jarvis_internet_history_owner
    ON jarvis_internet_history(tenant_id,user_id,created_at DESC)`);
}

async function logInternet(q,ctx,data={}){
  await ensureInternetHistory(q);
  await q(`INSERT INTO jarvis_internet_history
    (tenant_id,user_id,operation,query,url,title,result_count,metadata)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [t(ctx.tenant_id),ctx.user_id||null,t(data.operation)||'unknown',t(data.query)||null,
     t(data.url)||null,t(data.title)||null,Number(data.result_count)||0,JSON.stringify(data.metadata||{})]);
}

function braveKey(){
  const key=t(process.env.BRAVE_SEARCH_API_KEY);
  if(!key) throw new Error('BRAVE_SEARCH_API_KEY no está configurada en Render');
  return key;
}

function normalizeFreshness(v){
  const x=t(v).toLowerCase();
  if(!x) return '';
  const map={day:'pd',dia:'pd',today:'pd',week:'pw',semana:'pw',month:'pm',mes:'pm',year:'py',ano:'py','año':'py'};
  return map[x]||x;
}

async function braveGet(endpoint, params={}){
  const u=new URL(`https://api.search.brave.com/res/v1/${endpoint}`);
  for(const [k,v] of Object.entries(params)){
    if(v!==undefined && v!==null && String(v)!=='') u.searchParams.set(k,String(v));
  }
  const r=await fetch(u,{headers:{
    'Accept':'application/json',
    'X-Subscription-Token':braveKey(),
    'User-Agent':'JARVIS/1.0'
  }});
  const raw=await r.text();
  let data={}; try{data=raw?JSON.parse(raw):{};}catch{data={raw};}
  if(!r.ok){
    const detail=data?.error?.detail||data?.error?.code||data?.message||`HTTP ${r.status}`;
    throw new Error(`Brave Search: ${detail}`);
  }
  return data;
}

async function internetSearch(q,ctx,args={}){
  const query=t(args.query||args.q);
  if(!query) throw new Error('Falta la búsqueda de Internet');
  const count=Math.min(20,Math.max(1,Number(args.count)||8));
  const data=await braveGet('web/search',{
    q:query,count,
    country:t(args.country)||'US',
    search_lang:t(args.search_lang)||'es',
    safesearch:t(args.safesearch)||'moderate',
    freshness:normalizeFreshness(args.freshness),
    extra_snippets:'true'
  });
  const results=(data?.web?.results||[]).slice(0,count).map((r,i)=>({
    rank:i+1,title:t(r.title),url:t(r.url),description:t(r.description),
    extra_snippets:Array.isArray(r.extra_snippets)?r.extra_snippets.slice(0,3):[],
    age:t(r.age),language:t(r.language)
  }));
  await logInternet(q,ctx,{operation:'search',query,result_count:results.length,
    metadata:{country:t(args.country)||'US',search_lang:t(args.search_lang)||'es'}});
  return {ok:true,source:'brave_search',query,results,
    more_results_available:Boolean(data?.query?.more_results_available),
    assistant_message:`Encontré ${results.length} resultados en Internet para: ${query}.`,
    client_event:{type:'jarvis_internet_changed'}};
}

function isPrivateIp(ip){
  if(net.isIPv4(ip)){
    const p=ip.split('.').map(Number);
    return p[0]===10 || p[0]===127 || p[0]===0 ||
      (p[0]===169&&p[1]===254) || (p[0]===172&&p[1]>=16&&p[1]<=31) ||
      (p[0]===192&&p[1]===168) || (p[0]===100&&p[1]>=64&&p[1]<=127) ||
      (p[0]===198&&(p[1]===18||p[1]===19));
  }
  if(net.isIPv6(ip)){
    const x=ip.toLowerCase();
    return x==='::1' || x==='::' || x.startsWith('fc') || x.startsWith('fd') ||
      x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb');
  }
  return true;
}

async function assertPublicUrl(raw){
  let u;
  try{u=new URL(raw);}catch{throw new Error('URL inválida');}
  if(!['http:','https:'].includes(u.protocol)) throw new Error('Solo se permiten URLs http/https');
  const host=u.hostname.toLowerCase();
  if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal'))
    throw new Error('Destino interno no permitido');
  if(net.isIP(host)){ if(isPrivateIp(host)) throw new Error('IP privada/interna no permitida'); }
  else{
    const addrs=await dns.lookup(host,{all:true,verbatim:true});
    if(!addrs.length || addrs.some(x=>isPrivateIp(x.address))) throw new Error('El dominio resuelve a una red privada/interna');
  }
  return u;
}

function htmlToText(html){
  return String(html||'')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,' ')
    .replace(/<!--[\s\S]*?-->/g,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
    .replace(/&#39;/g,"'").replace(/&quot;/gi,'"')
    .replace(/\s+/g,' ').trim();
}

async function fetchPublicPage(rawUrl){
  let current=await assertPublicUrl(rawUrl);
  for(let i=0;i<4;i++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),12000);
    let r;
    try{
      r=await fetch(current,{redirect:'manual',signal:controller.signal,headers:{
        'User-Agent':'Mozilla/5.0 (compatible; JARVIS/1.0; web-reader)',
        'Accept':'text/html,text/plain,application/xhtml+xml'
      }});
    } finally { clearTimeout(timer); }
    if([301,302,303,307,308].includes(r.status)){
      const loc=r.headers.get('location');
      if(!loc) throw new Error('Redirección sin destino');
      current=await assertPublicUrl(new URL(loc,current).toString());
      continue;
    }
    if(!r.ok) throw new Error(`La página respondió HTTP ${r.status}`);
    const type=(r.headers.get('content-type')||'').toLowerCase();
    if(!type.includes('text/html')&&!type.includes('text/plain')&&!type.includes('application/xhtml+xml'))
      throw new Error(`Tipo de contenido no soportado: ${type||'desconocido'}`);
    const raw=await r.text();
    if(raw.length>2_000_000) throw new Error('La página es demasiado grande para Internet V1');
    return {url:current.toString(),content_type:type,raw};
  }
  throw new Error('Demasiadas redirecciones');
}

async function internetReadPage(q,ctx,args={}){
  const url=t(args.url);
  if(!url) throw new Error('Falta la URL');
  const page=await fetchPublicPage(url);
  const title=(page.raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||'';
  const maxChars=Math.min(30000,Math.max(2000,Number(args.max_chars)||12000));
  const text=htmlToText(page.raw).slice(0,maxChars);
  await logInternet(q,ctx,{operation:'read_page',url:page.url,title:htmlToText(title),result_count:1,
    metadata:{content_type:page.content_type,characters:text.length}});
  return {ok:true,source:'direct_web_page',url:page.url,title:htmlToText(title),text,
    truncated:text.length>=maxChars,client_event:{type:'jarvis_internet_changed'}};
}

async function internetResearch(q,ctx,args={}){
  const query=t(args.query||args.q);
  if(!query) throw new Error('Falta el tema de investigación');
  const maxUrls=Math.min(6,Math.max(3,Number(args.maximum_number_of_urls)||5));
  const maxTokens=Math.min(5000,Math.max(1024,Number(args.maximum_number_of_tokens)||3000));
  const data=await braveGet('llm/context',{
    q:query,
    country:t(args.country)||'US',
    search_lang:t(args.search_lang)||'es',
    safesearch:t(args.safesearch)||'moderate',
    freshness:normalizeFreshness(args.freshness),
    maximum_number_of_urls:maxUrls,
    maximum_number_of_tokens:maxTokens,
    enable_source_metadata:'true'
  });
  const items=(data?.grounding?.generic||[]).map((x,i)=>({
    rank:i+1,url:t(x.url),title:t(x.title),
    snippets:Array.isArray(x.snippets)?x.snippets:[]
  }));
  await logInternet(q,ctx,{operation:'research',query,result_count:items.length,
    metadata:{maximum_number_of_urls:maxUrls,maximum_number_of_tokens:maxTokens}});
  return {ok:true,source:'brave_llm_context',query,sources:items,source_metadata:data?.sources||{},
    assistant_instruction:'Sintetiza la investigación usando únicamente estas fuentes. Distingue hechos de inferencias y menciona las URLs relevantes.',
    client_event:{type:'jarvis_internet_changed'}};
}

async function internetGetHistory(q,ctx,args={}){
  await ensureInternetHistory(q);
  const limit=Math.min(100,Math.max(1,Number(args.limit)||20));
  const op=t(args.operation);
  const params=[t(ctx.tenant_id),ctx.user_id||null];
  let extra='';
  if(op){params.push(op);extra=` AND operation=$3`;}
  params.push(limit);
  const limitPos=params.length;
  const r=await q(`SELECT id,operation,query,url,title,result_count,metadata,created_at
    FROM jarvis_internet_history
    WHERE tenant_id=$1 AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL))${extra}
    ORDER BY created_at DESC LIMIT $${limitPos}`,params);
  return {ok:true,source:'jarvis_internet_history',total:r.rows.length,items:r.rows};
}

async function reportInternet(q,ctx,args={}){
  await ensureInternetHistory(q);
  const r=await q(`SELECT COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE created_at>=NOW()-interval '24 hours')::int AS today,
    MAX(created_at) AS last_activity
    FROM jarvis_internet_history
    WHERE tenant_id=$1 AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL))`,
    [t(ctx.tenant_id),ctx.user_id||null]);
  return {module:'internet',status:process.env.BRAVE_SEARCH_API_KEY?'operativo':'no_conectado',
    validated:true,provider:'Brave Search API',api_configured:Boolean(process.env.BRAVE_SEARCH_API_KEY),
    searches_and_reads_total:r.rows[0]?.total||0,activity_last_24h:r.rows[0]?.today||0,
    last_activity:r.rows[0]?.last_activity||null};
}


// ===================== Reportes centrales de tarjetas JARVIS =====================
const JARVIS_CARD_MODULES=['agenda','recordatorios','whatsapp','correo','llamadas','internet'];

async function fetchJarvisInternal(ctx,path){
  const base=t(process.env.INTERNAL_BASE_URL||process.env.RENDER_EXTERNAL_URL)||`http://127.0.0.1:${process.env.PORT||10000}`;
  const headers={};
  if(t(ctx.authorization)) headers.authorization=t(ctx.authorization);
  if(t(ctx.branch_key)) headers['x-sucursal']=t(ctx.branch_key);
  const r=await fetch(`${base}${path}`,{headers});
  const raw=await r.text();
  let data=null; try{data=raw?JSON.parse(raw):null;}catch{data=raw;}
  if(!r.ok) throw new Error(`${path} respondió ${r.status}${data?.error?`: ${data.error}`:''}`);
  return data;
}
function normalizeArrayPayload(data){
  if(Array.isArray(data)) return data;
  for(const k of ['items','messages','contacts','data']) if(Array.isArray(data?.[k])) return data[k];
  return [];
}
async function reportAgenda(q,ctx,args={}){
  await ensurePersonalTables(q);
  const days=Math.min(30,Math.max(1,Number(args.days)||7));
  const now=new Date(), to=new Date(now.getTime()+days*864e5);
  const r=await q(`SELECT id,title,start_at,end_at,location,status FROM jarvis_personal_events
    WHERE tenant_id::text=$1::text AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL))
    AND status<>'cancelled' AND start_at BETWEEN $3::timestamptz AND $4::timestamptz
    ORDER BY start_at LIMIT 50`,[ctx.tenant_id,ctx.user_id||null,now.toISOString(),to.toISOString()]);
  return {module:'agenda',status:'operativo',validated:true,period_days:days,total:r.rows.length,upcoming:r.rows.slice(0,10)};
}
async function reportReminders(q,ctx,args={}){
  await ensurePersonalTables(q);
  const days=Math.min(30,Math.max(1,Number(args.days)||7));
  const now=new Date(), to=new Date(now.getTime()+days*864e5);
  const r=await q(`SELECT id,title,remind_at,priority,status,notified_at,acknowledged_at FROM jarvis_personal_reminders
    WHERE tenant_id::text=$1::text AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL))
    AND status<>'cancelled' AND remind_at BETWEEN $3::timestamptz AND $4::timestamptz
    ORDER BY remind_at LIMIT 50`,[ctx.tenant_id,ctx.user_id||null,now.toISOString(),to.toISOString()]);
  return {module:'recordatorios',status:'operativo',validated:true,period_days:days,total:r.rows.length,
    pending:r.rows.filter(x=>String(x.status||'pending').toLowerCase()==='pending').length,items:r.rows.slice(0,10)};
}
async function reportWhatsApp(q,ctx,args={}){
  const limit=Math.min(1000,Math.max(20,Number(args.limit)||250));
  const [mp,cp]=await Promise.all([
    fetchJarvisInternal(ctx,`/api/whatsapp/jarvis/messages?limit=${limit}`),
    fetchJarvisInternal(ctx,'/api/whatsapp/jarvis/contacts')
  ]);
  const messages=normalizeArrayPayload(mp), contacts=normalizeArrayPayload(cp);
  const incoming=messages.filter(m=>String(m.type||m.direction||'').toLowerCase()==='incoming').length;
  const outgoing=messages.filter(m=>String(m.type||m.direction||'').toLowerCase()==='outgoing').length;
  const phones=new Set(messages.map(m=>t(m.phone)).filter(Boolean));
  const recent=messages.slice().sort((a,b)=>new Date(b.timestamp||b.created_at||0)-new Date(a.timestamp||a.created_at||0)).slice(0,10);
  return {module:'whatsapp',status:'operativo',validated:true,source:'JARVIS-WA-001',scope:'tarjeta_central_jarvis',
    contacts:contacts.length,messages:messages.length,conversations:phones.size,incoming,outgoing,recent};
}
function unavailableCard(module,reason){return {module,status:'no_conectado',validated:false,reason};}
async function getJarvisModuleReport(q,ctx,args={}){
  const raw=normalizeName(args.module||args.card||'');
  const aliases={agenda:'agenda',calendario:'agenda',recordatorio:'recordatorios',recordatorios:'recordatorios',
    whatsapp:'whatsapp',wa:'whatsapp',correo:'correo',email:'correo',mail:'correo',
    llamada:'llamadas',llamadas:'llamadas',telefono:'llamadas',internet:'internet',web:'internet'};
  const module=aliases[raw]||raw;
  if(!JARVIS_CARD_MODULES.includes(module)) throw new Error(`Módulo no reconocido: ${module}`);
  if(module==='agenda') return reportAgenda(q,ctx,args);
  if(module==='recordatorios') return reportReminders(q,ctx,args);
  if(module==='whatsapp') return reportWhatsApp(q,ctx,args);
  if(module==='correo') return unavailableCard('correo','La tarjeta todavía no tiene una fuente de correo conectada al backend central.');
  if(module==='llamadas') return unavailableCard('llamadas','La tarjeta todavía no tiene una fuente de llamadas conectada al backend central.');
  return reportInternet(q,ctx,args);
}
async function getJarvisCardsReport(q,ctx,args={}){
  const requested=Array.isArray(args.modules)&&args.modules.length?args.modules:JARVIS_CARD_MODULES;
  const reports=[];
  for(const module of requested){
    try{reports.push(await getJarvisModuleReport(q,ctx,{...args,module}));}
    catch(error){reports.push({module:String(module),status:'con_incidencia',validated:false,error:error.message});}
  }
  return {ok:true,source:'jarvis_central',scope:'tarjetas_centrales',generated_at:new Date().toISOString(),reports};
}

// ===================== JARVIS Skill Builder =====================
// Estas herramientas son propias de JARVIS. No deben caer al ejecutor F1.
async function ensureSkillBuilderTables(q){
  await q(`CREATE TABLE IF NOT EXISTS jarvis_skill_drafts (
    id BIGSERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT,
    name TEXT NOT NULL,
    purpose TEXT,
    proposed_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
    proposed_card TEXT,
    required_services TEXT,
    estimated_cost TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_jarvis_skill_drafts_owner
    ON jarvis_skill_drafts(tenant_id,user_id,updated_at DESC)`);
  // Skill Installer V1: metadatos de activación. ALTER es idempotente y no rompe borradores existentes.
  await q(`ALTER TABLE jarvis_skill_drafts ADD COLUMN IF NOT EXISTS installed_at TIMESTAMPTZ`);
  await q(`ALTER TABLE jarvis_skill_drafts ADD COLUMN IF NOT EXISTS installer_type TEXT`);
  await q(`ALTER TABLE jarvis_skill_drafts ADD COLUMN IF NOT EXISTS runtime_config JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await q(`ALTER TABLE jarvis_skill_drafts ADD COLUMN IF NOT EXISTS workflow_config JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await q(`ALTER TABLE jarvis_skill_drafts ADD COLUMN IF NOT EXISTS validation_report JSONB NOT NULL DEFAULT '{}'::jsonb`);
}


function isWeatherSkillDraft(d={}){
  const haystack=[d.name,d.purpose,d.proposed_card,d.required_services,...(Array.isArray(d.proposed_tools)?d.proposed_tools:[])]
    .map(x=>t(x).toLowerCase()).join(' ');
  return /\b(clima|tiempo|weather|meteorolog|temperatura|pron[oó]stico)\b/i.test(haystack);
}


function skillHaystack(d={}){
  return [d.name,d.purpose,d.proposed_card,d.required_services,
    ...(Array.isArray(d.proposed_tools)?d.proposed_tools:[])]
    .map(x=>typeof x==='string'?x:JSON.stringify(x||'')).join(' ').toLowerCase();
}
function isPlacesSkillDraft(d={}){
  const h=skillHaystack(d);
  return /(openstreetmap|nominatim|mapa|lugares|ubicacion|ubicación|geocod|places|map\b)/i.test(h);
}
function isReadOnlyWebSkillDraft(d={}){
  const h=skillHaystack(d);
  return /(buscar|busqueda|búsqueda|consulta|search|internet|web|api|https)/i.test(h);
}
function parseJsonObject(v,fallback={}){
  if(v&&typeof v==='object'&&!Array.isArray(v)) return v;
  if(typeof v==='string'&&v.trim()){
    try{const x=JSON.parse(v); return x&&typeof x==='object'&&!Array.isArray(x)?x:fallback;}catch{}
  }
  return fallback;
}
function inferSafeRuntime(d={}){
  if(isWeatherSkillDraft(d)) return {type:'weather',provider:'open-meteo',api_key_required:false};
  if(isPlacesSkillDraft(d)) return {type:'places',provider:'openstreetmap-nominatim',api_key_required:false};
  const wf=parseJsonObject(d.workflow_config,{});
  if(wf && Array.isArray(wf.steps) && wf.steps.length) return {type:'declarative_v4',provider:'allowlisted_https',api_key_required:false,workflow:wf};
  return null;
}

function applyFreeServiceFallback(d={}){
  const out={...d,proposed_tools:Array.isArray(d.proposed_tools)?[...d.proposed_tools]:[]};
  const cost=t(out.estimated_cost).toLowerCase()||'unknown';

  // V1: para clima preferimos una fuente sin API key antes de dejar el costo en unknown.
  // No convertimos servicios explícitamente de pago.
  if(cost==='unknown' && isWeatherSkillDraft(out)){
    out.estimated_cost='free';
    out.required_services='Open-Meteo (sin API key; usar dentro de los términos del proveedor)';
    if(!out.proposed_tools.some(x=>/open-meteo/i.test(t(x)))){
      out.proposed_tools.push('Consulta HTTPS a Open-Meteo para clima actual y pronóstico');
    }
    out.free_fallback_applied=true;
  }
  return out;
}

function normalizeSkillDraftArgs(args={}){
  // Acepta tanto el contrato nuevo como los nombres que Realtime ya está enviando.
  const toolsRaw=args.proposed_tools ?? args.tools_needed ?? [];
  const proposedTools=Array.isArray(toolsRaw)
    ? toolsRaw.map(x=>t(x)).filter(Boolean)
    : (t(toolsRaw) ? [t(toolsRaw)] : []);
  return applyFreeServiceFallback({
    name:t(args.name||args.skill_name||args.title),
    purpose:t(args.purpose||args.objective||args.description),
    proposed_tools:proposedTools,
    proposed_card:t(args.proposed_card||args.interface||args.card),
    required_services:t(args.required_services||args.services_required||args.services),
    estimated_cost:t(args.estimated_cost||args.cost)||'unknown',
    workflow_config:parseJsonObject(args.workflow_config||args.workflow||args.runtime_workflow,{})
  });
}

async function createSkillDraft(q,ctx,args={}){
  await ensureSkillBuilderTables(q);
  const d=normalizeSkillDraftArgs(args);
  if(!d.name) throw new Error('Falta el nombre de la habilidad');
  if(!d.purpose) throw new Error('Falta el propósito de la habilidad');
  const {rows}=await q(`INSERT INTO jarvis_skill_drafts
    (tenant_id,user_id,name,purpose,proposed_tools,proposed_card,required_services,estimated_cost,status,workflow_config)
    VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,'draft',$9::jsonb) RETURNING *`,[
      t(ctx.tenant_id),ctx.user_id||null,d.name,d.purpose,JSON.stringify(d.proposed_tools),
      d.proposed_card||null,d.required_services||null,d.estimated_cost,JSON.stringify(d.workflow_config||{})
    ]);
  const draft=rows[0];
  return {ok:true,source:'jarvis_skill_builder',draft,
    assistant_message:`Listo. Creé el borrador de la habilidad “${draft.name}”. Quedó pendiente de revisión antes de instalarse.`,
    client_event:{type:'jarvis_skill_builder_changed',draft_id:draft.id}};
}

async function listSkillDrafts(q,ctx,args={}){
  await ensureSkillBuilderTables(q);
  const limit=Math.min(100,Math.max(1,Number(args.limit)||20));
  const {rows}=await q(`SELECT * FROM jarvis_skill_drafts
    WHERE tenant_id=$1 AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL))
    ORDER BY updated_at DESC LIMIT $3`,[t(ctx.tenant_id),ctx.user_id||null,limit]);
  return {ok:true,source:'jarvis_skill_builder',drafts:rows,total:rows.length};
}

async function getSkillDraft(q,ctx,args={}){
  await ensureSkillBuilderTables(q);
  const id=Number(args.id ?? args.draft_id);
  if(!Number.isSafeInteger(id) || id<=0) throw new Error('Falta un ID de habilidad válido');
  const {rows}=await q(`SELECT * FROM jarvis_skill_drafts
    WHERE tenant_id=$1 AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND id=$3
    LIMIT 1`,[t(ctx.tenant_id),ctx.user_id||null,id]);
  if(!rows[0]) throw new Error('No encontré ese borrador de habilidad');
  return {ok:true,source:'jarvis_skill_builder',draft:rows[0]};
}

async function approveSkillDraft(q,ctx,args={}){
  const current=await getSkillDraft(q,ctx,args);
  let draft=current.draft;
  let cost=t(draft.estimated_cost).toLowerCase() || 'unknown';

  // Si un borrador viejo de clima quedó en unknown, migramos primero a la alternativa
  // gratuita conocida en vez de obligar al usuario a recrearlo.
  if(cost==='unknown' && isWeatherSkillDraft(draft)){
    const fallback=applyFreeServiceFallback({
      ...draft,
      proposed_tools:Array.isArray(draft.proposed_tools)?draft.proposed_tools:[],
      estimated_cost:'unknown'
    });
    const {rows}=await q(`UPDATE jarvis_skill_drafts
      SET proposed_tools=$4::jsonb,required_services=$5,estimated_cost='free',status='draft',updated_at=NOW()
      WHERE tenant_id=$1 AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND id=$3 RETURNING *`,
      [t(ctx.tenant_id),ctx.user_id||null,draft.id,JSON.stringify(fallback.proposed_tools),fallback.required_services]);
    draft=rows[0]||draft;
    cost='free';
  }

  // La aprobación normal solo procede cuando el borrador está confirmado como gratuito.
  // unknown/paid NO generan un 400: devolvemos un resultado explicable a Realtime.
  if(cost!=='free'){
    const nextStatus=cost==='paid'?'blocked_cost_review':'cost_review';
    const {rows}=await q(`UPDATE jarvis_skill_drafts SET status=$4,updated_at=NOW()
      WHERE tenant_id=$1 AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND id=$3 RETURNING *`,
      [t(ctx.tenant_id),ctx.user_id||null,draft.id,nextStatus]);
    return {ok:false,source:'jarvis_skill_builder',draft:rows[0],requires_cost_confirmation:true,
      assistant_message:cost==='paid'
        ? `La habilidad “${draft.name}” indica un servicio de pago. No la aprobé; requiere autorización explícita de costo.`
        : `La habilidad “${draft.name}” tiene costo todavía sin confirmar. Antes de aprobarla debo confirmar que los servicios elegidos sean gratuitos.`,
      client_event:{type:'jarvis_skill_builder_changed',draft_id:draft.id}};
  }

  if(t(draft.status).toLowerCase()==='active' || t(draft.status).toLowerCase()==='installed'){
    return {ok:true,source:'jarvis_skill_builder',draft,already_approved:true,executable:true,
      assistant_message:`La habilidad “${draft.name}” ya está instalada y activa.`};
  }
  if(t(draft.status).toLowerCase()==='approved'){
    return installApprovedSkill(q,ctx,{id:draft.id});
  }
  if(t(draft.status).toLowerCase()==='rejected'){
    return {ok:false,source:'jarvis_skill_builder',draft,
      assistant_message:`La habilidad “${draft.name}” está rechazada. Debe crearse o reabrirse una propuesta antes de aprobarla.`};
  }

  const {rows}=await q(`UPDATE jarvis_skill_drafts SET status='approved',updated_at=NOW()
    WHERE tenant_id=$1 AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND id=$3 RETURNING *`,
    [t(ctx.tenant_id),ctx.user_id||null,draft.id]);
  const approved=rows[0];
  const installed=await installApprovedSkill(q,ctx,{id:approved.id});
  if(installed?.ok) return installed;
  return {...installed,draft:approved,client_event:{type:'jarvis_skill_builder_changed',draft_id:approved.id}};
}

async function rejectSkillDraft(q,ctx,args={}){
  await ensureSkillBuilderTables(q);
  const id=Number(args.id ?? args.draft_id);
  if(!Number.isSafeInteger(id) || id<=0) throw new Error('Falta un ID de habilidad válido');
  const {rows}=await q(`UPDATE jarvis_skill_drafts SET status='rejected',updated_at=NOW()
    WHERE tenant_id=$1 AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND id=$3 RETURNING *`,
    [t(ctx.tenant_id),ctx.user_id||null,id]);
  if(!rows[0]) throw new Error('No encontré ese borrador de habilidad');
  return {ok:true,source:'jarvis_skill_builder',draft:rows[0],reason:t(args.reason)||null,
    assistant_message:`La propuesta “${rows[0].name}” fue rechazada y no se instalará.`,
    client_event:{type:'jarvis_skill_builder_changed',draft_id:id}};
}



// ===================== JARVIS Skill Installer V1 =====================
// Instalación controlada: NO toca archivos, GitHub, Render, secretos ni servicios de pago.
// V1 solo activa runtimes que ya vienen incluidos en el backend. El primero es clima vía Open-Meteo.
function weatherCodeText(code){
  const c=Number(code);
  const map={0:'despejado',1:'mayormente despejado',2:'parcialmente nublado',3:'nublado',45:'niebla',48:'niebla con escarcha',51:'llovizna ligera',53:'llovizna moderada',55:'llovizna intensa',56:'llovizna helada ligera',57:'llovizna helada intensa',61:'lluvia ligera',63:'lluvia moderada',65:'lluvia intensa',66:'lluvia helada ligera',67:'lluvia helada intensa',71:'nieve ligera',73:'nieve moderada',75:'nieve intensa',77:'granos de nieve',80:'chubascos ligeros',81:'chubascos moderados',82:'chubascos fuertes',85:'chubascos de nieve ligeros',86:'chubascos de nieve fuertes',95:'tormenta',96:'tormenta con granizo ligero',99:'tormenta con granizo fuerte'};
  return map[c]||`código meteorológico ${c}`;
}

async function findSkillDraftByRef(q,ctx,args={}){
  await ensureSkillBuilderTables(q);
  const id=Number(args.id ?? args.draft_id ?? args.skill_id);
  if(Number.isSafeInteger(id)&&id>0) return (await getSkillDraft(q,ctx,{id})).draft;
  const name=t(args.name||args.skill_name);
  if(!name) throw new Error('Falta el ID o nombre de la habilidad');
  const {rows}=await q(`SELECT * FROM jarvis_skill_drafts
    WHERE tenant_id=$1 AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL))
      AND lower(name)=lower($3)
    ORDER BY updated_at DESC LIMIT 1`,[t(ctx.tenant_id),ctx.user_id||null,name]);
  if(rows[0]) return rows[0];
  const fuzzy=await q(`SELECT * FROM jarvis_skill_drafts
    WHERE tenant_id=$1 AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL))
      AND lower(name) LIKE '%'||lower($3)||'%'
    ORDER BY updated_at DESC LIMIT 5`,[t(ctx.tenant_id),ctx.user_id||null,name]);
  if(fuzzy.rows.length===1) return fuzzy.rows[0];
  if(fuzzy.rows.length>1) return {ambiguous:true,matches:fuzzy.rows};
  throw new Error(`No encontré la habilidad “${name}”`);
}

async function installApprovedSkill(q,ctx,args={}){
  const draft=await findSkillDraftByRef(q,ctx,args);
  if(draft?.ambiguous) return {ok:false,requires_selection:true,skills:draft.matches,assistant_message:'Encontré varias habilidades con ese nombre. Indícame cuál deseas instalar.'};
  const status=t(draft.status).toLowerCase();
  const cost=t(draft.estimated_cost).toLowerCase();
  if(status==='active' || status==='installed') return {ok:true,already_installed:true,skill:draft,executable:true,assistant_message:`La habilidad “${draft.name}” ya está activa.`};
  if(status!=='approved') return {ok:false,requires_approval:true,skill:draft,assistant_message:`La habilidad “${draft.name}” todavía no está aprobada. Debe aprobarse antes de instalarla.`};
  if(cost!=='free') return {ok:false,requires_cost_confirmation:true,skill:draft,assistant_message:`No instalé “${draft.name}” porque su costo no está confirmado como gratuito.`};

  const inferred=inferSafeRuntime(draft);
  if(!inferred){
    const report={ok:false,reason:'no_safe_runtime_manifest',checked_at:new Date().toISOString()};
    await q(`UPDATE jarvis_skill_drafts SET validation_report=$4::jsonb,updated_at=NOW()
      WHERE tenant_id=$1 AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND id=$3`,
      [t(ctx.tenant_id),ctx.user_id||null,draft.id,JSON.stringify(report)]);
    return {ok:false,unsupported_runtime:true,skill:draft,validation_report:report,
      assistant_message:`“${draft.name}” está aprobada, pero no contiene un workflow declarativo seguro que V4 pueda validar. No ejecuté código arbitrario.`};
  }

  const config={...inferred,installed_by:'jarvis_universal_runtime_v4'};
  const report={ok:true,runtime:config.type,provider:config.provider,checked_at:new Date().toISOString(),
    safety:['no_arbitrary_javascript','no_local_network','no_paid_service_auto_activation']};
  const {rows}=await q(`UPDATE jarvis_skill_drafts
    SET status='active',installed_at=NOW(),installer_type='universal_runtime_v4',
        runtime_config=$4::jsonb,validation_report=$5::jsonb,updated_at=NOW()
    WHERE tenant_id=$1 AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND id=$3 RETURNING *`,
    [t(ctx.tenant_id),ctx.user_id||null,draft.id,JSON.stringify(config),JSON.stringify(report)]);
  return {ok:true,source:'jarvis_universal_skill_runtime_v4',skill:rows[0],executable:true,validation_report:report,
    assistant_message:`Validé, instalé y activé “${draft.name}” con Universal Skill Runtime V4 (${config.type}).`,
    client_event:{type:'jarvis_skill_builder_changed',draft_id:draft.id}};
}

async function geocodeOpenMeteo(location){
  const url=`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=5&language=es&format=json`;
  const r=await fetch(url,{headers:{accept:'application/json','user-agent':'JARVIS/1.0'}});
  if(!r.ok) throw new Error(`Open-Meteo geocoding respondió ${r.status}`);
  const data=await r.json();
  const place=Array.isArray(data?.results)?data.results[0]:null;
  if(!place) throw new Error(`No encontré la ubicación “${location}”`);
  return place;
}

async function runWeatherSkill(q,ctx,draft,args={}){
  const location=t(args.location||args.city||args.ciudad||args.place);
  if(!location) return {ok:false,requires_location:true,assistant_message:'¿De qué ciudad o ubicación desea consultar el clima?'};
  const place=await geocodeOpenMeteo(location);
  const params=new URLSearchParams({
    latitude:String(place.latitude),longitude:String(place.longitude),timezone:'auto',
    current:'temperature_2m,apparent_temperature,weather_code,wind_speed_10m',
    daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    forecast_days:'4'
  });
  const r=await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`,{headers:{accept:'application/json','user-agent':'JARVIS/1.0'}});
  if(!r.ok) throw new Error(`Open-Meteo forecast respondió ${r.status}`);
  const data=await r.json();
  const days=(data?.daily?.time||[]).map((date,i)=>({date,condition:weatherCodeText(data.daily.weather_code?.[i]),max_c:data.daily.temperature_2m_max?.[i],min_c:data.daily.temperature_2m_min?.[i],rain_probability:data.daily.precipitation_probability_max?.[i]}));
  const result={location:{name:place.name,admin1:place.admin1||null,country:place.country||null,latitude:place.latitude,longitude:place.longitude},current:{temperature_c:data?.current?.temperature_2m,feels_like_c:data?.current?.apparent_temperature,condition:weatherCodeText(data?.current?.weather_code),wind_kmh:data?.current?.wind_speed_10m},forecast:days,provider:'Open-Meteo',skill_id:draft.id,skill_name:draft.name};
  const today=days[0];
  return {ok:true,source:'jarvis_skill_runtime',result,
    assistant_message:`En ${place.name}${place.admin1?`, ${place.admin1}`:''}, ahora hay ${result.current.temperature_c} °C, sensación de ${result.current.feels_like_c} °C y está ${result.current.condition}. Hoy se esperan entre ${today?.min_c} y ${today?.max_c} °C, con hasta ${today?.rain_probability ?? 0}% de probabilidad de precipitación.`};
}


function safePublicHttpsUrl(raw){
  let u; try{u=new URL(String(raw||''));}catch{throw new Error('URL inválida en workflow');}
  if(u.protocol!=='https:') throw new Error('V4 solo permite HTTPS');
  const h=u.hostname.toLowerCase();
  if(h==='localhost'||h.endsWith('.local')||h==='0.0.0.0'||h==='127.0.0.1'||h==='::1'||
     /^10\./.test(h)||/^192\.168\./.test(h)||/^169\.254\./.test(h)||/^172\.(1[6-9]|2\d|3[01])\./.test(h))
    throw new Error('Destino local/privado bloqueado');
  return u;
}
const placesCache=new Map();
function cacheGetPlaceQuery(key){
  const hit=placesCache.get(key);
  if(!hit) return null;
  if(Date.now()-hit.at>10*60*1000){placesCache.delete(key);return null;}
  return hit.value;
}
function cacheSetPlaceQuery(key,value){
  placesCache.set(key,{at:Date.now(),value});
  if(placesCache.size>200){const first=placesCache.keys().next().value;placesCache.delete(first);}
}
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
async function fetchNominatimPlaces(query){
  const u=new URL('https://nominatim.openstreetmap.org/search');
  u.searchParams.set('q',query);u.searchParams.set('format','jsonv2');u.searchParams.set('addressdetails','1');u.searchParams.set('limit','8');
  for(let attempt=0;attempt<2;attempt++){
    const r=await fetch(u,{headers:{accept:'application/json','accept-language':'es,en;q=0.8','user-agent':'CliniqOne-JARVIS/4.2 (places search)'}});
    if(r.ok){
      const data=await r.json();
      return (Array.isArray(data)?data:[]).map(x=>({
        name:x.name||String(x.display_name||'').split(',')[0]||'Lugar',
        display_name:x.display_name||null,lat:Number(x.lat),lon:Number(x.lon),
        type:x.type||null,category:x.category||x.class||null,address:x.address||{},provider:'nominatim'
      }));
    }
    if(r.status!==429 && r.status<500) throw new Error(`Nominatim respondió ${r.status}`);
    if(attempt===0) await sleep(900);
  }
  return null;
}
async function fetchOpenMeteoPlaceFallback(query){
  const u=new URL('https://geocoding-api.open-meteo.com/v1/search');
  u.searchParams.set('name',query);u.searchParams.set('count','8');u.searchParams.set('language','es');u.searchParams.set('format','json');
  const r=await fetch(u,{headers:{accept:'application/json','user-agent':'CliniqOne-JARVIS/4.2'}});
  if(!r.ok) throw new Error(`Proveedor alternativo respondió ${r.status}`);
  const data=await r.json();
  return (Array.isArray(data?.results)?data.results:[]).map(x=>({
    name:x.name||'Lugar',
    display_name:[x.name,x.admin1,x.country].filter(Boolean).join(', '),
    lat:Number(x.latitude),lon:Number(x.longitude),
    type:x.feature_code||null,category:'geocoding',address:{city:x.name,state:x.admin1,country:x.country},provider:'open-meteo-geocoding'
  }));
}
async function runPlacesSkill(q,ctx,draft,args={}){
  const query=t(args.query||args.search||args.place||args.location||args.city||args.request);
  if(!query) return {ok:false,requires_query:true,assistant_message:'¿Qué lugar o dirección desea buscar?'};
  const key=query.toLowerCase();
  const cached=cacheGetPlaceQuery(key);
  if(cached) return {...cached,cached:true};

  let places=null,provider='OpenStreetMap/Nominatim';
  try{places=await fetchNominatimPlaces(query);}catch(error){
    console.warn('[JARVIS PLACES] Nominatim error, usando fallback:',error?.message||error);
  }
  if(!places){
    places=await fetchOpenMeteoPlaceFallback(query);
    provider='Open-Meteo Geocoding (fallback)';
  }
  const payload={ok:true,source:'jarvis_universal_skill_runtime_v4_2',provider,
    result:{query,places,center:places[0]?{lat:places[0].lat,lon:places[0].lon}:null,skill_id:draft.id,skill_name:draft.name},
    assistant_message:places.length?`Encontré ${places.length} resultado${places.length===1?'':'s'} para “${query}”.`:`No encontré resultados para “${query}”.`};
  cacheSetPlaceQuery(key,payload);
  return payload;
}

function bindTemplate(value,args){
  if(typeof value!=='string') return value;
  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,(_,k)=>encodeURIComponent(t(args[k])));
}
async function runDeclarativeV4(draft,args={}){
  const cfg=draft.runtime_config&&typeof draft.runtime_config==='object'?draft.runtime_config:{};
  const wf=cfg.workflow||parseJsonObject(draft.workflow_config,{});
  const steps=Array.isArray(wf.steps)?wf.steps:[];
  if(!steps.length) return {ok:false,unsupported_runtime:true,assistant_message:'La habilidad no tiene pasos declarativos ejecutables.'};
  let last=null; const outputs=[];
  for(const step of steps.slice(0,12)){
    const op=t(step.op||step.type).toLowerCase();
    if(op==='http_get_json'||op==='http_get'){
      const raw=bindTemplate(step.url,args);
      const u=safePublicHttpsUrl(raw);
      const r=await fetch(u,{headers:{accept:'application/json','user-agent':'JARVIS-CliniqOne/4.0'}});
      if(!r.ok) throw new Error(`HTTP ${r.status} en ${u.hostname}`);
      last=await r.json(); outputs.push({op,url:u.origin+u.pathname,result:last});
    }else if(op==='select'||op==='pick'){
      const path=String(step.path||'').split('.').filter(Boolean);
      let v=last; for(const p of path){v=v?.[p];}
      last=v; outputs.push({op,path:step.path,result:last});
    }else{
      throw new Error(`Operación declarativa no permitida: ${op}`);
    }
  }
  return {ok:true,source:'jarvis_universal_skill_runtime_v4',result:last,steps:outputs,skill_id:draft.id,skill_name:draft.name,
    assistant_message:`Ejecuté “${draft.name}” correctamente.`};
}

async function runInstalledSkill(q,ctx,args={}){
  await ensureSkillBuilderTables(q);
  let draft=null;
  if(args.id||args.draft_id||args.skill_id||args.name||args.skill_name){
    draft=await findSkillDraftByRef(q,ctx,args);
    if(draft?.ambiguous) return {ok:false,requires_selection:true,skills:draft.matches,assistant_message:'Encontré varias habilidades. Indícame cuál deseas ejecutar.'};
  }else{
    const intent=t(args.intent||args.request||args.action);
    if(/clima|tiempo|weather|temperatura|pron[oó]stico/i.test(intent)){
      const {rows}=await q(`SELECT * FROM jarvis_skill_drafts WHERE tenant_id=$1 AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND status='active' ORDER BY updated_at DESC`,[t(ctx.tenant_id),ctx.user_id||null]);
      draft=rows.find(isWeatherSkillDraft)||null;
    }
  }
  if(!draft) throw new Error('No encontré una habilidad activa que pueda ejecutar esa solicitud');
  if(t(draft.status).toLowerCase()!=='active') return {ok:false,not_active:true,skill:draft,assistant_message:`La habilidad “${draft.name}” no está activa todavía.`};
  const cfg=draft.runtime_config&&typeof draft.runtime_config==='object'?draft.runtime_config:{};
  if(cfg.type==='weather'||isWeatherSkillDraft(draft)) return runWeatherSkill(q,ctx,draft,args);
  if(cfg.type==='places'||isPlacesSkillDraft(draft)) return runPlacesSkill(q,ctx,draft,args);
  if(cfg.type==='declarative_v4') return runDeclarativeV4(draft,args);
  return {ok:false,unsupported_runtime:true,skill:draft,assistant_message:`La habilidad “${draft.name}” está activa, pero su runtime V4 no está disponible.`};
}

const personalHandlers={personal_create_event:createEvent,personal_create_reminder:createReminder,personal_acknowledge:acknowledge,personal_get_agenda:getAgenda,find_whatsapp_contact:findJarvisWhatsAppContact,send_whatsapp_message:sendJarvisWhatsAppMessage,jarvis_get_module_report:getJarvisModuleReport,jarvis_get_cards_report:getJarvisCardsReport,internet_search:internetSearch,internet_read_page:internetReadPage,internet_research:internetResearch,internet_get_history:internetGetHistory,skill_create_draft:createSkillDraft,skill_list_drafts:listSkillDrafts,skill_get_draft:getSkillDraft,skill_approve_draft:approveSkillDraft,skill_reject_draft:rejectSkillDraft,skill_install_approved:installApprovedSkill,skill_run:runInstalledSkill};
async function executeTool(q,ctx,name,args){ if(personalHandlers[name]) return personalHandlers[name](q,ctx,args||{}); return executeCliniqOneTool(q,ctx,name,args||{}); }
module.exports={executeTool,personalHandlers,ensurePersonalTables};

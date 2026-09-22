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

const personalHandlers={personal_create_event:createEvent,personal_create_reminder:createReminder,personal_acknowledge:acknowledge,personal_get_agenda:getAgenda,find_whatsapp_contact:findJarvisWhatsAppContact,send_whatsapp_message:sendJarvisWhatsAppMessage,jarvis_get_module_report:getJarvisModuleReport,jarvis_get_cards_report:getJarvisCardsReport,internet_search:internetSearch,internet_read_page:internetReadPage,internet_research:internetResearch,internet_get_history:internetGetHistory};
async function executeTool(q,ctx,name,args){ if(personalHandlers[name]) return personalHandlers[name](q,ctx,args||{}); return executeCliniqOneTool(q,ctx,name,args||{}); }
module.exports={executeTool,personalHandlers,ensurePersonalTables};

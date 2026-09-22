'use strict';

const { executeTool: executeCliniqOneTool } = require('../f1/management-tools');

function t(v){ return v == null ? '' : String(v).trim(); }
function idList(v){ return Array.isArray(v) ? v.map(Number).filter(Number.isSafeInteger) : []; }

async function ensurePersonalTables(q){
  await q(`CREATE TABLE IF NOT EXISTS jarvis_personal_events (
    id BIGSERIAL PRIMARY KEY, tenant_id UUID NOT NULL, user_id TEXT,
    title TEXT NOT NULL, start_at TIMESTAMPTZ NOT NULL, end_at TIMESTAMPTZ,
    location TEXT, notes TEXT, category TEXT DEFAULT 'personal', status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_jarvis_personal_events_due ON jarvis_personal_events(tenant_id,user_id,start_at)`);
  await q(`CREATE TABLE IF NOT EXISTS jarvis_personal_reminders (
    id BIGSERIAL PRIMARY KEY, tenant_id UUID NOT NULL, user_id TEXT,
    event_id BIGINT REFERENCES jarvis_personal_events(id) ON DELETE CASCADE,
    title TEXT NOT NULL, remind_at TIMESTAMPTZ NOT NULL, notes TEXT,
    priority TEXT DEFAULT 'normal', status TEXT DEFAULT 'pending',
    insist_at TIMESTAMPTZ, notified_at TIMESTAMPTZ, insisted_at TIMESTAMPTZ, acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_jarvis_personal_reminders_due ON jarvis_personal_reminders(tenant_id,user_id,status,remind_at,insist_at)`);
}

function userWhere(ctx, start=1){
  return { sql:`tenant_id=$${start}::uuid AND (user_id=$${start+1} OR (user_id IS NULL AND $${start+1} IS NULL))`, params:[ctx.tenant_id, ctx.user_id || null] };
}

async function createEvent(q,ctx,args={}){
  await ensurePersonalTables(q);
  if(!t(args.title)) throw new Error('Falta el título de la reunión o evento');
  if(!t(args.start_at)) throw new Error('Falta la fecha y hora del evento');
  const mins = Number.isFinite(Number(args.reminder_minutes_before)) ? Math.max(0,Number(args.reminder_minutes_before)) : 10;
  const {rows} = await q(`INSERT INTO jarvis_personal_events(tenant_id,user_id,title,start_at,end_at,location,notes,category)
    VALUES($1::uuid,$2,$3,$4::timestamptz,NULLIF($5,'')::timestamptz,$6,$7,$8) RETURNING *`,
    [ctx.tenant_id,ctx.user_id||null,t(args.title),t(args.start_at),t(args.end_at),t(args.location)||null,t(args.notes)||null,t(args.category)||'personal']);
  const event=rows[0];
  const rr=await q(`INSERT INTO jarvis_personal_reminders(tenant_id,user_id,event_id,title,remind_at,notes,priority,insist_at)
    VALUES($1::uuid,$2,$3,$4,$5::timestamptz - ($6::text || ' minutes')::interval,$7,'normal',$5::timestamptz - ($6::text || ' minutes')::interval + interval '5 minutes') RETURNING *`,
    [ctx.tenant_id,ctx.user_id||null,event.id,`Evento: ${event.title}`,event.start_at,mins,t(args.notes)||null]);
  return {ok:true,event,reminder:rr.rows[0],assistant_message:`Listo. Programé ${event.title} y el aviso ${mins} minutos antes.`,client_event:{type:'jarvis_personal_changed'}};
}

async function createReminder(q,ctx,args={}){
  await ensurePersonalTables(q);
  if(!t(args.title)) throw new Error('Falta el título del recordatorio');
  if(!t(args.remind_at)) throw new Error('Falta la fecha y hora del recordatorio');
  const mins=Number.isFinite(Number(args.insist_after_minutes))?Math.max(1,Number(args.insist_after_minutes)):5;
  const {rows}=await q(`INSERT INTO jarvis_personal_reminders(tenant_id,user_id,title,remind_at,notes,priority,insist_at)
    VALUES($1::uuid,$2,$3,$4::timestamptz,$5,$6,$4::timestamptz + ($7::text || ' minutes')::interval) RETURNING *`,
    [ctx.tenant_id,ctx.user_id||null,t(args.title),t(args.remind_at),t(args.notes)||null,t(args.priority)||'normal',mins]);
  return {ok:true,reminder:rows[0],assistant_message:`Listo. Programé el recordatorio: ${rows[0].title}.`,client_event:{type:'jarvis_personal_changed'}};
}

async function acknowledge(q,ctx,args={}){
  await ensurePersonalTables(q);
  const reminderIds=idList(args.reminder_ids); const eventIds=idList(args.event_ids);
  let reminders=[];
  if(!reminderIds.length && !eventIds.length){
    const r=await q(`UPDATE jarvis_personal_reminders SET status='acknowledged',acknowledged_at=NOW(),updated_at=NOW() WHERE tenant_id=$1::uuid AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND status='pending' AND acknowledged_at IS NULL AND notified_at IS NOT NULL AND remind_at<=NOW()+interval '30 minutes' RETURNING *`,[ctx.tenant_id,ctx.user_id||null]);
    reminders=r.rows;
  }
  if(reminderIds.length){ const r=await q(`UPDATE jarvis_personal_reminders SET status='acknowledged',acknowledged_at=NOW(),updated_at=NOW() WHERE tenant_id=$1::uuid AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND id=ANY($3::bigint[]) RETURNING *`,[ctx.tenant_id,ctx.user_id||null,reminderIds]); reminders=r.rows; }
  if(eventIds.length){ const r=await q(`UPDATE jarvis_personal_reminders SET status='acknowledged',acknowledged_at=NOW(),updated_at=NOW() WHERE tenant_id=$1::uuid AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND event_id=ANY($3::bigint[]) RETURNING *`,[ctx.tenant_id,ctx.user_id||null,eventIds]); reminders=[...reminders,...r.rows]; }
  return {ok:true,acknowledged:reminders.length,assistant_message:'Entendido. Quedó confirmado de enterado y detuve la insistencia.'};
}

async function getAgenda(q,ctx,args={}){
  await ensurePersonalTables(q);
  const from=t(args.from)||new Date().toISOString(); const to=t(args.to)||new Date(Date.now()+7*864e5).toISOString();
  const ev=await q(`SELECT * FROM jarvis_personal_events WHERE tenant_id=$1::uuid AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND start_at BETWEEN $3::timestamptz AND $4::timestamptz AND status<>'cancelled' ORDER BY start_at`,[ctx.tenant_id,ctx.user_id||null,from,to]);
  const rr=await q(`SELECT * FROM jarvis_personal_reminders WHERE tenant_id=$1::uuid AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL)) AND remind_at BETWEEN $3::timestamptz AND $4::timestamptz AND status<>'cancelled' ORDER BY remind_at`,[ctx.tenant_id,ctx.user_id||null,from,to]);
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
    WHERE tenant_id=$1::uuid
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


// ===================== Reportes centrales de tarjetas JARVIS =====================
const JARVIS_CARD_MODULES = ['agenda','recordatorios','whatsapp','correo','llamadas','internet'];

async function fetchJarvisInternal(ctx, path){
  const base=t(process.env.INTERNAL_BASE_URL||process.env.RENDER_EXTERNAL_URL)||`http://127.0.0.1:${process.env.PORT||10000}`;
  const headers={};
  if(t(ctx.authorization)) headers.authorization=t(ctx.authorization);
  if(t(ctx.branch_key)) headers['x-sucursal']=t(ctx.branch_key);
  const r=await fetch(`${base}${path}`,{headers});
  const raw=await r.text();
  let data=null;
  try{ data=raw?JSON.parse(raw):null; }catch{ data=raw; }
  if(!r.ok) throw new Error(`${path} respondió ${r.status}`);
  return data;
}

function normalizeArrayPayload(data){
  if(Array.isArray(data)) return data;
  if(Array.isArray(data?.items)) return data.items;
  if(Array.isArray(data?.messages)) return data.messages;
  if(Array.isArray(data?.contacts)) return data.contacts;
  if(Array.isArray(data?.data)) return data.data;
  return [];
}

async function reportAgenda(q,ctx,args={}){
  await ensurePersonalTables(q);
  const now=new Date();
  const days=Math.min(30,Math.max(1,Number(args.days)||7));
  const to=new Date(now.getTime()+days*864e5);
  const ev=await q(`SELECT id,title,start_at,end_at,location,status
    FROM jarvis_personal_events
    WHERE tenant_id=$1::uuid AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL))
      AND status<>'cancelled' AND start_at BETWEEN $3::timestamptz AND $4::timestamptz
    ORDER BY start_at LIMIT 50`,[ctx.tenant_id,ctx.user_id||null,now.toISOString(),to.toISOString()]);
  return {module:'agenda',status:'operativo',validated:true,period_days:days,total:ev.rows.length,upcoming:ev.rows.slice(0,10)};
}

async function reportReminders(q,ctx,args={}){
  await ensurePersonalTables(q);
  const now=new Date();
  const days=Math.min(30,Math.max(1,Number(args.days)||7));
  const to=new Date(now.getTime()+days*864e5);
  const rr=await q(`SELECT id,title,remind_at,priority,status,notified_at,acknowledged_at
    FROM jarvis_personal_reminders
    WHERE tenant_id=$1::uuid AND (user_id=$2 OR (user_id IS NULL AND $2 IS NULL))
      AND status<>'cancelled' AND remind_at BETWEEN $3::timestamptz AND $4::timestamptz
    ORDER BY remind_at LIMIT 50`,[ctx.tenant_id,ctx.user_id||null,now.toISOString(),to.toISOString()]);
  const pending=rr.rows.filter(x=>String(x.status||'pending').toLowerCase()==='pending');
  return {module:'recordatorios',status:'operativo',validated:true,period_days:days,total:rr.rows.length,pending:pending.length,items:rr.rows.slice(0,10)};
}

async function reportWhatsApp(q,ctx,args={}){
  const limit=Math.min(1000,Math.max(20,Number(args.limit)||250));
  const [messagePayload,contactPayload]=await Promise.all([
    fetchJarvisInternal(ctx,`/api/whatsapp/jarvis/messages?limit=${limit}`),
    fetchJarvisInternal(ctx,'/api/whatsapp/jarvis/contacts')
  ]);
  const messages=normalizeArrayPayload(messagePayload);
  const contacts=normalizeArrayPayload(contactPayload);
  const incoming=messages.filter(m=>String(m.type||m.direction||'').toLowerCase()==='incoming').length;
  const outgoing=messages.filter(m=>String(m.type||m.direction||'').toLowerCase()==='outgoing').length;
  const phones=new Set(messages.map(m=>t(m.phone)).filter(Boolean));
  const recent=messages.slice().sort((a,b)=>new Date(b.timestamp||b.created_at||0)-new Date(a.timestamp||a.created_at||0)).slice(0,10);
  return {
    module:'whatsapp',status:'operativo',validated:true,source:'JARVIS-WA-001',
    scope:'tarjeta_central_jarvis',contacts:contacts.length,messages:messages.length,
    conversations:phones.size,incoming,outgoing,recent
  };
}

function unavailableCard(module, reason){
  return {module,status:'no_conectado',validated:false,reason};
}

async function getJarvisModuleReport(q,ctx,args={}){
  const raw=normalizeName(args.module||args.card||'');
  const aliases={
    agenda:'agenda',calendario:'agenda',
    recordatorio:'recordatorios',recordatorios:'recordatorios',
    whatsapp:'whatsapp',wa:'whatsapp',
    correo:'correo',email:'correo',mail:'correo',
    llamada:'llamadas',llamadas:'llamadas',telefono:'llamadas',
    internet:'internet',web:'internet'
  };
  const module=aliases[raw]||raw;
  if(!JARVIS_CARD_MODULES.includes(module)) throw new Error(`Módulo no reconocido. Usa: ${JARVIS_CARD_MODULES.join(', ')}`);
  if(module==='agenda') return reportAgenda(q,ctx,args);
  if(module==='recordatorios') return reportReminders(q,ctx,args);
  if(module==='whatsapp') return reportWhatsApp(q,ctx,args);
  if(module==='correo') return unavailableCard('correo','La tarjeta existe en la interfaz, pero todavía no hay una fuente de correo conectada al backend central de JARVIS.');
  if(module==='llamadas') return unavailableCard('llamadas','La tarjeta existe en la interfaz, pero todavía no hay una fuente de llamadas conectada al backend central de JARVIS.');
  return unavailableCard('internet','La tarjeta existe en la interfaz, pero todavía no hay una fuente/historial de Internet conectada como herramienta central verificable.');
}

async function getJarvisCardsReport(q,ctx,args={}){
  const requested=Array.isArray(args.modules)&&args.modules.length?args.modules:JARVIS_CARD_MODULES;
  const reports=[];
  for(const module of requested){
    try{ reports.push(await getJarvisModuleReport(q,ctx,{...args,module})); }
    catch(error){ reports.push({module:String(module),status:'con_incidencia',validated:false,error:error.message}); }
  }
  return {
    ok:true,source:'jarvis_central',scope:'tarjetas_centrales',
    generated_at:new Date().toISOString(),
    reports,
    assistant_message:'Reporte central de tarjetas JARVIS generado con fuentes propias. Los módulos sin integración real se marcan como no conectados; no se sustituyen con datos de CliniqOne.'
  };
}

const personalHandlers={personal_create_event:createEvent,personal_create_reminder:createReminder,personal_acknowledge:acknowledge,personal_get_agenda:getAgenda,find_whatsapp_contact:findJarvisWhatsAppContact,send_whatsapp_message:sendJarvisWhatsAppMessage,jarvis_get_module_report:getJarvisModuleReport,jarvis_get_cards_report:getJarvisCardsReport};
async function executeTool(q,ctx,name,args){ if(personalHandlers[name]) return personalHandlers[name](q,ctx,args||{}); return executeCliniqOneTool(q,ctx,name,args||{}); }
module.exports={executeTool,personalHandlers,ensurePersonalTables};

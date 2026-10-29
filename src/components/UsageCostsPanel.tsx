import React from 'react';
type Props={API_BASE:string;headers:Record<string,string>;tenantId?:string;companyName?:string};
const money=(n:any)=>n==null?'Pendiente':new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(Number(n));
const names:Record<string,string>={realtime:'Hanna por voz',hana:'Hanna por texto',whatsapp:'WhatsApp',messenger:'Facebook / Messenger',instagram:'Instagram',assistant_web:'Asistente web'};
const sources:Record<string,string>={voice:'Voz',text:'Texto',transcription:'Transcripción',virtual_assistant:'Asistente virtual',manual:'Manual',reminders:'Recordatorios',cron_reminders:'Cron automático',survey:'Encuestas',briefing_audio:'Audio de resumen',wake_transcription:'Verificación de voz'};
export default function UsageCostsPanel({API_BASE,headers,tenantId,companyName}:Props){
 const [snapshot,setData]=React.useState<any>(null),[error,setError]=React.useState(''),[saving,setSaving]=React.useState(false);
 const currentToken=localStorage.getItem('dentalux_auth_token')||'';
 const [draft,setDraft]=React.useState<any>(null),[editing,setEditing]=React.useState(false);
 const initial=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit'}).formatToParts(new Date());
 const [month,setMonth]=React.useState(`${initial.find(x=>x.type==='year')?.value}-${initial.find(x=>x.type==='month')?.value}`);
 const data=snapshot?._sessionToken===currentToken&&snapshot?._targetTenant===(tenantId||'')&&snapshot?.period===month?snapshot:null;
 const endpoint=API_BASE.replace(/\/$/,'')+'/api/usage';
 const selection=tenantId?'&tenant_id='+encodeURIComponent(tenantId):'';
 const requestHeaders=React.useMemo(()=>{
  const normalized=new Headers(headers);
  normalized.set('Authorization','Bearer '+(localStorage.getItem('dentalux_auth_token')||''));
  normalized.set('Content-Type','application/json');
  return Object.fromEntries(normalized.entries());
 },[headers]);
 React.useEffect(()=>{
  let alive=true,inFlight=false;const controller=new AbortController();
  const load=async()=>{if(inFlight)return;inFlight=true;try{
   const token=localStorage.getItem('dentalux_auth_token')||'';
   const activeHeaders=new Headers(requestHeaders);activeHeaders.set('Authorization','Bearer '+token);
   const r=await fetch(endpoint+'?period='+month+selection,{headers:activeHeaders,signal:controller.signal});const j=await r.json();
   if(!r.ok||!j.ok)throw Error(j.error||'No se pudo consultar el consumo');
   if(tenantId&&j.tenant_id!==tenantId)throw Error('El servidor no confirmó la empresa seleccionada. Verifica el despliegue del backend antes de configurar tarifas.');
   if(alive&&token===(localStorage.getItem('dentalux_auth_token')||'')){setData({...j,_sessionToken:token,_targetTenant:tenantId||''});setError('');}
  }catch(e:any){if(alive&&e.name!=='AbortError')setError(e.message);}finally{inFlight=false;}};
  setData(null);setEditing(false);setDraft(null);setError('');void load();const timer=window.setInterval(()=>{if(!document.hidden)void load();},5000);
  return()=>{alive=false;controller.abort();window.clearInterval(timer);};
 },[endpoint,month,requestHeaders,selection,tenantId,currentToken]);
 const edit=()=>{setDraft({...data.plan,rates:{...data.plan.rates,meta:{...(data.plan.rates?.meta||{})}}});setEditing(true);};
 const save=async()=>{setSaving(true);try{
  if(!tenantId||!data?.can_configure)throw Error('No tienes permiso para configurar tarifas.');
  for(const k of ['included_mxn','monthly_rent_mxn','markup_pct','usd_mxn'])if(draft[k]==null||String(draft[k]).trim()==='')throw Error('Completa todos los importes y el tipo de cambio.');
  if(data?._sessionToken!==(localStorage.getItem('dentalux_auth_token')||''))throw Error('Cambió la sesión. Abre de nuevo la configuración de la empresa actual.');
  const activeHeaders=new Headers(requestHeaders);activeHeaders.set('Authorization','Bearer '+data._sessionToken);
  const body={...draft};for(const k of ['included_mxn','monthly_rent_mxn','markup_pct','usd_mxn'])body[k]=Number(body[k]);
  const r=await fetch(endpoint+'/plan?period='+month+selection,{method:'PUT',headers:activeHeaders,body:JSON.stringify(body)});const j=await r.json();
  if(!r.ok||!j.ok)throw Error(j.error||'No se guardó');
  const fresh=await fetch(endpoint+'?period='+month+selection,{headers:activeHeaders});const result=await fresh.json();if(!fresh.ok||!result.ok)throw Error(result.error||'No se pudo actualizar');
  if(tenantId&&result.tenant_id!==tenantId)throw Error('El servidor devolvió otra empresa. No se mostraron sus datos.');
  if(data._sessionToken===(localStorage.getItem('dentalux_auth_token')||''))setData({...result,_sessionToken:data._sessionToken,_targetTenant:tenantId||''});setEditing(false);setError('');
 }catch(e:any){setError(e.message);}finally{setSaving(false);}};
 const s=data?.summary;
 return <div className="h-full overflow-auto p-4 space-y-4 bg-slate-50 text-slate-800">
  <div className="flex justify-between gap-3 items-center"><div><h2 className="font-semibold">Uso y costos</h2><p className="text-xs text-slate-500">{companyName?`Consumo mensual de ${companyName}`:'Consumo mensual de tu empresa'} · pesos mexicanos</p></div><input aria-label="Mes de consumo" type="month" value={month} onChange={e=>{setMonth(e.target.value);setEditing(false);}} className="border rounded p-1 text-sm" /></div>
  {error&&<div role="alert" className="p-3 bg-red-50 text-red-700 rounded text-sm">{error}</div>}
  {!data&&!error&&<p className="text-sm">Consultando consumo…</p>}
  {data&&<>
   {!data.plan.configured&&<div className="bg-amber-50 p-3 rounded text-sm">Falta configurar el monto incluido, el tipo de cambio y el margen. El consumo se registra; el excedente aún no puede calcularse.</div>}
   <div className="bg-white p-4 rounded-xl border space-y-3">
    <div className="flex justify-between text-sm"><span>Uso del monto incluido</span><strong>{s.used_pct==null?'Sin configurar':`${s.used_pct.toFixed(1)}%`}</strong></div>
    <div role="progressbar" aria-label="Uso mensual incluido" aria-valuenow={Math.min(100,s.used_pct||0)} aria-valuemin={0} aria-valuemax={100} className="h-3 rounded bg-slate-100 overflow-hidden"><div className={`h-full ${s.exceeded?'bg-red-500':s.used_pct>=80?'bg-amber-400':'bg-emerald-500'}`} style={{width:`${Math.min(100,s.used_pct||0)}%`}} /></div>
    <p className="text-sm">{money(s.retail_mxn)} de {money(data.plan.configured?s.included_mxn:null)} incluidos en la renta</p>
    <div className="grid grid-cols-2 gap-3 text-sm"><div>Costo proveedor<br/><strong>{money(s.provider_cost_mxn)}</strong></div><div className={s.exceeded?'text-red-600':''}>Cargo adicional {s.complete?'':'provisional'}<br/><strong>{money(s.extra_mxn)}</strong></div><div>Renta mensual<br/><strong>{money(data.plan.monthly_rent_mxn)}</strong></div><div>Total renta + excedente<br/><strong>{s.extra_mxn==null?'Pendiente':money(Number(data.plan.monthly_rent_mxn)+s.extra_mxn)}</strong></div></div>
    {s.exceeded&&<p className="text-red-600 text-sm font-medium">Se superó el monto incluido. Excedente: {money(s.extra_mxn)}.</p>}
    <p className="text-xs text-slate-500">El uso comercial aplica {data.plan.markup_pct}% sobre el costo medido. El excedente es uso comercial menos el monto incluido. No realiza cobros automáticos.</p>
   </div>
   {(s.pending_events>0||data.coverage_gaps>0||data.missing_records>0)&&<div className="bg-amber-50 rounded p-3 text-sm">Medición incompleta: {s.pending_events} consumos pendientes de tarifa, conversión o entrega; {data.coverage_gaps} sesiones con medición incompleta; {data.missing_records||0} registros fallidos en esta instancia. Los totales conocidos pueden aumentar.</div>}
   {data.active_sessions>0&&<p className="text-xs text-slate-500">{data.active_sessions} sesiones en curso: el consumo puede seguir aumentando.</p>}
   {(data.pending_details?.length>0||data.coverage_gaps>0)&&<details className="bg-white rounded border p-3 text-xs"><summary className="cursor-pointer font-medium">Por qué hay importes sin cuantificar</summary>
    <p className="mt-2">Estos avisos no son pagos pendientes. Son datos de medición que faltan. No se consideran gratis ni se borran al cambiar de mes.</p>
    {(data.pending_details||[]).map((item:any)=><div key={[item.channel,item.source,item.reason].join(':')} className="border-t mt-2 pt-2"><strong>{names[item.channel]||item.channel} · {sources[item.source]||item.source}: {item.count}</strong><p>{({tokens_missing:'El proveedor no dejó tokens utilizables en este registro. Sin esos datos no puede reconstruirse un costo exacto; un reporte válido del mismo evento permite completarlo sin duplicar cargos.',exchange_missing:'Hay costo en USD, pero falta su conversión a pesos. Guarda el tipo de cambio del mes actual para recuperar las conversiones pendientes de ese mes.',delivery_pending:'Falta confirmar entrega o fallo del mensaje de WhatsApp.',billing_pending:'WhatsApp no ha informado si el mensaje es facturable.',tariff_missing:'Hay uso registrado, pero falta una tarifa aplicable al modelo o canal.'} as Record<string,string>)[item.reason]||'Falta información del proveedor.'}</p><p className="text-slate-500">Primer registro: {item.first_at?new Date(item.first_at).toLocaleString('es-MX'):'sin fecha'} · Último: {item.last_at?new Date(item.last_at).toLocaleString('es-MX'):'sin fecha'}</p></div>)}
    {data.coverage_gaps>0&&<div className="border-t mt-2 pt-2"><strong>Sesiones con medición incompleta: {data.coverage_gaps}</strong><p>El monitor perdió conexión, no confirmó el cierre o no pudo guardar todos los eventos. Reconectar no recupera automáticamente eventos que no se recibieron.</p><ul className="mt-1">{(data.sessions||[]).filter((item:any)=>!['starting','connected','closed'].includes(item.status)).map((item:any)=><li key={item.status}>{({coverage_incomplete:'Hueco de medición registrado',connected_after_gap:'Reconectada con un hueco previo',closed_or_gap:'Desconexión inesperada',monitor_error:'Error de conexión del monitor',monitor_stale:'El monitor dejó de actualizarse',invalid_event:'Evento no interpretable'} as Record<string,string>)[item.status]||'Estado sin cierre confirmado'}: {item.count}</li>)}</ul></div>}
   </details>}
   <div className="bg-white rounded-xl border overflow-x-auto"><table className="w-full text-xs text-left"><thead className="bg-slate-100"><tr><th className="p-2">Canal</th><th>Tokens</th><th>Mensajes</th><th>Costo conocido</th><th>Pendientes</th></tr></thead><tbody>{s.groups.map((g:any)=><tr key={g.channel} className="border-t"><td className="p-2"><strong>{names[g.channel]||g.channel}</strong><div className="text-slate-500">{Object.entries(g.sources).map(([k,v])=>`${sources[k]||k}: ${v}`).join(' · ')}</div></td><td>{g.tokens.toLocaleString('es-MX')}</td><td>{g.messages}{g.channel==='whatsapp'&&<div className="text-slate-500">{g.delivered} entregados</div>}</td><td>{money(g.cost_mxn)}</td><td>{g.pending}</td></tr>)}</tbody></table>{!s.groups.length&&<p className="p-3 text-sm text-slate-500">Aún no hay consumo registrado en este mes.</p>}</div>
   <details className="bg-white rounded border p-3 text-xs"><summary className="cursor-pointer font-medium">Tarifas y alcance de la medición</summary><p className="mt-2">OpenAI se calcula por tokens reales de entrada, caché, salida y audio; la transcripción se registra aparte. WhatsApp se valora con la entrega confirmada y la tarifa configurada por categoría y mercado. Sin tarifa verificada queda pendiente, nunca gratis por defecto.</p><p className="mt-2">USD registrados: {Number(s.provider_cost_usd).toFixed(6)}. Tipo de cambio configurado: {data.plan.usd_mxn||'pendiente'} MXN por USD. Tarifas de referencia: {data.reference_date}.</p><div className="overflow-x-auto mt-2"><table className="w-full text-left"><caption className="text-left">Tarifa proveedor por 1 millón de tokens (USD)</caption><thead><tr><th>Modelo</th><th>Texto entrada</th><th>Texto caché</th><th>Texto salida</th><th>Audio entrada</th><th>Audio caché</th><th>Audio salida</th></tr></thead><tbody>{Object.entries({...data.reference_rates,...data.plan.rates?.openai}).filter(([model])=>!/-20\d\d-/.test(model)).map(([model,rates]:any)=><tr key={model}><td>{model}</td>{['text_input','text_cached','text_output','audio_input','audio_cached','audio_output'].map(k=><td key={k}>{rates[k]==null?'—':rates[k]}</td>)}</tr>)}</tbody></table></div><p className="mt-2">Primer consumo medido: {data.measuring_since?new Date(data.measuring_since).toLocaleString('es-MX'):'todavía ninguno'}. No incluye uso histórico previo a instalar este módulo, impuestos, cargos del hosting ni intermediarios no configurados.</p><a className="text-blue-600 underline" href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noreferrer">Tarifas OpenAI</a> · <a className="text-blue-600 underline" href="https://business.whatsapp.com/products/platform-pricing" target="_blank" rel="noreferrer">Tarifas WhatsApp</a></details>
   {tenantId&&data.can_configure&&!editing&&<button onClick={edit} className="bg-indigo-600 text-white rounded px-3 py-2 text-sm">Configurar plan y tarifas</button>}
   {tenantId&&data.can_configure&&editing&&draft&&<div className="bg-white p-4 rounded border space-y-3"><h3 className="font-semibold text-sm">Configuración comercial del mes</h3>{[['monthly_rent_mxn','Renta mensual MXN'],['included_mxn','Consumo incluido MXN'],['markup_pct','Recargo sobre costo %'],['usd_mxn','MXN por USD']].map(([k,label])=><label key={k} className="block text-xs">{label}<input type="number" min={k==='usd_mxn'?0.000001:0} step="any" value={draft[k]??''} onChange={e=>setDraft({...draft,[k]:e.target.value})} className="block border rounded p-2 w-full"/></label>)}<p className="text-xs text-slate-500">Tarifas Meta: MXN por mensaje facturable. Deja vacío lo que no hayas verificado. Una tarifa 0 debe ser una decisión explícita.</p>{['MX:marketing','MX:utility','MX:authentication','MX:service','messenger'].map(k=><label key={k} className="block text-xs">{k}<input type="number" min="0" step="any" value={draft.rates.meta[k]??''} onChange={e=>{const meta={...draft.rates.meta};if(e.target.value==='')delete meta[k];else meta[k]=Number(e.target.value);setDraft({...draft,rates:{...draft.rates,meta}});}} className="block border rounded p-2 w-full"/></label>)}<div className="flex gap-2"><button disabled={saving} onClick={save} className="bg-indigo-600 text-white rounded px-3 py-2 text-sm">{saving?'Guardando…':'Guardar'}</button><button onClick={()=>setEditing(false)} className="border rounded px-3 text-sm">Cancelar</button></div></div>}
  </>}
 </div>;
}

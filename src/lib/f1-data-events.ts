export type DataChange={type:string;record_id?:number;appointment_id?:number;source?:string};
export function eventsForTool(name:string,result:any,args:any={}):DataChange[]{
 if(!result || result.ok===false || result.blocked || result.needs_input || result.ambiguous || result.requires_confirmation || result.confirmation_required || result.prerequisite_required)return [];
 const event=result.client_event;const list:DataChange[]=event?.type?[event]:[];
 let type='';
 if(/^(create|update|delete|cancel|reschedule)_appointment(?:_status)?$/.test(name))type='appointments_changed';
 else if(/^(register|update|delete)_payment$/.test(name))type='payments_changed';
 else if(/^(register|update|delete)_expense$/.test(name))type='expenses_changed';
 else if(/^(create|update|delete)_doctor$/.test(name))type='doctors_changed';
 else if(/^(create|update|delete)_service$/.test(name))type='services_changed';
 else if(/^(create|update|delete|adjust)_inventory_(item|stock)$/.test(name)||name==='apply_inventory_formula')type='inventory_changed';
 else if(/^(create|update|delete)_laboratory$/.test(name)||/^(create|update|delete)_lab_work(?:_stage)?$/.test(name)||['register_lab_payment','register_laboratory_payout','assign_lab_work_doctor','mark_lab_payroll_paid'].includes(name))type='laboratory_changed';
 else if(/^(create|update|delete)_objective$/.test(name)||name==='update_doctor_productivity_settings')type='productivity_changed';
 else if(['create_medical_record','update_medical_record','upsert_clinical_history','upsert_odontogram_tooth','add_dental_treatment','update_dental_treatment','delete_dental_treatment','create_informed_consent','update_consent_signatures','add_medical_document','delete_medical_document'].includes(name))type='medical_record_changed';
 else if(['send_whatsapp_message','send_whatsapp_to_patient','send_whatsapp_template','send_today_confirmations'].includes(name))type='whatsapp_changed';
 if(!list.length && type && result.ok===true)list.push({type,record_id:result.record?.id||result.history?.expediente_id||result.treatment?.expediente_id||args.record_id,appointment_id:result.appointment?.id||args.appointment_id});
 if(type==='appointments_changed'&&result.ok===true)list.push({type:'inventory_changed'});
 return list.filter((e,i,a)=>a.findIndex(x=>x.type===e.type)===i);
}
export function notifyApiMutation(endpoint:string,method:string,result:any){
 if(!/^(POST|PUT|PATCH|DELETE)$/i.test(method)||result?.ok===false||result?.blocked)return;
 const path=endpoint.replace(/^\/api\//,'/');let type='';
 if(/^\/appointments(?:\/|$)/.test(path))type='appointments_changed';
 else if(/^\/payments(?:\/|$)/.test(path))type='payments_changed';
 else if(/^\/expenses(?:\/|$)/.test(path))type='expenses_changed';
 else if(/^\/doctors(?:\/|$)/.test(path))type='doctors_changed';
 else if(/^\/services(?:\/|$)/.test(path))type='services_changed';
 else if(/^\/(inventory|inventario)(?:\/|$)/.test(path))type='inventory_changed';
 else if(/^\/(laboratorios|trabajos-laboratorio|pagos-laboratorio)(?:\/|$)/.test(path))type='laboratory_changed';
 else if(/^\/objetivos(?:[-/]|$)/.test(path))type='productivity_changed';
 else if(/^\/(expediente-medico|historia-clinica-dental|odontograma|tratamiento-dental|consentimiento-informado|documento-radiografia)(?:\/|$)/.test(path))type='medical_record_changed';
 else if(/^\/whatsapp\/(send-|broadcast\/)/.test(path))type='whatsapp_changed';
 if(type && typeof window!=='undefined' && typeof window.dispatchEvent==='function'){window.dispatchEvent(new CustomEvent('cliniqone:f1-data-changed',{detail:{type,source:'manual-api'}}));if(type==='appointments_changed')window.dispatchEvent(new CustomEvent('cliniqone:f1-data-changed',{detail:{type:'inventory_changed',source:'manual-api'}}))}
}

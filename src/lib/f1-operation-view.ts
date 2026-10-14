export type OperationViewRequest={id:string;module:string;date?:string;from?:string;to?:string;doctorId?:string;laboratoryId?:string;labFilter?:string;direction?:string;objectivesTab?:string};
export function applyOperationView(r:OperationViewRequest,set:any){
 if(!r?.id)return;
 if(r.module==='agenda'){set.setActiveTab('agenda');if(r.date)set.setSelectedDate(r.date);if(r.doctorId!==undefined)set.setSelectedDoctor(r.doctorId)}
 else if(r.module==='caja'){set.setActiveTab('pagos');set.setCajaRange('rango');set.setCajaFrom(r.from);set.setCajaTo(r.to)}
 else if(r.module==='reportes'){set.setActiveTab('analytics');set.setRangeKey('personalizado');set.setFrom(r.from);set.setTo(r.to)}
 else if(r.module==='laboratorio'){set.setActiveTab('laboratorios');if(r.labFilter)set.setLaboratorioFilter(r.labFilter);if(r.laboratoryId!==undefined)set.setSelectedLaboratorioFilter(r.laboratoryId)}
 else if(r.module==='whatsapp'){set.setActiveTab('whatsapp');if(r.direction)set.setMsgFilter(r.direction);if(r.from&&r.to){set.setWaRange('custom');set.setWaFrom(r.from);set.setWaTo(r.to)}}
}

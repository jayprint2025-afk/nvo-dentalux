'use strict';
const {randomUUID}=require('crypto');
function operationView(args={}){
 const allowed=['agenda','caja','reportes','laboratorio','whatsapp','objetivos'];
 if(!allowed.includes(args.module))throw Error('Vista no permitida');
 const date=v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v||''))throw Error('Indica una fecha YYYY-MM-DD');const d=new Date(v+'T12:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==v)throw Error('Fecha inválida');return v};
 const request={id:randomUUID(),module:args.module};
 if(args.date)request.date=date(args.date);
 if(args.from||args.to){request.from=date(args.from);request.to=date(args.to);if(request.from>request.to)throw Error('El inicio debe ser anterior al fin');}
 if(['caja','reportes','objetivos'].includes(args.module)&&!request.from)throw Error('Indica inicio y fin del período');
 if(args.module==='agenda'&&!request.date)throw Error('Indica la fecha de la agenda');
 if(args.doctor_id!==undefined)request.doctorId=args.doctor_id==null?'':String(args.doctor_id);
 if(args.laboratory_id!==undefined)request.laboratoryId=args.laboratory_id==null?'':String(args.laboratory_id);
 if(args.lab_filter!==undefined){if(!['todos','pendientes','entregados'].includes(args.lab_filter))throw Error('Filtro de laboratorio inválido');request.labFilter=args.lab_filter;}
 if(args.direction!==undefined){if(!['all','incoming','outgoing'].includes(args.direction))throw Error('Dirección de mensajes inválida');request.direction=args.direction;}
 if(args.objectives_tab!==undefined){if(!['objetivos','reportes'].includes(args.objectives_tab))throw Error('Pestaña de Objetivos inválida');request.objectivesTab=args.objectives_tab;}
 return {ok:true,assistant_message:`Solicité abrir ${args.module} con los filtros indicados.`,client_action:{type:'operation_view',request}};
}
module.exports={operationView};

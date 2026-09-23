'use strict';

const skillTools = [
  {
    type:'function',
    name:'skill_create_draft',
    description:'Crea SOLO una propuesta/borrador de una nueva habilidad o tarjeta para JARVIS. Diseña también su interfaz declarativa completa para Dynamic UI Engine V3 usando proposed_card cuando la habilidad necesite UI. No inventes integraciones: la interfaz puede existir, pero datos/acciones requieren un runtime real.  NO instala, NO modifica código, NO hace commit, NO hace push y NO despliega. Prioriza capacidades existentes, fuentes gratuitas y costo cero. Si detecta un servicio de pago debe declararlo en estimated_cost/required_services.',
    parameters:{
      type:'object',
      properties:{
        name:{type:'string',description:'Nombre corto de la habilidad'},
        request:{type:'string',description:'Petición original o descripción precisa de lo que debe poder hacer'},
        purpose:{type:'string',description:'Objetivo y beneficio de la habilidad'},
        proposed_card:{type:'object',description:'Manifest declarativo Dynamic UI Engine V3. NO JavaScript/HTML arbitrario. Preferir {version:3,title,subtitle,layout,components:[...]}. Componentes soportados: stack,row,grid,section,panel,group,tabs,input,text-input,search,number,date,time,email,url,textarea,select,toggle,checkbox,button,action,text,heading,badge,metric,kpi,progress,meter,list,feed,playlist,timeline,cards,table,image,gallery-image,audio,audio-player,video,video-player,player-controls,map,link,external-link. Los componentes pueden usar bind como result.current.temperature_c o result.items. Para map usar lat_bind/lon_bind o lat/lon. Para multimedia usar src o bind. Diseña la interfaz completa de la habilidad usando estos bloques reutilizables.'},
        proposed_tools:{type:'array',items:{type:'object'},description:'Herramientas/acciones que harían falta'},
        required_services:{type:'array',items:{type:['string','object']},description:'Servicios, APIs o fuentes requeridas. Indicar si son existentes/gratuitas/de pago.'},
        estimated_cost:{type:'string',enum:['free','unknown','paid'],description:'free si no agrega costo; unknown si debe verificarse; paid si requiere pago'},
        risk_level:{type:'string',enum:['low','medium','high']},
        notes:{type:'string'}
      },
      required:['name','request','estimated_cost']
    }
  },
  {
    type:'function',
    name:'skill_list_drafts',
    description:'Lista propuestas de habilidades creadas por Skill Builder. No instala nada.',
    parameters:{type:'object',properties:{status:{type:'string'}}}
  },
  {
    type:'function',
    name:'skill_get_draft',
    description:'Obtiene el detalle de una propuesta de habilidad por ID.',
    parameters:{type:'object',properties:{id:{type:'number'}},required:['id']}
  },
  {
    type:'function',
    name:'skill_approve_draft',
    description:'Registra UNA autorización explícita del administrador para una propuesta GRATUITA y, si existe un runtime seguro incluido en JARVIS, la aprueba y la instala/activa inmediatamente en la misma operación. NO modifica código, GitHub, Render, secretos ni contrata servicios. Las propuestas con costo paid/unknown quedan bloqueadas.',
    parameters:{type:'object',properties:{id:{type:'number'}},required:['id']}
  },
  {
    type:'function',
    name:'skill_reject_draft',
    description:'Rechaza una propuesta de habilidad para que no se instale.',
    parameters:{type:'object',properties:{id:{type:'number'},reason:{type:'string'}},required:['id']}
  }
,
  {
    type:'function',
    name:'skill_install_approved',
    description:'Instala/activa una habilidad YA APROBADA usando únicamente runtimes seguros incluidos en JARVIS. V1 no modifica código, GitHub, Render, secretos ni contrata servicios. Solo procede si estimated_cost=free.',
    parameters:{type:'object',properties:{id:{type:'number'},name:{type:'string'}},additionalProperties:false}
  },
  {
    type:'function',
    name:'skill_run',
    description:'Ejecuta una habilidad previamente instalada y activa. Para clima, usa location/city. No simules el resultado: usa esta herramienta.',
    parameters:{type:'object',properties:{id:{type:'number'},name:{type:'string'},intent:{type:'string'},location:{type:'string'},city:{type:'string'}},additionalProperties:true}
  }
];

module.exports={skillTools};

'use strict';
// Módulos excluidos del asistente por decisión del propietario.
function isExcludedAction(name,args={}) {
  if(/(?:invoice|billing|tax_client|tax_product)/.test(String(name)))return true;
  return name==='open_module' && ['facturacion','factura','jarvis','detalles','cliniq sales','cliniq_sales'].includes(String(args.module||'').toLowerCase());
}
function excludeTools(tools){return tools.filter(t=>!isExcludedAction(t.name)).map(t=>t.name==='open_module'?{...t,parameters:{...t.parameters,properties:{...t.parameters.properties,module:{...t.parameters.properties.module,enum:t.parameters.properties.module.enum.filter(m=>!isExcludedAction('open_module',{module:m}))}}}}:t)}
module.exports={isExcludedAction,excludeTools};

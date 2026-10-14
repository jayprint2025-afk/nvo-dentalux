'use strict';
function validateActionValues(name,args={}){
  const writes=/^(create_|update_|register_|add_|upsert_|adjust_)/.test(name);
  if(!writes)return;
  const nonnegative=['quantity','min_stock','max_stock','price','cost','budget','meta','base_salary','abonos','usage_per_patient','estimated_cost','total'];
  for(const field of nonnegative){if(args[field]!==undefined&&args[field]!==null){const n=Number(args[field]);if(args[field]===''||!Number.isFinite(n)||n<0)throw new Error(`${field} debe ser un número de 0 o mayor`)}}
  if(args.amount!==undefined&&(!Number.isFinite(Number(args.amount))||Number(args.amount)<=0))throw new Error('El monto debe ser un número mayor a 0');
  if(args.duration_hours!==undefined&&(!Number.isFinite(Number(args.duration_hours))||Number(args.duration_hours)<=0))throw new Error('La duración debe ser mayor a 0');
  if(args.delta!==undefined&&!Number.isFinite(Number(args.delta)))throw new Error('El ajuste de stock debe ser numérico');
  if(Array.isArray(args.concepts))for(const c of args.concepts){
    if(c.quantity!==undefined&&(!Number.isFinite(Number(c.quantity))||Number(c.quantity)<=0))throw new Error('La cantidad del concepto debe ser mayor a 0');
    for(const field of ['unit_value','amount'])if(c[field]!==undefined&&(!Number.isFinite(Number(c[field]))||Number(c[field])<0))throw new Error('El importe del concepto no puede ser negativo');
  }
}
module.exports={validateActionValues};

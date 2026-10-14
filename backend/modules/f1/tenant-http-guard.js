'use strict';
const {assertTenantReferences}=require('./tenant-ownership');
const paths={appointments:'appointment_id',doctors:'doctor_id',services:'service_id',payments:'payment_id',expenses:'expense_id',inventory:'inventory_id',laboratorios:'laboratory_id','trabajos-laboratorio':'work_id',objetivos:'objective_id'};
function tenantHttpGuard(q){return async(req,res,next)=>{
  try{
    const fields={...(req.query||{}),...(req.body||{})};
    for(const [alias,key] of Object.entries({doctorId:'doctor_id',serviceId:'service_id',laboratorio_id:'laboratory_id',trabajo_id:'work_id'})){
      if(fields[alias]!=null)fields[key]=fields[alias];
    }
    const parts=req.originalUrl.split('?')[0].split('/').filter(Boolean);
    const index=parts[1]==='melissa'?2:1;
    const module=parts[index],id=parts[index+1];
    if(paths[module] && id && !['reportes','doctor-settings','stock','bulk','today','stats','summary','buscar','apply-formula'].includes(id)) fields[paths[module]]=id;
    await assertTenantReferences(q,req.auth?.tenantId,fields);
    next();
  }catch(error){res.status(error.statusCode||400).json({error:error.message});}
};}
module.exports={tenantHttpGuard};

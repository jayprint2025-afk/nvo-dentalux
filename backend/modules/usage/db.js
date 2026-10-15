'use strict';
// Captura empresa y pool, sin depender de la petición que originó un WebSocket.
function tenantQuery(pool,tenantId){
 if(!tenantId)throw new Error('Falta empresa para medición');
 return async(text,args=[])=>{
  const c=await pool.connect();
  try{await c.query('BEGIN');await c.query("SELECT set_config('app.tenant_id',$1,true)",[String(tenantId)]);
   const out=await c.query(text,args);await c.query('COMMIT');return out;
  }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
 };
}
module.exports={tenantQuery};

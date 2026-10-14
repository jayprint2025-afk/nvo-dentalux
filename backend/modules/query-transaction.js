'use strict';
// Una conexión para toda la operación, con el tenant de la sesión autenticada.
function createTransactionRunner({getPool,getContext,runWithContext}) {
  return async function withTransaction(work){
    const context=getContext()||{};
    if(context.transactionQuery)return work(context.transactionQuery);
    const client=await getPool().connect();
    try{
      await client.query('BEGIN');
      if(context.tenantId)await client.query(`SELECT set_config('app.tenant_id',$1,true)`,[String(context.tenantId)]);
      const query=(sql,params=[])=>client.query(sql,params);
      query.inTransaction=true;
      const result=await runWithContext({...context,transactionClient:client,transactionQuery:query},()=>work(query));
      await client.query('COMMIT');
      return result;
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
    finally{client.release()}
  };
}
module.exports={createTransactionRunner};

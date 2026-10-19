const {db,pool}=require('./owned-publication-store.cjs');
const {OwnedPublicationStore}=require('../../src/services/owned_publication_store');
process.once('message',async data=>{
 try{
  let result;
  if(data.writer){process.env.TELEGRAM_BOT_TOKEN='000000000:synthetic-test-token';const tasks=require('../../src/services/mcp_publication/tasks');process.send({ready:true});result=await tasks.updatePublicationContent({projectId:data.request.projectId,taskId:data.request.taskId,body:'synthetic concurrent edit',expectedRevision:data.request.expectedAcceptedRevision});}
  else if(data.legacy){result=await db.$transaction(async tx=>{const changed=await tx.contentItem.updateMany({where:{id:data.request.taskId,project_id:data.request.projectId,status:'ready_for_execution',publication_mode:'owner_released'},data:{status:'publishing'}});if(changed.count!==1)throw Error('legacy CAS lost');await tx.workflowEvent.create({data:{project_id:data.request.projectId,content_item_id:data.request.taskId,actor_id:'system:synthetic-legacy',command:'legacy_publish_claim',idempotency_key:'legacy',after_state:{state:'publishing'}}});return 'legacy_claimed';});}
  else{const store=new OwnedPublicationStore({db,manifest:async()=>({checksum:data.manifest}),facts:{record:async()=>{throw Error('no fact expected');}}});if(data.release)process.send({ready:true});result=data.release?await store.release(data.request,data.principal):await store.claim(data.request,data.principal,data.inventory);}
  process.send({ok:true,attemptId:result.attemptId||null});
 }catch(error){process.send({ok:false,message:error.message});}
 finally{await db.$disconnect();await pool.end();process.disconnect();}
});

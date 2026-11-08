const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {db,admin,worker,project,dispose,key,SETTINGS_CACHE_EVENT}=require('./runtime.fixture.cjs');
after(dispose);
test('actual Redis process restart preserves fresh reads and durable recovery after writer death',{timeout:45000},async()=>{
 const p=await project(),web=worker(),mcp=worker();
 try{
  await mcp.call('read',{projectId:p.id,key});
  const signal=web.signal('afterCommit');
  const write=web.call('write',{projectId:p.id,key,value:'survived-real-restart',pause:'afterCommit'}).catch(()=>null);
  await Promise.race([signal,write.then(()=>{throw Error('writer failed before expected signal');})]);
  web.child.kill('SIGKILL');await write;
  await admin.shutdown('NOSAVE').catch(()=>{}); // Expected connection closure in this synthetic Redis.
  assert.equal((await mcp.call('read',{projectId:p.id,key})).value,'survived-real-restart');
  console.log('RESTART_REDIS_NOW');
  let ready=false;
  for(let i=0;i<100;i++){
   try{if(await admin.ping()==='PONG'){ready=true;break;}}catch{}
   await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(ready,'synthetic Redis host orchestration did not restart the service');
  assert.equal((await mcp.call('read',{projectId:p.id,key})).value,'survived-real-restart');
  await mcp.call('deliver');
  assert.equal(await db.outboxEvent.count({where:{project_id:p.id,event_type:SETTINGS_CACHE_EVENT,status:'pending'}}),0);
 }finally{await mcp.close();await db.project.delete({where:{id:p.id}});}
});

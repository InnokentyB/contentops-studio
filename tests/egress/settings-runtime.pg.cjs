const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {db,admin,worker,project,dispose,key,SETTINGS_CACHE_EVENT,tracker,createSettingsCacheRuntime,createSettingsRedis}=require('./runtime.fixture.cjs');
after(dispose);
test('generic Owner settings POST invalidates an already warm production reader in another process',{timeout:20000},async()=>{
 const p=await project(),web=worker(true),mcp=worker(true);
 try{
  assert.equal((await mcp.call('read',{projectId:p.id,key})).value,'old');
  await web.call('genericPut',{projectId:p.id,key,value:'saved-through-generic-route'});
  assert.equal((await mcp.call('read',{projectId:p.id,key})).value,'saved-through-generic-route');
  assert.equal(await db.outboxEvent.count({where:{project_id:p.id,event_type:SETTINGS_CACHE_EVENT,status:'pending'}}),0);
 }finally{await web.close();await mcp.close();await db.project.delete({where:{id:p.id}});}
});
test('production reader in two processes sees existing settings PUT immediately',{timeout:20000},async()=>{
 const p=await project(),web=worker(true),mcp=worker(true);
 try{
  assert.equal((await mcp.call('read',{projectId:p.id,key})).value,'old');
  await web.call('put',{projectId:p.id,key,value:'new'});
  const results=await Promise.all(Array.from({length:100},()=>mcp.call('read',{projectId:p.id,key})));
  assert.ok(results.every(r=>r.value==='new'));
  assert.equal((await mcp.call('stats')).readCount,2); // One cold load before save and one coalesced reload after save.
  assert.equal(await db.outboxEvent.count({where:{project_id:p.id,event_type:SETTINGS_CACHE_EVENT,status:'pending'}}),0);
 }finally{await web.close();await mcp.close();await db.project.delete({where:{id:p.id}});}
});
test('writer death after durable commit leaves reads fresh and outbox repairable; tracker cannot consume it',{timeout:20000},async()=>{
 const p=await project(),web=worker(),mcp=worker();
 try{
  await mcp.call('read',{projectId:p.id,key});
  const signal=web.signal('afterCommit');
  const write=web.call('write',{projectId:p.id,key,value:'committed',pause:'afterCommit'}).catch(()=>null);
  await Promise.race([signal,write.then(()=>{throw Error('writer failed before expected post-commit signal');})]);web.child.kill('SIGKILL');await write;
  assert.equal((await mcp.call('read',{projectId:p.id,key})).value,'committed');
  await tracker.processOutbox({projectId:p.id,actorId:'synthetic'});
  assert.equal(await db.outboxEvent.count({where:{project_id:p.id,event_type:SETTINGS_CACHE_EVENT,status:'pending'}}),1);
  await mcp.call('deliver');
  assert.equal(await db.outboxEvent.count({where:{project_id:p.id,event_type:SETTINGS_CACHE_EVENT,status:'pending'}}),0);
  assert.equal((await mcp.call('read',{projectId:p.id,key})).value,'committed');
 }finally{await mcp.close();await db.project.delete({where:{id:p.id}});}
});
test('Redis metadata loss during open DB transaction cannot bootstrap stale cached state',{timeout:20000},async()=>{
 const p=await project(),web=worker(),mcp=worker();
 try{
  await mcp.call('read',{projectId:p.id,key});
  const signal=web.signal('beforeCommit');
  const write=web.call('write',{projectId:p.id,key,value:'after-redis-restart',pause:'beforeCommit'});
  await Promise.race([signal,write.then(()=>{throw Error('writer completed before expected open transaction signal');})]);await admin.flushdb(); // This Redis instance is ephemeral and synthetic only.
  let completed=false;
  const read=mcp.call('read',{projectId:p.id,key}).then(r=>{completed=true;return r;});
  await new Promise(r=>setTimeout(r,80));assert.equal(completed,false);
  await web.call('resume');await write;
  assert.equal((await read).value,'after-redis-restart');
 }finally{await web.close();await mcp.close();await db.project.delete({where:{id:p.id}});}
});
test('unreachable Redis bypasses reads and refuses a cacheable write before any data change',{timeout:15000},async()=>{
 const p=await project(),runtime=createSettingsCacheRuntime(db,createSettingsRedis('redis://127.0.0.1:1'));
 try{
  assert.equal((await runtime.read(p.id,key)).value,'old');
  await assert.rejects(runtime.write(p.id,key,tx=>tx.projectSettings.update({where:{project_id_key:{project_id:p.id,key}},data:{value:'wrong'}})),/not saved/);
  assert.equal((await db.projectSettings.findUnique({where:{project_id_key:{project_id:p.id,key}}})).value,'old');
 }finally{await runtime.close();await db.project.delete({where:{id:p.id}});}
});
test('actual pending DB load in another process cannot refill old data after save acknowledgement',{timeout:20000},async()=>{
 const p=await project(),web=worker(),mcp=worker();
 try{
  const signal=mcp.signal('load');
  const read=mcp.call('read',{projectId:p.id,key,pause:'load'});
  await signal;await web.call('write',{projectId:p.id,key,value:'new-after-pending-load'});
  await mcp.call('resume');
  assert.equal((await read).value,'new-after-pending-load');
  assert.equal((await mcp.call('read',{projectId:p.id,key})).value,'new-after-pending-load');
 }finally{await web.close();await mcp.close();await db.project.delete({where:{id:p.id}});}
});
test('abandoned prepared write is durably aborted and a late original cannot mutate settings',{timeout:20000},async()=>{
 const {randomUUID}=require('node:crypto');
 const {createSettingsEventStore}=require(process.env.EGRESS_DIST+'/services/settings_cache_events.js');
 const store=createSettingsEventStore(db),redis=createSettingsRedis(process.env.EGRESS_REDIS_URL),p=await project();
 const runtime=createSettingsCacheRuntime(db,redis);
 try{
  await runtime.read(p.id,key);
  const row=await store.prepare(p.id,key,randomUUID()),e=store.decode(row);
  await redis.begin(e);
  await db.outboxEvent.update({where:{id:e.id},data:{created_at:new Date(Date.now()-31000)}});
  await runtime.deliver();
  let barrierCalled=false; // Delayed original request resumes after recovery.
  await assert.rejects(store.commit(e,async()=>{barrierCalled=true;await redis.begin(e);},tx=>tx.projectSettings.update({where:{project_id_key:{project_id:p.id,key}},data:{value:'stale-writer'}})),/not saved/);
  assert.equal(barrierCalled,false);
  await store.finish(e,()=>redis.finish(e),true);
  assert.equal((await redis.state(p.id,key)).blocked,false);
  assert.equal((await runtime.read(p.id,key)).value,'old');
 }finally{await runtime.close();await db.project.delete({where:{id:p.id}});}
});
test('read-cache-disabled writer still invalidates a peer with caching enabled',{timeout:20000},async()=>{
 const p=await project(),web=worker('off'),mcp=worker(true);
 try{
  await mcp.call('read',{projectId:p.id,key});
  await web.call('put',{projectId:p.id,key,value:'updated-with-reader-cache-off'});
  assert.equal((await mcp.call('read',{projectId:p.id,key})).value,'updated-with-reader-cache-off');
 }finally{await web.close();await mcp.close();await db.project.delete({where:{id:p.id}});}
});
test('shared Redis metadata is isolated by database binding and tenant',{timeout:15000},async()=>{
 const a=createSettingsRedis(process.env.EGRESS_REDIS_URL,'postgresql://synthetic@db:5432/synthetic_a');
 const b=createSettingsRedis(process.env.EGRESS_REDIS_URL,'postgresql://synthetic@db:5432/synthetic_b');
 try{
  await a.install([]);await b.install([]);
  assert.notEqual((await a.state(1,key)).version,(await b.state(1,key)).version);
  assert.notEqual((await a.state(1,key)).version,(await a.state(2,key)).version);
 }finally{await a.close();await b.close();}
});

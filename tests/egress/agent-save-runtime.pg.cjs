const {test}=require('node:test'),assert=require('node:assert/strict');
const base=process.env.EGRESS_DIST;
const {default:db,pool}=require(base+'/db.js');
const {createSettingsRedis}=require(base+'/services/settings_cache_redis.js');
const {createSettingsCacheRuntime}=require(base+'/services/settings_cache_runtime.js');
const {SettingsSavedCacheSyncPendingError,SettingsCacheSyncError,SETTINGS_CACHE_EVENT}=require(base+'/services/settings_cache_events.js');
test('real commit with failed Redis acknowledgement yields typed pending and repairs without resave',{timeout:15000},async()=>{
 assert.equal(process.env.EGRESS_REDIS_URL,'redis://redis:6379');
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/shared_browser_synthetic');
 const project=await db.project.create({data:{name:'Synthetic diagnostics',slug:'diagnostics-'+Date.now()}});
 const redis=createSettingsRedis(process.env.EGRESS_REDIS_URL);let fail=true;
 const port={...redis,finish:async e=>{if(fail)throw new Error('synthetic lost reply');return redis.finish(e);}};
 const writer=createSettingsCacheRuntime(db,port),reader=createSettingsCacheRuntime(db,createSettingsRedis(process.env.EGRESS_REDIS_URL));
 const key='multi_agent_post_creator_prompt';
 try{
  await assert.rejects(writer.write(project.id,key,tx=>tx.projectSettings.create({data:{project_id:project.id,key,value:'committed synthetic'}})),error=>error instanceof SettingsSavedCacheSyncPendingError&&error.code==='SETTINGS_SAVED_CACHE_SYNC_PENDING');
  assert.equal((await db.projectSettings.findUnique({where:{project_id_key:{project_id:project.id,key}}})).value,'committed synthetic');
  assert.equal((await reader.read(project.id,key)).value,'committed synthetic');
  assert.equal(await db.outboxEvent.count({where:{project_id:project.id,event_type:SETTINGS_CACHE_EVENT,status:'pending'}}),1);
  fail=false;await writer.deliver();
  assert.equal(await db.outboxEvent.count({where:{project_id:project.id,event_type:SETTINGS_CACHE_EVENT,status:'pending'}}),0);
 }finally{await writer.close();await reader.close();await db.project.delete({where:{id:project.id}});await db.$disconnect();await pool.end();}
});

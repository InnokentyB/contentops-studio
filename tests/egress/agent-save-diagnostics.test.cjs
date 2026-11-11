const {test}=require('node:test'),assert=require('node:assert/strict');
const base=process.env.EGRESS_DIST;
const Fastify=require('fastify');
const routes=require(base+'/routes/api/settings.routes.js').default;
const reader=require(base+'/services/project_settings_reader.js').projectSettingsReader;
const {SettingsCacheSyncError}=require(base+'/services/settings_cache_events.js');
test('agent save HTTP preserves per-field commit certainty without exposing values',async()=>{
 const original=reader.write;let calls=[],failure=0,error;
 reader.write=async(_project,key)=>{calls.push(key);if(calls.length===failure)throw error;};
 const app=Fastify();app.addHook('preHandler',async req=>{req.projectId=77;});await app.register(routes);
 const save=()=>app.inject({method:'PUT',url:'/api/settings/agents/post_creator',payload:{prompt:'PRIVATE_PROMPT',model:'PRIVATE_MODEL',apiKey:''}});
 try{
  failure=1;error=new SettingsCacheSyncError();let response=await save(),body=response.json();
  assert.equal(response.statusCode,503);assert.equal(body.code,'SETTINGS_CACHE_SYNC_UNAVAILABLE');assert.equal(body.save_state,'not_saved');
  assert.deepEqual(body.fields,{prompt:'not_saved',api_key:'not_attempted',model:'not_attempted'});assert.match(body.action,/Redis/);
  calls=[];failure=1;error=new Error('SETTINGS_SAVED_CACHE_SYNC_PENDING: PRIVATE_SECRET');
  // Genuine post-commit signal must be typed, not inferred from arbitrary exception text.
  response=await save();assert.equal(response.json().save_state,'unknown');
  const {SettingsSavedCacheSyncPendingError}=require(base+'/services/settings_cache_events.js');
  calls=[];error=new SettingsSavedCacheSyncPendingError();response=await save();body=response.json();
  assert.equal(body.code,'SETTINGS_SAVED_CACHE_SYNC_PENDING');assert.equal(body.save_state,'synchronization_pending');
  assert.deepEqual(body.fields,{prompt:'synchronization_pending',api_key:'not_attempted',model:'not_attempted'});assert.equal(calls.length,1);
  calls=[];failure=3;error=new SettingsCacheSyncError();response=await save();body=response.json();
  assert.equal(body.save_state,'partially_saved');assert.deepEqual(body.fields,{prompt:'saved',api_key:'saved',model:'not_saved'});
  calls=[];failure=2;error=new Error('postgres://secret:PRIVATE_SECRET@internal/private');response=await save();body=response.json();
  assert.equal(body.save_state,'unknown');assert.deepEqual(body.fields,{prompt:'saved',api_key:'unknown',model:'not_attempted'});
  assert.doesNotMatch(response.body,/PRIVATE|postgres:|internal/);assert.match(body.action,/Check|check/);
  calls=[];failure=0;response=await save();assert.equal(response.statusCode,200);assert.deepEqual(response.json(),{success:true});assert.equal(calls.length,3);
 }finally{reader.write=original;await app.close();await reader.close();}
});

const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const{randomUUID}=require('node:crypto');
const{fixture,base}=require('./threads-api.fixture.cjs');const url=new URL(process.env.DATABASE_URL);
assert.equal(url.hostname,'synthetic-db');assert.equal(url.pathname,'/threads_reliability_synthetic');assert.equal(url.username,'synthetic');
const{prisma:db,pool}=require(path.join(base,'db.ts'));const{GenericThreadsReleaseService}=require(path.join(base,'services/threads_generic_release.service.ts'));
const factService=require(path.join(base,'services/publication_fact.service.ts')).default;
const{reserveThreadsRead}=require(path.join(base,'services/threads_api_store.ts'));
test.after(async()=>{await db.$disconnect();await pool.end();});
async function setup(t,failFact=false){
 const f=fixture(),nonce=randomUUID();const user=await db.user.create({data:{email:`threads-${nonce}@example.invalid`,name:'Synthetic Threads',password_hash:'not-a-login'}});
 const project=await db.project.create({data:{name:'Synthetic Threads',slug:`threads-${nonce}`}});
 t.after(async()=>{await db.project.delete({where:{id:project.id}});await db.user.delete({where:{id:user.id}});});
 await db.projectMember.create({data:{project_id:project.id,user_id:user.id,role:'owner'}});
 const channel=await db.socialChannel.create({data:{project_id:project.id,name:'synthetic-threads',type:'threads',is_active:true,config:f.task.channel.config}});
 const{channel:omittedChannel,selected_asset:omittedAsset,publication_fact:omittedFact,id:omittedId,project_id:omittedProject,...source}=f.task;
 const task=await db.contentItem.create({data:{...source,project_id:project.id,channel_id:channel.id,type:'publication',item_key:nonce}});
 const actorId=`user:${user.id}`;await db.artDirectionDecision.create({data:{project_id:project.id,content_item_id:task.id,decision_version:1,
 source_content_revision:1,channel:'threads',placement:'feed',decision:'NO_VISUAL_NEEDED',actor_id:actorId,reason:'Synthetic',status:'active'}});
 for(const kind of ['content_review','art_direction'])await db.workItem.create({data:{project_id:project.id,content_item_id:task.id,item_key:`${nonce}-${kind}`,
 kind,state:'completed',assignee_role:kind,input_context_version:1}});
 const bind={projectId:project.id,taskId:task.id,actorId};const release={...f.release,...bind,expectedChannelId:channel.id};const send={...f.send,...bind};
 const deps={...f.deps,db,facts:failFact?{record:async()=>{throw Error('synthetic-commit-unavailable');}}:factService,
 manifest:async()=>({project:{id:project.id,slug:project.slug},checksum:f.release.expectedManifestChecksum})};
 const service=new GenericThreadsReleaseService(deps);await service.release(release);
 return{f,project,task,channel,user,service,deps,send,reconcile:attemptId=>({...f.reconcile,...bind,attemptId})};
}
async function pending(t){const s=await setup(t,true);await assert.rejects(s.service.publish(s.send),/FACT_COMMIT_PENDING/);
 const attempt=await db.deliveryAttempt.findFirst({where:{project_id:s.project.id,content_item_id:s.task.id}});
 await db.apiDeliveryRecovery.update({where:{project_id_attempt_id:{project_id:s.project.id,attempt_id:attempt.id}},data:{lease_expires_at:new Date(0),next_read_at:new Date(0)}});
 s.deps.facts=factService;return{...s,attempt};}
const row=s=>db.apiDeliveryRecovery.findFirst({where:{project_id:s.project.id,content_item_id:s.task.id}});
test('T04/T09 actual generic lifecycle commits canonical fact, attempt and API state',async t=>{
 const s=await setup(t);const result=await s.service.publish(s.send);assert.equal(result.mode,'published');assert.equal(s.f.calls,2);
 assert.equal((await row(s)).state,'confirmed');assert.equal(await db.publicationFact.count({where:{content_item_id:s.task.id}}),1);
 assert.equal((await db.deliveryAttempt.findFirst({where:{content_item_id:s.task.id}})).status,'delivered');
 assert.equal((await s.service.reconcile(s.reconcile((await row(s)).attempt_id))).provider_object_id,'123');
});
test('T09 competing readers produce one canonical fact',async t=>{
 const s=await pending(t),a=s.reconcile(s.attempt.id);const results=await Promise.allSettled([s.service.reconcile(a),s.service.reconcile(a)]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(await db.publicationFact.count({where:{content_item_id:s.task.id}}),1);
 assert.equal((await row(s)).state,'confirmed');assert.equal(s.f.calls,2);
});
test('T09 injected audit failure rolls back canonical fact, attempt and recovery completion',async t=>{
 const s=await pending(t);s.deps.facts={record:args=>factService.record({...args,beforeWrite:tx=>args.beforeWrite(new Proxy(tx,{get(target,key){
 if(key==='workflowEvent')return{...target.workflowEvent,create:async()=>{throw Error('synthetic-audit-unavailable');}};return target[key];}}))})};
 await assert.rejects(s.service.reconcile(s.reconcile(s.attempt.id)),/FACT_COMMIT_PENDING/);
 assert.equal(await db.publicationFact.count({where:{content_item_id:s.task.id}}),0);assert.notEqual((await row(s)).state,'confirmed');
 assert.equal((await db.deliveryAttempt.findUnique({where:{id:s.attempt.id}})).status,'pending');
});
test('T07 lease expiration immediately before canonical commit rolls back every write',async t=>{
 const s=await setup(t);s.deps.facts={record:args=>factService.record({...args,beforeCommit:async tx=>{
 s.f.advance(40_000);await args.beforeCommit(tx);}})};
 await assert.rejects(s.service.publish(s.send),/RECOVERY_CONFLICT/);
 assert.equal(await db.publicationFact.count({where:{content_item_id:s.task.id}}),0);assert.notEqual((await row(s)).state,'confirmed');
 assert.equal((await db.deliveryAttempt.findFirst({where:{content_item_id:s.task.id}})).status,'pending');
});
test('T07 generic fact writer cannot bypass a pending API hold even with a callback',async t=>{
 const s=await pending(t);await assert.rejects(factService.record({projectId:s.project.id,taskId:s.task.id,actorId:`user:${s.user.id}`,
 artifactKind:'post',outcome:'published',confirmationMode:'manual',publishedAt:'2026-10-19T10:00:00Z',providerObjectId:'123',
 publicUrl:'https://www.threads.net/@tester/post/abc',beforeWrite:async()=>{}}),/RECOVERY_CONFLICT/);
 assert.equal(await db.publicationFact.count({where:{content_item_id:s.task.id}}),0);
});
test('T07 changed accepted text and revoked owner block readback without provider GET',async t=>{
 const s=await pending(t);const count=s.f.reads;await db.contentItem.update({where:{id:s.task.id},data:{draft_text:'changed'}});
 await assert.rejects(s.service.reconcile(s.reconcile(s.attempt.id)),/RECOVERY_CONFLICT/);assert.equal(s.f.reads,count);
 await db.projectMember.update({where:{project_id_user_id:{project_id:s.project.id,user_id:s.user.id}},data:{role:'viewer'}});
 await assert.rejects(s.service.reconcile(s.reconcile(s.attempt.id)),/OWNER_REQUIRED/);assert.equal(s.f.reads,count);
});
test('T08 real serializable reservation persists budget across concurrent readers',async t=>{
 const s=await pending(t),scope={projectId:s.project.id,taskId:s.task.id,attemptId:s.attempt.id},now=s.deps.now();
 const results=await Promise.allSettled([db.$transaction(tx=>reserveThreadsRead(tx,scope,now),{isolationLevel:'Serializable'}),db.$transaction(tx=>reserveThreadsRead(tx,scope,now),{isolationLevel:'Serializable'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await row(s)).requests_used,4);
});
test('additive migration preserves old attempt and enforces tenant FK, uniqueness and budget',async()=>{
 const{Client}=require('pg'),fs=require('node:fs');const client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();
 try{await client.query('BEGIN');await client.query('CREATE SCHEMA threads_delta_synthetic');
 await client.query('CREATE TABLE threads_delta_synthetic.delivery_attempts(id INTEGER,project_id INTEGER,status TEXT, UNIQUE(project_id,id))');
 await client.query("INSERT INTO threads_delta_synthetic.delivery_attempts VALUES(1,2,'pending')");
 const sql=fs.readFileSync('/source/prisma/migrations/20261019120000_api_delivery_recovery/migration.sql','utf8').replaceAll('"planner".','"threads_delta_synthetic".');await client.query(sql);
 assert.equal((await client.query('SELECT status FROM threads_delta_synthetic.delivery_attempts')).rows[0].status,'pending');
 assert.equal((await client.query('SELECT COUNT(*) FROM threads_delta_synthetic.api_delivery_recovery')).rows[0].count,'0');
 await client.query('SAVEPOINT check_budget');await assert.rejects(client.query("INSERT INTO threads_delta_synthetic.api_delivery_recovery(project_id,content_item_id,attempt_id,package_sha256,release_sha256,snapshot,rounds,updated_at) VALUES(2,3,1,'a','b','{}',4,NOW())"),/check constraint/);await client.query('ROLLBACK TO check_budget');
 }finally{await client.query('ROLLBACK');await client.end();}
});

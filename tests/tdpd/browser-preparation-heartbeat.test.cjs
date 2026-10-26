const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist';
const {setup,deps,db,pool}=require('./browser-recovery.fixture.cjs');
const release=require(path.join(base,'services/browser_publication_release.js'));
const execution=require(path.join(base,'services/browser_publication_execution.js'));
const {createPreparationRecovery}=require(path.join(base,'services/browser_preparation_recovery.js'));
const {createPreparationHeartbeat}=require(path.join(base,'services/browser_preparation_heartbeat.js'));
const {withPublicationPrincipal}=require(path.join(base,'mcp/publication-principal.js'));
const {body,sha}=require('./shared-browser.fixture.cjs');
process.env.BROWSER_RECOVERY_V2_ENABLED='true';
test.after(async()=>{await db.$disconnect();await pool.end();});
async function scenario(t){
 const s=await setup(t),released=await release.releaseBrowserPublication(s.args,deps),workItemId=released.browser_work_item_id;
 const claim=await execution.claimBrowserPublication({...s.args,workItemId,idempotencyKey:'claim'},deps);
 const supervisor={executorId:'synthetic-heartbeat-runtime',supports:()=>true,quiesce:async a=>({executorId:'synthetic-heartbeat-runtime',generation:a.generation,challengeSha256:sha(a.challenge),oldExecutorQuiescent:true,evidenceRef:'sha256:'+'c'.repeat(64),failureKind:'EXECUTOR_RESTART'})};
 const recovery=createPreparationRecovery({deps,supervisor});
 const send={...s.args,apply:false,workItemId,leaseToken:claim.lease_token,idempotencyKey:'immutable-original-start'};
 const started=await recovery.start(send),attemptId=started.attempt_id;
 const input={projectId:send.projectId,taskId:send.taskId,attemptId,workItemId,actorId:send.actorId,idempotencyKey:send.idempotencyKey,leaseToken:send.leaseToken,generation:0};
 const principal={userId:s.user.id,actorId:send.actorId,projectId:send.projectId,profile:'publisher'};
 const current=Date.now(),shortExpiry=new Date(current+30000);await db.workItem.update({where:{id:workItemId},data:{lease_expires_at:shortExpiry}});
 const service=createPreparationHeartbeat(deps,()=>current);
 const renew=(changes={},identity=principal)=>withPublicationPrincipal(identity,()=>service.renew({...input,...changes}));
 const observation={...send,attemptId,observedProfileUrl:send.snapshot.identity.profileUrl,observedProviderAccountId:send.snapshot.identity.providerAccountId,observedAccountType:send.snapshot.identity.accountType,observedBodySha256:sha(body),observedAssetSha256:send.snapshot.assetSha256,paragraphBlockSha256:body.split(/\n\s*\n/).map(p=>sha(p.trim())),attachedImageCount:1,duplicateAbsent:true,evidenceSha256:'d'.repeat(64)};
 return{...s,input,principal,renew,current,shortExpiry,recovery,observation,service};
}
const work=s=>db.workItem.findUnique({where:{id:s.input.workItemId}});
const ledger=s=>db.browserPreparationExecution.findUnique({where:{project_id_attempt_id:{project_id:s.input.projectId,attempt_id:s.input.attemptId}}});
const state=s=>db.browserDeliveryRecovery.findUnique({where:{project_id_attempt_id:{project_id:s.input.projectId,attempt_id:s.input.attemptId}}});
test('HB01 live preparation renews original lease, audits safely and creates no attempt/permit',async t=>{
 const s=await scenario(t),before=await work(s),r=await s.renew(),after=await work(s);
 assert.equal(r.generation,0);assert.equal(r.leaseExpiresAtMs,s.current+120000);assert.equal(after.lease_expires_at.getTime(),r.leaseExpiresAtMs);assert.equal(after.lease_token,before.lease_token);
 assert.equal(await db.deliveryAttempt.count({where:{content_item_id:s.input.taskId}}),1);assert.equal(await db.workflowEvent.count({where:{content_item_id:s.input.taskId,command:'ba_pre_submit_browser_submission'}}),0);
 assert.equal(r.submission_permitted,false);assert.equal(JSON.stringify(r).includes(before.lease_token),false);
 const audit=await db.workflowEvent.findFirst({where:{content_item_id:s.input.taskId,command:'browser_preparation_heartbeat'}});
 assert.ok(audit);assert.equal(JSON.stringify(audit).includes(before.lease_token),false);assert.equal(JSON.stringify(audit).includes(s.input.idempotencyKey),false);
});
test('HB02 no captured identity fallback: missing, owner, wrong project/actor refuse',async t=>{
 const s=await scenario(t),before=await work(s);
 for(const principal of [null,{...s.principal,profile:'owner'},{...s.principal,projectId:s.input.projectId+1},{...s.principal,userId:s.user.id+1,actorId:'user:'+(s.user.id+1)}])await assert.rejects(s.renew({},principal));
 assert.deepEqual(await work(s),before);
});
test('HB03 wrong immutable key, private lease, work item or generation never renew',async t=>{
 const s=await scenario(t),before=await work(s);
 for(const patch of [{idempotencyKey:'different-start'},{leaseToken:'not-the-original-private-lease'},{workItemId:s.input.workItemId+1},{generation:1}])await assert.rejects(s.renew(patch));
 assert.deepEqual(await work(s),before);
});
test('HB04 expired or released original lease cannot be revived',async t=>{
 const s=await scenario(t);await db.workItem.update({where:{id:s.input.workItemId},data:{lease_expires_at:new Date(s.current)}});
 await assert.rejects(s.renew(),/HEARTBEAT_LEASE_EXPIRED/);assert.equal((await work(s)).lease_expires_at.getTime(),s.current);
});
test('HB05 live preparation extends beyond recovery cutoff without changing its bounded budget',async t=>{
 const s=await scenario(t),stored=await ledger(s),deadline=s.current+60000;
 await db.browserPreparationExecution.update({where:{project_id_attempt_id:{project_id:s.input.projectId,attempt_id:s.input.attemptId}},data:{ledger:{...stored.ledger,deadlineMs:deadline}}});
 assert.equal((await s.renew()).leaseExpiresAtMs,s.current+120000);
 const active=await ledger(s);assert.equal(active.ledger.deadlineMs,deadline);
 await db.browserPreparationExecution.update({where:{project_id_attempt_id:{project_id:s.input.projectId,attempt_id:s.input.attemptId}},data:{ledger:{...active.ledger,deadlineMs:s.current}}});
 assert.equal((await s.renew()).leaseExpiresAtMs,s.current+120000);assert.equal((await ledger(s)).ledger.deadlineMs,s.current);
});
test('HB06 ANY recorded permit blocks renewal even when recovery flags claim PREPARE',async t=>{
 const s=await scenario(t),before=await work(s);
 await db.workflowEvent.create({data:{project_id:s.input.projectId,content_item_id:s.input.taskId,work_item_id:s.input.workItemId,actor_id:s.input.actorId,command:'ba_pre_submit_browser_submission',after_state:{submission_permitted:true}}});
 await assert.rejects(s.renew(),/HEARTBEAT_POSSIBLY_SENT/);assert.deepEqual(await work(s),before);
});
test('HB07 revoked Owner approval and demo/member revocation are rechecked',async t=>{
 const s=await scenario(t),before=await work(s);
 await db.user.update({where:{id:s.user.id},data:{is_demo:true}});await assert.rejects(s.renew());await db.user.update({where:{id:s.user.id},data:{is_demo:false}});
 await db.projectMember.deleteMany({where:{project_id:s.project.id,user_id:s.user.id}});await assert.rejects(s.renew());assert.deepEqual(await work(s),before);
});
test('HB08 current content revision/package change refuses heartbeat',async t=>{
 const s=await scenario(t),before=await work(s);await db.contentItem.update({where:{id:s.input.taskId},data:{content_revision:6}});
 await assert.rejects(s.renew());assert.deepEqual(await work(s),before);
});
test('HB09 heartbeat cannot extend beyond permit or race a concurrent first permit',async t=>{
 const s=await scenario(t);const results=await Promise.allSettled([s.renew(),s.recovery.preSubmit(s.observation,0)]);
 assert.ok(results.some(x=>x.status==='fulfilled'));
 const events=await db.workflowEvent.findMany({where:{content_item_id:s.input.taskId,command:{in:['browser_preparation_heartbeat','ba_pre_submit_browser_submission']}},orderBy:{id:'asc'}});
 const p=events.findIndex(x=>x.command==='ba_pre_submit_browser_submission');if(p>=0)assert.equal(events.slice(p+1).some(x=>x.command==='browser_preparation_heartbeat'),false);
 if((await state(s)).stage!=='PREPARE')await assert.rejects(s.renew());
 assert.equal(await db.deliveryAttempt.count({where:{content_item_id:s.input.taskId}}),1);
});
test('HB10 audit failure rolls back work and recovery/ledger renewal atomically',async t=>{
 const s=await scenario(t),before=await work(s),beforeState=await state(s),beforeLedger=await ledger(s);
 const bad={...deps,db:new Proxy(db,{get(target,key){if(key==='$transaction')return (run,options)=>target.$transaction(tx=>run(new Proxy(tx,{get(t,k){if(k==='workflowEvent')return new Proxy(t.workflowEvent,{get(w,m){if(m==='create')return async()=>{throw Error('synthetic-audit-unavailable');};return w[m];}});return t[k];}})),options);return target[key];}})};
 await assert.rejects(withPublicationPrincipal(s.principal,()=>createPreparationHeartbeat(bad,()=>s.current).renew(s.input)),/synthetic-audit-unavailable/);
 assert.deepEqual(await work(s),before);assert.deepEqual(await state(s),beforeState);assert.deepEqual(await ledger(s),beforeLedger);
});
test('HB11 stale generation after same-attempt recovery cannot renew the old lease',async t=>{
 const s=await scenario(t);const r=await s.recovery.recover({projectId:s.input.projectId,taskId:s.input.taskId,attemptId:s.input.attemptId,actorId:s.input.actorId,idempotencyKey:'recovery'});
 assert.equal(r.resumed,true);const before=await work(s);await assert.rejects(s.renew());assert.deepEqual(await work(s),before);assert.equal((await state(s)).execution_generation,1);
});
test('HB12 unknown input fields and caller-selected TTL are rejected',async t=>{
 const s=await scenario(t);await assert.rejects(s.renew({leaseSeconds:1800}));await assert.rejects(s.renew({oldExecutorQuiescent:true}));
});

test('HB13 original expiry reached during audit rolls the entire heartbeat back',async t=>{
 const s=await scenario(t),before=await work(s);let time=s.current;
 const slow={...deps,db:new Proxy(db,{get(target,key){if(key==='$transaction')return (run,options)=>target.$transaction(tx=>run(new Proxy(tx,{get(t,k){if(k==='workflowEvent')return new Proxy(t.workflowEvent,{get(w,m){if(m==='create')return async args=>{const result=await w.create(args);time=s.shortExpiry.getTime();return result;};return w[m];}});return t[k];}})),options);return target[key];}})};
 await assert.rejects(withPublicationPrincipal(s.principal,()=>createPreparationHeartbeat(slow,()=>time).renew(s.input)),/HEARTBEAT_LEASE_EXPIRED/);
 assert.deepEqual(await work(s),before);assert.equal(await db.workflowEvent.count({where:{content_item_id:s.input.taskId,command:'browser_preparation_heartbeat'}}),0);
});
test('HB14 concurrent heartbeat and recovery leave only the fenced same attempt usable',async t=>{
 const s=await scenario(t);
 await Promise.allSettled([s.renew(),s.recovery.recover({projectId:s.input.projectId,taskId:s.input.taskId,attemptId:s.input.attemptId,actorId:s.input.actorId,idempotencyKey:'racing-recovery'})]);
 const r=await state(s);if(r.execution_generation>0)await assert.rejects(s.renew());else assert.ok(['preparing','quiescing'].includes((await ledger(s)).ledger.state));
 assert.equal(await db.deliveryAttempt.count({where:{content_item_id:s.input.taskId}}),1);
 assert.equal(await db.workflowEvent.count({where:{content_item_id:s.input.taskId,command:'ba_pre_submit_browser_submission'}}),0);
});
test('HB15 concurrent renewals never rotate ownership or mint a new generation',async t=>{
 const s=await scenario(t),before=await work(s),results=await Promise.allSettled([s.renew(),s.renew()]);
 assert.ok(results.some(x=>x.status==='fulfilled'));assert.equal((await work(s)).lease_token,before.lease_token);assert.equal((await state(s)).execution_generation,0);
 assert.equal(await db.deliveryAttempt.count({where:{content_item_id:s.input.taskId}}),1);
});

const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist';
const {setup,deps,db,pool}=require('./browser-recovery.fixture.cjs');
const release=require(path.join(base,'services/browser_publication_release.js')),execution=require(path.join(base,'services/browser_publication_execution.js'));
const {createPreparationRecovery}=require(path.join(base,'services/browser_preparation_recovery.js'));
const {createPreparationHeartbeat}=require(path.join(base,'services/browser_preparation_heartbeat.js'));
const {withPublicationPrincipal}=require(path.join(base,'mcp/publication-principal.js'));
const {body,sha}=require('./shared-browser.fixture.cjs');
process.env.BROWSER_RECOVERY_V2_ENABLED='true';test.after(async()=>{await db.$disconnect();await pool.end();});
async function scenario(t){
 const s=await setup(t),released=await release.releaseBrowserPublication(s.args,deps),workItemId=released.browser_work_item_id;
 const claim=await execution.claimBrowserPublication({...s.args,workItemId,idempotencyKey:'claim'},deps);
 let clock=Date.now();const executorId='synthetic-live-runtime';
 const supervisor={executorId,supports:()=>true,quiesce:async a=>({executorId,generation:a.generation,challengeSha256:sha(a.challenge),oldExecutorQuiescent:true,evidenceRef:'sha256:'+'b'.repeat(64),failureKind:'EXECUTOR_RESTART'})};
 const recovery=createPreparationRecovery({deps,supervisor,now:()=>clock});
 const send={...s.args,apply:false,workItemId,leaseToken:claim.lease_token,idempotencyKey:'original-start'};
 const started=await recovery.start(send),attemptId=started.attempt_id;
 const input={projectId:send.projectId,taskId:send.taskId,attemptId,workItemId,actorId:send.actorId,idempotencyKey:send.idempotencyKey,leaseToken:send.leaseToken,generation:0};
 const principal={userId:s.user.id,actorId:send.actorId,projectId:send.projectId,profile:'publisher'};
 const request=key=>({projectId:input.projectId,taskId:input.taskId,attemptId,actorId:input.actorId,idempotencyKey:key});
 const renew=()=>withPublicationPrincipal(principal,()=>createPreparationHeartbeat(deps,()=>clock).renew(input));
 const observation=()=>({...send,leaseToken:input.leaseToken,attemptId,observedProfileUrl:send.snapshot.identity.profileUrl,observedProviderAccountId:send.snapshot.identity.providerAccountId,observedAccountType:send.snapshot.identity.accountType,observedBodySha256:sha(body),observedAssetSha256:send.snapshot.assetSha256,paragraphBlockSha256:body.split(/\n\s*\n/).map(p=>sha(p.trim())),attachedImageCount:1,duplicateAbsent:true,evidenceSha256:'d'.repeat(64)});
 const ledger=()=>db.browserPreparationExecution.findUnique({where:{project_id_attempt_id:{project_id:input.projectId,attempt_id:attemptId}}});
 async function edit(delta){const row=await ledger();await db.browserPreparationExecution.update({where:{project_id_attempt_id:{project_id:input.projectId,attempt_id:attemptId}},data:{ledger:{...row.ledger,...delta}}});}
 const work=()=>db.workItem.findUnique({where:{id:workItemId}});
 return{...s,input,request,renew,recovery,observation,ledger,edit,work,executorId,now:()=>clock,advance:ms=>{clock+=ms;}};
}
async function admittedWindow(s){await s.edit({startedAtMs:s.now()-1000,deadlineMs:s.now()+179000});await db.workItem.update({where:{id:s.input.workItemId},data:{lease_expires_at:new Date(s.now()+30000)}});}
async function keepAliveBeyondDeadline(s){await admittedWindow(s);await s.renew();for(let i=0;i<4;i++){s.advance(80000);await s.renew();}}
test('LIVE01 repeated actual renewals and preSubmit work beyond180s without consuming or resetting recovery clock',async t=>{
 const s=await scenario(t);await keepAliveBeyondDeadline(s);const row=await s.ledger();assert.ok(s.now()>row.ledger.deadlineMs);assert.equal(row.ledger.resumptions,0);assert.equal(row.ledger.deadlineMs-row.ledger.startedAtMs,180000);assert.equal(row.ledger.activeLiveness.generation,0);
 const picked=await s.recovery.pickup({...s.request('pickup'),generation:0});assert.equal(picked.leaseToken,s.input.leaseToken);
 const result=await s.recovery.preSubmit(s.observation(),0);assert.equal(result.submission_permitted,true);await assert.rejects(s.renew());assert.equal(await db.deliveryAttempt.count({where:{content_item_id:s.input.taskId}}),1);
});
test('LIVE02 queued pickup remains deadline-bound and cannot acquire a new active exemption after expiry',async t=>{
 const s=await scenario(t);await s.edit({state:'queued',startedAtMs:s.now()-180001,deadlineMs:s.now()-1,outbox:'pending'});await assert.rejects(s.recovery.pickup({...s.request('pickup'),generation:0}));assert.equal((await s.ledger()).ledger.activeLiveness,undefined);
});
test('LIVE03 heartbeat expiry and historical record without active binding cannot be revived after deadline',async t=>{
 const s=await scenario(t);await admittedWindow(s);s.advance(180000);await assert.rejects(s.renew());assert.equal((await s.ledger()).ledger.activeLiveness,undefined);
 const other=await scenario(t);await keepAliveBeyondDeadline(other);const expiry=(await other.work()).lease_expires_at.getTime();other.advance(expiry-other.now());const before=await other.work();await assert.rejects(other.renew());assert.deepEqual(await other.work(),before);
});
test('LIVE04 live active generation refuses recovery takeover without changing budget or calling quiescence',async t=>{
 const s=await scenario(t);await keepAliveBeyondDeadline(s);const before=await s.ledger();const r=await s.recovery.recover(s.request('outage'));assert.equal(r.code,'RECOVERY_IN_PROGRESS');assert.deepEqual(await s.ledger(),before);
});
test('LIVE05 later outage pauses only verified active lease interval; downtime is charged and next generation inherits no activity',async t=>{
 const s=await scenario(t);await keepAliveBeyondDeadline(s);const before=(await s.ledger()).ledger,expiry=(await s.work()).lease_expires_at.getTime();s.advance(expiry-s.now()+10000);
 const r=await s.recovery.recover(s.request('outage'));assert.equal(r.resumed,true);const after=(await s.ledger()).ledger;
 assert.equal(after.resumptions,before.resumptions+1);assert.equal(after.generation,1);assert.equal(after.activeLiveness,undefined);
 assert.equal(after.deadlineMs,before.deadlineMs+expiry-before.activeLiveness.activatedAtMs);assert.equal(after.deadlineMs-s.now(),169000);
 const replay=await s.recovery.recover(s.request('outage'));assert.equal(replay.resumed,true);assert.equal((await s.ledger()).ledger.deadlineMs,after.deadlineMs);await assert.rejects(s.renew());
});
test('LIVE06 expired180s cumulative budget and3resumptions remain exhausted despite long active time',async t=>{
 for(const exhaustion of ['time','count']){const s=await scenario(t);await keepAliveBeyondDeadline(s);const before=(await s.ledger()).ledger,expiry=(await s.work()).lease_expires_at.getTime();if(exhaustion==='count')await s.edit({resumptions:3});s.advance(expiry-s.now()+(exhaustion==='time'?180000:1));
 const r=await s.recovery.recover(s.request('outage'));assert.equal(r.code,'RECONCILIATION_BUDGET_EXHAUSTED');const after=(await s.ledger()).ledger;assert.equal(after.resumptions,exhaustion==='count'?3:before.resumptions);assert.equal(after.deadlineMs-after.startedAtMs,180000);}
});
test('LIVE07 active state with wrong generation/lease or mismatched work expiry never extends admission',async t=>{
 const s=await scenario(t);await keepAliveBeyondDeadline(s);const original=(await s.ledger()).ledger;for(const change of [{generation:1},{leaseSha256:'f'.repeat(64)},{leaseExpiresAtMs:original.activeLiveness.leaseExpiresAtMs+1}]){await s.edit({activeLiveness:{...original.activeLiveness,...change}});await assert.rejects(s.renew());await assert.rejects(s.recovery.preSubmit(s.observation(),0));}assert.equal(await db.workflowEvent.count({where:{content_item_id:s.input.taskId,command:'ba_pre_submit_browser_submission'}}),0);
});
test('LIVE08 closing active-clock audit failure rolls back credit and never calls supervisor',async t=>{
 const s=await scenario(t);await keepAliveBeyondDeadline(s);const expiry=(await s.work()).lease_expires_at.getTime();s.advance(expiry-s.now()+1);const before=await s.ledger(),beforeWork=await s.work();let quiesced=0;
 const bad={...deps,db:new Proxy(db,{get(target,key){if(key==='$transaction')return (run,options)=>target.$transaction(tx=>run(new Proxy(tx,{get(t,k){if(k==='workflowEvent')return new Proxy(t.workflowEvent,{get(w,m){if(m==='create')return async a=>{if(a.data.command==='browser_preparation_liveness_closed')throw Error('synthetic-audit-failure');return w.create(a);};return w[m];}});return t[k];}})),options);return target[key];}})};
 const recovery=createPreparationRecovery({deps:bad,now:s.now,supervisor:{executorId:s.executorId,supports:()=>true,quiesce:async()=>{quiesced++;throw Error('not-reached');}}});
 const r=await recovery.recover(s.request('outage'));assert.equal(r.resumed,false);assert.equal(quiesced,0);assert.deepEqual(await s.ledger(),before);assert.deepEqual(await s.work(),beforeWork);
});
test('LIVE09 concurrent expired recovery closes one active interval only and cannot reset its clock',async t=>{
 const s=await scenario(t);await keepAliveBeyondDeadline(s);const before=(await s.ledger()).ledger,expiry=(await s.work()).lease_expires_at.getTime();s.advance(expiry-s.now()+1);
 const results=await Promise.allSettled([s.recovery.recover(s.request('a')),s.recovery.recover(s.request('b'))]);assert.ok(results.some(r=>r.status==='fulfilled'));const after=(await s.ledger()).ledger;
 assert.equal(after.deadlineMs,before.deadlineMs+expiry-before.activeLiveness.activatedAtMs);assert.equal(await db.workflowEvent.count({where:{content_item_id:s.input.taskId,command:'browser_preparation_liveness_closed'}}),1);assert.equal(await db.deliveryAttempt.count({where:{content_item_id:s.input.taskId}}),1);
});
test('LIVE10 heartbeat racing takeover leaves a single owned generation and never credits a live lease',async t=>{
 const s=await scenario(t);await keepAliveBeyondDeadline(s);const before=(await s.ledger()).ledger;await Promise.allSettled([s.renew(),s.recovery.recover(s.request('race'))]);const after=(await s.ledger()).ledger;
 assert.equal(after.generation,before.generation);assert.equal(after.resumptions,before.resumptions);assert.equal(after.deadlineMs,before.deadlineMs);assert.equal(after.state,'preparing');assert.equal(await db.workflowEvent.count({where:{content_item_id:s.input.taskId,command:'browser_preparation_liveness_closed'}}),0);
});
test('LIVE11 exact recovery replay after pickup stays read-only and does not deny the live executor',async t=>{
 const s=await scenario(t);const first=await s.recovery.recover(s.request('original-recovery'));assert.equal(first.resumed,true);await s.recovery.pickup({...s.request('pickup'),generation:1});const before=await s.ledger();const replay=await s.recovery.recover(s.request('original-recovery'));assert.equal(replay.resumed,true);assert.equal(replay.replayed,true);assert.deepEqual(await s.ledger(),before);
});
test('LIVE12 UNKNOWN or recorded possible dispatch never gets a liveness exemption or clock credit',async t=>{
 const s=await scenario(t);await keepAliveBeyondDeadline(s);await db.browserDeliveryRecovery.update({where:{project_id_attempt_id:{project_id:s.input.projectId,attempt_id:s.input.attemptId}},data:{delivery_certainty:'UNKNOWN'}});const before=await s.ledger();
 await assert.rejects(s.renew());await assert.rejects(s.recovery.pickup({...s.request('pickup'),generation:0}));await assert.rejects(s.recovery.preSubmit(s.observation(),0));const r=await s.recovery.recover(s.request('outage'));assert.equal(r.resumed,false);assert.equal(r.code,'POST_SUBMIT_UNKNOWN');assert.deepEqual(await s.ledger(),before);
});

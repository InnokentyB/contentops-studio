const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist';
const {started,deps,db,pool}=require('./browser-recovery.fixture.cjs');
const {hash,snapshotHash}=require(path.join(base,'services/browser_publication_contract.js'));
const {createBrowserRecoveryRepository}=require(path.join(base,'services/browser_recovery_repository.js'));
const {createBrowserRecoveryResumePort}=require(path.join(base,'services/browser_recovery_resume_repository.js'));
const {resumeBrowserRecovery}=require(path.join(base,'services/browser_recovery_resume.js'));
const {finalizeBrowserRecoverySubmission}=require(path.join(base,'services/browser_publication_confirmation.js'));
const {preSubmitBrowserSubmission,markBrowserSubmissionUncertain}=require(path.join(base,'services/browser_publication_execution.js'));
const {coordinateBrowserRecovery,recoveryOutcome}=require(path.join(base,'services/browser_recovery_coordinator.js'));
const {createBrowserRecoveryOperation}=require(path.join(base,'services/browser_recovery_runtime.js'));
process.env.BROWSER_RECOVERY_V2_ENABLED='true';
test.after(async()=>{await db.$disconnect();await pool.end();});
async function state(t,prepare=false){
 const s=await started(t),a=s.observation;
 await db.deliveryAttempt.update({where:{id:a.attemptId},data:{error_message:prepare?'PRE_SUBMIT_REJECTED':'PROVIDER_RESULT_UNCERTAIN'}});
 const scope={projectId:a.projectId,taskId:a.taskId,attemptId:a.attemptId,packageSha256:snapshotHash(a.snapshot)};
 await db.browserDeliveryRecovery.create({data:{project_id:a.projectId,content_item_id:a.taskId,attempt_id:a.attemptId,work_item_id:a.workItemId,package_sha256:scope.packageSha256,approval_sha256:hash(a.approvalReference),original_snapshot:a.snapshot,stage:prepare?'PREPARE':'RECONCILING',delivery_certainty:prepare?'NOT_DISPATCHED':'UNKNOWN',cause_code:prepare?'PREPARE_FAILED':'POST_SUBMIT_UNKNOWN',recovery_action:prepare?'CONTINUE_SAME_ATTEMPT_AFTER_REPAIR':'READ_ONLY_RECONCILIATION'}});
 return{...s,scope,repo:createBrowserRecoveryRepository(deps,a.actorId)};
}
const current=s=>db.browserDeliveryRecovery.findUnique({where:{project_id_attempt_id:{project_id:s.scope.projectId,attempt_id:s.scope.attemptId}}});
test('additive migration created constrained storage without admitting historical attempts',async()=>{
 const rows=await db.$queryRaw`SELECT to_regclass('planner.browser_delivery_recovery')::text AS relation`;
 assert.match(rows[0].relation,/(?:planner\.)?browser_delivery_recovery$/);
});
test('two recovery readers race: one reservation wins and per-page budget cannot exceed twenty',async t=>{
 const s=await state(t),now=Date.now();
 const results=await Promise.allSettled([s.repo.reserve(s.scope,now),s.repo.reserve(s.scope,now)]);
 const grants=results.flatMap(r=>r.status==='fulfilled'&&r.value.kind==='reserved'?[r.value.reservation]:[]);assert.equal(grants.length,1);
 const r=grants[0];let granted=0;for(let n=0;n<25;n++)if(await s.repo.takeRequest(r,now+1))granted++;
 assert.equal(granted,20);assert.equal((await current(s)).requests_used,20);
 assert.equal(await s.repo.takeRequest({...r,leaseToken:'foreign-secret'},now+2),false);
 assert.equal(await s.repo.settle(r,recoveryOutcome('RECONCILIATION_BUDGET_EXHAUSTED'),now+3),'committed');
 assert.equal((await s.repo.reserve(s.scope,now+4)).kind,'held');
 const audit=await db.workflowEvent.findMany({where:{project_id:s.scope.projectId,command:{startsWith:'browser_recovery_'}}});
 assert.ok(!JSON.stringify(audit).includes(r.leaseToken));
});
test('readback budget survives repository recreation, crash lease expiry, and stale settlement',async t=>{
 const s=await state(t),now=Date.now(),one=await s.repo.reserve(s.scope,now);assert.equal(one.kind,'reserved');
 await s.repo.takeRequest(one.reservation,now+1);
 const restarted=createBrowserRecoveryRepository(deps,s.observation.actorId);
 const two=await restarted.reserve(s.scope,now+36000);assert.equal(two.kind,'reserved');assert.equal(two.reservation.round,2);assert.equal(two.reservation.requestsUsed,1);
 assert.equal(await s.repo.takeRequest(one.reservation,now+36001),false);
 assert.equal(await s.repo.settle(one.reservation,recoveryOutcome('PERMISSION_DENIED'),now+36001),'conflict');
 assert.equal(await restarted.settle(two.reservation,recoveryOutcome('RECONCILIATION_NOT_FOUND'),now+36002),'committed');
 const three=await restarted.reserve(s.scope,now+120000);assert.equal(three.kind,'reserved');
 await restarted.settle(three.reservation,recoveryOutcome('RECONCILIATION_NOT_FOUND'),now+120001);
 assert.equal((await current(s)).cause_code,'RECONCILIATION_BUDGET_EXHAUSTED');
 assert.equal((await restarted.reserve(s.scope,now+120002)).kind,'held');
});
test('cross-tenant/package recovery scopes and non-owner cannot spend a request',async t=>{
 const s=await state(t),now=Date.now();
 await assert.rejects(s.repo.reserve({...s.scope,taskId:s.scope.taskId+1},now),/SCOPE/);
 assert.equal((await s.repo.reserve({...s.scope,packageSha256:'e'.repeat(64)},now)).kind,'legacy');
 const denied=createBrowserRecoveryRepository(deps,'user:999999999');await assert.rejects(denied.reserve(s.scope,now),/OWNER/);
 assert.equal((await current(s)).requests_used,0);
});
test('v1 submit path cannot bypass v2 hold',async t=>{
 const s=await state(t);await assert.rejects(preSubmitBrowserSubmission(s.observation,deps),/BROWSER_RECOVERY_V2_HELD/);
 assert.equal(await db.workflowEvent.count({where:{project_id:s.scope.projectId,command:'ba_pre_submit_browser_submission'}}),0);
});
async function completion(s){const reserved=await s.repo.reserve(s.scope,Date.now());assert.equal(reserved.kind,'reserved');await s.repo.takeRequest(reserved.reservation,Date.now());
 const{leaseToken,...a}=s.observation;return{r:reserved.reservation,input:{...a,publicUrl:'https://www.linkedin.com/feed/update/urn:li:activity:918273645/',providerObjectId:'urn:li:activity:918273645',publishedAt:new Date().toISOString()}};}
test('verified readback commits same attempt, canonical fact, recovery and audit atomically and replays idempotently',async t=>{
 const s=await state(t),{r,input}=await completion(s),signal=new AbortController().signal;
 const result=await finalizeBrowserRecoverySubmission(input,r,signal,deps);assert.equal(result.attempt_id,s.scope.attemptId);
 assert.equal((await current(s)).state,'finalized');assert.equal((await db.deliveryAttempt.findUnique({where:{id:s.scope.attemptId}})).status,'delivered');
 const replay=await finalizeBrowserRecoverySubmission(input,r,signal,deps);assert.equal(replay.replayed,true);
 assert.equal(await db.publicationFact.count({where:{content_item_id:s.scope.taskId}}),1);
 assert.equal(await db.workflowEvent.count({where:{project_id:s.scope.projectId,command:'browser_recovery_finalize'}}),1);
});
test('canonical finalization rollback preserves UNKNOWN and pending attempt on audit failure',async t=>{
 const s=await state(t),{r,input}=await completion(s),factService=require(path.join(base,'services/publication_fact.service.js')).default;
 // Fact writer and recovery hook must share the SAME real transaction; inject failure in its beforeWrite hook.
 const write=args=>factService.record({...args,beforeWrite:tx=>args.beforeWrite(new Proxy(tx,{get(target,key){if(key==='workflowEvent')return{...target.workflowEvent,create:async()=>{throw Error('synthetic-audit-unavailable');}};return target[key];}}))});
 await assert.rejects(finalizeBrowserRecoverySubmission(input,r,new AbortController().signal,deps,write),/synthetic-audit/);
 assert.equal((await current(s)).state,'reading');assert.equal((await db.deliveryAttempt.findUnique({where:{id:s.scope.attemptId}})).status,'pending');assert.equal(await db.publicationFact.count({where:{content_item_id:s.scope.taskId}}),0);
});
test('FOUND races a late v1 response: at most one fact and no unguarded mutation',async t=>{
 const s=await state(t),{r,input}=await completion(s),confirm=require(path.join(base,'services/browser_publication_confirmation.js'));
 const results=await Promise.allSettled([finalizeBrowserRecoverySubmission(input,r,new AbortController().signal,deps),confirm.reconcileBrowserSubmission(input,deps)]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(await db.publicationFact.count({where:{content_item_id:s.scope.taskId}}),1);
});
const proof={executorId:'synthetic-fenced-executor',proveQuiescence:async()=>({executorId:'synthetic-fenced-executor',evidenceRef:'sha256:'+'d'.repeat(64),issuedPermitCount:0,dispatchCount:0,oldExecutorQuiescent:true,challengeSupersessionSupported:true})};
test('pre-permit recovery resumes the same attempt with rotated lease and stale replay held',async t=>{
 const s=await state(t,true),a=s.observation,args={projectId:a.projectId,taskId:a.taskId,attemptId:a.attemptId,actorId:a.actorId,idempotencyKey:'resume'};
 const old=await db.workItem.findUnique({where:{id:a.workItemId}}),port=createBrowserRecoveryResumePort(deps,proof);
 const result=await resumeBrowserRecovery(args,port);assert.equal(result.resumed,true);assert.equal(result.generation,1);assert.equal(result.state,'resumed_requires_executor_pickup');assert.equal(result.submission_permitted,false);
 const updated=await db.workItem.findUnique({where:{id:a.workItemId}});assert.notEqual(updated.lease_token,old.lease_token);
 assert.equal(await db.deliveryAttempt.count({where:{content_item_id:a.taskId}}),1);assert.equal((await db.deliveryAttempt.findUnique({where:{id:a.attemptId}})).error_message,'PRE_SUBMIT_REJECTED');
 assert.equal((await resumeBrowserRecovery(args,port)).replayed,true);
 await db.browserDeliveryRecovery.update({where:{project_id_attempt_id:{project_id:a.projectId,attempt_id:a.attemptId}},data:{recovery_lease_expires_at:new Date(Date.now()-1)}});
 assert.equal((await resumeBrowserRecovery(args,port)).code,'RECOVERY_CONFLICT');
 await db.browserDeliveryRecovery.update({where:{project_id_attempt_id:{project_id:a.projectId,attempt_id:a.attemptId}},data:{stage:'PERMIT_ISSUED',delivery_certainty:'POSSIBLY_SENT'}});
 assert.equal((await resumeBrowserRecovery(args,port)).code,'POST_SUBMIT_UNKNOWN');
 assert.ok(!JSON.stringify(result).includes(updated.lease_token));
});
test('missing executor fence and issued permit evidence prevent same-attempt resume',async t=>{
 const s=await state(t,true),a=s.observation,args={projectId:a.projectId,taskId:a.taskId,attemptId:a.attemptId,actorId:a.actorId,idempotencyKey:'resume-denied'};
 assert.equal((await resumeBrowserRecovery(args,createBrowserRecoveryResumePort(deps))).code,'PRE_DISPATCH_PROOF_UNAVAILABLE');
 await db.workflowEvent.create({data:{project_id:a.projectId,content_item_id:a.taskId,work_item_id:a.workItemId,actor_id:a.actorId,command:'ba_pre_submit_browser_submission',after_state:{submission_permitted:true}}});
 assert.equal((await resumeBrowserRecovery(args,createBrowserRecoveryResumePort(deps,proof))).resumed,false);assert.equal((await current(s)).execution_generation,0);
});
test('automatic owning-operation recovery calls only a registered synthetic reader and finalizes through canonical gates',async t=>{
 const s=await started(t),a=s.observation;let reads=0;
 const clock={now:Date.now,wait:(ms,signal)=>new Promise((resolve,reject)=>{const timer=setTimeout(resolve,ms);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('cancelled'));},{once:true});}),timer:(ms,cb)=>{const timer=setTimeout(cb,ms);return()=>clearTimeout(timer);}};
 const evidence={schemaVersion:1,provider:'linkedin',accountSha256:hash(JSON.stringify(a.snapshot.identity)),packageSha256:snapshotHash(a.snapshot),bodySha256:a.snapshot.bodySha256,assetSha256:a.snapshot.assetSha256,providerObjectId:'urn:li:activity:918273646',publicUrl:'https://www.linkedin.com/feed/update/urn:li:activity:918273646/',publishedAtMs:Date.now(),observedAtMs:Date.now()+1,evidenceRef:'sha256:'+'d'.repeat(64)};
 const ports=new Map([['linkedin',{timeoutMs:1000,read:async(context,control)=>{assert.equal(await control.takeRequest(),true);reads++;return{kind:'FOUND',evidence:{...evidence,observedAtMs:Date.now()}};},verify:async(context,e)=>e}]]);
 const operation=createBrowserRecoveryOperation(ports,clock,async(r,e,outcome,signal)=>{const{leaseToken,...input}=a;await finalizeBrowserRecoverySubmission({...input,publicUrl:e.publicUrl,providerObjectId:e.providerObjectId,publishedAt:new Date(e.publishedAtMs).toISOString(),evidenceSha256:e.evidenceRef.slice(7)},r,signal,deps);return'finalized';},deps);
 const result=await markBrowserSubmissionUncertain({...s.send,attemptId:a.attemptId,reasonCode:'PROVIDER_RESULT_UNCERTAIN'},deps,undefined,operation);
 assert.equal(result.recovery.code,'RECONCILIATION_FOUND');assert.equal(reads,1);assert.equal(await db.publicationFact.count({where:{content_item_id:a.taskId}}),1);
});
test('migration delta preserves seeded pre-v2 attempt and enforces tenant FK, uniqueness and budget constraints',async()=>{
 const {Client}=require('pg'),{readFileSync}=require('node:fs');const client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();
 try{await client.query('BEGIN');
  await client.query('CREATE SCHEMA recovery_delta_synthetic');
  await client.query('CREATE TABLE recovery_delta_synthetic.delivery_attempts (id INTEGER NOT NULL,project_id INTEGER NOT NULL,status TEXT NOT NULL, UNIQUE(project_id,id))');
  await client.query("INSERT INTO recovery_delta_synthetic.delivery_attempts VALUES(19,23,'pending')");
  await client.query('CREATE TABLE recovery_delta_synthetic.publication_facts AS TABLE planner.publication_facts WITH NO DATA');
  await client.query('CREATE TABLE recovery_delta_synthetic.workflow_events AS TABLE planner.workflow_events WITH NO DATA');
  await client.query("INSERT INTO recovery_delta_synthetic.publication_facts(id,project_id,content_item_id,outcome,public_url) VALUES(37,23,29,'published','https://example.invalid/synthetic')");
  await client.query("INSERT INTO recovery_delta_synthetic.workflow_events(id,project_id,content_item_id,actor_id,command) VALUES(41,23,29,'user:43','synthetic_prior_history')");
  const priorFact=(await client.query('SELECT row_to_json(f) AS data FROM recovery_delta_synthetic.publication_facts f')).rows;
  const priorAudit=(await client.query('SELECT row_to_json(e) AS data FROM recovery_delta_synthetic.workflow_events e')).rows;
  const sql=readFileSync('/workspace/prisma/migrations/20261019010000_browser_delivery_recovery/migration.sql','utf8').replaceAll('"planner".','"recovery_delta_synthetic".');await client.query(sql);
  assert.equal((await client.query('SELECT status FROM recovery_delta_synthetic.delivery_attempts WHERE id=19')).rows[0].status,'pending');
  assert.equal((await client.query('SELECT count(*)::int AS n FROM recovery_delta_synthetic.browser_delivery_recovery')).rows[0].n,0);
  assert.deepEqual((await client.query('SELECT row_to_json(f) AS data FROM recovery_delta_synthetic.publication_facts f')).rows,priorFact);
  assert.deepEqual((await client.query('SELECT row_to_json(e) AS data FROM recovery_delta_synthetic.workflow_events e')).rows,priorAudit);
  const insert="INSERT INTO recovery_delta_synthetic.browser_delivery_recovery (project_id,content_item_id,attempt_id,work_item_id,package_sha256,approval_sha256,original_snapshot,stage,delivery_certainty,cause_code,recovery_action,updated_at) VALUES (23,29,19,31,'hash','hash','{}','PREPARE','UNKNOWN','LEGACY','NONE',now())";
  await client.query(insert);await client.query('SAVEPOINT duplicate');await assert.rejects(client.query(insert),e=>e.code==='23505');await client.query('ROLLBACK TO SAVEPOINT duplicate');
  await client.query('SAVEPOINT budget');await assert.rejects(client.query('UPDATE recovery_delta_synthetic.browser_delivery_recovery SET requests_used=21'),e=>e.code==='23514');await client.query('ROLLBACK TO SAVEPOINT budget');
  await client.query('SAVEPOINT tenant');await assert.rejects(client.query('UPDATE recovery_delta_synthetic.browser_delivery_recovery SET project_id=24'),e=>e.code==='23503');await client.query('ROLLBACK TO SAVEPOINT tenant');
 }finally{await client.query('ROLLBACK');await client.end();}
});
test('disabling new recovery admission cannot remove the hold on an existing v2 attempt',async t=>{
 const s=await state(t,true);process.env.BROWSER_RECOVERY_V2_ENABLED='false';
 try{await assert.rejects(preSubmitBrowserSubmission(s.observation,deps),/BROWSER_RECOVERY_V2_HELD/);}
 finally{process.env.BROWSER_RECOVERY_V2_ENABLED='true';}
});
test('persisted exact recovery status reaches scoped diagnose instead of legacy fallback',async t=>{
 const s=await state(t),a=s.observation;
 await db.browserDeliveryRecovery.update({where:{project_id_attempt_id:{project_id:a.projectId,attempt_id:a.attemptId}},data:{state:'held',cause_code:'RECONCILIATION_BUDGET_EXHAUSTED',recovery_action:'CONTACT_ENGINEERING'}});
 const {diagnoseBrowserPublication}=require(path.join(base,'services/browser_publication_diagnostics.js'));
 const result=await diagnoseBrowserPublication({projectId:a.projectId,taskId:a.taskId,actorId:a.actorId},deps);
 assert.equal(result.recovery.code,'RECONCILIATION_BUDGET_EXHAUSTED');assert.ok(!JSON.stringify(result).includes('PROVIDER_RESULT_UNCERTAIN'));
});
test('revoked release on an existing recovery row blocks provider lookup with precise action',async t=>{
 const s=await state(t),a=s.observation;let reads=0;
 const clock={now:Date.now,wait:async()=>{},timer:(ms,cb)=>{const timer=setTimeout(cb,ms);return()=>clearTimeout(timer);}};
 const operation=createBrowserRecoveryOperation(new Map([['linkedin',{timeoutMs:1000,read:async()=>{reads++;return{kind:'NOT_FOUND'};},verify:async()=>null}]]),clock,async()=>{throw Error('must not finalize');},deps);
 const task=await db.contentItem.findUnique({where:{id:a.taskId}});await db.contentItem.update({where:{id:a.taskId},data:{quality_report:{...task.quality_report,browser_release:{...task.quality_report.browser_release,publication_authorized:false}}}});
 const result=await operation({...s.send,attemptId:a.attemptId,reasonCode:'PROVIDER_RESULT_UNCERTAIN'});
 assert.equal(result.code,'APPROVAL_REVOKED');assert.equal(result.recoveryAction,'REVIEW_APPROVAL');assert.equal(reads,0);
 assert.equal((await current(s)).cause_code,'APPROVAL_REVOKED');
});
test('generic internal fact callback cannot bypass an admitted recovery hold',async t=>{
 const s=await state(t),a=s.observation,facts=require(path.join(base,'services/publication_fact.service.js')).default;
 await assert.rejects(facts.record({projectId:a.projectId,taskId:a.taskId,actorId:a.actorId,artifactKind:'post',outcome:'published',publishedAt:new Date().toISOString(),publicUrl:'https://www.linkedin.com/feed/update/urn:li:activity:918273647/',providerObjectId:'urn:li:activity:918273647',confirmationMode:'automatic',beforeWrite:async()=>{}}),/BROWSER_RECOVERY_V2_HELD/);
 assert.equal(await db.publicationFact.count({where:{content_item_id:a.taskId}}),0);
});
test('cancellation after the guarded beforeWrite still rolls back canonical fact at beforeCommit',async t=>{
 const s=await state(t),{r,input}=await completion(s),controller=new AbortController(),facts=require(path.join(base,'services/publication_fact.service.js')).default;
 const write=args=>facts.record({...args,beforeWrite:async tx=>{await args.beforeWrite(tx);controller.abort();}});
 await assert.rejects(finalizeBrowserRecoverySubmission(input,r,controller.signal,deps,write),/RECOVERY_CANCELLED/);
 assert.equal(await db.publicationFact.count({where:{content_item_id:s.scope.taskId}}),0);assert.equal((await current(s)).state,'reading');
 assert.equal((await db.deliveryAttempt.findUnique({where:{id:s.scope.attemptId}})).status,'pending');
});
test('two pre-permit resumptions cannot rotate two generations or create another attempt',async t=>{
 const s=await state(t,true),a=s.observation,port=createBrowserRecoveryResumePort(deps,proof),args={projectId:a.projectId,taskId:a.taskId,attemptId:a.attemptId,actorId:a.actorId};
 const results=await Promise.allSettled([resumeBrowserRecovery({...args,idempotencyKey:'race-a'},port),resumeBrowserRecovery({...args,idempotencyKey:'race-b'},port)]);
 assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.resumed).length,1);
 assert.equal((await current(s)).execution_generation,1);assert.equal(await db.deliveryAttempt.count({where:{content_item_id:a.taskId}}),1);
 assert.equal(await db.workflowEvent.count({where:{project_id:a.projectId,command:'ba_resume_browser_recovery'}}),1);
});
test('owner revocation after beforeWrite prevents canonical commit and rolls back all changes',async t=>{
 const s=await state(t),{r,input}=await completion(s),facts=require(path.join(base,'services/publication_fact.service.js')).default;
 const write=args=>facts.record({...args,beforeWrite:async tx=>{await args.beforeWrite(tx);await tx.projectMember.updateMany({where:{project_id:s.scope.projectId,user_id:s.user.id},data:{role:'editor'}});}});
 await assert.rejects(finalizeBrowserRecoverySubmission(input,r,new AbortController().signal,deps,write),/OWNER/);
 assert.equal(await db.publicationFact.count({where:{content_item_id:s.scope.taskId}}),0);assert.equal((await current(s)).state,'reading');
 assert.equal((await db.projectMember.findUnique({where:{project_id_user_id:{project_id:s.scope.projectId,user_id:s.user.id}}})).role,'owner');
});
test('repeated recovery preserves immutable lookup window, original deadline and exact held permission action',async t=>{
 const s=await started(t),a=s.observation;let reads=0,now=Date.now();
 const clock={now:()=>now,wait:async()=>{},timer:(ms,cb)=>{const timer=setTimeout(cb,ms);return()=>clearTimeout(timer);}};
 const ports=new Map([['linkedin',{timeoutMs:1000,read:async(context,control)=>{assert.equal(await control.takeRequest(),true);reads++;return{kind:'PERMISSION_DENIED'};},verify:async()=>null}]]);
 const operation=createBrowserRecoveryOperation(ports,clock,async()=>{throw Error('must not finalize');},deps),input={...s.send,attemptId:a.attemptId,reasonCode:'PROVIDER_RESULT_UNCERTAIN'};
 await db.deliveryAttempt.update({where:{id:a.attemptId},data:{error_message:'PROVIDER_RESULT_UNCERTAIN'}});
 assert.equal((await operation(input)).code,'PERMISSION_DENIED');
 const before=await db.browserDeliveryRecovery.findUnique({where:{project_id_attempt_id:{project_id:a.projectId,attempt_id:a.attemptId}}});now+=10000;
 const replay=await operation(input);assert.equal(replay.code,'PERMISSION_DENIED');assert.equal(replay.recoveryAction,'RESTORE_PERMISSION');assert.equal(reads,1);
 const after=await db.browserDeliveryRecovery.findUnique({where:{project_id_attempt_id:{project_id:a.projectId,attempt_id:a.attemptId}}});
 assert.equal(after.lookup_window_end_at.getTime(),before.lookup_window_end_at.getTime());assert.equal(after.deadline_at.getTime(),before.deadline_at.getTime());
});

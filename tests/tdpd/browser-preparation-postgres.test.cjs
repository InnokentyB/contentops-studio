const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist';
const {setup,deps,db,pool}=require('./browser-recovery.fixture.cjs');
const {body,sha}=require('./shared-browser.fixture.cjs');
const release=require(path.join(base,'services/browser_publication_release.js'));
const execution=require(path.join(base,'services/browser_publication_execution.js'));
const {createPreparationRecovery}=require(path.join(base,'services/browser_preparation_recovery.js'));
const {createBrowserRecoveryResumePort}=require(path.join(base,'services/browser_recovery_resume_repository.js'));
process.env.BROWSER_RECOVERY_V2_ENABLED='true';test.after(async()=>{await db.$disconnect();await pool.end();});
async function scenario(t,override={}){
 const s=await setup(t),released=await release.releaseBrowserPublication(s.args,deps),workItemId=released.browser_work_item_id;
 const claim=await execution.claimBrowserPublication({...s.args,workItemId,idempotencyKey:'claim'},deps);
 let acks=0;
 const supervisor={executorId:'synthetic-supervised-executor',supports:()=>true,quiesce:async a=>{acks++;return{executorId:'synthetic-supervised-executor',generation:a.generation,challengeSha256:sha(a.challenge),oldExecutorQuiescent:true,evidenceRef:'sha256:'+'c'.repeat(64),failureKind:'EXECUTOR_RESTART'};},...override};
 const service=createPreparationRecovery({deps,supervisor}),send={...s.args,apply:false,workItemId,leaseToken:claim.lease_token,idempotencyKey:'original-publication'};
 const started=await service.start(send),attemptId=started.attempt_id;
 const observation={...send,attemptId,observedProfileUrl:s.args.snapshot.identity.profileUrl,observedProviderAccountId:s.args.snapshot.identity.providerAccountId,observedAccountType:s.args.snapshot.identity.accountType,observedBodySha256:sha(body),observedAssetSha256:s.args.snapshot.assetSha256,paragraphBlockSha256:body.split(/\n\s*\n/).map(p=>sha(p.trim())),attachedImageCount:1,duplicateAbsent:true,evidenceSha256:'d'.repeat(64)};
 const request={projectId:send.projectId,taskId:send.taskId,attemptId,actorId:send.actorId,idempotencyKey:'technical-recovery-1'};
 return {...s,send,observation,attemptId,service,request,supervisor,acks:()=>acks};
}
const ledger=s=>db.browserPreparationExecution.findUnique({where:{project_id_attempt_id:{project_id:s.request.projectId,attempt_id:s.attemptId}}});
const recovery=s=>db.browserDeliveryRecovery.findUnique({where:{project_id_attempt_id:{project_id:s.request.projectId,attempt_id:s.attemptId}}});
test('PREP-01 original admitted start creates protected PREPARE ownership and no submit permission',async t=>{
 const s=await scenario(t);assert.equal((await recovery(s)).stage,'PREPARE');assert.equal((await ledger(s)).ledger.generation,0);
 assert.equal(await db.deliveryAttempt.count({where:{content_item_id:s.send.taskId}}),1);assert.equal(await db.workflowEvent.count({where:{project_id:s.send.projectId,command:'ba_pre_submit_browser_submission'}}),0);
 await assert.rejects(execution.preSubmitBrowserSubmission(s.observation,deps),/BROWSER_RECOVERY_V2_HELD/);
});
test('PREP-02/03 original attempt resumes into durable pickup after restart, old executor cannot permit/dispatch',async t=>{
 const s=await scenario(t),result=await s.service.recover(s.request);assert.equal(result.resumed,true);assert.equal(result.generation,1);assert.equal(s.acks(),1);
 const row=await ledger(s);assert.equal(row.ledger.outbox,'pending');assert.equal(row.ledger.state,'queued');assert.equal((await db.deliveryAttempt.findUnique({where:{id:s.attemptId}})).error_message,'EXECUTOR_RESTART');
 const restarted=createPreparationRecovery({deps,supervisor:s.supervisor}),replay=await restarted.recover(s.request);assert.equal(replay.replayed,true);assert.equal(replay.generation,1);assert.equal(s.acks(),1);
 const pickup=await restarted.pickup({...s.request,generation:1}),again=await restarted.pickup({...s.request,generation:1});assert.equal(pickup.leaseToken,again.leaseToken);assert.notEqual(pickup.leaseToken,s.send.leaseToken);assert.equal(pickup.submission_permitted,false);
 await assert.rejects(restarted.preSubmit(s.observation,0),/RECOVERY_CONFLICT/);
 let sent=0;await assert.rejects(restarted.dispatch(s.observation,0,async()=>{sent++;}),/POST_SUBMIT_UNKNOWN/);assert.equal(sent,0);
 assert.equal(await db.deliveryAttempt.count({where:{content_item_id:s.send.taskId}}),1);
 assert.equal(JSON.stringify(result).includes(pickup.leaseToken),false);
});
test('PREP-05 first permit is one-shot, dispatch once, and canonical result completes the same attempt',async t=>{
 const s=await scenario(t);await s.service.recover(s.request);const pickup=await s.service.pickup({...s.request,generation:1}),observed={...s.observation,leaseToken:pickup.leaseToken};
 const permit=await s.service.preSubmit(observed,1);assert.equal(permit.submission_permitted,true);
 let sent=0;await s.service.dispatch(observed,1,async()=>{sent++;});await assert.rejects(s.service.dispatch(observed,1,async()=>{sent++;}),/POST_SUBMIT_UNKNOWN/);assert.equal(sent,1);
 const resumed=await s.service.recover({...s.request,idempotencyKey:'different-recovery'});assert.equal(resumed.resumed,false);assert.equal(resumed.code,'POST_SUBMIT_UNKNOWN');
 const {leaseToken,...withoutLease}=observed;
 await s.service.confirm({...withoutLease,publicUrl:'https://www.linkedin.com/feed/update/urn:li:share:2468/',providerObjectId:'urn:li:share:2468',publishedAt:new Date().toISOString()},1);
 assert.equal(await db.publicationFact.count({where:{content_item_id:s.send.taskId}}),1);assert.equal((await db.deliveryAttempt.findUnique({where:{id:s.attemptId}})).status,'delivered');assert.equal((await ledger(s)).ledger.state,'complete');
});
test('PREP-06 concurrent recoverers produce at most one durable generation and pickup',async t=>{
 const s=await scenario(t),results=await Promise.all([s.service.recover(s.request),s.service.recover({...s.request,idempotencyKey:'racing-other-recoverer'})]);
 assert.equal(results.filter(r=>r.resumed===true).length,1);assert.equal((await recovery(s)).execution_generation,1);assert.equal((await ledger(s)).ledger.outbox,'pending');
 assert.equal(await db.workflowEvent.count({where:{project_id:s.send.projectId,command:'ba_resume_browser_recovery'}}),1);
});
test('PREP-04 bad supervisor proof leaves original attempt held and cannot issue a permit',async t=>{
 const s=await scenario(t,{quiesce:async a=>({executorId:'synthetic-supervised-executor',generation:a.generation,challengeSha256:'f'.repeat(64),oldExecutorQuiescent:true,evidenceRef:'sha256:'+'c'.repeat(64),failureKind:'EXECUTOR_RESTART'})});
 const result=await s.service.recover(s.request);assert.equal(result.code,'PRE_DISPATCH_PROOF_UNAVAILABLE');assert.equal((await recovery(s)).execution_generation,0);assert.equal((await ledger(s)).ledger.state,'quiescing');
 await assert.rejects(s.service.preSubmit(s.observation,0),/RECOVERY_CONFLICT/);
});
test('PREP-07 revoked approval denies before supervisor or lease mutation',async t=>{
 const s=await scenario(t),task=await db.contentItem.findUnique({where:{id:s.send.taskId}}),quality=task.quality_report;quality.browser_release.publication_authorized=false;await db.contentItem.update({where:{id:s.send.taskId},data:{quality_report:quality}});
 const result=await s.service.recover(s.request);assert.equal(result.code,'APPROVAL_REVOKED');assert.equal(s.acks(),0);assert.equal((await recovery(s)).execution_generation,0);
});
test('PREP-08 expiry survives application restart and cannot reset durable budget',async t=>{
 const s=await scenario(t);await s.service.recover(s.request);const stored=await ledger(s);const restarted=createPreparationRecovery({deps,supervisor:s.supervisor,now:()=>stored.ledger.deadlineMs+1});
 const result=await restarted.recover({...s.request,idempotencyKey:'after-deadline'});assert.equal(result.code,'RECONCILIATION_BUDGET_EXHAUSTED');assert.equal(s.acks(),1);assert.equal((await ledger(s)).ledger.resumptions,1);
});
test('PREP-09 generic settings cannot forge protected execution proof or counters',async t=>{
 const s=await scenario(t),before=await ledger(s);await db.projectSettings.create({data:{project_id:s.send.projectId,key:`browser_preparation:v1:${s.attemptId}`,value:JSON.stringify({...before.ledger,state:'quiescent',proofSha256:'f'.repeat(64),resumptions:0})}});
 const port=createBrowserRecoveryResumePort(deps);const proof=await port.transaction(tx=>tx.preparationProof(s.request,s.supervisor.executorId));assert.equal(proof.state,'preparing');assert.equal(proof.proofSha256,null);assert.deepEqual((await ledger(s)).ledger,before.ledger);
});
test('PREP-08 three resumptions use durable offsets and never reset counters with a new key',async t=>{
 const s=await scenario(t);let clock=Date.now();const service=createPreparationRecovery({deps,supervisor:s.supervisor,now:()=>clock});
 assert.equal((await service.recover(s.request)).resumed,true);
 const early=await service.recover({...s.request,idempotencyKey:'second'});assert.equal(early.code,'RECOVERY_IN_PROGRESS');assert.equal(s.acks(),1);
 clock+=30001;assert.equal((await service.recover({...s.request,idempotencyKey:'second'})).resumed,true);
 clock+=90000;assert.equal((await service.recover({...s.request,idempotencyKey:'third'})).resumed,true);
 const exhausted=await service.recover({...s.request,idempotencyKey:'fourth'});assert.equal(exhausted.code,'RECONCILIATION_BUDGET_EXHAUSTED');assert.equal(s.acks(),3);assert.equal((await ledger(s)).ledger.resumptions,3);
});
test('PREP-05 an already issued generic permit event prevents quiescence and resume',async t=>{
 const s=await scenario(t);await db.workflowEvent.create({data:{project_id:s.send.projectId,content_item_id:s.send.taskId,work_item_id:s.send.workItemId,actor_id:s.send.actorId,command:'ba_pre_submit_browser_submission',after_state:{submission_permitted:true}}});
 const result=await s.service.recover(s.request);assert.equal(result.code,'POST_SUBMIT_UNKNOWN');assert.equal(s.acks(),0);assert.equal((await recovery(s)).execution_generation,0);
});
test('PREP-07 cross-tenant and non-owner cannot request supervisor quiescence',async t=>{
 const s=await scenario(t);for(const input of [{...s.request,actorId:'user:999999999'},{...s.request,projectId:s.request.projectId+9999999}]){const result=await s.service.recover(input);assert.equal(result.resumed,false);assert.equal(s.acks(),0);}assert.equal((await recovery(s)).execution_generation,0);
});
test('PREP-06 simultaneous private pickups deliver the same lease, without additional authority',async t=>{
 const s=await scenario(t);await s.service.recover(s.request);const results=await Promise.allSettled([s.service.pickup({...s.request,generation:1}),s.service.pickup({...s.request,generation:1})]);const fulfilled=results.filter(r=>r.status==='fulfilled').map(r=>r.value);assert.ok(fulfilled.length>=1);assert.ok(fulfilled.every(p=>p.leaseToken===fulfilled[0].leaseToken&&p.submission_permitted===false));assert.equal(await db.workflowEvent.count({where:{project_id:s.send.projectId,command:'browser_preparation_pickup'}}),1);
});
test('PREP-04 missing real supervisor never admits an otherwise ordinary original start',async t=>{
 const s=await setup(t),r=await release.releaseBrowserPublication(s.args,deps),workItemId=r.browser_work_item_id,claim=await execution.claimBrowserPublication({...s.args,workItemId,idempotencyKey:'claim'},deps),service=createPreparationRecovery({deps});
 const result=await service.start({...s.args,workItemId,leaseToken:claim.lease_token,idempotencyKey:'original'});assert.equal(result.submission_permitted,false);assert.equal(await db.browserPreparationExecution.count({where:{project_id:s.args.projectId}}),0);assert.equal(await db.browserDeliveryRecovery.count({where:{project_id:s.args.projectId}}),0);
});
test('PREP-06 first permit racing quiescence can never grant both a permit and resumed generation',async t=>{
 const s=await scenario(t),results=await Promise.allSettled([s.service.preSubmit(s.observation,0),s.service.recover(s.request)]);
 const permit=results[0].status==='fulfilled'&&results[0].value.submission_permitted===true,resumed=results[1].status==='fulfilled'&&results[1].value.resumed===true;
 assert.equal(permit&&resumed,false);assert.ok(permit||resumed);assert.equal(await db.deliveryAttempt.count({where:{content_item_id:s.send.taskId}}),1);
});
test('PREP-10 actual MCP owning operation resumes with actionable status and never exposes private pickup lease',async t=>{
 const s=await scenario(t),handlers=new Map(),server={registerTool(name,_configuration,handler){handlers.set(name,handler);}};
 require(path.join(base,'mcp/tools/browser_publication_tools.js')).registerBrowserPublicationTools(server,undefined,s.service);
 const result=await handlers.get('ba_mark_browser_submission_uncertain')({...s.send,attemptId:s.attemptId,reasonCode:'BROWSER_UNAVAILABLE'}),serialized=JSON.stringify(result),work=await db.workItem.findUnique({where:{id:s.send.workItemId}});
 assert.ok(serialized.includes('RECOVERY_PREPARE_RESUMED'));assert.ok(serialized.includes('action'));assert.equal(serialized.includes(work.lease_token),false);assert.equal(serialized.includes(s.send.approvalReference),false);assert.equal((await recovery(s)).execution_generation,1);
});
test('PREP-05 dispatch failure preserves uncertain one-shot authority and hides raw provider error',async t=>{
 const s=await scenario(t);await s.service.recover(s.request);const pickup=await s.service.pickup({...s.request,generation:1}),observed={...s.observation,leaseToken:pickup.leaseToken};await s.service.preSubmit(observed,1);let sends=0;
 await assert.rejects(s.service.dispatch(observed,1,async()=>{sends++;throw Error('private-provider-token');}),error=>/POST_SUBMIT_UNKNOWN/.test(error.message)&&!error.message.includes('private'));
 await assert.rejects(s.service.dispatch(observed,1,async()=>{sends++;}),/POST_SUBMIT_UNKNOWN/);assert.equal(sends,1);
 const result=await s.service.operation({...s.send,leaseToken:pickup.leaseToken,attemptId:s.attemptId,reasonCode:'PROVIDER_RESULT_UNCERTAIN'});assert.equal(result.recovery.code,'READBACK_CAPABILITY_UNAVAILABLE');assert.equal((await recovery(s)).delivery_certainty,'UNKNOWN');assert.equal(await db.publicationFact.count({where:{content_item_id:s.send.taskId}}),0);
});
test('PREP-01 normal admitted original attempt can complete without manufacturing a preparation failure',async t=>{
 const s=await scenario(t);assert.equal((await s.service.preSubmit(s.observation,0)).submission_permitted,true);await s.service.dispatch(s.observation,0,async()=>undefined);
 const {leaseToken,...input}=s.observation;await s.service.confirm({...input,publicUrl:'https://www.linkedin.com/feed/update/urn:li:share:2469/',providerObjectId:'urn:li:share:2469',publishedAt:new Date().toISOString()},0);
 assert.equal((await db.deliveryAttempt.findUnique({where:{id:s.attemptId}})).status,'delivered');assert.equal((await ledger(s)).ledger.resumptions,0);assert.equal((await ledger(s)).ledger.state,'complete');assert.equal(await db.workflowEvent.count({where:{project_id:s.send.projectId,command:'browser_preparation_quiescent'}}),0);
});
test('PREP-04 supervisor timeout cannot commit a late acknowledgement or create pickup authority',async t=>{
 let aborted=false;const s=await scenario(t,{quiesce:async a=>new Promise(resolve=>a.signal.addEventListener('abort',()=>{aborted=true;resolve({executorId:'synthetic-supervised-executor',generation:a.generation,challengeSha256:sha(a.challenge),oldExecutorQuiescent:true,evidenceRef:'sha256:'+'c'.repeat(64),failureKind:'EXECUTOR_RESTART'});},{once:true}))});
 const started=Date.now(),result=await s.service.recover(s.request);assert.equal(result.code,'PRE_DISPATCH_PROOF_UNAVAILABLE');assert.equal(aborted,true);assert.ok(Date.now()-started<12000);assert.equal((await recovery(s)).execution_generation,0);assert.equal((await ledger(s)).ledger.outbox,'none');
});
test('PREP-08 uncertainty replay preserves an active readback lease and original durable deadline',async t=>{
 const s=await scenario(t);await s.service.recover(s.request);const pickup=await s.service.pickup({...s.request,generation:1}),observed={...s.observation,leaseToken:pickup.leaseToken};await s.service.preSubmit(observed,1);await s.service.dispatch(observed,1,async()=>undefined);
 const args={...s.send,leaseToken:pickup.leaseToken,attemptId:s.attemptId,reasonCode:'PROVIDER_RESULT_UNCERTAIN'},repository=require(path.join(base,'services/browser_recovery_repository.js')).createBrowserRecoveryRepository(deps,s.send.actorId),outcome=require(path.join(base,'services/browser_recovery_coordinator.js')).recoveryOutcome;
 await s.service.operation(args,async()=>{const r=await repository.reserve({projectId:s.send.projectId,taskId:s.send.taskId,attemptId:s.attemptId,packageSha256:sha(JSON.stringify(s.send.snapshot))},Date.now());assert.equal(r.kind,'reserved');return outcome('RECONCILIATION_TEMPORARILY_UNAVAILABLE');});
 const before=await recovery(s);await s.service.operation(args,async()=>outcome('RECOVERY_IN_PROGRESS'));const after=await recovery(s);
 for(const key of ['state','row_version','recovery_lease_sha256','rounds','requests_used'])assert.equal(after[key],before[key]);for(const key of ['started_at','deadline_at','recovery_lease_expires_at'])assert.equal(after[key].getTime(),before[key].getTime());assert.equal(after.state,'reading');
});
test('PREP-05 canonical result failure rolls back ledger completion, attempt, fact and recovery together',async t=>{
 const s=await scenario(t);await s.service.recover(s.request);const pickup=await s.service.pickup({...s.request,generation:1}),observed={...s.observation,leaseToken:pickup.leaseToken};await s.service.preSubmit(observed,1);await s.service.dispatch(observed,1,async()=>undefined);
 const service=require(path.join(base,'services/publication_fact.service.js')).default,original=service.record;
 service.record=function(args){return original.call(service,{...args,beforeWrite:tx=>args.beforeWrite(new Proxy(tx,{get(target,key){if(key==='browserPreparationExecution')return {...target.browserPreparationExecution,updateMany:async value=>{await target.browserPreparationExecution.updateMany(value);throw Error('synthetic-ledger-completion-unavailable');}};return target[key];}}))});};
 try{const{leaseToken,...input}=observed;await assert.rejects(s.service.confirm({...input,publicUrl:'https://www.linkedin.com/feed/update/urn:li:share:2470/',providerObjectId:'urn:li:share:2470',publishedAt:new Date().toISOString()},1),/synthetic-ledger-completion/);}finally{service.record=original;}
 assert.equal((await ledger(s)).ledger.state,'awaiting_result');assert.equal((await db.deliveryAttempt.findUnique({where:{id:s.attemptId}})).status,'pending');assert.equal(await db.publicationFact.count({where:{content_item_id:s.send.taskId}}),0);assert.equal((await recovery(s)).state,'reading');
});
test('PREP-03 queued recovery replay reports proven pre-dispatch state without rerunning supervisor',async t=>{
 const s=await scenario(t),args={...s.send,attemptId:s.attemptId,reasonCode:'BROWSER_UNAVAILABLE'};await s.service.operation(args);const response=await s.service.operation(args);
 assert.equal(response.recovery.code,'RECOVERY_PREPARE_RESUMED');assert.equal(response.recovery.deliveryCertainty,'NOT_DISPATCHED');assert.equal(response.recovery.recoveryAction,'CONTINUE_SAME_ATTEMPT_AFTER_REPAIR');assert.equal(s.acks(),1);assert.equal((await recovery(s)).execution_generation,1);
});
test('PREP-05 owning uncertainty operation FOUND atomically completes protected ledger via shared finalizer',async t=>{
 const s=await scenario(t);await s.service.recover(s.request);const pickup=await s.service.pickup({...s.request,generation:1}),observed={...s.observation,leaseToken:pickup.leaseToken};await s.service.preSubmit(observed,1);await s.service.dispatch(observed,1,async()=>undefined);
 const publishedAt=Date.now(),{leaseToken,...confirmation}=observed;
 const clock={now:Date.now,wait:async()=>undefined,timer:(ms,cb)=>{const id=setTimeout(cb,ms);return()=>clearTimeout(id);}};
 const evidence={schemaVersion:1,provider:'linkedin',accountSha256:sha(JSON.stringify(s.send.snapshot.identity)),packageSha256:sha(JSON.stringify(s.send.snapshot)),bodySha256:s.send.snapshot.bodySha256,assetSha256:s.send.snapshot.assetSha256,providerObjectId:'urn:li:share:2471',publicUrl:'https://www.linkedin.com/feed/update/urn:li:share:2471/',publishedAtMs:publishedAt,observedAtMs:publishedAt,evidenceRef:'sha256:'+'d'.repeat(64)};
 const reader=require(path.join(base,'services/browser_recovery_runtime.js')).createBrowserRecoveryOperation(new Map([['linkedin',{timeoutMs:1000,read:async(_context,control)=>{assert.equal(await control.takeRequest(),true);return{kind:'FOUND',evidence:{...evidence,observedAtMs:Date.now()}};},verify:async(_context,e)=>e}]]),clock,async(r,e,_outcome,signal)=>{await require(path.join(base,'services/browser_publication_confirmation.js')).finalizeBrowserRecoverySubmission({...confirmation,publicUrl:e.publicUrl,providerObjectId:e.providerObjectId,publishedAt:new Date(e.publishedAtMs).toISOString(),evidenceSha256:e.evidenceRef.slice(7)},r,signal,deps);return'finalized';},deps);
 const result=await s.service.operation({...s.send,leaseToken:pickup.leaseToken,attemptId:s.attemptId,reasonCode:'PROVIDER_RESULT_UNCERTAIN'},reader);
 assert.equal(result.recovery.code,'RECONCILIATION_FOUND');assert.equal((await ledger(s)).ledger.state,'complete');assert.equal((await recovery(s)).state,'finalized');assert.equal(await db.publicationFact.count({where:{content_item_id:s.send.taskId}}),1);assert.equal((await db.deliveryAttempt.findUnique({where:{id:s.attemptId}})).status,'delivered');
});
test('PREP-01 protected storage discovery preserves old recovery when additive table is absent',async()=>{
 const helper=require(path.join(base,'services/browser_preparation_finalization.js')).completePreparationAfterFinalization;
 await db.$transaction(async tx=>{
  await tx.$executeRaw`ALTER TABLE planner.browser_preparation_execution RENAME TO browser_preparation_execution_synthetic_absent`;
  try{await helper(tx,{scope:{projectId:1,taskId:2,attemptId:3,packageSha256:'a'.repeat(64)},rowVersion:0,executionGeneration:0,leaseToken:'synthetic-not-used',startedAtMs:Date.now(),deadlineMs:Date.now()+180000,round:1,requestsUsed:0});}finally{await tx.$executeRaw`ALTER TABLE planner.browser_preparation_execution_synthetic_absent RENAME TO browser_preparation_execution`;}
 });
});

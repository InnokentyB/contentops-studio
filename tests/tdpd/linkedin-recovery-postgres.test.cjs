const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const base=process.env.SHARED_BROWSER_DIST||'/opt/planner/dist';
const {started,deps,db,pool}=require('./browser-recovery.fixture.cjs');
const {hash}=require(path.join(base,'services/browser_publication_contract.js'));
const {createPublicationRecoveryApplication}=require(path.join(base,'services/browser_recovery_application.js'));
const {markBrowserSubmissionUncertain}=require(path.join(base,'services/browser_publication_execution.js'));
process.env.BROWSER_RECOVERY_V2_ENABLED='true';
test.after(async()=>{await db.$disconnect();await pool.end();});
function operation(s,overrides={},onRead=async()=>{}){
 const a=s.observation,author=`urn:li:organization:${a.snapshot.identity.providerAccountId}`;
 const scope={projectId:a.projectId,taskId:a.taskId,attemptId:a.attemptId,packageSha256:hash(JSON.stringify(a.snapshot))};
 let reads=0;
 const binding={route:'linkedin_api',readAdmission:true,authorUrn:author,accountSha256:hash(JSON.stringify(a.snapshot.identity)),accessToken:'synthetic-only',apiVersion:'202610',permissions:['r_organization_social'],receipt:{scope,accountSha256:hash(JSON.stringify(a.snapshot.identity)),objectId:'urn:li:share:123',source:'admitted_executor_receipt',media:{providerMediaId:'urn:li:image:synthetic',assetSha256:a.snapshot.assetSha256}},...overrides};
 const publishedAt=Date.now();
 return{get reads(){return reads;},operation:createPublicationRecoveryApplication({deps,linkedin:{resolve:async()=>binding,fetch:async()=>{reads++;await onRead(reads);return new Response(JSON.stringify({id:'urn:li:share:123',author,commentary:s.task.draft_text,lifecycleState:'PUBLISHED',publishedAt,visibility:'PUBLIC',distribution:{feedDistribution:'MAIN_FEED'},content:{media:{id:'urn:li:image:synthetic'}}}));}}})};
}
test('LI-01 actual owning uncertainty operation verifies API twice and commits one original attempt/fact',async t=>{
 const s=await started(t),h=operation(s),a=s.observation;
 const result=await markBrowserSubmissionUncertain({...s.send,attemptId:a.attemptId,reasonCode:'PROVIDER_RESULT_UNCERTAIN'},deps,undefined,h.operation);
 assert.equal(result.recovery.code,'RECONCILIATION_FOUND');assert.equal(h.reads,2);
 assert.equal(await db.deliveryAttempt.count({where:{content_item_id:a.taskId}}),1);
 const attempt=await db.deliveryAttempt.findUnique({where:{id:a.attemptId}});assert.equal(attempt.status,'delivered');
 const fact=await db.publicationFact.findUnique({where:{content_item_id:a.taskId}});assert.equal(fact.provider_object_id,'urn:li:share:123');assert.equal(fact.evidence_type,'api');
 assert.equal(await db.workflowEvent.count({where:{project_id:a.projectId,command:'ba_pre_submit_browser_submission'}}),0);
});
test('LI-04 actual owning operation keeps denied read UNKNOWN with zero provider calls/facts',async t=>{
 const s=await started(t),h=operation(s,{permissions:[]}),a=s.observation;
 const result=await markBrowserSubmissionUncertain({...s.send,attemptId:a.attemptId,reasonCode:'PROVIDER_RESULT_UNCERTAIN'},deps,undefined,h.operation);
 assert.equal(result.recovery.code,'PERMISSION_DENIED');assert.equal(h.reads,0);
 assert.equal(await db.publicationFact.count({where:{content_item_id:a.taskId}}),0);
 assert.equal((await db.deliveryAttempt.findUnique({where:{id:a.attemptId}})).error_message,'PROVIDER_RESULT_UNCERTAIN');
});

test('LI-03 approval revoked during provider verification rolls back attempted finalization',async t=>{
 const s=await started(t),a=s.observation,h=operation(s,{},async n=>{if(n!==2)return;const task=await db.contentItem.findUnique({where:{id:a.taskId}});const quality=task.quality_report;quality.browser_release.publication_authorized=false;await db.contentItem.update({where:{id:a.taskId},data:{quality_report:quality}});});
 const result=await markBrowserSubmissionUncertain({...s.send,attemptId:a.attemptId,reasonCode:'PROVIDER_RESULT_UNCERTAIN'},deps,undefined,h.operation);
 assert.equal(result.recovery.code,'APPROVAL_REVOKED');assert.equal(h.reads,2);assert.equal(await db.publicationFact.count({where:{content_item_id:a.taskId}}),0);
 const recovery=await db.browserDeliveryRecovery.findUnique({where:{project_id_attempt_id:{project_id:a.projectId,attempt_id:a.attemptId}}});assert.equal(recovery.state,'held');assert.equal(recovery.delivery_certainty,'UNKNOWN');
 assert.equal((await db.deliveryAttempt.findUnique({where:{id:a.attemptId}})).status,'pending');
});
test('LI-07 abort after verified beforeWrite rolls back fact, attempt and recovery together',async t=>{
 const s=await started(t),a=s.observation;
 await markBrowserSubmissionUncertain({...s.send,attemptId:a.attemptId,reasonCode:'PROVIDER_RESULT_UNCERTAIN'},deps);
 const scope={projectId:a.projectId,taskId:a.taskId,attemptId:a.attemptId,packageSha256:hash(JSON.stringify(a.snapshot))},now=Date.now();
 await db.browserDeliveryRecovery.create({data:{project_id:a.projectId,content_item_id:a.taskId,attempt_id:a.attemptId,work_item_id:a.workItemId,package_sha256:scope.packageSha256,approval_sha256:hash(a.approvalReference),original_snapshot:a.snapshot,stage:'RECONCILING',delivery_certainty:'UNKNOWN',cause_code:'POST_SUBMIT_UNKNOWN',recovery_action:'READ_ONLY_RECONCILIATION',lookup_window_start_at:new Date(now-120000),lookup_window_end_at:new Date(now+30000)}});
 const repository=require(path.join(base,'services/browser_recovery_repository.js')).createBrowserRecoveryRepository(deps,a.actorId),reservation=await repository.reserve(scope,now);assert.equal(reservation.kind,'reserved');
 const evidence={schemaVersion:1,provider:'linkedin',accountSha256:hash(JSON.stringify(a.snapshot.identity)),packageSha256:scope.packageSha256,bodySha256:a.snapshot.bodySha256,assetSha256:a.snapshot.assetSha256,providerObjectId:'urn:li:share:123',publicUrl:'https://www.linkedin.com/feed/update/urn:li:share:123/',publishedAtMs:now,observedAtMs:now,evidenceRef:'sha256:'+'d'.repeat(64)};
 const controller=new AbortController(),factService=require(path.join(base,'services/publication_fact.service.js')).default;
 const write=args=>factService.record({...args,beforeWrite:async tx=>{await args.beforeWrite(tx);controller.abort();}});
 const finalize=require(path.join(base,'services/browser_recovery_verified_fact.js')).finalizeVerifiedBrowserRecovery;
 await assert.rejects(finalize({...s.send,attemptId:a.attemptId},reservation.reservation,evidence,controller.signal,deps,write),/RECOVERY_CANCELLED/);
 assert.equal(await db.publicationFact.count({where:{content_item_id:a.taskId}}),0);assert.equal((await db.deliveryAttempt.findUnique({where:{id:a.attemptId}})).status,'pending');assert.equal((await db.browserDeliveryRecovery.findUnique({where:{project_id_attempt_id:{project_id:a.projectId,attempt_id:a.attemptId}}})).state,'reading');
});

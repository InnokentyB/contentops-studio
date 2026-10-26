import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {hash,object,type BrowserDependencies} from './browser_publication_contract';
import {requireTerminalPrincipal} from './browser_terminal_principal';
import {terminalReviewIssue,terminalReviewedRequest,terminalLocalObservation,terminalProgramHashSchema} from './browser_terminal_review_contract';
import {loadLegacyBrowserScope} from './legacy_browser_recovery_scope';
import {preparationSerial} from './browser_preparation_storage';
import {checkTerminalMetadata,terminalEvidenceSummary} from './browser_terminal_evidence_verifier';
import {requireNonDemoBrowserOwner} from './browser_recovery_owner';
import {browserRecoveryEnabled} from './browser_recovery_guard';
const issueCommand='browser_terminal_evidence_review_requested',intakeCommand='browser_terminal_execution_evidence';
const issued=z.object({nonce_sha256:z.string(),package_sha256:z.string(),approval_sha256:z.string(),publisher_actor_sha256:z.string(),old_lease_sha256:z.string(),original_key_sha256:z.string(),attempt_id:z.number(),started_at_ms:z.number(),deadline_ms:z.number()}).strict();
/** Actual packaged files, not a caller-selected verifier registration or a fixed business digest. */
export function terminalProgramHashes(){
 const files={collector:'../../ops/original-terminal-source/collect.cjs',producer:'../../ops/terminal-operation-review/review.cjs',semantics:'browser_terminal_source_semantics.js',document:'browser_terminal_source_document.js',shape:'browser_terminal_source_shape.js',external:'browser_terminal_external_shape.js',native:'../../ops/terminal-operation-review/native.cjs',census:'../../ops/terminal-external-census-20261026/census.cjs'};
 return terminalProgramHashSchema.parse(Object.fromEntries(Object.entries(files).map(([name,file])=>[name,hash(readFileSync(join(__dirname,file),'utf8'))])));
}
/** Authenticated Owner-controlled native receipt review. This explicitly does not claim a native-signed stop/drain ACK. */
export function createTerminalOwnerReview(deps:BrowserDependencies,now:()=>number){
 function targetBinding(loaded:Awaited<ReturnType<typeof loadLegacyBrowserScope>>){
  if(!loaded.work.lease_actor_id||!/^user:[1-9]\d*$/.test(loaded.work.lease_actor_id))throw new Error('[TERMINAL_ORIGINAL_PUBLISHER_REQUIRED]');
  const sorted=(value:object)=>Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0));
  const snapshot=loaded.request.snapshot,canonical=sorted({...snapshot,identity:sorted(snapshot.identity)});
  return {projectId:snapshot.projectId,taskId:snapshot.taskId,attemptId:loaded.attempt.id,workItemId:loaded.work.id,actorId:loaded.work.lease_actor_id,keySha256:hash(loaded.attempt.idempotency_key!),leaseSha256:loaded.oldLeaseSha256,approvalSha256:loaded.approvalSha256,snapshotSha256:hash(JSON.stringify(canonical)),legacyPackageSha256:loaded.packageSha256};
 }
 async function preview(input:unknown,caller:unknown){
  const args=terminalReviewIssue.parse(input),p=requireTerminalPrincipal(caller,args.projectId,'owner',false);
  return deps.db.$transaction(async tx=>{
   const loaded=await loadLegacyBrowserScope(tx,deps,{projectId:args.projectId,taskId:args.taskId,attemptId:args.attemptId,actorId:p.actorId,idempotencyKey:args.idempotencyKey},now());
   if(loaded.request.snapshot.manifestChecksum!==args.expectedManifestChecksum)throw new Error('[TERMINAL_PACKAGE_CHANGED]');
   return {enabled:browserRecoveryEnabled(),target_binding:targetBinding(loaded),program_hashes:terminalProgramHashes(),native_source_verified:false,submission_permitted:false,mutates_state:false};
  },preparationSerial);
 }
 async function issueReview(input:unknown,caller:unknown){
  const args=terminalReviewIssue.parse(input),p=requireTerminalPrincipal(caller,args.projectId,'owner'),scope={projectId:args.projectId,taskId:args.taskId,attemptId:args.attemptId,actorId:p.actorId,idempotencyKey:args.idempotencyKey};
  return deps.db.$transaction(async tx=>{
   await requireNonDemoBrowserOwner(tx,scope);
   const prior=await tx.workflowEvent.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId,actor_id:p.actorId,command:issueCommand,idempotency_key:args.idempotencyKey}});
   if(prior){const replay=issued.parse(prior.after_state);if(replay.attempt_id!==args.attemptId||object(prior.before_state).request_sha256!==hash(JSON.stringify(args)))throw new Error('[TERMINAL_REPLAY_CONFLICT]');return {review_id:prior.id,nonce_available:false,replayed:true,deadline_at:new Date(replay.deadline_ms).toISOString(),program_hashes:terminalProgramHashes(),submission_permitted:false};}
   const loaded=await loadLegacyBrowserScope(tx,deps,scope,now());
   if(loaded.row||loaded.request.snapshot.manifestChecksum!==args.expectedManifestChecksum)throw new Error('[TERMINAL_PACKAGE_CHANGED]');
   const history=await tx.workflowEvent.findMany({where:{project_id:args.projectId,content_item_id:args.taskId,command:issueCommand},orderBy:{id:'asc'},take:4});
   const first=history[0]?issued.parse(history[0].after_state):null,time=now(),deadline=first?.deadline_ms??time+180000;
   if(history.length>=3||deadline<=time)throw new Error('[TERMINAL_REVIEW_BUDGET_EXHAUSTED]');
   const nonce=randomUUID(),event=await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:loaded.work.id,actor_id:p.actorId,command:issueCommand,idempotency_key:args.idempotencyKey,before_state:{request_sha256:hash(JSON.stringify(args))},after_state:{nonce_sha256:hash(nonce),package_sha256:loaded.packageSha256,approval_sha256:loaded.approvalSha256,publisher_actor_sha256:hash(loaded.work.lease_actor_id??''),old_lease_sha256:loaded.oldLeaseSha256,original_key_sha256:hash(loaded.attempt.idempotency_key!),attempt_id:args.attemptId,started_at_ms:first?.started_at_ms??time,deadline_ms:deadline}}});
   return {review_id:event.id,nonce,deadline_at:new Date(deadline).toISOString(),program_hashes:terminalProgramHashes(),target_binding:targetBinding(loaded),submission_permitted:false};
  },preparationSerial);
 }
 async function acceptReviewed(input:unknown,caller:unknown){
  const args=terminalReviewedRequest.parse(input),p=requireTerminalPrincipal(caller,args.projectId,'owner'),scope={projectId:args.projectId,taskId:args.taskId,attemptId:args.attemptId,actorId:p.actorId,idempotencyKey:args.idempotencyKey};
  let decoded:unknown;try{decoded=JSON.parse(args.localObservationJson);}catch(error:unknown){if(error instanceof SyntaxError)throw new Error('[TERMINAL_LOCAL_OUTPUT_INVALID]');throw error;}
  const local=terminalLocalObservation.safeParse(decoded);if(!local.success)throw new Error('[TERMINAL_LOCAL_OUTPUT_UNVERIFIED]');
  const requestSha256=hash(JSON.stringify(args));
  return deps.db.$transaction(async tx=>{
   await requireNonDemoBrowserOwner(tx,scope);
   const prior=await tx.workflowEvent.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId,actor_id:p.actorId,command:intakeCommand,after_state:{path:['review_id'],equals:args.reviewId}}});
   if(prior){if(object(prior.before_state).request_sha256!==requestSha256||object(prior.after_state).attempt_id!==args.attemptId)throw new Error('[TERMINAL_REVIEW_ALREADY_ACCEPTED]');return {evidence_id:prior.id,replayed:true,submission_permitted:false};}
   const loaded=await loadLegacyBrowserScope(tx,deps,scope,now());
   if(loaded.row||loaded.request.snapshot.manifestChecksum!==args.expectedManifestChecksum)throw new Error('[TERMINAL_PACKAGE_CHANGED]');
   const event=await tx.workflowEvent.findFirst({where:{id:args.reviewId,project_id:args.projectId,content_item_id:args.taskId,work_item_id:loaded.work.id,actor_id:p.actorId,command:issueCommand}}),proof=issued.safeParse(event?.after_state),time=now();
   if(!proof.success||proof.data.nonce_sha256!==hash(args.nonce)||proof.data.attempt_id!==args.attemptId||proof.data.deadline_ms<=time||proof.data.package_sha256!==loaded.packageSha256||proof.data.approval_sha256!==loaded.approvalSha256||proof.data.publisher_actor_sha256!==hash(loaded.work.lease_actor_id??'')||proof.data.old_lease_sha256!==loaded.oldLeaseSha256||proof.data.original_key_sha256!==hash(loaded.attempt.idempotency_key!))throw new Error('[TERMINAL_REVIEW_STALE]');
   const expected=terminalProgramHashes();for(const key of Object.keys(expected) as (keyof typeof expected)[])if(local.data.programHashes[key]!==expected[key])throw new Error('[TERMINAL_PRODUCER_VERSION_MISMATCH]');
   for(const control of [args.sourceControl,args.providerControl])if(control.reviewedAtMs<proof.data.started_at_ms||control.reviewedAtMs>time+5000)throw new Error('[TERMINAL_CONTROL_REVIEW_STALE]');
   if(args.sourceControl.outputSha256!==hash(args.localObservationJson)||args.providerControl.controlReference!==args.evidence.providerWindow.controlReference||args.providerControl.evidenceSha256!==hash(JSON.stringify(args.evidence.providerWindow)))throw new Error('[TERMINAL_CONTROL_DIGEST_MISMATCH]');
   if(args.sourceControl.controlReference.split('/')[4]===args.evidence.observation.threadId)throw new Error('[TERMINAL_INDEPENDENT_CONTROL_REQUIRED]');
   const native=local.data,metadata=args.evidence,o=metadata.observation;
   if(native.threadId!==o.threadId||native.turnId!==o.turnId||JSON.stringify(native.start)!==JSON.stringify(o.start)||JSON.stringify(native.end)!==JSON.stringify(o.end)||native.browserSha256!==hash(metadata.browserInstanceId)||native.profileSha256!==hash(`https://www.linkedin.com/company/${loaded.request.snapshot.identity.providerAccountId}/admin/page-posts/published/`)||native.operations.length!==o.operations.length)throw new Error('[TERMINAL_NATIVE_SCOPE_MISMATCH]');
   for(let i=0;i<o.operations.length;i++){const {classification,shapes,...operation}=native.operations[i]!;if(JSON.stringify(operation)!==JSON.stringify(o.operations[i]))throw new Error('[TERMINAL_NATIVE_SCOPE_MISMATCH]');}
   const actual=native.originalStartBinding,expectedBinding=targetBinding(loaded);
   if(actual.callId!==metadata.originalStart.callId||actual.ordinal!==metadata.originalStart.ordinal||actual.publisherActorSha256!==hash(expectedBinding.actorId)||actual.approvalSha256!==loaded.approvalSha256||actual.canonicalSnapshotSha256!==expectedBinding.snapshotSha256)throw new Error('[TERMINAL_NATIVE_SCOPE_MISMATCH]');
   for(const key of ['projectId','taskId','attemptId','workItemId','keySha256','leaseSha256'] as const)if(actual[key]!==expectedBinding[key])throw new Error('[TERMINAL_NATIVE_SCOPE_MISMATCH]');
   const externalCalls=new Set<string>(),nativeCalls=new Set<string>();
   for(const frame of native.external){
    if(externalCalls.has(frame.callId)||frame.semantic.callId!==frame.callId||frame.semantic.inputSha256!==frame.argumentsSha256||frame.ordinal<=o.start.ordinal||frame.completionOrdinal!==frame.matchingOutput.ordinal||frame.completionOrdinal<=frame.ordinal||frame.completionOrdinal>=o.end.ordinal)throw new Error('[TERMINAL_NATIVE_SCOPE_MISMATCH]');externalCalls.add(frame.callId);
    for(const id of frame.semantic.matchedNativeCallIds){if(nativeCalls.has(id))throw new Error('[TERMINAL_NATIVE_SCOPE_MISMATCH]');nativeCalls.add(id);}
   }
   if(!nativeCalls.has(actual.callId)||!native.external.some(f=>f.semantic.classification==='TARGET_START_ONLY'&&f.semantic.matchedNativeCallIds.includes(actual.callId)))throw new Error('[TERMINAL_NATIVE_SCOPE_MISMATCH]');
   const binding={...scope,workItemId:loaded.work.id,keySha256:hash(loaded.attempt.idempotency_key!),leaseSha256:loaded.oldLeaseSha256,snapshotSha256:loaded.packageSha256,approvalSha256:loaded.approvalSha256,publisherActorSha256:hash(loaded.work.lease_actor_id??''),createdAtMs:loaded.attempt.created_at.getTime(),snapshot:loaded.request.snapshot};
   checkTerminalMetadata(metadata,binding,time);
   const summary=terminalEvidenceSummary(metadata,binding,time,requestSha256);
   const accepted=await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:loaded.work.id,actor_id:p.actorId,command:intakeCommand,idempotency_key:args.idempotencyKey,before_state:{request_sha256:requestSha256},after_state:{...summary,expires_at_ms:Math.min(summary.expires_at_ms,proof.data.deadline_ms),review_id:args.reviewId,source_control_sha256:hash(args.sourceControl.controlReference),provider_control_sha256:hash(args.providerControl.controlReference),native_output_sha256:args.sourceControl.outputSha256,native_records_sha256:native.recordsSha256,verification_authority:'AUTHENTICATED_OWNER_CONTROL_REVIEW'}}});
   return {evidence_id:accepted.id,replayed:false,submission_permitted:false};
  },preparationSerial);
 }
 return {preview,issueReview,acceptReviewed};
}

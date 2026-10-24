import {hash,object,type BrowserDependencies} from './browser_publication_contract';
import {createBrowserRecoveryRepository} from './browser_recovery_repository';
import {requireNonDemoBrowserOwner} from './browser_recovery_owner';
import {preparationSerial} from './browser_preparation_storage';
import {preparationLedger,preparationRequest} from './browser_preparation_contract';
import {loadLegacyBrowserScope} from './legacy_browser_recovery_scope';
import type {LegacyRecoveryRequest,LegacyReservation} from './legacy_browser_recovery_contract';
import type {RecoveryClock} from './browser_recovery_contract';
export async function reserveLegacyBrowser(deps:BrowserDependencies,args:LegacyRecoveryRequest,executorId:string,clock:RecoveryClock){
 const scoped=await deps.db.$transaction(async tx=>{
  const scope=await loadLegacyBrowserScope(tx,deps,args,clock.now());
  if(!scope.row){
   const started=new Date(clock.now());
   await tx.browserDeliveryRecovery.create({data:{project_id:args.projectId,content_item_id:args.taskId,attempt_id:args.attemptId,work_item_id:scope.work.id,package_sha256:scope.packageSha256,approval_sha256:scope.approvalSha256,original_snapshot:scope.request.snapshot,stage:'LEGACY_ADOPTION_PENDING',delivery_certainty:'UNKNOWN',state:'idle',cause_code:'LEGACY_BROWSER_VERIFICATION_REQUIRED',recovery_action:'READ_ONLY_RECONCILIATION',started_at:started,deadline_at:new Date(started.getTime()+180000)}});
   await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:scope.work.id,actor_id:args.actorId,command:'legacy_browser_adoption_started',idempotency_key:args.idempotencyKey,before_state:{request_sha256:hash(JSON.stringify(args))},after_state:{adoption_contract_version:1,attempt_id:args.attemptId,package_sha256:scope.packageSha256,executor_sha256:hash(executorId),old_lease_sha256:scope.oldLeaseSha256,submission_permitted:false}}});
  }else{
   const marker=await tx.workflowEvent.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:scope.work.id,command:'legacy_browser_adoption_started',idempotency_key:scope.operationKey}});
   if(object(marker?.after_state).executor_sha256!==hash(executorId))throw new Error('[PRE_DISPATCH_PROOF_UNAVAILABLE]');
  }
  return scope;
 },preparationSerial);
 if(scoped.row?.stage==='PREPARE')return {kind:'resumed' as const,operationKey:scoped.operationKey};
 if(scoped.row?.state==='finalized')return {kind:'finalized' as const};
 if(scoped.row&&!['LEGACY_ADOPTION_PENDING','RECONCILING'].includes(scoped.row.stage))throw new Error('[POST_SUBMIT_UNKNOWN]');
 const repository=createBrowserRecoveryRepository(deps,args.actorId,requireNonDemoBrowserOwner);
 const result=await repository.reserve({projectId:args.projectId,taskId:args.taskId,attemptId:args.attemptId,packageSha256:scoped.packageSha256},clock.now());
 if(result.kind!=='reserved')return {kind:'held' as const,code:result.kind==='exhausted'?'RECONCILIATION_BUDGET_EXHAUSTED':result.kind==='held'?result.outcome?.code??'RECOVERY_IN_PROGRESS':'RECOVERY_CONFLICT'};
 const r=result.reservation;
 const context={...args,workItemId:scoped.work.id,snapshot:scoped.request.snapshot,approvalReference:scoped.request.approvalReference,attemptKey:scoped.attempt.idempotency_key!,packageSha256:scoped.packageSha256,approvalSha256:scoped.approvalSha256,oldLeaseSha256:scoped.oldLeaseSha256,challenge:r.leaseToken,deadlineMs:r.deadlineMs};
 return {kind:'reserved' as const,value:{context,reservation:r,operationKey:scoped.operationKey} satisfies LegacyReservation,repository};
}
/** Turn UNKNOWN into PREPARE only after verified full historical custody and current provider observation. */
export async function commitLegacyPreparation(deps:BrowserDependencies,value:LegacyReservation,executorId:string,evidenceSha256:string,clock:RecoveryClock):Promise<void>{
 const {context:c,reservation:r}=value;
 await deps.db.$transaction(async tx=>{
  const scope=await loadLegacyBrowserScope(tx,deps,c,clock.now()),row=scope.row;
  if(!row||row.state!=='reading'||row.row_version!==r.rowVersion||row.execution_generation!==r.executionGeneration||row.recovery_lease_sha256!==hash(r.leaseToken)||!row.recovery_lease_expires_at||row.recovery_lease_expires_at.getTime()<=clock.now()||!row.deadline_at||row.deadline_at.getTime()<=clock.now()||scope.oldLeaseSha256!==c.oldLeaseSha256||hash(scope.work.lease_token||'')!==c.oldLeaseSha256||scope.work.state!=='claimed'||!scope.work.lease_expires_at||scope.work.lease_expires_at.getTime()>clock.now())throw new Error('[RECOVERY_CONFLICT]');
  if(await tx.workflowEvent.count({where:{project_id:c.projectId,content_item_id:c.taskId,command:'ba_pre_submit_browser_submission'}}))throw new Error('[POST_SUBMIT_UNKNOWN]');
  const request=preparationRequest.parse({projectId:c.projectId,taskId:c.taskId,attemptId:c.attemptId,actorId:c.actorId,idempotencyKey:value.operationKey});
  const ledger=preparationLedger.parse({version:1,projectId:c.projectId,taskId:c.taskId,attemptId:c.attemptId,workItemId:c.workItemId,executorSha256:hash(executorId),generation:r.executionGeneration,revision:0,state:'quiescent',resumptions:r.round,startedAtMs:r.startedAtMs,deadlineMs:r.deadlineMs,operationSha256:hash(JSON.stringify(request)),challengeSha256:hash(c.challenge),proofSha256:evidenceSha256,outbox:'none',permitIssued:false,dispatchStarted:false});
  await tx.browserPreparationExecution.create({data:{project_id:c.projectId,attempt_id:c.attemptId,content_item_id:c.taskId,work_item_id:c.workItemId,ledger}});
  const changed=await tx.browserDeliveryRecovery.updateMany({where:{id:row.id,row_version:r.rowVersion,execution_generation:r.executionGeneration,state:'reading',recovery_lease_sha256:hash(r.leaseToken)},data:{row_version:{increment:1},stage:'PREPARE',state:'idle',delivery_certainty:'NOT_DISPATCHED',cause_code:'LEGACY_BROWSER_PRE_PERMIT_VERIFIED',recovery_action:'CONTINUE_SAME_ATTEMPT_AFTER_REPAIR',recovery_lease_sha256:null,recovery_lease_expires_at:null}});
  if(changed.count!==1)throw new Error('[RECOVERY_CONFLICT]');
  await tx.workflowEvent.create({data:{project_id:c.projectId,content_item_id:c.taskId,work_item_id:c.workItemId,actor_id:c.actorId,command:'legacy_browser_preparation_adopted',after_state:{adoption_contract_version:1,attempt_id:c.attemptId,generation:r.executionGeneration,evidence_sha256:evidenceSha256,executor_sha256:hash(executorId),package_sha256:c.packageSha256,submission_permitted:false}}});
 },preparationSerial);
}

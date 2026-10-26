import {browserSnapshotSchema,hash,object,type BrowserDb,type BrowserDependencies,type BrowserRequest} from './browser_publication_contract';
import {requireNonDemoBrowserOwner} from './browser_recovery_owner';
import {checkedBrowserRelease} from './browser_publication_guard';
import {loadPreparationState} from './browser_recovery_resume_repository';
import type {LegacyRecoveryRequest} from './legacy_browser_recovery_contract';
async function assertLegacyHistory(tx:BrowserDb,args:LegacyRecoveryRequest,workItemId:number,attemptKey:string):Promise<void>{
 if(await tx.apiDeliveryRecovery.count({where:{project_id:args.projectId,content_item_id:args.taskId}})
  ||await tx.connectorDispatchJob.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId}}))throw new Error('[LEGACY_BROWSER_CUSTODY_INCOMPLETE]');
 const events=await tx.workflowEvent.findMany({where:{project_id:args.projectId,content_item_id:args.taskId},select:{command:true,work_item_id:true,idempotency_key:true,after_state:true},take:201});
 if(events.length>200)throw new Error('[LEGACY_BROWSER_CUSTODY_INCOMPLETE]');
 const starts=events.filter(e=>e.command==='ba_start_browser_submission');
 if(starts.length!==1||starts[0]!.work_item_id!==workItemId||starts[0]!.idempotency_key!==attemptKey||object(starts[0]!.after_state).attempt_id!==args.attemptId)throw new Error('[LEGACY_BROWSER_CUSTODY_INCOMPLETE]');
 for(const event of events){
  if(event.command==='ba_start_browser_submission'||event.command==='ba_mark_browser_submission_uncertain')continue;
  if(object(event.after_state).submission_permitted===true||/pre_submit|dispatch|x_native_issue_challenge/.test(event.command))throw new Error('[POST_SUBMIT_UNKNOWN]');
 }
}
/** Validate current release data; historical task/account identifiers never select a code path. */
export async function loadLegacyBrowserScope(tx:BrowserDb,deps:BrowserDependencies,args:LegacyRecoveryRequest,now:number){
 await requireNonDemoBrowserOwner(tx,args);
 const fact=await tx.publicationFact.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId}});
 if(fact?.project_id===args.projectId)throw new Error('[LEGACY_BROWSER_FACT_EXISTS]');
 const attempt=await tx.deliveryAttempt.findFirst({where:{id:args.attemptId,project_id:args.projectId,content_item_id:args.taskId,status:'pending'}});
 if(!attempt||!attempt.idempotency_key)throw new Error('[RECOVERY_SCOPE_MISMATCH]');
 if(await tx.deliveryAttempt.count({where:{project_id:args.projectId,content_item_id:args.taskId}})!==1)throw new Error('[LEGACY_BROWSER_CUSTODY_INCOMPLETE]');
 const works=await tx.workItem.findMany({where:{project_id:args.projectId,content_item_id:args.taskId,kind:'browser_publish'},take:2});
 if(works.length!==1)throw new Error('[RECOVERY_SCOPE_MISMATCH]');
 const work=works[0]!,proof=object(work.result_payload),snapshot=browserSnapshotSchema.parse(proof.snapshot);
 const approvalReference=typeof proof.approval_reference==='string'?proof.approval_reference:'';
 const request:BrowserRequest={...args,snapshot,approvalReference,idempotencyKey:attempt.idempotency_key,apply:false};
 await assertLegacyHistory(tx,args,work.id,attempt.idempotency_key);
 const row=await tx.browserDeliveryRecovery.findUnique({where:{project_id_attempt_id:{project_id:args.projectId,attempt_id:args.attemptId}}});
 if(row){
  const marker=await tx.workflowEvent.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:work.id,command:'legacy_browser_adoption_started'}});
  if(object(marker?.after_state).adoption_contract_version!==1||object(marker?.after_state).attempt_id!==args.attemptId)throw new Error('[RECOVERY_CONFLICT]');
  const state=await loadPreparationState(tx,deps,args);
  if(!state||!state.ownerAuthorized||!state.permissionAllowed)throw new Error('[PERMISSION_DENIED]');
  if(!state.approvalActive||state.originalApprovalSha256!==state.currentApprovalSha256)throw new Error('[APPROVAL_REVOKED]');
  if(state.packageSha256!==state.currentPackageSha256)throw new Error('[PACKAGE_CHANGED]');
  return {attempt,work,request,row,operationKey:marker!.idempotency_key!,packageSha256:state.packageSha256,approvalSha256:state.originalApprovalSha256,oldLeaseSha256:String(object(marker!.after_state).old_lease_sha256)};
 }
 const {task}=await checkedBrowserRelease(tx,{...request,workItemId:work.id},deps);
 if(task.status!=='publishing'||work.state!=='claimed'||!work.lease_token||!work.lease_expires_at||work.lease_expires_at.getTime()>now)throw new Error('[LEGACY_BROWSER_ACTIVE_EXECUTOR]');
 if(attempt.channel_id!==snapshot.channelId||await tx.browserPreparationExecution.findUnique({where:{project_id_attempt_id:{project_id:args.projectId,attempt_id:args.attemptId}}}))throw new Error('[LEGACY_BROWSER_CUSTODY_INCOMPLETE]');
 return {attempt,work,request,row:null,operationKey:args.idempotencyKey,packageSha256:hash(JSON.stringify(snapshot)),approvalSha256:hash(approvalReference),oldLeaseSha256:hash(work.lease_token)};
}

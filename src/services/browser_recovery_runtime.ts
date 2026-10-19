import {isDeepStrictEqual} from 'node:util';
import {assessLegacyBrowserRecovery} from './browser_recovery_assessment';
import {Prisma} from '@prisma/client';
import {browserDefaults,hash,object,snapshotHash,checkedBrowserContext,requireBrowserOwner,type BrowserDependencies} from './browser_publication_contract';
import {browserUncertainSchema} from './browser_publication_execution';
import {checkedBrowserRelease} from './browser_publication_guard';
import {browserRecoveryEnabled} from './browser_recovery_guard';
import {createBrowserRecoveryRepository} from './browser_recovery_repository';
import {coordinateBrowserRecovery,recoveryOutcome} from './browser_recovery_coordinator';
import type {BrowserRecoveryPorts,RecoveryClock,RecoveryFinalizer,RecoveryOutcome} from './browser_recovery_contract';
export type BrowserRecoveryOperation=(input:unknown)=>Promise<RecoveryOutcome>;
/** Application-only registration: no RPC accepts ports/finalizer or enables a provider capability. */
export function createBrowserRecoveryOperation(ports:BrowserRecoveryPorts,clock:RecoveryClock,finalize:RecoveryFinalizer,deps:BrowserDependencies=browserDefaults):BrowserRecoveryOperation {
 return async input=>{
  const args=browserUncertainSchema.parse(input);
  if(!ports.has(args.snapshot.identity.platform))return assessLegacyBrowserRecovery(args.reasonCode);
  if(!browserRecoveryEnabled())return recoveryOutcome('READBACK_CAPABILITY_UNAVAILABLE');
  const digest=snapshotHash(args.snapshot),operationStartedAt=clock.now();
  let lookupWindow:{from:Date;through:Date}|undefined;
  const denied=await deps.db.$transaction(async tx=>{
   await requireBrowserOwner(tx,args);
   const attempt=await tx.deliveryAttempt.findFirst({where:{id:args.attemptId,project_id:args.projectId,content_item_id:args.taskId,channel_id:args.snapshot.channelId,idempotency_key:args.idempotencyKey,status:'pending'}});
   if(!attempt||!attempt.error_message)throw new Error('[RECOVERY_SCOPE_MISMATCH]');
   const old=await tx.browserDeliveryRecovery.findUnique({where:{project_id_attempt_id:{project_id:args.projectId,attempt_id:args.attemptId}}});
   if(old){
    if(old.content_item_id!==args.taskId||old.work_item_id!==args.workItemId||old.package_sha256!==digest||old.approval_sha256!==hash(args.approvalReference))throw new Error('[RECOVERY_SCOPE_MISMATCH]');
    const hold=async(code:string)=>{
     const outcome=recoveryOutcome(code);
     const changed=await tx.browserDeliveryRecovery.updateMany({where:{id:old.id,row_version:old.row_version},data:{state:'held',row_version:{increment:1},cause_code:outcome.code,recovery_action:outcome.recoveryAction,recovery_lease_sha256:null,recovery_lease_expires_at:null}});
     if(changed.count!==1)return recoveryOutcome('RECOVERY_CONFLICT');
     await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,actor_id:args.actorId,command:'browser_recovery_read_denied',after_state:{attempt_id:args.attemptId,code:outcome.code}}});return outcome;
    };
    const current=await tx.contentItem.findFirst({where:{id:args.taskId,project_id:args.projectId}});
    const proof=object(object(current?.quality_report).browser_release);
    if(proof.publication_authorized!==true||proof.approval_reference!==args.approvalReference)return hold('APPROVAL_REVOKED');
    try{await checkedBrowserContext(tx,args,deps);}
    catch(error:unknown){
     if(error instanceof Error&&/^\[(STALE_MANIFEST|BROWSER_SNAPSHOT_MISMATCH|BROWSER_IDENTITY_INVALID)\]/.test(error.message))return hold('PACKAGE_CHANGED');
     throw error;
    }
    const work=await tx.workItem.findFirst({where:{id:args.workItemId,project_id:args.projectId,content_item_id:args.taskId}});
    if(!work||!isDeepStrictEqual(object(work.result_payload),proof))return hold('APPROVAL_REVOKED');
    const release=await tx.workflowEvent.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:args.workItemId,command:'ba_release_browser_publication',actor_id:typeof proof.actor_id==='string'?proof.actor_id:'',idempotency_key:typeof proof.release_key==='string'?proof.release_key:''}});
    if(object(release?.after_state).publication_authorized!==true||proof.snapshot_sha256!==digest)return hold('APPROVAL_REVOKED');
    if(old.lookup_window_start_at&&old.lookup_window_end_at)lookupWindow={from:old.lookup_window_start_at,through:old.lookup_window_end_at};
    return null;
   }
   const {work}=await checkedBrowserRelease(tx,args,deps);
   if(work.lease_actor_id!==args.actorId||hash(work.lease_token||'')!==hash(args.leaseToken))throw new Error('[RECOVERY_SCOPE_MISMATCH]');
   lookupWindow={from:new Date(attempt.created_at.getTime()-120000),through:new Date(operationStartedAt+30000)};
   await tx.browserDeliveryRecovery.create({data:{project_id:args.projectId,content_item_id:args.taskId,attempt_id:args.attemptId,work_item_id:args.workItemId,package_sha256:digest,approval_sha256:hash(args.approvalReference),original_snapshot:args.snapshot,lookup_window_start_at:lookupWindow.from,lookup_window_end_at:lookupWindow.through,started_at:new Date(operationStartedAt),deadline_at:new Date(operationStartedAt+180000),stage:'RECONCILING',delivery_certainty:'UNKNOWN',cause_code:'POST_SUBMIT_UNKNOWN',recovery_action:'READ_ONLY_RECONCILIATION'}});
   await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:args.workItemId,actor_id:args.actorId,command:'browser_recovery_admit',after_state:{attempt_id:args.attemptId,contract_version:2,code:'POST_SUBMIT_UNKNOWN'}}});
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:2000,timeout:10000});
  if(denied)return denied;
  // Publication time window is adapter-verified; do not equate provider visibility with permit expiry.
  if(!lookupWindow)return recoveryOutcome('RECONCILIATION_COVERAGE_INCOMPLETE');
  return coordinateBrowserRecovery({scope:{projectId:args.projectId,taskId:args.taskId,attemptId:args.attemptId,packageSha256:digest},provider:args.snapshot.identity.platform,accountSha256:hash(JSON.stringify(args.snapshot.identity)),bodySha256:args.snapshot.bodySha256,assetSha256:args.snapshot.assetSha256,publishedAfterMs:lookupWindow.from.getTime(),publishedBeforeMs:lookupWindow.through.getTime()},{repository:createBrowserRecoveryRepository(deps,args.actorId),ports,clock,finalize});
 };
}

export {createLinkedInRecoveryReader} from './linkedin_recovery_reader';

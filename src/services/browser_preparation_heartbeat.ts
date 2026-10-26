import {z} from 'zod';
import {currentPublicationPrincipal} from '../mcp/publication-principal';
import {browserDefaults,hash,type BrowserDependencies} from './browser_publication_contract';
import {equalBrowserLease} from './browser_publication_guard';
import {browserRecoveryEnabled} from './browser_recovery_guard';
import {requireNonDemoBrowserOwner} from './browser_recovery_owner';
import {loadPreparationState} from './browser_recovery_resume_repository';
import {preparationLedger} from './browser_preparation_contract';
import {preparationSerial,replacePreparation} from './browser_preparation_storage';
import {checkedPreparationActivity,preparationActivity} from './browser_preparation_liveness';

export const preparationHeartbeatRequest=z.object({
 projectId:z.number().int().positive(),taskId:z.number().int().positive(),
 attemptId:z.number().int().positive(),workItemId:z.number().int().positive(),
 actorId:z.string().regex(/^user:[1-9]\d*$/),idempotencyKey:z.string().trim().min(1).max(120),
 leaseToken:z.string().min(16).max(200),generation:z.number().int().nonnegative()
}).strict();
export type PreparationHeartbeatRequest=z.infer<typeof preparationHeartbeatRequest>;
export type PreparationHeartbeatResult={
 generation:number;leaseExpiresAtMs:number;submission_permitted:false;retry_allowed:false;
};
const renewalMs=120000;
/**
 * Renews only an authenticated original Publisher's LIVE, admitted PREPARE lease.
 * No attempt, permit, takeover or stop evidence is created. The owning runtime must
 * call this while working; a watchdog and genuinely fenced runtime remain separate.
 */
export function createPreparationHeartbeat(deps:BrowserDependencies=browserDefaults,now:()=>number=Date.now){
 async function renew(input:unknown):Promise<PreparationHeartbeatResult>{
  const args=preparationHeartbeatRequest.parse(input),principal=currentPublicationPrincipal();
  if(!principal||principal.profile!=='publisher'||principal.projectId!==args.projectId
   ||principal.actorId!==args.actorId||principal.actorId!==`user:${principal.userId}`)
   throw new Error('[HEARTBEAT_PUBLISHER_REQUIRED]');
  if(!browserRecoveryEnabled())throw new Error('[HEARTBEAT_DISABLED]');
  return deps.db.$transaction(async tx=>{
   await requireNonDemoBrowserOwner(tx,args);
   const state=await loadPreparationState(tx,deps,args);
   if(!state||!state.ownerAuthorized||!state.permissionAllowed||state.attemptStatus!=='pending')
    throw new Error('[HEARTBEAT_NOT_PREPARING]');
   if(!state.approvalActive||state.originalApprovalSha256!==state.currentApprovalSha256)
    throw new Error('[APPROVAL_REVOKED]');
   if(state.packageSha256!==state.currentPackageSha256)throw new Error('[PACKAGE_CHANGED]');
   const stored=await tx.browserPreparationExecution.findUnique({where:{project_id_attempt_id:{project_id:args.projectId,attempt_id:args.attemptId}}});
   const parsed=preparationLedger.safeParse(stored?.ledger),time=now();
   if(!Number.isFinite(time)||!stored||!parsed.success)throw new Error('[HEARTBEAT_NOT_PREPARING]');
   const ledger=parsed.data;
   if(ledger.projectId!==args.projectId||ledger.taskId!==args.taskId||ledger.attemptId!==args.attemptId
    ||ledger.workItemId!==args.workItemId||state.workItemId!==args.workItemId
    ||ledger.generation!==args.generation||state.executionGeneration!==args.generation
    ||ledger.state!=='preparing'||state.stage!=='PREPARE'||state.deliveryCertainty!=='NOT_DISPATCHED'
    ||ledger.permitIssued||ledger.dispatchStarted)
    throw new Error('[HEARTBEAT_NOT_PREPARING]');
   const attempt=await tx.deliveryAttempt.findFirst({where:{id:args.attemptId,project_id:args.projectId,content_item_id:args.taskId,status:'pending'}});
   if(!attempt||attempt.idempotency_key!==args.idempotencyKey)throw new Error('[BROWSER_ATTEMPT_KEY_MISMATCH]');
   // An existing event wins over optimistic PREPARE flags; absence is not native stop proof.
   if(await tx.workflowEvent.count({where:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:args.workItemId,
    OR:[{command:{in:['ba_pre_submit_browser_submission','browser_preparation_dispatch_started','x_native_issue_challenge']}},
     {after_state:{path:['submission_permitted'],equals:true}},{after_state:{path:['provider_called'],equals:true}}]}}))
    throw new Error('[HEARTBEAT_POSSIBLY_SENT]');
   const work=await tx.workItem.findFirst({where:{id:args.workItemId,project_id:args.projectId,content_item_id:args.taskId,kind:'browser_publish'}});
   if(!work||work.state!=='claimed'||work.lease_actor_id!==args.actorId||!equalBrowserLease(work.lease_token,args.leaseToken)
    ||!work.lease_expires_at||work.lease_expires_at.getTime()<=time)throw new Error('[HEARTBEAT_LEASE_EXPIRED]');
   const currentExpiry=work.lease_expires_at.getTime();
   if(ledger.activeLiveness)checkedPreparationActivity(ledger,work,state.recoveryLeaseExpiresAt,time);
   else if(ledger.deadlineMs!==null&&time>=ledger.deadlineMs)throw new Error('[HEARTBEAT_NOT_PREPARING]');
   const expires=Math.max(currentExpiry,time+renewalMs);
   if(expires<currentExpiry||expires<=time)throw new Error('[HEARTBEAT_NOT_PREPARING]');
   const row=await tx.browserDeliveryRecovery.findUnique({where:{project_id_attempt_id:{project_id:args.projectId,attempt_id:args.attemptId}}});
   if(!row||row.content_item_id!==args.taskId||row.work_item_id!==args.workItemId
    ||(args.generation>0&&(row.recovery_lease_sha256!==hash(args.leaseToken)
      ||row.recovery_lease_expires_at?.getTime()!==currentExpiry)))throw new Error('[RECOVERY_CONFLICT]');
   const changed=await tx.browserDeliveryRecovery.updateMany({where:{project_id:args.projectId,attempt_id:args.attemptId,
    content_item_id:args.taskId,row_version:state.rowVersion,execution_generation:args.generation,
    stage:'PREPARE',delivery_certainty:'NOT_DISPATCHED',state:{in:['idle','resumed']}},
    data:{row_version:{increment:1},recovery_lease_sha256:hash(args.leaseToken),recovery_lease_expires_at:new Date(expires)}});
   if(changed.count!==1)throw new Error('[RECOVERY_CONFLICT]');
   const renewed=await tx.workItem.updateMany({where:{id:args.workItemId,project_id:args.projectId,content_item_id:args.taskId,
    state:'claimed',lease_actor_id:args.actorId,lease_token:args.leaseToken,lease_expires_at:work.lease_expires_at},
    data:{lease_expires_at:new Date(expires)}});
   if(renewed.count!==1)throw new Error('[RECOVERY_CONFLICT]');
   await replacePreparation(tx,stored,{...ledger,activeLiveness:preparationActivity(ledger,args.leaseToken,expires,time)});
   await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:args.workItemId,
    actor_id:args.actorId,command:'browser_preparation_heartbeat',after_state:{attempt_id:args.attemptId,generation:args.generation,
     lease_sha256:hash(args.leaseToken),previous_expires_at:work.lease_expires_at.toISOString(),
     lease_expires_at:new Date(expires).toISOString(),submission_permitted:false,retry_allowed:false}}});
   if(!Number.isFinite(now())||now()>=currentExpiry||now()>=expires)throw new Error('[HEARTBEAT_LEASE_EXPIRED]');
   return{generation:args.generation,leaseExpiresAtMs:expires,submission_permitted:false,retry_allowed:false};
  },preparationSerial);
 }
 return{renew};
}

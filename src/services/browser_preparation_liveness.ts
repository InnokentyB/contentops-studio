import {hash,type BrowserDependencies} from './browser_publication_contract';
import type {PreparationLedger,PreparationRequest} from './browser_preparation_contract';
import {loadPreparation,preparationSerial,replacePreparation} from './browser_preparation_storage';
type WorkLease={lease_token:string|null;lease_expires_at:Date|null};
/** Server-persisted activity is valid only for the exact current generation and actual private work lease. */
export function checkedPreparationActivity(ledger:PreparationLedger,work:WorkLease,recoveryExpiry:Date|null,time:number,allowExpired=false){
 const active=ledger.activeLiveness,expiry=work.lease_expires_at?.getTime();
 if(!active||!Number.isFinite(time)||active.generation!==ledger.generation||!work.lease_token
  ||active.leaseSha256!==hash(work.lease_token)||expiry!==active.leaseExpiresAtMs
  ||recoveryExpiry?.getTime()!==expiry||active.activatedAtMs>active.lastHeartbeatAtMs
  ||active.lastHeartbeatAtMs>time||active.lastHeartbeatAtMs>=active.leaseExpiresAtMs
  ||(!allowExpired&&time>=active.leaseExpiresAtMs))throw new Error('[RECOVERY_CONFLICT]');
 return active;
}
/** Binding is produced only after a successful private pickup or authenticated live renewal, never request flags. */
export function preparationActivity(ledger:PreparationLedger,leaseToken:string,expiry:number,time:number):NonNullable<PreparationLedger['activeLiveness']>{
 return {version:1,generation:ledger.generation,leaseSha256:hash(leaseToken),activatedAtMs:ledger.activeLiveness?.activatedAtMs??time,
  lastHeartbeatAtMs:time,leaseExpiresAtMs:expiry};
}
/** Close one EXPIRED active interval once. This changes clock accounting only, never proves quiescence or resumes an executor. */
export async function closePreparationActivity(deps:BrowserDependencies,args:PreparationRequest,executorId:string,now:()=>number):Promise<void>{
 await deps.db.$transaction(async tx=>{
  const loaded=await loadPreparation(tx,deps,args,executorId),{ledger,state}=loaded;
  if(!ledger.activeLiveness)return;
  if(state.stage!=='PREPARE'||state.deliveryCertainty!=='NOT_DISPATCHED'||state.attemptStatus!=='pending'
   ||ledger.state!=='preparing'||ledger.permitIssued||ledger.dispatchStarted)throw new Error('[POST_SUBMIT_UNKNOWN]');
  const time=now(),work=await tx.workItem.findFirst({where:{id:state.workItemId,project_id:args.projectId,content_item_id:args.taskId,state:'claimed',lease_actor_id:args.actorId}});
  if(!work)throw new Error('[RECOVERY_CONFLICT]');
  const active=checkedPreparationActivity(ledger,work,state.recoveryLeaseExpiresAt,time,true);
  if(time<active.leaseExpiresAtMs){
   if(ledger.operationSha256===hash(JSON.stringify(args)))return; // exact recovery replay creates no takeover or clock credit
   throw new Error('[RECOVERY_IN_PROGRESS]');
  }
  if(await tx.workflowEvent.count({where:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:state.workItemId,
   OR:[{command:{in:['ba_pre_submit_browser_submission','browser_preparation_dispatch_started','x_native_issue_challenge']}},
    {after_state:{path:['submission_permitted'],equals:true}},{after_state:{path:['provider_called'],equals:true}}]}}))throw new Error('[POST_SUBMIT_UNKNOWN]');
  const pausedMs=active.leaseExpiresAtMs-active.activatedAtMs;
  if(!Number.isFinite(pausedMs)||pausedMs<0||(ledger.startedAtMs===null)!==(ledger.deadlineMs===null))throw new Error('[RECOVERY_CONFLICT]');
  const {activeLiveness:_closed,...inactive}=ledger;
  const next={...inactive,startedAtMs:ledger.startedAtMs===null?null:ledger.startedAtMs+pausedMs,
   deadlineMs:ledger.deadlineMs===null?null:ledger.deadlineMs+pausedMs};
  if((next.startedAtMs!==null&&!Number.isFinite(next.startedAtMs))||(next.deadlineMs!==null&&!Number.isFinite(next.deadlineMs)))throw new Error('[RECOVERY_CONFLICT]');
  await replacePreparation(tx,loaded.stored,next);
  await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:state.workItemId,actor_id:args.actorId,
   command:'browser_preparation_liveness_closed',after_state:{attempt_id:args.attemptId,generation:ledger.generation,
    lease_sha256:active.leaseSha256,active_interval_ms:pausedMs,recovery_started_at_ms:next.startedAtMs,recovery_deadline_ms:next.deadlineMs,
    resumptions:ledger.resumptions,submission_permitted:false,retry_allowed:false}}});
 },preparationSerial);
}

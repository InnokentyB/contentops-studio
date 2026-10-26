import {recoveryOutcome} from './browser_recovery_coordinator';
import {randomUUID,createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {requireBrowserOwner,type BrowserDependencies,type BrowserDb} from './browser_publication_contract';
import {RECOVERY_LIMITS,type BrowserRecoveryRepository,type RecoveryScope,type RecoveryReservation,type RecoveryOutcome} from './browser_recovery_contract';
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const scopeSchema=z.object({projectId:z.number().int().positive(),taskId:z.number().int().positive(),attemptId:z.number().int().positive(),packageSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const serial={isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:2000,timeout:10000};
const reusable=new Set(['RECONCILIATION_NOT_FOUND','RECONCILIATION_TEMPORARILY_UNAVAILABLE','RECONCILIATION_CANCELLED']);
/** Application-owned repository: every operation rechecks tenant ownership and immutable attempt scope. */
export function createBrowserRecoveryRepository(deps:BrowserDependencies,actorId:string,additionalOwnerGuard?:typeof requireBrowserOwner):BrowserRecoveryRepository {
 const transact=<T>(scope:RecoveryScope,run:(tx:BrowserDb)=>Promise<T>)=>{
  scopeSchema.parse(scope);
  return deps.db.$transaction(async tx=>{
   await requireBrowserOwner(tx,{projectId:scope.projectId,actorId});
   if(additionalOwnerGuard)await additionalOwnerGuard(tx,{projectId:scope.projectId,actorId});
   const attempt=await tx.deliveryAttempt.findFirst({where:{id:scope.attemptId,project_id:scope.projectId,content_item_id:scope.taskId}});
   if(!attempt)throw new Error('[RECOVERY_SCOPE_MISMATCH]');
   return run(tx);
  },serial);
 };
 const find=(tx:BrowserDb,s:RecoveryScope)=>tx.browserDeliveryRecovery.findFirst({where:{project_id:s.projectId,content_item_id:s.taskId,attempt_id:s.attemptId,package_sha256:s.packageSha256,contract_version:2}});
 const fence=(r:RecoveryReservation,now:number)=>({project_id:r.scope.projectId,content_item_id:r.scope.taskId,attempt_id:r.scope.attemptId,package_sha256:r.scope.packageSha256,contract_version:2,row_version:r.rowVersion,execution_generation:r.executionGeneration,state:'reading',recovery_lease_sha256:sha(r.leaseToken),recovery_lease_expires_at:{gt:new Date(now)},deadline_at:{gt:new Date(now)}});
 const audit=(tx:BrowserDb,r:RecoveryReservation,command:string,code:string)=>tx.workflowEvent.create({data:{project_id:r.scope.projectId,content_item_id:r.scope.taskId,actor_id:actorId,command,after_state:{attempt_id:r.scope.attemptId,generation:r.executionGeneration,round:r.round,code}}});
 return {
  reserve:(scope,now)=>transact(scope,async tx=>{
   if(!Number.isFinite(now))throw new Error('[RECOVERY_INVALID_CLOCK]');
   const row=await find(tx,scope);if(!row)return{kind:'legacy'};
   if(row.state==='finalized')return{kind:'finalized'};
   if(row.state==='reading'&&row.recovery_lease_expires_at&&row.recovery_lease_expires_at.getTime()>now)return{kind:'held'};
   if(row.state==='held')return{kind:'held',outcome:recoveryOutcome(row.cause_code)};
   const started=row.started_at?.getTime()??now,deadline=row.deadline_at?.getTime()??started+RECOVERY_LIMITS.deadlineMs;
   if(row.rounds>=RECOVERY_LIMITS.rounds||row.requests_used>=RECOVERY_LIMITS.requests||now>=deadline)return{kind:'exhausted'};
   const token=randomUUID(),round=row.rounds+1,version=row.row_version+1;
   const leaseEnd=Math.min(deadline,Math.max(now,started+RECOVERY_LIMITS.roundOffsetsMs[round-1]!)+35000);
   const changed=await tx.browserDeliveryRecovery.updateMany({where:{id:row.id,row_version:row.row_version,execution_generation:row.execution_generation},data:{state:'reading',stage:'RECONCILING',rounds:round,row_version:version,started_at:new Date(started),deadline_at:new Date(deadline),recovery_lease_sha256:sha(token),recovery_lease_expires_at:new Date(leaseEnd)}});
   if(changed.count!==1)return{kind:'held'};
   const reservation:RecoveryReservation={scope,rowVersion:version,executionGeneration:row.execution_generation,leaseToken:token,startedAtMs:started,deadlineMs:deadline,round,requestsUsed:row.requests_used};
   await audit(tx,reservation,'browser_recovery_reserve','RECONCILIATION_STARTED');
   return{kind:'reserved',reservation};
  }),
  takeRequest:(r,now)=>transact(r.scope,async tx=>{
   if(!Number.isFinite(now))return false;
   const changed=await tx.browserDeliveryRecovery.updateMany({where:{...fence(r,now),requests_used:{lt:RECOVERY_LIMITS.requests}},data:{requests_used:{increment:1}}});
   if(changed.count===1)await audit(tx,r,'browser_recovery_read_request','READ_ONLY_REQUEST_RESERVED');
   return changed.count===1;
  }),
  settle:(r,result,now)=>transact(r.scope,async tx=>{
   if(!Number.isFinite(now)||result.code==='RECONCILIATION_FOUND'||result.deliveryCertainty==='CONFIRMED_SENT')return'conflict';
   if(!/^[A-Z][A-Z_]{1,79}$/.test(result.code)||result.retry_allowed!==false||result.submission_permitted!==false)return'conflict';
   const budgetEnd=r.round>=RECOVERY_LIMITS.rounds&&reusable.has(result.code);
   const changed=await tx.browserDeliveryRecovery.updateMany({where:fence(r,now),data:{row_version:{increment:1},state:!budgetEnd&&reusable.has(result.code)?'idle':'held',cause_code:budgetEnd?'RECONCILIATION_BUDGET_EXHAUSTED':result.code,recovery_action:budgetEnd?'CONTACT_ENGINEERING':result.recoveryAction,delivery_certainty:'UNKNOWN',recovery_lease_sha256:null,recovery_lease_expires_at:null,next_read_at:!budgetEnd&&reusable.has(result.code)?new Date(r.startedAtMs+(RECOVERY_LIMITS.roundOffsetsMs[r.round]??RECOVERY_LIMITS.deadlineMs)):null}});
   if(changed.count!==1)return'conflict';
   await audit(tx,r,'browser_recovery_settle',budgetEnd?'RECONCILIATION_BUDGET_EXHAUSTED':result.code);return'committed';
  })
 };
}
/** Must run inside the canonical fact transaction; never a separate fact writer. */
export async function finalizeRecoveryState(tx:BrowserDb,r:RecoveryReservation,actorId:string,signal:AbortSignal):Promise<void>{
 const now=new Date();if(signal.aborted)throw new Error('[RECOVERY_CANCELLED]');
 await requireBrowserOwner(tx,{projectId:r.scope.projectId,actorId});
 const changed=await tx.browserDeliveryRecovery.updateMany({where:{project_id:r.scope.projectId,content_item_id:r.scope.taskId,attempt_id:r.scope.attemptId,package_sha256:r.scope.packageSha256,row_version:r.rowVersion,execution_generation:r.executionGeneration,state:'reading',recovery_lease_sha256:sha(r.leaseToken),recovery_lease_expires_at:{gt:now},deadline_at:{gt:now}},data:{state:'finalized',stage:'FINALIZED',delivery_certainty:'CONFIRMED_SENT',cause_code:'RECONCILIATION_FOUND',recovery_action:'INSPECT_CONFIRMED_FACT',row_version:{increment:1},recovery_lease_sha256:null,recovery_lease_expires_at:null}});
 if(changed.count!==1||signal.aborted)throw new Error('[RECOVERY_CONFLICT]');
 await tx.workflowEvent.create({data:{project_id:r.scope.projectId,content_item_id:r.scope.taskId,actor_id:actorId,command:'browser_recovery_finalize',after_state:{attempt_id:r.scope.attemptId,generation:r.executionGeneration,code:'RECONCILIATION_FOUND'}}});
}

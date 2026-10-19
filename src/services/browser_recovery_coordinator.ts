import { z } from 'zod';
import { RECOVERY_LIMITS,type BrowserRecoveryDependencies,type RecoveryContext,type RecoveryOutcome,type RecoveryReservation,type RecoveryReadControl,type VerifiedRecoveryEvidence,type RecoveryClock } from './browser_recovery_contract';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const contextSchema=z.object({scope:z.object({projectId:z.number().int().positive(),taskId:z.number().int().positive(),attemptId:z.number().int().positive(),packageSha256:hash}).strict(),provider:z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),accountSha256:hash,bodySha256:hash,assetSha256:hash.nullable(),publishedAfterMs:z.number().finite(),publishedBeforeMs:z.number().finite(),knownObjectId:z.string().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/).optional()}).strict();
const evidenceSchema=z.object({schemaVersion:z.literal(1),provider:z.string(),accountSha256:hash,packageSha256:hash,bodySha256:hash,assetSha256:hash.nullable(),providerObjectId:z.string().min(1).max(200),publicUrl:z.string().url().max(2000),publishedAtMs:z.number().finite(),observedAtMs:z.number().finite(),evidenceRef:z.string().regex(/^sha256:[a-f0-9]{64}$/)}).strict();
type Entry=readonly [RecoveryOutcome['recoveryAction'],string,string];
const catalog:Record<string,Entry>={
 PREPARATION_RECOVERY_FAILED:['CONTACT_ENGINEERING','Preparation recovery failed; the exact cause is not classified.','Ask engineering to inspect safe diagnostics and the original attempt and executor state. Preserve its holds and history; do not clear errors, replace keys or resend.'],
 READBACK_CAPABILITY_UNAVAILABLE:['CONTACT_ENGINEERING','No admitted read-only provider recovery capability is registered.','Ask engineering to implement and admit a bounded reader through the existing approved route. Preserve the current attempt; do not resend or use another transport.'],
 RECONCILIATION_BUDGET_EXHAUSTED:['CONTACT_ENGINEERING','The durable read-only recovery budget is exhausted.','Inspect retained evidence and adapter health. Reconcile the same attempt through its approved route; do not reset counters, replace keys or resend.'],
 RECOVERY_CONFLICT:['READ_ONLY_RECONCILIATION','The recovery state or canonical fact changed concurrently.','Read current canonical state and reconcile the same attempt. Do not overwrite evidence or send again.'],
 RECOVERY_IN_PROGRESS:['WAIT_SYSTEM_RETRY','Another read-only recovery operation holds this attempt.','Wait for the current recovery result or permitted lease expiry; do not start a duplicate reader or resend.'],
 RECOVERY_LEGACY_UNKNOWN:['CONTACT_ENGINEERING','This legacy attempt lacks trustworthy v2 recovery evidence.','Keep the original attempt UNKNOWN and use its existing approved reconciliation route. Do not infer that no submission occurred.'],
 RECOVERY_INPUT_INVALID:['CONTACT_ENGINEERING','The internal recovery context is invalid.','Ask engineering to repair scope and immutable package bindings before admitting recovery. No provider read or send was authorized.'],
 RECONCILIATION_TEMPORARILY_UNAVAILABLE:['WAIT_SYSTEM_RETRY','The read-only dependency is temporarily unavailable.','The system may resume bounded reading within the existing durable budget. No new owner approval or submission is requested.'],
 RECONCILIATION_CANCELLED:['WAIT_SYSTEM_RETRY','The read-only recovery request was cancelled.','Inspect persisted recovery status. A later authorized invocation may use only the remaining durable read budget; do not resend.'],
 RECONCILIATION_NOT_FOUND:['READ_ONLY_RECONCILIATION','The bounded read did not find a matching provider object.','Preserve UNKNOWN and continue only supported reading within the durable budget. Absence is not proof of non-delivery and never permits resend.'],
 RECONCILIATION_COVERAGE_INCOMPLETE:['CONTACT_ENGINEERING','The readback evidence or inventory coverage could not establish a verified outcome.','Ask engineering to repair evidence validation or missing coverage through the registered reader. Preserve UNKNOWN; do not infer absence or resend.'],
 RECONCILIATION_AMBIGUOUS:['RESOLVE_AMBIGUITY','The provider readback contains an ambiguous match.','Ask the owning operator to distinguish the existing provider objects using account, immutable package and publication time evidence. Do not resend.'],
 PERMISSION_DENIED:['RESTORE_PERMISSION','The registered readback operation reports a permission denial.','Ask the authorized permission administrator to resolve the exact denial in the approved adapter context. Do not bypass it with another route.'],
 APPROVAL_REVOKED:['REVIEW_APPROVAL','The current approval does not permit guarded finalization.','Ask the project owner to review the revoked approval; preserve historical evidence and the original attempt without dispatching again.'],
 PACKAGE_CHANGED:['REVIEW_PACKAGE','The current package no longer matches the immutable attempt package.','Ask the owner to review the package change while retaining historical evidence. Do not rebind the attempt or publish again.'],
 RECONCILIATION_FOUND:['INSPECT_CONFIRMED_FACT','A unique verified provider match was finalized through the canonical gates.','Read the existing canonical publication fact. No further submission is required.'],
 RECONCILIATION_PROVEN_NOT_SENT:['READ_ONLY_RECONCILIATION','The reader reports non-delivery evidence; this slice cannot authorize a new send.','Retain the evidence for a separately governed recovery decision. Do not resend or create a new key.']
};
export function recoveryOutcome(input:string):RecoveryOutcome {
 const code=Object.prototype.hasOwnProperty.call(catalog,input)?input:'RECOVERY_CONFLICT';
 const [recoveryAction,message,action]=catalog[code]!;
 return {code,stage:code==='RECONCILIATION_FOUND'?'FINALIZED':code==='PREPARATION_RECOVERY_FAILED'?'PREPARE':'RECONCILING',deliveryCertainty:code==='RECONCILIATION_FOUND'?'CONFIRMED_SENT':'UNKNOWN',causeCode:code,recoveryAction,message,action,retry_allowed:false,submission_permitted:false};
}
class ReadInterrupted extends Error {constructor(readonly cancelled:boolean){super('RECOVERY_READ_INTERRUPTED');}}
async function bounded<T>(run:(signal:AbortSignal)=>Promise<T>,timeoutMs:number,clock:RecoveryClock,parent?:AbortSignal):Promise<T>{
 const controller=new AbortController();let cancelTimer:()=>void=()=>undefined;let onAbort:()=>void=()=>undefined;
 const interrupted=new Promise<never>((_resolve,reject)=>{
  onAbort=()=>{controller.abort();reject(new ReadInterrupted(true));};
  if(parent?.aborted){onAbort();return;}
  parent?.addEventListener('abort',onAbort,{once:true});
  cancelTimer=clock.timer(timeoutMs,()=>{controller.abort();reject(new ReadInterrupted(false));});
 });
 try{if(parent?.aborted)throw new ReadInterrupted(true);return await Promise.race([run(controller.signal),interrupted]);}
 finally{cancelTimer();parent?.removeEventListener('abort',onAbort);controller.abort();}
}
function verified(context:RecoveryContext,value:unknown,now:number,reservation:RecoveryReservation):VerifiedRecoveryEvidence|undefined{
 const parsed=evidenceSchema.safeParse(value);if(!parsed.success)return undefined;
 const e=parsed.data,url=new URL(e.publicUrl);
 if(e.provider!==context.provider||e.accountSha256!==context.accountSha256||e.packageSha256!==context.scope.packageSha256||e.bodySha256!==context.bodySha256||e.assetSha256!==context.assetSha256||e.publishedAtMs<context.publishedAfterMs||e.publishedAtMs>context.publishedBeforeMs||e.observedAtMs<reservation.startedAtMs||e.observedAtMs>now+5000||url.protocol!=='https:'||url.username||url.password||url.hash||url.search||url.port)return undefined;
 if(context.knownObjectId&&e.providerObjectId!==context.knownObjectId)return undefined;
 return e;
}
const readKinds=new Set(['FOUND','NOT_FOUND','COVERAGE_INCOMPLETE','AMBIGUOUS','PROVEN_NOT_SENT','TEMPORARY_UNAVAILABLE','PERMISSION_DENIED','APPROVAL_REVOKED','PACKAGE_CHANGED']);
/** Finite same-attempt READ ONLY operation. Ports/finalizer are app registrations, never schema/RPC arguments. */
export async function coordinateBrowserRecovery(input:RecoveryContext,deps:BrowserRecoveryDependencies):Promise<RecoveryOutcome>{
 const parsed=contextSchema.safeParse(input);
 if(!parsed.success||parsed.data.publishedBeforeMs<parsed.data.publishedAfterMs)return recoveryOutcome('RECOVERY_INPUT_INVALID');
 const context=parsed.data,port=deps.ports.get(context.provider);
 if(!port||!Number.isFinite(port.timeoutMs)||port.timeoutMs<=0)return recoveryOutcome('READBACK_CAPABILITY_UNAVAILABLE');
 const parent=deps.signal;let operationDeadline=deps.clock.now()+RECOVERY_LIMITS.deadlineMs;
 for(let iteration=0;iteration<RECOVERY_LIMITS.rounds;iteration++){
  if(parent?.aborted)return recoveryOutcome('RECONCILIATION_CANCELLED');
  let reserved;
  try{reserved=await bounded(()=>deps.repository.reserve(context.scope,deps.clock.now()),Math.max(1,operationDeadline-deps.clock.now()),deps.clock,parent);}
  catch(error:unknown){return recoveryOutcome(error instanceof ReadInterrupted?(error.cancelled?'RECONCILIATION_CANCELLED':'RECONCILIATION_BUDGET_EXHAUSTED'):'RECOVERY_CONFLICT');}
  if(reserved.kind==='held'&&reserved.outcome)return recoveryOutcome(reserved.outcome.code);
  if(reserved.kind!=='reserved')return recoveryOutcome(reserved.kind==='held'?'RECOVERY_IN_PROGRESS':reserved.kind==='finalized'?'RECONCILIATION_FOUND':reserved.kind==='legacy'?'RECOVERY_LEGACY_UNKNOWN':'RECONCILIATION_BUDGET_EXHAUSTED');
  const r=reserved.reservation;
  if(r.scope.projectId!==context.scope.projectId||r.scope.taskId!==context.scope.taskId||r.scope.attemptId!==context.scope.attemptId||r.scope.packageSha256!==context.scope.packageSha256||!Number.isFinite(r.startedAtMs)||!Number.isFinite(r.deadlineMs)||!Number.isInteger(r.round)||!Number.isInteger(r.requestsUsed)||r.requestsUsed<0)return recoveryOutcome('RECOVERY_CONFLICT');
  operationDeadline=Math.min(operationDeadline,r.deadlineMs,r.startedAtMs+RECOVERY_LIMITS.deadlineMs);
  let result:RecoveryOutcome;
  const remaining=Math.min(r.deadlineMs,r.startedAtMs+RECOVERY_LIMITS.deadlineMs)-deps.clock.now();
  if(r.round<1||r.round>RECOVERY_LIMITS.rounds||r.requestsUsed>=RECOVERY_LIMITS.requests||remaining<=0)result=recoveryOutcome('RECONCILIATION_BUDGET_EXHAUSTED');
  else {
   const offset=RECOVERY_LIMITS.roundOffsetsMs[r.round-1]??RECOVERY_LIMITS.deadlineMs;
   try{
    const wait=Math.max(0,r.startedAtMs+offset-deps.clock.now());
    if(wait>=remaining)result=recoveryOutcome('RECONCILIATION_BUDGET_EXHAUSTED');
    else {
     if(wait)await bounded(signal=>deps.clock.wait(wait,signal),Math.max(1,operationDeadline-deps.clock.now()),deps.clock,parent);
     const deadline=Math.min(r.deadlineMs,r.startedAtMs+RECOVERY_LIMITS.deadlineMs);
     const read=await bounded(async signal=>{
      let count=0;
      const control:RecoveryReadControl={signal,deadlineMs:deadline,maxRequests:Math.max(0,RECOVERY_LIMITS.requests-r.requestsUsed),takeRequest:async()=>{
       if(signal.aborted||deps.clock.now()>=deadline||count>=RECOVERY_LIMITS.requests-r.requestsUsed)return false;
       const allowed=await bounded(()=>deps.repository.takeRequest(r,deps.clock.now()),Math.max(1,deadline-deps.clock.now()),deps.clock,signal);
       if(allowed)count++;return allowed&&!signal.aborted;
      }};
      const raw=await port.read(context,control);
      if(!raw||typeof raw!=='object'||Array.isArray(raw))return {kind:'COVERAGE_INCOMPLETE'};
      const value=raw as Record<string,unknown>;
      if(typeof value.kind!=='string'||!readKinds.has(value.kind))return {kind:'COVERAGE_INCOMPLETE'};
      if(value.kind!=='FOUND')return {kind:value.kind};
      if(count===0)return {kind:'COVERAGE_INCOMPLETE'};
      return {kind:'FOUND',evidence:await port.verify(context,value.evidence,control)};
     },Math.max(1,Math.min(port.timeoutMs,30000,deadline-deps.clock.now())),deps.clock,parent);
     if(read.kind==='FOUND'){
      const evidence=verified(context,read.evidence,deps.clock.now(),r);
      if(!evidence)result=recoveryOutcome('RECONCILIATION_COVERAGE_INCOMPLETE');
      else {
       // Callback must atomically gate fact/attempt/recovery/audit with this reservation; never settle FOUND separately.
       try{
        const final=await bounded(signal=>deps.finalize(r,evidence,recoveryOutcome('RECONCILIATION_FOUND'),signal),Math.max(1,deadline-deps.clock.now()),deps.clock,parent);
        if(final==='finalized')return recoveryOutcome('RECONCILIATION_FOUND');
        result=recoveryOutcome(final==='approval_revoked'?'APPROVAL_REVOKED':final==='package_changed'?'PACKAGE_CHANGED':final==='permission_denied'?'PERMISSION_DENIED':'RECOVERY_CONFLICT');
       }catch{return recoveryOutcome(parent?.aborted?'RECONCILIATION_CANCELLED':'RECOVERY_CONFLICT');}
      }
     }else result=recoveryOutcome(read.kind==='NOT_FOUND'?'RECONCILIATION_NOT_FOUND':read.kind==='AMBIGUOUS'?'RECONCILIATION_AMBIGUOUS':read.kind==='TEMPORARY_UNAVAILABLE'?'RECONCILIATION_TEMPORARILY_UNAVAILABLE':read.kind==='PROVEN_NOT_SENT'?'RECONCILIATION_PROVEN_NOT_SENT':read.kind==='PERMISSION_DENIED'?'PERMISSION_DENIED':read.kind==='APPROVAL_REVOKED'?'APPROVAL_REVOKED':read.kind==='PACKAGE_CHANGED'?'PACKAGE_CHANGED':'RECONCILIATION_COVERAGE_INCOMPLETE');
    }
   }catch(error:unknown){result=recoveryOutcome(error instanceof ReadInterrupted&&error.cancelled?'RECONCILIATION_CANCELLED':'RECONCILIATION_TEMPORARILY_UNAVAILABLE');}
  }
  if(deps.clock.now()>=operationDeadline)return recoveryOutcome('RECONCILIATION_BUDGET_EXHAUSTED');
  if((['RECONCILIATION_NOT_FOUND','RECONCILIATION_TEMPORARILY_UNAVAILABLE'].includes(result.code)&&r.round>=RECOVERY_LIMITS.rounds))result=recoveryOutcome('RECONCILIATION_BUDGET_EXHAUSTED');
  let settled;
  try{settled=await bounded(()=>deps.repository.settle(r,result,deps.clock.now()),Math.max(1,Math.min(result.code==='RECONCILIATION_CANCELLED'?1000:5000,operationDeadline-deps.clock.now())),deps.clock);}catch{return recoveryOutcome('RECOVERY_CONFLICT');}
  if(settled!=='committed')return recoveryOutcome('RECOVERY_CONFLICT');
  if(!['RECONCILIATION_NOT_FOUND','RECONCILIATION_TEMPORARILY_UNAVAILABLE'].includes(result.code))return result;
  if(r.round>=RECOVERY_LIMITS.rounds)return recoveryOutcome('RECONCILIATION_BUDGET_EXHAUSTED');
 }
 return recoveryOutcome('RECONCILIATION_BUDGET_EXHAUSTED');
}

import {z} from 'zod';
import {browserDefaults,browserSnapshotSchema,hash,type BrowserDependencies,type BrowserRequest,type BrowserDb} from './browser_publication_contract';
import {createLegacyBrowserRecovery} from './legacy_browser_recovery';
import {legacyCustodyProof,legacyAbsenceProof,legacyClock,type LegacyBrowserSupervisor,type LegacyRecoveryContext} from './legacy_browser_recovery_contract';
import {createPreparationRecovery} from './browser_preparation_recovery';
import {preparationSerial} from './browser_preparation_storage';
import {requireNonDemoBrowserOwner} from './browser_recovery_owner';
import {browserReconcileSchema} from './browser_publication_confirmation';
import type {RecoveryClock,RecoveryReadControl} from './browser_recovery_contract';
import type {BrowserExecutorExpectation,BrowserExecutorRegistration} from './browser_executor_receipt';
import {browserExecutorRegistrationSchema} from './browser_executor_receipt';
import {issueOriginalExecutorChallenge,verifyOriginalExecutorChallenge,consumeOriginalExecutorChallenges} from './browser_executor_challenge_store';

type Scope={projectId:number;taskId:number;attemptId:number;actorId:string};
type Call={expected:BrowserExecutorExpectation;snapshot:BrowserRequest['snapshot'];signal:AbortSignal};
/** Implemented by a reviewed ORIGINAL runtime adapter, never supplied through MCP, env flags or a signed boolean.
 * verifyStop/verifyRead must validate authoritative native evidence, independently of the wrapper signature. */
export type OriginalExecutorSource={registration:BrowserExecutorRegistration;supports:(snapshot:BrowserRequest['snapshot'])=>boolean;
 stop:(call:Call)=>Promise<unknown>;verifyStop:(call:Call&{nativeEvidence:unknown})=>Promise<unknown>;
 read:(call:Call,control:RecoveryReadControl)=>Promise<unknown>;verifyRead:(call:Call&{nativeEvidence:unknown},control:RecoveryReadControl)=>Promise<unknown>};
const replySchema=z.object({envelope:z.unknown(),nativeEvidence:z.unknown()}).strict();
const quiescence=z.object({executorId:z.string().min(1),generation:z.number().int().nonnegative(),challengeSha256:z.string().regex(/^[a-f0-9]{64}$/),oldExecutorQuiescent:z.literal(true),evidenceRef:z.string().regex(/^sha256:[a-f0-9]{64}$/),failureKind:z.enum(['NETWORK_TEMPORARY','EXECUTOR_RESTART'])}).strict();
const readProof=z.union([legacyAbsenceProof,z.object({kind:z.literal('FOUND'),confirmation:browserReconcileSchema}).strict()]);
const unavailable=():never=>{throw new Error('[PRE_DISPATCH_PROOF_UNAVAILABLE]');};
function checked<T>(schema:z.ZodType<T>,input:unknown):T{const r=schema.safeParse(input);return r.success?r.data:unavailable();}
/** An absent native source stays absent. No native method, signer, transport or custody proof is fabricated here. */
export function createOriginalExecutorController(options:{deps?:BrowserDependencies;source?:OriginalExecutorSource;clock?:RecoveryClock}={}){
 const deps=options.deps??browserDefaults,clock=options.clock??legacyClock,candidate=options.source;
 const source=candidate&&browserExecutorRegistrationSchema.safeParse(candidate.registration).success
  &&[candidate.supports,candidate.stop,candidate.verifyStop,candidate.read,candidate.verifyRead].every(fn=>typeof fn==='function')?candidate:undefined;
 if(!source)return {legacy:createLegacyBrowserRecovery({deps,clock}),preparation:createPreparationRecovery({deps,now:clock.now})};
 async function context(s:Scope,purpose:BrowserExecutorExpectation['purpose'],challenge:string,deadlineMs:number,signal:AbortSignal,generation?:number):Promise<Call>{
  if(signal.aborted)return unavailable();
  const call=await deps.db.$transaction(async tx=>{
   await requireNonDemoBrowserOwner(tx,s);
   const row=await tx.browserDeliveryRecovery.findUnique({where:{project_id_attempt_id:{project_id:s.projectId,attempt_id:s.attemptId}}});
   const work=row?.work_item_id?await tx.workItem.findFirst({where:{id:row.work_item_id,project_id:s.projectId,content_item_id:s.taskId}}):null;
   const attempt=await tx.deliveryAttempt.findFirst({where:{id:s.attemptId,project_id:s.projectId,content_item_id:s.taskId,status:'pending'}});
   if(!row||row.content_item_id!==s.taskId||!work?.lease_token||!attempt?.idempotency_key||!row.deadline_at||work.lease_actor_id!==s.actorId
    ||(generation!==undefined&&row.execution_generation!==generation))return unavailable();
   const now=clock.now(),end=Math.min(deadlineMs,row.deadline_at.getTime(),now+(purpose==='profile_read'?30000:10000),
    purpose==='quiesce'?Infinity:row.recovery_lease_expires_at?.getTime()??0);
   if(end<=now)return unavailable();
   const pin=source!.registration;
   const expected:BrowserExecutorExpectation={projectId:s.projectId,taskId:s.taskId,attemptId:s.attemptId,workItemId:work.id,
    packageSha256:row.package_sha256,approvalSha256:row.approval_sha256,leaseSha256:hash(work.lease_token),attemptKeySha256:hash(attempt.idempotency_key),
    issuerId:pin.issuerId,runtimeSha256:pin.runtimeSha256,epochSha256:pin.epochSha256,contextSha256:pin.contextSha256,profileSha256:pin.profileSha256,nativeContractSha256:pin.nativeContractSha256,
    generation:row.execution_generation,challengeSha256:hash(challenge),purpose,issuedAtMs:now,expiresAtMs:end};
   return {expected,snapshot:browserSnapshotSchema.parse(row.original_snapshot),signal};
  },preparationSerial);
  const expected=await issueOriginalExecutorChallenge(deps,s,call.expected,source!.registration,clock.now());
  return {...call,expected};
 }
 async function stop(s:Scope,call:Call){
  const reply=checked(replySchema,await source!.stop(call));if(call.signal.aborted)return unavailable();
  const native=await source!.verifyStop({...call,nativeEvidence:reply.nativeEvidence});if(call.signal.aborted)return unavailable();
  if(call.expected.purpose==='fence_legacy'){
   const proof=checked(legacyCustodyProof,native);
   const ref=await verifyOriginalExecutorChallenge(deps,s,call.expected,source!.registration,reply.envelope,proof,clock.now());
   return {...proof,evidenceRef:ref};
  }
  const proof=checked(quiescence,native);
  const ref=await verifyOriginalExecutorChallenge(deps,s,call.expected,source!.registration,reply.envelope,proof,clock.now());
  return {...proof,evidenceRef:ref};
 }
 async function consumeLegacy(tx:BrowserDb,c:LegacyRecoveryContext){
  const row=await tx.browserDeliveryRecovery.findUnique({where:{project_id_attempt_id:{project_id:c.projectId,attempt_id:c.attemptId}}});
  if(!row)return unavailable();
  await consumeOriginalExecutorChallenges(tx,deps,{...c,generation:row.execution_generation,challengeSha256:hash(c.challenge)},['fence_legacy','profile_read'],clock.now());
 }
 const supervisor:LegacyBrowserSupervisor={executorId:source.registration.issuerId,supports:snapshot=>source.supports(snapshot),
  fenceLegacy:async c=>stop(c,await context(c,'fence_legacy',c.challenge,c.deadlineMs,c.signal)),
  quiesce:async q=>{
   const work=await deps.db.workItem.findFirst({where:{project_id:q.projectId,content_item_id:q.taskId,kind:'browser_publish',state:'claimed'}});
   if(!work?.lease_actor_id)return unavailable();const s={...q,actorId:work.lease_actor_id};
   const call=await context(s,'quiesce',q.challenge,q.deadlineMs,q.signal,q.generation);
   return checked(quiescence,await stop(s,call));
  },
  beforeQuiescenceCommit:async(tx,s)=>consumeOriginalExecutorChallenges(tx,deps,s,['quiesce'],clock.now())};
 const reader={supports:(snapshot:BrowserRequest["snapshot"])=>source.supports(snapshot),read:async(c:LegacyRecoveryContext,control:RecoveryReadControl)=>{
  const call=await context(c,'profile_read',c.challenge,control.deadlineMs,control.signal);
  const reply=checked(replySchema,await source.read(call,control));if(control.signal.aborted)return unavailable();
  const proof=checked(readProof,await source.verifyRead({...call,nativeEvidence:reply.nativeEvidence},control));if(control.signal.aborted)return unavailable();
  const ref=await verifyOriginalExecutorChallenge(deps,c,call.expected,source.registration,reply.envelope,proof,clock.now());
  return proof.kind==='ABSENT'?{...proof,evidenceRef:ref}:proof;
 }};
 return {legacy:createLegacyBrowserRecovery({deps,clock,supervisor,reader,beforeAdoptionCommit:consumeLegacy}),
  preparation:createPreparationRecovery({deps,supervisor,now:clock.now})};
}

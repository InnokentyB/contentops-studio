import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {hash,object,type BrowserDb,type BrowserDependencies} from './browser_publication_contract';
import {requireNonDemoBrowserOwner} from './browser_recovery_owner';
import {loadPreparationState} from './browser_recovery_resume_repository';
import {preparationLedger,type PreparationRequest} from './browser_preparation_contract';
import {preparationSerial} from './browser_preparation_storage';
import {browserRecoveryEnabled} from './browser_recovery_guard';
import {browserExecutorExpectationSchema,browserExecutorEvidenceSha256,verifyBrowserExecutorReceipt,type BrowserExecutorExpectation,type BrowserExecutorRegistration} from './browser_executor_receipt';

type Scope=Pick<PreparationRequest,'projectId'|'taskId'|'attemptId'|'actorId'>;
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const issued=z.object({version:z.literal(1),expectation:browserExecutorExpectationSchema,registration_sha256:sha}).strict();
const key=(e:BrowserExecutorExpectation)=>hash(JSON.stringify([e.taskId,e.attemptId,e.generation,e.purpose,e.challengeSha256]));
const where=(s:Scope,e:BrowserExecutorExpectation,command:string)=>({project_id:s.projectId,content_item_id:s.taskId,work_item_id:e.workItemId,actor_id:s.actorId,command,idempotency_key:key(e)});
const conflict=():never=>{throw new Error('[RECOVERY_CONFLICT]');};
/** Revalidates current authority/package and the existing reservation, not just stored signature bytes. */
async function current(tx:BrowserDb,deps:BrowserDependencies,s:Scope,e:BrowserExecutorExpectation,now:number){
 if(!browserRecoveryEnabled())throw new Error('[PRE_DISPATCH_PROOF_UNAVAILABLE]');
 await requireNonDemoBrowserOwner(tx,s);
 const state=await loadPreparationState(tx,deps,s);
 if(!state?.ownerAuthorized||!state.permissionAllowed)throw new Error('[PERMISSION_DENIED]');
 if(!state.approvalActive||state.originalApprovalSha256!==state.currentApprovalSha256)throw new Error('[APPROVAL_REVOKED]');
 if(state.packageSha256!==state.currentPackageSha256)throw new Error('[PACKAGE_CHANGED]');
 if(e.projectId!==s.projectId||e.taskId!==s.taskId||e.attemptId!==s.attemptId||e.generation!==state.executionGeneration
  ||e.workItemId!==state.workItemId||e.packageSha256!==state.packageSha256||e.approvalSha256!==state.originalApprovalSha256)return conflict();
 const row=await tx.browserDeliveryRecovery.findUnique({where:{project_id_attempt_id:{project_id:s.projectId,attempt_id:s.attemptId}}});
 const work=await tx.workItem.findFirst({where:{id:e.workItemId,project_id:s.projectId,content_item_id:s.taskId,state:'claimed',lease_actor_id:s.actorId}});
 const attempt=await tx.deliveryAttempt.findFirst({where:{id:s.attemptId,project_id:s.projectId,content_item_id:s.taskId,status:'pending'}});
 if(!row||!work?.lease_token||!attempt?.idempotency_key||hash(work.lease_token)!==e.leaseSha256||hash(attempt.idempotency_key)!==e.attemptKeySha256
  ||!row.deadline_at||now>=e.expiresAtMs||now<e.issuedAtMs||e.expiresAtMs>row.deadline_at.getTime())return conflict();
 if(e.purpose==='quiesce'){
  const stored=await tx.browserPreparationExecution.findUnique({where:{project_id_attempt_id:{project_id:s.projectId,attempt_id:s.attemptId}}});
  const ledger=preparationLedger.safeParse(stored?.ledger);
  if(row.stage!=='PREPARE'||!ledger.success||ledger.data.state!=='quiescing'||ledger.data.generation!==e.generation
   ||ledger.data.challengeSha256!==e.challengeSha256||ledger.data.permitIssued||ledger.data.dispatchStarted)return conflict();
 }else if(row.state!=='reading'||row.recovery_lease_sha256!==e.challengeSha256||!row.recovery_lease_expires_at
   ||e.expiresAtMs>row.recovery_lease_expires_at.getTime())return conflict();
}
async function pending(tx:BrowserDb,s:Scope,e:BrowserExecutorExpectation){
 const event=await tx.workflowEvent.findFirst({where:where(s,e,'browser_executor_challenge_issued')});
 const parsed=issued.safeParse(event?.after_state);if(!parsed.success)return conflict();
 if(await tx.workflowEvent.findFirst({where:where(s,e,'browser_executor_challenge_consumed')}))return conflict();
 return parsed.data;
}
/** Durable issuance keyed by existing generation/purpose/nonce; retries cannot extend its deadline or replace the pin. */
export async function issueOriginalExecutorChallenge(deps:BrowserDependencies,s:Scope,input:BrowserExecutorExpectation,pin:BrowserExecutorRegistration,now:number){
 const e=browserExecutorExpectationSchema.parse(input),registrationSha=browserExecutorEvidenceSha256(pin);
 return deps.db.$transaction(async tx=>{
  await current(tx,deps,s,e,now);
  const old=await tx.workflowEvent.findFirst({where:where(s,e,'browser_executor_challenge_issued')});
  if(old){const stored=await pending(tx,s,e);const same={...e,issuedAtMs:stored.expectation.issuedAtMs,expiresAtMs:stored.expectation.expiresAtMs};
   if(stored.registration_sha256!==registrationSha||!isDeepStrictEqual(same,stored.expectation))return conflict();
   await current(tx,deps,s,stored.expectation,now);return stored.expectation;}
  await tx.workflowEvent.create({data:{...where(s,e,'browser_executor_challenge_issued'),after_state:{version:1,expectation:e,registration_sha256:registrationSha}}});
  return e;
 },preparationSerial);
}
/** Native evidence was independently checked by the SOURCE port before authentication; this records hashes only. */
export async function verifyOriginalExecutorChallenge(deps:BrowserDependencies,s:Scope,e:BrowserExecutorExpectation,pin:BrowserExecutorRegistration,envelope:unknown,nativeProof:unknown,now:number){
 const verified=verifyBrowserExecutorReceipt(envelope,e,pin,now,browserExecutorEvidenceSha256(nativeProof));
 return deps.db.$transaction(async tx=>{
  await current(tx,deps,s,e,now);const stored=await pending(tx,s,e);
  if(!isDeepStrictEqual(stored.expectation,e)||stored.registration_sha256!==browserExecutorEvidenceSha256(pin))return conflict();
  const prior=await tx.workflowEvent.findFirst({where:where(s,e,'browser_executor_receipt_verified')});
  if(prior){if(object(prior.after_state).receipt_sha256!==verified.evidenceRef.slice(7))return conflict();return verified.evidenceRef;}
  await tx.workflowEvent.create({data:{...where(s,e,'browser_executor_receipt_verified'),after_state:{receipt_sha256:verified.evidenceRef.slice(7),native_evidence_sha256:browserExecutorEvidenceSha256(nativeProof)}}});
  return verified.evidenceRef;
 },preparationSerial);
}
/** MUST run in the caller's adoption/quiescence transaction; its audit/ledger failure also rolls back consumption. */
export async function consumeOriginalExecutorChallenges(tx:BrowserDb,deps:BrowserDependencies,s:Scope&{generation:number;challengeSha256:string},purposes:BrowserExecutorExpectation['purpose'][],now:number){
 for(const purpose of purposes){
  const events=await tx.workflowEvent.findMany({where:{project_id:s.projectId,content_item_id:s.taskId,actor_id:s.actorId,command:'browser_executor_challenge_issued'},take:101});
  if(events.length>100)return conflict();
  const matching=events.flatMap(event=>{const p=issued.safeParse(event.after_state);return p.success&&p.data.expectation.attemptId===s.attemptId&&p.data.expectation.generation===s.generation&&p.data.expectation.purpose===purpose&&p.data.expectation.challengeSha256===s.challengeSha256?[p.data.expectation]:[];});
  if(matching.length!==1)return conflict();const e=matching[0]!;
  await current(tx,deps,s,e,now);await pending(tx,s,e);
  const verified=await tx.workflowEvent.findFirst({where:where(s,e,'browser_executor_receipt_verified')});
  const digest=sha.safeParse(object(verified?.after_state).receipt_sha256);if(!digest.success)return conflict();
  await tx.workflowEvent.create({data:{...where(s,e,'browser_executor_challenge_consumed'),after_state:{attempt_id:s.attemptId,generation:s.generation,purpose,challenge_sha256:s.challengeSha256,receipt_sha256:digest.data,submission_permitted:false}}});
 }
}

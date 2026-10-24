import {z} from 'zod';
import {browserDefaults,hash,object,snapshotHash} from './browser_publication_contract';
import {requireNonDemoBrowserOwner} from './browser_recovery_owner';
import {browserRecoveryEnabled} from './browser_recovery_guard';
import {recoveryOutcome} from './browser_recovery_coordinator';
import {projectBrowserRecovery} from './browser_recovery_assessment';
import {createPreparationRecovery} from './browser_preparation_recovery';
import {browserReconcileSchema,finalizeBrowserRecoverySubmission} from './browser_publication_confirmation';
import {preparationSerial} from './browser_preparation_storage';
import {loadLegacyBrowserScope} from './legacy_browser_recovery_scope';
import {reserveLegacyBrowser,commitLegacyPreparation} from './legacy_browser_recovery_state';
import {legacyRecoveryRequest,legacyCustodyProof,legacyAbsenceProof,legacyClock,legacyBounded,type LegacyRecoveryOptions,type LegacyRecoveryRequest,type LegacyRecoveryContext} from './legacy_browser_recovery_contract';
import type {RecoveryReadControl} from './browser_recovery_contract';
import publicationFactService from './publication_fact.service';
/** Safe static result shared by control handlers and persisted status projection. */
export function legacyBrowserOutcome(code:string){
 const base=code==='PRE_DISPATCH_PROOF_UNAVAILABLE'?projectBrowserRecovery({code})!:recoveryOutcome(code);
 return {...base,resumed:false,submission_permitted:false as const,retry_allowed:false as const};
}
function failure(error:unknown){
 if(error instanceof z.ZodError)return legacyBrowserOutcome('RECOVERY_INPUT_INVALID');
 const raw=error instanceof Error?/^\[([A-Z_]+)\]/.exec(error.message)?.[1]:undefined;
 const code=raw==='OWNER_REQUIRED'?'PERMISSION_DENIED':raw==='STALE_MANIFEST'||raw==='BROWSER_SNAPSHOT_MISMATCH'||raw==='BROWSER_IDENTITY_INVALID'?'PACKAGE_CHANGED':raw==='BROWSER_RELEASE_PROOF_INVALID'||raw==='BROWSER_RELEASE_AUDIT_REQUIRED'?'APPROVAL_REVOKED':raw??'RECOVERY_CONFLICT';
 return legacyBrowserOutcome(code);
}
/** Application-only registration, no provider login, new sender, background sweep or admission by environment switch. */
export function createLegacyBrowserRecovery(options:LegacyRecoveryOptions={}){
 const deps=options.deps??browserDefaults,clock=options.clock??legacyClock;
 const missing=(snapshot:LegacyRecoveryContext['snapshot'])=>!options.supervisor||!options.supervisor.supports(snapshot)?'LEGACY_BROWSER_SUPERVISOR_UNAVAILABLE':!options.reader||!options.reader.supports(snapshot)?'LEGACY_BROWSER_READER_UNAVAILABLE':!browserRecoveryEnabled()?'READBACK_CAPABILITY_UNAVAILABLE':null;
 async function completed(args:LegacyRecoveryRequest){
  return deps.db.$transaction(async tx=>{
   await requireNonDemoBrowserOwner(tx,args);
   const row=await tx.browserDeliveryRecovery.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId,attempt_id:args.attemptId,state:'finalized'}});
   if(!row)return null;
   const marker=await tx.workflowEvent.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:row.work_item_id,command:'legacy_browser_adoption_started'}});
   const fact=await tx.publicationFact.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId}});
   if(object(marker?.after_state).adoption_contract_version!==1||object(marker?.after_state).attempt_id!==args.attemptId||!fact||fact.project_id!==args.projectId)throw new Error('[RECOVERY_CONFLICT]');
   return {...legacyBrowserOutcome('RECONCILIATION_FOUND'),replayed:true,publication_fact_id:fact.id,public_url:fact.public_url,mutates_state:false};
  },preparationSerial);
 }
 async function preview(input:unknown){
  try{
   const args=legacyRecoveryRequest.parse(input),done=await completed(args);if(done)return done;
   const scope=await deps.db.$transaction(tx=>loadLegacyBrowserScope(tx,deps,args,clock.now()),preparationSerial);
   return {...legacyBrowserOutcome(missing(scope.request.snapshot)??'LEGACY_BROWSER_VERIFICATION_REQUIRED'),attempt_id:args.attemptId,work_item_id:scope.work.id,provider:scope.request.snapshot.identity.platform,mutates_state:false};
  }catch(error:unknown){return failure(error);}
 }
 async function adopt(input:unknown){
  let settle:(code:string)=>Promise<boolean>=async()=>true;
  try{
   const args=legacyRecoveryRequest.parse(input),done=await completed(args);if(done)return done;
   const inspected=await deps.db.$transaction(tx=>loadLegacyBrowserScope(tx,deps,args,clock.now()),preparationSerial);
   const unavailable=missing(inspected.request.snapshot);if(unavailable)return legacyBrowserOutcome(unavailable);
   const supervisor=options.supervisor!,reader=options.reader!;
   const reserved=await reserveLegacyBrowser(deps,args,supervisor.executorId,clock);
   if(reserved.kind==='resumed')return {...await createPreparationRecovery({deps,supervisor,now:clock.now}).recover({...args,idempotencyKey:reserved.operationKey})};
   if(reserved.kind==='finalized')return legacyBrowserOutcome('RECONCILIATION_FOUND');
   if(reserved.kind==='held')return legacyBrowserOutcome(reserved.code);
   const {value,repository}=reserved,{context:c,reservation:r}=value;
   settle=async code=>(await repository.settle(r,legacyBrowserOutcome(code),clock.now()))==='committed';
   const proof=legacyCustodyProof.safeParse(await legacyBounded(clock,Math.min(r.deadlineMs,clock.now()+10000),signal=>supervisor.fenceLegacy({...c,signal})));
   if(!proof.success||proof.data.projectId!==c.projectId||proof.data.taskId!==c.taskId||proof.data.attemptId!==c.attemptId||proof.data.workItemId!==c.workItemId||proof.data.executorId!==supervisor.executorId||proof.data.packageSha256!==c.packageSha256||proof.data.approvalSha256!==c.approvalSha256||proof.data.oldLeaseSha256!==c.oldLeaseSha256||proof.data.challengeSha256!==hash(c.challenge))throw new Error('[PRE_DISPATCH_PROOF_UNAVAILABLE]');
   let requests=0;
   const read=await legacyBounded(clock,Math.min(r.deadlineMs,clock.now()+30000),async signal=>{
    const control:RecoveryReadControl={signal,deadlineMs:r.deadlineMs,maxRequests:20-r.requestsUsed,takeRequest:async()=>{
     if(signal.aborted||clock.now()>=r.deadlineMs)return false;
     const allowed=await repository.takeRequest(r,clock.now());if(allowed)requests++;return allowed&&!signal.aborted;
    }};
    return reader.read(c,control);
   });
   if(requests===0)throw new Error('[RECONCILIATION_COVERAGE_INCOMPLETE]');
   if(object(read).kind==='FOUND'){
    const found=z.object({kind:z.literal('FOUND'),confirmation:browserReconcileSchema}).strict().parse(read).confirmation;
    if(found.projectId!==c.projectId||found.taskId!==c.taskId||found.attemptId!==c.attemptId||found.workItemId!==c.workItemId||found.actorId!==c.actorId||found.idempotencyKey!==c.attemptKey||found.approvalReference!==c.approvalReference||snapshotHash(found.snapshot)!==c.packageSha256)throw new Error('[RECONCILIATION_COVERAGE_INCOMPLETE]');
    await legacyBounded(clock,r.deadlineMs,signal=>finalizeBrowserRecoverySubmission(found,r,signal,deps,args=>publicationFactService.record({...args,beforeWrite:async tx=>{await loadLegacyBrowserScope(tx,deps,c,clock.now());await args.beforeWrite?.(tx);}})));
    return {...legacyBrowserOutcome('RECONCILIATION_FOUND'),mutates_state:true};
   }
   const absence=legacyAbsenceProof.safeParse(read);
   if(!absence.success){const kind=object(read).kind;const code=kind==='TEMPORARY_UNAVAILABLE'?'RECONCILIATION_TEMPORARILY_UNAVAILABLE':kind==='AMBIGUOUS'?'RECONCILIATION_AMBIGUOUS':kind==='PERMISSION_DENIED'?'PERMISSION_DENIED':kind==='APPROVAL_REVOKED'?'APPROVAL_REVOKED':kind==='PACKAGE_CHANGED'?'PACKAGE_CHANGED':'RECONCILIATION_COVERAGE_INCOMPLETE';throw new Error(`[${code}]`);}
   const e=absence.data;
   if(e.projectId!==c.projectId||e.taskId!==c.taskId||e.attemptId!==c.attemptId||e.packageSha256!==c.packageSha256||e.accountSha256!==hash(JSON.stringify(c.snapshot.identity))||e.challengeSha256!==hash(c.challenge)||e.observedAtMs<r.startedAtMs||e.observedAtMs>clock.now()+5000)throw new Error('[RECONCILIATION_COVERAGE_INCOMPLETE]');
   await commitLegacyPreparation(deps,value,supervisor.executorId,hash(JSON.stringify({custody:proof.data.evidenceRef,readback:e.evidenceRef,challenge:hash(c.challenge)})),clock);
   settle=async()=>true;
   return {...await createPreparationRecovery({deps,supervisor,now:clock.now}).recover({...args,idempotencyKey:value.operationKey}),mutates_state:true};
  }catch(error:unknown){
   const result=failure(error);
   try{if(!await settle(result.code))return legacyBrowserOutcome('RECOVERY_CONFLICT');}
   catch{return legacyBrowserOutcome('RECOVERY_CONFLICT');}
   return result;
  }
 }
 return {preview,adopt,available:()=>Boolean(options.supervisor&&options.reader&&browserRecoveryEnabled())};
}
export type LegacyBrowserRecovery=ReturnType<typeof createLegacyBrowserRecovery>;

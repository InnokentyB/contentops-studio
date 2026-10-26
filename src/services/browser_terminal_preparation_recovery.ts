import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {browserDefaults,browserSnapshotSchema,hash,object,type BrowserDependencies} from './browser_publication_contract';
import {requireNonDemoBrowserOwner} from './browser_recovery_owner';
import {loadLegacyBrowserScope} from './legacy_browser_recovery_scope';
import {preparationSerial} from './browser_preparation_storage';
import {preparationLedger,type PreparationSupervisor} from './browser_preparation_contract';
import {createPreparationRecovery} from './browser_preparation_recovery';
import {terminalScope} from './browser_terminal_evidence_contract';
import {requireTerminalPrincipal} from './browser_terminal_principal';
import {verifyTerminalEvidence} from './browser_terminal_evidence_verifier';
import {assertBrowserLease} from './browser_publication_guard';
import {browserConfirmSchema,browserReconcileSchema,reconcileBrowserSubmission} from './browser_publication_confirmation';
import {createTerminalOwnerReview} from './browser_terminal_owner_review';
const intakeCommand='browser_terminal_execution_evidence',adoptCommand='browser_terminal_preparation_adopted',executorId='owner-reviewed-terminal-cua-v1';
type Options={deps?:BrowserDependencies;clock?:()=>number};
const evidenceRecord=z.object({evidence_class:z.literal('OWNER_VERIFIED_TERMINAL_OPERATIONS_V1'),evidence_sha256:z.string(),package_sha256:z.string(),approval_sha256:z.string(),publisher_actor_sha256:z.string(),old_lease_sha256:z.string(),original_key_sha256:z.string(),attempt_id:z.number(),work_item_id:z.number(),created_at_ms:z.number(),expires_at_ms:z.number()}).passthrough();
/** Owner intake and one-use adoption; continuation reuses the original attempt's standard permit/fact FSM. */
export function createTerminalPreparationRecovery(options:Options={}){
 const deps=options.deps??browserDefaults,now=options.clock??Date.now;
 const supervisor:PreparationSupervisor={executorId,supports:s=>s.identity.platform==='linkedin',quiesce:async()=>{throw new Error('[TERMINAL_FRESH_SOURCE_REQUIRED] Obtain a new complete original-operation review before another transfer.');}};
 const continuation=createPreparationRecovery({deps,supervisor,now});
 const ownerReview=createTerminalOwnerReview(deps,now);
 const principal=(input:unknown,projectId:number,owner=false)=>requireTerminalPrincipal(input,projectId,owner?'owner':'publisher');
 async function capture(input:unknown,caller:unknown){
  const args=terminalScope.extend({evidence:z.unknown()}).strict().parse(input),p=principal(caller,args.projectId,true),scope={projectId:args.projectId,taskId:args.taskId,attemptId:args.attemptId,actorId:p.actorId,idempotencyKey:args.idempotencyKey};
  return deps.db.$transaction(async tx=>{
   const loaded=await loadLegacyBrowserScope(tx,deps,scope,now());
   if(loaded.request.snapshot.manifestChecksum!==args.expectedManifestChecksum)throw new Error('[TERMINAL_PACKAGE_CHANGED]');
   const evidence=verifyTerminalEvidence(args.evidence,{...scope,workItemId:loaded.work.id,keySha256:hash(loaded.attempt.idempotency_key!),leaseSha256:loaded.oldLeaseSha256,snapshotSha256:loaded.packageSha256,approvalSha256:loaded.approvalSha256,publisherActorSha256:hash(loaded.work.lease_actor_id??''),createdAtMs:loaded.attempt.created_at.getTime(),snapshot:loaded.request.snapshot},now());
   const record=await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:loaded.work.id,actor_id:p.actorId,command:intakeCommand,idempotency_key:args.idempotencyKey,after_state:evidence}});
   return {evidence_id:record.id,submission_permitted:false};
  },preparationSerial);
 }
 async function recover(input:unknown,caller:unknown){
  const args=terminalScope.extend({evidenceId:z.number().int().positive()}).strict().parse(input),p=principal(caller,args.projectId,true),scope={projectId:args.projectId,taskId:args.taskId,attemptId:args.attemptId,actorId:p.actorId,idempotencyKey:args.idempotencyKey};
  return deps.db.$transaction(async tx=>{
   await requireNonDemoBrowserOwner(tx,scope);
   const prior=await tx.workflowEvent.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId,actor_id:p.actorId,command:adoptCommand,idempotency_key:args.idempotencyKey}});
   if(prior){const a=object(prior.after_state);if(a.evidence_id!==args.evidenceId||a.attempt_id!==args.attemptId||a.manifest_checksum!==args.expectedManifestChecksum)throw new Error('[TERMINAL_REPLAY_CONFLICT]');return {resumed:true,generation:1,replayed:true,submission_permitted:false};}
   const loaded=await loadLegacyBrowserScope(tx,deps,scope,now());
   if(loaded.row||loaded.request.snapshot.manifestChecksum!==args.expectedManifestChecksum)throw new Error('[TERMINAL_PACKAGE_CHANGED]');
   const event=await tx.workflowEvent.findFirst({where:{id:args.evidenceId,project_id:args.projectId,content_item_id:args.taskId,work_item_id:loaded.work.id,actor_id:p.actorId,command:intakeCommand}}),parsed=evidenceRecord.safeParse(event?.after_state);
   if(!parsed.success)throw new Error('[TERMINAL_EVIDENCE_REQUIRED]');const e=parsed.data,time=now(),deadline=e.expires_at_ms;
   if(e.attempt_id!==args.attemptId||e.package_sha256!==loaded.packageSha256||e.approval_sha256!==loaded.approvalSha256||e.publisher_actor_sha256!==hash(loaded.work.lease_actor_id??'')||e.work_item_id!==loaded.work.id||e.old_lease_sha256!==loaded.oldLeaseSha256||e.original_key_sha256!==hash(loaded.attempt.idempotency_key!)||deadline<=time||e.created_at_ms>time)throw new Error('[TERMINAL_EVIDENCE_STALE]');
   const consumed=await tx.workflowEvent.count({where:{project_id:args.projectId,content_item_id:args.taskId,command:adoptCommand,after_state:{path:['evidence_id'],equals:args.evidenceId}}});
   if(consumed)throw new Error('[TERMINAL_EVIDENCE_CONSUMED]');
   const publisherActor=loaded.work.lease_actor_id;
   if(!publisherActor||!/^user:[1-9]\d*$/.test(publisherActor))throw new Error('[TERMINAL_ORIGINAL_PUBLISHER_REQUIRED]');
   await requireNonDemoBrowserOwner(tx,{projectId:args.projectId,actorId:publisherActor});
   const leaseToken=`lease-${randomUUID()}`,leaseExpiresAt=new Date(Math.min(time+120000,deadline)),generation=1;
   const changed=await tx.workItem.updateMany({where:{id:loaded.work.id,project_id:args.projectId,content_item_id:args.taskId,state:'claimed',lease_actor_id:publisherActor,lease_token:loaded.work.lease_token,lease_expires_at:{lte:new Date(time)}},data:{lease_token:leaseToken,lease_actor_id:publisherActor,lease_expires_at:leaseExpiresAt}});
   if(changed.count!==1)throw new Error('[TERMINAL_LEASE_CONFLICT]');
   await tx.browserDeliveryRecovery.create({data:{project_id:args.projectId,content_item_id:args.taskId,attempt_id:args.attemptId,work_item_id:loaded.work.id,package_sha256:loaded.packageSha256,approval_sha256:loaded.approvalSha256,original_snapshot:loaded.request.snapshot,execution_generation:generation,stage:'PREPARE',delivery_certainty:'NOT_DISPATCHED',state:'resumed',cause_code:'TERMINAL_PRE_PERMIT_VERIFIED',recovery_action:'CONTINUE_SAME_ATTEMPT_AFTER_REPAIR',rounds:1,requests_used:0,started_at:new Date(time),deadline_at:new Date(deadline),recovery_lease_sha256:hash(leaseToken),recovery_lease_expires_at:leaseExpiresAt}});
   const ledger=preparationLedger.parse({version:1,projectId:args.projectId,taskId:args.taskId,attemptId:args.attemptId,workItemId:loaded.work.id,executorSha256:hash(executorId),generation,revision:0,state:'queued',resumptions:1,startedAtMs:time,deadlineMs:deadline,operationSha256:hash(JSON.stringify({...scope,actorId:publisherActor})),challengeSha256:hash(randomUUID()),proofSha256:e.evidence_sha256,outbox:'pending',permitIssued:false,dispatchStarted:false});
   await tx.browserPreparationExecution.create({data:{project_id:args.projectId,attempt_id:args.attemptId,content_item_id:args.taskId,work_item_id:loaded.work.id,ledger}});
   await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:loaded.work.id,actor_id:p.actorId,command:adoptCommand,idempotency_key:args.idempotencyKey,after_state:{evidence_class:e.evidence_class,evidence_id:args.evidenceId,attempt_id:args.attemptId,generation,manifest_checksum:args.expectedManifestChecksum,evidence_sha256:e.evidence_sha256,lease_sha256:hash(leaseToken),publisher_actor_sha256:hash(publisherActor),submission_permitted:false}}});
   return {resumed:true,generation,submission_permitted:false};
  },preparationSerial);
 }
 function continued(input:unknown,caller:unknown):Record<string,unknown>&{projectId:number;actorId:string}{
  const a=z.object({projectId:z.number().int().positive()}).passthrough().parse(input),p=principal(caller,a.projectId);
  if(a.actorId!==undefined&&a.actorId!==p.actorId)throw new Error('[TERMINAL_OWNER_REQUIRED] The submitted actor differs from the authenticated Publisher.');
  return {...a,actorId:p.actorId};
 }
 async function generation(input:unknown){
  const a=z.object({projectId:z.number().int().positive(),taskId:z.number().int().positive(),attemptId:z.number().int().positive()}).passthrough().parse(input);
  const stored=await deps.db.browserPreparationExecution.findFirst({where:{project_id:a.projectId,content_item_id:a.taskId,attempt_id:a.attemptId}}),parsed=preparationLedger.safeParse(stored?.ledger);
  return parsed.success&&parsed.data.projectId===a.projectId&&parsed.data.taskId===a.taskId&&parsed.data.attemptId===a.attemptId&&parsed.data.executorSha256===hash(executorId)?parsed.data.generation:null;
 }
 return {...ownerReview,capture,recover,generation,pickup:async(input:unknown,caller:unknown)=>{
   const a=terminalScope.extend({generation:z.number().int().positive()}).parse(input),p=principal(caller,a.projectId);
   const stored=await deps.db.browserDeliveryRecovery.findFirst({where:{project_id:a.projectId,content_item_id:a.taskId,attempt_id:a.attemptId}}),snapshot=browserSnapshotSchema.safeParse(stored?.original_snapshot);
   if(!snapshot.success||snapshot.data.manifestChecksum!==a.expectedManifestChecksum)throw new Error('[TERMINAL_PACKAGE_CHANGED]');
   return continuation.pickup({projectId:a.projectId,taskId:a.taskId,attemptId:a.attemptId,idempotencyKey:a.idempotencyKey,actorId:p.actorId,generation:a.generation});},
  preSubmit:(input:unknown,generation:number,caller:unknown)=>continuation.preSubmit(continued(input,caller),generation),
  beginDispatch:(input:unknown,generation:number,caller:unknown)=>continuation.dispatch(continued(input,caller),generation,async()=>({dispatch_authorized:true,submission_result:'UNKNOWN'})),
  uncertain:(input:unknown,caller:unknown)=>continuation.operation(continued(input,caller)),
  confirm:async(input:unknown,generation:number,caller:unknown)=>{
   const observed=continued(input,caller);
   const {leaseToken:omittedLease,...confirmation}=observed,args=browserReconcileSchema.parse(confirmation);
   const done=await deps.db.browserDeliveryRecovery.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId,attempt_id:args.attemptId,execution_generation:generation,state:'finalized'}});
   if(done){
    const audit=await deps.db.workflowEvent.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:args.workItemId,actor_id:args.actorId,idempotency_key:args.idempotencyKey,command:'ba_reconcile_browser_submission'}});
    if(!audit)throw new Error('[TERMINAL_REPLAY_CONFLICT]');return reconcileBrowserSubmission(args,deps);
   }
   if(observed.leaseToken!==undefined){
    const leased=browserConfirmSchema.parse(observed);
    const work=await deps.db.workItem.findFirst({where:{id:leased.workItemId,project_id:leased.projectId,content_item_id:leased.taskId}});
    if(!work)throw new Error('[TERMINAL_LEASE_CONFLICT]');assertBrowserLease(work,leased);
   }
   return continuation.confirm(confirmation,generation);
  }};
}

import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { BrowserDependencies,browserDefaults,hash,object,requireBrowserOwner,browserPrior } from './browser_publication_contract';
import { browserClaimSchema,browserBoundarySchema,browserObservedSchema,checkedBrowserRelease,
    assertBrowserLease,checkedBrowserAttempt,assertBrowserObserved,browserObservationHash } from './browser_publication_guard';
import { assertBrowserNativeAdmission,requireBrowserNativeGate,type NativeGate } from './browser_publication_native';
const serial={isolationLevel:Prisma.TransactionIsolationLevel.Serializable};

/** Claim only a released item. Before an attempt, an expired lease may be reclaimed; after start it cannot. */
export async function claimBrowserPublication(input:unknown,deps:BrowserDependencies=browserDefaults) {
    const args=browserClaimSchema.parse(input),command='ba_claim_browser_publication';
    return deps.db.$transaction(async tx=>{
        const {task,work}=await checkedBrowserRelease(tx,args,deps);
        if(await tx.deliveryAttempt.count({where:{project_id:args.projectId,content_item_id:args.taskId}}))
            throw new Error('[BROWSER_RECONCILIATION_REQUIRED]');
        if(task.status!=='browser_required')throw new Error('[BROWSER_NOT_CLAIMABLE]');
        const prior=await browserPrior(tx,args,command),now=new Date();
        if(prior){
            if(work.state!=='claimed'||work.lease_actor_id!==args.actorId||!work.lease_token||!work.lease_expires_at||work.lease_expires_at<=now
                ||prior.lease_sha256!==hash(work.lease_token)||prior.lease_expires_at!==work.lease_expires_at.toISOString())
                throw new Error('[BROWSER_ACTIVE_LEASE_REQUIRED]');
            return{work_item_id:work.id,lease_token:work.lease_token,lease_expires_at:work.lease_expires_at.toISOString(),replayed:true};
        }
        const lease=`lease-${randomUUID()}`,expires=new Date(now.getTime()+(args.leaseSeconds||900)*1000);
        const changed=await tx.workItem.updateMany({where:{id:work.id,project_id:args.projectId,content_item_id:args.taskId,
            OR:[{state:'available'},{state:'claimed',lease_expires_at:{lt:now}}]},
            data:{state:'claimed',lease_actor_id:args.actorId,lease_token:lease,lease_expires_at:expires}});
        if(changed.count!==1)throw new Error('[BROWSER_WORK_ALREADY_CLAIMED]');
        await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:work.id,
            actor_id:args.actorId,command,idempotency_key:args.idempotencyKey,
            before_state:{request_hash:hash(JSON.stringify(args))},after_state:{lease_sha256:hash(lease),lease_expires_at:expires.toISOString()}}});
        return{work_item_id:work.id,lease_token:lease,lease_expires_at:expires.toISOString(),replayed:false};
    },serial);
}
/** Durable attempt before provider interaction. Starting does not itself permit clicking Submit. */
export async function startBrowserSubmission(input:unknown,deps:BrowserDependencies=browserDefaults,nativeGate?:NativeGate) {
    const args=browserBoundarySchema.parse(input),command='ba_start_browser_submission';
    assertBrowserNativeAdmission(args,nativeGate);
    return deps.db.$transaction(async tx=>{
        await requireBrowserOwner(tx,args);
        const prior=await browserPrior(tx,args,command);
        if(prior)return{...prior,submission_permitted:false,retry_allowed:false};
        const {task,work}=await checkedBrowserRelease(tx,args,deps);assertBrowserLease(work,args);
        if(task.status!=='browser_required'||await tx.deliveryAttempt.count({where:{project_id:args.projectId,content_item_id:args.taskId}}))
            throw new Error('[BROWSER_RECONCILIATION_REQUIRED]');
        await requireBrowserNativeGate(tx,'start',args,nativeGate);
        const attempt=await tx.deliveryAttempt.create({data:{project_id:args.projectId,content_item_id:args.taskId,
            channel_id:args.snapshot.channelId,mode:'assisted',status:'pending',attempt_number:1,
            idempotency_key:args.idempotencyKey,scheduled_at:task.schedule_at,requires_manual_confirmation:true}});
        const changed=await tx.contentItem.updateMany({where:{id:args.taskId,project_id:args.projectId,
            status:'browser_required',content_revision:args.snapshot.contentRevision,publication_mode:'browser_required'},data:{status:'publishing'}});
        if(changed.count!==1)throw new Error('[BROWSER_START_CAS_CONFLICT]');
        const result={status:'started',attempt_id:attempt.id,submission_permitted:false,retry_allowed:false,replayed:false};
        await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:work.id,
            actor_id:args.actorId,command,idempotency_key:args.idempotencyKey,
            before_state:{request_hash:hash(JSON.stringify(args))},after_state:result}});
        return result;
    },serial);
}
/** One permission from actual pre-submit observations. Lost/replayed response never grants another click. */
export async function preSubmitBrowserSubmission(input:unknown,deps:BrowserDependencies=browserDefaults,nativeGate?:NativeGate) {
    const args=browserObservedSchema.parse(input),command='ba_pre_submit_browser_submission';
    assertBrowserNativeAdmission(args,nativeGate);
    return deps.db.$transaction(async tx=>{
        const {task,work}=await checkedBrowserRelease(tx,args,deps);assertBrowserLease(work,args);
        if(task.status!=='publishing')throw new Error('[BROWSER_NOT_STARTED]');
        const attempt=await checkedBrowserAttempt(tx,args);
        if(attempt.error_message)throw new Error('[BROWSER_RECONCILIATION_REQUIRED]');
        assertBrowserObserved(task.draft_text!,args);
        const prior=await browserPrior(tx,args,command);if(prior)return{...prior,submission_permitted:false,retry_allowed:false};
        await requireBrowserNativeGate(tx,'permit',args,nativeGate);
        const proof={attempt_id:attempt.id,work_item_id:work.id,lease_sha256:hash(args.leaseToken),
            observation_sha256:browserObservationHash(args),evidence_sha256:args.evidenceSha256,
            permit_expires_at:new Date(Math.min(work.lease_expires_at!.getTime(),Date.now()+(args.snapshot.identity.platform==='x'?15000:30000))).toISOString(),
            submission_permitted:true,retry_allowed:false,assurance:'executor_observation_not_independent_provider_proof'};
        await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:work.id,
            actor_id:args.actorId,command,idempotency_key:args.idempotencyKey,
            before_state:{request_hash:hash(JSON.stringify(args))},after_state:proof}});
        return{...proof,replayed:false};
    },serial);
}
export const browserUncertainSchema=browserBoundarySchema.safeExtend({attemptId:z.number().int().positive(),
    reasonCode:z.enum(['PROVIDER_RESULT_UNCERTAIN','PRE_SUBMIT_REJECTED','BROWSER_UNAVAILABLE'])});
/** Freeze after lost result, including expired leases; no resend or synthetic fact. */
export async function markBrowserSubmissionUncertain(input:unknown,deps:BrowserDependencies=browserDefaults,nativeGate?:NativeGate) {
    const args=browserUncertainSchema.parse(input),command='ba_mark_browser_submission_uncertain';
    assertBrowserNativeAdmission(args,nativeGate);
    return deps.db.$transaction(async tx=>{
        await requireBrowserOwner(tx,args);const {task,work}=await checkedBrowserRelease(tx,args,deps);
        if(task.status!=='publishing'||work.lease_actor_id!==args.actorId||hash(work.lease_token||'')!==hash(args.leaseToken))
            throw new Error('[BROWSER_ATTEMPT_SCOPE_MISMATCH]');
        const prior=await browserPrior(tx,args,command);if(prior)return prior;
        await checkedBrowserAttempt(tx,args);
        await requireBrowserNativeGate(tx,'unknown',args,nativeGate);
        const changed=await tx.deliveryAttempt.updateMany({where:{id:args.attemptId,project_id:args.projectId,
            content_item_id:args.taskId,status:'pending',idempotency_key:args.idempotencyKey},
            data:{requires_manual_confirmation:true,error_message:args.reasonCode}});
        if(changed.count!==1)throw new Error('[BROWSER_UNCERTAIN_CAS_CONFLICT]');
        const result={attempt_id:args.attemptId,state:'reconciliation_required',submission_permitted:false,retry_allowed:false};
        await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:work.id,
            actor_id:args.actorId,command,idempotency_key:args.idempotencyKey,
            before_state:{request_hash:hash(JSON.stringify(args))},after_state:{...result,reason_code:args.reasonCode}}});
        return result;
    },serial);
}

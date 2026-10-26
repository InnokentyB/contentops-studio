import { Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { browserMetadataRepairContext } from './browser_publication_metadata';
import { browserRequestSchema, BrowserDependencies, browserDefaults, checkedBrowserContext,
    browserPrior, browserCas, browserFingerprint, snapshotHash, hash, object,
    noBrowserDelivery, requireBrowserOwner, canonicalBrowserProfile } from './browser_publication_contract';

function ready(task:{status:string;publication_mode:string|null;publication_fact:unknown;published_link:string|null}):void {
    if(task.status!=='ready_for_execution'||task.publication_mode!=='approval_required'||task.publication_fact||task.published_link)
        throw new Error('[BROWSER_NOT_RELEASE_READY]');
}
/** Read-only owner preview. No state, attempt, provider call or send authority. */
export async function inspectBrowserPublication(input:unknown,deps:BrowserDependencies=browserDefaults) {
    const args=browserRequestSchema.parse(input);
    return deps.db.$transaction(async tx=>{
        const task=await checkedBrowserContext(tx,args,deps);
        return {project_id:args.projectId,task_id:args.taskId,channel_id:task.channel_id,
            snapshot:args.snapshot,status:task.status,publication_mode:task.publication_mode,
            content_language:object(task.quality_report).content_language||null,
            handoff_language:object(object(task.quality_report).handoff_bundle).content_language||null,
            publication_authorized:false,provider_called:false,mutates_state:false,
            assurance:'Owner-adopted Registry metadata; provider identity and durable asset bytes still require executor readback.'};
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
/** Audited task-only metadata repair; accepted copy/visual/date/channel records are immutable. */
export async function repairBrowserPublicationMetadata(input:unknown,deps:BrowserDependencies=browserDefaults) {
    const args=browserRequestSchema.parse(input),command='ba_repair_browser_publication_metadata';
    return deps.db.$transaction(async tx=>{
        await requireBrowserOwner(tx,args);const prior=await browserPrior(tx,args,command);if(prior)return prior;
        const context=await browserMetadataRepairContext(tx,args,deps),{task,handoff}=context;
        ready(task);await noBrowserDelivery(tx,args);
        const quality=object(task.quality_report);
        const binding={snapshot_sha256:snapshotHash(args.snapshot),identity:args.snapshot.identity,
            verification_basis:'owner_adopted_registry_binding',provider_identity_verified:false,
            audit_command:command,audit_idempotency_key:args.idempotencyKey,actor_id:args.actorId};
        const result={project_id:args.projectId,task_id:args.taskId,identity_binding:binding,
            content_language:args.snapshot.contentLanguage,applied:args.apply,
            handoff_materialization:{eligible:context.materialize,applied:context.materialize&&args.apply,
                basis:context.materialize?'verified_accepted_durable_fields':null,
                mismatches:context.mismatches,body_sha256:args.snapshot.bodySha256,asset_sha256:args.snapshot.assetSha256},
            publication_authorized:false,provider_called:false,replayed:false};
        if(!args.apply)return result;
        if(quality.browser_identity_binding&&!isDeepStrictEqual(object(quality.browser_identity_binding).identity,binding.identity))
            throw new Error('[BROWSER_IDENTITY_BINDING_CONFLICT]');
        const changed=await tx.contentItem.updateMany({where:browserCas(task),data:{quality_report:{...quality,
            content_language:args.snapshot.contentLanguage,browser_identity_binding:binding,
            handoff_bundle:{...handoff,content_language:args.snapshot.contentLanguage}} as Prisma.InputJsonValue}});
        if(changed.count!==1)throw new Error('[BROWSER_METADATA_CAS_CONFLICT]');
        await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,actor_id:args.actorId,
            command,idempotency_key:args.idempotencyKey,before_state:{request_hash:hash(JSON.stringify(args)),
                missing_handoff_bundle:context.materialize},
            after_state:result as Prisma.InputJsonValue}});
        return result;
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
/** Owner-only dynamic release. Creates one revision-bound browser item, never a delivery attempt. */
export async function releaseBrowserPublication(input:unknown,deps:BrowserDependencies=browserDefaults) {
    const args=browserRequestSchema.parse(input),command='ba_release_browser_publication';
    return deps.db.$transaction(async tx=>{
        await requireBrowserOwner(tx,args);const prior=await browserPrior(tx,args,command);if(prior)return prior;
        const task=await checkedBrowserContext(tx,args,deps);ready(task);await noBrowserDelivery(tx,args);
        const quality=object(task.quality_report),binding=object(quality.browser_identity_binding);
        if(binding.snapshot_sha256!==snapshotHash(args.snapshot)||quality.content_language!==args.snapshot.contentLanguage
            ||object(quality.handoff_bundle).content_language!==args.snapshot.contentLanguage)
            throw new Error('[BROWSER_METADATA_REPAIR_REQUIRED]');
        const audit=await tx.workflowEvent.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId,
            actor_id:String(binding.actor_id),command:'ba_repair_browser_publication_metadata',
            idempotency_key:String(binding.audit_idempotency_key)}});
        if(object(audit?.after_state).applied!==true
            ||JSON.stringify(object(audit?.after_state).identity_binding)!==JSON.stringify(binding))
            throw new Error('[BROWSER_AUDITED_IDENTITY_REQUIRED]');
        const proof={lifecycle:'shared_browser_v1',publication_authorized:true,
            snapshot:args.snapshot,snapshot_sha256:snapshotHash(args.snapshot),
            fingerprint:browserFingerprint(task,args.snapshot),actor_id:args.actorId,
            release_key:args.idempotencyKey,
            approval_reference:args.approvalReference,target_profile_url:canonicalBrowserProfile(args.snapshot.identity),
            provider_identity_verified:false,released_at:new Date().toISOString()};
        const preview={project_id:args.projectId,task_id:args.taskId,channel_id:task.channel_id,
            snapshot:args.snapshot,publication_authorized:args.apply,applied:args.apply,
            submission_permitted:false,provider_called:false,published:false,replayed:false};
        if(!args.apply)return preview;
        const changed=await tx.contentItem.updateMany({where:browserCas(task),data:{status:'browser_required',
            publication_mode:'browser_required',quality_report:{...quality,publication_route:'browser_required',
                browser_release:proof} as Prisma.InputJsonValue}});
        if(changed.count!==1)throw new Error('[BROWSER_RELEASE_CAS_CONFLICT]');
        const work=await tx.workItem.create({data:{project_id:args.projectId,content_item_id:args.taskId,
            week_package_id:task.week_package_id,item_key:task.item_key||`publication-${args.taskId}`,
            kind:'browser_publish',state:'available',assignee_role:'browser_publisher',due_at:task.schedule_at,
            reason_code:'OWNER_RELEASED_BROWSER_PUBLICATION',input_context_version:args.snapshot.contentRevision,
            dedupe_key:`shared-browser:${args.projectId}:${args.taskId}:r${args.snapshot.contentRevision}`,
            result_payload:proof as Prisma.InputJsonValue}});
        const result={...preview,browser_work_item_id:work.id};
        await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:work.id,
            actor_id:args.actorId,command,idempotency_key:args.idempotencyKey,
            before_state:{request_hash:hash(JSON.stringify(args))},after_state:result as Prisma.InputJsonValue}});
        return result;
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}

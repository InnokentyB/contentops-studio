import {assertManualPublicationTransportMutable} from './owner_manual_publication_fence';
import type {Prisma} from '@prisma/client';
import {ownedLegacyCommitted,ownedLegacyReceipt} from './owned_publication_legacy';
import {ownedClaimSchema,ownedDigest,ownedHash,ownedObject as object,checkedOwnedReceipt,ownedPackageSchema} from './owned_publication_contract';
import type {OwnedPublicationClaim as Claim,OwnedPublicationRequest as Request,OwnedPublicationPrincipal as Principal,OwnedPublicationReceipt as Receipt,OwnedPublicationResult as Result} from './owned_publication_contract';
import {ownedActor,ownedAudit,ownedPrincipal,ownedLock,ownedSnapshot,ownedExpected} from './owned_publication_guard';
import type {OwnedPublicationDependencies as Dependencies} from './owned_publication_guard';
/** Canonical immutable claim validation; independent of mutable eligibility or role. */
export async function ownedCommitted(tx:Prisma.TransactionClient,c:Claim){
    if(c.origin==='legacy_native_v1')return ownedLegacyCommitted(tx,c);
    const scope={project_id:c.package.projectId,content_item_id:c.package.taskId};
    const event=await tx.workflowEvent.findFirst({where:{...scope,actor_id:ownedActor,command:'owned_publication.claim',idempotency_key:c.key}});
    const retained=ownedClaimSchema.parse(object(event?.after_state).claim);
    const {nativeObjectId:readbackObject,...input}=ownedClaimSchema.parse(c);
    if(JSON.stringify(retained)!==JSON.stringify(input)||ownedDigest(retained.package)!==retained.package.digest)throw Error('OWNED_CLAIM_CONFLICT');
    const attempt=await tx.deliveryAttempt.findFirst({where:{...scope,id:c.attemptId,channel_id:c.package.channelId,idempotency_key:c.key,mode:'automatic'}});
    if(!attempt)throw Error('OWNED_ATTEMPT_NOT_FOUND');return {claim:retained,attempt};
}
/** Aggregate admission/recovery fence; deliberately excluded from immutable receipt custody. */
export async function ownedUniqueHistory(tx:Prisma.TransactionClient,c:Claim){
    const scope={project_id:c.package.projectId,content_item_id:c.package.taskId};
    const [attempts,jobs,work,claims]=await Promise.all([
        tx.deliveryAttempt.findMany({where:scope}),tx.connectorDispatchJob.findMany({where:scope}),
        tx.workItem.findMany({where:{...scope,kind:{in:['browser_publish','provider_publish']}}}),
        tx.workflowEvent.findMany({where:{...scope,OR:[{command:'owned_publication.claim'},{command:{endsWith:':claim'}},{command:{endsWith:'_claim'}}]}})
    ]);
    if(attempts.length!==1||attempts[0].id!==c.attemptId||attempts[0].idempotency_key!==c.key
        ||jobs.length!==(c.jobId?1:0)||c.jobId&&jobs[0]?.id!==c.jobId
        ||work.length!==(c.workItemId?1:0)||c.workItemId&&work[0]?.id!==c.workItemId||claims.length!==1)throw Error('OWNED_HISTORY_AMBIGUOUS');
}
export async function ownedCurrent(tx:Prisma.TransactionClient,r:Request,p:Principal,d:Dependencies,c:Claim){
    await ownedPrincipal(tx,r,p);await ownedLock(tx,r);await assertManualPublicationTransportMutable(tx,r);
    if(r.projectId!==c.package.projectId||r.taskId!==c.package.taskId||r.idempotencyKey!==c.key)throw Error('OWNED_CLAIM_CONFLICT');
    const retained=await ownedCommitted(tx,c);await ownedUniqueHistory(tx,c);const current=await ownedSnapshot(tx,{...r,operation:'publish'},p,d,c);
    const compared: Array<keyof typeof current>=['projectId','taskId','channelId','revision','decisionId','decisionVersion','selectedAssetId','bodySha256','assetSha256','schedule','manifest','accountId','body','title','assetUrl','approvalReference','releaseActorId','releaseId'];
    if(compared.some(key=>current[key]!==c.package[key])||c.origin!=='legacy_native_v1'&&current.digest!==c.package.digest)throw Error('OWNED_PACKAGE_CONFLICT');
    if(r.operation!=='reconcile')ownedExpected(r,c.origin==='legacy_native_v1'?c.package:current);
    if(c.jobId){
        const job=await tx.connectorDispatchJob.findFirst({where:{id:c.jobId,project_id:r.projectId,content_item_id:r.taskId,
            binding:{path:['protocol'],equals:'owned_provider_v1'}}});
        if(!job||object(job.binding).provider!==c.package.provider||job.attempt_id!==c.attemptId||job.work_item_id!==c.workItemId
            ||JSON.stringify(ownedPackageSchema.parse(object(job.binding).package))!==JSON.stringify(ownedPackageSchema.parse(c.package))
            ||job.package_sha256!==c.package.digest||job.generation!==c.generation||job.canonical_lease_sha256!==c.leaseSha256)throw Error('OWNED_JOB_CONFLICT');
        return {...retained,job};
    }
    return {...retained,job:null};
}
export async function ownedStage(tx:Prisma.TransactionClient,c:Claim,kind:'started'|'submit_consumed'){
    const e=await tx.workflowEvent.findFirst({where:{project_id:c.package.projectId,content_item_id:c.package.taskId,actor_id:c.origin==='legacy_native_v1'?`system:planner-mcp:dzen-task${c.package.taskId}`:ownedActor,
        command:c.origin==='legacy_native_v1'?`${c.eventNamespace}:started`:`owned_publication.${kind}`,idempotency_key:String(c.attemptId)}});
    if(object(e?.after_state).package_digest!==c.package.digest||c.origin!=='legacy_native_v1'&&object(e?.after_state).generation!==c.generation)throw Error('OWNED_STAGE_REQUIRED');
}
export async function ownedReceipt(tx:Prisma.TransactionClient,c:Claim,now:Date):Promise<Receipt|null>{
    const e=await tx.workflowEvent.findFirst({where:{project_id:c.package.projectId,content_item_id:c.package.taskId,actor_id:ownedActor,
        command:'owned_publication.receipt',idempotency_key:String(c.attemptId)}});
    if(!e&&c.origin==='legacy_native_v1'){const {attempt}=await ownedLegacyCommitted(tx,c);const old=await ownedLegacyReceipt(tx,c);return old?checkedOwnedReceipt(old,c,attempt.created_at,now):null;}
    if(!e)return null;
    const {attempt}=await ownedCommitted(tx,c);const r=checkedOwnedReceipt(object(e.after_state).receipt,c,attempt.created_at,now);
    const submit=await tx.workflowEvent.findFirst({where:{project_id:c.package.projectId,content_item_id:c.package.taskId,actor_id:ownedActor,command:'owned_publication.submit_consumed',idempotency_key:String(c.attemptId)}});
    if(object(submit?.after_state).object_id!==r.objectId||object(submit?.after_state).account_id!==r.accountId)throw Error('OWNED_OBJECT_CONFLICT');
    if(object(e.after_state).receipt_digest!==ownedHash(JSON.stringify(r)))throw Error('OWNED_RECEIPT_CONFLICT');return r;
}
export async function ownedCanonical(tx:Prisma.TransactionClient,c:Claim,r:Receipt):Promise<Result|null>{
    const fact=await tx.publicationFact.findFirst({where:{project_id:c.package.projectId,content_item_id:c.package.taskId}});
    if(!fact)return null;
    if(fact.channel_id!==c.package.channelId||fact.artifact_kind!=='article'||fact.outcome!=='published'||fact.public_url!==r.url
        ||fact.provider_object_id!==r.objectId||fact.published_at?.toISOString()!==r.publishedAt||fact.confirmation_mode!=='automatic'
        ||fact.evidence_type!=='api'||fact.evidence_ref!==r.objectId)throw Error('OWNED_FACT_CONFLICT');
    const {attempt}=await ownedCommitted(tx,c);
    const e=await tx.workflowEvent.findFirst({where:{project_id:c.package.projectId,content_item_id:c.package.taskId,actor_id:c.origin==='legacy_native_v1'?`system:planner-mcp:dzen-task${c.package.taskId}`:ownedActor,
        command:c.origin==='legacy_native_v1'?`${c.eventNamespace}:completed`:'owned_publication.completed',idempotency_key:String(c.attemptId)}});
    if(attempt.status!=='delivered'||object(e?.after_state).package_digest!==c.package.digest)throw Error('OWNED_COMPLETION_CONFLICT');
    if(c.jobId){const job=await tx.connectorDispatchJob.findFirst({where:{id:c.jobId,project_id:c.package.projectId,content_item_id:c.package.taskId,binding:{path:['protocol'],equals:'owned_provider_v1'}}});if(job?.publication_fact_id!==fact.id||job.state!=='confirmed'||job.attempt_id!==c.attemptId||job.generation!==c.generation)throw Error('OWNED_JOB_FACT_CONFLICT');}
    return {state:'published',project_id:c.package.projectId,task_id:c.package.taskId,attempt_id:c.attemptId,retry_allowed:false,published_link:r.url,external_id:r.objectId};
}
export async function ownedComplete(tx:Prisma.TransactionClient,r:Request,p:Principal,d:Dependencies,c:Claim,receipt:Receipt){
    await ownedCurrent(tx,r,p,d,c);await ownedStage(tx,c,'submit_consumed');
    const proof=await ownedReceipt(tx,c,d.now?.()||new Date());if(!proof||JSON.stringify(proof)!==JSON.stringify(receipt))throw Error('OWNED_RECEIPT_CONFLICT');
    if(await ownedCanonical(tx,c,receipt))return;
    const changed=await tx.deliveryAttempt.updateMany({where:{project_id:r.projectId,id:c.attemptId,content_item_id:r.taskId,
        idempotency_key:c.key,status:'verification_required'},data:{status:'delivered',actual_published_at:new Date(receipt.publishedAt),requires_manual_confirmation:false,error_message:null}});
    if(changed.count!==1)throw Error('OWNED_ATTEMPT_CONFLICT');
    if(c.jobId){const changedJob=await tx.connectorDispatchJob.updateMany({where:{id:c.jobId,...{project_id:r.projectId,content_item_id:r.taskId},
        attempt_id:c.attemptId,generation:c.generation,canonical_lease_sha256:c.leaseSha256,binding:{path:['protocol'],equals:'owned_provider_v1'}},data:{state:'confirmed',blocker_code:null}});
        if(changedJob.count!==1)throw Error('OWNED_JOB_CONFLICT');}
    if(c.workItemId)await tx.workItem.updateMany({where:{id:c.workItemId,project_id:r.projectId,content_item_id:r.taskId},data:{state:'completed'}});
    if(c.origin==='legacy_native_v1')await tx.workflowEvent.create({data:{project_id:c.package.projectId,content_item_id:c.package.taskId,actor_id:`system:planner-mcp:dzen-task${c.package.taskId}`,command:`${c.eventNamespace}:completed`,idempotency_key:String(c.attemptId),after_state:{package_digest:c.package.digest,attempt_id:c.attemptId,public_url:receipt.url,actor_id:p.actorId}}});
    else await ownedAudit(tx,c.package,'completed',String(c.attemptId),{package_digest:c.package.digest,attempt_id:c.attemptId,public_url:receipt.url,actor_id:p.actorId});
}

/** Fact ID is available only after the canonical write, within that same transaction. */
export async function ownedLinkFact(tx:Prisma.TransactionClient,c:Claim,factId:number){
    if(!c.jobId)return;
    const fact=await tx.publicationFact.findFirst({where:{id:factId,project_id:c.package.projectId,content_item_id:c.package.taskId,channel_id:c.package.channelId,outcome:'published'}});
    if(!fact)throw Error('OWNED_FACT_CONFLICT');
    const changed=await tx.connectorDispatchJob.updateMany({where:{id:c.jobId,project_id:c.package.projectId,content_item_id:c.package.taskId,
        binding:{path:['protocol'],equals:'owned_provider_v1'},state:'confirmed',attempt_id:c.attemptId,generation:c.generation,canonical_lease_sha256:c.leaseSha256,
        OR:[{publication_fact_id:null},{publication_fact_id:factId}]},data:{publication_fact_id:factId}});
    if(changed.count!==1)throw Error('OWNED_JOB_FACT_CONFLICT');
}

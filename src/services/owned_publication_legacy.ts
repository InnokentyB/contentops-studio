import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {ownedHash,ownedObject as object,ownedPackageSchema,ownedReceiptSchema} from './owned_publication_contract';
import type {OwnedPublicationClaim as Claim,OwnedPublicationPackage as Package,OwnedPublicationRequest as Request,OwnedPublicationReceipt as Receipt} from './owned_publication_contract';
const sha=z.string().regex(/^[a-f0-9]{64}$/),id=z.number().int().positive();
// Historical protocol decoding only. No concrete business IDs or execution authority.
const legacyPackage=z.object({projectId:id,taskId:id,channelId:id,revision:id,decisionId:id,decisionVersion:id,selectedAssetId:id,
    bodySha256:sha,assetSha256:sha,schedule:z.string().datetime(),manifest:z.string().min(1),releaseId:id,accountId:z.string().min(1),
    body:z.string().min(1).max(50000),title:z.string().min(1).max(1000),assetUrl:z.string().url().startsWith('https://'),digest:sha}).strict();
export async function ownedLegacyRelease(tx:Prisma.TransactionClient,r:Request){
    const events=await tx.workflowEvent.findMany({where:{project_id:r.projectId,content_item_id:r.taskId,OR:[
        {command:{startsWith:'ba_release_dzen_task'}},{command:'ba_release_approved_dzen_task'},{command:{startsWith:'ba_release_approved_dzen_task'}}]},orderBy:{id:'desc'}});
    return events.find(e=>object(e.after_state).task_id===r.taskId)||null;
}
export function ownedLegacyReleaseProof(e:{id:number;actor_id:string;before_state:unknown;after_state:unknown},p:Package){
    const proof=object(e.after_state),before=object(e.before_state);
    if(before.manifest_checksum!==p.manifest||e.id!==p.releaseId||e.actor_id!==p.releaseActorId||before.approval_reference!==p.approvalReference
        ||proof.task_id!==p.taskId||proof.channel_id!==p.channelId||proof.content_revision!==p.revision||proof.accepted_revision!==p.revision
        ||proof.body_sha256!==p.bodySha256||proof.visual_decision_id!==p.decisionId||proof.visual_decision_version!==p.decisionVersion
        ||proof.selected_asset_id!==p.selectedAssetId||proof.asset_sha256!==p.assetSha256||proof.schedule_at!==p.schedule
        ||proof.publish_at!==p.schedule||proof.publication_mode!=='owner_released')throw Error('OWNED_LEGACY_RELEASE_CONFLICT');
}
/** Recovery never materializes a replacement job or attempt for legacy history. */
export async function ownedLegacyClaim(tx:Prisma.TransactionClient,r:Request):Promise<Claim|null>{
    if(!r.attemptId||!r.idempotencyKey)return null;
    const attempt=await tx.deliveryAttempt.findFirst({where:{id:r.attemptId,project_id:r.projectId,content_item_id:r.taskId,idempotency_key:r.idempotencyKey}});
    if(!attempt)return null;
    const events=await tx.workflowEvent.findMany({where:{project_id:r.projectId,content_item_id:r.taskId,idempotency_key:r.idempotencyKey,actor_id:`system:planner-mcp:dzen-task${r.taskId}`,command:`ba_publish_dzen_task${r.taskId}:claim`}});
    if(events.length!==1)return null;
    const e=events[0],state=object(e.after_state);const raw=legacyPackage.parse(state.package),{digest,...material}=raw;
    const match=/^(ba_publish_dzen_task\d+):claim$/.exec(e.command);
    if(!match||match[1]!==`ba_publish_dzen_task${r.taskId}`||e.actor_id!==`system:planner-mcp:dzen-task${r.taskId}`
        ||state.attempt_id!==attempt.id||raw.projectId!==r.projectId||raw.taskId!==r.taskId||raw.channelId!==attempt.channel_id
        ||ownedHash(JSON.stringify(material))!==digest||ownedHash(raw.body)!==raw.bodySha256||state.release_id!==raw.releaseId)throw Error('OWNED_LEGACY_CLAIM_CONFLICT');
    const release=await tx.workflowEvent.findFirst({where:{id:raw.releaseId,project_id:r.projectId,content_item_id:r.taskId}});
    const approval=object(release?.before_state).approval_reference;
    if(!release||release.actor_id!==state.actor_id||typeof approval!=='string')throw Error('OWNED_LEGACY_RELEASE_CONFLICT');
    const pkg=ownedPackageSchema.parse({...raw,protocol:'owned_provider_v1',provider:'dzen',approvalReference:approval,releaseActorId:release.actor_id});
    ownedLegacyReleaseProof(release,pkg);
    return {attemptId:attempt.id,key:r.idempotencyKey,package:pkg,generation:0,jobId:null,workItemId:null,leaseSha256:null,eventNamespace:match[1],origin:'legacy_native_v1'};
}
export async function ownedLegacyCommitted(tx:Prisma.TransactionClient,c:Claim){
    const retained=await ownedLegacyClaim(tx,{projectId:c.package.projectId,taskId:c.package.taskId,attemptId:c.attemptId,idempotencyKey:c.key});
    if(!retained)throw Error('OWNED_LEGACY_CLAIM_CONFLICT');
    const {nativeObjectId:ignored,...input}=c;if(JSON.stringify(retained)!==JSON.stringify(input))throw Error('OWNED_LEGACY_CLAIM_CONFLICT');
    const attempt=await tx.deliveryAttempt.findUnique({where:{id:c.attemptId}});if(!attempt)throw Error('OWNED_ATTEMPT_NOT_FOUND');return {claim:retained,attempt};
}
export async function ownedLegacyReceipt(tx:Prisma.TransactionClient,c:Claim):Promise<Receipt|null>{
    if(!c.eventNamespace)return null;
    const e=await tx.workflowEvent.findFirst({where:{project_id:c.package.projectId,content_item_id:c.package.taskId,actor_id:`system:planner-mcp:dzen-task${c.package.taskId}`,command:`${c.eventNamespace}:receipt`,idempotency_key:String(c.attemptId)}});
    if(!e)return null;
    const raw=object(object(e.after_state).receipt);const schema=raw.schemaVersion;
    if(typeof schema!=='string'||!/^dzen\d+-native-v1$/.test(schema)||schema!==`dzen${c.package.taskId}-native-v1`)throw Error('OWNED_LEGACY_RECEIPT_CONFLICT');
    const {schemaVersion:ignored,...payload}=raw;
    // The original strict receipt's property order is the historical digest protocol.
    const original={schemaVersion:schema,attemptId:payload.attemptId,key:payload.key,packageDigest:payload.packageDigest,accountId:payload.accountId,
        objectId:payload.objectId,url:payload.url,publishedAt:payload.publishedAt,observedAt:payload.observedAt,bodySha256:payload.bodySha256,assetSha256:payload.assetSha256,title:payload.title};
    if(Object.keys(raw).length!==Object.keys(original).length||object(e.after_state).receipt_digest!==ownedHash(JSON.stringify(original)))throw Error('OWNED_LEGACY_RECEIPT_CONFLICT');
    return ownedReceiptSchema.parse({...payload,schemaVersion:'owned-provider-receipt-v1',generation:0});
}

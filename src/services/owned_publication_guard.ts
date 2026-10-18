import {Prisma,PrismaClient} from '@prisma/client';
import type {RecordPublicationFactArgs} from './publication_fact.service';
import {isDzenPublicationPlatform} from './vk_publication_route_contract';
import {ownedLegacyRelease} from './owned_publication_legacy';
import {ownedDigest,ownedHash,ownedObject as object,ownedPackageSchema,OWNED_PROTOCOL,OWNED_PROVIDER,OWNED_RELEASE_OPERATION,NO_VISUAL_DECISION} from './owned_publication_contract';
import type {OwnedPublicationPackage as Package,OwnedPublicationPrincipal as Principal,OwnedPublicationRequest as Request,OwnedPublicationClaim as Claim} from './owned_publication_contract';
export const ownedSerial={isolationLevel:Prisma.TransactionIsolationLevel.Serializable} as const;
export const ownedActor='system:planner-owned-publication';
export interface OwnedPublicationDependencies{db:PrismaClient;manifest:(projectId:number,userId:number,tx?:Prisma.TransactionClient)=>Promise<{checksum:string}>;
    facts:{record(args:RecordPublicationFactArgs):Promise<unknown>};now?:()=>Date}
export async function ownedLock(tx:Prisma.TransactionClient,r:Request){
    const rows=await tx.$queryRaw<Array<{id:number}>>`SELECT id FROM planner.content_items WHERE project_id=${r.projectId} AND id=${r.taskId} FOR UPDATE`;
    if(rows.length!==1)throw Error('OWNED_TASK_NOT_FOUND');
}
export async function ownedPrincipal(tx:Prisma.TransactionClient,r:Request,p:Principal,owner=false){
    if(!p||p.projectId!==r.projectId||!Number.isSafeInteger(p.userId)||p.userId<1||p.actorId!==`user:${p.userId}`
        ||!['owner','publisher'].includes(p.profile))throw Error('OWNED_PRINCIPAL_REQUIRED');
    const m=await tx.projectMember.findUnique({where:{project_id_user_id:{project_id:r.projectId,user_id:p.userId}}});
    if(!m||!['owner','editor'].includes(m.role)||(owner&&(m.role!=='owner'||p.profile!=='owner')))throw Error('OWNED_OWNER_REQUIRED');
}
export function ownedExpected(r:Request,p:Package){
    if(r.expectedAcceptedRevision!==p.revision||r.expectedPackageSha256!==p.digest||r.expectedManifestChecksum!==p.manifest)throw Error('OWNED_PACKAGE_CONFLICT');
}
export async function ownedReleaseEvent(tx:Prisma.TransactionClient,r:Request){
    return await tx.workflowEvent.findFirst({where:{project_id:r.projectId,content_item_id:r.taskId,command:'owned_publication.release'},orderBy:{id:'desc'}})||await ownedLegacyRelease(tx,r);
}
export async function ownedSnapshot(tx:Prisma.TransactionClient,r:Request,p:Principal,d:OwnedPublicationDependencies,claim?:Claim):Promise<Package>{
    await ownedPrincipal(tx,r,p,r.operation===OWNED_RELEASE_OPERATION);
    const task=await tx.contentItem.findFirst({where:{project_id:r.projectId,id:r.taskId},include:{channel:true,selected_asset:true}});
    const release=await ownedReleaseEvent(tx,r);const prior=object(object(release?.after_state).package);
    const legacyApproval=object(release?.before_state).approval_reference;
    const approval=(r.operation===OWNED_RELEASE_OPERATION?r.approvalReference:prior.approvalReference||legacyApproval)||(r.dryRun!==false?'PENDING_OWNER_APPROVAL':undefined);
    const releaseActor=r.operation===OWNED_RELEASE_OPERATION?p.actorId:prior.releaseActorId||release?.actor_id||p.actorId;
    const decision=task?await tx.artDirectionDecision.findFirst({where:{project_id:r.projectId,content_item_id:r.taskId,source_content_revision:task.content_revision,
        decision_version:task.visual_decision_version,placement:'article_cover',channel:OWNED_PROVIDER,status:'active'}}):null;
    const asset=task?.selected_asset;const provenance=object(asset?.provenance);const sha=object(provenance.planner_storage).sha256||provenance.sha256;
    const account=object(task?.channel?.config).channel_id;const hold=object(task?.quality_report);
    const legacyState=object(hold.publication_task_delivery).state;
    if(!claim&&(task?.published_link||hold.provider_result_uncertain||hold.dzen_publish_claim||hold.dzen_publication_pending
        ||['provider_call_started','provider_result_uncertain','provider_confirmed_fact_pending'].includes(String(legacyState))
        ||object(hold.retirement).provider_result_uncertain))throw Error('OWNED_HISTORICAL_OUTCOME_REQUIRES_RECONCILIATION');
    if(!task||task.channel?.project_id!==r.projectId||!isDzenPublicationPlatform(task.channel.type)||!task.channel.is_active||typeof account!=='string'||!account
        ||task.content_revision!==task.accepted_revision||task.content_revision<1||task.text_state!=='accepted'||task.handoff_state!=='ready'
        ||r.operation!==OWNED_RELEASE_OPERATION&&release&&task.publication_mode!=='owner_released'
        ||task.visual_state!=='APPROVED'||task.visual_placement!=='article_cover'||!decision||decision.decision===NO_VISUAL_DECISION
        ||asset?.project_id!==r.projectId||asset.content_item_id!==task.id||asset.content_revision!==task.content_revision||asset.decision_id!==decision.id
        ||asset.status!=='approved'||!asset.file_url||typeof sha!=='string'||!task.title?.trim()||!task.draft_text?.trim()
        ||!task.schedule_at||task.schedule_at.toISOString()!==task.publish_at?.toISOString()||hold.publication_hold
        ||typeof approval!=='string'||!approval.trim()||typeof releaseActor!=='string'
        ||(!claim&&!['ready_for_execution','published'].includes(task.status))
        ||(claim&&!['publishing','published'].includes(task.status)))throw Error('OWNED_PACKAGE_NOT_ELIGIBLE');
    const url=new URL(asset.file_url);if(url.protocol!=='https:'||url.username||url.password)throw Error('OWNED_ASSET_URL_INVALID');
    const manifest=await d.manifest(r.projectId,p.userId,tx);
    const candidate:Package={protocol:OWNED_PROTOCOL,provider:'dzen',projectId:r.projectId,taskId:r.taskId,channelId:task.channel.id,revision:task.content_revision,
        decisionId:decision.id,decisionVersion:decision.decision_version,selectedAssetId:asset.id,bodySha256:ownedHash(task.draft_text),assetSha256:sha,
        schedule:task.schedule_at.toISOString(),manifest:manifest.checksum,accountId:account,body:task.draft_text,title:task.title,assetUrl:asset.file_url,
        approvalReference:approval,releaseActorId:releaseActor,digest:'0'.repeat(64),releaseId:release?.id||null};
    candidate.digest=ownedDigest(candidate);return ownedPackageSchema.parse(candidate);
}
export async function ownedAudit(tx:Prisma.TransactionClient,p:Package,kind:string,key:string,after:Prisma.InputJsonObject){
    return tx.workflowEvent.create({data:{project_id:p.projectId,content_item_id:p.taskId,actor_id:ownedActor,command:`owned_publication.${kind}`,idempotency_key:key,after_state:after}});
}
export function ownedJobWhere(p:Package){return{project_id:p.projectId,content_item_id:p.taskId,binding:{path:['protocol'],equals:OWNED_PROTOCOL}};}

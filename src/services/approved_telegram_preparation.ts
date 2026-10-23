import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import prisma from '../db';
import {currentPublicationPrincipal} from '../mcp/publication-principal';
import {PublicationDiagnosticError} from './publication_diagnostics';
import {assertOwnedPublicationMutable,hasLegacyPublicationUncertainty,lockOwnedPublicationTask} from './publication_owned_guard';
import {assertVisualReassessmentReady,VisualDecisionCode} from './visual_reassessment_binding';
import {getVisualStorageIngestState} from './visual_storage_incident.service';
import {isServerResolvableVisualUrl} from './visual_asset_binding.service';
import {publicationContentLanguage} from './content_language.service';
import {loadPublicationPlanContext} from './mcp_publication/plans';
import planService from './publication_plan.service';
import adapter from './publication_adapter.service';
import {safePreparationBundle} from './publication_preparation_bundle';

type PreparationItem=Prisma.ContentItemGetPayload<{include:{channel:true;selected_asset:true;image_assets:true}}>;
type CheckedItem=Prisma.ContentItemGetPayload<{include:{channel:true;selected_asset:{include:{decision:true}};publication_fact:true;art_direction_decisions:true}}>;
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const sha=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const COMMAND='ba_prepare_approved_publication';
function denied(code:string,message:string,action:string):never{
    throw new PublicationDiagnosticError({code,message,retry_allowed:false,reasons:[{code,field:'publication_preparation',message,action}]});
}
function binding(item:PreparationItem|CheckedItem){
    return {updated_at:item.updated_at,channel_id:item.channel_id,channel:item.channel,
        body:item.draft_text,brief:item.brief,title:item.title,assets:item.assets,quality:item.quality_report,
        revision:item.content_revision,accepted:item.accepted_revision,text_state:item.text_state,
        status:item.status,mode:item.publication_mode,visual_mode:item.visual_mode,visual_state:item.visual_state,
        decision_version:item.visual_decision_version,placement:item.visual_placement,asset_id:item.selected_asset_id,
        asset:item.selected_asset?{id:item.selected_asset.id,updated_at:item.selected_asset.updated_at,file_url:item.selected_asset.file_url,
            status:item.selected_asset.status,project_id:item.selected_asset.project_id,content_item_id:item.selected_asset.content_item_id,
            content_revision:item.selected_asset.content_revision,decision_id:item.selected_asset.decision_id,placement:item.selected_asset.placement,
            provenance:item.selected_asset.provenance,reviewed_at:item.selected_asset.reviewed_at,qa_report:item.selected_asset.qa_report}:null,
        handoff:item.handoff_state,schedule:item.schedule_at,publish:item.publish_at};
}
function assertPackage(item:CheckedItem):void{
    if(item.status!=='approved'||item.publication_mode!=='approval_required'||item.channel?.type!=='telegram'
        ||item.channel.project_id!==item.project_id||!item.channel.is_active||item.text_state!=='accepted'
        ||!item.accepted_revision||item.content_revision!==item.accepted_revision||!item.draft_text?.trim()
        ||!item.schedule_at||!item.publish_at||item.schedule_at.getTime()!==item.publish_at.getTime())
        denied('PREPARE_READINESS_PACKAGE_CONFLICT','The current accepted Telegram package is not eligible for preparation.','Read the current task and complete its normal text/channel/schedule approval; do not change the revision to repair status.');
    const decision=item.art_direction_decisions[0],asset=item.selected_asset;
    if(!decision||decision.project_id!==item.project_id||decision.content_item_id!==item.id
        ||decision.source_content_revision!==item.accepted_revision||decision.decision_version!==item.visual_decision_version
        ||decision.channel!==item.channel.type||decision.placement!==item.visual_placement)
        denied('PREPARE_READINESS_VISUAL_INVALID','The active visual decision does not match the current accepted package.','Finish the current art-direction decision and its independent review; do not repeat an old review to change task status.');
    const withoutVisual=item.visual_state==='NO_VISUAL_NEEDED'&&item.visual_mode!=='required'
        &&decision.decision===VisualDecisionCode.NotNeeded&&item.selected_asset_id===null;
    const approvedVisual=item.visual_state==='APPROVED'&&item.visual_mode!=='forbidden'
        &&asset?.status==='approved'&&asset.project_id===item.project_id&&asset.content_item_id===item.id
        &&asset.content_revision===item.accepted_revision&&asset.decision_id===decision.id
        &&asset.placement===item.visual_placement&&isServerResolvableVisualUrl(asset.file_url)
        &&decision.decision!==VisualDecisionCode.NotNeeded&&decision.decision!==VisualDecisionCode.Blocked;
    if(!withoutVisual&&!approvedVisual)
        denied('PREPARE_READINESS_VISUAL_INVALID','The selected visual is not the approved durable visual for this accepted revision.','Read visual readiness and complete the current valid visual workflow; preparation cannot approve or waive a visual.');
}
async function assertNoDelivery(tx:Prisma.TransactionClient,item:CheckedItem):Promise<void>{
    const where={project_id:item.project_id,content_item_id:item.id};
    const [attempt,job,work,release]=await Promise.all([
        tx.deliveryAttempt.findFirst({where,select:{id:true}}),
        tx.connectorDispatchJob.findFirst({where,select:{id:true}}),
        tx.workItem.findFirst({where:{...where,OR:[{state:'claimed'},{lease_token:{not:null}},
            {kind:{in:['browser_publish','publication_execute','publish']},state:{not:'cancelled'}}]},select:{id:true}}),
        tx.workflowEvent.findFirst({where:{...where,command:{in:['ba_release_approved_telegram_task','ba_release_browser_publication','ba_authorize_browser_publication']}},select:{id:true}})
    ]);
    if(item.publication_fact||hasLegacyPublicationUncertainty(item)||attempt||job||work||release||object(item.quality_report).publication_hold)
        denied('PREPARE_READINESS_EXISTING_AUTHORITY','Preparation cannot reopen a held, leased, released or previously attempted publication.','Read task, work and attempt history; reconcile existing delivery authority or resolve the audited hold before preparing. Never resend an uncertain attempt.');
    if((await getVisualStorageIngestState(item.project_id,tx)).blocked)
        denied('PREPARE_READINESS_STORAGE_BLOCKED','Visual storage has an unresolved incident.','Resolve the project storage incident and verify durable visual readiness before preparing again.');
    await assertVisualReassessmentReady(tx,item.project_id,item.id);
}
async function currentBundle(tx:Prisma.TransactionClient,item:CheckedItem){
    const source=await loadPublicationPlanContext(item.project_id,tx),action=object(object(item.assets).action);
    const plan=source&&Object.keys(action).length?planService.parsePlan(JSON.stringify({...source,actions:[action]})):null;
    const bundle=plan?planService.buildHandoffBundle(plan,item,{requireAcceptedContent:true})
        :planService.buildGeneratedContentItemHandoff(item,{requireAcceptedContent:true});
    if(typeof bundle.task.schedule_at!=='string'||Date.parse(bundle.task.schedule_at)!==item.schedule_at?.getTime())
        denied('PREPARE_READINESS_SCHEDULE_CONFLICT','The imported handoff slot differs from the current task schedule.','Inspect and align the canonical task schedule and imported planning slot through the supported planning workflow before preparation. Do not release a packet with conflicting dates.');
    const config=object(item.channel?.config),raw=object(config.raw_account);
    const account={...config,...raw,platform:raw.platform||item.channel?.type,workflow_mode:config.workflow_mode||raw.workflow_mode};
    if(bundle.transport?.connector_authority==='manual_only'||!adapter.supportsDirectExecution(account)
        ||(bundle.mode==='manual'&&!adapter.prefersAutomaticExecution(account)))
        denied('PREPARE_READINESS_ROUTE_CHANGED','This package no longer uses supported direct Telegram preparation.','Read the current channel route and use its normal supported preparation workflow; do not switch transport to repair status.');
    return safePreparationBundle({...bundle,content_language:publicationContentLanguage(item.channel,item.quality_report)});
}
/** Readiness is preparation only: never grants release, creates a review or calls a provider. */
export async function prepareApprovedTelegram(item:PreparationItem){
    const principal=currentPublicationPrincipal();
    if(!principal)denied('PREPARE_READINESS_PRINCIPAL_REQUIRED','This readiness transition requires an authenticated operator.','Reconnect the authorized Planner/Publisher profile and prepare the same current task.');
    if(principal.projectId!==undefined&&principal.projectId!==item.project_id)
        denied('PREPARE_READINESS_SCOPE_MISMATCH','The connected profile belongs to a different project.','Use the existing authorized preparation profile for this task project.');
    const phase:{value:'validation'|'handoff'|'state_write'|'audit'}={value:'validation'};
    try{return await prisma.$transaction(async tx=>{
        await lockOwnedPublicationTask(tx,{projectId:item.project_id,taskId:item.id});
        const member=await tx.projectMember.findUnique({where:{project_id_user_id:{project_id:item.project_id,user_id:principal.userId}},select:{role:true}});
        const user=await tx.user.findUnique({where:{id:principal.userId},select:{is_demo:true}});
        if(!member||!['owner','editor'].includes(member.role)||!user||user.is_demo)denied('PREPARE_READINESS_ACTOR_FORBIDDEN','The authenticated actor is not an active non-demo project owner or editor.','Use an active project owner or editor with the permitted preparation profile.');
        await assertOwnedPublicationMutable(tx,{projectId:item.project_id,taskId:item.id});
        const current=await tx.contentItem.findFirst({where:{id:item.id,project_id:item.project_id},include:{channel:true,
            selected_asset:{include:{decision:true}},publication_fact:true,art_direction_decisions:{where:{status:'active'},orderBy:{decision_version:'desc'},take:1}}});
        if(!current||sha(binding(current))!==sha(binding(item)))
            denied('PREPARE_READINESS_PACKAGE_CONFLICT','The package changed while it was being prepared.','Read the current task and prepare its exact accepted package again; no preparation was saved.');
        assertPackage(current);await assertNoDelivery(tx,current);
        phase.value='handoff';
        const bundle=await currentBundle(tx,current),beforeHash=sha(binding(current));
        phase.value='state_write';
        const changed=await tx.contentItem.updateMany({where:{id:current.id,project_id:current.project_id,updated_at:current.updated_at,
            status:'approved',publication_mode:'approval_required',publication_fact:{is:null}},
            data:{status:'ready_for_execution',handoff_state:'ready',quality_report:{...object(current.quality_report),
                handoff_bundle:bundle,prepared_at:new Date().toISOString()} as Prisma.InputJsonValue}});
        if(changed.count!==1)denied('PREPARE_READINESS_PACKAGE_CONFLICT','The package changed before readiness could be saved.','Read the current task and retry preparation only after resolving the conflict.');
        phase.value='audit';
        await tx.workflowEvent.create({data:{project_id:current.project_id,content_item_id:current.id,actor_id:principal.actorId,
            command:COMMAND,idempotency_key:`prepare:${current.id}:${beforeHash}`,before_state:{status:current.status,snapshot_sha256:beforeHash},
            after_state:{status:'ready_for_execution',publication_mode:'approval_required',content_revision:current.content_revision,
                selected_asset_id:current.selected_asset_id,bundle_sha256:sha(bundle),publication_authorized:false,provider_called:false}}});
        phase.value='state_write';
        const updated=await tx.contentItem.findUniqueOrThrow({where:{id:current.id},include:{channel:true,selected_asset:true,image_assets:true}});
        return {item:updated,bundle,reused:false};
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:5000,timeout:10000});}catch(error:unknown){
        if(error instanceof PublicationDiagnosticError)throw error;
        if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2034')
            return denied('PREPARE_READINESS_PACKAGE_CONFLICT','Concurrent preparation changed the package.','Read the current task before retrying; preparation has not authorized a send.');
        if(phase.value==='audit')return denied('PREPARE_READINESS_AUDIT_FAILED','The preparation audit could not be saved; readiness was rolled back.','Check audit/database availability, then read the current task before repeating the same preparation. No send was authorized.');
        if(phase.value==='handoff')return denied('PREPARE_READINESS_HANDOFF_FAILED','The current handoff could not be built; readiness was not saved.','Inspect the current stored publication plan, accepted body and durable asset bindings before preparing again.');
        if(error instanceof Error&&/\[(?:OWNED_LIFECYCLE_IMMUTABLE|PUBLICATION_VISUAL_REVIEW_REQUIRED|VISUAL_REASSESSMENT_[A-Z_]+)\]/.test(error.message))
            return denied('PREPARE_READINESS_EXISTING_AUTHORITY','The persisted publication or visual-review lifecycle prevents readiness repair.','Read its current lifecycle and finish the required reconciliation or independent visual review; preparation cannot replace it.');
        return denied('PREPARE_READINESS_TRANSACTION_UNCONFIRMED','The preparation transaction outcome could not be confirmed.','Read the current task and its preparation audit before retrying. Preparation never authorizes a send; a lost response does not prove rollback.');
    }
}

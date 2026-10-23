import {Prisma} from '@prisma/client';
import {PublicationDiagnostic} from './publication_diagnostics';
import {VisualDecisionCode} from './visual_reassessment_binding';
import {isServerResolvableVisualUrl} from './visual_asset_binding.service';

type Item=Prisma.ContentItemGetPayload<{include:{channel:true;selected_asset:{include:{decision:true}};publication_fact:true;art_direction_decisions:true}}>;
/** Stable independent checks. Missing prerequisites never imply a downstream mismatch. */
export function packageReadinessReasons(item:Item):PublicationDiagnostic['reasons'][number][]{
    const reasons:PublicationDiagnostic['reasons'][number][]=[];
    const add=(code:string,field:string,message:string,action:string)=>reasons.push({code,field,message,action});
    if(item.status!=='approved'||item.publication_mode!=='approval_required')
        add('PREPARE_READINESS_STATE_CONFLICT','status','The task is no longer awaiting approved preparation.','Read its current lifecycle and use the supported preparation command for that state.');
    if(!item.channel||item.channel.project_id!==item.project_id||item.channel.type!=='telegram')
        add('PREPARE_READINESS_CHANNEL_INVALID','channel_id','A current project-owned Telegram channel is required.','Select the correct project-owned channel through the supported planning workflow.');
    if(item.channel&&!item.channel.is_active)
        add('PREPARE_READINESS_CHANNEL_INACTIVE','channel.is_active','The publication channel is inactive.','Enable the intended channel through project settings or select an active channel and review the changed package.');
    if(item.text_state!=='accepted')
        add('PREPARE_READINESS_TEXT_UNACCEPTED','text_state','The current text has not been accepted.','Complete the current text review before preparing.');
    if(!item.accepted_revision)
        add('PREPARE_READINESS_ACCEPTED_REVISION_MISSING','accepted_revision','No accepted content revision is recorded.','Complete the normal content acceptance workflow for the current revision.');
    else if(item.content_revision!==item.accepted_revision)
        add('PREPARE_READINESS_REVISION_MISMATCH','accepted_revision','The accepted revision differs from the current content revision.','Review and accept the current content revision before preparing.');
    if(!item.draft_text?.trim())
        add('PREPARE_READINESS_BODY_MISSING','draft_text','The publication body is empty.','Provide and accept the current publication text through the content workflow.');
    if(!item.schedule_at)
        add('PREPARE_READINESS_SCHEDULE_MISSING','schedule_at','The canonical publication schedule is missing.','Set the intended publication time through the supported scheduling workflow.');
    if(!item.publish_at)
        add('PREPARE_READINESS_PUBLISH_TIME_MISSING','publish_at','The publication time projection is missing.','Use the supported scheduling workflow to synchronize publication time.');
    if(item.schedule_at&&item.publish_at&&item.schedule_at.getTime()!==item.publish_at.getTime())
        add('PREPARE_READINESS_SCHEDULE_MISMATCH','publish_at','The canonical schedule and publication time disagree.','Align both times through the supported scheduling workflow before preparing.');
    const decision=item.art_direction_decisions[0],asset=item.selected_asset;
    if(!decision){
        add('PREPARE_READINESS_VISUAL_DECISION_MISSING','art_direction_decisions','The current active visual decision is missing.','Complete the current art-direction decision before preparing.');
        return reasons;
    }
    if(decision.project_id!==item.project_id||decision.content_item_id!==item.id
        ||(item.accepted_revision!==null&&decision.source_content_revision!==item.accepted_revision)
        ||decision.decision_version!==item.visual_decision_version
        ||(item.channel&&decision.channel!==item.channel.type)||decision.placement!==item.visual_placement)
        add('PREPARE_READINESS_VISUAL_INVALID','art_direction_decisions','The active visual decision does not match the current accepted package.','Read the current art-direction context and finish its matching decision and independent review.');
    if(asset&&item.accepted_revision!==null&&asset.content_revision!==item.accepted_revision)
        add('PREPARE_READINESS_ASSET_REVISION_MISMATCH','selected_asset.content_revision','The selected asset belongs to another content revision.','Select and independently review the visual for the current accepted revision.');
    const withoutVisual=item.visual_state==='NO_VISUAL_NEEDED'&&item.visual_mode!=='required'
        &&decision.decision===VisualDecisionCode.NotNeeded&&item.selected_asset_id===null;
    // Revision mismatches have their own precise reason above.
    const approvedVisual=item.visual_state==='APPROVED'&&item.visual_mode!=='forbidden'
        &&asset?.status==='approved'&&asset.project_id===item.project_id&&asset.content_item_id===item.id
        &&asset.decision_id===decision.id&&asset.placement===item.visual_placement&&isServerResolvableVisualUrl(asset.file_url)
        &&decision.decision!==VisualDecisionCode.NotNeeded&&decision.decision!==VisualDecisionCode.Blocked;
    if(!withoutVisual&&!approvedVisual)
        add('PREPARE_READINESS_VISUAL_INVALID','selected_asset','The selected visual is not an approved durable visual for this package.','Read visual readiness and complete the current valid visual workflow; preparation cannot approve or waive a visual.');
    return reasons;
}

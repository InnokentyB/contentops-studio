import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../db';
import {createHash} from 'node:crypto';
import {isServerResolvableVisualUrl} from './visual_asset_binding.service';

export const VISUAL_REASSESSMENT_COMMAND='ba_request_publication_visual_reassessment';
export const VISUAL_REASSESSMENT_COMPLETE='ba_complete_publication_visual_reassessment';
/** Provider-independent protocol states, never business-record identifiers. */
export enum VisualDecisionCode {NotNeeded='NO_VISUAL_NEEDED',Blocked='BLOCKED'}
/** Existing independent review outcomes. */
export enum VisualReviewOutcome {Approved='approved',Rejected='rejected'}
const bindingSchema=z.object({version:z.literal(1),generation:z.string().uuid(),work_item_id:z.number().int().positive(),prior_decision_id:z.number().int().positive(),revision:z.number().int().positive(),body_sha256:z.string().regex(/^[a-f0-9]{64}$/),channel_id:z.number().int().positive(),placement:z.string(),schedule_at:z.string().nullable(),requirement:z.string(),reason:z.string(),owner_instruction_reference:z.string(),request_hash:z.string()});
export type VisualReassessmentBinding=z.infer<typeof bindingSchema>;
export type VisualClient=Prisma.TransactionClient|typeof prisma;
/** Static actionable errors disclose neither submitted packet nor publication content. */
export function visualReassessmentError(code:string):Error {
 const reasons:Record<string,string>={
  VISUAL_REASSESSMENT_OWNER_REQUIRED:'Only a current project Owner can request a new visual requirement. Use the project Owner profile.',
  VISUAL_REASSESSMENT_PACKAGE_CONFLICT:'Accepted text, revision, channel, placement, schedule or publication state changed. Refresh the exact accepted package before previewing again.',
  VISUAL_REASSESSMENT_PRIOR_INPUT_CONFLICT:'The expected active no-visual decision or its completed art-direction input is no longer current. Inspect current art-direction history.',
  VISUAL_REASSESSMENT_OWNER_VISUAL_REQUIRED:'The Owner explicitly requested a meaningful visual after the prior assessment. NO_VISUAL_NEEDED cannot fulfil that instruction. Submit a functional generation/source/manual brief, or an explicit blocked decision explaining the missing prerequisite.',
  VISUAL_REASSESSMENT_PLACEMENT_FORBIDDEN:'This placement forbids a visual. Resolve the placement conflict with the Owner; this command cannot change the channel or placement.',
  VISUAL_REASSESSMENT_EXISTING_AUTHORITY:'A release, send, visual work step or reassessment already exists. Inspect that lifecycle first; reconcile any started or uncertain send. Do not open replacement send authority.',
  VISUAL_REASSESSMENT_IDEMPOTENCY_CONFLICT:'This idempotency key already belongs to a different request packet. Read its recorded result and confirm the intended requirement; do not replay altered arguments.',
  VISUAL_REASSESSMENT_GENERATION_CONFLICT:'This callback belongs to an old work item, generation or accepted package. Read the new art-direction context and use its current work item and lease.',
  VISUAL_REASSESSMENT_DECISION_CONFLICT:'This asset does not belong to the current visual-producing decision of the new art work item. Use the asset and decision from the current reassessment.',
  VISUAL_REASSESSMENT_REVIEW_LEASE_REQUIRED:'A current claimed visual-review work item, its actor-bound lease and reassessment generation are required. Claim the current review step before submitting its result.',
  VISUAL_REASSESSMENT_LEASE_CONFLICT:'The art-direction lease expired or changed during completion. Refresh and claim the current art work item before retrying assessment.',
  VISUAL_REASSESSMENT_TYPED_COMPLETION_REQUIRED:'This reassessment stage requires its typed result. Use ba_submit_art_direction_decision for art direction or ba_review_image_asset for visual review with the current lease and generation. Generic work completion cannot replace either decision.',
  VISUAL_REASSESSMENT_REVISION_LOCKED:'The accepted copy is frozen while its visual reassessment is pending. Complete the current visual workflow before revising the copy.',
  VISUAL_REASSESSMENT_CAS_CONFLICT:'The publication changed concurrently. Refresh the current accepted package and rerun preview.',
  VISUAL_REASSESSMENT_STORAGE_OR_PLACEMENT_CHECK_FAILED:'The database or placement validation could not complete; the exact cause is not established. Ask engineering to inspect service health and the safe diagnostic code before retrying.',
  VISUAL_REASSESSMENT_BINDING_INVALID:'The stored reassessment binding is inconsistent. Stop this workflow and ask engineering to inspect its request audit.',
  VISUAL_REASSESSMENT_ASSET_MISSING:'The asset is no longer available in this project. Refresh the current visual-review work item.',
  VISUAL_REASSESSMENT_ASSET_NOT_DURABLE:'The current asset URL is not a server-resolvable HTTPS source. Register a durable visual source before reviewing this asset; the review remains uncompleted.'
 };
 return new Error(`[${code}] ${reasons[code]||'The reassessment could not complete safely. Refresh its current state and ask engineering to inspect the safe diagnostic code.'} A closed connection never permits replay of an uncertain publication.`);
}
/** Every participating canonical writer serializes on the same tenant-owned content row. */
export async function lockVisualContent(tx:Prisma.TransactionClient,projectId:number,taskId:number):Promise<void>{
 await tx.$queryRaw`SELECT id FROM planner.content_items WHERE project_id=${projectId} AND id=${taskId} FOR UPDATE`;
}
/** Generic completion cannot terminally consume an art/review lease without its required typed decision. */
export async function assertTypedVisualCompletion(tx:Prisma.TransactionClient,projectId:number,work:{kind:string;content_item_id:number|null}):Promise<void>{
 if(!work.content_item_id||!['art_direction','visual_review'].includes(work.kind))return;
 await lockVisualContent(tx,projectId,work.content_item_id);
 if(await getVisualReassessment(tx,projectId,work.content_item_id))throw visualReassessmentError('VISUAL_REASSESSMENT_TYPED_COMPLETION_REQUIRED');
}
/** Request authority comes only from the immutable server-authored event, never client JSON. */
export async function getVisualReassessment(client:VisualClient,projectId:number,taskId:number):Promise<VisualReassessmentBinding|null>{
 const event=await client.workflowEvent.findFirst({where:{project_id:projectId,content_item_id:taskId,command:VISUAL_REASSESSMENT_COMMAND},orderBy:{id:'desc'}});
 if(!event)return null;
 const envelope=z.object({binding:bindingSchema}).safeParse(event.after_state);
 if(!envelope.success)throw visualReassessmentError('VISUAL_REASSESSMENT_BINDING_INVALID');
 if(event.work_item_id!==envelope.data.binding.work_item_id)throw visualReassessmentError('VISUAL_REASSESSMENT_BINDING_INVALID');
 const completed=await client.workflowEvent.findFirst({where:{project_id:projectId,content_item_id:taskId,command:VISUAL_REASSESSMENT_COMPLETE},orderBy:{id:'desc'}});
 const completion=z.object({generation:z.string()}).safeParse(completed?.after_state);
 if(completion.success&&completion.data.generation===envelope.data.binding.generation){
  const current=await client.contentItem.findFirst({where:{id:taskId,project_id:projectId},select:{content_revision:true}});
  if(current&&current.content_revision!==envelope.data.binding.revision)return null;
 }
 return envelope.data.binding;
}
/** Current assessment must come from the new generation's WI and frozen package. */
export function assertVisualAssessmentBinding(binding:VisualReassessmentBinding,workItemId:number,item:{accepted_revision:number|null;content_revision:number;channel_id:number|null;visual_placement:string|null;draft_text:string|null;schedule_at:Date|null},bodyHash:string):void{
 if(binding.work_item_id!==workItemId||binding.revision!==item.accepted_revision||item.accepted_revision!==item.content_revision||binding.channel_id!==item.channel_id||binding.placement!==item.visual_placement||binding.body_sha256!==bodyHash||binding.schedule_at!==(item.schedule_at?.toISOString()??null))throw visualReassessmentError('VISUAL_REASSESSMENT_GENERATION_CONFLICT');
}
/** New assets/review must bind to the current decision produced by the request's exact WI. */
export async function assertVisualDecisionBinding(tx:VisualClient,binding:VisualReassessmentBinding,projectId:number,taskId:number,decisionId:number|null):Promise<void>{
 const decision=decisionId?await tx.artDirectionDecision.findFirst({where:{id:decisionId,project_id:projectId,content_item_id:taskId,status:'active',work_item_id:binding.work_item_id,source_content_revision:binding.revision,placement:binding.placement}}):null;
 const channel=await tx.socialChannel.findFirst({where:{id:binding.channel_id,project_id:projectId},select:{type:true}});
 if(!decision||!channel||decision.channel!==channel.type||decision.decision===VisualDecisionCode.NotNeeded||decision.decision===VisualDecisionCode.Blocked)throw visualReassessmentError('VISUAL_REASSESSMENT_DECISION_CONFLICT');
}
/** Visual callbacks cannot reopen a package after delivery authority has been issued. Call under the content lock. */
export async function assertVisualMutationBeforeRelease(tx:VisualClient,projectId:number,taskId:number):Promise<void>{
 const [item,attempt,executor,job]=await Promise.all([
  tx.contentItem.findFirst({where:{project_id:projectId,id:taskId},include:{publication_fact:true}}),
  tx.deliveryAttempt.findFirst({where:{project_id:projectId,content_item_id:taskId}}),
  tx.workItem.findFirst({where:{project_id:projectId,content_item_id:taskId,kind:{in:['browser_publish','publication_execute','publish']},state:{notIn:['cancelled']}}}),
  tx.connectorDispatchJob.findFirst({where:{project_id:projectId,content_item_id:taskId}})
 ]);
 if(!item||!['approved','ready_for_execution'].includes(item.status)||item.publication_fact||item.published_link||attempt||executor||job||!['approval_required','manual_handoff',null].includes(item.publication_mode))throw visualReassessmentError('VISUAL_REASSESSMENT_EXISTING_AUTHORITY');
}
/** A separate current review completion is required even if project pipeline settings later change. */
export async function visualReassessmentFulfilled(client:VisualClient,binding:VisualReassessmentBinding,projectId:number,taskId:number,assetId:number|null):Promise<boolean>{
 const event=await client.workflowEvent.findFirst({where:{project_id:projectId,content_item_id:taskId,command:VISUAL_REASSESSMENT_COMPLETE},orderBy:{id:'desc'}});
 const result=z.object({generation:z.string(),asset_id:z.number(),decision_id:z.number()}).safeParse(event?.after_state);
 if(!result.success||result.data.generation!==binding.generation||result.data.asset_id!==assetId)return false;
 const asset=await client.imageAsset.findFirst({where:{id:result.data.asset_id,project_id:projectId,content_item_id:taskId},select:{decision_id:true}});
 if(asset?.decision_id!==result.data.decision_id)return false;
 await assertVisualDecisionBinding(client,binding,projectId,taskId,result.data.decision_id);return true;
}
/** Release/start/permit admission reads durable Owner requirement authority, even if legacy projections were restored. */
export async function assertVisualReassessmentReady(client:VisualClient,projectId:number,taskId:number):Promise<void>{
 const binding=await getVisualReassessment(client,projectId,taskId);if(!binding)return;
 const deny=():never=>{throw new Error('[PUBLICATION_VISUAL_REVIEW_REQUIRED] The Owner requested a new meaningful visual. The current request generation has no matching approved independent visual review. Read the current art-direction context, finish its source/generation and separate visual review, then obtain a new release for that package. Restoring old no-visual fields does not fulfil this requirement.');};
 const item=await client.contentItem.findFirst({where:{id:taskId,project_id:projectId},include:{selected_asset:{include:{decision:true}}}});
 const asset=item?.selected_asset,decision=asset?.decision;
 if(!item||item.visual_mode!=='required'||item.visual_state!=='APPROVED'||item.handoff_state!=='ready'||!asset||asset.status!=='approved'||asset.content_revision!==binding.revision||!isServerResolvableVisualUrl(asset.file_url)||!decision||decision.status!=='active'||decision.work_item_id!==binding.work_item_id||decision.decision_version!==item.visual_decision_version)return deny();
 assertVisualAssessmentBinding(binding,binding.work_item_id,item,createHash('sha256').update(item.draft_text||'').digest('hex'));
 if(!await visualReassessmentFulfilled(client,binding,projectId,taskId,item.selected_asset_id))return deny();
}

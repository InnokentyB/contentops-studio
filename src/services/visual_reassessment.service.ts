import { createHash,randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../db';
import { requireProjectOwner } from './work_queue/auth';
import { assertCanonicalPublicationPlacement } from './publication_placement_contract';
import { getVisualReassessment,lockVisualContent,visualReassessmentError,VISUAL_REASSESSMENT_COMMAND,VisualDecisionCode,type VisualReassessmentBinding } from './visual_reassessment_binding';
export const visualReassessmentSchema=z.object({projectId:z.number().int().positive(),taskId:z.number().int().positive(),actorId:z.string().regex(/^user:\d+$/),expectedContentRevision:z.number().int().positive(),expectedAcceptedRevision:z.number().int().positive(),expectedBodySha256:z.string().regex(/^[a-f0-9]{64}$/),expectedChannelId:z.number().int().positive(),expectedPlacement:z.string().trim().min(1).max(100),expectedScheduleAt:z.string().datetime({offset:true}),expectedDecisionId:z.number().int().positive(),expectedDecisionVersion:z.number().int().positive(),expectedArtWorkItemId:z.number().int().positive(),requirement:z.string().trim().min(10).max(2000),reason:z.string().trim().min(10).max(1000),ownerInstructionReference:z.string().trim().min(10).max(1000),idempotencyKey:z.string().trim().min(1).max(200),apply:z.boolean().default(false)});
const sha=(s:string):string=>createHash('sha256').update(s).digest('hex');
const adapterSerialization=z.object({driverAdapterError:z.object({cause:z.object({originalCode:z.literal('40001')})})});
function serializationConflict(error:unknown):boolean{
 return error instanceof Prisma.PrismaClientKnownRequestError&&(error.code==='P2034'||error.code==='P2010'&&(error.meta?.code==='40001'||adapterSerialization.safeParse(error.meta).success));
}
/** Owner-only preview/apply: immutable accepted copy, new art input, no delivery authority. */
export async function requestPublicationVisualReassessment(input:unknown,database:typeof prisma=prisma):Promise<Record<string,unknown>>{
 const args=visualReassessmentSchema.parse(input);const {apply,...packet}=args,requestHash=sha(JSON.stringify(packet));
 for(let round=0;round<3;round++){
 try{return await database.$transaction(async tx=>{
  try{await requireProjectOwner(tx,args.projectId,args.actorId);}catch(error:unknown){if(error instanceof Error&&error.message.startsWith('[Security]'))throw visualReassessmentError('VISUAL_REASSESSMENT_OWNER_REQUIRED');throw error;}
  await lockVisualContent(tx,args.projectId,args.taskId);
  const prior=await tx.workflowEvent.findUnique({where:{project_id_actor_id_command_idempotency_key:{project_id:args.projectId,actor_id:args.actorId,command:VISUAL_REASSESSMENT_COMMAND,idempotency_key:args.idempotencyKey}}});
  if(prior){const parsed=z.object({binding:z.object({request_hash:z.string()})}).safeParse(prior.after_state);if(!parsed.success||parsed.data.binding.request_hash!==requestHash)throw visualReassessmentError('VISUAL_REASSESSMENT_IDEMPOTENCY_CONFLICT');return{...prior.after_state as Record<string,Prisma.JsonValue>,replayed:true};}
  const item=await tx.contentItem.findFirst({where:{project_id:args.projectId,id:args.taskId},include:{channel:true,publication_fact:true}});
  if(!item||item.channel_id!==args.expectedChannelId||item.content_revision!==args.expectedContentRevision||item.accepted_revision!==args.expectedAcceptedRevision||item.accepted_revision!==item.content_revision||item.text_state!=='accepted'||sha(item.draft_text||'')!==args.expectedBodySha256||item.visual_placement!==args.expectedPlacement||item.schedule_at?.toISOString()!==args.expectedScheduleAt||item.selected_asset_id!==null||item.visual_state!=='NO_VISUAL_NEEDED'||item.visual_mode==='required'||!['approved','ready_for_execution'].includes(item.status)||item.publication_fact||item.published_link)throw visualReassessmentError('VISUAL_REASSESSMENT_PACKAGE_CONFLICT');
  if(!item.channel||item.channel.project_id!==args.projectId)throw visualReassessmentError('VISUAL_REASSESSMENT_PACKAGE_CONFLICT');
  if(item.channel.type.toLowerCase()==='email'||item.visual_mode==='forbidden')throw visualReassessmentError('VISUAL_REASSESSMENT_PLACEMENT_FORBIDDEN');
  assertCanonicalPublicationPlacement(item.channel,args.expectedPlacement);
  const [decision,oldWi,active,attempt,job,existing]=await Promise.all([
   tx.artDirectionDecision.findFirst({where:{project_id:args.projectId,content_item_id:item.id,id:args.expectedDecisionId,decision_version:args.expectedDecisionVersion,status:'active',decision:VisualDecisionCode.NotNeeded,source_content_revision:item.content_revision,work_item_id:args.expectedArtWorkItemId,channel:item.channel.type,placement:args.expectedPlacement}}),
   tx.workItem.findFirst({where:{id:args.expectedArtWorkItemId,project_id:args.projectId,content_item_id:item.id,kind:'art_direction',state:'completed',input_context_version:item.content_revision}}),
   tx.workItem.findFirst({where:{project_id:args.projectId,content_item_id:item.id,OR:[{kind:{in:['art_direction','visual_generate','visual_source_collect','visual_review']},state:{notIn:['completed','cancelled']}},{kind:{in:['browser_publish','publication_execute','publish']},state:{notIn:['cancelled']}}]}}),
   tx.deliveryAttempt.findFirst({where:{project_id:args.projectId,content_item_id:item.id}}),tx.connectorDispatchJob.findFirst({where:{project_id:args.projectId,content_item_id:item.id}}),getVisualReassessment(tx,args.projectId,item.id)]);
  const quality=z.record(z.string(),z.unknown()).safeParse(item.quality_report);const releases=['browser_release','owner_release','publication_release','threads_release'];
  const activeDecisionCount=await tx.artDirectionDecision.count({where:{project_id:args.projectId,content_item_id:item.id,status:'active'}});
  if(!decision||!oldWi||activeDecisionCount!==1||item.visual_decision_version!==decision.decision_version)throw visualReassessmentError('VISUAL_REASSESSMENT_PRIOR_INPUT_CONFLICT');
  if(active||attempt||job||existing||!['approval_required','manual_handoff',null].includes(item.publication_mode)||releases.some(k=>quality.success&&quality.data[k]))throw visualReassessmentError('VISUAL_REASSESSMENT_EXISTING_AUTHORITY');
  const preview={project_id:args.projectId,task_id:item.id,applied:false,replayed:false,publication_authorized:false,provider_called:false,published:false,visual_mode:'required',visual_state:'PENDING_ASSESSMENT',handoff_state:'blocked'};
  if(!apply)return preview;
  const generation=randomUUID();const changed=await tx.contentItem.updateMany({where:{id:item.id,project_id:args.projectId,status:item.status,updated_at:item.updated_at,visual_state:'NO_VISUAL_NEEDED',visual_decision_version:args.expectedDecisionVersion,selected_asset_id:null},data:{status:'approved',visual_mode:'required',visual_state:'PENDING_ASSESSMENT',handoff_state:'blocked'}});
  if(changed.count!==1)throw visualReassessmentError('VISUAL_REASSESSMENT_CAS_CONFLICT');
  const work=await tx.workItem.create({data:{project_id:args.projectId,content_item_id:item.id,week_package_id:item.week_package_id,item_key:item.item_key||`content:${item.id}`,kind:'art_direction',state:'available',assignee_role:'art_director',input_context_version:item.content_revision,dedupe_key:`visual-reassessment:${item.id}:${generation}`,note:'Owner requested a new visual assessment; read current server-owned context.'}});
  const binding:VisualReassessmentBinding={version:1,generation,work_item_id:work.id,prior_decision_id:decision.id,revision:item.content_revision,body_sha256:args.expectedBodySha256,channel_id:args.expectedChannelId,placement:args.expectedPlacement,schedule_at:args.expectedScheduleAt,requirement:args.requirement,reason:args.reason,owner_instruction_reference:args.ownerInstructionReference,request_hash:requestHash};
  const result={...preview,applied:true,art_direction_work_item_id:work.id,binding};
  await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:item.id,work_item_id:work.id,actor_id:args.actorId,command:VISUAL_REASSESSMENT_COMMAND,idempotency_key:args.idempotencyKey,before_state:{decision_id:decision.id,work_item_id:oldWi.id,visual_state:item.visual_state},after_state:result}});return result;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}catch(error:unknown){if(serializationConflict(error)&&round<2)continue;const safeCode=error instanceof Error?/^\[(VISUAL_REASSESSMENT_[A-Z_]+)\]/.exec(error.message)?.[1]:undefined;const code=safeCode||'VISUAL_REASSESSMENT_STORAGE_OR_PLACEMENT_CHECK_FAILED';console.warn(JSON.stringify({event:'visual_reassessment_denied',code,retry_allowed:false,action:'Refresh the accepted package and current workflow; reconcile any started or uncertain delivery.'}));if(safeCode)throw error;throw visualReassessmentError(code);}
 }
 throw visualReassessmentError('VISUAL_REASSESSMENT_RETRY_EXHAUSTED');
}

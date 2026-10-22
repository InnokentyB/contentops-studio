import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {requirePublicationPrincipal} from '../mcp/publication-principal';
import {browserRequestSchema,browserDefaults,requireBrowserOwner,checkedBrowserContext,browserPrior,browserCas,browserFingerprint,snapshotHash,hash,object,canonicalBrowserProfile,type BrowserDependencies} from './browser_publication_contract';
export const ownerBrowserInstructionSchema=browserRequestSchema.safeExtend({allowDuplicate:z.literal(true)});
/** One explicit Owner command; old uncertainty remains historical truth. */
export async function authorizeBrowserPublication(input:unknown,deps:BrowserDependencies=browserDefaults){
 const args=ownerBrowserInstructionSchema.parse(input),command='ba_authorize_browser_publication';
 const principal=requirePublicationPrincipal(args.projectId);
 if(principal.profile!=='owner'||principal.actorId!==args.actorId)throw new Error('[OWNER_INSTRUCTION_REQUIRED]');
 return deps.db.$transaction(async tx=>{
  await requireBrowserOwner(tx,args);
  const user=await tx.user.findUnique({where:{id:principal.userId},select:{is_demo:true}});
  if(!user||user.is_demo)throw new Error('[OWNER_INSTRUCTION_REQUIRED]');
  const prior=await browserPrior(tx,args,command);if(prior)return prior;
  const task=await checkedBrowserContext(tx,args,deps);
  if(task.publication_fact||task.published_link)throw new Error('[OWNER_NEW_PUBLICATION_INSTANCE_REQUIRED]');
  if(!['ready_for_execution','browser_required','publishing'].includes(task.status))throw new Error('[BROWSER_NOT_RELEASE_READY]');
  const history=await tx.deliveryAttempt.aggregate({where:{project_id:args.projectId,content_item_id:args.taskId},_max:{id:true,attempt_number:true}});
  const quality=object(task.quality_report);
  const proof={lifecycle:'shared_browser_v1',publication_authorized:true,snapshot:args.snapshot,snapshot_sha256:snapshotHash(args.snapshot),fingerprint:browserFingerprint(task,args.snapshot),actor_id:args.actorId,release_key:args.idempotencyKey,owner_instruction_key:args.idempotencyKey,approval_reference:args.approvalReference,target_profile_url:canonicalBrowserProfile(args.snapshot.identity),provider_identity_verified:false,released_at:new Date().toISOString()};
  const result={version:1,project_id:args.projectId,task_id:args.taskId,snapshot:args.snapshot,snapshot_sha256:proof.snapshot_sha256,historical_attempt_through:history._max.id??0,next_attempt_number:(history._max.attempt_number??0)+1,duplicate_risk_accepted:true,applied:args.apply,submission_permitted:false,provider_called:false,replayed:false};
  if(!args.apply)return result;
  const changed=await tx.contentItem.updateMany({where:browserCas(task),data:{status:'browser_required',publication_mode:'browser_required',quality_report:{...quality,browser_release:proof,publication_route:'browser_required'} as Prisma.InputJsonValue}});
  if(changed.count!==1)throw new Error('[BROWSER_RELEASE_CAS_CONFLICT]');
  await tx.workItem.updateMany({where:{project_id:args.projectId,content_item_id:args.taskId,kind:'browser_publish',state:{notIn:['cancelled','completed']}},data:{state:'cancelled',lease_token:null,lease_actor_id:null,lease_expires_at:null,reason_code:'SUPERSEDED_BY_OWNER_INSTRUCTION'}});
  const work=await tx.workItem.create({data:{project_id:args.projectId,content_item_id:args.taskId,week_package_id:task.week_package_id,item_key:task.item_key||`publication-${args.taskId}`,kind:'browser_publish',state:'available',assignee_role:'browser_publisher',due_at:task.schedule_at,reason_code:'OWNER_EXPLICIT_PUBLICATION',input_context_version:args.snapshot.contentRevision,dedupe_key:`owner-browser:${args.projectId}:${args.taskId}:${hash(`${args.actorId}:${args.idempotencyKey}`)}`,result_payload:proof as Prisma.InputJsonValue}});
  const output={...result,browser_work_item_id:work.id};
  await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:work.id,actor_id:args.actorId,command,idempotency_key:args.idempotencyKey,before_state:{request_hash:hash(JSON.stringify(args)),previous_release:quality.browser_release??null} as Prisma.InputJsonValue,after_state:output as Prisma.InputJsonValue}});
  await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:work.id,actor_id:args.actorId,command:'ba_release_browser_publication',idempotency_key:args.idempotencyKey,after_state:{...output,publication_authorized:true} as Prisma.InputJsonValue}});
  return output;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}

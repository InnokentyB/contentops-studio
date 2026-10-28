import {createHash} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {publicationPlacementAssetContract} from './publication_placement_contract';
import {lockOwnedPublicationTask,hasLegacyPublicationUncertainty} from './publication_owned_guard';
import {recordWorkflowEvent} from './work_queue/infrastructure';
type Request={projectId:number;actorId:string;taskId:number;expectedContentRevision:number;expectedAcceptedRevision:number;expectedChannelId:number|null;expectedPlacement:string;targetChannelId:number;targetPlacement:string;blockedWorkItemId:number;idempotencyKey:string;expectedGeometryStateSha256?:string};
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const command='ba_repair_publication_placement.geometry';
/** Called only inside the Owner-authorized serializable existing repair transaction. Missing hash is read-only preview. */
export async function refreshPublicationGeometry(tx:Prisma.TransactionClient,args:Request):Promise<Record<string,unknown>|null>{
 if(args.expectedChannelId!==args.targetChannelId||args.expectedPlacement!==args.targetPlacement)return null;
 await lockOwnedPublicationTask(tx,args);
 const old=await tx.workItem.findFirst({where:{id:args.blockedWorkItemId,project_id:args.projectId,content_item_id:args.taskId,kind:'art_direction'}});
 if(old?.reason_code!=='missing_placement_dimensions')return null;
 await tx.$queryRaw`SELECT id FROM planner.social_channels WHERE id=${args.targetChannelId} AND project_id=${args.projectId} FOR UPDATE`;
 const requestHash=createHash('sha256').update(JSON.stringify(args)).digest('hex');
 const task=await tx.contentItem.findFirst({where:{id:args.taskId,project_id:args.projectId},include:{channel:true,publication_fact:true}});
 const reject=():never=>{throw new Error('[GEOMETRY_REFRESH_CONFLICT] Refresh the current accepted task and blocked Art evidence.');};
 const prior=await tx.workflowEvent.findFirst({where:{project_id:args.projectId,actor_id:args.actorId,command,idempotency_key:args.idempotencyKey}});
 if(prior){const after=object(prior.after_state);if(after.request_sha256!==requestHash||after.task_id!==args.taskId||after.old_work_item_id!==args.blockedWorkItemId||after.expected_state_sha256!==args.expectedGeometryStateSha256||after.content_revision!==args.expectedContentRevision||args.expectedAcceptedRevision!==args.expectedContentRevision)return reject();return after;}
 if(!task?.channel||task.channel.type!=='linkedin'||task.channel_id!==args.expectedChannelId||task.visual_placement!=='feed'||args.targetPlacement!=='feed'
  ||task.content_revision!==args.expectedContentRevision||task.accepted_revision!==args.expectedAcceptedRevision||task.accepted_revision!==task.content_revision
  ||task.text_state!=='accepted'||task.status==='published'||task.status==='publishing'||task.publication_mode!=='approval_required'
  ||task.published_link||task.publication_fact||hasLegacyPublicationUncertainty(task)||task.selected_asset_id!==null
  ||!old||old.state!=='blocked'||old.input_context_version!==task.content_revision||old.lease_token||old.lease_actor_id||old.lease_expires_at)return reject();
 const where={project_id:args.projectId,content_item_id:args.taskId};
 if(await tx.deliveryAttempt.count({where})||await tx.connectorDispatchJob.count({where})
  ||await tx.workItem.count({where:{...where,OR:[{kind:'browser_publish'},{lease_token:{not:null}},{kind:'art_direction',id:{not:old.id},input_context_version:task.content_revision,state:{in:['available','claimed','waiting_approval']}}]}}))return reject();
 const quality=object(task.quality_report),bundle=object(quality.handoff_bundle),oldContract=object(bundle.placement_contract);
 const contract=publicationPlacementAssetContract(task.channel,'feed');
 if(!bundle.task||!oldContract.placement||oldContract.placement!=='feed'||oldContract.dimensions!=null||!contract.dimensions||!contract.safe_area)return reject();
 if(!args.idempotencyKey.trim())return reject();
 const snapshot=JSON.stringify({task,old,contract});const stateHash=createHash('sha256').update(snapshot).digest('hex');
 if(!args.expectedGeometryStateSha256)return {mode:'preview',task_id:task.id,old_work_item_id:old.id,expected_state_sha256:stateHash,mutates:false,submission_permitted:false};
 if(args.expectedGeometryStateSha256!==stateHash)return reject();
 const changed=await tx.contentItem.updateMany({where:{id:task.id,project_id:args.projectId,content_revision:task.content_revision,accepted_revision:task.accepted_revision,updated_at:task.updated_at,channel_id:task.channel_id,visual_placement:'feed',selected_asset_id:null,status:task.status,publication_mode:'approval_required'},data:{quality_report:{...quality,handoff_bundle:{...bundle,placement_contract:contract}} as Prisma.InputJsonValue}});
 if(changed.count!==1)return reject();
 const fresh=await tx.workItem.create({data:{...where,week_package_id:task.week_package_id,item_key:task.item_key||`content:${task.id}`,kind:'art_direction',state:'available',assignee_role:'art_director',input_context_version:task.content_revision,result_version:0,dedupe_key:`art-geometry:${task.id}:${task.content_revision}:${old.id}`,note:'Reassess restored canonical geometry; historical blocker retained',result_payload:{superseded_work_item_id:old.id,recovery_kind:'missing_placement_dimensions'}}});
 const result={request_sha256:requestHash,repaired:true,task_id:task.id,old_work_item_id:old.id,content_revision:task.content_revision,art_direction_work_item_id:fresh.id,expected_state_sha256:stateHash,submission_permitted:false};
 await recordWorkflowEvent(tx,{projectId:args.projectId,actorId:args.actorId,contentItemId:task.id,workItemId:fresh.id,command,idempotencyKey:args.idempotencyKey,beforeState:{state_sha256:stateHash},afterState:result});
 return result;
}

import {isDeepStrictEqual} from 'node:util';
import {object,snapshotHash,requireBrowserOwner,type BrowserDb,type BrowserRequest} from './browser_publication_contract';
export type OwnerInstruction={workItemId:number;historicalThroughAttemptId:number;nextAttemptNumber:number};
/** Only a server-written Owner audit grants exception authority. */
export async function currentOwnerInstruction(tx:BrowserDb,args:Pick<BrowserRequest,'projectId'|'taskId'>):Promise<OwnerInstruction|null>{
 const task=await tx.contentItem.findFirst({where:{project_id:args.projectId,id:args.taskId}});
 const proof=object(object(task?.quality_report).browser_release);
 if(typeof proof.owner_instruction_key!=='string')return null;
 if(typeof proof.actor_id!=='string'||!/^user:[1-9]\d*$/.test(proof.actor_id))throw new Error('[OWNER_INSTRUCTION_INVALID]');
 await requireBrowserOwner(tx,{projectId:args.projectId,actorId:proof.actor_id});
 const issuer=await tx.user.findUnique({where:{id:Number(proof.actor_id.slice(5))},select:{is_demo:true}});
 if(!issuer||issuer.is_demo)throw new Error('[OWNER_INSTRUCTION_REQUIRED]');
 const audit=await tx.workflowEvent.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId,command:'ba_authorize_browser_publication',actor_id:String(proof.actor_id),idempotency_key:proof.owner_instruction_key}});
 const data=object(audit?.after_state);
 if(data.version!==1||data.applied!==true||data.snapshot_sha256!==proof.snapshot_sha256||!isDeepStrictEqual(data.snapshot,proof.snapshot)||typeof data.browser_work_item_id!=='number'||!Number.isSafeInteger(data.historical_attempt_through)||Number(data.historical_attempt_through)<0||!Number.isSafeInteger(data.next_attempt_number)||Number(data.next_attempt_number)<1)throw new Error('[OWNER_INSTRUCTION_INVALID]');
 return {workItemId:data.browser_work_item_id,historicalThroughAttemptId:Number(data.historical_attempt_through),nextAttemptNumber:Number(data.next_attempt_number)};
}
export async function instructionForRequest(tx:BrowserDb,args:BrowserRequest&{workItemId?:number}):Promise<OwnerInstruction|null>{
 const instruction=await currentOwnerInstruction(tx,args);if(!instruction)return null;
 if(instruction.workItemId!==args.workItemId)throw new Error('[OWNER_INSTRUCTION_SCOPE_MISMATCH]');
 const work=await tx.workItem.findFirst({where:{id:instruction.workItemId,project_id:args.projectId,content_item_id:args.taskId}});
 if(object(work?.result_payload).snapshot_sha256!==snapshotHash(args.snapshot))throw new Error('[OWNER_INSTRUCTION_SCOPE_MISMATCH]');
 return instruction;
}

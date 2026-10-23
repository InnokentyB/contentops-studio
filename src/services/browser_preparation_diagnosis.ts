import type {Prisma} from '@prisma/client';
import {object} from './browser_publication_contract';

type Attempt={id:number;status:string;error_message:string|null;idempotency_key:string|null};
type Work={id:number;state:string;input_context_version:number;lease_expires_at:Date|null;lease_actor_id:string|null};
type Task={id:number;project_id:number;status:string;accepted_revision:number|null;content_revision:number};
export type BrowserPreparationDiagnosis={code:string;stage:'PREPARE';delivery_certainty:'UNKNOWN';message:string;action:string};
const result=(code:string,message:string,action:string):BrowserPreparationDiagnosis=>({code,stage:'PREPARE',delivery_certainty:'UNKNOWN',message,action});
/** Read-only evidence classification; never proves provider absence, adopts an attempt or grants a permit. */
export async function diagnoseActivePreparation(tx:Prisma.TransactionClient,task:Task,attempts:Attempt[],work:Work[],actorId:string):Promise<BrowserPreparationDiagnosis|null>{
    if(attempts.length!==1||work.length!==1||task.status!=='publishing')return null;
    const attempt=attempts[0]!,executor=work[0]!;
    if(attempt.status!=='pending'||attempt.error_message||!attempt.idempotency_key
        ||executor.state!=='claimed'||!task.accepted_revision||task.accepted_revision!==task.content_revision
        ||executor.input_context_version!==task.accepted_revision)return null;
    const events=await tx.workflowEvent.findMany({where:{project_id:task.project_id,content_item_id:task.id},
        select:{command:true,work_item_id:true,actor_id:true,idempotency_key:true,after_state:true},orderBy:{id:'asc'},take:201});
    if(events.length>200)return null;
    const starts=events.filter(e=>e.command==='ba_start_browser_submission');
    const start=starts[0];
    if(starts.length!==1||!start||start.work_item_id!==executor.id||start.actor_id!==actorId
        ||start.idempotency_key!==attempt.idempotency_key||object(start.after_state).attempt_id!==attempt.id
        ||object(start.after_state).submission_permitted!==false)return null;
    if(events.some(e=>object(e.after_state).submission_permitted===true||object(e.after_state).provider_called===true
        ||/pre_submit|dispatch|uncertain|x_native_issue_challenge|ba_publish_/.test(e.command)))return null;
    if(!executor.lease_expires_at||executor.lease_expires_at<=new Date())
        return result('BROWSER_PREPARATION_LEASE_EXPIRED','The original preparation lease has expired before any recorded Submit permit.',
            'Preserve the same attempt. Use admitted historical preparation recovery with technical fencing and supported readback; do not start or release another attempt.');
    const controlled=executor.lease_actor_id===actorId&&await tx.workItem.count({where:{id:executor.id,project_id:task.project_id,
        content_item_id:task.id,state:'claimed',lease_actor_id:actorId,lease_token:{not:null},lease_expires_at:{gt:new Date()}}})===1;
    if(!controlled)return result('BROWSER_PREPARATION_EXECUTOR_UNAVAILABLE','The current operator does not hold the original preparation executor lease.',
        'Preserve the same attempt. Ask its owning executor to inspect its current lease; if control was lost, use admitted recovery and technical fencing, never another start.');
    return result('BROWSER_PREPARATION_ACTIVE','The original attempt is still in active preparation with no recorded Submit permit.',
        'Continue the same attempt through its owning executor and normal pre-submit checks only while the original lease and exact package remain valid. This diagnosis grants no Submit permission or proof of provider absence.');
}

import type {BrowserDb} from './browser_publication_contract';
import type {PreparationLedger} from './browser_preparation_contract';
import {replacePreparation} from './browser_preparation_storage';
/** Caller owns the serializable preparation transaction; clock and ledger CAS roll back together with its audit. */
export async function replacePreparationClock(tx:BrowserDb,stored:{project_id:number;attempt_id:number;row_version:number},prior:PreparationLedger,next:PreparationLedger){
 const conflict=():never=>{throw new Error('[RECOVERY_CONFLICT]');};
 if(prior.permitIssued||prior.dispatchStarted||next.permitIssued||next.dispatchStarted
  ||prior.generation!==next.generation||prior.projectId!==next.projectId||prior.attemptId!==next.attemptId
  ||prior.taskId!==next.taskId||prior.workItemId!==next.workItemId)return conflict();
 for(const ledger of [prior,next]){
  if((ledger.startedAtMs===null)!==(ledger.deadlineMs===null))return conflict();
  if(ledger.startedAtMs!==null&&(!Number.isFinite(ledger.startedAtMs)||!Number.isFinite(ledger.deadlineMs)
   ||ledger.deadlineMs!-ledger.startedAtMs!==180000))return conflict();
 }
 const row=await tx.browserDeliveryRecovery.findUnique({where:{project_id_attempt_id:{project_id:prior.projectId,attempt_id:prior.attemptId}}});
 if(!row||row.content_item_id!==prior.taskId||row.work_item_id!==prior.workItemId||row.execution_generation!==prior.generation
  ||row.stage!=='PREPARE'||row.delivery_certainty!=='NOT_DISPATCHED'
  ||(row.started_at?.getTime()??null)!==prior.startedAtMs||(row.deadline_at?.getTime()??null)!==prior.deadlineMs)return conflict();
 if(await tx.workflowEvent.count({where:{project_id:prior.projectId,content_item_id:prior.taskId,work_item_id:prior.workItemId,
  OR:[{command:{in:['ba_pre_submit_browser_submission','browser_preparation_dispatch_started','x_native_issue_challenge']}},
   {after_state:{path:['submission_permitted'],equals:true}},{after_state:{path:['provider_called'],equals:true}}]}}))return conflict();
 const changed=await tx.browserDeliveryRecovery.updateMany({where:{project_id:prior.projectId,attempt_id:prior.attemptId,
  content_item_id:prior.taskId,work_item_id:prior.workItemId,row_version:row.row_version,execution_generation:prior.generation,
  stage:'PREPARE',delivery_certainty:'NOT_DISPATCHED',started_at:row.started_at,deadline_at:row.deadline_at},
  data:{row_version:{increment:1},started_at:next.startedAtMs===null?null:new Date(next.startedAtMs),deadline_at:next.deadlineMs===null?null:new Date(next.deadlineMs)}});
 if(changed.count!==1)return conflict();
 await replacePreparation(tx,stored,next);
}

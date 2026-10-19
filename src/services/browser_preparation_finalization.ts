import {preparationLedger} from './browser_preparation_contract';
import type {BrowserDb} from './browser_publication_contract';
import type {RecoveryReservation} from './browser_recovery_contract';
/** Called only inside the existing guarded canonical finalization transaction, after its original checks/writes. Grants no authority. */
export async function completePreparationAfterFinalization(tx:BrowserDb,reservation:RecoveryReservation):Promise<void>{
 const availability=await tx.$queryRaw<Array<{preparation_available:boolean}>>`SELECT to_regclass('planner.browser_preparation_execution') IS NOT NULL AS preparation_available`;
 if(availability[0]?.preparation_available!==true)return;
 const scope=reservation.scope,stored=await tx.browserPreparationExecution.findUnique({where:{project_id_attempt_id:{project_id:scope.projectId,attempt_id:scope.attemptId}}});
 if(!stored)return;
 const parsed=preparationLedger.safeParse(stored.ledger),recovery=await tx.browserDeliveryRecovery.findUnique({where:{project_id_attempt_id:{project_id:scope.projectId,attempt_id:scope.attemptId}}});
 if(!parsed.success)throw new Error('[RECOVERY_CONFLICT]');const ledger=parsed.data;
 if(ledger.projectId!==scope.projectId||ledger.taskId!==scope.taskId||ledger.attemptId!==scope.attemptId||ledger.workItemId!==stored.work_item_id||ledger.generation!==reservation.executionGeneration||ledger.state!=='awaiting_result'||!ledger.permitIssued||!recovery||recovery.work_item_id!==ledger.workItemId||recovery.package_sha256!==scope.packageSha256||recovery.state!=='finalized'||recovery.row_version!==reservation.rowVersion+1)throw new Error('[RECOVERY_CONFLICT]');
 const changed=await tx.browserPreparationExecution.updateMany({where:{project_id:scope.projectId,attempt_id:scope.attemptId,row_version:stored.row_version},data:{row_version:{increment:1},ledger:{...ledger,state:'complete',revision:ledger.revision+1}}});
 if(changed.count!==1)throw new Error('[RECOVERY_CONFLICT]');
}

import {Prisma} from '@prisma/client';
import {hash,snapshotHash,type BrowserDb,type BrowserDependencies,type BrowserRequest} from './browser_publication_contract';
import {browserRecoveryEnabled} from './browser_recovery_guard';
import {loadPreparationState} from './browser_recovery_resume_repository';
import {preparationLedger,type PreparationLedger,type PreparationRequest,type PreparationSupervisor} from './browser_preparation_contract';
export const preparationSerial={isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:2000,timeout:10000};
export async function loadPreparation(tx:BrowserDb,deps:BrowserDependencies,args:PreparationRequest,executorId:string){
 const state=await loadPreparationState(tx,deps,args);
 if(!state||!state.ownerAuthorized||!state.permissionAllowed)throw new Error('[PERMISSION_DENIED]');
 if(!state.approvalActive||state.originalApprovalSha256!==state.currentApprovalSha256)throw new Error('[APPROVAL_REVOKED]');
 if(state.packageSha256!==state.currentPackageSha256)throw new Error('[PACKAGE_CHANGED]');
 const stored=await tx.browserPreparationExecution.findUnique({where:{project_id_attempt_id:{project_id:args.projectId,attempt_id:args.attemptId}}});
 const parsed=preparationLedger.safeParse(stored?.ledger);
 if(!parsed.success||parsed.data.projectId!==args.projectId||parsed.data.taskId!==args.taskId||parsed.data.attemptId!==args.attemptId||parsed.data.workItemId!==state.workItemId||parsed.data.executorSha256!==hash(executorId)||parsed.data.generation!==state.executionGeneration)throw new Error('[PRE_DISPATCH_PROOF_UNAVAILABLE]');
 return {state,ledger:parsed.data,stored:stored!};
}
export async function replacePreparation(tx:BrowserDb,prior:{project_id:number;attempt_id:number;row_version:number},ledger:PreparationLedger):Promise<void>{
 const changed=await tx.browserPreparationExecution.updateMany({where:{project_id:prior.project_id,attempt_id:prior.attempt_id,row_version:prior.row_version},data:{row_version:{increment:1},ledger:preparationLedger.parse({...ledger,revision:ledger.revision+1})}});
 if(changed.count!==1)throw new Error('[RECOVERY_CONFLICT]');
}
export async function admitPreparation(tx:BrowserDb,args:BrowserRequest&{workItemId:number;leaseToken:string},attemptId:number,supervisor:PreparationSupervisor){
 if(!browserRecoveryEnabled()||!supervisor.executorId||!supervisor.supports(args.snapshot))throw new Error('[PRE_DISPATCH_PROOF_UNAVAILABLE]');
 await tx.browserDeliveryRecovery.create({data:{project_id:args.projectId,content_item_id:args.taskId,attempt_id:attemptId,work_item_id:args.workItemId,package_sha256:snapshotHash(args.snapshot),approval_sha256:hash(args.approvalReference),original_snapshot:args.snapshot,stage:'PREPARE',delivery_certainty:'NOT_DISPATCHED',cause_code:'PREPARE_STARTED',recovery_action:'NONE'}});
 const ledger:PreparationLedger={version:1,projectId:args.projectId,taskId:args.taskId,attemptId,workItemId:args.workItemId,executorSha256:hash(supervisor.executorId),generation:0,revision:0,state:'preparing',resumptions:0,startedAtMs:null,deadlineMs:null,operationSha256:null,challengeSha256:null,proofSha256:null,outbox:'none',permitIssued:false,dispatchStarted:false};
 await tx.browserPreparationExecution.create({data:{project_id:args.projectId,attempt_id:attemptId,content_item_id:args.taskId,work_item_id:args.workItemId,ledger}});
 await tx.workflowEvent.create({data:{project_id:args.projectId,content_item_id:args.taskId,work_item_id:args.workItemId,actor_id:args.actorId,command:'browser_preparation_admitted',after_state:{attempt_id:attemptId,generation:0,executor_sha256:ledger.executorSha256,submission_permitted:false}}});
}

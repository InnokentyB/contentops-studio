import {completePreparationAfterFinalization} from './browser_preparation_finalization';
import {requireBrowserOwner,type BrowserDb} from './browser_publication_contract';
import type {RecoveryReservation} from './browser_recovery_contract';
import {finalizeRecoveryState} from './browser_recovery_repository';
const admittedTransactions=new WeakMap<BrowserDb,{projectId:number;taskId:number}>();
const completedTransactions=new WeakMap<BrowserDb,RecoveryReservation>();
export function browserRecoveryEnabled():boolean{return process.env.BROWSER_RECOVERY_V2_ENABLED==='true';}
/** Storage discovery is independent of admission: rollback must not remove persisted holds. */
export async function browserRecoveryStorageAvailable(tx:BrowserDb):Promise<boolean>{
 const rows=await tx.$queryRaw<Array<{available:boolean}>>`SELECT to_regclass('planner.browser_delivery_recovery') IS NOT NULL AS available`;
 const available=rows[0]?.available===true;
 if(!available&&browserRecoveryEnabled())throw new Error('[BROWSER_RECOVERY_STORAGE_UNAVAILABLE]');
 return available;
}
/** Existing v1 mutation paths cannot bypass a v2 hold. Admission being off does not disable persisted holds. */
export type PreparationWriterPurpose={kind:'first_permit';attemptId:number;generation:number};
export async function assertBrowserRecoveryWriter(tx:BrowserDb,args:{projectId:number;taskId:number;attemptId?:number},purpose?:PreparationWriterPurpose):Promise<void>{
 if(!await browserRecoveryStorageAvailable(tx))return;
 const preparation=preparationWriters.get(tx);
 if(purpose?.kind==='first_permit'&&preparation?.projectId===args.projectId&&preparation.taskId===args.taskId&&preparation.attemptId===args.attemptId&&preparation.attemptId===purpose.attemptId&&preparation.generation===purpose.generation)return;
 const permit=admittedTransactions.get(tx);
 if(permit?.projectId===args.projectId&&permit.taskId===args.taskId)return;
 if(await tx.browserDeliveryRecovery.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId}}))throw new Error('[BROWSER_RECOVERY_V2_HELD]');
}
/** Internal canonical finalization capability, never a request flag or serialized token. */
export async function withBrowserRecoveryFinalization(tx:BrowserDb,r:RecoveryReservation,actorId:string,signal:AbortSignal,check:()=>Promise<void>):Promise<void>{
 if(!browserRecoveryEnabled()||signal.aborted)throw new Error('[BROWSER_RECOVERY_V2_HELD]');
 // CAS first, then checks/fact write in the same transaction; all changes roll back on any failure.
 await finalizeRecoveryState(tx,r,actorId,signal);
 admittedTransactions.set(tx,r.scope);
 try{await check();if(signal.aborted)throw new Error('[RECOVERY_CANCELLED]');await completePreparationAfterFinalization(tx,r);if(signal.aborted)throw new Error('[RECOVERY_CANCELLED]');completedTransactions.set(tx,r);}
 finally{admittedTransactions.delete(tx);}
}

/** All canonical fact callers, including internal callbacks, must respect the same hold. */
export async function assertBrowserRecoveryFactWriter(tx:BrowserDb,args:{projectId:number;taskId:number}):Promise<void>{
 const completed=completedTransactions.get(tx);
 if(completed?.scope.projectId===args.projectId&&completed.scope.taskId===args.taskId)return;
 await assertBrowserRecoveryWriter(tx,args);
}
/** Last transactional check before COMMIT; abort/expiry cannot silently commit a late result. */
export async function assertBrowserRecoveryCommit(tx:BrowserDb,r:RecoveryReservation,actorId:string,signal:AbortSignal):Promise<void>{
 if(signal.aborted)throw new Error('[RECOVERY_CANCELLED]');
 if(Date.now()>=r.deadlineMs)throw new Error('[RECOVERY_CONFLICT]');
 const completed=completedTransactions.get(tx);
 if(completed!==r)throw new Error('[RECOVERY_CONFLICT]');
 await requireBrowserOwner(tx,{projectId:r.scope.projectId,actorId});
 const row=await tx.browserDeliveryRecovery.findFirst({where:{project_id:r.scope.projectId,content_item_id:r.scope.taskId,attempt_id:r.scope.attemptId,package_sha256:r.scope.packageSha256,state:'finalized',row_version:r.rowVersion+1,execution_generation:r.executionGeneration}});
 if(!row||signal.aborted)throw new Error(signal.aborted?'[RECOVERY_CANCELLED]':'[RECOVERY_CONFLICT]');
}

const preparationWriters=new WeakMap<BrowserDb,{projectId:number;taskId:number;attemptId:number;generation:number}>();
export function preparationWriterPurpose(tx:BrowserDb,args:{projectId:number;taskId:number;attemptId:number}):PreparationWriterPurpose|undefined{
 const value=preparationWriters.get(tx);return value&&value.projectId===args.projectId&&value.taskId===args.taskId&&value.attemptId===args.attemptId?{kind:'first_permit',attemptId:value.attemptId,generation:value.generation}:undefined;
}
export function isBrowserPreparationWriter(tx:BrowserDb,args:{projectId:number;taskId:number;attemptId:number}):boolean{
 const admitted=preparationWriters.get(tx);return admitted?.projectId===args.projectId&&admitted.taskId===args.taskId&&admitted.attemptId===args.attemptId;
}
/** Internal supervised first-permit seam; generation, immutable package and lease are rechecked before granting a narrow transaction-local writer. */
export async function withBrowserPreparationPermit<T>(tx:BrowserDb,args:{projectId:number;taskId:number;attemptId:number;generation:number;packageSha256:string;leaseSha256:string},run:()=>Promise<T>):Promise<T>{
 if(!browserRecoveryEnabled())throw new Error('[PRE_DISPATCH_PROOF_UNAVAILABLE]');
 const row=await tx.browserDeliveryRecovery.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId,attempt_id:args.attemptId,execution_generation:args.generation,package_sha256:args.packageSha256,stage:'PREPARE',delivery_certainty:'NOT_DISPATCHED',state:{in:['idle','resumed']}}});
 if(!row||(args.generation>0&&(row.recovery_lease_sha256!==args.leaseSha256||!row.recovery_lease_expires_at||row.recovery_lease_expires_at<=new Date())))throw new Error('[RECOVERY_CONFLICT]');
 preparationWriters.set(tx,args);try{return await run();}finally{preparationWriters.delete(tx);}
}

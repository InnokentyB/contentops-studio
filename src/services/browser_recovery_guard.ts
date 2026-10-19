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
export async function assertBrowserRecoveryWriter(tx:BrowserDb,args:{projectId:number;taskId:number}):Promise<void>{
 if(!await browserRecoveryStorageAvailable(tx))return;
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
 try{await check();if(signal.aborted)throw new Error('[RECOVERY_CANCELLED]');completedTransactions.set(tx,r);}
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

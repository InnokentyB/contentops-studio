import {z} from 'zod';
import {preparationRequest,type PreparationSupervisor} from './browser_preparation_contract';
import type {BrowserRequest,BrowserDependencies,BrowserDb} from './browser_publication_contract';
import type {RecoveryClock,RecoveryReadControl,RecoveryReservation} from './browser_recovery_contract';
export const legacyRecoveryRequest=preparationRequest;
export type LegacyRecoveryRequest=z.infer<typeof legacyRecoveryRequest>;
export type LegacyRecoveryContext=LegacyRecoveryRequest&{workItemId:number;snapshot:BrowserRequest['snapshot'];approvalReference:string;attemptKey:string;packageSha256:string;approvalSha256:string;oldLeaseSha256:string;challenge:string;deadlineMs:number};
/** Registered custody must account for every historical/offline executor, not just the new lease. */
export type LegacyBrowserSupervisor=PreparationSupervisor&{fenceLegacy:(context:LegacyRecoveryContext&{signal:AbortSignal})=>Promise<unknown>};
/** The existing permitted owning-executor reader; no request can register or replace this port. */
export type LegacyBrowserReader={supports:(snapshot:BrowserRequest['snapshot'])=>boolean;read:(context:LegacyRecoveryContext,control:RecoveryReadControl)=>Promise<unknown>};
export type LegacyRecoveryOptions={deps?:BrowserDependencies;supervisor?:LegacyBrowserSupervisor;reader?:LegacyBrowserReader;clock?:RecoveryClock;beforeAdoptionCommit?:(tx:BrowserDb,context:LegacyRecoveryContext)=>Promise<void>};
const sha=z.string().regex(/^[a-f0-9]{64}$/),ref=z.string().regex(/^sha256:[a-f0-9]{64}$/);
const scope={projectId:z.number().int().positive(),taskId:z.number().int().positive(),attemptId:z.number().int().positive(),packageSha256:sha,challengeSha256:sha};
export const legacyCustodyProof=z.object({...scope,version:z.literal(1),workItemId:z.number().int().positive(),executorId:z.string().min(1).max(200),approvalSha256:sha,oldLeaseSha256:sha,lifecycleCoverage:z.literal('complete'),oldExecutorQuiescent:z.literal(true),issuedPermitCount:z.literal(0),dispatchCount:z.literal(0),evidenceRef:ref}).strict();
export const legacyAbsenceProof=z.object({...scope,kind:z.literal('ABSENT'),version:z.literal(1),accountSha256:sha,observedAtMs:z.number().finite(),coverage:z.literal('complete'),duplicateAbsent:z.literal(true),evidenceRef:ref}).strict();
export type LegacyReservation={context:LegacyRecoveryContext;reservation:RecoveryReservation;operationKey:string};
export const legacyClock:RecoveryClock={now:Date.now,wait:(ms,signal)=>new Promise<void>((resolve,reject)=>{
 if(signal.aborted){reject(new Error('[RECONCILIATION_CANCELLED]'));return;}
 const abort=()=>{clearTimeout(timer);reject(new Error('[RECONCILIATION_CANCELLED]'));};
 const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});
}),timer:(ms,callback)=>{const timer=setTimeout(callback,ms);return()=>clearTimeout(timer);}};
/** A late dependency result cannot outlive its reservation or acquire mutation authority. */
export async function legacyBounded<T>(clock:RecoveryClock,deadline:number,run:(signal:AbortSignal)=>Promise<T>):Promise<T>{
 const controller=new AbortController();let cancel:()=>void=()=>undefined;
 try{return await Promise.race([new Promise<never>((_resolve,reject)=>{
  const remaining=deadline-clock.now();if(remaining<=0){controller.abort();reject(new Error('[RECONCILIATION_BUDGET_EXHAUSTED]'));return;}
  cancel=clock.timer(remaining,()=>{controller.abort();reject(new Error('[RECONCILIATION_TEMPORARILY_UNAVAILABLE]'));});
 }),Promise.resolve().then(()=>{if(controller.signal.aborted)throw new Error('[RECONCILIATION_BUDGET_EXHAUSTED]');return run(controller.signal);})]);}
 finally{cancel();controller.abort();}
}

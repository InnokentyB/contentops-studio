import {createBrowserRecoveryOperation,type BrowserRecoveryOperation} from './browser_recovery_runtime';
import {createLinkedInRecoveryReader} from './linkedin_recovery_reader';
import {finalizeVerifiedBrowserRecovery} from './browser_recovery_verified_fact';
import {browserUncertainSchema} from './browser_publication_execution';
import {browserDefaults,type BrowserDependencies} from './browser_publication_contract';
import type {BrowserRecoveryPorts,RecoveryClock} from './browser_recovery_contract';
/** No environment switch admits provider permissions or changes a browser account's approved route. */
export function createPublicationRecoveryApplication(options:{linkedin?:Parameters<typeof createLinkedInRecoveryReader>[0];clock?:RecoveryClock;deps?:BrowserDependencies}={}):BrowserRecoveryOperation {
 const ports:BrowserRecoveryPorts=new Map();if(options.linkedin)ports.set('linkedin',createLinkedInRecoveryReader(options.linkedin));
 const clock:RecoveryClock=options.clock??{now:Date.now,wait:(ms,signal)=>new Promise<void>((resolve,reject)=>{
  if(signal.aborted){reject(new Error('[RECOVERY_CANCELLED]'));return;}
  const stop=()=>{clearTimeout(timer);reject(new Error('[RECOVERY_CANCELLED]'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},ms);signal.addEventListener('abort',stop,{once:true});
 }),timer:(ms,callback)=>{const timer=setTimeout(callback,ms);return ()=>clearTimeout(timer);}};
 return async input=>{
  const args=browserUncertainSchema.parse(input),{reasonCode:omitted,...factInput}=args;
  return createBrowserRecoveryOperation(ports,clock,async(r,e,_outcome,signal)=>{
   try{return await finalizeVerifiedBrowserRecovery(factInput,r,e,signal,options.deps??browserDefaults);}
   catch(error:unknown){
    const code=error instanceof Error?/^\[([A-Z_]+)\]/.exec(error.message)?.[1]:undefined;
    if(code==='OWNER_REQUIRED')return 'permission_denied';
    if(code==='BROWSER_RELEASE_PROOF_INVALID'||code==='BROWSER_RELEASE_AUDIT_REQUIRED')return 'approval_revoked';
    if(code==='STALE_MANIFEST'||code==='BROWSER_SNAPSHOT_MISMATCH'||code==='BROWSER_IDENTITY_INVALID')return 'package_changed';
    return 'conflict';
   }
  },options.deps??browserDefaults)(args);
 };
}

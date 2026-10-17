import type { BrowserDb, BrowserRequest } from './browser_publication_contract';

export type NativePhase='start'|'permit'|'result'|'reconcile'|'unknown';
export type NativeGateArgs=Pick<BrowserRequest,'projectId'|'taskId'|'actorId'|'snapshot'|'idempotencyKey'>
    &{workItemId:number;attemptId?:number;leaseToken?:string};
/** In-process HTTP executor seam; never accepted as caller data by a schema/RPC. */
export type NativeGate=(tx:BrowserDb,phase:NativePhase,args:NativeGateArgs)=>Promise<void>;
export function assertBrowserNativeAdmission(args:NativeGateArgs,gate?:NativeGate):void {
    if(args.snapshot.identity.platform==='x'){
        if(typeof gate!=='function')throw new Error('[BROWSER_NATIVE_RECEIPT_REQUIRED]');
    }else if(gate)throw new Error('[BROWSER_NATIVE_POLICY_MISMATCH]');
}
/** Receipt verification and nonce CAS are part of the same canonical mutation. */
export async function requireBrowserNativeGate(tx:BrowserDb,phase:NativePhase,args:NativeGateArgs,gate?:NativeGate):Promise<void>{
    assertBrowserNativeAdmission(args,gate);
    if(gate)await gate(tx,phase,args);
}

import type { BrowserDb, BrowserRequest } from './browser_publication_contract';

export type NativePhase='start'|'permit'|'result'|'reconcile'|'unknown';
export type NativeGateArgs=Pick<BrowserRequest,'projectId'|'taskId'|'actorId'|'snapshot'|'idempotencyKey'>
    &{workItemId:number;attemptId?:number;leaseToken?:string};
/** In-process HTTP executor seam; never accepted as caller data by a schema/RPC. */
export type NativeGate=(tx:BrowserDb,phase:NativePhase,args:NativeGateArgs)=>Promise<void>;
export function assertBrowserNativeAdmission(args:NativeGateArgs,gate?:NativeGate):void {
    if(args.snapshot.identity.platform!=='x'&&gate)throw new Error('[BROWSER_NATIVE_POLICY_MISMATCH]');
}
/** Selected by the server entry point, never by a caller profile/flag. */
export function browserExecutionSource(args:NativeGateArgs,gate?:NativeGate) {
    return args.snapshot.identity.platform==='x'
        ? gate?'signed_x_extension_v1':'governed_x_browser_v1':undefined;
}
/** Receipt verification and nonce CAS are part of the same canonical mutation. */
export async function requireBrowserExecutionSource(tx:BrowserDb,args:NativeGateArgs,gate?:NativeGate):Promise<void>{
    if(args.snapshot.identity.platform==='x'){
        const start=await tx.workflowEvent.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId,
            work_item_id:args.workItemId,actor_id:args.actorId,command:'ba_start_browser_submission',idempotency_key:args.idempotencyKey}});
        const proof=start?.after_state;
        if(!proof||typeof proof!=='object'||Array.isArray(proof)||!('attempt_id' in proof)||proof.attempt_id!==args.attemptId)
            throw new Error('[BROWSER_EXECUTION_SOURCE_REQUIRED]');
        const source='execution_source' in proof?proof.execution_source:undefined;
        if(source==='governed_x_browser_v1'){
            if(gate)throw new Error('[BROWSER_NATIVE_POLICY_MISMATCH]');
        }else if(source===undefined||source==='signed_x_extension_v1'){
            if(!gate)throw new Error('[BROWSER_NATIVE_RECEIPT_REQUIRED]');
        }else throw new Error('[BROWSER_EXECUTION_SOURCE_REQUIRED]');
    }
}
export async function requireBrowserNativeGate(tx:BrowserDb,phase:NativePhase,args:NativeGateArgs,gate?:NativeGate):Promise<void>{
    assertBrowserNativeAdmission(args,gate);
    if(phase!=='start')await requireBrowserExecutionSource(tx,args,gate);
    if(gate)await gate(tx,phase,args);
}

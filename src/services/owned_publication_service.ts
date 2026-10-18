import {ownedCheck,runOwnedInvocation} from './owned_publication_invocation';
import {ownedRequestSchema} from './owned_publication_contract';
import type {OwnedPublicationRequest as Request,OwnedPublicationPrincipal as Principal,OwnedPublicationAdapter as Adapter,OwnedPublicationResult as Result,OwnedPublicationClaim as Claim,OwnedPublicationBudget as Budget} from './owned_publication_contract';
import {OwnedPublicationStore} from './owned_publication_store';
/** Application orchestration: private adapter ports are selected by the server composition root only. */
export class OwnedPublicationService{
    constructor(readonly ports:{store:OwnedPublicationStore;adapter:Adapter;workBudgetMs?:number}){}
    private async heldAfterFailure(r:Request,c:Claim,
        reason:'OWNED_PROVIDER_OUTCOME_UNCERTAIN'|'OWNED_COMPLETION_REQUIRES_RECONCILIATION'):Promise<Result>{
        try{await this.ports.store.freeze(c,reason);return {...this.ports.store.held(r,c.attemptId),blocker:reason};}
        catch(storageError:unknown){return {...this.ports.store.held(r,c.attemptId),blocker:'OWNED_EVIDENCE_STORAGE_UNAVAILABLE'};}
    }
    async execute(input:Request,principal:Principal):Promise<Result>{
        const workBudget=Math.min(230000,this.ports.workBudgetMs??230000);
        if(!Number.isSafeInteger(workBudget)||workBudget<1)throw Error('OWNED_INVALID_WORK_BUDGET');
        const controller=new AbortController(),budget:Budget={deadline:Date.now()+workBudget,signal:controller.signal};
        let claim:Claim|undefined;
        const timer=setTimeout(()=>controller.abort(),Math.max(0,budget.deadline-Date.now()));
        try{const result=await runOwnedInvocation(budget,()=>this.executeWithin(input,principal,budget,c=>{claim=c;}));ownedCheck(budget);return result;}
        catch(error:unknown){if(controller.signal.aborted||error instanceof Error&&error.message==='OWNED_INVOCATION_TIMED_OUT')return {
            state:claim?'verification_required':'blocked',project_id:input.projectId,task_id:input.taskId,attempt_id:claim?.attemptId,retry_allowed:false,blocker:'OWNED_INVOCATION_TIMED_OUT'};throw error;}
        finally{clearTimeout(timer);controller.abort();}
    }
    private async executeWithin(input:Request,principal:Principal,budget:Budget,claimed:(c:Claim)=>void):Promise<Result>{
        ownedCheck(budget);
        if(Buffer.byteLength(JSON.stringify(input))>65536)throw Error('OWNED_REQUEST_TOO_LARGE');
        const r=ownedRequestSchema.parse(input),{store,adapter}=this.ports;
        if(r.operation==='reconcile'){
            if(!r.attemptId||!r.idempotencyKey||r.approvalReference)throw Error('OWNED_RECONCILE_BINDING_REQUIRED');
            let c;try{c=await store.loadClaim(r,principal);}catch(error:unknown){if(error instanceof Error&&error.message==='OWNED_HISTORY_AMBIGUOUS')return store.held(r,r.attemptId);throw error;}
            claimed(c);if(r.dryRun)return {...store.held(r,c.attemptId),state:'preview'};
            const replay=await store.replay(r,principal);if(replay?.state==='published')return replay;
            if(!await store.retained(c)){
                if(!c.nativeObjectId)return store.held(r,c.attemptId);
                await store.assertRecovery(r,principal,c);ownedCheck(budget);await adapter.authorize('readback',budget);ownedCheck(budget);const receipt=await adapter.readback(c,budget);ownedCheck(budget);
                if(!receipt)return store.held(r,c.attemptId);await store.saveReceipt(c,receipt);
            }
            try{return await store.confirm(r,principal,c);}catch(error:unknown){if(error instanceof Error&&error.message==='OWNED_INVOCATION_TIMED_OUT')throw error;ownedCheck(budget);return this.heldAfterFailure(r,c,'OWNED_COMPLETION_REQUIRES_RECONCILIATION');}
        }
        if(r.attemptId||r.operation==='publish'&&r.approvalReference)throw Error('OWNED_OPERATION_FIELD_CONFLICT');
        if(!r.dryRun&&(!r.idempotencyKey||!r.expectedAcceptedRevision||!r.expectedPackageSha256||!r.expectedManifestChecksum
            ||r.operation==='release'&&!r.approvalReference))throw Error('OWNED_EXACT_BINDING_REQUIRED');
        if(r.operation==='publish'){
            const replay=await store.replay(r,principal);if(replay)return r.dryRun?{...replay,state:'preview'}:replay;
        }
        if(r.operation==='release'&&!r.dryRun){const prior=await store.releaseReplay(r,principal);if(prior)return prior;}
        const pkg=await store.inspect(r,principal);
        if(r.dryRun)return {state:'preview',project_id:r.projectId,task_id:r.taskId,retry_allowed:false,package_sha256:pkg.digest,
            accepted_revision:pkg.revision,manifest_checksum:pkg.manifest,blocker:'NATIVE_READINESS_UNVERIFIED'};
        if(r.operation==='release')return store.release(r,principal);
        ownedCheck(budget);await adapter.authorize('inventory',budget);ownedCheck(budget);const inventory=await adapter.inventory(pkg,budget);ownedCheck(budget);
        const claim=await store.claim(r,principal,inventory);claimed(claim);
        try{
            const receipt=await adapter.publish(claim,{beforeMutation:()=>runOwnedInvocation(budget,async()=>{ownedCheck(budget);await adapter.authorize('mutation',budget);ownedCheck(budget);await store.start(r,principal,claim);}),
                beforeSubmit:observation=>runOwnedInvocation(budget,async()=>{ownedCheck(budget);await adapter.authorize('submit',budget);ownedCheck(budget);await store.submit(r,principal,claim,observation);})},budget);ownedCheck(budget);
            await store.saveReceipt(claim,receipt);return await store.confirm(r,principal,claim);
        }catch(error:unknown){if(error instanceof Error&&error.message==='OWNED_INVOCATION_TIMED_OUT')throw error;ownedCheck(budget);return this.heldAfterFailure(r,claim,'OWNED_PROVIDER_OUTCOME_UNCERTAIN');}
    }
}

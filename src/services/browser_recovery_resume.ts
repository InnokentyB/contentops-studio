import type {PreparationLedger} from './browser_preparation_contract';
import {projectBrowserRecovery} from './browser_recovery_assessment';
import {recoveryOutcome} from './browser_recovery_coordinator';
import type {RecoveryOutcome} from './browser_recovery_contract';
import { createHash, randomUUID } from 'node:crypto';
export type ResumeScope = {projectId:number;taskId:number;attemptId:number;actorId:string};
export type BrowserRecoveryResumeState = ResumeScope & {contractVersion:2;rowVersion:number;executionGeneration:number;
    stage:string;deliveryCertainty:string;attemptStatus:string;ownerAuthorized:boolean;permissionAllowed:boolean;
    approvalActive:boolean;originalApprovalSha256:string;currentApprovalSha256:string;
    packageSha256:string;currentPackageSha256:string;workItemId:number;recoveryLeaseExpiresAt:Date|null;recoveryState:string};
export type BrowserRecoveryResumeProof = {executorId:string;evidenceRef:string;issuedPermitCount:0;dispatchCount:0;
    oldExecutorQuiescent:true;challengeSupersessionSupported:true;resumeDeadlineMs?:number};
export type ResumeCommit = {scope:ResumeScope;expectedRowVersion:number;expectedGeneration:number;nextGeneration:number;
    leaseToken:string;leaseSha256:string;leaseExpiresAt:Date;requestSha256:string;idempotencyKey:string;
    executorId:string;evidenceRef:string};
/** The repository MUST atomically CAS generation/version, supersede challenges, rotate lease and append audit; never clear attempt errors. */
export interface BrowserRecoveryResumeTransaction {
    load(scope:ResumeScope):Promise<BrowserRecoveryResumeState|null>;
    preparationProof?(scope:ResumeScope,executorId:string):Promise<PreparationLedger|null>;
    findReplay(scope:ResumeScope,idempotencyKey:string):Promise<{requestSha256:string;generation:number}|null>;
    commitResume(commit:ResumeCommit):Promise<boolean>;
}
/** This capability is registered by application code, never supplied through request data. */
export interface BrowserRecoveryResumePort {
    transaction<T>(run:(tx:BrowserRecoveryResumeTransaction)=>Promise<T>):Promise<T>;
    executorFence?:{executorId:string;proveQuiescence(tx:BrowserRecoveryResumeTransaction,state:BrowserRecoveryResumeState):Promise<BrowserRecoveryResumeProof|null>};
    now?:()=>Date;
}
export type BrowserRecoveryResumeResult = RecoveryOutcome & {generation?:number;replayed?:boolean;resumed:boolean;state?:'resumed_requires_executor_pickup';submission_permitted:false;retry_allowed:false};
function digest(value:string):string { return createHash('sha256').update(value).digest('hex'); }
function request(input:unknown):ResumeScope&{idempotencyKey:string} {
    if(input===null||typeof input!=='object'||Array.isArray(input))throw new Error('[RECOVERY_INVALID_REQUEST]');
    const value=input as Record<string,unknown>;
    const allowed=['projectId','taskId','attemptId','actorId','idempotencyKey'];
    if(Object.keys(value).some(key=>!allowed.includes(key))||!['projectId','taskId','attemptId'].every(key=>typeof value[key]==='number'&&Number.isSafeInteger(value[key])&&Number(value[key])>0)
        ||typeof value.actorId!=='string'||!/^user:[1-9]\d*$/.test(value.actorId)
        ||typeof value.idempotencyKey!=='string'||value.idempotencyKey.length<1||value.idempotencyKey.length>120||value.idempotencyKey.trim()!==value.idempotencyKey)
        throw new Error('[RECOVERY_INVALID_REQUEST]');
    return {projectId:Number(value.projectId),taskId:Number(value.taskId),attemptId:Number(value.attemptId),actorId:value.actorId,idempotencyKey:value.idempotencyKey};
}
function response(code:string,extra:Partial<BrowserRecoveryResumeResult>={}):BrowserRecoveryResumeResult {
    const detail=code==='RECOVERY_PREPARE_RESUMED'||code==='PRE_DISPATCH_PROOF_UNAVAILABLE'
        ?projectBrowserRecovery({code})!:code==='POST_SUBMIT_UNKNOWN'
        ?{...recoveryOutcome('RECONCILIATION_NOT_FOUND'),code,stage:'AWAITING_RESULT' as const,deliveryCertainty:'POSSIBLY_SENT' as const,causeCode:code,message:'Submission may already have occurred for this attempt.',action:'Use only the registered read-only reconciliation path. Do not resume preparation, renew a submit permit or send again.'}
        :code==='RECOVERY_OWNER_REQUIRED'?{...recoveryOutcome('PERMISSION_DENIED'),code,causeCode:code,message:'The current actor is not authorized to recover this attempt.',action:'Use the authorized owner context for this project. Do not switch tenants or bypass the permission check.'}
        :code==='RECOVERY_SCOPE_MISMATCH'?{...recoveryOutcome('RECOVERY_CONFLICT'),code,stage:'PREPARE' as const,causeCode:code,recoveryAction:'CONTACT_ENGINEERING' as const,message:'The requested attempt is not available in this recovery scope.',action:'Ask engineering to inspect the scoped attempt and immutable recovery bindings. No publication or lease change was authorized.'}
        :recoveryOutcome(code);
    return {...detail,code,resumed:false,...extra,submission_permitted:false,retry_allowed:false};
}
/** Registers no submit permission: rotates only a proven pre-first-permit attempt into private executor pickup. */
export async function resumeBrowserRecovery(input:unknown,port:BrowserRecoveryResumePort):Promise<BrowserRecoveryResumeResult> {
    const args=request(input),{idempotencyKey,...scope}=args;
    const requestSha256=digest(JSON.stringify(args));
    return port.transaction(async tx=>{
        const state=await tx.load(scope);
        if(!state)return response('RECOVERY_SCOPE_MISMATCH');
        if(state.projectId!==scope.projectId||state.taskId!==scope.taskId||state.attemptId!==scope.attemptId||state.actorId!==scope.actorId)
            return response('RECOVERY_SCOPE_MISMATCH');
        if(state.ownerAuthorized!==true)return response('RECOVERY_OWNER_REQUIRED');
        if(state.permissionAllowed!==true)return response('PERMISSION_DENIED');
        if(![state.originalApprovalSha256,state.currentApprovalSha256,state.packageSha256,state.currentPackageSha256].every(value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)))return response('PRE_DISPATCH_PROOF_UNAVAILABLE');
        if(state.approvalActive!==true||state.originalApprovalSha256!==state.currentApprovalSha256)return response('APPROVAL_REVOKED');
        if(state.packageSha256!==state.currentPackageSha256)return response('PACKAGE_CHANGED');
        if(state.contractVersion!==2||!Number.isSafeInteger(state.rowVersion)||state.rowVersion<0||!Number.isSafeInteger(state.executionGeneration)||state.executionGeneration<0||state.executionGeneration>=Number.MAX_SAFE_INTEGER||state.attemptStatus!=='pending')return response('RECOVERY_CONFLICT');
        if(state.stage!=='PREPARE')return response('POST_SUBMIT_UNKNOWN');
        if(state.deliveryCertainty!=='NOT_DISPATCHED')return response('PRE_DISPATCH_PROOF_UNAVAILABLE');
        const prior=await tx.findReplay(scope,idempotencyKey);
        if(prior){
            const replayNow=port.now?.()||new Date();
            if(state.recoveryState!=='resumed'||!(state.recoveryLeaseExpiresAt instanceof Date)||!Number.isFinite(replayNow.getTime())
                ||!Number.isFinite(state.recoveryLeaseExpiresAt.getTime())||state.recoveryLeaseExpiresAt<=replayNow)return response('RECOVERY_CONFLICT');
            if(prior.requestSha256!==requestSha256||!Number.isSafeInteger(prior.generation)||prior.generation<1||prior.generation!==state.executionGeneration)return response('RECOVERY_CONFLICT');
            return response('RECOVERY_PREPARE_RESUMED',{generation:prior.generation,replayed:true,resumed:true,state:'resumed_requires_executor_pickup'});
        }
        if(state.stage!=='PREPARE')return response('POST_SUBMIT_UNKNOWN');
        if(state.deliveryCertainty!=='NOT_DISPATCHED')return response('PRE_DISPATCH_PROOF_UNAVAILABLE');
        const fence=port.executorFence;
        if(!fence||!fence.executorId||typeof fence.proveQuiescence!=='function')return response('PRE_DISPATCH_PROOF_UNAVAILABLE');
        const proof=await fence.proveQuiescence(tx,state);
        if(!proof||proof.executorId!==fence.executorId||proof.issuedPermitCount!==0||proof.dispatchCount!==0
            ||proof.oldExecutorQuiescent!==true||proof.challengeSupersessionSupported!==true||!/^sha256:[a-f0-9]{64}$/.test(proof.evidenceRef))return response('PRE_DISPATCH_PROOF_UNAVAILABLE');
        const now=port.now?.()||new Date();
        if(!Number.isFinite(now.getTime()))return response('RECOVERY_CONFLICT');
        const leaseToken=`recovery-${randomUUID()}`,nextGeneration=state.executionGeneration+1;
        const leaseDeadline=Math.min(now.getTime()+900000,proof.resumeDeadlineMs??Infinity);
        if(!Number.isFinite(leaseDeadline)||leaseDeadline<=now.getTime())return response('RECONCILIATION_BUDGET_EXHAUSTED');
        const committed=await tx.commitResume({scope,expectedRowVersion:state.rowVersion,expectedGeneration:state.executionGeneration,
            nextGeneration,leaseToken,leaseSha256:digest(leaseToken),leaseExpiresAt:new Date(leaseDeadline),
            requestSha256,idempotencyKey,executorId:proof.executorId,evidenceRef:proof.evidenceRef});
        return committed?response('RECOVERY_PREPARE_RESUMED',{generation:nextGeneration,replayed:false,resumed:true,state:'resumed_requires_executor_pickup'}):response('RECOVERY_CONFLICT');
    });
}

export {createPreparationRecovery} from './browser_preparation_recovery';

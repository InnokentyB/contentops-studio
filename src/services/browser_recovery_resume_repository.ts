import {preparationLedger} from './browser_preparation_contract';
import {isDeepStrictEqual} from 'node:util';
import {Prisma} from '@prisma/client';
import {browserSnapshotSchema,checkedBrowserContext,hash,object,snapshotHash,requireBrowserOwner,loadBrowserTask,browserFingerprint,
    type BrowserDependencies,type BrowserDb,type BrowserRequest} from './browser_publication_contract';
import {nativeStoredSchema} from './x_native_state';
import type {BrowserRecoveryResumePort,BrowserRecoveryResumeTransaction,BrowserRecoveryResumeState,ResumeScope,ResumeCommit} from './browser_recovery_resume';
const command='ba_resume_browser_recovery';
function knownGuard(error:unknown):string|null {
    if(!(error instanceof Error))return null;
    return /^\[(OWNER_REQUIRED|STALE_MANIFEST|BROWSER_SNAPSHOT_MISMATCH|BROWSER_IDENTITY_INVALID)\](?:\s|$)/.exec(error.message)?.[1]||null;
}
export async function loadPreparationState(tx:BrowserDb,deps:BrowserDependencies,scope:ResumeScope):Promise<BrowserRecoveryResumeState|null> {
    const row=await tx.browserDeliveryRecovery.findUnique({where:{project_id_attempt_id:{project_id:scope.projectId,attempt_id:scope.attemptId}}});
    if(!row||row.contract_version!==2||row.content_item_id!==scope.taskId)return null;
    const attempt=await tx.deliveryAttempt.findFirst({where:{id:scope.attemptId,project_id:scope.projectId,content_item_id:scope.taskId}});
    if(!attempt||await tx.deliveryAttempt.count({where:{project_id:scope.projectId,content_item_id:scope.taskId}})!==1)return null;
    const work=await tx.workItem.findFirst({where:{id:row.work_item_id,project_id:scope.projectId,content_item_id:scope.taskId,kind:'browser_publish'}});
    const parsed=browserSnapshotSchema.safeParse(row.original_snapshot);
    if(!work||!parsed.success)return null;
    const snapshot=parsed.data,proof=object(work.result_payload);
    if(snapshot.projectId!==scope.projectId||snapshot.taskId!==scope.taskId||snapshot.channelId!==attempt.channel_id||snapshotHash(snapshot)!==row.package_sha256)return null;
    const approvalReference=typeof proof.approval_reference==='string'?proof.approval_reference:'';
    const releaseKey=typeof proof.release_key==='string'?proof.release_key:'';
    const args:BrowserRequest={...scope,snapshot,approvalReference,idempotencyKey:attempt.idempotency_key||'',apply:false};
    let ownerAuthorized=true,permissionAllowed=true,approvalActive=true,currentPackageSha256=snapshotHash(snapshot);
    let task=await loadBrowserTask(tx,scope);
    try { await requireBrowserOwner(tx,args); task=await checkedBrowserContext(tx,args,deps); }
    catch(error:unknown){
        const code=knownGuard(error);if(!code)throw error;
        if(code==='OWNER_REQUIRED')ownerAuthorized=false;
        else if(code==='STALE_MANIFEST'||code==='BROWSER_SNAPSHOT_MISMATCH'||code==='BROWSER_IDENTITY_INVALID')currentPackageSha256=hash('current-package-invalid');
    }
    if(task&&proof.fingerprint!==browserFingerprint(task,snapshot))currentPackageSha256=hash('current-package-invalid');
    const audit=releaseKey?await tx.workflowEvent.findFirst({where:{project_id:scope.projectId,content_item_id:scope.taskId,
        work_item_id:work.id,actor_id:typeof proof.actor_id==='string'?proof.actor_id:'',command:'ba_release_browser_publication',idempotency_key:releaseKey}}):null;
    if(proof.lifecycle!=='shared_browser_v1'||proof.publication_authorized!==true||!approvalReference||!task
        ||!isDeepStrictEqual(proof,object(object(task.quality_report).browser_release))
        ||proof.snapshot_sha256!==snapshotHash(snapshot)||!isDeepStrictEqual(proof.snapshot,snapshot)
        ||object(audit?.after_state).browser_work_item_id!==work.id||object(audit?.after_state).publication_authorized!==true
        ||!isDeepStrictEqual(object(audit?.after_state).snapshot,snapshot))approvalActive=false;
    if(task&&(task.publication_fact||task.published_link||task.status!=='publishing'||task.publication_mode!=='browser_required'))permissionAllowed=false;
    return {...scope,contractVersion:2,rowVersion:row.row_version,executionGeneration:row.execution_generation,
        stage:row.stage,deliveryCertainty:row.delivery_certainty,attemptStatus:attempt.status,ownerAuthorized,permissionAllowed,
        approvalActive,originalApprovalSha256:row.approval_sha256,currentApprovalSha256:hash(approvalReference),
        packageSha256:row.package_sha256,currentPackageSha256,workItemId:work.id,recoveryLeaseExpiresAt:row.recovery_lease_expires_at,recoveryState:row.state};
}
/** Conservatively rejects granted permits AND issued permit challenges. Missing native records are not no-dispatch proof. */
async function safeChallenges(tx:BrowserDb,scope:ResumeScope,workItemId:number):Promise<boolean> {
    if(await tx.workflowEvent.count({where:{project_id:scope.projectId,content_item_id:scope.taskId,work_item_id:workItemId,command:'ba_pre_submit_browser_submission'}}))return false;
    const issued=await tx.workflowEvent.findMany({where:{project_id:scope.projectId,content_item_id:scope.taskId,work_item_id:workItemId,command:'x_native_issue_challenge'},take:101});
    if(issued.length>100)return false;
    for(const event of issued){
        const stored=await tx.projectSettings.findUnique({where:{project_id_key:{project_id:scope.projectId,key:`x_native:challenge:v1:${event.idempotency_key}`}}});
        if(!stored)return false;
        let decoded:unknown;
        try {decoded=JSON.parse(stored.value);}catch(error:unknown){if(error instanceof SyntaxError)return false;throw error;}
        const parsed=nativeStoredSchema.safeParse(decoded);
        if(!parsed.success||parsed.data.challenge.projectId!==scope.projectId||parsed.data.challenge.taskId!==scope.taskId
            ||parsed.data.challenge.workItemId!==workItemId||parsed.data.challenge.phase!=='start')return false;
    }
    return true;
}
async function commit(tx:BrowserDb,deps:BrowserDependencies,value:ResumeCommit):Promise<boolean> {
    const state=await loadPreparationState(tx,deps,value.scope);
    if(!state||!state.ownerAuthorized||!state.permissionAllowed||!state.approvalActive||state.packageSha256!==state.currentPackageSha256
        ||state.originalApprovalSha256!==state.currentApprovalSha256||state.attemptStatus!=='pending'
        ||state.rowVersion!==value.expectedRowVersion||state.executionGeneration!==value.expectedGeneration
        ||state.stage!=='PREPARE'||state.deliveryCertainty!=='NOT_DISPATCHED'||!await safeChallenges(tx,value.scope,state.workItemId))return false;
    const changed=await tx.browserDeliveryRecovery.updateMany({where:{project_id:value.scope.projectId,attempt_id:value.scope.attemptId,
        content_item_id:value.scope.taskId,row_version:value.expectedRowVersion,execution_generation:value.expectedGeneration,
        stage:'PREPARE',delivery_certainty:'NOT_DISPATCHED',state:{in:['held','idle','resumed']}},data:{row_version:{increment:1},execution_generation:value.nextGeneration,
        state:'resumed',cause_code:'LEASE_EXPIRED_PRE_DISPATCH',recovery_action:'CONTINUE_SAME_ATTEMPT_AFTER_REPAIR',
        recovery_lease_sha256:value.leaseSha256,recovery_lease_expires_at:value.leaseExpiresAt}});
    if(changed.count!==1)return false;
    const work=await tx.workItem.updateMany({where:{id:state.workItemId,project_id:value.scope.projectId,content_item_id:value.scope.taskId,
        kind:'browser_publish',state:{notIn:['completed','cancelled']}},data:{state:'claimed',lease_actor_id:value.scope.actorId,lease_token:value.leaseToken,lease_expires_at:value.leaseExpiresAt}});
    if(work.count!==1)throw new Error('[RECOVERY_CONFLICT]');
    await tx.projectSettings.updateMany({where:{project_id:value.scope.projectId,key:{startsWith:`x_native:phase:v1:${value.scope.taskId}:${state.workItemId}:`}},
        data:{value:hash(`superseded:${value.leaseSha256}:${value.nextGeneration}`)}});
    await tx.workflowEvent.create({data:{project_id:value.scope.projectId,content_item_id:value.scope.taskId,work_item_id:state.workItemId,
        actor_id:value.scope.actorId,command,idempotency_key:value.idempotencyKey,before_state:{request_hash:value.requestSha256},
        after_state:{attempt_id:value.scope.attemptId,generation:value.nextGeneration,lease_sha256:value.leaseSha256,
            lease_expires_at:value.leaseExpiresAt.toISOString(),evidence_sha256:value.evidenceRef.slice(7),executor_sha256:hash(value.executorId),
            state:'resumed_requires_executor_pickup',submission_permitted:false,retry_allowed:false}}});
    return true;
}
/** Prisma-backed transaction boundary. Unsupported executors remain unregistered and cannot resume. */
export function createBrowserRecoveryResumePort(deps:BrowserDependencies,fence?:BrowserRecoveryResumePort['executorFence'],onCommit?:(tx:BrowserDb,value:ResumeCommit)=>Promise<void>):BrowserRecoveryResumePort {
    return {executorFence:fence,transaction:run=>deps.db.$transaction(async tx=>{
        const port:BrowserRecoveryResumeTransaction={preparationProof:async(scope,executorId)=>{
            const stored=await tx.browserPreparationExecution.findUnique({where:{project_id_attempt_id:{project_id:scope.projectId,attempt_id:scope.attemptId}}});
            const parsed=preparationLedger.safeParse(stored?.ledger);if(!parsed.success)return null;const ledger=parsed.data;
            return ledger.projectId===scope.projectId&&ledger.taskId===scope.taskId&&ledger.attemptId===scope.attemptId&&ledger.executorSha256===hash(executorId)?ledger:null;
        },load:scope=>loadPreparationState(tx,deps,scope),findReplay:async(scope,idempotencyKey)=>{
            const event=await tx.workflowEvent.findFirst({where:{project_id:scope.projectId,content_item_id:scope.taskId,actor_id:scope.actorId,command,idempotency_key:idempotencyKey}});
            if(!event)return null;const before=object(event.before_state),after=object(event.after_state);
            if(after.attempt_id!==scope.attemptId||typeof before.request_hash!=='string'||typeof after.generation!=='number')throw new Error('[RECOVERY_CONFLICT]');
            return {requestSha256:before.request_hash,generation:after.generation};
        },commitResume:async value=>{
            if(!fence||value.executorId!==fence.executorId||value.nextGeneration!==value.expectedGeneration+1
                ||hash(value.leaseToken)!==value.leaseSha256||!/^sha256:[a-f0-9]{64}$/.test(value.evidenceRef)
                ||!Number.isFinite(value.leaseExpiresAt.getTime())||value.leaseExpiresAt.getTime()<=Date.now()
                ||value.leaseExpiresAt.getTime()>Date.now()+900000)return false;
            const state=await loadPreparationState(tx,deps,value.scope);if(!state)return false;
            const proof=await fence.proveQuiescence(port,state);
            if(!proof||proof.executorId!==fence.executorId||proof.evidenceRef!==value.evidenceRef||proof.issuedPermitCount!==0
                ||proof.dispatchCount!==0||proof.oldExecutorQuiescent!==true||proof.challengeSupersessionSupported!==true)return false;
            const committed=await commit(tx,deps,value);if(committed&&onCommit)await onCommit(tx,value);return committed;
        }};
        return run(port);
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:2000,timeout:10000})};
}

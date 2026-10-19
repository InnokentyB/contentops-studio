import {Prisma} from '@prisma/client';
import {randomUUID} from 'crypto';
import type {ThreadsApiSnapshot} from './threads_api_contract';
import {digest,threadsSnapshotSchema} from './threads_api_contract';
import type {ThreadsPhaseJournal} from './threads.service';
import {admitThreadsApiFinalizer} from './threads_api_fact_guard';
type Tx=Prisma.TransactionClient;
export const apiSerial={isolationLevel:Prisma.TransactionIsolationLevel.Serializable} as const;

export async function createThreadsApiState(tx:Tx,snapshot:ThreadsApiSnapshot,attemptId:number){
    return tx.apiDeliveryRecovery.create({data:{project_id:snapshot.projectId,content_item_id:snapshot.taskId,
        attempt_id:attemptId,package_sha256:snapshot.bodySha256,release_sha256:snapshot.releaseSha256,
        snapshot:{...snapshot}}});
}
export async function loadThreadsApiState(tx:Tx,projectId:number,taskId:number,attemptId:number){
    const row=await tx.apiDeliveryRecovery.findFirst({where:{project_id:projectId,content_item_id:taskId,attempt_id:attemptId,
        transport:'threads_api',contract_version:1}});
    if(!row)throw new Error('[THREADS_RECOVERY_CAPABILITY_UNAVAILABLE]');
    const snapshot=threadsSnapshotSchema.parse(row.snapshot);
    if(snapshot.projectId!==projectId||snapshot.taskId!==taskId||row.package_sha256!==snapshot.bodySha256
        ||row.release_sha256!==snapshot.releaseSha256)throw new Error('[THREADS_RECOVERY_CONFLICT]');
    return {row,snapshot};
}
/** Every persisted stage is CAS-fenced; an interrupted publisher has no automatic replay path. */
export function threadsPhaseJournal(transaction:<T>(run:(tx:Tx)=>Promise<T>)=>Promise<T>,scope:{projectId:number;taskId:number;attemptId:number},
    guard:(tx:Tx)=>Promise<void>,now:()=>number):ThreadsPhaseJournal{
    async function advance(from:string,to:string,data:Prisma.ApiDeliveryRecoveryUpdateManyMutationInput={}){
        await transaction(async tx=>{
            // Current authority gates each external mutation; receipts preserve original evidence even if authority later changes.
            if(from==='claimed'||from==='container_ready')await guard(tx);
            const {row,snapshot}=await loadThreadsApiState(tx,scope.projectId,scope.taskId,scope.attemptId);
            if(row.state!==from||row.generation!==1||row.lease_sha256)throw new Error('[THREADS_RECOVERY_CONFLICT]');
            const changed=await tx.apiDeliveryRecovery.updateMany({where:{id:row.id,project_id:scope.projectId,
                state:from,row_version:row.row_version,generation:1},data:{...data,state:to,row_version:{increment:1}}});
            if(changed.count!==1)throw new Error('[THREADS_RECOVERY_CONFLICT]');
            await tx.workflowEvent.create({data:{project_id:scope.projectId,content_item_id:scope.taskId,
                actor_id:snapshot.actorId,command:'threads_api_phase',
                after_state:{attempt_id:scope.attemptId,from,to,generation:1}}});
        });
    }
    return {beforeCreate:()=>advance('claimed','container_create_started'),
        containerCreated:id=>advance('container_create_started','container_ready',{container_id:id}),
        beforePublish:()=>advance('container_ready','publish_started',{publish_started_at:new Date(now())}),
        published:id=>advance('publish_started','provider_id_recorded',{post_id:id,observed_at:new Date(now())})};
}

export async function reserveThreadsRead(tx:Tx,scope:{projectId:number;taskId:number;attemptId:number},now:number){
    const {row,snapshot}=await loadThreadsApiState(tx,scope.projectId,scope.taskId,scope.attemptId);
    if(!row.post_id||!row.publish_started_at||!row.observed_at)throw new Error('[THREADS_RECOVERY_IDENTITY_UNAVAILABLE]');
    if(row.state==='confirmed')return {row,snapshot,lease:null};
    if(row.lease_expires_at&&row.lease_expires_at.getTime()>now)throw new Error('[THREADS_RECOVERY_IN_PROGRESS]');
    const deadline=row.deadline_at?.getTime()??now+180_000;
    if(row.rounds>=3||row.requests_used+2>20||now>=deadline)throw new Error('[THREADS_RECOVERY_BUDGET_EXHAUSTED]');
    if(row.next_read_at&&row.next_read_at.getTime()>now)throw new Error('[THREADS_RECOVERY_BACKOFF]');
    const lease=digest(randomUUID()),round=row.rounds+1,leaseExpiresAt=new Date(Math.min(deadline,now+30_000));
    const changed=await tx.apiDeliveryRecovery.updateMany({where:{id:row.id,row_version:row.row_version,project_id:scope.projectId},
        data:{lease_sha256:lease,lease_expires_at:leaseExpiresAt,deadline_at:new Date(deadline),
            rounds:round,requests_used:{increment:2},next_read_at:new Date(now+(round===1?30_000:90_000)),
            row_version:{increment:1},cause_code:'THREADS_READBACK_PENDING'}});
    if(changed.count!==1)throw new Error('[THREADS_RECOVERY_CONFLICT]');
    return {row:{...row,deadline_at:new Date(deadline),lease_expires_at:leaseExpiresAt},snapshot,lease};
}

export async function assertThreadsFinalizer(tx:Tx,scope:{projectId:number;taskId:number;attemptId:number},postId:string,
    lease:string|null,now:number){
    const {row}=await loadThreadsApiState(tx,scope.projectId,scope.taskId,scope.attemptId);
    if(row.post_id!==postId||row.generation!==1||row.state==='confirmed'
        ||row.lease_sha256!==lease||(lease&&(!row.lease_expires_at||row.lease_expires_at.getTime()<=now)))
        throw new Error('[THREADS_RECOVERY_CONFLICT]');
    const other=await tx.publicationFact.findFirst({where:{project_id:scope.projectId,provider_object_id:postId,
        content_item_id:{not:scope.taskId},channel:{type:'threads'}}});
    if(other)throw new Error('[THREADS_RECOVERY_CONFLICT]');
    admitThreadsApiFinalizer(tx,scope,postId);
    return row;
}

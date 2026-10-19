import type {Prisma} from '@prisma/client';
type Tx=Prisma.TransactionClient;
const completed=new WeakMap<Tx,{projectId:number;taskId:number;attemptId:number;postId:string;transport:string}>();
/** Internal capability established only after original API attempt/lease validation. */
export function admitThreadsApiFinalizer(tx:Tx,scope:{projectId:number;taskId:number;attemptId:number},postId:string){
    completed.set(tx,{...scope,postId,transport:'threads_api'});
}
export function admitLinkedInApiFinalizer(tx:Tx,scope:{projectId:number;taskId:number;attemptId:number},postId:string){
    completed.set(tx,{...scope,postId,transport:'linkedin_api'});
}
/** Persisted holds survive admission rollback; no public fact callback can bypass them. */
export async function assertThreadsApiFactWriter(tx:Tx,args:{projectId:number;taskId:number;providerObjectId?:string|null}){
    const storage=await tx.$queryRaw<Array<{available:boolean}>>`SELECT to_regclass('planner.api_delivery_recovery') IS NOT NULL AS available`;
    if(!storage[0]?.available){
        if(process.env.THREADS_API_RECOVERY_ENABLED==='true'||process.env.LINKEDIN_API_DELIVERY_ENABLED==='true')throw new Error('[THREADS_RECOVERY_CAPABILITY_UNAVAILABLE]');
        return;
    }
    const rows=await tx.apiDeliveryRecovery.findMany({where:{project_id:args.projectId,content_item_id:args.taskId}});
    if(!rows.length)return;
    if(rows.length!==1)throw new Error('[THREADS_RECOVERY_CONFLICT]');
    const row=rows[0];
    const permit=completed.get(tx);
    if(row.contract_version!==1||!['threads_api','linkedin_api'].includes(row.transport)||!permit||permit.transport!==row.transport||permit.projectId!==args.projectId||permit.taskId!==args.taskId||permit.attemptId!==row.attempt_id
        ||permit.postId!==row.post_id||args.providerObjectId!==row.post_id||row.state!=='confirmed')
        throw new Error('[THREADS_RECOVERY_CONFLICT]');
    const attempt=await tx.deliveryAttempt.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId,
        id:row.attempt_id,status:'delivered'}});
    if(!attempt)throw new Error('[THREADS_RECOVERY_CONFLICT]');
}

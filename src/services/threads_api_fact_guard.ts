import type {Prisma} from '@prisma/client';
type Tx=Prisma.TransactionClient;
const completed=new WeakMap<Tx,{projectId:number;taskId:number;attemptId:number;postId:string}>();
/** Internal capability established only after original API attempt/lease validation. */
export function admitThreadsApiFinalizer(tx:Tx,scope:{projectId:number;taskId:number;attemptId:number},postId:string){
    completed.set(tx,{...scope,postId});
}
/** Persisted holds survive admission rollback; no public fact callback can bypass them. */
export async function assertThreadsApiFactWriter(tx:Tx,args:{projectId:number;taskId:number;providerObjectId?:string|null}){
    const storage=await tx.$queryRaw<Array<{available:boolean}>>`SELECT to_regclass('planner.api_delivery_recovery') IS NOT NULL AS available`;
    if(!storage[0]?.available){
        if(process.env.THREADS_API_RECOVERY_ENABLED==='true')throw new Error('[THREADS_RECOVERY_CAPABILITY_UNAVAILABLE]');
        return;
    }
    const row=await tx.apiDeliveryRecovery.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId}});
    if(!row)return;
    const permit=completed.get(tx);
    if(!permit||permit.projectId!==args.projectId||permit.taskId!==args.taskId||permit.attemptId!==row.attempt_id
        ||permit.postId!==row.post_id||args.providerObjectId!==row.post_id||row.state!=='confirmed')
        throw new Error('[THREADS_RECOVERY_CONFLICT]');
    const attempt=await tx.deliveryAttempt.findFirst({where:{project_id:args.projectId,content_item_id:args.taskId,
        id:row.attempt_id,status:'delivered'}});
    if(!attempt)throw new Error('[THREADS_RECOVERY_CONFLICT]');
}

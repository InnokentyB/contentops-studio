import type {Prisma,PrismaClient} from '@prisma/client';
import {assertManualPublicationTransportMutable,type ManualPublicationScope} from './owner_manual_publication_fence';
import {lockOwnedPublicationTask} from './publication_owned_guard';

/** Shares the manual confirmation's task lock; a pre-provider check alone cannot fence late callbacks. */
export async function lockManualTransportMutation(tx:Prisma.TransactionClient,scope:ManualPublicationScope):Promise<void>{
    await lockOwnedPublicationTask(tx,scope);
    await assertManualPublicationTransportMutable(tx,scope);
}

/** Local projection/audit only. Never execute a provider operation while holding this transaction. */
export function withManualTransportMutation<T>(db:Pick<PrismaClient,'$transaction'>,scope:ManualPublicationScope,
    write:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T>{
    return db.$transaction(async tx=>{
        await lockManualTransportMutation(tx,scope);
        return write(tx);
    },{isolationLevel:'Serializable',maxWait:2000,timeout:20000});
}

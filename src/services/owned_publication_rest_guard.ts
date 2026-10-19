import { Prisma, PrismaClient } from '@prisma/client';
import { assertOwnedPublicationMutable, lockOwnedPublicationTask } from './publication_owned_guard';

type Scope = { projectId: number; taskId: number };

/** REST conflicts retain the same history fence as canonical lifecycle writers. */
export async function assertOwnedRestMutable(db: Prisma.TransactionClient | PrismaClient, scope: Scope) {
    try {
        await assertOwnedPublicationMutable(db, scope);
    } catch (error: unknown) {
        if (error instanceof Error && error.message === '[OWNED_LIFECYCLE_IMMUTABLE]') {
            throw Object.assign(error, { statusCode: 409 });
        }
        throw error;
    }
}

export async function withOwnedRestMutation<T>(
    db: PrismaClient, scope: Scope, run: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
    try {
        return await db.$transaction(async tx => {
            await lockOwnedPublicationTask(tx, scope);
            await assertOwnedRestMutable(tx, scope);
            return run(tx);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error: unknown) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
            throw Object.assign(Error('[OWNED_CONCURRENT_MODIFICATION]'), { statusCode: 409 });
        }
        throw error;
    }
}

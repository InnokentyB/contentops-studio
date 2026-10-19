import prisma from '../db';
import type { Prisma } from '@prisma/client';
type AccessDb = Pick<Prisma.TransactionClient, 'projectMember' | 'serviceIdentityBinding'>;

/** A transaction reader keeps lifecycle authorization inside its SQL deadline. */
export async function requireProjectActorAccess(projectId: number, actorId: string, accessDb: AccessDb = prisma) {
    if (!actorId || typeof actorId !== 'string') {
        throw new Error('[Security] Access denied');
    }

    if (actorId.startsWith('user:')) {
        const userId = Number(actorId.slice(5));
        if (!Number.isInteger(userId) || userId <= 0) {
            throw new Error('[Security] Access denied');
        }
        const membership = await accessDb.projectMember.findUnique({
            where: { project_id_user_id: { project_id: projectId, user_id: userId } },
            select: { id: true }
        });
        if (!membership) throw new Error('[Security] Access denied');
        return;
    }

    const binding = await accessDb.serviceIdentityBinding.findUnique({
        where: { project_id_actor_id: { project_id: projectId, actor_id: actorId } },
        select: { is_active: true }
    });
    if (!binding?.is_active) throw new Error('[Security] Access denied');
}

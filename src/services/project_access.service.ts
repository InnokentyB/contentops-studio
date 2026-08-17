import prisma from '../db';

export async function requireProjectActorAccess(projectId: number, actorId: string) {
    if (!actorId || typeof actorId !== 'string') {
        throw new Error('[Security] Access denied');
    }

    if (actorId.startsWith('user:')) {
        const userId = Number(actorId.slice(5));
        if (!Number.isInteger(userId) || userId <= 0) {
            throw new Error('[Security] Access denied');
        }
        const membership = await prisma.projectMember.findUnique({
            where: { project_id_user_id: { project_id: projectId, user_id: userId } },
            select: { id: true }
        });
        if (!membership) throw new Error('[Security] Access denied');
        return;
    }

    const binding = await prisma.serviceIdentityBinding.findUnique({
        where: { project_id_actor_id: { project_id: projectId, actor_id: actorId } },
        select: { is_active: true }
    });
    if (!binding?.is_active) throw new Error('[Security] Access denied');
}

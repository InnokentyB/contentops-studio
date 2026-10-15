import type { Prisma } from '@prisma/client';

/** The pilot's active canonical job owns its result; a generic form cannot race it. */
export async function guardManualPublicationFact(tx: Prisma.TransactionClient,
    args: { projectId: number; taskId: number; internalConfirmation: boolean }): Promise<void> {
    if (!args.internalConfirmation && args.projectId === 7 && args.taskId === 1086) throw new Error('LINKEDIN1086_EXACT_CONFIRMATION_REQUIRED');
    if (!args.internalConfirmation && args.projectId === 7 && args.taskId === 1128) throw new Error('LINKEDIN1128_EXACT_CONFIRMATION_REQUIRED');
    if (args.internalConfirmation || args.projectId !== 10 || args.taskId !== 1048) return;
    await tx.$queryRaw`SELECT id FROM content_items WHERE id = ${args.taskId} AND project_id = ${args.projectId} FOR UPDATE`;
    const active = await tx.connectorDispatchJob.findFirst({ where: {
        project_id: args.projectId, content_item_id: args.taskId,
        OR: [{ state: { notIn: ['confirmed', 'cancelled'] } }, { state: 'cancelled', attempt_id: { not: null } }]
    }, select: { id: true } });
    if (active) throw new Error('ADAPTER_RECONCILIATION_REQUIRED');
}

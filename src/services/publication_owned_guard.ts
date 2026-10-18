import type { Prisma } from '@prisma/client';
type MutationDb = Pick<Prisma.TransactionClient, 'workflowEvent' | 'connectorDispatchJob' | 'contentItem' | 'deliveryAttempt'>;
type Scope = { projectId: number; taskId: number };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
export function hasLegacyPublicationUncertainty(item: { published_link?: unknown; quality_report?: unknown }): boolean {
    const quality = object(item.quality_report);
    return Boolean(item.published_link || quality.provider_result_uncertain || quality.dzen_publish_claim || quality.dzen_publication_pending
        || ['provider_call_started', 'provider_result_uncertain', 'provider_confirmed_fact_pending']
            .includes(String(object(quality.publication_task_delivery).state))
        || object(quality.retirement).provider_result_uncertain);
}
/** Stored history, not a mutable quality marker, owns the canonical publication. */
export async function hasOwnedPublicationHistory(db: MutationDb, scope: Scope): Promise<boolean> {
    const where = { project_id: scope.projectId, content_item_id: scope.taskId };
    if (await db.workflowEvent.findFirst({ where: { ...where, command: { startsWith: 'owned_publication.' } }, select: { id: true } })) return true;
    if (await db.connectorDispatchJob.findFirst({ where: { ...where, binding: { path: ['protocol'], equals: 'owned_provider_v1' } }, select: { id: true } })) return true;
    const task = await db.contentItem.findFirst({ where: { project_id: scope.projectId, id: scope.taskId },
        select: { publication_mode: true, published_link: true, quality_report: true, channel: { select: { type: true } } } });
    if (!task?.channel || !['dzen', 'zen', 'zen_article'].includes(task.channel.type)) return false;
    return hasLegacyPublicationUncertainty(task) || task.publication_mode === 'owner_released'
        || Boolean(await db.deliveryAttempt.findFirst({ where, select: { id: true } }));
}
export async function assertOwnedPublicationMutable(db: MutationDb, scope: Scope): Promise<void> {
    if (await hasOwnedPublicationHistory(db, scope)) throw new Error('[OWNED_LIFECYCLE_IMMUTABLE]');
}
/** Atomic mutator predicate also fences a release racing the preliminary read. */
export function ownedPublicationMutableWhere(): Prisma.ContentItemWhereInput {
    return {
        workflow_events: { none: { OR: [
            { command: { startsWith: 'owned_publication.' } },
            { command: { startsWith: 'ba_publish_dzen_task' } },
            { command: { startsWith: 'ba_release_dzen_task' } }
        ] } },
        connector_dispatch_jobs: { none: { binding: { path: ['protocol'], equals: 'owned_provider_v1' } } },
        NOT: { AND: [{ channel: { type: { in: ['dzen', 'zen', 'zen_article'] } } }, { publication_mode: 'owner_released' }] }
    };
}

/** Serialize a protected mutation with release/claim on the same tenant-owned row. */
export async function lockOwnedPublicationTask(tx: Prisma.TransactionClient, scope: Scope): Promise<void> {
    await tx.$queryRaw`SELECT id FROM planner.content_items WHERE id=${scope.taskId} AND project_id=${scope.projectId} FOR UPDATE`;
}

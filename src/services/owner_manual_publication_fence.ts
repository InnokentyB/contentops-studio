import type { Prisma } from '@prisma/client';

export const OWNER_MANUAL_EVIDENCE_PREFIX = 'owner-manual:v1:';
export const OWNER_MANUAL_CONFIRMATION_COMMAND = 'owner_manual_publication.confirmed';
export type ManualPublicationScope = { projectId: number; taskId: number };
type FactReader = Pick<Prisma.TransactionClient, 'publicationFact'>;

/** A reserved canonical origin marker fails closed even if its audit needs repair. */
export function isOwnerManualFact(fact: unknown): boolean {
    if (!fact || typeof fact !== 'object' || Array.isArray(fact)) return false;
    const value = fact as Record<string, unknown>;
    return value.confirmation_mode === 'manual' && typeof value.evidence_ref === 'string'
        && value.evidence_ref.startsWith(OWNER_MANUAL_EVIDENCE_PREFIX);
}

/** Call inside the same locked transaction as a transport mutation, never as a permission shortcut. */
export async function assertManualPublicationTransportMutable(db: FactReader, scope: ManualPublicationScope): Promise<void> {
    const fact = await db.publicationFact.findFirst({
        where: { project_id: scope.projectId, content_item_id: scope.taskId },
        select: { confirmation_mode: true, evidence_ref: true }
    });
    if (isOwnerManualFact(fact)) {
        throw new Error('[MANUAL_PUBLICATION_TRANSPORT_PRESERVED] The Owner recorded an existing external object. '
            + 'Read the canonical manual fact; do not alter, retry, adopt or confirm the previous transport. Its uncertainty remains unchanged.');
    }
}

import type { Prisma } from '@prisma/client';
import { isOwnerManualFact, OWNER_MANUAL_CONFIRMATION_COMMAND } from './owner_manual_publication_fence';
import { ownerManualFactSha } from './owner_manual_publication_provenance';

type ReadableFact = { id: number; project_id: number; content_item_id: number; confirmation_mode: string; evidence_ref: string | null };
function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Only a bounded allowlist of the manual audit is exposed; no custody payloads or credentials. */
export async function ownerManualFactReadback(db: Pick<Prisma.TransactionClient, 'workflowEvent' | '$queryRaw'>, fact: ReadableFact) {
    if (!isOwnerManualFact(fact)) return {};
    const event = await db.workflowEvent.findFirst({
        where: { project_id: fact.project_id, content_item_id: fact.content_item_id,
            command: OWNER_MANUAL_CONFIRMATION_COMMAND,
            after_state: { path: ['publication_fact_id'], equals: fact.id } },
        orderBy: { id: 'desc' }, select: { id: true, after_state: true }
    });
    const state = record(event?.after_state), proof = record(state.provenance);
    const currentFactSha = await ownerManualFactSha(db, fact.project_id, fact.content_item_id);
    if (state.version !== 1 || proof.origin !== 'owner_attested_v1' || !currentFactSha || state.publication_fact_sha256 !== currentFactSha) {
        return { publication_origin: 'owner_attested_v1', provenance_state: 'repair_required',
            retry_allowed: false, transport_history_preserved: true, published_revision: null };
    }
    return { publication_origin: 'owner_attested_v1', transport_history_preserved: true,
        manual_confirmation: { audit_event_id: event?.id, origin: 'owner_attested_v1',
            time_basis: proof.time_basis, published_at_original: proof.published_at_original,
            published_at_precision: proof.published_at_precision, published_at_canonical: proof.published_at_canonical,
            revision_binding: proof.revision_binding, published_revision: proof.published_revision,
            owner_confirmation_reference: proof.owner_confirmation_reference, owner_actor_id: proof.owner_actor_id } };
}

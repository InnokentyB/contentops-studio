import { DZEN1045_PHASE_A_V2_RECONCILE } from './dzen_task1045_phase_a_v2_reconcile_contract';
import type { Dzen1045SecondAttemptPublication } from './dzen_task1045_second_attempt_contract';

export const DZEN1045_PHASE_B = {
    command: 'ba_publish_dzen_task1045_phase_b_existing_draft',
    idempotencyKey: 'dzen-p10-1045-r4-asset129-phase-b-existing-6acbdd8a-20261011-01',
    sourceKey: DZEN1045_PHASE_A_V2_RECONCILE.sourceKey,
    sourceFailedAt: DZEN1045_PHASE_A_V2_RECONCILE.failedAt,
    providerId: DZEN1045_PHASE_A_V2_RECONCILE.providerId,
    finalSelector: '[data-testid="article-publish-btn"]'
} as const;

export type Dzen1045PhaseBPreflight = { providerId: typeof DZEN1045_PHASE_B.providerId;
    exactPackage: true; detailStatus: 'draft'; enabledFinalControls: 1;
    finalSelector: typeof DZEN1045_PHASE_B.finalSelector; providerWrites: 0 };

function assertPreflight(value: Dzen1045PhaseBPreflight): void {
    if (value.providerId !== DZEN1045_PHASE_B.providerId || value.exactPackage !== true
        || value.detailStatus !== 'draft' || value.enabledFinalControls !== 1
        || value.finalSelector !== DZEN1045_PHASE_B.finalSelector || value.providerWrites !== 0) {
        throw new Error('[DZEN1045_PHASE_B_PREFLIGHT_INVALID]');
    }
}

export async function runDzen1045PhaseB<T>(args: { confirm: boolean; idempotencyKey: string }, ports: {
    inspect(): Promise<Dzen1045PhaseBPreflight>;
    claim(preflight: Dzen1045PhaseBPreflight): Promise<boolean>;
    submitOnce(): Promise<Dzen1045SecondAttemptPublication>;
    record(publication: Dzen1045SecondAttemptPublication): Promise<T>;
}) {
    if (args.idempotencyKey !== DZEN1045_PHASE_B.idempotencyKey) throw new Error('[DZEN1045_PHASE_B_KEY_REQUIRED]');
    const preflight = await ports.inspect(); assertPreflight(preflight);
    if (!args.confirm) return { mode: 'preview' as const, preflight };
    if (!await ports.claim(preflight)) throw new Error('[DZEN1045_PHASE_B_ALREADY_CLAIMED]');
    const publication = await ports.submitOnce();
    if (publication.provider_object_id !== DZEN1045_PHASE_B.providerId
        || !publication.public_url || !publication.published_at
        || !publication.public_body_matches || !publication.public_asset_matches) {
        throw new Error('[DZEN1045_PHASE_B_PUBLICATION_PROOF_INVALID]');
    }
    return { mode: 'published' as const, publication, result: await ports.record(publication) };
}

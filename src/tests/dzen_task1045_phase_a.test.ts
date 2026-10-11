import test from 'node:test';
import assert from 'node:assert/strict';
import { DZEN1045_PHASE_A, runDzen1045PhaseA, type Dzen1045DurableDraftProof } from '../services/dzen_task1045_phase_a_contract';
import { createDzen1045DurableDraftPhaseA } from '../services/puppeteer/dzen1045_phase_a';
import type { Page } from 'puppeteer';

const zero = { kind: 'no_exact_match' as const, diagnostics: { publishedTitleCandidates: 0,
    exactPublishedMatches: 0, publishedBodyMismatches: 0, publishedCoverMismatches: 0,
    publishedIdentityGaps: 0, draftCandidates: 0, exactDraftMatches: 0,
    draftTitleMismatches: 0, draftBodyMismatches: 0, draftCoverMismatches: 0 },
evidence: { published_coverage_complete: true, draft_coverage_complete: true } };
const proof: Dzen1045DurableDraftProof = { draftId: 'a'.repeat(24), coverId: 'cover',
    title: '46 тестов зелёные. Почему я всё равно не называю AI-продукт запущенным',
    bodySha256: '37b70ca472211b64104168115d435d4c2d4ef6c9fb3c61c9041ec0f9336242f1',
    coverSha256: '6b02adaf5ce140d986d85de5cf910a33bed36f65384e166031712fd66a06d76b',
    publishedCoverageComplete: true, draftCoverageComplete: true, exactPublishedMatches: 0,
    exactDraftMatches: 1, persistenceTrigger: 'editor_blur_then_studio_navigation',
    providerTrace: [{ method: 'PUT', path: '/editor-api/draft', status: 200 }],
    provenAt: '2026-10-11T18:30:00.000Z' };

test('phase A preview is zero-guarded and read-only', async () => {
    let claims = 0; let creates = 0;
    const result = await runDzen1045PhaseA({ confirm: false, idempotencyKey: DZEN1045_PHASE_A.idempotencyKey }, {
        inspect: async () => zero, claim: async () => { claims += 1; return true; },
        createAndPersist: async () => { creates += 1; return proof; }
    });
    assert.equal(result.mode, 'preview'); assert.equal(claims, 0); assert.equal(creates, 0);
});

test('phase A claims before exactly one create/persist and exposes no submit port', async () => {
    const order: string[] = [];
    const result = await runDzen1045PhaseA({ confirm: true, idempotencyKey: DZEN1045_PHASE_A.idempotencyKey }, {
        inspect: async () => { order.push('inspect'); return zero; },
        claim: async () => { order.push('claim'); return true; },
        createAndPersist: async () => { order.push('create'); return proof; }
    });
    assert.equal(result.mode, 'draft_proven'); assert.deepEqual(order, ['inspect', 'claim', 'create']);
});

test('phase A stale claim, nonzero inventory and invalid durable proof perform no retry or submit', async () => {
    let creates = 0;
    await assert.rejects(runDzen1045PhaseA({ confirm: true, idempotencyKey: DZEN1045_PHASE_A.idempotencyKey }, {
        inspect: async () => zero, claim: async () => false,
        createAndPersist: async () => { creates += 1; return proof; }
    }), /ALREADY_CLAIMED/);
    assert.equal(creates, 0);
    await assert.rejects(runDzen1045PhaseA({ confirm: true, idempotencyKey: DZEN1045_PHASE_A.idempotencyKey }, {
        inspect: async () => ({ ...zero, diagnostics: { ...zero.diagnostics, exactDraftMatches: 1 } }),
        claim: async () => true, createAndPersist: async () => proof
    }), /INVENTORY_NOT_ZERO/);
    await assert.rejects(runDzen1045PhaseA({ confirm: true, idempotencyKey: DZEN1045_PHASE_A.idempotencyKey }, {
        inspect: async () => zero, claim: async () => true,
        createAndPersist: async () => ({ ...proof, exactDraftMatches: 0 }) as unknown as Dzen1045DurableDraftProof
    }), /DRAFT_PROOF_INVALID/);
});

test('provider boundary proves assigned draft identity after persistence navigation and has no submit control', async () => {
    const order: string[] = []; let responseListener: ((value: unknown) => void) | null = null;
    const page = { on: (_name: string, listener: (value: unknown) => void) => { responseListener = listener; },
        off: () => { responseListener = null; },
        url: () => `https://dzen.ru/profile/editor/id/publisher/${'c'.repeat(24)}/edit`,
        evaluate: async () => { order.push('blur'); }, $$: async () => [] } as unknown as Page;
    const result = await createDzen1045DurableDraftPhaseA(page, 'accepted', 'https://example.test/cover.png', {
        openComposer: async () => { order.push('open'); },
        fillEditor: async () => { order.push('fill'); }, uploadImage: async () => { order.push('upload'); },
        wait: async () => undefined,
        inspect: async () => ({ kind: 'sole_exact_draft', draft: { draftId: 'c'.repeat(24), coverId: 'cover',
            title: proof.title, bodySha256: proof.bodySha256, coverSha256: proof.coverSha256 },
        evidence: { provider_writes: 0, publish_controls_clicked: 0 } })
    });
    assert.equal(result.draftId, 'c'.repeat(24));
    assert.equal(result.persistenceTrigger, 'editor_blur_then_studio_navigation');
    assert.deepEqual(order, ['open', 'fill', 'upload', 'blur']);
    assert.equal(responseListener, null);
});

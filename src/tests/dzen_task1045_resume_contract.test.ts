import test from 'node:test';
import assert from 'node:assert/strict';
import { DZEN1045, Dzen1045DraftProof, runDzen1045DraftResume } from '../services/dzen_task1045_resume_contract';
import { dzen1045Pagination } from '../services/puppeteer/dzen1045_existing_draft';

const proof: Dzen1045DraftProof = { draftId: '6ac547ad5113b334aeff83d2', coverId: 'cover1',
    title: DZEN1045.title, bodySha256: DZEN1045.bodySha, coverSha256: DZEN1045.assetSha,
    publishedMatches: 0, publishedCoverageComplete: true, draftMatches: 1,
    draftCoverageComplete: true, finalControlReady: true };

test('Dzen1045 preview proves exact draft and exhaustive public absence without claiming or submitting', async () => {
    let claims = 0; let submits = 0;
    const result = await runDzen1045DraftResume({ confirm: false, idempotencyKey: DZEN1045.resumeKey }, {
        inspect: async () => proof, claim: async () => { claims += 1; return true; },
        submit: async () => { submits += 1; return {}; }
    });
    assert.equal(result.mode, 'preview');
    assert.equal(claims, 0); assert.equal(submits, 0);
});

test('Dzen1045 confirm claims before one final submit and never rebuilds content', async () => {
    const order: string[] = [];
    const result = await runDzen1045DraftResume({ confirm: true, idempotencyKey: DZEN1045.resumeKey }, {
        inspect: async () => { order.push('inspect'); return proof; },
        claim: async () => { order.push('claim'); return true; },
        submit: async received => { order.push('submit'); assert.equal(received.draftId, proof.draftId);
            return { public_url: 'https://dzen.ru/a/exact', provider_object_id: proof.draftId }; }
    });
    assert.equal(result.mode, 'submitted');
    assert.deepEqual(order, ['inspect', 'claim', 'submit']);
});

test('Dzen1045 treats a provider page shorter than its requested pageSize as exhaustive', () => {
    assert.deepEqual(dzen1045Pagination({}, 12, 20, 12), {
        complete: true, hasMore: undefined, total: undefined
    });
    assert.deepEqual(dzen1045Pagination({}, 20, 20, 20), {
        complete: false, hasMore: undefined, total: undefined
    });
});

test('Dzen1045 explicit provider pagination overrides the short-page fallback', () => {
    assert.equal(dzen1045Pagination({ hasMore: true }, 12, 20, 12).complete, false);
    assert.equal(dzen1045Pagination({ hasMore: false }, 20, 20, 20).complete, true);
});

for (const drift of ['body', 'asset', 'public', 'draft_coverage', 'draft_count', 'control'] as const) {
    test(`Dzen1045 resume freezes on ${drift} drift`, async () => {
        const changed = { ...proof };
        if (drift === 'body') changed.bodySha256 = '0'.repeat(64);
        if (drift === 'asset') changed.coverSha256 = '0'.repeat(64);
        if (drift === 'public') changed.publishedMatches = 1;
        if (drift === 'draft_coverage') changed.draftCoverageComplete = false;
        if (drift === 'draft_count') changed.draftMatches = 2;
        if (drift === 'control') changed.finalControlReady = false;
        let submitted = false;
        await assert.rejects(runDzen1045DraftResume({ confirm: true, idempotencyKey: DZEN1045.resumeKey }, {
            inspect: async () => changed, claim: async () => true,
            submit: async () => { submitted = true; return {}; }
        }), /DZEN1045_DRAFT_PROOF_FAILED/);
        assert.equal(submitted, false);
    });
}

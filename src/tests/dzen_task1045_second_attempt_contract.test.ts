import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DZEN1045_SECOND_ATTEMPT,
    runDzen1045SecondAttemptRecovery,
    type Dzen1045SecondAttemptInspection
} from '../services/dzen_task1045_second_attempt_contract';

const draftInspection: Dzen1045SecondAttemptInspection = {
    kind: 'exact_draft',
    proof: {
        draftId: '6ac547ad5113b334aeff83d2', coverId: 'cover-129',
        title: '46 тестов зелёные. Почему я всё равно не называю AI-продукт запущенным',
        bodySha256: '37b70ca472211b64104168115d435d4c2d4ef6c9fb3c61c9041ec0f9336242f1',
        coverSha256: '6b02adaf5ce140d986d85de5cf910a33bed36f65384e166031712fd66a06d76b',
        publishedMatches: 0, publishedCoverageComplete: true,
        draftMatches: 1, draftCoverageComplete: true, finalControlReady: true
    }
};

test('second-attempt preview exhaustively identifies one exact draft without claim or click', async () => {
    let claims = 0; let submits = 0;
    const result = await runDzen1045SecondAttemptRecovery({ confirm: false,
        idempotencyKey: DZEN1045_SECOND_ATTEMPT.resumeKey }, {
        inspect: async () => draftInspection,
        claim: async () => { claims += 1; return true; },
        submit: async () => { submits += 1; return { public_url: 'https://dzen.ru/a/unused',
            provider_object_id: 'unused', published_at: '2026-10-11T00:00:00.000Z',
            public_body_matches: true, public_asset_matches: true,
            checked_at: '2026-10-11T00:00:01.000Z' }; }
    });
    assert.equal(result.mode, 'preview');
    assert.equal(claims, 0);
    assert.equal(submits, 0);
});

test('second-attempt live claims before exactly one final click and never rebuilds', async () => {
    const order: string[] = [];
    const result = await runDzen1045SecondAttemptRecovery({ confirm: true,
        idempotencyKey: DZEN1045_SECOND_ATTEMPT.resumeKey }, {
        inspect: async () => { order.push('inspect'); return draftInspection; },
        claim: async proof => { order.push(`claim:${proof.draftId}`); return true; },
        submit: async proof => { order.push(`submit:${proof.draftId}`); return {
            public_url: 'https://dzen.ru/a/exact-second-attempt', provider_object_id: proof.draftId,
            published_at: '2026-10-11T00:01:00.000Z', public_body_matches: true,
            public_asset_matches: true, checked_at: '2026-10-11T00:01:01.000Z' }; }
    });
    assert.equal(result.mode, 'submitted');
    assert.deepEqual(order, [
        'inspect', 'claim:6ac547ad5113b334aeff83d2', 'submit:6ac547ad5113b334aeff83d2'
    ]);
});

test('an exact published object reconciles without claim or final click', async () => {
    let claims = 0; let submits = 0;
    const result = await runDzen1045SecondAttemptRecovery({ confirm: true,
        idempotencyKey: DZEN1045_SECOND_ATTEMPT.resumeKey }, {
        inspect: async () => ({ kind: 'exact_published', publication: {
            public_url: 'https://dzen.ru/a/already-public', provider_object_id: 'published-id',
            published_at: '2026-10-10T22:39:00.000Z', public_body_matches: true,
            public_asset_matches: true, checked_at: '2026-10-11T00:00:00.000Z'
        } }),
        claim: async () => { claims += 1; return true; },
        submit: async () => { submits += 1; throw new Error('must not submit'); }
    });
    assert.equal(result.mode, 'reconciled');
    assert.equal(claims, 0);
    assert.equal(submits, 0);
});

test('zero, multiple, mismatched, stale key and failed CAS stop before final click', async () => {
    const invalid: Dzen1045SecondAttemptInspection[] = [
        { kind: 'no_exact_match', diagnostics: { publishedMatches: 0, draftObjects: 0,
            exactDraftMatches: 0, bodyMismatches: 0, coverMismatches: 0, titleMismatches: 0 } },
        { kind: 'no_exact_match', diagnostics: { publishedMatches: 0, draftObjects: 2,
            exactDraftMatches: 2, bodyMismatches: 0, coverMismatches: 0, titleMismatches: 0 } }
    ];
    for (const inspection of invalid) {
        let submitted = false;
        await assert.rejects(runDzen1045SecondAttemptRecovery({ confirm: true,
            idempotencyKey: DZEN1045_SECOND_ATTEMPT.resumeKey }, {
            inspect: async () => inspection, claim: async () => true,
            submit: async () => { submitted = true; throw new Error('unexpected'); }
        }), /DZEN1045_SECOND_ATTEMPT_NOT_EXACT/);
        assert.equal(submitted, false);
    }
    await assert.rejects(runDzen1045SecondAttemptRecovery({ confirm: true,
        idempotencyKey: 'wrong' }, { inspect: async () => draftInspection,
        claim: async () => true, submit: async () => { throw new Error('unexpected'); } }),
    /DZEN1045_SECOND_ATTEMPT_RESUME_KEY_REQUIRED/);
    let submitted = false;
    await assert.rejects(runDzen1045SecondAttemptRecovery({ confirm: true,
        idempotencyKey: DZEN1045_SECOND_ATTEMPT.resumeKey }, {
        inspect: async () => draftInspection, claim: async () => false,
        submit: async () => { submitted = true; throw new Error('unexpected'); }
    }), /DZEN1045_SECOND_ATTEMPT_ALREADY_CLAIMED/);
    assert.equal(submitted, false);
});

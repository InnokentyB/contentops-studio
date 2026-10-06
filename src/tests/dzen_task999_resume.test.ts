import assert from 'node:assert/strict';
import test from 'node:test';
import { assertDzen999Proof, DZEN999, normalizeDzen999Body, type Dzen999Proof } from '../services/dzen_task999_resume_contract';
import * as contract from '../services/dzen_task999_resume_contract';
import { resumeDzenTask999 } from '../services/dzen_task999_resume.service';
import { isToolAllowedForProfile } from '../mcp/capabilities';

const proof: Dzen999Proof = { draftId: DZEN999.draftId, title: DZEN999.title,
    bodyMatches: true, coverId: DZEN999.providerImageId, coverSha: DZEN999.assetSha,
    coverWidth: 1200, coverHeight: 630, draftListed: true, publishedMatches: 0,
    publicationListComplete: true, finalControlReady: true };

test('exact draft resume orchestration is available without the full composer', () => {
    assert.equal(typeof Reflect.get(contract, 'runDzen999Resume'), 'function');
});

test('existing Dzen999 resume requires exact cover, body, unpublished draft and final stage', () => {
    assert.doesNotThrow(() => assertDzen999Proof(proof));
    const changes: Partial<Dzen999Proof>[] = [{ draftId: 'different' }, { bodyMatches: false },
        { coverSha: 'different' }, { coverId: 'different' }, { title: 'different' },
        { draftListed: false }, { publishedMatches: 1 }, { publicationListComplete: false },
        { finalControlReady: false }, { coverWidth: 1080 }];
    for (const change of changes) assert.throws(() => assertDzen999Proof({ ...proof, ...change }), /PROOF_FAILED/);
});

test('body normalization permits presentation markers but never changes substantive text', () => {
    assert.equal(normalizeDzen999Body('## Heading\n\n- text'), normalizeDzen999Body('Heading\ntext'));
    assert.notEqual(normalizeDzen999Body('## Heading\n- 293'), normalizeDzen999Body('Heading\n294'));
});

test('preview never claims or submits; live cannot submit after failed CAS or invalid proof/key', async () => {
    let claims = 0;
    let submits = 0;
    const ports = { inspect: async () => proof, claim: async () => { claims++; return false; },
        submit: async () => { submits++; return 'published'; } };
    assert.equal((await contract.runDzen999Resume({ confirm: false, idempotencyKey: DZEN999.key }, ports)).mode, 'preview');
    assert.equal(claims, 0);
    await assert.rejects(contract.runDzen999Resume({ confirm: true, idempotencyKey: DZEN999.key }, ports), /ALREADY_CLAIMED/);
    await assert.rejects(contract.runDzen999Resume({ confirm: true, idempotencyKey: 'new-key' }, ports), /ORIGINAL_KEY/);
    await assert.rejects(contract.runDzen999Resume({ confirm: true, idempotencyKey: DZEN999.key }, {
        ...ports, inspect: async () => ({ ...proof, publishedMatches: 1 })
    }), /PROOF_FAILED/);
    assert.equal(claims, 1);
    assert.equal(submits, 0);
});

test('one claimed resume performs only one final submission and uncertain outcome is propagated', async () => {
    let submits = 0;
    let available = true;
    const ports = { inspect: async () => proof,
        claim: async () => { const claimed = available; available = false; return claimed; },
        submit: async () => { submits++; throw new Error('uncertain'); } };
    await assert.rejects(contract.runDzen999Resume({ confirm: true, idempotencyKey: DZEN999.key }, ports), /uncertain/);
    await assert.rejects(contract.runDzen999Resume({ confirm: true, idempotencyKey: DZEN999.key }, ports), /ALREADY_CLAIMED/);
    assert.equal(submits, 1);
});

test('scoped existing-draft endpoint cannot be widened or given an alternative send key', async () => {
    assert.equal(isToolAllowedForProfile('publisher', 'ba_resume_dzen_task999_existing_draft'), true);
    assert.equal(isToolAllowedForProfile('planner', 'ba_resume_dzen_task999_existing_draft'), false);
    for (const change of [{ projectId: 11 }, { taskId: 1031 }, { idempotencyKey: 'different' }]) {
        await assert.rejects(resumeDzenTask999({ projectId: 10, taskId: 999, actorId: 'user:2',
            idempotencyKey: DZEN999.key, ...change }), /ORIGINAL_PACKAGE/);
    }
});

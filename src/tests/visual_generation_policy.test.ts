import assert from 'node:assert/strict';
import test from 'node:test';
import { assertVisualGenerationGate, hardenEditorialVisualPrompt } from '../services/visual_generation_policy';

const ready = {
    weekPackageId: 12,
    weekApprovalStatus: 'approved',
    textState: 'accepted',
    acceptedRevision: 3,
    contentRevision: 3,
    decisionType: 'GENERATE',
    decisionSourceRevision: 3,
    channelId: 121,
    channelName: 'analystcraft_blog',
    channelType: 'site',
    placement: 'article_cover',
    decisionChannel: 'site',
    decisionPlacement: 'article_cover',
    prompt: 'A single acceptance threshold beside a finished object that falls short.',
    altText: 'A finished object stopping just before a fixed acceptance threshold.'
};

test('visual generation is blocked until the weekly topic plan is approved', () => {
    assert.throws(() => assertVisualGenerationGate({ ...ready, weekApprovalStatus: 'needs_review' }), /WEEK_PLAN_NOT_APPROVED/);
});

test('old site/blog decision cannot generate an asset after article-cover repair', () => {
    assert.throws(() => assertVisualGenerationGate({ ...ready, decisionPlacement: 'blog' }), /VISUAL_DECISION_BINDING_MISMATCH/);
    assert.throws(() => assertVisualGenerationGate({ ...ready, decisionChannel: 'growth_ops' }), /VISUAL_DECISION_BINDING_MISMATCH/);
});

test('visual decision accepts the bound channel name, ID or legacy type but not another account', () => {
    assert.doesNotThrow(() => assertVisualGenerationGate({ ...ready, decisionChannel: 'analystcraft_blog' }));
    assert.doesNotThrow(() => assertVisualGenerationGate({ ...ready, decisionChannel: '121' }));
    assert.doesNotThrow(() => assertVisualGenerationGate({ ...ready, decisionChannel: 'site' }));
    assert.throws(() => assertVisualGenerationGate({ ...ready, decisionChannel: 'other_blog' }), /VISUAL_DECISION_BINDING_MISMATCH/);
    assert.throws(() => assertVisualGenerationGate({ ...ready, decisionChannel: '122' }), /VISUAL_DECISION_BINDING_MISMATCH/);
});

test('visual generation is blocked until the current text revision is accepted', () => {
    assert.throws(() => assertVisualGenerationGate({ ...ready, textState: 'draft', acceptedRevision: null }), /TEXT_NOT_ACCEPTED/);
});

test('visual generation requires an approved GENERATE brief and alt text', () => {
    assert.throws(() => assertVisualGenerationGate({ ...ready, decisionType: 'NO_VISUAL_NEEDED' }), /VISUAL_BRIEF_NOT_APPROVED/);
    assert.throws(() => assertVisualGenerationGate({ ...ready, altText: null }), /ALT_TEXT_REQUIRED/);
    assert.doesNotThrow(() => assertVisualGenerationGate(ready));
});

test('production prompt bans text, pseudo interfaces, office scenes and comic retelling', () => {
    const prompt = hardenEditorialVisualPrompt(ready.prompt);
    assert.match(prompt, /No visible text/);
    assert.match(prompt, /No user-interface panels/);
    assert.match(prompt, /No people, office teams/);
    assert.match(prompt, /must not retell the post/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { assertContentReviewInput } from '../services/content_review_gate';
import { isToolAllowedForProfile } from '../mcp/capabilities';
import { scopeRemoteMcpRequest } from '../mcp/remote-auth';

const input = {
    kind: 'content_review', assigneeRole: 'content_reviewer', state: 'available',
    resultVersion: 1, expectedResultVersion: 1,
    contentRevision: 3, expectedContentRevision: 3,
    phase: 'claim' as const
};

test('review claim and submit are editor-only capabilities, not writer or publisher actions', () => {
    for (const name of ['ba_claim_content_review', 'ba_submit_content_review']) {
        assert.equal(isToolAllowedForProfile('editor', name), true);
        assert.equal(isToolAllowedForProfile('writer', name), false);
        assert.equal(isToolAllowedForProfile('publisher', name), false);
        assert.equal(isToolAllowedForProfile('planner', name), false);
    }
});

test('content review gate rejects another kind, role, state or revision', () => {
    assert.doesNotThrow(() => assertContentReviewInput(input));
    assert.doesNotThrow(() => assertContentReviewInput({ ...input, state: 'claimed', phase: 'submit' }));
    assert.throws(() => assertContentReviewInput({ ...input, kind: 'content_write' }), /ROLE_MISMATCH/);
    assert.throws(() => assertContentReviewInput({ ...input, assigneeRole: 'content_writer' }), /ROLE_MISMATCH/);
    assert.throws(() => assertContentReviewInput({ ...input, state: 'claimed' }), /STATE_CONFLICT/);
    assert.throws(() => assertContentReviewInput({ ...input, state: 'available', phase: 'submit' }), /STATE_CONFLICT/);
    assert.throws(() => assertContentReviewInput({ ...input, resultVersion: 2 }), /VERSION_CONFLICT/);
    assert.throws(() => assertContentReviewInput({ ...input, contentRevision: 4 }), /VERSION_CONFLICT/);
});

test('remote reviewer claim is project-scoped and uses the authenticated actor', () => {
    const call = { method: 'tools/call', params: { name: 'ba_claim_content_review',
        arguments: { projectId: 10, actorId: 'agent:content_reviewer', workItemId: 944 } } };
    const editor = scopeRemoteMcpRequest(call, {
        userId: 7, actorId: 'user:7', projectId: 10, profile: 'editor'
    });
    assert.equal(editor.allowed, true);
    assert.equal(editor.body.params.arguments.actorId, 'user:7');
    assert.equal(scopeRemoteMcpRequest(call, {
        userId: 8, actorId: 'user:8', projectId: 10, profile: 'writer'
    }).allowed, false);
    assert.equal(scopeRemoteMcpRequest({ ...call, params: { ...call.params,
        arguments: { ...call.params.arguments, projectId: 11 }
    } }, { userId: 7, actorId: 'user:7', projectId: 10, profile: 'editor' }).allowed, false);
});

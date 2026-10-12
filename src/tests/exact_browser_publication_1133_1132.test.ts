import assert from 'node:assert/strict';
import test from 'node:test';
import {
    EXACT_BROWSER_PACKAGES,
    classifyPriorAttempt,
    validateProviderIdentity
} from '../services/exact_browser_publication_1133_1132.service';
import { isToolAllowedForProfile } from '../mcp/capabilities';

test('task-specific browser publication controls are publisher-only', () => {
    const tools = [
        'ba_release_medium_task1133_browser', 'ba_claim_medium_task1133_browser_publication',
        'ba_start_medium_task1133_browser_submission', 'ba_confirm_medium_task1133_browser_submission',
        'ba_mark_medium_task1133_browser_submission_uncertain', 'ba_diagnose_linkedin_task1132_browser',
        'ba_release_linkedin_task1132_browser', 'ba_claim_linkedin_task1132_browser_publication',
        'ba_start_linkedin_task1132_browser_submission', 'ba_confirm_linkedin_task1132_browser_submission',
        'ba_mark_linkedin_task1132_browser_submission_uncertain',
        'ba_release_x_task1107_browser', 'ba_claim_x_task1107_browser_publication',
        'ba_start_x_task1107_browser_submission', 'ba_confirm_x_task1107_browser_submission',
        'ba_mark_x_task1107_browser_submission_uncertain'
    ];
    for (const tool of tools) {
        assert.equal(isToolAllowedForProfile('owner', tool), true);
        assert.equal(isToolAllowedForProfile('publisher', tool), true);
        assert.equal(isToolAllowedForProfile('writer', tool), false);
    }
});

test('exact package constants preserve owner-approved bytes and bindings', () => {
    assert.deepEqual(EXACT_BROWSER_PACKAGES.medium, {
        projectId: 10, taskId: 1133, channelId: 172, revision: 2,
        bodySha256: '627b9253d5c6fcabc4505a4bf59cf93cb7fed6cefc310360ca3b5db65ff23430',
        assetId: 145,
        assetSha256: '87528eae6cb2a91280e55608874b7e2709f8055defc1518f2dc2619d076eee60',
        placement: 'article_cover', schedule: '2026-10-12T13:00:00.000Z',
        manifest: 'sha256:8b4a8d3741c0a89889a90c9ee4d3d9c69b36edbc704b9ebc5c1361c67492f76e',
        channelType: 'medium', artifactKind: 'article'
    });
    assert.equal(EXACT_BROWSER_PACKAGES.linkedin.bodySha256,
        '2ea7050c4f1a9c70cec7ccf2b7340bbcea4f4d305dbc18008f5fa172665f6632');
    assert.equal(EXACT_BROWSER_PACKAGES.linkedin.assetId, null);
    assert.deepEqual(EXACT_BROWSER_PACKAGES.x, {
        projectId: 10, taskId: 1107, channelId: 164, revision: 1,
        bodySha256: '2029e3fc10296091ba2331bcc2e666d5db895923111d37fb141cbec77171fdd4',
        assetId: null, assetSha256: null, placement: 'feed',
        schedule: '2026-10-12T15:00:00.000Z',
        manifest: 'sha256:4bfec7ca8399251c6c8f132a34d9e0952adbf1eef049d29325808cbd9db3975b',
        channelType: 'x', artifactKind: 'post'
    });
});

test('only absent or explicitly pre-provider failed attempts are retry-safe', () => {
    assert.deepEqual(classifyPriorAttempt(null), { classification: 'absent', retrySafe: true });
    assert.deepEqual(classifyPriorAttempt({ id: 9, status: 'failed', requires_manual_confirmation: false,
        error_message: '[BROWSER_PRE_PROVIDER_ABORT_CONFIRMED]' }),
    { classification: 'failed_pre_provider', retrySafe: true, attemptId: 9 });
    for (const attempt of [
        { id: 1, status: 'pending', requires_manual_confirmation: true, error_message: null },
        { id: 2, status: 'delivered', requires_manual_confirmation: false, error_message: null },
        { id: 3, status: 'failed', requires_manual_confirmation: true,
            error_message: '[BROWSER_READBACK_UNCONFIRMED]' }
    ]) assert.equal(classifyPriorAttempt(attempt).retrySafe, false);
});

test('provider confirmation accepts only exact canonical Medium, LinkedIn and X identities', () => {
    assert.deepEqual(validateProviderIdentity('medium',
        'https://medium.com/@i.a.bodrov85/cross-task-duplicate-964d9b8e6509',
        '964d9b8e6509', '2026-10-12T14:01:00.000Z'), {
        publicUrl: 'https://medium.com/@i.a.bodrov85/cross-task-duplicate-964d9b8e6509',
        providerObjectId: '964d9b8e6509', publishedAt: '2026-10-12T14:01:00.000Z'
    });
    assert.deepEqual(validateProviderIdentity('linkedin',
        'https://www.linkedin.com/feed/update/urn:li:activity:7383532112233445566/',
        'urn:li:activity:7383532112233445566', '2026-10-12T14:02:00Z'), {
        publicUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:7383532112233445566/',
        providerObjectId: 'urn:li:activity:7383532112233445566', publishedAt: '2026-10-12T14:02:00.000Z'
    });
    assert.throws(() => validateProviderIdentity('medium',
        'https://medium.com/@someone-else/post-964d9b8e6509', '964d9b8e6509', '2026-10-12T14:01:00Z'),
    /PROVIDER_IDENTITY_INVALID/);
    assert.throws(() => validateProviderIdentity('linkedin',
        'https://www.linkedin.com/feed/update/urn:li:activity:7383532112233445566/',
        'urn:li:activity:1', '2026-10-12T14:02:00Z'), /PROVIDER_IDENTITY_INVALID/);
    assert.deepEqual(validateProviderIdentity('x',
        'https://x.com/naraHeTc/status/1234567890123456789',
        '1234567890123456789', '2026-10-12T16:45:00Z'), {
        publicUrl: 'https://x.com/naraHeTc/status/1234567890123456789',
        providerObjectId: '1234567890123456789', publishedAt: '2026-10-12T16:45:00.000Z'
    });
    assert.throws(() => validateProviderIdentity('x',
        'https://x.com/someoneElse/status/1234567890123456789',
        '1234567890123456789', '2026-10-12T16:45:00Z'), /PROVIDER_IDENTITY_INVALID/);
});

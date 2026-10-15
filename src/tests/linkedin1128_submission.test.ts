import assert from 'node:assert/strict';
import test from 'node:test';
import { isToolAllowedForProfile } from '../mcp/capabilities';
import { linkedin1128SubmissionSchema, submissionRequestHash } from '../services/linkedin1128_submission_guard';
import { confirmLinkedIn1128 } from '../services/linkedin1128_submission.service';
import { LINKEDIN1128 as p } from '../services/linkedin1128_identity.service';
const args = { projectId: 7 as const, taskId: 1128 as const, channelId: 6 as const, workItemId: 1924 as const,
    actorId: 'user:2', leaseToken: 'synthetic-lease', approvalReference: 'synthetic existing owner approval',
    idempotencyKey: 'synthetic-existing-key', expectedManifestChecksum: p.manifest, contentRevision: 1 as const,
    textSha256: p.body, selectedAssetId: null, imageSha256: null, observedCompanyId: '97416172' as const,
    authorEvidenceSha256: 'a'.repeat(64), duplicateCheckReference: 'synthetic duplicate evidence' };
test('1128 existing claimed WI gains only publisher-scoped submission controls', () => {
    for (const operation of ['start', 'pre_submit', 'confirm', 'mark']) {
        const name = operation === 'mark' ? 'ba_mark_linkedin_task1128_browser_submission_uncertain'
            : `ba_${operation}_linkedin_task1128_browser_submission`;
        assert.equal(isToolAllowedForProfile('publisher', name), true);
        assert.equal(isToolAllowedForProfile('owner', name), true);
        assert.equal(isToolAllowedForProfile('writer', name), false);
        assert.equal(isToolAllowedForProfile('planner', name), false);
    }
});
test('1128 scope cannot adopt another work item, author, revision or body', () => {
    assert.equal(linkedin1128SubmissionSchema.safeParse(args).success, true);
    for (const patch of [{ projectId: 10 }, { workItemId: 1925 }, { taskId: 1132 }, { channelId: 5 },
        { contentRevision: 2 }, { textSha256: 'b'.repeat(64) }, { observedCompanyId: '79633032' },
        { leaseToken: '' }, { authorEvidenceSha256: '' }]) {
        assert.equal(linkedin1128SubmissionSchema.safeParse({ ...args, ...patch }).success, false);
    }
    assert.notEqual(submissionRequestHash(args), submissionRequestHash({ ...args, approvalReference: 'changed owner reference' }));
});
test('1128 rejects invalid provider identity and backdated facts before database work', async () => {
    const base = { ...args, attemptId: 123, publicUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:123/',
        providerObjectId: 'urn:li:activity:123', publishedAt: '2026-10-14T10:01:00Z', evidenceSha256: 'b'.repeat(64) };
    for (const patch of [{ publicUrl: 'https://evil.example/feed/update/urn:li:activity:123/' },
        { providerObjectId: 'urn:li:activity:456' }, { publishedAt: '2026-10-13T10:00:00Z' },
        { publicUrl: `${base.publicUrl}?secret=synthetic` }, { evidenceSha256: '' }]) {
        await assert.rejects(confirmLinkedIn1128({ ...base, ...patch }), /PROVIDER_IDENTITY_INVALID/);
    }
});

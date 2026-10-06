import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseXTask1079 } from '../services/x_task1079_release.service';

test('1079 release rejects other tasks before transaction or manifest access', async () => {
    await assert.rejects(() => releaseXTask1079({ taskId: 1025 } as never,
        { $transaction: async () => { throw new Error('database reached'); } } as never),
    /TASK1079_RELEASE_SCOPE_MISMATCH/);
});

test('1079 release rejects a non-owner before package mutations', async () => {
    const args = {
        projectId: 10, taskId: 1079, actorId: 'user:2', expectedChannelId: 164,
        expectedContentRevision: 1, expectedAcceptedRevision: 1,
        expectedBodySha256: '286f4cba8795f2a64e439dff096866bf4dfa17a864a3e50788d9d95bfd8b3217',
        expectedDecisionId: 228, expectedReviewWorkItemId: 1465, expectedArtWorkItemId: 1466,
        expectedScheduleAt: '2026-10-04T17:30:00.000Z',
        expectedManifestChecksum: 'sha256:dc5831717f09ee68f339ccb5b9e63ca00ce4b68edae810b80308fd09e11bcc71',
        approvalReference: 'Owner: publish 1079', idempotencyKey: 'release-1079-r1'
    } as const;
    let transactions = 0;
    const db = { $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
        transactions += 1;
        return callback({
            projectMember: { findUnique: async () => ({ role: 'viewer' }) }
        });
    } };
    await assert.rejects(() => releaseXTask1079(args, db as never,
        (async () => ({ checksum: args.expectedManifestChecksum })) as never), /OWNER_REQUIRED/);
    assert.equal(transactions, 1);
});

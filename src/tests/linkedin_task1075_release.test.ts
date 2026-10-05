import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseLinkedInTask1075 } from '../services/linkedin_task1075_release.service';

const exact = {
    projectId: 7 as const, taskId: 1075 as const, actorId: 'user:2', expectedChannelId: 5 as const,
    expectedContentRevision: 1 as const, expectedAcceptedRevision: 1 as const,
    expectedBodySha256: '24ce0bc8c6863662a8af115bef9a200dc3d75ca5b051b9d3ba6a04fc7109fb4f' as const,
    expectedDecisionId: 234 as const, expectedScheduleAt: '2026-10-05T09:00:00.000Z' as const,
    staleUpstreamWorkItemId: 1408 as const, expectedEditorWorkItemId: 1483 as const,
    expectedArtWorkItemId: 1484 as const, approvalReference: 'Owner GO 2026-10-05', idempotencyKey: 'release-1075-v1'
};

test('task 1075 release refuses any widened task or body scope before DB access', async () => {
    const db = { $transaction: async () => { throw new Error('DB must not be reached'); } } as any;
    await assert.rejects(() => releaseLinkedInTask1075({ ...exact, taskId: 1076 as 1075 }, db), /TASK1075_RELEASE_SCOPE_MISMATCH/);
    await assert.rejects(() => releaseLinkedInTask1075({ ...exact, expectedBodySha256: 'a'.repeat(64) as any }, db), /TASK1075_RELEASE_SCOPE_MISMATCH/);
});

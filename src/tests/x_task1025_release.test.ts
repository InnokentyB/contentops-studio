import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseXTask1025 } from '../services/x_task1025_release.service';

const exact = {
    projectId: 10 as const,
    taskId: 1025 as const,
    actorId: 'user:2',
    expectedChannelId: 164 as const,
    expectedContentRevision: 1 as const,
    expectedAcceptedRevision: 1 as const,
    expectedBodySha256: '2e0af78370143fbc4604726a70c3ebc70f63167f608da5413b5029181afe785c' as const,
    expectedDecisionId: 230 as const,
    expectedReviewWorkItemId: 1475 as const,
    expectedArtWorkItemId: 1477 as const,
    expectedScheduleAt: '2026-10-05T15:00:00.000Z' as const,
    expectedManifestChecksum: 'sha256:5500db954642b50ac4077ce9ef6ae8bd78f9382cc87d7911b0baacdaf95860d3' as const,
    approvalReference: 'Portfolio HQ owner approval: «Давай его выпусти, пожалуйста»',
    idempotencyKey: 'x-1025-browser-release-r1-20261005-v1'
};

test('task 1025 release refuses widened task, channel, or body scope before DB access', async () => {
    const db = { $transaction: async () => { throw new Error('DB must not be reached'); } } as never;
    await assert.rejects(
        () => releaseXTask1025({ ...exact, taskId: 1079 as 1025 }, db),
        /TASK1025_RELEASE_SCOPE_MISMATCH/
    );
    await assert.rejects(
        () => releaseXTask1025({ ...exact, expectedChannelId: 165 as 164 }, db),
        /TASK1025_RELEASE_SCOPE_MISMATCH/
    );
    await assert.rejects(
        () => releaseXTask1025({ ...exact, expectedBodySha256: 'a'.repeat(64) as typeof exact.expectedBodySha256 }, db),
        /TASK1025_RELEASE_SCOPE_MISMATCH/
    );
});

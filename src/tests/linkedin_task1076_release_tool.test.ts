import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedInTask1076ReleaseSchema } from '../mcp/tools/linkedin_task1076_release_tool';

const packageArgs = {
    projectId: 7, taskId: 1076, actorId: 'user:2', expectedChannelId: 6,
    expectedContentRevision: 1, expectedAcceptedRevision: 1, expectedSelectedAssetId: 116,
    expectedBodySha256: 'a'.repeat(64), expectedAssetSha256: 'b'.repeat(64),
    expectedManifestChecksum: `sha256:${'c'.repeat(64)}`,
    expectedScheduleAt: '2026-10-07T10:00:00.000Z',
    approvalReference: 'Owner explicit GO for task 1076', idempotencyKey: '1076-release-v1'
};

test('task1076 release accepts only the exact owning package boundary', () => {
    assert.equal(linkedInTask1076ReleaseSchema.safeParse(packageArgs).success, true);
    for (const [field, value] of Object.entries({ projectId: 10, taskId: 1075,
        expectedChannelId: 5, expectedContentRevision: 2, expectedAcceptedRevision: 2,
        expectedSelectedAssetId: 115, expectedBodySha256: 'invalid',
        expectedAssetSha256: 'invalid', expectedManifestChecksum: 'invalid',
        expectedScheduleAt: 'invalid', approvalReference: '', idempotencyKey: '' })) {
        assert.equal(linkedInTask1076ReleaseSchema.safeParse({ ...packageArgs, [field]: value }).success, false, field);
    }
});

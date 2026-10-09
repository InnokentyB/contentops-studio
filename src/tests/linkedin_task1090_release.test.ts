import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedInTask1090ReleaseSchema } from '../mcp/tools/linkedin_task1090_release_tool';
import { isToolAllowedForProfile } from '../mcp/capabilities';

const exactPackage = {
    actorId: 'user:2',
    approvalReference: 'Portfolio HQ owner GO for LinkedIn task 1090',
    idempotencyKey: 'owner-release-p7-1090-r2-asset123-20261009',
    expectedManifestChecksum: 'sha256:ed6923b99f46d80a029a877bd4c02c09852c61ebdb2a02a26bee99e6f18015f8',
    projectId: 7,
    taskId: 1090,
    expectedChannelId: 5,
    expectedContentRevision: 2,
    expectedAcceptedRevision: 2,
    expectedSelectedAssetId: 123,
    expectedBodySha256: '8a93e640b02f2c9de6c2119c4556fbbe9cbb67339f9ffed73721700f1a476d39',
    expectedAssetSha256: 'a1fff6e14da32a07fe5853d25ae0288f002907b1405ed90f02090a537fa38aef',
    expectedScheduleAt: '2026-10-09T09:00:00.000Z'
};

test('task 1090 release schema accepts only the exact owner-approved package', () => {
    assert.equal(linkedInTask1090ReleaseSchema.safeParse(exactPackage).success, true);
    for (const [field, value] of Object.entries({
        projectId: 10,
        taskId: 1072,
        expectedChannelId: 6,
        expectedContentRevision: 3,
        expectedAcceptedRevision: 3,
        expectedSelectedAssetId: 124,
        expectedBodySha256: 'b'.repeat(64),
        expectedAssetSha256: 'c'.repeat(64),
        expectedScheduleAt: '2026-10-10T09:00:00.000Z',
        idempotencyKey: ''
    })) {
        assert.equal(linkedInTask1090ReleaseSchema.safeParse({ ...exactPackage, [field]: value }).success, false, field);
    }
});

test('only Publisher can invoke the exact task 1090 release', () => {
    assert.equal(isToolAllowedForProfile('publisher', 'ba_release_linkedin_task1090_browser'), true);
    assert.equal(isToolAllowedForProfile('publisher', 'ba_release_approved_linkedin_browser_task'), false);
    for (const profile of ['planner', 'writer', 'editor', 'art_director', 'growth_analyst', 'strategist'] as const) {
        assert.equal(isToolAllowedForProfile(profile, 'ba_release_linkedin_task1090_browser'), false);
    }
});

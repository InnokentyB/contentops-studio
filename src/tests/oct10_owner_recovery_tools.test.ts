import test from 'node:test';
import assert from 'node:assert/strict';
import { isToolAllowedForProfile } from '../mcp/capabilities';
import {
    linkedIn1072ReleaseSchema,
    threads1043ReleaseSchema,
    x1042OverlengthRecoverySchema,
    x1042ReleaseSchema
} from '../mcp/tools/oct10_owner_recovery_tools';
import { OCT10_MANIFEST_CHECKSUM } from '../services/oct10_owner_recovery.service';

const common = { projectId: 10, actorId: 'user:2', expectedManifestChecksum: OCT10_MANIFEST_CHECKSUM,
    recoverySlotDate: '2026-10-10', approvalReference: 'owner-authorized exact recovery', idempotencyKey: 'one-key' };

test('October 10 exact release schemas reject package, identity and missed-slot drift', () => {
    const x = { ...common, taskId: 1042, expectedChannelId: 164, expectedContentRevision: 6, expectedAcceptedRevision: 6,
        expectedBodySha256: '8ee902b053a244255c4c3d728947e755069e5aca8503f3ed201476bf67f0cfc3',
        expectedSelectedAssetId: null, expectedAssetSha256: null, expectedReviewWorkItemId: 1420,
        expectedArtWorkItemId: 1800, expectedDecisionId: 300, expectedWeightedLength: 273, expectedLimit: 280,
        expectedScheduleAt: '2026-10-09T15:00:00.000Z' };
    const linkedin = { ...common, taskId: 1072, expectedCurrentChannelId: 123, sourceRegistryProjectId: 7,
        sourceRegistryChannelId: 5, targetProfileRef: 'profile_personal_innokenty_linkedin',
        targetProfileUrl: 'https://www.linkedin.com/in/innokentyb/', expectedContentRevision: 4, expectedAcceptedRevision: 4,
        expectedBodySha256: 'd5b88c95e2fbe35cf96e792c775b0e84eff4c261974487d592a8cc24ac44951c',
        expectedSelectedAssetId: 127, expectedAssetSha256: '3c2c2f95dcdd54784a034216414a8efc6b97fe79167ea3403de9e5e918db1121',
        expectedScheduleAt: '2026-10-09T15:00:00.000Z' };
    const threads = { ...common, taskId: 1043, expectedChannelId: 138, expectedThreadsUserId: '39421253764155091',
        expectedUsername: 'innokentybo', expectedContentRevision: 4, expectedAcceptedRevision: 4,
        expectedBodySha256: '00813c7d65068bdce2e0b5aa6bb1cc04ca936e42c81ca4a44b2be50a095713fc',
        expectedSelectedAssetId: 128, expectedAssetSha256: 'd53fa8809efe40b35577849cdfcd2795ead8127ba77e9e4a604fbfaf94f9d3c3',
        expectedScheduleAt: '2026-10-09T16:30:00.000Z' };
    assert.equal(x1042ReleaseSchema.safeParse(x).success, true);
    assert.equal(linkedIn1072ReleaseSchema.safeParse(linkedin).success, true);
    assert.equal(threads1043ReleaseSchema.safeParse(threads).success, true);
    assert.equal(x1042ReleaseSchema.safeParse({ ...x, expectedSelectedAssetId: 126 }).success, false);
    assert.equal(x1042ReleaseSchema.safeParse({ ...x, expectedContentRevision: 5,
        expectedBodySha256: '7d780809a7f6b73494b590cd1fa11ac2f6383fdc0a952f1aca5d09cb4e676c70' }).success, false);
    assert.equal(x1042OverlengthRecoverySchema.safeParse({ projectId: 10, taskId: 1042, actorId: 'user:2',
        expectedManifestChecksum: OCT10_MANIFEST_CHECKSUM, expectedBrowserWorkItemId: 1689,
        expectedWriterWorkItemId: 1308, expectedReviewWorkItemId: 1420, expectedArtWorkItemId: 1688,
        expectedDecisionId: 271, expectedWeightedLength: 365, expectedLimit: 280,
        approvalReference: 'X composer rejected rev5 as overlength', idempotencyKey: 'recover' }).success, true);
    assert.equal(linkedIn1072ReleaseSchema.safeParse({ ...linkedin, targetProfileUrl: 'https://linkedin.com/company/analystcraft' }).success, false);
    assert.equal(threads1043ReleaseSchema.safeParse({ ...threads, expectedThreadsUserId: 'wrong' }).success, false);
    assert.equal(threads1043ReleaseSchema.safeParse({ ...threads, expectedScheduleAt: '2026-10-10T16:30:00.000Z' }).success, false);
});

test('only owner and Publisher profiles expose the exact release and claim paths', () => {
    const tools = ['ba_prepare_x_task1042_text_only_package', 'ba_release_x_task1042_browser', 'ba_claim_x_task1042_browser_publication',
        'ba_release_linkedin_task1072_personal_browser', 'ba_claim_linkedin_task1072_browser_publication',
        'ba_release_threads_task1043_api', 'ba_publish_threads_task1043'];
    for (const tool of tools) {
        assert.equal(isToolAllowedForProfile('owner', tool), true);
        assert.equal(isToolAllowedForProfile('publisher', tool), true);
        for (const profile of ['planner', 'writer', 'editor', 'art_director', 'growth_analyst', 'strategist'] as const) {
            assert.equal(isToolAllowedForProfile(profile, tool), false, `${profile}:${tool}`);
        }
    }
});

test('overlength release recovery is owner-only', () => {
    assert.equal(isToolAllowedForProfile('owner', 'ba_recover_x_task1042_overlength_release'), true);
    for (const profile of ['planner', 'writer', 'editor', 'art_director', 'growth_analyst', 'strategist', 'publisher'] as const) {
        assert.equal(isToolAllowedForProfile(profile, 'ba_recover_x_task1042_overlength_release'), false);
    }
});

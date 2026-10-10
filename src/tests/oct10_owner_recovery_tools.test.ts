import test from 'node:test';
import assert from 'node:assert/strict';
import { isToolAllowedForProfile } from '../mcp/capabilities';
import {
    dzen1045ReleaseSchema,
    linkedIn1072ReleaseSchema,
    threads1043ReleaseSchema,
    threads1046ReleaseSchema,
    telegram1099RepairSchema,
    telegram1099ReleaseSchema,
    x1042OverlengthRecoverySchema,
    x1042ReleaseSchema
} from '../mcp/tools/oct10_owner_recovery_tools';
import { OCT10_MANIFEST_CHECKSUM } from '../services/oct10_owner_recovery.service';
import { X1042_TEXT_ONLY_MANIFEST } from '../services/x_task1042_text_only.service';

const common = { projectId: 10, actorId: 'user:2', expectedManifestChecksum: OCT10_MANIFEST_CHECKSUM,
    recoverySlotDate: '2026-10-10', approvalReference: 'owner-authorized exact recovery', idempotencyKey: 'one-key' };

test('October 10 exact release schemas reject package, identity and missed-slot drift', () => {
    const x = { ...common, expectedManifestChecksum: X1042_TEXT_ONLY_MANIFEST,
        taskId: 1042, expectedChannelId: 164, expectedContentRevision: 6, expectedAcceptedRevision: 6,
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
        expectedUsername: 'innokentybo', expectedCurrentContentRevision: 4, expectedCurrentAcceptedRevision: 4,
        expectedCurrentBodySha256: '00813c7d65068bdce2e0b5aa6bb1cc04ca936e42c81ca4a44b2be50a095713fc',
        expectedCurrentSelectedAssetId: 128, expectedCurrentAssetSha256: 'd53fa8809efe40b35577849cdfcd2795ead8127ba77e9e4a604fbfaf94f9d3c3',
        expectedHistoricalContentRevision: 3,
        expectedHistoricalBodySha256: 'c68bd80edc8c866930e06844f1f9bde96ab3c4325cf1bd8d21760f1f8fb691bd',
        expectedHistoricalApprovalId: 255, expectedHistoricalDecisionId: 217,
        expectedTargetContentRevision: 5, expectedTargetSelectedAssetId: null,
        expectedScheduleAt: '2026-10-09T16:30:00.000Z' };
    assert.equal(x1042ReleaseSchema.safeParse(x).success, true);
    assert.equal(linkedIn1072ReleaseSchema.safeParse(linkedin).success, true);
    assert.equal(threads1043ReleaseSchema.safeParse(threads).success, true);
    assert.equal(dzen1045ReleaseSchema.safeParse({ ...common, taskId: 1045, expectedChannelId: 116,
        expectedContentRevision: 4, expectedAcceptedRevision: 4,
        expectedBodySha256: '37b70ca472211b64104168115d435d4c2d4ef6c9fb3c61c9041ec0f9336242f1',
        expectedVisualState: 'APPROVED', expectedPlacement: 'article_cover', expectedVisualDecisionVersion: 1,
        expectedSelectedAssetId: 129, expectedAssetSha256: '6b02adaf5ce140d986d85de5cf910a33bed36f65384e166031712fd66a06d76b',
        expectedScheduleAt: '2026-10-10T10:00:00.000Z', expectedPublishAt: '2026-10-10T10:00:00.000Z'
    }).success, true);
    assert.equal(x1042ReleaseSchema.safeParse({ ...x, expectedSelectedAssetId: 126 }).success, false);
    assert.equal(x1042ReleaseSchema.safeParse({ ...x, expectedContentRevision: 5,
        expectedBodySha256: '7d780809a7f6b73494b590cd1fa11ac2f6383fdc0a952f1aca5d09cb4e676c70' }).success, false);
    assert.equal(x1042OverlengthRecoverySchema.safeParse({ projectId: 10, taskId: 1042, actorId: 'user:2',
        expectedManifestChecksum: X1042_TEXT_ONLY_MANIFEST, expectedBrowserWorkItemId: 1689,
        expectedWriterWorkItemId: 1308, expectedReviewWorkItemId: 1420, expectedArtWorkItemId: 1688,
        expectedDecisionId: 271, expectedWeightedLength: 365, expectedLimit: 280,
        approvalReference: 'X composer rejected rev5 as overlength', idempotencyKey: 'recover' }).success, true);
    assert.equal(linkedIn1072ReleaseSchema.safeParse({ ...linkedin, targetProfileUrl: 'https://linkedin.com/company/analystcraft' }).success, false);
    assert.equal(threads1043ReleaseSchema.safeParse({ ...threads, expectedThreadsUserId: 'wrong' }).success, false);
    assert.equal(threads1043ReleaseSchema.safeParse({ ...threads, expectedScheduleAt: '2026-10-10T16:30:00.000Z' }).success, false);
    const threads1046 = { projectId: 10, taskId: 1046, actorId: 'user:2',
        expectedManifestChecksum: OCT10_MANIFEST_CHECKSUM, expectedChannelId: 138,
        expectedThreadsUserId: '39421253764155091', expectedUsername: 'innokentybo',
        expectedContentRevision: 4, expectedAcceptedRevision: 4,
        expectedBodySha256: 'e3403bd77725ff503627cdecca3a2ce423f148af75ac25830add9652ae25adb9',
        expectedVisualState: 'APPROVED', expectedPlacement: 'feed', expectedDecisionId: 270,
        expectedDecisionVersion: 1, expectedSelectedAssetId: 132,
        expectedAssetSha256: '1b9177bbdc77a4d29f0c950f14f85f16f018c2a45544aa8f75ff6e8f00db2e03',
        expectedScheduleAt: '2026-10-10T16:30:00.000Z', approvalReference: 'owner authorized release',
        idempotencyKey: 'threads1046-release' };
    assert.equal(threads1046ReleaseSchema.safeParse(threads1046).success, true);
    assert.equal(threads1046ReleaseSchema.safeParse({ ...threads1046, expectedSelectedAssetId: 131 }).success, false);
    const telegram1099 = { projectId: 10, taskId: 1099, actorId: 'user:2',
        expectedManifestChecksum: OCT10_MANIFEST_CHECKSUM, expectedInitiativeId: 296, expectedChannelId: 108,
        expectedCurrentType: 'publication', expectedCurrentPlacement: 'feed', expectedTargetType: 'telegram_story',
        expectedTargetPlacement: 'story', expectedContentRevision: 1, expectedAcceptedRevision: 1,
        expectedBodySha256: 'f46104f5ed4e1b892d07eb1474015890165bc61a3d9bd0c7bce3edc061f2a2be',
        expectedDecisionId: 277, expectedDecisionVersion: 1, expectedSelectedAssetId: 134,
        expectedSourceAssetId: 133, expectedSourcePublicationFactId: 442,
        expectedAssetSha256: 'ab299952f375cef3346c9a43dc529db1a74ac281dc16f290ab8de0b6cb796c6c',
        prohibitedRenderJobId: '6474ed84-5a6a-494d-a06c-7183e9ace9bb',
        expectedScheduleAt: '2026-10-10T13:30:00.000Z', idempotencyKey: 'repair1099' };
    assert.equal(telegram1099RepairSchema.safeParse(telegram1099).success, true);
    assert.equal(telegram1099ReleaseSchema.safeParse({ ...telegram1099,
        expectedCurrentType: 'telegram_story', expectedCurrentPlacement: 'story', expectedTelegramAccountId: 2,
        expectedSourceStoryTaskId: 986, expectedSourceStoryFactId: 363,
        approvalReference: 'owner accepted exact Story' }).success, true);
    assert.equal(telegram1099RepairSchema.safeParse({ ...telegram1099, expectedTargetPlacement: 'feed' }).success, false);
});

test('only owner and Publisher profiles expose the exact release and claim paths', () => {
    const tools = ['ba_prepare_x_task1042_text_only_package', 'ba_release_x_task1042_browser', 'ba_claim_x_task1042_browser_publication',
        'ba_release_linkedin_task1072_personal_browser', 'ba_claim_linkedin_task1072_browser_publication',
        'ba_release_threads_task1043_api', 'ba_publish_threads_task1043',
        'ba_release_threads_task1046_api', 'ba_publish_threads_task1046',
        'ba_repair_telegram_task1099_story_placement', 'ba_release_telegram_task1099_personal_story',
        'ba_publish_telegram_task1099_personal_story',
        'ba_release_dzen_task1045', 'ba_verify_dzen_task1045_connector',
        'ba_reconcile_dzen_task1045_uncertain_attempt',
        'ba_preview_vk_task1048_api_promotion', 'ba_apply_vk_task1048_api_promotion'];
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

import assert from 'node:assert/strict';
import test from 'node:test';
import {
    EXACT_BROWSER_PACKAGES,
    releaseExactBrowserTask
} from '../services/exact_browser_publication_1133_1132.service';
import { PENDING_THREADS_PACKAGES } from '../services/threads_pending_release.service';
import { ThreadsTaskPublicationService } from '../services/threads_task_publication.service';
import { isToolAllowedForProfile } from '../mcp/capabilities';

const linkedInTools = (taskId: 1088 | 1134) => [
    `ba_release_linkedin_task${taskId}_browser`,
    `ba_claim_linkedin_task${taskId}_browser_publication`,
    `ba_start_linkedin_task${taskId}_browser_submission`,
    `ba_confirm_linkedin_task${taskId}_browser_submission`,
    `ba_mark_linkedin_task${taskId}_browser_submission_uncertain`
];

test('13 October LinkedIn routes bind exact task, identity, decision and package bytes', () => {
    assert.deepEqual(EXACT_BROWSER_PACKAGES.linkedin1088, {
        projectId: 7, taskId: 1088, channelId: 5, revision: 1,
        bodySha256: '8f251f8740f4b84ed1ac873113a0e62d199d650689345f3288efc8fd37bece61',
        assetId: null, assetSha256: null, placement: 'feed', schedule: '2026-10-13T09:00:00.000Z',
        manifest: 'sha256:e6178b5bfa7b08acb91dabfe7e34589e6067ae4b2d6270fbc0be8f983b6ef2bb',
        channelType: 'linkedin', artifactKind: 'post', decisionId: 250,
        targetProfileUrl: 'https://www.linkedin.com/in/innokentyb/', accountType: 'personal',
        browserProfile: 'Innokenty', duplicateCheckRequired: true
    });
    assert.equal(EXACT_BROWSER_PACKAGES.linkedin1134.channelId, 179);
    assert.equal(EXACT_BROWSER_PACKAGES.linkedin1134.decisionId, 295);
    assert.equal(EXACT_BROWSER_PACKAGES.linkedin1134.assetId, 148);
    assert.equal(EXACT_BROWSER_PACKAGES.linkedin1134.targetProfileUrl,
        'https://www.linkedin.com/company/79633032/');
    assert.equal(EXACT_BROWSER_PACKAGES.linkedin1134.browserProfile, 'Innokenty');
});

test('tomorrow LinkedIn release refuses to proceed without a global provider-history duplicate check', async () => {
    const pkg = EXACT_BROWSER_PACKAGES.linkedin1088;
    await assert.rejects(releaseExactBrowserTask('linkedin1088', {
        projectId: pkg.projectId, taskId: pkg.taskId, actorId: 'user:2',
        expectedManifestChecksum: pkg.manifest, expectedBodySha256: pkg.bodySha256,
        expectedScheduleAt: pkg.schedule, approvalReference: 'Owner approval at scheduled slot',
        idempotencyKey: 'release-1088-r1-test'
    }), /EXACT_BROWSER_SCOPE_MISMATCH/);
});

test('tomorrow publication controls are visible only at owner and publisher boundaries', () => {
    const tools = [...linkedInTools(1088), ...linkedInTools(1134),
        'ba_release_threads_task1110_api', 'ba_publish_threads_task1110'];
    for (const tool of tools) {
        assert.equal(isToolAllowedForProfile('owner', tool), true);
        assert.equal(isToolAllowedForProfile('publisher', tool), true);
        assert.equal(isToolAllowedForProfile('writer', tool), false);
        assert.equal(isToolAllowedForProfile('planner', tool), false);
    }
});

test('task1110 native route binds accepted revision2 and reports executable connector preflight', async () => {
    assert.deepEqual(PENDING_THREADS_PACKAGES[1110], {
        revision: 2, decisionId: 299, decisionChannel: 'threads', chain: false,
        bodySha256: '9172f6ceefe974c88caffb7b6aa84c971a3920fd5b0c281c0a6329b94825ce30',
        releaseCommand: 'ba_release_threads_task1110_api', schedule: '2026-10-13T16:30:00.000Z'
    });
    const body = 'x'.repeat(462);
    const service = new ThreadsTaskPublicationService({ db: { contentItem: { findFirst: async () => ({
        id: 1110, project_id: 10, channel_id: 138, channel: { type: 'threads', config: {
            access_token: 'fixture', threads_user_id: '39421253764155091' } },
        accepted_revision: 2, content_revision: 2, text_state: 'accepted', draft_text: body,
        selected_asset_id: null, visual_state: 'NO_VISUAL_NEEDED', visual_decision_version: 2,
        schedule_at: new Date('2026-10-13T16:30:00.000Z')
    }) } } });
    const result = await service.execute({ projectId: 10, taskId: 1110, dryRun: true }) as {
        route_executable: boolean; live_publish_supported: boolean; route_blocker?: string;
        payload_preview: { character_count: number };
    };
    assert.equal(result.route_executable, true);
    assert.equal(result.live_publish_supported, true);
    assert.equal(result.route_blocker, undefined);
    assert.equal(result.payload_preview.character_count, 462);
});

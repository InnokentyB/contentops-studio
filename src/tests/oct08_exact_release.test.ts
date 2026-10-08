import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedInTask1077ReleaseSchema, dzenTask1036ReleaseSchema } from '../mcp/tools/oct08_exact_release_tools';
import { isToolAllowedForProfile } from '../mcp/capabilities';
import { DzenTaskPublicationService } from '../services/dzen_task_publication.service';

const common = { actorId: 'user:2', approvalReference: 'Owner GO 2026-10-08',
    idempotencyKey: 'exact-release-v1', expectedManifestChecksum: `sha256:${'a'.repeat(64)}` };
const linkedin = { ...common, projectId: 7, taskId: 1077, expectedChannelId: 5,
    expectedContentRevision: 1, expectedAcceptedRevision: 1, expectedSelectedAssetId: null,
    expectedVisualDecisionId: 252,
    expectedAssetSha256: null, expectedScheduleAt: '2026-10-08T09:00:00.000Z',
    expectedBodySha256: '5f9df7dcbcb1d999742e7a3f918b2ba9fb4fff92d5470009dee0b3034c5ec53a' };
const dzen = { ...common, projectId: 10, taskId: 1036, expectedChannelId: 116,
    expectedContentRevision: 2, expectedAcceptedRevision: 2, expectedVisualState: 'APPROVED',
    expectedPlacement: 'article_cover', expectedVisualDecisionVersion: 1, expectedSelectedAssetId: 122,
    expectedScheduleAt: '2026-10-08T11:30:00.000Z', expectedPublishAt: '2026-10-08T11:30:00.000Z',
    expectedBodySha256: '84f8f3ea79c4f252216e7568aa12a84eff08f685f33d4da360b94c8d8073e0fa',
    expectedAssetSha256: '8cbe7cecab92124712292d4d2b6723cee113d6dadec6d0a3ac6d952aeec925ba' };

test('October 8 release schemas pin accepted package and reject cross-tenant or changed bytes', () => {
    assert.equal(linkedInTask1077ReleaseSchema.safeParse(linkedin).success, true);
    assert.equal(dzenTask1036ReleaseSchema.safeParse(dzen).success, true);
    for (const [schema, args] of [[linkedInTask1077ReleaseSchema, linkedin], [dzenTask1036ReleaseSchema, dzen]] as const) {
        for (const [field, value] of Object.entries({ projectId: 99, taskId: 1040, expectedChannelId: 139,
            expectedContentRevision: 9, expectedAcceptedRevision: 9, expectedSelectedAssetId: 999,
            expectedBodySha256: 'b'.repeat(64), expectedAssetSha256: 'c'.repeat(64),
            expectedScheduleAt: '2026-10-09T09:00:00.000Z', idempotencyKey: '' })) {
            assert.equal(schema.safeParse({ ...args, [field]: value }).success, false, field);
        }
    }
});

test('publisher receives exact releases only; generic owner controls stay hidden', () => {
    for (const name of ['ba_release_linkedin_task1077_browser', 'ba_release_dzen_task1036', 'ba_verify_dzen_task1036_connector']) {
        assert.equal(isToolAllowedForProfile('publisher', name), true);
        assert.equal(isToolAllowedForProfile('writer', name), false);
    }
    assert.equal(isToolAllowedForProfile('publisher', 'ba_release_approved_dzen_task'), false);
    assert.equal(isToolAllowedForProfile('publisher', 'ba_release_approved_linkedin_browser_task'), false);
});

test('1036 dry-run checks exact release and cover, never calls the provider or mutates', async () => {
    let sideEffects = 0;
    const forbidden = async () => { sideEffects++; throw new Error('unexpected side effect'); };
    const task = { id: 1036, project_id: 10, channel_id: 116,
        channel: { type: 'dzen', config: { cookies: 'test-fixture', channel_id: 'test-channel' } },
        content_revision: 2, accepted_revision: 2, text_state: 'accepted', draft_text: 'fixture', title: 'Fixture',
        visual_state: 'APPROVED', visual_placement: 'article_cover', visual_decision_version: 1,
        selected_asset_id: 122, selected_asset: { id: 122, status: 'approved', content_revision: 2,
            file_url: 'https://example.test/122.jpg', provenance: { planner_storage: { sha256: dzen.expectedAssetSha256 } } },
        status: 'ready_for_execution', handoff_state: 'ready', publication_mode: 'owner_released',
        schedule_at: new Date(dzen.expectedScheduleAt), publication_fact: null, published_link: null, quality_report: {} };
    const service = new DzenTaskPublicationService({
        hashBody: () => dzen.expectedBodySha256,
        db: { contentItem: { findFirst: async () => task, updateMany: forbidden },
            artDirectionDecision: { findFirst: async () => ({ id: 253, decision_version: 1 }) },
            workflowEvent: { findFirst: async ({ where }: { where: { command: string } }) => ({ after_state:
                where.command === 'ba_verify_dzen_task1036_connector'
                    ? { task_id: 1036, channel_id: 116, body_sha256: dzen.expectedBodySha256,
                        selected_asset_id: 122, asset_sha256: dzen.expectedAssetSha256,
                        authenticated: true, editor_available: true, checked_at: new Date().toISOString() }
                    : { task_id: 1036, channel_id: 116, content_revision: 2, accepted_revision: 2,
                        body_sha256: dzen.expectedBodySha256, visual_decision_id: 253,
                        selected_asset_id: 122, asset_sha256: dzen.expectedAssetSha256,
                        schedule_at: dzen.expectedScheduleAt, publication_mode: 'owner_released' }
            }), create: forbidden } },
        dzen: { publishPost: forbidden, testConnection: forbidden, readStudioPublications: forbidden },
        facts: { record: forbidden }
    });
    const result = await service.execute({ projectId: 10, taskId: 1036, dryRun: true });
    assert.equal(result.mode, 'dry_run');
    assert.equal(sideEffects, 0);
    task.selected_asset_id = 123;
    await assert.rejects(() => service.execute({ projectId: 10, taskId: 1036, dryRun: true }), /DZEN_OWNER_RELEASE_PROOF_MISMATCH/);
});

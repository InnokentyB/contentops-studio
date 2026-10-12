import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVkConnectorSnapshot } from '../services/vk_connector_package';
import { connectorHash } from '../services/vk_connector_contract';
function fixture() {
    const body = 'Exact accepted feed body';
    const release = { actor_id: 'user:2', publication_authorized: true, placement: 'feed', body_sha256: connectorHash(body),
        asset_sha256: 'b'.repeat(64), content_revision: 1, selected_asset_id: 130,
        approval_reference: 'owner approval exact1048', released_at: '2026-10-12T19:00:00Z' };
    const task = { id: 1048, project_id: 10, channel_id: 117, content_revision: 1, accepted_revision: 1,
        text_state: 'accepted', visual_state: 'APPROVED', visual_placement: 'feed', selected_asset_id: 130,
        status: 'browser_required', publication_mode: 'browser_required', handoff_state: 'ready',
        draft_text: body, published_link: null, publication_fact: null,
        quality_report: { owner_release: release },
        channel: { id: 117, project_id: 10, type: 'vk', is_active: true, config: { vk_id: '-240051152' } },
        selected_asset: { id: 130, project_id: 10, content_item_id: 1048, content_revision: 1, status: 'approved',
            provenance: { planner_storage: { sha256: 'b'.repeat(64) } } } };
    const item = { id: 1699, project_id: 10, content_item_id: 1048, kind: 'browser_publish', assignee_role: 'browser_publisher',
        state: 'claimed', input_context_version: 1, result_payload: { ...release, channel_id: 117 } };
    return { task, item };
}
test('VK016-PACKAGE: repository validates exact independent task, asset, WI and current owner release', () => {
    const f = fixture(); const snapshot = buildVkConnectorSnapshot(f.task, f.item, null);
    assert.equal(snapshot.eligible, true); assert.equal(snapshot.package.taskId, 1048); assert.equal(snapshot.workItemId, 1699);
    assert.equal(snapshot.factId, null); assert.equal(snapshot.attemptId, null);
    for (const mutate of [
        (x: ReturnType<typeof fixture>) => { x.task.selected_asset.project_id = 7; },
        (x: ReturnType<typeof fixture>) => { x.task.selected_asset.content_item_id = 1084; },
        (x: ReturnType<typeof fixture>) => { x.task.draft_text += ' changed'; },
        (x: ReturnType<typeof fixture>) => { x.task.accepted_revision = 2; },
        (x: ReturnType<typeof fixture>) => { x.task.quality_report.owner_release.publication_authorized = false; },
        (x: ReturnType<typeof fixture>) => { x.item.result_payload.asset_sha256 = 'd'.repeat(64); },
        (x: ReturnType<typeof fixture>) => { x.item.result_payload.approval_reference = 'different owner release'; },
        (x: ReturnType<typeof fixture>) => { x.item.result_payload.channel_id = 999; }
    ]) {
        const invalid = fixture(); mutate(invalid); assert.throws(() => buildVkConnectorSnapshot(invalid.task, invalid.item, null), /PACKAGE_NOT_READY/);
    }
});
test('VK016-PACKAGE: held handoff or WI and any existing attempt are not ready to execute', () => {
    const held = fixture(); held.task.handoff_state = 'blocked';
    assert.equal(buildVkConnectorSnapshot(held.task, held.item, null).eligible, false);
    const f = fixture(); f.item.state = 'blocked'; assert.equal(buildVkConnectorSnapshot(f.task, f.item, null).eligible, false);
    const current = fixture(); const snapshot = buildVkConnectorSnapshot(current.task, current.item,
        { id: 28, project_id: 10, content_item_id: 1048, channel_id: 117, status: 'pending' });
    assert.equal(snapshot.attemptId, 28);
    assert.throws(() => buildVkConnectorSnapshot(current.task, current.item,
        { id: 28, project_id: 7, content_item_id: 1048, channel_id: 117, status: 'pending' }), /PACKAGE_NOT_READY/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVkConnectorSnapshot } from '../services/vk_connector_package';
import { connectorHash, connectorPackageHash } from '../services/vk_connector_contract';
import { harness } from './helpers/vk_connector_harness';

function records(project: number, taskId: number, channelId: number, assetId: number, revision: number, community: string) {
    const body = `Accepted synthetic body ${project}`;
    const release = { publication_authorized: true, placement: 'feed', body_sha256: connectorHash(body),
        asset_sha256: 'b'.repeat(64), content_revision: revision, selected_asset_id: assetId,
        approval_reference: `owner-release-${project}`, actor_id: `user:${project}`, released_at: '2026-10-17T12:00:00Z' };
    const task = { id: taskId, project_id: project, channel_id: channelId, content_revision: revision, accepted_revision: revision,
        text_state: 'accepted', visual_state: 'APPROVED', visual_placement: 'feed', selected_asset_id: assetId,
        status: 'browser_required', publication_mode: 'browser_required', handoff_state: 'ready', draft_text: body,
        published_link: null, publication_fact: null, quality_report: { owner_release: release },
        channel: { id: channelId, project_id: project, type: 'vk', is_active: true, config: { vk_id: community } },
        selected_asset: { id: assetId, project_id: project, content_item_id: taskId, content_revision: revision,
            status: 'approved', provenance: { planner_storage: { sha256: release.asset_sha256 } } } };
    const item = { id: taskId + 100, project_id: project, content_item_id: taskId, kind: 'browser_publish',
        assignee_role: 'browser_publisher', state: 'available', input_context_version: revision,
        result_payload: { ...release, channel_id: channelId } };
    return { task, item };
}
test('VK022 shared snapshot resolves two tenant publications from records without business-ID authority', () => {
    for (const data of [records(10, 1048, 117, 130, 1, '-240051152'), records(31, 8207, 902, 1901, 4, '-654321')]) {
        const snapshot = buildVkConnectorSnapshot(data.task, data.item, null);
        assert.equal(snapshot.package.projectId, data.task.project_id);
        assert.equal(snapshot.package.taskId, data.task.id);
        assert.equal(snapshot.package.channelId, data.task.channel_id);
        assert.equal(snapshot.package.communityId, Number(data.task.channel.config.vk_id));
        assert.equal(snapshot.package.revision, data.task.content_revision);
        assert.equal(snapshot.package.selectedAssetId, data.task.selected_asset_id);
        assert.equal(snapshot.workItemId, data.item.id);
        assert.equal(snapshot.eligible, true);
        for (const change of [
            (x: typeof data) => { x.task.selected_asset.project_id++; },
            (x: typeof data) => { x.task.channel.id++; },
            (x: typeof data) => { x.task.accepted_revision++; },
            (x: typeof data) => { x.item.result_payload.content_revision++; },
            (x: typeof data) => { x.item.input_context_version++; },
            (x: typeof data) => { x.task.selected_asset.content_revision++; },
            (x: typeof data) => { x.task.draft_text += 'changed'; }
        ]) {
            const bad = structuredClone(data); change(bad);
            assert.throws(() => buildVkConnectorSnapshot(bad.task, bad.item, null), /PACKAGE_NOT_READY/);
        }
    }
});
test('VK022 shared dispatch and receipt use authenticated tenant and validated host data', async () => {
    const h = harness(); const data = records(31, 8207, 902, 1901, 4, '-654321');
    Object.assign(h.snapshot, buildVkConnectorSnapshot(data.task, data.item, null));
    h.store.authorize = async (p, a) => { if (p !== 31 || a !== 'user:31') throw new Error('DENIED'); };
    const identity = { projectId: 31, actorId: 'user:31' };
    const request = { ...identity, taskId: data.task.id, expectedPackageSha256: connectorPackageHash(h.snapshot.package), idempotencyKey: 'shared-publication' };
    const job = await h.service.dispatch(request);
    assert.equal((await h.service.dispatch(request)).jobId, job.jobId);
    const consumer = { ...identity, hostId: 'synthetic-vk-account-b', instanceId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', buildVersion: 'shared-test' };
    h.hosts.set(consumer.hostId, { projectId: identity.projectId, hostId: consumer.hostId, instanceId: consumer.instanceId,
        buildVersion: 'synthetic-registered', heartbeatAt: new Date('2026-10-12T19:00:00Z'), mode: 'infrastructure_only', blocker: null });
    const [queued] = (await h.service.poll(consumer)).jobs;
    assert.equal((await h.service.ack({ ...consumer, ...queued })).state, 'accepted');
    await assert.rejects(h.service.dispatch({ ...request, projectId: 32 }), /DENIED/);
    assert.equal(h.jobs.size, 1); assert.equal(h.snapshot.attemptId, null); assert.equal(h.snapshot.factId, null);
});
test('VK022 shared dispatch rejects mismatched resolved tenant and changed canonical work binding', async () => {
    const h = harness();
    h.snapshot.package.projectId = 99;
    await assert.rejects(h.service.dispatch({ ...h.request, expectedPackageSha256: connectorPackageHash(h.snapshot.package) }), /PACKAGE_CHANGED/);
    assert.equal(h.jobs.size, 0);
    h.snapshot.package.projectId = h.identity.projectId;
    const job = await h.service.dispatch(h.request);
    h.snapshot.workItemId++;
    await assert.rejects(h.service.dispatch(h.request), /PACKAGE_CHANGED/);
    assert.equal(h.jobs.get(job.jobId)?.state, 'queued');
    assert.equal(h.snapshot.attemptId, null); assert.equal(h.snapshot.factId, null);
});

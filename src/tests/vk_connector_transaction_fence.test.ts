import test from 'node:test';
import assert from 'node:assert/strict';
import { connectorHash, connectorPackageHash } from '../services/vk_connector_contract';
import { buildVkConnectorSnapshot } from '../services/vk_connector_package';
import { assertVkConnectorTransactionFence } from '../services/vk_connector_execution_ports';
import prisma from '../db';

process.env.TELEGRAM_BOT_TOKEN ||= 'test:connector-fence';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_KEY ||= 'test-only';

test('VK017 canonical transaction fence rejects stale generation, hold and cancelled payload before canonical writes', async context => {
    const now = new Date();
    const token = 'fixture-canonical-lease';
    const release = { publication_authorized: true, placement: 'feed', body_sha256: connectorHash('Fixture body'),
        asset_sha256: 'b'.repeat(64), content_revision: 1, selected_asset_id: 130,
        approval_reference: 'exact-owner-fixture-1048', actor_id: 'user:2', released_at: '2026-10-13T00:00:00Z' };
    const task = { id: 1048, project_id: 10, channel_id: 117, content_revision: 1, accepted_revision: 1,
        text_state: 'accepted', visual_placement: 'feed', selected_asset_id: 130, visual_state: 'APPROVED',
        status: 'publishing', publication_mode: 'browser_required', handoff_state: 'ready', draft_text: 'Fixture body',
        published_link: null, quality_report: { owner_release: release }, updated_at: now,
        channel: { id: 117, project_id: 10, type: 'vk', is_active: true, config: { vk_id: '-240051152' }, updated_at: now },
        selected_asset: { id: 130, project_id: 10, content_item_id: 1048, content_revision: 1, status: 'approved',
            provenance: { planner_storage: { sha256: 'b'.repeat(64) } }, updated_at: now }, publication_fact: null };
    const work = { id: 1699, project_id: 10, content_item_id: 1048, kind: 'browser_publish', assignee_role: 'browser_publisher',
        state: 'claimed', input_context_version: 1, result_payload: { ...release, channel_id: 117 }, updated_at: now,
        lease_token: token, lease_actor_id: 'user:2', lease_expires_at: new Date(now.getTime() + 60_000) };
    const hash = connectorPackageHash(buildVkConnectorSnapshot(task, work, null).package);
    const args = { projectId: 10, actorId: 'user:2', jobId: '00000000-0000-4000-8000-000000000001',
        generation: 3, packageSha256: hash, hostId: 'vk-connector-local-1048',
        instanceId: '00000000-0000-4000-8000-000000000002', leaseToken: token };
    const job = { id: args.jobId, project_id: 10, content_item_id: 1048, channel_id: 117, work_item_id: 1699,
        generation: 3, package_sha256: hash, host_id: args.hostId, consumer_instance_id: args.instanceId,
        state: 'executing', updated_at: now, canonical_lease_sha256: connectorHash(token),
        canonical_lease_expires_at: work.lease_expires_at };
    let writes = 0;
    const stub = (target: object, key: string, value: (...params: unknown[]) => unknown): void => {
        const before: unknown = Reflect.get(target, key);
        assert.equal(typeof before, 'function');
        assert.equal(Reflect.set(target, key, value), true);
        context.after(() => { assert.equal(Reflect.set(target, key, before), true); });
    };
    stub(prisma.projectMember, 'findUnique', async () => ({ role: 'owner' }));
    stub(prisma.connectorDispatchJob, 'findFirst', async () => job);
    stub(prisma.connectorHostStatus, 'findUnique', async () => ({ instance_id: args.instanceId, heartbeat_at: now, mode: 'vk_feed_provider' }));
    stub(prisma.contentItem, 'findFirst', async () => task);
    stub(prisma.workItem, 'findFirst', async () => work);
    stub(prisma.deliveryAttempt, 'findFirst', async () => null);
    for (const model of [prisma.connectorDispatchJob, prisma.contentItem, prisma.workItem, prisma.imageAsset, prisma.socialChannel]) {
        stub(model, 'updateMany', async () => { writes++; return { count: 1 }; });
    }
    await assertVkConnectorTransactionFence(prisma, args, true);
    assert.equal(writes, 5);
    writes = 0;
    job.generation = 4;
    await assert.rejects(assertVkConnectorTransactionFence(prisma, args, true), /FENCED/);
    assert.equal(writes, 0);
    job.generation = 3;
    for (const status of ['cancelled', 'ready_for_execution', 'published']) {
        task.status = status;
        await assert.rejects(assertVkConnectorTransactionFence(prisma, args, true), /PACKAGE_CHANGED/);
        assert.equal(writes, 0);
    }
    task.status = 'publishing';
    Object.assign(task.quality_report, { publication_hold: { state: 'owner_hold' } });
    await assert.rejects(assertVkConnectorTransactionFence(prisma, args, true), /PACKAGE_CHANGED/);
    assert.equal(writes, 0);
    Reflect.deleteProperty(task.quality_report, 'publication_hold');
    task.handoff_state = 'blocked';
    await assert.rejects(assertVkConnectorTransactionFence(prisma, args, true), /PACKAGE_CHANGED/);
    assert.equal(writes, 0);
    task.handoff_state = 'ready'; task.channel.is_active = false;
    await assert.rejects(assertVkConnectorTransactionFence(prisma, args, true), /PACKAGE_CHANGED|PACKAGE_NOT_READY/);
    assert.equal(writes, 0);
});

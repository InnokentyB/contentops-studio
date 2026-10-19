import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/vk_connector_harness';
import type { ConnectorHost } from '../services/vk_connector_contract';
function registered(h: ReturnType<typeof harness>, mode: ConnectorHost['mode'] = 'vk_feed_provider'): ConnectorHost {
    return { projectId: h.identity.projectId, hostId: h.consumer.hostId, instanceId: h.consumer.instanceId,
        buildVersion: 'fixture-registration', heartbeatAt: new Date('2026-10-12T19:00:00Z'), mode, blocker: null };
}
test('VK022 unknown consumer cannot self-register by polling', async () => {
    const h = harness(); h.hosts.clear();
    await assert.rejects(h.service.poll(h.consumer), /HOST_NOT_REGISTERED/);
    assert.equal(h.hosts.size, 0); assert.equal(h.events.length, 0);
});
test('VK022 polling cannot upgrade the registered tenant host capability', async () => {
    const h = harness(); h.hosts.set(h.consumer.hostId, registered(h, 'infrastructure_only'));
    await assert.rejects(h.service.poll({ ...h.consumer, mode: 'vk_feed_provider' }), /HOST_MODE/);
    assert.equal(h.hosts.get(h.consumer.hostId)?.mode, 'infrastructure_only');
});
test('VK022 another registered healthy host cannot interrupt or take over a live provider job', async () => {
    const h = harness(); h.hosts.set(h.consumer.hostId, registered(h));
    await h.service.dispatch(h.request);
    const [queued] = (await h.service.poll({ ...h.consumer, mode: 'vk_feed_provider' })).jobs;
    const receipt = await h.service.ack({ ...h.consumer, ...queued });
    const row = h.jobs.get(receipt.jobId); assert.ok(row);
    const other = { ...h.consumer, hostId: 'synthetic-second-host', instanceId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', mode: 'vk_feed_provider' as const };
    h.hosts.set(other.hostId, { ...registered(h), hostId: other.hostId, instanceId: other.instanceId });
    for (const state of ['ready','executing','reconciling','accepted'] as const) {
        row.state = state;
        const before: import('../services/vk_connector_contract').ConnectorJob = structuredClone(row);
        assert.equal((await h.service.poll(other)).jobs.length, 0);
        assert.deepEqual(h.jobs.get(row.jobId), before);
    }
});

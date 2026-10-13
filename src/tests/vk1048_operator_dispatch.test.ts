import assert from 'node:assert/strict';
import test from 'node:test';
import { withVk1048Heartbeat } from '../services/vk1048_operator_dispatch';
import type { VkConnectorControl, VkConnectorIdentity } from '../services/vk_connector_consumer_runtime';
const identity: VkConnectorIdentity = { projectId: 10, actorId: 'user:0', hostId: 'vk-connector-local-1048', instanceId: '00000000-0000-4000-8000-000000000001', buildVersion: 'fixture', mode: 'vk_feed_provider' };
test('OPERATOR-001 scoped heartbeat renews during work without job harvesting and stops on completion', async () => {
    const calls: string[] = [];
    const control: VkConnectorControl = { close: async () => undefined, call: async name => { calls.push(name); return { status: 'online', heartbeatAt: new Date().toISOString() }; } };
    await withVk1048Heartbeat(control, identity, async () => { await new Promise(resolve => setTimeout(resolve, 35)); }, undefined, 10);
    const count = calls.length; await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(count >= 2); assert.equal(calls.length, count); assert.ok(calls.every(name => name === 'ba_renew_vk_connector_heartbeat'));
});
test('OPERATOR-002 hung renewal is bounded and prevents any provider work', async () => {
    let work = false;
    const control: VkConnectorControl = { close: async () => undefined, call: async () => new Promise(() => undefined) };
    await assert.rejects(withVk1048Heartbeat(control, identity, async () => { work = true; }, undefined, 10), /HEARTBEAT_UNAVAILABLE/);
    assert.equal(work, false);
});

test('OPERATOR-003 existing resource directories must be private, owned and not symlinks', async (t) => {
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
    const { validateVk1048OperatorResources } = await import('../services/vk1048_operator_dispatch');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-resources-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const profile = path.join(root, 'profile'), evidence = path.join(root, 'evidence');
    fs.mkdirSync(profile, { mode: 0o700 }); fs.mkdirSync(evidence, { mode: 0o700 });
    validateVk1048OperatorResources(profile, evidence);
    fs.chmodSync(evidence, 0o755); assert.throws(() => validateVk1048OperatorResources(profile, evidence));
    fs.chmodSync(evidence, 0o700); const link = path.join(root, 'link'); fs.symlinkSync(profile, link);
    assert.throws(() => validateVk1048OperatorResources(link, evidence));
});

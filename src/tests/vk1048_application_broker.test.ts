import assert from 'node:assert/strict';
import test from 'node:test';
import { createVk1048ApplicationBroker } from '../services/vk1048_application_broker';
import type { VkConnectorControl } from '../services/vk_connector_consumer_runtime';
const scope = { projectId: 10, actorId: 'user:0', hostId: 'vk-connector-local-1048', instanceId: '1a90b31f-4dfe-4ec7-ae9c-078639a905f9',
    jobId: 'd5f98f04-fc1d-4c27-8eb4-8b62678ef663', generation: 1, packageSha256: 'a'.repeat(64) };
test('BROKER-001 single-use app challenges bind purpose and current claim generation', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const control: VkConnectorControl = { close: async () => undefined, call: async (name, args) => {
        calls.push({ name, args }); return { challengeId: '7fc5d0d9-3fbf-4c9d-a2f8-0154a0b75782', nonce: 'b'.repeat(64),
            purpose: args.purpose, authorization: 'application_host', issuedAt: '2026-10-13T10:00:00Z', expiresAt: '2026-10-13T10:02:00Z' };
    } };
    const broker = createVk1048ApplicationBroker(control, scope, () => new Date('2026-10-13T10:00:01Z'));
    await broker.authorize('wall_read');
    assert.equal(broker.attest('wall_read', { genuine: 'fixture evidence' }).operation, 'wall_read');
    assert.throws(() => broker.attest('wall_read', {}), /CHALLENGE_UNAVAILABLE/);
    broker.updateGeneration(2); await broker.authorize('submission');
    assert.equal(calls[1].args.generation, 2);
});

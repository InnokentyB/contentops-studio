import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/vk_connector_harness';

async function accepted() {
    const h = harness(); await h.service.dispatch(h.request);
    const [queued] = (await h.service.poll(h.consumer)).jobs;
    const receipt = await h.service.ack({ ...h.consumer, ...queued });
    const row = h.jobs.get(receipt.jobId); assert.ok(row);
    return { h, receipt, row };
}

test('VK017 active provider heartbeat renews the same instance without polling or changing execution state', async () => {
    const { h, receipt, row } = await accepted();
    row.state = 'executing'; row.attemptId = 51; row.canonicalLeaseSha256 = 'd'.repeat(64);
    h.advance(20_000);
    await h.service.heartbeat(h.consumer);
    h.advance(20_000);
    assert.equal((await h.service.health(h.consumer)).status, 'online');
    assert.equal(row.state, 'executing'); assert.equal(row.generation, receipt.generation);
    assert.equal(row.attemptId, 51); assert.equal(row.canonicalLeaseSha256, 'd'.repeat(64));
    await assert.rejects(h.service.heartbeat({ ...h.consumer, instanceId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' }), /FENCED/);
});

test('VK017 replacement process rebinds the same uncertain job only for read-only reconciliation', async () => {
    const { h, receipt, row } = await accepted();
    row.state = 'executing'; row.attemptId = 51; row.canonicalLeaseSha256 = 'd'.repeat(64);
    h.snapshot.attemptId = 51; h.snapshot.attemptStatus = 'pending';
    h.advance(31_000);
    const replacement = { ...h.consumer, mode: 'vk_feed_provider' as const, instanceId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' };
    await h.service.poll(replacement);
    const frozenGeneration = row.generation;
    const args = { ...replacement, jobId: receipt.jobId, generation: frozenGeneration, packageSha256: receipt.packageSha256 };
    await h.service.rebindReconciliation(args);
    assert.equal(row.instanceId, replacement.instanceId); assert.equal(row.generation, frozenGeneration + 1);
    assert.equal(row.state, 'verification_required'); assert.equal(row.attemptId, 51);
    assert.equal(row.canonicalLeaseSha256, 'd'.repeat(64)); assert.equal(h.jobs.size, 1);
    await assert.rejects(h.service.ack({ ...replacement, jobId: row.jobId, generation: row.generation, packageSha256: row.packageSha256 }), /CAS|VERIFICATION/);
    await assert.rejects(h.service.rebindReconciliation(args), /CAS|FENCED/);
});

test('VK017 reconciliation rebind rejects changed package or canonical attempt without granting a retry', async () => {
    const { h, receipt, row } = await accepted();
    row.state = 'verification_required'; row.attemptId = 51;
    const args = { ...h.consumer, jobId: row.jobId, generation: row.generation, packageSha256: row.packageSha256 };
    await h.service.poll({ ...h.consumer, mode: 'vk_feed_provider' });
    await assert.rejects(h.service.rebindReconciliation({ ...args, packageSha256: '0'.repeat(64) }), /FENCED/);
    await assert.rejects(h.service.rebindReconciliation(args), /ATTEMPT_CHANGED/);
    assert.equal(row.generation, receipt.generation); assert.equal(row.state, 'verification_required');
    assert.equal(row.attemptId, 51); assert.equal(row.instanceId, h.consumer.instanceId);
});

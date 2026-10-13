import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/vk_connector_harness';

async function blocked() {
    const h = harness();
    await h.service.dispatch(h.request);
    const [job] = (await h.service.poll(h.consumer)).jobs;
    const receipt = await h.service.ack({ ...h.consumer, ...job });
    await h.service.report({ ...h.consumer, jobId: receipt.jobId, generation: receipt.generation, blocker: 'PROVIDER_CONTROL_DENIED' });
    return { h, receipt };
}
test('VK017 owner resumes the same immutable job with CAS and retains its prior blocker audit', async () => {
    const { h, receipt } = await blocked();
    const result = await h.service.resume({ ...h.identity, jobId: receipt.jobId, expectedGeneration: receipt.generation,
        expectedPackageSha256: receipt.packageSha256, approvalReference: 'owner-approved-delta017', idempotencyKey: 'resume-test-v1' });
    assert.equal(result.jobId, receipt.jobId);
    assert.equal(result.state, 'queued');
    assert.equal(result.generation, receipt.generation + 1);
    assert.equal(h.jobs.size, 1);
    assert.equal(h.snapshot.attemptId, null);
    assert.equal(h.snapshot.factId, null);
    assert.ok(h.events.some(event => event.command === 'vk_connector_owner_resume'));
    await assert.rejects(h.service.resume({ ...h.identity, actorId: 'user:8', jobId: result.jobId,
        expectedGeneration: result.generation, expectedPackageSha256: result.packageSha256,
        approvalReference: 'owner-approved-delta017', idempotencyKey: 'wrong-owner' }));
});
test('VK017 stale generation, changed release and existing attempt cannot resume for send', async () => {
    const { h, receipt } = await blocked();
    const args = { ...h.identity, jobId: receipt.jobId, expectedGeneration: receipt.generation,
        expectedPackageSha256: receipt.packageSha256, approvalReference: 'owner-approved-delta017', idempotencyKey: 'resume-test-v1' };
    await assert.rejects(h.service.resume({ ...args, expectedGeneration: 0 }), /CAS|FENCED/);
    h.snapshot.attemptId = 51;
    await assert.rejects(h.service.resume(args), /VERIFICATION_REQUIRED/);
    assert.equal([...h.jobs.values()][0].state, 'blocked');
});

test('VK017 replay preserves one resume generation and safe prior blocker/receipt audit', async () => {
    const { h, receipt } = await blocked();
    const args = { ...h.identity, jobId: receipt.jobId, expectedGeneration: receipt.generation,
        expectedPackageSha256: receipt.packageSha256, approvalReference: 'owner-approved-delta017', idempotencyKey: 'resume-test-v1' };
    const one = await h.service.resume(args), two = await h.service.resume(args);
    assert.equal(one.generation, two.generation);
    assert.equal(h.jobs.size, 1);
    const event = h.events.find(row => row.command === 'vk_connector_owner_resume');
    assert.equal(event?.previousBlocker, 'PROVIDER_CONTROL_DENIED');
    assert.equal(event?.previousReceiptAt, receipt.receiptAt);
    assert.equal(JSON.stringify(event).includes(args.approvalReference), false);
    await assert.rejects(h.service.resume({ ...args, approvalReference: 'different-owner-reference' }), /IDEMPOTENCY_CONFLICT/);
});
test('VK017 lost claim response and executing restart freeze advanced states without lease reset or retry', async () => {
    for (const state of ['reconciling','ready','executing'] as const) {
        const h = harness(); await h.service.dispatch(h.request);
        const [job] = (await h.service.poll(h.consumer)).jobs;
        const accepted = await h.service.ack({ ...h.consumer, ...job });
        const row = h.jobs.get(job.jobId); assert.ok(row);
        row.state = state;
        row.canonicalLeaseSha256 = 'd'.repeat(64);
        if (state === 'executing') { h.snapshot.attemptId = 51; h.snapshot.attemptStatus = 'pending'; }
        assert.equal((await h.service.poll(h.consumer)).jobs.length, 0);
        assert.equal(h.jobs.get(job.jobId)?.state, state);
        h.advance(31_000);
        const replacement = { ...h.consumer, instanceId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' };
        assert.equal((await h.service.poll(replacement)).jobs.length, 0);
        const frozen = h.jobs.get(job.jobId); assert.ok(frozen);
        assert.equal(frozen.state, 'verification_required');
        assert.equal(frozen.generation, accepted.generation + 1);
        assert.equal(frozen.canonicalLeaseSha256, 'd'.repeat(64));
        assert.equal(h.snapshot.workItemId, 1699);
        assert.equal(h.snapshot.attemptId, state === 'executing' ? 51 : null);
    }
});

test('VK017 invalid advanced package preserves heartbeat and freezes the same job without losing attempt evidence', async () => {
    for (const invalidation of ['not_ready', 'changed'] as const) {
        const h = harness(); await h.service.dispatch(h.request);
        const [job] = (await h.service.poll(h.consumer)).jobs;
        const accepted = await h.service.ack({ ...h.consumer, ...job });
        const row = h.jobs.get(job.jobId); assert.ok(row);
        row.state = 'ready'; row.attemptId = 51; row.canonicalLeaseSha256 = 'd'.repeat(64);
        if (invalidation === 'not_ready') h.invalidate();
        else h.snapshot.package.bodySha256 = 'e'.repeat(64);
        h.advance(31_000);
        const replacement = { ...h.consumer, instanceId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' };
        const polled = await h.service.poll(replacement);
        assert.equal(polled.health.status, 'online');
        assert.equal(polled.jobs.length, 0);
        assert.equal(h.hosts.get(h.consumer.hostId)?.instanceId, replacement.instanceId);
        assert.equal(h.hosts.get(h.consumer.hostId)?.heartbeatAt.toISOString(), polled.health.heartbeatAt);
        const frozen = h.jobs.get(job.jobId); assert.ok(frozen);
        assert.equal(h.jobs.size, 1);
        assert.equal(frozen.state, 'verification_required');
        assert.equal(frozen.blocker, invalidation === 'not_ready' ? 'PACKAGE_NOT_READY' : 'PACKAGE_CHANGED');
        assert.equal(frozen.generation, accepted.generation + 1);
        assert.equal(frozen.attemptId, 51);
        assert.equal(frozen.canonicalLeaseSha256, 'd'.repeat(64));
        assert.equal(frozen.packageSha256, accepted.packageSha256);
    }
});

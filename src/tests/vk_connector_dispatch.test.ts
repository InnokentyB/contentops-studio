import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/vk_connector_harness';
import { VK_CONNECTOR_HOST } from './helpers/vk_connector_fixture';

test('VK016-01: Planner command is queued until a standalone consumer acknowledges, then blocked without publication', async () => {
    const h = harness(); const initial = await h.service.dispatch(h.request);
    assert.equal(initial.state, 'queued'); assert.equal(initial.receiptAt, null);
    const poll = await h.service.poll(h.consumer); assert.equal(poll.jobs.length, 1);
    assert.deepEqual(poll.jobs[0].package, h.snapshot.package);
    const accepted = await h.service.ack({ ...h.consumer, ...poll.jobs[0] });
    assert.equal(accepted.state, 'accepted'); assert.ok(accepted.receiptAt); assert.equal(accepted.generation, 1);
    const blocked = await h.service.report({ ...h.consumer, jobId: accepted.jobId, generation: 1, blocker: 'PROVIDER_CONTROL_DENIED' });
    assert.equal(blocked.state, 'blocked'); assert.equal(blocked.blocker, 'PROVIDER_CONTROL_DENIED');
    assert.equal(blocked.factId, null); assert.equal(blocked.attemptId, null);
    assert.equal((await h.service.poll(h.consumer)).jobs.length, 0);
    assert.equal(h.snapshot.factId, null); assert.equal(h.snapshot.attemptId, null);
});

test('VK016-11: realistic repository invalidation blocks transport without losing heartbeat or status visibility', async () => {
    const h = harness(); const job = await h.service.dispatch(h.request); h.invalidate();
    const poll = await h.service.poll(h.consumer); assert.equal(poll.jobs.length, 0); assert.equal(poll.health.status, 'online');
    const status = await h.service.status({ ...h.identity, jobId: job.jobId });
    assert.equal(status.state, 'blocked'); assert.equal(status.blocker, 'PACKAGE_NOT_READY'); assert.equal(status.publicUrl, null);
});

test('VK016-12: acknowledged job remains resumable by the same healthy consumer after report response loss', async () => {
    const h = harness(); await h.service.dispatch(h.request); const [queued] = (await h.service.poll(h.consumer)).jobs;
    const ack = await h.service.ack({ ...h.consumer, ...queued });
    const [resume] = (await h.service.poll(h.consumer)).jobs;
    assert.ok(resume); assert.equal(resume.state, 'accepted'); assert.equal(resume.generation, ack.generation);
    const report = await h.service.report({ ...h.consumer, ...resume, blocker: 'PROVIDER_CONTROL_DENIED' });
    assert.equal(report.state, 'blocked'); assert.equal(report.generation, ack.generation);
    assert.equal(h.snapshot.attemptId, null); assert.equal(h.jobs.size, 1);
});

test('VK016-02: repeated and concurrent commands retain one durable job and never pretend it was accepted', async () => {
    const h = harness(); const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
        h.service.dispatch({ ...h.request, idempotencyKey: i % 2 ? 'second-key' : h.request.idempotencyKey })));
    assert.equal(new Set(results.map(r => r.jobId)).size, 1); assert.equal(h.jobs.size, 1);
    assert.ok(results.every(r => r.state === 'queued' && r.receiptAt === null));
});

test('VK016-03: inactive consumer reports offline; heartbeat proves only infrastructure', async () => {
    const h = harness(); const args = { ...h.identity, hostId: VK_CONNECTOR_HOST };
    assert.equal((await h.service.health(args)).status, 'offline');
    await h.service.poll(h.consumer); const online = await h.service.health(args);
    assert.equal(online.status, 'online'); assert.equal(online.providerExecution, 'blocked');
    h.advance(30_001); assert.equal((await h.service.health(args)).status, 'offline');
});

test('VK016-04: disabled dispatch, wrong actor/project/task or stale package perform no queue writes', async () => {
    const disabled = harness(false); await assert.rejects(disabled.service.dispatch(disabled.request), /DISABLED/);
    assert.equal(disabled.jobs.size, 0);
    const h = harness();
    for (const patch of [{ actorId: 'user:8' }, { projectId: 7 }, { taskId: 1084 }, { expectedPackageSha256: 'd'.repeat(64) }]) {
        await assert.rejects(h.service.dispatch({ ...h.request, ...patch }));
    }
    assert.equal(h.jobs.size, 0); assert.equal(h.events.length, 0);
});

test('VK016-05: revision or owner release changed after queueing blocks acknowledgement', async () => {
    const h = harness(); await h.service.dispatch(h.request);
    const [job] = (await h.service.poll(h.consumer)).jobs;
    h.snapshot.package.releaseSha256 = 'd'.repeat(64);
    await assert.rejects(h.service.ack({ ...h.consumer, ...job }), /PACKAGE_CHANGED/);
    assert.equal([...h.jobs.values()][0].receiptAt, null);
});

test('VK016-06: second process cannot replace a healthy host or acknowledge the same job', async () => {
    const h = harness(); await h.service.dispatch(h.request);
    const [job] = (await h.service.poll(h.consumer)).jobs;
    await h.service.ack({ ...h.consumer, ...job });
    const other = { ...h.consumer, instanceId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' };
    await assert.rejects(h.service.poll(other), /HOST_BUSY/);
    await assert.rejects(h.service.ack({ ...other, ...job }), /FENCED|CONFLICT/);
    assert.equal([...h.jobs.values()][0].instanceId, h.consumer.instanceId);
});

test('VK016-07: pre-provider restart changes generation and rejects stale completion without changing task lease', async () => {
    const h = harness(); await h.service.dispatch(h.request);
    const [job] = (await h.service.poll(h.consumer)).jobs;
    const accepted = await h.service.ack({ ...h.consumer, ...job }); h.advance(31_000);
    const replacement = { ...h.consumer, instanceId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' };
    const [recovered] = (await h.service.poll(replacement)).jobs; assert.ok(recovered);
    assert.ok(recovered.generation > accepted.generation);
    await assert.rejects(h.service.report({ ...h.consumer, jobId: job.jobId, generation: accepted.generation,
        blocker: 'PROVIDER_CONTROL_DENIED' }), /FENCED|CONFLICT/);
    const receipt = await h.service.ack({ ...replacement, ...recovered }); assert.equal(receipt.state, 'accepted');
    assert.equal(h.snapshot.workItemId, 1699); assert.equal(h.snapshot.attemptId, null);
});

test('VK016-08: started or uncertain provider attempt prevents dispatch and restart never requeues it', async () => {
    const fresh = harness(); fresh.snapshot.attemptId = 28; fresh.snapshot.attemptStatus = 'pending';
    await assert.rejects(fresh.service.dispatch(fresh.request), /VERIFICATION_REQUIRED/); assert.equal(fresh.jobs.size, 0);
    const h = harness(); await h.service.dispatch(h.request); const [job] = (await h.service.poll(h.consumer)).jobs;
    await h.service.ack({ ...h.consumer, ...job }); h.snapshot.attemptId = 28; h.snapshot.attemptStatus = 'pending'; h.advance(31_000);
    const poll = await h.service.poll({ ...h.consumer, instanceId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' });
    assert.equal(poll.jobs.length, 0); assert.equal([...h.jobs.values()][0].state, 'verification_required');
    assert.equal([...h.jobs.values()][0].attemptId, 28);
});

test('VK016-09: reconciliation with unavailable provider reports UNKNOWN and cannot create fact/checkpoints or permit retry', async () => {
    const h = harness(); const job = await h.service.dispatch(h.request);
    const result = await h.service.reconcile({ ...h.identity, jobId: job.jobId });
    assert.equal(result.blocker, 'PROVIDER_CONTROL_DENIED'); assert.equal(result.factId, null);
    assert.equal(result.publicUrl, null); assert.equal(h.snapshot.factId, null);
    assert.equal((await h.service.status({ ...h.identity, jobId: job.jobId })).state, 'queued');
});

test('VK016-10: canonical confirmed fact is returned on replay, without creating a new attempt or fact', async () => {
    const h = harness(); const job = await h.service.dispatch(h.request);
    h.snapshot.factId = 901; h.snapshot.publicUrl = 'https://vk.com/wall-240051152_31';
    h.snapshot.attemptId = 77; h.snapshot.attemptStatus = 'delivered';
    const a = await h.service.reconcile({ ...h.identity, jobId: job.jobId });
    const b = await h.service.reconcile({ ...h.identity, jobId: job.jobId });
    assert.equal(a.state, 'confirmed'); assert.equal(a.factId, 901); assert.equal(b.factId, 901);
    assert.equal(a.publicUrl, h.snapshot.publicUrl); assert.equal(h.jobs.size, 1);
    assert.equal(h.snapshot.attemptId, 77);
});

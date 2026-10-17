const test = require('node:test'), assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const { db, pool, deps, getXNativeState, setup, install, fingerprint, sha } = require('./x-native-state-read.fixture.cjs');
test.after(async () => { await db.$disconnect(); await pool.end(); });

test('READ-11:100 reads at1 RPS, concurrency2 ceiling, limit-size real-PG state, no pool or write leak', { timeout: 125000 }, async t => {
    const s = await setup(t), records = [];
    for (let n = 0; n < 20; n++) records.push(await install(s, { uatReference: 'x'.repeat(500) }));
    for (const item of records) {
        await db.workflowEvent.createMany({ data: Array.from({ length: 3 }, (_, index) => ({ project_id: s.project.id,
            actor_id: `user:${2147483640 + index}`, command: 'x_native_register_installation',
            idempotency_key: `${s.channel.id}:${item.record.installationId}`,
            after_state: { registration_sha256: sha(JSON.stringify(item.record)) } })) });
    }
    const args = { ...s.args, candidateInstallationId: records[0].record.installationId }, before = await fingerprint(s);
    const durations = [], requests = [], pending = new Set(), start = performance.now(); let maximumInFlight = 0;
    for (let index = 0; index < 100; index++) {
        await delay(Math.max(0, start + index * 1000 - performance.now()));
        if (pending.size === 2) await Promise.race(pending);
        const request = (async () => {
            const began = performance.now(), result = await getXNativeState(args, deps);
            durations.push(performance.now() - began);
            assert.equal(result.complete, true); assert.equal(result.installations.totalCount, 20);
            assert.equal(result.installations.candidateState, 'active'); assert.equal(result.installations.otherActivePresent, true);
        })();
        requests.push(request); pending.add(request); maximumInFlight = Math.max(maximumInFlight, pending.size);
        void request.then(() => pending.delete(request), () => pending.delete(request));
    }
    await Promise.all(requests);
    const sorted = durations.toSorted((a, b) => a - b), p95 = sorted[94], p99 = sorted[98];
    assert.equal(durations.length, 100); assert.ok(maximumInFlight <= 2);
    assert.ok(p95 <= 750, `p95=${p95}`); assert.ok(p99 <= 1500, `p99=${p99}`);
    assert.equal(await fingerprint(s), before);
    assert.equal(pool.waitingCount, 0); assert.equal(pool.idleCount, pool.totalCount);
    t.diagnostic(JSON.stringify({ requests: durations.length, ratePerSecond: 1, maximumInFlight,
        p95Ms: Number(p95.toFixed(2)), p99Ms: Number(p99.toFixed(2)), elapsedMs: Math.round(performance.now() - start),
        pool: { waiting: pool.waitingCount, idle: pool.idleCount, total: pool.totalCount }, writes: 0 }));
});

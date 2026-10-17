import test from 'node:test';
import assert from 'node:assert/strict';
import { createController, parseInput, publicView } from '../../extensions/x-native/pilot-ui-controller.mjs';
const packageData = { projectId: 301, taskId: 401, channelId: 501, revision: 2,
    bodySha256: 'a'.repeat(64), account: '@fixture_301', profileUrl: 'https://x.com/fixture_301',
    scheduleAt: '2026-10-17T10:00:00.000Z' };
const input = { packageText: JSON.stringify(packageData), nonce: 'b'.repeat(64), text: '' };

test('startup is inert; exact fresh readiness and deliberate consent precede a single run', async () => {
    let time = 1000; const sent = [];
    const c = createController({ now: () => time, send: async message => {
        sent.push(message);
        return message.operation === 'readiness'
            ? { ready: true, task_id: 401, expires_at: new Date(time + 60000).toISOString(), submission_permitted: false }
            : { mode: 'unknown', submission_permitted: false };
    } });
    assert.equal(sent.length, 0); assert.equal(c.view().canRun, false);
    c.edit(input); c.consent(true);
    await c.perform('run'); assert.equal(sent.length, 0);
    await c.perform('readiness'); assert.equal(c.view().canRun, false);
    c.consent(true); assert.equal(c.view().canRun, true);
    time += 30001; assert.equal(c.view().canRun, false);
    await c.perform('readiness'); c.consent(true);
    await Promise.all([c.perform('run'), c.perform('run')]);
    assert.equal(sent.filter(m => m.operation === 'run').length, 1);
    c.edit(input); await c.perform('readiness'); c.consent(true);
    assert.equal(c.view().canRun, false, 'editing cannot reset an invoked package');
});

test('input changes invalidate permission; no-send/reconciliation cannot become run', async () => {
    const sent = []; const c = createController({ send: async message => {
        sent.push(message); return { no_send: true, publication_authorized: false };
    } });
    c.edit({ ...input, nonce: '', text: 'Fixture accepted text' });
    await c.perform('uat'); await c.perform('reconcile');
    assert.deepEqual(sent.map(m => m.operation), ['uat', 'reconcile']);
    c.edit({ ...input, nonce: 'c'.repeat(64) }); assert.equal(c.view().canRun, false);
    assert.throws(() => parseInput({ ...input, packageText: JSON.stringify({ ...packageData, token: 'secret' }) }), /LOCAL_PACKAGE_INVALID/);
    assert.throws(() => parseInput({ ...input, nonce: 'secret' }), /LOCAL_NONCE_INVALID/);
});

test('public rendering never reflects lease/context/secrets or foreign status URLs', async () => {
    const output = publicView({ mode: 'published', public_url: 'https://x.com/foreign/status/123',
        lease: 'secret', context: { token: 'secret' }, publicKey: { d: 'secret' } }, packageData);
    assert.equal(output.url, undefined); assert.doesNotMatch(JSON.stringify(output), /secret|foreign/);
    const c = createController({ send: async () => { throw Error('token=secret'); } });
    c.edit(input); await c.perform('readiness');
    assert.doesNotMatch(JSON.stringify(c.view()), /token|secret/);
    assert.equal(c.view().canRun, false);
});

test('a late readiness response cannot authorize an edited package', async () => {
    let resolve; const c = createController({ send: () => new Promise(done => { resolve = done; }) });
    c.edit(input); const checking = c.perform('readiness');
    c.edit({ ...input, packageText: JSON.stringify({ ...packageData, bodySha256: 'c'.repeat(64) }) });
    resolve({ ready: true, task_id: 401, expires_at: new Date(Date.now() + 30000).toISOString(), submission_permitted: false });
    await checking; c.consent(true);
    assert.equal(c.view().canRun, false);
    assert.equal(c.view().result.status, 'NOT_CHECKED');
});

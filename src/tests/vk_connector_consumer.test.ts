import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { mock, type TestContext } from 'node:test';
import { z } from 'zod';
import { acquireVkConnectorLock, consumeVkConnectorOnce, loadVkConnectorConfig, readVkConnectorToken,
    vkConnectorPackageSha256, type VkConnectorControl } from '../services/vk_connector_consumer_runtime';
import { parseVkConnectorToolResponse, runVkConnectorConsumer } from '../workers/vk_connector_consumer';
const identity = { projectId: 10, actorId: 'user:0', hostId: 'vk-connector-local-1048', instanceId: '00000000-0000-4000-8000-000000000001', buildVersion: 'fixture' };
const health = { hostId: 'vk-connector-local-1048', mode: 'infrastructure_only', providerExecution: 'blocked', status: 'online', heartbeatAt: '2026-10-12T12:00:00Z' };
const pilot = { projectId: 10, taskId: 1048, channelId: 117, communityId: -240051152, revision: 1, selectedAssetId: 130,
    placement: 'feed', bodySha256: 'a'.repeat(64), assetSha256: 'b'.repeat(64), releaseSha256: 'c'.repeat(64) };
const job = { jobId: '00000000-0000-4000-8000-000000000002', generation: 0, packageSha256: vkConnectorPackageSha256(pilot), package: pilot };
function fixtureControl(jobs: unknown[] = [job]) {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const control: VkConnectorControl = { close: async () => {}, call: async (name, args) => {
        calls.push({ name, args });
        if (name === 'ba_poll_vk_connector_jobs') return { jobs, health };
        if (name === 'ba_ack_vk_connector_job') return { jobId: job.jobId, generation: 1, state: 'accepted' };
        if (name === 'ba_report_vk_connector_job') return { jobId: job.jobId, generation: 1, state: 'blocked', blocker: 'PROVIDER_CONTROL_DENIED' };
        throw new Error('Unexpected operation');
    } };
    return { control, calls };
}
function localConfig(t: TestContext) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-consumer-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const config = { projectId: 10 as const, hostId: 'vk-connector-local-1048' as const,
        endpoint: 'https://planner-mcp-production.up.railway.app/mcp/publisher' as const,
        tokenFile: path.join(root, 'synthetic-token'), runtimeDir: path.join(root, 'runtime'),
        mode: 'infrastructure_only' as const, buildVersion: 'fixture' };
    fs.writeFileSync(config.tokenFile, 'synthetic-test-credential', { mode: 0o600 });
    const file = path.join(root, 'config.json'); fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
    return { root, config, file };
}
test('CONSUMER-001 empty authenticated poll reports genuine infrastructure health without provider execution', async () => {
    const f = fixtureControl([]);
    const output = await consumeVkConnectorOnce(identity, f.control);
    assert.equal(output.status, 'idle_provider_blocked');
    assert.equal(output.providerExecution, 'blocked');
    assert.equal(output.heartbeatAt, health.heartbeatAt);
    assert.equal(f.calls.length, 1);
});
test('CONSUMER-002 valid pilot receipt ends blocked rather than publication success', async () => {
    const f = fixtureControl();
    const output = await consumeVkConnectorOnce(identity, f.control);
    assert.equal(output.status, 'receipt_provider_blocked');
    assert.deepEqual(output.receipts, [{ jobId: job.jobId, generation: 1, state: 'blocked' }]);
    assert.deepEqual(f.calls.map((call) => call.name), ['ba_poll_vk_connector_jobs', 'ba_ack_vk_connector_job', 'ba_report_vk_connector_job']);
    assert.equal(f.calls[1].args.generation, 0);
    assert.equal(f.calls[2].args.generation, 1);
    assert.equal(f.calls[2].args.blocker, 'PROVIDER_CONTROL_DENIED');
    assert.equal('publicationFactId' in output, false);
});
test('CONSUMER-003 changed pilot/hash/revision/tenant has no consumer acknowledgement', async () => {
    for (const mutation of [{ taskId: 1084 }, { channelId: 120 }, { communityId: -1 }, { revision: 2 }, { selectedAssetId: 131 }, { placement: 'clip' }, { bodySha256: 'invalid' }]) {
        const f = fixtureControl([{ ...job, package: { ...pilot, ...mutation } }]);
        assert.equal((await consumeVkConnectorOnce(identity, f.control)).status, 'invalid_response');
        assert.equal(f.calls.length, 1);
    }
    const f = fixtureControl([{ ...job, packageSha256: 'd'.repeat(64) }]);
    assert.equal((await consumeVkConnectorOnce(identity, f.control)).status, 'invalid_response');
    assert.equal(f.calls.length, 1);
    await assert.rejects(consumeVkConnectorOnce({ ...identity, projectId: 7 }, fixtureControl().control));
});
test('CONSUMER-004 stale generation cannot report or publish', async () => {
    const f = fixtureControl();
    const original = f.control.call;
    f.control.call = async (name, args) => name === 'ba_ack_vk_connector_job'
        ? { jobId: job.jobId, generation: 0, state: 'accepted' } : original(name, args);
    const output = await consumeVkConnectorOnce(identity, f.control);
    assert.equal(output.status, 'stale_generation');
    assert.deepEqual(output.receipts, []);
    assert.equal(f.calls.some((call) => call.name === 'ba_report_vk_connector_job'), false);
});
test('CONSUMER-005 provider/auth errors remain sanitized and no receipt is fabricated', async () => {
    const control: VkConnectorControl = { close: async () => {}, call: async () => { throw new Error('Authorization=SECRET COOKIE=PRIVATE'); } };
    const output = await consumeVkConnectorOnce(identity, control);
    assert.equal(output.status, 'auth_or_control_unavailable');
    assert.equal(JSON.stringify(output).includes('SECRET'), false);
    assert.deepEqual(output.receipts, []);
    assert.throws(() => parseVkConnectorToolResponse({ isError: true, content: [{ type: 'text', text: 'SECRET' }] }), /MCP_CALL_REJECTED/);
});
test('CONSUMER-006 owner-only config rejects wrong permissions, host, project and symlinks', (t) => {
    const f = localConfig(t);
    assert.equal(loadVkConnectorConfig(f.file).projectId, 10);
    fs.chmodSync(f.file, 0o644); assert.throws(() => loadVkConnectorConfig(f.file)); fs.chmodSync(f.file, 0o600);
    for (const mutation of [{ projectId: 7 }, { hostId: 'different' }, { mode: 'live' }, { endpoint: 'https://evil.example/mcp' }, { profileDir: '/private/profile' }]) {
        fs.writeFileSync(f.file, JSON.stringify({ ...f.config, ...mutation })); assert.throws(() => loadVkConnectorConfig(f.file));
    }
    const link = path.join(f.root, 'linked.json'); fs.symlinkSync(f.file, link); assert.throws(() => loadVkConnectorConfig(link));
});
test('CONSUMER-007 missing/unsafe credential cannot create a network client', async (t) => {
    const f = localConfig(t);
    fs.unlinkSync(f.config.tokenFile);
    let connected = 0;
    await assert.rejects(runVkConnectorConsumer(f.file, new AbortController().signal, async () => {
        connected += 1; return fixtureControl().control;
    }), /AUTH_UNAVAILABLE/);
    assert.equal(connected, 0);
    fs.writeFileSync(f.config.tokenFile, 'synthetic-test-token', { mode: 0o644 });
    assert.throws(() => readVkConnectorToken(f.config), /AUTH_UNAVAILABLE/);
});
test('CONSUMER-008 double consumer excluded; graceful restart has a new instance fence', (t) => {
    const f = localConfig(t);
    const first = acquireVkConnectorLock(f.config);
    assert.equal(fs.statSync(f.config.runtimeDir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(f.config.runtimeDir, 'consumer.lock')).mode & 0o777, 0o600);
    assert.throws(() => acquireVkConnectorLock(f.config), /ALREADY_RUNNING_OR_STALE_LOCK/);
    first.release(); first.release();
    const restarted = acquireVkConnectorLock(f.config);
    assert.notEqual(restarted.instanceId, first.instanceId); restarted.release();
});
test('CONSUMER-009 graceful shutdown closes control, releases lock and writes honest private receipt', async (t) => {
    const f = localConfig(t);
    const abort = new AbortController();
    const provider = fixtureControl(); let closed = 0;
    const original = provider.control.call;
    provider.control.call = async (name, args) => {
        const result = await original(name, args);
        if (name === 'ba_report_vk_connector_job') abort.abort();
        return result;
    };
    provider.control.close = async () => { closed += 1; };
    await runVkConnectorConsumer(f.file, abort.signal, async () => provider.control);
    assert.equal(closed, 1);
    assert.equal(fs.existsSync(path.join(f.config.runtimeDir, 'consumer.lock')), false);
    const file = fs.readdirSync(f.config.runtimeDir).find((name) => name.startsWith('health-'));
    assert.ok(file);
    assert.equal(fs.statSync(path.join(f.config.runtimeDir, file)).mode & 0o777, 0o600);
    const output = fs.readFileSync(path.join(f.config.runtimeDir, file), 'utf8');
    const snapshot = z.object({ receipts: z.array(z.object({ jobId: z.string().uuid(), generation: z.number().int(),
        state: z.enum(['accepted', 'blocked']) })) }).parse(JSON.parse(output));
    assert.equal(snapshot.receipts.length, 1);
    assert.equal(snapshot.receipts[0].jobId, job.jobId);
    assert.equal(snapshot.receipts[0].generation, 1);
    assert.ok(['accepted', 'blocked'].includes(snapshot.receipts[0].state));
    assert.equal(output.includes('confirmed'), false);
    assert.equal(output.includes('synthetic-test-credential'), false);
});
test('CONSUMER-010 executable imports no browser/provider worker and never asks for publication tools', () => {
    const code = fs.readFileSync(path.join(process.cwd(), 'src/workers/vk_connector_consumer.ts'), 'utf8');
    assert.equal(/playwright|vk_browser_worker|launchPersistentContext|profileDir/.test(code), false);
    const runtime = fs.readFileSync(path.join(process.cwd(), 'src/services/vk_connector_consumer_runtime.ts'), 'utf8');
    assert.equal(/ba_start_vk_browser_submission|ba_confirm_vk_browser_submission|ba_claim_vk_browser_publication/.test(runtime), false);
});
test('CONSUMER-011 server status extras are stripped; disabled host is never online-ready', async () => {
    const f = fixtureControl(); const original = f.control.call;
    f.control.call = async (name, args) => {
        const output = await original(name, args);
        return name === 'ba_poll_vk_connector_jobs' ? output : { ...(typeof output === 'object' && output !== null ? output : {}),
            factId: null, attemptId: null, publicUrl: null, packageSha256: job.packageSha256, receiptAt: health.heartbeatAt };
    };
    assert.equal((await consumeVkConnectorOnce(identity, f.control)).status, 'receipt_provider_blocked');
    f.control.call = async () => ({ jobs: [], health: { ...health, status: 'disabled', heartbeatAt: null } });
    const disabled = await consumeVkConnectorOnce(identity, f.control);
    assert.equal(disabled.status, 'auth_or_control_unavailable');
    assert.equal(disabled.heartbeatAt, null);
});
test('CONSUMER-012 stale/crash lock is preserved for operator review without automatic unlink', (t) => {
    const f = localConfig(t);
    fs.mkdirSync(f.config.runtimeDir, { mode: 0o700 });
    const lock = path.join(f.config.runtimeDir, 'consumer.lock');
    const record = JSON.stringify({ pid: 999999999, instanceId: identity.instanceId, mode: 'infrastructure_only' });
    fs.writeFileSync(lock, record, { mode: 0o600 });
    assert.throws(() => acquireVkConnectorLock(f.config), /ALREADY_RUNNING_OR_STALE_LOCK/);
    assert.equal(fs.readFileSync(lock, 'utf8'), record);
});
test('CONSUMER-013 abort/timeout bounds a hung control call and late acknowledgement cannot chain report', async () => {
    const f = fixtureControl(); const original = f.control.call;
    let acknowledge: ((value: unknown) => void) | undefined;
    f.control.call = async (name, args) => name === 'ba_ack_vk_connector_job'
        ? new Promise((resolve) => { acknowledge = resolve; }) : original(name, args);
    const result = await consumeVkConnectorOnce(identity, f.control, undefined, 10);
    assert.equal(result.status, 'auth_or_control_unavailable');
    acknowledge?.({ jobId: job.jobId, generation: 1, state: 'accepted' });
    await Promise.resolve();
    assert.equal(f.calls.some((call) => call.name === 'ba_report_vk_connector_job'), false);
    const abort = new AbortController(); abort.abort();
    const stopped = fixtureControl();
    assert.equal((await consumeVkConnectorOnce(identity, stopped.control, abort.signal)).status, 'auth_or_control_unavailable');
    assert.equal(stopped.calls.length, 0);
});
test('CONSUMER-014 report loss resumes owned accepted job without repeating ACK or creating publication', async () => {
    let accepted = false; let reports = 0; let acknowledgements = 0;
    const control: VkConnectorControl = { close: async () => {}, call: async (name) => {
        if (name === 'ba_poll_vk_connector_jobs') return { jobs: [{ ...job, state: accepted ? 'accepted' : 'queued', generation: accepted ? 1 : 0 }], health };
        if (name === 'ba_ack_vk_connector_job') { accepted = true; acknowledgements += 1; return { jobId: job.jobId, generation: 1, state: 'accepted' }; }
        reports += 1;
        if (reports === 1) throw new Error('Lost report response');
        return { jobId: job.jobId, generation: 1, state: 'blocked', blocker: 'PROVIDER_CONTROL_DENIED' };
    } };
    const first = await consumeVkConnectorOnce(identity, control);
    assert.equal(first.status, 'auth_or_control_unavailable');
    assert.deepEqual(first.receipts, [{ jobId: job.jobId, generation: 1, state: 'accepted' }]);
    const resumed = await consumeVkConnectorOnce(identity, control);
    assert.equal(resumed.status, 'receipt_provider_blocked');
    assert.equal(acknowledgements, 1);
    assert.equal(reports, 2);
    assert.equal('publicationFactId' in resumed, false);
});
test('CONSUMER-015 lock initialization failure closes descriptor and preserves fail-closed stale lock', (t) => {
    const f = localConfig(t); const closed: number[] = [];
    const originalClose = fs.closeSync;
    const write = mock.method(fs, 'writeFileSync', () => { throw new Error('Synthetic private-path disk error'); });
    const close = mock.method(fs, 'closeSync', (fd: number) => { closed.push(fd); originalClose(fd); });
    try {
        assert.throws(() => acquireVkConnectorLock(f.config), /LOCK_INITIALIZATION_FAILED/);
        assert.equal(closed.length, 1);
        assert.equal(fs.existsSync(path.join(f.config.runtimeDir, 'consumer.lock')), true);
    } finally { write.mock.restore(); close.mock.restore(); }
});

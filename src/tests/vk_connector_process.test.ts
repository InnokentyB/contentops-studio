import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { harness } from './helpers/vk_connector_harness';
import { AUTHENTICATED_REMOTE_ACTOR } from '../services/vk_connector_consumer_runtime';

const request = z.object({ id: z.number().int(), name: z.string(), args: z.object({ projectId: z.literal(10),
    actorId: z.literal(AUTHENTICATED_REMOTE_ACTOR), hostId: z.literal('vk-connector-local-1048'), instanceId: z.uuid(),
    buildVersion: z.string(), jobId: z.uuid().optional(), generation: z.number().int().optional(),
    packageSha256: z.string().optional(), blocker: z.literal('PROVIDER_CONTROL_DENIED').optional() }) });
test('VK016-PROCESS: real standalone process receives explicit Planner job and persists an honest provider-blocked receipt', async () => {
    const h = harness(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vk016-infra-'));
    fs.chmodSync(dir, 0o700); const token = path.join(dir, 'token'), config = path.join(dir, 'config.json');
    fs.writeFileSync(token, 'mcp_offline_deterministic_fixture_only', { mode: 0o600 });
    fs.writeFileSync(config, JSON.stringify({ projectId: 10, hostId: 'vk-connector-local-1048',
        endpoint: 'https://planner-mcp-production.up.railway.app/mcp/publisher', tokenFile: token,
        runtimeDir: dir, mode: 'infrastructure_only', buildVersion: 'deterministic-ipc-016' }), { mode: 0o600 });
    const queued = await h.service.dispatch(h.request); assert.equal(queued.receiptAt, null);
    const driver = `const {runVkConnectorConsumer}=require(${JSON.stringify(path.resolve(__dirname, '../workers/vk_connector_consumer.js'))});
const abort=new AbortController(), pending=new Map();let n=0;
process.on('message',m=>{const p=pending.get(m.id);if(!p)return;pending.delete(m.id);if(m.error)p.reject(new Error('CONTROL_REJECTED'));else p.resolve(m.result);if(p.report)setImmediate(()=>abort.abort());});
const connector=async()=>({call:(name,args)=>new Promise((resolve,reject)=>{const id=++n;pending.set(id,{resolve,reject,report:name==='ba_report_vk_connector_job'});process.send({id,name,args});}),close:async()=>{}});
runVkConnectorConsumer(process.argv[1],abort.signal,connector).then(()=>process.disconnect()).catch(()=>{process.exitCode=1;process.disconnect();});`;
    const child = spawn(process.execPath, ['-e', driver, config], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const calls: string[] = []; let controlFailure = false;
    child.on('message', (raw: unknown) => {
        void (async () => {
            const m = request.parse(raw); calls.push(m.name); const a = { ...m.args, actorId: 'user:2' };
            let result;
            if (m.name === 'ba_poll_vk_connector_jobs') result = await h.service.poll(a);
            else if (m.name === 'ba_ack_vk_connector_job' && a.jobId && a.packageSha256 && a.generation !== undefined)
                result = await h.service.ack({ ...a, jobId: a.jobId, generation: a.generation, packageSha256: a.packageSha256 });
            else if (m.name === 'ba_report_vk_connector_job' && a.jobId && a.generation !== undefined)
                result = await h.service.report({ ...a, jobId: a.jobId, generation: a.generation, blocker: 'PROVIDER_CONTROL_DENIED' });
            else throw new Error('UNEXPECTED_CONTROL_CALL');
            child.send({ id: m.id, result });
        })().catch(() => { controlFailure = true; child.kill('SIGTERM'); });
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    try {
        const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
        assert.equal(code, 0); assert.equal(controlFailure, false);
        assert.deepEqual(calls, ['ba_poll_vk_connector_jobs', 'ba_ack_vk_connector_job', 'ba_report_vk_connector_job']);
        const status = await h.service.status({ ...h.identity, jobId: queued.jobId });
        assert.equal(status.state, 'blocked'); assert.equal(status.blocker, 'PROVIDER_CONTROL_DENIED');
        assert.ok(status.receiptAt); assert.equal(status.factId, null); assert.equal(status.attemptId, null);
        assert.equal(fs.existsSync(path.join(dir, 'consumer.lock')), false);
        assert.equal(h.snapshot.workItemId, 1699); assert.equal(h.snapshot.attemptId, null);
        const healthFile = fs.readdirSync(dir).find(f => f.startsWith('health-')); assert.ok(healthFile);
        const health = JSON.parse(fs.readFileSync(path.join(dir, healthFile), 'utf8')) as { status: string };
        assert.equal(health.status, 'receipt_provider_blocked');
    } finally { clearTimeout(timer); if (child.exitCode === null) child.kill('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }); }
});

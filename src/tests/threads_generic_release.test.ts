import assert from 'node:assert/strict';
import test from 'node:test';
import {withPublicationPrincipal} from '../mcp/publication-principal';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import genericThreadsReleaseService from '../services/threads_generic_release.service';
import { registerTaskPublicationTools } from '../mcp/tools/task_publication_tools';
import { threadsDiagnosticResult } from '../mcp/tools/threads_diagnostic_result';
import { GenericThreadsReleaseService, type GenericThreadsReleaseArgs } from '../services/threads_generic_release.service';

const body = 'A generic, accepted Threads post that is not bound to a task constant.';
const bodySha256 = '2311ed6993a8a022ffb3bac046373ae3efe6684c1518f5e727e24c2e857fc837';
const manifestChecksum = 'sha256:cc2cc620612463792340ae39c2a815f61d603edad17cd01e49cff6f369a50dc7';

function fixture(publishFails = false) {
    const task: any = { id: 4242, project_id: 10, channel_id: 138, content_revision: 3, accepted_revision: 3,
        draft_text: body, text_state: 'accepted', visual_state: 'NO_VISUAL_NEEDED', visual_placement: 'feed',
        visual_mode: 'auto_assess', visual_decision_version: 2, selected_asset_id: null, selected_asset: null,
        handoff_state: 'ready', publication_mode: 'approval_required', status: 'ready_for_execution',
        schedule_at: new Date('2026-10-15T16:30:00.000Z'), publish_at: new Date('2026-10-15T16:30:00.000Z'),
        publication_fact: null, published_link: null, quality_report: {}, updated_at: new Date('2026-10-15T15:00:00.000Z'),
        channel: { id: 138, type: 'threads', name: 'innokenty_threads', is_active: true, config: {
            access_token: 'secret', threads_user_id: '39421253764155091', channel_username: 'innokentybo' } } };
    const events: any[] = []; const attempts: any[] = []; let providerCalls = 0; let preflightCalls = 0;
    const tx: any = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        contentItem: { findFirst: async () => task, updateMany: async ({ where, data }: any) => {
            if (task.status !== where.status || task.publication_mode !== where.publication_mode) return { count: 0 };
            Object.assign(task, data); return { count: 1 };
        } },
        artDirectionDecision: { findFirst: async () => ({ id: 900, decision: 'NO_VISUAL_NEEDED', channel: 'threads',
            placement: 'feed', source_content_revision: 3, decision_version: 2, status: 'active' }) },
        workItem: { findFirst: async ({ where }: any) => where.kind === 'browser_publish' ? null : ({ id: 1 }) },
        deliveryAttempt: { findFirst: async () => attempts[0] || null,
            create: async ({ data }: any) => { const row = { id: 77, ...data }; attempts.push(row); return row; },
            updateMany: async ({ where, data }: any) => { const row = attempts.find(x => x.id === where.id && x.status === where.status);
                if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 }; } },
        workflowEvent: { findFirst: async ({ where }: any) => events.find(e => Object.entries(where).every(([k, v]) =>
            v === undefined || e[k] === v)) || null, create: async ({ data }: any) => { const row = { id: events.length + 1, ...data }; events.push(row); return row; } }
    };
    const db: any = { ...tx, $transaction: async (fn: any) => fn(tx) };
    const service = new GenericThreadsReleaseService({ db, manifest: async () => ({ project: { id: 10, slug: 'analystcraft-2' },
        checksum: manifestChecksum }) as any, now: () => Date.parse('2026-10-15T17:00:00.000Z'),
        threads: { testConnection: async () => { preflightCalls += 1;
            return { success: true, details: { id: '39421253764155091', username: 'innokentybo' } }; },
            getOwnPosts: async () => ({ items: [], after: null }), publishVerifiedText: async () => {
                providerCalls += 1; if (publishFails) throw new Error('secret provider error');
                return { id: '987654321', url: 'https://www.threads.com/@innokentybo/post/generic', publishedAt: '2026-10-15T17:00:01.000Z' };
            } } as any,
        facts: { record: async (args: any) => { await args.beforeWrite(tx); task.publication_fact = { outcome: 'published', public_url: args.publicUrl };
            return { id: 1 }; } } as any });
    const release: GenericThreadsReleaseArgs = { projectId: 10, taskId: 4242, actorId: 'user:2',
        approvalReference: 'owner approval fixture', expectedManifestChecksum: manifestChecksum,
        expectedAcceptedRevision: 3, expectedContentRevision: 3, expectedBodySha256: bodySha256,
        expectedChannelId: 138, expectedScheduleAt: '2026-10-15T16:30:00.000Z',
        expectedVisualState: 'NO_VISUAL_NEEDED', expectedSelectedAssetId: null, expectedPlacement: 'feed',
        expectedThreadsUserId: '39421253764155091', expectedUsername: 'innokentybo', idempotencyKey: 'release-generic-4242' };
    return { service, release, task, attempts, events, get providerCalls() { return providerCalls; },
        get preflightCalls() { return preflightCalls; } };
}

test('generic release accepts an arbitrary canonical task without sending and records an exact immutable proof', async () => {
    const f = fixture(); const proof = await f.service.release(f.release);
    assert.equal(proof.task_id, 4242); assert.equal(proof.body_sha256, bodySha256);
    assert.equal(f.task.publication_mode, 'owner_released'); assert.equal(f.providerCalls, 0);
    assert.equal(f.events.filter(e => e.command === 'ba_release_approved_threads_task').length, 1);
});

test('generic live send creates the attempt before provider dispatch and confirms provider readback once', async () => {
    const f = fixture(); await f.service.release(f.release);
    const result = await f.service.publish({ projectId: 10, taskId: 4242, actorId: 'user:2',
        approvalReference: f.release.approvalReference, expectedManifestChecksum: manifestChecksum,
        releaseIdempotencyKey: f.release.idempotencyKey, idempotencyKey: 'send-generic-4242' });
    assert.equal(result.public_url, 'https://www.threads.com/@innokentybo/post/generic');
    assert.equal(f.attempts[0].status, 'delivered'); assert.equal(f.providerCalls, 1);
    assert.ok(f.events.find(e => e.command === 'ba_publish_threads_task:claim'));
});

test('generic uncertain provider result freezes the attempt and blocks a second dispatch', async () => {
    const f = fixture(true); await f.service.release(f.release);
    const send = { projectId: 10, taskId: 4242, actorId: 'user:2', approvalReference: f.release.approvalReference,
        expectedManifestChecksum: manifestChecksum, releaseIdempotencyKey: f.release.idempotencyKey,
        idempotencyKey: 'send-generic-4242' };
    await assert.rejects(f.service.publish(send), /THREADS_PUBLICATION_UNCERTAIN/);
    await assert.rejects(f.service.publish(send), /THREADS_GENERIC_PACKAGE_GUARD_FAILED/);
    assert.equal(f.providerCalls, 1); assert.equal(f.attempts[0].requires_manual_confirmation, true);
});

function sendArgs(f: ReturnType<typeof fixture>) {
    return { projectId: f.release.projectId, taskId: f.release.taskId, actorId: f.release.actorId,
        approvalReference: f.release.approvalReference, expectedManifestChecksum: manifestChecksum,
        releaseIdempotencyKey: f.release.idempotencyKey, idempotencyKey: 'diagnostic-send', dryRun: true };
}

const mismatches = [
    ['publication_authorized', false, 'PUBLICATION_NOT_AUTHORIZED'],
    ['body_sha256', 'stale-body', 'BODY_SHA256_MISMATCH'],
    ['channel_id', -1, 'CHANNEL_ID_MISMATCH'],
    ['accepted_revision', -1, 'ACCEPTED_REVISION_MISMATCH'],
    ['manifest_checksum', 'stale-manifest', 'MANIFEST_CHECKSUM_MISMATCH'],
    ['actor_id', 'stale-actor', 'ACTOR_ID_MISMATCH'],
    ['approval_reference', 'private-old-approval', 'APPROVAL_REFERENCE_MISMATCH']
] as const;

async function blocked(f: ReturnType<typeof fixture>, expected: string[]) {
    const beforePreflight = f.preflightCalls;
    await assert.rejects(f.service.publish(sendArgs(f)), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /THREADS_GENERIC_OWNER_RELEASE_REQUIRED/);
        assert.ok('diagnostics' in error);
        const diagnostic = error.diagnostics as { reasons: { code: string; field: string; message: string; action: string }[];
            retry_allowed: boolean; message: string };
        assert.deepEqual(diagnostic.reasons.map(reason => reason.code), expected);
        assert.equal(diagnostic.retry_allowed, false);
        for (const reason of diagnostic.reasons) {
            assert.ok(reason.field); assert.ok(reason.message); assert.ok(reason.action);
        }
        const serialized = JSON.stringify(diagnostic);
        for (const secret of [body, bodySha256, manifestChecksum, f.release.approvalReference,
            'private-old-approval', 'secret', 'user:2', '4242']) assert.ok(!serialized.includes(secret));
        return true;
    });
    assert.equal(f.providerCalls, 0); assert.equal(f.attempts.length, 0);
    assert.equal(f.preflightCalls, beforePreflight);
}

for (const [field, value, code] of mismatches) {
    test(`release diagnostics identify ${field} without disclosing values`, async () => {
        const f = fixture(); await f.service.release(f.release);
        const event = f.events[0];
        const state: Record<string, unknown> = field === 'approval_reference' ? event.before_state : event.after_state;
        state[field] = value;
        await blocked(f, [code]);
    });
}

test('missing release produces one reason, without cascading missing-proof mismatches', async () => {
    const f = fixture(); await f.service.release(f.release); f.events.length = 0;
    await blocked(f, ['RELEASE_NOT_FOUND']);
});

test('release diagnostics collect all mismatches in stable order', async () => {
    const f = fixture(); await f.service.release(f.release);
    for (const [field, value] of mismatches) {
        const state: Record<string, unknown> = field === 'approval_reference' ? f.events[0].before_state : f.events[0].after_state;
        state[field] = value;
    }
    await blocked(f, mismatches.map(([, , code]) => code));
});

test('malformed release states fail closed with safe reasons for all available checks', async () => {
    const f = fixture(); await f.service.release(f.release);
    f.events[0].after_state = null; f.events[0].before_state = [];
    await blocked(f, mismatches.map(([, , code]) => code));
});

test('valid dry run preserves release and does not dispatch or claim', async () => {
    const f = fixture(); await f.service.release(f.release);
    const result = await f.service.publish(sendArgs(f));
    assert.equal(result.mode, 'dry_run'); assert.ok('published' in result); assert.equal(result.published, false);
    assert.equal(f.providerCalls, 0); assert.equal(f.attempts.length, 0); assert.equal(f.events.length, 1);
});

test('MCP serializes actionable release diagnostics and logs only safe diagnostic data', async t => {
    const f = fixture(); await f.service.release(f.release); f.events.length = 0;
    t.mock.method(genericThreadsReleaseService, 'publish', f.service.publish.bind(f.service));
    const warnings: unknown[][] = [];
    t.mock.method(console, 'warn', (...args: unknown[]) => { warnings.push(args); });
    const server = new McpServer({ name: 'threads-diagnostic-test', version: '1' });
    registerTaskPublicationTools(server);
    const client = new Client({ name: 'operator', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
        await server.connect(a); await client.connect(b);
        const response = await withPublicationPrincipal({userId:2,actorId:'user:2',profile:'owner',projectId:10},()=>client.callTool({ name: 'ba_publish_threads_task', arguments: sendArgs(f) }));
        assert.equal(response.isError, true);
        const textContent = response.content as { type: string; text?: string }[];
        const diagnostic = JSON.parse(textContent[0].text || '{}');
        assert.equal(diagnostic.code, 'THREADS_GENERIC_OWNER_RELEASE_REQUIRED');
        assert.equal(diagnostic.reasons[0].code, 'RELEASE_NOT_FOUND');
        assert.ok(diagnostic.reasons[0].action); assert.equal(diagnostic.retry_allowed, false);
        assert.deepEqual(response.structuredContent, diagnostic);
        assert.equal(warnings.length, 1);
        const output = JSON.stringify({ response, warnings });
        for (const secret of [body, bodySha256, manifestChecksum, f.release.approvalReference, 'secret', 'user:2', '4242']) {
            assert.ok(!output.includes(secret));
        }
        assert.equal(f.providerCalls, 0); assert.equal(f.attempts.length, 0);
    } finally { await client.close(); await server.close(); }
});

for (const [raw, expected] of [
    ['[THREADS_PROVIDER_IDENTITY_UNVERIFIED] private-provider-payload', 'THREADS_PROVIDER_IDENTITY_UNVERIFIED'],
    ['[THREADS_PUBLICATION_UNCERTAIN] private-provider-payload', 'THREADS_PUBLICATION_UNCERTAIN'],
    ['database error: private-provider-payload', 'THREADS_REQUEST_FAILED']
] as const) {
    test(`Threads boundary safely explains ${expected} without exposing raw errors`, async t => {
        const warnings: unknown[][] = [];
        t.mock.method(console, 'warn', (...args: unknown[]) => { warnings.push(args); });
        const response = await threadsDiagnosticResult(async () => { throw new Error(raw); });
        assert.equal(response.isError, true);
        const diagnostic = JSON.parse(response.content[0].text);
        assert.equal(diagnostic.code, expected);
        assert.equal(diagnostic.retry_allowed, false);
        assert.ok(diagnostic.reasons[0].action);
        if (expected === 'THREADS_PUBLICATION_UNCERTAIN') assert.match(diagnostic.reasons[0].action, /reconcil/i);
        assert.equal(warnings.length, 1);
        assert.ok(!JSON.stringify({ response, warnings }).includes('private-provider-payload'));
    });
}

for(const dryRun of [true,false])test(`future exact released package stays not due during ${dryRun?'preview':'live admission'}`,async()=>{
    const f=fixture(),future='2026-10-16T12:00:00.000Z';
    f.task.schedule_at=new Date(future);f.task.publish_at=new Date(future);f.release.expectedScheduleAt=future;
    await f.service.release(f.release);
    const before=JSON.stringify({task:f.task,events:f.events,attempts:f.attempts}),reads=f.preflightCalls;
    await assert.rejects(f.service.publish({...sendArgs(f),dryRun}),/THREADS_NOT_DUE/);
    assert.equal(f.preflightCalls,reads);assert.equal(f.providerCalls,0);
    assert.equal(JSON.stringify({task:f.task,events:f.events,attempts:f.attempts}),before);
});

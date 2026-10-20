import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { harness } from './helpers/vk_connector_harness';
import { connectorHash, connectorPackageHash } from '../services/vk_connector_contract';
import { VkConnectorExecutionService } from '../services/vk_connector_execution.service';
import type { VkConnectorExecutionPorts, ConnectorExecutionIdentity } from '../services/vk_connector_execution_contract';
import { runVkConnectorProviderJob, type VkConnectorOfflineHarness } from '../services/vk_connector_provider_execution';
import type { VkConnectorControl } from '../services/vk_connector_consumer_runtime';
import type { VkConnectorWallEvidence } from '../services/vk_connector_reconciliation';
import prisma from '../db';
import { PublicationFactService } from '../services/publication_fact.service';
import * as projectAccess from '../services/project_access.service';

const now = new Date('2026-10-13T19:00:00Z'), release = '2026-10-12T19:00:00Z';
const body = 'Actual service fixture accepted1048 caption', bytes = Buffer.from('approved local integration fixture');
const sha = connectorHash(bytes.toString());
const wireIdentity = z.object({ projectId: z.literal(10), actorId: z.literal('user:0'),
    hostId: z.literal('vk-connector-local-1048'), instanceId: z.string().uuid(),
    jobId: z.string().uuid(), generation: z.number().int().positive(), packageSha256: z.string().regex(/^[a-f0-9]{64}$/) });

async function integratedFixture(t: TestContext) {
    const h = harness(true, 'vk_feed_provider'); h.advance(86_400_000);
    h.snapshot.package.bodySha256 = connectorHash(body); h.snapshot.package.assetSha256 = sha;
    const packageSha256 = connectorPackageHash(h.snapshot.package);
    const job = await h.service.dispatch({ ...h.request, expectedPackageSha256: packageSha256 });
    const [polled] = (await h.service.poll({ ...h.consumer, mode: 'vk_feed_provider' })).jobs;
    const accepted = await h.service.ack({ ...h.consumer, ...polled });
    const identity: ConnectorExecutionIdentity = { ...h.consumer, jobId: job.jobId, generation: accepted.generation, packageSha256 };
    const evidence: VkConnectorWallEvidence = { ownerId: '-240051152', capturedAt: now.toISOString(), startedAt: now.toISOString(),
        windowStart: release, windowEnd: now.toISOString(), coverage: 'complete_window', exhausted: true, rows: [] };
    h.store.executionPackage = async () => ({ binding: h.snapshot.package, packageSha256, body,
        asset: { id: 130, url: 'https://cdn.example/approved.png', sha256: sha }, approvalReference: 'exact-owner-fixture-1048',
        releasedAt: release, workItemId: 1699, permissionStatus: 'NOT_CHECKED', providerExecution: 'blocked' });
    h.store.bindLease = async (projectId, actorId, token, expiresAt) => {
        assert.equal(projectId, 10); assert.equal(actorId, 'user:2'); assert.equal(token, 'fixture-canonical-lease');
        assert.equal(expiresAt, '2026-10-13T20:00:00Z');
    };
    const counters = { claim: 0, attempt: 0, fact: 0, upload: 0, submit: 0, session: 0, cancelled: 0 };
    let permitted = true, fenceAfterUpload = false;
    const ports: VkConnectorExecutionPorts = {
        admission: async () => permitted ? 'PERMITTED' : 'NOT_CHECKED',
        verifyEvidence: async (_args, _execution, supplied) => supplied === evidence ? evidence : null,
        verifyMediaAcknowledgement: async args => args.mediaAcknowledgement.assetSha256 === sha
            && args.mediaAcknowledgement.providerObjectId === '-240051152_61'
            && args.mediaAcknowledgement.providerMediaId === 'photo-240051152_55',
        claimLease: async () => { counters.claim++; return { leaseToken: 'fixture-canonical-lease', leaseExpiresAt: '2026-10-13T20:00:00Z' }; },
        checkLease: async args => { assert.equal(args.leaseToken, 'fixture-canonical-lease'); },
        start: async args => {
            assert.equal(args.workItemId, 1699); assert.equal(args.taskId, 1048); assert.equal(args.selectedAssetId, 130);
            assert.equal(args.textSha256, h.snapshot.package.bodySha256); assert.equal(args.imageSha256, sha);
            if (h.snapshot.attemptId) return { status: 'verification_required', attempt_id: h.snapshot.attemptId, retry_allowed: false };
            counters.attempt++; h.snapshot.attemptId = 701; h.snapshot.attemptStatus = 'pending';
            return { status: 'started', attempt_id: 701 };
        },
        confirm: async args => {
            assert.equal(args.attemptId, 701); assert.equal(args.mediaAcknowledgement.providerObjectId, '-240051152_61');
            assert.equal(args.providerTimestampSource, 'provider'); assert.equal(args.publishedAt, now.toISOString());
            counters.fact++; h.snapshot.factId = 801;
            h.snapshot.publicUrl = 'https://vk.com/wall-240051152_61'; h.snapshot.attemptStatus = 'delivered';
            return { publication_fact_id: 801 };
        },
        uncertain: async () => { h.snapshot.attemptStatus = 'pending'; return { status: 'verification_required' }; },
        recordMatchedFact: async (_args, execution, post) => {
            assert.equal(execution.binding.assetSha256, post.media?.assetSha256);
            counters.fact++; h.snapshot.factId = 801; h.snapshot.publicUrl = post.publicUrl;
            return { factId: 801, publicUrl: post.publicUrl };
        }
    };
    const service = new VkConnectorExecutionService(h.service, h.repository, ports, () => now);
    const controlErrors: string[] = [];
    // In-memory MCP routing invokes actual service methods and derives the actor from its authenticated fixture principal.
    const control: VkConnectorControl = { close: async () => {}, call: async (name, raw) => {
        const parsed = wireIdentity.parse(raw);
        const principal = { ...parsed, actorId: 'user:2' };
        if (name === 'ba_get_vk_connector_execution_package') return service.package(principal);
        if (name === 'ba_claim_vk_connector_execution') return service.claim({ ...principal, evidence: raw.evidence });
        if (name === 'ba_check_vk_connector_execution') return service.check({ ...principal, leaseToken: z.string().parse(raw.leaseToken) });
        if (name === 'ba_start_vk_connector_submission') {
            const command = z.object({ workItemId: z.literal(1699), channelId: z.literal(117), taskId: z.literal(1048),
                leaseToken: z.string(), approvalReference: z.string(), contentRevision: z.literal(1), textSha256: z.string(),
                imageSha256: z.string(), selectedAssetId: z.literal(130), placement: z.literal('feed'), idempotencyKey: z.string() }).parse(raw);
            return service.start({ ...principal, ...command });
        }
        if (name === 'ba_confirm_vk_connector_submission') {
            const command = z.object({ workItemId: z.literal(1699), channelId: z.literal(117), taskId: z.literal(1048),
                leaseToken: z.string(), approvalReference: z.string(), contentRevision: z.literal(1), textSha256: z.string(),
                imageSha256: z.string(), selectedAssetId: z.literal(130), placement: z.literal('feed'), idempotencyKey: z.string(),
                attemptId: z.number().int(), publicUrl: z.string(), providerObjectId: z.string(), publishedAt: z.string(), evidenceSha256: z.string(),
                providerTimestampSource: z.literal('provider'), readbackObservedAt: z.string(), postBaselineCapturedAt: z.string(),
                postBaselineObjectIds: z.array(z.string()), postSubmissionStartedAt: z.string(),
                mediaAcknowledgement: z.object({ assetSha256: z.string(), providerMediaId: z.string(), acknowledged: z.literal(true), providerObjectId: z.string() }) }).parse(raw);
            return service.confirm({ ...principal, ...command });
        }
        if (name === 'ba_mark_vk_connector_submission_uncertain') {
            const command = z.object({ taskId: z.literal(1048), workItemId: z.literal(1699), leaseToken: z.string(),
                attemptId: z.number().int(), reasonCode: z.string(), idempotencyKey: z.string() }).parse(raw);
            return service.uncertain({ ...principal, ...command });
        }
        if (name === 'ba_reconcile_vk_connector_execution') return service.reconcile({ ...principal, evidence: raw.evidence });
        throw new Error('Unexpected fixture command');
    } };
    const originalCall = control.call;
    control.call = async (name, args) => {
        try { return await originalCall(name, args); }
        catch (error: unknown) {
            controlErrors.push(`${name}:${error instanceof Error ? error.message : 'unknown fixture error'}`);
            throw error;
        }
    };
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vk017-integration-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const offline: VkConnectorOfflineHarness = { executionContext: 'offline_fixture', evidenceDir: directory, now: () => now,
        admission: { assess: async () => ({ status: 'OFFLINE_FIXTURE_ADMITTED', executionContext: 'offline_fixture' }) },
        loadApprovedImage: async () => ({ buffer: bytes, filename: 'approved.png', contentType: 'image/png' }),
        withSession: async run => {
            counters.session++;
            return run({ reconcile: async () => evidence, cancelPendingOperations: async () => { counters.cancelled++; },
                mediaAcknowledgement: async () => ({ assetSha256: sha, providerMediaId: 'photo-240051152_55', providerObjectId: '-240051152_61', acknowledged: true }),
                ui: { navigate: async () => {}, loginRequired: async () => false, openWallComposer: async () => {}, setPostText: async text => { assert.equal(text, body); },
                    attachImage: async () => { counters.upload++; if (fenceAfterUpload) h.jobs.get(job.jobId)!.generation++; },
                    captureScreenshot: async file => { fs.writeFileSync(file, 'synthetic fixture screenshot'); },
                    submitPost: async () => { counters.submit++; },
                    readbackPost: async () => ({ public_url: 'https://vk.com/wall-240051152_61', provider_object_id: '-240051152_61', owner_id: '-240051152',
                        published_at: now.toISOString(), text: body, image_present: true, provider_timestamp_source: 'provider',
                        post_baseline_captured_at: now.toISOString(), post_baseline_object_ids: [], post_submission_started_at: now.toISOString(), readback_observed_at: now.toISOString() }) }
            });
        } };
    const input = { identity: { ...h.consumer, actorId: 'user:0', mode: 'vk_feed_provider' }, jobId: job.jobId, generation: accepted.generation,
        packageSha256, binding: h.snapshot.package };
    return { h, service, identity, input, evidence, counters, control, offline, controlErrors,
        deny: () => { permitted = false; }, fenceOnUpload: () => { fenceAfterUpload = true; } };
}

test('VK017-INTEGRATION: service-backed MCP DTOs claim/start/confirm one exact synthetic package', async t => {
    const f = await integratedFixture(t);
    const result = await runVkConnectorProviderJob(f.input, f.control, f.offline);
    assert.equal(result.status, 'offline_fixture_confirmed', JSON.stringify({ controlErrors: f.controlErrors, counters: f.counters })); assert.equal(result.factId, 801);
    assert.equal(f.counters.claim, 1); assert.equal(f.counters.attempt, 1); assert.equal(f.counters.upload, 1); assert.equal(f.counters.submit, 1);
    const replay = await f.h.service.dispatch({ ...f.h.request, expectedPackageSha256: f.input.packageSha256 });
    assert.equal(replay.factId, 801); assert.equal(f.counters.fact, 1);
});
test('VK017-INTEGRATION: exact existing post reconciles without synthetic attempt or provider send', async t => {
    const f = await integratedFixture(t);
    f.evidence.rows = [{ objectId: '-240051152_61', publicUrl: 'https://vk.com/wall-240051152_61', publishedAt: release, text: body,
        media: { assetSha256: sha, providerMediaId: 'photo-240051152_55', acknowledged: true } }];
    const result = await runVkConnectorProviderJob(f.input, f.control, f.offline);
    assert.equal(result.status, 'offline_fixture_confirmed'); assert.equal(result.reason, 'EXACT_EXISTING_OBJECT');
    assert.equal(f.counters.attempt, 0); assert.equal(f.counters.claim, 0); assert.equal(f.counters.submit, 0); assert.equal(f.counters.fact, 1);
});
test('VK017-INTEGRATION: trusted admission unavailable blocks even an injected offline UI', async t => {
    const f = await integratedFixture(t); f.deny();
    const result = await runVkConnectorProviderJob(f.input, f.control, f.offline);
    assert.equal(result.status, 'verification_required'); assert.equal(f.counters.session, 0); assert.equal(f.counters.claim, 0);
});
test('VK017-INTEGRATION: transport fence loss after upload freezes durable attempt before submit/fact', async t => {
    const f = await integratedFixture(t); f.fenceOnUpload();
    const result = await runVkConnectorProviderJob(f.input, f.control, f.offline);
    assert.equal(result.status, 'verification_required'); assert.equal(f.counters.attempt, 1); assert.equal(f.counters.upload, 1);
    assert.equal(f.counters.submit, 0); assert.equal(f.counters.fact, 0); assert.equal(f.h.snapshot.attemptStatus, 'pending');
});

test('VK017-INTEGRATION: actual fact service runs transport beforeWrite guard before any canonical write', async t => {
    let transactionCalled = false, guardCalled = false, writes = 0;
    const forbiddenWrite = async (): Promise<never> => { writes++; throw new Error('Unexpected fixture database write'); };
    t.mock.method(projectAccess, 'requireProjectActorAccess', async (projectId: number, actorId: string) => {
        assert.equal(projectId, 10); assert.equal(actorId, 'user:2');
    });
    const transaction = new Proxy(prisma, { get(target, property): unknown {
        if (property === '$queryRaw') return async () => [];
        if (property === 'contentItem') return {
            create: forbiddenWrite, update: forbiddenWrite, updateMany: forbiddenWrite,
            findFirst: async ({ where }: { where: Record<string, unknown> }) => {
                assert.deepEqual(where, { id: 1048, project_id: 10 });
                return { id: 1048, project_id: 10, channel: { id: 139, type: 'vk' }, publication_fact: null };
            }
        };
        if (property === 'publicationFact') return {
            create: forbiddenWrite, update: forbiddenWrite, updateMany: forbiddenWrite,
            findFirst: async ({ where }: { where: Record<string, unknown> }) => {
                assert.equal(where.project_id, 10);
                assert.deepEqual(where.content_item_id, { not: 1048 });
                return null;
            }
        };
        if (['publicationFact', 'contentItem', 'workItem', 'metricSnapshot'].includes(String(property))) {
            return { create: forbiddenWrite, update: forbiddenWrite, updateMany: forbiddenWrite, findFirst: forbiddenWrite };
        }
        return Reflect.get(target, property);
    } });
    const priorTransaction = prisma.$transaction;
    t.after(() => { Reflect.set(prisma, '$transaction', priorTransaction); });
    Reflect.set(prisma, '$transaction', async (...args: unknown[]) => {
        const callback = args[0];
        assert.equal(typeof callback, 'function');
        assert.deepEqual(args[1], { isolationLevel: 'Serializable' });
        transactionCalled = true;
        if (typeof callback !== 'function') throw new Error('Expected transaction callback');
        return callback(transaction);
    });
    await assert.rejects(new PublicationFactService().record({ projectId: 10, taskId: 1048, actorId: 'user:2',
        artifactKind: 'post', outcome: 'published', publishedAt: now.toISOString(),
        publicUrl: 'https://vk.com/wall-240051152_61', providerObjectId: '-240051152_61', confirmationMode: 'reconciled',
        beforeWrite: async tx => { guardCalled = true; assert.equal(tx, transaction); throw new Error('[VK_CONNECTOR_FENCED]'); }
    }), /VK_CONNECTOR_FENCED/);
    assert.equal(transactionCalled, true); assert.equal(guardCalled, true); assert.equal(writes, 0);
});

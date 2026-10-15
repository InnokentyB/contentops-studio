import assert from 'node:assert/strict';
import test from 'node:test';
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
    const events: any[] = []; const attempts: any[] = []; let providerCalls = 0;
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
        threads: { testConnection: async () => ({ success: true, details: { id: '39421253764155091', username: 'innokentybo' } }),
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
    return { service, release, task, attempts, events, get providerCalls() { return providerCalls; } };
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

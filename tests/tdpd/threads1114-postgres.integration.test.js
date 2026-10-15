const test = require('node:test');
const assert = require('node:assert/strict');
// Never fall back to DATABASE_URL or use an existing shared database.
const target = process.env.TDPD_TEST_DATABASE_URL;
if (!target) throw new Error('Explicit isolated TDPD_TEST_DATABASE_URL required');
const parsed = new URL(target);
if (process.env.CI !== 'true' || parsed.protocol !== 'postgresql:' || parsed.search || parsed.hash
    || parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/codex_lifecycle_ci') {
    throw new Error('Only the dedicated ephemeral CI PostgreSQL database is permitted');
}
process.env.DATABASE_URL = target;
// Bootstrap may prefer an APP/Supabase URL from an environment file. Validate
// the effective target before importing anything that creates a connection pool.
require('../../dist/bootstrap-env');
const effective = new URL(process.env.DATABASE_URL || '');
if (effective.hostname !== parsed.hostname || effective.port !== parsed.port || effective.pathname !== parsed.pathname
    || effective.protocol !== parsed.protocol || effective.username !== parsed.username || effective.password !== parsed.password) {
    throw new Error('Database bootstrap changed the explicitly isolated test target');
}
const db = require('../../dist/db');
const guard = require('../../dist/services/threads1114_store_guard');
const store = require('../../dist/services/threads1114_store');
const p = require('../../dist/services/threads1114_contract').THREADS1114;
const args = { projectId: 10, taskId: 1114, actorId: 'user:2', expectedManifestChecksum: p.manifest,
    approvalReference: 'synthetic CI owner approval', idempotencyKey: 'ci-release-1114', releaseIdempotencyKey: 'ci-release-1114' };
let created = false;
const slug = 'isolated_threads1114_cas_fixture';

test('PostgreSQL serializable release replay and competing claims preserve one attempt', { timeout: 30_000 }, async t => {
    assert.equal(await db.default.project.findUnique({ where: { id: 10 } }), null, 'refuse any preexisting project');
    await db.default.project.create({ data: { id: 10, name: 'Isolated CI fixture', slug } }); created = true;
    await db.default.socialChannel.create({ data: { id: 138, project_id: 10, type: 'threads', name: 'synthetic', config: {} } });
    await db.default.contentItem.create({ data: { id: 1114, project_id: 10, channel_id: 138, type: 'threads_post',
        draft_text: 'Synthetic DB fence fixture, never publish', content_revision: 1, accepted_revision: 1,
        text_state: 'accepted', status: 'ready_for_execution', publication_mode: 'approval_required', schedule_at: new Date(p.schedule) } });
    // Identity/package behavior has deterministic tests; this test isolates real DB fencing.
    t.mock.method(guard, 'ownerOnly', async () => 2);
    t.mock.method(guard, 'checked1114', async (tx, _a, released) => {
        const task = await tx.contentItem.findUnique({ where: { id: 1114 } });
        if (!task || task.status !== 'ready_for_execution'
            || task.publication_mode !== (released ? 'owner_released' : 'approval_required')) throw new Error('FIXTURE_GUARD_FAILED');
        return { task };
    });
    const releases = await Promise.all([store.release1114(args), store.release1114(args)]);
    assert.deepEqual(releases[0], releases[1]);
    assert.equal(await db.default.workflowEvent.count({ where: { project_id: 10, command: p.releaseCommand } }), 1);
    const send = { ...args, idempotencyKey: 'ci-send-1114' };
    const claims = await Promise.allSettled([store.claim1114(send), store.claim1114(send)]);
    assert.equal(claims.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(await db.default.deliveryAttempt.count({ where: { project_id: 10, content_item_id: 1114 } }), 1);
    assert.equal(await db.default.workflowEvent.count({ where: { project_id: 10, command: `${p.sendCommand}:claim` } }), 1);
    assert.deepEqual(await store.replay1114(send, 'send'), { mode: 'verification_required', retry_allowed: false, task_id: 1114 });
    assert.equal((await store.replay1114({ ...send, idempotencyKey: 'other-key' }, 'send')).retry_allowed, false);
});
test.after(async () => {
    if (created) {
        const project = await db.default.project.findUnique({ where: { id: 10 } });
        assert.equal(project?.slug, slug, 'cleanup only the fixture created by this test');
        await db.default.project.delete({ where: { id: 10 } });
    }
    await db.default.$disconnect(); await db.pool.end();
});

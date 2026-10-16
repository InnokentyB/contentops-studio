const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const target = process.env.TDPD_TEST_DATABASE_URL;
if (!target) throw Error('Explicit isolated test database required');
const url = new URL(target);
if (process.env.CI !== 'true' || url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1'
    || url.pathname !== '/codex_lifecycle_ci' || url.search || url.hash) throw Error('Ephemeral CI database only');
process.env.DATABASE_URL = target;
require('../../dist/bootstrap-env');
const effective = new URL(process.env.DATABASE_URL || '');
if (effective.protocol !== url.protocol || effective.hostname !== url.hostname
    || effective.port !== url.port || effective.pathname !== url.pathname
    || effective.username !== url.username || effective.password !== url.password || effective.hash
    || effective.searchParams.get('schema') !== 'planner'
    || effective.searchParams.get('options') !== '-c search_path=planner'
    || [...effective.searchParams.keys()].some(key => !['schema', 'options'].includes(key))) {
    throw Error('Bootstrap changed isolated database target');
}
const { default: db, pool } = require('../../dist/db');
const { repairReviewHandoff, reviewRepairMetadataHash, reviewRepairStateHash } = require('../../dist/services/review_handoff_repair');
const sha = value => createHash('sha256').update(value).digest('hex');
const slug = 'isolated_review_handoff_fixture';
let projectCreated = false; let userId;
test('real PostgreSQL repair rolls back on audit failure and concurrent apply leaves one replacement/event',
    { timeout: 30000 }, async () => {
        assert.equal(await db.project.findUnique({ where: { id: 7 } }), null);
        await db.project.create({ data: { id: 7, name: 'Synthetic isolated fixture', slug } });
        projectCreated = true;
        const user = await db.user.create({ data: { email: 'review-repair@synthetic.invalid',
            name: 'Synthetic owner', password_hash: 'not-a-login-credential' } }); userId = user.id;
        await db.projectMember.create({ data: { project_id: 7, user_id: userId, role: 'owner' } });
        const config = { execution_modes: ['manual'] };
        await db.socialChannel.create({ data: { id: 6, project_id: 7, type: 'linkedin', name: 'synthetic', config } });
        const date = '2026-10-16T14:00:00.000Z';
        await db.contentItem.create({ data: { id: 1136, project_id: 7, channel_id: 6, type: 'publication',
            content_revision: 2, draft_text: 'Synthetic unchanged body', status: 'drafted', text_state: 'draft',
            visual_state: 'STALE', visual_placement: 'feed', publication_mode: 'approval_required',
            schedule_at: new Date(date), publish_at: new Date(date), quality_report: { handoff_bundle: { mode: 'automated' } } } });
        await db.workItem.create({ data: { id: 1948, project_id: 7, content_item_id: 1136, item_key: 'synthetic',
            kind: 'content_review', state: 'waiting_approval', assignee_role: 'content_reviewer',
            input_context_version: 2, result_version: 2, result_payload: { content_revision: 2 } } });
        const approval = await db.approvalDecision.create({ data: { work_item_id: 1948,
            result_version: 2, decision: 'approved', actor_id: `user:${userId}`, comment: 'Historical r1; retain' } });
        const args = { projectId: 7, taskId: 1136, workItemId: 1948, actorId: `user:${userId}`,
            expectedChannelId: 6, expectedRevision: 2, expectedBodySha256: sha('Synthetic unchanged body'),
            expectedChannelConfigSha256: sha(JSON.stringify(config)), expectedScheduleAt: date, expectedPublishAt: date,
            expectedResultVersion: 2, idempotencyKey: 'synthetic-recovery', reason: 'Synthetic owner recovery approval', apply: true };
        args.expectedTaskMetadataSha256 = reviewRepairMetadataHash(await db.contentItem.findUnique({
            where: { id: 1136 }, include: { channel: true } }));
        args.expectedReviewStateSha256 = reviewRepairStateHash(await db.workItem.findUnique({ where: { id: 1948 } }));
        const failingDb = new Proxy(db, { get(object, key) {
            if (key !== '$transaction') return Reflect.get(object, key);
            return (run, options) => db.$transaction(tx => run(new Proxy(tx, { get(client, field) {
                if (field === 'workflowEvent') return { ...client.workflowEvent,
                    create: async () => { throw Error('synthetic audit failure'); } };
                return Reflect.get(client, field);
            } })), options);
        } });
        await assert.rejects(repairReviewHandoff(args, failingDb), /synthetic audit failure/);
        assert.equal((await db.workItem.findUnique({ where: { id: 1948 } })).state, 'waiting_approval');
        assert.equal(await db.workItem.count({ where: { project_id: 7 } }), 1);
        assert.equal((await db.contentItem.findUnique({ where: { id: 1136 } })).quality_report.handoff_bundle.mode, 'automated');
        const attempts = await Promise.allSettled([repairReviewHandoff(args), repairReviewHandoff(args)]);
        assert.ok(attempts.some(r => r.status === 'fulfilled'));
        const replay = await repairReviewHandoff(args);
        assert.equal(replay.replayed, true);
        assert.equal(await db.workItem.count({ where: { project_id: 7, content_item_id: 1136,
            state: 'available', input_context_version: 2, result_version: 0 } }), 1);
        assert.equal(await db.workflowEvent.count({ where: { project_id: 7, command: 'ba_repair_content_review_handoff' } }), 1);
        assert.deepEqual(await db.approvalDecision.findUnique({ where: { id: approval.id } }), approval);
        assert.equal(await db.deliveryAttempt.count({ where: { project_id: 7 } }), 0);
        assert.equal(await db.publicationFact.count({ where: { project_id: 7 } }), 0);
    });
test.after(async () => {
    if (projectCreated) {
        assert.equal((await db.project.findUnique({ where: { id: 7 } }))?.slug, slug);
        await db.project.delete({ where: { id: 7 } });
    }
    if (userId) await db.user.delete({ where: { id: userId } });
    await db.$disconnect(); await pool.end();
});

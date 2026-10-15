import assert from 'node:assert/strict';
import test from 'node:test';
process.env.TELEGRAM_BOT_TOKEN = '000000:synthetic-route-test';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_KEY ||= 'synthetic-route-test';

for (const binding of [{ id: 1114, project_id: 10, platform: 'threads' }, { id: 1128, project_id: 7, platform: 'linkedin' }]) {
    test(`exact task${binding.id} cannot use generic send, processing or browser fallback`, async t => {
        let external = 0; let state = 0; let readiness = 0;
        t.mock.method(globalThis, 'fetch', async () => { external += 1; throw new Error('Provider calls forbidden in this test'); });
        const { publicationDispatcher } = await import('../services/publishers/publication_dispatcher');
        const prisma = (await import('../db')).default;
        const art = (await import('../services/art_direction.service')).default;
        const original = prisma.$transaction;
        prisma.$transaction = async () => { state += 1; throw new Error('Generic state write forbidden'); };
        t.after(() => { prisma.$transaction = original; });
        t.mock.method(art, 'getReadiness', async () => { readiness += 1; throw new Error('Generic readiness must not precede exact guard'); });
        const task = { ...binding, status: 'publishing', channel: { type: binding.platform }, content_revision: 1 };
        const results = [
            await publicationDispatcher.executeAutomatedPublicationTask(task, {}, {}, {}),
            await publicationDispatcher.processPublicationTaskItem(task, { manualTrigger: true }),
            await publicationDispatcher.routeToBrowserPublication(task, {}, { code: 'STALE_CONNECTOR' })
        ];
        for (const result of results) {
            assert.equal(result.blocked, true); assert.equal(result.reason, 'exact_owned_task_route_required');
            assert.equal(result.retry_via_api, false);
        }
        assert.equal(external, 0); assert.equal(state, 0); assert.equal(readiness, 0);
    });
}

import assert from 'node:assert/strict';
import { z } from 'zod';
import test, { mock } from 'node:test';
process.env.TELEGRAM_BOT_TOKEN ||= '123456:offline-route-fixture';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_KEY ||= 'offline-route-fixture';
const task = { id: 1048, project_id: 10, status: 'ready_for_execution', channel: { id: 117, type: 'vk' }, publication_mode: 'connector_auto' };
test('VK generic direct entry returns independent-adapter handoff without provider or state writes', async () => {
    const { publicationDispatcher } = await import('../services/publishers/publication_dispatcher');
    const prisma = (await import('../db')).prisma;
    const vk = (await import('../services/publishers/vk_publisher')).vkPublisher;
    let writes = 0; let providerCalls = 0;
    const originalTransaction = prisma.$transaction;
    prisma.$transaction = async () => { writes++; throw new Error('Unexpected transaction'); };
    const provider = mock.method(vk, 'publishVkTask', async () => { providerCalls++; throw new Error('Unexpected provider call'); });
    try {
        const result = await publicationDispatcher.executeAutomatedPublicationTask(task, { publication: { body: 'accepted text' } }, {}, { actions: [], assets: {}, accounts: {} });
        assert.equal(result.reason, 'vk_adapter_required'); assert.equal(result.success, false);
        assert.equal(result.blocked, true); assert.equal(result.provider_execution, 'blocked');
        assert.equal(result.adapter_requirement.code, 'VK_INDEPENDENT_ADAPTER_REQUIRED');
        assert.equal(writes, 0); assert.equal(providerCalls, 0);
    } finally { provider.mock.restore(); prisma.$transaction = originalTransaction; }
});
test('Dzen unavailable adapter never creates generic browser fallback or exposes provider secrets', async () => {
    const { publicationDispatcher } = await import('../services/publishers/publication_dispatcher');
    const { browserFallbackReason } = await import('../services/publication_execution_route');
    const prisma = (await import('../db')).prisma;
    let writes = 0;
    const originalTransaction = prisma.$transaction;
    prisma.$transaction = async () => { writes++; throw new Error('Unexpected write'); };
    try {
        for (const type of ['dzen', 'zen', 'zen_article']) {
            const reason = browserFallbackReason(new Error('cookie=PRIVATE'), type);
            assert.equal(reason.next_route, 'dzen_adapter_required');
            assert.equal(JSON.stringify(reason).includes('PRIVATE'), false);
            const result = z.object({ blocked: z.literal(true), reason: z.literal('dzen_adapter_required') }).parse(
                await publicationDispatcher.routeToBrowserPublication({ ...task, channel: { type } }, {}, reason));
            assert.equal(result.blocked, true);
        }
        assert.equal(writes, 0);
    } finally { prisma.$transaction = originalTransaction; }
});

test('VK browser fallback central entry cannot write a browser handoff or infer retry permission', async () => {
    const { publicationDispatcher } = await import('../services/publishers/publication_dispatcher');
    const prisma = (await import('../db')).prisma; let writes = 0;
    const originalTransaction = prisma.$transaction;
    prisma.$transaction = async () => { writes++; throw new Error('Unexpected transaction'); };
    try {
        const result = z.object({ reason: z.string(), adapter_requirement: z.object({ retry_via_api: z.literal(false) }) }).parse(await publicationDispatcher.routeToBrowserPublication(task, {}, { code: 'CONNECTOR_PUBLISH_FAILED' }));
        assert.equal(result.reason, 'vk_adapter_required'); assert.equal(result.adapter_requirement.retry_via_api, false); assert.equal(writes, 0);
    } finally { prisma.$transaction = originalTransaction; }
});

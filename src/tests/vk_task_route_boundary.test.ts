import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
process.env.TELEGRAM_BOT_TOKEN ||= '123456:offline-vk-route';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_KEY ||= 'offline-vk-route';
const channel = { id: 120, project_id: 10, type: 'vk', name: 'owned-vk-fixture', is_active: true,
    config: { vk_id: '-123', publish_access_token: 'fixture-community', user_access_token: 'fixture-user', oauth_user_id: 42 },
    created_at: new Date(0), updated_at: new Date(0) };
const blocked = z.object({ reason: z.literal('vk_adapter_required'), adapter_requirement: z.object({ retry_via_api: z.literal(false) }) });

test('VK task boundary blocks feed/story/clip before provider claim and fact; dry-run cannot advertise direct API readiness', async () => {
    const { TelegramTaskPublicationService } = await import('../services/telegram_task_publication.service');
    for (const placement of ['feed','story','clip']) {
        let providerCalls = 0, writes = 0;
        const task = { id: 900, project_id: 10, status: 'ready_for_execution', publication_mode: 'connector_auto',
            type: placement === 'story' ? 'vk_story' : 'vk_post:publish', visual_placement: placement,
            draft_text: 'accepted fixture', content_revision: 1, accepted_revision: 1, text_state: 'accepted', visual_state: 'APPROVED',
            selected_asset_id: 18, channel, publication_fact: null,
            selected_asset: { id: 18, status: 'approved', content_revision: 1, file_url: 'https://fixture.test/image.png' } };
        const write = async (): Promise<never> => { writes++; throw new Error('Forbidden task claim/fact write'); };
        const provider = async () => { providerCalls++; return { publishedLink: 'https://vk.com/wall-123_456', metrics: { vk_owner_id: '-123', vk_post_id: '456' } }; };
        const service = new TelegramTaskPublicationService({ prisma: { workflowEvent: { findUnique: async () => null },
            contentItem: { findFirst: async () => task }, projectMember: { findFirst: async () => ({ user_id: 2 }) }, $transaction: write },
            publicationFacts: { record: write }, publisher: { publishTelegramTaskMtproto: write, publishTelegramPersonalStoryMtproto: write,
                publishVkTask: provider, publishVkPersonalStory: provider } });
        for (const dryRun of [true,false]) {
            const raw = await service.execute({ projectId: 10, taskId: 900, dryRun, idempotencyKey: 'fixture-route-900' });
            assert.equal(raw.connector_ready, null); assert.equal(raw.adapter_readiness, 'NOT_CHECKED');
            const result = blocked.parse(raw);
            assert.equal(result.adapter_requirement.retry_via_api, false);
        }
        assert.equal(providerCalls, 0); assert.equal(writes, 0);
    }
});

test('VK task facade and task publisher reject direct API calls before inspecting or refreshing credentials', async t => {
    const facade = (await import('../services/publisher.service')).default;
    const publisher = (await import('../services/publishers/vk_publisher')).vkPublisher;
    const vk = (await import('../services/vk.service')).default;
    const oauth = (await import('../services/vk_oauth.service')).default;
    let calls = 0;
    t.mock.method(vk, 'publishPostWithIdentity', async () => { calls++; return { ownerId: '-123', postId: '456', publishedLink: 'https://vk.com/wall-123_456' }; });
    t.mock.method(vk, 'publishPersonalPhotoStoryWithIdentity', async () => { calls++; return { ownerId: '42', storyId: '88', publishedLink: 'https://vk.com/story42_88' }; });
    t.mock.method(oauth, 'refreshStoredChannelToken', async () => { calls++; throw new Error('No refresh allowed'); });
    const params = { projectId: 10, taskId: 900, channel, text: 'fixture text', imageUrl: 'https://fixture.test/image.png', idempotencyKey: 'fixture-vk-task' };
    for (const entry of [facade,publisher]) {
        await assert.rejects(entry.publishVkTask(params), /VK_INDEPENDENT_ADAPTER_REQUIRED/);
        await assert.rejects(entry.publishVkPersonalStory(params), /VK_INDEPENDENT_ADAPTER_REQUIRED/);
    }
    assert.equal(calls, 0);
});

test('VK direct MCP channel resolution stays scoped and returns BLOCKED before provider or event writes', async t => {
    const { publishDirect } = await import('../services/mcp_publication/direct_publish');
    const prisma = (await import('../db')).prisma;
    const vk = (await import('../services/vk.service')).default;
    let calls = 0, writes = 0, scoped = 0;
    t.mock.method(vk, 'publishPost', async () => { calls++; return 'https://vk.com/wall-123_456'; });
    const previous = prisma.event;
    Reflect.set(prisma, 'event', { create: async () => { writes++; throw new Error('Forbidden direct event write'); } });
    t.after(() => { Reflect.set(prisma, 'event', previous); });
    const resolver = async (projectId: number, channelId?: number) => { assert.equal(projectId, 10); assert.equal(channelId, 120); scoped++; return channel; };
    for (const dryRun of [true,false]) blocked.parse(await publishDirect({ projectId: 10, channelId: 120, text: 'fixture', dryRun }, resolver));
    await assert.rejects(publishDirect({ projectId: 99, channelId: 120, text: 'fixture' }, async () => { throw new Error('Scope rejected'); }), /Scope rejected/);
    assert.equal(scoped, 2); assert.equal(calls, 0); assert.equal(writes, 0);
});

test('VK legacy scheduled/manual posts cannot be marked publishing or sent through the task-owned API fallback', async t => {
    const prisma = (await import('../db')).prisma;
    const { legacyPostPublisher } = await import('../services/publishers/legacy_post_publisher');
    const vk = (await import('../services/vk.service')).default;
    let calls = 0, writes = 0;
    const post = { id: 900, project_id: 10, channel_id: 120, channel, status: 'scheduled', final_text: 'fixture', image_url: null };
    const priorPost = prisma.post, priorChannel = prisma.socialChannel;
    const write = async () => { writes++; return { count: 1 }; };
    Reflect.set(prisma, 'post', { findMany: async () => [post], findUnique: async () => post, updateMany: write, update: write });
    Reflect.set(prisma, 'socialChannel', { findUnique: async () => channel, findFirst: async () => channel });
    t.after(() => { Reflect.set(prisma, 'post', priorPost); Reflect.set(prisma, 'socialChannel', priorChannel); });
    t.mock.method(vk, 'publishPost', async () => { calls++; return 'https://vk.com/wall-123_456'; });
    assert.equal(await legacyPostPublisher.publishDuePosts(), 0);
    await assert.rejects(legacyPostPublisher.publishPostNow(900), /VK_INDEPENDENT_ADAPTER_REQUIRED/);
    assert.equal(calls, 0); assert.equal(writes, 0);
});

test('VK blocked task lookup remains project scoped, owner approval stays mandatory, and canonical published replay stays read-only', async () => {
    const { TelegramTaskPublicationService } = await import('../services/telegram_task_publication.service');
    let writes = 0;
    const forbidden = async (): Promise<never> => { writes++; throw new Error('Unexpected claim/provider/fact'); };
    const task = { id: 900, project_id: 10, channel, publication_mode: 'connector_auto',
        status: 'ready_for_execution', publication_fact: null as { outcome: string; public_url: string; provider_object_id: string } | null };
    const scoped = z.object({ where: z.object({ id: z.literal(900), project_id: z.literal(10) }) }).passthrough();
    const create = (findFirst: (args: unknown) => Promise<unknown>) => new TelegramTaskPublicationService({
        prisma: { workflowEvent: { findUnique: async () => null }, contentItem: { findFirst }, $transaction: forbidden },
        publicationFacts: { record: forbidden }, publisher: { publishTelegramTaskMtproto: forbidden,
            publishTelegramPersonalStoryMtproto: forbidden, publishVkTask: forbidden, publishVkPersonalStory: forbidden } });
    const service = create(async args => { scoped.parse(args); return task; });
    task.publication_mode = 'approval_required';
    await assert.rejects(service.execute({ projectId: 10, taskId: 900, idempotencyKey: 'fixture-approval' }), /OWNER_RELEASE_REQUIRED/);
    task.publication_mode = 'connector_auto'; task.status = 'published';
    task.publication_fact = { outcome: 'published', public_url: 'https://vk.com/wall-123_456', provider_object_id: '-123_456' };
    const replay = await service.execute({ projectId: 10, taskId: 900, idempotencyKey: 'fixture-replay' });
    assert.equal(replay.mode, 'published'); assert.equal(replay.replayed, true); assert.equal(replay.published_link, task.publication_fact.public_url);
    await assert.rejects(create(async args => { const query = z.object({ where: z.object({ project_id: z.literal(99) }) }).passthrough().parse(args);
        assert.equal(query.where.project_id, 99); return null; }).execute({ projectId: 99, taskId: 900, idempotencyKey: 'fixture-cross-project' }), /PUBLICATION_TASK_NOT_FOUND/);
    assert.equal(writes, 0);
});

test('VK orphan legacy effective-channel resolution blocks before scheduled/manual writes or uncertainty reset', async t => {
    const prisma = (await import('../db')).prisma;
    const { legacyPostPublisher } = await import('../services/publishers/legacy_post_publisher');
    let writes = 0;
    const post = { id: 900, project_id: 10, channel_id: null, channel: null, status: 'scheduled', final_text: 'fixture' };
    const priorPost = prisma.post, priorChannel = prisma.socialChannel;
    Reflect.set(prisma, 'post', { findMany: async () => [post], findUnique: async () => post,
        updateMany: async () => { writes++; return { count: 1 }; }, update: async () => { writes++; return post; } });
    Reflect.set(prisma, 'socialChannel', { findFirst: async () => channel, findUnique: async () => channel });
    t.after(() => { Reflect.set(prisma, 'post', priorPost); Reflect.set(prisma, 'socialChannel', priorChannel); });
    assert.equal(await legacyPostPublisher.publishDuePosts(), 0);
    await assert.rejects(legacyPostPublisher.publishPostNow(900), /VK_INDEPENDENT_ADAPTER_REQUIRED/);
    post.status = 'publishing';
    assert.equal(await legacyPostPublisher.resetStuckPublishingPosts(), 0);
    assert.equal(writes, 0);
});

test('Legacy known Telegram selection retains scheduled-native state flow while unknown effective channels are held', async t => {
    const prisma = (await import('../db')).prisma;
    const { legacyPostPublisher } = await import('../services/publishers/legacy_post_publisher');
    const telegram = { ...channel, type: 'telegram' };
    const post = { id: 901, project_id: 10, channel_id: 120, channel: telegram, status: 'scheduled_native' };
    let writes = 0, known = true;
    const priorPost = prisma.post, priorChannel = prisma.socialChannel;
    Reflect.set(prisma, 'post', { findMany: async () => [post], updateMany: async () => { writes++; return { count: 1 }; } });
    Reflect.set(prisma, 'socialChannel', { findFirst: async () => known ? telegram : null });
    t.after(() => { Reflect.set(prisma, 'post', priorPost); Reflect.set(prisma, 'socialChannel', priorChannel); });
    assert.equal(await legacyPostPublisher.publishDuePosts(), 1); assert.equal(writes, 1);
    post.status = 'publishing';
    assert.equal(await legacyPostPublisher.resetStuckPublishingPosts(), 1); assert.equal(writes, 2);
    known = false;
    assert.equal(await legacyPostPublisher.publishDuePosts(), 0); assert.equal(await legacyPostPublisher.resetStuckPublishingPosts(), 0);
    assert.equal(writes, 2);
});

test('Legacy explicit missing or foreign channel binding is held without resolving the available default Telegram channel', async t => {
    const prisma = (await import('../db')).prisma;
    const { legacyPostPublisher } = await import('../services/publishers/legacy_post_publisher');
    const { resolveLegacyPublicationChannel } = await import('../services/publishers/legacy_publication_channel');
    let writes = 0, fallbacks = 0;
    const post = { id: 902, project_id: 10, channel_id: 999, status: 'scheduled_native' };
    const telegram = { ...channel, type: 'telegram' };
    const priorPost = prisma.post, priorChannel = prisma.socialChannel;
    Reflect.set(prisma, 'post', { findMany: async () => [post], findUnique: async () => post,
        updateMany: async () => { writes++; return { count: 1 }; }, update: async () => { writes++; return post; } });
    const querySchema = z.object({ where: z.object({ id: z.number().optional(), project_id: z.literal(10) }).passthrough() }).passthrough();
    Reflect.set(prisma, 'socialChannel', { findFirst: async (raw: unknown) => {
        const query = querySchema.parse(raw);
        if (query.where.id !== undefined) return null; // Scoped lookup cannot resolve stale or foreign assignment.
        fallbacks++; return telegram;
    } });
    t.after(() => { Reflect.set(prisma, 'post', priorPost); Reflect.set(prisma, 'socialChannel', priorChannel); });
    for (const channelId of [999, 1000]) {
        post.channel_id = channelId;
        assert.equal(await resolveLegacyPublicationChannel(prisma, post), null);
        assert.equal(await legacyPostPublisher.publishDuePosts(), 0);
        await assert.rejects(legacyPostPublisher.publishPostNow(post.id), /Channel config not found/);
        post.status = 'publishing';
        assert.equal(await legacyPostPublisher.resetStuckPublishingPosts(), 0);
        post.status = 'scheduled_native';
    }
    assert.equal(fallbacks, 0); assert.equal(writes, 0);
});

test('Legacy explicit binding disappearing after preclassification is held after claim without default provider or blind reset', async t => {
    const prisma = (await import('../db')).prisma;
    const { legacyPostPublisher } = await import('../services/publishers/legacy_post_publisher');
    const vk = (await import('../services/vk.service')).default;
    let scopedReads = 0, defaults = 0, providers = 0, claims = 0, resets = 0;
    const telegram = { ...channel, type: 'telegram', config: { telegram_channel_id: 'fixture-target' } };
    const post = { id: 903, project_id: 10, channel_id: 120, channel: telegram, status: 'scheduled', final_text: 'fixture' };
    const priorPost = prisma.post, priorChannel = prisma.socialChannel;
    const mutation = z.object({ data: z.object({ status: z.string() }).passthrough() }).passthrough();
    Reflect.set(prisma, 'post', { findMany: async () => [post], updateMany: async (raw: unknown) => {
        const command = mutation.parse(raw); if (command.data.status === 'publishing') claims++; else resets++;
        return { count: 1 }; }, update: async () => { resets++; return post; } });
    Reflect.set(prisma, 'socialChannel', { findFirst: async (raw: unknown) => {
        const query = z.object({ where: z.object({ id: z.number().optional(), project_id: z.literal(10) }).passthrough() }).passthrough().parse(raw);
        if (query.where.id !== undefined) return ++scopedReads === 1 ? telegram : null;
        defaults++; return channel;
    }, findUnique: async () => null });
    t.after(() => { Reflect.set(prisma, 'post', priorPost); Reflect.set(prisma, 'socialChannel', priorChannel); });
    t.mock.method(vk, 'publishPost', async () => { providers++; return 'https://vk.com/wall-123_456'; });
    await legacyPostPublisher.publishDuePosts();
    assert.equal(claims, 1); // Existing legacy batch claim can precede a binding change; it is not the canonical017 fence.
    assert.equal(defaults, 0); assert.equal(providers, 0); assert.equal(resets, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';

process.env.TELEGRAM_BOT_TOKEN ||= 'test:vk-task-publication';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_KEY ||= 'test-supabase-key';

const { TelegramTaskPublicationService } = require('../services/telegram_task_publication.service');
const { VKService } = require('../services/vk.service');

function approvedVkTask(overrides: Record<string, any> = {}) {
    return {
        id: 900,
        project_id: 10,
        status: 'ready_for_execution',
        type: 'vk_post:publish',
        draft_text: '  Accepted VK publication text  ',
        content_revision: 3,
        accepted_revision: 3,
        text_state: 'accepted',
        visual_state: 'APPROVED',
        selected_asset_id: 18,
        quality_report: {},
        metrics: {},
        channel: {
            id: 120,
            type: 'vk',
            name: 'analystcraft_vk',
            config: { vk_id: '-123', publish_access_token: 'secret-token' }
        },
        selected_asset: {
            id: 18,
            status: 'approved',
            content_revision: 3,
            file_url: ' https://cdn.example/approved-vk.png '
        },
        publication_fact: {
            id: 50,
            outcome: 'removed',
            public_url: null,
            provider_object_id: null
        },
        ...overrides
    };
}

function harness(task = approvedVkTask(), providerError?: Error) {
    const calls = { provider: [] as any[], updates: [] as any[], events: [] as any[], facts: [] as any[] };
    const workflowEvent = {
        findUnique: async () => null,
        create: async ({ data }: any) => { calls.events.push(data); return data; }
    };
    const contentItem = {
        findFirst: async () => task,
        updateMany: async ({ data }: any) => { calls.updates.push(data); return { count: 1 }; },
        update: async ({ data }: any) => { calls.updates.push(data); return { ...task, ...data }; }
    };
    const prisma = {
        workflowEvent,
        contentItem,
        projectMember: { findFirst: async () => ({ user_id: 2 }) },
        $transaction: async (callback: any) => callback({ workflowEvent, contentItem })
    };
    const publisher = {
        publishTelegramTaskMtproto: async () => { throw new Error('Telegram boundary must not be called'); },
        publishTelegramPersonalStoryMtproto: async () => { throw new Error('Telegram story boundary must not be called'); },
        publishVkPersonalStory: async (payload: any) => {
            calls.provider.push(payload);
            if (providerError) throw providerError;
            return {
                adapter: 'vk_story',
                deliveryMethod: 'vk_api_personal_story',
                publishedLink: 'https://vk.com/story42_88',
                evidenceRef: 'https://vk.com/story42_88',
                metrics: { vk_story_owner_id: '42', vk_story_id: '88' }
            };
        },
        publishVkTask: async (payload: any) => {
            calls.provider.push(payload);
            if (providerError) throw providerError;
            return {
                adapter: 'vk',
                deliveryMethod: 'vk_api',
                publishedLink: 'https://vk.com/wall-123_456',
                metrics: { vk_owner_id: '-123', vk_post_id: '456' }
            };
        }
    };
    const publicationFacts = {
        record: async (args: any) => { calls.facts.push(args); return { publication_fact: args }; }
    };
    return { service: new TelegramTaskPublicationService({ prisma, publisher, publicationFacts }), calls };
}

test('VK dry-run and live use the same accepted text and approved durable visual', async () => {
    const dry = harness();
    const preview = await dry.service.execute({ projectId: 10, taskId: 900, dryRun: true });
    const live = harness();
    const result = await live.service.execute({ projectId: 10, taskId: 900, idempotencyKey: 'publish:vk:900:r3' });

    assert.deepEqual(preview.payload_preview, {
        text: 'Accepted VK publication text',
        image_url: 'https://cdn.example/approved-vk.png',
        has_image: true
    });
    assert.equal(preview.delivery, 'vk_api');
    assert.deepEqual(live.calls.provider, [{
        projectId: 10,
        taskId: 900,
        channel: approvedVkTask().channel,
        text: preview.payload_preview.text,
        imageUrl: preview.payload_preview.image_url,
        idempotencyKey: 'publish:vk:900:r3'
    }]);
    assert.equal(result.external_id, 'wall-123_456');
    assert.equal(live.calls.facts[0].providerObjectId, 'wall-123_456');
    assert.match(live.calls.facts[0].correctionReason, /removed/i);
});

test('VK dry-run validates payload while reporting missing provider configuration', async () => {
    const task = approvedVkTask({
        channel: { ...approvedVkTask().channel, config: { platform: 'vk' } }
    });
    const { service, calls } = harness(task);
    const preview = await service.execute({ projectId: 10, taskId: 900, dryRun: true });
    assert.equal(preview.connector_ready, false);
    assert.equal(preview.connector_reason, 'vk_credentials_missing');
    await assert.rejects(service.execute({
        projectId: 10,
        taskId: 900,
        idempotencyKey: 'publish:vk:missing-credentials'
    }), /VK_CONNECTOR_NOT_READY/);
    assert.equal(calls.provider.length, 0);
});

test('VK provider failure stays uncertain and never writes a publication fact', async () => {
    const { service, calls } = harness(approvedVkTask(), new Error('connection lost'));
    await assert.rejects(
        service.execute({ projectId: 10, taskId: 900, idempotencyKey: 'publish:vk:900:r3' }),
        /VK_PUBLICATION_UNCERTAIN/
    );
    assert.equal(calls.facts.length, 0);
    assert.equal(calls.events.length, 1);
    assert.equal(calls.updates[calls.updates.length - 1].status, 'publishing');
});

test('strict VK provider passes a stable guid and returns validated provider identity', async () => {
    const wallCalls: any[] = [];
    const service = new VKService({
        createClient: () => ({
            upload: { wallPhoto: async () => ({ toString: () => 'photo-123_99' }) },
            api: { wall: { post: async (args: any) => { wallCalls.push(args); return { post_id: 456 }; } } }
        }),
        loadRemoteImage: async () => ({ buffer: Buffer.from('png'), filename: 'approved.png', contentType: 'image/png' })
    });
    const result = await service.publishPostWithIdentity('-123', 'token', 'Accepted VK text', 'https://cdn.example/approved.png', {
        guid: 'planner-task-900-r3'
    });
    assert.deepEqual(wallCalls, [{
        owner_id: -123,
        message: 'Accepted VK text',
        attachments: 'photo-123_99',
        guid: 'planner-task-900-r3'
    }]);
    assert.deepEqual(result, {
        ownerId: '-123',
        postId: '456',
        publishedLink: 'https://vk.com/wall-123_456'
    });
});

test('strict VK provider uploads a personal photo story and verifies its identity by readback', async () => {
    const uploadCalls: any[] = [];
    const readbackCalls: any[] = [];
    const service = new VKService({
        createClient: () => ({
            upload: {
                storiesPhoto: async (args: any) => {
                    uploadCalls.push(args);
                    return { ownerId: 42, id: 88 };
                }
            },
            api: {
                stories: {
                    getById: async (args: any) => {
                        readbackCalls.push(args);
                        return { items: [{ owner_id: 42, id: 88, is_expired: false, is_deleted: false }] };
                    }
                }
            }
        }),
        loadRemoteImage: async () => ({ buffer: Buffer.from('png'), filename: 'approved-story.png', contentType: 'image/png' })
    });

    const result = await service.publishPersonalPhotoStoryWithIdentity(
        'user-token',
        42,
        'https://cdn.example/approved-story.png'
    );

    assert.equal(uploadCalls.length, 1);
    assert.equal(uploadCalls[0].source.filename, 'approved-story.png');
    assert.equal(uploadCalls[0].group_id, undefined);
    assert.deepEqual(readbackCalls, [{ stories: '42_88', extended: 0 }]);
    assert.deepEqual(result, {
        ownerId: '42',
        storyId: '88',
        publishedLink: 'https://vk.com/story42_88',
        evidenceRef: 'https://vk.com/story42_88'
    });
});

test('strict VK personal story provider rejects a mismatched readback identity', async () => {
    const service = new VKService({
        createClient: () => ({
            upload: { storiesPhoto: async () => ({ ownerId: 42, id: 88 }) },
            api: { stories: { getById: async () => ({ items: [{ owner_id: 7, id: 88 }] }) } }
        }),
        loadRemoteImage: async () => ({ buffer: Buffer.from('png'), filename: 'approved-story.png', contentType: 'image/png' })
    });

    await assert.rejects(
        service.publishPersonalPhotoStoryWithIdentity('user-token', 42, 'https://cdn.example/approved-story.png'),
        /VK_STORY_READBACK_MISMATCH/
    );
});

test('VK personal story uses the accepted vertical asset and records story identity', async () => {
    const task = approvedVkTask({
        type: 'vk_story',
        visual_placement: 'story',
        channel: {
            ...approvedVkTask().channel,
            config: { publish_access_token: 'user-token', oauth_user_id: 42, oauth_provider: 'vk_id' }
        }
    });
    const dry = harness(task);
    const preview = await dry.service.execute({ projectId: 10, taskId: 900, dryRun: true });
    assert.equal(preview.delivery, 'vk_api_personal_story');
    assert.equal(preview.target, 'personal_profile');
    assert.equal(preview.payload_preview.has_image, true);
    assert.equal(preview.payload_preview.text, '');

    const live = harness(task);
    const result = await live.service.execute({ projectId: 10, taskId: 900, idempotencyKey: 'publish:vk-story:900:r3' });
    assert.deepEqual(live.calls.provider, [{
        projectId: 10,
        taskId: 900,
        channel: task.channel,
        imageUrl: 'https://cdn.example/approved-vk.png',
        idempotencyKey: 'publish:vk-story:900:r3'
    }]);
    assert.equal(result.external_id, 'story42_88');
    assert.equal(live.calls.facts[0].artifactKind, 'story');
    assert.equal(live.calls.facts[0].providerObjectId, 'story42_88');
});

test('VK personal story dry-run requires OAuth profile identity and an approved visual', async () => {
    const missingIdentity = approvedVkTask({
        type: 'vk_story',
        visual_placement: 'story',
        channel: { ...approvedVkTask().channel, config: { publish_access_token: 'user-token' } }
    });
    const identityHarness = harness(missingIdentity);
    const preview = await identityHarness.service.execute({ projectId: 10, taskId: 900, dryRun: true });
    assert.equal(preview.connector_ready, false);
    assert.equal(preview.connector_reason, 'vk_personal_oauth_identity_missing');

    const missingVisual = approvedVkTask({
        type: 'vk_story', visual_placement: 'story', selected_asset_id: null, selected_asset: null,
        visual_state: 'PENDING_ASSESSMENT',
        channel: { ...approvedVkTask().channel, config: { publish_access_token: 'user-token', oauth_user_id: 42 } }
    });
    await assert.rejects(
        harness(missingVisual).service.execute({ projectId: 10, taskId: 900, dryRun: true }),
        /VK_STORY_MEDIA_REQUIRED/
    );
});

test('task publisher resolves top-level VK credentials even when raw_account exists', async () => {
    const publisherService = require('../services/publisher.service').default;
    const vkService = require('../services/vk.service').default;
    const original = vkService.publishPostWithIdentity;
    const calls: any[] = [];
    vkService.publishPostWithIdentity = async (...args: any[]) => {
        calls.push(args);
        return { ownerId: '-123', postId: '456', publishedLink: 'https://vk.com/wall-123_456' };
    };
    try {
        const result = await publisherService.publishVkTask({
            projectId: 10,
            taskId: 900,
            channel: {
                ...approvedVkTask().channel,
                config: {
                    vk_id: '-123',
                    publish_access_token: 'top-level-token',
                    raw_account: { platform: 'vk' }
                }
            },
            text: '  Accepted VK publication text  ',
            imageUrl: 'https://cdn.example/approved-vk.png',
            idempotencyKey: 'publish:vk:900:r3'
        });
        assert.equal(calls[0][0], '-123');
        assert.equal(calls[0][1], 'top-level-token');
        assert.equal(calls[0][2], 'Accepted VK publication text');
        assert.equal(calls[0][3], 'https://cdn.example/approved-vk.png');
        assert.match(calls[0][4].guid, /^planner-[a-f0-9]{32}$/);
        assert.equal(result.metrics.vk_post_id, '456');
    } finally {
        vkService.publishPostWithIdentity = original;
    }
});

test('scheduled VK adapter returns provider identity and a stable retry guid', async () => {
    const publisherService = require('../services/publisher.service').default;
    const vkService = require('../services/vk.service').default;
    const original = vkService.publishPostWithIdentity;
    const calls: any[] = [];
    vkService.publishPostWithIdentity = async (...args: any[]) => {
        calls.push(args);
        return { ownerId: '-123', postId: '456', publishedLink: 'https://vk.com/wall-123_456' };
    };
    try {
        const task = approvedVkTask();
        const result = await publisherService.executeAutomatedPublicationTask(
            task,
            { publication: { body: 'Accepted VK publication text', image_url: 'https://cdn.example/approved-vk.png' } },
            task.channel.config,
            { actions: [], assets: {}, accounts: {} }
        );
        assert.equal(calls.length, 1);
        assert.equal(calls[0][0], '-123');
        assert.equal(calls[0][1], 'secret-token');
        assert.equal(calls[0][2], 'Accepted VK publication text');
        assert.equal(calls[0][3], 'https://cdn.example/approved-vk.png');
        assert.match(calls[0][4].guid, /^planner-[a-f0-9]{32}$/);
        assert.deepEqual(result, {
            adapter: 'vk',
            publishedLink: 'https://vk.com/wall-123_456',
            metrics: {
                vk_owner_id: '-123',
                vk_post_id: '456',
                vk_guid: calls[0][4].guid
            }
        });
    } finally {
        vkService.publishPostWithIdentity = original;
    }
});

test('scheduled VK story dispatches through the personal story provider instead of wall.post', async () => {
    const publisherService = require('../services/publisher.service').default;
    const original = publisherService.publishVkPersonalStory;
    const calls: any[] = [];
    publisherService.publishVkPersonalStory = async (args: any) => {
        calls.push(args);
        return {
            adapter: 'vk_story',
            deliveryMethod: 'vk_api_personal_story',
            publishedLink: 'https://vk.com/story42_88',
            evidenceRef: 'https://vk.com/story42_88',
            metrics: { vk_story_owner_id: '42', vk_story_id: '88' }
        };
    };
    try {
        const task = approvedVkTask({
            type: 'vk_story',
            visual_placement: 'story',
            channel: {
                ...approvedVkTask().channel,
                config: { publish_access_token: 'user-token', oauth_user_id: 42 }
            }
        });
        const result = await publisherService.executeAutomatedPublicationTask(
            task,
            { publication: { body: 'Not transported', image_url: 'https://cdn.example/approved-vk.png' } },
            task.channel.config,
            { actions: [], assets: {}, accounts: {} }
        );
        assert.deepEqual(calls, [{
            projectId: 10,
            taskId: 900,
            channel: task.channel,
            imageUrl: 'https://cdn.example/approved-vk.png',
            idempotencyKey: 'scheduler:vk-story:10:900:r3'
        }]);
        assert.equal(result.publishedLink, 'https://vk.com/story42_88');
    } finally {
        publisherService.publishVkPersonalStory = original;
    }
});

test('strict VK provider never drops a requested visual and rejects missing post identity', async () => {
    let postCalls = 0;
    const uploadFailure = new VKService({
        createClient: () => ({
            upload: { wallPhoto: async () => { throw new Error('upload failed'); } },
            api: { wall: { post: async () => { postCalls += 1; return { post_id: 1 }; } } }
        }),
        loadRemoteImage: async () => ({ buffer: Buffer.from('png'), filename: 'approved.png', contentType: 'image/png' })
    });
    await assert.rejects(
        uploadFailure.publishPostWithIdentity('-123', 'token', 'text', 'https://cdn.example/approved.png', { guid: 'task-900' }),
        /upload failed/
    );
    assert.equal(postCalls, 0);

    const missingIdentity = new VKService({
        createClient: () => ({
            upload: { wallPhoto: async () => ({ toString: () => 'photo-123_99' }) },
            api: { wall: { post: async () => ({}) } }
        }),
        loadRemoteImage: async () => ({ buffer: Buffer.from('png'), filename: 'approved.png', contentType: 'image/png' })
    });
    await assert.rejects(
        missingIdentity.publishPostWithIdentity('-123', 'token', 'text', undefined, { guid: 'task-900' }),
        /VK_PUBLICATION_IDENTITY_MISSING/
    );
});

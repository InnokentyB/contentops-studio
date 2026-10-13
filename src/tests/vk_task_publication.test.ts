import assert from 'node:assert/strict';
import test from 'node:test';

process.env.TELEGRAM_BOT_TOKEN ||= 'test:vk-task-publication';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_KEY ||= 'test-supabase-key';
process.env.CHANNEL_SECRETS_KEY ||= 'test-only-vk-task-publication-secret-key';

const { TelegramTaskPublicationService } = require('../services/telegram_task_publication.service');
const { VKService } = require('../services/vk.service');
const { prepareChannelConfigForStorage } = require('../utils/channel.utils');

function approvedVkTask(overrides: Record<string, any> = {}) {
    return {
        id: 900,
        project_id: 10,
        status: 'ready_for_execution',
        publication_mode: 'connector_auto',
        type: 'vk_post:publish',
        draft_text: '  Accepted VK publication text  ',
        content_revision: 3,
        accepted_revision: 3,
        text_state: 'accepted',
        visual_state: 'APPROVED',
        selected_asset_id: 18,
        quality_report: {},
        metrics: {},
        assets: {},
        channel: {
            id: 120,
            type: 'vk',
            name: 'analystcraft_vk',
            config: {
                vk_id: '-123',
                publish_access_token: 'community-token',
                user_access_token: 'user-media-token'
            }
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

test('VK task dry-run and live require the independent adapter before any provider or fact', async () => {
    const { service, calls } = harness();
    for (const dryRun of [true, false]) {
        const result = await service.execute({ projectId: 10, taskId: 900, dryRun, idempotencyKey: 'fixture-route' });
        assert.equal(result.reason, 'vk_adapter_required'); assert.equal(result.route_executable, false);
        assert.equal(result.adapter_requirement.retry_via_api, false);
    }
    assert.equal(calls.provider.length, 0); assert.equal(calls.facts.length, 0); assert.equal(calls.updates.length, 0);
});

test('VK missing API credentials never change the required independent-adapter route', async () => {
    const task = approvedVkTask({ channel: { ...approvedVkTask().channel, config: { platform: 'vk' } } });
    const { service, calls } = harness(task);
    const result = await service.execute({ projectId: 10, taskId: 900, idempotencyKey: 'fixture-route' });
    assert.equal(result.reason, 'vk_adapter_required'); assert.equal(result.connector_ready, null);
    assert.equal(calls.provider.length, 0); assert.equal(calls.updates.length, 0);
});

test('VK text-only feed with a community token is not a direct publication permission', async () => {
    const task = approvedVkTask({ selected_asset_id: null, selected_asset: null,
        channel: { ...approvedVkTask().channel, config: { vk_id: '-123', publish_access_token: 'fixture-token' } } });
    const result = await harness(task).service.execute({ projectId: 10, taskId: 900, dryRun: true });
    assert.equal(result.reason, 'vk_adapter_required'); assert.equal(result.route_executable, false);
});

test('VK image task cannot request direct API fallback when the user media token is absent', async () => {
    const task = approvedVkTask({ channel: { ...approvedVkTask().channel, config: { vk_id: '-123', publish_access_token: 'fixture-token' } } });
    const { service, calls } = harness(task);
    const result = await service.execute({ projectId: 10, taskId: 900, idempotencyKey: 'fixture-route' });
    assert.equal(result.adapter_requirement.retry_via_api, false); assert.equal(calls.provider.length, 0);
});

test('VK unavailable direct provider is never attempted or labelled uncertain by the blocked task route', async () => {
    const { service, calls } = harness(approvedVkTask(), new Error('Must not call the provider'));
    const result = await service.execute({ projectId: 10, taskId: 900, idempotencyKey: 'fixture-route' });
    assert.equal(result.mode, 'blocked'); assert.equal(calls.provider.length, 0);
    assert.equal(calls.facts.length, 0); assert.equal(calls.updates.length, 0);
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
        guid: 'planner-task-900-r3',
        mediaUploadToken: 'user-media-token'
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

test('strict VK story provider creates and verifies a native poll sticker', async () => {
    const uploadCalls: any[] = [];
    const pollCalls: any[] = [];
    const providerPoll = {
        id: 501,
        owner_id: 42,
        question: 'What should we explain next?',
        answers: [{ id: 1, text: 'Metrics' }, { id: 2, text: 'Architecture' }]
    };
    const service = new VKService({
        createClient: () => ({
            upload: {
                storiesPhoto: async (args: any) => {
                    uploadCalls.push(args);
                    return { ownerId: 42, id: 88 };
                }
            },
            api: {
                polls: {
                    create: async (args: any) => {
                        pollCalls.push(args);
                        return providerPoll;
                    }
                },
                stories: {
                    getById: async () => ({
                        items: [{
                            owner_id: 42,
                            id: 88,
                            clickable_stickers: { clickable_stickers: [{ type: 'poll', poll: providerPoll }] }
                        }]
                    })
                }
            }
        }),
        loadRemoteImage: async () => ({ buffer: Buffer.from('png'), filename: 'approved-story.png', contentType: 'image/png' })
    });

    const result = await service.publishPersonalPhotoStoryWithIdentity(
        'user-token',
        42,
        'https://cdn.example/approved-story.png',
        {
            question: ' What should we explain next? ',
            answers: ['Metrics', 'Architecture'],
            anonymous: false,
            multiple: true,
            content_revision: 3
        }
    );

    assert.deepEqual(pollCalls, [{
        owner_id: 42,
        question: 'What should we explain next?',
        add_answers: JSON.stringify(['Metrics', 'Architecture']),
        is_anonymous: false,
        is_multiple: true
    }]);
    const stickerPayload = JSON.parse(uploadCalls[0].clickable_stickers);
    assert.equal(stickerPayload.clickable_stickers[0].type, 'poll');
    assert.equal(stickerPayload.clickable_stickers[0].poll.id, 501);
    assert.deepEqual(result.poll, { ownerId: '42', pollId: '501' });
});

test('strict VK story provider rejects a missing or changed native poll readback', async () => {
    const service = new VKService({
        createClient: () => ({
            upload: { storiesPhoto: async () => ({ ownerId: 42, id: 88 }) },
            api: {
                polls: { create: async () => ({ id: 501, owner_id: 42, question: 'Q', answers: [{ text: 'A' }, { text: 'B' }] }) },
                stories: { getById: async () => ({ items: [{ owner_id: 42, id: 88, clickable_stickers: { clickable_stickers: [] } }] }) }
            }
        }),
        loadRemoteImage: async () => ({ buffer: Buffer.from('png'), filename: 'approved-story.png', contentType: 'image/png' })
    });
    await assert.rejects(
        service.publishPersonalPhotoStoryWithIdentity('token', 42, 'https://cdn.example/story.png', {
            question: 'Q', answers: ['A', 'B'], anonymous: false, multiple: false, content_revision: 3
        }),
        /VK_STORY_POLL_READBACK_MISMATCH/
    );
});

test('VK personal story retains accepted content while requiring the independent adapter', async () => {
    const task = approvedVkTask({ type: 'vk_story', visual_placement: 'story' });
    const { service, calls } = harness(task);
    const result = await service.execute({ projectId: 10, taskId: 900, idempotencyKey: 'fixture-story-route' });
    assert.equal(result.reason, 'vk_adapter_required'); assert.equal(calls.provider.length, 0);
    assert.equal(calls.facts.length, 0); assert.equal(calls.updates.length, 0);
    assert.equal(task.selected_asset_id, 18); assert.equal(task.accepted_revision, 3);
});

test('VK personal-story native poll does not bypass the independent adapter gate', async () => {
    const task = approvedVkTask({ type: 'vk_story', visual_placement: 'story', assets: { vk_story_poll: {
        question: 'Fixture?', answers: ['Yes', 'No'], content_revision: 3 } } });
    const { service, calls } = harness(task);
    const result = await service.execute({ projectId: 10, taskId: 900, idempotencyKey: 'fixture-story-poll' });
    assert.equal(result.reason, 'vk_adapter_required'); assert.equal(calls.provider.length, 0);
});

test('VK story missing OAuth or visual stays adapter-blocked and never advertises direct API readiness', async () => {
    for (const task of [approvedVkTask({ type: 'vk_story', channel: { ...approvedVkTask().channel, config: {} } }),
        approvedVkTask({ type: 'vk_story', selected_asset_id: null, selected_asset: null })]) {
        const result = await harness(task).service.execute({ projectId: 10, taskId: 900, dryRun: true });
        assert.equal(result.reason, 'vk_adapter_required'); assert.equal(result.connector_ready, null);
    }
});

test('task publisher cannot use top-level or nested VK credentials as a direct route', async () => {
    const publisherService = require('../services/publisher.service').default;
    await assert.rejects(publisherService.publishVkTask({ projectId: 10, taskId: 900,
        channel: { config: { vk_id: '-123', publish_access_token: 'fixture-token', raw_account: { platform: 'vk' } } },
        text: 'Fixture text', idempotencyKey: 'fixture-route' }), /VK_INDEPENDENT_ADAPTER_REQUIRED/);
});

test('encrypted OAuth configuration never grants direct VK story publication', async () => {
    const task = approvedVkTask({ type: 'vk_story', channel: { ...approvedVkTask().channel, config: prepareChannelConfigForStorage('vk', {
        vk_id: '-123', vk_oauth_access_token: 'fixture-access', vk_refresh_token: 'fixture-refresh', vk_device_id: 'fixture-device',
        oauth_token_profile: 'server_refreshed', oauth_user_id: 42, raw_account: { platform: 'vk' } }) } });
    const result = await harness(task).service.execute({ projectId: 10, taskId: 900, dryRun: true });
    assert.equal(result.reason, 'vk_adapter_required'); assert.equal(result.connector_ready, null);
});

test('VK personal-story facade requires the independent adapter even with configured OAuth', async () => {
    const publisherService = require('../services/publisher.service').default;
    await assert.rejects(publisherService.publishVkPersonalStory({ projectId: 10, taskId: 900,
        channel: { id: 120, config: { user_access_token: 'fixture-token', vk_oauth_access_token: 'fixture-oauth', oauth_user_id: 42 } },
        imageUrl: 'https://fixture.test/image.png', idempotencyKey: 'fixture-story-route' }), /VK_INDEPENDENT_ADAPTER_REQUIRED/);
});

test('scheduled VK feed requires the independent adapter and never calls the direct provider', async () => {
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
        assert.equal(calls.length, 0);
        assert.equal(result.success, false);
        assert.equal(result.reason, 'vk_adapter_required');
        assert.equal(result.adapter_requirement.required_route, 'planner_registered_independent_adapter');
    } finally {
        vkService.publishPostWithIdentity = original;
    }
});

test('scheduled VK story requires the independent adapter without direct provider fallback', async () => {
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
                config: { user_access_token: 'user-token', oauth_user_id: 42 }
            }
        });
        const result = await publisherService.executeAutomatedPublicationTask(
            task,
            { publication: { body: 'Not transported', image_url: 'https://cdn.example/approved-vk.png' } },
            task.channel.config,
            { actions: [], assets: {}, accounts: {} }
        );
        assert.deepEqual(calls, []);
        assert.equal(result.success, false);
        assert.equal(result.reason, 'vk_adapter_required');
        assert.equal(result.adapter_requirement.retry_via_api, false);
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
        uploadFailure.publishPostWithIdentity('-123', 'token', 'text', 'https://cdn.example/approved.png', {
            guid: 'task-900', mediaUploadToken: 'user-media-token'
        }),
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

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a, _b, _c;
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const capabilities_1 = require("../mcp/capabilities");
(_a = process.env).TELEGRAM_BOT_TOKEN || (_a.TELEGRAM_BOT_TOKEN = 'test:telegram-task-publication');
(_b = process.env).SUPABASE_URL || (_b.SUPABASE_URL = 'https://example.supabase.co');
(_c = process.env).SUPABASE_KEY || (_c.SUPABASE_KEY = 'test-supabase-key');
const { TelegramTaskPublicationService } = require('../services/telegram_task_publication.service');
function approvedTask(overrides = {}) {
    return {
        id: 779,
        project_id: 10,
        status: 'ready_for_execution',
        type: 'tg_post',
        draft_text: '  Accepted publication text  ',
        content_revision: 2,
        accepted_revision: 2,
        text_state: 'accepted',
        visual_state: 'APPROVED',
        selected_asset_id: 8,
        quality_report: {},
        metrics: {},
        published_link: null,
        telegram_message_id: null,
        channel: {
            id: 111,
            type: 'telegram',
            name: 'analystcraft',
            config: { telegram_channel_id: '-100123', channel_username: 'analystcraft' }
        },
        selected_asset: {
            id: 8,
            status: 'approved',
            content_revision: 2,
            file_url: ' https://cdn.example/approved.png ',
            alt_text: 'Approved visual'
        },
        publication_fact: {
            id: 40,
            outcome: 'blocked',
            public_url: null,
            provider_object_id: null
        },
        ...overrides
    };
}
function harness(task = approvedTask(), options = {}) {
    const calls = {
        provider: [],
        updates: [],
        events: [],
        facts: []
    };
    let currentTask = { ...task };
    const workflowEvent = {
        findUnique: async () => options.cached || null,
        create: async ({ data }) => {
            calls.events.push(data);
            return data;
        }
    };
    const contentItem = {
        findFirst: async () => currentTask,
        findUnique: async () => currentTask,
        updateMany: async ({ where, data }) => {
            if (where?.status?.in && !where.status.in.includes(currentTask.status)) {
                return { count: 0 };
            }
            calls.updates.push(data);
            currentTask = { ...currentTask, ...data };
            return { count: 1 };
        },
        update: async ({ data }) => {
            calls.updates.push(data);
            currentTask = { ...currentTask, ...data };
            return currentTask;
        }
    };
    const prisma = {
        workflowEvent,
        contentItem,
        projectMember: { findFirst: async () => ({ user_id: 2 }) },
        $transaction: async (callback) => callback({ workflowEvent, contentItem })
    };
    const publisher = {
        publishTelegramTaskMtproto: async (payload) => {
            calls.provider.push(payload);
            if (options.providerError)
                throw options.providerError;
            return {
                adapter: 'telegram',
                deliveryMethod: 'mtproto',
                publishedLink: 'https://t.me/analystcraft/779',
                metrics: { telegram_message_id: 779 }
            };
        },
        publishTelegramPersonalStoryMtproto: async (payload) => {
            calls.provider.push(payload);
            if (options.providerError)
                throw options.providerError;
            return {
                adapter: 'telegram_story',
                deliveryMethod: 'mtproto_personal_story',
                publishedLink: 'https://t.me/i/s/42',
                metrics: { telegram_story_id: 42 }
            };
        }
    };
    const facts = {
        record: async (args) => {
            calls.facts.push(args);
            return { publication_fact: { outcome: 'published', public_url: args.publicUrl } };
        }
    };
    return {
        service: new TelegramTaskPublicationService({ prisma, publisher, publicationFacts: facts }),
        calls
    };
}
(0, node_test_1.default)('Planner capability exposes task-native Telegram publication but not raw direct publication', () => {
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('planner', 'ba_publish_publication_task'), true);
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('planner', 'ba_publish_direct'), false);
});
(0, node_test_1.default)('dry-run resolves accepted text and the approved durable asset without a provider call', async () => {
    const { service, calls } = harness();
    const result = await service.execute({ projectId: 10, taskId: 779, dryRun: true });
    strict_1.default.deepEqual(result.payload_preview, {
        text: 'Accepted publication text',
        image_url: 'https://cdn.example/approved.png',
        has_image: true
    });
    strict_1.default.equal(result.delivery, 'mtproto');
    strict_1.default.equal(result.route_executable, true);
    strict_1.default.equal(calls.provider.length, 0);
    strict_1.default.equal(calls.updates.length, 0);
    strict_1.default.equal(calls.facts.length, 0);
});
(0, node_test_1.default)('personal Telegram story dry-run is distinct from channel feed delivery', async () => {
    const story = approvedTask({
        type: 'telegram:story',
        visual_placement: 'story',
        quality_report: { handoff_bundle: { poll: { supported: false } } }
    });
    const { service, calls } = harness(story);
    const result = await service.execute({ projectId: 10, taskId: 779, dryRun: true });
    strict_1.default.equal(result.delivery, 'mtproto_personal_story');
    strict_1.default.equal(result.target, 'personal_profile');
    strict_1.default.equal(result.payload_preview.image_url, 'https://cdn.example/approved.png');
    strict_1.default.equal(calls.provider.length, 0);
});
(0, node_test_1.default)('personal Telegram story publishes as self and records story identity evidence', async () => {
    const story = approvedTask({
        type: 'telegram:story',
        visual_placement: 'story',
        quality_report: { handoff_bundle: { poll: { supported: false } } }
    });
    const { service, calls } = harness(story);
    const result = await service.execute({
        projectId: 10,
        taskId: 779,
        idempotencyKey: 'publish-personal-story:779:r2'
    });
    strict_1.default.deepEqual(calls.provider, [{
            projectId: 10,
            taskId: 779,
            caption: 'Accepted publication text',
            imageUrl: 'https://cdn.example/approved.png',
            idempotencyKey: 'publish-personal-story:779:r2'
        }]);
    strict_1.default.equal(result.delivery_method, 'mtproto_personal_story');
    strict_1.default.equal(result.external_id, 42);
    strict_1.default.equal(calls.facts[0].artifactKind, 'story');
    strict_1.default.equal(calls.facts[0].providerObjectId, '42');
    strict_1.default.deepEqual(calls.facts[0].evidence, { type: 'api', ref: 'https://t.me/i/s/42' });
});
(0, node_test_1.default)('validated personal Telegram story can claim from browser_required without becoming a channel post', async () => {
    const story = approvedTask({
        status: 'browser_required',
        publication_mode: 'browser_required',
        type: 'telegram:story',
        visual_placement: 'story',
        quality_report: {
            handoff_bundle: {
                placement_contract: { poll: { supported: false, configuration_mode: 'not_supported' } }
            }
        }
    });
    const { service, calls } = harness(story);
    const result = await service.execute({
        projectId: 10,
        taskId: 779,
        idempotencyKey: 'task-779-story-publish-r2'
    });
    strict_1.default.equal(result.delivery_method, 'mtproto_personal_story');
    strict_1.default.equal(calls.provider.length, 1);
    strict_1.default.equal(calls.provider[0].channel, undefined);
    strict_1.default.equal(calls.provider[0].idempotencyKey, 'task-779-story-publish-r2');
});
(0, node_test_1.default)('browser_required feed reports a route error while a concurrent publishing state reports a claim error', async () => {
    const preview = await harness(approvedTask({ status: 'browser_required', publication_mode: 'browser_required' }))
        .service.execute({ projectId: 10, taskId: 779, dryRun: true });
    strict_1.default.equal(preview.delivery, 'mtproto');
    strict_1.default.equal(preview.route_executable, false);
    strict_1.default.equal(preview.route_blocker, 'PUBLICATION_ROUTE_NOT_EXECUTABLE');
    const concurrentPreview = await harness(approvedTask({ status: 'publishing' }))
        .service.execute({ projectId: 10, taskId: 779, dryRun: true });
    strict_1.default.equal(concurrentPreview.route_executable, false);
    strict_1.default.equal(concurrentPreview.route_blocker, 'PUBLICATION_ATTEMPT_UNCERTAIN');
    await strict_1.default.rejects(harness(approvedTask({ status: 'browser_required', publication_mode: 'browser_required' })).service.execute({
        projectId: 10,
        taskId: 779,
        idempotencyKey: 'publish-browser-feed:779'
    }), /PUBLICATION_ROUTE_NOT_EXECUTABLE/);
    await strict_1.default.rejects(harness(approvedTask({ status: 'publishing' })).service.execute({
        projectId: 10,
        taskId: 779,
        idempotencyKey: 'publish-concurrent:779'
    }), /PUBLICATION_ATTEMPT_UNCERTAIN/);
});
(0, node_test_1.default)('personal Telegram story requires approved media and keeps native polls manual', async () => {
    const noMedia = approvedTask({
        type: 'telegram:story', visual_placement: 'story',
        visual_state: 'NOT_REQUIRED', selected_asset_id: null, selected_asset: null
    });
    await strict_1.default.rejects(harness(noMedia).service.execute({ projectId: 10, taskId: 779, dryRun: true }), /TELEGRAM_STORY_MEDIA_REQUIRED/);
    const nativePoll = approvedTask({
        type: 'telegram:story', visual_placement: 'story',
        quality_report: {
            handoff_bundle: {
                placement_contract: {
                    poll: { supported: true, configuration_mode: 'native_manual' }
                }
            }
        }
    });
    await strict_1.default.rejects(harness(nativePoll).service.execute({ projectId: 10, taskId: 779, dryRun: true }), /TELEGRAM_STORY_NATIVE_POLL_MANUAL/);
});
(0, node_test_1.default)('text-only task uses the same normalized payload for dry-run and live publication', async () => {
    const textOnly = approvedTask({
        visual_state: 'NOT_REQUIRED',
        selected_asset_id: null,
        selected_asset: null,
        publication_fact: null
    });
    const dry = harness(textOnly);
    const preview = await dry.service.execute({ projectId: 10, taskId: 779, dryRun: true });
    const live = harness(textOnly);
    await live.service.execute({ projectId: 10, taskId: 779, idempotencyKey: 'publish:779:text-only' });
    strict_1.default.deepEqual(preview.payload_preview, {
        text: 'Accepted publication text',
        image_url: null,
        has_image: false
    });
    strict_1.default.equal(live.calls.provider[0].text, preview.payload_preview.text);
    strict_1.default.equal(live.calls.provider[0].imageUrl, undefined);
});
(0, node_test_1.default)('live task publication sends the same payload through MTProto and corrects a blocked fact', async () => {
    const { service, calls } = harness();
    const result = await service.execute({
        projectId: 10,
        taskId: 779,
        idempotencyKey: 'publish:779:r2'
    });
    strict_1.default.deepEqual(calls.provider, [{
            projectId: 10,
            taskId: 779,
            channel: approvedTask().channel,
            text: 'Accepted publication text',
            imageUrl: 'https://cdn.example/approved.png'
        }]);
    strict_1.default.equal(result.delivery_method, 'mtproto');
    strict_1.default.equal(result.external_id, 779);
    strict_1.default.equal(calls.events.length, 2);
    strict_1.default.equal(calls.events[0].command, 'ba_publish_publication_task_claim');
    strict_1.default.equal(calls.events[0].after_state.target, 'configured_channel');
    strict_1.default.equal(calls.facts.length, 1);
    strict_1.default.equal(calls.facts[0].outcome, 'published');
    strict_1.default.equal(calls.facts[0].providerObjectId, '779');
    strict_1.default.match(calls.facts[0].correctionReason, /blocked/i);
});
(0, node_test_1.default)('task publisher passes the normalized payload to the MTProto client with forced media upload', async () => {
    const publisherService = require('../services/publisher.service').default;
    const telegramClientService = require('../services/telegram_client.service').default;
    const originalInit = telegramClientService.init;
    const originalPublishPost = telegramClientService.publishPost;
    const calls = [];
    telegramClientService.init = async () => true;
    telegramClientService.publishPost = async (...args) => {
        calls.push(args);
        return { id: 779 };
    };
    try {
        const result = await publisherService.publishTelegramTaskMtproto({
            projectId: 10,
            taskId: 779,
            channel: approvedTask().channel,
            text: '  Accepted publication text  ',
            imageUrl: ' https://cdn.example/approved.png '
        });
        strict_1.default.deepEqual(calls[0], [
            10,
            '-100123',
            'Accepted publication text',
            'https://cdn.example/approved.png',
            undefined,
            779,
            undefined,
            { forceMediaUpload: true }
        ]);
        strict_1.default.equal(result.deliveryMethod, 'mtproto');
        strict_1.default.equal(result.publishedLink, 'https://t.me/analystcraft/779');
    }
    finally {
        telegramClientService.init = originalInit;
        telegramClientService.publishPost = originalPublishPost;
    }
});
(0, node_test_1.default)('MTProto media loader downloads an approved HTTPS image into an uploadable buffer', async () => {
    const { loadTelegramRemoteImage } = require('../services/telegram_client.service');
    const remoteFile = await loadTelegramRemoteImage('https://cdn.example/approved.png', async () => new Response(Uint8Array.from([137, 80, 78, 71]), {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': '4' }
    }));
    strict_1.default.equal(remoteFile.name, 'approved-visual.png');
    strict_1.default.equal(remoteFile.size, 4);
    strict_1.default.deepEqual([...remoteFile.buffer], [137, 80, 78, 71]);
});
(0, node_test_1.default)('MTProto media loader rejects local hosts and non-image responses', async () => {
    const { loadTelegramRemoteImage } = require('../services/telegram_client.service');
    await strict_1.default.rejects(loadTelegramRemoteImage('https://127.0.0.1/approved.png', async () => new Response()), /TELEGRAM_IMAGE_URL_FORBIDDEN/);
    await strict_1.default.rejects(loadTelegramRemoteImage('https://cdn.example/not-an-image', async () => new Response('text', { status: 200, headers: { 'content-type': 'text/plain' } })), /TELEGRAM_IMAGE_TYPE_INVALID/);
});
(0, node_test_1.default)('MTProto personal story uses self peer, deterministic random id, and provider readback', async (t) => {
    const { TelegramClientService } = require('../services/telegram_client.service');
    const { Api } = require('telegram/tl');
    const requests = [];
    const fakeClient = {
        uploadFile: async () => new Api.InputFile({ id: 1, parts: 1, name: 'story.png', md5Checksum: '' }),
        invoke: async (request) => {
            requests.push(request);
            if (request instanceof Api.stories.CanSendStory)
                return true;
            if (request instanceof Api.stories.SendStory) {
                return { updates: [new Api.UpdateStoryID({ id: 42, randomId: request.randomId })] };
            }
            if (request instanceof Api.stories.GetStoriesByID)
                return { stories: [{ id: 42 }] };
            if (request instanceof Api.stories.ExportStoryLink)
                return { link: 'https://t.me/i/s/42' };
            throw new Error(`Unexpected request ${request.className}`);
        }
    };
    const service = new TelegramClientService();
    service.getClient = async () => fakeClient;
    t.mock.method(globalThis, 'fetch', async () => new Response(Uint8Array.from([137, 80, 78, 71]), {
        status: 200,
        headers: { 'content-type': 'image/png' }
    }));
    const first = await service.publishPersonalStory({
        projectId: 10,
        caption: 'Story caption',
        imageUrl: 'https://cdn.example/story.png',
        idempotencyKey: 'story:779:r2'
    });
    strict_1.default.deepEqual(first, { storyId: 42, publicLink: 'https://t.me/i/s/42' });
    strict_1.default.ok(requests[0].peer instanceof Api.InputPeerSelf);
    strict_1.default.ok(requests[1].peer instanceof Api.InputPeerSelf);
    strict_1.default.equal(requests[1].randomId.toString(), '397729934467936089');
    strict_1.default.ok(requests[2] instanceof Api.stories.GetStoriesByID);
    strict_1.default.ok(requests[3] instanceof Api.stories.ExportStoryLink);
});
(0, node_test_1.default)('file and data assets are rejected before MTProto is called', async () => {
    for (const fileUrl of ['file:///tmp/approved.png', 'data:image/png;base64,AAAA']) {
        const { service, calls } = harness(approvedTask({
            selected_asset: { ...approvedTask().selected_asset, file_url: fileUrl }
        }));
        await strict_1.default.rejects(service.execute({ projectId: 10, taskId: 779, dryRun: true }), /APPROVED_VISUAL_NOT_SERVER_RESOLVABLE/);
        strict_1.default.equal(calls.provider.length, 0);
    }
});
(0, node_test_1.default)('missing accepted text and stale approved assets are rejected', async () => {
    await strict_1.default.rejects(harness(approvedTask({ draft_text: '   ' })).service.execute({ projectId: 10, taskId: 779, dryRun: true }), /TELEGRAM_TEXT_REQUIRED/);
    await strict_1.default.rejects(harness(approvedTask({
        selected_asset: { ...approvedTask().selected_asset, content_revision: 1 }
    })).service.execute({ projectId: 10, taskId: 779, dryRun: true }), /APPROVED_VISUAL_REQUIRED/);
});
(0, node_test_1.default)('idempotency replay returns the confirmed result without another provider call', async () => {
    const cachedResult = {
        mode: 'published',
        task_id: 779,
        published_link: 'https://t.me/analystcraft/779',
        external_id: 779,
        delivery_method: 'mtproto'
    };
    const { service, calls } = harness(approvedTask(), {
        cached: { content_item_id: 779, after_state: cachedResult }
    });
    const result = await service.execute({ projectId: 10, taskId: 779, idempotencyKey: 'publish:779:r2' });
    strict_1.default.deepEqual(result, { ...cachedResult, replayed: true });
    strict_1.default.equal(calls.provider.length, 0);
});
(0, node_test_1.default)('an uncertain provider failure creates no fact and cannot be treated as published', async () => {
    const { service, calls } = harness(approvedTask(), { providerError: new Error('connection lost') });
    await strict_1.default.rejects(service.execute({ projectId: 10, taskId: 779, idempotencyKey: 'publish:779:r2' }), /TELEGRAM_PUBLICATION_UNCERTAIN/);
    strict_1.default.equal(calls.facts.length, 0);
    strict_1.default.equal(calls.events.length, 1);
    strict_1.default.equal(calls.events[0].command, 'ba_publish_publication_task_claim');
    strict_1.default.equal(calls.updates[calls.updates.length - 1].status, 'publishing');
});

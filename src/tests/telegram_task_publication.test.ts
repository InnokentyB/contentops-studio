import assert from 'node:assert/strict';
import test from 'node:test';
import { isToolAllowedForProfile } from '../mcp/capabilities';

process.env.TELEGRAM_BOT_TOKEN ||= 'test:telegram-task-publication';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_KEY ||= 'test-supabase-key';
const { TelegramTaskPublicationService } = require('../services/telegram_task_publication.service');

function approvedTask(overrides: Record<string, any> = {}) {
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

function harness(task = approvedTask(), options: { cached?: any; providerError?: Error } = {}) {
    const calls = {
        provider: [] as any[],
        updates: [] as any[],
        events: [] as any[],
        facts: [] as any[]
    };
    let currentTask = { ...task };
    const workflowEvent = {
        findUnique: async () => options.cached || null,
        create: async ({ data }: any) => {
            calls.events.push(data);
            return data;
        }
    };
    const contentItem = {
        findFirst: async () => currentTask,
        findUnique: async () => currentTask,
        updateMany: async ({ data }: any) => {
            calls.updates.push(data);
            currentTask = { ...currentTask, ...data };
            return { count: 1 };
        },
        update: async ({ data }: any) => {
            calls.updates.push(data);
            currentTask = { ...currentTask, ...data };
            return currentTask;
        }
    };
    const prisma = {
        workflowEvent,
        contentItem,
        projectMember: { findFirst: async () => ({ user_id: 2 }) },
        $transaction: async (callback: any) => callback({ workflowEvent, contentItem })
    };
    const publisher = {
        publishTelegramTaskMtproto: async (payload: any) => {
            calls.provider.push(payload);
            if (options.providerError) throw options.providerError;
            return {
                adapter: 'telegram',
                deliveryMethod: 'mtproto',
                publishedLink: 'https://t.me/analystcraft/779',
                metrics: { telegram_message_id: 779 }
            };
        }
    };
    const facts = {
        record: async (args: any) => {
            calls.facts.push(args);
            return { publication_fact: { outcome: 'published', public_url: args.publicUrl } };
        }
    };
    return {
        service: new TelegramTaskPublicationService({ prisma, publisher, publicationFacts: facts }),
        calls
    };
}

test('Planner capability exposes task-native Telegram publication but not raw direct publication', () => {
    assert.equal(isToolAllowedForProfile('planner', 'ba_publish_publication_task'), true);
    assert.equal(isToolAllowedForProfile('planner', 'ba_publish_direct'), false);
});

test('dry-run resolves accepted text and the approved durable asset without a provider call', async () => {
    const { service, calls } = harness();
    const result = await service.execute({ projectId: 10, taskId: 779, dryRun: true });

    assert.deepEqual(result.payload_preview, {
        text: 'Accepted publication text',
        image_url: 'https://cdn.example/approved.png',
        has_image: true
    });
    assert.equal(result.delivery, 'mtproto');
    assert.equal(calls.provider.length, 0);
    assert.equal(calls.updates.length, 0);
    assert.equal(calls.facts.length, 0);
});

test('dry-run validates a browser-only channel without dispatch', async () => {
    const task = approvedTask({
        id: 865,
        channel: { id: 116, type: 'dzen', name: 'analystcraft_dzen', config: {} }
    });
    const { service, calls } = harness(task);
    const result = await service.execute({ projectId: 10, taskId: 865, dryRun: true });

    assert.equal(result.delivery, 'validated_handoff');
    assert.equal(result.direct_execution_supported, false);
    assert.equal(result.payload_preview.image_url, 'https://cdn.example/approved.png');
    assert.equal(calls.provider.length, 0);
    assert.equal(calls.updates.length, 0);
    assert.equal(calls.facts.length, 0);
});

test('text-only task uses the same normalized payload for dry-run and live publication', async () => {
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

    assert.deepEqual(preview.payload_preview, {
        text: 'Accepted publication text',
        image_url: null,
        has_image: false
    });
    assert.equal(live.calls.provider[0].text, preview.payload_preview.text);
    assert.equal(live.calls.provider[0].imageUrl, undefined);
});

test('live task publication sends the same payload through MTProto and corrects a blocked fact', async () => {
    const { service, calls } = harness();
    const result = await service.execute({
        projectId: 10,
        taskId: 779,
        idempotencyKey: 'publish:779:r2'
    });

    assert.deepEqual(calls.provider, [{
        projectId: 10,
        taskId: 779,
        channel: approvedTask().channel,
        text: 'Accepted publication text',
        imageUrl: 'https://cdn.example/approved.png'
    }]);
    assert.equal(result.delivery_method, 'mtproto');
    assert.equal(result.external_id, 779);
    assert.equal(calls.events.length, 1);
    assert.equal(calls.facts.length, 1);
    assert.equal(calls.facts[0].outcome, 'published');
    assert.equal(calls.facts[0].providerObjectId, '779');
    assert.match(calls.facts[0].correctionReason, /blocked/i);
});

test('task publisher passes the normalized payload to the MTProto client with forced media upload', async () => {
    const publisherService = require('../services/publisher.service').default;
    const telegramClientService = require('../services/telegram_client.service').default;
    const originalInit = telegramClientService.init;
    const originalPublishPost = telegramClientService.publishPost;
    const calls: any[] = [];
    telegramClientService.init = async () => true;
    telegramClientService.publishPost = async (...args: any[]) => {
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
        assert.deepEqual(calls[0], [
            10,
            '-100123',
            'Accepted publication text',
            'https://cdn.example/approved.png',
            undefined,
            779,
            undefined,
            { forceMediaUpload: true }
        ]);
        assert.equal(result.deliveryMethod, 'mtproto');
        assert.equal(result.publishedLink, 'https://t.me/analystcraft/779');
    } finally {
        telegramClientService.init = originalInit;
        telegramClientService.publishPost = originalPublishPost;
    }
});

test('MTProto media loader downloads an approved HTTPS image into an uploadable buffer', async () => {
    const { loadTelegramRemoteImage } = require('../services/telegram_client.service');
    const remoteFile = await loadTelegramRemoteImage(
        'https://cdn.example/approved.png',
        async () => new Response(Uint8Array.from([137, 80, 78, 71]), {
            status: 200,
            headers: { 'content-type': 'image/png', 'content-length': '4' }
        })
    );
    assert.equal(remoteFile.name, 'approved-visual.png');
    assert.equal(remoteFile.size, 4);
    assert.deepEqual([...remoteFile.buffer], [137, 80, 78, 71]);
});

test('MTProto media loader rejects local hosts and non-image responses', async () => {
    const { loadTelegramRemoteImage } = require('../services/telegram_client.service');
    await assert.rejects(
        loadTelegramRemoteImage('https://127.0.0.1/approved.png', async () => new Response()),
        /TELEGRAM_IMAGE_URL_FORBIDDEN/
    );
    await assert.rejects(
        loadTelegramRemoteImage(
            'https://cdn.example/not-an-image',
            async () => new Response('text', { status: 200, headers: { 'content-type': 'text/plain' } })
        ),
        /TELEGRAM_IMAGE_TYPE_INVALID/
    );
});

test('file and data assets are rejected before MTProto is called', async () => {
    for (const fileUrl of ['file:///tmp/approved.png', 'data:image/png;base64,AAAA']) {
        const { service, calls } = harness(approvedTask({
            selected_asset: { ...approvedTask().selected_asset, file_url: fileUrl }
        }));
        await assert.rejects(
            service.execute({ projectId: 10, taskId: 779, dryRun: true }),
            /APPROVED_VISUAL_NOT_SERVER_RESOLVABLE/
        );
        assert.equal(calls.provider.length, 0);
    }
});

test('missing accepted text and stale approved assets are rejected', async () => {
    await assert.rejects(
        harness(approvedTask({ draft_text: '   ' })).service.execute({ projectId: 10, taskId: 779, dryRun: true }),
        /TELEGRAM_TEXT_REQUIRED/
    );
    await assert.rejects(
        harness(approvedTask({
            selected_asset: { ...approvedTask().selected_asset, content_revision: 1 }
        })).service.execute({ projectId: 10, taskId: 779, dryRun: true }),
        /APPROVED_VISUAL_REQUIRED/
    );
});

test('idempotency replay returns the confirmed result without another provider call', async () => {
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
    assert.deepEqual(result, { ...cachedResult, replayed: true });
    assert.equal(calls.provider.length, 0);
});

test('an uncertain provider failure creates no fact and cannot be treated as published', async () => {
    const { service, calls } = harness(approvedTask(), { providerError: new Error('connection lost') });
    await assert.rejects(
        service.execute({ projectId: 10, taskId: 779, idempotencyKey: 'publish:779:r2' }),
        /TELEGRAM_PUBLICATION_UNCERTAIN/
    );
    assert.equal(calls.facts.length, 0);
    assert.equal(calls.events.length, 0);
    assert.equal(calls.updates[calls.updates.length - 1].status, 'publishing');
});

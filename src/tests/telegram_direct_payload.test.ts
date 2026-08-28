import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildTelegramDeliveryPreview,
    normalizeTelegramDeliveryPayload
} from '../services/telegram_delivery_payload';

process.env.TELEGRAM_BOT_TOKEN ||= '123456:test-token';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_KEY ||= 'test-supabase-key';

type ProviderCall = {
    kind: 'text' | 'photo';
    chatId: string | number;
    text: string;
    imageUrl?: unknown;
};

async function withMockedTelegramProvider(
    providerResult: { message_id?: number } | Error,
    run: (context: { publisherService: any; providerCalls: ProviderCall[] }) => Promise<void>
) {
    const publisherService = (await import('../services/publisher.service')).default as any;
    const telegramService = (await import('../services/telegram.service')).default as any;
    const telegramClientService = (await import('../services/telegram_client.service')).default as any;
    const providerCalls: ProviderCall[] = [];
    const originalResolve = publisherService.resolveTelegramDeliveryConfig;
    const originalCheck = publisherService.checkMTProto;
    const originalSendMessage = telegramService.sendMessage;
    const originalSendPhoto = telegramService.sendPhoto;
    const originalInspectSession = telegramClientService.inspectSessionTarget;

    publisherService.resolveTelegramDeliveryConfig = async () => ({
        rawChannelId: '-1001234567890',
        normalizedHandle: '@analystcraft',
        config: {},
        matchedChannelId: 12
    });
    const sessionTarget = {
        configured: false,
        project_id: 10,
        account_id: null,
        phone_hint: null,
        reason_code: 'project_session_missing',
        reason: 'No active Telegram account session found for this project'
    };
    telegramClientService.inspectSessionTarget = async () => sessionTarget;
    publisherService.checkMTProto = async () => ({
        available: false,
        reason: 'No active Telegram account session found for this project',
        sessionTarget
    });
    telegramService.sendMessage = async (chatId: string | number, text: string) => {
        providerCalls.push({ kind: 'text', chatId, text });
        if (providerResult instanceof Error) throw providerResult;
        return providerResult;
    };
    telegramService.sendPhoto = async (chatId: string | number, imageUrl: unknown, options: any) => {
        providerCalls.push({ kind: 'photo', chatId, text: options.caption, imageUrl });
        if (providerResult instanceof Error) throw providerResult;
        return providerResult;
    };

    try {
        await run({ publisherService, providerCalls });
    } finally {
        publisherService.resolveTelegramDeliveryConfig = originalResolve;
        publisherService.checkMTProto = originalCheck;
        telegramService.sendMessage = originalSendMessage;
        telegramService.sendPhoto = originalSendPhoto;
        telegramClientService.inspectSessionTarget = originalInspectSession;
    }
}

const channel = {
    id: 12,
    name: 'analystcraft',
    type: 'telegram',
    config: { telegram_channel_id: '-1001234567890', channel_username: 'analystcraft' }
};

test('text-only direct publication sends a non-empty normalized provider payload', async () => {
    await withMockedTelegramProvider({ message_id: 501 }, async ({ publisherService, providerCalls }) => {
        const result = await publisherService.publishDirectTelegram({
            projectId: 10,
            channel,
            text: '  Accepted text  '
        });

        assert.deepEqual(providerCalls, [{
            kind: 'text',
            chatId: '-1001234567890',
            text: 'Accepted text'
        }]);
        assert.equal(result.metrics.telegram_message_id, 501);
    });
});

test('task-779 class payload reaches the provider with accepted text and approved image', async () => {
    await withMockedTelegramProvider({ message_id: 779 }, async ({ publisherService, providerCalls }) => {
        const result = await publisherService.publishDirectTelegram({
            projectId: 10,
            channel,
            text: '  Accepted task 779 text  ',
            imageUrl: ' https://cdn.example/task-779-approved.png '
        });

        assert.deepEqual(providerCalls, [{
            kind: 'photo',
            chatId: '-1001234567890',
            text: 'Accepted task 779 text',
            imageUrl: 'https://cdn.example/task-779-approved.png'
        }]);
        assert.equal(result.metrics.telegram_message_id, 779);
    });
});

test('missing Telegram text is rejected before any provider call', async () => {
    await withMockedTelegramProvider({ message_id: 1 }, async ({ publisherService, providerCalls }) => {
        await assert.rejects(
            publisherService.publishDirectTelegram({ projectId: 10, channel, text: '   ' }),
            /TELEGRAM_TEXT_REQUIRED/
        );
        assert.equal(providerCalls.length, 0);
    });
});

test('provider response without message identity is not accepted as publication', async () => {
    await withMockedTelegramProvider({}, async ({ publisherService, providerCalls }) => {
        await assert.rejects(
            publisherService.publishDirectTelegram({ projectId: 10, channel, text: 'Accepted text' }),
            /PUBLICATION_IDENTITY_MISSING/
        );
        assert.equal(providerCalls.length, 1);
    });
});

test('failed Bot API fallback preserves the MTProto decision trace', async () => {
    await withMockedTelegramProvider(new Error('Bad Request: chat not found'), async ({ publisherService, providerCalls }) => {
        await assert.rejects(
            publisherService.publishDirectTelegram({
                projectId: 10,
                channel,
                text: 'Accepted text',
                imageUrl: 'https://cdn.example/approved.png'
            }),
            (error: any) => {
                assert.match(error.message, /chat not found/);
                assert.equal(error.routeTrace.eligibility.mtproto, false);
                assert.equal(error.routeTrace.eligibility.reason_code, 'project_session_missing');
                assert.equal(error.routeTrace.session_target.project_id, 10);
                assert.equal(error.routeTrace.session_target.account_id, null);
                assert.equal(error.routeTrace.target.value, '-1001234567890');
                assert.equal(error.routeTrace.asset_resolution.kind, 'https_url');
                assert.match(error.routeTrace.fallback_reason, /mtproto_unavailable/);
                assert.equal(error.routeTrace.final_adapter, 'bot_api');
                return true;
            }
        );
        assert.equal(providerCalls.length, 1);
    });
});

test('dry-run trace exposes a project-scoped missing session and non-server asset without dispatch', async () => {
    await withMockedTelegramProvider({ message_id: 1 }, async ({ publisherService, providerCalls }) => {
        const trace = await publisherService.inspectTelegramDirectRoute({
            projectId: 10,
            channel,
            text: 'Accepted task 827 text',
            imageUrl: 'file:///tmp/task-827-approved.png'
        });

        assert.equal(trace.eligibility.mtproto, false);
        assert.equal(trace.session_target.project_id, 10);
        assert.equal(trace.session_target.account_id, null);
        assert.equal(trace.target.value, '-1001234567890');
        assert.equal(trace.asset_resolution.has_asset, true);
        assert.equal(trace.asset_resolution.kind, 'local_path');
        assert.equal(trace.asset_resolution.resolved_url, null);
        assert.equal(trace.asset_resolution.server_resolvable, false);
        assert.equal(trace.asset_resolution.reason_code, 'asset_non_server_resolvable');
        assert.equal(trace.fallback_reason, null);
        assert.equal(trace.final_adapter, 'not_dispatched');
        assert.equal(providerCalls.length, 0);
    });
});

test('MTProto client never reuses a connected session across projects', async () => {
    const { TelegramClientService } = await import('../services/telegram_client.service');
    const service = new TelegramClientService() as any;
    const projectOneClient = { project: 1 };
    const projectTenClient = { project: 10 };
    service.client = projectOneClient;
    service.activeProjectId = 1;
    const initializedProjects: number[] = [];
    service.init = async (projectId: number) => {
        initializedProjects.push(projectId);
        service.client = projectTenClient;
        service.activeProjectId = projectId;
        return true;
    };

    const selected = await service.getClient(10);
    assert.deepEqual(initializedProjects, [10]);
    assert.equal(selected, projectTenClient);
});

test('MCP serializes a failed live Telegram route as structured error content', async () => {
    const { asTelegramRouteToolError } = await import('../mcp/shared');
    const routeTrace = {
        eligibility: { mtproto: false, bot_api_fallback: true, reason_code: 'project_session_missing', reason: 'missing' },
        session_target: { configured: false, project_id: 10, account_id: null, phone_hint: null },
        target: { value: '-1001306772661' },
        asset_resolution: { has_asset: true, kind: 'local_path', server_resolvable: false },
        fallback_reason: 'mtproto_unavailable: missing',
        final_adapter: 'bot_api'
    };
    const result = asTelegramRouteToolError({ message: 'Bad Request: chat not found', routeTrace })!;

    assert.equal(result.isError, true);
    assert.deepEqual(result.structuredContent.route_trace, routeTrace);
    assert.match(result.content[0].text, /"final_adapter": "bot_api"/);
    assert.match(result.content[0].text, /chat not found/);
});

test('dry-run preview and live adapter boundary use the same normalized payload', async () => {
    await withMockedTelegramProvider({ message_id: 808 }, async ({ publisherService, providerCalls }) => {
        const mcpPublicationService = (await import('../services/mcp_publication.service')).default as any;
        const prisma = (await import('../db')).default as any;
        const originalResolveChannel = mcpPublicationService.resolveChannel;
        const originalEventCreate = prisma.event.create;
        mcpPublicationService.resolveChannel = async () => channel;
        prisma.event.create = async () => ({ id: 1 });

        try {
            const input = {
                projectId: 10,
                channelId: 12,
                text: '  Accepted parity text  ',
                imageUrl: ' https://cdn.example/parity.png '
            };
            const dryRun = await mcpPublicationService.publishDirect({ ...input, dryRun: true });
            const live = await mcpPublicationService.publishDirect(input);
            const normalized = normalizeTelegramDeliveryPayload(input);

            assert.deepEqual(dryRun.payload_preview, {
                title: null,
                text_preview: normalized.text,
                subreddit: null,
                ...buildTelegramDeliveryPreview(normalized)
            });
            assert.deepEqual(buildTelegramDeliveryPreview(normalized), {
                text: providerCalls[0].text,
                image_url: providerCalls[0].imageUrl,
                has_image: true
            });
            assert.equal(live.external_id, 808);
            assert.equal(dryRun.route_trace.final_adapter, 'not_dispatched');
            assert.equal(dryRun.route_trace.session_target.project_id, 10);
            assert.equal(live.route_trace.final_adapter, 'bot_api');
            assert.match(live.route_trace.fallback_reason, /mtproto_unavailable/);
        } finally {
            mcpPublicationService.resolveChannel = originalResolveChannel;
            prisma.event.create = originalEventCreate;
        }
    });
});

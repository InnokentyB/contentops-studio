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
    providerResult: { message_id?: number },
    run: (context: { publisherService: any; providerCalls: ProviderCall[] }) => Promise<void>
) {
    const publisherService = (await import('../services/publisher.service')).default as any;
    const telegramService = (await import('../services/telegram.service')).default as any;
    const providerCalls: ProviderCall[] = [];
    const originalResolve = publisherService.resolveTelegramDeliveryConfig;
    const originalCheck = publisherService.checkMTProto;
    const originalSendMessage = telegramService.sendMessage;
    const originalSendPhoto = telegramService.sendPhoto;

    publisherService.resolveTelegramDeliveryConfig = async () => ({
        rawChannelId: '-1001234567890',
        normalizedHandle: '@analystcraft',
        config: {},
        matchedChannelId: 12
    });
    publisherService.checkMTProto = async () => ({ available: false, reason: 'mocked' });
    telegramService.sendMessage = async (chatId: string | number, text: string) => {
        providerCalls.push({ kind: 'text', chatId, text });
        return providerResult;
    };
    telegramService.sendPhoto = async (chatId: string | number, imageUrl: unknown, options: any) => {
        providerCalls.push({ kind: 'photo', chatId, text: options.caption, imageUrl });
        return providerResult;
    };

    try {
        await run({ publisherService, providerCalls });
    } finally {
        publisherService.resolveTelegramDeliveryConfig = originalResolve;
        publisherService.checkMTProto = originalCheck;
        telegramService.sendMessage = originalSendMessage;
        telegramService.sendPhoto = originalSendPhoto;
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
        } finally {
            mcpPublicationService.resolveChannel = originalResolveChannel;
            prisma.event.create = originalEventCreate;
        }
    });
});

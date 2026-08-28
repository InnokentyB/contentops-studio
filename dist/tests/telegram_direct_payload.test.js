"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a, _b, _c;
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const telegram_delivery_payload_1 = require("../services/telegram_delivery_payload");
(_a = process.env).TELEGRAM_BOT_TOKEN || (_a.TELEGRAM_BOT_TOKEN = '123456:test-token');
(_b = process.env).SUPABASE_URL || (_b.SUPABASE_URL = 'http://127.0.0.1:54321');
(_c = process.env).SUPABASE_KEY || (_c.SUPABASE_KEY = 'test-supabase-key');
async function withMockedTelegramProvider(providerResult, run) {
    const publisherService = (await Promise.resolve().then(() => __importStar(require('../services/publisher.service')))).default;
    const telegramService = (await Promise.resolve().then(() => __importStar(require('../services/telegram.service')))).default;
    const providerCalls = [];
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
    telegramService.sendMessage = async (chatId, text) => {
        providerCalls.push({ kind: 'text', chatId, text });
        return providerResult;
    };
    telegramService.sendPhoto = async (chatId, imageUrl, options) => {
        providerCalls.push({ kind: 'photo', chatId, text: options.caption, imageUrl });
        return providerResult;
    };
    try {
        await run({ publisherService, providerCalls });
    }
    finally {
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
(0, node_test_1.default)('text-only direct publication sends a non-empty normalized provider payload', async () => {
    await withMockedTelegramProvider({ message_id: 501 }, async ({ publisherService, providerCalls }) => {
        const result = await publisherService.publishDirectTelegram({
            projectId: 10,
            channel,
            text: '  Accepted text  '
        });
        strict_1.default.deepEqual(providerCalls, [{
                kind: 'text',
                chatId: '-1001234567890',
                text: 'Accepted text'
            }]);
        strict_1.default.equal(result.metrics.telegram_message_id, 501);
    });
});
(0, node_test_1.default)('task-779 class payload reaches the provider with accepted text and approved image', async () => {
    await withMockedTelegramProvider({ message_id: 779 }, async ({ publisherService, providerCalls }) => {
        const result = await publisherService.publishDirectTelegram({
            projectId: 10,
            channel,
            text: '  Accepted task 779 text  ',
            imageUrl: ' https://cdn.example/task-779-approved.png '
        });
        strict_1.default.deepEqual(providerCalls, [{
                kind: 'photo',
                chatId: '-1001234567890',
                text: 'Accepted task 779 text',
                imageUrl: 'https://cdn.example/task-779-approved.png'
            }]);
        strict_1.default.equal(result.metrics.telegram_message_id, 779);
    });
});
(0, node_test_1.default)('missing Telegram text is rejected before any provider call', async () => {
    await withMockedTelegramProvider({ message_id: 1 }, async ({ publisherService, providerCalls }) => {
        await strict_1.default.rejects(publisherService.publishDirectTelegram({ projectId: 10, channel, text: '   ' }), /TELEGRAM_TEXT_REQUIRED/);
        strict_1.default.equal(providerCalls.length, 0);
    });
});
(0, node_test_1.default)('provider response without message identity is not accepted as publication', async () => {
    await withMockedTelegramProvider({}, async ({ publisherService, providerCalls }) => {
        await strict_1.default.rejects(publisherService.publishDirectTelegram({ projectId: 10, channel, text: 'Accepted text' }), /PUBLICATION_IDENTITY_MISSING/);
        strict_1.default.equal(providerCalls.length, 1);
    });
});
(0, node_test_1.default)('dry-run preview and live adapter boundary use the same normalized payload', async () => {
    await withMockedTelegramProvider({ message_id: 808 }, async ({ publisherService, providerCalls }) => {
        const mcpPublicationService = (await Promise.resolve().then(() => __importStar(require('../services/mcp_publication.service')))).default;
        const prisma = (await Promise.resolve().then(() => __importStar(require('../db')))).default;
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
            const normalized = (0, telegram_delivery_payload_1.normalizeTelegramDeliveryPayload)(input);
            strict_1.default.deepEqual(dryRun.payload_preview, {
                title: null,
                text_preview: normalized.text,
                subreddit: null,
                ...(0, telegram_delivery_payload_1.buildTelegramDeliveryPreview)(normalized)
            });
            strict_1.default.deepEqual((0, telegram_delivery_payload_1.buildTelegramDeliveryPreview)(normalized), {
                text: providerCalls[0].text,
                image_url: providerCalls[0].imageUrl,
                has_image: true
            });
            strict_1.default.equal(live.external_id, 808);
        }
        finally {
            mcpPublicationService.resolveChannel = originalResolveChannel;
            prisma.event.create = originalEventCreate;
        }
    });
});

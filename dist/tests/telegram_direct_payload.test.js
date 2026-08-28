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
    const telegramClientService = (await Promise.resolve().then(() => __importStar(require('../services/telegram_client.service')))).default;
    const providerCalls = [];
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
    telegramService.sendMessage = async (chatId, text) => {
        providerCalls.push({ kind: 'text', chatId, text });
        if (providerResult instanceof Error)
            throw providerResult;
        return providerResult;
    };
    telegramService.sendPhoto = async (chatId, imageUrl, options) => {
        providerCalls.push({ kind: 'photo', chatId, text: options.caption, imageUrl });
        if (providerResult instanceof Error)
            throw providerResult;
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
        telegramClientService.inspectSessionTarget = originalInspectSession;
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
(0, node_test_1.default)('failed Bot API fallback preserves the MTProto decision trace', async () => {
    await withMockedTelegramProvider(new Error('Bad Request: chat not found'), async ({ publisherService, providerCalls }) => {
        await strict_1.default.rejects(publisherService.publishDirectTelegram({
            projectId: 10,
            channel,
            text: 'Accepted text',
            imageUrl: 'https://cdn.example/approved.png'
        }), (error) => {
            strict_1.default.match(error.message, /chat not found/);
            strict_1.default.equal(error.routeTrace.eligibility.mtproto, false);
            strict_1.default.equal(error.routeTrace.eligibility.reason_code, 'project_session_missing');
            strict_1.default.equal(error.routeTrace.session_target.project_id, 10);
            strict_1.default.equal(error.routeTrace.session_target.account_id, null);
            strict_1.default.equal(error.routeTrace.target.value, '-1001234567890');
            strict_1.default.equal(error.routeTrace.asset_resolution.kind, 'https_url');
            strict_1.default.match(error.routeTrace.fallback_reason, /mtproto_unavailable/);
            strict_1.default.equal(error.routeTrace.final_adapter, 'bot_api');
            return true;
        });
        strict_1.default.equal(providerCalls.length, 1);
    });
});
(0, node_test_1.default)('dry-run trace exposes a project-scoped missing session and non-server asset without dispatch', async () => {
    await withMockedTelegramProvider({ message_id: 1 }, async ({ publisherService, providerCalls }) => {
        const trace = await publisherService.inspectTelegramDirectRoute({
            projectId: 10,
            channel,
            text: 'Accepted task 827 text',
            imageUrl: 'file:///tmp/task-827-approved.png'
        });
        strict_1.default.equal(trace.eligibility.mtproto, false);
        strict_1.default.equal(trace.session_target.project_id, 10);
        strict_1.default.equal(trace.session_target.account_id, null);
        strict_1.default.equal(trace.target.value, '-1001234567890');
        strict_1.default.equal(trace.asset_resolution.has_asset, true);
        strict_1.default.equal(trace.asset_resolution.kind, 'local_path');
        strict_1.default.equal(trace.asset_resolution.resolved_url, null);
        strict_1.default.equal(trace.asset_resolution.server_resolvable, false);
        strict_1.default.equal(trace.asset_resolution.reason_code, 'asset_non_server_resolvable');
        strict_1.default.equal(trace.fallback_reason, null);
        strict_1.default.equal(trace.final_adapter, 'not_dispatched');
        strict_1.default.equal(providerCalls.length, 0);
    });
});
(0, node_test_1.default)('MTProto client never reuses a connected session across projects', async () => {
    const { TelegramClientService } = await Promise.resolve().then(() => __importStar(require('../services/telegram_client.service')));
    const service = new TelegramClientService();
    const projectOneClient = { project: 1 };
    const projectTenClient = { project: 10 };
    service.client = projectOneClient;
    service.activeProjectId = 1;
    const initializedProjects = [];
    service.init = async (projectId) => {
        initializedProjects.push(projectId);
        service.client = projectTenClient;
        service.activeProjectId = projectId;
        return true;
    };
    const selected = await service.getClient(10);
    strict_1.default.deepEqual(initializedProjects, [10]);
    strict_1.default.equal(selected, projectTenClient);
});
(0, node_test_1.default)('MCP serializes a failed live Telegram route as structured error content', async () => {
    const { asTelegramRouteToolError } = await Promise.resolve().then(() => __importStar(require('../mcp/shared')));
    const routeTrace = {
        eligibility: { mtproto: false, bot_api_fallback: true, reason_code: 'project_session_missing', reason: 'missing' },
        session_target: { configured: false, project_id: 10, account_id: null, phone_hint: null },
        target: { value: '-1001306772661' },
        asset_resolution: { has_asset: true, kind: 'local_path', server_resolvable: false },
        fallback_reason: 'mtproto_unavailable: missing',
        final_adapter: 'bot_api'
    };
    const result = asTelegramRouteToolError({ message: 'Bad Request: chat not found', routeTrace });
    strict_1.default.equal(result.isError, true);
    strict_1.default.deepEqual(result.structuredContent.route_trace, routeTrace);
    strict_1.default.match(result.content[0].text, /"final_adapter": "bot_api"/);
    strict_1.default.match(result.content[0].text, /chat not found/);
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
            strict_1.default.equal(dryRun.route_trace.final_adapter, 'not_dispatched');
            strict_1.default.equal(dryRun.route_trace.session_target.project_id, 10);
            strict_1.default.equal(live.route_trace.final_adapter, 'bot_api');
            strict_1.default.match(live.route_trace.fallback_reason, /mtproto_unavailable/);
        }
        finally {
            mcpPublicationService.resolveChannel = originalResolveChannel;
            prisma.event.create = originalEventCreate;
        }
    });
});

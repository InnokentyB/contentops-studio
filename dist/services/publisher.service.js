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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelegramPublicationRouteError = void 0;
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const telegram_service_1 = __importDefault(require("./telegram.service"));
const vk_service_1 = __importDefault(require("./vk.service"));
const storage_service_1 = __importDefault(require("./storage.service"));
const publication_plan_service_1 = __importDefault(require("./publication_plan.service"));
const publication_adapter_service_1 = __importDefault(require("./publication_adapter.service"));
const reddit_service_1 = __importDefault(require("./reddit.service"));
const gsc_service_1 = __importDefault(require("./gsc.service"));
const tilda_service_1 = __importDefault(require("./tilda.service"));
const linkedin_service_1 = __importDefault(require("./linkedin.service"));
const ok_service_1 = __importDefault(require("./ok.service"));
const habr_service_1 = __importDefault(require("./habr.service"));
const vc_service_1 = __importDefault(require("./vc.service"));
const dzen_service_1 = __importDefault(require("./dzen.service"));
const threads_service_1 = __importDefault(require("./threads.service"));
const art_direction_service_1 = __importDefault(require("./art_direction.service"));
const publication_runtime_helpers_1 = require("./publication_runtime.helpers");
const publication_execution_route_1 = require("./publication_execution_route");
const publication_content_state_1 = require("./publication_content_state");
const publication_fact_service_1 = __importDefault(require("./publication_fact.service"));
const telegram_delivery_payload_1 = require("./telegram_delivery_payload");
const telegram_client_service_1 = __importDefault(require("./telegram_client.service"));
const dotenv_1 = require("dotenv");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
(0, dotenv_1.config)();
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
// --- Simple File Logger ---
const LOGS_DIR = path.join(__dirname, '../../logs');
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}
const PUBLISHER_LOG_FILE = path.join(LOGS_DIR, 'publisher.log');
function logToFile(level, message, data) {
    const timestamp = new Date().toISOString();
    let logLine = `[${timestamp}] [${level}] ${message}`;
    if (data) {
        logLine += ` | ${typeof data === 'object' ? JSON.stringify(data) : data}`;
    }
    logLine += '\n';
    // Write to file
    fs.appendFileSync(PUBLISHER_LOG_FILE, logLine);
    // Also log to console
    if (level === 'ERROR')
        console.error(message, data || '');
    else if (level === 'WARN')
        console.warn(message, data || '');
    else
        console.log(message, data || '');
}
class TelegramPublicationRouteError extends Error {
    constructor(message, routeTrace) {
        super(message);
        this.routeTrace = routeTrace;
        this.name = 'TelegramPublicationRouteError';
    }
}
exports.TelegramPublicationRouteError = TelegramPublicationRouteError;
class PublisherService {
    async closeConnections() {
        await prisma.$disconnect();
        await pool.end();
    }
    async publishDirectTelegram(params) {
        const payload = (0, telegram_delivery_payload_1.normalizeTelegramDeliveryPayload)(params);
        const result = await this.executeAutomatedPublicationTask({
            id: 0,
            project_id: params.projectId,
            channel_id: params.channel.id,
            channel: params.channel,
            selected_asset: payload.imageUrl ? { file_url: payload.imageUrl } : null
        }, {
            mode: 'automatic',
            task: { action_type: 'telegram:direct' },
            publication: {
                body: payload.text,
                image_url: payload.imageUrl
            }
        }, params.channel.config || {}, { actions: [], assets: {}, accounts: {} }, params.requestHost);
        if (!result.publishedLink && !result.metrics?.telegram_message_id) {
            if (!result.routeTrace) {
                throw new Error('[PUBLICATION_IDENTITY_MISSING] Telegram provider did not confirm a message ID or permalink');
            }
            throw new TelegramPublicationRouteError('[PUBLICATION_IDENTITY_MISSING] Telegram provider did not confirm a message ID or permalink', result.routeTrace);
        }
        return result;
    }
    async inspectTelegramDirectRoute(params) {
        const payload = (0, telegram_delivery_payload_1.normalizeTelegramDeliveryPayload)(params);
        const resolved = await this.resolveTelegramDeliveryConfig({
            id: 0,
            project_id: params.projectId,
            channel: params.channel,
            metrics: {},
            assets: {}
        }, params.channel?.config || {});
        let sessionTarget;
        try {
            sessionTarget = await telegram_client_service_1.default.inspectSessionTarget(params.projectId);
        }
        catch {
            sessionTarget = {
                configured: false,
                project_id: params.projectId,
                account_id: null,
                phone_hint: null,
                reason: 'Telegram session lookup failed',
                reason_code: 'session_lookup_failed'
            };
        }
        return this.buildTelegramRouteTrace({
            projectId: params.projectId,
            resolved,
            imageUrl: payload.imageUrl || null,
            sessionTarget
        });
    }
    buildTelegramRouteTrace(params) {
        const configuredTarget = params.resolved.rawChannelId || params.resolved.normalizedHandle || null;
        const target = params.targetOverride || configuredTarget;
        const source = params.targetSourceOverride || (params.targetOverride && params.targetOverride !== configuredTarget
            ? 'local_test_override'
            : params.resolved.rawChannelId
                ? 'telegram_channel_id'
                : params.resolved.normalizedHandle
                    ? 'channel_handle'
                    : 'missing');
        const imageUrl = params.imageUrl;
        const assetKind = !imageUrl ? 'none'
            : imageUrl.startsWith('https://') ? 'https_url'
                : imageUrl.startsWith('http://') ? 'http_url'
                    : imageUrl.startsWith('data:') ? 'data_uri' : 'local_path';
        const session = params.sessionTarget || {};
        return {
            eligibility: {
                mtproto: Boolean(session.configured),
                bot_api_fallback: true,
                reason_code: session.reason_code || (session.configured ? null : 'project_session_missing'),
                reason: session.reason || null
            },
            session_target: {
                configured: Boolean(session.configured),
                project_id: Number(session.project_id || params.projectId),
                account_id: Number.isInteger(session.account_id) ? session.account_id : null,
                phone_hint: typeof session.phone_hint === 'string' ? session.phone_hint : null
            },
            target: {
                value: target,
                source,
                configured_channel_id: params.resolved.rawChannelId,
                configured_handle: params.resolved.normalizedHandle,
                matched_channel_id: params.resolved.matchedChannelId
            },
            asset_resolution: {
                has_asset: Boolean(imageUrl),
                source: imageUrl ? 'normalized_input' : 'none',
                kind: assetKind,
                resolved_url: assetKind === 'https_url' || assetKind === 'http_url' ? imageUrl : null,
                server_resolvable: assetKind === 'https_url' || assetKind === 'none',
                reason_code: imageUrl && assetKind !== 'https_url' ? 'asset_non_server_resolvable' : null
            },
            fallback_reason: null,
            final_adapter: 'not_dispatched'
        };
    }
    async publishTelegramTaskMtproto(params) {
        const payload = (0, telegram_delivery_payload_1.normalizeTelegramDeliveryPayload)(params);
        const channelConfig = this.extractTelegramAccountConfig(params.channel?.config || {});
        const rawChannelId = channelConfig.telegram_channel_id?.toString?.() || null;
        const normalizedHandle = this.normalizeTelegramHandle(channelConfig.handle || channelConfig.channel_username || params.channel?.name);
        const target = rawChannelId || normalizedHandle;
        if (!target) {
            throw new Error('[TELEGRAM_TARGET_REQUIRED] Telegram channel config has no channel ID or public handle');
        }
        const initialized = await telegram_client_service_1.default.init(params.projectId);
        if (!initialized) {
            throw new Error('[MTPROTO_UNAVAILABLE] No active Telegram MTProto session is available for the project');
        }
        const sent = await telegram_client_service_1.default.publishPost(params.projectId, target, payload.text, payload.imageUrl, undefined, params.taskId, undefined, { forceMediaUpload: true });
        const messageId = Number(sent?.id);
        if (!Number.isInteger(messageId) || messageId <= 0) {
            throw new Error('[PUBLICATION_IDENTITY_MISSING] MTProto did not confirm a Telegram message ID');
        }
        const channelUsername = normalizedHandle?.replace(/^@/, '') || null;
        const targetString = String(target);
        const publishedLink = channelUsername
            ? `https://t.me/${channelUsername}/${messageId}`
            : targetString.startsWith('-100')
                ? `https://t.me/c/${targetString.substring(4)}/${messageId}`
                : null;
        if (!publishedLink) {
            throw new Error('[PUBLICATION_IDENTITY_MISSING] MTProto message has no resolvable Telegram permalink');
        }
        return {
            adapter: 'telegram',
            deliveryMethod: 'mtproto',
            publishedLink,
            metrics: { telegram_message_id: messageId }
        };
    }
    async publishVkTask(params) {
        const text = typeof params.text === 'string' ? params.text.trim() : '';
        if (!text)
            throw new Error('[VK_TEXT_REQUIRED] VK publication text must not be empty');
        const vkConfig = this.extractVkAccountConfig(params.channel?.config || {});
        if (!vkConfig.vk_id || !vkConfig.publish_access_token) {
            throw new Error('[VK_CONNECTOR_NOT_READY] VK channel requires vk_id and publish_access_token');
        }
        const guid = `planner-${(0, crypto_1.createHash)('sha256').update(params.idempotencyKey).digest('hex').slice(0, 32)}`;
        const result = await vk_service_1.default.publishPostWithIdentity(String(vkConfig.vk_id), String(vkConfig.publish_access_token), text, params.imageUrl, { guid });
        return {
            adapter: 'vk',
            deliveryMethod: 'vk_api',
            publishedLink: result.publishedLink,
            metrics: {
                vk_owner_id: result.ownerId,
                vk_post_id: result.postId,
                vk_guid: guid
            }
        };
    }
    async routeToBrowserPublication(task, bundle, reason) {
        const now = new Date().toISOString();
        const qualityReport = {
            ...(task.quality_report || {}),
            handoff_bundle: bundle,
            publication_route: 'browser_required',
            browser_handoff: {
                reason,
                created_at: now,
                content_revision: task.content_revision
            }
        };
        await prisma.$transaction(async (tx) => {
            await tx.contentItem.update({
                where: { id: task.id },
                data: {
                    status: 'browser_required',
                    publication_mode: 'browser_required',
                    quality_report: qualityReport
                }
            });
            const dedupeKey = `browser_publish:${task.id}:r${task.content_revision}`;
            await tx.workItem.upsert({
                where: { dedupe_key: dedupeKey },
                update: {
                    state: 'available',
                    reason_code: String(reason.code || 'BROWSER_REQUIRED'),
                    note: String(reason.message || 'Browser publication is required'),
                    result_payload: reason
                },
                create: {
                    project_id: task.project_id,
                    week_package_id: task.week_package_id,
                    content_item_id: task.id,
                    item_key: task.item_key || `publication-${task.id}`,
                    kind: 'browser_publish',
                    state: 'available',
                    assignee_role: 'browser_publisher',
                    due_at: task.schedule_at || task.publish_at || new Date(),
                    reason_code: String(reason.code || 'BROWSER_REQUIRED'),
                    note: String(reason.message || 'Browser publication is required'),
                    result_payload: reason,
                    dedupe_key: dedupeKey
                }
            });
        });
        return {
            success: true,
            mode: 'browser',
            status: 'browser_required',
            adapter: task.channel?.type || task.layer || null,
            publishedLink: task.published_link || null,
            browserRequired: true,
            reason
        };
    }
    normalizeTelegramHandle(value) {
        if (typeof value !== 'string')
            return null;
        const trimmed = value.trim();
        if (!trimmed)
            return null;
        return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
    }
    extractTelegramAccountConfig(config) {
        const topLevel = config && typeof config === 'object' ? config : {};
        const raw = topLevel.raw_account && typeof topLevel.raw_account === 'object'
            ? topLevel.raw_account
            : {};
        return {
            ...topLevel,
            ...raw,
            telegram_channel_id: raw.telegram_channel_id ?? topLevel.telegram_channel_id ?? null,
            channel_username: raw.channel_username ?? topLevel.channel_username ?? null,
            handle: raw.handle ?? topLevel.handle ?? null,
            account_ref: raw.account_ref ?? topLevel.account_ref ?? null
        };
    }
    extractVkAccountConfig(config) {
        const topLevel = config && typeof config === 'object' ? config : {};
        const raw = topLevel.raw_account && typeof topLevel.raw_account === 'object'
            ? topLevel.raw_account
            : {};
        return {
            ...topLevel,
            ...raw,
            vk_id: raw.vk_id ?? topLevel.vk_id ?? null,
            publish_access_token: raw.publish_access_token
                ?? raw.api_key
                ?? topLevel.publish_access_token
                ?? topLevel.api_key
                ?? null,
            stats_access_token: raw.stats_access_token ?? topLevel.stats_access_token ?? null
        };
    }
    async resolveTelegramDeliveryConfig(task, channelConfig) {
        const baseConfig = this.extractTelegramAccountConfig(channelConfig);
        const taskAccountRef = task.metrics?.account_ref || task.assets?.account_ref || task.channel?.name || null;
        const candidates = await prisma.socialChannel.findMany({
            where: {
                project_id: task.project_id,
                type: 'telegram',
                is_active: true
            },
            select: {
                id: true,
                name: true,
                config: true
            }
        });
        const matchingSibling = candidates
            .filter((candidate) => {
            const candidateConfig = this.extractTelegramAccountConfig(candidate.config);
            const candidateAccountRef = candidateConfig.account_ref || candidate.name || null;
            return (candidate.id === task.channel?.id
                || candidate.name === task.channel?.name
                || (taskAccountRef && candidate.name === taskAccountRef)
                || (taskAccountRef && candidateAccountRef === taskAccountRef));
        })
            .map((candidate) => ({
            id: candidate.id,
            name: candidate.name,
            config: this.extractTelegramAccountConfig(candidate.config)
        }))
            .sort((left, right) => {
            const leftScore = Number(Boolean(left.config.telegram_channel_id)) * 10
                + Number(Boolean(this.normalizeTelegramHandle(left.config.handle || left.config.channel_username)));
            const rightScore = Number(Boolean(right.config.telegram_channel_id)) * 10
                + Number(Boolean(this.normalizeTelegramHandle(right.config.handle || right.config.channel_username)));
            return rightScore - leftScore;
        })[0];
        const mergedConfig = {
            ...matchingSibling?.config,
            ...baseConfig,
            telegram_channel_id: baseConfig.telegram_channel_id || matchingSibling?.config?.telegram_channel_id || null,
            handle: baseConfig.handle || matchingSibling?.config?.handle || null,
            channel_username: baseConfig.channel_username || matchingSibling?.config?.channel_username || null,
            account_ref: baseConfig.account_ref || matchingSibling?.config?.account_ref || taskAccountRef || null
        };
        const rawChannelId = mergedConfig.telegram_channel_id?.toString?.() || null;
        let normalizedHandle = this.normalizeTelegramHandle(mergedConfig.handle || mergedConfig.channel_username);
        if (!rawChannelId && !normalizedHandle) {
            const fallbackCandidate = mergedConfig.account_ref || task.channel?.name || null;
            if (fallbackCandidate) {
                normalizedHandle = this.normalizeTelegramHandle(fallbackCandidate);
                logToFile('INFO', `[Publisher] Fallback resolved Telegram handle from name/ref: ${normalizedHandle}`);
            }
        }
        return {
            config: mergedConfig,
            rawChannelId,
            normalizedHandle,
            matchedChannelId: matchingSibling?.id || task.channel?.id || null
        };
    }
    shouldRetryTelegramWithoutMarkdown(error) {
        const messageParts = [
            typeof error?.message === 'string' ? error.message : '',
            typeof error?.response?.description === 'string' ? error.response.description : '',
            typeof error?.description === 'string' ? error.description : ''
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
        return messageParts.includes("can't parse entities")
            || messageParts.includes('parse entities')
            || messageParts.includes('bad request');
    }
    isCaptionTooLongError(error) {
        const desc = error?.response?.body?.description || error?.response?.description || error?.description || error?.message || '';
        const descStr = String(desc).toUpperCase();
        return descStr.includes('MEDIA_CAPTION_TOO_LONG') || descStr.includes('CAPTION IS TOO LONG');
    }
    markdownToTelegramHtml(text) {
        if (!text)
            return '';
        let html = text;
        // Escape HTML special characters first
        html = html
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        // Headers: # Title -> <b>Title</b>
        html = html.replace(/^#+\s+(.+)$/gm, '<b>$1</b>');
        // Bold: **text** or __text__ -> <b>text</b>
        html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
        html = html.replace(/__(.*?)__/g, '<u>$1</u>'); // double underscores as underline
        // Italic: *text* or _text_ -> <i>text</i>
        html = html.replace(/\*(.*?)\*/g, '<i>$1</i>');
        // Avoid replacing underscores inside links or words
        html = html.replace(/(?<!\w)_(.*?)_(?!\w)/g, '<i>$1</i>');
        // Inline code: `code` -> <code>code</code>
        html = html.replace(/`(.*?)`/g, '<code>$1</code>');
        // Code blocks: ```code``` -> <pre>$1</pre>
        html = html.replace(/```([\s\S]*?)```/g, '<pre>$1</pre>');
        // Links: [text](url) -> <a href="url">text</a>
        html = html.replace(/\[(.*?)\]\((.*?)\)/g, (match, linkText, url) => {
            const cleanUrl = url.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
            return `<a href="${cleanUrl}">${linkText}</a>`;
        });
        return html;
    }
    getTelegramPhotoSource(imageUrl) {
        if (!imageUrl)
            return null;
        if (imageUrl.startsWith('data:')) {
            const base64Data = imageUrl.split(',')[1];
            return { source: Buffer.from(base64Data, 'base64') };
        }
        if (imageUrl.startsWith('/uploads/')) {
            const baseHost = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.PUBLIC_URL || process.env.APP_URL;
            if (baseHost) {
                const domain = baseHost.startsWith('http') ? baseHost : `https://${baseHost}`;
                return `${domain}${imageUrl}`;
            }
            const fs = require('fs');
            const path = require('path');
            const filename = imageUrl.split('/').pop();
            const localPath = path.join(__dirname, '../../uploads', filename);
            if (fs.existsSync(localPath)) {
                return { source: fs.createReadStream(localPath) };
            }
            return null;
        }
        return imageUrl;
    }
    getPublicImageUrl(postId, imageUrl, requestHost) {
        if (!imageUrl)
            return null;
        if (imageUrl.startsWith('http')) {
            return imageUrl;
        }
        const baseHost = requestHost || process.env.RAILWAY_PUBLIC_DOMAIN || process.env.PUBLIC_URL || process.env.APP_URL;
        if (baseHost) {
            const domain = baseHost.startsWith('http') ? baseHost : `https://${baseHost}`;
            return `${domain}/public/posts/${postId}/image`;
        }
        return null;
    }
    getPublicContentItemImageUrl(itemId, imageUrl, requestHost) {
        if (!imageUrl)
            return null;
        if (imageUrl.startsWith('http')) {
            return imageUrl;
        }
        if (!itemId) {
            return null;
        }
        const baseHost = requestHost || process.env.RAILWAY_PUBLIC_DOMAIN || process.env.PUBLIC_URL || process.env.APP_URL;
        if (baseHost) {
            const domain = baseHost.startsWith('http') ? baseHost : `https://${baseHost}`;
            return `${domain}/public/content-items/${itemId}/image`;
        }
        return null;
    }
    extractTelegramErrorDescription(error) {
        const responseDescription = typeof error?.response?.description === 'string'
            ? error.response.description.trim()
            : '';
        const directDescription = typeof error?.description === 'string'
            ? error.description.trim()
            : '';
        const directMessage = typeof error?.message === 'string'
            ? error.message.trim()
            : '';
        return responseDescription || directDescription || directMessage || 'Unknown Telegram error';
    }
    async sendTelegramMessageWithFallback(chatId, text, extraOptions = {}) {
        try {
            return await telegram_service_1.default.sendMessage(chatId, text, {
                parse_mode: 'HTML',
                ...extraOptions
            });
        }
        catch (error) {
            logToFile('WARN', '[Publisher] Telegram HTML message failed, retrying as plain text.', {
                chatId,
                description: error?.response?.description || error?.message || null
            });
            // Strip HTML tags for plain text fallback
            const plainText = text.replace(/<[^>]*>/g, '');
            return await telegram_service_1.default.sendMessage(chatId, plainText, { ...extraOptions });
        }
    }
    async findDependencyItems(projectId, dependencyTaskIds) {
        if (dependencyTaskIds.length === 0)
            return [];
        return prisma.contentItem.findMany({
            where: {
                project_id: projectId,
                OR: dependencyTaskIds.map((dep) => ({
                    metrics: {
                        path: ['task_id'],
                        equals: dep
                    }
                }))
            },
            select: {
                id: true,
                status: true,
                title: true,
                metrics: true,
                updated_at: true
            }
        });
    }
    async loadPublicationPlanContext(projectId) {
        const settings = await prisma.projectSettings.findMany({
            where: {
                project_id: projectId,
                key: {
                    in: [
                        'publication_plan_meta',
                        'publication_plan_assets',
                        'publication_plan_accounts',
                        'publication_plan_asset_snapshots',
                        'publication_plan_content_file_snapshots',
                        'publication_plan_ongoing_rules',
                        'publication_plan_measurement'
                    ]
                }
            }
        });
        const meta = settings.find((setting) => setting.key === 'publication_plan_meta')?.value;
        const assets = settings.find((setting) => setting.key === 'publication_plan_assets')?.value;
        const accounts = settings.find((setting) => setting.key === 'publication_plan_accounts')?.value;
        const assetSnapshots = settings.find((setting) => setting.key === 'publication_plan_asset_snapshots')?.value;
        const contentFileSnapshots = settings.find((setting) => setting.key === 'publication_plan_content_file_snapshots')?.value;
        const ongoingRules = settings.find((setting) => setting.key === 'publication_plan_ongoing_rules')?.value;
        const measurement = settings.find((setting) => setting.key === 'publication_plan_measurement')?.value;
        if (!meta || !assets || !accounts) {
            return null;
        }
        return {
            meta: JSON.parse(meta),
            assets: JSON.parse(assets),
            accounts: JSON.parse(accounts),
            asset_snapshots: assetSnapshots ? JSON.parse(assetSnapshots) : {},
            content_file_snapshots: contentFileSnapshots ? JSON.parse(contentFileSnapshots) : {},
            actions: [],
            ongoing_rules: ongoingRules ? JSON.parse(ongoingRules) : [],
            measurement: measurement ? JSON.parse(measurement) : {}
        };
    }
    resolvePlanRef(plan, ref) {
        if (!ref)
            return null;
        const parts = ref.split('.');
        let current = plan;
        for (const part of parts) {
            if (current == null)
                return null;
            current = current[part];
        }
        return current ?? null;
    }
    async getProjectGscChannel(projectId) {
        return prisma.socialChannel.findFirst({
            where: {
                project_id: projectId,
                type: 'google_search_console'
            }
        });
    }
    async evaluateBlockingConditions(task, plan) {
        const blockingConditions = (task.quality_report?.blocking_conditions || task.assets?.action?.blocking_conditions || []);
        if (blockingConditions.length === 0) {
            return { ready: true };
        }
        const dependencyTaskIds = (task.assets?.action?.dependencies || []);
        const dependencyItems = await this.findDependencyItems(task.project_id, dependencyTaskIds);
        const dependencyEntries = dependencyItems
            .map((item) => {
            const taskId = String(item.metrics?.task_id || '');
            return taskId ? [taskId, item] : null;
        })
            .filter((entry) => Boolean(entry));
        const dependencyByTaskId = new Map(dependencyEntries);
        for (const condition of blockingConditions) {
            if (condition.type === 'gsc_indexed') {
                const targetUrl = this.resolvePlanRef(plan, condition.url_ref);
                const gscChannel = await this.getProjectGscChannel(task.project_id);
                if (!targetUrl || !gscChannel) {
                    return {
                        ready: false,
                        kind: 'waiting_on_blocking_condition',
                        details: { type: 'gsc_indexed', reason: 'Missing target URL or linked GSC channel.' }
                    };
                }
                const dependencyItem = dependencyTaskIds.map((taskId) => dependencyByTaskId.get(taskId)).find(Boolean);
                if (condition.min_days_indexed && dependencyItem) {
                    const ageMs = Date.now() - new Date(dependencyItem.updated_at).getTime();
                    const requiredMs = Number(condition.min_days_indexed) * 24 * 60 * 60 * 1000;
                    if (ageMs < requiredMs) {
                        return {
                            ready: false,
                            kind: 'waiting_on_blocking_condition',
                            details: { type: 'gsc_indexed', reason: `Minimum indexed age not reached (${condition.min_days_indexed}d).` }
                        };
                    }
                }
                const inspection = await gsc_service_1.default.inspectUrl(gscChannel.config.raw_account || gscChannel.config, targetUrl).catch(() => null);
                const coverageState = inspection?.inspectionResult?.indexStatusResult?.coverageState || inspection?.inspectionResult?.indexStatusResult?.verdict || '';
                if (!String(coverageState).toLowerCase().includes('indexed') && String(coverageState).toLowerCase() !== 'pass') {
                    return {
                        ready: false,
                        kind: 'waiting_on_blocking_condition',
                        details: { type: 'gsc_indexed', reason: `GSC has not confirmed indexation yet: ${coverageState || 'unknown'}` }
                    };
                }
            }
            if (condition.type === 'url_live') {
                const targetUrl = this.resolvePlanRef(plan, condition.url_ref);
                if (!targetUrl) {
                    return {
                        ready: false,
                        kind: 'waiting_on_blocking_condition',
                        details: { type: 'url_live', reason: 'Missing target URL.' }
                    };
                }
                const response = await fetch(targetUrl, { method: 'GET' }).catch(() => null);
                if (!response?.ok) {
                    return {
                        ready: false,
                        kind: 'waiting_on_blocking_condition',
                        details: { type: 'url_live', reason: `Target URL is not live yet: ${targetUrl}` }
                    };
                }
                const dependencyItem = dependencyTaskIds.map((taskId) => dependencyByTaskId.get(taskId)).find(Boolean);
                if (condition.min_days_live && dependencyItem) {
                    const ageMs = Date.now() - new Date(dependencyItem.updated_at).getTime();
                    const requiredMs = Number(condition.min_days_live) * 24 * 60 * 60 * 1000;
                    if (ageMs < requiredMs) {
                        return {
                            ready: false,
                            kind: 'waiting_on_blocking_condition',
                            details: { type: 'url_live', reason: `Minimum live age not reached (${condition.min_days_live}d).` }
                        };
                    }
                }
            }
            if (condition.type === 'ih_posting_privileges_granted') {
                const channelConfig = task.channel?.config || {};
                const granted = channelConfig.posting_privileges_granted === true
                    || channelConfig.privileges_granted === true
                    || channelConfig.can_post === true;
                if (!granted) {
                    return {
                        ready: false,
                        kind: 'waiting_on_blocking_condition',
                        details: { type: 'ih_posting_privileges_granted', reason: 'Indie Hackers posting privileges have not been marked as granted.' }
                    };
                }
            }
        }
        return { ready: true };
    }
    async shouldReactivateDeferredTask(task, plan) {
        const trigger = task.quality_report?.reactivation_trigger || task.assets?.action?.reactivation_trigger || null;
        if (!trigger) {
            return { ready: false, reason: 'No reactivation trigger defined.' };
        }
        if (trigger === 'human_confirms_ih_posting_privileges_granted') {
            const channelConfig = task.channel?.config || {};
            const granted = channelConfig.posting_privileges_granted === true
                || channelConfig.privileges_granted === true
                || channelConfig.can_post === true;
            if (!granted) {
                return { ready: false, reason: 'Waiting for human confirmation of IH posting privileges.' };
            }
        }
        const blockingState = await this.evaluateBlockingConditions(task, plan);
        if (!blockingState.ready) {
            return { ready: false, reason: blockingState.details?.reason || 'Blocking conditions are not satisfied yet.' };
        }
        return { ready: true, reason: null };
    }
    async ensureRuleTask(projectId, rule, instanceKey, scheduleAt, extra = {}) {
        const existing = await prisma.contentItem.findFirst({
            where: {
                project_id: projectId,
                metrics: {
                    path: ['rule_instance_key'],
                    equals: instanceKey
                }
            }
        });
        if (existing) {
            return false;
        }
        await prisma.contentItem.create({
            data: {
                project_id: projectId,
                channel_id: null,
                type: `internal:${rule.action || rule.id}`,
                layer: 'internal',
                title: `Rule · ${rule.id}`,
                brief: `${rule.action || 'rule action'} triggered by ${rule.trigger}`,
                status: 'planned',
                schedule_at: scheduleAt,
                assets: {
                    source: 'ongoing_rule',
                    rule,
                    ...extra
                },
                quality_report: {
                    execution_mode: 'manual',
                    rule_id: rule.id,
                    trigger: rule.trigger
                },
                metrics: {
                    rule_id: rule.id,
                    rule_instance_key: instanceKey
                }
            }
        });
        return true;
    }
    async processPublicationOngoingRules() {
        let createdCount = 0;
        const ruleSettings = await prisma.projectSettings.findMany({
            where: { key: 'publication_plan_ongoing_rules' }
        });
        for (const ruleSetting of ruleSettings) {
            const projectId = ruleSetting.project_id;
            const plan = await this.loadPublicationPlanContext(projectId);
            if (!plan)
                continue;
            const timezone = plan.meta.timezone_default || 'UTC';
            const rules = Array.isArray(plan.ongoing_rules) ? plan.ongoing_rules : [];
            for (const rule of rules) {
                if (typeof rule?.trigger !== 'string' || !rule.id)
                    continue;
                const recurring = (0, publication_runtime_helpers_1.parseRecurringTrigger)(rule.trigger, timezone);
                if (recurring?.due) {
                    const instanceKey = `${rule.id}:${new Date().toISOString().slice(0, 10)}`;
                    const created = await this.ensureRuleTask(projectId, rule, instanceKey, recurring.scheduleAt);
                    if (created)
                        createdCount += 1;
                    continue;
                }
                if (rule.trigger.startsWith('after_action:')) {
                    const actionId = rule.trigger.replace('after_action:', '');
                    const sourceTask = await prisma.contentItem.findFirst({
                        where: {
                            project_id: projectId,
                            metrics: {
                                path: ['task_id'],
                                equals: actionId
                            },
                            status: 'published'
                        }
                    });
                    if (sourceTask) {
                        const instanceKey = `${rule.id}:${sourceTask.id}`;
                        const created = await this.ensureRuleTask(projectId, rule, instanceKey, sourceTask.updated_at, { source_task_id: sourceTask.id });
                        if (created)
                            createdCount += 1;
                    }
                    continue;
                }
                if (rule.trigger === 'after_any_linkedin_post' || rule.trigger === 'after_any_innokentiy_linkedin_post' || rule.trigger === 'after_any_publish_to_knowledge_section' || rule.trigger === 'after_any_article_publish_or_edit') {
                    const sourceItems = await prisma.contentItem.findMany({
                        where: {
                            project_id: projectId,
                            status: 'published'
                        },
                        include: { channel: true }
                    });
                    for (const sourceItem of sourceItems) {
                        const accountRef = sourceItem.metrics?.account_ref || '';
                        const publishedLink = sourceItem.published_link || '';
                        const isLinkedin = sourceItem.channel?.type === 'linkedin';
                        const isKnowledgePublish = publishedLink.includes('/knowledge/') || JSON.stringify(sourceItem.assets || {}).includes('knowledge');
                        const isArticlePublish = ['tilda:publish_article', 'tilda:publish_index_page', 'tilda:update_homepage'].includes(sourceItem.type);
                        const matches = (rule.trigger === 'after_any_linkedin_post' && isLinkedin) ||
                            (rule.trigger === 'after_any_innokentiy_linkedin_post' && isLinkedin && accountRef === 'innokentiy_linkedin') ||
                            (rule.trigger === 'after_any_publish_to_knowledge_section' && isKnowledgePublish) ||
                            (rule.trigger === 'after_any_article_publish_or_edit' && isArticlePublish);
                        if (!matches)
                            continue;
                        const instanceKey = `${rule.id}:${sourceItem.id}`;
                        const created = await this.ensureRuleTask(projectId, rule, instanceKey, sourceItem.updated_at, { source_task_id: sourceItem.id });
                        if (created)
                            createdCount += 1;
                    }
                }
            }
            const measurement = plan.measurement || {};
            const snapshotDays = Array.isArray(measurement.snapshot_days) ? measurement.snapshot_days : [];
            const cycleStart = plan.meta.cycle_start ? new Date(plan.meta.cycle_start) : null;
            if (cycleStart) {
                for (const snapshotDay of snapshotDays) {
                    const scheduleAt = new Date(cycleStart);
                    scheduleAt.setDate(scheduleAt.getDate() + Number(snapshotDay));
                    const instanceKey = `measurement:snapshot:${snapshotDay}`;
                    const created = await this.ensureRuleTask(projectId, {
                        id: `measurement-snapshot-${snapshotDay}`,
                        action: 'measurement_snapshot',
                        trigger: `day_${snapshotDay}`
                    }, instanceKey, scheduleAt, { measurement_snapshot_day: snapshotDay, measurement });
                    if (created)
                        createdCount += 1;
                }
            }
        }
        return createdCount;
    }
    async executeMeasurementSnapshot(task, plan) {
        const measurement = task.assets?.measurement || plan.measurement || {};
        const metricDefs = Array.isArray(measurement.metrics) ? measurement.metrics : [];
        const projectChannels = await prisma.socialChannel.findMany({
            where: { project_id: task.project_id }
        });
        const gscChannel = projectChannels.find((channel) => channel.type === 'google_search_console') || null;
        const results = {};
        for (const metricDef of metricDefs) {
            if (!metricDef?.id)
                continue;
            if (metricDef.source === 'gsc' && metricDef.url_ref && gscChannel) {
                const url = this.resolvePlanRef(plan, metricDef.url_ref);
                results[metricDef.id] = url
                    ? await gsc_service_1.default.queryPageMetrics(gscChannel.config.raw_account || gscChannel.config, url).catch((error) => ({ error: error.message }))
                    : { error: 'Missing URL reference' };
                continue;
            }
            if (metricDef.source === 'linkedin_analytics') {
                const linkedinTasks = await prisma.contentItem.findMany({
                    where: {
                        project_id: task.project_id,
                        status: 'published',
                        channel: { type: 'linkedin' }
                    },
                    include: { channel: true }
                });
                results[metricDef.id] = await Promise.all(linkedinTasks.map(async (item) => {
                    const config = item.channel?.config || {};
                    if (!config.linkedin_urn || !config.access_token || !item.published_link) {
                        return { task_id: item.metrics?.task_id || null, error: 'Missing LinkedIn credentials or link.' };
                    }
                    const metrics = await linkedin_service_1.default.getMetrics(config.linkedin_urn, config.access_token, item.published_link).catch((error) => ({ error: error.message }));
                    return {
                        task_id: item.metrics?.task_id || null,
                        title: item.title,
                        metrics
                    };
                }));
                continue;
            }
            if (metricDef.source === 'reddit') {
                const redditTasks = await prisma.contentItem.findMany({
                    where: {
                        project_id: task.project_id,
                        status: 'published',
                        channel: { type: 'reddit' }
                    }
                });
                results[metricDef.id] = await Promise.all(redditTasks.map(async (item) => ({
                    task_id: item.metrics?.task_id || null,
                    title: item.title,
                    metrics: item.published_link
                        ? await reddit_service_1.default.getPostMetrics(item.published_link).catch((error) => ({ error: error.message }))
                        : { error: 'Missing Reddit permalink.' }
                })));
                continue;
            }
            results[metricDef.id] = { unsupported: true, source: metricDef.source };
        }
        return results;
    }
    async executeGscHealthAudit(task, plan) {
        const projectChannels = await prisma.socialChannel.findMany({
            where: { project_id: task.project_id }
        });
        const gscChannel = projectChannels.find((channel) => channel.type === 'google_search_console') || null;
        if (!gscChannel) {
            return { error: 'No Google Search Console channel configured.' };
        }
        const candidateUrls = Object.values(plan.assets || {})
            .map((asset) => asset?.target_url)
            .filter((url) => typeof url === 'string' && url.startsWith('https://'));
        const uniqueUrls = Array.from(new Set(candidateUrls));
        const inspections = await Promise.all(uniqueUrls.map(async (url) => ({
            url,
            inspection: await gsc_service_1.default.inspectUrl(gscChannel.config.raw_account || gscChannel.config, url).catch((error) => ({ error: error.message }))
        })));
        return {
            checked_urls: inspections.length,
            inspections
        };
    }
    async executeMediumCanonicalVerification(task, plan) {
        const sourceTaskId = task.assets?.source_task_id;
        const sourceTask = sourceTaskId
            ? await prisma.contentItem.findUnique({ where: { id: sourceTaskId } })
            : null;
        const mediumTask = sourceTask || await prisma.contentItem.findFirst({
            where: {
                project_id: task.project_id,
                type: 'medium:republish_with_canonical',
                status: 'published'
            },
            orderBy: { updated_at: 'desc' }
        });
        if (!mediumTask?.published_link) {
            return { error: 'No published Medium task found for canonical verification.' };
        }
        const response = await fetch(mediumTask.published_link).catch(() => null);
        if (!response?.ok) {
            return { error: `Unable to fetch Medium page: ${mediumTask.published_link}` };
        }
        const html = await response.text();
        const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
        const actualCanonical = canonicalMatch?.[1] || null;
        const expectedCanonical = this.resolvePlanRef(plan, 'assets.article_blog.target_url');
        return {
            medium_url: mediumTask.published_link,
            expected_canonical: expectedCanonical,
            actual_canonical: actualCanonical,
            valid: Boolean(actualCanonical && expectedCanonical && actualCanonical === expectedCanonical)
        };
    }
    async executeInternalLinkCrawl(task, plan) {
        const candidateUrls = Object.values(plan.assets || {})
            .map((asset) => asset?.target_url)
            .filter((url) => typeof url === 'string' && url.startsWith('https://seturon.com'));
        const uniqueUrls = Array.from(new Set(candidateUrls));
        const results = await Promise.all(uniqueUrls.map(async (url) => {
            const response = await fetch(url).catch(() => null);
            if (!response?.ok) {
                return { url, ok: false, status: response?.status || null };
            }
            const html = await response.text();
            const internalLinks = Array.from(html.matchAll(/href=["'](https:\/\/seturon\.com[^"']+)["']/g)).map((match) => match[1]);
            return {
                url,
                ok: true,
                status: response.status,
                internal_link_count: internalLinks.length
            };
        }));
        return {
            checked_urls: results.length,
            results
        };
    }
    async markInternalTaskAsManual(task, reason) {
        await prisma.contentItem.update({
            where: { id: task.id },
            data: {
                status: 'awaiting_manual_publication',
                quality_report: {
                    ...(task.quality_report || {}),
                    execution_result: {
                        mode: 'manual_required',
                        reason
                    },
                    prepared_at: new Date().toISOString()
                }
            }
        });
    }
    async createGeneratedPublicationTask(params) {
        return prisma.contentItem.create({
            data: {
                project_id: params.projectId,
                channel_id: params.channelId,
                type: params.type,
                layer: params.layer,
                title: params.title,
                brief: params.brief,
                draft_text: params.draftText || null,
                status: 'planned',
                schedule_at: params.scheduleAt || null,
                cross_link_to: params.sourceTaskId ? [params.sourceTaskId] : [],
                assets: {
                    source: 'ongoing_rule_generated',
                    action: params.action,
                    account_ref: params.accountRef || null,
                    asset_refs: params.assetRefs || [],
                    source_task_id: params.sourceTaskId || null
                },
                quality_report: {
                    execution_mode: 'manual',
                    generated_by_rule: true,
                    blocking_conditions: params.action?.blocking_conditions || [],
                    human_review: params.action?.human_review !== false,
                    human_review_reason: params.action?.human_review_reason || null,
                    display_name: params.action?.display_name || params.title
                },
                metrics: {
                    rule_generated: true,
                    task_id: params.action?.id || null,
                    task_display_name: params.action?.display_name || params.title,
                    account_ref: params.accountRef || null,
                    ...(params.extraMetrics || {})
                }
            }
        });
    }
    async executeBrandRepostRule(task, plan) {
        const sourceTaskId = task.assets?.source_task_id;
        const sourceTask = sourceTaskId ? await prisma.contentItem.findUnique({ where: { id: sourceTaskId } }) : null;
        if (!sourceTask?.published_link) {
            return { skipped: true, reason: 'Source LinkedIn post is missing or not published yet.' };
        }
        const sourceAction = sourceTask.assets?.action || {};
        const sourceAssets = sourceTask.assets?.resolved_assets || [];
        const sourceAngle = sourceAssets.find((assetEntry) => assetEntry?.asset?.angle)?.asset?.angle || null;
        const exclusions = Array.isArray(task.assets?.rule?.exclusions) ? task.assets.rule.exclusions : [];
        if (exclusions.some((exclusion) => exclusion.angle === sourceAngle)) {
            return { skipped: true, reason: `Source angle \`${sourceAngle}\` is excluded from brand reposts.` };
        }
        const brandChannel = await prisma.socialChannel.findFirst({
            where: {
                project_id: task.project_id,
                type: 'linkedin',
                config: {
                    path: ['raw_account', 'type'],
                    equals: 'company_page'
                }
            }
        }) || await prisma.socialChannel.findFirst({
            where: {
                project_id: task.project_id,
                type: 'linkedin'
            }
        });
        if (!brandChannel) {
            return { skipped: true, reason: 'No LinkedIn brand page channel is configured.' };
        }
        const frameTemplate = task.assets?.rule?.repost_frame_template || 'From our founder: {one_or_two_sentence_relevance_for_creators}';
        const draftText = `${frameTemplate}\n\nSource post: ${sourceTask.published_link}`;
        const scheduledAt = new Date(sourceTask.updated_at.getTime() + 2 * 60 * 60 * 1000);
        const generatedActionId = `rule-repost-${sourceTask.id}`;
        const createdTask = await this.createGeneratedPublicationTask({
            projectId: task.project_id,
            channelId: brandChannel.id,
            type: 'linkedin:repost_with_frame',
            layer: 'linkedin',
            title: `LinkedIn Seturon page — Repost founder post: ${sourceTask.title || sourceAction.id || sourceTask.id}`,
            brief: 'Brand repost generated from founder post per ongoing rule.',
            scheduleAt: scheduledAt,
            draftText,
            sourceTaskId: sourceTask.id,
            accountRef: brandChannel.name,
            action: {
                id: generatedActionId,
                display_name: `LinkedIn Seturon page — Repost founder post`,
                channel: 'linkedin',
                action_type: 'repost_with_frame',
                account_ref: brandChannel.name,
                scheduled_date: scheduledAt.toISOString().slice(0, 10),
                scheduled_time_window: null,
                human_review: true,
                human_review_reason: task.assets?.rule?.human_review_reason || 'Approve brand frame before reposting.',
                parameters: {
                    repost_source_url: sourceTask.published_link,
                    frame_template: frameTemplate
                },
                asset_refs: []
            },
            extraMetrics: {
                rule_generated_from_source_task: sourceTask.id
            }
        });
        return {
            created_task_id: createdTask.id,
            source_task_id: sourceTask.id
        };
    }
    async executeBrandRotationRule(task, plan) {
        const rule = task.assets?.rule || {};
        const slots = Array.isArray(rule.rotation_slots_in_order) && rule.rotation_slots_in_order.length > 0
            ? rule.rotation_slots_in_order
            : ['A', 'B', 'C', 'D'];
        const stateKey = 'brand_rotation_current_slot';
        const storedState = await prisma.projectSettings.findUnique({
            where: {
                project_id_key: {
                    project_id: task.project_id,
                    key: stateKey
                }
            }
        });
        const currentSlot = storedState?.value || slots[0];
        const assetEntry = Object.entries(plan.assets || {}).find(([, asset]) => asset?.rotation_slot === currentSlot);
        if (!assetEntry) {
            return { skipped: true, reason: `No asset found for brand rotation slot ${currentSlot}.` };
        }
        const [assetRef, asset] = assetEntry;
        const brandChannel = await prisma.socialChannel.findFirst({
            where: {
                project_id: task.project_id,
                type: 'linkedin',
                config: {
                    path: ['raw_account', 'type'],
                    equals: 'company_page'
                }
            }
        }) || await prisma.socialChannel.findFirst({
            where: {
                project_id: task.project_id,
                type: 'linkedin'
            }
        });
        if (!brandChannel) {
            return { skipped: true, reason: 'No LinkedIn brand page channel is configured.' };
        }
        const existingGenerated = await prisma.contentItem.findFirst({
            where: {
                project_id: task.project_id,
                metrics: {
                    path: ['rule_generated_rotation_slot'],
                    equals: currentSlot
                },
                status: { in: ['planned', 'ready_for_execution', 'awaiting_manual_publication', 'published'] }
            }
        });
        if (existingGenerated) {
            return { skipped: true, reason: `A task for rotation slot ${currentSlot} already exists.` };
        }
        const nextIndex = (slots.indexOf(currentSlot) + 1) % slots.length;
        const nextSlot = slots[nextIndex] || slots[0];
        const scheduleAt = task.schedule_at || new Date();
        const createdTask = await this.createGeneratedPublicationTask({
            projectId: task.project_id,
            channelId: brandChannel.id,
            type: 'linkedin:post_with_comment_link',
            layer: 'linkedin',
            title: `LinkedIn Seturon page — Rotation slot ${currentSlot}`,
            brief: `Brand page post draft prepared for rotation slot ${currentSlot}.`,
            scheduleAt,
            sourceTaskId: null,
            accountRef: brandChannel.name,
            assetRefs: [assetRef],
            action: {
                id: `rule-brand-slot-${currentSlot}-${scheduleAt.toISOString().slice(0, 10)}`,
                display_name: `LinkedIn Seturon page — Rotation slot ${currentSlot}`,
                channel: 'linkedin',
                action_type: 'post_with_comment_link',
                account_ref: brandChannel.name,
                scheduled_date: scheduleAt.toISOString().slice(0, 10),
                scheduled_time_window: null,
                human_review: true,
                human_review_reason: rule.human_review_reason || 'Approve brand-page post draft before publishing.',
                parameters: {
                    post_body_source: asset.section_marker || asset.path,
                    link_location: 'first_comment_only',
                    link_url_ref: asset.links_to ? `assets.${asset.links_to}.target_url` : null,
                    rotation_slot_used: currentSlot,
                    rotation_slot_next: nextSlot
                },
                asset_refs: [assetRef]
            },
            extraMetrics: {
                rule_generated_rotation_slot: currentSlot
            }
        });
        await prisma.projectSettings.upsert({
            where: {
                project_id_key: {
                    project_id: task.project_id,
                    key: stateKey
                }
            },
            update: { value: nextSlot },
            create: {
                project_id: task.project_id,
                key: stateKey,
                value: nextSlot
            }
        });
        return {
            created_task_id: createdTask.id,
            used_slot: currentSlot,
            next_slot: nextSlot
        };
    }
    async executeKnowledgeHubRule(task, plan) {
        const sourceTaskId = task.assets?.source_task_id;
        const sourceTask = sourceTaskId ? await prisma.contentItem.findUnique({ where: { id: sourceTaskId } }) : null;
        if (!sourceTask) {
            return { skipped: true, reason: 'Source knowledge task not found.' };
        }
        const hubAsset = (plan.assets || {}).knowledge_hub_page;
        if (!hubAsset) {
            return { skipped: true, reason: 'knowledge_hub_page asset is missing from the plan.' };
        }
        const tildaChannel = await prisma.socialChannel.findFirst({
            where: {
                project_id: task.project_id,
                type: 'tilda'
            }
        });
        if (!tildaChannel) {
            return { skipped: true, reason: 'No Tilda channel is configured.' };
        }
        const sourceAction = sourceTask.assets?.action || {};
        const publishedUrl = sourceTask.published_link || this.resolvePlanRef(plan, sourceAction.asset_refs?.[0] ? `assets.${sourceAction.asset_refs[0]}.target_url` : null);
        const createdTask = await this.createGeneratedPublicationTask({
            projectId: task.project_id,
            channelId: tildaChannel.id,
            type: 'tilda:append_article_card_to_knowledge_hub',
            layer: 'tilda',
            title: `Tilda — Update knowledge hub after ${sourceTask.title || sourceTask.id}`,
            brief: 'Append the newly published knowledge article to the /knowledge/ hub page.',
            scheduleAt: new Date(),
            sourceTaskId: sourceTask.id,
            accountRef: tildaChannel.name,
            assetRefs: ['knowledge_hub_page'],
            action: {
                id: `rule-knowledge-hub-${sourceTask.id}`,
                display_name: `Tilda — Append article card to /knowledge/ hub`,
                channel: 'tilda',
                action_type: 'append_article_card_to_knowledge_hub',
                account_ref: tildaChannel.name,
                scheduled_date: new Date().toISOString().slice(0, 10),
                scheduled_time_window: null,
                human_review: true,
                human_review_reason: task.assets?.rule?.human_review_reason || 'Confirm category placement before updating the hub page.',
                parameters: {
                    target_asset_ref: 'knowledge_hub_page',
                    article_url: publishedUrl,
                    article_title: sourceTask.title
                },
                asset_refs: ['knowledge_hub_page']
            },
            extraMetrics: {
                rule_generated_from_source_task: sourceTask.id,
                target_url: hubAsset.target_url
            }
        });
        return {
            created_task_id: createdTask.id,
            source_task_id: sourceTask.id
        };
    }
    async processOperationalTasks() {
        let processedCount = 0;
        const tasks = await prisma.contentItem.findMany({
            where: {
                layer: 'internal',
                status: { in: ['planned', 'ready_for_execution'] },
                OR: [
                    { schedule_at: null },
                    { schedule_at: { lte: new Date() } }
                ]
            }
        });
        for (const task of tasks) {
            const plan = await this.loadPublicationPlanContext(task.project_id);
            if (!plan)
                continue;
            const rule = task.assets?.rule || {};
            const action = (rule.action || '').toString();
            let result = null;
            try {
                if (action === 'measurement_snapshot') {
                    result = await this.executeMeasurementSnapshot(task, plan);
                }
                else if (action === 'check_gsc_errors_on_published_urls') {
                    result = await this.executeGscHealthAudit(task, plan);
                }
                else if (action === 'verify_medium_canonical_via_gsc_url_inspection') {
                    result = await this.executeMediumCanonicalVerification(task, plan);
                }
                else if (action === 'crawl_internal_link_graph') {
                    result = await this.executeInternalLinkCrawl(task, plan);
                }
                else if (action === 'repost_with_brand_frame') {
                    result = await this.executeBrandRepostRule(task, plan);
                }
                else if (action === 'prepare_brand_page_post_for_current_rotation_slot') {
                    result = await this.executeBrandRotationRule(task, plan);
                }
                else if (action === 'append_article_card_to_knowledge_hub') {
                    result = await this.executeKnowledgeHubRule(task, plan);
                }
                else {
                    await this.markInternalTaskAsManual(task, `No automated executor is implemented for ongoing rule action \`${action}\`.`);
                    continue;
                }
                await prisma.contentItem.update({
                    where: { id: task.id },
                    data: {
                        status: 'published',
                        quality_report: {
                            ...(task.quality_report || {}),
                            execution_result: result,
                            executed_at: new Date().toISOString()
                        },
                        metrics: {
                            ...(task.metrics || {}),
                            execution_summary: result
                        }
                    }
                });
                processedCount += 1;
            }
            catch (error) {
                await prisma.contentItem.update({
                    where: { id: task.id },
                    data: {
                        status: 'failed',
                        quality_report: {
                            ...(task.quality_report || {}),
                            execution_error: error.message || String(error),
                            executed_at: new Date().toISOString()
                        }
                    }
                });
            }
        }
        return processedCount;
    }
    async processDeferredPublicationTasks() {
        let reactivatedCount = 0;
        const deferredTasks = await prisma.contentItem.findMany({
            where: {
                status: 'deferred',
                assets: { not: undefined }
            },
            include: {
                channel: true
            }
        });
        for (const task of deferredTasks) {
            const plan = await this.loadPublicationPlanContext(task.project_id);
            if (!plan)
                continue;
            const reactivation = await this.shouldReactivateDeferredTask(task, plan);
            if (!reactivation.ready) {
                await prisma.contentItem.update({
                    where: { id: task.id },
                    data: {
                        quality_report: {
                            ...(task.quality_report || {}),
                            last_reactivation_check_at: new Date().toISOString(),
                            reactivation_wait_reason: reactivation.reason
                        }
                    }
                });
                continue;
            }
            await prisma.contentItem.update({
                where: { id: task.id },
                data: {
                    status: 'planned',
                    quality_report: {
                        ...(task.quality_report || {}),
                        reactivated_at: new Date().toISOString(),
                        reactivation_wait_reason: null
                    }
                }
            });
            reactivatedCount += 1;
        }
        return reactivatedCount;
    }
    async processPublicationTasks() {
        const now = new Date();
        const staleAttemptCutoff = new Date(now.getTime() - 30 * 60 * 1000);
        const dueTasks = await prisma.contentItem.findMany({
            where: {
                schedule_at: { lte: now },
                publication_mode: { not: 'browser_required' },
                type: { not: 'week_theme' },
                OR: [
                    { assets: { not: undefined } },
                    { item_key: { startsWith: 'week-topic:' } }
                ],
                AND: [{ OR: [
                            { status: { in: ['planned', 'ready_for_execution'] } },
                            {
                                status: 'publishing',
                                publication_mode: 'connector_auto',
                                updated_at: { lte: staleAttemptCutoff }
                            }
                        ] }]
            },
            include: { channel: true, publication_fact: true, selected_asset: true }
        });
        if (dueTasks.length === 0) {
            return 0;
        }
        for (const task of dueTasks) {
            try {
                await this.processPublicationTaskItem(task);
            }
            catch (error) {
                logToFile('ERROR', `[Publisher] Failed to process publication task ${task.id}`, error);
            }
        }
        return dueTasks.length;
    }
    async processPublicationTaskNow(taskId, requestHost) {
        const task = await prisma.contentItem.findUnique({
            where: { id: taskId },
            include: { channel: true, publication_fact: true, selected_asset: true }
        });
        if (!task) {
            throw new Error(`Publication task ${taskId} not found`);
        }
        if (task.status === 'published') {
            throw new Error('This publication task is already published');
        }
        if (task.status === 'deferred' || task.status === 'skipped') {
            throw new Error(`This publication task cannot be executed from status '${task.status}'`);
        }
        return this.processPublicationTaskItem(task, { manualTrigger: true, requestHost });
    }
    async processPublicationTaskItem(task, options = {}) {
        const visualReadiness = await art_direction_service_1.default.getReadiness(task.project_id, task.id);
        if (!visualReadiness.ready) {
            if (options.manualTrigger)
                throw new Error(`[VISUAL_GATE_BLOCKED] ${visualReadiness.reason}`);
            logToFile('INFO', `[Publisher] Task ${task.id} is waiting on visual readiness.`, visualReadiness);
            return { success: false, status: task.status, skipped: true, reason: visualReadiness.reason };
        }
        const dependencyState = await this.areTaskDependenciesSatisfied(task);
        if (!dependencyState.ready) {
            if (options.manualTrigger) {
                if (dependencyState.kind === 'waiting_on_deferred') {
                    throw new Error('Task is blocked by a deferred dependency');
                }
                if (dependencyState.kind === 'blocked_by_skipped') {
                    throw new Error('Task is blocked by a skipped dependency');
                }
                throw new Error('Task dependencies are not satisfied yet');
            }
            if (dependencyState.kind === 'waiting_on_deferred') {
                logToFile('INFO', `[Publisher] Task ${task.id} is parked because a dependency is deferred.`, dependencyState.details);
            }
            else if (dependencyState.kind === 'blocked_by_skipped') {
                logToFile('WARN', `[Publisher] Task ${task.id} is blocked because a dependency was skipped.`, dependencyState.details);
            }
            return { success: false, status: task.status, skipped: true };
        }
        const plan = await this.loadPublicationPlanContext(task.project_id);
        const blockingState = plan ? await this.evaluateBlockingConditions(task, plan) : { ready: true };
        if (!blockingState.ready) {
            if (options.manualTrigger) {
                throw new Error('Task is waiting on blocking conditions');
            }
            logToFile('INFO', `[Publisher] Task ${task.id} is waiting on blocking conditions.`, blockingState.details);
            return { success: false, status: task.status, skipped: true };
        }
        const action = task.assets?.action;
        if (plan)
            plan.actions = action ? [action] : [];
        const bundle = plan && action
            ? publication_plan_service_1.default.buildHandoffBundle(plan, task)
            : publication_plan_service_1.default.buildGeneratedContentItemHandoff(task);
        const channelConfig = task.channel?.config || {};
        const executionMode = bundle.mode;
        const rawAccount = channelConfig.raw_account || channelConfig || {};
        const directExecutionSupported = publication_adapter_service_1.default.supportsDirectExecution({
            ...channelConfig,
            ...rawAccount,
            platform: rawAccount.platform || task.channel?.type
        });
        const route = (0, publication_execution_route_1.resolvePublicationExecutionRoute)({
            contentReady: (0, publication_content_state_1.derivePublicationContentState)(task) === 'ready',
            visualReady: visualReadiness.ready,
            due: !task.schedule_at || new Date(task.schedule_at).getTime() <= Date.now(),
            published: (0, publication_content_state_1.derivePublicationContentState)(task) === 'published',
            executionMode,
            directExecutionSupported,
            publicationMode: task.publication_mode
        });
        if (task.status === 'publishing') {
            return this.routeToBrowserPublication(task, bundle, {
                code: 'CONNECTOR_ATTEMPT_STALE',
                message: 'The connector attempt did not finish. Verify in the browser before publishing to avoid a duplicate post.',
                retry_via_api: false,
                next_route: 'browser_required'
            });
        }
        if (route === 'waiting' || route === 'published') {
            return { success: false, status: task.status, skipped: true, reason: route };
        }
        if (route === 'browser_required') {
            return this.routeToBrowserPublication(task, bundle, {
                code: directExecutionSupported ? 'MANUAL_EXECUTION_REQUIRED' : 'CONNECTOR_NOT_AVAILABLE',
                message: directExecutionSupported
                    ? 'Publication policy requires an authenticated browser flow.'
                    : `No direct publication connector is available for ${task.channel?.type || 'this channel'}.`,
                retry_via_api: false,
                next_route: 'browser_required'
            });
        }
        const claimed = await prisma.contentItem.updateMany({
            where: {
                id: task.id,
                status: { in: ['planned', 'ready_for_execution'] },
                publication_mode: { not: 'browser_required' }
            },
            data: {
                status: 'publishing',
                publication_mode: 'connector_auto',
                quality_report: {
                    ...(task.quality_report || {}),
                    handoff_bundle: bundle,
                    publication_route: 'connector_auto',
                    connector_attempt_started_at: new Date().toISOString()
                }
            }
        });
        if (claimed.count !== 1) {
            if (options.manualTrigger)
                throw new Error('[PUBLICATION_ALREADY_CLAIMED] Publication task is already being processed');
            return { success: false, status: task.status, skipped: true, reason: 'already_claimed' };
        }
        let automatedResult;
        try {
            automatedResult = await this.executeAutomatedPublicationTask(task, bundle, channelConfig, plan || { actions: [], assets: {}, accounts: {} }, options.requestHost);
            if (automatedResult.manualFallback) {
                return this.routeToBrowserPublication(task, bundle, {
                    code: 'CONNECTOR_NOT_AVAILABLE',
                    message: automatedResult.reason || 'The connector requires browser publication.',
                    retry_via_api: false,
                    next_route: 'browser_required'
                });
            }
            if (task.channel?.type === 'telegram'
                && !automatedResult.publishedLink
                && !automatedResult.metrics?.telegram_message_id) {
                throw new Error('[PUBLICATION_IDENTITY_MISSING] Telegram provider did not confirm a message ID or permalink');
            }
            if (task.channel?.type === 'vk') {
                const ownerId = String(automatedResult.metrics?.vk_owner_id || '').trim();
                const postId = String(automatedResult.metrics?.vk_post_id || '').trim();
                const expectedLink = ownerId && postId ? `https://vk.com/wall${ownerId}_${postId}` : null;
                if (!expectedLink || automatedResult.publishedLink !== expectedLink) {
                    throw new Error('[PUBLICATION_IDENTITY_MISSING] VK provider did not confirm a matching owner ID, post ID, and permalink');
                }
            }
        }
        catch (error) {
            const fallback = (0, publication_execution_route_1.browserFallbackReason)(error);
            logToFile('WARN', `[Publisher] Connector failed for task ${task.id}; routed to browser publication.`, fallback);
            return this.routeToBrowserPublication(task, bundle, fallback);
        }
        await prisma.contentItem.update({
            where: { id: task.id },
            data: {
                status: 'published',
                publication_mode: 'connector_auto',
                published_link: automatedResult.publishedLink || task.published_link,
                quality_report: {
                    ...(task.quality_report || {}),
                    handoff_bundle: bundle,
                    execution_result: automatedResult,
                    publication_route: 'connector_auto',
                    connector_attempt_completed_at: new Date().toISOString()
                },
                metrics: {
                    ...(task.metrics || {}),
                    last_execution_at: new Date().toISOString(),
                    ...(automatedResult.metrics ? automatedResult.metrics : {})
                }
            }
        });
        if (automatedResult.publishedLink) {
            try {
                const owner = await prisma.projectMember.findFirst({
                    where: { project_id: task.project_id, role: 'owner' },
                    orderBy: { id: 'asc' }
                });
                if (owner) {
                    const rawType = String(task.type || '').toLowerCase();
                    const artifactKind = rawType.includes('article') ? 'article'
                        : rawType.includes('comment') ? 'comment'
                            : rawType.includes('story') ? 'story'
                                : rawType.includes('email') ? 'email'
                                    : 'post';
                    await publication_fact_service_1.default.record({
                        projectId: task.project_id,
                        taskId: task.id,
                        actorId: `user:${owner.user_id}`,
                        artifactKind,
                        outcome: 'published',
                        publishedAt: new Date().toISOString(),
                        publicUrl: automatedResult.publishedLink,
                        providerObjectId: task.channel?.type === 'vk'
                            ? `wall${automatedResult.metrics.vk_owner_id}_${automatedResult.metrics.vk_post_id}`
                            : null,
                        confirmationMode: 'automatic',
                        evidence: { type: 'api', ref: automatedResult.publishedLink },
                        note: `Published automatically via ${automatedResult.adapter || task.channel?.type || 'connector'}`,
                        correctionReason: task.publication_fact
                            ? `Replace prior ${task.publication_fact.outcome || 'existing'} publication fact after confirmed provider delivery.`
                            : null
                    });
                }
            }
            catch (factError) {
                // The connector has already published; never retry and risk a duplicate post.
                logToFile('WARN', `[Publisher] Task ${task.id} was published but its canonical fact needs verification.`, factError);
            }
        }
        logToFile('INFO', `[Publisher] Processed publication task ${task.id} (${bundle.task.action_type}) via automated adapter.`);
        return {
            success: true,
            mode: 'automated',
            status: 'published',
            adapter: automatedResult.adapter || task.channel?.type || task.layer || null,
            publishedLink: automatedResult.publishedLink || task.published_link || null,
            browserRequired: false,
            reason: null
        };
    }
    async areTaskDependenciesSatisfied(task) {
        const explicitActionDeps = (task.assets?.action?.dependencies || []);
        if (explicitActionDeps.length > 0) {
            const dependencyItems = await this.findDependencyItems(task.project_id, explicitActionDeps);
            const deferredDeps = dependencyItems.filter((item) => item.status === 'deferred');
            if (deferredDeps.length > 0) {
                return {
                    ready: false,
                    kind: 'waiting_on_deferred',
                    details: deferredDeps.map((item) => ({
                        id: item.id,
                        task_id: item.metrics?.task_id || null,
                        title: item.title
                    }))
                };
            }
            const skippedDeps = dependencyItems.filter((item) => item.status === 'skipped');
            if (skippedDeps.length > 0) {
                return {
                    ready: false,
                    kind: 'blocked_by_skipped',
                    details: skippedDeps.map((item) => ({
                        id: item.id,
                        task_id: item.metrics?.task_id || null,
                        title: item.title
                    }))
                };
            }
            const publishedTaskIds = new Set(dependencyItems
                .filter((item) => item.status === 'published')
                .map((item) => item.metrics?.task_id)
                .filter(Boolean));
            const missingDeps = explicitActionDeps.filter((dep) => !publishedTaskIds.has(dep));
            if (missingDeps.length > 0) {
                return {
                    ready: false,
                    kind: 'waiting',
                    details: { missing_task_ids: missingDeps }
                };
            }
        }
        const linkedDeps = Array.isArray(task.cross_link_to) ? task.cross_link_to.filter((value) => typeof value === 'number') : [];
        if (linkedDeps.length > 0) {
            const linkedItems = await prisma.contentItem.findMany({
                where: {
                    id: { in: linkedDeps },
                    project_id: task.project_id,
                },
                select: {
                    id: true,
                    status: true,
                    title: true
                }
            });
            const deferredLinked = linkedItems.filter((item) => item.status === 'deferred');
            if (deferredLinked.length > 0) {
                return {
                    ready: false,
                    kind: 'waiting_on_deferred',
                    details: deferredLinked
                };
            }
            const skippedLinked = linkedItems.filter((item) => item.status === 'skipped');
            if (skippedLinked.length > 0) {
                return {
                    ready: false,
                    kind: 'blocked_by_skipped',
                    details: skippedLinked
                };
            }
            const publishedLinkedIds = new Set(linkedItems.filter((item) => item.status === 'published').map((item) => item.id));
            const missingLinkedIds = linkedDeps.filter((depId) => !publishedLinkedIds.has(depId));
            if (missingLinkedIds.length > 0) {
                return {
                    ready: false,
                    kind: 'waiting',
                    details: { missing_content_item_ids: missingLinkedIds }
                };
            }
        }
        return { ready: true };
    }
    async executeAutomatedPublicationTask(task, bundle, channelConfig, plan, requestHost) {
        const channelType = task.channel?.type;
        const action = task.assets?.action || {};
        const directTelegramPayload = channelType === 'telegram'
            ? (0, telegram_delivery_payload_1.normalizeTelegramDeliveryPayload)({
                text: bundle.publication?.body,
                imageUrl: bundle.publication?.image_url || task.selected_asset?.file_url
            })
            : null;
        const text = directTelegramPayload?.text || bundle.publication?.body || '';
        const generatedVisual = Array.isArray(task.assets?.generated_visuals)
            ? task.assets.generated_visuals[0]
            : null;
        const imageUrl = channelType === 'telegram'
            ? directTelegramPayload.imageUrl
            : generatedVisual?.url
                || generatedVisual?.image_url
                || generatedVisual?.src
                || task.selected_asset?.file_url
                || bundle.publication?.image_url
                || null;
        if (channelType === 'reddit') {
            const title = bundle.publication?.html_bundle?.[0]?.asset?.title
                || action.parameters?.title
                || task.title
                || 'Reddit discussion';
            const subreddit = action.parameters?.subreddit || action.parameters?.sr || action.assets?.subreddit || task.layer;
            const result = await reddit_service_1.default.submitDiscussionPost(channelConfig.raw_account || channelConfig, {
                subreddit,
                title,
                text
            });
            return {
                adapter: 'reddit',
                publishedLink: result.url,
                metrics: {
                    reddit_post_name: result.name || null
                }
            };
        }
        if (channelType === 'google_search_console') {
            const targetUrlRef = task.assets?.gsc_action?.url_ref || task.assets?.target_url_ref;
            const parentAction = task.assets?.parent_action_id
                ? plan.actions.find((item) => item.id === task.assets?.parent_action_id)
                : null;
            const resolvedTargetUrl = targetUrlRef ? this.resolvePlanRef(plan, targetUrlRef) : null;
            const fallbackLink = task.published_link || resolvedTargetUrl || parentAction?.parameters?.link_url_ref || null;
            const inspection = fallbackLink ? await gsc_service_1.default.inspectUrl(channelConfig.raw_account || channelConfig, fallbackLink) : null;
            const metrics = fallbackLink ? await gsc_service_1.default.queryPageMetrics(channelConfig.raw_account || channelConfig, fallbackLink) : null;
            return {
                adapter: 'gsc',
                publishedLink: fallbackLink,
                metrics: {
                    gsc_inspection: inspection,
                    gsc_page_metrics: metrics
                }
            };
        }
        if (channelType === 'threads') {
            const threadsConfig = channelConfig.raw_account || channelConfig;
            const threadsUserId = threadsConfig.threads_user_id;
            const accessToken = threadsConfig.access_token;
            if (!threadsUserId || !accessToken) {
                throw new Error('Threads channel config is missing threads_user_id or access_token');
            }
            const publishedLink = await threads_service_1.default.publishPost(threadsUserId, accessToken, text, imageUrl || undefined);
            return {
                adapter: 'threads',
                publishedLink
            };
        }
        if (channelType === 'vk') {
            const vkConfig = this.extractVkAccountConfig(channelConfig);
            const vkId = vkConfig.vk_id;
            const apiKey = vkConfig.publish_access_token;
            if (!vkId || !apiKey) {
                throw new Error('VK channel config is missing vk_id or api_key');
            }
            const vkText = typeof text === 'string' ? text.trim() : '';
            const vkImageUrl = typeof imageUrl === 'string' ? imageUrl.trim() : '';
            if (!vkText)
                throw new Error('[VK_TEXT_REQUIRED] VK publication text must not be empty');
            const revision = task.accepted_revision || task.content_revision || 0;
            const guid = `planner-${(0, crypto_1.createHash)('sha256')
                .update(`task:${task.project_id}:${task.id}:revision:${revision}`)
                .digest('hex')
                .slice(0, 32)}`;
            const result = await vk_service_1.default.publishPostWithIdentity(String(vkId), String(apiKey), vkText, vkImageUrl || undefined, { guid });
            return {
                adapter: 'vk',
                publishedLink: result.publishedLink,
                metrics: {
                    vk_owner_id: result.ownerId,
                    vk_post_id: result.postId,
                    vk_guid: guid
                }
            };
        }
        if (channelType === 'linkedin') {
            const linkedinConfig = channelConfig.raw_account || channelConfig;
            const urn = linkedinConfig.linkedin_urn;
            const token = linkedinConfig.access_token;
            if (!urn || !token) {
                throw new Error('LinkedIn channel config is missing linkedin_urn or access_token');
            }
            const publishedLink = await linkedin_service_1.default.publishPost(urn, token, text, imageUrl || undefined);
            return {
                adapter: 'linkedin',
                publishedLink
            };
        }
        if (channelType === 'telegram') {
            const resolvedTelegram = await this.resolveTelegramDeliveryConfig(task, channelConfig);
            const rawChannelId = resolvedTelegram.rawChannelId;
            const normalizedHandle = resolvedTelegram.normalizedHandle;
            let resolvedChatId = rawChannelId;
            let channelUsername = normalizedHandle ? normalizedHandle.replace(/^@/, '') : null;
            let telegramTarget = rawChannelId || normalizedHandle;
            if (!telegramTarget) {
                throw new Error('Telegram channel config is missing telegram_channel_id or public handle');
            }
            if (!resolvedChatId && normalizedHandle) {
                try {
                    const chat = await telegram_service_1.default.bot.telegram.getChat(normalizedHandle);
                    resolvedChatId = chat?.id ? String(chat.id) : null;
                    if (resolvedChatId) {
                        telegramTarget = resolvedChatId;
                    }
                    if (typeof chat?.username === 'string' && chat.username.trim()) {
                        channelUsername = chat.username.trim().replace(/^@/, '');
                    }
                }
                catch (error) {
                    logToFile('WARN', '[Publisher] Failed to resolve Telegram handle to chat id.', {
                        handle: normalizedHandle,
                        description: this.extractTelegramErrorDescription(error)
                    });
                }
            }
            const localTestChannel = process.env.LOCAL_TEST_CHANNEL;
            const targetChannelId = (process.env.NODE_ENV !== 'production' && localTestChannel)
                ? localTestChannel
                : telegramTarget;
            const mtprotoCheck = await this.checkMTProto(task.project_id);
            const routeTrace = this.buildTelegramRouteTrace({
                projectId: task.project_id,
                resolved: resolvedTelegram,
                imageUrl: imageUrl || null,
                sessionTarget: mtprotoCheck.sessionTarget,
                targetOverride: targetChannelId,
                targetSourceOverride: (process.env.NODE_ENV !== 'production' && localTestChannel)
                    ? 'local_test_override'
                    : resolvedChatId && resolvedChatId !== rawChannelId && normalizedHandle
                        ? 'bot_api_handle_resolution'
                        : undefined
            });
            routeTrace.eligibility.mtproto = mtprotoCheck.available;
            routeTrace.eligibility.reason = mtprotoCheck.reason || null;
            routeTrace.eligibility.reason_code = mtprotoCheck.available
                ? null
                : mtprotoCheck.sessionTarget?.configured
                    ? 'session_connection_failed'
                    : mtprotoCheck.sessionTarget?.reason_code || 'project_session_missing';
            let sentMessageId;
            let publishWarning;
            let publishedViaMtproto = false;
            if (!mtprotoCheck.available) {
                publishWarning = `MTProto недоступен (${mtprotoCheck.reason}). Публикация через Bot API.`;
                routeTrace.fallback_reason = `mtproto_unavailable: ${mtprotoCheck.reason || 'unknown reason'}`;
                logToFile('WARN', `[Publisher] ${publishWarning}`);
            }
            if (mtprotoCheck.available) {
                try {
                    const importedClient = require('./telegram_client.service').default;
                    const result = await importedClient.publishPost(task.project_id, targetChannelId, text, imageUrl || undefined, undefined, undefined, requestHost);
                    if (result?.id) {
                        sentMessageId = result.id;
                        publishedViaMtproto = true;
                    }
                    else {
                        routeTrace.fallback_reason = 'mtproto_missing_message_identity';
                    }
                }
                catch (clientErr) {
                    publishWarning = `MTProto отказал: ${clientErr.message || clientErr}. Публикация через Bot API.`;
                    routeTrace.fallback_reason = `mtproto_failed: ${clientErr.message || clientErr}`;
                    logToFile('WARN', `[Publisher] ${publishWarning}`);
                }
            }
            if (!sentMessageId) {
                routeTrace.final_adapter = 'bot_api';
                try {
                    const telegramText = this.markdownToTelegramHtml(text);
                    const photoSource = this.getTelegramPhotoSource(imageUrl);
                    if (photoSource) {
                        const CAPTION_LIMIT = 1024;
                        if (telegramText.length > CAPTION_LIMIT) {
                            const publicImageUrl = this.getPublicContentItemImageUrl(task.id, imageUrl, requestHost);
                            if (publicImageUrl) {
                                const sentMessage = await this.sendTextSplitting(targetChannelId, telegramText, {
                                    link_preview_options: {
                                        url: publicImageUrl,
                                        prefer_large_media: true,
                                        show_above_text: true,
                                        is_disabled: false
                                    }
                                });
                                sentMessageId = sentMessage?.message_id;
                            }
                            else {
                                let splitIndex = telegramText.lastIndexOf('\n', CAPTION_LIMIT);
                                if (splitIndex === -1 || splitIndex < CAPTION_LIMIT * 0.5) {
                                    splitIndex = telegramText.lastIndexOf(' ', CAPTION_LIMIT);
                                }
                                if (splitIndex === -1)
                                    splitIndex = CAPTION_LIMIT;
                                const caption = telegramText.substring(0, splitIndex);
                                const remainder = telegramText.substring(splitIndex).trim();
                                const photoMsg = await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                                    caption: caption,
                                    parse_mode: 'HTML'
                                });
                                if (remainder.length > 0) {
                                    const sentMsg = await telegram_service_1.default.sendMessage(targetChannelId, remainder, {
                                        parse_mode: 'HTML'
                                    });
                                    sentMessageId = sentMsg?.message_id;
                                }
                                else {
                                    sentMessageId = photoMsg?.message_id;
                                }
                            }
                        }
                        else {
                            const photoMsg = await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                                caption: telegramText,
                                parse_mode: 'HTML'
                            });
                            sentMessageId = photoMsg?.message_id;
                        }
                    }
                    else {
                        const sentMessage = await this.sendTextSplitting(targetChannelId, telegramText);
                        sentMessageId = sentMessage?.message_id;
                    }
                }
                catch (error) {
                    throw new TelegramPublicationRouteError(`Telegram publish failed for ${normalizedHandle || rawChannelId || task.channel?.name || 'channel'}: ${this.extractTelegramErrorDescription(error)}`, routeTrace);
                }
            }
            if (publishedViaMtproto) {
                routeTrace.final_adapter = 'mtproto';
            }
            let publishedLink = null;
            if (channelUsername && sentMessageId) {
                publishedLink = `https://t.me/${channelUsername}/${sentMessageId}`;
            }
            else if (targetChannelId.startsWith('-100') && sentMessageId) {
                const cleanId = targetChannelId.substring(4);
                publishedLink = `https://t.me/c/${cleanId}/${sentMessageId}`;
            }
            return {
                adapter: 'telegram',
                deliveryMethod: publishedViaMtproto ? 'mtproto' : 'bot_api',
                publishedLink,
                warning: publishWarning,
                routeTrace,
                metrics: sentMessageId ? { telegram_message_id: sentMessageId } : undefined
            };
        }
        if (channelType === 'tilda') {
            const result = await tilda_service_1.default.executePublish(channelConfig.raw_account || channelConfig, {
                task,
                bundle
            });
            if (result.mode === 'manual_required') {
                return {
                    adapter: 'tilda',
                    manualFallback: true,
                    reason: result.reason
                };
            }
            return {
                adapter: 'tilda',
                publishedLink: bundle.publication?.link_url || null,
                metrics: {
                    tilda_publish_response: result.response || null
                }
            };
        }
        if (['ok', 'odnoklassniki'].includes(channelType)) {
            const okConfig = channelConfig.raw_account || channelConfig;
            const token = okConfig.access_token;
            const appKey = okConfig.application_key;
            const appSecret = okConfig.application_secret_key;
            const gid = okConfig.group_id || okConfig.vk_id || channelConfig.telegram_channel_id || task.channel?.config?.telegram_channel_id;
            if (!token || !appKey || !appSecret || !gid) {
                throw new Error('Odnoklassniki channel config is missing access_token, application_key, application_secret_key, or group_id');
            }
            const publishedLink = await ok_service_1.default.publishPost({
                access_token: token,
                application_key: appKey,
                application_secret_key: appSecret,
                group_id: String(gid)
            }, text, imageUrl || undefined);
            return {
                adapter: 'odnoklassniki',
                publishedLink
            };
        }
        if (['habr', 'habr_article'].includes(channelType)) {
            const habrConfig = channelConfig.raw_account || channelConfig;
            const title = bundle.publication?.html_bundle?.[0]?.asset?.title || task.title || 'Habr article';
            const publishedLink = await habr_service_1.default.publishPost({
                api_token: habrConfig.api_token,
                webhook_url: habrConfig.webhook_url,
                hub_ids: habrConfig.hub_ids
            }, text, imageUrl || undefined, title);
            return {
                adapter: 'habr',
                publishedLink
            };
        }
        if (['vc', 'vc_article'].includes(channelType)) {
            const vcConfig = channelConfig.raw_account || channelConfig;
            const title = bundle.publication?.html_bundle?.[0]?.asset?.title || task.title || 'VC article';
            const publishedLink = await vc_service_1.default.publishPost({
                access_token: vcConfig.access_token || vcConfig.api_key,
                subsite_id: vcConfig.subsite_id || vcConfig.vk_id,
                webhook_url: vcConfig.webhook_url
            }, text, imageUrl || undefined, title);
            return {
                adapter: 'vc',
                publishedLink
            };
        }
        if (['zen', 'zen_article', 'dzen'].includes(channelType)) {
            const dzenConfig = channelConfig.raw_account || channelConfig;
            const title = bundle.publication?.html_bundle?.[0]?.asset?.title || task.title || 'Zen article';
            const publishedLink = await dzen_service_1.default.publishPost({
                channel_id: dzenConfig.channel_id || dzenConfig.vk_id,
                webhook_url: dzenConfig.webhook_url
            }, text, imageUrl || undefined, title);
            return {
                adapter: 'dzen',
                publishedLink
            };
        }
        return {
            adapter: 'unknown',
            manualFallback: true,
            reason: `No automated executor configured for channel type ${channelType}`
        };
    }
    async publishDuePosts() {
        const now = new Date();
        const duePosts = await prisma.post.findMany({
            where: {
                status: {
                    in: ['scheduled', 'scheduled_native']
                },
                publish_at: { lte: now }
            },
            include: {
                week: true
            }
        });
        if (duePosts.length === 0) {
            return 0;
        }
        logToFile('INFO', `[Publisher] Found ${duePosts.length} posts due (or past due) for publishing.`);
        // 🔒 LOCK POSTS immediately to prevent concurrent `setInterval` or `/jobs/publish-due` calls
        // from fetching and publishing the exact same posts simultaneously.
        await prisma.post.updateMany({
            where: { id: { in: duePosts.map(p => p.id) } },
            data: { status: 'publishing' }
        });
        for (const post of duePosts) {
            if (post.status === 'scheduled_native')
                continue;
            try {
                // Get the channel for this post
                let channel = null;
                if (post.channel_id) {
                    channel = await prisma.socialChannel.findUnique({
                        where: { id: post.channel_id }
                    });
                }
                // Fallback: Find first Telegram channel for project
                if (!channel) {
                    logToFile('INFO', `[Publisher] Post ${post.id} has no channel_id or channel not found. Trying default...`);
                    channel = await prisma.socialChannel.findFirst({
                        where: { project_id: post.project_id, type: 'telegram' }
                    });
                }
                if (!channel || !channel.config) {
                    logToFile('ERROR', `Channel not found or config missing for post ${post.id}`);
                    continue;
                }
                const text = post.final_text || post.generated_text || '';
                let sentMessageId;
                let publishedLink = null;
                let isPublishedViaClient = false;
                if (channel.type === 'threads') {
                    logToFile('INFO', `[Publisher] Publishing to Threads for post ${post.id}`);
                    const threadsConfig = channel.config;
                    const threadsUserId = threadsConfig.threads_user_id;
                    const accessToken = threadsConfig.access_token;
                    if (!threadsUserId || !accessToken) {
                        logToFile('ERROR', `Threads config missing user_id/token for post ${post.id}`);
                        continue;
                    }
                    try {
                        publishedLink = await threads_service_1.default.publishPost(threadsUserId, accessToken, text, post.image_url || undefined);
                        logToFile('INFO', `[Publisher] Successfully published post ${post.id} to Threads: ${publishedLink}`);
                    }
                    catch (threadsErr) {
                        logToFile('ERROR', `[Publisher] Failed to publish post ${post.id} to Threads:`, threadsErr);
                        continue;
                    }
                }
                else if (channel.type === 'vk') {
                    // VK Publishing Logic
                    logToFile('INFO', `[Publisher] Publishing to VK for post ${post.id}`);
                    const vkConfig = this.extractVkAccountConfig(channel.config);
                    const vkId = vkConfig.vk_id;
                    const apiKey = vkConfig.publish_access_token;
                    if (!vkId || !apiKey) {
                        logToFile('ERROR', `VK config missing id/key for post ${post.id}`);
                        continue;
                    }
                    try {
                        publishedLink = await vk_service_1.default.publishPost(vkId, apiKey, text, post.image_url || undefined);
                        logToFile('INFO', `[Publisher] Successfully published post ${post.id} to VK: ${publishedLink}`);
                    }
                    catch (vkErr) {
                        logToFile('ERROR', `[Publisher] Failed to publish post ${post.id} to VK:`, vkErr);
                        continue; // Skip the rest if VK fails
                    }
                }
                else if (channel.type === 'linkedin') {
                    // LinkedIn Publishing Logic
                    logToFile('INFO', `[Publisher] Publishing to LinkedIn for post ${post.id}`);
                    const linkedinConfig = channel.config;
                    const urn = linkedinConfig.linkedin_urn;
                    const token = linkedinConfig.access_token;
                    if (!urn || !token) {
                        logToFile('ERROR', `LinkedIn config missing urn/token for post ${post.id}`);
                        continue;
                    }
                    try {
                        const importedLinkedin = require('./linkedin.service').default;
                        publishedLink = await importedLinkedin.publishPost(urn, token, text, post.image_url || undefined);
                        logToFile('INFO', `[Publisher] Successfully published post ${post.id} to LinkedIn: ${publishedLink}`);
                    }
                    catch (liErr) {
                        logToFile('ERROR', `[Publisher] Failed to publish post ${post.id} to LinkedIn:`, liErr);
                        continue;
                    }
                }
                else if (channel.type === 'telegram') {
                    // Telegram Publishing Logic
                    const rawChannelId = channel.config.telegram_channel_id?.toString();
                    if (!rawChannelId) {
                        logToFile('ERROR', `Telegram channel config missing ID for post ${post.id}`);
                        continue;
                    }
                    // ⚠️ LOCAL DEV OVERRIDE: redirect all messages to the test channel
                    const localTestChannel = process.env.LOCAL_TEST_CHANNEL;
                    const targetChannelId = (process.env.NODE_ENV !== 'production' && localTestChannel)
                        ? localTestChannel
                        : rawChannelId;
                    if (targetChannelId !== rawChannelId) {
                        logToFile('WARN', `[Publisher] 🚧 LOCAL DEV: redirecting post ${post.id} from ${rawChannelId} → ${targetChannelId}`);
                    }
                    // Try MTProto Client First
                    try {
                        const importedClient = require('./telegram_client.service').default;
                        // Initialize (connect) if not already
                        await importedClient.init(post.project_id);
                        // We need to resolve image path here to pass string
                        let imagePathOrUrl;
                        if (post.image_url)
                            imagePathOrUrl = post.image_url;
                        console.log(`[Publisher] Calling MTProto publishPost for post ${post.id}`);
                        const result = await importedClient.publishPost(post.project_id, targetChannelId, text, imagePathOrUrl, undefined, post.id);
                        console.log(`[Publisher] MTProto publishPost result for post ${post.id}:`, result ? `Success (ID: ${result.id})` : 'Falsy Result');
                        if (result) {
                            sentMessageId = result.id; // gramjs message object has .id
                            isPublishedViaClient = true;
                            console.log(`[Publisher] Published via MTProto Client: Message ID ${sentMessageId}`);
                        }
                        else {
                            console.log(`[Publisher] MTProto publishPost returned falsy for post ${post.id}. Will fallback to Bot API!`);
                        }
                    }
                    catch (clientErr) {
                        if (clientErr.message && clientErr.message.includes('FLOOD_WAIT')) {
                            console.warn(`[Publisher] FLOOD_WAIT detected: ${clientErr.message}. Skipping this run for post ${post.id}.`);
                            // ⚠️ ROLLBACK status since we skipped it
                            await prisma.post.update({
                                where: { id: post.id },
                                data: { status: 'scheduled' }
                            });
                            continue;
                        }
                        console.warn(`[Publisher] MTProto Client failed (fallback to Bot API):`, clientErr.message || clientErr);
                    }
                    if (!isPublishedViaClient) {
                        // Fallback to Bot API Logic
                        console.log(`[Publisher] Falling back to Bot API for post ${post.id}`);
                        const telegramText = this.markdownToTelegramHtml(post.final_text || post.generated_text || '');
                        const photoSource = this.getTelegramPhotoSource(post.image_url);
                        let sentMessage;
                        if (photoSource) {
                            const CAPTION_LIMIT = 1024;
                            if (telegramText.length > CAPTION_LIMIT) {
                                const publicImageUrl = this.getPublicImageUrl(post.id, post.image_url);
                                if (publicImageUrl) {
                                    // Send as text with large media preview (no split, 1 message)
                                    sentMessage = await this.sendTextSplitting(targetChannelId, telegramText, {
                                        link_preview_options: {
                                            url: publicImageUrl,
                                            prefer_large_media: true,
                                            show_above_text: true,
                                            is_disabled: false
                                        }
                                    });
                                }
                                else {
                                    try {
                                        sentMessage = await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                                            caption: telegramText,
                                            parse_mode: 'HTML'
                                        });
                                    }
                                    catch (sendErr) {
                                        if (this.isCaptionTooLongError(sendErr)) {
                                            console.warn(`[Publisher] Caption too long for Bot API (${telegramText.length} chars). Splitting into photo + reply.`);
                                            let splitIndex = telegramText.lastIndexOf('\n', CAPTION_LIMIT);
                                            if (splitIndex === -1 || splitIndex < CAPTION_LIMIT * 0.5) {
                                                splitIndex = telegramText.lastIndexOf(' ', CAPTION_LIMIT);
                                            }
                                            if (splitIndex === -1)
                                                splitIndex = CAPTION_LIMIT;
                                            const caption = telegramText.substring(0, splitIndex);
                                            const remainder = telegramText.substring(splitIndex).trim();
                                            const photoMsg = await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                                                caption: caption,
                                                parse_mode: 'HTML'
                                            });
                                            if (remainder.length > 0) {
                                                sentMessage = await telegram_service_1.default.sendMessage(targetChannelId, remainder, {
                                                    parse_mode: 'HTML'
                                                });
                                            }
                                            else {
                                                sentMessage = photoMsg;
                                            }
                                        }
                                        else {
                                            throw sendErr;
                                        }
                                    }
                                }
                            }
                            else {
                                sentMessage = await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                                    caption: telegramText,
                                    parse_mode: 'HTML'
                                });
                            }
                        }
                        else {
                            sentMessage = await this.sendTextSplitting(targetChannelId, telegramText);
                        }
                        sentMessageId = sentMessage?.message_id;
                    }
                    // Construct link
                    const channelUsername = channel.config.channel_username;
                    if (channelUsername) {
                        publishedLink = `https://t.me/${channelUsername}/${sentMessageId}`;
                    }
                    else if (targetChannelId.startsWith('-100')) {
                        const cleanId = targetChannelId.substring(4);
                        publishedLink = `https://t.me/c/${cleanId}/${sentMessageId}`;
                    }
                    console.log(`[Publisher] Successfully published post ${post.id} to Telegram: ${targetChannelId}`);
                }
                // Update status to published
                await prisma.post.update({
                    where: { id: post.id },
                    data: {
                        status: 'published',
                        telegram_message_id: sentMessageId,
                        published_link: publishedLink
                    }
                });
                // Cleanup Image if it's from Supabase
                if (post.image_url && post.image_url.includes('supabase.co')) {
                    console.log(`[Publisher] Cleaning up Supabase image for post ${post.id}...`);
                    try {
                        await storage_service_1.default.deleteFile(post.image_url);
                    }
                    catch (cleanupErr) {
                        console.error(`[Publisher] Failed to cleanup image:`, cleanupErr);
                    }
                }
                console.log(`[Publisher] Successfully published post ${post.id} to channel ${channel.name}`);
            }
            catch (err) {
                console.error(`[Publisher] Failed to publish post ${post.id}:`, err);
                // ⚠️ ROLLBACK status in case of an unexpected error
                await prisma.post.update({
                    where: { id: post.id },
                    data: { status: 'scheduled' }
                }).catch(e => console.error(`[Publisher] Failed to rollback status for post ${post.id}`, e));
            }
        }
        return duePosts.length;
    }
    async resetStuckPublishingPosts() {
        try {
            const result = await prisma.post.updateMany({
                where: { status: 'publishing' },
                data: { status: 'scheduled' }
            });
            if (result.count > 0) {
                logToFile('INFO', `[Publisher] Reset ${result.count} stuck 'publishing' posts back to 'scheduled'.`);
            }
            return result.count;
        }
        catch (e) {
            logToFile('ERROR', '[Publisher] Failed to reset stuck publishing posts:', e);
            return 0;
        }
    }
    /**
     * Checks whether the MTProto (GramJS) client can connect for a given project.
     * Returns true if the session is active and the connection was successful.
     */
    async checkMTProto(projectId) {
        let sessionTarget;
        try {
            const importedClient = require('./telegram_client.service').default;
            sessionTarget = await importedClient.inspectSessionTarget(projectId);
            if (!sessionTarget.configured) {
                return {
                    available: false,
                    reason: sessionTarget.reason || 'No active Telegram account session found for this project',
                    sessionTarget
                };
            }
            const success = await importedClient.init(projectId);
            if (success) {
                return { available: true, sessionTarget };
            }
            return { available: false, reason: 'Telegram MTProto session could not connect', sessionTarget };
        }
        catch (e) {
            return { available: false, reason: e.message || 'MTProto connection failed', sessionTarget };
        }
    }
    async publishPostNow(postId, requestHost) {
        // 1. Fetch Post with Channel info
        const post = await prisma.post.findUnique({
            where: { id: postId },
            include: { channel: true }
        });
        if (!post) {
            throw new Error(`Post ${postId} not found`);
        }
        const initialStatus = post.status;
        try {
            // 2. Get Channel info
            let channel = null;
            if (post.channel_id) {
                channel = await prisma.socialChannel.findUnique({ where: { id: post.channel_id } });
            }
            if (!channel) {
                channel = await prisma.socialChannel.findFirst({
                    where: { project_id: post.project_id, type: 'telegram' }
                });
            }
            if (!channel || !channel.config) {
                throw new Error(`Channel config not found for post ${postId}`);
            }
            // 🔒 LOCK POST to prevent concurrent running
            if (post.status === 'scheduled') {
                await prisma.post.update({
                    where: { id: postId },
                    data: { status: 'publishing' }
                });
            }
            // 3. Send Immediately
            const text = post.final_text || post.generated_text || '';
            let sentMessageId;
            let publishedLink = null;
            let isPublishedViaClient = false;
            let publishWarning;
            if (channel.type === 'threads') {
                const threadsConfig = channel.config;
                const threadsUserId = threadsConfig.threads_user_id;
                const accessToken = threadsConfig.access_token;
                if (!threadsUserId || !accessToken) {
                    throw new Error(`Threads config missing user_id/token for post ${postId}`);
                }
                publishedLink = await threads_service_1.default.publishPost(threadsUserId, accessToken, text, post.image_url || undefined);
            }
            else if (channel.type === 'vk') {
                const vkConfig = this.extractVkAccountConfig(channel.config);
                const vkId = vkConfig.vk_id;
                const apiKey = vkConfig.publish_access_token;
                if (!vkId || !apiKey) {
                    throw new Error(`VK config missing id/key for post ${postId}`);
                }
                publishedLink = await vk_service_1.default.publishPost(vkId, apiKey, text, post.image_url || undefined);
            }
            else if (channel.type === 'linkedin') {
                const linkedinConfig = channel.config;
                const urn = linkedinConfig.linkedin_urn;
                const token = linkedinConfig.access_token;
                if (!urn || !token) {
                    throw new Error(`LinkedIn config missing urn/token for post ${postId}`);
                }
                const importedLinkedin = require('./linkedin.service').default;
                publishedLink = await importedLinkedin.publishPost(urn, token, text, post.image_url || undefined);
            }
            else if (channel.type === 'telegram') {
                const resolvedTelegram = await this.resolveTelegramDeliveryConfig(post, channel.config);
                const rawChannelId = resolvedTelegram.rawChannelId;
                const normalizedHandle = resolvedTelegram.normalizedHandle;
                let targetChannelId = rawChannelId || normalizedHandle;
                if (!targetChannelId) {
                    throw new Error(`Telegram channel config missing ID or handle for post ${postId}`);
                }
                // ⚠️ LOCAL DEV OVERRIDE: redirect all messages to the test channel
                const localTestChannel = process.env.LOCAL_TEST_CHANNEL;
                if (process.env.NODE_ENV !== 'production' && localTestChannel) {
                    logToFile('WARN', `[Publisher] 🚧 LOCAL DEV: redirecting post ${postId} from ${targetChannelId} → ${localTestChannel}`);
                    targetChannelId = localTestChannel;
                }
                // --- Step 1: Check MTProto availability first ---
                const mtprotoCheck = await this.checkMTProto(post.project_id);
                if (!mtprotoCheck.available) {
                    publishWarning = `MTProto недоступен (${mtprotoCheck.reason}). Публикация через Bot API.`;
                    logToFile('WARN', `[Publisher] ${publishWarning}`);
                }
                // --- Step 2: Try MTProto Client ---
                if (mtprotoCheck.available) {
                    try {
                        const importedClient = require('./telegram_client.service').default;
                        let imagePathOrUrl;
                        if (post.image_url)
                            imagePathOrUrl = post.image_url;
                        logToFile('INFO', `[Publisher] publishPostNow: calling MTProto for post ${post.id}`);
                        const result = await importedClient.publishPost(post.project_id, targetChannelId, text, imagePathOrUrl, undefined, post.id, requestHost);
                        if (result) {
                            sentMessageId = result.id;
                            isPublishedViaClient = true;
                            logToFile('INFO', `[Publisher] Published via MTProto Client: Message ID ${sentMessageId}`);
                        }
                    }
                    catch (clientErr) {
                        publishWarning = `MTProto отказал: ${clientErr.message || clientErr}. Публикация через Bot API.`;
                        logToFile('WARN', `[Publisher] ${publishWarning}`);
                    }
                }
                if (!isPublishedViaClient) {
                    // Fallback to Bot API Logic
                    const telegramText = this.markdownToTelegramHtml(post.final_text || post.generated_text || '');
                    const photoSource = this.getTelegramPhotoSource(post.image_url);
                    let sentMessage;
                    if (photoSource) {
                        const CAPTION_LIMIT = 1024;
                        if (telegramText.length > CAPTION_LIMIT) {
                            const publicImageUrl = this.getPublicImageUrl(post.id, post.image_url, requestHost);
                            if (publicImageUrl) {
                                // Send as single text with large media preview instead of splitting
                                sentMessage = await this.sendTextSplitting(targetChannelId, telegramText, {
                                    link_preview_options: {
                                        url: publicImageUrl,
                                        prefer_large_media: true,
                                        show_above_text: true,
                                        is_disabled: false
                                    }
                                });
                            }
                            else {
                                // Local file / Buffer: try sending as single photo (Premium users/bots have 4096 limit)
                                try {
                                    sentMessage = await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                                        caption: telegramText,
                                        parse_mode: 'HTML'
                                    });
                                }
                                catch (sendErr) {
                                    if (this.isCaptionTooLongError(sendErr)) {
                                        console.warn(`[Publisher] Caption too long for Bot API (${telegramText.length} chars). Splitting into photo + reply.`);
                                        let splitIndex = telegramText.lastIndexOf('\n', CAPTION_LIMIT);
                                        if (splitIndex === -1 || splitIndex < CAPTION_LIMIT * 0.5) {
                                            splitIndex = telegramText.lastIndexOf(' ', CAPTION_LIMIT);
                                        }
                                        if (splitIndex === -1) {
                                            splitIndex = CAPTION_LIMIT;
                                        }
                                        const caption = telegramText.substring(0, splitIndex);
                                        const remainder = telegramText.substring(splitIndex).trim();
                                        const photoMsg = await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                                            caption: caption,
                                            parse_mode: 'HTML'
                                        });
                                        if (remainder.length > 0) {
                                            sentMessage = await telegram_service_1.default.sendMessage(targetChannelId, remainder, {
                                                parse_mode: 'HTML'
                                            });
                                        }
                                        else {
                                            sentMessage = photoMsg;
                                        }
                                    }
                                    else {
                                        throw sendErr;
                                    }
                                }
                            }
                        }
                        else {
                            sentMessage = await telegram_service_1.default.sendPhoto(targetChannelId, photoSource, {
                                caption: telegramText,
                                parse_mode: 'HTML'
                            });
                        }
                    }
                    else {
                        sentMessage = await this.sendTextSplitting(targetChannelId, telegramText);
                    }
                    sentMessageId = sentMessage?.message_id;
                }
                // Construct link for Telegram
                const channelUsername = channel.config.channel_username;
                if (channelUsername) {
                    publishedLink = `https://t.me/${channelUsername}/${sentMessageId}`;
                }
                else if (targetChannelId.startsWith('-100')) {
                    const cleanId = targetChannelId.substring(4);
                    publishedLink = `https://t.me/c/${cleanId}/${sentMessageId}`;
                }
            }
            // Update post status
            await prisma.post.update({
                where: { id: postId },
                data: {
                    status: 'published',
                    telegram_message_id: sentMessageId,
                    published_link: publishedLink
                }
            });
            // Cleanup Supabase image after publishing (non-blocking)
            if (post.image_url && post.image_url.includes('supabase.co')) {
                logToFile('INFO', `[Publisher] Cleaning up Supabase image for post ${postId}...`);
                storage_service_1.default.deleteFile(post.image_url).catch(err => logToFile('ERROR', `[Publisher] Failed to cleanup image:`, err));
            }
            return {
                success: true,
                publishMethod: isPublishedViaClient ? 'mtproto' : (channel.type === 'vk' ? 'vk' : (channel.type === 'linkedin' ? 'linkedin' : 'bot_api')),
                warning: publishWarning
            };
        }
        catch (error) {
            // Rollback if we locked it at 'publishing' or if it failed mid-publish
            if (initialStatus === 'scheduled' || initialStatus === 'publishing') {
                logToFile('WARN', `[Publisher] publishPostNow failed, rolling back status to scheduled for post ${postId}`);
                await prisma.post.update({
                    where: { id: postId },
                    data: { status: 'scheduled' }
                }).catch(e => logToFile('ERROR', 'Failed to rollback post status', e));
            }
            throw error;
        }
    }
    async scheduleNativePosts() {
        const now = new Date();
        const lookahead = new Date(now.getTime() + 5 * 60 * 1000); // Posts due in > 5m
        // Find posts that are 'scheduled' but far enough in the future
        const futurePosts = await prisma.post.findMany({
            where: {
                status: 'scheduled',
                publish_at: { gt: lookahead }
            },
            include: {
                project: {
                    include: {
                        settings: true,
                        channels: true
                    }
                }
            }
        });
        if (futurePosts.length > 0) {
            logToFile('INFO', `[Publisher] Checking ${futurePosts.length} future posts for native scheduling...`);
        }
        for (const post of futurePosts) {
            // Check if Native Scheduling is enabled for this project
            const settings = post.project.settings;
            const nativeEnabled = settings.find(s => s.key === 'telegram_native_scheduling')?.value === 'true';
            if (!nativeEnabled)
                continue;
            // Find Channel
            let channel = null;
            if (post.channel_id) {
                channel = post.project.channels.find(c => c.id === post.channel_id);
            }
            else {
                // Fallback default
                channel = post.project.channels.find(c => c.type === 'telegram');
            }
            if (!channel || channel.type !== 'telegram' || !channel.config.telegram_channel_id) {
                continue;
            }
            const targetChannelId = channel.config.telegram_channel_id.toString();
            const text = post.final_text || post.generated_text || '';
            // Try MTProto Client
            try {
                const importedClient = require('./telegram_client.service').default;
                await importedClient.init(post.project_id);
                let imagePathOrUrl;
                if (post.image_url)
                    imagePathOrUrl = post.image_url;
                // Pass schedule param (UNIX timestamp or Date object depending on library, gramjs takes Date or int)
                // Note: telegram_client.service.ts publishPost signature needs update or we pass it in options?
                // The current publishPost signature is: (projectId, target, text, imageUrl)
                // We need to update TelegramClientService.publishPost to accept 'scheduleDate'.
                // Let's first update TelegramClientService, then come back here? 
                // Or I can update TelegramClientService.publishPost to take an options object.
                // Current signature: publishPost(projectId: number, target: string | number, text: string, imageUrl?: string | null)
                // I will assume I update TelegramClientService to accept a 5th arg 'scheduleDate'.
                const result = await importedClient.publishPost(post.project_id, targetChannelId, text, imagePathOrUrl, post.publish_at, post.id);
                if (result) {
                    logToFile('INFO', `[Publisher] Scheduled natively via MTProto: Message ID ${result.id}`);
                    // Update Status
                    await prisma.post.update({
                        where: { id: post.id },
                        data: {
                            status: 'scheduled_native',
                            telegram_message_id: result.id
                        }
                    });
                }
            }
            catch (err) {
                logToFile('ERROR', `[Publisher] Failed to natively schedule post ${post.id}:`, err);
            }
        }
    }
    async sendTextSplitting(chatId, text, extraOptions = {}) {
        const MAX_LENGTH = 4090; // Leave room for markdown safety
        if (text.length <= MAX_LENGTH) {
            return await this.sendTelegramMessageWithFallback(chatId, text, extraOptions);
        }
        else {
            // Split logic
            const chunks = [];
            let remaining = text;
            while (remaining.length > 0) {
                let chunk = remaining.substring(0, MAX_LENGTH);
                // Try to cut at newline
                const lastNewline = chunk.lastIndexOf('\n');
                if (lastNewline > MAX_LENGTH * 0.8) {
                    chunk = remaining.substring(0, lastNewline);
                }
                chunks.push(chunk);
                remaining = remaining.substring(chunk.length);
            }
            let lastMessage;
            let isFirst = true;
            for (const chunk of chunks) {
                lastMessage = await this.sendTelegramMessageWithFallback(chatId, chunk, isFirst ? extraOptions : {});
                isFirst = false;
            }
            return lastMessage;
        }
    }
}
exports.default = new PublisherService();

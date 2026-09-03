import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import telegramService from './telegram.service';
import vkService from './vk.service';
import storageService from './storage.service';
import exporterService from './exporter.service';
import publicationPlanService from './publication_plan.service';
import publicationAdapterService from './publication_adapter.service';
import redditService from './reddit.service';
import gscService from './gsc.service';
import tildaService from './tilda.service';
import linkedinService from './linkedin.service';
import okService from './ok.service';
import habrService from './habr.service';
import vcService from './vc.service';
import dzenService from './dzen.service';
import threadsService from './threads.service';
import artDirectionService from './art_direction.service';
import { parseRecurringTrigger } from './publication_runtime.helpers';
import { browserFallbackReason, resolvePublicationExecutionRoute } from './publication_execution_route';
import { derivePublicationContentState } from './publication_content_state';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import publicationFactService from './publication_fact.service';
import { normalizeTelegramDeliveryPayload } from './telegram_delivery_payload';
import telegramClientService from './telegram_client.service';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// --- Simple File Logger ---
const LOGS_DIR = path.join(__dirname, '../../logs');
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}
const PUBLISHER_LOG_FILE = path.join(LOGS_DIR, 'publisher.log');

function logToFile(level: 'INFO' | 'WARN' | 'ERROR', message: string, data?: any) {
    const timestamp = new Date().toISOString();
    let logLine = `[${timestamp}] [${level}] ${message}`;
    if (data) {
        logLine += ` | ${typeof data === 'object' ? JSON.stringify(data) : data}`;
    }
    logLine += '\n';

    // Write to file
    fs.appendFileSync(PUBLISHER_LOG_FILE, logLine);

    // Also log to console
    if (level === 'ERROR') console.error(message, data || '');
    else if (level === 'WARN') console.warn(message, data || '');
    else console.log(message, data || '');
}

export type TelegramRouteTrace = {
    eligibility: {
        mtproto: boolean;
        bot_api_fallback: boolean;
        reason_code: 'project_session_missing' | 'session_connection_failed' | 'session_lookup_failed' | null;
        reason: string | null;
    };
    session_target: {
        configured: boolean;
        project_id: number;
        account_id: number | null;
        phone_hint: string | null;
    };
    target: {
        value: string | null;
        source: 'telegram_channel_id' | 'channel_handle' | 'bot_api_handle_resolution' | 'local_test_override' | 'missing';
        configured_channel_id: string | null;
        configured_handle: string | null;
        matched_channel_id: number | null;
    };
    asset_resolution: {
        has_asset: boolean;
        source: 'normalized_input' | 'none';
        kind: 'https_url' | 'http_url' | 'data_uri' | 'local_path' | 'none';
        resolved_url: string | null;
        server_resolvable: boolean;
        reason_code: 'asset_non_server_resolvable' | null;
    };
    fallback_reason: string | null;
    final_adapter: 'not_dispatched' | 'mtproto' | 'bot_api';
};

export class TelegramPublicationRouteError extends Error {
    constructor(message: string, public readonly routeTrace: TelegramRouteTrace) {
        super(message);
        this.name = 'TelegramPublicationRouteError';
    }
}

class PublisherService {
    private ongoingRulePlanCache: {
        expiresAt: number;
        plans: Array<{
            projectId: number;
            meta: any;
            ongoing_rules: any[];
            measurement: any;
        }>;
    } | null = null;

    private ongoingRuleCacheTtlMs() {
        const configured = Number(process.env.PUBLICATION_RULES_CACHE_TTL_MS || 300000);
        return Number.isFinite(configured) && configured >= 1000 ? configured : 300000;
    }

    private async loadOngoingRulePlans() {
        const now = Date.now();
        if (this.ongoingRulePlanCache && this.ongoingRulePlanCache.expiresAt > now) {
            return this.ongoingRulePlanCache.plans;
        }

        const ruleSettings = await prisma.projectSettings.findMany({
            where: { key: 'publication_plan_ongoing_rules' },
            select: { project_id: true, value: true }
        });
        const projectIds = ruleSettings.map((setting) => setting.project_id);
        if (projectIds.length === 0) {
            this.ongoingRulePlanCache = {
                expiresAt: now + this.ongoingRuleCacheTtlMs(),
                plans: []
            };
            return [];
        }

        const supportingSettings = await prisma.projectSettings.findMany({
            where: {
                project_id: { in: projectIds },
                key: { in: ['publication_plan_meta', 'publication_plan_measurement'] }
            },
            select: { project_id: true, key: true, value: true }
        });
        const settingsByProject = new Map<number, Map<string, string>>();
        for (const setting of supportingSettings) {
            const projectSettings = settingsByProject.get(setting.project_id) || new Map<string, string>();
            projectSettings.set(setting.key, setting.value);
            settingsByProject.set(setting.project_id, projectSettings);
        }

        const plans = ruleSettings.flatMap((ruleSetting) => {
            const projectSettings = settingsByProject.get(ruleSetting.project_id);
            const metaValue = projectSettings?.get('publication_plan_meta');
            if (!metaValue) return [];

            const measurementValue = projectSettings?.get('publication_plan_measurement');
            return [{
                projectId: ruleSetting.project_id,
                meta: JSON.parse(metaValue),
                ongoing_rules: JSON.parse(ruleSetting.value || '[]'),
                measurement: measurementValue ? JSON.parse(measurementValue) : {}
            }];
        });

        this.ongoingRulePlanCache = {
            expiresAt: now + this.ongoingRuleCacheTtlMs(),
            plans
        };
        return plans;
    }

    async closeConnections() {
        await prisma.$disconnect();
        await pool.end();
    }

    async publishDirectTelegram(params: {
        projectId: number;
        channel: any;
        text: string;
        imageUrl?: string;
        requestHost?: string;
    }) {
        const payload = normalizeTelegramDeliveryPayload(params);
        const result = await this.executeAutomatedPublicationTask(
            {
                id: 0,
                project_id: params.projectId,
                channel_id: params.channel.id,
                channel: params.channel,
                selected_asset: payload.imageUrl ? { file_url: payload.imageUrl } : null
            },
            {
                mode: 'automatic',
                task: { action_type: 'telegram:direct' },
                publication: {
                    body: payload.text,
                    image_url: payload.imageUrl
                }
            },
            params.channel.config || {},
            { actions: [], assets: {}, accounts: {} },
            params.requestHost
        );
        if (!result.publishedLink && !result.metrics?.telegram_message_id) {
            if (!result.routeTrace) {
                throw new Error('[PUBLICATION_IDENTITY_MISSING] Telegram provider did not confirm a message ID or permalink');
            }
            throw new TelegramPublicationRouteError(
                '[PUBLICATION_IDENTITY_MISSING] Telegram provider did not confirm a message ID or permalink',
                result.routeTrace
            );
        }
        return result;
    }

    async inspectTelegramDirectRoute(params: {
        projectId: number;
        channel: any;
        text: string;
        imageUrl?: string;
    }): Promise<TelegramRouteTrace> {
        const payload = normalizeTelegramDeliveryPayload(params);
        const resolved = await this.resolveTelegramDeliveryConfig({
            id: 0,
            project_id: params.projectId,
            channel: params.channel,
            metrics: {},
            assets: {}
        }, params.channel?.config || {});
        let sessionTarget: any;
        try {
            sessionTarget = await telegramClientService.inspectSessionTarget(params.projectId);
        } catch {
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

    private buildTelegramRouteTrace(params: {
        projectId: number;
        resolved: { rawChannelId: string | null; normalizedHandle: string | null; matchedChannelId: number | null };
        imageUrl: string | null;
        sessionTarget?: any;
        targetOverride?: string | null;
        targetSourceOverride?: TelegramRouteTrace['target']['source'];
    }): TelegramRouteTrace {
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

    async publishTelegramTaskMtproto(params: {
        projectId: number;
        taskId: number;
        channel: any;
        text: string;
        imageUrl?: string;
    }) {
        const payload = normalizeTelegramDeliveryPayload(params);
        const channelConfig = this.extractTelegramAccountConfig(params.channel?.config || {});
        const rawChannelId = channelConfig.telegram_channel_id?.toString?.() || null;
        const normalizedHandle = this.normalizeTelegramHandle(
            channelConfig.handle || channelConfig.channel_username || params.channel?.name
        );
        const target = rawChannelId || normalizedHandle;
        if (!target) {
            throw new Error('[TELEGRAM_TARGET_REQUIRED] Telegram channel config has no channel ID or public handle');
        }

        const initialized = await telegramClientService.init(params.projectId);
        if (!initialized) {
            throw new Error('[MTPROTO_UNAVAILABLE] No active Telegram MTProto session is available for the project');
        }

        const sent = await telegramClientService.publishPost(
            params.projectId,
            target,
            payload.text,
            payload.imageUrl,
            undefined,
            params.taskId,
            undefined,
            { forceMediaUpload: true }
        );
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

    async publishTelegramPersonalStoryMtproto(params: {
        projectId: number;
        taskId: number;
        caption: string;
        imageUrl: string;
        idempotencyKey: string;
    }) {
        const initialized = await telegramClientService.init(params.projectId);
        if (!initialized) {
            throw new Error('[MTPROTO_UNAVAILABLE] No active Telegram MTProto session is available for the project');
        }
        const story = await telegramClientService.publishPersonalStory({
            projectId: params.projectId,
            caption: params.caption,
            imageUrl: params.imageUrl,
            idempotencyKey: params.idempotencyKey
        });
        return {
            adapter: 'telegram_story',
            deliveryMethod: 'mtproto_personal_story',
            publishedLink: story.publicLink,
            evidenceRef: story.publicLink || `telegram-story:self:${story.storyId}`,
            metrics: { telegram_story_id: story.storyId }
        };
    }

    async publishVkTask(params: {
        projectId: number;
        taskId: number;
        channel: any;
        text: string;
        imageUrl?: string;
        idempotencyKey: string;
    }) {
        const text = typeof params.text === 'string' ? params.text.trim() : '';
        if (!text) throw new Error('[VK_TEXT_REQUIRED] VK publication text must not be empty');
        const vkConfig = this.extractVkAccountConfig(params.channel?.config || {});
        if (!vkConfig.vk_id || !vkConfig.publish_access_token) {
            throw new Error('[VK_CONNECTOR_NOT_READY] VK channel requires vk_id and publish_access_token');
        }
        const guid = `planner-${createHash('sha256').update(params.idempotencyKey).digest('hex').slice(0, 32)}`;
        const result = await vkService.publishPostWithIdentity(
            String(vkConfig.vk_id),
            String(vkConfig.publish_access_token),
            text,
            params.imageUrl,
            { guid }
        );
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

    private async routeToBrowserPublication(task: any, bundle: any, reason: Record<string, unknown>) {
        const now = new Date().toISOString();
        const qualityReport = {
            ...((task.quality_report as any) || {}),
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
                    quality_report: qualityReport as any
                }
            });

            const dedupeKey = `browser_publish:${task.id}:r${task.content_revision}`;
            await tx.workItem.upsert({
                where: { dedupe_key: dedupeKey },
                update: {
                    state: 'available',
                    reason_code: String(reason.code || 'BROWSER_REQUIRED'),
                    note: String(reason.message || 'Browser publication is required'),
                    result_payload: reason as any
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
                    result_payload: reason as any,
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

    private normalizeTelegramHandle(value: unknown): string | null {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        if (!trimmed) return null;
        return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
    }

    private extractTelegramAccountConfig(config: any) {
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

    private extractVkAccountConfig(config: any) {
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

    private async resolveTelegramDeliveryConfig(task: any, channelConfig: any) {
        const baseConfig = this.extractTelegramAccountConfig(channelConfig);
        const taskAccountRef = (task.metrics as any)?.account_ref || (task.assets as any)?.account_ref || task.channel?.name || null;
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
                return (
                    candidate.id === task.channel?.id
                    || candidate.name === task.channel?.name
                    || (taskAccountRef && candidate.name === taskAccountRef)
                    || (taskAccountRef && candidateAccountRef === taskAccountRef)
                );
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

    private shouldRetryTelegramWithoutMarkdown(error: any) {
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

    private isCaptionTooLongError(error: any): boolean {
        const desc = error?.response?.body?.description || error?.response?.description || error?.description || error?.message || '';
        const descStr = String(desc).toUpperCase();
        return descStr.includes('MEDIA_CAPTION_TOO_LONG') || descStr.includes('CAPTION IS TOO LONG');
    }

    private markdownToTelegramHtml(text: string): string {
        if (!text) return '';
        
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

    private getTelegramPhotoSource(imageUrl: string | null): string | any {
        if (!imageUrl) return null;
        
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

    private getPublicImageUrl(postId: number, imageUrl: string | null, requestHost?: string): string | null {
        if (!imageUrl) return null;
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

    private getPublicContentItemImageUrl(itemId: number, imageUrl: string | null, requestHost?: string): string | null {
        if (!imageUrl) return null;
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

    private extractTelegramErrorDescription(error: any) {
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

    private async sendTelegramMessageWithFallback(chatId: string | number, text: string, extraOptions: any = {}) {
        try {
            return await telegramService.sendMessage(chatId, text, {
                parse_mode: 'HTML',
                ...extraOptions
            });
        } catch (error: any) {
            logToFile('WARN', '[Publisher] Telegram HTML message failed, retrying as plain text.', {
                chatId,
                description: error?.response?.description || error?.message || null
            });
            // Strip HTML tags for plain text fallback
            const plainText = text.replace(/<[^>]*>/g, '');
            return await telegramService.sendMessage(chatId, plainText, { ...extraOptions });
        }
    }

    private async findDependencyItems(projectId: number, dependencyTaskIds: string[]) {
        if (dependencyTaskIds.length === 0) return [];

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

    private async loadPublicationPlanContext(projectId: number) {
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
            actions: [] as any[],
            ongoing_rules: ongoingRules ? JSON.parse(ongoingRules) : [],
            measurement: measurement ? JSON.parse(measurement) : {}
        };
    }

    private resolvePlanRef(plan: any, ref?: string | null): any {
        if (!ref) return null;
        const parts = ref.split('.');
        let current: any = plan;
        for (const part of parts) {
            if (current == null) return null;
            current = current[part];
        }
        return current ?? null;
    }

    private async getProjectGscChannel(projectId: number) {
        return prisma.socialChannel.findFirst({
            where: {
                project_id: projectId,
                type: 'google_search_console'
            }
        });
    }

    private async evaluateBlockingConditions(task: any, plan: any): Promise<{
        ready: boolean;
        kind?: 'waiting_on_blocking_condition';
        details?: any;
    }> {
        const blockingConditions = ((task.quality_report as any)?.blocking_conditions || (task.assets as any)?.action?.blocking_conditions || []) as any[];
        if (blockingConditions.length === 0) {
            return { ready: true };
        }

        const dependencyTaskIds = ((task.assets as any)?.action?.dependencies || []) as string[];
        const dependencyItems = await this.findDependencyItems(task.project_id, dependencyTaskIds);
        const dependencyEntries: Array<[string, any]> = dependencyItems
            .map((item): [string, any] | null => {
                const taskId = String((item.metrics as any)?.task_id || '');
                return taskId ? [taskId, item] : null;
            })
            .filter((entry): entry is [string, any] => Boolean(entry));
        const dependencyByTaskId = new Map<string, any>(dependencyEntries);

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

                const inspection = await gscService.inspectUrl((gscChannel.config as any).raw_account || gscChannel.config, targetUrl).catch(() => null);
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
                const channelConfig: any = task.channel?.config || {};
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

    private async shouldReactivateDeferredTask(task: any, plan: any) {
        const trigger = (task.quality_report as any)?.reactivation_trigger || (task.assets as any)?.action?.reactivation_trigger || null;
        if (!trigger) {
            return { ready: false, reason: 'No reactivation trigger defined.' };
        }

        if (trigger === 'human_confirms_ih_posting_privileges_granted') {
            const channelConfig: any = task.channel?.config || {};
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

    private async ensureRuleTask(projectId: number, rule: any, instanceKey: string, scheduleAt: Date | null, extra: any = {}) {
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
                } as any,
                quality_report: {
                    execution_mode: 'manual',
                    rule_id: rule.id,
                    trigger: rule.trigger
                } as any,
                metrics: {
                    rule_id: rule.id,
                    rule_instance_key: instanceKey
                } as any
            }
        });

        return true;
    }

    async processPublicationOngoingRules() {
        let createdCount = 0;
        const plans = await this.loadOngoingRulePlans();

        for (const plan of plans) {
            const projectId = plan.projectId;

            const timezone = plan.meta.timezone_default || 'UTC';
            const rules = Array.isArray(plan.ongoing_rules) ? plan.ongoing_rules : [];

            for (const rule of rules) {
                if (typeof rule?.trigger !== 'string' || !rule.id) continue;

                const recurring = parseRecurringTrigger(rule.trigger, timezone);
                if (recurring?.due) {
                    const instanceKey = `${rule.id}:${new Date().toISOString().slice(0, 10)}`;
                    const created = await this.ensureRuleTask(projectId, rule, instanceKey, recurring.scheduleAt);
                    if (created) createdCount += 1;
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
                        if (created) createdCount += 1;
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
                        const accountRef = (sourceItem.metrics as any)?.account_ref || '';
                        const publishedLink = sourceItem.published_link || '';
                        const isLinkedin = sourceItem.channel?.type === 'linkedin';
                        const isKnowledgePublish = publishedLink.includes('/knowledge/') || JSON.stringify((sourceItem.assets as any) || {}).includes('knowledge');
                        const isArticlePublish = ['tilda:publish_article', 'tilda:publish_index_page', 'tilda:update_homepage'].includes(sourceItem.type);

                        const matches =
                            (rule.trigger === 'after_any_linkedin_post' && isLinkedin) ||
                            (rule.trigger === 'after_any_innokentiy_linkedin_post' && isLinkedin && accountRef === 'innokentiy_linkedin') ||
                            (rule.trigger === 'after_any_publish_to_knowledge_section' && isKnowledgePublish) ||
                            (rule.trigger === 'after_any_article_publish_or_edit' && isArticlePublish);

                        if (!matches) continue;

                        const instanceKey = `${rule.id}:${sourceItem.id}`;
                        const created = await this.ensureRuleTask(projectId, rule, instanceKey, sourceItem.updated_at, { source_task_id: sourceItem.id });
                        if (created) createdCount += 1;
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
                    if (created) createdCount += 1;
                }
            }
        }

        return createdCount;
    }

    private async executeMeasurementSnapshot(task: any, plan: any) {
        const measurement = (task.assets as any)?.measurement || plan.measurement || {};
        const metricDefs = Array.isArray(measurement.metrics) ? measurement.metrics : [];
        const projectChannels = await prisma.socialChannel.findMany({
            where: { project_id: task.project_id }
        });
        const gscChannel = projectChannels.find((channel) => channel.type === 'google_search_console') || null;

        const results: Record<string, any> = {};
        for (const metricDef of metricDefs) {
            if (!metricDef?.id) continue;

            if (metricDef.source === 'gsc' && metricDef.url_ref && gscChannel) {
                const url = this.resolvePlanRef(plan, metricDef.url_ref);
                results[metricDef.id] = url
                    ? await gscService.queryPageMetrics((gscChannel.config as any).raw_account || gscChannel.config, url).catch((error: any) => ({ error: error.message }))
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
                    const config: any = item.channel?.config || {};
                    if (!config.linkedin_urn || !config.access_token || !item.published_link) {
                        return { task_id: (item.metrics as any)?.task_id || null, error: 'Missing LinkedIn credentials or link.' };
                    }

                    const metrics = await linkedinService.getMetrics(config.linkedin_urn, config.access_token, item.published_link).catch((error: any) => ({ error: error.message }));
                    return {
                        task_id: (item.metrics as any)?.task_id || null,
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
                    task_id: (item.metrics as any)?.task_id || null,
                    title: item.title,
                    metrics: item.published_link
                        ? await redditService.getPostMetrics(item.published_link).catch((error: any) => ({ error: error.message }))
                        : { error: 'Missing Reddit permalink.' }
                })));
                continue;
            }

            results[metricDef.id] = { unsupported: true, source: metricDef.source };
        }

        return results;
    }

    private async executeGscHealthAudit(task: any, plan: any) {
        const projectChannels = await prisma.socialChannel.findMany({
            where: { project_id: task.project_id }
        });
        const gscChannel = projectChannels.find((channel) => channel.type === 'google_search_console') || null;
        if (!gscChannel) {
            return { error: 'No Google Search Console channel configured.' };
        }

        const candidateUrls = Object.values(plan.assets || {})
            .map((asset: any) => asset?.target_url)
            .filter((url): url is string => typeof url === 'string' && url.startsWith('https://'));

        const uniqueUrls = Array.from(new Set(candidateUrls));
        const inspections = await Promise.all(uniqueUrls.map(async (url) => ({
            url,
            inspection: await gscService.inspectUrl((gscChannel.config as any).raw_account || gscChannel.config, url).catch((error: any) => ({ error: error.message }))
        })));

        return {
            checked_urls: inspections.length,
            inspections
        };
    }

    private async executeMediumCanonicalVerification(task: any, plan: any) {
        const sourceTaskId = (task.assets as any)?.source_task_id;
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

    private async executeInternalLinkCrawl(task: any, plan: any) {
        const candidateUrls = Object.values(plan.assets || {})
            .map((asset: any) => asset?.target_url)
            .filter((url): url is string => typeof url === 'string' && url.startsWith('https://seturon.com'));

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

    private async markInternalTaskAsManual(task: any, reason: string) {
        await prisma.contentItem.update({
            where: { id: task.id },
            data: {
                status: 'awaiting_manual_publication',
                quality_report: {
                    ...((task.quality_report as any) || {}),
                    execution_result: {
                        mode: 'manual_required',
                        reason
                    },
                    prepared_at: new Date().toISOString()
                } as any
            }
        });

    }

    private async createGeneratedPublicationTask(params: {
        projectId: number;
        channelId: number | null;
        type: string;
        layer: string;
        title: string;
        brief: string;
        scheduleAt?: Date | null;
        draftText?: string | null;
        sourceTaskId?: number | null;
        action: any;
        accountRef?: string | null;
        assetRefs?: string[];
        extraMetrics?: Record<string, any>;
    }) {
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
                } as any,
                quality_report: {
                    execution_mode: 'manual',
                    generated_by_rule: true,
                    blocking_conditions: params.action?.blocking_conditions || [],
                    human_review: params.action?.human_review !== false,
                    human_review_reason: params.action?.human_review_reason || null,
                    display_name: params.action?.display_name || params.title
                } as any,
                metrics: {
                    rule_generated: true,
                    task_id: params.action?.id || null,
                    task_display_name: params.action?.display_name || params.title,
                    account_ref: params.accountRef || null,
                    ...(params.extraMetrics || {})
                } as any
            }
        });
    }

    private async executeBrandRepostRule(task: any, plan: any) {
        const sourceTaskId = (task.assets as any)?.source_task_id;
        const sourceTask = sourceTaskId ? await prisma.contentItem.findUnique({ where: { id: sourceTaskId } }) : null;
        if (!sourceTask?.published_link) {
            return { skipped: true, reason: 'Source LinkedIn post is missing or not published yet.' };
        }

        const sourceAction = (sourceTask.assets as any)?.action || {};
        const sourceAssets = (sourceTask.assets as any)?.resolved_assets || [];
        const sourceAngle = sourceAssets.find((assetEntry: any) => assetEntry?.asset?.angle)?.asset?.angle || null;
        const exclusions = Array.isArray((task.assets as any)?.rule?.exclusions) ? (task.assets as any).rule.exclusions : [];
        if (exclusions.some((exclusion: any) => exclusion.angle === sourceAngle)) {
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

        const frameTemplate = (task.assets as any)?.rule?.repost_frame_template || 'From our founder: {one_or_two_sentence_relevance_for_creators}';
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
                human_review_reason: (task.assets as any)?.rule?.human_review_reason || 'Approve brand frame before reposting.',
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

    private async executeBrandRotationRule(task: any, plan: any) {
        const rule = (task.assets as any)?.rule || {};
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

        const assetEntry = Object.entries(plan.assets || {}).find(([, asset]: any) => asset?.rotation_slot === currentSlot);
        if (!assetEntry) {
            return { skipped: true, reason: `No asset found for brand rotation slot ${currentSlot}.` };
        }

        const [assetRef, asset] = assetEntry as [string, any];
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

    private async executeKnowledgeHubRule(task: any, plan: any) {
        const sourceTaskId = (task.assets as any)?.source_task_id;
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

        const sourceAction = (sourceTask.assets as any)?.action || {};
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
                human_review_reason: (task.assets as any)?.rule?.human_review_reason || 'Confirm category placement before updating the hub page.',
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
            if (!plan) continue;

            const rule = (task.assets as any)?.rule || {};
            const action = (rule.action || '').toString();
            let result: any = null;

            try {
                if (action === 'measurement_snapshot') {
                    result = await this.executeMeasurementSnapshot(task, plan);
                } else if (action === 'check_gsc_errors_on_published_urls') {
                    result = await this.executeGscHealthAudit(task, plan);
                } else if (action === 'verify_medium_canonical_via_gsc_url_inspection') {
                    result = await this.executeMediumCanonicalVerification(task, plan);
                } else if (action === 'crawl_internal_link_graph') {
                    result = await this.executeInternalLinkCrawl(task, plan);
                } else if (action === 'repost_with_brand_frame') {
                    result = await this.executeBrandRepostRule(task, plan);
                } else if (action === 'prepare_brand_page_post_for_current_rotation_slot') {
                    result = await this.executeBrandRotationRule(task, plan);
                } else if (action === 'append_article_card_to_knowledge_hub') {
                    result = await this.executeKnowledgeHubRule(task, plan);
                } else {
                    await this.markInternalTaskAsManual(task, `No automated executor is implemented for ongoing rule action \`${action}\`.`);
                    continue;
                }

                await prisma.contentItem.update({
                    where: { id: task.id },
                    data: {
                        status: 'published',
                        quality_report: {
                            ...((task.quality_report as any) || {}),
                            execution_result: result,
                            executed_at: new Date().toISOString()
                        } as any,
                        metrics: {
                            ...((task.metrics as any) || {}),
                            execution_summary: result
                        } as any
                    }
                });
                processedCount += 1;
            } catch (error: any) {
                await prisma.contentItem.update({
                    where: { id: task.id },
                    data: {
                        status: 'failed',
                        quality_report: {
                            ...((task.quality_report as any) || {}),
                            execution_error: error.message || String(error),
                            executed_at: new Date().toISOString()
                        } as any
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
            if (!plan) continue;

            const reactivation = await this.shouldReactivateDeferredTask(task, plan);
            if (!reactivation.ready) {
                await prisma.contentItem.update({
                    where: { id: task.id },
                    data: {
                        quality_report: {
                            ...((task.quality_report as any) || {}),
                            last_reactivation_check_at: new Date().toISOString(),
                            reactivation_wait_reason: reactivation.reason
                        } as any
                    }
                });
                continue;
            }

            await prisma.contentItem.update({
                where: { id: task.id },
                data: {
                    status: 'planned',
                    quality_report: {
                        ...((task.quality_report as any) || {}),
                        reactivated_at: new Date().toISOString(),
                        reactivation_wait_reason: null
                    } as any
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
            } catch (error) {
                logToFile('ERROR', `[Publisher] Failed to process publication task ${task.id}`, error);
            }
        }

        return dueTasks.length;
    }

    async processPublicationTaskNow(taskId: number, requestHost?: string) {
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

    private async processPublicationTaskItem(task: any, options: { manualTrigger?: boolean, requestHost?: string } = {}) {
        const visualReadiness = await artDirectionService.getReadiness(task.project_id, task.id);
        if (!visualReadiness.ready) {
            if (options.manualTrigger) throw new Error(`[VISUAL_GATE_BLOCKED] ${visualReadiness.reason}`);
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
            } else if (dependencyState.kind === 'blocked_by_skipped') {
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

        const action = (task.assets as any)?.action;
        if (plan) plan.actions = action ? [action] : [];
        const bundle = plan && action
            ? publicationPlanService.buildHandoffBundle(plan as any, task)
            : publicationPlanService.buildGeneratedContentItemHandoff(task);
        const channelConfig: any = task.channel?.config || {};
        const executionMode = bundle.mode;
        const rawAccount = channelConfig.raw_account || channelConfig || {};
        const directExecutionSupported = bundle.transport?.connector_authority !== 'manual_only'
            && publicationAdapterService.supportsDirectExecution({
            ...channelConfig,
            ...rawAccount,
            platform: rawAccount.platform || task.channel?.type
        });
        const route = resolvePublicationExecutionRoute({
            contentReady: derivePublicationContentState(task) === 'ready',
            visualReady: visualReadiness.ready,
            due: !task.schedule_at || new Date(task.schedule_at).getTime() <= Date.now(),
            published: derivePublicationContentState(task) === 'published',
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
                    ...((task.quality_report as any) || {}),
                    handoff_bundle: bundle,
                    publication_route: 'connector_auto',
                    connector_attempt_started_at: new Date().toISOString()
                } as any
            }
        });
        if (claimed.count !== 1) {
            if (options.manualTrigger) throw new Error('[PUBLICATION_ALREADY_CLAIMED] Publication task is already being processed');
            return { success: false, status: task.status, skipped: true, reason: 'already_claimed' };
        }

        let automatedResult: any;
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
        } catch (error) {
            const fallback = browserFallbackReason(error);
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
                    ...((task.quality_report as any) || {}),
                    handoff_bundle: bundle,
                    execution_result: automatedResult,
                    publication_route: 'connector_auto',
                    connector_attempt_completed_at: new Date().toISOString()
                } as any,
                metrics: {
                    ...((task.metrics as any) || {}),
                    last_execution_at: new Date().toISOString(),
                    ...(automatedResult.metrics ? automatedResult.metrics : {})
                } as any
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
                    await publicationFactService.record({
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
            } catch (factError) {
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

    private async areTaskDependenciesSatisfied(task: any): Promise<{
        ready: boolean;
        kind?: 'waiting' | 'waiting_on_deferred' | 'blocked_by_skipped';
        details?: any;
    }> {
        const explicitActionDeps = ((task.assets as any)?.action?.dependencies || []) as string[];
        if (explicitActionDeps.length > 0) {
            const dependencyItems = await this.findDependencyItems(task.project_id, explicitActionDeps);
            const deferredDeps = dependencyItems.filter((item) => item.status === 'deferred');
            if (deferredDeps.length > 0) {
                return {
                    ready: false,
                    kind: 'waiting_on_deferred',
                    details: deferredDeps.map((item) => ({
                        id: item.id,
                        task_id: (item.metrics as any)?.task_id || null,
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
                        task_id: (item.metrics as any)?.task_id || null,
                        title: item.title
                    }))
                };
            }

            const publishedTaskIds = new Set(
                dependencyItems
                    .filter((item) => item.status === 'published')
                    .map((item) => (item.metrics as any)?.task_id)
                    .filter(Boolean)
            );

            const missingDeps = explicitActionDeps.filter((dep) => !publishedTaskIds.has(dep));
            if (missingDeps.length > 0) {
                return {
                    ready: false,
                    kind: 'waiting',
                    details: { missing_task_ids: missingDeps }
                };
            }
        }

        const linkedDeps = Array.isArray(task.cross_link_to) ? task.cross_link_to.filter((value: any) => typeof value === 'number') : [];
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
            const missingLinkedIds = linkedDeps.filter((depId: number) => !publishedLinkedIds.has(depId));
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

    private async executeAutomatedPublicationTask(task: any, bundle: any, channelConfig: any, plan: any, requestHost?: string) {
        const channelType = task.channel?.type;
        const action = (task.assets as any)?.action || {};
        const directTelegramPayload = channelType === 'telegram'
            ? normalizeTelegramDeliveryPayload({
                text: bundle.publication?.body,
                imageUrl: bundle.publication?.image_url || task.selected_asset?.file_url
            })
            : null;
        const text = directTelegramPayload?.text || bundle.publication?.body || '';
        const generatedVisual = Array.isArray((task.assets as any)?.generated_visuals)
            ? (task.assets as any).generated_visuals[0]
            : null;
        const imageUrl = channelType === 'telegram'
            ? directTelegramPayload!.imageUrl
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
            const result = await redditService.submitDiscussionPost(channelConfig.raw_account || channelConfig, {
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
            const targetUrlRef = (task.assets as any)?.gsc_action?.url_ref || (task.assets as any)?.target_url_ref;
            const parentAction = (task.assets as any)?.parent_action_id
                ? plan.actions.find((item: any) => item.id === (task.assets as any)?.parent_action_id)
                : null;
            const resolvedTargetUrl = targetUrlRef ? this.resolvePlanRef(plan, targetUrlRef) : null;
            const fallbackLink = task.published_link || resolvedTargetUrl || parentAction?.parameters?.link_url_ref || null;
            const inspection = fallbackLink ? await gscService.inspectUrl(channelConfig.raw_account || channelConfig, fallbackLink) : null;
            const metrics = fallbackLink ? await gscService.queryPageMetrics(channelConfig.raw_account || channelConfig, fallbackLink) : null;

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

            const publishedLink = await threadsService.publishPost(threadsUserId, accessToken, text, imageUrl || undefined);
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
            if (!vkText) throw new Error('[VK_TEXT_REQUIRED] VK publication text must not be empty');
            const revision = task.accepted_revision || task.content_revision || 0;
            const guid = `planner-${createHash('sha256')
                .update(`task:${task.project_id}:${task.id}:revision:${revision}`)
                .digest('hex')
                .slice(0, 32)}`;
            const result = await vkService.publishPostWithIdentity(
                String(vkId),
                String(apiKey),
                vkText,
                vkImageUrl || undefined,
                { guid }
            );
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

            const publishedLink = await linkedinService.publishPost(urn, token, text, imageUrl || undefined);
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
                    const chat = await telegramService.bot.telegram.getChat(normalizedHandle) as any;
                    resolvedChatId = chat?.id ? String(chat.id) : null;
                    if (resolvedChatId) {
                        telegramTarget = resolvedChatId;
                    }
                    if (typeof chat?.username === 'string' && chat.username.trim()) {
                        channelUsername = chat.username.trim().replace(/^@/, '');
                    }
                } catch (error: any) {
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
            let sentMessageId: number | undefined;
            let publishWarning: string | undefined;
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
                    } else {
                        routeTrace.fallback_reason = 'mtproto_missing_message_identity';
                    }
                } catch (clientErr: any) {
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
                            } else {
                                let splitIndex = telegramText.lastIndexOf('\n', CAPTION_LIMIT);
                                if (splitIndex === -1 || splitIndex < CAPTION_LIMIT * 0.5) {
                                    splitIndex = telegramText.lastIndexOf(' ', CAPTION_LIMIT);
                                }
                                if (splitIndex === -1) splitIndex = CAPTION_LIMIT;

                                const caption = telegramText.substring(0, splitIndex);
                                const remainder = telegramText.substring(splitIndex).trim();

                                const photoMsg = await telegramService.sendPhoto(targetChannelId, photoSource, {
                                    caption: caption,
                                    parse_mode: 'HTML'
                                });

                                if (remainder.length > 0) {
                                    const sentMsg = await telegramService.sendMessage(targetChannelId, remainder, {
                                        parse_mode: 'HTML'
                                    });
                                    sentMessageId = sentMsg?.message_id;
                                } else {
                                    sentMessageId = photoMsg?.message_id;
                                }
                            }
                        } else {
                            const photoMsg = await telegramService.sendPhoto(targetChannelId, photoSource, {
                                caption: telegramText,
                                parse_mode: 'HTML'
                            });
                            sentMessageId = photoMsg?.message_id;
                        }
                    } else {
                        const sentMessage = await this.sendTextSplitting(targetChannelId, telegramText);
                        sentMessageId = sentMessage?.message_id;
                    }
                } catch (error: any) {
                    throw new TelegramPublicationRouteError(
                        `Telegram publish failed for ${normalizedHandle || rawChannelId || task.channel?.name || 'channel'}: ${this.extractTelegramErrorDescription(error)}`,
                        routeTrace
                    );
                }
            }

            if (publishedViaMtproto) {
                routeTrace.final_adapter = 'mtproto';
            }

            let publishedLink: string | null = null;
            if (channelUsername && sentMessageId) {
                publishedLink = `https://t.me/${channelUsername}/${sentMessageId}`;
            } else if (targetChannelId.startsWith('-100') && sentMessageId) {
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
            const result = await tildaService.executePublish(channelConfig.raw_account || channelConfig, {
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

            const publishedLink = await okService.publishPost({
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
            const publishedLink = await habrService.publishPost({
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
            const publishedLink = await vcService.publishPost({
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
            if (imageUrl && !/^https:\/\//i.test(imageUrl)) {
                throw new Error(
                    '[DZEN_VISUAL_NOT_REMOTE] The approved Dzen image is not available to Railway. '
                    + 'Upload it to public HTTPS storage or mark the publication as not requiring an image.'
                );
            }
            const dzenConfig = resolveEffectiveChannelConfig(channelType, channelConfig);
            const title = bundle.publication?.html_bundle?.[0]?.asset?.title || task.title || 'Zen article';
            const actionType = String((task.assets as any)?.action?.action_type || task.type || '').toLowerCase();
            const publicationType = actionType.includes('article') || channelType === 'zen_article'
                ? 'article'
                : actionType.includes('post')
                    ? 'post'
                    : dzenConfig.default_publication_type === 'post' ? 'post' : 'article';
            const publishedLink = await dzenService.publishPost({
                channel_id: dzenConfig.channel_id || dzenConfig.vk_id,
                cookies: dzenConfig.cookies,
                article_editor_url: dzenConfig.article_editor_url,
                post_editor_url: dzenConfig.post_editor_url
            }, text, imageUrl || undefined, title, publicationType);

            return {
                adapter: 'dzen',
                publicationType,
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
            if (post.status === 'scheduled_native') continue;

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
                let sentMessageId: number | undefined;
                let publishedLink: string | null = null;
                let isPublishedViaClient = false;

                if (channel.type === 'threads') {
                    logToFile('INFO', `[Publisher] Publishing to Threads for post ${post.id}`);
                    const threadsConfig = channel.config as any;
                    const threadsUserId = threadsConfig.threads_user_id;
                    const accessToken = threadsConfig.access_token;

                    if (!threadsUserId || !accessToken) {
                        logToFile('ERROR', `Threads config missing user_id/token for post ${post.id}`);
                        continue;
                    }

                    try {
                        publishedLink = await threadsService.publishPost(
                            threadsUserId,
                            accessToken,
                            text,
                            post.image_url || undefined
                        );
                        logToFile('INFO', `[Publisher] Successfully published post ${post.id} to Threads: ${publishedLink}`);
                    } catch (threadsErr) {
                        logToFile('ERROR', `[Publisher] Failed to publish post ${post.id} to Threads:`, threadsErr);
                        continue;
                    }
                } else if (channel.type === 'vk') {
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
                        publishedLink = await vkService.publishPost(
                            vkId,
                            apiKey,
                            text,
                            post.image_url || undefined
                        );
                        logToFile('INFO', `[Publisher] Successfully published post ${post.id} to VK: ${publishedLink}`);
                    } catch (vkErr) {
                        logToFile('ERROR', `[Publisher] Failed to publish post ${post.id} to VK:`, vkErr);
                        continue; // Skip the rest if VK fails
                    }
                } else if (channel.type === 'linkedin') {
                    // LinkedIn Publishing Logic
                    logToFile('INFO', `[Publisher] Publishing to LinkedIn for post ${post.id}`);
                    const linkedinConfig = channel.config as any;
                    const urn = linkedinConfig.linkedin_urn;
                    const token = linkedinConfig.access_token;

                    if (!urn || !token) {
                        logToFile('ERROR', `LinkedIn config missing urn/token for post ${post.id}`);
                        continue;
                    }

                    try {
                        const importedLinkedin = require('./linkedin.service').default;
                        publishedLink = await importedLinkedin.publishPost(
                            urn,
                            token,
                            text,
                            post.image_url || undefined
                        );
                        logToFile('INFO', `[Publisher] Successfully published post ${post.id} to LinkedIn: ${publishedLink}`);
                    } catch (liErr) {
                        logToFile('ERROR', `[Publisher] Failed to publish post ${post.id} to LinkedIn:`, liErr);
                        continue;
                    }
                } else if (channel.type === 'telegram') {
                    // Telegram Publishing Logic
                    const rawChannelId = (channel.config as any).telegram_channel_id?.toString();
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
                        let imagePathOrUrl: string | undefined;
                        if (post.image_url) imagePathOrUrl = post.image_url;

                        console.log(`[Publisher] Calling MTProto publishPost for post ${post.id}`);
                        const result = await importedClient.publishPost(post.project_id, targetChannelId, text, imagePathOrUrl, undefined, post.id);
                        console.log(`[Publisher] MTProto publishPost result for post ${post.id}:`, result ? `Success (ID: ${result.id})` : 'Falsy Result');

                        if (result) {
                            sentMessageId = result.id; // gramjs message object has .id
                            isPublishedViaClient = true;
                            console.log(`[Publisher] Published via MTProto Client: Message ID ${sentMessageId}`);
                        } else {
                            console.log(`[Publisher] MTProto publishPost returned falsy for post ${post.id}. Will fallback to Bot API!`);
                        }
                    } catch (clientErr: any) {
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
                        let sentMessage: any;

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
                                } else {
                                    try {
                                        sentMessage = await telegramService.sendPhoto(targetChannelId, photoSource, {
                                            caption: telegramText,
                                            parse_mode: 'HTML'
                                        });
                                    } catch (sendErr: any) {
                                        if (this.isCaptionTooLongError(sendErr)) {
                                            console.warn(`[Publisher] Caption too long for Bot API (${telegramText.length} chars). Splitting into photo + reply.`);
                                            let splitIndex = telegramText.lastIndexOf('\n', CAPTION_LIMIT);
                                            if (splitIndex === -1 || splitIndex < CAPTION_LIMIT * 0.5) {
                                                splitIndex = telegramText.lastIndexOf(' ', CAPTION_LIMIT);
                                            }
                                            if (splitIndex === -1) splitIndex = CAPTION_LIMIT;

                                            const caption = telegramText.substring(0, splitIndex);
                                            const remainder = telegramText.substring(splitIndex).trim();

                                            const photoMsg = await telegramService.sendPhoto(targetChannelId, photoSource, {
                                                caption: caption,
                                                parse_mode: 'HTML'
                                            });

                                            if (remainder.length > 0) {
                                                sentMessage = await telegramService.sendMessage(targetChannelId, remainder, {
                                                    parse_mode: 'HTML'
                                                });
                                            } else {
                                                sentMessage = photoMsg;
                                            }
                                        } else {
                                            throw sendErr;
                                        }
                                    }
                                }
                            } else {
                                sentMessage = await telegramService.sendPhoto(targetChannelId, photoSource, {
                                    caption: telegramText,
                                    parse_mode: 'HTML'
                                });
                            }
                        } else {
                            sentMessage = await this.sendTextSplitting(targetChannelId, telegramText);
                        }
                        sentMessageId = sentMessage?.message_id;
                    }

                    // Construct link
                    const channelUsername = (channel.config as any).channel_username;
                    if (channelUsername) {
                        publishedLink = `https://t.me/${channelUsername}/${sentMessageId}`;
                    } else if (targetChannelId.startsWith('-100')) {
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
                        await storageService.deleteFile(post.image_url);
                    } catch (cleanupErr) {
                        console.error(`[Publisher] Failed to cleanup image:`, cleanupErr);
                    }
                }

                console.log(`[Publisher] Successfully published post ${post.id} to channel ${channel.name}`);
            } catch (err) {
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
        } catch (e) {
            logToFile('ERROR', '[Publisher] Failed to reset stuck publishing posts:', e);
            return 0;
        }
    }

    /**
     * Checks whether the MTProto (GramJS) client can connect for a given project.
     * Returns true if the session is active and the connection was successful.
     */
    async checkMTProto(projectId: number): Promise<{ available: boolean; reason?: string; sessionTarget?: any }> {
        let sessionTarget: any;
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
        } catch (e: any) {
            return { available: false, reason: e.message || 'MTProto connection failed', sessionTarget };
        }
    }

    async publishPostNow(postId: number, requestHost?: string): Promise<{ success: boolean; publishMethod: 'mtproto' | 'bot_api' | 'vk' | 'linkedin'; warning?: string }> {
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
        let sentMessageId: number | undefined;
        let publishedLink: string | null = null;
        let isPublishedViaClient = false;
        let publishWarning: string | undefined;

        if (channel.type === 'threads') {
            const threadsConfig = channel.config as any;
            const threadsUserId = threadsConfig.threads_user_id;
            const accessToken = threadsConfig.access_token;
            if (!threadsUserId || !accessToken) {
                throw new Error(`Threads config missing user_id/token for post ${postId}`);
            }
            publishedLink = await threadsService.publishPost(threadsUserId, accessToken, text, post.image_url || undefined);
        } else if (channel.type === 'vk') {
            const vkConfig = this.extractVkAccountConfig(channel.config);
            const vkId = vkConfig.vk_id;
            const apiKey = vkConfig.publish_access_token;
            if (!vkId || !apiKey) {
                throw new Error(`VK config missing id/key for post ${postId}`);
            }
            publishedLink = await vkService.publishPost(vkId, apiKey, text, post.image_url || undefined);
        } else if (channel.type === 'linkedin') {
            const linkedinConfig = channel.config as any;
            const urn = linkedinConfig.linkedin_urn;
            const token = linkedinConfig.access_token;
            if (!urn || !token) {
                throw new Error(`LinkedIn config missing urn/token for post ${postId}`);
            }
            const importedLinkedin = require('./linkedin.service').default;
            publishedLink = await importedLinkedin.publishPost(urn, token, text, post.image_url || undefined);
        } else if (channel.type === 'telegram') {
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
                    let imagePathOrUrl: string | undefined;
                    if (post.image_url) imagePathOrUrl = post.image_url;

                    logToFile('INFO', `[Publisher] publishPostNow: calling MTProto for post ${post.id}`);
                    const result = await importedClient.publishPost(post.project_id, targetChannelId, text, imagePathOrUrl, undefined, post.id, requestHost);
                    if (result) {
                        sentMessageId = result.id;
                        isPublishedViaClient = true;
                        logToFile('INFO', `[Publisher] Published via MTProto Client: Message ID ${sentMessageId}`);
                    }
                } catch (clientErr: any) {
                    publishWarning = `MTProto отказал: ${clientErr.message || clientErr}. Публикация через Bot API.`;
                    logToFile('WARN', `[Publisher] ${publishWarning}`);
                }
            }

            if (!isPublishedViaClient) {
                // Fallback to Bot API Logic
                const telegramText = this.markdownToTelegramHtml(post.final_text || post.generated_text || '');
                const photoSource = this.getTelegramPhotoSource(post.image_url);
                let sentMessage: any;

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
                        } else {
                            // Local file / Buffer: try sending as single photo (Premium users/bots have 4096 limit)
                            try {
                                sentMessage = await telegramService.sendPhoto(targetChannelId, photoSource, {
                                    caption: telegramText,
                                    parse_mode: 'HTML'
                                });
                            } catch (sendErr: any) {
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

                                    const photoMsg = await telegramService.sendPhoto(targetChannelId, photoSource, {
                                        caption: caption,
                                        parse_mode: 'HTML'
                                    });

                                    if (remainder.length > 0) {
                                        sentMessage = await telegramService.sendMessage(targetChannelId, remainder, {
                                            parse_mode: 'HTML'
                                        });
                                    } else {
                                        sentMessage = photoMsg;
                                    }
                                } else {
                                    throw sendErr;
                                }
                            }
                        }
                    } else {
                        sentMessage = await telegramService.sendPhoto(targetChannelId, photoSource, {
                            caption: telegramText,
                            parse_mode: 'HTML'
                        });
                    }
                } else {
                    sentMessage = await this.sendTextSplitting(targetChannelId, telegramText);
                }
                sentMessageId = sentMessage?.message_id;
            }

            // Construct link for Telegram
            const channelUsername = (channel.config as any).channel_username;
            if (channelUsername) {
                publishedLink = `https://t.me/${channelUsername}/${sentMessageId}`;
            } else if (targetChannelId.startsWith('-100')) {
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
            storageService.deleteFile(post.image_url).catch(err => logToFile('ERROR', `[Publisher] Failed to cleanup image:`, err));
        }

        return {
            success: true,
            publishMethod: isPublishedViaClient ? 'mtproto' as const : (channel.type === 'vk' ? 'vk' as const : (channel.type === 'linkedin' ? 'linkedin' as const : 'bot_api' as const)),
            warning: publishWarning
        };
        } catch (error: any) {
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

            if (!nativeEnabled) continue;

            // Find Channel
            let channel = null;
            if (post.channel_id) {
                channel = post.project.channels.find(c => c.id === post.channel_id);
            } else {
                // Fallback default
                channel = post.project.channels.find(c => c.type === 'telegram');
            }

            if (!channel || channel.type !== 'telegram' || !(channel.config as any).telegram_channel_id) {
                continue;
            }

            const targetChannelId = (channel.config as any).telegram_channel_id.toString();
            const text = post.final_text || post.generated_text || '';

            // Try MTProto Client
            try {
                const importedClient = require('./telegram_client.service').default;
                await importedClient.init(post.project_id);

                let imagePathOrUrl: string | undefined;
                if (post.image_url) imagePathOrUrl = post.image_url;

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
            } catch (err) {
                logToFile('ERROR', `[Publisher] Failed to natively schedule post ${post.id}:`, err);
            }
        }
    }

    private async sendTextSplitting(chatId: string, text: string, extraOptions: any = {}) {
        const MAX_LENGTH = 4090; // Leave room for markdown safety
        if (text.length <= MAX_LENGTH) {
            return await this.sendTelegramMessageWithFallback(chatId, text, extraOptions);
        } else {
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

export default new PublisherService();

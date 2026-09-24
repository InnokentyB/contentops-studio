import prisma from '../../db';
import telegramService from '../telegram.service';
import telegramClientService from '../telegram_client.service';
import { normalizeTelegramDeliveryPayload } from '../telegram_delivery_payload';
import { logToFile } from './publisher_logger';
import {
    TelegramRouteTrace,
    TelegramPublicationRouteError,
    DirectTelegramParams,
    TelegramTaskParams
} from './types';
import * as fs from 'fs';
import { safeResolveUploadPath } from '../../utils/path_safety';

export interface TelegramAccountConfig {
    telegram_channel_id: string | number | null;
    channel_username: string | null;
    handle: string | null;
    account_ref: string | null;
    [key: string]: unknown;
}

export class TelegramPublisher {
    /**
     * Normalize telegram handle by prepending '@' if missing.
     */
    normalizeTelegramHandle(value: unknown): string | null {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        if (!trimmed) return null;
        return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
    }

    /**
     * Extract flattened Telegram account configuration from channel config object.
     */
    extractTelegramAccountConfig(config: Record<string, unknown> | null | undefined): TelegramAccountConfig {
        const topLevel = config && typeof config === 'object' ? config : {};
        const raw = topLevel.raw_account && typeof topLevel.raw_account === 'object'
            ? (topLevel.raw_account as Record<string, unknown>)
            : {};

        return {
            ...topLevel,
            ...raw,
            telegram_channel_id: (raw.telegram_channel_id ?? topLevel.telegram_channel_id ?? null) as string | number | null,
            channel_username: (raw.channel_username ?? topLevel.channel_username ?? null) as string | null,
            handle: (raw.handle ?? topLevel.handle ?? null) as string | null,
            account_ref: (raw.account_ref ?? topLevel.account_ref ?? null) as string | null
        };
    }

    /**
     * Check MTProto availability for a project session.
     */
    async checkMTProto(projectId: number): Promise<{ available: boolean; reason?: string; sessionTarget?: unknown }> {
        let sessionTarget: Record<string, unknown> | undefined;
        try {
            sessionTarget = (await telegramClientService.inspectSessionTarget(projectId)) as Record<string, unknown>;
            if (!sessionTarget.configured) {
                return {
                    available: false,
                    reason: (sessionTarget.reason as string) || 'No active Telegram account session found for this project',
                    sessionTarget
                };
            }
            const success = await telegramClientService.init(projectId);
            if (success) {
                return { available: true, sessionTarget };
            }
            return { available: false, reason: 'Telegram MTProto session could not connect', sessionTarget };
        } catch (e: any) {
            return { available: false, reason: e.message || 'MTProto connection failed', sessionTarget };
        }
    }

    /**
     * Resolve effective Telegram delivery configuration and matching channels.
     */
    async resolveTelegramDeliveryConfig(
        task: {
            id?: number;
            project_id: number;
            channel?: { id?: number; name?: string; config?: unknown };
            metrics?: Record<string, unknown>;
            assets?: Record<string, unknown>;
        },
        channelConfig: Record<string, unknown>
    ) {
        const baseConfig = this.extractTelegramAccountConfig(channelConfig);
        const taskMetrics = task.metrics as Record<string, unknown> | undefined;
        const taskAssets = task.assets as Record<string, unknown> | undefined;
        const taskAccountRef = (taskMetrics?.account_ref || taskAssets?.account_ref || task.channel?.name || null) as string | null;

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
                const candidateConfig = this.extractTelegramAccountConfig(candidate.config as Record<string, unknown>);
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
                config: this.extractTelegramAccountConfig(candidate.config as Record<string, unknown>)
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

    /**
     * Build detailed route trace for Telegram delivery routing.
     */
    buildTelegramRouteTrace(params: {
        projectId: number;
        resolved: { rawChannelId: string | null; normalizedHandle: string | null; matchedChannelId: number | null };
        imageUrl: string | null;
        sessionTarget?: Record<string, unknown>;
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
                reason_code: (session.reason_code as any) || (session.configured ? null : 'project_session_missing'),
                reason: (session.reason as string) || null
            },
            session_target: {
                configured: Boolean(session.configured),
                project_id: Number(session.project_id || params.projectId),
                account_id: Number.isInteger(session.account_id) ? (session.account_id as number) : null,
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

    /**
     * Inspect direct route parameters for debugging and pre-flight validation.
     */
    async inspectTelegramDirectRoute(params: DirectTelegramParams): Promise<TelegramRouteTrace> {
        const payload = normalizeTelegramDeliveryPayload(params);
        const resolved = await this.resolveTelegramDeliveryConfig({
            id: 0,
            project_id: params.projectId,
            channel: params.channel,
            metrics: {},
            assets: {}
        }, (params.channel?.config as Record<string, unknown>) || {});

        let sessionTarget: Record<string, unknown>;
        try {
            sessionTarget = (await telegramClientService.inspectSessionTarget(params.projectId)) as Record<string, unknown>;
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

    /**
     * Converts markdown to HTML supported by Telegram Bot API.
     */
    markdownToTelegramHtml(text: string): string {
        if (!text) return '';
        let html = text;

        html = html
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        html = html.replace(/^#+\s+(.+)$/gm, '<b>$1</b>');
        html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
        html = html.replace(/__(.*?)__/g, '<u>$1</u>');
        html = html.replace(/\*(.*?)\*/g, '<i>$1</i>');
        html = html.replace(/(?<!\w)_(.*?)_(?!\w)/g, '<i>$1</i>');
        html = html.replace(/`(.*?)`/g, '<code>$1</code>');
        html = html.replace(/```([\s\S]*?)```/g, '<pre>$1</pre>');
        html = html.replace(/\[(.*?)\]\((.*?)\)/g, (_match, linkText, url) => {
            const cleanUrl = url.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
            return `<a href="${cleanUrl}">${linkText}</a>`;
        });

        return html;
    }

    /**
     * Resolve photo source for Telegraf/Telegram Bot API.
     */
    getTelegramPhotoSource(imageUrl: string | null): unknown {
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

            const localPath = safeResolveUploadPath(imageUrl, { requireImageExtension: true });
            if (localPath && fs.existsSync(localPath)) {
                return { source: fs.createReadStream(localPath) };
            }
            return null;
        }

        return imageUrl;
    }

    /**
     * Check if Telegram error indicates media caption length exceeded.
     */
    isCaptionTooLongError(error: unknown): boolean {
        const err = error as Record<string, any>;
        const desc = err?.response?.body?.description || err?.response?.description || err?.description || err?.message || '';
        const descStr = String(desc).toUpperCase();
        return descStr.includes('MEDIA_CAPTION_TOO_LONG') || descStr.includes('CAPTION IS TOO LONG');
    }

    /**
     * Check if Telegram error should be retried without Markdown entities.
     */
    shouldRetryTelegramWithoutMarkdown(error: unknown): boolean {
        const err = error as Record<string, any>;
        const messageParts = [
            typeof err?.message === 'string' ? err.message : '',
            typeof err?.response?.description === 'string' ? err.response.description : '',
            typeof err?.description === 'string' ? err.description : ''
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

        return messageParts.includes("can't parse entities")
            || messageParts.includes('parse entities')
            || messageParts.includes('bad request');
    }

    /**
     * Extract human-readable error description from Telegram error object.
     */
    extractTelegramErrorDescription(error: unknown): string {
        const err = error as Record<string, any>;
        const responseDescription = typeof err?.response?.description === 'string'
            ? err.response.description.trim()
            : '';
        const directDescription = typeof err?.description === 'string'
            ? err.description.trim()
            : '';
        const directMessage = typeof err?.message === 'string'
            ? err.message.trim()
            : '';

        return responseDescription || directDescription || directMessage || 'Unknown Telegram error';
    }

    /**
     * Send HTML message with automatic fallback to plain text if parsing fails.
     */
    async sendTelegramMessageWithFallback(chatId: string | number, text: string, extraOptions: Record<string, unknown> = {}) {
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
            const plainText = text.replace(/<[^>]*>/g, '');
            return await telegramService.sendMessage(chatId, plainText, { ...extraOptions });
        }
    }

    /**
     * Send long text by splitting into Telegram-compliant chunks with fallback formatting.
     */
    async sendTextSplitting(chatId: string | number, text: string, extraOptions: Record<string, unknown> = {}) {
        const MAX_LENGTH = 4090;
        if (text.length <= MAX_LENGTH) {
            return await this.sendTelegramMessageWithFallback(chatId, text, extraOptions);
        }

        const chunks: string[] = [];
        let remaining = text;
        while (remaining.length > 0) {
            let chunk = remaining.substring(0, MAX_LENGTH);
            const lastNewline = chunk.lastIndexOf('\n');
            if (lastNewline > MAX_LENGTH * 0.8) {
                chunk = remaining.substring(0, lastNewline);
            }
            chunks.push(chunk);
            remaining = remaining.substring(chunk.length);
        }

        let lastMessage: any;
        let isFirst = true;
        for (const chunk of chunks) {
            lastMessage = await this.sendTelegramMessageWithFallback(chatId, chunk, isFirst ? extraOptions : {});
            isFirst = false;
        }
        return lastMessage;
    }

    /**
     * Publish Telegram Task via MTProto client.
     */
    async publishTelegramTaskMtproto(params: TelegramTaskParams) {
        const payload = normalizeTelegramDeliveryPayload(params);
        const channelConfig = this.extractTelegramAccountConfig(params.channel?.config as Record<string, unknown> | undefined);
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
        const messageId = Number((sent as any)?.id);
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

    /**
     * Publish personal Telegram story via MTProto.
     */
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
}

export const telegramPublisher = new TelegramPublisher();

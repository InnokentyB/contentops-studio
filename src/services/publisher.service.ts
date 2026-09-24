import prisma, { pool } from '../db';
import {
    TelegramRouteTrace,
    TelegramPublicationRouteError,
    DirectTelegramParams,
    TelegramTaskParams,
    VkStoryParams
} from './publishers/types';
import { logToFile } from './publishers/publisher_logger';
import { telegramPublisher } from './publishers/telegram_publisher';
import { vkPublisher } from './publishers/vk_publisher';
import { ongoingRulesProcessor, OngoingRulePlan } from './publishers/ongoing_rules_processor';
import { publicationDispatcher } from './publishers/publication_dispatcher';
import { legacyPostPublisher } from './publishers/legacy_post_publisher';
import { VkStoryPoll } from './vk_story_poll';

export { TelegramRouteTrace, TelegramPublicationRouteError };

/**
 * Master Facade for the Multi-Channel Publication Engine.
 * Coordinates direct deliveries, scheduled jobs, recurring ongoing rules,
 * and automated platform adapters while preserving backwards compatibility.
 */
export class PublisherService {
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

    /**
     * Gracefully disconnect database pool connections.
     */
    async closeConnections(): Promise<void> {
        await prisma.$disconnect();
        await pool.end();
    }

    // ─────────────────────────────────────────────────────────────
    // Direct Deliveries & Preflights
    // ─────────────────────────────────────────────────────────────

    async publishDirectTelegram(params: DirectTelegramParams) {
        const payload = require('./telegram_delivery_payload').normalizeTelegramDeliveryPayload(params);
        const result = await publicationDispatcher.executeAutomatedPublicationTask(
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
            (params.channel.config as Record<string, unknown>) || {},
            { actions: [], assets: {}, accounts: {} },
            params.requestHost,
            this
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

    async inspectTelegramDirectRoute(params: DirectTelegramParams): Promise<TelegramRouteTrace> {
        return telegramPublisher.inspectTelegramDirectRoute(params);
    }

    buildTelegramRouteTrace(params: {
        projectId: number;
        resolved: { rawChannelId: string | null; normalizedHandle: string | null; matchedChannelId: number | null };
        imageUrl: string | null;
        sessionTarget?: Record<string, unknown>;
        targetOverride?: string | null;
        targetSourceOverride?: TelegramRouteTrace['target']['source'];
    }): TelegramRouteTrace {
        return telegramPublisher.buildTelegramRouteTrace(params);
    }

    async publishTelegramTaskMtproto(params: TelegramTaskParams) {
        return telegramPublisher.publishTelegramTaskMtproto(params);
    }

    async publishTelegramPersonalStoryMtproto(params: {
        projectId: number;
        taskId: number;
        caption: string;
        imageUrl: string;
        idempotencyKey: string;
    }) {
        return telegramPublisher.publishTelegramPersonalStoryMtproto(params);
    }

    async publishVkTask(params: {
        projectId: number;
        taskId: number;
        channel: { id?: number; config?: Record<string, unknown> };
        text: string;
        imageUrl?: string;
        idempotencyKey: string;
    }) {
        return vkPublisher.publishVkTask(params);
    }

    async publishVkPersonalStory(params: VkStoryParams & { poll?: VkStoryPoll | null }) {
        return vkPublisher.publishVkPersonalStory(params);
    }

    // ─────────────────────────────────────────────────────────────
    // Config Extraction & Helpers (Public & Test Surface)
    // ─────────────────────────────────────────────────────────────

    normalizeTelegramHandle(value: unknown): string | null {
        return telegramPublisher.normalizeTelegramHandle(value);
    }

    extractTelegramAccountConfig(config: Record<string, unknown> | null | undefined) {
        return telegramPublisher.extractTelegramAccountConfig(config);
    }

    extractVkAccountConfig(config: Record<string, unknown> | null | undefined) {
        return vkPublisher.extractVkAccountConfig(config);
    }

    async resolveTelegramDeliveryConfig(task: any, channelConfig: any) {
        return telegramPublisher.resolveTelegramDeliveryConfig(task, channelConfig);
    }

    async checkMTProto(projectId: number): Promise<{ available: boolean; reason?: string; sessionTarget?: any }> {
        return telegramPublisher.checkMTProto(projectId);
    }

    markdownToTelegramHtml(text: string): string {
        return telegramPublisher.markdownToTelegramHtml(text);
    }

    getTelegramPhotoSource(imageUrl: string | null): unknown {
        return telegramPublisher.getTelegramPhotoSource(imageUrl);
    }

    sendTelegramMessageWithFallback(chatId: string | number, text: string, extraOptions: Record<string, unknown> = {}) {
        return telegramPublisher.sendTelegramMessageWithFallback(chatId, text, extraOptions);
    }

    sendTextSplitting(chatId: string | number, text: string, extraOptions: Record<string, unknown> = {}) {
        return telegramPublisher.sendTextSplitting(chatId, text, extraOptions);
    }

    getPublicImageUrl(postId: number, imageUrl: string | null, requestHost?: string): string | null {
        return legacyPostPublisher.getPublicImageUrl(postId, imageUrl, requestHost);
    }

    getPublicContentItemImageUrl(itemId: number, imageUrl: string | null, requestHost?: string): string | null {
        return publicationDispatcher.getPublicContentItemImageUrl(itemId, imageUrl, requestHost);
    }

    // ─────────────────────────────────────────────────────────────
    // Ongoing Rules & Operational Tasks
    // ─────────────────────────────────────────────────────────────

    async processPublicationOngoingRules(): Promise<number> {
        const plans = await this.loadOngoingRulePlans();
        return ongoingRulesProcessor.processPublicationOngoingRules(plans as OngoingRulePlan[]);
    }

    private async executeMeasurementSnapshot(task: any, plan: any) {
        return ongoingRulesProcessor.executeMeasurementSnapshot(task, plan);
    }

    async processOperationalTasks(): Promise<number> {
        return ongoingRulesProcessor.processOperationalTasks();
    }

    async processDeferredPublicationTasks(): Promise<number> {
        return ongoingRulesProcessor.processDeferredPublicationTasks();
    }

    // ─────────────────────────────────────────────────────────────
    // Automated ContentItem Publication Tasks
    // ─────────────────────────────────────────────────────────────

    async processPublicationTasks(): Promise<number> {
        return publicationDispatcher.processPublicationTasks(this);
    }

    async processPublicationTaskNow(taskId: number, requestHost?: string) {
        return publicationDispatcher.processPublicationTaskNow(taskId, requestHost, this);
    }

    async executeAutomatedPublicationTask(task: any, bundle: any, channelConfig: any, plan: any, requestHost?: string) {
        return publicationDispatcher.executeAutomatedPublicationTask(task, bundle, channelConfig, plan, requestHost, this);
    }

    // ─────────────────────────────────────────────────────────────
    // Legacy Post Tasks & Native Scheduler
    // ─────────────────────────────────────────────────────────────

    async publishDuePosts(): Promise<number> {
        return legacyPostPublisher.publishDuePosts();
    }

    async publishPostNow(postId: number, requestHost?: string) {
        return legacyPostPublisher.publishPostNow(postId, requestHost);
    }

    async resetStuckPublishingPosts(): Promise<number> {
        return legacyPostPublisher.resetStuckPublishingPosts();
    }

    async scheduleNativePosts(): Promise<void> {
        return legacyPostPublisher.scheduleNativePosts();
    }
}

export default new PublisherService();

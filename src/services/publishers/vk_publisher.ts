import prisma from '../../db';
import vkService from '../vk.service';
import vkOAuthService from '../vk_oauth.service';
import { resolveEffectiveChannelConfig } from '../../utils/channel.utils';
import { createHash } from 'crypto';
import { VkStoryPoll } from '../vk_story_poll';
import { VkStoryParams } from './types';

export interface VkAccountConfig {
    vk_id: string | number | null;
    publish_access_token: string | null;
    stats_access_token: string | null;
    user_access_token: string | null;
    vk_oauth_access_token: string | null;
    vk_refresh_token: string | null;
    vk_device_id: string | null;
    oauth_user_id: string | number | null;
    oauth_token_profile: string | null;
    oauth_expires_at: string | Date | null;
    [key: string]: unknown;
}

export class VkPublisher {
    /**
     * Extract flattened and validated VK account configuration.
     */
    extractVkAccountConfig(config: Record<string, unknown> | null | undefined): VkAccountConfig {
        const topLevel = resolveEffectiveChannelConfig('vk', config && typeof config === 'object' ? config : {});
        const raw = topLevel.raw_account && typeof topLevel.raw_account === 'object'
            ? (topLevel.raw_account as Record<string, unknown>)
            : {};

        return {
            ...topLevel,
            ...raw,
            vk_id: (raw.vk_id ?? topLevel.vk_id ?? null) as string | number | null,
            publish_access_token: (raw.publish_access_token
                ?? raw.api_key
                ?? topLevel.publish_access_token
                ?? topLevel.api_key
                ?? null) as string | null,
            stats_access_token: (raw.stats_access_token ?? topLevel.stats_access_token ?? null) as string | null,
            user_access_token: (raw.user_access_token ?? topLevel.user_access_token ?? null) as string | null,
            vk_oauth_access_token: (raw.vk_oauth_access_token ?? topLevel.vk_oauth_access_token ?? null) as string | null,
            vk_refresh_token: (raw.vk_refresh_token ?? topLevel.vk_refresh_token ?? null) as string | null,
            vk_device_id: (raw.vk_device_id ?? topLevel.vk_device_id ?? null) as string | null,
            oauth_user_id: (raw.oauth_user_id ?? topLevel.oauth_user_id ?? null) as string | number | null,
            oauth_token_profile: (raw.oauth_token_profile ?? topLevel.oauth_token_profile ?? null) as string | null,
            oauth_expires_at: (raw.oauth_expires_at ?? topLevel.oauth_expires_at ?? null) as string | Date | null
        };
    }

    /**
     * Resolve OAuth or direct access token for personal VK story publishing.
     */
    async resolveVkStoryAccessToken(channel: { id?: number; config?: Record<string, unknown> }, initialConfig?: VkAccountConfig): Promise<string> {
        const initial = initialConfig || this.extractVkAccountConfig(channel?.config || {});
        const serverOAuthReady = initial.oauth_token_profile === 'server_refreshed'
            && initial.vk_oauth_access_token
            && initial.vk_refresh_token
            && initial.vk_device_id;

        if (!serverOAuthReady) {
            if (initial.user_access_token) return String(initial.user_access_token);
            throw new Error('[VK_PERSONAL_STORY_CONNECTOR_NOT_READY] Personal VK story requires a server-refreshed VK ID connection');
        }

        const channelId = Number(channel?.id);
        if (!Number.isInteger(channelId) || channelId <= 0) {
            throw new Error('[VK_PERSONAL_STORY_CONNECTOR_NOT_READY] VK channel identity is missing');
        }

        const refreshed = await vkOAuthService.refreshStoredChannelToken(prisma, channelId);
        return refreshed.accessToken;
    }

    /**
     * Publish standard Wall post to VK community with idempotent GUID.
     */
    async publishVkTask(params: {
        projectId: number;
        taskId: number;
        channel: { id?: number; config?: Record<string, unknown> };
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
            { guid, mediaUploadToken: vkConfig.user_access_token || undefined }
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

    /**
     * Publish personal photo story to VK ID profile.
     */
    async publishVkPersonalStory(params: VkStoryParams) {
        const vkConfig = this.extractVkAccountConfig(params.channel?.config || {});
        if (!vkConfig.oauth_user_id) {
            throw new Error('[VK_PERSONAL_STORY_CONNECTOR_NOT_READY] Personal VK story requires a verified profile ID');
        }

        const storyToken = await this.resolveVkStoryAccessToken(params.channel, vkConfig);
        const result = await vkService.publishPersonalPhotoStoryWithIdentity(
            storyToken,
            String(vkConfig.oauth_user_id),
            params.imageUrl,
            params.poll as VkStoryPoll | null | undefined
        );

        return {
            adapter: 'vk_story',
            deliveryMethod: 'vk_api_personal_story',
            publishedLink: result.publishedLink,
            evidenceRef: result.evidenceRef,
            metrics: {
                vk_story_owner_id: result.ownerId,
                vk_story_id: result.storyId,
                ...(result.poll ? {
                    vk_story_poll_owner_id: result.poll.ownerId,
                    vk_story_poll_id: result.poll.pollId
                } : {})
            }
        };
    }
}

export const vkPublisher = new VkPublisher();

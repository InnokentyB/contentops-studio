import prisma from '../../db';
import { Prisma } from '@prisma/client';
import publisherService from '../publisher.service';
import redditService from '../reddit.service';
import threadsService from '../threads.service';
import vkService from '../vk.service';
import linkedinService from '../linkedin.service';
import okService from '../ok.service';
import habrService from '../habr.service';
import vcService from '../vc.service';
import dzenService from '../dzen.service';
import { resolveEffectiveChannelConfig } from '../../utils/channel.utils';
import { normalizeTelegramDeliveryPayload, buildTelegramDeliveryPreview } from '../telegram_delivery_payload';
import { resolveChannel } from './projects';
import { normalizeTextPreview } from './helpers';
import { DirectPublishParams } from './types';

/**
 * Directly publish content to target social platform without a publication plan task.
 */
export async function publishDirect(
    params: DirectPublishParams,
    channelResolver: (projectId: number, channelId?: number, channelType?: string) => Promise<Awaited<ReturnType<typeof resolveChannel>>> = resolveChannel
) {
    const channel = await channelResolver(params.projectId, params.channelId, params.channelType);
    const config = resolveEffectiveChannelConfig(channel.type, channel.config) as Record<string, unknown> | null;
    const telegramPayload = channel.type === 'telegram'
        ? normalizeTelegramDeliveryPayload(params)
        : null;

    if (params.dryRun) {
        const routeTrace = telegramPayload
            ? await publisherService.inspectTelegramDirectRoute({
                projectId: params.projectId,
                channel,
                text: telegramPayload.text,
                imageUrl: telegramPayload.imageUrl || undefined
            })
            : null;
        return {
            mode: 'dry_run',
            project_id: params.projectId,
            channel: {
                id: channel.id,
                name: channel.name,
                type: channel.type
            },
            payload_preview: {
                title: params.title || null,
                text_preview: normalizeTextPreview(telegramPayload?.text || params.text),
                subreddit: params.subreddit || null,
                has_image: Boolean(telegramPayload?.imageUrl || params.imageUrl),
                ...(telegramPayload ? buildTelegramDeliveryPreview(telegramPayload) : {})
            },
            ...(routeTrace ? { route_trace: routeTrace } : {})
        };
    }

    let publishedLink: string | null = null;
    let externalId: string | number | null = null;
    let deliveryMethod: string | null = null;
    let routeTrace: unknown = null;

    if (channel.type === 'reddit') {
        if (!params.title?.trim()) {
            throw new Error('`title` is required for Reddit publication');
        }
        if (!params.subreddit?.trim()) {
            throw new Error('`subreddit` is required for Reddit publication');
        }

        const result = await redditService.submitDiscussionPost(config as Parameters<typeof redditService.submitDiscussionPost>[0], {
            subreddit: params.subreddit,
            title: params.title,
            text: params.text
        });
        publishedLink = result.url;
        externalId = result.name;
    } else if (channel.type === 'telegram') {
        const result = await publisherService.publishDirectTelegram({
            projectId: params.projectId,
            channel,
            text: telegramPayload!.text,
            imageUrl: telegramPayload!.imageUrl || undefined
        });
        publishedLink = result.publishedLink;
        externalId = result.metrics?.telegram_message_id || null;
        deliveryMethod = result.deliveryMethod || null;
        routeTrace = result.routeTrace || null;
    } else if (channel.type === 'threads') {
        const threadsUserId = config?.threads_user_id as string | undefined;
        const accessToken = config?.access_token as string | undefined;
        if (!threadsUserId || !accessToken) {
            throw new Error(`Threads channel ${channel.id} is missing threads_user_id or access_token`);
        }

        publishedLink = await threadsService.publishPost(threadsUserId, accessToken, params.text, params.imageUrl);
    } else if (channel.type === 'vk') {
        const vkId = config?.vk_id as string | number | undefined;
        const apiKey = (config?.publish_access_token || config?.api_key) as string | undefined;
        if (!vkId || !apiKey) {
            throw new Error(`VK channel ${channel.id} is missing vk_id or api_key`);
        }

        if (params.imageUrl && !config?.user_access_token) {
            throw new Error(`VK channel ${channel.id} requires user_access_token to upload an image`);
        }

        publishedLink = await vkService.publishPost(
            String(vkId),
            apiKey,
            params.text,
            params.imageUrl,
            { mediaUploadToken: (config?.user_access_token as string) || undefined }
        );
    } else if (channel.type === 'linkedin') {
        const urn = config?.linkedin_urn as string | undefined;
        const token = config?.access_token as string | undefined;
        if (!urn || !token) {
            throw new Error(`LinkedIn channel ${channel.id} is missing linkedin_urn or access_token`);
        }

        publishedLink = await linkedinService.publishPost(urn, token, params.text, params.imageUrl);
    } else if (['ok', 'odnoklassniki'].includes(channel.type)) {
        const token = config?.access_token as string | undefined;
        const appKey = config?.application_key as string | undefined;
        const appSecret = config?.application_secret_key as string | undefined;
        const channelConfig = channel.config as Record<string, unknown> | null;
        const gid = config?.group_id || config?.vk_id || channelConfig?.telegram_channel_id;
        if (!token || !appKey || !appSecret || !gid) {
            throw new Error(`Odnoklassniki channel ${channel.id} is missing access_token, application_key, application_secret_key, or group_id`);
        }
        publishedLink = await okService.publishPost({
            access_token: token,
            application_key: appKey,
            application_secret_key: appSecret,
            group_id: String(gid)
        }, params.text, params.imageUrl);
    } else if (['habr', 'habr_article'].includes(channel.type)) {
        publishedLink = await habrService.publishPost({
            api_token: config?.api_token as string | undefined,
            webhook_url: config?.webhook_url as string | undefined,
            hub_ids: config?.hub_ids as string[] | undefined,
            cookies: config?.cookies as string | undefined
        }, params.text, params.imageUrl, params.title);
    } else if (['vc', 'vc_article'].includes(channel.type)) {
        const subsiteId = config?.subsite_id ? String(config.subsite_id) : (config?.vk_id ? String(config.vk_id) : undefined);
        publishedLink = await vcService.publishPost({
            access_token: (config?.access_token || config?.api_key) as string | undefined,
            subsite_id: subsiteId,
            webhook_url: config?.webhook_url as string | undefined
        }, params.text, params.imageUrl, params.title);
    } else if (['zen', 'zen_article', 'dzen'].includes(channel.type)) {
        const dzenConfig = resolveEffectiveChannelConfig(channel.type, channel.config) as Record<string, unknown> | null;
        publishedLink = await dzenService.publishPost({
            channel_id: (dzenConfig?.channel_id || dzenConfig?.vk_id) as string | undefined,
            cookies: dzenConfig?.cookies as string | undefined,
            article_editor_url: dzenConfig?.article_editor_url as string | undefined,
            post_editor_url: dzenConfig?.post_editor_url as string | undefined
        }, params.text, params.imageUrl, params.title, params.title ? 'article' : 'post');
    } else {
        throw new Error(`Direct MCP publication is not supported for channel type '${channel.type}'`);
    }

    await prisma.event.create({
        data: {
            entity_type: 'project',
            entity_id: params.projectId,
            event_type: 'mcp.direct_publication',
            payload: {
                channel_id: channel.id,
                channel_type: channel.type,
                title: params.title || null,
                subreddit: params.subreddit || null,
                published_link: publishedLink,
                external_id: externalId,
                delivery_method: deliveryMethod,
                route_trace: routeTrace,
                has_image: Boolean(params.imageUrl),
                text_preview: normalizeTextPreview(params.text, 500)
            } as Prisma.InputJsonValue
        }
    });

    return {
        mode: 'published',
        project_id: params.projectId,
        channel: {
            id: channel.id,
            name: channel.name,
            type: channel.type
        },
        published_link: publishedLink,
        external_id: externalId,
        delivery_method: deliveryMethod,
        ...(routeTrace ? { route_trace: routeTrace } : {})
    };
}

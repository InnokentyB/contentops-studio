import prisma from '../../db';
import storageService from '../storage.service';
import threadsService from '../threads.service';
import vkService from '../vk.service';
import telegramService from '../telegram.service';
import telegramClientService from '../telegram_client.service';
import { telegramPublisher } from './telegram_publisher';
import { vkPublisher } from './vk_publisher';
import { logToFile } from './publisher_logger';

export class LegacyPostPublisher {
    getPublicImageUrl(postId: number, imageUrl: string | null, requestHost?: string): string | null {
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

    async resetStuckPublishingPosts(): Promise<number> {
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

    async publishDuePosts(): Promise<number> {
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
        await prisma.post.updateMany({
            where: { id: { in: duePosts.map(p => p.id) } },
            data: { status: 'publishing' }
        });

        for (const post of duePosts) {
            if (post.status === 'scheduled_native') continue;

            try {
                let channel = null;
                if (post.channel_id) {
                    channel = await prisma.socialChannel.findUnique({
                        where: { id: post.channel_id }
                    });
                }

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
                    logToFile('INFO', `[Publisher] Publishing to VK for post ${post.id}`);
                    const vkConfig = vkPublisher.extractVkAccountConfig(channel.config as Record<string, unknown>);
                    const vkId = vkConfig.vk_id;
                    const apiKey = vkConfig.publish_access_token;

                    if (!vkId || !apiKey) {
                        logToFile('ERROR', `VK config missing id/key for post ${post.id}. Marking as failed.`);
                        await prisma.post.update({
                            where: { id: post.id },
                            data: {
                                status: 'failed',
                                metrics: { error: 'VK config missing id or key' }
                            }
                        });
                        continue;
                    }

                    try {
                        publishedLink = await vkService.publishPost(
                            String(vkId),
                            apiKey,
                            text,
                            post.image_url || undefined,
                            { mediaUploadToken: vkConfig.user_access_token || undefined }
                        );
                        logToFile('INFO', `[Publisher] Successfully published post ${post.id} to VK: ${publishedLink}`);
                    } catch (vkErr) {
                        logToFile('ERROR', `[Publisher] Failed to publish post ${post.id} to VK:`, vkErr);
                        continue;
                    }
                } else if (channel.type === 'linkedin') {
                    logToFile('INFO', `[Publisher] Publishing to LinkedIn for post ${post.id}`);
                    const linkedinConfig = channel.config as any;
                    const urn = linkedinConfig.linkedin_urn;
                    const token = linkedinConfig.access_token;

                    if (!urn || !token) {
                        logToFile('ERROR', `LinkedIn config missing urn/token for post ${post.id}. Marking as failed.`);
                        await prisma.post.update({
                            where: { id: post.id },
                            data: {
                                status: 'failed',
                                metrics: { error: 'LinkedIn config missing urn or token' }
                            }
                        });
                        continue;
                    }

                    try {
                        const importedLinkedin = require('../linkedin.service').default;
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
                    const rawChannelId = (channel.config as any).telegram_channel_id?.toString();
                    if (!rawChannelId) {
                        logToFile('ERROR', `Telegram channel config missing ID for post ${post.id}. Marking as failed.`);
                        await prisma.post.update({
                            where: { id: post.id },
                            data: {
                                status: 'failed',
                                metrics: { error: 'Telegram channel config missing telegram_channel_id' }
                            }
                        });
                        continue;
                    }

                    const localTestChannel = process.env.LOCAL_TEST_CHANNEL;
                    const targetChannelId = (process.env.NODE_ENV !== 'production' && localTestChannel)
                        ? localTestChannel
                        : rawChannelId;
                    if (targetChannelId !== rawChannelId) {
                        logToFile('WARN', `[Publisher] 🚧 LOCAL DEV: redirecting post ${post.id} from ${rawChannelId} → ${targetChannelId}`);
                    }

                    try {
                        await telegramClientService.init(post.project_id);

                        let imagePathOrUrl: string | undefined;
                        if (post.image_url) imagePathOrUrl = post.image_url;

                        const result = await telegramClientService.publishPost(post.project_id, targetChannelId, text, imagePathOrUrl, undefined, post.id);

                        if (result) {
                            sentMessageId = (result as any).id;
                            isPublishedViaClient = true;
                            logToFile('INFO', `[Publisher] Published via MTProto Client: Message ID ${sentMessageId}`);
                        }
                    } catch (clientErr: any) {
                        if (clientErr.message && clientErr.message.includes('FLOOD_WAIT')) {
                            console.warn(`[Publisher] FLOOD_WAIT detected: ${clientErr.message}. Skipping this run for post ${post.id}.`);
                            await prisma.post.update({
                                where: { id: post.id },
                                data: { status: 'scheduled' }
                            });
                            continue;
                        }
                        console.warn(`[Publisher] MTProto Client failed (fallback to Bot API):`, clientErr.message || clientErr);
                    }

                    if (!isPublishedViaClient) {
                        const telegramText = telegramPublisher.markdownToTelegramHtml(post.final_text || post.generated_text || '');
                        const photoSource = telegramPublisher.getTelegramPhotoSource(post.image_url);
                        let sentMessage: any;

                        if (photoSource) {
                            const CAPTION_LIMIT = 1024;
                            if (telegramText.length > CAPTION_LIMIT) {
                                const publicImageUrl = this.getPublicImageUrl(post.id, post.image_url);
                                if (publicImageUrl) {
                                    sentMessage = await telegramPublisher.sendTextSplitting(targetChannelId, telegramText, {
                                        link_preview_options: {
                                            url: publicImageUrl,
                                            prefer_large_media: true,
                                            show_above_text: true,
                                            is_disabled: false
                                        }
                                    });
                                } else {
                                    try {
                                        sentMessage = await telegramService.sendPhoto(targetChannelId, photoSource as any, {
                                            caption: telegramText,
                                            parse_mode: 'HTML'
                                        });
                                    } catch (sendErr: any) {
                                        if (telegramPublisher.isCaptionTooLongError(sendErr)) {
                                            let splitIndex = telegramText.lastIndexOf('\n', CAPTION_LIMIT);
                                            if (splitIndex === -1 || splitIndex < CAPTION_LIMIT * 0.5) {
                                                splitIndex = telegramText.lastIndexOf(' ', CAPTION_LIMIT);
                                            }
                                            if (splitIndex === -1) splitIndex = CAPTION_LIMIT;

                                            const caption = telegramText.substring(0, splitIndex);
                                            const remainder = telegramText.substring(splitIndex).trim();

                                            const photoMsg = await telegramService.sendPhoto(targetChannelId, photoSource as any, {
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
                                sentMessage = await telegramService.sendPhoto(targetChannelId, photoSource as any, {
                                    caption: telegramText,
                                    parse_mode: 'HTML'
                                });
                            }
                        } else {
                            sentMessage = await telegramPublisher.sendTextSplitting(targetChannelId, telegramText);
                        }
                        sentMessageId = sentMessage?.message_id;
                    }

                    const channelUsername = (channel.config as any).channel_username;
                    if (channelUsername) {
                        publishedLink = `https://t.me/${channelUsername}/${sentMessageId}`;
                    } else if (targetChannelId.startsWith('-100')) {
                        const cleanId = targetChannelId.substring(4);
                        publishedLink = `https://t.me/c/${cleanId}/${sentMessageId}`;
                    }
                    logToFile('INFO', `[Publisher] Successfully published post ${post.id} to Telegram: ${targetChannelId}`);
                }

                await prisma.post.update({
                    where: { id: post.id },
                    data: {
                        status: 'published',
                        telegram_message_id: sentMessageId,
                        published_link: publishedLink
                    }
                });

                if (post.image_url && post.image_url.includes('supabase.co')) {
                    try {
                        await storageService.deleteFile(post.image_url);
                    } catch (cleanupErr) {
                        console.error(`[Publisher] Failed to cleanup image:`, cleanupErr);
                    }
                }
            } catch (err) {
                console.error(`[Publisher] Failed to publish post ${post.id}:`, err);
                await prisma.post.update({
                    where: { id: post.id },
                    data: { status: 'scheduled' }
                }).catch(e => console.error(`[Publisher] Failed to rollback status for post ${post.id}`, e));
            }
        }

        return duePosts.length;
    }

    async publishPostNow(postId: number, requestHost?: string): Promise<{ success: boolean; publishMethod: 'mtproto' | 'bot_api' | 'vk' | 'linkedin'; warning?: string }> {
        const post = await prisma.post.findUnique({
            where: { id: postId },
            include: { channel: true }
        });

        if (!post) {
            throw new Error(`Post ${postId} not found`);
        }

        try {
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

            if (post.status === 'scheduled') {
                await prisma.post.update({
                    where: { id: postId },
                    data: { status: 'publishing' }
                });
            }

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
                const vkConfig = vkPublisher.extractVkAccountConfig(channel.config as Record<string, unknown>);
                const vkId = vkConfig.vk_id;
                const apiKey = vkConfig.publish_access_token;
                if (!vkId || !apiKey) {
                    throw new Error(`VK config missing id/key for post ${postId}`);
                }
                publishedLink = await vkService.publishPost(
                    String(vkId),
                    apiKey,
                    text,
                    post.image_url || undefined,
                    { mediaUploadToken: vkConfig.user_access_token || undefined }
                );
            } else if (channel.type === 'linkedin') {
                const linkedinConfig = channel.config as any;
                const urn = linkedinConfig.linkedin_urn;
                const token = linkedinConfig.access_token;
                if (!urn || !token) {
                    throw new Error(`LinkedIn config missing urn/token for post ${postId}`);
                }
                const importedLinkedin = require('../linkedin.service').default;
                publishedLink = await importedLinkedin.publishPost(urn, token, text, post.image_url || undefined);
            } else if (channel.type === 'telegram') {
                const resolvedTelegram = await telegramPublisher.resolveTelegramDeliveryConfig({
                    id: post.id,
                    project_id: post.project_id,
                    channel: channel ? { id: channel.id, name: channel.name, config: channel.config as Record<string, unknown> } : undefined,
                    metrics: (post.metrics as Record<string, unknown>) || undefined
                }, channel.config as Record<string, unknown>);
                const rawChannelId = resolvedTelegram.rawChannelId;
                const normalizedHandle = resolvedTelegram.normalizedHandle;
                let targetChannelId = rawChannelId || normalizedHandle;

                if (!targetChannelId) {
                    throw new Error(`Telegram channel config missing ID or handle for post ${postId}`);
                }

                const localTestChannel = process.env.LOCAL_TEST_CHANNEL;
                if (process.env.NODE_ENV !== 'production' && localTestChannel) {
                    logToFile('WARN', `[Publisher] 🚧 LOCAL DEV: redirecting post ${postId} from ${targetChannelId} → ${localTestChannel}`);
                    targetChannelId = localTestChannel;
                }

                const mtprotoCheck = await telegramPublisher.checkMTProto(post.project_id);
                if (!mtprotoCheck.available) {
                    publishWarning = `MTProto недоступен (${mtprotoCheck.reason}). Публикация через Bot API.`;
                    logToFile('WARN', `[Publisher] ${publishWarning}`);
                }

                if (mtprotoCheck.available) {
                    try {
                        let imagePathOrUrl: string | undefined;
                        if (post.image_url) imagePathOrUrl = post.image_url;

                        logToFile('INFO', `[Publisher] publishPostNow: calling MTProto for post ${post.id}`);
                        const result = await telegramClientService.publishPost(post.project_id, targetChannelId, text, imagePathOrUrl, undefined, post.id, requestHost);
                        if (result) {
                            sentMessageId = (result as any).id;
                            isPublishedViaClient = true;
                            logToFile('INFO', `[Publisher] Published via MTProto Client: Message ID ${sentMessageId}`);
                        }
                    } catch (clientErr: any) {
                        publishWarning = `MTProto отказал: ${clientErr.message || clientErr}. Публикация через Bot API.`;
                        logToFile('WARN', `[Publisher] ${publishWarning}`);
                    }
                }

                if (!isPublishedViaClient) {
                    const telegramText = telegramPublisher.markdownToTelegramHtml(post.final_text || post.generated_text || '');
                    const photoSource = telegramPublisher.getTelegramPhotoSource(post.image_url);
                    let sentMessage: any;

                    if (photoSource) {
                        const CAPTION_LIMIT = 1024;
                        if (telegramText.length > CAPTION_LIMIT) {
                            const publicImageUrl = this.getPublicImageUrl(post.id, post.image_url, requestHost);
                            if (publicImageUrl) {
                                sentMessage = await telegramPublisher.sendTextSplitting(targetChannelId, telegramText, {
                                    link_preview_options: {
                                        url: publicImageUrl,
                                        prefer_large_media: true,
                                        show_above_text: true,
                                        is_disabled: false
                                    }
                                });
                            } else {
                                try {
                                    sentMessage = await telegramService.sendPhoto(targetChannelId, photoSource as any, {
                                        caption: telegramText,
                                        parse_mode: 'HTML'
                                    });
                                } catch (sendErr: any) {
                                    if (telegramPublisher.isCaptionTooLongError(sendErr)) {
                                        let splitIndex = telegramText.lastIndexOf('\n', CAPTION_LIMIT);
                                        if (splitIndex === -1 || splitIndex < CAPTION_LIMIT * 0.5) {
                                            splitIndex = telegramText.lastIndexOf(' ', CAPTION_LIMIT);
                                        }
                                        if (splitIndex === -1) splitIndex = CAPTION_LIMIT;

                                        const caption = telegramText.substring(0, splitIndex);
                                        const remainder = telegramText.substring(splitIndex).trim();

                                        const photoMsg = await telegramService.sendPhoto(targetChannelId, photoSource as any, {
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
                            sentMessage = await telegramService.sendPhoto(targetChannelId, photoSource as any, {
                                caption: telegramText,
                                parse_mode: 'HTML'
                            });
                        }
                    } else {
                        sentMessage = await telegramPublisher.sendTextSplitting(targetChannelId, telegramText);
                    }
                    sentMessageId = sentMessage?.message_id;
                }

                const channelUsername = (channel.config as any).channel_username;
                if (channelUsername) {
                    publishedLink = `https://t.me/${channelUsername}/${sentMessageId}`;
                } else if (targetChannelId.startsWith('-100')) {
                    const cleanId = targetChannelId.substring(4);
                    publishedLink = `https://t.me/c/${cleanId}/${sentMessageId}`;
                }
            }

            await prisma.post.update({
                where: { id: postId },
                data: {
                    status: 'published',
                    telegram_message_id: sentMessageId,
                    published_link: publishedLink
                }
            });

            if (post.image_url && post.image_url.includes('supabase.co')) {
                try {
                    await storageService.deleteFile(post.image_url);
                } catch (cleanupErr) {
                    console.error(`[Publisher] Failed to cleanup image:`, cleanupErr);
                }
            }

            let publishMethod: 'mtproto' | 'bot_api' | 'vk' | 'linkedin' = 'bot_api';
            if (channel.type === 'vk') publishMethod = 'vk';
            else if (channel.type === 'linkedin') publishMethod = 'linkedin';
            else if (isPublishedViaClient) publishMethod = 'mtproto';

            return { success: true, publishMethod, warning: publishWarning };
        } catch (error) {
            console.error(`[Publisher] Manual publish failed for post ${postId}:`, error);
            await prisma.post.update({
                where: { id: postId },
                data: { status: post.status === 'scheduled' ? 'scheduled' : post.status }
            }).catch(e => console.error(`[Publisher] Failed to rollback status for post ${postId}`, e));
            throw error;
        }
    }

    async scheduleNativePosts(): Promise<void> {
        const now = new Date();
        const lookahead = new Date(now.getTime() + 5 * 60 * 1000);

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
            const settings = post.project.settings;
            const nativeEnabled = settings.find(s => s.key === 'telegram_native_scheduling')?.value === 'true';

            if (!nativeEnabled) continue;

            let channel = null;
            if (post.channel_id) {
                channel = post.project.channels.find(c => c.id === post.channel_id);
            } else {
                channel = post.project.channels.find(c => c.type === 'telegram');
            }

            if (!channel || channel.type !== 'telegram' || !(channel.config as any).telegram_channel_id) {
                continue;
            }

            const targetChannelId = (channel.config as any).telegram_channel_id.toString();
            const text = post.final_text || post.generated_text || '';

            try {
                await telegramClientService.init(post.project_id);

                let imagePathOrUrl: string | undefined;
                if (post.image_url) imagePathOrUrl = post.image_url;

                const result = await telegramClientService.publishPost(post.project_id, targetChannelId, text, imagePathOrUrl, post.publish_at, post.id);

                if (result) {
                    logToFile('INFO', `[Publisher] Scheduled natively via MTProto: Message ID ${(result as any).id}`);

                    await prisma.post.update({
                        where: { id: post.id },
                        data: {
                            status: 'scheduled_native',
                            telegram_message_id: (result as any).id
                        }
                    });
                }
            } catch (err) {
                logToFile('ERROR', `[Publisher] Failed to natively schedule post ${post.id}:`, err);
            }
        }
    }
}

export const legacyPostPublisher = new LegacyPostPublisher();

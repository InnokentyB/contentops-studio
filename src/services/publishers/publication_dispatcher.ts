import prisma from '../../db';
import publicationPlanService from '../publication_plan.service';
import publicationAdapterService from '../publication_adapter.service';
import artDirectionService from '../art_direction.service';
import publicationFactService from '../publication_fact.service';
import { resolvePublicationExecutionRoute, browserFallbackReason } from '../publication_execution_route';
import { connectorAutoModeGuard } from '../publication_approval_guard';
import { derivePublicationContentState } from '../publication_content_state';
import { resolveEffectiveChannelConfig } from '../../utils/channel.utils';
import { telegramPublisher } from './telegram_publisher';
import { vkPublisher } from './vk_publisher';
import { ongoingRulesProcessor } from './ongoing_rules_processor';
import redditService from '../reddit.service';
import gscService from '../gsc.service';
import threadsService from '../threads.service';
import linkedinService from '../linkedin.service';
import tildaService from '../tilda.service';
import okService from '../ok.service';
import habrService from '../habr.service';
import vcService from '../vc.service';
import dzenService from '../dzen.service';
import telegramService from '../telegram.service';
import { dzenPublicationTypeForAction } from '../dzen_publication_route';
import { logToFile } from './publisher_logger';
import { TelegramPublicationRouteError, AutomatedPublicationResult } from './types';
import { normalizeTelegramDeliveryPayload } from '../telegram_delivery_payload';
import { resolveVkStoryPollFromTask } from '../vk_story_poll';
import { createHash } from 'crypto';

export class PublicationDispatcher {
    getPublicContentItemImageUrl(itemId: number, imageUrl: string | null, requestHost?: string): string | null {
        if (!imageUrl) return null;
        if (imageUrl.startsWith('http')) {
            return imageUrl;
        }
        const baseHost = requestHost || process.env.RAILWAY_PUBLIC_DOMAIN || process.env.PUBLIC_URL || process.env.APP_URL;
        if (baseHost) {
            const domain = baseHost.startsWith('http') ? baseHost : `https://${baseHost}`;
            return `${domain}/public/content-items/${itemId}/image`;
        }
        return null;
    }

    async routeToBrowserPublication(task: any, bundle: any, reason: Record<string, unknown>) {
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

    async areTaskDependenciesSatisfied(task: any): Promise<{
        ready: boolean;
        kind?: 'waiting' | 'waiting_on_deferred' | 'blocked_by_skipped';
        details?: any;
    }> {
        const explicitActionDeps = ((task.assets as any)?.action?.dependencies || []) as string[];
        if (explicitActionDeps.length > 0) {
            const dependencyItems = await ongoingRulesProcessor.findDependencyItems(task.project_id, explicitActionDeps);
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

    async executeAutomatedPublicationTask(
        task: any,
        bundle: any,
        channelConfig: any,
        plan: any,
        requestHost?: string,
        publisherFacade?: any
    ): Promise<AutomatedPublicationResult | any> {
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
            const resolvedTargetUrl = targetUrlRef ? (ongoingRulesProcessor.resolvePlanRef(plan, targetUrlRef) as string | null) : null;
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
            const vkConfig = vkPublisher.extractVkAccountConfig(channelConfig);
            const vkId = vkConfig.vk_id;
            const apiKey = vkConfig.publish_access_token;
            const isStory = String(task.type || '').toLowerCase().includes('story')
                || String(task.visual_placement || '').toLowerCase() === 'story';
            if (isStory) {
                const vkImageUrl = typeof imageUrl === 'string' ? imageUrl.trim() : '';
                if (!vkImageUrl) throw new Error('[VK_STORY_MEDIA_REQUIRED] A personal VK story requires an approved image');
                const nativePoll = resolveVkStoryPollFromTask(task);
                const storyParams = {
                    projectId: task.project_id,
                    taskId: task.id,
                    channel: task.channel,
                    imageUrl: vkImageUrl,
                    idempotencyKey: `scheduler:vk-story:${task.project_id}:${task.id}:r${task.accepted_revision || task.content_revision || 0}`,
                    ...(nativePoll ? { poll: nativePoll } : {})
                };
                if (typeof publisherFacade?.publishVkPersonalStory === 'function') {
                    return publisherFacade.publishVkPersonalStory(storyParams);
                }
                return vkPublisher.publishVkPersonalStory(storyParams);
            }
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
            const result = await vkPublisher.publishVkTask({
                projectId: task.project_id,
                taskId: task.id,
                channel: task.channel,
                text: vkText,
                imageUrl: vkImageUrl || undefined,
                idempotencyKey: `task:${task.project_id}:${task.id}:revision:${revision}`
            });
            return {
                adapter: 'vk',
                publishedLink: result.publishedLink,
                metrics: {
                    ...result.metrics,
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
            const resolvedTelegram = await telegramPublisher.resolveTelegramDeliveryConfig(task, channelConfig);
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
                        description: telegramPublisher.extractTelegramErrorDescription(error)
                    });
                }
            }

            const localTestChannel = process.env.LOCAL_TEST_CHANNEL;
            const targetChannelId = (process.env.NODE_ENV !== 'production' && localTestChannel)
                ? localTestChannel
                : telegramTarget;

            const mtprotoCheck = await telegramPublisher.checkMTProto(task.project_id);
            const routeTrace = telegramPublisher.buildTelegramRouteTrace({
                projectId: task.project_id,
                resolved: resolvedTelegram,
                imageUrl: imageUrl || null,
                sessionTarget: mtprotoCheck.sessionTarget as Record<string, unknown> | undefined,
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
                : (mtprotoCheck.sessionTarget as any)?.configured
                    ? 'session_connection_failed'
                    : (mtprotoCheck.sessionTarget as any)?.reason_code || 'project_session_missing';
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
                    const importedClient = require('../telegram_client.service').default;
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
                    const telegramText = telegramPublisher.markdownToTelegramHtml(text);
                    const photoSource = telegramPublisher.getTelegramPhotoSource(imageUrl);
                    if (photoSource) {
                        const CAPTION_LIMIT = 1024;
                        if (telegramText.length > CAPTION_LIMIT) {
                            const publicImageUrl = this.getPublicContentItemImageUrl(task.id, imageUrl, requestHost);
                            if (publicImageUrl) {
                                const sentMessage = await telegramPublisher.sendTextSplitting(targetChannelId, telegramText, {
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

                                const photoMsg = await telegramService.sendPhoto(targetChannelId, photoSource as any, {
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
                            const photoMsg = await telegramService.sendPhoto(targetChannelId, photoSource as any, {
                                caption: telegramText,
                                parse_mode: 'HTML'
                            });
                            sentMessageId = photoMsg?.message_id;
                        }
                    } else {
                        const sentMessage = await telegramPublisher.sendTextSplitting(targetChannelId, telegramText);
                        sentMessageId = sentMessage?.message_id;
                    }
                } catch (error: any) {
                    throw new TelegramPublicationRouteError(
                        `Telegram publish failed for ${normalizedHandle || rawChannelId || task.channel?.name || 'channel'}: ${telegramPublisher.extractTelegramErrorDescription(error)}`,
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
            const publicationType = dzenPublicationTypeForAction(
                actionType, channelType, dzenConfig.default_publication_type
            );
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

    async processPublicationTaskItem(task: any, options: { manualTrigger?: boolean; requestHost?: string; publisherFacade?: any } = {}) {
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

        const plan = await ongoingRulesProcessor.loadPublicationPlanContext(task.project_id);
        const blockingState = plan ? await ongoingRulesProcessor.evaluateBlockingConditions(task, plan) : { ready: true };
        if (!blockingState.ready) {
            if (options.manualTrigger) {
                throw new Error('Task is waiting on blocking conditions');
            }
            logToFile('INFO', `[Publisher] Task ${task.id} is waiting on blocking conditions.`, blockingState.details);
            return { success: false, status: task.status, skipped: true };
        }

        const action = (task.assets as any)?.action;
        if (plan) (plan as any).actions = action ? [action] : [];
        const bundle = plan && action
            ? publicationPlanService.buildHandoffBundle(plan as any, task)
            : publicationPlanService.buildGeneratedContentItemHandoff(task);
        const channelConfig: any = resolveEffectiveChannelConfig(task.channel?.type || '', task.channel?.config || {});
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
                ...connectorAutoModeGuard()
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
            automatedResult = await this.executeAutomatedPublicationTask(task, bundle, channelConfig, plan || { actions: [], assets: {}, accounts: {} }, options.requestHost, options.publisherFacade);
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
                const isStory = String(task.type || '').toLowerCase().includes('story')
                    || String(task.visual_placement || '').toLowerCase() === 'story';
                const ownerId = String(isStory
                    ? automatedResult.metrics?.vk_story_owner_id || ''
                    : automatedResult.metrics?.vk_owner_id || '').trim();
                const objectId = String(isStory
                    ? automatedResult.metrics?.vk_story_id || ''
                    : automatedResult.metrics?.vk_post_id || '').trim();
                const expectedLink = ownerId && objectId
                    ? `https://vk.com/${isStory ? 'story' : 'wall'}${ownerId}_${objectId}`
                    : null;
                if (!expectedLink || automatedResult.publishedLink !== expectedLink) {
                    throw new Error('[PUBLICATION_IDENTITY_MISSING] VK provider did not confirm a matching owner ID, object ID, and permalink');
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
                            ? artifactKind === 'story'
                                ? `story${automatedResult.metrics.vk_story_owner_id}_${automatedResult.metrics.vk_story_id}`
                                : `wall${automatedResult.metrics.vk_owner_id}_${automatedResult.metrics.vk_post_id}`
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

    async processPublicationTasks(publisherFacade?: any): Promise<number> {
        const now = new Date();
        const staleAttemptCutoff = new Date(now.getTime() - 30 * 60 * 1000);
        const dueTasks = await prisma.contentItem.findMany({
            where: {
                schedule_at: { lte: now },
                ...connectorAutoModeGuard(),
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
                await this.processPublicationTaskItem(task, { publisherFacade });
            } catch (error) {
                logToFile('ERROR', `[Publisher] Failed to process publication task ${task.id}`, error);
            }
        }

        return dueTasks.length;
    }

    async processPublicationTaskNow(taskId: number, requestHost?: string, publisherFacade?: any) {
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

        return this.processPublicationTaskItem(task, { manualTrigger: true, requestHost, publisherFacade });
    }
}

export const publicationDispatcher = new PublicationDispatcher();

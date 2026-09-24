import { FastifyInstance } from 'fastify';
import prisma from '../../db';
import authService from '../../services/auth.service';
import dzenService from '../../services/dzen.service';
import vkOAuthService from '../../services/vk_oauth.service';
import threadsService from '../../services/threads.service';
import storageService from '../../services/storage.service';
import generatorService from '../../services/generator.service';
import workQueueService from '../../services/work_queue.service';
import { CreateChannelSchema } from '../../schemas/routes.schema';
import {
    sanitizeChannelConfig,
    mergeChannelConfig,
    prepareChannelConfigForStorage,
    resolveEffectiveChannelConfig
} from '../../utils/channel.utils';
import {
    AuthenticatedUser,
    inferManualContentType,
    inferManualResourceKind,
    readMultipartField,
    isAutoCanvasChannel
} from './helpers';

export default async function projectChannelsRoutes(fastify: FastifyInstance) {
    // Add channel
    fastify.post('/api/projects/:id/channels', async (request, reply) => {
        const user = (request as unknown as { user: AuthenticatedUser }).user;
        const { id } = request.params as { id: string };
        const projectId = parseInt(id, 10);

        const hasAccess = await authService.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            reply.code(403).send({ error: 'No access' });
            return;
        }

        const parseResult = CreateChannelSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.code(400).send({ error: parseResult.error.message });
        }
        const { type, name, config } = parseResult.data;

        let storedConfig: Record<string, unknown>;
        try {
            storedConfig = prepareChannelConfigForStorage(type, config);
        } catch (error: unknown) {
            return reply.code(400).send({ error: (error as Error).message });
        }

        const channel = await prisma.socialChannel.create({
            data: {
                project_id: projectId,
                type,
                name,
                config: storedConfig as any
            }
        });

        return {
            ...channel,
            config: sanitizeChannelConfig(channel.type, channel.config)
        };
    });

    // Edit channel
    fastify.put('/api/projects/:id/channels/:channelId', async (request, reply) => {
        const user = (request as unknown as { user: AuthenticatedUser }).user;
        const { id, channelId } = request.params as { id: string; channelId: string };
        const { name, config } = (request.body as { name?: string; config?: Record<string, unknown> }) || {};
        const projectId = parseInt(id, 10);
        const parsedChannelId = parseInt(channelId, 10);

        const hasAccess = await authService.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            reply.code(403).send({ error: 'No access' });
            return;
        }

        const existingChannel = await prisma.socialChannel.findUnique({
            where: { id: parsedChannelId, project_id: projectId }
        });

        if (!existingChannel) {
            return reply.code(404).send({ error: 'Channel not found' });
        }

        let mergedConfig: Record<string, unknown>;
        try {
            mergedConfig = prepareChannelConfigForStorage(
                existingChannel.type,
                mergeChannelConfig(config, (existingChannel.config as Record<string, unknown>) || {})
            );
        } catch (error: unknown) {
            return reply.code(400).send({ error: (error as Error).message });
        }

        const channel = await prisma.socialChannel.update({
            where: { id: parsedChannelId, project_id: projectId },
            data: {
                name,
                config: mergedConfig as any
            }
        });

        return {
            ...channel,
            config: sanitizeChannelConfig(channel.type, channel.config)
        };
    });

    // Test connection
    fastify.post('/api/projects/:id/channels/:channelId/test-connection', async (request, reply) => {
        const user = (request as unknown as { user: AuthenticatedUser }).user;
        const { id, channelId } = request.params as { id: string; channelId: string };
        const projectId = parseInt(id, 10);
        const parsedChannelId = parseInt(channelId, 10);
        const requestedConfig = (request.body as { config?: Record<string, unknown> } | undefined)?.config;
        const hasAccess = await authService.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) return reply.code(403).send({ error: 'No access' });

        const channel = await prisma.socialChannel.findFirst({
            where: { id: parsedChannelId, project_id: projectId }
        });
        if (!channel) return reply.code(404).send({ error: 'Channel not found' });
        if (!['zen', 'zen_article', 'dzen', 'vk', 'threads'].includes(channel.type)) {
            return reply.code(400).send({ error: 'Connection test is not supported for this channel type' });
        }

        try {
            if (channel.type === 'threads') {
                const savedConfig = resolveEffectiveChannelConfig(channel.type, channel.config);
                const unsavedConfig = requestedConfig && typeof requestedConfig === 'object'
                    ? requestedConfig
                    : {};
                const token = typeof unsavedConfig.access_token === 'string' && unsavedConfig.access_token.trim() !== '' && unsavedConfig.access_token !== '******'
                    ? unsavedConfig.access_token.trim()
                    : savedConfig.access_token;
                const userId = typeof unsavedConfig.threads_user_id === 'string' && unsavedConfig.threads_user_id.trim() !== ''
                    ? unsavedConfig.threads_user_id.trim()
                    : (savedConfig.threads_user_id || savedConfig.user_id);

                if (!token) {
                    return reply.code(400).send({ error: 'Access token is required to test Threads connection', code: 'THREADS_TOKEN_REQUIRED' });
                }

                const result = await threadsService.testConnection({
                    access_token: token,
                    threads_user_id: userId
                });

                if (!result.success) {
                    return reply.code(400).send({ error: result.error || 'Failed to connect to Threads', code: 'THREADS_CONNECTION_TEST_FAILED' });
                }

                return {
                    success: true,
                    result: result.details
                };
            }

            if (channel.type === 'vk') {
                let config = resolveEffectiveChannelConfig('vk', channel.config);
                if (!config.vk_id) {
                    return reply.code(400).send({ error: 'Connect VK before testing this channel', code: 'VK_NOT_CONNECTED' });
                }
                const canRefreshServerOAuth = config.oauth_token_profile === 'server_refreshed'
                    && config.vk_refresh_token
                    && config.vk_device_id;
                if (canRefreshServerOAuth) {
                    const refreshed = await vkOAuthService.refreshStoredChannelToken(prisma, channel.id);
                    config = {
                        ...config,
                        vk_oauth_access_token: refreshed.accessToken,
                        vk_refresh_token: refreshed.refreshToken,
                        oauth_user_id: refreshed.userId || config.oauth_user_id,
                        oauth_expires_at: refreshed.expiresAt
                    };
                }
                const identityToken = config.vk_oauth_access_token || config.user_access_token;
                const identity = identityToken
                    ? await vkOAuthService.verifyCommunityAdmin(identityToken, String(config.vk_id), Number(config.oauth_user_id) || undefined)
                    : null;
                const profileId = identity?.userId || Number(config.oauth_user_id) || null;
                const serverStoryOAuth = config.oauth_token_profile === 'server_refreshed'
                    && config.vk_oauth_access_token
                    && config.vk_refresh_token
                    && config.vk_device_id;
                if (config.user_access_token && identity?.userId) {
                    const nextConfig = prepareChannelConfigForStorage('vk', {
                        ...((channel.config as Record<string, unknown>) || {}),
                        oauth_user_id: identity.userId,
                        user_token_profile: 'classic_vk_api',
                        user_token_verified_at: new Date().toISOString()
                    });
                    await prisma.socialChannel.update({ where: { id: channel.id }, data: { config: nextConfig as any } });
                }
                return {
                    success: true,
                    result: {
                        ...(identity || {}),
                        connected: Boolean(identity),
                        capabilities: {
                            feed_text: Boolean(config.publish_access_token),
                            feed_image: Boolean(config.publish_access_token && config.user_access_token),
                            personal_story: Boolean((config.user_access_token || serverStoryOAuth) && profileId),
                            vk_id_identity: Boolean(config.vk_oauth_access_token && config.oauth_user_id)
                        }
                    }
                };
            }
            const savedConfig = resolveEffectiveChannelConfig(channel.type, channel.config);
            const unsavedConfig = requestedConfig && typeof requestedConfig === 'object'
                ? requestedConfig
                : {};
            const cookies = typeof unsavedConfig.cookies === 'string' && unsavedConfig.cookies.trim() !== '' && unsavedConfig.cookies !== '******'
                ? unsavedConfig.cookies.trim()
                : savedConfig.cookies;
            const result = await dzenService.testConnection({
                ...savedConfig,
                ...unsavedConfig,
                cookies
            });
            return { success: true, result };
        } catch (error: unknown) {
            const err = error as Error;
            const channelName = channel.type === 'vk' ? 'VK' : channel.type === 'threads' ? 'Threads' : 'Dzen';
            const channelCode = channel.type === 'vk' ? 'VK_CONNECTION_TEST_FAILED' : channel.type === 'threads' ? 'THREADS_CONNECTION_TEST_FAILED' : 'DZEN_CONNECTION_TEST_FAILED';
            return reply.code(400).send({
                error: err.message || `${channelName} connection test failed`,
                code: channelCode
            });
        }
    });

    // Delete channel
    fastify.delete('/api/projects/:id/channels/:channelId', async (request, reply) => {
        const user = (request as unknown as { user: AuthenticatedUser }).user;
        const { id, channelId } = request.params as { id: string; channelId: string };
        const projectId = parseInt(id, 10);
        const parsedChannelId = parseInt(channelId, 10);

        const hasAccess = await authService.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            reply.code(403).send({ error: 'No access' });
            return;
        }

        const defaultChannelSetting = await prisma.projectSettings.findFirst({
            where: { project_id: projectId, key: 'default_channel_id', value: String(parsedChannelId) }
        });
        if (defaultChannelSetting) {
            await prisma.projectSettings.delete({
                where: { id: defaultChannelSetting.id }
            });
        }

        await prisma.socialChannel.delete({
            where: { id: parsedChannelId, project_id: projectId }
        });

        return { success: true };
    });

    // Manual content creation
    fastify.post('/api/projects/:id/channels/:channelId/manual-content', async (request, reply) => {
        const user = (request as unknown as { user: AuthenticatedUser }).user;
        const { id, channelId } = request.params as { id: string; channelId: string };
        const {
            fileName,
            fileType,
            content,
            note,
            publishedLink,
            publishNow,
            outcome
        } = request.body as {
            fileName?: string;
            fileType?: 'markdown' | 'html' | 'unknown';
            content?: string;
            note?: string;
            publishedLink?: string;
            publishNow?: boolean;
            outcome?: 'published' | 'blocked' | 'removed' | 'restricted';
        };

        const projectId = parseInt(id, 10);
        const parsedChannelId = parseInt(channelId, 10);

        const hasAccess = await authService.hasProjectAccess(user.id, projectId, 'editor');
        if (!hasAccess) {
            reply.code(403).send({ error: 'No access' });
            return;
        }

        if (!content?.trim()) {
            return reply.code(400).send({ error: 'content is required' });
        }

        const channel = await prisma.socialChannel.findFirst({
            where: {
                id: parsedChannelId,
                project_id: projectId
            }
        });

        if (!channel) {
            return reply.code(404).send({ error: 'Channel not found' });
        }

        const safeFileName = (fileName || 'manual-content').trim();
        const title = safeFileName.replace(/\.(md|markdown|html|htm)$/i, '').replace(/[-_]+/g, ' ').trim() || safeFileName;
        const normalizedPublishedLink = publishedLink?.trim() || null;
        const publicationOutcome = outcome || 'published';
        const shouldMarkPublished = publishNow === true && Boolean(normalizedPublishedLink);

        const item = await prisma.contentItem.create({
            data: {
                project_id: projectId,
                channel_id: channel.id,
                type: inferManualContentType(channel.type, fileType || null),
                layer: channel.type,
                title,
                brief: note?.trim() || `Manual ${fileType || 'text'} upload for ${channel.name}`,
                draft_text: content,
                status: shouldMarkPublished ? 'published' : 'drafted',
                assets: {
                    source: 'manual_upload',
                    manual_upload: {
                        file_name: safeFileName,
                        file_type: fileType || 'unknown',
                        note: note || null,
                        published_link: normalizedPublishedLink
                    }
                } as any,
                quality_report: {
                    execution_mode: 'manual',
                    content_origin: 'manual_upload',
                    manual_publication_note: note || null,
                    publication_outcome: shouldMarkPublished ? publicationOutcome : null,
                    handoff_bundle: {
                        mode: 'manual',
                        account: {
                            ref: channel.name,
                            details: channel.config || null
                        },
                        task: {
                            id: `manual-${Date.now()}`,
                            display_name: title,
                            channel: channel.type,
                            action_type: 'manual_upload'
                        },
                        publication: {
                            body: content,
                            html_bundle: fileType === 'html' ? [{ file_name: safeFileName }] : [],
                            link_url: normalizedPublishedLink,
                            visuals: []
                        },
                        resource_files: [
                            {
                                role: 'manual_upload',
                                purpose: 'User-provided channel content',
                                file_name: safeFileName,
                                relative_path: null,
                                full_path: null,
                                section_marker: null,
                                exists: true,
                                url: null,
                                content
                            }
                        ],
                        manual_checklist: ['Review the uploaded content and continue the channel workflow.'],
                        verification: [],
                        post_actions: [],
                        dependencies: []
                    }
                } as any,
                metrics: {
                    content_origin: 'manual_upload',
                    channel_ref: channel.name,
                    uploaded_at: new Date().toISOString(),
                    publication_outcome: shouldMarkPublished ? publicationOutcome : null,
                    manual_confirmation_at: shouldMarkPublished ? new Date().toISOString() : null
                } as any,
                published_link: normalizedPublishedLink
            },
            include: {
                channel: true
            }
        });

        return item;
    });

    // Manual content multipart upload
    fastify.post('/api/projects/:id/channels/:channelId/manual-content-upload', async (request, reply) => {
        const user = (request as unknown as { user: AuthenticatedUser }).user;
        const { id, channelId } = request.params as { id: string; channelId: string };
        const data = await (request as any).file();

        const projectId = parseInt(id, 10);
        const parsedChannelId = parseInt(channelId, 10);

        const hasAccess = await authService.hasProjectAccess(user.id, projectId, 'editor');
        if (!hasAccess) {
            reply.code(403).send({ error: 'No access' });
            return;
        }

        if (!data) {
            return reply.code(400).send({ error: 'No file uploaded' });
        }

        const channel = await prisma.socialChannel.findFirst({
            where: {
                id: parsedChannelId,
                project_id: projectId
            }
        });

        if (!channel) {
            return reply.code(404).send({ error: 'Channel not found' });
        }

        const note = readMultipartField((data as any).fields?.note).trim();
        const publishedLink = readMultipartField((data as any).fields?.publishedLink).trim() || null;
        const publishNow = readMultipartField((data as any).fields?.publishNow) === 'true';
        const outcome = (readMultipartField((data as any).fields?.outcome) || 'published') as 'published' | 'blocked' | 'removed' | 'restricted';

        const buffer = await data.toBuffer();
        const safeFileName = (data.filename || 'manual-upload').trim();
        const resourceKind = inferManualResourceKind(safeFileName, data.mimetype);
        const normalizedPublishedLink = publishedLink;
        const shouldMarkPublished = publishNow === true && Boolean(normalizedPublishedLink);
        const title = safeFileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || safeFileName;

        let content: string | null = null;
        let fileUrl: string | null = null;
        let previewUrl: string | null = null;

        if (resourceKind === 'markdown' || resourceKind === 'html' || resourceKind === 'text') {
            content = buffer.toString('utf8');
        } else {
            const ext = safeFileName.split('.').pop() || 'png';
            const filename = `manual-${projectId}-${parsedChannelId}-${Date.now()}.${ext}`;
            fileUrl = await storageService.uploadFileFromBuffer(buffer, data.mimetype || 'application/octet-stream', `uploads/${filename}`);
            previewUrl = resourceKind === 'image' ? fileUrl : null;
        }

        const item = await prisma.contentItem.create({
            data: {
                project_id: projectId,
                channel_id: channel.id,
                type: inferManualContentType(channel.type, resourceKind === 'html' ? 'html' : resourceKind === 'markdown' ? 'markdown' : null),
                layer: channel.type,
                title,
                brief: note || `Manual ${resourceKind} upload for ${channel.name}`,
                draft_text: content,
                status: shouldMarkPublished ? 'published' : 'drafted',
                assets: {
                    source: 'manual_upload',
                    manual_upload: {
                        file_name: safeFileName,
                        file_type: resourceKind,
                        mime_type: data.mimetype || null,
                        note: note || null,
                        published_link: normalizedPublishedLink,
                        file_url: fileUrl,
                        preview_url: previewUrl
                    }
                } as any,
                quality_report: {
                    execution_mode: 'manual',
                    content_origin: 'manual_upload',
                    manual_publication_note: note || null,
                    publication_outcome: shouldMarkPublished ? outcome : null,
                    handoff_bundle: {
                        mode: 'manual',
                        account: {
                            ref: channel.name,
                            details: channel.config || null
                        },
                        task: {
                            id: `manual-${Date.now()}`,
                            display_name: title,
                            channel: channel.type,
                            action_type: 'manual_upload'
                        },
                        publication: {
                            body: content,
                            html_bundle: resourceKind === 'html' ? [{ file_name: safeFileName }] : [],
                            link_url: normalizedPublishedLink,
                            visuals: previewUrl ? [{ file_name: safeFileName, mime_type: data.mimetype || 'image/png', url: previewUrl }] : []
                        },
                        resource_files: [
                            {
                                role: 'manual_upload',
                                purpose: 'User-provided channel content',
                                file_name: safeFileName,
                                relative_path: null,
                                full_path: null,
                                section_marker: null,
                                exists: true,
                                url: fileUrl,
                                content
                            }
                        ],
                        manual_checklist: ['Review the uploaded file and continue the channel workflow.'],
                        verification: [],
                        post_actions: [],
                        dependencies: []
                    }
                } as any,
                metrics: {
                    content_origin: 'manual_upload',
                    channel_ref: channel.name,
                    uploaded_at: new Date().toISOString(),
                    publication_outcome: shouldMarkPublished ? outcome : null,
                    manual_confirmation_at: shouldMarkPublished ? new Date().toISOString() : null,
                    uploaded_resource_kind: resourceKind
                } as any,
                published_link: normalizedPublishedLink
            },
            include: {
                channel: true
            }
        });

        return item;
    });

    // Auto canvas status
    fastify.get('/api/projects/:id/channels/:channelId/auto-canvas-status', async (request, reply) => {
        const user = (request as unknown as { user: AuthenticatedUser }).user;
        const { id, channelId } = request.params as { id: string; channelId: string };
        const projectId = parseInt(id, 10);
        const parsedChannelId = parseInt(channelId, 10);
        const requestedWeekPackageId = Number((request.query as { weekPackageId?: string }).weekPackageId || 0);

        const hasAccess = await authService.hasProjectAccess(user.id, projectId, 'editor');
        if (!hasAccess) {
            reply.code(403).send({ error: 'No access' });
            return;
        }

        const channel = await prisma.socialChannel.findFirst({
            where: {
                id: parsedChannelId,
                project_id: projectId
            }
        });

        if (!channel) {
            return reply.code(404).send({ error: 'Channel not found' });
        }

        const channelItems = await prisma.contentItem.findMany({
            where: {
                project_id: projectId,
                channel_id: parsedChannelId,
                ...(requestedWeekPackageId > 0 ? { week_package_id: requestedWeekPackageId } : {})
            },
            include: {
                week_package: true
            },
            orderBy: [
                { schedule_at: 'asc' },
                { id: 'asc' }
            ]
        });

        const channelConfig = channel.config as Record<string, unknown> | null;
        const rawAccount = channelConfig?.raw_account as Record<string, unknown> | undefined;

        const latestWeekPackage = channelItems
            .map((item) => item.week_package)
            .filter((wp): wp is NonNullable<typeof wp> => Boolean(wp))
            .sort((left, right) => {
                const leftTime = new Date(left.week_start).getTime();
                const rightTime = new Date(right.week_start).getTime();
                return rightTime - leftTime;
            })[0] || null;

        const packageItems = latestWeekPackage
            ? await prisma.contentItem.findMany({
                where: {
                    project_id: projectId,
                    week_package_id: latestWeekPackage.id,
                    type: { not: 'week_theme' }
                },
                include: { channel: true },
                orderBy: [{ publish_at: 'asc' }, { id: 'asc' }]
            })
            : [];
        const visibleItems = packageItems.filter((item) =>
            item.channel_id === parsedChannelId
            && item.item_key?.startsWith(`week-topic:${latestWeekPackage?.id}:`)
        );

        return {
            channel: {
                id: channel.id,
                name: channel.name,
                type: channel.type,
                workflow_mode: (channelConfig?.workflow_mode || rawAccount?.planner_generation_mode || null) as string | null,
                auto_canvas_enabled: isAutoCanvasChannel(channel)
            },
            week_package: latestWeekPackage ? {
                id: latestWeekPackage.id,
                week_theme: latestWeekPackage.week_theme,
                core_thesis: latestWeekPackage.core_thesis,
                approval_status: latestWeekPackage.approval_status,
                plan_version: latestWeekPackage.plan_version,
                week_start: latestWeekPackage.week_start,
                week_end: latestWeekPackage.week_end
            } : null,
            stats: {
                total: visibleItems.length,
                planned: visibleItems.filter((item) => item.status === 'planned').length,
                drafted: visibleItems.filter((item) => item.status === 'drafted').length,
                published: visibleItems.filter((item) => item.status === 'published').length,
                failed: visibleItems.filter((item) => item.status === 'failed').length
            },
            items: visibleItems.map((item) => ({
                id: item.id,
                title: item.title,
                brief: item.brief,
                key_points: item.key_points,
                status: item.status,
                schedule_at: item.schedule_at,
                draft_text: item.draft_text,
                published_link: item.published_link
            })),
            plan_items: packageItems.map((item) => ({
                id: item.id,
                title: item.title,
                type: item.type,
                status: item.status,
                schedule_at: item.schedule_at,
                publish_at: item.publish_at,
                published_link: item.published_link,
                channel: item.channel ? {
                    id: item.channel.id,
                    name: item.channel.name,
                    type: item.channel.type
                } : null,
                is_week_topic: item.channel_id === parsedChannelId
                    && item.item_key?.startsWith(`week-topic:${latestWeekPackage?.id}:`)
            }))
        };
    });

    // Auto canvas week-plan decision
    fastify.post('/api/projects/:id/channels/:channelId/week-plans/:weekPackageId/decision', async (request, reply) => {
        const user = (request as unknown as { user: AuthenticatedUser }).user;
        const { id, channelId, weekPackageId } = request.params as { id: string; channelId: string; weekPackageId: string };
        const { decision, comment } = (request.body as { decision?: 'approved' | 'rejected'; comment?: string }) || {};
        const projectId = Number(id);
        const parsedChannelId = Number(channelId);
        const parsedWeekPackageId = Number(weekPackageId);

        if (![projectId, parsedChannelId, parsedWeekPackageId].every(Number.isInteger) || !['approved', 'rejected'].includes(String(decision))) {
            return reply.code(400).send({ error: 'Invalid week-plan decision request' });
        }
        if (!await authService.hasProjectAccess(user.id, projectId, 'owner')) {
            return reply.code(403).send({ error: 'Only the project owner can approve the weekly plan' });
        }

        const weekPackage = await prisma.weekPackage.findFirst({
            where: {
                id: parsedWeekPackageId,
                project_id: projectId,
                content_items: { some: { channel_id: parsedChannelId, type: { not: 'week_theme' } } }
            }
        });
        if (!weekPackage) return reply.code(404).send({ error: 'Weekly plan not found for this channel' });
        if (!weekPackage.plan_version) return reply.code(409).send({ error: 'Weekly plan has no current version to approve' });

        return workQueueService.decideWeekPlan({
            projectId,
            actorId: `user:${user.id}`,
            weekPackageId: parsedWeekPackageId,
            planVersion: weekPackage.plan_version,
            decision: decision!,
            comment: comment?.trim() || undefined,
            idempotencyKey: `ui-week-plan:${parsedWeekPackageId}:${weekPackage.plan_version}:${decision}`
        });
    });

    // Auto canvas generate
    fastify.post('/api/projects/:id/channels/:channelId/auto-canvas-generate', async (request, reply) => {
        const user = (request as unknown as { user: AuthenticatedUser }).user;
        const { id, channelId } = request.params as { id: string; channelId: string };
        const { limit } = (request.body as { limit?: number }) || {};
        const projectId = parseInt(id, 10);
        const parsedChannelId = parseInt(channelId, 10);

        const hasAccess = await authService.hasProjectAccess(user.id, projectId, 'editor');
        if (!hasAccess) {
            reply.code(403).send({ error: 'No access' });
            return;
        }

        const channel = await prisma.socialChannel.findFirst({
            where: {
                id: parsedChannelId,
                project_id: projectId
            }
        });

        if (!channel) {
            return reply.code(404).send({ error: 'Channel not found' });
        }

        if (!isAutoCanvasChannel(channel)) {
            return reply.code(400).send({ error: 'This channel is not configured for automatic canvas generation.' });
        }

        const itemsToProcess = await prisma.contentItem.findMany({
            where: {
                project_id: projectId,
                channel_id: parsedChannelId,
                status: { in: ['planned', 'failed'] },
                week_package: { approval_status: 'approved' }
            },
            orderBy: [
                { schedule_at: 'asc' },
                { id: 'asc' }
            ],
            take: Math.max(1, Math.min(limit || 10, 50))
        });

        const results: Array<{ id: number; status: string; error?: string | null }> = [];
        for (const item of itemsToProcess) {
            try {
                await generatorService.generateContentItemText(item.id);
                results.push({ id: item.id, status: 'drafted' });
            } catch (error: unknown) {
                const err = error as Error;
                await prisma.contentItem.update({
                    where: { id: item.id },
                    data: { status: 'failed' }
                });
                results.push({ id: item.id, status: 'failed', error: err?.message || 'Generation failed' });
            }
        }

        return {
            channel_id: parsedChannelId,
            processed: results.length,
            results
        };
    });
}

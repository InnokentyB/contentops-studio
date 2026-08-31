import { FastifyInstance } from 'fastify';
import plannerService from '../services/planner.service';
import generatorService from '../services/generator.service';
import multiAgentService from '../services/multi_agent.service';
import { channelContentLanguage } from '../services/content_language.service';
import publisherService from '../services/publisher.service';
import initiativeService from '../services/initiative.service';
import modelService from '../services/model.service';
import { modelForRole } from '../services/model_policy.service';
import v2Orchestrator from '../services/v2_orchestrator.service';
import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

import authService from '../services/auth.service';
import commentService from '../services/comment.service';
import storageService from '../services/storage.service';
import contentDictionaryService from '../services/content_dictionary.service';
import contentPolicyMatrixService from '../services/content_policy_matrix.service';
import publicationPlanService from '../services/publication_plan.service';
import metricsService from '../services/metrics.service';
import vkMetricsService from '../services/vk_metrics.service';
import { jsonBytes, logEgressDiagnostic, textBytes } from '../utils/egress_diagnostics';
import { derivePublicationContentState } from '../services/publication_content_state';
import publicationFactService from '../services/publication_fact.service';
import { isPublicationTaskActive } from '../services/publication_task_activity';
import artDirectionService from '../services/art_direction.service';
import publicationAdapterService from '../services/publication_adapter.service';
import { derivePublicationGenerationStage } from '../services/publication_generation_stage';
import imageAssetService from '../services/image_asset.service';
import { assertVisualGenerationGate, hardenEditorialVisualPrompt } from '../services/visual_generation_policy';

async function loadPublicationPlanContext(projectId: number) {
    const settings = await prisma.projectSettings.findMany({
        where: {
            project_id: projectId,
            key: { in: ['publication_plan_meta', 'publication_plan_assets', 'publication_plan_accounts', 'publication_plan_asset_snapshots', 'publication_plan_content_file_snapshots'] }
        }
    });

    const meta = settings.find((setting) => setting.key === 'publication_plan_meta')?.value;
    const assets = settings.find((setting) => setting.key === 'publication_plan_assets')?.value;
    const accounts = settings.find((setting) => setting.key === 'publication_plan_accounts')?.value;
    const assetSnapshots = settings.find((setting) => setting.key === 'publication_plan_asset_snapshots')?.value;
    const contentFileSnapshots = settings.find((setting) => setting.key === 'publication_plan_content_file_snapshots')?.value;

    if (!meta || !assets || !accounts) {
        return null;
    }

    return {
        meta: JSON.parse(meta),
        assets: JSON.parse(assets),
        accounts: JSON.parse(accounts),
        asset_snapshots: assetSnapshots ? JSON.parse(assetSnapshots) : {},
        content_file_snapshots: contentFileSnapshots ? JSON.parse(contentFileSnapshots) : {},
        actions: [] as any[]
    };
}

function safeJsonParse<T = any>(value?: string | null): T | null {
    if (!value?.trim()) return null;
    try {
        return JSON.parse(value) as T;
    } catch {
        return null;
    }
}

function formatJson(value: unknown) {
    return JSON.stringify(value, null, 2);
}

function parseMetricsDate(value?: string, field = 'date') {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`${field} must be a valid ISO date`);
    }
    return parsed;
}

function csvCell(value: unknown) {
    if (value === null || value === undefined) return '';
    const serialized = value instanceof Date ? value.toISOString() : String(value);
    return `"${serialized.replace(/"/g, '""')}"`;
}

function extractRequestErrorMessage(error: any, fallback: string) {
    const directMessage = typeof error?.message === 'string' ? error.message.trim() : '';
    const providerDescription = typeof error?.response?.description === 'string'
        ? error.response.description.trim()
        : (typeof error?.description === 'string' ? error.description.trim() : '');

    if (providerDescription) {
        if (directMessage && directMessage !== 'Bad Request' && directMessage !== providerDescription) {
            return `${directMessage}: ${providerDescription}`;
        }
        return providerDescription;
    }

    if (directMessage) {
        return directMessage;
    }

    return fallback;
}

async function loadPublicationProjectContext(projectId: number) {
    const settings = await prisma.projectSettings.findMany({
        where: {
            project_id: projectId,
            key: { in: ['content_dictionary_yaml', 'content_policy_matrix_yaml', 'atoma_files_description', 'atoma_files_payload'] }
        }
    });

    return {
        glossaryYaml: settings.find((setting) => setting.key === 'content_dictionary_yaml')?.value || null,
        contentPolicyMatrixYaml: settings.find((setting) => setting.key === 'content_policy_matrix_yaml')?.value || null,
        atomaFilesDescription: settings.find((setting) => setting.key === 'atoma_files_description')?.value || null,
        atomaFilesPayload: safeJsonParse(settings.find((setting) => setting.key === 'atoma_files_payload')?.value || null)
    };
}

function derivePublicationVoice(item: any) {
    return (
        (item?.assets as any)?.action?.voice_profile
        || (item?.assets as any)?.action?.parameters?.voice_profile
        || (item?.channel?.config as any)?.voice_profile
        || (item?.metrics as any)?.voice_profile
        || null
    );
}

function resolveTaskScheduleAt(item: any) {
    const actionScheduleAt = (item?.assets as any)?.action?.scheduled_at;
    if (typeof actionScheduleAt === 'string' && actionScheduleAt.trim()) {
        return actionScheduleAt;
    }
    return item?.schedule_at?.toISOString?.() || item?.schedule_at || null;
}

function buildPublicationTaskListItem(item: any) {
    const qualityReport = (item.quality_report as any) || {};
    const metrics = (item.metrics as any) || {};
    const publicationOutcome = item.publication_fact?.outcome
        || qualityReport.publication_outcome
        || metrics.publication_outcome
        || null;

    return {
        id: item.id,
        item_key: item.item_key || null,
        type: item.type,
        layer: item.layer,
        title: item.title,
        brief: item.brief,
        status: item.status,
        is_active: isPublicationTaskActive(item),
        publication_outcome: publicationOutcome,
        schedule_at: item?.schedule_at?.toISOString?.() || item?.schedule_at || null,
        published_link: item.published_link,
        content_state: derivePublicationContentState(item),
        content_revision: item.content_revision || 0,
        generation_stage: derivePublicationGenerationStage({
            status: item.status,
            draftText: item.draft_text,
            textState: item.text_state,
            visualState: item.visual_state,
            handoffState: item.handoff_state,
            publicationMode: item.publication_mode,
            workItems: item.work_items
        }),
        publication_mode: item.publication_mode || null,
        selected_asset: item.selected_asset ? {
            id: item.selected_asset.id,
            file_url: item.selected_asset.file_url || null,
            alt_text: item.selected_asset.alt_text || null,
            status: item.selected_asset.status || null
        } : null,
        week_package_id: item.week_package_id || null,
        publication_fact: item.publication_fact || null,
        metrics: {
            monitoring: metrics.monitoring || null,
            collected_metrics: metrics.collected_metrics || null,
            publication_outcome: metrics.publication_outcome || null,
            account_ref: metrics.account_ref || null,
            metrics_updated_at: metrics.metrics_updated_at || null
        },
        quality_report: {
            execution_mode: qualityReport.execution_mode || null,
            publication_outcome: qualityReport.publication_outcome || null,
            publication_route: qualityReport.publication_route || null,
            browser_handoff: qualityReport.browser_handoff || null
        },
        channel: item.channel ? {
            id: item.channel.id,
            name: item.channel.name,
            type: item.channel.type,
            config: item.channel.config || null
        } : null
    };
}

function buildPublicationTaskDetailItem(item: any, options?: {
    handoffBundle?: any | null;
    projectContext?: {
        glossaryYaml: string | null;
        contentPolicyMatrixYaml: string | null;
        atomaFilesDescription: string | null;
        atomaFilesPayload: any | null;
    };
}) {
    const qualityReport = (item.quality_report as any) || {};
    const metrics = (item.metrics as any) || {};
    const assets = (item.assets as any) || {};
    const handoffBundle = options?.handoffBundle || qualityReport.handoff_bundle || null;
    const firstResourceWithUrl = (handoffBundle?.resource_files || []).find((entry: any) => entry?.url);
    const firstSourceContent = (handoffBundle?.resource_files || []).find((entry: any) => typeof entry?.content === 'string' && entry.content.trim());
    const derivedVoice = derivePublicationVoice(item);

    return {
        id: item.id,
        item_key: item.item_key || null,
        type: item.type,
        layer: item.layer,
        title: item.title,
        brief: item.brief,
        key_points: item.key_points || null,
        status: item.status,
        schedule_at: resolveTaskScheduleAt(item),
        published_link: item.published_link,
        draft_text: item.draft_text || null,
        content_state: derivePublicationContentState({ ...item, quality_report: { ...qualityReport, handoff_bundle: handoffBundle } }),
        content_revision: item.content_revision || 0,
        accepted_revision: item.accepted_revision || null,
        text_state: item.text_state || null,
        generation_stage: derivePublicationGenerationStage({
            status: item.status,
            draftText: item.draft_text,
            textState: item.text_state,
            visualState: item.visual_state,
            handoffState: item.handoff_state,
            publicationMode: item.publication_mode,
            workItems: item.work_items
        }),
        publication_mode: item.publication_mode || null,
        week_package_id: item.week_package_id || null,
        publication_fact: item.publication_fact || null,
        metric_checkpoints: Array.isArray(item.metric_snapshots) ? item.metric_snapshots : [],
        channel: item.channel ? {
            id: item.channel.id,
            name: item.channel.name,
            type: item.channel.type,
            config: item.channel.config || null
        } : null,
        assets: {
            action: assets.action || null,
            resolved_assets: assets.resolved_assets || [],
            generated_visuals: assets.generated_visuals || []
        },
        metrics: {
            monitoring: metrics.monitoring || null,
            collected_metrics: metrics.collected_metrics || null,
            publication_outcome: metrics.publication_outcome || null,
            account_ref: metrics.account_ref || null,
            task_id: metrics.task_id || null,
            metrics_updated_at: metrics.metrics_updated_at || null
        },
        quality_report: {
            execution_mode: qualityReport.execution_mode || null,
            publication_outcome: qualityReport.publication_outcome || null,
            manual_publication_note: qualityReport.manual_publication_note || null,
            critic_review: qualityReport.critic_review || null,
            generated_image: qualityReport.generated_image || null,
            content_edit_history: Array.isArray(qualityReport.content_edit_history) ? qualityReport.content_edit_history : [],
            verification: qualityReport.verification || null,
            post_actions: qualityReport.post_actions || null,
            handoff_bundle: handoffBundle
        },
        project_context: {
            glossary_available: Boolean(options?.projectContext?.glossaryYaml),
            glossary_yaml: options?.projectContext?.glossaryYaml || null,
            content_policy_matrix_yaml: options?.projectContext?.contentPolicyMatrixYaml || null,
            atoma_files_description: options?.projectContext?.atomaFilesDescription || null,
            atoma_files_payload: options?.projectContext?.atomaFilesPayload || null
        },
        workspace_context: {
            plan_item_ref: assets.action?.id || metrics.task_id || null,
            target_resource_url: handoffBundle?.publication?.link_url || firstResourceWithUrl?.url || null,
            target_resource_label: handoffBundle?.publication?.link_url ? 'publication.link_url' : firstResourceWithUrl?.file_name || firstResourceWithUrl?.ref || null,
            source_content: firstSourceContent?.content || handoffBundle?.publication?.body || item.draft_text || '',
            source_file_name: firstSourceContent?.file_name || null,
            voice_profile: derivedVoice,
            platform_type: item.channel?.type || item.layer || null
        }
    };
}

function countBundleResourceFiles(bundle: any) {
    return Array.isArray(bundle?.resource_files) ? bundle.resource_files.length : 0;
}

function countResolvedAssets(item: any) {
    return Array.isArray((item?.assets as any)?.resolved_assets) ? (item.assets as any).resolved_assets.length : 0;
}

async function runPublicationCriticReview(projectId: number, item: any, overrideText?: string) {
    const plan = await loadPublicationPlanContext(projectId);
    const projectContext = await loadPublicationProjectContext(projectId);
    const action = (item.assets as any)?.action;
    const bundle = plan && action
        ? publicationPlanService.buildHandoffBundle({ ...plan, actions: [action] } as any, item)
        : ((item.quality_report as any)?.handoff_bundle || null);

    const publicationBody = (overrideText || bundle?.publication?.body || item.draft_text || '').trim();
    const sourceContent = ((bundle?.resource_files || []) as any[]).find((entry) => typeof entry?.content === 'string' && entry.content.trim())?.content || '';
    if (!publicationBody) {
        throw new Error('No publication body is available for critic review.');
    }

    const platform = item.channel?.type || item.layer || item.type;
    const contentLanguage = channelContentLanguage(item.channel);
    const voice = derivePublicationVoice(item);
    const dictionaryReport = contentDictionaryService.validateText(publicationBody, projectContext.glossaryYaml);
    const policyReport = contentPolicyMatrixService.validateText(publicationBody, projectContext.contentPolicyMatrixYaml, {
        platform,
        voice
    });

    let llmCritic: any = null;
    let llmError: string | null = null;

    try {
        llmCritic = await multiAgentService.runPublicationCritic(projectId, {
            task_id: (action as any)?.id || (item.metrics as any)?.task_id || item.id,
            title: item.title,
            channel: item.channel?.name || item.layer || item.type,
            platform,
            content_language: contentLanguage,
            voice_profile: voice,
            target_resource_url: bundle?.publication?.link_url || null,
            publication_body: publicationBody,
            source_content: sourceContent,
            glossary_yaml: projectContext.glossaryYaml,
            content_policy_matrix_yaml: projectContext.contentPolicyMatrixYaml,
            applied_policy: policyReport.derived_policy,
            deterministic_findings: {
                dictionary: dictionaryReport.findings,
                policy: policyReport.findings,
                dictionary_score: dictionaryReport.score,
                policy_score: policyReport.score,
                policy_dimensions: policyReport.dimensions
            },
            atoma_files_description: projectContext.atomaFilesDescription,
            atoma_files_payload: projectContext.atomaFilesPayload
        });
    } catch (error: any) {
        llmError = error?.message || 'Critic agent failed';
    }

    const llmDimensions = llmCritic?.dimensions && typeof llmCritic.dimensions === 'object'
        ? llmCritic.dimensions
        : {};
    const mergedDimensions = {
        platform_fit: Math.round(((policyReport.dimensions.platform_fit || 0) + (Number(llmDimensions.platform_fit) || policyReport.dimensions.platform_fit || 0)) / 2),
        voice_fit: Math.round(((policyReport.dimensions.voice_fit || 0) + (Number(llmDimensions.voice_fit) || policyReport.dimensions.voice_fit || 0)) / 2),
        length_fit: Math.round(((policyReport.dimensions.length_fit || 0) + (Number(llmDimensions.length_fit) || policyReport.dimensions.length_fit || 0)) / 2),
        rule_fit: Math.round(((policyReport.dimensions.rule_fit || 0) + (Number(llmDimensions.rule_fit) || policyReport.dimensions.rule_fit || 0)) / 2),
        dictionary_fit: dictionaryReport.score,
        llm_quality: llmCritic?.score ?? null
    };

    const overallScore = llmCritic
        ? Math.round((dictionaryReport.score + policyReport.score + llmCritic.score) / 3)
        : Math.round((dictionaryReport.score + policyReport.score) / 2);

    const criticReview = {
        checked_at: new Date().toISOString(),
        overall_score: overallScore,
        dictionary: dictionaryReport,
        policy_matrix: {
            score: policyReport.score,
            findings: policyReport.findings,
            dimensions: policyReport.dimensions,
            derived_policy: policyReport.derived_policy
        },
        scoring_dimensions: mergedDimensions,
        llm_critic: llmCritic,
        llm_error: llmError,
        glossary_available: Boolean(projectContext.glossaryYaml),
        content_policy_matrix_available: Boolean(projectContext.contentPolicyMatrixYaml),
        content_policy_matrix_yaml: projectContext.contentPolicyMatrixYaml,
        atoma_files_description: projectContext.atomaFilesDescription,
        atoma_files_payload: projectContext.atomaFilesPayload,
        workspace_context: {
            platform,
            voice_profile: voice,
            target_resource_url: bundle?.publication?.link_url || null
        }
    };

    return {
        criticReview,
        publicationBody,
        bundle,
        projectContext
    };
}

export default async function apiRoutes(fastify: FastifyInstance) {
    // Auth and Project context middleware
    fastify.addHook('preHandler', async (request, reply) => {
        // Skip auth for public endpoints (like public image serving)
        if (request.url.startsWith('/public/')) {
            return;
        }

        // Skip auth for static files if needed, but here we cover /api/
        const token = request.headers.authorization?.split(' ')[1];
        if (!token) {
            reply.code(401).send({ error: 'Authentication required' });
            return;
        }

        try {
            const user = authService.verifyToken(token);
            (request as any).user = user;

            const projectId = request.headers['x-project-id'];
            if (projectId) {
                const pid = parseInt(projectId as string);
                const hasAccess = await authService.hasProjectAccess(user.id, pid);
                if (!hasAccess) {
                    reply.code(403).send({ error: 'No access to this project' });
                    return;
                }
                (request as any).projectId = pid;
            }
        } catch (e) {
            reply.code(401).send({ error: 'Invalid or expired token' });
        }
    });

    // Public endpoint to serve images for Telegram link preview
    fastify.get('/public/posts/:id/image', async (request, reply) => {
        const { id } = request.params as { id: string };
        const post = await prisma.post.findUnique({
            where: { id: parseInt(id) },
            select: { image_url: true }
        });

        if (!post || !post.image_url) {
            return reply.code(404).send({ error: 'Image not found' });
        }

        if (post.image_url.startsWith('data:image/')) {
            const matches = post.image_url.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) {
                return reply.code(400).send({ error: 'Invalid image format' });
            }
            const mimeType = matches[1];
            const base64Data = matches[2];
            const buffer = Buffer.from(base64Data, 'base64');
            reply.header('Content-Type', mimeType);
            reply.header('Cache-Control', 'public, max-age=86400');
            return reply.send(buffer);
        } else if (post.image_url.startsWith('/uploads/')) {
            // Local upload: serve file
            const fs = require('fs');
            const path = require('path');
            const filename = post.image_url.split('/').pop() || '';
            const localPath = path.join(__dirname, '../../uploads', filename);
            if (fs.existsSync(localPath)) {
                const ext = filename.split('.').pop()?.toLowerCase();
                const mimeType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
                const buffer = fs.readFileSync(localPath);
                reply.header('Content-Type', mimeType);
                reply.header('Cache-Control', 'public, max-age=86400');
                return reply.send(buffer);
            }
            return reply.code(404).send({ error: 'Local image file not found' });
        } else if (post.image_url.startsWith('http')) {
            return reply.redirect(post.image_url);
        } else {
            return reply.code(400).send({ error: 'Unrecognized image url format' });
        }
    });

    // Public endpoint to serve images for V2 ContentItem link preview
    fastify.get('/public/content-items/:id/image', async (request, reply) => {
        const { id } = request.params as { id: string };
        const item = await prisma.contentItem.findUnique({
            where: { id: parseInt(id) },
            select: { assets: true }
        });

        if (!item || !item.assets) {
            return reply.code(404).send({ error: 'ContentItem or assets not found' });
        }

        const assets = item.assets as any;
        const generatedVisual = Array.isArray(assets?.generated_visuals)
            ? assets.generated_visuals[0]
            : null;
        const imageUrl = generatedVisual?.url || generatedVisual?.image_url || generatedVisual?.src || null;

        if (!imageUrl) {
            return reply.code(404).send({ error: 'Image not found in assets' });
        }

        if (imageUrl.startsWith('data:image/')) {
            const matches = imageUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) {
                return reply.code(400).send({ error: 'Invalid image format' });
            }
            const mimeType = matches[1];
            const base64Data = matches[2];
            const buffer = Buffer.from(base64Data, 'base64');
            reply.header('Content-Type', mimeType);
            reply.header('Cache-Control', 'public, max-age=86400');
            return reply.send(buffer);
        } else if (imageUrl.startsWith('/uploads/')) {
            const fs = require('fs');
            const path = require('path');
            const filename = imageUrl.split('/').pop() || '';
            const localPath = path.join(__dirname, '../../uploads', filename);
            if (fs.existsSync(localPath)) {
                const ext = filename.split('.').pop()?.toLowerCase();
                const mimeType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
                const buffer = fs.readFileSync(localPath);
                reply.header('Content-Type', mimeType);
                reply.header('Cache-Control', 'public, max-age=86400');
                return reply.send(buffer);
            }
            return reply.code(404).send({ error: 'Local image file not found' });
        } else if (imageUrl.startsWith('http')) {
            return reply.redirect(imageUrl);
        } else {
            return reply.code(400).send({ error: 'Unrecognized image url format' });
        }
    });

    // Weeks
    fastify.get('/api/weeks', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const weeks = await prisma.week.findMany({
            where: { project_id: projectId },
            orderBy: { week_start: 'desc' },
            include: { _count: { select: { posts: true } } }
        });
        return weeks;
    });

    fastify.post('/api/weeks', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { theme, startDate, channelId } = request.body as { theme: string; startDate?: string; channelId?: number };

        let start, end;
        if (startDate) {
            const date = new Date(startDate);
            const range = await plannerService.getWeekRangeForDate(date);
            start = range.start;
            end = range.end;
        } else {
            const range = await plannerService.getNextWeekRange();
            start = range.start;
            end = range.end;
        }

        try {
            const week = await plannerService.createWeek(projectId, theme, start, end);
            // Default: All 7 days (14 slots)
            await plannerService.generateSlots(week.id, projectId, start, 14, 0, channelId);
            return week;
        } catch (e: any) {
            // P2002 is Prisma Unique Constraint Violation
            if (e.code === 'P2002') {
                console.log(`[API] Week already exists for project ${projectId} and start ${start}. Returning existing.`);
                const existing = await prisma.week.findFirst({
                    where: {
                        project_id: projectId,
                        week_start: start,
                        week_end: end
                    },
                    include: { _count: { select: { posts: true } } }
                });
                return existing;
            }
            console.error('[API] Error creating week:', e);
            reply.code(500).send({ error: 'Failed to create week', details: e.message });
        }
    });

    fastify.get('/api/weeks/:id', async (request, reply) => {
        try {
            const { id } = request.params as { id: string };
            const week = await prisma.week.findUnique({
                where: { id: parseInt(id) },
                include: {
                    posts: {
                        orderBy: { publish_at: 'asc' }
                    }
                }
            });

            if (!week) {
                reply.code(404).send({ error: 'Week not found' });
                return;
            }

            // Get topics if in topics_generated status
            let topics = null;
            if (week.status === 'topics_generated') {
                console.log('Week status is topics_generated, looking for run...');
                const run = await prisma.agentRun.findFirst({
                    where: { input: `Theme: ${week.theme}` },
                    orderBy: { created_at: 'desc' },
                    include: { iterations: true }
                });
                if (run) {
                    console.log('Run found:', run.id);
                    // Noop
                }
            }

            console.log('Returning week:', week.id); // Debug Log

            // Sanitize BigInt for Fastify
            const serializedPosts = week.posts.map((p: any) => ({
                ...p,
                approval_message_id: p.approval_message_id ? p.approval_message_id.toString() : null
            }));

            return { ...week, posts: serializedPosts, topics };
        } catch (e: any) {
            console.error('Error in GET /api/weeks/:id:', e);
            const fs = require('fs');
            fs.appendFileSync('server_error.log', `[${new Date().toISOString()}] Error in GET /weeks/${(request.params as any).id}: ${e.message}\n${e.stack}\n\n`);
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });

    fastify.put('/api/weeks/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const data = request.body as any;

        const week = await prisma.week.update({
            where: { id: parseInt(id) },
            data
        });

        return week;
    });

    fastify.delete('/api/weeks/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        await prisma.week.delete({ where: { id: parseInt(id) } });
        return { success: true };
    });

    // Week actions
    fastify.post('/api/weeks/:id/generate-topics', async (request, reply) => {
        try {
            const projectId = (request as any).projectId;
            console.log('[API] Generate Topics Request:', {
                projectId,
                params: request.params,
                headers_x_project_id: request.headers['x-project-id']
            });

            if (!projectId) {
                console.error('[API] Missing Project ID');
                return reply.code(400).send({ error: 'Project ID required' });
            }

            const { id } = request.params as { id: string };
            const { promptPresetId, overwrite } = request.body as { promptPresetId?: number, overwrite?: boolean };

            const week = await prisma.week.findUnique({
                where: { id: parseInt(id) } // Removed project_id check temporarily to depend on middleware
            });

            // Double check project ownership if needed, or rely on middleware
            if (!week || week.project_id !== projectId) {
                return reply.code(404).send({ error: 'Week not found' });
            }

            // Handle Overwrite
            if (overwrite) {
                console.log(`[API] Overwriting topics for week ${id}`);
                await prisma.post.deleteMany({
                    where: {
                        week_id: week.id,
                        status: { in: ['planned', 'topics_generated'] } // Only delete planned/generated, keep published/scheduled? 
                        // Actually, if we regenerate topics, we probably want to wipe the slate for this week unless they are already locked in.
                    }
                });
            }

            let promptOverride: string | undefined;
            if (promptPresetId) {
                const preset = await prisma.promptPreset.findUnique({ where: { id: promptPresetId } });
                if (preset) promptOverride = preset.prompt_text;
            }

            // Determine how many topics to generate based on existing posts (topics)
            const existingPosts = await prisma.post.findMany({
                where: { week_id: week.id, status: { not: 'planned' } }, // Count generated/approved topics
                select: { topic: true }
            });
            const existingCount = existingPosts.length;
            const existingTopics = existingPosts.map(p => p.topic || '').filter(t => t);

            let countToGenerate = 0;
            // Target 14 topics (full week)
            if (existingCount < 14) {
                countToGenerate = 14 - existingCount;
            } else {
                return reply.code(400).send({ error: 'Maximum topics (14) already reached' });
            }

            if (countToGenerate <= 0) {
                return reply.code(400).send({ error: 'No topics needed or max reached' });
            }

            // Generate slots for new topics
            // We need to know where to start indexing. 
            // Assuming slots are 1-based index. 
            // Actually, we should check if slots already exist for these indices.
            // But simplify: just generate slots starting from current count.
            // Push to queue instead of running inline
            const { topicsQueue } = require('../queue');
            await topicsQueue.add('generate-topics', {
                projectId,
                weekId: week.id,
                promptOverride,
                countToGenerate,
                existingCount,
                existingTopics
            }, {
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 }
            });

            return reply.code(202).send({ success: true, message: 'Topics generation queued in background' });
        } catch (error: any) {
            console.error('[API Error] Generate Topics Failed API setup:', error);
            const fs = require('fs');
            const logEntry = `[${new Date().toISOString()}] Error in /generate-topics API: ${error.message}\nStack: ${error.stack}\n\n`;
            fs.appendFileSync('server_error.log', logEntry);
            return reply.code(500).send({ error: 'Internal Server Error', details: error.message });
        }
    });

    fastify.post('/api/weeks/:id/approve-topics', async (request, reply) => {
        const { id } = request.params as { id: string };
        const weekId = parseInt(id);

        // Update all posts status
        await prisma.post.updateMany({
            where: {
                week_id: weekId,
                status: 'topics_generated'
            },
            data: {
                status: 'topics_approved'
            }
        });

        await plannerService.updateWeekStatus(weekId, 'topics_approved');
        return { success: true };
    });

    fastify.post('/api/weeks/:id/generate-posts', async (request, reply) => {
        const projectId = (request as any).projectId;
        const { id } = request.params as { id: string };
        const week = await prisma.week.findUnique({
            where: { id: parseInt(id), project_id: projectId },
            include: { posts: true }
        });

        if (!week) {
            reply.code(404).send({ error: 'Week not found' });
            return;
        }

        await plannerService.updateWeekStatus(week.id, 'generating');

        // Generate posts asynchronously via BullMQ Queue
        const { postsQueue } = require('../queue');
        
        for (const post of week.posts) {
            if (!post.topic) continue;

            await prisma.post.update({
                where: { id: post.id },
                data: { status: 'generating' }
            });

            await postsQueue.add('generate-post', {
                projectId,
                theme: week.theme,
                topic: post.topic,
                postId: post.id,
                isBatch: true // Identifies we should check if entire week is done
            }, {
                attempts: 3,
                backoff: { type: 'exponential', delay: 10000 }
            });
        }

        return reply.code(202).send({ success: true, message: 'Generation queued' });
    });

    fastify.post('/api/weeks/:id/generate-sequential', async (request, reply) => {
        const projectId = (request as any).projectId;
        const { id } = request.params as { id: string };

        const week = await prisma.week.findUnique({
            where: { id: parseInt(id) }
        });

        if (!week) return reply.code(404).send({ error: 'Week not found' });

        // Trigger background generation
        (async () => {
            const writer = require('../services/sequential_writer.service').default;
            try {
                await writer.generateWeekPosts(projectId, week.id);
            } catch (e) {
                console.error('Sequential generation failed', e);
            }
        })();

        return { success: true, message: 'Sequential generation started' };
    });

    fastify.post('/api/posts/:id/generate-image', async (request, reply) => {
        const projectId = (request as any).projectId;
        const { id } = request.params as { id: string };
        const { provider } = request.body as { provider?: 'preview' | 'final' | 'flagship' | 'gpt-image' | 'nano' | 'full' };

        const post = await prisma.post.findUnique({
            where: { id: parseInt(id) }
        });

        if (!post) {
            return reply.code(404).send({ error: 'Post not found' });
        }

        try {
            console.log(`[Generate Image] Enqueueing request for Post ${id}, Mode: ${provider || 'preview'}`);
            const textToUse = post.final_text || post.generated_text || post.topic || '';
            
            // Mark immediately to stop re-clicks
            await prisma.post.update({
                where: { id: parseInt(id) },
                data: { status: 'generating' }
            });

            const { imageQueue } = require('../queue');
            await imageQueue.add('generate-image', {
                projectId,
                postId: post.id,
                provider: provider || 'preview',
                textToUse,
                topic: post.topic
            }, {
                attempts: 2,
                backoff: { type: 'exponential', delay: 10000 }
            });

            return reply.code(202).send({ success: true, message: 'Image generation queued' });
        } catch (error: any) {
            request.log.error(error);
            return reply.code(500).send({ error: `Queue failed: ${error.message}` });
        }
    });

    fastify.post('/api/posts/:id/upload-image', async (request, reply) => {
        const { id } = request.params as { id: string };
        const data = await (request as any).file();

        if (!data) {
            return reply.code(400).send({ error: 'No file uploaded' });
        }

        try {
            const buffer = await data.toBuffer();
            const ext = data.filename.split('.').pop() || 'jpg';
            const filename = `post-${id}-${Date.now()}.${ext}`;
            const destinationPath = `uploads/${filename}`;

            console.log(`[Upload] Uploading ${filename} to Supabase Storage...`);
            const imageUrl = await storageService.uploadFileFromBuffer(buffer, data.mimetype, destinationPath);
            console.log(`[Upload] Upload success: ${imageUrl}`);

            await prisma.post.update({
                where: { id: parseInt(id) },
                data: {
                    image_url: imageUrl,
                    image_prompt: 'Uploaded by user'
                }
            });

            return { success: true, imageUrl };
        } catch (error: any) {
            request.log.error(error);
            return reply.code(500).send({ error: 'Upload failed', details: error.message || error });
        }
    });

    // Posts
    fastify.get('/api/posts/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const post = await prisma.post.findUnique({
            where: { id: parseInt(id) },
            include: { week: true }
        });

        if (!post) {
            reply.code(404).send({ error: 'Post not found' });
            return;
        }

        // Find associated WeekPackage by matching dates and project_id (with range overlap support)
        let weekPackageId = null;
        if (post.week) {
            const weekPackage = await prisma.weekPackage.findFirst({
                where: {
                    project_id: post.project_id,
                    week_start: {
                        gte: post.week.week_start,
                        lte: post.week.week_end
                    }
                }
            });
            weekPackageId = weekPackage?.id || null;
        }

        const { week, ...rest } = post as any;
        return {
            ...rest,
            week_package_id: weekPackageId
        };
    });

    fastify.put('/api/posts/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const data = request.body as any;

        const post = await prisma.post.update({
            where: { id: parseInt(id) },
            data
        });

        return post;
    });

    fastify.post('/api/posts/:id/approve', async (request, reply) => {
        const { id } = request.params as { id: string };
        const data = (request.body as any) || {};

        const post = await prisma.post.update({
            where: { id: parseInt(id) },
            data: {
                ...data, // Allow updating publish_at, text, channel_id etc during approval
                status: 'scheduled'
            }
        });

        return post;
    });

    fastify.post('/api/posts/:id/approve-topic', async (request, reply) => {
        const { id } = request.params as { id: string };
        const post = await prisma.post.update({
            where: { id: parseInt(id) },
            data: { status: 'topics_approved' }
        });
        return post;
    });


    fastify.post('/api/posts/:id/publish-now', async (request, reply) => {
        const { id } = request.params as { id: string };
        try {
            const host = request.headers.host || undefined;
            const result = await publisherService.publishPostNow(parseInt(id), host);
            return {
                success: true,
                publishMethod: result.publishMethod,
                warning: result.warning || null
            };
        } catch (e: any) {
            console.error('Publish now failed', e);
            reply.code(500).send({ error: e.message });
        }
    });

    fastify.post('/api/posts/:id/generate', async (request, reply) => {
        const projectId = (request as any).projectId;
        const { id } = request.params as { id: string };
        const post = await prisma.post.findFirst({
            where: {
                id: parseInt(id),
                week: { project_id: projectId }
            },
            include: { week: true }
        });

        if (!post || !post.week) {
            reply.code(404).send({ error: 'Post not found or access denied' });
            return;
        }

        if (!post.topic) {
            reply.code(400).send({ error: 'Post has no topic' });
            return;
        }

        const { promptPresetId, withImage } = request.body as { promptPresetId?: number, withImage?: boolean };
        let promptOverride: string | undefined;
        if (promptPresetId) {
            const preset = await prisma.promptPreset.findUnique({ where: { id: promptPresetId } });
            if (preset) promptOverride = preset.prompt_text;
        }

        // Immediately update status and enqueue background generation via BullMQ
        await prisma.post.update({
            where: { id: post.id },
            data: { status: 'generating' }
        });

        const { postsQueue } = require('../queue');
        await postsQueue.add('generate-post', {
            projectId,
            theme: post.week!.theme,
            topic: post.topic,
            postId: post.id,
            promptOverride,
            withImage,
            isBatch: false
        }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 10000 }
        });

        return reply.code(202).send({ success: true, message: 'Generation queued in background' });
    });

    fastify.post('/api/posts/:id/validate-dictionary', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };
        const { text } = request.body as { text?: string };

        const post = await prisma.post.findFirst({
            where: {
                id: parseInt(id),
                project_id: projectId
            }
        });

        if (!post) {
            return reply.code(404).send({ error: 'Post not found' });
        }

        const dictionarySetting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'content_dictionary_yaml' } }
        });

        const report = contentDictionaryService.validateText(
            text || post.final_text || post.generated_text || '',
            dictionarySetting?.value || null
        );

        return report;
    });

    fastify.get('/api/publication-tasks', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { status, manualOnly, weekPackageId, from, to } = request.query as { status?: string; manualOnly?: string; weekPackageId?: string; from?: string; to?: string };
        const where: any = {
            project_id: projectId,
            type: { not: 'week_theme' },
            OR: [
                { assets: { not: Prisma.AnyNull } },
                { item_key: { startsWith: 'week-topic:' } }
            ]
        };

        if (status === 'active') {
            where.status = { in: ['planned', 'drafted', 'revised', 'approved', 'scheduled', 'ready_for_execution', 'browser_required', 'awaiting_manual_publication', 'failed'] };
        } else if (status && status !== 'all') {
            where.status = status;
        }
        if (weekPackageId) where.week_package_id = Number(weekPackageId);
        if (from || to) {
            where.schedule_at = {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {})
            };
        }

        const items = await prisma.contentItem.findMany({
            where,
            select: {
                id: true,
                item_key: true,
                type: true,
                layer: true,
                title: true,
                brief: true,
                status: true,
                schedule_at: true,
                published_link: true,
                draft_text: true,
                content_revision: true,
                publication_mode: true,
                text_state: true,
                visual_state: true,
                handoff_state: true,
                week_package_id: true,
                quality_report: true,
                metrics: true,
                publication_fact: true,
                work_items: {
                    select: { kind: true, state: true }
                },
                channel: {
                    select: {
                        id: true,
                        name: true,
                        type: true,
                        config: true
                    }
                }
            },
            orderBy: { schedule_at: 'asc' }
        });

        const activeFiltered = status === 'active'
            ? items.filter(isPublicationTaskActive)
            : items;
        const filtered = manualOnly === 'true'
            ? activeFiltered.filter((item) => {
                const executionMode = (item.quality_report as any)?.execution_mode;
                return item.publication_mode === 'browser_required'
                    || executionMode === 'manual'
                    || executionMode === 'browser';
            })
            : activeFiltered;

        const response = filtered.map(buildPublicationTaskListItem);
        logEgressDiagnostic('publication_tasks.list', {
            projectId,
            status: status || 'active',
            manualOnly: manualOnly === 'true',
            itemCount: response.length,
            responseBytes: jsonBytes(response)
        });

        return response;
    });

    fastify.get('/api/publication-tasks/:id', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };
        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id), project_id: projectId },
            include: {
                channel: true,
                selected_asset: true,
                publication_fact: true,
                metric_snapshots: { orderBy: { scheduled_for: 'asc' } },
                work_items: { select: { id: true, kind: true, state: true, assignee_role: true } }
            }
        });

        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }

        const plan = await loadPublicationPlanContext(projectId);
        const projectContext = await loadPublicationProjectContext(projectId);
        const action = (item.assets as any)?.action;
        if (!plan || !action) {
            const response = buildPublicationTaskDetailItem(item, { projectContext });
            logEgressDiagnostic('publication_tasks.detail', {
                projectId,
                taskId: item.id,
                hasPlan: false,
                resolvedAssets: countResolvedAssets(item),
                sourceContentBytes: textBytes(response.workspace_context?.source_content),
                responseBytes: jsonBytes(response)
            });
            return response;
        }

        const bundle = publicationPlanService.buildHandoffBundle({ ...plan, actions: [action] } as any, item);
        const response = buildPublicationTaskDetailItem(item, {
            handoffBundle: bundle,
            projectContext
        });
        logEgressDiagnostic('publication_tasks.detail', {
            projectId,
            taskId: item.id,
            hasPlan: true,
            resolvedAssets: countResolvedAssets(item),
            bundleResourceFiles: countBundleResourceFiles(bundle),
            publicationBodyBytes: textBytes(bundle?.publication?.body),
            sourceContentBytes: textBytes(response.workspace_context?.source_content),
            responseBytes: jsonBytes(response)
        });

        return response;
    });

    fastify.get('/api/publication-tasks/:id/visual-readiness', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });
        const taskId = Number((request.params as { id: string }).id);
        if (!Number.isInteger(taskId)) return reply.code(400).send({ error: 'Invalid task ID' });
        return artDirectionService.getReadiness(projectId, taskId);
    });

    fastify.put('/api/publication-tasks/:id/content', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };
        const { body } = request.body as { body?: string };

        if (typeof body !== 'string') {
            return reply.code(400).send({ error: 'body must be a string' });
        }

        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id), project_id: projectId }
        });

        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }

        const nextQualityReport = {
            ...((item.quality_report as any) || {})
        } as any;

        const previousBody = String(
            nextQualityReport.handoff_bundle?.publication?.body
            || item.draft_text
            || ''
        );

        const history = Array.isArray(nextQualityReport.content_edit_history)
            ? nextQualityReport.content_edit_history
            : [];

        if (body !== previousBody) {
            nextQualityReport.content_edit_history = [
                {
                    edited_at: new Date().toISOString(),
                    previous_body: previousBody,
                    next_body: body
                },
                ...history
            ].slice(0, 20);
        }

        if (nextQualityReport.handoff_bundle?.publication) {
            nextQualityReport.handoff_bundle = {
                ...nextQualityReport.handoff_bundle,
                publication: {
                    ...nextQualityReport.handoff_bundle.publication,
                    body
                }
            };
        }

        const updated = await prisma.contentItem.update({
            where: { id: item.id },
            data: {
                draft_text: body,
                content_revision: { increment: 1 },
                quality_report: nextQualityReport
            }
        });

        const response = {
            id: updated.id,
            draft_text: updated.draft_text,
            content_revision: updated.content_revision,
            content_state: derivePublicationContentState(updated),
            quality_report: updated.quality_report
        };
        logEgressDiagnostic('publication_tasks.save_content', {
            projectId,
            taskId: updated.id,
            requestBodyBytes: textBytes(body),
            responseBytes: jsonBytes(response)
        });

        return response;
    });

    fastify.post('/api/publication-tasks/:id/prepare-handoff', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };
        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id), project_id: projectId },
            include: { channel: true, selected_asset: true }
        });

        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }

        await artDirectionService.assertPublicationReady(projectId, item.id);

        const plan = await loadPublicationPlanContext(projectId);
        const action = (item.assets as any)?.action;
        if (plan) plan.actions = action ? [action] : [];
        const bundle = plan && action
            ? publicationPlanService.buildHandoffBundle(plan as any, item)
            : publicationPlanService.buildGeneratedContentItemHandoff(item);
        const channelConfig = (item.channel?.config as any) || {};
        const rawAccount = channelConfig.raw_account || channelConfig;
        const directExecutionSupported = publicationAdapterService.supportsDirectExecution({
            ...channelConfig,
            ...rawAccount,
            platform: rawAccount.platform || item.channel?.type
        });
        const browserRequired = bundle.mode === 'manual' || !directExecutionSupported;

        const updated = await prisma.contentItem.update({
            where: { id: item.id },
            data: {
                status: browserRequired ? 'browser_required' : 'ready_for_execution',
                publication_mode: browserRequired ? 'browser_required' : 'connector_auto',
                quality_report: {
                    ...((item.quality_report as any) || {}),
                    handoff_bundle: bundle,
                    execution_mode: browserRequired ? 'browser' : 'automatic',
                    publication_route: browserRequired ? 'browser_required' : 'connector_auto',
                    prepared_at: new Date().toISOString()
                } as any
            }
        });

        const response = {
            item: {
                ...updated,
                schedule_at: resolveTaskScheduleAt(updated)
            },
            bundle
        };
        logEgressDiagnostic('publication_tasks.prepare_handoff', {
            projectId,
            taskId: item.id,
            hasPlan: Boolean(plan && action),
            bundleResourceFiles: countBundleResourceFiles(bundle),
            publicationBodyBytes: textBytes(bundle?.publication?.body),
            responseBytes: jsonBytes(response)
        });

        return response;
    });

    fastify.post('/api/publication-tasks/:id/publish-now', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };
        const taskId = parseInt(id);
        const item = await prisma.contentItem.findFirst({
            where: { id: taskId, project_id: projectId },
            include: { channel: true }
        });

        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }

        try {
            const host = request.headers.host || undefined;
            const result = await publisherService.processPublicationTaskNow(taskId, host);
            const refreshed = await prisma.contentItem.findFirst({
                where: { id: taskId, project_id: projectId },
                include: { channel: true }
            });

            const response = {
                success: true,
                result,
                item: refreshed ? {
                    ...refreshed,
                    schedule_at: resolveTaskScheduleAt(refreshed)
                } : null
            };
            logEgressDiagnostic('publication_tasks.publish_now', {
                projectId,
                taskId,
                responseBytes: jsonBytes(response)
            });
            return response;
        } catch (error: any) {
            return reply.code(400).send({ error: extractRequestErrorMessage(error, 'Failed to publish task now') });
        }
    });

    fastify.post('/api/publication-tasks/:id/confirm-publication', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };
        const {
            publishedLink,
            note,
            outcome
        } = request.body as {
            publishedLink?: string;
            note?: string;
            outcome?: 'published' | 'blocked' | 'removed' | 'restricted';
        };

        if (!publishedLink) {
            return reply.code(400).send({ error: 'publishedLink is required' });
        }

        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id), project_id: projectId }
        });

        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }

        const publicationOutcome = outcome || 'published';
        const rawType = String(item.type || '').toLowerCase();
        const artifactKind = rawType.includes('article') ? 'article'
            : rawType.includes('comment') ? 'comment'
                : rawType.includes('email') ? 'email'
                    : 'post';
        await publicationFactService.record({
            projectId,
            taskId: item.id,
            actorId: `user:${(request as any).user.id}`,
            artifactKind,
            outcome: publicationOutcome,
            publishedAt: new Date().toISOString(),
            publicUrl: publishedLink,
            confirmationMode: 'manual',
            evidence: { type: 'public_url', ref: publishedLink },
            note
        });
        const updated = await prisma.contentItem.findUniqueOrThrow({ where: { id: item.id } });
        await initiativeService.syncPublishedPublicationTask(projectId, updated.id);

        logEgressDiagnostic('publication_tasks.confirm_publication', {
            projectId,
            taskId: updated.id,
            publishedLinkBytes: textBytes(publishedLink),
            noteBytes: textBytes(note),
            responseBytes: jsonBytes(updated)
        });

        return updated;
    });

    fastify.post('/api/publication-tasks/:id/publication-fact', async (request, reply) => {
        const projectId = (request as any).projectId;
        const userId = (request as any).user?.id;
        if (!projectId || !userId) return reply.code(400).send({ error: 'Project and user are required' });
        const taskId = Number((request.params as { id: string }).id);
        try {
            return await publicationFactService.record({
                ...(request.body as any),
                projectId,
                taskId,
                actorId: `user:${userId}`
            });
        } catch (error: any) {
            const code = String(error?.message || 'PUBLICATION_FACT_FAILED');
            const statusCode = /Access denied|NOT_FOUND/.test(code) ? 404 : 400;
            return reply.code(statusCode).send({ error: code });
        }
    });

    fastify.get('/api/publication-tasks/:id/publication-fact', async (request, reply) => {
        const projectId = (request as any).projectId;
        const userId = (request as any).user?.id;
        if (!projectId || !userId) return reply.code(400).send({ error: 'Project and user are required' });
        try {
            return {
                publication_fact: await publicationFactService.get(
                    projectId,
                    Number((request.params as { id: string }).id),
                    `user:${userId}`
                )
            };
        } catch (error: any) {
            return reply.code(404).send({ error: String(error?.message || 'PUBLICATION_FACT_NOT_FOUND') });
        }
    });

    fastify.get('/api/metric-checkpoints', async (request, reply) => {
        const projectId = (request as any).projectId;
        const userId = (request as any).user?.id;
        if (!projectId || !userId) return reply.code(400).send({ error: 'Project and user are required' });
        const query = request.query as { status?: string; dueBefore?: string; channelId?: string };
        try {
            return {
                checkpoints: await publicationFactService.listCheckpoints({
                    projectId,
                    actorId: `user:${userId}`,
                    status: query.status,
                    dueBefore: query.dueBefore,
                    channelId: query.channelId ? Number(query.channelId) : undefined
                })
            };
        } catch (error: any) {
            return reply.code(400).send({ error: String(error?.message || 'METRIC_CHECKPOINTS_FAILED') });
        }
    });

    fastify.put('/api/publication-tasks/:id/metric-checkpoints/:checkpoint', async (request, reply) => {
        const projectId = (request as any).projectId;
        const userId = (request as any).user?.id;
        if (!projectId || !userId) return reply.code(400).send({ error: 'Project and user are required' });
        const { id, checkpoint } = request.params as { id: string; checkpoint: string };
        const body = request.body as any;
        try {
            return await metricsService.recordMetricSnapshot({
                ...body,
                projectId,
                actorId: `user:${userId}`,
                contentItemId: Number(id),
                checkpoint
            });
        } catch (error: any) {
            return reply.code(400).send({ error: String(error?.message || 'METRIC_SNAPSHOT_FAILED') });
        }
    });

    fastify.post('/api/publication-tasks/:id/record-metrics', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };
        const { metrics } = request.body as { metrics?: Record<string, any> };

        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id), project_id: projectId }
        });

        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }

        const updated = await prisma.contentItem.update({
            where: { id: item.id },
            data: {
                metrics: {
                    ...((item.metrics as any) || {}),
                    collected_metrics: metrics || {},
                    metrics_updated_at: new Date().toISOString()
                } as any
            }
        });

        logEgressDiagnostic('publication_tasks.record_metrics', {
            projectId,
            taskId: updated.id,
            metricsBytes: jsonBytes(metrics || {}),
            responseBytes: jsonBytes(updated)
        });

        return updated;
    });

    fastify.post('/api/publication-tasks/:id/collect-metrics', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };
        const result = await metricsService.collectMetricsForContentItem(parseInt(id), projectId);

        if (!result.found) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }

        logEgressDiagnostic('publication_tasks.collect_metrics', {
            projectId,
            taskId: parseInt(id),
            found: result.found,
            responseBytes: jsonBytes(result)
        });

        return result;
    });

    fastify.get('/api/publication-tasks/:id/metrics-history', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });
        const { id } = request.params as { id: string };
        const { from, to } = request.query as { from?: string; to?: string };
        try {
            const history = await vkMetricsService.getHistory(
                parseInt(id),
                projectId,
                parseMetricsDate(from, 'from'),
                parseMetricsDate(to, 'to')
            );
            if (!history) return reply.code(404).send({ error: 'Publication task not found' });
            return { snapshots: history };
        } catch (error: any) {
            return reply.code(400).send({ error: error.message || 'Invalid metrics history request' });
        }
    });

    fastify.get('/api/publication-tasks/:id/metrics-weekly', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });
        const { id } = request.params as { id: string };
        const { from, to } = request.query as { from?: string; to?: string };
        if (!from || !to) return reply.code(400).send({ error: 'from and to are required' });
        try {
            const report = await vkMetricsService.getWeeklyDelta(
                parseInt(id),
                projectId,
                parseMetricsDate(from, 'from')!,
                parseMetricsDate(to, 'to')!
            );
            if (!report) return reply.code(404).send({ error: 'Publication task not found' });
            return report;
        } catch (error: any) {
            return reply.code(400).send({ error: error.message || 'Invalid weekly metrics request' });
        }
    });

    fastify.get('/api/vk-metrics/export', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });
        const { from, to, format = 'json' } = request.query as { from?: string; to?: string; format?: string };
        if (!['json', 'csv'].includes(format)) {
            return reply.code(400).send({ error: 'format must be json or csv' });
        }
        try {
            const snapshots = await vkMetricsService.exportProject(
                projectId,
                parseMetricsDate(from, 'from'),
                parseMetricsDate(to, 'to')
            );
            if (format === 'json') return { snapshots };

            const columns = [
                'content_item_id', 'channel_id', 'owner_id', 'post_id', 'logical_date', 'captured_at',
                'wall_status', 'reach_status', 'views', 'likes', 'comments', 'reposts', 'reach_total',
                'reach_subscribers', 'reach_viral', 'reach_ads', 'link_clicks', 'group_clicks', 'group_joins',
                'hides', 'reports', 'unsubscribes', 'provider_error_code'
            ] as const;
            const rows = [
                columns.join(','),
                ...snapshots.map((snapshot) => columns.map((column) => csvCell(snapshot[column])).join(','))
            ];
            reply.header('content-type', 'text/csv; charset=utf-8');
            reply.header('content-disposition', `attachment; filename="vk-metrics-${projectId}.csv"`);
            return rows.join('\n');
        } catch (error: any) {
            return reply.code(400).send({ error: error.message || 'Invalid metrics export request' });
        }
    });

    fastify.post('/api/publication-tasks/:id/external-comment-alert', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };
        const { text, commentUrl, author } = request.body as { text?: string; commentUrl?: string; author?: string };

        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id), project_id: projectId }
        });

        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }

        const composed = [
            author ? `Author: ${author}` : null,
            text ? `Comment: ${text}` : null,
            commentUrl ? `URL: ${commentUrl}` : null
        ].filter(Boolean).join('\n');

        const comment = await commentService.createComment(projectId, 'content_item', item.id, composed || 'External comment alert received', 'assistant');

        await prisma.contentItem.update({
            where: { id: item.id },
            data: {
                metrics: {
                    ...((item.metrics as any) || {}),
                    last_comment_alert_at: new Date().toISOString()
                } as any
            }
        });

        logEgressDiagnostic('publication_tasks.external_comment_alert', {
            projectId,
            taskId: item.id,
            textBytes: textBytes(text),
            commentUrlBytes: textBytes(commentUrl),
            authorBytes: textBytes(author),
            responseBytes: jsonBytes(comment)
        });

        return comment;
    });

    fastify.post('/api/publication-tasks/:id/critic-check', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };
        const { text } = request.body as { text?: string };

        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id), project_id: projectId },
            include: { channel: true }
        });

        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }

        let criticReview: any;
        try {
            criticReview = (await runPublicationCriticReview(projectId, item, text)).criticReview;
        } catch (error: any) {
            return reply.code(400).send({ error: error?.message || 'No publication body is available for critic review.' });
        }

        await prisma.contentItem.update({
            where: { id: item.id },
            data: {
                quality_report: {
                    ...((item.quality_report as any) || {}),
                    critic_review: criticReview
                } as any
            }
        });

        logEgressDiagnostic('publication_tasks.critic_check', {
            projectId,
            taskId: item.id,
            inputTextBytes: textBytes(text),
            responseBytes: jsonBytes(criticReview)
        });

        return criticReview;
    });

    fastify.post('/api/publication-tasks/:id/fix-with-critic', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };
        const { text } = request.body as { text?: string };

        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id), project_id: projectId },
            include: { channel: true }
        });

        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }

        const initial = await runPublicationCriticReview(projectId, item, text);
        const currentText = initial.publicationBody;

        const fixed = await multiAgentService.runPublicationFixer(projectId, {
            task_id: ((item.metrics as any)?.task_id || item.id),
            title: item.title,
            channel: item.channel?.name || item.layer || item.type,
            platform: item.channel?.type || item.layer || item.type,
            content_language: channelContentLanguage(item.channel),
            voice_profile: derivePublicationVoice(item),
            original_text: currentText,
            critic_review: initial.criticReview,
            source_content: ((initial.bundle?.resource_files || []) as any[]).find((entry) => typeof entry?.content === 'string' && entry.content.trim())?.content || '',
            glossary_yaml: initial.projectContext.glossaryYaml,
            content_policy_matrix_yaml: initial.projectContext.contentPolicyMatrixYaml,
            atoma_files_description: initial.projectContext.atomaFilesDescription,
            atoma_files_payload: initial.projectContext.atomaFilesPayload
        });

        const nextQualityReport = {
            ...((item.quality_report as any) || {})
        } as any;
        const history = Array.isArray(nextQualityReport.content_edit_history)
            ? nextQualityReport.content_edit_history
            : [];

        if (fixed.updated_text && fixed.updated_text !== currentText) {
            nextQualityReport.content_edit_history = [
                {
                    edited_at: new Date().toISOString(),
                    previous_body: currentText,
                    next_body: fixed.updated_text,
                    source: 'critic_fixer'
                },
                ...history
            ].slice(0, 20);
        }

        if (nextQualityReport.handoff_bundle?.publication && fixed.updated_text) {
            nextQualityReport.handoff_bundle = {
                ...nextQualityReport.handoff_bundle,
                publication: {
                    ...nextQualityReport.handoff_bundle.publication,
                    body: fixed.updated_text
                }
            };
        }

        nextQualityReport.last_fixer_run = {
            fixed_at: new Date().toISOString(),
            summary: fixed.summary || null,
            resolved_findings: fixed.resolved_findings || [],
            raw: fixed
        };

        const updated = await prisma.contentItem.update({
            where: { id: item.id },
            data: {
                draft_text: fixed.updated_text || currentText,
                quality_report: nextQualityReport
            }
        });

        const reloaded = await prisma.contentItem.findFirst({
            where: { id: updated.id, project_id: projectId },
            include: { channel: true }
        });

        const finalCritic = reloaded
            ? await runPublicationCriticReview(projectId, reloaded, updated.draft_text || currentText)
            : null;

        if (reloaded && finalCritic) {
            await prisma.contentItem.update({
                where: { id: reloaded.id },
                data: {
                    quality_report: {
                        ...(((reloaded.quality_report as any) || {})),
                        critic_review: finalCritic.criticReview,
                        last_fixer_run: nextQualityReport.last_fixer_run
                    } as any
                }
            });
        }

        const response = {
            updated_text: updated.draft_text || currentText,
            fixer: fixed,
            critic_review: finalCritic?.criticReview || initial.criticReview
        };
        logEgressDiagnostic('publication_tasks.fix_with_critic', {
            projectId,
            taskId: item.id,
            inputTextBytes: textBytes(text || currentText),
            outputTextBytes: textBytes(updated.draft_text || currentText),
            responseBytes: jsonBytes(response)
        });

        return response;
    });

    fastify.post('/api/publication-tasks/:id/generate-image', async (request, reply) => {
        const projectId = (request as any).projectId;
        const userId = (request as any).user?.id;
        if (!projectId || !userId) return reply.code(400).send({ error: 'Project and user are required' });

        const { id } = request.params as { id: string };
        const { provider } = request.body as { provider?: 'preview' | 'final' | 'flagship' | 'gpt-image' | 'nano' | 'full' };

        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id), project_id: projectId },
            include: {
                week_package: true,
                art_direction_decisions: { where: { status: 'active' }, orderBy: { decision_version: 'desc' }, take: 1 }
            }
        });

        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }

        const visualDecision = item.art_direction_decisions[0] || null;
        try {
            assertVisualGenerationGate({
                weekPackageId: item.week_package_id,
                weekApprovalStatus: item.week_package?.approval_status,
                textState: item.text_state,
                acceptedRevision: item.accepted_revision,
                contentRevision: item.content_revision,
                decisionType: visualDecision?.decision,
                decisionSourceRevision: visualDecision?.source_content_revision,
                prompt: visualDecision?.prompt,
                altText: visualDecision?.alt_text
            });
        } catch (error: any) {
            return reply.code(409).send({ error: error.message });
        }
        const approvedPrompt = visualDecision!.prompt!.trim();
        const approvedAltText = visualDecision!.alt_text!.trim();

        const plan = await loadPublicationPlanContext(projectId);
        const action = (item.assets as any)?.action;
        const bundle = plan && action
            ? publicationPlanService.buildHandoffBundle({ ...plan, actions: [action] } as any, item)
            : ((item.quality_report as any)?.handoff_bundle || null);

        const publicationBody = (bundle?.publication?.body || item.draft_text || '').trim();
        const topic = item.title || (action as any)?.display_name || item.type;
        const selectedProvider = provider || 'preview';

        if (!publicationBody) {
            return reply.code(400).send({ error: 'No publication body is available to generate an image.' });
        }

        let prompt = hardenEditorialVisualPrompt(approvedPrompt);

        let imageUrl = '';
        if (selectedProvider === 'preview') {
            imageUrl = await generatorService.generateImageNanoBanana(prompt, undefined, 'gemini-3.1-flash-lite-image', projectId);
        } else if (selectedProvider === 'final' || selectedProvider === 'nano') {
            imageUrl = await generatorService.generateImageNanoBanana(prompt, undefined, 'gemini-3.1-flash-image', projectId);
        } else if (selectedProvider === 'flagship' || selectedProvider === 'full') {
            const draftUrl = await generatorService.generateImage(prompt, projectId);
            const critic = await multiAgentService.runImageCritic(projectId, publicationBody, draftUrl);
            const refinedPrompt = hardenEditorialVisualPrompt(critic?.new_prompt || approvedPrompt);
            imageUrl = await generatorService.generateImageNanoBanana(refinedPrompt, draftUrl, 'gemini-3.1-flash-image', projectId);
            prompt = refinedPrompt;
        } else {
            imageUrl = await generatorService.generateImage(prompt, projectId);
        }

        const previousVisuals = Array.isArray((item.assets as any)?.generated_visuals)
            ? (item.assets as any).generated_visuals
            : [];

        const generatedImage = {
            provider: selectedProvider,
            prompt,
            url: imageUrl,
            alt_text: approvedAltText,
            decision_id: visualDecision.id,
            generated_at: new Date().toISOString()
        };

        const imageAsset = await imageAssetService.generateImageAsset({
            projectId,
            actorId: `user:${userId}`,
            contentItemId: item.id,
            prompt,
            provider: selectedProvider,
            model: selectedProvider === 'preview' ? 'gemini-3.1-flash-lite-image' : 'gemini-3.1-flash-image',
            altText: approvedAltText,
            aspectRatio: (visualDecision.dimensions as any)?.aspect_ratio || undefined,
            decisionId: visualDecision.id,
            contentRevision: item.content_revision,
            placement: visualDecision.placement,
            fileUrl: imageUrl
        });

        await prisma.contentItem.update({
            where: { id: item.id },
            data: {
                assets: {
                    ...((item.assets as any) || {}),
                    generated_visuals: [{ ...generatedImage, asset_id: imageAsset.asset_id }, ...previousVisuals].slice(0, 6)
                } as any,
                quality_report: {
                    ...((item.quality_report as any) || {}),
                    generated_image: generatedImage
                } as any
            }
        });

        logEgressDiagnostic('publication_tasks.generate_image', {
            projectId,
            taskId: item.id,
            provider: selectedProvider,
            publicationBodyBytes: textBytes(publicationBody),
            promptBytes: textBytes(prompt),
            responseBytes: jsonBytes(generatedImage)
        });

        return { ...generatedImage, asset_id: imageAsset.asset_id, asset_status: imageAsset.status };
    });

    fastify.post('/api/publication-tasks/:id/upload-image', async (request, reply) => {
        const projectId = (request as any).projectId;
        const userId = (request as any).user?.id;
        if (!projectId || !userId) return reply.code(400).send({ error: 'Project and user are required' });

        const taskId = Number((request.params as { id: string }).id);
        if (!Number.isInteger(taskId)) return reply.code(400).send({ error: 'Invalid publication task ID' });
        const data = await (request as any).file();
        if (!data) return reply.code(400).send({ error: 'No image uploaded' });
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(data.mimetype)) {
            return reply.code(415).send({ error: 'Only PNG, JPEG, WebP, and GIF images are supported' });
        }

        const item = await prisma.contentItem.findFirst({
            where: { id: taskId, project_id: projectId },
            include: { selected_asset: true }
        });
        if (!item) return reply.code(404).send({ error: 'Publication task not found' });
        if (!item.selected_asset) {
            return reply.code(409).send({ error: 'Select and approve a visual asset before replacing its file' });
        }

        const buffer = await data.toBuffer();
        if (buffer.length === 0 || buffer.length > 15 * 1024 * 1024) {
            return reply.code(413).send({ error: 'Image must be between 1 byte and 15 MB' });
        }
        const extension = data.mimetype === 'image/jpeg' ? 'jpg'
            : data.mimetype === 'image/webp' ? 'webp'
                : data.mimetype === 'image/gif' ? 'gif' : 'png';
        const objectPath = `publication-tasks/${projectId}/${taskId}/asset-${item.selected_asset.id}-${Date.now()}.${extension}`;
        const imageUrl = await storageService.uploadFileFromBuffer(buffer, data.mimetype, objectPath);

        const taskAssets = (item.assets as any) || {};
        const generatedVisuals = Array.isArray(taskAssets.generated_visuals)
            ? taskAssets.generated_visuals.map((visual: any) => Number(visual?.asset_id) === item.selected_asset!.id
                ? { ...visual, url: imageUrl, image_url: imageUrl, uploaded_at: new Date().toISOString() }
                : visual)
            : [];
        await prisma.$transaction([
            prisma.imageAsset.update({ where: { id: item.selected_asset.id }, data: { file_url: imageUrl } }),
            prisma.contentItem.update({
                where: { id: item.id },
                data: {
                    assets: { ...taskAssets, generated_visuals: generatedVisuals } as any,
                    quality_report: {
                        ...((item.quality_report as any) || {}),
                        visual_storage: { provider: storageService.getProvider(), url: imageUrl, uploaded_at: new Date().toISOString() }
                    } as any
                }
            })
        ]);

        return { success: true, imageUrl, assetId: item.selected_asset.id, storageProvider: storageService.getProvider() };
    });

    // Settings
    fastify.get('/api/settings/agents', async (request, reply) => {
        try {
            const projectId = (request as any).projectId;
            if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

            const roles = ['post_creator', 'post_critic', 'post_fixer', 'topic_creator', 'topic_critic', 'topic_fixer', 'visual_architect', 'structural_critic', 'precision_fixer', 'image_critic'];
            const agents = [];

            // Text Agents
            for (const role of roles) {
                try {
                    const config = await multiAgentService.getAgentConfig(projectId, role as any);

                    let provider = 'Not Configured';
                    if (config.apiKey) {
                        if (config.apiKey.startsWith('sk-ant')) provider = 'Anthropic';
                        else if (config.apiKey.startsWith('AIza')) provider = 'Gemini';
                        else if (config.apiKey.startsWith('sk-')) provider = 'OpenAI';
                        else provider = 'Unknown';
                    }

                    agents.push({
                        role,
                        prompt: config.prompt,
                        apiKey: config.apiKey,
                        model: config.model,
                        provider
                    });
                } catch (e) {
                    console.error(`Failed to fetch config for role ${role}`, e);
                    // Push safe default instead of crashing
                    agents.push({
                        role,
                        prompt: '',
                        apiKey: '',
                        model: '',
                        provider: 'Error'
                    });
                }
            }

            // Image Agents (GPT-Image)
            try {
                const dallePrompt = await generatorService.getImagePromptTemplate(projectId, 'gpt-image');
                agents.push({
                    role: 'gpt_image_gen',
                    prompt: dallePrompt,
                    apiKey: '', // Managed via env mostly for now
                    model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
                    provider: 'OpenAI (Env)'
                });
            } catch (e) {
                console.error('Failed to fetch DALL-E config', e);
            }

            // Image Agents (Nano)
            try {
                const nanoPrompt = await generatorService.getImagePromptTemplate(projectId, 'nano');
                agents.push({
                    role: 'nano_image_gen',
                    prompt: nanoPrompt,
                    apiKey: '',
                    model: 'gemini-3.1-flash-image',
                    provider: 'Google (Env)'
                });
            } catch (e) {
                console.error('Failed to fetch Nano config', e);
            }

            return agents;
        } catch (e: any) {
            console.error('Error in GET /api/settings/agents:', e);
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });

    fastify.get('/api/settings/model-usage', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });
        const daysRaw = Number((request.query as any)?.days || 30);
        const days = Number.isFinite(daysRaw) ? Math.min(90, Math.max(1, Math.trunc(daysRaw))) : 30;

        const rows = await prisma.$queryRaw<Array<{
            provider: string | null;
            model: string | null;
            calls: number;
            failed_calls: number;
            input_tokens: number;
            output_tokens: number;
            estimated_cost_usd: string | null;
            avg_latency_ms: number | null;
        }>>(Prisma.sql`
            SELECT provider,
                   model,
                   COUNT(*)::int AS calls,
                   COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_calls,
                   COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
                   COALESCE(SUM(output_tokens), 0)::int AS output_tokens,
                   SUM(estimated_cost_usd)::text AS estimated_cost_usd,
                   AVG(latency_ms)::int AS avg_latency_ms
              FROM planner.agent_runs
             WHERE project_id = ${projectId}
               AND type = 'model_invocation'
               AND created_at >= NOW() - (${days} * INTERVAL '1 day')
             GROUP BY provider, model
             ORDER BY SUM(estimated_cost_usd) DESC NULLS LAST, COUNT(*) DESC
        `);

        return {
            period_days: days,
            exact_cost_coverage: rows.filter((row) => row.estimated_cost_usd !== null).reduce((sum, row) => sum + row.calls, 0),
            total_calls: rows.reduce((sum, row) => sum + row.calls, 0),
            total_estimated_cost_usd: Number(rows.reduce((sum, row) => sum + Number(row.estimated_cost_usd || 0), 0).toFixed(6)),
            by_model: rows.map((row) => ({
                ...row,
                estimated_cost_usd: row.estimated_cost_usd === null ? null : Number(row.estimated_cost_usd)
            }))
        };
    });

    fastify.put('/api/settings/agents/:role', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { role } = request.params as { role: string };
        const { prompt, apiKey, model } = request.body as { prompt: string; apiKey: string; model: string };

        // Handle Image Agents
        if (role === 'gpt_image_gen') {
            await generatorService.updateImagePromptTemplate(projectId, prompt, 'gpt-image');
            return { success: true };
        }
        if (role === 'nano_image_gen') {
            await generatorService.updateImagePromptTemplate(projectId, prompt, 'nano');
            return { success: true };
        }

        // Handle Text Agents
        const roleMap: any = {
            'post_creator': {
                prompt: multiAgentService.KEY_POST_CREATOR_PROMPT,
                key: multiAgentService.KEY_POST_CREATOR_KEY,
                model: multiAgentService.KEY_POST_CREATOR_MODEL
            },
            'post_critic': {
                prompt: multiAgentService.KEY_POST_CRITIC_PROMPT,
                key: multiAgentService.KEY_POST_CRITIC_KEY,
                model: multiAgentService.KEY_POST_CRITIC_MODEL
            },
            'post_fixer': {
                prompt: multiAgentService.KEY_POST_FIXER_PROMPT,
                key: multiAgentService.KEY_POST_FIXER_KEY,
                model: multiAgentService.KEY_POST_FIXER_MODEL
            },
            'topic_creator': {
                prompt: multiAgentService.KEY_TOPIC_CREATOR_PROMPT,
                key: multiAgentService.KEY_TOPIC_CREATOR_KEY,
                model: multiAgentService.KEY_TOPIC_CREATOR_MODEL
            },
            'topic_critic': {
                prompt: multiAgentService.KEY_TOPIC_CRITIC_PROMPT,
                key: multiAgentService.KEY_TOPIC_CRITIC_KEY,
                model: multiAgentService.KEY_TOPIC_CRITIC_MODEL
            },
            'topic_fixer': {
                prompt: multiAgentService.KEY_TOPIC_FIXER_PROMPT,
                key: multiAgentService.KEY_TOPIC_FIXER_KEY,
                model: multiAgentService.KEY_TOPIC_FIXER_MODEL
            },
            'visual_architect': {
                prompt: multiAgentService.KEY_VISUAL_ARCHITECT_PROMPT,
                key: multiAgentService.KEY_VISUAL_ARCHITECT_KEY,
                model: multiAgentService.KEY_VISUAL_ARCHITECT_MODEL
            },
            'structural_critic': {
                prompt: multiAgentService.KEY_STRUCTURAL_CRITIC_PROMPT,
                key: multiAgentService.KEY_STRUCTURAL_CRITIC_KEY,
                model: multiAgentService.KEY_STRUCTURAL_CRITIC_MODEL
            },
            'precision_fixer': {
                prompt: multiAgentService.KEY_PRECISION_FIXER_PROMPT,
                key: multiAgentService.KEY_PRECISION_FIXER_KEY,
                model: multiAgentService.KEY_PRECISION_FIXER_MODEL
            },
            'image_critic': {
                prompt: multiAgentService.KEY_IMAGE_CRITIC_PROMPT,
                key: multiAgentService.KEY_IMAGE_CRITIC_KEY,
                model: multiAgentService.KEY_IMAGE_CRITIC_MODEL
            }
        };

        const keys = roleMap[role];
        if (!keys) {
            return reply.code(400).send({ error: 'Invalid role' });
        }

        try {
            // Helper to safe update
            const saveSetting = async (key: string, value: string) => {
                const existing = await prisma.projectSettings.findUnique({
                    where: { project_id_key: { project_id: projectId, key } }
                });
                if (existing) {
                    await prisma.projectSettings.update({
                        where: { id: existing.id },
                        data: { value }
                    });
                } else {
                    await prisma.projectSettings.create({
                        data: { project_id: projectId, key, value }
                    });
                }
            };

            await saveSetting(keys.prompt, prompt);
            await saveSetting(keys.key, apiKey || '');
            await saveSetting(keys.model, model);

            return { success: true };
        } catch (e: any) {
            console.error(`Failed to save settings for ${role}`, e);
            return reply.code(500).send({ error: 'Failed to save settings', details: e.message });
        }
    });

    fastify.get('/api/settings/runs', async (request, reply) => {
        const runs = await prisma.agentRun.findMany({
            orderBy: { created_at: 'desc' },
            take: 50
        });

        return runs;

    });

    // Agents Presets
    fastify.get('/api/settings/presets', async (request, reply) => {
        try {
            const projectId = (request as any).projectId;
            if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

            return await prisma.promptPreset.findMany({
                where: { project_id: projectId },
                orderBy: { created_at: 'desc' }
            });
        } catch (e: any) {
            console.error('Error in GET /api/settings/presets:', e);
            const fs = require('fs');
            fs.appendFileSync('server_error.log', `[${new Date().toISOString()}] Error in GET /presets: ${e.message}\n${e.stack}\n\n`);
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });

    fastify.post('/api/settings/presets', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { name, role, prompt_text } = request.body as any;

        return await prisma.promptPreset.create({
            data: { project_id: projectId, name, role, prompt_text }
        });
    });

    fastify.put('/api/settings/presets/:id', async (request, reply) => {
        const projectId = (request as any).projectId;
        const { id } = request.params as { id: string };
        const data = request.body as any;

        // Ensure belongs to project
        const count = await prisma.promptPreset.count({ where: { id: parseInt(id), project_id: projectId } });
        if (count === 0) return reply.code(404).send({ error: 'Not found' });

        return await prisma.promptPreset.update({
            where: { id: parseInt(id) },
            data
        });
    });

    fastify.delete('/api/settings/presets/:id', async (request, reply) => {
        const projectId = (request as any).projectId;
        const { id } = request.params as { id: string };

        // Ensure belongs to project
        const count = await prisma.promptPreset.count({ where: { id: parseInt(id), project_id: projectId } });
        if (count === 0) return reply.code(404).send({ error: 'Not found' });

        await prisma.promptPreset.delete({ where: { id: parseInt(id) } });
        return { success: true };
    });

    // Comments
    fastify.get('/api/comments', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { entityType, entityId } = request.query as { entityType: string, entityId: string };
        if (!entityType || !entityId) return reply.code(400).send({ error: 'Missing params' });

        return await commentService.getComments(projectId, entityType, parseInt(entityId));
    });

    fastify.post('/api/comments', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { entityType, entityId, text } = request.body as any;

        return await commentService.createComment(projectId, entityType, parseInt(entityId), text, 'user');
    });

    // Keys Management
    fastify.get('/api/settings/keys', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const keys = await prisma.providerKey.findMany({
            where: { project_id: projectId },
            orderBy: { created_at: 'desc' }
        });

        // Mask keys
        return keys.map(k => ({
            ...k,
            key: k.key.substring(0, 3) + '...' + k.key.substring(k.key.length - 4)
        }));
    });

    fastify.post('/api/settings/keys', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { name, key } = request.body as { name: string; key: string };

        let provider = 'Other';
        if (key.startsWith('sk-ant')) provider = 'Anthropic';
        else if (key.startsWith('AIza')) provider = 'Gemini';
        else if (key.startsWith('sk-')) provider = 'OpenAI';

        const newKey = await prisma.providerKey.create({
            data: {
                project_id: projectId,
                name,
                key,
                provider
            }
        });

        return { success: true, id: newKey.id, provider: newKey.provider };
    });

    fastify.delete('/api/settings/keys/:id', async (request, reply) => {
        const projectId = (request as any).projectId;
        const { id } = request.params as { id: string };

        // Ensure belongs to project
        const count = await prisma.providerKey.count({ where: { id: parseInt(id), project_id: projectId } });
        if (count === 0) return reply.code(404).send({ error: 'Not found' });

        await prisma.providerKey.delete({ where: { id: parseInt(id) } });
        return { success: true };
    });

    fastify.get('/api/settings/content-dictionary', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const setting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'content_dictionary_yaml' } }
        });

        const yamlValue = setting?.value || contentDictionaryService.getDefaultYaml();
        const parsed = contentDictionaryService.parseYaml(yamlValue);

        return {
            yaml: yamlValue,
            parsed,
            updated_at: setting?.updated_at || null
        };
    });

    fastify.put('/api/settings/content-dictionary', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { yaml: yamlText } = request.body as { yaml?: string };
        if (typeof yamlText !== 'string' || !yamlText.trim()) {
            return reply.code(400).send({ error: 'yaml is required' });
        }

        try {
            const normalizedYaml = contentDictionaryService.normalizeToYaml(yamlText);
            const parsed = contentDictionaryService.parseYaml(normalizedYaml);

            const saved = await prisma.projectSettings.upsert({
                where: { project_id_key: { project_id: projectId, key: 'content_dictionary_yaml' } },
                update: { value: normalizedYaml },
                create: {
                    project_id: projectId,
                    key: 'content_dictionary_yaml',
                    value: normalizedYaml
                }
            });

            return {
                yaml: saved.value,
                parsed,
                updated_at: saved.updated_at
            };
        } catch (error: any) {
            return reply.code(400).send({ error: error.message || 'Invalid dictionary YAML' });
        }
    });

    fastify.get('/api/settings/content-policy-matrix', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const setting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'content_policy_matrix_yaml' } }
        });

        const yamlValue = setting?.value || contentPolicyMatrixService.getDefaultYaml();
        const parsed = contentPolicyMatrixService.parseYaml(yamlValue);

        return {
            yaml: yamlValue,
            parsed,
            updated_at: setting?.updated_at || null
        };
    });

    fastify.put('/api/settings/content-policy-matrix', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { yaml: yamlText } = request.body as { yaml?: string };
        if (typeof yamlText !== 'string' || !yamlText.trim()) {
            return reply.code(400).send({ error: 'yaml is required' });
        }

        try {
            const normalizedYaml = contentPolicyMatrixService.normalizeToYaml(yamlText);
            const parsed = contentPolicyMatrixService.parseYaml(normalizedYaml);

            const saved = await prisma.projectSettings.upsert({
                where: { project_id_key: { project_id: projectId, key: 'content_policy_matrix_yaml' } },
                update: { value: normalizedYaml },
                create: {
                    project_id: projectId,
                    key: 'content_policy_matrix_yaml',
                    value: normalizedYaml
                }
            });

            return {
                yaml: saved.value,
                parsed,
                updated_at: saved.updated_at
            };
        } catch (error: any) {
            return reply.code(400).send({ error: error.message || 'Invalid content policy matrix YAML' });
        }
    });

    fastify.get('/api/settings/atoma-context', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const settings = await prisma.projectSettings.findMany({
            where: {
                project_id: projectId,
                key: { in: ['atoma_files_description', 'atoma_files_payload'] }
            }
        });

        const descriptionSetting = settings.find((setting) => setting.key === 'atoma_files_description') || null;
        const payloadSetting = settings.find((setting) => setting.key === 'atoma_files_payload') || null;
        const parsedPayload = safeJsonParse(payloadSetting?.value || null);
        const updatedAt = [descriptionSetting?.updated_at, payloadSetting?.updated_at]
            .filter(Boolean)
            .sort((a, b) => new Date(b as Date).getTime() - new Date(a as Date).getTime())[0] || null;

        return {
            description: descriptionSetting?.value || '',
            payload: parsedPayload,
            payload_text: payloadSetting?.value
                ? (parsedPayload !== null ? formatJson(parsedPayload) : payloadSetting.value)
                : '',
            updated_at: updatedAt
        };
    });

    fastify.put('/api/settings/atoma-context', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { description, payloadText } = request.body as { description?: string; payloadText?: string };
        if (typeof description !== 'string' || typeof payloadText !== 'string') {
            return reply.code(400).send({ error: 'description and payloadText are required' });
        }

        const normalizedDescription = description.trim();
        const normalizedPayloadText = payloadText.trim();

        let normalizedPayloadValue = '';
        let parsedPayload: any = null;

        if (normalizedPayloadText) {
            try {
                parsedPayload = JSON.parse(normalizedPayloadText);
                normalizedPayloadValue = formatJson(parsedPayload);
            } catch (error: any) {
                return reply.code(400).send({ error: error.message || 'Invalid ATOMA payload JSON' });
            }
        }

        await prisma.$transaction(async (tx) => {
            if (normalizedDescription) {
                await tx.projectSettings.upsert({
                    where: { project_id_key: { project_id: projectId, key: 'atoma_files_description' } },
                    update: { value: normalizedDescription },
                    create: {
                        project_id: projectId,
                        key: 'atoma_files_description',
                        value: normalizedDescription
                    }
                });
            } else {
                await tx.projectSettings.deleteMany({
                    where: { project_id: projectId, key: 'atoma_files_description' }
                });
            }

            if (normalizedPayloadValue) {
                await tx.projectSettings.upsert({
                    where: { project_id_key: { project_id: projectId, key: 'atoma_files_payload' } },
                    update: { value: normalizedPayloadValue },
                    create: {
                        project_id: projectId,
                        key: 'atoma_files_payload',
                        value: normalizedPayloadValue
                    }
                });
            } else {
                await tx.projectSettings.deleteMany({
                    where: { project_id: projectId, key: 'atoma_files_payload' }
                });
            }
        });

        const refreshed = await prisma.projectSettings.findMany({
            where: {
                project_id: projectId,
                key: { in: ['atoma_files_description', 'atoma_files_payload'] }
            }
        });

        const savedDescription = refreshed.find((setting) => setting.key === 'atoma_files_description')?.value || '';
        const savedPayloadValue = refreshed.find((setting) => setting.key === 'atoma_files_payload')?.value || '';
        const savedPayload = safeJsonParse(savedPayloadValue);
        const updatedAt = refreshed
            .map((setting) => setting.updated_at)
            .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;

        return {
            description: savedDescription,
            payload: savedPayload,
            payload_text: savedPayloadValue ? (savedPayload !== null ? formatJson(savedPayload) : savedPayloadValue) : '',
            updated_at: updatedAt
        };
    });

    fastify.get('/api/settings/skill-connections', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const setting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'llm_skill_connections' } }
        });

        if (!setting?.value) {
            return [];
        }

        try {
            const parsed = JSON.parse(setting.value);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.error('Failed to parse llm_skill_connections', error);
            return [];
        }
    });

    fastify.put('/api/settings/skill-connections', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { connections } = request.body as { connections?: any[] };
        if (!Array.isArray(connections)) {
            return reply.code(400).send({ error: 'connections must be an array' });
        }

        const normalized = connections.map((connection, index) => {
            if (!connection?.name || !connection?.provider || !connection?.model) {
                throw new Error(`connections[${index}] must include name, provider and model`);
            }

            return {
                id: String(connection.id || `skill-connection-${index + 1}`),
                name: String(connection.name).trim(),
                provider: String(connection.provider).trim(),
                model: String(connection.model).trim(),
                providerKeyId: typeof connection.providerKeyId === 'number' ? connection.providerKeyId : null,
                endpointType: String(connection.endpointType || 'native').trim(),
                skillMode: String(connection.skillMode || 'native_skills').trim(),
                enabledSkills: Array.isArray(connection.enabledSkills)
                    ? connection.enabledSkills.map((skill: any) => String(skill).trim()).filter(Boolean)
                    : [],
                systemPrompt: String(connection.systemPrompt || ''),
                notes: String(connection.notes || ''),
                enabled: connection.enabled !== false,
                supportsSkills: connection.supportsSkills !== false
            };
        });

        await prisma.projectSettings.upsert({
            where: { project_id_key: { project_id: projectId, key: 'llm_skill_connections' } },
            update: { value: JSON.stringify(normalized) },
            create: {
                project_id: projectId,
                key: 'llm_skill_connections',
                value: JSON.stringify(normalized)
            }
        });

        return normalized;
    });

    // Model Fetching
    fastify.get('/api/settings/models', async (request, reply) => {
        const projectId = (request as any).projectId;
        const { provider, keyId, key } = request.query as { provider?: string, keyId?: string, key?: string };

        let apiKey = key;
        let detectedProvider = provider || 'Unknown';

        // If keyId is provided, fetch from DB
        if (keyId) {
            const storedKey = await prisma.providerKey.findFirst({
                where: { id: parseInt(keyId), project_id: projectId }
            });
            if (storedKey) {
                apiKey = storedKey.key;
                detectedProvider = storedKey.provider;
            }
        }

        if (!apiKey) return reply.code(400).send({ error: 'API Key required' });

        // Auto-detect provider if missing
        if (!detectedProvider || detectedProvider === 'Unknown') {
            if (apiKey.startsWith('sk-ant')) detectedProvider = 'Anthropic';
            else if (apiKey.startsWith('AIza')) detectedProvider = 'Gemini';
            else if (apiKey.startsWith('sk-')) detectedProvider = 'OpenAI';
        }

        const models = await modelService.fetchModels(detectedProvider, apiKey);
        return { models };
    });

    // ==========================================
    // V2 Orchestrator Routes
    // ==========================================

    fastify.get('/api/v2/weeks', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const weeks = await prisma.weekPackage.findMany({
            where: { project_id: projectId },
            orderBy: { week_start: 'desc' },
            include: { _count: { select: { content_items: true } } }
        });
        return weeks;
    });

    fastify.get('/api/v2/weeks/:id', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };
        let week = await prisma.weekPackage.findUnique({
            where: { id: parseInt(id), project_id: projectId },
            include: {
                content_items: {
                    orderBy: { schedule_at: 'asc' }
                }
            }
        });

        if (!week) {
            // Check if it is a V1 week ID
            const v1Week = await prisma.week.findFirst({
                where: { id: parseInt(id), project_id: projectId }
            });
            if (v1Week) {
                // Find matching V2 week package using range overlap
                const matchingWeekPackage = await prisma.weekPackage.findFirst({
                    where: {
                        project_id: projectId,
                        week_start: {
                            gte: v1Week.week_start,
                            lte: v1Week.week_end
                        }
                    },
                    include: {
                        content_items: {
                            orderBy: { schedule_at: 'asc' }
                        }
                    }
                });
                if (matchingWeekPackage) {
                    week = matchingWeekPackage;
                }
            }
        }

        if (!week) return reply.code(404).send({ error: 'V2 WeekPackage not found' });
        return week;
    });

    fastify.post('/api/v2/weeks/:id/convert-to-v1', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };

        try {
            const result = await plannerService.convertWeekPackageToV1(projectId, parseInt(id));

            logEgressDiagnostic('weeks.convert_to_v1', {
                projectId,
                weekPackageId: parseInt(id),
                weekId: result.weekId,
                reused: result.reused
            });

            return {
                success: true,
                message: result.reused ? 'V1 Week already exists for these dates.' : 'V1 Week created successfully.',
                weekId: result.weekId
            };
        } catch (error: any) {
            if (error.message === 'V2 WeekPackage not found') {
                return reply.code(404).send({ error: error.message });
            }
            return reply.code(400).send({ error: error.message });
        }
    });

    fastify.post('/api/v2/plan-week', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { themeHint, startDate } = request.body as { themeHint: string; startDate?: string };

        // Determine next Monday if not provided
        let weekStart = new Date();
        if (startDate) {
            weekStart = new Date(startDate);
        } else {
            const dayOfWeek = weekStart.getDay();
            const daysUntilNextMonday = (8 - dayOfWeek) % 7 || 7;
            weekStart.setDate(weekStart.getDate() + daysUntilNextMonday);
        }
        weekStart.setUTCHours(0, 0, 0, 0);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setUTCHours(23, 59, 59, 999);

        try {
            // 1. SMO
            const wp = await v2Orchestrator.planWeek(projectId, weekStart, weekEnd, themeHint || '');

            // 2. DA (Dynamic split from MTA/SMO)
            await v2Orchestrator.architectDistribution(wp.id);

            // 3. NCC
            const validation = await v2Orchestrator.validateContinuity(wp.id);
            if (!validation.valid) {
                console.warn(`[NCC] Validation failed for WP ${wp.id}: ${validation.critique}`);
                // Save risks back or handle
            }

            return { success: true, weekPackageId: wp.id, validation };
        } catch (e: any) {
            console.error('[API] Error in V2 plan-week:', e);
            reply.code(500).send({ error: 'Failed to complete V2 planning', details: e.message });
        }
    });

    fastify.post('/api/v2/approve-week/:id', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };

        const wp = await prisma.weekPackage.findUnique({ where: { id: parseInt(id), project_id: projectId } });
        if (!wp) return reply.code(404).send({ error: 'WeekPackage not found' });

        const updated = await prisma.weekPackage.update({
            where: { id: wp.id },
            data: { approval_status: 'approved' }
        });

        return { success: true, status: updated.approval_status };
    });

    fastify.post('/api/v2/architect-week/:id', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params as { id: string };

        try {
            const items = await v2Orchestrator.architectDistribution(parseInt(id));
            return { success: true, count: items.length };
        } catch (e: any) {
            reply.code(500).send({ error: e.message || 'Failed to architect week' });
        }
    });

    fastify.post('/api/v2/plan-quarter', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { goalHint, startDate, plannedChannels } = request.body as { goalHint?: string; startDate?: string; plannedChannels?: any };
        const dStart = startDate ? new Date(startDate) : new Date();

        try {
            const result = await v2Orchestrator.planQuarter(projectId, dStart, goalHint, plannedChannels);

            // For MVP, immediately kick off Monthly Tactical Agents (MTA) for all 3 generated months
            for (const month of result.monthArcs) {
                await v2Orchestrator.planMonth(month.id);
            }

            return { success: true, quarterId: result.quarterPlan.id };
        } catch (e: any) {
            reply.code(500).send({ error: e.message || 'Failed to plan quarter' });
        }
    });

    fastify.get('/api/v2/quarters', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const quarters = await prisma.quarterPlan.findMany({
            where: { project_id: projectId },
            orderBy: { quarter_start: 'desc' },
            include: {
                month_arcs: {
                    include: {
                        week_packages: true
                    }
                }
            }
        });
        return quarters;
    });

    fastify.post('/api/v2/factory-sweep', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        try {
            // Trigger the generator service script Logic asynchronously or await it here.
            // For MVP API, we do it inline and block or trigger child process.
            // Let's do a lightweight inline sweep for just 2 items to prevent timeout
            const itemsToProcess = await prisma.contentItem.findMany({
                where: {
                    project_id: projectId,
                    status: 'planned',
                    week_package: { approval_status: 'approved' }
                },
                take: 2 // Max 2 per api ping to avoid 504 timeouts
            });

            const results = [];
            for (const item of itemsToProcess) {
                try {
                    await generatorService.generateContentItemText(item.id);
                    results.push({ id: item.id, status: 'drafted' });
                } catch (e: any) {
                    await prisma.contentItem.update({ where: { id: item.id }, data: { status: 'failed' } });
                    results.push({ id: item.id, status: 'failed', error: e.message });
                }
            }
            return { processed: results.length, results };
        } catch (e: any) {
            reply.code(500).send({ error: 'Failed during factory sweep', details: e.message });
        }
    });

    // ─── Strategy Assistant Chat ─────────────────────────────────────────────

    const strategyLanguage = (value: unknown): 'ru' | 'en' => value === 'en' ? 'en' : 'ru';
    const defaultStrategyPrompt = (language: 'ru' | 'en') => language === 'en'
        ? `You are a content strategy assistant. Help the author build an effective content strategy for their channels.
Consider platform-specific audiences, a sustainable publishing cadence, the Awareness → Authority → Conversion funnel, and the current quarterly plan.
Ask focused follow-up questions and propose concrete decisions and post formats. Reply in English: concise, specific, and useful.`
        : `Ты — Стратегический Ассистент по контенту.
Твоя задача: помогать автору выстроить эффективную контентную стратегию для его каналов.
Ты учитываешь разные платформы, стабильный контентный поток, воронку Awareness → Authority → Conversion и текущий квартальный план.
Задавай уточняющие вопросы, предлагай конкретные решения и форматы постов. Отвечай на русском языке: кратко, конкретно и полезно.`;

    /**
     * GET the current system prompt for the strategy assistant.
     */
    fastify.get('/api/v2/strategy-chat/settings', async (request, _reply) => {
        const projectId = (request as any).projectId;
        const { language } = request.query as { language?: string };
        const setting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'strategy_assistant_prompt' } }
        });
        return {
            systemPrompt: setting?.value || defaultStrategyPrompt(strategyLanguage(language))
        };
    });

    /**
     * PUT updated system prompt for the strategy assistant.
     */
    fastify.put('/api/v2/strategy-chat/settings', async (request, _reply) => {
        const projectId = (request as any).projectId;
        const { systemPrompt } = request.body as { systemPrompt: string };
        await prisma.projectSettings.upsert({
            where: { project_id_key: { project_id: projectId, key: 'strategy_assistant_prompt' } },
            update: { value: systemPrompt },
            create: { project_id: projectId, key: 'strategy_assistant_prompt', value: systemPrompt }
        });
        return { success: true };
    });

    fastify.get('/api/v2/strategy-chat/history', async (request) => {
        const projectId = (request as any).projectId;
        const setting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'strategy_assistant_history' } }
        });
        try {
            const messages = JSON.parse(setting?.value || '[]');
            return { messages: Array.isArray(messages) ? messages.slice(-40) : [] };
        } catch {
            return { messages: [] };
        }
    });

    fastify.delete('/api/v2/strategy-chat/history', async (request) => {
        const projectId = (request as any).projectId;
        await prisma.projectSettings.deleteMany({ where: { project_id: projectId, key: 'strategy_assistant_history' } });
        return { success: true };
    });

    /**
     * POST a message to the strategy assistant. Conversation history is owned by the project.
     */
    fastify.post('/api/v2/strategy-chat', async (request, reply) => {
        const projectId = (request as any).projectId;
        const { message, language } = request.body as {
            message: string;
            language?: string;
        };
        const responseLanguage = strategyLanguage(language);

        if (!message?.trim()) return reply.code(400).send({ error: 'Message is required' });

        // Load custom system prompt (or use default)
        const setting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'strategy_assistant_prompt' } }
        });
        const systemPrompt = setting?.value || defaultStrategyPrompt(responseLanguage);

        // Load current quarters for context
        const quarters = await prisma.quarterPlan.findMany({
            where: { project_id: projectId },
            orderBy: { quarter_start: 'desc' },
            take: 1,
            include: { month_arcs: true }
        });
        const contextStr = quarters.length > 0
            ? responseLanguage === 'en'
                ? `\n\nCurrent quarterly plan:\nGoal: ${quarters[0].strategic_goal}\nPillar: ${quarters[0].primary_pillar}\nMonths: ${quarters[0].month_arcs.map(m => m.arc_theme).join(', ')}`
                : `\n\nТекущий квартальный план:\nЦель: ${quarters[0].strategic_goal}\nПилар: ${quarters[0].primary_pillar}\nМесяцы: ${quarters[0].month_arcs.map(m => m.arc_theme).join(', ')}`
            : '';
        const languageRule = responseLanguage === 'en'
            ? '\n\nRespond in English, even if the source context contains another language.'
            : '\n\nОтвечай по-русски, даже если исходный контекст содержит другой язык.';

        const openai = new (require('openai').default)({ apiKey: process.env.OPENAI_API_KEY });
        const historySetting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'strategy_assistant_history' } }
        });
        let history: { role: 'user' | 'assistant'; content: string }[] = [];
        try {
            const parsed = JSON.parse(historySetting?.value || '[]');
            history = Array.isArray(parsed)
                ? parsed.filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string').slice(-20)
                : [];
        } catch { /* Ignore malformed legacy chat history. */ }

        const messages = [
            { role: 'system' as const, content: systemPrompt + contextStr + languageRule },
            ...history.slice(-10), // keep last 10 turns for context
            { role: 'user' as const, content: message }
        ];

        try {
            const completion = await openai.chat.completions.create({
                model: modelForRole('classifier'),
                messages,
                max_tokens: 1000
            });
            const reply_text = completion.choices[0]?.message.content || '';
            const nextHistory = [...history, { role: 'user' as const, content: message.trim() }, { role: 'assistant' as const, content: reply_text }].slice(-40);
            await prisma.projectSettings.upsert({
                where: { project_id_key: { project_id: projectId, key: 'strategy_assistant_history' } },
                update: { value: JSON.stringify(nextHistory) },
                create: { project_id: projectId, key: 'strategy_assistant_history', value: JSON.stringify(nextHistory) }
            });
            return { reply: reply_text, messages: nextHistory };
        } catch (e: any) {
            reply.code(500).send({ error: e.message || 'AI request failed' });
        }
    });
}

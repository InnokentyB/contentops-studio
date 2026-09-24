import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import prisma from '../../db';
import publisherService from '../../services/publisher.service';
import generatorService from '../../services/generator.service';
import multiAgentService from '../../services/multi_agent.service';
import { channelContentLanguage } from '../../services/content_language.service';
import artDirectionService from '../../services/art_direction.service';
import publicationPlanService from '../../services/publication_plan.service';
import publicationAdapterService from '../../services/publication_adapter.service';
import publicationFactService from '../../services/publication_fact.service';
import commentService from '../../services/comment.service';
import storageService from '../../services/storage.service';
import imageAssetService from '../../services/image_asset.service';
import initiativeService from '../../services/initiative.service';
import { assertVisualGenerationGate, hardenEditorialVisualPrompt } from '../../services/visual_generation_policy';
import { isPublicationTaskActive } from '../../services/publication_task_activity';
import { derivePublicationContentState } from '../../services/publication_content_state';
import { jsonBytes, logEgressDiagnostic, textBytes } from '../../utils/egress_diagnostics';
import { extractRequestErrorMessage } from './helpers';
import {
    loadPublicationPlanContext,
    loadPublicationProjectContext,
    derivePublicationVoice,
    resolveTaskScheduleAt,
    buildPublicationTaskListItem,
    buildPublicationTaskDetailItem,
    countBundleResourceFiles,
    countResolvedAssets,
    runPublicationCriticReview
} from './publication_task_helpers';

export {
    loadPublicationPlanContext,
    loadPublicationProjectContext,
    derivePublicationVoice,
    resolveTaskScheduleAt,
    buildPublicationTaskListItem,
    buildPublicationTaskDetailItem,
    countBundleResourceFiles,
    countResolvedAssets,
    runPublicationCriticReview
};

interface IdParams {
    id: string;
}

export default async function publicationTasksRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.get('/api/publication-tasks', async (request: FastifyRequest, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { status, manualOnly, weekPackageId, from, to } = request.query as {
            status?: string;
            manualOnly?: string;
            weekPackageId?: string;
            from?: string;
            to?: string;
        };

        const where: Prisma.ContentItemWhereInput = {
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

    fastify.get('/api/publication-tasks/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params;
        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id, 10), project_id: projectId },
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

    fastify.get('/api/publication-tasks/:id/visual-readiness', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });
        const taskId = Number(request.params.id);
        if (!Number.isInteger(taskId)) return reply.code(400).send({ error: 'Invalid task ID' });
        return artDirectionService.getReadiness(projectId, taskId);
    });

    fastify.put('/api/publication-tasks/:id/content', async (request: FastifyRequest<{ Params: IdParams; Body: { body?: string } }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params;
        const { body } = request.body || {};

        if (typeof body !== 'string') {
            return reply.code(400).send({ error: 'body must be a string' });
        }

        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id, 10), project_id: projectId }
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

    fastify.post('/api/publication-tasks/:id/prepare-handoff', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params;
        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id, 10), project_id: projectId },
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
        const effectiveAccount = {
            ...channelConfig,
            ...rawAccount,
            workflow_mode: channelConfig.workflow_mode || rawAccount.workflow_mode,
            platform: rawAccount.platform || item.channel?.type
        };
        const directExecutionSupported = publicationAdapterService.supportsDirectExecution(effectiveAccount);
        const browserRequired = !directExecutionSupported
            || (bundle.mode === 'manual' && !publicationAdapterService.prefersAutomaticExecution(effectiveAccount));

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

    fastify.post('/api/publication-tasks/:id/publish-now', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params;
        const taskId = parseInt(id, 10);
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
        } catch (error: unknown) {
            return reply.code(400).send({ error: extractRequestErrorMessage(error, 'Failed to publish task now') });
        }
    });

    fastify.post('/api/publication-tasks/:id/confirm-publication', async (request: FastifyRequest<{
        Params: IdParams;
        Body: { publishedLink?: string; note?: string; outcome?: 'published' | 'blocked' | 'removed' | 'restricted' };
    }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        const user = (request as unknown as { user?: { id: number } }).user;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params;
        const { publishedLink, note, outcome } = request.body || {};

        if (!publishedLink) {
            return reply.code(400).send({ error: 'publishedLink is required' });
        }

        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id, 10), project_id: projectId }
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
            actorId: `user:${user?.id}`,
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

    fastify.post('/api/publication-tasks/:id/publication-fact', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        const userId = (request as unknown as { user?: { id: number } }).user?.id;
        if (!projectId || !userId) return reply.code(400).send({ error: 'Project and user are required' });
        const taskId = Number(request.params.id);
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

    fastify.get('/api/publication-tasks/:id/publication-fact', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        const userId = (request as unknown as { user?: { id: number } }).user?.id;
        if (!projectId || !userId) return reply.code(400).send({ error: 'Project and user are required' });
        try {
            return {
                publication_fact: await publicationFactService.get(
                    projectId,
                    Number(request.params.id),
                    `user:${userId}`
                )
            };
        } catch (error: any) {
            return reply.code(404).send({ error: String(error?.message || 'PUBLICATION_FACT_NOT_FOUND') });
        }
    });

    fastify.post('/api/publication-tasks/:id/external-comment-alert', async (request: FastifyRequest<{
        Params: IdParams;
        Body: { text?: string; commentUrl?: string; author?: string };
    }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params;
        const { text, commentUrl, author } = request.body || {};

        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id, 10), project_id: projectId }
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

    fastify.post('/api/publication-tasks/:id/critic-check', async (request: FastifyRequest<{
        Params: IdParams;
        Body: { text?: string };
    }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params;
        const { text } = request.body || {};

        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id, 10), project_id: projectId },
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

    fastify.post('/api/publication-tasks/:id/fix-with-critic', async (request: FastifyRequest<{
        Params: IdParams;
        Body: { text?: string };
    }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params;
        const { text } = request.body || {};

        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id, 10), project_id: projectId },
            include: { channel: true }
        });

        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }

        const initial = await runPublicationCriticReview(projectId, item, text);
        const currentText = initial.publicationBody;

        const fixed = await multiAgentService.runPublicationFixer(projectId, {
            task_id: (item.metrics as any)?.task_id || item.id,
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

    fastify.post('/api/publication-tasks/:id/generate-image', async (request: FastifyRequest<{
        Params: IdParams;
        Body: { provider?: 'preview' | 'final' | 'flagship' | 'gpt-image' | 'nano' | 'full' };
    }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        const userId = (request as unknown as { user?: { id: number } }).user?.id;
        if (!projectId || !userId) return reply.code(400).send({ error: 'Project and user are required' });

        const { id } = request.params;
        const { provider } = request.body || {};

        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id, 10), project_id: projectId },
            include: {
                week_package: true,
                channel: true,
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
                channelId: item.channel_id,
                channelName: item.channel?.name,
                channelType: item.channel?.type || item.type,
                placement: item.visual_placement || 'feed',
                decisionChannel: visualDecision?.channel,
                decisionPlacement: visualDecision?.placement,
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

    fastify.post('/api/publication-tasks/:id/upload-image', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        const userId = (request as unknown as { user?: { id: number } }).user?.id;
        if (!projectId || !userId) return reply.code(400).send({ error: 'Project and user are required' });

        const taskId = Number(request.params.id);
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
        const qualityReport = (item.quality_report as any) || {};
        const browserReasonCode = qualityReport.browser_handoff?.reason?.code;
        const reopenApprovedConnectorTask = item.status === 'browser_required'
            && browserReasonCode === 'MANUAL_EXECUTION_REQUIRED'
            && item.text_state === 'accepted'
            && item.accepted_revision === item.content_revision;
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
                    ...(reopenApprovedConnectorTask ? {
                        status: 'ready_for_execution',
                        publication_mode: 'connector_auto'
                    } : {}),
                    assets: { ...taskAssets, generated_visuals: generatedVisuals } as any,
                    quality_report: {
                        ...qualityReport,
                        ...(reopenApprovedConnectorTask ? {
                            browser_handoff: null,
                            publication_route: 'connector_auto',
                            publication_outcome: null
                        } : {}),
                        visual_storage: { provider: storageService.getProvider(), url: imageUrl, uploaded_at: new Date().toISOString() }
                    } as any
                }
            })
        ]);

        return { success: true, imageUrl, assetId: item.selected_asset.id, storageProvider: storageService.getProvider() };
    });
}

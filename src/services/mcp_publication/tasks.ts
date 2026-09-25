import prisma from '../../db';
import { Prisma } from '@prisma/client';
import artDirectionService from '../art_direction.service';
import publicationFactService from '../publication_fact.service';
import initiativeService from '../initiative.service';
import publicationPlanService from '../publication_plan.service';
import publicationAdapterService from '../publication_adapter.service';
import { channelContentLanguage } from '../content_language.service';
import { normalizeVkStoryPoll } from '../vk_story_poll';
import { isPublicationTaskActive } from '../publication_task_activity';
import { derivePublicationContentState } from '../publication_content_state';
import { derivePublicationGenerationStage } from '../publication_generation_stage';
import { planAcceptedContentEdit } from '../publication_content_revision_lifecycle';
import { preparationRoute } from '../publication_approval_guard';
import { loadPublicationPlanContext } from './plans';
import { resolveTaskScheduleAt, assertPublicationTaskMutableForMcp } from './helpers';
import { PublicationOutcome } from './types';

/**
 * Get resources and assets associated with a publication task.
 */
export async function getPublicationTaskResources(projectId: number, taskId: number, maxChars = 12000) {
    const item = await prisma.contentItem.findFirst({
        where: { id: taskId, project_id: projectId },
        include: { channel: true, selected_asset: true }
    });

    if (!item) {
        throw new Error(`Publication task ${taskId} not found for project ${projectId}`);
    }

    const action = (item.assets as Record<string, unknown> | null)?.action;
    const plan = action ? await loadPublicationPlanContext(projectId) : null;
    if (action && !plan) {
        throw new Error(`No imported publication plan found for project ${projectId}`);
    }
    const bundle = action
        ? publicationPlanService.buildHandoffBundle({ ...plan!, actions: [action] } as unknown as Parameters<typeof publicationPlanService.buildHandoffBundle>[0], item)
        : publicationPlanService.buildGeneratedContentItemHandoff(item);
    const resources = Array.isArray(bundle.resource_files) ? bundle.resource_files : [];

    return {
        project_id: projectId,
        task_id: taskId,
        resources: resources.map((entry) => {
            const entryRecord = entry as Record<string, unknown>;
            const content = typeof entryRecord.content === 'string' ? entryRecord.content : null;
            const truncated = Boolean(content && content.length > maxChars);

            return {
                ref: entryRecord.ref || null,
                type: entryRecord.type || null,
                role: entryRecord.role || null,
                purpose: entryRecord.purpose || null,
                relative_path: entryRecord.relative_path || null,
                full_path: entryRecord.full_path || null,
                section_marker: entryRecord.section_marker || null,
                exists: entryRecord.exists === true,
                url: entryRecord.url || null,
                content_source: entryRecord.content_source || null,
                content_type: entryRecord.content_type || null,
                checksum_sha256: entryRecord.checksum_sha256 || null,
                byte_size: entryRecord.byte_size || null,
                width: entryRecord.width || null,
                height: entryRecord.height || null,
                color_mode: entryRecord.color_mode || null,
                provenance: entryRecord.provenance || null,
                snapshot_available: entryRecord.snapshot_available === true,
                truncated,
                content: content ? (truncated ? `${content.slice(0, maxChars)}\n...[truncated]` : content) : null
            };
        })
    };
}

/**
 * List publication tasks for a project.
 */
export async function listPublicationTasks(projectId: number, status?: string, manualOnly?: boolean) {
    const where: Prisma.ContentItemWhereInput = {
        project_id: projectId,
        type: { not: 'week_theme' },
        OR: [
            { assets: { not: Prisma.DbNull } },
            { item_key: { startsWith: 'week-topic:' } }
        ]
    };

    if (status === 'active') {
        where.status = { in: ['planned', 'drafted', 'revised', 'approved', 'scheduled', 'ready_for_execution', 'browser_required', 'awaiting_manual_publication', 'failed'] };
    } else if (status) {
        where.status = status;
    }

    const items = await prisma.contentItem.findMany({
        where,
        include: { channel: true, publication_fact: true, work_items: { select: { kind: true, state: true } } },
        orderBy: { schedule_at: 'asc' }
    });

    const activeFiltered = status === 'active'
        ? items.filter((item: (typeof items)[number]) => isPublicationTaskActive(item))
        : items;
    const filtered = manualOnly
        ? activeFiltered.filter((item: (typeof items)[number]) => {
            const executionMode = (item.quality_report as Record<string, unknown> | null)?.execution_mode;
            return item.publication_mode === 'browser_required'
                || executionMode === 'manual'
                || executionMode === 'browser';
        })
        : activeFiltered;

    return filtered.map((item: (typeof items)[number]) => ({
        id: item.id,
        title: item.title,
        type: item.type,
        status: item.status,
        layer: item.layer,
        schedule_at: resolveTaskScheduleAt(item),
        published_link: item.published_link,
        content_state: derivePublicationContentState(item),
        content_revision: item.content_revision,
        generation_stage: derivePublicationGenerationStage({
            status: item.status,
            draftText: item.draft_text,
            textState: item.text_state,
            visualState: item.visual_state,
            handoffState: item.handoff_state,
            publicationMode: item.publication_mode,
            workItems: item.work_items
        }),
        publication_mode: item.publication_mode,
        channel: item.channel
            ? {
                id: item.channel.id,
                name: item.channel.name,
                type: item.channel.type
            }
            : null,
        execution_mode: (item.quality_report as Record<string, unknown> | null)?.execution_mode || null,
        publication_outcome: (item.metrics as Record<string, unknown> | null)?.publication_outcome || (item.quality_report as Record<string, unknown> | null)?.publication_outcome || null,
        publication_fact: item.publication_fact || null
    }));
}

/**
 * Get single publication task details.
 */
export async function getPublicationTask(projectId: number, taskId: number) {
    const item = await prisma.contentItem.findFirst({
        where: { id: taskId, project_id: projectId },
        include: {
            channel: true,
            selected_asset: true,
            publication_fact: true,
            metric_snapshots: { orderBy: { scheduled_for: 'asc' } },
            work_items: { select: { kind: true, state: true } }
        }
    });

    if (!item) {
        throw new Error(`Publication task ${taskId} not found for project ${projectId}`);
    }

    const plan = await loadPublicationPlanContext(projectId);
    const action = (item.assets as Record<string, unknown> | null)?.action;
    if (!plan || !action) {
        const bundle = publicationPlanService.buildGeneratedContentItemHandoff(item);
        return {
            ...item,
            content_state: derivePublicationContentState(item),
            generation_stage: derivePublicationGenerationStage({
                status: item.status,
                draftText: item.draft_text,
                textState: item.text_state,
                visualState: item.visual_state,
                handoffState: item.handoff_state,
                publicationMode: item.publication_mode,
                workItems: item.work_items
            }),
            schedule_at: resolveTaskScheduleAt(item),
            quality_report: {
                ...((item.quality_report as Record<string, unknown> | null) || {}),
                handoff_bundle: bundle
            }
        };
    }

    const bundle = publicationPlanService.buildHandoffBundle({ ...plan, actions: [action] } as unknown as Parameters<typeof publicationPlanService.buildHandoffBundle>[0], item);
    return {
        ...item,
        generation_stage: derivePublicationGenerationStage({
            status: item.status,
            draftText: item.draft_text,
            textState: item.text_state,
            visualState: item.visual_state,
            handoffState: item.handoff_state,
            publicationMode: item.publication_mode,
            workItems: item.work_items
        }),
        content_state: derivePublicationContentState({
            ...item,
            quality_report: {
                ...((item.quality_report as Record<string, unknown> | null) || {}),
                handoff_bundle: bundle
            }
        }),
        schedule_at: resolveTaskScheduleAt(item),
        quality_report: {
            ...((item.quality_report as Record<string, unknown> | null) || {}),
            handoff_bundle: bundle
        }
    };
}

/**
 * Update publication body content with revision locking and lifecycle checks.
 */
export async function updatePublicationContent(input: {
    projectId: number;
    taskId: number;
    body: string;
    expectedRevision: number;
}) {
    const item = await prisma.contentItem.findFirst({
        where: { id: input.taskId, project_id: input.projectId }
    });

    if (!item) {
        throw new Error(`Publication task ${input.taskId} not found for project ${input.projectId}`);
    }
    if (item.content_revision !== input.expectedRevision) {
        throw new Error('[CONTENT_REVISION_CONFLICT] Publication content changed since it was read. Reload the task and retry.');
    }

    assertPublicationTaskMutableForMcp(item, 'update_publication_content');
    const qualityReport = { ...((item.quality_report as Record<string, unknown> | null) || {}) };
    const handoffBundle = qualityReport.handoff_bundle as Record<string, unknown> | undefined;
    const handoffPub = handoffBundle?.publication as Record<string, unknown> | undefined;
    const previousBody = String(
        handoffPub?.body
        || item.draft_text
        || ''
    );
    const history = Array.isArray(qualityReport.content_edit_history)
        ? qualityReport.content_edit_history
        : [];

    if (input.body !== previousBody) {
        qualityReport.content_edit_history = [{
            edited_at: new Date().toISOString(),
            previous_body: previousBody,
            next_body: input.body
        }, ...history].slice(0, 20);
    }

    if (handoffPub) {
        qualityReport.handoff_bundle = {
            ...handoffBundle,
            publication: {
                ...handoffPub,
                body: input.body
            }
        };
    }

    const lifecycle = planAcceptedContentEdit({
        currentRevision: item.content_revision,
        acceptedRevision: item.accepted_revision,
        textState: item.text_state,
        bodyChanged: input.body !== previousBody
    });

    if (!lifecycle.reopenReview) {
        return {
            id: item.id,
            draft_text: item.draft_text,
            content_revision: item.content_revision,
            content_state: derivePublicationContentState(item),
            updated_at: item.updated_at
        };
    }

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await artDirectionService.markRevisionStale(tx, item.id);
        const result = await tx.contentItem.updateMany({
            where: {
                id: item.id,
                project_id: input.projectId,
                content_revision: input.expectedRevision
            },
            data: {
                draft_text: input.body,
                quality_report: qualityReport as Prisma.InputJsonValue,
                content_revision: lifecycle.contentRevision,
                text_state: lifecycle.textState,
                accepted_revision: lifecycle.acceptedRevision,
                status: 'drafted'
            }
        });

        if (result.count !== 1) {
            throw new Error('[CONTENT_REVISION_CONFLICT] Publication content changed since it was read. Reload the task and retry.');
        }

        const existingReview = await tx.workItem.findFirst({
            where: { content_item_id: item.id, kind: 'content_review' },
            orderBy: { updated_at: 'desc' }
        });
        const reviewData = {
            state: lifecycle.reviewState!,
            input_context_version: lifecycle.contentRevision,
            result_version: lifecycle.reviewBaseResultVersion,
            result_payload: {
                body: input.body,
                content_revision: lifecycle.contentRevision,
                source: 'publication_content_update'
            },
            lease_token: null,
            lease_expires_at: null,
            lease_actor_id: null,
            note: `Review publication content revision ${lifecycle.contentRevision}`
        };
        if (existingReview) {
            await tx.workItem.update({ where: { id: existingReview.id }, data: reviewData });
        } else {
            await tx.workItem.create({
                data: {
                    project_id: input.projectId,
                    week_package_id: item.week_package_id,
                    content_item_id: item.id,
                    item_key: item.item_key || `content:${item.id}`,
                    kind: 'content_review',
                    assignee_role: 'content_reviewer',
                    ...reviewData
                }
            });
        }
        return tx.contentItem.findUniqueOrThrow({ where: { id: item.id } });
    });
    return {
        id: updated.id,
        draft_text: updated.draft_text,
        content_revision: updated.content_revision,
        content_state: derivePublicationContentState(updated),
        updated_at: updated.updated_at
    };
}

/**
 * Configure native VK Story poll.
 */
export async function configureVkStoryPoll(input: {
    projectId: number;
    taskId: number;
    expectedRevision: number;
    question?: string;
    answers?: string[];
    anonymous?: boolean;
    multiple?: boolean;
    remove?: boolean;
}) {
    const item = await prisma.contentItem.findFirst({
        where: { id: input.taskId, project_id: input.projectId },
        include: { channel: true }
    });
    if (!item) throw new Error(`Publication task ${input.taskId} not found for project ${input.projectId}`);
    if (item.content_revision !== input.expectedRevision) {
        throw new Error('[CONTENT_REVISION_CONFLICT] Publication content changed since it was read. Reload the task and retry.');
    }
    assertPublicationTaskMutableForMcp(item, 'configure_vk_story_poll');
    const isVkStory = item.channel?.type === 'vk'
        && (String(item.type || '').toLowerCase().includes('story') || item.visual_placement === 'story');
    if (!isVkStory) throw new Error('[VK_STORY_TASK_REQUIRED] Native VK polls can only be configured on VK story tasks');

    const previous = (item.assets as Record<string, unknown> | null)?.vk_story_poll as Parameters<typeof normalizeVkStoryPoll>[0] || null;
    if (input.remove === true && !previous) return item;
    const normalized = input.remove === true ? null : normalizeVkStoryPoll(input);
    const previousComparable = previous ? normalizeVkStoryPoll(previous) : null;
    const comparable = normalized ? { ...normalized, content_revision: undefined } : null;
    if (previousComparable && comparable
        && JSON.stringify({ ...previousComparable, content_revision: undefined }) === JSON.stringify(comparable)) {
        return item;
    }

    const lifecycle = planAcceptedContentEdit({
        currentRevision: item.content_revision,
        acceptedRevision: item.accepted_revision,
        textState: item.text_state,
        bodyChanged: true
    });
    const nextRevision = lifecycle.contentRevision;
    const boundPoll = normalized ? { ...normalized, content_revision: nextRevision } : null;
    const { vk_story_poll: _previousPoll, ...assetsWithoutPoll } = ((item.assets as Record<string, unknown> | null) || {});
    const qualityReport = { ...((item.quality_report as Record<string, unknown> | null) || {}) };
    const handoffBundle = qualityReport.handoff_bundle as Record<string, unknown> | undefined;
    if (handoffBundle?.publication) {
        const publicationObj = handoffBundle.publication as Record<string, unknown>;
        const { native_poll: _previousHandoffPoll, ...publicationWithoutPoll } = publicationObj;
        qualityReport.handoff_bundle = {
            ...handoffBundle,
            publication: boundPoll
                ? { ...publicationWithoutPoll, native_poll: boundPoll }
                : publicationWithoutPoll
        };
    }

    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await artDirectionService.markRevisionStale(tx, item.id);
        const changed = await tx.contentItem.updateMany({
            where: { id: item.id, project_id: input.projectId, content_revision: input.expectedRevision },
            data: {
                assets: (boundPoll ? { ...assetsWithoutPoll, vk_story_poll: boundPoll } : assetsWithoutPoll) as Prisma.InputJsonValue,
                quality_report: qualityReport as Prisma.InputJsonValue,
                content_revision: nextRevision,
                text_state: lifecycle.textState,
                accepted_revision: lifecycle.acceptedRevision,
                status: 'drafted',
                handoff_state: 'blocked'
            }
        });
        if (changed.count !== 1) {
            throw new Error('[CONTENT_REVISION_CONFLICT] Publication content changed since it was read. Reload the task and retry.');
        }
        const existingReview = await tx.workItem.findFirst({
            where: { content_item_id: item.id, kind: 'content_review' },
            orderBy: { updated_at: 'desc' }
        });
        const reviewData = {
            state: 'available',
            input_context_version: nextRevision,
            result_version: lifecycle.reviewBaseResultVersion,
            result_payload: Prisma.DbNull,
            lease_token: null,
            lease_expires_at: null,
            lease_actor_id: null,
            note: boundPoll
                ? `Review publication content and VK story poll revision ${nextRevision}`
                : `Review publication content after removing the VK story poll in revision ${nextRevision}`
        };
        if (existingReview) {
            await tx.workItem.update({ where: { id: existingReview.id }, data: reviewData });
        } else {
            await tx.workItem.create({
                data: {
                    project_id: input.projectId,
                    week_package_id: item.week_package_id,
                    content_item_id: item.id,
                    item_key: item.item_key || `content:${item.id}`,
                    kind: 'content_review',
                    assignee_role: 'content_reviewer',
                    ...reviewData
                }
            });
        }
        return tx.contentItem.findUniqueOrThrow({ where: { id: item.id } });
    });
}

/**
 * Prepare publication task for execution.
 */
export async function preparePublicationTask(projectId: number, taskId: number) {
    const item = await prisma.contentItem.findFirst({
        where: { id: taskId, project_id: projectId },
        include: { channel: true, selected_asset: true }
    });

    if (!item) {
        throw new Error(`Publication task ${taskId} not found for project ${projectId}`);
    }

    assertPublicationTaskMutableForMcp(item, 'prepare_publication_task');
    await artDirectionService.assertPublicationReady(projectId, taskId);

    const plan = await loadPublicationPlanContext(projectId);
    const action = (item.assets as Record<string, unknown> | null)?.action;
    if (plan) plan.actions = action ? [action] : [];
    const bundle = plan && action
        ? publicationPlanService.buildHandoffBundle(plan as unknown as Parameters<typeof publicationPlanService.buildHandoffBundle>[0], item, { requireAcceptedContent: true })
        : publicationPlanService.buildGeneratedContentItemHandoff(item, { requireAcceptedContent: true });
    const channelConfig = ((item.channel?.config as Record<string, unknown> | null) || {});
    const rawAccount = (channelConfig.raw_account as Record<string, unknown> | undefined) || channelConfig;
    const effectiveAccount = {
        ...channelConfig,
        ...rawAccount,
        workflow_mode: channelConfig.workflow_mode || rawAccount.workflow_mode,
        platform: rawAccount.platform || item.channel?.type
    };
    const directExecutionSupported = bundle.transport?.connector_authority !== 'manual_only'
        && publicationAdapterService.supportsDirectExecution(effectiveAccount);
    const bundleWithLanguage = {
        ...bundle,
        content_language: channelContentLanguage(item.channel)
    };
    const browserRequired = !directExecutionSupported
        || (bundleWithLanguage.mode === 'manual' && !publicationAdapterService.prefersAutomaticExecution(effectiveAccount));
    const preparation = preparationRoute(item.publication_mode, browserRequired);

    if (preparation === 'preserve_approval') {
        return {
            item: { ...item, schedule_at: resolveTaskScheduleAt(item) },
            bundle: bundleWithLanguage,
            reused: false
        };
    }

    const updated = await prisma.contentItem.update({
        where: { id: item.id },
        data: {
            status: preparation === 'browser_required' ? 'browser_required' : 'ready_for_execution',
            publication_mode: preparation,
            quality_report: {
                ...((item.quality_report as Record<string, unknown> | null) || {}),
                handoff_bundle: bundleWithLanguage,
                execution_mode: browserRequired ? 'browser' : 'automatic',
                publication_route: browserRequired ? 'browser_required' : 'connector_auto',
                prepared_at: new Date().toISOString()
            } as Prisma.InputJsonValue
        }
    });

    return {
        item: {
            ...updated,
            schedule_at: resolveTaskScheduleAt(updated)
        },
        bundle: bundleWithLanguage,
        reused: false
    };
}

/**
 * Confirm publication execution.
 */
export async function confirmPublication(
    projectId: number,
    taskId: number,
    publishedLink: string,
    note?: string,
    outcome: PublicationOutcome = 'published'
) {
    const item = await prisma.contentItem.findFirst({
        where: { id: taskId, project_id: projectId }
    });

    if (!item) {
        throw new Error(`Publication task ${taskId} not found for project ${projectId}`);
    }

    assertPublicationTaskMutableForMcp(item, 'confirm_publication');

    const owner = await prisma.projectMember.findFirst({
        where: { project_id: projectId, role: 'owner' },
        orderBy: { id: 'asc' }
    });
    if (!owner) throw new Error(`Project ${projectId} has no owner`);
    const rawType = String(item.type || '').toLowerCase();
    const artifactKind = rawType.includes('article') ? 'article'
        : rawType.includes('comment') ? 'comment'
            : rawType.includes('story') ? 'story'
                : rawType.includes('email') ? 'email'
                    : 'post';
    await publicationFactService.record({
        projectId,
        taskId,
        actorId: `user:${owner.user_id}`,
        artifactKind,
        outcome,
        publishedAt: new Date().toISOString(),
        publicUrl: publishedLink,
        confirmationMode: 'manual',
        evidence: { type: 'public_url', ref: publishedLink },
        note
    });
    const updated = await prisma.contentItem.findUniqueOrThrow({ where: { id: item.id } });
    await initiativeService.syncPublishedPublicationTask(projectId, taskId);
    return updated;
}

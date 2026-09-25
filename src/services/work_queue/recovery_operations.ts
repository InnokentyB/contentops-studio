import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../db';
import { planContentReviewRecovery, planMissingContentReviewRecovery } from '../publication_content_revision_lifecycle';
import { isLegacyArticleCoverAliasMismatchEvidence, isLegacyDzen958FeedMismatchEvidence, isLegacySiteBlogCoverMismatchEvidence, isPublicationPlacementMismatchEvidence, placementRepairProvenance, planPublicationPlacementRepair, repairMaterializedPublicationProjection } from '../publication_metadata_repair';
import { assertCanonicalPublicationPlacement } from '../publication_placement_contract';
import { requireProjectOwner } from './auth';
import { checkIdempotency, recordWorkflowEvent } from './infrastructure';

/**
 * Recovers an art direction input by creating a fresh art_direction work item
 * for re-assessment after verifying the task still matches preconditions.
 */
export async function recoverArtDirectionInput(params: {
    projectId: number;
    actorId: string;
    taskId: number;
    expectedChannelId: number;
    expectedPlacement: string;
    expectedRevision: number;
    oldWorkItemId: number;
    oldDecisionId: number;
    idempotencyKey: string;
}, database: typeof prisma = prisma): Promise<Record<string, unknown>> {
    return database.$transaction(async (tx) => {
        await requireProjectOwner(tx, params.projectId, params.actorId);
        const command = 'ba_recover_art_direction_input';
        const cached = await checkIdempotency(tx, {
            projectId: params.projectId, actorId: params.actorId, command,
            idempotencyKey: params.idempotencyKey
        });
        if (cached) return cached as Record<string, unknown>;

        const task = await tx.contentItem.findFirst({
            where: { id: params.taskId, project_id: params.projectId },
            include: { channel: true, publication_fact: true }
        });
        if (!task || !task.channel || task.channel_id !== params.expectedChannelId
            || task.visual_placement !== params.expectedPlacement
            || task.content_revision !== params.expectedRevision
            || task.accepted_revision !== params.expectedRevision
            || task.text_state !== 'accepted'
            || task.status !== 'approved' || task.visual_state !== 'BRIEFED'
            || task.handoff_state !== 'blocked' || task.selected_asset_id !== null
            || task.published_link || task.publication_fact) {
            throw new Error('[ART_RECOVERY_TASK_CONFLICT] Task no longer matches the accepted unpublished visual hold');
        }
        assertCanonicalPublicationPlacement(task.channel, params.expectedPlacement);
        const oldWorkItem = await tx.workItem.findFirst({
            where: {
                id: params.oldWorkItemId, project_id: params.projectId,
                content_item_id: task.id, kind: 'art_direction', state: 'completed',
                input_context_version: params.expectedRevision
            }
        });
        const oldDecision = await tx.artDirectionDecision.findFirst({
            where: {
                id: params.oldDecisionId, project_id: params.projectId,
                content_item_id: task.id, work_item_id: params.oldWorkItemId,
                decision_version: task.visual_decision_version, status: 'active'
            }
        });
        if (!oldWorkItem || !oldDecision || oldWorkItem.result_version !== oldDecision.decision_version) {
            throw new Error('[ART_RECOVERY_EVIDENCE_CONFLICT] Immutable work item or decision changed');
        }
        const newerInput = await tx.workItem.findFirst({
            where: {
                project_id: params.projectId, content_item_id: task.id, kind: 'art_direction',
                id: { not: oldWorkItem.id },
                state: { in: ['available', 'claimed', 'waiting_approval', 'completed'] },
                input_context_version: params.expectedRevision
            }
        });
        const newerAsset = await tx.imageAsset.findFirst({
            where: { project_id: params.projectId, content_item_id: task.id,
                content_revision: params.expectedRevision,
                decision: { is: { decision_version: { gt: oldDecision.decision_version } } } }
        });
        if (newerInput || newerAsset) {
            throw new Error('[ART_RECOVERY_ALREADY_SUPERSEDED] Newer valid input or asset exists');
        }
        const activeGenerator = await tx.workItem.findFirst({
            where: {
                project_id: params.projectId, content_item_id: task.id,
                kind: 'visual_generate', input_context_version: params.expectedRevision,
                state: 'claimed',
                result_payload: { path: ['decision_id'], equals: oldDecision.id }
            }
        });
        if (activeGenerator) {
            throw new Error('[ART_RECOVERY_GENERATOR_ACTIVE] Existing generation lease must finish or be safely released first');
        }

        const update = await tx.contentItem.updateMany({
            where: {
                id: task.id, project_id: params.projectId, channel_id: params.expectedChannelId,
                visual_placement: params.expectedPlacement, content_revision: params.expectedRevision,
                accepted_revision: params.expectedRevision, status: 'approved',
                visual_state: 'BRIEFED', handoff_state: 'blocked', selected_asset_id: null,
                visual_decision_version: oldDecision.decision_version
            },
            data: { visual_state: 'PENDING_ASSESSMENT' }
        });
        if (update.count !== 1) throw new Error('[ART_RECOVERY_RACE] Task changed concurrently');
        const staleGenerators = await tx.workItem.updateMany({
            where: {
                project_id: params.projectId, content_item_id: task.id,
                kind: 'visual_generate', input_context_version: params.expectedRevision,
                state: { in: ['available', 'waiting_approval'] },
                result_payload: { path: ['decision_id'], equals: oldDecision.id }
            },
            data: {
                state: 'blocked', reason_code: 'superseded_art_direction_input',
                note: `Held pending a new art-direction decision; prior decision ${oldDecision.id} retained as audit evidence`
            }
        });
        const dedupeKey = `art-direction:${task.id}:${params.expectedRevision}:${params.expectedPlacement}:contract-recovery:${oldWorkItem.id}`;
        const fresh = await tx.workItem.create({
            data: {
                project_id: params.projectId, week_package_id: task.week_package_id,
                content_item_id: task.id, item_key: task.item_key || `content:${task.id}`,
                kind: 'art_direction', state: 'available', assignee_role: 'art_director',
                input_context_version: params.expectedRevision, result_version: 0,
                dedupe_key: dedupeKey,
                note: `Reassess canonical ${task.channel.name}/${params.expectedPlacement} contract; prior work item ${oldWorkItem.id} and decision ${oldDecision.id} retained unchanged`,
                result_payload: {
                    recovery_kind: 'canonical_visual_contract',
                    superseded_work_item_id: oldWorkItem.id,
                    superseded_decision_id: oldDecision.id,
                    channel_id: task.channel.id, channel_type: task.channel.type,
                    placement: params.expectedPlacement
                }
            }
        });
        const result = {
            task_id: task.id, channel_id: task.channel.id, channel_type: task.channel.type,
            placement: params.expectedPlacement, accepted_revision: params.expectedRevision,
            old_work_item_id: oldWorkItem.id, old_decision_id: oldDecision.id,
            held_visual_generate_count: staleGenerators.count,
            art_direction_work_item_id: fresh.id, art_direction_state: fresh.state,
            input_context_version: fresh.input_context_version, result_version: fresh.result_version,
            visual_state: 'PENDING_ASSESSMENT', handoff_state: 'blocked'
        };
        await recordWorkflowEvent(tx, {
            projectId: params.projectId, workItemId: fresh.id,
            weekPackageId: task.week_package_id || undefined, contentItemId: task.id,
            actorId: params.actorId, command, idempotencyKey: params.idempotencyKey,
            beforeState: { visual_state: task.visual_state, old_work_item_id: oldWorkItem.id,
                old_decision_id: oldDecision.id }, afterState: result
        });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * Requires visual production for an exact accepted, unpublished task and creates
 * the first revision-bound art-direction input. It does not bind a channel,
 * alter copy/schedule, attach an asset, or grant publication authority.
 */
export async function requirePublicationVisual(params: {
    projectId: number; actorId: string; taskId: number;
    expectedContentRevision: number; expectedAcceptedRevision: number;
    expectedChannelId: number | null; expectedScheduleAt: string;
    expectedVisualMode: string; expectedVisualState: string;
    expectedVisualPlacement: string; expectedStatus: string; idempotencyKey: string;
}, database: typeof prisma = prisma): Promise<Record<string, unknown>> {
    return database.$transaction(async (tx) => {
        await requireProjectOwner(tx, params.projectId, params.actorId);
        const command = 'ba_require_publication_visual';
        const cached = await checkIdempotency(tx, { projectId: params.projectId, actorId: params.actorId,
            command, idempotencyKey: params.idempotencyKey });
        if (cached) return cached as Record<string, unknown>;
        const task = await tx.contentItem.findFirst({
            where: { id: params.taskId, project_id: params.projectId }, include: { publication_fact: true }
        });
        if (!task || task.channel_id !== params.expectedChannelId
            || task.content_revision !== params.expectedContentRevision
            || task.accepted_revision !== params.expectedAcceptedRevision
            || task.content_revision !== task.accepted_revision || task.text_state !== 'accepted'
            || task.status !== params.expectedStatus || ['published', 'removed', 'cancelled'].includes(task.status)
            || task.visual_mode !== params.expectedVisualMode || task.visual_state !== params.expectedVisualState
            || task.visual_placement !== params.expectedVisualPlacement || task.selected_asset_id !== null
            || task.schedule_at?.toISOString() !== params.expectedScheduleAt
            || task.publication_fact || task.published_link) {
            throw new Error('[VISUAL_REQUIREMENT_TASK_CONFLICT] Exact accepted unpublished task guards are required');
        }
        const [decision, existingInput] = await Promise.all([
            tx.artDirectionDecision.findFirst({ where: { project_id: params.projectId,
                content_item_id: task.id, source_content_revision: params.expectedContentRevision } }),
            tx.workItem.findFirst({ where: { project_id: params.projectId, content_item_id: task.id,
                kind: 'art_direction', input_context_version: params.expectedContentRevision } })
        ]);
        if (decision || existingInput) throw new Error('[VISUAL_REQUIREMENT_ALREADY_MATERIALIZED] Existing visual workflow requires reconciliation');
        const changed = await tx.contentItem.updateMany({ where: {
            id: task.id, project_id: params.projectId, channel_id: params.expectedChannelId,
            content_revision: params.expectedContentRevision, accepted_revision: params.expectedAcceptedRevision,
            status: params.expectedStatus, text_state: 'accepted', visual_mode: params.expectedVisualMode,
            visual_state: params.expectedVisualState, visual_placement: params.expectedVisualPlacement,
            selected_asset_id: null, schedule_at: new Date(params.expectedScheduleAt)
        }, data: { visual_mode: 'required', visual_state: 'PENDING_ASSESSMENT', handoff_state: 'blocked' } });
        if (changed.count !== 1) throw new Error('[VISUAL_REQUIREMENT_CAS_CONFLICT] Task changed concurrently');
        const dedupeKey = `art-direction:${task.id}:${params.expectedContentRevision}:${params.expectedVisualPlacement}:owner-required`;
        const workItem = await tx.workItem.create({ data: {
            project_id: params.projectId, week_package_id: task.week_package_id,
            content_item_id: task.id, item_key: task.item_key || `content:${task.id}`,
            kind: 'art_direction', state: 'available', assignee_role: 'art_director',
            input_context_version: params.expectedContentRevision, result_version: 0,
            dedupe_key: dedupeKey,
            note: `Owner requires a visual for accepted revision ${params.expectedContentRevision}; assess placement ${params.expectedVisualPlacement}`,
            result_payload: { recovery_kind: 'owner_visual_requirement', channel_id: params.expectedChannelId,
                placement: params.expectedVisualPlacement }
        } });
        const result = { task_id: task.id, content_revision: task.content_revision,
            accepted_revision: task.accepted_revision, channel_id: task.channel_id,
            schedule_at: params.expectedScheduleAt, visual_mode: 'required', visual_state: 'PENDING_ASSESSMENT',
            handoff_state: 'blocked', art_direction_work_item_id: workItem.id,
            art_direction_state: workItem.state, input_context_version: workItem.input_context_version,
            selected_asset_id: null, published: false };
        await recordWorkflowEvent(tx, { projectId: params.projectId, workItemId: workItem.id,
            weekPackageId: task.week_package_id || undefined, contentItemId: task.id, actorId: params.actorId,
            command, idempotencyKey: params.idempotencyKey,
            beforeState: { visual_mode: task.visual_mode, visual_state: task.visual_state,
                selected_asset_id: task.selected_asset_id }, afterState: result });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * Repairs a publication placement mismatch by re-binding channel/placement
 * and creating a fresh art_direction work item for the corrected contract.
 */
export async function repairPublicationPlacement(params: {
    projectId: number;
    actorId: string;
    taskId: number;
    expectedContentRevision: number;
    expectedAcceptedRevision: number;
    expectedChannelId: number | null;
    expectedPlacement: string;
    targetChannelId: number;
    targetPlacement: string;
    blockedWorkItemId: number;
    idempotencyKey: string;
}): Promise<Record<string, unknown>> {
    return prisma.$transaction(async (tx) => {
        await requireProjectOwner(tx, params.projectId, params.actorId);
        const command = 'ba_repair_publication_placement';
        const cached = await checkIdempotency(tx, {
            projectId: params.projectId,
            actorId: params.actorId,
            command,
            idempotencyKey: params.idempotencyKey
        });
        if (cached) return cached as Record<string, unknown>;

        const content = await tx.contentItem.findFirst({
            where: { id: params.taskId, project_id: params.projectId },
            include: { publication_fact: true }
        });
        const targetChannel = await tx.socialChannel.findFirst({
            where: { id: params.targetChannelId, project_id: params.projectId }
        });
        const blockedItem = await tx.workItem.findFirst({
            where: {
                id: params.blockedWorkItemId,
                project_id: params.projectId,
                content_item_id: params.taskId,
                kind: 'art_direction'
            }
        });
        const blockedDecision = blockedItem ? await tx.artDirectionDecision.findFirst({
            where: {
                project_id: params.projectId,
                content_item_id: params.taskId,
                work_item_id: blockedItem.id,
                decision: 'BLOCKED'
            },
            orderBy: { decision_version: 'desc' }
        }) : null;
        const legacySiteBlogDecision = blockedItem ? await tx.artDirectionDecision.findFirst({
            where: {
                project_id: params.projectId,
                content_item_id: params.taskId,
                work_item_id: blockedItem.id,
                decision: 'GENERATE'
            },
            orderBy: { decision_version: 'desc' }
        }) : null;
        if (!content) throw new Error(`Publication task ${params.taskId} not found for project ${params.projectId}`);
        if (!targetChannel) throw new Error(`Target channel ${params.targetChannelId} not found for project ${params.projectId}`);
        assertCanonicalPublicationPlacement(targetChannel, params.targetPlacement);
        const blockedMismatch = blockedItem ? isPublicationPlacementMismatchEvidence({
            workItemState: blockedItem.state,
            workItemReasonCode: blockedItem.reason_code,
            workItemRevision: blockedItem.input_context_version,
            expectedRevision: params.expectedContentRevision,
            expectedPlacement: params.expectedPlacement,
            decision: blockedDecision
        }) : false;
        const legacyDzen958Mismatch = blockedItem && content && targetChannel
            ? isLegacyDzen958FeedMismatchEvidence({
                projectId: params.projectId,
                taskId: content.id,
                workItemId: blockedItem.id,
                workItemState: blockedItem.state,
                workItemRevision: blockedItem.input_context_version,
                expectedRevision: params.expectedContentRevision,
                currentChannelId: content.channel_id,
                targetChannelId: targetChannel.id,
                currentPlacement: content.visual_placement,
                targetPlacement: params.targetPlacement,
                targetChannelType: targetChannel.type,
                taskStatus: content.status,
                publicationMode: content.publication_mode,
                decision: blockedDecision
            })
            : false;
        const legacySiteBlogMismatch = blockedItem && content && targetChannel
            ? isLegacySiteBlogCoverMismatchEvidence({
                workItemState: blockedItem.state,
                workItemRevision: blockedItem.input_context_version,
                expectedRevision: params.expectedContentRevision,
                currentChannelId: content.channel_id,
                targetChannelId: targetChannel.id,
                currentPlacement: content.visual_placement,
                targetPlacement: params.targetPlacement,
                targetChannelType: targetChannel.type,
                taskStatus: content.status,
                visualState: content.visual_state,
                handoffState: content.handoff_state,
                selectedAssetId: content.selected_asset_id,
                decision: legacySiteBlogDecision
            })
            : false;
        const legacyArticleCoverAliasMismatch = blockedItem && content && targetChannel
            ? isLegacyArticleCoverAliasMismatchEvidence({
                workItemState: blockedItem.state,
                workItemRevision: blockedItem.input_context_version,
                expectedRevision: params.expectedContentRevision,
                currentChannelId: content.channel_id,
                targetChannelId: targetChannel.id,
                currentPlacement: content.visual_placement,
                targetPlacement: params.targetPlacement,
                targetChannelType: targetChannel.type,
                taskStatus: content.status,
                visualState: content.visual_state,
                handoffState: content.handoff_state,
                selectedAssetId: content.selected_asset_id,
                decision: legacySiteBlogDecision
            })
            : false;
        if (!blockedItem || (!blockedMismatch && !legacyDzen958Mismatch && !legacySiteBlogMismatch && !legacyArticleCoverAliasMismatch)) {
            throw new Error('[BLOCKED_INPUT_MISMATCH] Expected immutable channel-placement mismatch evidence');
        }
        const legacyGenerateMismatch = legacySiteBlogMismatch || legacyArticleCoverAliasMismatch;
        const supersededDecision = legacyGenerateMismatch ? legacySiteBlogDecision : blockedDecision;
        if (content.status === 'published' || content.published_link || content.publication_fact?.outcome === 'published') {
            throw new Error('[PUBLICATION_READ_ONLY] Published tasks cannot be repaired');
        }
        if (content.content_revision !== params.expectedContentRevision
            || content.accepted_revision !== params.expectedAcceptedRevision) {
            throw new Error('[CONTENT_REVISION_CONFLICT] Content or accepted revision changed');
        }
        if (content.channel_id !== params.expectedChannelId || content.visual_placement !== params.expectedPlacement) {
            throw new Error('[PLACEMENT_CONFLICT] Channel or placement changed since preview');
        }

        const plan = planPublicationPlacementRepair({
            contentItemId: content.id,
            contentRevision: content.content_revision,
            acceptedRevision: content.accepted_revision,
            currentChannelId: content.channel_id,
            targetChannelId: targetChannel.id,
            currentPlacement: content.visual_placement,
            targetPlacement: params.targetPlacement,
            replacementKeySuffix: legacyArticleCoverAliasMismatch
                ? `contract-recovery:${blockedItem.id}`
                : blockedItem.reason_code === 'missing_feed_asset_contract'
                ? `contract-recovery:${blockedItem.id}`
                : undefined
        });
        const beforeState = {
            channel_id: content.channel_id,
            visual_placement: content.visual_placement,
            content_revision: content.content_revision,
            accepted_revision: content.accepted_revision,
            blocked_work_item_id: blockedItem.id,
            blocked_work_item_state: blockedItem.state
        };
        const repairedProjection = repairMaterializedPublicationProjection({
            assets: content.assets,
            qualityReport: content.quality_report,
            metrics: content.metrics,
            channel: targetChannel,
            placement: plan.placement
        });
        const update = await tx.contentItem.updateMany({
            where: {
                id: content.id,
                project_id: params.projectId,
                content_revision: params.expectedContentRevision,
                accepted_revision: params.expectedAcceptedRevision,
                channel_id: params.expectedChannelId,
                visual_placement: params.expectedPlacement,
                ...(legacyGenerateMismatch ? {
                    status: 'approved', visual_state: 'BRIEFED',
                    handoff_state: 'blocked', selected_asset_id: null
                } : {})
            },
            data: {
                channel_id: plan.channelId,
                visual_placement: plan.placement,
                ...(legacyGenerateMismatch ? { visual_state: 'PENDING_ASSESSMENT', handoff_state: 'blocked' } : {}),
                assets: repairedProjection.assets as Prisma.InputJsonValue,
                quality_report: repairedProjection.qualityReport as Prisma.InputJsonValue,
                metrics: repairedProjection.metrics as Prisma.InputJsonValue
            }
        });
        if (update.count !== 1) throw new Error('[PLACEMENT_CONFLICT] Metadata changed concurrently');

        if (legacyArticleCoverAliasMismatch && supersededDecision) {
            await tx.artDirectionDecision.updateMany({
                where: { id: supersededDecision.id, status: 'active' },
                data: { status: 'stale' }
            });
            await tx.workItem.updateMany({
                where: {
                    project_id: params.projectId,
                    content_item_id: content.id,
                    kind: 'visual_generate',
                    state: { in: ['available', 'claimed', 'waiting_approval'] },
                    result_payload: { path: ['decision_id'], equals: supersededDecision.id }
                },
                data: {
                    state: 'blocked',
                    reason_code: 'superseded_article_cover_alias',
                    note: `Superseded by canonical article_cover repair from decision ${supersededDecision.id}`,
                    lease_token: null,
                    lease_actor_id: null,
                    lease_expires_at: null
                }
            });
        }

        const artDirectionItem = await tx.workItem.upsert({
            where: { dedupe_key: plan.dedupeKey },
            update: {},
            create: {
                project_id: params.projectId,
                week_package_id: content.week_package_id,
                content_item_id: content.id,
                item_key: content.item_key || `content:${content.id}`,
                kind: 'art_direction',
                state: plan.artDirectionState,
                assignee_role: 'art_director',
                input_context_version: plan.inputContextVersion,
                result_version: 0,
                dedupe_key: plan.dedupeKey,
                note: `${plan.note}; supersedes immutable ${legacyGenerateMismatch ? 'legacy article-cover placement' : 'blocker'} decision ${supersededDecision?.id || 'unknown'}`,
                result_payload: placementRepairProvenance({
                    blockedWorkItemId: blockedItem.id,
                    blockedDecisionId: supersededDecision?.id || null,
                    fromChannelId: content.channel_id,
                    fromPlacement: content.visual_placement,
                    kind: legacySiteBlogMismatch
                        ? 'legacy_site_blog_cover'
                        : legacyArticleCoverAliasMismatch
                            ? 'legacy_article_cover_alias'
                            : 'blocked_mismatch'
                }) as Prisma.InputJsonValue
            }
        });
        const afterState = {
            repaired: true,
            task_id: content.id,
            channel_id: plan.channelId,
            channel_type: targetChannel.type,
            visual_placement: plan.placement,
            content_revision: plan.contentRevision,
            accepted_revision: plan.acceptedRevision,
            old_work_item_id: blockedItem.id,
            old_work_item_state: blockedItem.state,
            old_decision_id: supersededDecision?.id || null,
            art_direction_work_item_id: artDirectionItem.id,
            art_direction_state: artDirectionItem.state,
            art_direction_dedupe_key: artDirectionItem.dedupe_key,
            input_context_version: artDirectionItem.input_context_version,
            ...(legacyGenerateMismatch ? { visual_state: 'PENDING_ASSESSMENT' } : {})
        };
        await recordWorkflowEvent(tx, {
            projectId: params.projectId,
            workItemId: artDirectionItem.id,
            weekPackageId: content.week_package_id || undefined,
            contentItemId: content.id,
            actorId: params.actorId,
            command,
            beforeState,
            afterState,
            idempotencyKey: params.idempotencyKey
        });
        return afterState;
    });
}

/**
 * Repairs a materialized publication projection by re-computing assets,
 * quality report, and metrics from the current channel/placement binding.
 */
export async function repairPublicationProjection(params: {
    projectId: number;
    actorId: string;
    taskId: number;
    expectedContentRevision: number;
    expectedAcceptedRevision: number;
    expectedChannelId: number;
    expectedPlacement: string;
    expectedSelectedAssetId: number;
    idempotencyKey: string;
}): Promise<Record<string, unknown>> {
    return prisma.$transaction(async (tx) => {
        await requireProjectOwner(tx, params.projectId, params.actorId);
        const command = 'ba_repair_publication_projection';
        const cached = await checkIdempotency(tx, {
            projectId: params.projectId,
            actorId: params.actorId,
            command,
            idempotencyKey: params.idempotencyKey
        });
        if (cached) return cached as Record<string, unknown>;

        const content = await tx.contentItem.findFirst({
            where: { id: params.taskId, project_id: params.projectId },
            include: { channel: true, selected_asset: true, publication_fact: true }
        });
        if (!content) throw new Error(`Publication task ${params.taskId} not found for project ${params.projectId}`);
        if (!content.channel) throw new Error('[CHANNEL_BINDING_MISSING] Publication task has no current channel');
        if (content.status === 'published' || content.published_link || content.publication_fact?.outcome === 'published') {
            throw new Error('[PUBLICATION_READ_ONLY] Published tasks cannot be repaired');
        }
        if (content.content_revision !== params.expectedContentRevision
            || content.accepted_revision !== params.expectedAcceptedRevision
            || content.accepted_revision !== content.content_revision
            || content.text_state !== 'accepted') {
            throw new Error('[CONTENT_REVISION_CONFLICT] Current accepted revision changed');
        }
        if (content.channel_id !== params.expectedChannelId || content.visual_placement !== params.expectedPlacement) {
            throw new Error('[PROJECTION_BINDING_CONFLICT] Channel or placement changed since inspection');
        }
        if (content.selected_asset_id !== params.expectedSelectedAssetId
            || !content.selected_asset
            || content.selected_asset.status !== 'approved'
            || content.selected_asset.content_revision !== content.accepted_revision) {
            throw new Error('[VISUAL_BINDING_CONFLICT] Approved selected asset changed');
        }
        assertCanonicalPublicationPlacement(content.channel, params.expectedPlacement);

        const beforeAssets = (content.assets || {}) as Record<string, any>;
        const beforeQuality = (content.quality_report || {}) as Record<string, any>;
        const beforeMetrics = (content.metrics || {}) as Record<string, any>;
        const projection = repairMaterializedPublicationProjection({
            assets: beforeAssets,
            qualityReport: beforeQuality,
            metrics: beforeMetrics,
            channel: content.channel,
            placement: params.expectedPlacement
        });
        const bodySha256 = createHash('sha256').update(content.draft_text || '').digest('hex');
        const assetChecksum = ((content.selected_asset.provenance as any)?.planner_storage?.sha256)
            || (content.selected_asset.provenance as any)?.sha256
            || null;
        const beforeState = {
            task_id: content.id,
            channel_id: content.channel_id,
            channel_name: content.channel.name,
            channel_type: content.channel.type,
            visual_placement: content.visual_placement,
            content_revision: content.content_revision,
            accepted_revision: content.accepted_revision,
            body_sha256: bodySha256,
            selected_asset_id: content.selected_asset_id,
            selected_asset_checksum: assetChecksum,
            materialized_account_ref: beforeAssets.account_ref || null,
            handoff_account_ref: beforeQuality.handoff_bundle?.account?.ref || null,
            handoff_channel: beforeQuality.handoff_bundle?.task?.channel || null,
            metrics_account_ref: beforeMetrics.account_ref || null
        };

        const update = await tx.contentItem.updateMany({
            where: {
                id: content.id,
                project_id: params.projectId,
                content_revision: params.expectedContentRevision,
                accepted_revision: params.expectedAcceptedRevision,
                channel_id: params.expectedChannelId,
                visual_placement: params.expectedPlacement,
                selected_asset_id: params.expectedSelectedAssetId
            },
            data: {
                assets: projection.assets as Prisma.InputJsonValue,
                quality_report: projection.qualityReport as Prisma.InputJsonValue,
                metrics: projection.metrics as Prisma.InputJsonValue
            }
        });
        if (update.count !== 1) throw new Error('[PROJECTION_CONFLICT] Publication metadata changed concurrently');

        const afterState = {
            repaired: true,
            task_id: content.id,
            channel_id: content.channel_id,
            channel_name: content.channel.name,
            channel_type: content.channel.type,
            visual_placement: content.visual_placement,
            content_revision: content.content_revision,
            accepted_revision: content.accepted_revision,
            body_sha256: bodySha256,
            selected_asset_id: content.selected_asset_id,
            selected_asset_checksum: assetChecksum,
            materialized_account_ref: projection.assets.account_ref,
            handoff_account_ref: projection.qualityReport.handoff_bundle?.account?.ref || null,
            handoff_channel: projection.qualityReport.handoff_bundle?.task?.channel || null,
            handoff_action_type: projection.qualityReport.handoff_bundle?.task?.action_type || null,
            metrics_account_ref: projection.metrics.account_ref,
            poll_configuration_mode: projection.qualityReport.handoff_bundle?.placement_contract?.poll?.configuration_mode || null
        };
        await recordWorkflowEvent(tx, {
            projectId: params.projectId,
            weekPackageId: content.week_package_id || undefined,
            contentItemId: content.id,
            actorId: params.actorId,
            command,
            beforeState,
            afterState,
            idempotencyKey: params.idempotencyKey
        });
        return afterState;
    });
}

/**
 * Recovers a missing content review by creating a review work item
 * and resetting the content item to a reviewable state.
 */
export async function recoverMissingContentReview(params: {
    projectId: number;
    actorId: string;
    taskId: number;
    expectedContentRevision: number;
    idempotencyKey: string;
    evidenceRequirement?: string;
}): Promise<Record<string, unknown>> {
    return prisma.$transaction(async (tx) => {
        await requireProjectOwner(tx, params.projectId, params.actorId);
        const command = 'ba_recover_missing_content_review';
        const cached = await checkIdempotency(tx, {
            projectId: params.projectId,
            actorId: params.actorId,
            command,
            idempotencyKey: params.idempotencyKey
        });
        if (cached) return cached as Record<string, unknown>;

        const content = await tx.contentItem.findFirst({
            where: { id: params.taskId, project_id: params.projectId }
        });
        if (!content) throw new Error(`Publication task ${params.taskId} not found for project ${params.projectId}`);
        if (content.content_revision !== params.expectedContentRevision) {
            throw new Error(`[CONTENT_REVISION_CONFLICT] Expected revision ${params.expectedContentRevision}; current revision is ${content.content_revision}`);
        }
        if (!content.draft_text?.trim()) throw new Error('[CONTENT_BODY_MISSING] Cannot create review for empty content');
        if (content.accepted_revision !== null || content.text_state === 'accepted') {
            throw new Error('[CONTENT_ALREADY_ACCEPTED] Missing-review recovery cannot invalidate accepted content');
        }
        if (['published', 'cancelled', 'removed'].includes(content.status)) {
            throw new Error(`[CONTENT_TERMINAL] Missing-review recovery is not allowed for status ${content.status}`);
        }

        const lifecycle = planMissingContentReviewRecovery({
            contentRevision: content.content_revision,
            acceptedRevision: content.accepted_revision,
            textState: content.text_state
        });
        const existingReview = await tx.workItem.findFirst({
            where: { content_item_id: content.id, project_id: params.projectId, kind: 'content_review' },
            orderBy: { updated_at: 'desc' }
        });
        const beforeState = {
            task_status: content.status,
            content_revision: content.content_revision,
            accepted_revision: content.accepted_revision,
            text_state: content.text_state,
            handoff_state: content.handoff_state,
            work_item_id: existingReview?.id || null
        };

        await tx.contentItem.update({
            where: { id: content.id },
            data: {
                status: lifecycle.taskStatus,
                text_state: lifecycle.textState,
                accepted_revision: lifecycle.acceptedRevision,
                handoff_state: lifecycle.handoffState
            }
        });

        const review = existingReview || await tx.workItem.upsert({
            where: { dedupe_key: `content-review-recovery:${content.id}:${content.content_revision}` },
            update: {},
            create: {
                project_id: params.projectId,
                week_package_id: content.week_package_id,
                content_item_id: content.id,
                item_key: content.item_key || `content:${content.id}`,
                kind: 'content_review',
                state: lifecycle.reviewState,
                assignee_role: 'content_reviewer',
                input_context_version: lifecycle.reviewInputContextVersion,
                result_version: lifecycle.reviewResultVersion,
                dedupe_key: `content-review-recovery:${content.id}:${content.content_revision}`,
                note: params.evidenceRequirement || 'Review required before acceptance'
            }
        });
        const afterState = {
            recovered: !existingReview,
            task_id: content.id,
            task_status: lifecycle.taskStatus,
            content_revision: lifecycle.contentRevision,
            accepted_revision: lifecycle.acceptedRevision,
            text_state: lifecycle.textState,
            handoff_state: lifecycle.handoffState,
            work_item_id: review.id,
            review_state: review.state,
            review_result_version: review.result_version
        };
        await recordWorkflowEvent(tx, {
            projectId: params.projectId,
            workItemId: review.id,
            weekPackageId: content.week_package_id || undefined,
            contentItemId: content.id,
            actorId: params.actorId,
            command,
            beforeState,
            afterState,
            idempotencyKey: params.idempotencyKey
        });
        return afterState;
    });
}

/**
 * Recovers a content review work item by resetting its state
 * and optionally creating a replacement review if the original was superseded.
 */
export async function recoverContentReview(params: {
    projectId: number;
    actorId: string;
    taskId: number;
    workItemId: number;
    expectedContentRevision: number;
    idempotencyKey: string;
    evidence?: string;
}): Promise<Record<string, unknown>> {
    return prisma.$transaction(async (tx) => {
        await requireProjectOwner(tx, params.projectId, params.actorId);
        const command = 'ba_recover_content_review';
        const cached = await checkIdempotency(tx, {
            projectId: params.projectId,
            actorId: params.actorId,
            command,
            idempotencyKey: params.idempotencyKey
        });
        if (cached) return cached as Record<string, unknown>;

        const content = await tx.contentItem.findFirst({
            where: { id: params.taskId, project_id: params.projectId }
        });
        const review = await tx.workItem.findFirst({
            where: {
                id: params.workItemId,
                project_id: params.projectId,
                content_item_id: params.taskId,
                kind: 'content_review'
            }
        });
        if (!content) throw new Error(`Publication task ${params.taskId} not found for project ${params.projectId}`);
        if (!review) throw new Error(`Content review work item ${params.workItemId} not found for publication task ${params.taskId}`);
        if (content.content_revision !== params.expectedContentRevision) {
            throw new Error(`[CONTENT_REVISION_CONFLICT] Expected revision ${params.expectedContentRevision}; current revision is ${content.content_revision}`);
        }

        const currentApproval = await tx.approvalDecision.findUnique({
            where: {
                work_item_id_result_version: {
                    work_item_id: review.id,
                    result_version: content.content_revision
                }
            }
        });
        const lifecycle = planContentReviewRecovery({
            contentRevision: content.content_revision,
            acceptedRevision: content.accepted_revision,
            textState: content.text_state,
            reviewResultVersion: review.result_version,
            currentRevisionAlreadyApproved: currentApproval?.decision === 'approved'
        });
        const beforeState = {
            content_revision: content.content_revision,
            accepted_revision: content.accepted_revision,
            text_state: content.text_state,
            review_result_version: review.result_version,
            review_state: review.state
        };

        if (lifecycle.needsRecovery) {
            await tx.contentItem.update({
                where: { id: content.id },
                data: {
                    text_state: lifecycle.textState,
                    accepted_revision: lifecycle.acceptedRevision
                }
            });
            if (lifecycle.replacementReviewRequired) {
                await tx.workItem.update({
                    where: { id: review.id },
                    data: {
                        state: 'completed',
                        lease_token: null,
                        lease_expires_at: null,
                        lease_actor_id: null,
                        note: `Superseded after approval collision for content revision ${content.content_revision}`
                    }
                });
            } else {
                await tx.workItem.update({
                    where: { id: review.id },
                    data: {
                        state: lifecycle.reviewState,
                        input_context_version: content.content_revision,
                        result_version: lifecycle.reviewResultVersion,
                        result_payload: {
                            recovered_content_revision: content.content_revision,
                            body: content.draft_text,
                            evidence: params.evidence || null
                        },
                        lease_token: null,
                        lease_expires_at: null,
                        lease_actor_id: null,
                        note: params.evidence || `Recovered review result for content revision ${content.content_revision}`
                    }
                });
            }
        }

        const replacementReview = lifecycle.replacementReviewRequired
            ? await tx.workItem.upsert({
                where: { dedupe_key: `content-review-recovery:${content.id}:${content.content_revision}:${review.id}` },
                update: {},
                create: {
                    project_id: params.projectId,
                    week_package_id: review.week_package_id,
                    content_item_id: content.id,
                    item_key: review.item_key,
                    kind: 'content_review',
                    state: 'available',
                    assignee_role: 'content_reviewer',
                    input_context_version: content.content_revision,
                    result_version: Math.max(0, content.content_revision - 1),
                    dedupe_key: `content-review-recovery:${content.id}:${content.content_revision}:${review.id}`,
                    note: params.evidence || `Fresh review required for content revision ${content.content_revision}`
                }
            })
            : review;

        const afterState = {
            recovered: lifecycle.needsRecovery,
            task_id: content.id,
            content_revision: content.content_revision,
            accepted_revision: lifecycle.acceptedRevision,
            text_state: lifecycle.textState,
            work_item_id: replacementReview.id,
            superseded_work_item_id: lifecycle.replacementReviewRequired ? review.id : null,
            review_result_version: replacementReview.result_version,
            review_state: replacementReview.state
        };
        await recordWorkflowEvent(tx, {
            projectId: params.projectId,
            workItemId: replacementReview.id,
            weekPackageId: review.week_package_id || undefined,
            contentItemId: content.id,
            actorId: params.actorId,
            command,
            beforeState,
            afterState,
            idempotencyKey: params.idempotencyKey
        });
        return afterState;
    });
}

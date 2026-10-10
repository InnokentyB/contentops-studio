import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import dzenService from './dzen.service';
import publicationFactService from './publication_fact.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import { DZEN1045, type Dzen1045DraftProof } from './dzen_task1045_resume_contract';

const COMMAND = 'ba_reconcile_or_resume_dzen_task1045_draft';

function object(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}

function assertArgs(args: { projectId: number; taskId: number; actorId: string;
    expectedAttemptIdempotencyKey: string; idempotencyKey: string; confirm?: boolean }) {
    if (args.projectId !== 10 || args.taskId !== 1045
        || args.expectedAttemptIdempotencyKey !== DZEN1045.originalKey
        || args.idempotencyKey !== DZEN1045.resumeKey) throw new Error('[DZEN1045_RESUME_SCOPE_MISMATCH]');
    const actor = /^user:(\d+)$/.exec(args.actorId);
    if (!actor) throw new Error('[OWNER_REQUIRED]');
    return Number(actor[1]);
}

function assertTask(task: Awaited<ReturnType<typeof loadTask>>) {
    const delivery = object(object(task?.quality_report).publication_task_delivery);
    const storage = object(object(task?.selected_asset?.provenance).planner_storage);
    if (!task || task.channel_id !== 116 || task.channel?.type !== 'dzen'
        || task.status !== 'publishing' || task.publication_mode !== 'owner_released'
        || task.content_revision !== 4 || task.accepted_revision !== 4 || task.text_state !== 'accepted'
        || task.title !== DZEN1045.title || task.visual_placement !== 'article_cover'
        || task.visual_state !== 'APPROVED' || task.visual_decision_version !== 1
        || task.selected_asset_id !== 129 || task.selected_asset?.status !== 'approved'
        || task.selected_asset.content_revision !== 4 || storage.sha256 !== DZEN1045.assetSha
        || createHash('sha256').update(task.draft_text || '').digest('hex') !== DZEN1045.bodySha
        || task.publication_fact || task.published_link
        || delivery.state !== 'provider_result_uncertain' || delivery.idempotency_key !== DZEN1045.originalKey
        || delivery.retry_via_api !== false || delivery.failed_at !== DZEN1045.failedAt
        || typeof delivery.error !== 'string' || !delivery.error.includes(`[${DZEN1045.errorCode}]`)) {
        throw new Error('[DZEN1045_RESUME_GUARD_FAILED] Exact frozen pre-submit incident changed');
    }
    return { task, delivery };
}

function loadTask() {
    return prisma.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
        include: { channel: true, selected_asset: true, publication_fact: true } });
}

export async function reconcileOrResumeDzenTask1045Draft(args: { projectId: number; taskId: number;
    actorId: string; expectedAttemptIdempotencyKey: string; idempotencyKey: string; confirm?: boolean }) {
    const userId = assertArgs(args);
    const member = await prisma.projectMember.findUnique({ where: { project_id_user_id: {
        project_id: 10, user_id: userId
    } } });
    if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    const prior = await prisma.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
        command: COMMAND, idempotency_key: DZEN1045.resumeKey }, orderBy: { id: 'desc' } });
    if (prior) throw new Error('[DZEN1045_RESUME_ALREADY_CLAIMED] Read fact/reconciliation; never click again');
    const current = assertTask(await loadTask());
    const claim = await prisma.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
        command: 'ba_publish_dzen_task1045_claim', idempotency_key: DZEN1045.originalKey }, orderBy: { id: 'desc' } });
    if (!claim || object(claim.after_state).status !== 'publishing'
        || object(claim.after_state).channel_id !== 116) throw new Error('[DZEN1045_ORIGINAL_CLAIM_REQUIRED]');
    const config = resolveEffectiveChannelConfig('dzen', current.task.channel?.config || {});
    if (String(config.channel_id || '') !== DZEN1045.publisherId) throw new Error('[DZEN1045_PUBLISHER_ID_MISMATCH]');
    let claimed = false;
    try {
        const result = await dzenService.resumeTask1045Draft(config, current.task.draft_text || '', {
            confirm: args.confirm === true, idempotencyKey: args.idempotencyKey
        }, async (proof: Dzen1045DraftProof) => {
            const changed = await prisma.$transaction(async tx => {
                const owner = await tx.projectMember.findUnique({ where: { project_id_user_id: {
                    project_id: 10, user_id: userId
                } } });
                const latest = await tx.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
                    include: { channel: true, selected_asset: true, publication_fact: true } });
                if (owner?.role !== 'owner') return false;
                const guarded = assertTask(latest);
                if (await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
                    command: COMMAND, idempotency_key: DZEN1045.resumeKey } })) return false;
                const updated = await tx.contentItem.updateMany({ where: { id: 1045, project_id: 10,
                    channel_id: 116, status: 'publishing', publication_mode: 'owner_released',
                    content_revision: 4, accepted_revision: 4, selected_asset_id: 129,
                    quality_report: { equals: latest!.quality_report || {} }, publication_fact: { is: null },
                    published_link: null }, data: { quality_report: { ...object(latest!.quality_report),
                    publication_task_delivery: { ...guarded.delivery, state: 'existing_draft_resume_started',
                        draft_id: proof.draftId, resume_started_at: new Date().toISOString(),
                        retry_via_api: false, final_submit_count: 0 }
                } as Prisma.InputJsonValue } });
                if (updated.count !== 1) return false;
                await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
                    actor_id: args.actorId, command: COMMAND, idempotency_key: DZEN1045.resumeKey,
                    before_state: ({ original_claim_event_id: claim.id,
                        publication_task_delivery: guarded.delivery } as Prisma.InputJsonValue),
                    after_state: { state: 'existing_draft_resume_started', proof,
                        body_sha256: DZEN1045.bodySha, asset_sha256: DZEN1045.assetSha,
                        original_idempotency_key: DZEN1045.originalKey } as Prisma.InputJsonValue } });
                return true;
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
            claimed = changed;
            return changed;
        });
        if (result.mode === 'preview') return { ...result, published: false, original_claim_event_id: claim.id };
        const publication = result.result;
        await prisma.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
            actor_id: args.actorId, command: 'dzen1045_existing_draft_provider_confirmed',
            idempotency_key: DZEN1045.resumeKey, after_state: publication as Prisma.InputJsonValue } });
        const fact = await publicationFactService.record({ projectId: 10, taskId: 1045, actorId: args.actorId,
            artifactKind: 'article', outcome: 'published', publicUrl: publication.public_url,
            providerObjectId: publication.provider_object_id, publishedAt: publication.published_at,
            confirmationMode: 'automatic', evidence: { type: 'public_url', ref: publication.public_url },
            utmStatus: 'not_applicable', note: 'Resumed exact existing task1045 draft; no content rebuild or resend.' });
        return { ...result, publication_fact_id: fact.publication_fact.id };
    } catch (error: unknown) {
        if (claimed) await prisma.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
            actor_id: args.actorId, command: 'dzen1045_existing_draft_resume_requires_reconciliation',
            idempotency_key: DZEN1045.resumeKey, after_state: { state: 'uncertain', retry_via_api: false,
                final_submit_may_have_been_attempted: true } } });
        throw error;
    }
}

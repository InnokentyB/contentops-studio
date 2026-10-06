import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import publisher from './puppeteer_publisher.service';
import facts from './publication_fact.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import { DZEN999 } from './dzen_task999_resume_contract';

const command = 'ba_resume_dzen_task999_existing_draft';
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
    ? v as Record<string, unknown> : {};

export async function resumeDzenTask999(args: { projectId: number; taskId: number; actorId: string;
    idempotencyKey: string; confirm?: boolean }) {
    if (args.projectId !== 10 || args.taskId !== 999 || args.idempotencyKey !== DZEN999.key) {
        throw new Error('[DZEN999_ORIGINAL_PACKAGE_REQUIRED]');
    }
    const user = /^user:(\d+)$/.exec(args.actorId);
    if (!user) throw new Error('[OWNER_REQUIRED]');
    const member = await prisma.projectMember.findUnique({ where: {
        project_id_user_id: { project_id: 10, user_id: Number(user[1]) }
    } });
    if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    const prior = await prisma.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 999,
        command, idempotency_key: DZEN999.key }, orderBy: { id: 'desc' } });
    if (prior) throw new Error('[DZEN999_RESUME_ALREADY_CLAIMED] Read publication fact; never repeat resume');
    const task = await prisma.contentItem.findFirst({ where: { id: 999, project_id: 10 },
        include: { channel: true, selected_asset: true, publication_fact: true } });
    const delivery = object(object(task?.quality_report).publication_task_delivery);
    const storage = object(object(task?.selected_asset?.provenance).planner_storage);
    if (!task || task.channel_id !== 116 || task.content_revision !== 2 || task.accepted_revision !== 2
        || task.text_state !== 'accepted' || task.status !== 'publishing' || task.publication_mode !== 'owner_released'
        || task.title !== DZEN999.title || task.visual_placement !== 'article_cover' || task.visual_state !== 'APPROVED'
        || task.selected_asset_id !== 114 || task.selected_asset?.status !== 'approved'
        || task.selected_asset.content_revision !== 2 || storage.sha256 !== DZEN999.assetSha
        || task.schedule_at?.toISOString() !== '2026-10-06T10:00:00.000Z'
        || task.publish_at?.toISOString() !== '2026-10-06T10:00:00.000Z'
        || createHash('sha256').update(task.draft_text || '').digest('hex') !== DZEN999.bodySha
        || task.publication_fact || task.published_link || delivery.state !== 'provider_result_uncertain'
        || delivery.idempotency_key !== DZEN999.key || delivery.retry_via_api !== false) {
        throw new Error('[DZEN999_RESUME_GUARD_FAILED]');
    }
    const original = await prisma.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 999,
        command: 'ba_publish_dzen_task999_claim', idempotency_key: DZEN999.key } });
    if (!original || object(original.after_state).channel_id !== 116) throw new Error('[DZEN999_ORIGINAL_CLAIM_REQUIRED]');
    let claimed = false;
    try {
        const result = await publisher.resumeDzen999(resolveEffectiveChannelConfig('dzen', task.channel?.config || {}),
            task.draft_text || '', { confirm: args.confirm === true, idempotencyKey: args.idempotencyKey }, async proof => {
                const changed = await prisma.$transaction(async tx => {
                    const owner = await tx.projectMember.findUnique({ where: {
                        project_id_user_id: { project_id: 10, user_id: Number(user[1]) }
                    } });
                    const decision = await tx.artDirectionDecision.findFirst({ where: {
                        id: 241, project_id: 10, content_item_id: 999, source_content_revision: 2, status: 'active'
                    } });
                    if (owner?.role !== 'owner' || !decision) return false;
                    const updated = await tx.contentItem.updateMany({ where: {
                        id: 999, project_id: 10, channel_id: 116, content_revision: 2, accepted_revision: 2,
                        status: 'publishing', publication_mode: 'owner_released', selected_asset_id: 114,
                        visual_state: 'APPROVED', title: DZEN999.title, draft_text: task.draft_text,
                        text_state: 'accepted', visual_placement: 'article_cover',
                        schedule_at: task.schedule_at, publish_at: task.publish_at,
                        published_link: null, publication_fact: { is: null },
                        selected_asset: { is: { status: 'approved', content_revision: 2,
                            provenance: { equals: task.selected_asset?.provenance || {} } } },
                        quality_report: { equals: task.quality_report || {} }
                    }, data: { quality_report: { ...object(task.quality_report), publication_task_delivery: {
                        ...delivery, state: 'existing_draft_resume_started', draft_id: DZEN999.draftId,
                        resume_started_at: new Date().toISOString(), retry_via_api: false
                    } } } });
                    if (updated.count !== 1) return false;
                    await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 999,
                        actor_id: args.actorId, command, idempotency_key: DZEN999.key,
                        before_state: { original_claim_id: original.id, quality_report: task.quality_report },
                        after_state: { proof, state: 'existing_draft_resume_started', body_sha256: DZEN999.bodySha,
                            selected_asset_id: 114, asset_sha256: DZEN999.assetSha }
                    } });
                    return true;
                }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
                claimed = changed;
                return changed;
            });
        if (result.mode === 'preview') return result;
        const publication = result.result;
        await prisma.workflowEvent.create({ data: { project_id: 10, content_item_id: 999,
            actor_id: args.actorId, command: 'dzen999_existing_draft_provider_confirmed',
            idempotency_key: DZEN999.key, after_state: publication
        } });
        await facts.record({ projectId: 10, taskId: 999, actorId: args.actorId, artifactKind: 'post', outcome: 'published',
            publicUrl: publication.public_url!, providerObjectId: DZEN999.draftId,
            publishedAt: publication.published_at!, confirmationMode: 'automatic',
            evidence: { type: 'public_url', ref: publication.public_url! },
            note: `Resumed original ${DZEN999.key} exact draft; cover SHA and public body verified` });
        return result;
    } catch (error: unknown) {
        if (claimed) await prisma.workflowEvent.create({ data: {
            project_id: 10, content_item_id: 999, actor_id: args.actorId,
            command: 'dzen999_resume_requires_reconciliation', idempotency_key: DZEN999.key,
            after_state: { state: 'uncertain', draft_id: DZEN999.draftId, retry_via_api: false }
        } });
        throw error;
    }
}

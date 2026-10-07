import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { visualMetadataFromProvenance } from './visual_asset_binding.service';

type Args = { projectId: number; taskId: number; actorId: string; dryRun?: boolean;
    expectedBodySha256?: string; idempotencyKey?: string; approvalReference?: string };
const ASSET_SHA = '8032717b6898e1dd915e585a481aa27696d7aa383b0a51277a4e912f89caeca1';

/** Exact internal hold only. Never clears leases, changes attempts, or contacts VK. */
export async function holdVkTask1084(args: Args, database: typeof prisma = prisma) {
    if (args.projectId !== 10 || args.taskId !== 1084) throw new Error('[TASK1084_SCOPE_MISMATCH]');
    const actor = /^user:(\d+)$/.exec(args.actorId);
    if (!actor) throw new Error('[OWNER_REQUIRED]');
    return database.$transaction(async tx => {
        const owner = await tx.projectMember.findUnique({ where: { project_id_user_id: {
            project_id: 10, user_id: Number(actor[1])
        } } });
        if (owner?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        const task = await tx.contentItem.findFirst({ where: { id: 1084, project_id: 10 },
            include: { channel: true, selected_asset: true, publication_fact: true } });
        const metadata = visualMetadataFromProvenance(task?.selected_asset?.provenance);
        if (!task || task.channel_id !== 117 || task.channel?.type !== 'vk'
            || task.channel.name !== 'analystcraft_vk_group' || task.visual_placement !== 'feed'
            || task.content_revision !== 1 || task.accepted_revision !== 1 || task.text_state !== 'accepted'
            || task.visual_state !== 'APPROVED' || task.selected_asset_id !== 118
            || task.selected_asset?.status !== 'approved' || task.selected_asset.content_revision !== 1
            || task.selected_asset.decision_id !== 246 || metadata.sha256 !== ASSET_SHA
            || metadata.mime_type !== 'video/mp4' || task.publication_fact || task.published_link) {
            throw new Error('[TASK1084_PACKAGE_CHANGED]');
        }
        const bodyHash = createHash('sha256').update(task.draft_text || '').digest('hex');
        // Explicit projections exclude lease tokens, provider errors, payloads and credentials.
        const [workItems, attempts] = await Promise.all([
            tx.workItem.findMany({ where: { project_id: 10, content_item_id: 1084, kind: 'browser_publish' },
                select: { id: true, state: true, lease_expires_at: true, result_version: true, input_context_version: true } }),
            tx.deliveryAttempt.findMany({ where: { project_id: 10, content_item_id: 1084 },
                select: { id: true, status: true, created_at: true, actual_published_at: true } })
        ]);
        const activeLease = workItems.some(w => w.state === 'claimed'
            && (!w.lease_expires_at || w.lease_expires_at.getTime() > Date.now()));
        const result = { project_id: 10, task_id: 1084, body_sha256: bodyHash,
            accepted_revision: 1, channel_id: 117, selected_asset_id: 118, asset_sha256: ASSET_SHA,
            status: task.status, handoff_state: task.handoff_state, work_items: workItems, attempts,
            active_lease: activeLease, attempt_absence_confirmed: attempts.length === 0,
            publication_fact: null, held: false,
            blockers: ['BROWSER_POLICY_DENIED', 'VK_NATIVE_VIDEO_ADAPTER_UNSUPPORTED'] };
        if (args.dryRun !== false) return result;
        if (!args.idempotencyKey?.trim() || !args.approvalReference?.trim()) throw new Error('[AUDIT_REFERENCE_REQUIRED]');
        if (args.expectedBodySha256 !== bodyHash) throw new Error('[BODY_SHA_MISMATCH]');
        const command = 'ba_hold_vk_task1084';
        const requestHash = createHash('sha256').update(JSON.stringify(args)).digest('hex');
        const prior = await tx.workflowEvent.findFirst({ where: {
            project_id: 10, actor_id: args.actorId, command, idempotency_key: args.idempotencyKey
        } });
        if (prior?.after_state) {
            if ((prior.before_state as Record<string, unknown>)?.request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...(prior.after_state as Record<string, unknown>), replayed: true };
        }
        if (activeLease || task.status === 'publishing') throw new Error('[PUBLICATION_OPERATION_ACTIVE_OR_UNCERTAIN]');
        const report = (task.quality_report as Record<string, Prisma.InputJsonValue> | null) || {};
        const changed = await tx.contentItem.updateMany({ where: {
            id: 1084, project_id: 10, updated_at: task.updated_at, channel_id: 117,
            content_revision: 1, accepted_revision: 1, selected_asset_id: 118
        }, data: { status: 'blocked', handoff_state: 'blocked', quality_report: { ...report,
            publication_hold: { blockers: result.blockers, actor_id: args.actorId,
                approval_reference: args.approvalReference, content_revision: 1, body_sha256: bodyHash,
                provider_attempts_present: attempts.length > 0, held_at: new Date().toISOString() }
        } } });
        if (changed.count !== 1) throw new Error('[TASK1084_HOLD_CAS_CONFLICT]');
        const held = { ...result, status: 'blocked', handoff_state: 'blocked', held: true };
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1084,
            actor_id: args.actorId, command, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: requestHash, status: task.status, handoff_state: task.handoff_state },
            after_state: JSON.parse(JSON.stringify(held)) as Prisma.InputJsonValue } });
        return held;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

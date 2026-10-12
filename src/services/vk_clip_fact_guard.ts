import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { assertApprovedVkClipAsset } from './publication_plan/handoff';

/** Internal browser confirmation proof; never accepted by the generic public fact tool. */
export interface VkClipFactGuard {
    channelId: number;
    expectedOwnerId: string;
    workItemId: number;
    leaseToken: string;
    approvalReference: string;
    idempotencyKey: string;
    contentRevision: number;
    textSha256: string;
    titleSha256?: string | null;
    imageSha256: string;
    selectedAssetId: number;
    attemptId: number;
    expectedUpdatedAt: string;
}

interface FactIdentity { projectId: number; taskId: number; actorId: string }
function object(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}
function hash(body: string): string {
    return createHash('sha256').update(body.trim()).digest('hex');
}
function reject(): never { throw new Error('[VK_CLIP_FACT_GUARD_FAILED] Exact clip confirmation changed'); }
function cas(count: number): void {
    if (count !== 1) throw new Error('[VK_CLIP_FACT_CAS_CONFLICT] Clip confirmation snapshot changed');
}

/** Rechecks and locks the provider-bound clip snapshot in the fact's Serializable transaction. */
export async function guardVkClipFactWrite(
    tx: Prisma.TransactionClient, identity: FactIdentity, guard: VkClipFactGuard
): Promise<void> {
    const now = new Date();
    const task = await tx.contentItem.findFirst({
        where: { id: identity.taskId, project_id: identity.projectId },
        select: { id: true, project_id: true, channel_id: true, status: true, publication_mode: true,
            visual_placement: true, visual_state: true, content_revision: true, accepted_revision: true, text_state: true,
            selected_asset_id: true, draft_text: true, title: true, updated_at: true, published_link: true,
            publication_fact: { select: { id: true } }, channel: { select: { id: true, type: true, is_active: true, config: true, updated_at: true } } }
    });
    if (!task || task.channel_id !== guard.channelId || task.channel?.type !== 'vk' || !task.channel.is_active
        || task.status !== 'publishing' || task.publication_mode !== 'browser_required'
        || String(object(task.channel.config).vk_id || '') !== guard.expectedOwnerId || !/^-[1-9]\d*$/.test(guard.expectedOwnerId)
        || task.visual_state !== 'APPROVED' || task.visual_placement !== 'clip' || task.content_revision !== guard.contentRevision
        || task.accepted_revision !== guard.contentRevision || task.text_state !== 'accepted'
        || task.selected_asset_id !== guard.selectedAssetId || task.publication_fact || task.published_link
        || task.updated_at.toISOString() !== guard.expectedUpdatedAt || hash(task.draft_text || '') !== guard.textSha256
        || (guard.titleSha256 && hash(task.title || '') !== guard.titleSha256)) reject();
    const work = await tx.workItem.findFirst({
        where: { id: guard.workItemId, project_id: identity.projectId, content_item_id: identity.taskId },
        select: { id: true, kind: true, assignee_role: true, state: true, lease_token: true,
            lease_actor_id: true, lease_expires_at: true, result_payload: true, updated_at: true }
    });
    const release = object(work?.result_payload);
    if (!work || work.kind !== 'browser_publish' || work.assignee_role !== 'browser_publisher'
        || work.state !== 'claimed' || work.lease_token !== guard.leaseToken || work.lease_actor_id !== identity.actorId
        || !work.lease_expires_at || work.lease_expires_at <= now || release.publication_authorized !== true
        || release.approval_reference !== guard.approvalReference || release.content_revision !== guard.contentRevision
        || release.body_sha256 !== guard.textSha256 || release.asset_sha256 !== guard.imageSha256
        || release.selected_asset_id !== guard.selectedAssetId || release.placement !== 'clip'
        || release.channel_id !== guard.channelId || (guard.titleSha256 && release.title_sha256 !== guard.titleSha256)) reject();
    const asset = await tx.imageAsset.findFirst({
        where: { id: guard.selectedAssetId, project_id: identity.projectId, content_item_id: identity.taskId },
        select: { id: true, status: true, content_revision: true, provenance: true, file_url: true, updated_at: true }
    });
    const provenance = object(asset?.provenance);
    const assetHash = object(provenance.planner_storage).sha256 ?? provenance.sha256;
    if (!asset || asset.status !== 'approved' || asset.content_revision !== guard.contentRevision
        || assetHash !== guard.imageSha256) reject();
    assertApprovedVkClipAsset({ ...task, selected_asset: asset });
    const attempt = await tx.deliveryAttempt.findFirst({
        where: { id: guard.attemptId, project_id: identity.projectId, content_item_id: identity.taskId,
            channel_id: guard.channelId, idempotency_key: guard.idempotencyKey, status: 'pending' },
        select: { id: true, status: true, updated_at: true }
    });
    if (!attempt || attempt.status !== 'pending') reject();
    // No-op CAS writes acquire row locks; explicit timestamps preserve the original snapshot.
    cas((await tx.socialChannel.updateMany({ where: { id: task.channel.id, project_id: identity.projectId,
        type: 'vk', is_active: true, updated_at: task.channel.updated_at },
        data: { updated_at: task.channel.updated_at } })).count);
    cas((await tx.contentItem.updateMany({ where: { id: task.id, project_id: identity.projectId,
        status: 'publishing', publication_mode: 'browser_required', updated_at: task.updated_at,
        content_revision: guard.contentRevision, accepted_revision: guard.contentRevision, selected_asset_id: guard.selectedAssetId },
        data: { status: 'publishing', updated_at: task.updated_at } })).count);
    cas((await tx.workItem.updateMany({ where: { id: work.id, project_id: identity.projectId,
        content_item_id: identity.taskId, state: 'claimed', updated_at: work.updated_at,
        lease_token: guard.leaseToken, lease_actor_id: identity.actorId, lease_expires_at: { gt: now } },
        data: { state: 'claimed', updated_at: work.updated_at } })).count);
    cas((await tx.imageAsset.updateMany({ where: { id: asset.id, project_id: identity.projectId,
        content_item_id: identity.taskId, status: 'approved', content_revision: guard.contentRevision, updated_at: asset.updated_at },
        data: { status: 'approved', updated_at: asset.updated_at } })).count);
    cas((await tx.deliveryAttempt.updateMany({ where: { id: attempt.id, project_id: identity.projectId,
        content_item_id: identity.taskId, channel_id: guard.channelId, idempotency_key: guard.idempotencyKey,
        status: 'pending', updated_at: attempt.updated_at }, data: { status: 'pending', updated_at: attempt.updated_at } })).count);
}

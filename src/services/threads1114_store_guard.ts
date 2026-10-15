import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import { assertThreads1114Snapshot, THREADS1114 as p } from './threads1114_contract';
import type { Threads1114Request } from './threads1114_execution';
export function object(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
export function requestHash(a: Threads1114Request, operation: string) {
    return hash(JSON.stringify({ package: p, operation, projectId: a.projectId, taskId: a.taskId,
        actorId: a.actorId, expectedManifestChecksum: a.expectedManifestChecksum,
        approvalReference: a.approvalReference, idempotencyKey: a.idempotencyKey, releaseIdempotencyKey: a.releaseIdempotencyKey }));
}
export async function ownerOnly(tx: Prisma.TransactionClient, a: Threads1114Request) {
    const match = /^user:([1-9]\d*)$/.exec(a.actorId);
    if (!match) throw new Error('[OWNER_REQUIRED]');
    const member = await tx.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: Number(match[1]) } } });
    if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    return Number(match[1]);
}
export async function ownerManifest(tx: Prisma.TransactionClient, a: Threads1114Request) {
    const userId = await ownerOnly(tx, a);
    const manifest = await loadAgentWorkspaceManifest(10, userId);
    if (a.expectedManifestChecksum !== p.manifest || manifest.checksum !== p.manifest || manifest.project.slug !== 'analystcraft-2') throw new Error('[STALE_MANIFEST]');
}
/** Exact release proof is not transferable between owner principals or release operations. */
export function validRelease1114(a: Threads1114Request, release: { after_state?: unknown; before_state?: unknown } | null) {
    const proof = object(release?.after_state);
    return proof.publication_authorized === true && proof.body_sha256 === p.bodySha256
        && proof.actor_id === a.actorId && proof.release_idempotency_key === a.releaseIdempotencyKey
        && proof.manifest_checksum === p.manifest && proof.channel_id === 138 && proof.accepted_revision === 1
        && proof.threads_user_id === p.userId && proof.schedule_at === p.schedule && proof.publish_at === p.schedule
        && proof.decision_id === 309 && proof.selected_asset_id === null
        && object(release?.before_state).approval_reference === a.approvalReference;
}
export async function checked1114(tx: Prisma.TransactionClient, a: Threads1114Request,
    released: boolean, attemptId?: number) {
    await ownerManifest(tx, a);
    const task = await tx.contentItem.findFirst({ where: { id: 1114, project_id: 10 },
        include: { channel: true, publication_fact: true, selected_asset: true } });
    const [decision, review, art, attempt, browserWork, release] = await Promise.all([
        tx.artDirectionDecision.findFirst({ where: { id: 309, project_id: 10, content_item_id: 1114, status: 'active' } }),
        tx.workItem.findFirst({ where: { id: 1898, project_id: 10, content_item_id: 1114, kind: 'content_review',
            state: 'completed', input_context_version: 1, result_version: 2 } }),
        tx.workItem.findFirst({ where: { id: 1902, project_id: 10, content_item_id: 1114, kind: 'art_direction',
            state: 'completed', input_context_version: 1, result_version: 1 } }),
        tx.deliveryAttempt.findFirst({ where: { project_id: 10, content_item_id: 1114 }, orderBy: { id: 'asc' } }),
        tx.workItem.findFirst({ where: { project_id: 10, content_item_id: 1114, kind: 'browser_publish', state: { notIn: ['completed', 'cancelled'] } } }),
        tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1114, command: p.releaseCommand,
            actor_id: a.actorId, idempotency_key: a.releaseIdempotencyKey }, orderBy: { id: 'desc' } })
    ]);
    if (!task || task.channel?.type !== 'threads' || task.channel.name !== 'innokenty_threads'
        || task.selected_asset || object(task.quality_report).publication_hold
        || (attemptId !== undefined && (task.status !== 'publishing' || attempt?.id !== attemptId
            || attempt.status !== 'pending' || attempt.idempotency_key !== a.idempotencyKey))) throw new Error('[THREADS1114_PACKAGE_GUARD_FAILED]');
    const config = resolveEffectiveChannelConfig('threads', task.channel.config);
    const snapshot = { projectId: 10, taskId: task.id, channelId: task.channel_id,
        revision: task.content_revision, acceptedRevision: task.accepted_revision, bodySha256: hash(task.draft_text || ''),
        scheduleAt: task.schedule_at?.toISOString(), publishAt: task.publish_at?.toISOString(), manifest: p.manifest,
        owner: true, activeChannel: task.channel.is_active, userId: config.threads_user_id,
        username: typeof config.account_ref === 'string' ? config.account_ref.replace(/^@/, '') : null,
        accepted: task.text_state === 'accepted', handoffReady: task.handoff_state === 'ready',
        selectedAssetId: task.selected_asset_id, visualState: task.visual_state, decisionId: decision?.id,
        decisionVersion: decision?.decision_version, decisionRevision: decision?.source_content_revision,
        decisionActive: decision?.status === 'active', decisionKind: decision?.decision, decisionChannel: decision?.channel,
        placement: task.visual_placement, reviewComplete: Boolean(review), artComplete: Boolean(art),
        hasFact: Boolean(task.publication_fact || task.published_link), hasAttempt: Boolean(attempt && attempt.id !== attemptId),
        hasBrowserWork: Boolean(browserWork), status: attemptId === undefined ? task.status : 'ready_for_execution', mode: task.publication_mode };
    assertThreads1114Snapshot(snapshot, released);
    if (decision?.placement !== 'feed' || task.visual_decision_version !== 1) throw new Error('[THREADS1114_PACKAGE_GUARD_FAILED]');
    if (attemptId !== undefined && await tx.deliveryAttempt.count({ where: { project_id: 10, content_item_id: 1114 } }) !== 1) {
        throw new Error('[THREADS1114_ATTEMPT_CONFLICT]');
    }
    const releaseValid = validRelease1114(a, release);
    if (released && !releaseValid) throw new Error('[THREADS1114_OWNER_RELEASE_REQUIRED]');
    return { task, snapshot, credentialReady: Boolean(config.access_token), releaseValid };
}

import { createHash } from 'crypto';
import { isDeepStrictEqual } from 'util';
import { Prisma } from '@prisma/client';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { X1113 as p, type X1113Boundary, type X1113Release } from './x1113_contract';
export function xObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function xHash(value: string) { return createHash('sha256').update(value).digest('hex'); }
export async function xOwner(tx: Prisma.TransactionClient, a: X1113Release) {
    const match = /^user:([1-9]\d*)$/.exec(a.actorId);
    if (a.projectId !== 10 || a.taskId !== 1113 || !match) throw new Error('[X1113_OWNER_SCOPE_REQUIRED]');
    const userId = Number(match[1]);
    const owner = await tx.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: userId } } });
    if (owner?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    return userId;
}
export async function xPackage(tx: Prisma.TransactionClient, a: X1113Release, released: boolean) {
    const userId = await xOwner(tx, a);
    const manifest = await loadAgentWorkspaceManifest(10, userId, tx);
    if (a.expectedManifestChecksum !== p.manifest || manifest.checksum !== p.manifest || manifest.project.slug !== 'analystcraft-2') throw new Error('[STALE_MANIFEST]');
    const [task, decision, review, art] = await Promise.all([
        tx.contentItem.findFirst({ where: { id: 1113, project_id: 10 }, include: { channel: true, publication_fact: true } }),
        tx.artDirectionDecision.findFirst({ where: { id: 308, project_id: 10, content_item_id: 1113, status: 'active',
            source_content_revision: 1, decision_version: 1, channel: 'x', placement: 'feed', decision: 'NO_VISUAL_NEEDED' } }),
        tx.workItem.findFirst({ where: { id: 1897, project_id: 10, content_item_id: 1113, kind: 'content_review', state: 'completed', input_context_version: 1, result_version: 2 } }),
        tx.workItem.findFirst({ where: { id: 1901, project_id: 10, content_item_id: 1113, kind: 'art_direction', state: 'completed', input_context_version: 1, result_version: 1 } })
    ]);
    const config = xObject(task?.channel?.config);
    if (!task || task.channel_id !== 164 || task.channel?.type !== 'x' || task.channel.name !== 'innokenty_x' || !task.channel.is_active
        || config.account_ref !== p.account || config.channel_url !== p.url || !isDeepStrictEqual(config.execution_modes, ['manual'])
        || task.content_revision !== 1 || task.accepted_revision !== 1 || task.text_state !== 'accepted'
        || !task.draft_text?.trim() || xHash(task.draft_text) !== p.bodySha256 || task.draft_text.length > 280
        || task.schedule_at?.toISOString() !== p.schedule || task.publish_at?.toISOString() !== p.schedule
        || task.selected_asset_id !== null || task.visual_state !== 'NO_VISUAL_NEEDED' || task.visual_mode === 'required'
        || task.visual_placement !== 'feed' || task.visual_decision_version !== 1 || !decision || !review || !art
        || task.handoff_state !== 'ready' || task.publication_fact || task.published_link || xObject(task.quality_report).publication_hold
        || task.publication_mode !== (released ? 'browser_required' : 'approval_required')
        || !(released ? ['browser_required', 'publishing'] : ['ready_for_execution']).includes(task.status)) {
        throw new Error('[X1113_EXACT_PACKAGE_REQUIRED]');
    }
    return task;
}
export function xRequestHash(a: X1113Boundary) {
    return xHash(JSON.stringify({ project: 10, task: 1113, channel: 164, work: a.workItemId, actor: a.actorId,
        approval: a.approvalReference, releaseKey: a.releaseIdempotencyKey, key: a.idempotencyKey,
        manifest: p.manifest, revision: 1, body: p.bodySha256, asset: null }));
}
export function xReadbackHash(a: X1113Boundary) {
    return xHash(JSON.stringify({ request: xRequestHash(a), profile: a.browserProfile, account: a.observedAccountRef,
        observedAt: a.observedAt, runtimeGuard: a.clientRuntimeGuardSha256, duplicate: a.duplicateCheckReference }));
}
export async function xReleasedWork(tx: Prisma.TransactionClient, a: X1113Boundary, freshContext: boolean) {
    const task = await xPackage(tx, a, true);
    const [work, release] = await Promise.all([
        tx.workItem.findFirst({ where: { id: a.workItemId, project_id: 10, content_item_id: 1113, kind: 'browser_publish' } }),
        tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1113, actor_id: a.actorId,
            command: 'ba_release_x_task1113_browser', idempotency_key: a.releaseIdempotencyKey } })
    ]);
    const proof = xObject(xObject(task.quality_report).owner_release);
    if (!work || work.assignee_role !== 'browser_publisher' || work.input_context_version !== 1
        || proof.publication_authorized !== true || proof.actor_id !== a.actorId
        || proof.release_idempotency_key !== a.releaseIdempotencyKey || proof.approval_reference !== a.approvalReference
        || proof.body_sha256 !== p.bodySha256 || proof.channel_id !== 164 || proof.content_revision !== 1
        || proof.browser_profile !== 'Innokenty' || proof.manifest_checksum !== p.manifest
        || !isDeepStrictEqual(proof, xObject(work.result_payload))
        || xObject(release?.after_state).browser_work_item_id !== work.id) throw new Error('[X1113_AUDITED_RELEASE_REQUIRED]');
    if (freshContext) {
        const age = Date.now() - Date.parse(a.observedAt);
        if (a.browserProfile !== 'Innokenty' || a.observedAccountRef !== p.account
            || a.contextSource !== 'owning_publisher_live_browser_info' || age < -5_000 || age > 30_000) {
            throw new Error('[X1113_LIVE_PERSONAL_CONTEXT_REQUIRED]');
        }
    }
    return { task, work };
}
export async function xBoundary(tx: Prisma.TransactionClient, a: X1113Boundary, freshContext: boolean) {
    const checked = await xReleasedWork(tx, a, freshContext);
    const work = checked.work;
    if (work.state !== 'claimed' || work.lease_actor_id !== a.actorId || work.lease_token !== a.leaseToken
        || !work.lease_expires_at || work.lease_expires_at.getTime() <= Date.now()) throw new Error('[X1113_ACTIVE_LEASE_REQUIRED]');
    return checked;
}

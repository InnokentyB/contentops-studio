import { isDeepStrictEqual } from 'util';
import { Prisma } from '@prisma/client';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { submissionObject as object, submissionHash as hash } from './linkedin1128_submission_guard';
import { LINKEDIN1086 as p, base1086Schema, submission1086Schema, type Base1086, type Submission1086 as Args } from './linkedin1086_contract';
export { object as submissionObject, hash as submissionHash };
export type { Submission1086 } from './linkedin1086_contract';

/** Validate the authenticated project owner before all state and replay paths. */
export async function check1086Owner(tx: Prisma.TransactionClient, a: Base1086): Promise<void> {
    if (!base1086Schema.safeParse(a).success) throw new Error('[LINKEDIN1086_SCOPE_MISMATCH]');
    const member = await tx.projectMember.findUnique({ where: { project_id_user_id: { project_id: 7, user_id: Number(a.actorId.slice(5)) } } });
    if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
}
/** Read only the exact accepted personal package and its active review/art gates. */
export async function package1086(tx: Prisma.TransactionClient, a: Base1086, released = true) {
    await check1086Owner(tx, a);
    const manifest = await loadAgentWorkspaceManifest(7, Number(a.actorId.slice(5)), tx);
    if (manifest.checksum !== p.manifest || manifest.project.slug !== 'seturon') throw new Error('[STALE_MANIFEST]');
    const [task, decision, review] = await Promise.all([
        tx.contentItem.findFirst({ where: { id: 1086, project_id: 7 }, include: { channel: true, publication_fact: true } }),
        tx.artDirectionDecision.findFirst({ where: { id: 249, project_id: 7, content_item_id: 1086, status: 'active',
            source_content_revision: 1, decision_version: 1, decision: 'NO_VISUAL_NEEDED', channel: 'linkedin', placement: 'feed' } }),
        tx.workItem.findFirst({ where: { project_id: 7, content_item_id: 1086, kind: 'content_review', state: 'completed', input_context_version: 1 } })
    ]);
    const c = object(task?.channel?.config); const q = object(task?.quality_report);
    if (!task || task.channel_id !== 5 || !task.channel?.is_active || task.channel.type !== 'linkedin'
        || task.channel.name !== 'innokentiy_linkedin' || c.account_ref !== p.profile || c.channel_url !== p.profile
        || c.identity_ref !== 'personal_innokenty' || c.profile_ref !== 'profile_personal_innokenty_linkedin'
        || c.account_type !== 'personal' || c.workflow_mode !== 'browser_required' || c.connector_mode !== 'browser_assisted'
        || object(c.capability_flags).browser_publish !== true || !isDeepStrictEqual(c.execution_modes, ['manual'])
        || task.content_revision !== 1 || task.accepted_revision !== 1 || task.text_state !== 'accepted'
        || hash(task.draft_text || '') !== p.body || task.schedule_at?.toISOString() !== p.schedule
        || task.publish_at?.toISOString() !== p.schedule || !decision || !review
        || task.visual_state !== 'NO_VISUAL_NEEDED' || task.visual_decision_version !== 1 || task.visual_placement !== 'feed'
        || task.selected_asset_id !== null || task.handoff_state !== 'ready' || task.publication_fact || task.published_link || q.publication_hold
        || (released ? task.publication_mode !== 'browser_required' || !['browser_required', 'publishing'].includes(task.status)
            || q.content_language !== 'en' || object(q.handoff_bundle).content_language !== 'en' || object(q.handoff_bundle).mode !== 'manual'
            : task.publication_mode !== 'approval_required' || task.status !== 'ready_for_execution')) {
        throw new Error('[LINKEDIN1086_EXACT_PACKAGE_REQUIRED]');
    }
    return task;
}
/** Stable package/actor/lease-owner request binding; raw lease never enters audit. */
export function submissionRequestHash(a: Args): string {
    return hash(JSON.stringify({ actor: a.actorId, project: 7, task: 1086, channel: 5, work: a.workItemId,
        revision: 1, body: p.body, manifest: p.manifest, approval: a.approvalReference,
        releaseKey: a.releaseIdempotencyKey, key: a.idempotencyKey }));
}
/** Bind the one-shot permission to actual native author/editor/history readback. */
export function submissionReadbackHash(a: Args): string {
    return hash(JSON.stringify({ request: submissionRequestHash(a), profile: a.observedProfileUrl,
        author: a.authorEvidenceSha256, duplicate: a.duplicateCheckReference, actionTimeConfirmation: a.actionTimeConfirmationReference,
        editor_sha256: a.observedEditorText === undefined ? null : hash(a.observedEditorText.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim()) }));
}
/** Resolve one audited release and its unique revision-bound work item. */
export async function releasedWork1086(tx: Prisma.TransactionClient, a: Args) {
    const task = await package1086(tx, a);
    const [work, event] = await Promise.all([
        tx.workItem.findFirst({ where: { id: a.workItemId, project_id: 7, content_item_id: 1086, kind: 'browser_publish' } }),
        tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1086, actor_id: a.actorId, command: p.command, idempotency_key: a.releaseIdempotencyKey } })
    ]);
    const proof = object(object(task.quality_report).owner_release);
    if (!work || work.assignee_role !== 'browser_publisher' || work.input_context_version !== 1
        || proof.publication_authorized !== true || proof.actor_id !== a.actorId || proof.body_sha256 !== p.body
        || proof.content_revision !== 1 || proof.channel_id !== 5 || proof.approval_reference !== a.approvalReference
        || proof.release_idempotency_key !== a.releaseIdempotencyKey || proof.target_profile_url !== p.profile
        || !isDeepStrictEqual(work.result_payload, proof) || object(event?.after_state).browser_work_item_id !== work.id) {
        throw new Error('[LINKEDIN1086_AUDITED_RELEASE_REQUIRED]');
    }
    return { task, work };
}
/** Expired fences admit same-attempt reconciliation only, never Submit. */
export async function check1086(tx: Prisma.TransactionClient, a: Args, historical = false) {
    if (!submission1086Schema.safeParse(a).success) throw new Error('[LINKEDIN1086_SCOPE_MISMATCH]');
    const checked = await releasedWork1086(tx, a); const w = checked.work;
    if (w.state !== 'claimed' || w.lease_actor_id !== a.actorId || w.lease_token !== a.leaseToken || !w.lease_expires_at
        || (!historical && w.lease_expires_at.getTime() <= Date.now())) throw new Error('[LINKEDIN1086_LEASE_REQUIRED]');
    return checked;
}

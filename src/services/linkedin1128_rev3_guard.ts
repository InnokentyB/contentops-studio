import { isDeepStrictEqual } from 'util';
import { Prisma } from '@prisma/client';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { submissionObject as object, submissionHash as hash } from './linkedin1128_submission_guard';
import { LINKEDIN1128R3 as p, rev3BaseSchema, linkedin1128Rev3SubmissionSchema,
    type Rev3Base, type LinkedIn1128Rev3Submission as Args } from './linkedin1128_rev3_contract';
export { object as submissionObject, hash as submissionHash };
export type { LinkedIn1128Rev3Submission } from './linkedin1128_rev3_contract';
export async function check1128Rev3Owner(tx: Prisma.TransactionClient, a: Rev3Base) {
    if (!rev3BaseSchema.safeParse(a).success) throw new Error('[LINKEDIN1128_REV3_SCOPE_MISMATCH]');
    const member = await tx.projectMember.findUnique({ where: { project_id_user_id: { project_id: 7, user_id: Number(a.actorId.slice(5)) } } });
    if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
}
export async function rev3Package(tx: Prisma.TransactionClient, a: Rev3Base) {
    await check1128Rev3Owner(tx, a);
    const manifest = await loadAgentWorkspaceManifest(7, Number(a.actorId.slice(5)), tx);
    if (manifest.checksum !== p.manifest || manifest.project.slug !== 'seturon') throw new Error('[STALE_MANIFEST]');
    const [task, decision, review] = await Promise.all([
        tx.contentItem.findFirst({ where: { id: 1128, project_id: 7 }, include: { channel: true, publication_fact: true } }),
        tx.artDirectionDecision.findFirst({ where: { id: 315, project_id: 7, content_item_id: 1128,
            status: 'active', source_content_revision: 3, decision_version: 2, decision: 'NO_VISUAL_NEEDED', channel: 'linkedin', placement: 'feed' } }),
        tx.workItem.findFirst({ where: { project_id: 7, content_item_id: 1128, kind: 'content_review', state: 'completed', input_context_version: 3 } })
    ]);
    const c = object(task?.channel?.config);
    if (!task || task.channel_id !== 6 || !task.channel?.is_active || task.channel.type !== 'linkedin'
        || task.channel.name !== 'seturon_linkedin_page' || c.account_ref !== 'seturon_linkedin_page'
        || c.account_type !== 'company_page' || object(c.raw_account).url !== 'https://www.linkedin.com/company/seturon/'
        || !isDeepStrictEqual(c.execution_modes, ['manual']) || task.content_revision !== 3 || task.accepted_revision !== 3
        || task.text_state !== 'accepted' || hash(task.draft_text || '') !== p.body
        || task.schedule_at?.toISOString() !== p.schedule || task.publish_at?.toISOString() !== p.schedule
        || !decision || !review || task.visual_state !== 'NO_VISUAL_NEEDED' || task.visual_decision_version !== 2
        || task.visual_placement !== 'feed' || task.selected_asset_id !== null || task.handoff_state !== 'ready'
        || task.publication_mode !== 'browser_required' || !['ready_for_execution', 'browser_required', 'publishing'].includes(task.status)
        || task.publication_fact || task.published_link || object(task.quality_report).publication_hold) {
        throw new Error('[LINKEDIN1128_REV3_EXACT_PACKAGE_REQUIRED]');
    }
    return task;
}
export function submissionRequestHash(a: Args) {
    return hash(JSON.stringify({ actor: a.actorId, project: 7, task: 1128, channel: 6, work: a.workItemId,
        revision: 3, body: p.body, manifest: p.manifest, approval: a.approvalReference,
        releaseKey: a.releaseIdempotencyKey, key: a.idempotencyKey }));
}
export function submissionReadbackHash(a: Args) {
    return hash(JSON.stringify({ request: submissionRequestHash(a), company: a.observedCompanyId,
        author: a.authorEvidenceSha256, duplicate: a.duplicateCheckReference, actionTimeConfirmation: a.actionTimeConfirmationReference,
        editor_sha256: a.observedEditorText === undefined ? null : hash(a.observedEditorText.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim()) }));
}
export async function rev3ReleasedWork(tx: Prisma.TransactionClient, a: Args) {
    const task = await rev3Package(tx, a);
    const [work, event, old, oldWork] = await Promise.all([
        tx.workItem.findFirst({ where: { id: a.workItemId, project_id: 7, content_item_id: 1128, kind: 'browser_publish' } }),
        tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1128, actor_id: a.actorId, command: p.command, idempotency_key: a.releaseIdempotencyKey } }),
        tx.deliveryAttempt.findFirst({ where: { id: 38, project_id: 7, content_item_id: 1128, status: 'superseded_pre_provider', actual_published_at: null,
            idempotency_key: p.oldAttemptKey, requires_manual_confirmation: false, error_message: 'OWNER_ENGLISH_REV3_NO_SUBMIT_PERMISSION' } }),
        tx.workItem.findFirst({ where: { id: 1924, project_id: 7, content_item_id: 1128, state: 'blocked',
            reason_code: 'SUPERSEDED_BY_ACCEPTED_REVISION3', lease_token: null, lease_actor_id: null, lease_expires_at: null } })
    ]);
    const proof = object(object(task.quality_report).owner_release); const binding = object(object(task.quality_report).identity_binding);
    if (!work || !old || !oldWork || work.id === 1924 || work.assignee_role !== 'browser_publisher' || work.input_context_version !== 3
        || proof.publication_authorized !== true || proof.actor_id !== a.actorId || proof.body_sha256 !== p.body
        || proof.content_revision !== 3 || proof.channel_id !== 6 || proof.approval_reference !== a.approvalReference
        || proof.release_idempotency_key !== a.releaseIdempotencyKey || !isDeepStrictEqual(work.result_payload, proof)
        || binding.content_revision !== 3 || binding.body_sha256 !== p.body || binding.linkedin_company_id !== '97416172'
        || binding.provider_identity_verified !== false || binding.audit_command !== p.command
        || !isDeepStrictEqual(object(event?.after_state).identity_binding, binding)
        || object(event?.after_state).browser_work_item_id !== work.id) throw new Error('[LINKEDIN1128_REV3_AUDITED_RELEASE_REQUIRED]');
    return { task, work };
}
export async function check1128Rev3(tx: Prisma.TransactionClient, a: Args, historical = false) {
    if (!linkedin1128Rev3SubmissionSchema.safeParse(a).success) throw new Error('[LINKEDIN1128_REV3_SCOPE_MISMATCH]');
    const checked = await rev3ReleasedWork(tx, a); const w = checked.work;
    if (w.state !== 'claimed' || w.lease_actor_id !== a.actorId || w.lease_token !== a.leaseToken || !w.lease_expires_at
        || (!historical && w.lease_expires_at.getTime() <= Date.now())) throw new Error('[LINKEDIN1128_REV3_LEASE_REQUIRED]');
    return checked;
}

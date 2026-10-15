import { isDeepStrictEqual } from 'util';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { linkedIn1128Binding } from './linkedin1128_release_policy';
import { submissionObject as object, submissionHash as hash } from './linkedin1128_submission_guard';
import { LINKEDIN1128 as old } from './linkedin1128_identity.service';
import { LINKEDIN1128R3 as p, rev3ReleaseSchema, assertRev1PreProvider } from './linkedin1128_rev3_contract';
import { rev3Package, check1128Rev3Owner } from './linkedin1128_rev3_guard';
import { linkedIn1128Rev3Handoff } from './linkedin1128_rev3_projection';
export async function releaseLinkedIn1128Rev3(input: unknown) {
    const a = rev3ReleaseSchema.parse(input);
    const fingerprint = hash(JSON.stringify({ ...a, apply: undefined }));
    return prisma.$transaction(async tx => {
        await check1128Rev3Owner(tx, a);
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1128,
            actor_id: a.actorId, command: p.command, idempotency_key: a.idempotencyKey } });
        if (prior) {
            if (object(prior.before_state).request_hash !== fingerprint) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...object(prior.after_state), replayed: true, submission_permitted: false };
        }
        const task = await rev3Package(tx, a);
        if (task.status !== 'ready_for_execution') throw new Error('[LINKEDIN1128_REV3_RELEASE_STATE_REQUIRED]');
        const report = object(task.quality_report); const binding = linkedIn1128Binding(report);
        const [attempts, events, work, bindingAudit, releaseAudit, newWork] = await Promise.all([
            tx.deliveryAttempt.findMany({ where: { project_id: 7, content_item_id: 1128 } }),
            tx.workflowEvent.findMany({ where: { project_id: 7, content_item_id: 1128, OR: [
                { command: { contains: 'linkedin_task1128' } }, { work_item_id: 1924 },
                { command: { in: ['ba_confirm_publication', 'ba_record_publication_fact'] } }] } }),
            tx.workItem.findFirst({ where: { id: 1924, project_id: 7, content_item_id: 1128, kind: 'browser_publish' } }),
            tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1128, actor_id: binding.actor_id,
                command: old.command, idempotency_key: binding.audit_idempotency_key } }),
            tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1128,
                command: 'ba_release_approved_linkedin_browser_task' }, orderBy: { id: 'desc' } }),
            tx.workItem.findFirst({ where: { project_id: 7, content_item_id: 1128, kind: 'browser_publish', id: { not: 1924 } } })
        ]);
        assertRev1PreProvider({ actor: a.actorId, work, attempts, events });
        if (!work || newWork || binding.actor_id !== a.actorId || object(bindingAudit?.after_state).applied !== true
            || !isDeepStrictEqual(object(bindingAudit?.after_state).identity_binding, binding)
            || releaseAudit?.actor_id !== a.actorId || object(releaseAudit.after_state).browser_work_item_id !== 1924
            || object(releaseAudit.after_state).body_sha256 !== old.body
            || object(report.owner_release).body_sha256 !== old.body) throw new Error('[LINKEDIN1128_REV3_OLD_AUDIT_REQUIRED]');
        const nextBinding = { ...binding, content_revision: 3, accepted_revision: 3, body_sha256: p.body,
            visual_decision_id: 315, visual_decision_version: 2, actor_id: a.actorId,
            approval_reference: a.approvalReference, audit_command: p.command, audit_idempotency_key: a.idempotencyKey,
            superseded_binding_sha256: hash(JSON.stringify(binding)) };
        if (!a.apply) return { mode: 'preview', supersede_attempt_id: 38, supersede_work_item_id: 1924,
            replacement_revision: 3, body_sha256: p.body, company_id: '97416172',
            pre_provider_basis: 'no_durable_submit_permission_and_owning_executor_report', published: false, publication_authorized: false };
        const proof = { publication_authorized: true, content_revision: 3, body_sha256: p.body, channel_id: 6,
            selected_asset_id: null, asset_sha256: null, actor_id: a.actorId, approval_reference: a.approvalReference,
            release_idempotency_key: a.idempotencyKey, superseded_attempt_id: 38, superseded_work_item_id: 1924 };
        const bundle = linkedIn1128Rev3Handoff({ ...object(report.handoff_bundle), publication: {
            body: task.draft_text, image_url: null, video_url: null, content_binding: { accepted_revision: 3, body_sha256: p.body }
        } }, { identity_binding: nextBinding });
        const aborted = await tx.deliveryAttempt.updateMany({ where: { id: 38, project_id: 7, content_item_id: 1128,
            status: 'pending', actual_published_at: null, idempotency_key: p.oldAttemptKey, updated_at: attempts[0].updated_at },
        data: { status: 'superseded_pre_provider', requires_manual_confirmation: false, error_message: 'OWNER_ENGLISH_REV3_NO_SUBMIT_PERMISSION' } });
        const stale = await tx.workItem.updateMany({ where: { id: 1924, project_id: 7, content_item_id: 1128,
            state: 'claimed', lease_actor_id: a.actorId, lease_token: work.lease_token, updated_at: work.updated_at },
        data: { state: 'blocked', reason_code: 'SUPERSEDED_BY_ACCEPTED_REVISION3', lease_token: null, lease_actor_id: null, lease_expires_at: null } });
        const changed = await tx.contentItem.updateMany({ where: { id: 1128, project_id: 7, channel_id: 6,
            content_revision: 3, accepted_revision: 3, status: 'ready_for_execution', updated_at: task.updated_at },
        data: { status: 'browser_required', quality_report: { ...report, identity_binding: nextBinding,
            owner_release: proof, handoff_bundle: bundle, content_language: 'en', execution_mode: 'browser', publication_route: 'browser_required'
        } as Prisma.InputJsonObject } });
        if (aborted.count !== 1 || stale.count !== 1 || changed.count !== 1) throw new Error('[LINKEDIN1128_REV3_CAS_CONFLICT]');
        const next = await tx.workItem.create({ data: { project_id: 7, content_item_id: 1128,
            item_key: task.item_key || 'publication-1128', kind: 'browser_publish', state: 'available', assignee_role: 'browser_publisher',
            input_context_version: 3, result_payload: proof, due_at: task.schedule_at, dedupe_key: 'browser_publish:1128:r3' } });
        const result = { mode: 'released', browser_work_item_id: next.id, content_revision: 3,
            identity_binding: nextBinding, superseded_attempt_id: 38, superseded_work_item_id: 1924, submission_permitted: false };
        await tx.workflowEvent.create({ data: { project_id: 7, content_item_id: 1128, work_item_id: next.id,
            actor_id: a.actorId, command: p.command, idempotency_key: a.idempotencyKey, before_state: {
                request_hash: fingerprint, prior_attempt_status: 'pending', old_work_item_id: 1924, old_attempt_id: 38,
                start_event_id: 3243, binding_sha256: hash(JSON.stringify(binding)),
                lease_sha256: work.lease_token ? hash(work.lease_token) : null, lease_expires_at: work.lease_expires_at?.toISOString() || null,
                no_submit_evidence_reference: a.noSubmitEvidenceReference,
                pre_provider_basis: 'no_durable_submit_permission_and_owning_executor_report'
            }, after_state: result } });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

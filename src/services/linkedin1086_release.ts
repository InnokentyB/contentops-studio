import { Prisma } from '@prisma/client';
import prisma from '../db';
import { LINKEDIN1086 as p, release1086Schema } from './linkedin1086_contract';
import { package1086, check1086Owner, submissionObject as object, submissionHash as hash } from './linkedin1086_guard';

/** Preserve exact English/manual task projection when preparing the handoff again. */
export function handoff1086(bundle: Record<string, unknown>): Record<string, unknown> {
    return { ...bundle, mode: 'manual', content_language: 'en',
        task: { ...object(bundle.task), content_item_id: 1086, channel: 'linkedin', placement: 'feed',
            account_ref: p.profile, schedule_at: p.schedule },
        account: { ref: p.profile, details: { platform: 'linkedin', account_type: 'personal', url: p.profile,
            profile_ref: 'profile_personal_innokenty_linkedin', identity_ref: 'personal_innokenty' } } };
}

/** Preview/apply metadata or release for1086 only, with exact CAS and audit. */
export async function controlLinkedIn1086(input: unknown, release: boolean): Promise<Record<string, unknown>> {
    const a = release1086Schema.parse(input); const command = release ? p.command : 'ba_repair_linkedin_task1086_metadata';
    const fingerprint = hash(JSON.stringify({ ...a, apply: undefined, release }));
    return prisma.$transaction(async tx => {
        await check1086Owner(tx, a);
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1086,
            actor_id: a.actorId, command, idempotency_key: a.idempotencyKey } });
        if (prior) {
            if (object(prior.before_state).request_hash !== fingerprint) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...object(prior.after_state), replayed: true, submission_permitted: false };
        }
        const task = await package1086(tx, a, false); const quality = object(task.quality_report);
        const [attempt, work] = await Promise.all([
            tx.deliveryAttempt.findFirst({ where: { project_id: 7, content_item_id: 1086 } }),
            tx.workItem.findFirst({ where: { project_id: 7, content_item_id: 1086, kind: 'browser_publish' } })
        ]);
        if (attempt || work || quality.owner_release) throw new Error('[LINKEDIN1086_RECONCILIATION_REQUIRED]');
        const oldBundle = object(quality.handoff_bundle);
        if (release && (quality.content_language !== 'en' || oldBundle.content_language !== 'en' || oldBundle.mode !== 'manual')) {
            throw new Error('[LINKEDIN1086_METADATA_REPAIR_REQUIRED]');
        }
        if (release) {
            const metadataAudit = await tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1086,
                actor_id: a.actorId, command: 'ba_repair_linkedin_task1086_metadata',
                idempotency_key: String(quality.linkedin1086_metadata_repair_key || '') } });
            if (quality.linkedin1086_metadata_repair !== p.body || object(metadataAudit?.after_state).mode !== 'repaired'
                || object(metadataAudit?.after_state).body_sha256 !== p.body) throw new Error('[LINKEDIN1086_METADATA_REPAIR_REQUIRED]');
        }
        const preview = { mode: 'preview', task_id: 1086, channel_id: 5, content_revision: 1,
            body_sha256: p.body, target_profile_url: p.profile, schedule_at: p.schedule,
            from: { content_language: quality.content_language ?? null, handoff_language: oldBundle.content_language ?? null,
                handoff_mode: oldBundle.mode ?? null },
            to: { content_language: 'en', handoff_mode: 'manual' }, submission_permitted: false, provider_called: false };
        if (!a.apply) return preview;
        const proof = { publication_authorized: true, content_revision: 1, body_sha256: p.body, channel_id: 5,
            selected_asset_id: null, asset_sha256: null, actor_id: a.actorId, approval_reference: a.approvalReference,
            release_idempotency_key: a.idempotencyKey, target_profile_url: p.profile };
        const nextQuality = { ...quality, content_language: 'en', execution_mode: 'browser',
            linkedin1086_metadata_repair: p.body,
            linkedin1086_metadata_repair_key: release ? quality.linkedin1086_metadata_repair_key : a.idempotencyKey,
            handoff_bundle: handoff1086({ ...oldBundle, publication: { ...object(oldBundle.publication),
                body: task.draft_text, image_url: null, video_url: null,
                content_binding: { accepted_revision: 1, body_sha256: p.body } } }),
            ...(release ? { owner_release: proof, publication_route: 'browser_required' } : {}) };
        const changed = await tx.contentItem.updateMany({ where: { id: 1086, project_id: 7, channel_id: 5,
            updated_at: task.updated_at, status: 'ready_for_execution', publication_mode: 'approval_required',
            content_revision: 1, accepted_revision: 1, draft_text: task.draft_text,
            schedule_at: new Date(p.schedule), publish_at: new Date(p.schedule), selected_asset_id: null },
        data: { quality_report: nextQuality as Prisma.InputJsonObject,
            ...(release ? { status: 'browser_required', publication_mode: 'browser_required' } : {}) } });
        if (changed.count !== 1) throw new Error('[LINKEDIN1086_CAS_CONFLICT]');
        const next = release ? await tx.workItem.create({ data: { project_id: 7, content_item_id: 1086,
            item_key: task.item_key || 'publication-1086', kind: 'browser_publish', state: 'available',
            assignee_role: 'browser_publisher', input_context_version: 1, result_payload: proof,
            due_at: task.schedule_at, dedupe_key: 'browser_publish:1086:r1' } }) : null;
        const result = { ...preview, mode: release ? 'released' : 'repaired', browser_work_item_id: next?.id ?? null };
        await tx.workflowEvent.create({ data: { project_id: 7, content_item_id: 1086, work_item_id: next?.id,
            actor_id: a.actorId, command, idempotency_key: a.idempotencyKey,
            before_state: { request_hash: fingerprint, metadata: preview.from }, after_state: result } });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

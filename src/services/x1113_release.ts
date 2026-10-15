import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { X1113 as p, x1113ReleaseSchema, x1113ClaimSchema, type X1113Release, type X1113Claim } from './x1113_contract';
import { xOwner, xPackage, xReleasedWork, xObject as object, xHash, xRequestHash } from './x1113_guard';
const serial = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;
const command = 'ba_release_x_task1113_browser';
function fingerprint(a: X1113Release) { return xHash(JSON.stringify({ actor: a.actorId, approval: a.approvalReference,
    key: a.idempotencyKey, manifest: a.expectedManifestChecksum, duplicate: a.duplicateCheckReference })); }
export async function releaseX1113(input: X1113Release) {
    const a = x1113ReleaseSchema.parse(input);
    return prisma.$transaction(async tx => {
        await xOwner(tx, a);
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1113,
            actor_id: a.actorId, command, idempotency_key: a.idempotencyKey } });
        if (prior) {
            if (object(prior.before_state).request_hash !== fingerprint(a)) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...object(prior.after_state), replayed: true, submission_permitted: false };
        }
        const task = await xPackage(tx, a, false);
        const [attempt, existing] = await Promise.all([
            tx.deliveryAttempt.findFirst({ where: { project_id: 10, content_item_id: 1113 } }),
            tx.workItem.findFirst({ where: { project_id: 10, content_item_id: 1113, kind: 'browser_publish' } })
        ]);
        if (attempt || existing) throw new Error('[X1113_EXISTING_EXECUTION_RECONCILE_ONLY]');
        const proof = { publication_authorized: true, actor_id: a.actorId, approval_reference: a.approvalReference,
            release_idempotency_key: a.idempotencyKey, manifest_checksum: p.manifest, content_revision: 1,
            body_sha256: p.bodySha256, channel_id: 164, selected_asset_id: null, asset_sha256: null,
            browser_profile: 'Innokenty', account_ref: p.account };
        const report = object(task.quality_report); const oldBundle = object(report.handoff_bundle);
        const bundle = { ...oldBundle, mode: 'manual', content_language: 'en',
            task: { ...object(oldBundle.task), content_item_id: 1113, channel: 'x', placement: 'feed',
                account_ref: p.account, schedule_at: p.schedule, action_type: 'x_feed:publish' },
            publication: { body: task.draft_text, image_url: null, video_url: null,
                content_binding: { accepted_revision: 1, body_sha256: p.bodySha256 } },
            checklist: [`Use only personal browser profile Innokenty and X account ${p.account}.`,
                'Run the live native context guard before attempt and immediately before Post; never persist browser IDs.',
                'Use the exact accepted text, no attachments. Check native duplicate history before Post.',
                'One-shot pre-submit permits one click only. Ambiguity means reconcile, never resend.'] };
        const changed = await tx.contentItem.updateMany({ where: { id: 1113, project_id: 10, channel_id: 164,
            updated_at: task.updated_at, status: 'ready_for_execution', publication_mode: 'approval_required' },
        data: { status: 'browser_required', publication_mode: 'browser_required', quality_report: {
            ...report, owner_release: proof, handoff_bundle: bundle, publication_route: 'browser_required'
        } as Prisma.InputJsonObject } });
        if (changed.count !== 1) throw new Error('[X1113_CAS_CONFLICT]');
        const work = await tx.workItem.create({ data: { project_id: 10, content_item_id: 1113,
            item_key: task.item_key || 'publication-1113', kind: 'browser_publish', state: 'available',
            assignee_role: 'browser_publisher', input_context_version: 1, result_payload: proof,
            due_at: task.schedule_at, dedupe_key: 'browser_publish:1113:r1' } });
        const result = { mode: 'released', browser_work_item_id: work.id, channel_id: 164,
            browser_profile: 'Innokenty', account_ref: p.account, submission_permitted: false };
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1113, work_item_id: work.id,
            actor_id: a.actorId, command, idempotency_key: a.idempotencyKey,
            before_state: { request_hash: fingerprint(a) }, after_state: result } });
        return result;
    }, serial);
}
export async function claimX1113(input: X1113Claim) {
    const a = { ...x1113ClaimSchema.parse(input), leaseToken: '' };
    return prisma.$transaction(async tx => {
        const { work } = await xReleasedWork(tx, a, 'start');
        if (await tx.deliveryAttempt.findFirst({ where: { project_id: 10, content_item_id: 1113 } })) throw new Error('[X1113_RECONCILE_ONLY]');
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1113,
            work_item_id: work.id, actor_id: a.actorId, command: 'ba_claim_x_task1113_browser', idempotency_key: a.idempotencyKey } });
        if (prior) {
            if (object(prior.before_state).request_hash !== xRequestHash(a)) throw new Error('[IDEMPOTENCY_CONFLICT]');
            if (work.state !== 'claimed' || work.lease_actor_id !== a.actorId || !work.lease_token || !work.lease_expires_at
                || work.lease_expires_at.getTime() <= Date.now() || object(prior.after_state).lease_sha256 !== xHash(work.lease_token)) {
                throw new Error('[X1113_RECONCILE_ONLY]');
            }
            return { mode: 'claimed', work_item_id: work.id, lease_token: work.lease_token,
                lease_expires_at: work.lease_expires_at.toISOString(), replayed: true, submission_permitted: false };
        }
        if (work.state !== 'available' || work.lease_token || work.lease_actor_id) throw new Error('[X1113_ALREADY_CLAIMED]');
        const token = `lease-${randomUUID()}`; const expires = new Date(Date.now() + 1800000);
        const changed = await tx.workItem.updateMany({ where: { id: work.id, project_id: 10,
            state: 'available', updated_at: work.updated_at, lease_token: null, lease_actor_id: null },
        data: { state: 'claimed', lease_actor_id: a.actorId, lease_token: token, lease_expires_at: expires } });
        if (changed.count !== 1) throw new Error('[X1113_CAS_CONFLICT]');
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1113, work_item_id: work.id,
            actor_id: a.actorId, command: 'ba_claim_x_task1113_browser', idempotency_key: a.idempotencyKey,
            before_state: { state: 'available', request_hash: xRequestHash(a) },
            after_state: { state: 'claimed', lease_expires_at: expires.toISOString(), lease_sha256: xHash(token) } } });
        return { mode: 'claimed', work_item_id: work.id, lease_token: token, lease_expires_at: expires.toISOString(), submission_permitted: false };
    }, serial);
}

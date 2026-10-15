import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../db';
import { linkedin1128RecoverySchema, check1128RecoveryOwner, check1128RecoverySnapshot, submissionObject as object,
    submissionHash as hash, type LinkedIn1128Recovery } from './linkedin1128_submission_guard';
const command = 'ba_renew_linkedin_task1128_browser_lease';
const SAFE_CODES = new Set(['OWNER_REQUIRED', 'STALE_MANIFEST', 'IDEMPOTENCY_CONFLICT',
    'LINKEDIN1128_SCOPE_MISMATCH', 'LINKEDIN1128_ACTIVE_PACKAGE_LEASE_REQUIRED', 'LINKEDIN1128_EXPIRED_LEASE_REQUIRED',
    'LINKEDIN1128_IDENTITY_BINDING_REQUIRED', 'LINKEDIN1128_EXACT_PACKAGE_REQUIRED', 'LINKEDIN1128_AUDITED_BINDING_REQUIRED',
    'PUBLICATION_HOLD_ACTIVE', 'LINKEDIN1128_RELEASE_PROOF_INVALID', 'LINKEDIN1128_AUDITED_RELEASE_REQUIRED',
    'LINKEDIN1128_RECONCILIATION_REQUIRED', 'LINKEDIN1128_SAME_EXECUTOR_REQUIRED', 'LINKEDIN1128_PRE_PROVIDER_STATE_REQUIRED',
    'LINKEDIN1128_LEASE_HISTORY_REQUIRED', 'LINKEDIN1128_EXPECTED_EXPIRY_REQUIRED', 'LINKEDIN1128_LEASE_CAS_CONFLICT']);
export const linkedin1128LeaseSchema = linkedin1128RecoverySchema.extend({
    apply: z.boolean().optional().default(false), expectedExpiredLeaseAt: z.string().datetime({ offset: true }).optional(),
    expectedExpiredLeaseSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    leaseSeconds: z.number().int().min(60).max(1800).optional().default(1800)
});
type Args = LinkedIn1128Recovery & { apply?: boolean; expectedExpiredLeaseAt?: string; expectedExpiredLeaseSha256?: string; leaseSeconds?: number };
function requestHash(a: Args) {
    return hash(JSON.stringify({ project: 7, task: 1128, channel: 6, work: 1924, actor: a.actorId,
        manifest: a.expectedManifestChecksum, approval: a.approvalReference, key: a.idempotencyKey,
        body: a.textSha256, revision: a.contentRevision, oldLeaseSha: a.expectedExpiredLeaseSha256,
        expectedExpiry: a.expectedExpiredLeaseAt, seconds: a.leaseSeconds || 1800 }));
}
async function noExecution(tx: Prisma.TransactionClient) {
    const [attempt, operation] = await Promise.all([
        tx.deliveryAttempt.findFirst({ where: { project_id: 7, content_item_id: 1128 } }),
        tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1128, command: { in: [
            'ba_start_linkedin_task1128_browser_submission', 'ba_pre_submit_linkedin_task1128_browser_submission',
            'ba_confirm_linkedin_task1128_browser_submission', 'ba_mark_linkedin_task1128_browser_submission_uncertain'
        ] } } })
    ]);
    if (attempt || operation) throw new Error('[LINKEDIN1128_RECONCILIATION_REQUIRED] Existing execution forbids lease recovery');
}
export async function renewLinkedIn1128Lease(input: Args): Promise<Record<string, unknown>> {
    const parsed = linkedin1128LeaseSchema.safeParse(input);
    if (!parsed.success) throw new Error('[LINKEDIN1128_LEASE_SCOPE_MISMATCH]');
    const a = parsed.data; const fingerprint = requestHash(a);
    for (let retry = 0; retry < 3; retry += 1) {
        try { return await prisma.$transaction(async tx => {
            await check1128RecoveryOwner(tx, a);
            const prior = await tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1128,
                work_item_id: 1924, actor_id: a.actorId, command, idempotency_key: a.idempotencyKey } });
            if (prior) {
                if (object(prior.before_state).request_hash !== fingerprint) throw new Error('[IDEMPOTENCY_CONFLICT]');
                await noExecution(tx);
                const work = await tx.workItem.findFirst({ where: { id: 1924, project_id: 7, content_item_id: 1128,
                    state: 'claimed', lease_actor_id: a.actorId } });
                if (!work?.lease_token || !work.lease_expires_at || work.lease_expires_at.getTime() <= Date.now()
                    || hash(work.lease_token) !== object(prior.after_state).new_lease_sha256) {
                    return { mode: 'verification_required', work_item_id: 1924, renewed: false };
                }
                await check1128RecoverySnapshot(tx, { ...a, leaseToken: work.lease_token }, 'active');
                return { mode: 'renewed', work_item_id: 1924, lease_token: work.lease_token,
                    lease_expires_at: work.lease_expires_at.toISOString(), replayed: true, publication_authority_changed: false };
            }
            const current = await tx.workItem.findFirst({ where: { id: 1924, project_id: 7, content_item_id: 1128,
                kind: 'browser_publish', state: 'claimed', lease_actor_id: a.actorId } });
            if (!current?.lease_token) throw new Error('[LINKEDIN1128_SAME_EXECUTOR_REQUIRED]');
            const oldToken = current.lease_token;
            const { task, work } = await check1128RecoverySnapshot(tx, { ...a, leaseToken: oldToken }, 'expired_recovery');
            if (task.status !== 'browser_required') throw new Error('[LINKEDIN1128_PRE_PROVIDER_STATE_REQUIRED]');
            await noExecution(tx);
            if (!work.lease_expires_at) throw new Error('[LINKEDIN1128_LEASE_HISTORY_REQUIRED]');
            const previousExpiry = work.lease_expires_at.toISOString();
            if (!a.apply) return { mode: 'preview', work_item_id: 1924, renewable: true,
                expired_lease_at: previousExpiry, expired_lease_sha256: hash(oldToken),
                same_actor: true, no_execution: true, publication_authority_changed: false };
            if (!a.expectedExpiredLeaseAt || a.expectedExpiredLeaseAt !== previousExpiry
                || a.expectedExpiredLeaseSha256 !== hash(oldToken)) throw new Error('[LINKEDIN1128_EXPECTED_EXPIRY_REQUIRED]');
            const token = `lease-${randomUUID()}`; const expires = new Date(Date.now() + a.leaseSeconds * 1000);
            const changed = await tx.workItem.updateMany({ where: { id: 1924, project_id: 7, content_item_id: 1128,
                kind: 'browser_publish', state: 'claimed', lease_actor_id: a.actorId, lease_token: oldToken,
                lease_expires_at: work.lease_expires_at, updated_at: work.updated_at },
            data: { lease_token: token, lease_expires_at: expires } });
            if (changed.count !== 1) throw new Error('[LINKEDIN1128_LEASE_CAS_CONFLICT]');
            await tx.workflowEvent.create({ data: { project_id: 7, content_item_id: 1128, work_item_id: 1924,
                actor_id: a.actorId, command, idempotency_key: a.idempotencyKey,
                before_state: { request_hash: fingerprint, expired_lease_at: previousExpiry,
                    old_lease_sha256: hash(oldToken), state: 'claimed' },
                after_state: { work_item_id: 1924, new_lease_sha256: hash(token), lease_expires_at: expires.toISOString(),
                    same_actor: true, lease_renewal_only: true, publication_authority_changed: false } } });
            return { mode: 'renewed', work_item_id: 1924, lease_token: token,
                lease_expires_at: expires.toISOString(), replayed: false, publication_authority_changed: false };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error: unknown) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
                if (retry < 2) continue;
                throw new Error('[LINKEDIN1128_LEASE_CAS_CONFLICT]');
            }
            const code = error instanceof Error ? /^\[([A-Z0-9_]+)\]/.exec(error.message)?.[1] : undefined;
            throw new Error(code && SAFE_CODES.has(code) ? `[${code}]`
                : '[LINKEDIN1128_LEASE_RECOVERY_FAILED] Reconcile the same renewal key; never recreate work');
        }
    }
    throw new Error('[LINKEDIN1128_LEASE_CAS_CONFLICT]');
}

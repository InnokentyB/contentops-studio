import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../db';
import { claim1086Schema } from './linkedin1086_contract';
import { releasedWork1086, submissionObject as object, submissionHash as hash, submissionRequestHash } from './linkedin1086_guard';
export const lease1086Schema = claim1086Schema.extend({ apply: z.boolean().default(false),
    expectedExpiredLeaseAt: z.string().datetime({ offset: true }).optional(),
    expectedExpiredLeaseSha256: z.string().regex(/^[a-f0-9]{64}$/).optional() });
export async function leaseLinkedIn1086(input: unknown, renew: boolean) {
    const a = { ...lease1086Schema.parse(input), leaseToken: '' };
    const command = renew ? 'ba_renew_linkedin_task1086_browser_lease' : 'ba_claim_linkedin_task1086_browser';
    const fingerprint = hash(JSON.stringify({ request: submissionRequestHash(a), renew,
        expiry: a.expectedExpiredLeaseAt, fence: a.expectedExpiredLeaseSha256 }));
    return prisma.$transaction(async tx => {
        const { work } = await releasedWork1086(tx, a);
        if (await tx.deliveryAttempt.findFirst({ where: { project_id: 7, content_item_id: 1086 } })
            || await tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1086,
                command: { in: ['ba_start_linkedin_task1086_browser_submission', 'ba_pre_submit_linkedin_task1086_browser_submission',
                    'ba_confirm_linkedin_task1086_browser_submission', 'ba_mark_linkedin_task1086_browser_submission_uncertain'] } } })) {
            throw new Error('[LINKEDIN1086_RECONCILIATION_REQUIRED]');
        }
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1086,
            actor_id: a.actorId, work_item_id: work.id, command, idempotency_key: a.idempotencyKey } });
        if (prior) {
            if (object(prior.before_state).request_hash !== fingerprint) throw new Error('[IDEMPOTENCY_CONFLICT]');
            if (work.state !== 'claimed' || work.lease_actor_id !== a.actorId || !work.lease_token
                || !work.lease_expires_at || work.lease_expires_at.getTime() <= Date.now()
                || object(prior.after_state).lease_sha256 !== hash(work.lease_token)) throw new Error('[LINKEDIN1086_RECONCILIATION_REQUIRED]');
            return { mode: 'claimed', work_item_id: work.id, lease_token: work.lease_token,
                lease_expires_at: work.lease_expires_at.toISOString(), replayed: true, submission_permitted: false };
        }
        if (renew ? work.state !== 'claimed' || work.lease_actor_id !== a.actorId || !work.lease_token || !work.lease_expires_at
            || work.lease_expires_at.getTime() > Date.now() : work.state !== 'available' || work.lease_actor_id || work.lease_token) {
            throw new Error('[LINKEDIN1086_LEASE_STATE_INVALID]');
        }
        const expiry = work.lease_expires_at?.toISOString() || null; const fence = work.lease_token ? hash(work.lease_token) : null;
        if (!a.apply) return { mode: 'preview', work_item_id: work.id, expired_lease_at: expiry, expired_lease_sha256: fence, submission_permitted: false };
        if (renew && (a.expectedExpiredLeaseAt !== expiry || a.expectedExpiredLeaseSha256 !== fence)) throw new Error('[LINKEDIN1086_EXPECTED_LEASE_REQUIRED]');
        const token = `lease-${randomUUID()}`; const expires = new Date(Date.now() + 1800000);
        const changed = await tx.workItem.updateMany({ where: { id: work.id, project_id: 7, content_item_id: 1086,
            state: work.state, lease_actor_id: work.lease_actor_id, lease_token: work.lease_token,
            lease_expires_at: work.lease_expires_at, updated_at: work.updated_at },
        data: { state: 'claimed', lease_actor_id: a.actorId, lease_token: token, lease_expires_at: expires } });
        if (changed.count !== 1) throw new Error('[LINKEDIN1086_CAS_CONFLICT]');
        await tx.workflowEvent.create({ data: { project_id: 7, content_item_id: 1086, work_item_id: work.id,
            actor_id: a.actorId, command, idempotency_key: a.idempotencyKey,
            before_state: { request_hash: fingerprint, old_lease_sha256: fence, old_expiry: expiry },
            after_state: { lease_sha256: hash(token), lease_expires_at: expires.toISOString(), same_actor: true } } });
        return { mode: 'claimed', work_item_id: work.id, lease_token: token, lease_expires_at: expires.toISOString(), replayed: false, submission_permitted: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}


import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { Submission1086 } from './linkedin1086_contract';

export const LI1086_RECOVERY_COMMAND = 'ba_recover_linkedin_task1086_attempt41';
export const LI1086_HUMAN_REF = 'codex:01a0df21-ea6c-71f2-9c1b-40393de0e105/message/01a145fb-b06d-7f03-852e-7cbc7305852a';
/** Canonical event lookup spans all operation keys. Other old tasks never enter this path. */
export async function recovery1086Event(tx: Prisma.TransactionClient, workItemId: number) {
    return workItemId === 1946 ? tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1086,
        work_item_id: 1946, command: LI1086_RECOVERY_COMMAND }, orderBy: { id: 'asc' } }) : null;
}
function object(v: unknown): Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}
/** Historical original fence remains useful only for native-object reconciliation/uncertainty, never submit. */
export async function historical1086Fence(tx: Prisma.TransactionClient, a: Submission1086): Promise<boolean> {
    const e = await recovery1086Event(tx, a.workItemId);
    return e?.actor_id === a.actorId && object(e.before_state).old_lease_sha256
        === createHash('sha256').update(a.leaseToken).digest('hex');
}
/** Recovery generation is one-shot; fresh Publisher readback is attributed, not independently provider verified. */
export async function check1086RecoverySubmit(tx: Prisma.TransactionClient, a: Submission1086,
    workUpdatedAt: Date, now: Date, leaseExpiresAt?: Date | null): Promise<string | null> {
    if (a.workItemId !== 1946) return null;
    const event = await recovery1086Event(tx, a.workItemId);
    const after = object(event?.after_state);
    if (!event || event.actor_id !== a.actorId || after.recovery_generation !== 1 || after.attempt_id !== 41
        || after.lease_sha256 !== createHash('sha256').update(a.leaseToken).digest('hex')
        || a.recoveryGeneration !== 1 || a.actionTimeConfirmationReference !== LI1086_HUMAN_REF
        || !a.recoveryObservedAt || Date.parse(a.recoveryObservedAt) < event.created_at.getTime()
        || Date.parse(a.recoveryObservedAt) > now.getTime()
        || now.getTime() - Date.parse(a.recoveryObservedAt) > 120_000) throw new Error('[LINKEDIN1086_RECOVERY_FRESH_READBACK_REQUIRED]');
    const changed = await tx.workItem.updateMany({ where: { id: 1946, project_id: 7, content_item_id: 1086,
        state: 'claimed', updated_at: workUpdatedAt, lease_actor_id: a.actorId, lease_token: a.leaseToken,
        lease_expires_at: { gt: now } }, data: { updated_at: now } });
    if (changed.count !== 1) throw new Error('[LINKEDIN1086_CAS_CONFLICT]');
    return new Date(Math.min(now.getTime() + 30_000, leaseExpiresAt?.getTime() ?? now.getTime())).toISOString();
}

import { Prisma } from '@prisma/client';
import prisma from '../db';
import factService from './publication_fact.service';
import { X1113 as p, x1113BoundarySchema, type X1113Boundary as Args } from './x1113_contract';
import { xBoundary, xOwner, xObject as object, xHash, xRequestHash, xReadbackHash } from './x1113_guard';
const serial = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;
const startCommand = 'ba_start_x_task1113_browser_submission';
const preCommand = 'ba_pre_submit_x_task1113_browser_submission';
const confirmCommand = 'ba_confirm_x_task1113_browser_submission';
async function audit(tx: Prisma.TransactionClient, a: Args, command: string, after: Prisma.InputJsonObject, requestHash: string) {
    await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1113, work_item_id: a.workItemId,
        actor_id: a.actorId, command, idempotency_key: a.idempotencyKey,
        before_state: { request_hash: requestHash }, after_state: after } });
}
async function pending(tx: Prisma.TransactionClient, a: Args, id: number, reconcile = false) {
    const attempts = await tx.deliveryAttempt.findMany({ where: { project_id: 10, content_item_id: 1113 } });
    if (attempts.length !== 1 || attempts[0].id !== id || attempts[0].channel_id !== 164
        || attempts[0].idempotency_key !== a.idempotencyKey
        || !(reconcile ? ['pending', 'verification_required'] : ['pending']).includes(attempts[0].status)) throw new Error('[X1113_RECONCILE_ONLY]');
    const start = await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1113,
        work_item_id: a.workItemId, actor_id: a.actorId, command: startCommand, idempotency_key: a.idempotencyKey } });
    if (object(start?.before_state).request_hash !== xRequestHash(a)) throw new Error('[IDEMPOTENCY_CONFLICT]');
    return attempts[0];
}
export async function startX1113(input: Args) {
    const a = x1113BoundarySchema.parse(input);
    return prisma.$transaction(async tx => {
        const { task } = await xBoundary(tx, a, 'start');
        const prior = await tx.deliveryAttempt.findFirst({ where: { project_id: 10, content_item_id: 1113 } });
        if (prior) return { mode: 'verification_required', attempt_id: prior.id, retry_allowed: false };
        if (task.status !== 'browser_required') throw new Error('[X1113_START_STATE_INVALID]');
        const changed = await tx.contentItem.updateMany({ where: { id: 1113, project_id: 10,
            updated_at: task.updated_at, status: 'browser_required', publication_mode: 'browser_required' }, data: { status: 'publishing' } });
        if (changed.count !== 1) throw new Error('[X1113_CAS_CONFLICT]');
        const attempt = await tx.deliveryAttempt.create({ data: { project_id: 10, content_item_id: 1113, channel_id: 164,
            mode: 'assisted', status: 'pending', attempt_number: 1, requires_manual_confirmation: true,
            scheduled_at: task.schedule_at, idempotency_key: a.idempotencyKey } });
        await audit(tx, a, startCommand, { attempt_id: attempt.id, context_hash: xReadbackHash(a),
            client_runtime_guard_required: true, server_browser_verified: false }, xRequestHash(a));
        return { mode: 'started', attempt_id: attempt.id, retry_allowed: false };
    }, serial);
}
export async function preSubmitX1113(input: Args & { attemptId: number }) {
    const a = { ...x1113BoundarySchema.parse(input), attemptId: input.attemptId };
    return prisma.$transaction(async tx => {
        const { task } = await xBoundary(tx, a, 'submit');
        if (task.status !== 'publishing') throw new Error('[X1113_START_REQUIRED]');
        await pending(tx, a, a.attemptId);
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1113,
            actor_id: a.actorId, command: preCommand, idempotency_key: a.idempotencyKey } });
        if (prior) return { mode: 'verification_required', attempt_id: a.attemptId, submission_permitted: false, retry_allowed: false };
        const result = { mode: 'pre_submit_checked', attempt_id: a.attemptId, submission_permitted: true,
            account_ref: p.account, browser_profile: 'Innokenty', client_runtime_guard_required: true,
            server_browser_verified: false, retry_allowed: false };
        await audit(tx, a, preCommand, result, xReadbackHash(a));
        return result;
    }, serial);
}
export type X1113Confirm = Args & { attemptId: number; publicUrl: string; providerObjectId: string; publishedAt: string; evidenceSha256: string };
export async function confirmX1113(input: X1113Confirm) {
    const a = { ...input, ...x1113BoundarySchema.parse(input) };
    let url: URL;
    try { url = new URL(a.publicUrl); } catch { throw new Error('[X1113_PROVIDER_IDENTITY_INVALID]'); }
    if (url.origin !== 'https://x.com' || url.username || url.password || url.search || url.hash
        || !/^\d+$/.test(a.providerObjectId) || url.pathname !== `/naraHeTc/status/${a.providerObjectId}`
        || !/^[a-f0-9]{64}$/.test(a.evidenceSha256) || !Number.isFinite(Date.parse(a.publishedAt))
        || Date.parse(a.publishedAt) < Date.parse(p.schedule) || Date.parse(a.publishedAt) > Date.now() + 300000) throw new Error('[X1113_PROVIDER_IDENTITY_INVALID]');
    const fingerprint = xHash(JSON.stringify({ request: xReadbackHash(a), attempt: a.attemptId,
        url: a.publicUrl, id: a.providerObjectId, publishedAt: a.publishedAt, evidence: a.evidenceSha256 }));
    const replay = await prisma.$transaction(async tx => {
        await xOwner(tx, a);
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1113,
            actor_id: a.actorId, command: confirmCommand, idempotency_key: a.idempotencyKey } });
        if (!prior) return null;
        if (object(prior.before_state).request_hash !== fingerprint) throw new Error('[IDEMPOTENCY_CONFLICT]');
        const fact = await tx.publicationFact.findFirst({ where: { project_id: 10, content_item_id: 1113 } });
        if (!fact || fact.outcome !== 'published' || fact.provider_object_id !== a.providerObjectId
            || fact.public_url !== a.publicUrl || fact.published_at?.toISOString() !== new Date(a.publishedAt).toISOString()) {
            return { mode: 'verification_required', retry_allowed: false };
        }
        return object(prior.after_state);
    }, serial);
    if (replay) return replay;
    const result = { mode: 'published', provider_object_id: a.providerObjectId, public_url: a.publicUrl,
        published_at: a.publishedAt, attempt_id: a.attemptId, retry_allowed: false };
    await factService.record({ projectId: 10, taskId: 1113, actorId: a.actorId, artifactKind: 'post', outcome: 'published',
        confirmationMode: 'reconciled', publishedAt: a.publishedAt, publicUrl: a.publicUrl, providerObjectId: a.providerObjectId,
        evidence: { type: 'screenshot', ref: `sha256:${a.evidenceSha256}` }, beforeWrite: async tx => {
            const { task } = await xBoundary(tx, a, false);
            if (task.status !== 'publishing') throw new Error('[X1113_START_REQUIRED]');
            const attempt = await pending(tx, a, a.attemptId, true);
            const submit = await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1113,
                actor_id: a.actorId, command: preCommand, idempotency_key: a.idempotencyKey } });
            if (!submit || object(submit.after_state).attempt_id !== a.attemptId
                || object(submit.before_state).request_hash !== xReadbackHash(a)) throw new Error('[X1113_PRE_SUBMIT_PROOF_REQUIRED]');
            const earliest = Math.max(attempt.created_at.getTime(), submit.created_at.getTime()) - 120000;
            if (!Number.isFinite(earliest) || Date.parse(a.publishedAt) < earliest) throw new Error('[X1113_PUBLISHED_BEFORE_ATTEMPT]');
            const changed = await tx.deliveryAttempt.updateMany({ where: { id: a.attemptId, project_id: 10,
                content_item_id: 1113, status: { in: ['pending', 'verification_required'] }, idempotency_key: a.idempotencyKey },
            data: { status: 'delivered', actual_published_at: new Date(a.publishedAt), requires_manual_confirmation: false } });
            if (changed.count !== 1) throw new Error('[X1113_CAS_CONFLICT]');
            await audit(tx, a, confirmCommand, result, fingerprint);
        } });
    return result;
}
export async function uncertainX1113(input: Args & { attemptId: number }) {
    const a = { ...x1113BoundarySchema.parse(input), attemptId: input.attemptId };
    return prisma.$transaction(async tx => {
        await xBoundary(tx, a, false); await pending(tx, a, a.attemptId, true);
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1113,
            actor_id: a.actorId, command: 'ba_mark_x_task1113_browser_submission_uncertain', idempotency_key: a.idempotencyKey } });
        if (prior) return object(prior.after_state);
        const changed = await tx.deliveryAttempt.updateMany({ where: { id: a.attemptId, project_id: 10,
            content_item_id: 1113, status: { in: ['pending', 'verification_required'] }, idempotency_key: a.idempotencyKey },
        data: { status: 'verification_required', requires_manual_confirmation: true, error_message: 'X1113_RECONCILE_ONLY' } });
        if (changed.count !== 1) throw new Error('[X1113_CAS_CONFLICT]');
        const result = { mode: 'verification_required', attempt_id: a.attemptId, retry_allowed: false };
        await audit(tx, a, 'ba_mark_x_task1113_browser_submission_uncertain', result, xRequestHash(a));
        return result;
    }, serial);
}

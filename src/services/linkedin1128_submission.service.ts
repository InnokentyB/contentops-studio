import { Prisma } from '@prisma/client';
import prisma from '../db';
import publicationFactService from './publication_fact.service';
import { LINKEDIN1128 as p } from './linkedin1128_identity.service';
import { check1128, check1128Owner, submissionObject as object, submissionHash as hash,
    submissionRequestHash, type LinkedIn1128Submission as Args } from './linkedin1128_submission_guard';

const serial = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;
const startCommand = 'ba_start_linkedin_task1128_browser_submission';
const confirmCommand = 'ba_confirm_linkedin_task1128_browser_submission';
async function audit(tx: Prisma.TransactionClient, a: Args, command: string, after: Prisma.InputJsonObject, requestHash: string) {
    await tx.workflowEvent.create({ data: { project_id: 7, content_item_id: 1128, work_item_id: 1924,
        actor_id: a.actorId, command, idempotency_key: a.idempotencyKey,
        before_state: { request_hash: requestHash }, after_state: after } });
}
async function pending(tx: Prisma.TransactionClient, a: Args, attemptId: number) {
    const attempts = await tx.deliveryAttempt.findMany({ where: { project_id: 7, content_item_id: 1128 } });
    if (attempts.length !== 1 || attempts[0].id !== attemptId || attempts[0].status !== 'pending'
        || attempts[0].channel_id !== 6 || attempts[0].idempotency_key !== a.idempotencyKey) {
        throw new Error('[LINKEDIN1128_ATTEMPT_NOT_CONFIRMABLE]');
    }
    const start = await tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1128,
        work_item_id: 1924, actor_id: a.actorId, command: startCommand, idempotency_key: a.idempotencyKey } });
    if (object(start?.before_state).request_hash !== submissionRequestHash(a)) throw new Error('[IDEMPOTENCY_CONFLICT]');
}
export async function startLinkedIn1128(a: Args) {
    return prisma.$transaction(async tx => {
        const { task } = await check1128(tx, a);
        const prior = await tx.deliveryAttempt.findFirst({ where: { project_id: 7, content_item_id: 1128 } });
        if (prior) {
            if (prior.idempotency_key === a.idempotencyKey) await pending(tx, a, prior.id);
            return { mode: 'verification_required', attempt_id: prior.id, retry_allowed: false };
        }
        if (task.status !== 'browser_required') throw new Error('[LINKEDIN1128_START_STATE_INVALID]');
        const changed = await tx.contentItem.updateMany({ where: { id: 1128, project_id: 7,
            updated_at: task.updated_at, status: 'browser_required', publication_mode: 'browser_required' }, data: { status: 'publishing' } });
        if (changed.count !== 1) throw new Error('[LINKEDIN1128_CAS_CONFLICT]');
        const attempt = await tx.deliveryAttempt.create({ data: { project_id: 7, content_item_id: 1128, channel_id: 6,
            mode: 'assisted', status: 'pending', attempt_number: 1, requires_manual_confirmation: true,
            scheduled_at: task.schedule_at, idempotency_key: a.idempotencyKey } });
        await audit(tx, a, startCommand, { attempt_id: attempt.id, company_id: '97416172',
            author_evidence_sha256: a.authorEvidenceSha256, duplicate_check_reference: a.duplicateCheckReference }, submissionRequestHash(a));
        return { mode: 'started', attempt_id: attempt.id, retry_allowed: false };
    }, serial);
}
export async function preSubmitLinkedIn1128(a: Args & { attemptId: number }) {
    return prisma.$transaction(async tx => {
        const { task } = await check1128(tx, a);
        if (task.status !== 'publishing') throw new Error('[LINKEDIN1128_START_REQUIRED]');
        await pending(tx, a, a.attemptId);
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1128,
            actor_id: a.actorId, command: 'ba_pre_submit_linkedin_task1128_browser_submission', idempotency_key: a.idempotencyKey } });
        if (prior && object(prior.before_state).request_hash !== submissionRequestHash(a)) throw new Error('[IDEMPOTENCY_CONFLICT]');
        if (prior) return object(prior.after_state);
        const result = { mode: 'pre_submit_checked', attempt_id: a.attemptId,
            company_id: '97416172', author_evidence_sha256: a.authorEvidenceSha256,
            provider_identity_source: 'owning_publisher_browser_readback',
            server_provider_verification: false, retry_allowed: false };
        await audit(tx, a, 'ba_pre_submit_linkedin_task1128_browser_submission', result, submissionRequestHash(a));
        return result;
    }, serial);
}
export type LinkedIn1128Confirm = Args & { attemptId: number; publicUrl: string; providerObjectId: string;
    publishedAt: string; evidenceSha256: string };
export async function confirmLinkedIn1128(a: LinkedIn1128Confirm) {
    let url: URL;
    try { url = new URL(a.publicUrl); } catch { throw new Error('[LINKEDIN1128_PROVIDER_IDENTITY_INVALID]'); }
    if (url.protocol !== 'https:' || url.hostname !== 'www.linkedin.com' || url.username || url.password
        || url.port || url.search || url.hash || !/^urn:li:activity:\d+$/.test(a.providerObjectId)
        || url.pathname !== `/feed/update/${a.providerObjectId}/` || !/^[a-f0-9]{64}$/.test(a.evidenceSha256)
        || !Number.isFinite(Date.parse(a.publishedAt)) || Date.parse(a.publishedAt) < Date.parse(p.schedule)
        || Date.parse(a.publishedAt) > Date.now() + 300_000) throw new Error('[LINKEDIN1128_PROVIDER_IDENTITY_INVALID]');
    const requestHash = hash(JSON.stringify({ request: submissionRequestHash(a), id: a.providerObjectId,
        url: a.publicUrl, time: a.publishedAt, evidence: a.evidenceSha256, attempt: a.attemptId }));
    const replay = await prisma.$transaction(async tx => {
        await check1128Owner(tx, a);
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1128,
            actor_id: a.actorId, command: confirmCommand, idempotency_key: a.idempotencyKey } });
        if (!prior) return null;
        if (object(prior.before_state).request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
        const fact = await tx.publicationFact.findFirst({ where: { project_id: 7, content_item_id: 1128 } });
        if (!fact || fact.outcome !== 'published' || fact.provider_object_id !== a.providerObjectId
            || fact.public_url !== a.publicUrl || fact.published_at?.toISOString() !== new Date(a.publishedAt).toISOString()) {
            return { mode: 'verification_required', retry_allowed: false };
        }
        return object(prior.after_state);
    }, serial);
    if (replay) return replay;
    const result = { mode: 'published', provider_object_id: a.providerObjectId, public_url: a.publicUrl,
        published_at: a.publishedAt, attempt_id: a.attemptId, retry_allowed: false };
    await publicationFactService.record({ projectId: 7, taskId: 1128, actorId: a.actorId,
        artifactKind: 'post', outcome: 'published', confirmationMode: 'reconciled', publishedAt: a.publishedAt,
        publicUrl: a.publicUrl, providerObjectId: a.providerObjectId,
        evidence: { type: 'screenshot', ref: `sha256:${a.evidenceSha256}` }, beforeWrite: async tx => {
            const { task } = await check1128(tx, a);
            if (task.status !== 'publishing') throw new Error('[LINKEDIN1128_START_REQUIRED]');
            await pending(tx, a, a.attemptId);
            const submit = await tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1128,
                command: 'ba_pre_submit_linkedin_task1128_browser_submission', actor_id: a.actorId,
                idempotency_key: a.idempotencyKey }, orderBy: { id: 'desc' } });
            if (object(submit?.after_state).attempt_id !== a.attemptId) throw new Error('[LINKEDIN1128_PRE_SUBMIT_REQUIRED]');
            const changed = await tx.deliveryAttempt.updateMany({ where: { id: a.attemptId, project_id: 7,
                content_item_id: 1128, status: 'pending', idempotency_key: a.idempotencyKey }, data: {
                status: 'delivered', actual_published_at: new Date(a.publishedAt), requires_manual_confirmation: false } });
            if (changed.count !== 1) throw new Error('[LINKEDIN1128_CAS_CONFLICT]');
            await audit(tx, a, confirmCommand, result, requestHash);
        } });
    return result;
}
export async function uncertainLinkedIn1128(a: Args & { attemptId: number }) {
    return prisma.$transaction(async tx => {
        await check1128(tx, a); await pending(tx, a, a.attemptId);
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1128,
            actor_id: a.actorId, command: 'ba_mark_linkedin_task1128_browser_submission_uncertain', idempotency_key: a.idempotencyKey } });
        if (prior) return object(prior.after_state);
        const changed = await tx.deliveryAttempt.updateMany({ where: { id: a.attemptId, project_id: 7, content_item_id: 1128,
            status: 'pending', idempotency_key: a.idempotencyKey }, data: {
            requires_manual_confirmation: true, error_message: 'LINKEDIN1128_UNCERTAIN_RECONCILE_ONLY' } });
        if (changed.count !== 1) throw new Error('[LINKEDIN1128_CAS_CONFLICT]');
        await audit(tx, a, 'ba_mark_linkedin_task1128_browser_submission_uncertain', {
            attempt_id: a.attemptId, retry_allowed: false }, submissionRequestHash(a));
        return { mode: 'verification_required', attempt_id: a.attemptId, retry_allowed: false };
    }, serial);
}

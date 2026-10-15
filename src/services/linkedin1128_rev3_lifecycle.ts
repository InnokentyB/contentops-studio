import { Prisma } from '@prisma/client';
import prisma from '../db';
import publicationFactService from './publication_fact.service';
import { LINKEDIN1128R3 as p } from './linkedin1128_rev3_contract';
import { check1128Rev3, check1128Rev3Owner, submissionObject as object, submissionHash as hash,
    submissionRequestHash, submissionReadbackHash, type LinkedIn1128Rev3Submission as Args } from './linkedin1128_rev3_guard';

const serial = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;
const startCommand = 'ba_start_linkedin_task1128_rev3_browser_submission';
async function audit(tx: Prisma.TransactionClient, a: Args, command: string, after: Prisma.InputJsonObject, requestHash: string) {
    await tx.workflowEvent.create({ data: { project_id: 7, content_item_id: 1128, work_item_id: a.workItemId,
        actor_id: a.actorId, command, idempotency_key: a.idempotencyKey,
        before_state: { request_hash: requestHash }, after_state: after } });
}
async function pending(tx: Prisma.TransactionClient, a: Args, attemptId: number,
    options: { verifyStartEvidence?: boolean; allowReconciliation?: boolean } = {}) {
    const attempts = await tx.deliveryAttempt.findMany({ where: { project_id: 7, content_item_id: 1128, id: { not: 38 } } });
    if (!options.allowReconciliation && attempts.length === 1 && (['uncertain', 'verification_required'].includes(attempts[0].status)
        || attempts[0].error_message === 'LINKEDIN1128_REV3_UNCERTAIN_RECONCILE_ONLY')) throw new Error('[LINKEDIN1128_REV3_RECONCILE_ONLY]');
    if (attempts.length !== 1 || attempts[0].id !== attemptId
        || !['pending', ...(options.allowReconciliation ? ['uncertain', 'verification_required'] : [])].includes(attempts[0].status)
        || attempts[0].channel_id !== 6 || attempts[0].idempotency_key !== a.idempotencyKey) {
        throw new Error('[LINKEDIN1128_REV3_ATTEMPT_NOT_CONFIRMABLE]');
    }
    const start = await tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1128,
        work_item_id: a.workItemId, actor_id: a.actorId, command: startCommand, idempotency_key: a.idempotencyKey } });
    if (object(start?.before_state).request_hash !== submissionRequestHash(a)) throw new Error('[IDEMPOTENCY_CONFLICT]');
    if (options.verifyStartEvidence && object(start?.after_state).readback_hash !== submissionReadbackHash(a)) throw new Error('[IDEMPOTENCY_CONFLICT]');
    return attempts[0];
}
export async function startLinkedIn1128Rev3(a: Args) {
    return prisma.$transaction(async tx => {
        const { task } = await check1128Rev3(tx, a);
        const prior = await tx.deliveryAttempt.findFirst({ where: { project_id: 7, content_item_id: 1128, id: { not: 38 } } });
        if (prior) {
            if (prior.idempotency_key === a.idempotencyKey && prior.status === 'pending') await pending(tx, a, prior.id, { verifyStartEvidence: true });
            return { mode: 'verification_required', attempt_id: prior.id, retry_allowed: false };
        }
        if (task.status !== 'browser_required') throw new Error('[LINKEDIN1128_REV3_START_STATE_INVALID]');
        const changed = await tx.contentItem.updateMany({ where: { id: 1128, project_id: 7,
            updated_at: task.updated_at, status: 'browser_required', publication_mode: 'browser_required' }, data: { status: 'publishing' } });
        if (changed.count !== 1) throw new Error('[LINKEDIN1128_REV3_CAS_CONFLICT]');
        const attempt = await tx.deliveryAttempt.create({ data: { project_id: 7, content_item_id: 1128, channel_id: 6,
            mode: 'assisted', status: 'pending', attempt_number: 2, requires_manual_confirmation: true,
            scheduled_at: task.schedule_at, idempotency_key: a.idempotencyKey } });
        await audit(tx, a, startCommand, { attempt_id: attempt.id, company_id: '97416172',
            readback_hash: submissionReadbackHash(a),
            author_evidence_sha256: a.authorEvidenceSha256, duplicate_check_reference: a.duplicateCheckReference }, submissionRequestHash(a));
        return { mode: 'started', attempt_id: attempt.id, retry_allowed: false };
    }, serial);
}
export async function preSubmitLinkedIn1128Rev3(a: Args & { attemptId: number }) {
    if (!a.actionTimeConfirmationReference || a.actionTimeConfirmationReference.length < 10) throw new Error('[LINKEDIN1128_REV3_ACTION_TIME_CONFIRMATION_REQUIRED]');
    if (!a.observedEditorText || hash(a.observedEditorText.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim()) !== p.body) throw new Error('[LINKEDIN1128_REV3_NATIVE_EDITOR_MISMATCH]');
    return prisma.$transaction(async tx => {
        const { task } = await check1128Rev3(tx, a);
        if (task.status !== 'publishing') throw new Error('[LINKEDIN1128_REV3_START_REQUIRED]');
        await pending(tx, a, a.attemptId);
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1128,
            actor_id: a.actorId, command: 'ba_pre_submit_linkedin_task1128_rev3_browser_submission', idempotency_key: a.idempotencyKey } });
        if (prior && object(prior.before_state).request_hash !== submissionReadbackHash(a)) throw new Error('[IDEMPOTENCY_CONFLICT]');
        if (prior) return { mode: 'verification_required', attempt_id: a.attemptId, submission_permitted: false, retry_allowed: false };
        const result = { mode: 'pre_submit_checked', attempt_id: a.attemptId,
            submission_permitted: true,
            company_id: '97416172', author_evidence_sha256: a.authorEvidenceSha256,
            provider_identity_source: 'owning_publisher_browser_readback',
            server_provider_verification: false, retry_allowed: false };
        await audit(tx, a, 'ba_pre_submit_linkedin_task1128_rev3_browser_submission', result, submissionReadbackHash(a));
        return result;
    }, serial);
}
export type LinkedIn1128Rev3Confirm = Args & { attemptId: number; publicUrl: string; providerObjectId: string;
    publishedAt: string; evidenceSha256: string; observedPostText: string; observedAuthorCompanyId: '97416172'; observedPublishedAt: string };
export async function confirmLinkedIn1128Rev3(a: LinkedIn1128Rev3Confirm, reconcile = false) {
    const confirmCommand = reconcile ? 'ba_reconcile_linkedin_task1128_rev3_browser_submission' : 'ba_confirm_linkedin_task1128_rev3_browser_submission';
    let url: URL;
    try { url = new URL(a.publicUrl); } catch { throw new Error('[LINKEDIN1128_REV3_PROVIDER_IDENTITY_INVALID]'); }
    if (url.protocol !== 'https:' || url.hostname !== 'www.linkedin.com' || url.username || url.password
        || url.port || url.search || url.hash || !/^urn:li:activity:\d+$/.test(a.providerObjectId)
        || url.pathname !== `/feed/update/${a.providerObjectId}/` || !/^[a-f0-9]{64}$/.test(a.evidenceSha256)
        || typeof a.observedPostText !== 'string' || hash(a.observedPostText.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim()) !== p.body
        || a.observedAuthorCompanyId !== '97416172' || a.observedPublishedAt !== a.publishedAt
        || !Number.isFinite(Date.parse(a.publishedAt)) || Date.parse(a.publishedAt) < Date.parse(p.schedule)
        || Date.parse(a.publishedAt) > Date.now() + 300_000) throw new Error('[LINKEDIN1128_REV3_PROVIDER_IDENTITY_INVALID]');
    const requestHash = hash(JSON.stringify({ request: submissionReadbackHash(a), id: a.providerObjectId,
        url: a.publicUrl, time: a.publishedAt, evidence: a.evidenceSha256, attempt: a.attemptId }));
    const replay = await prisma.$transaction(async tx => {
        await check1128Rev3Owner(tx, a);
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1128,
            actor_id: a.actorId, command: { in: ['ba_reconcile_linkedin_task1128_rev3_browser_submission', 'ba_confirm_linkedin_task1128_rev3_browser_submission'] }, idempotency_key: a.idempotencyKey } });
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
        published_at: a.publishedAt, attempt_id: a.attemptId, retry_allowed: false,
        confirmation_source: 'owning_publisher_native_readback', server_provider_verification: false };
    await publicationFactService.record({ projectId: 7, taskId: 1128, actorId: a.actorId,
        browserWorkItemId: a.workItemId,
        artifactKind: 'post', outcome: 'published', confirmationMode: reconcile ? 'reconciled' : 'manual', publishedAt: a.publishedAt,
        publicUrl: a.publicUrl, providerObjectId: a.providerObjectId,
        evidence: { type: 'screenshot', ref: `sha256:${a.evidenceSha256}` }, beforeWrite: async tx => {
            const { task } = await check1128Rev3(tx, a, reconcile);
            if (task.status !== 'publishing') throw new Error('[LINKEDIN1128_REV3_START_REQUIRED]');
            const attempt = await pending(tx, a, a.attemptId, { allowReconciliation: true });
            const submit = await tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1128,
                command: 'ba_pre_submit_linkedin_task1128_rev3_browser_submission', actor_id: a.actorId,
                idempotency_key: a.idempotencyKey }, orderBy: { id: 'desc' } });
            if (!submit || object(submit.after_state).attempt_id !== a.attemptId) throw new Error('[LINKEDIN1128_REV3_PRE_SUBMIT_REQUIRED]');
            if (object(submit?.before_state).request_hash !== submissionReadbackHash(a)) throw new Error('[IDEMPOTENCY_CONFLICT]');
            const earliest = Math.max(attempt.created_at.getTime(), submit.created_at.getTime()) - 120_000;
            if (!Number.isFinite(earliest) || Date.parse(a.publishedAt) < earliest) throw new Error('[LINKEDIN1128_REV3_PUBLISHED_BEFORE_ATTEMPT]');
            const changed = await tx.deliveryAttempt.updateMany({ where: { id: a.attemptId, project_id: 7,
                content_item_id: 1128, status: { in: ['pending', 'uncertain', 'verification_required'] }, idempotency_key: a.idempotencyKey }, data: {
                status: 'delivered', actual_published_at: new Date(a.publishedAt), requires_manual_confirmation: false } });
            if (changed.count !== 1) throw new Error('[LINKEDIN1128_REV3_CAS_CONFLICT]');
            await audit(tx, a, confirmCommand, result, requestHash);
        } });
    return result;
}
export async function uncertainLinkedIn1128Rev3(a: Args & { attemptId: number }) {
    return prisma.$transaction(async tx => {
        await check1128Rev3(tx, a, true); await pending(tx, a, a.attemptId, { allowReconciliation: true });
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: 7, content_item_id: 1128,
            actor_id: a.actorId, command: 'ba_mark_linkedin_task1128_rev3_browser_submission_uncertain', idempotency_key: a.idempotencyKey } });
        if (prior) return object(prior.after_state);
        const changed = await tx.deliveryAttempt.updateMany({ where: { id: a.attemptId, project_id: 7, content_item_id: 1128,
            status: { in: ['pending', 'uncertain', 'verification_required'] }, idempotency_key: a.idempotencyKey }, data: {
            status: 'verification_required', requires_manual_confirmation: true, error_message: 'LINKEDIN1128_REV3_UNCERTAIN_RECONCILE_ONLY' } });
        if (changed.count !== 1) throw new Error('[LINKEDIN1128_REV3_CAS_CONFLICT]');
        await audit(tx, a, 'ba_mark_linkedin_task1128_rev3_browser_submission_uncertain', {
            attempt_id: a.attemptId, retry_allowed: false }, submissionRequestHash(a));
        return { mode: 'verification_required', attempt_id: a.attemptId, retry_allowed: false };
    }, serial);
}

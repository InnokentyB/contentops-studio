import { Prisma } from '@prisma/client';
import prisma from '../db';
import publicationFactService from './publication_fact.service';
import { THREADS1114 as p } from './threads1114_contract';
import { checked1114, object, ownerManifest, ownerOnly, requestHash } from './threads1114_store_guard';
import type { Threads1114Request as Args, Threads1114Result } from './threads1114_execution';

const serial = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;
async function event(tx: Prisma.TransactionClient, a: Args, command: string, after: Prisma.InputJsonObject, operation: string) {
    await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1114,
        actor_id: a.actorId, command, idempotency_key: a.idempotencyKey,
        before_state: { request_hash: requestHash(a, operation), approval_reference: a.approvalReference }, after_state: after } });
}
export async function replay1114(a: Args, operation: 'release' | 'send') {
    return prisma.$transaction(async tx => {
        await ownerOnly(tx, a);
        const command = operation === 'release' ? p.releaseCommand : p.sendCommand;
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1114,
            command, idempotency_key: a.idempotencyKey } });
        if (prior) {
            if (object(prior.before_state).request_hash !== requestHash(a, operation)) throw new Error('[IDEMPOTENCY_CONFLICT]');
            if (operation === 'send') {
                const proof = object(prior.after_state);
                const fact = await tx.publicationFact.findFirst({ where: { project_id: 10, content_item_id: 1114 } });
                if (!fact || fact.outcome !== 'published' || fact.provider_object_id !== proof.provider_object_id
                    || fact.public_url !== proof.public_url || fact.published_at?.toISOString() !== new Date(String(proof.published_at)).toISOString()) {
                    return { mode: 'verification_required', retry_allowed: false, task_id: 1114 };
                }
            }
            return object(prior.after_state);
        }
        if (operation === 'send') {
            const claim = await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1114,
                command: `${p.sendCommand}:claim`, idempotency_key: a.idempotencyKey } });
            if (claim && object(claim.before_state).request_hash !== requestHash(a, 'send')) throw new Error('[IDEMPOTENCY_CONFLICT]');
            const [attempt, fact] = await Promise.all([
                tx.deliveryAttempt.findFirst({ where: { project_id: 10, content_item_id: 1114 } }),
                tx.publicationFact.findFirst({ where: { project_id: 10, content_item_id: 1114 } })
            ]);
            if (claim || attempt || fact) return { mode: 'verification_required', retry_allowed: false, task_id: 1114 };
        }
        return null;
    }, serial);
}
export async function release1114(a: Args) {
    if (a.idempotencyKey !== a.releaseIdempotencyKey) throw new Error('[THREADS1114_RELEASE_KEY_MISMATCH]');
    for (let retry = 0; retry < 3; retry += 1) {
        try { return await prisma.$transaction(async tx => {
        await ownerOnly(tx, a);
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1114,
            actor_id: a.actorId, command: p.releaseCommand, idempotency_key: a.idempotencyKey } });
        if (prior) {
            if (object(prior.before_state).request_hash !== requestHash(a, 'release')) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return object(prior.after_state);
        }
        const { task } = await checked1114(tx, a, false);
        const changed = await tx.contentItem.updateMany({ where: { id: 1114, project_id: 10,
            updated_at: task.updated_at, publication_mode: 'approval_required', status: 'ready_for_execution' },
        data: { publication_mode: 'owner_released' } });
        if (changed.count !== 1) throw new Error('[THREADS1114_CAS_CONFLICT]');
        const proof = { publication_authorized: true, task_id: 1114, channel_id: 138, accepted_revision: 1,
            actor_id: a.actorId, release_idempotency_key: a.idempotencyKey,
            body_sha256: p.bodySha256, manifest_checksum: p.manifest, threads_user_id: p.userId,
            schedule_at: p.schedule, publish_at: p.schedule, decision_id: 309, selected_asset_id: null };
        await event(tx, a, p.releaseCommand, proof, 'release');
        return proof;
    }, serial); } catch (error: unknown) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || retry === 2) throw error;
        }
    }
    throw new Error('[THREADS1114_RELEASE_CAS_CONFLICT]');
}
export async function claim1114(a: Args) {
    return prisma.$transaction(async tx => {
        const { task } = await checked1114(tx, a, true);
        const changed = await tx.contentItem.updateMany({ where: { id: 1114, project_id: 10,
            updated_at: task.updated_at, status: 'ready_for_execution', publication_mode: 'owner_released' }, data: { status: 'publishing' } });
        if (changed.count !== 1) throw new Error('[THREADS1114_CAS_CONFLICT]');
        const attempt = await tx.deliveryAttempt.create({ data: { project_id: 10, content_item_id: 1114,
            channel_id: 138, mode: 'automatic', status: 'pending', attempt_number: 1,
            idempotency_key: a.idempotencyKey, scheduled_at: task.schedule_at, requires_manual_confirmation: true } });
        await event(tx, a, `${p.sendCommand}:claim`, { attempt_id: attempt.id }, 'send');
        return { id: attempt.id, body: task.draft_text || '' };
    }, serial);
}
export async function confirm1114(a: Args, attemptId: number, result: Threads1114Result) {
    const response = { mode: 'published', task_id: 1114, provider_object_id: result.id,
        public_url: result.url, published_at: result.publishedAt, retry_allowed: false };
    await publicationFactService.record({ projectId: 10, taskId: 1114, actorId: a.actorId,
        artifactKind: 'post', outcome: 'published', confirmationMode: 'automatic',
        publishedAt: result.publishedAt, publicUrl: result.url, providerObjectId: result.id,
        evidence: { type: 'api', ref: result.id }, beforeWrite: async tx => {
            await checked1114(tx, a, true, attemptId);
            const updated = await tx.deliveryAttempt.updateMany({ where: { id: attemptId, project_id: 10,
                content_item_id: 1114, status: 'pending', idempotency_key: a.idempotencyKey },
            data: { status: 'delivered', actual_published_at: new Date(result.publishedAt), requires_manual_confirmation: false } });
            if (updated.count !== 1) throw new Error('[THREADS1114_ATTEMPT_CONFLICT]');
            await event(tx, a, p.sendCommand, response, 'send');
        } });
    return response;
}
export async function uncertain1114(a: Args, attemptId: number) {
    await prisma.$transaction(async tx => {
        await ownerManifest(tx, a);
        const updated = await tx.deliveryAttempt.updateMany({ where: { id: attemptId, project_id: 10,
            content_item_id: 1114, idempotency_key: a.idempotencyKey, status: 'pending' },
        data: { requires_manual_confirmation: true, error_message: 'THREADS1114_OUTCOME_UNCERTAIN_RECONCILE_ONLY' } });
        if (updated.count !== 1) throw new Error('[THREADS1114_ATTEMPT_CONFLICT]');
        await event(tx, a, `${p.sendCommand}:uncertain`, { attempt_id: attemptId, retry_allowed: false }, 'send');
    }, serial);
}

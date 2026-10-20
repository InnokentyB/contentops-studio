import {lockManualTransportMutation,withManualTransportMutation} from './manual_publication_transport_projection';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import dzenService from './dzen.service';
import publicationFactService from './publication_fact.service';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import { DZEN1045 } from './dzen_task1045_resume_contract';
import {
    DZEN1045_AUTHORIZATION_KEY,
    DZEN1045_NEW_DRAFT_COMMAND,
    DZEN1045_RECOVERY_MANIFEST
} from './dzen_task1045_new_draft_recovery.service';
import {
    DZEN1045_SECOND_ATTEMPT,
    type Dzen1045SecondAttemptDraftProof,
    type Dzen1045SecondAttemptPublication
} from './dzen_task1045_second_attempt_contract';

type Task = Prisma.ContentItemGetPayload<{
    include: { channel: true; selected_asset: true; publication_fact: true };
}>;

export type Dzen1045SecondAttemptRecoveryArgs = {
    projectId: 10;
    taskId: 1045;
    actorId: string;
    expectedManifestChecksum: typeof DZEN1045_RECOVERY_MANIFEST;
    expectedAttemptIdempotencyKey: typeof DZEN1045_SECOND_ATTEMPT.attemptKey;
    expectedFailedAt: typeof DZEN1045_SECOND_ATTEMPT.failedAt;
    ownerAuthorizationReference: string;
    idempotencyKey: typeof DZEN1045_SECOND_ATTEMPT.resumeKey;
    confirm?: boolean;
};

function object(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}

function string(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function assetChecksum(task: Task): string {
    const provenance = object(task.selected_asset?.provenance);
    return string(object(provenance.planner_storage).sha256 || provenance.sha256);
}

/** Fail closed unless the task is the exact frozen second pre-submit incident. */
export function assertDzen1045SecondAttemptState(task: Task | null,
    hashBody: (body: string) => string = body => createHash('sha256').update(body).digest('hex')): {
    task: Task;
    delivery: Record<string, unknown>;
} {
    const delivery = object(object(task?.quality_report).publication_task_delivery);
    if (!task || task.id !== 1045 || task.project_id !== 10 || task.channel_id !== 116
        || task.channel?.type !== 'dzen' || task.channel.is_active !== true
        || task.status !== 'publishing' || task.publication_mode !== 'owner_released'
        || task.content_revision !== 4 || task.accepted_revision !== 4 || task.text_state !== 'accepted'
        || hashBody(task.draft_text || '') !== DZEN1045.bodySha
        || task.visual_placement !== 'article_cover' || task.visual_state !== 'APPROVED'
        || task.visual_decision_version !== 1 || task.selected_asset_id !== 129
        || task.selected_asset?.id !== 129 || task.selected_asset.status !== 'approved'
        || task.selected_asset.content_revision !== 4 || assetChecksum(task) !== DZEN1045.assetSha
        || task.publication_fact || task.published_link
        || delivery.state !== 'provider_result_uncertain'
        || delivery.idempotency_key !== DZEN1045_SECOND_ATTEMPT.attemptKey
        || delivery.failed_at !== DZEN1045_SECOND_ATTEMPT.failedAt
        || delivery.retry_via_api !== false
        || !string(delivery.error).includes(`[${DZEN1045_SECOND_ATTEMPT.errorCode}]`)) {
        throw new Error('[DZEN1045_SECOND_ATTEMPT_GUARD_FAILED] Exact frozen pre-submit incident changed');
    }
    return { task, delivery };
}

function assertArgs(args: Dzen1045SecondAttemptRecoveryArgs): number {
    const actor = /^user:(\d+)$/.exec(args.actorId);
    if (!actor || args.projectId !== 10 || args.taskId !== 1045
        || args.expectedManifestChecksum !== DZEN1045_RECOVERY_MANIFEST
        || args.expectedAttemptIdempotencyKey !== DZEN1045_SECOND_ATTEMPT.attemptKey
        || args.expectedFailedAt !== DZEN1045_SECOND_ATTEMPT.failedAt
        || args.idempotencyKey !== DZEN1045_SECOND_ATTEMPT.resumeKey
        || !args.ownerAuthorizationReference.trim()) {
        throw new Error('[DZEN1045_SECOND_ATTEMPT_SCOPE_MISMATCH]');
    }
    return Number(actor[1]);
}

function loadTask(database: typeof prisma): Promise<Task | null> {
    return database.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
        include: { channel: true, selected_asset: true, publication_fact: true } });
}

async function authoritativeReadback() {
    const [fact, checkpoints] = await Promise.all([
        prisma.publicationFact.findFirst({ where: { project_id: 10, content_item_id: 1045 } }),
        prisma.metricSnapshot.findMany({ where: { project_id: 10, content_item_id: 1045, channel_id: 116 },
            orderBy: { id: 'asc' } })
    ]);
    return { publication_fact_id: fact?.id || null, public_url: fact?.public_url || null,
        provider_object_id: fact?.provider_object_id || null,
        checkpoint_ids: checkpoints.map(checkpoint => checkpoint.id),
        checkpoints: checkpoints.map(checkpoint => ({ id: checkpoint.id, checkpoint: checkpoint.checkpoint,
            channel_id: checkpoint.channel_id, collection_status: checkpoint.collection_status })) };
}

async function recordConfirmedPublication(args: Dzen1045SecondAttemptRecoveryArgs,
    publication: Dzen1045SecondAttemptPublication, mode: 'reconciled' | 'submitted') {
    const providerEvent = await prisma.workflowEvent.findFirst({ where: {
        project_id: 10, content_item_id: 1045, command: 'dzen1045_second_attempt_provider_confirmed',
        idempotency_key: DZEN1045_SECOND_ATTEMPT.resumeKey
    } });
    if (!providerEvent) await withManualTransportMutation(prisma,args,tx=>tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
        actor_id: args.actorId, command: 'dzen1045_second_attempt_provider_confirmed',
        idempotency_key: DZEN1045_SECOND_ATTEMPT.resumeKey,
        after_state: { ...publication, recovery_mode: mode } as Prisma.InputJsonValue } }));
    const fact = await publicationFactService.record({ projectId: 10, taskId: 1045, actorId: args.actorId,
        artifactKind: 'article', outcome: 'published', publicUrl: publication.public_url,
        providerObjectId: publication.provider_object_id, publishedAt: publication.published_at,
        confirmationMode: mode === 'reconciled' ? 'reconciled' : 'automatic',
        evidence: { type: 'public_url', ref: publication.public_url }, utmStatus: 'not_applicable',
        note: mode === 'reconciled'
            ? 'Reconciled exact public task1045 object from the second bounded attempt; no click performed.'
            : 'Completed one final click on the exact task1045 draft from the second bounded attempt.' });
    const current = await prisma.contentItem.findFirst({ where: { id: 1045, project_id: 10 } });
    const quality = object(current?.quality_report);
    const delivery = object(quality.publication_task_delivery);
    await withManualTransportMutation(prisma,args,tx=>tx.contentItem.update({ where: { id: 1045 }, data: { quality_report: {
        ...quality, publication_task_delivery: { ...delivery, state: 'provider_confirmed',
            idempotency_key: DZEN1045_SECOND_ATTEMPT.attemptKey,
            recovery_idempotency_key: DZEN1045_SECOND_ATTEMPT.resumeKey,
            provider_object_id: publication.provider_object_id, permalink: publication.public_url,
            final_submit_count: mode === 'submitted' ? 1 : 0, completed_at: new Date().toISOString() }
    } as Prisma.InputJsonValue } }));
    return { fact, readback: await authoritativeReadback() };
}

function confirmedPublication(eventState: unknown): {
    publication: Dzen1045SecondAttemptPublication;
    mode: 'reconciled' | 'submitted';
} | null {
    const state = object(eventState);
    const mode = state.recovery_mode;
    if (!['reconciled', 'submitted'].includes(string(mode))
        || state.public_body_matches !== true || state.public_asset_matches !== true) return null;
    const publication = {
        public_url: string(state.public_url), provider_object_id: string(state.provider_object_id),
        published_at: string(state.published_at), public_body_matches: true as const,
        public_asset_matches: true as const, checked_at: string(state.checked_at)
    };
    if (!publication.public_url || !publication.provider_object_id || !publication.published_at) return null;
    return { publication, mode: mode as 'reconciled' | 'submitted' };
}

/** Owner-only task-specific recovery for the frozen second task1045 attempt. */
export async function reconcileOrResumeDzenTask1045SecondAttempt(args: Dzen1045SecondAttemptRecoveryArgs) {
    const userId = assertArgs(args);
    const [member, manifest] = await Promise.all([
        prisma.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: userId } } }),
        loadAgentWorkspaceManifest(10, userId)
    ]);
    if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    await withManualTransportMutation(prisma,args,async()=>undefined);
    if (manifest.checksum !== DZEN1045_RECOVERY_MANIFEST) throw new Error('[STALE_MANIFEST]');
    const [prior, providerEvent] = await Promise.all([
        prisma.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
            command: DZEN1045_SECOND_ATTEMPT.command, idempotency_key: DZEN1045_SECOND_ATTEMPT.resumeKey },
            orderBy: { id: 'desc' } }),
        prisma.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
            command: 'dzen1045_second_attempt_provider_confirmed',
            idempotency_key: DZEN1045_SECOND_ATTEMPT.resumeKey }, orderBy: { id: 'desc' } })
    ]);
    if (prior) {
        const confirmed = confirmedPublication(providerEvent?.after_state);
        if (!confirmed) {
            throw new Error('[DZEN1045_SECOND_ATTEMPT_ALREADY_CLAIMED] Read fact; never click again');
        }
        const completed = await recordConfirmedPublication(args, confirmed.publication, confirmed.mode);
        return { mode: confirmed.mode, publication: confirmed.publication,
            publication_fact_id: completed.fact.publication_fact.id,
            created_checkpoints: completed.fact.created_checkpoints,
            authoritative_readback: completed.readback, replayed: true };
    }
    const current = assertDzen1045SecondAttemptState(await loadTask(prisma));
    const [authorization, claim, decision] = await Promise.all([
        prisma.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
            command: DZEN1045_NEW_DRAFT_COMMAND, idempotency_key: DZEN1045_AUTHORIZATION_KEY },
            orderBy: { id: 'desc' } }),
        prisma.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
            command: 'ba_publish_dzen_task1045_claim',
            idempotency_key: DZEN1045_SECOND_ATTEMPT.attemptKey }, orderBy: { id: 'desc' } }),
        prisma.artDirectionDecision.findFirst({ where: { id: 267, project_id: 10, content_item_id: 1045,
            source_content_revision: 4, decision_version: 1, decision: 'GENERATE', channel: 'dzen',
            placement: 'article_cover', status: 'active' } })
    ]);
    if (!authorization || !decision || !claim || object(claim.after_state).status !== 'publishing'
        || object(claim.after_state).channel_id !== 116) {
        throw new Error('[DZEN1045_SECOND_ATTEMPT_DURABLE_PROOF_REQUIRED]');
    }
    const secondAttemptClaim = claim;
    const config = resolveEffectiveChannelConfig('dzen', current.task.channel?.config || {});
    if (string(config.channel_id) !== DZEN1045.publisherId) {
        throw new Error('[DZEN1045_PUBLISHER_ID_MISMATCH]');
    }
    let claimed = false;
    try {
        const result = await dzenService.recoverTask1045SecondAttempt(config, current.task.draft_text || '', {
            confirm: args.confirm === true, idempotencyKey: args.idempotencyKey
        }, async (proof: Dzen1045SecondAttemptDraftProof) => {
            const changed = await prisma.$transaction(async tx => {
            await lockManualTransportMutation(tx,args);
                const [owner, latest] = await Promise.all([
                    tx.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: userId } } }),
                    loadTask(tx as typeof prisma)
                ]);
                if (owner?.role !== 'owner') return false;
                const guarded = assertDzen1045SecondAttemptState(latest);
                if (await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
                    command: DZEN1045_SECOND_ATTEMPT.command,
                    idempotency_key: DZEN1045_SECOND_ATTEMPT.resumeKey } })) return false;
                const updated = await tx.contentItem.updateMany({ where: { id: 1045, project_id: 10,
                    channel_id: 116, status: 'publishing', publication_mode: 'owner_released',
                    content_revision: 4, accepted_revision: 4, selected_asset_id: 129,
                    quality_report: { equals: latest!.quality_report || {} }, publication_fact: { is: null },
                    published_link: null }, data: { quality_report: { ...object(latest!.quality_report),
                    publication_task_delivery: { ...guarded.delivery, state: 'second_attempt_draft_resume_started',
                        draft_id: proof.draftId, recovery_idempotency_key: DZEN1045_SECOND_ATTEMPT.resumeKey,
                        owner_authorization_reference: args.ownerAuthorizationReference,
                        resume_started_at: new Date().toISOString(), retry_via_api: false,
                        final_submit_count: 0 }
                } as Prisma.InputJsonValue } });
                if (updated.count !== 1) return false;
                await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
                    actor_id: args.actorId, command: DZEN1045_SECOND_ATTEMPT.command,
                    idempotency_key: DZEN1045_SECOND_ATTEMPT.resumeKey,
                    before_state: { second_attempt_claim_event_id: secondAttemptClaim.id,
                        publication_task_delivery: guarded.delivery } as Prisma.InputJsonValue,
                    after_state: { state: 'second_attempt_draft_resume_started', proof,
                        body_sha256: DZEN1045.bodySha, asset_sha256: DZEN1045.assetSha,
                        attempt_idempotency_key: DZEN1045_SECOND_ATTEMPT.attemptKey,
                        owner_authorization_reference: args.ownerAuthorizationReference } as Prisma.InputJsonValue } });
                return true;
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
            claimed = changed;
            return changed;
        });
        if (result.mode === 'preview') return { ...result, published: false,
            second_attempt_claim_event_id: secondAttemptClaim.id };
        const confirmed = await recordConfirmedPublication(args, result.publication, result.mode);
        return { ...result, publication_fact_id: confirmed.fact.publication_fact.id,
            created_checkpoints: confirmed.fact.created_checkpoints,
            authoritative_readback: confirmed.readback };
    } catch (error: unknown) {
        if (claimed) {
            const task = await prisma.contentItem.findFirst({ where: { id: 1045, project_id: 10 } });
            const quality = object(task?.quality_report);
            const delivery = object(quality.publication_task_delivery);
            await withManualTransportMutation(prisma,args,async tx=>{
                await tx.contentItem.update({ where: { id: 1045 }, data: { quality_report: { ...quality,
                    publication_task_delivery: { ...delivery, state: 'second_attempt_resume_uncertain',
                        retry_via_api: false, final_submit_may_have_been_attempted: true,
                        error: error instanceof Error ? error.message : 'Unknown recovery error',
                        failed_at: new Date().toISOString() }
                } as Prisma.InputJsonValue } });
                await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
                    actor_id: args.actorId, command: 'dzen1045_second_attempt_requires_reconciliation',
                    idempotency_key: DZEN1045_SECOND_ATTEMPT.resumeKey,
                    after_state: { state: 'uncertain', retry_via_api: false,
                        final_submit_may_have_been_attempted: true } } });
            });
        }
        throw error;
    }
}

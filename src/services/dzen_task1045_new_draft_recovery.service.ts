import {lockManualTransportMutation,withManualTransportMutation} from './manual_publication_transport_projection';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import dzenService from './dzen.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import { DZEN1045 } from './dzen_task1045_resume_contract';

export const DZEN1045_RECOVERY_MANIFEST =
    'sha256:6ceb5c1c2199d8c1915beeb622a9791ff9c1b877d02649c8e69acd0d173e46d8';
export const DZEN1045_NEW_DRAFT_COMMAND = 'ba_authorize_dzen_task1045_new_draft_retry';
export const DZEN1045_AUTHORIZATION_KEY = 'dzen-p10-1045-r4-new-draft-authorization-20261010-01';

export type Dzen1045NewDraftArgs = {
    projectId: 10;
    taskId: 1045;
    actorId: string;
    expectedManifestChecksum: typeof DZEN1045_RECOVERY_MANIFEST;
    expectedChannelId: 116;
    expectedContentRevision: 4;
    expectedAcceptedRevision: 4;
    expectedBodySha256: typeof DZEN1045.bodySha;
    expectedDecisionId: 267;
    expectedSelectedAssetId: 129;
    expectedAssetSha256: typeof DZEN1045.assetSha;
    expectedPlacement: 'article_cover';
    expectedOriginalAttemptKey: typeof DZEN1045.originalKey;
    authorizedPublishIdempotencyKey: typeof DZEN1045.retryKey;
    ownerAuthorizationReference: string;
    idempotencyKey: typeof DZEN1045_AUTHORIZATION_KEY;
};

type Dependencies = {
    database: any;
    manifestLoader: typeof loadAgentWorkspaceManifest;
    dzen: Pick<typeof dzenService, 'inspectTask1045Absence'>;
    now: () => Date;
    hashBody: (body: string) => string;
};

const dependencies: Dependencies = {
    database: prisma,
    manifestLoader: loadAgentWorkspaceManifest,
    dzen: dzenService,
    now: () => new Date(),
    hashBody: body => createHash('sha256').update(body).digest('hex')
};

function record(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function assetSha(task: any): string | null {
    const provenance = record(task?.selected_asset?.provenance);
    return record(provenance.planner_storage).sha256 || provenance.sha256 || null;
}

function assertFrozenPackage(task: any, hashBody: (body: string) => string): void {
    const delivery = record(record(task?.quality_report).publication_task_delivery);
    if (!task || task.project_id !== 10 || task.channel_id !== 116
        || task.channel?.type !== 'dzen' || task.channel?.is_active !== true
        || task.content_revision !== 4 || task.accepted_revision !== 4 || task.text_state !== 'accepted'
        || hashBody(task.draft_text || '') !== DZEN1045.bodySha || task.visual_placement !== 'article_cover'
        || task.visual_state !== 'APPROVED' || task.visual_decision_version !== 1
        || task.selected_asset_id !== 129 || task.selected_asset?.id !== 129
        || task.selected_asset?.status !== 'approved' || task.selected_asset?.content_revision !== 4
        || !/^https:\/\//.test(task.selected_asset?.file_url || '') || assetSha(task) !== DZEN1045.assetSha
        || task.schedule_at?.toISOString() !== '2026-10-10T10:00:00.000Z'
        || task.publication_mode !== 'owner_released' || task.status !== 'publishing'
        || task.publication_fact || task.published_link
        || !['provider_result_uncertain', 'confirmed_absent_reconciliation'].includes(delivery.state)
        || delivery.idempotency_key !== DZEN1045.originalKey || delivery.retry_via_api !== false) {
        throw new Error('[DZEN1045_NEW_DRAFT_PACKAGE_CHANGED]');
    }
}

export async function authorizeDzenTask1045NewDraftRetry(args: Dzen1045NewDraftArgs,
    deps: Dependencies = dependencies) {
    const actor = /^user:(\d+)$/.exec(args.actorId);
    if (!actor || args.projectId !== 10 || args.taskId !== 1045
        || args.expectedManifestChecksum !== DZEN1045_RECOVERY_MANIFEST
        || args.expectedChannelId !== 116 || args.expectedContentRevision !== 4
        || args.expectedAcceptedRevision !== 4 || args.expectedBodySha256 !== DZEN1045.bodySha
        || args.expectedDecisionId !== 267 || args.expectedSelectedAssetId !== 129
        || args.expectedAssetSha256 !== DZEN1045.assetSha || args.expectedPlacement !== 'article_cover'
        || args.expectedOriginalAttemptKey !== DZEN1045.originalKey
        || args.authorizedPublishIdempotencyKey !== DZEN1045.retryKey
        || args.idempotencyKey !== DZEN1045_AUTHORIZATION_KEY
        || !args.ownerAuthorizationReference.trim()) {
        throw new Error('[DZEN1045_NEW_DRAFT_GUARD_FAILED]');
    }
    const userId = Number(actor[1]);
    const [owner, manifest, prior] = await Promise.all([
        deps.database.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: userId } } }),
        deps.manifestLoader(10, userId),
        deps.database.workflowEvent.findUnique({ where: { project_id_actor_id_command_idempotency_key: {
            project_id: 10, actor_id: args.actorId, command: DZEN1045_NEW_DRAFT_COMMAND,
            idempotency_key: args.idempotencyKey
        } } })
    ]);
    if (owner?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    await withManualTransportMutation(deps.database,args,async()=>undefined);
    if (manifest.checksum !== DZEN1045_RECOVERY_MANIFEST) throw new Error('[STALE_MANIFEST]');
    if (prior?.after_state) return { ...record(prior.after_state), replayed: true };

    const task = await deps.database.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
        include: { channel: true, selected_asset: true, publication_fact: true } });
    assertFrozenPackage(task, deps.hashBody);
    const decision = await deps.database.artDirectionDecision.findFirst({ where: {
        id: 267, project_id: 10, content_item_id: 1045, source_content_revision: 4,
        decision_version: 1, decision: 'GENERATE', channel: 'dzen', placement: 'article_cover', status: 'active'
    } });
    const originalClaim = await deps.database.workflowEvent.findFirst({ where: {
        project_id: 10, content_item_id: 1045, command: 'ba_publish_dzen_task1045_claim',
        idempotency_key: DZEN1045.originalKey
    }, orderBy: { id: 'desc' } });
    if (!decision || originalClaim?.after_state?.status !== 'publishing'
        || originalClaim?.after_state?.channel_id !== 116) {
        throw new Error('[DZEN1045_ORIGINAL_INCIDENT_PROOF_REQUIRED]');
    }
    const config = resolveEffectiveChannelConfig('dzen', task.channel.config || {});
    const absence = await deps.dzen.inspectTask1045Absence(config);
    if (!absence.authenticated || !absence.publishedCoverageComplete || !absence.draftCoverageComplete
        || absence.draftObjects !== 0 || absence.relevantPublishedTitleMatches !== 0
        || absence.relevantDraftTitleMatches !== 0) {
        throw new Error('[DZEN1045_ABSENCE_NOT_PROVEN]');
    }

    const checkedAt = absence.checkedAt;
    const authorizedAt = deps.now().toISOString();
    return deps.database.$transaction(async (tx: any) => {
        await lockManualTransportMutation(tx,args);
        const replay = await tx.workflowEvent.findUnique({ where: { project_id_actor_id_command_idempotency_key: {
            project_id: 10, actor_id: args.actorId, command: DZEN1045_NEW_DRAFT_COMMAND,
            idempotency_key: args.idempotencyKey
        } } });
        if (replay?.after_state) return { ...record(replay.after_state), replayed: true };
        const current = await tx.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
            include: { channel: true, selected_asset: true, publication_fact: true } });
        assertFrozenPackage(current, deps.hashBody);
        const [currentOwner, currentDecision] = await Promise.all([
            tx.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: userId } } }),
            tx.artDirectionDecision.findFirst({ where: { id: 267, project_id: 10, content_item_id: 1045,
                source_content_revision: 4, decision_version: 1, decision: 'GENERATE', channel: 'dzen',
                placement: 'article_cover', status: 'active' } })
        ]);
        if (currentOwner?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        if (!currentDecision) throw new Error('[DZEN1045_NEW_DRAFT_PACKAGE_CHANGED]');
        const priorDelivery = record(record(current.quality_report).publication_task_delivery);
        const absenceProof = { ...absence, manifestChecksum: manifest.checksum,
            originalClaimEventId: originalClaim.id, inspectedWithoutSend: true };
        const result = { task_id: 1045, channel_id: 116, content_revision: 4, accepted_revision: 4,
            body_sha256: DZEN1045.bodySha, visual_decision_id: 267, selected_asset_id: 129,
            asset_sha256: DZEN1045.assetSha, placement: 'article_cover', status: 'ready_for_execution',
            publication_mode: 'owner_released', previous_idempotency_key: DZEN1045.originalKey,
            authorized_idempotency_key: DZEN1045.retryKey, absence_proof: absenceProof,
            provider_send_performed: false, publication_fact_id: null, authorized_at: authorizedAt,
            replayed: false };
        const changed = await tx.contentItem.updateMany({ where: { id: 1045, project_id: 10,
            status: 'publishing', publication_mode: 'owner_released', channel_id: 116,
            content_revision: 4, accepted_revision: 4, selected_asset_id: 129
        }, data: { status: 'ready_for_execution', quality_report: {
            ...record(current.quality_report), publication_task_delivery: {
                state: 'confirmed_absent_retry_authorized', channel_type: 'dzen',
                previous_idempotency_key: DZEN1045.originalKey,
                authorized_idempotency_key: DZEN1045.retryKey, retry_via_api: true,
                prior_incident: priorDelivery, absence_proof: absenceProof,
                owner_authorization_reference: args.ownerAuthorizationReference,
                authorized_at: authorizedAt
            }
        } } });
        if (changed.count !== 1) throw new Error('[DZEN1045_NEW_DRAFT_CAS_CONFLICT]');
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
            actor_id: args.actorId, command: DZEN1045_NEW_DRAFT_COMMAND,
            idempotency_key: args.idempotencyKey,
            before_state: { status: current.status, publication_mode: current.publication_mode,
                publication_task_delivery: priorDelivery }, after_state: result } });
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
            actor_id: args.actorId, command: 'ba_release_approved_dzen_task',
            idempotency_key: DZEN1045.retryKey,
            before_state: { authorization_command: DZEN1045_NEW_DRAFT_COMMAND },
            after_state: { task_id: 1045, channel_id: 116, content_revision: 4, accepted_revision: 4,
                body_sha256: DZEN1045.bodySha, visual_decision_id: 267, selected_asset_id: 129,
                asset_sha256: DZEN1045.assetSha, schedule_at: current.schedule_at.toISOString(),
                publication_mode: 'owner_released', authorization_event_key: args.idempotencyKey } } });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

import { Prisma } from '@prisma/client';
import prisma from '../db';
import dzenService from './dzen.service';
import publicationFactService from './publication_fact.service';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import { DZEN1045 } from './dzen_task1045_resume_contract';
import { DZEN1045_RECOVERY_MANIFEST } from './dzen_task1045_new_draft_recovery.service';
import { assertDzen1045SecondAttemptState } from './dzen_task1045_second_attempt_recovery.service';
import { DZEN1045_SECOND_ATTEMPT } from './dzen_task1045_second_attempt_contract';
import { DZEN1045_ZERO_RESTORE, runDzen1045ZeroRestore } from './dzen_task1045_zero_restore_contract';

export type Dzen1045ZeroRestoreArgs = {
    projectId: 10; taskId: 1045; actorId: string;
    expectedManifestChecksum: typeof DZEN1045_RECOVERY_MANIFEST;
    expectedAttemptIdempotencyKey: typeof DZEN1045_SECOND_ATTEMPT.attemptKey;
    expectedFailedAt: typeof DZEN1045_SECOND_ATTEMPT.failedAt;
    ownerAuthorizationReference: string;
    idempotencyKey: typeof DZEN1045_ZERO_RESTORE.idempotencyKey;
    confirm?: boolean;
};

function object(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}

function assertArgs(args: Dzen1045ZeroRestoreArgs): number {
    const actor = /^user:(\d+)$/.exec(args.actorId);
    if (!actor || args.projectId !== 10 || args.taskId !== 1045
        || args.expectedManifestChecksum !== DZEN1045_RECOVERY_MANIFEST
        || args.expectedAttemptIdempotencyKey !== DZEN1045_SECOND_ATTEMPT.attemptKey
        || args.expectedFailedAt !== DZEN1045_SECOND_ATTEMPT.failedAt
        || args.idempotencyKey !== DZEN1045_ZERO_RESTORE.idempotencyKey
        || !args.ownerAuthorizationReference.trim()) throw new Error('[DZEN1045_ZERO_RESTORE_SCOPE_MISMATCH]');
    return Number(actor[1]);
}

async function readback() {
    const [task, fact, checkpoints] = await Promise.all([
        prisma.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
            select: { status: true, publication_mode: true, published_link: true } }),
        prisma.publicationFact.findFirst({ where: { project_id: 10, content_item_id: 1045 } }),
        prisma.metricSnapshot.findMany({ where: { project_id: 10, content_item_id: 1045, channel_id: 116 },
            orderBy: { id: 'asc' } })
    ]);
    return { task, publication_fact_id: fact?.id || null, public_url: fact?.public_url || null,
        provider_object_id: fact?.provider_object_id || null,
        checkpoint_ids: checkpoints.map(item => item.id) };
}

/** Audited owner-only restore after a complete zero inventory; one claim permits one adapter operation. */
export async function restoreDzenTask1045AfterZeroInventory(args: Dzen1045ZeroRestoreArgs) {
    const userId = assertArgs(args);
    const [member, manifest, task, prior, providerEvent] = await Promise.all([
        prisma.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: userId } } }),
        loadAgentWorkspaceManifest(10, userId),
        prisma.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
            include: { channel: true, selected_asset: true, publication_fact: true } }),
        prisma.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
            command: DZEN1045_ZERO_RESTORE.command, idempotency_key: DZEN1045_ZERO_RESTORE.idempotencyKey } }),
        prisma.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
            command: 'dzen1045_zero_restore_provider_confirmed',
            idempotency_key: DZEN1045_ZERO_RESTORE.idempotencyKey } })
    ]);
    if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    if (manifest.checksum !== DZEN1045_RECOVERY_MANIFEST) throw new Error('[STALE_MANIFEST]');
    if (prior) {
        if (!providerEvent) throw new Error('[DZEN1045_ZERO_RESTORE_ALREADY_CLAIMED] Reconcile; never create or submit again');
        return { mode: 'replay', authoritative_readback: await readback(), replayed: true };
    }
    const guarded = assertDzen1045SecondAttemptState(task);
    const config = resolveEffectiveChannelConfig('dzen', guarded.task.channel?.config || {});
    if (String(config.channel_id || '') !== DZEN1045.publisherId || !config.cookies
        || !guarded.task.selected_asset?.file_url) throw new Error('[DZEN1045_ZERO_RESTORE_CONNECTOR_NOT_READY]');
    const imageUrl = guarded.task.selected_asset.file_url;
    let claimed = false;
    try {
        const result = await runDzen1045ZeroRestore({ confirm: args.confirm === true,
            idempotencyKey: args.idempotencyKey }, {
            inspect: () => dzenService.inspectTask1045ExactObjects(config, guarded.task.draft_text || ''),
            claim: async inspection => prisma.$transaction(async tx => {
                const latest = await tx.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
                    include: { channel: true, selected_asset: true, publication_fact: true } });
                const exact = assertDzen1045SecondAttemptState(latest);
                if (await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
                    command: DZEN1045_ZERO_RESTORE.command,
                    idempotency_key: DZEN1045_ZERO_RESTORE.idempotencyKey } })) return false;
                const quality = object(latest?.quality_report);
                const changed = await tx.contentItem.updateMany({ where: { id: 1045, project_id: 10,
                    status: 'publishing', publication_mode: 'owner_released', channel_id: 116,
                    content_revision: 4, accepted_revision: 4, selected_asset_id: 129,
                    quality_report: { equals: latest!.quality_report || {} }, publication_fact: { is: null },
                    published_link: null }, data: { quality_report: { ...quality,
                    publication_task_delivery: { ...exact.delivery, state: 'zero_inventory_restore_started',
                        restore_idempotency_key: DZEN1045_ZERO_RESTORE.idempotencyKey,
                        owner_authorization_reference: args.ownerAuthorizationReference,
                        provider_create_count_max: 1, final_submit_count_max: 1,
                        restore_started_at: new Date().toISOString(), retry_via_api: false }
                } as Prisma.InputJsonValue } });
                if (changed.count !== 1) return false;
                await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
                    actor_id: args.actorId, command: DZEN1045_ZERO_RESTORE.command,
                    idempotency_key: DZEN1045_ZERO_RESTORE.idempotencyKey,
                    before_state: { attempt_key: DZEN1045_SECOND_ATTEMPT.attemptKey,
                        failed_at: DZEN1045_SECOND_ATTEMPT.failedAt, inventory: inspection } as Prisma.InputJsonValue,
                    after_state: { state: 'zero_inventory_restore_started', body_sha256: DZEN1045.bodySha,
                        asset_sha256: DZEN1045.assetSha, decision_id: DZEN1045.decisionId,
                        selected_asset_id: DZEN1045.assetId } as Prisma.InputJsonValue } });
                claimed = true;
                return true;
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
            restore: () => dzenService.restoreTask1045(config, guarded.task.draft_text || '',
                imageUrl)
        });
        if (result.mode === 'preview') return { ...result, published: false };
        const restored = result.result;
        await prisma.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
            actor_id: args.actorId, command: 'dzen1045_zero_restore_provider_confirmed',
            idempotency_key: DZEN1045_ZERO_RESTORE.idempotencyKey,
            after_state: { ...restored.publication, recovery_mode: restored.mode,
                created_new_draft: restored.created, final_submit_count: restored.finalSubmitCount,
                draft_id: restored.proof?.draftId || restored.publication.provider_object_id,
                save_trace: restored.saveTrace } as Prisma.InputJsonValue } });
        const fact = await publicationFactService.record({ projectId: 10, taskId: 1045, actorId: args.actorId,
            artifactKind: 'article', outcome: 'published', publicUrl: restored.publication.public_url,
            providerObjectId: restored.publication.provider_object_id,
            publishedAt: restored.publication.published_at,
            confirmationMode: restored.mode === 'reconciled' ? 'reconciled' : 'automatic',
            evidence: { type: 'public_url', ref: restored.publication.public_url }, utmStatus: 'not_applicable',
            note: 'Exact task1045 zero-inventory recovery with durable draft readback.' });
        return { mode: restored.mode, publication: restored.publication,
            publication_fact_id: fact.publication_fact.id, created_checkpoints: fact.created_checkpoints,
            authoritative_readback: await readback(), replayed: false };
    } catch (error: unknown) {
        if (claimed) {
            const current = await prisma.contentItem.findFirst({ where: { id: 1045, project_id: 10 } });
            const quality = object(current?.quality_report);
            const delivery = object(quality.publication_task_delivery);
            await prisma.contentItem.update({ where: { id: 1045 }, data: { quality_report: { ...quality,
                publication_task_delivery: { ...delivery, state: 'zero_inventory_restore_uncertain',
                    retry_via_api: false, provider_create_may_have_occurred: true,
                    final_submit_may_have_occurred: true,
                    error: error instanceof Error ? error.message : String(error),
                    failed_at: new Date().toISOString() } } as Prisma.InputJsonValue } });
        }
        throw error;
    }
}

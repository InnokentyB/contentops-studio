import {lockManualTransportMutation,withManualTransportMutation} from './manual_publication_transport_projection';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import dzenService from './dzen.service';
import publicationFactService from './publication_fact.service';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import { DZEN1045 } from './dzen_task1045_resume_contract';
import { DZEN1045_RECOVERY_MANIFEST } from './dzen_task1045_new_draft_recovery.service';
import { assertDzen1045RestoreIncident, DZEN1045_RESTORE_RECONCILE,
    runDzen1045RestoreReconcile } from './dzen_task1045_restore_reconcile_contract';
import type { Dzen1045SecondAttemptPublication } from './dzen_task1045_second_attempt_contract';

type Task = Prisma.ContentItemGetPayload<{ include: { channel: true; selected_asset: true; publication_fact: true } }>;
export type Dzen1045RestoreReconcileArgs = { projectId: 10; taskId: 1045; actorId: string;
    expectedManifestChecksum: typeof DZEN1045_RECOVERY_MANIFEST;
    expectedRestoreIdempotencyKey: typeof DZEN1045_RESTORE_RECONCILE.restoreKey;
    expectedFailedAt: typeof DZEN1045_RESTORE_RECONCILE.failedAt;
    idempotencyKey: typeof DZEN1045_RESTORE_RECONCILE.idempotencyKey; confirm?: boolean };

function object(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}
function string(value: unknown): string { return typeof value === 'string' ? value : ''; }
function assetChecksum(task: Task): string {
    const provenance = object(task.selected_asset?.provenance);
    return string(object(provenance.planner_storage).sha256 || provenance.sha256);
}
function assertArgs(args: Dzen1045RestoreReconcileArgs): number {
    const actor = /^user:(\d+)$/.exec(args.actorId);
    if (!actor || args.projectId !== 10 || args.taskId !== 1045
        || args.expectedManifestChecksum !== DZEN1045_RECOVERY_MANIFEST
        || args.expectedRestoreIdempotencyKey !== DZEN1045_RESTORE_RECONCILE.restoreKey
        || args.expectedFailedAt !== DZEN1045_RESTORE_RECONCILE.failedAt
        || args.idempotencyKey !== DZEN1045_RESTORE_RECONCILE.idempotencyKey) {
        throw new Error('[DZEN1045_RESTORE_RECONCILE_SCOPE_MISMATCH]');
    }
    return Number(actor[1]);
}
export function assertDzen1045RestoreReconcileTask(task: Task | null): { task: Task; delivery: Record<string, unknown> } {
    const delivery = object(object(task?.quality_report).publication_task_delivery);
    if (!task || task.id !== 1045 || task.project_id !== 10 || task.channel_id !== 116
        || task.channel?.type !== 'dzen' || task.channel.is_active !== true
        || task.status !== 'publishing' || task.publication_mode !== 'owner_released'
        || task.content_revision !== 4 || task.accepted_revision !== 4 || task.text_state !== 'accepted'
        || createHash('sha256').update(task.draft_text || '').digest('hex') !== DZEN1045.bodySha
        || task.visual_placement !== 'article_cover' || task.visual_state !== 'APPROVED'
        || task.visual_decision_version !== 1 || task.selected_asset_id !== 129
        || task.selected_asset?.status !== 'approved' || task.selected_asset.content_revision !== 4
        || assetChecksum(task) !== DZEN1045.assetSha || task.publication_fact || task.published_link) {
        throw new Error('[DZEN1045_RESTORE_RECONCILE_TASK_MISMATCH]');
    }
    assertDzen1045RestoreIncident(delivery);
    return { task, delivery };
}
async function loadTask(): Promise<Task | null> {
    return prisma.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
        include: { channel: true, selected_asset: true, publication_fact: true } });
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
        checkpoints: checkpoints.map(item => ({ id: item.id, checkpoint: item.checkpoint,
            channel_id: item.channel_id, collection_status: item.collection_status })) };
}
function publicationFromState(value: unknown): Dzen1045SecondAttemptPublication | null {
    const state = object(value);
    if (state.public_body_matches !== true || state.public_asset_matches !== true) return null;
    const publication = { public_url: string(state.public_url), provider_object_id: string(state.provider_object_id),
        published_at: string(state.published_at), public_body_matches: true as const,
        public_asset_matches: true as const, checked_at: string(state.checked_at) };
    return publication.public_url && publication.provider_object_id && publication.published_at ? publication : null;
}
async function recordFact(args: Dzen1045RestoreReconcileArgs, publication: Dzen1045SecondAttemptPublication) {
    const fact = await publicationFactService.record({ projectId: 10, taskId: 1045, actorId: args.actorId,
        artifactKind: 'article', outcome: 'published', publicUrl: publication.public_url,
        providerObjectId: publication.provider_object_id, publishedAt: publication.published_at,
        confirmationMode: 'reconciled', evidence: { type: 'public_url', ref: publication.public_url },
        utmStatus: 'not_applicable', note: 'Read-only reconciliation of exact task1045 zero-restore incident.' });
    return { publication_fact_id: fact.publication_fact.id, created_checkpoints: fact.created_checkpoints,
        authoritative_readback: await readback() };
}

/** Exact read-only provider reconciliation bound to the failed zero-restore incident. */
export async function reconcileDzenTask1045ZeroRestoreIncident(args: Dzen1045RestoreReconcileArgs) {
    const userId = assertArgs(args);
    const [member, manifest, task, prior] = await Promise.all([
        prisma.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: userId } } }),
        loadAgentWorkspaceManifest(10, userId), loadTask(),
        prisma.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
            command: DZEN1045_RESTORE_RECONCILE.command,
            idempotency_key: DZEN1045_RESTORE_RECONCILE.idempotencyKey }, orderBy: { id: 'desc' } })
    ]);
    if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    await withManualTransportMutation(prisma,args,async()=>undefined);
    if (manifest.checksum !== DZEN1045_RECOVERY_MANIFEST) throw new Error('[STALE_MANIFEST]');
    if (prior && args.confirm === true) {
        const publication = publicationFromState(prior.after_state);
        if (!publication) throw new Error('[DZEN1045_RESTORE_RECONCILE_AUDIT_INVALID]');
        return { mode: 'reconciled', publication, ...await recordFact(args, publication), replayed: true };
    }
    const guarded = assertDzen1045RestoreReconcileTask(task);
    const config = resolveEffectiveChannelConfig('dzen', guarded.task.channel?.config || {});
    if (!config.cookies || string(config.channel_id) !== DZEN1045.publisherId) {
        throw new Error('[DZEN1045_RESTORE_RECONCILE_CONNECTOR_NOT_READY]');
    }
    const result = await runDzen1045RestoreReconcile({ confirm: args.confirm === true,
        idempotencyKey: args.idempotencyKey }, {
        inspect: () => dzenService.inspectTask1045RestoreIncident(config, guarded.task.draft_text || ''),
        reconcile: async publication => {
            await prisma.$transaction(async tx => {
            await lockManualTransportMutation(tx,args);
                const latest = await tx.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
                    include: { channel: true, selected_asset: true, publication_fact: true } });
                assertDzen1045RestoreReconcileTask(latest);
                if (await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
                    command: DZEN1045_RESTORE_RECONCILE.command,
                    idempotency_key: DZEN1045_RESTORE_RECONCILE.idempotencyKey } })) return;
                await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
                    actor_id: args.actorId, command: DZEN1045_RESTORE_RECONCILE.command,
                    idempotency_key: DZEN1045_RESTORE_RECONCILE.idempotencyKey,
                    before_state: { restore_idempotency_key: DZEN1045_RESTORE_RECONCILE.restoreKey,
                        failed_at: DZEN1045_RESTORE_RECONCILE.failedAt, provider_writes: 0 } as Prisma.InputJsonValue,
                    after_state: { ...publication, body_sha256: DZEN1045.bodySha,
                        asset_sha256: DZEN1045.assetSha, provider_writes: 0,
                        publish_controls_clicked: 0 } as Prisma.InputJsonValue } });
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
            return recordFact(args, publication);
        }
    });
    if (result.mode === 'preview') return { ...result, published: false, replayed: false };
    return { mode: result.mode, publication: result.publication, ...result.result, replayed: false };
}

import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import dzenService from './dzen.service';
import publicationFactService from './publication_fact.service';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import { DZEN1045 } from './dzen_task1045_resume_contract';
import { DZEN1045_RECOVERY_MANIFEST } from './dzen_task1045_new_draft_recovery.service';
import { assertDzen1045PhaseBIncident, DZEN1045_PHASE_B_RECONCILE,
    runDzen1045PhaseBReconcile, type Dzen1045PhaseBInspection } from './dzen_task1045_phase_b_reconcile_contract';
import type { Dzen1045SecondAttemptPublication } from './dzen_task1045_second_attempt_contract';

type Task = Prisma.ContentItemGetPayload<{ include: { channel: true; selected_asset: true; publication_fact: true } }>;
export type Dzen1045PhaseBReconcileArgs = { projectId: 10; taskId: 1045; actorId: string;
    expectedManifestChecksum: typeof DZEN1045_RECOVERY_MANIFEST;
    expectedPhaseBIdempotencyKey: typeof DZEN1045_PHASE_B_RECONCILE.sourceKey;
    expectedFailedAt: typeof DZEN1045_PHASE_B_RECONCILE.failedAt;
    expectedProviderId: typeof DZEN1045_PHASE_B_RECONCILE.providerId;
    ownerAuthorizationReference: string;
    idempotencyKey: typeof DZEN1045_PHASE_B_RECONCILE.idempotencyKey; confirm?: boolean };
function object(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object'
    && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function string(value: unknown): string { return typeof value === 'string' ? value : ''; }
function checksum(task: Task): string { const provenance = object(task.selected_asset?.provenance);
    return string(object(provenance.planner_storage).sha256 || provenance.sha256); }
function assertArgs(args: Dzen1045PhaseBReconcileArgs): number {
    const actor = /^user:(\d+)$/.exec(args.actorId);
    if (!actor || args.projectId !== 10 || args.taskId !== 1045
        || args.expectedManifestChecksum !== DZEN1045_RECOVERY_MANIFEST
        || args.expectedPhaseBIdempotencyKey !== DZEN1045_PHASE_B_RECONCILE.sourceKey
        || args.expectedFailedAt !== DZEN1045_PHASE_B_RECONCILE.failedAt
        || args.expectedProviderId !== DZEN1045_PHASE_B_RECONCILE.providerId
        || args.idempotencyKey !== DZEN1045_PHASE_B_RECONCILE.idempotencyKey
        || !args.ownerAuthorizationReference.trim()) throw new Error('[DZEN1045_PHASE_B_RECONCILE_SCOPE_MISMATCH]');
    return Number(actor[1]);
}
function assertTask(task: Task | null) {
    const delivery = object(object(task?.quality_report).publication_task_delivery);
    if (!task || task.channel_id !== 116 || task.channel?.type !== 'dzen' || !task.channel.is_active
        || task.status !== 'publishing' || task.publication_mode !== 'owner_released'
        || task.content_revision !== 4 || task.accepted_revision !== 4 || task.text_state !== 'accepted'
        || createHash('sha256').update(task.draft_text || '').digest('hex') !== DZEN1045.bodySha
        || task.selected_asset_id !== 129 || checksum(task) !== DZEN1045.assetSha
        || task.publication_fact || task.published_link) throw new Error('[DZEN1045_PHASE_B_RECONCILE_TASK_MISMATCH]');
    assertDzen1045PhaseBIncident(delivery); return { task, delivery };
}
function detailStatus(probe: Record<string, unknown>): string {
    const fields = object(object(probe.detailSemantics).stateFields);
    return String(Object.entries(fields).find(([key]) => /privateData\.status$/.test(key))?.[1] || '');
}
async function inspect(config: Record<string, unknown>, body: string): Promise<Dzen1045PhaseBInspection> {
    const [inventory, editor] = await Promise.all([
        dzenService.inspectTask1045PhaseAV2Incident(config, body),
        dzenService.probeTask1045ExactEditorState(config, body)
    ]);
    const evidence = { provider_writes: 0, clicked_controls: 0,
        execution_contract: { dialog_open_clicks: 1, final_confirmation_clicks: 0,
            historical_error: '[DZEN1045_PHASE_B_SUBMIT_UNCERTAIN]' }, inventory, editor };
    if (inventory.kind === 'exact_published'
        && inventory.publication.provider_object_id === DZEN1045_PHASE_B_RECONCILE.providerId) {
        return { kind: 'exact_public', publication: inventory.publication, evidence };
    }
    if (editor.exactPackage === true && detailStatus(object(editor)) === 'draft'
        && inventory.kind !== 'exact_published') return { kind: 'exact_draft', evidence };
    return { kind: 'ambiguous', evidence };
}
async function recordFact(args: Dzen1045PhaseBReconcileArgs, publication: Dzen1045SecondAttemptPublication) {
    return publicationFactService.record({ projectId: 10, taskId: 1045, actorId: args.actorId,
        artifactKind: 'article', outcome: 'published', publicUrl: publication.public_url,
        providerObjectId: publication.provider_object_id, publishedAt: publication.published_at,
        confirmationMode: 'reconciled', evidence: { type: 'public_url', ref: publication.public_url },
        utmStatus: 'not_applicable', note: 'Read-only reconciliation of exact Dzen task1045 Phase B incident.' });
}

export async function reconcileDzenTask1045PhaseBIncident(args: Dzen1045PhaseBReconcileArgs) {
    const userId = assertArgs(args);
    const [member, manifest, task, prior] = await Promise.all([
        prisma.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: userId } } }),
        loadAgentWorkspaceManifest(10, userId),
        prisma.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
            include: { channel: true, selected_asset: true, publication_fact: true } }),
        prisma.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
            command: DZEN1045_PHASE_B_RECONCILE.command,
            idempotency_key: DZEN1045_PHASE_B_RECONCILE.idempotencyKey } })
    ]);
    if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    if (manifest.checksum !== DZEN1045_RECOVERY_MANIFEST) throw new Error('[STALE_MANIFEST]');
    if (prior && args.confirm) {
        const after = object(prior.after_state);
        if (after.mode === 'not_attempted_final') return { mode: 'not_attempted_final', replayed: true,
            evidence: after.evidence };
        if (after.mode === 'exact_public') {
            const publication = after.publication as Dzen1045SecondAttemptPublication;
            return { mode: 'reconciled', replayed: true, fact: await recordFact(args, publication) };
        }
        throw new Error('[DZEN1045_PHASE_B_RECONCILE_AUDIT_INVALID]');
    }
    const guarded = assertTask(task);
    const config = resolveEffectiveChannelConfig('dzen', guarded.task.channel!.config || {});
    if (!config.cookies || String(config.channel_id || '') !== DZEN1045.publisherId) {
        throw new Error('[DZEN1045_PHASE_B_RECONCILE_CONNECTOR_NOT_READY]');
    }
    return runDzen1045PhaseBReconcile({ confirm: args.confirm === true,
        idempotencyKey: args.idempotencyKey }, {
        inspect: () => inspect(config, guarded.task.draft_text || ''),
        recordNotAttempted: async () => prisma.$transaction(async tx => {
            const latest = assertTask(await tx.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
                include: { channel: true, selected_asset: true, publication_fact: true } }));
            const quality = object(latest.task.quality_report); const now = new Date().toISOString();
            const evidence = { provider_id: DZEN1045_PHASE_B_RECONCILE.providerId,
                classification: 'NOT_ATTEMPTED_FINAL', dialog_open_clicks: 1,
                final_confirmation_clicks: 0, verified_at: now };
            await tx.contentItem.update({ where: { id: 1045 }, data: { quality_report: { ...quality,
                publication_task_delivery: { ...latest.delivery, state: 'phase_b_final_not_attempted',
                    prior_uncertain_failed_at: DZEN1045_PHASE_B_RECONCILE.failedAt,
                    final_submit_may_have_occurred: false, final_submit_count: 0,
                    final_submit_allowed: false, retry_via_api: false, phase_b_reconcile_evidence: evidence }
            } as Prisma.InputJsonValue } });
            await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
                actor_id: args.actorId, command: DZEN1045_PHASE_B_RECONCILE.command,
                idempotency_key: DZEN1045_PHASE_B_RECONCILE.idempotencyKey,
                before_state: { state: 'phase_b_uncertain', failed_at: DZEN1045_PHASE_B_RECONCILE.failedAt } as Prisma.InputJsonValue,
                after_state: { mode: 'not_attempted_final', evidence } as Prisma.InputJsonValue } });
            return evidence;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
        record: async publication => {
            await prisma.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
                actor_id: args.actorId, command: DZEN1045_PHASE_B_RECONCILE.command,
                idempotency_key: DZEN1045_PHASE_B_RECONCILE.idempotencyKey,
                after_state: { mode: 'exact_public', publication, provider_writes: 0 } as Prisma.InputJsonValue } });
            return recordFact(args, publication);
        }
    });
}

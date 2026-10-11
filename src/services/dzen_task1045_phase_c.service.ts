import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import dzenService from './dzen.service';
import publicationFactService from './publication_fact.service';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import { DZEN1045 } from './dzen_task1045_resume_contract';
import { DZEN1045_RECOVERY_MANIFEST } from './dzen_task1045_new_draft_recovery.service';
import { DZEN1045_PHASE_C, runDzen1045PhaseC,
    type Dzen1045DialogInspection } from './dzen_task1045_phase_c_contract';

type Task = Prisma.ContentItemGetPayload<{ include: { channel: true; selected_asset: true; publication_fact: true } }>;
export type Dzen1045PhaseCArgs = { projectId: 10; taskId: 1045; actorId: string;
    expectedManifestChecksum: typeof DZEN1045_RECOVERY_MANIFEST;
    expectedProviderId: typeof DZEN1045_PHASE_C.providerId;
    expectedControlMapKey: typeof DZEN1045_PHASE_C.sourceControlMapKey;
    expectedControlMapJsonSha256: typeof DZEN1045_PHASE_C.controlMapJsonSha256;
    expectedControlMapPngSha256: typeof DZEN1045_PHASE_C.controlMapPngSha256;
    ownerAuthorizationReference: string; idempotencyKey: string; confirm?: boolean;
    expectedDialogFingerprint?: string | null };
function object(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object'
    && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function assetChecksum(task: Task): string { const provenance = object(task.selected_asset?.provenance);
    return String(object(provenance.planner_storage).sha256 || provenance.sha256 || ''); }
function assertArgs(args: Dzen1045PhaseCArgs): number {
    const actor = /^user:(\d+)$/.exec(args.actorId); const expectedKey = args.confirm
        ? DZEN1045_PHASE_C.executeKey : DZEN1045_PHASE_C.previewKey;
    if (!actor || args.projectId !== 10 || args.taskId !== 1045
        || args.expectedManifestChecksum !== DZEN1045_RECOVERY_MANIFEST
        || args.expectedProviderId !== DZEN1045_PHASE_C.providerId
        || args.expectedControlMapKey !== DZEN1045_PHASE_C.sourceControlMapKey
        || args.expectedControlMapJsonSha256 !== DZEN1045_PHASE_C.controlMapJsonSha256
        || args.expectedControlMapPngSha256 !== DZEN1045_PHASE_C.controlMapPngSha256
        || args.idempotencyKey !== expectedKey || !args.ownerAuthorizationReference.trim()) {
        throw new Error('[DZEN1045_PHASE_C_SCOPE_MISMATCH]');
    }
    return Number(actor[1]);
}
function assertTask(task: Task | null) {
    const delivery = object(object(task?.quality_report).publication_task_delivery);
    const reconcileEvidence = object(delivery.phase_b_reconcile_evidence);
    if (!task || task.channel_id !== 116 || task.channel?.type !== 'dzen' || !task.channel.is_active
        || task.status !== 'publishing' || task.publication_mode !== 'owner_released'
        || task.content_revision !== 4 || task.accepted_revision !== 4 || task.text_state !== 'accepted'
        || createHash('sha256').update(task.draft_text || '').digest('hex') !== DZEN1045.bodySha
        || task.visual_placement !== 'article_cover' || task.visual_state !== 'APPROVED'
        || task.selected_asset_id !== 129 || assetChecksum(task) !== DZEN1045.assetSha
        || task.publication_fact || task.published_link || delivery.state !== DZEN1045_PHASE_C.sourceState
        || delivery.final_submit_count !== 0 || delivery.final_submit_may_have_occurred !== false
        || reconcileEvidence.classification !== 'NOT_ATTEMPTED_FINAL') {
        throw new Error('[DZEN1045_PHASE_C_TASK_MISMATCH]');
    }
    return { task, delivery };
}
function inspection(value: Awaited<ReturnType<typeof dzenService.previewTask1045PhaseC>>): Dzen1045DialogInspection {
    return { dialog: value.dialog, fingerprint: value.fingerprint, exactDraft: value.exactDraft,
        finalConfirmationClicks: value.finalConfirmationClicks, providerWrites: value.providerWrites };
}

export async function executeDzenTask1045PhaseC(args: Dzen1045PhaseCArgs) {
    const userId = assertArgs(args); const confirm = args.confirm === true;
    const [member, manifest, task, prior] = await Promise.all([
        prisma.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: userId } } }),
        loadAgentWorkspaceManifest(10, userId),
        prisma.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
            include: { channel: true, selected_asset: true, publication_fact: true } }),
        confirm ? prisma.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
            command: DZEN1045_PHASE_C.tool, idempotency_key: DZEN1045_PHASE_C.executeKey } }) : Promise.resolve(null)
    ]);
    if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    if (manifest.checksum !== DZEN1045_RECOVERY_MANIFEST) throw new Error('[STALE_MANIFEST]');
    if (prior) {
        if (task?.publication_fact?.provider_object_id === DZEN1045_PHASE_C.providerId) {
            return { mode: 'published', publication_fact: task.publication_fact, replayed: true };
        }
        throw new Error('[DZEN1045_PHASE_C_ALREADY_CLAIMED] Reconcile exact provider ID; never click again');
    }
    const guarded = assertTask(task); const config = resolveEffectiveChannelConfig('dzen', guarded.task.channel!.config || {});
    if (!config.cookies || String(config.channel_id || '') !== DZEN1045.publisherId) {
        throw new Error('[DZEN1045_PHASE_C_CONNECTOR_NOT_READY]');
    }
    let claimed = false;
    try {
        const result = await runDzen1045PhaseC({ confirm, idempotencyKey: args.idempotencyKey,
            expectedDialogFingerprint: args.expectedDialogFingerprint || null }, {
            inspectDialog: async () => inspection(await dzenService.previewTask1045PhaseC(config, guarded.task.draft_text || '')),
            claim: async preflight => prisma.$transaction(async tx => {
                const latest = assertTask(await tx.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
                    include: { channel: true, selected_asset: true, publication_fact: true } }));
                const quality = object(latest.task.quality_report);
                const changed = await tx.contentItem.updateMany({ where: { id: 1045, project_id: 10,
                    quality_report: { equals: latest.task.quality_report || {} }, publication_fact: { is: null }, published_link: null },
                data: { quality_report: { ...quality, publication_task_delivery: { ...latest.delivery,
                    state: 'phase_c_started', phase_c_idempotency_key: DZEN1045_PHASE_C.executeKey,
                    phase_c_dialog_fingerprint: preflight.fingerprint, provider_object_id: DZEN1045_PHASE_C.providerId,
                    final_submit_allowed: true, final_submit_count: 0, final_submit_may_have_occurred: false,
                    phase_c_started_at: new Date().toISOString(), retry_via_api: false } } as Prisma.InputJsonValue } });
                if (changed.count !== 1) return false;
                await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045, actor_id: args.actorId,
                    command: DZEN1045_PHASE_C.tool, idempotency_key: DZEN1045_PHASE_C.executeKey,
                    before_state: { source_state: DZEN1045_PHASE_C.sourceState, control_map_key: DZEN1045_PHASE_C.sourceControlMapKey,
                        control_map_json_sha256: DZEN1045_PHASE_C.controlMapJsonSha256,
                        control_map_png_sha256: DZEN1045_PHASE_C.controlMapPngSha256,
                        dialog_fingerprint: preflight.fingerprint } as Prisma.InputJsonValue,
                    after_state: { state: 'phase_c_started', provider_object_id: DZEN1045_PHASE_C.providerId,
                        final_submit_count_max: 1 } as Prisma.InputJsonValue } });
                claimed = true; return true;
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
            submitOnce: preflight => dzenService.publishTask1045PhaseCOnce(config,
                guarded.task.draft_text || '', preflight.fingerprint),
            record: async publication => {
                const fact = await publicationFactService.record({ projectId: 10, taskId: 1045, actorId: args.actorId,
                    artifactKind: 'article', outcome: 'published', publicUrl: publication.public_url,
                    providerObjectId: publication.provider_object_id, publishedAt: publication.published_at,
                    confirmationMode: 'automatic', evidence: { type: 'public_url', ref: publication.public_url },
                    utmStatus: 'not_applicable', note: 'Task1045 Phase C: exact existing Dzen object, one final confirmation.' });
                await prisma.$transaction(async tx => {
                    const latest = await tx.contentItem.findFirst({ where: { id: 1045, project_id: 10 } });
                    const quality = object(latest?.quality_report); const delivery = object(quality.publication_task_delivery);
                    await tx.contentItem.update({ where: { id: 1045 }, data: { quality_report: { ...quality,
                        publication_task_delivery: { ...delivery, state: 'phase_c_published', final_submit_allowed: false,
                            final_submit_count: 1, final_submit_may_have_occurred: true,
                            phase_c_completed_at: new Date().toISOString(), publication } } as Prisma.InputJsonValue } });
                    await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
                        actor_id: args.actorId, command: `${DZEN1045_PHASE_C.tool}_proof`,
                        idempotency_key: DZEN1045_PHASE_C.executeKey,
                        after_state: { publication, publication_fact_id: fact.publication_fact.id,
                            created_checkpoints: fact.created_checkpoints, final_submit_count: 1 } as Prisma.InputJsonValue } });
                }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
                return fact;
            }
        });
        return { ...result, replayed: false };
    } catch (error: unknown) {
        if (claimed) {
            const current = await prisma.contentItem.findFirst({ where: { id: 1045, project_id: 10 } });
            const quality = object(current?.quality_report); const delivery = object(quality.publication_task_delivery);
            await prisma.contentItem.update({ where: { id: 1045 }, data: { quality_report: { ...quality,
                publication_task_delivery: { ...delivery, state: 'phase_c_uncertain', final_submit_allowed: false,
                    final_submit_may_have_occurred: true, final_submit_count_max: 1, retry_via_api: false,
                    error: error instanceof Error ? error.message : String(error),
                    phase_c_failed_at: new Date().toISOString() } } as Prisma.InputJsonValue } });
        }
        throw error;
    }
}

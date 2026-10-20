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
import { assertDzen1045PhaseAV2Incident } from './dzen_task1045_phase_a_v2_reconcile_contract';
import { DZEN1045_PHASE_B, runDzen1045PhaseB,
    type Dzen1045PhaseBPreflight } from './dzen_task1045_phase_b_contract';

type Task = Prisma.ContentItemGetPayload<{ include: { channel: true; selected_asset: true; publication_fact: true } }>;
export type Dzen1045PhaseBArgs = { projectId: 10; taskId: 1045; actorId: string;
    expectedManifestChecksum: typeof DZEN1045_RECOVERY_MANIFEST;
    expectedSourcePhaseAIdempotencyKey: typeof DZEN1045_PHASE_B.sourceKey;
    expectedSourceFailedAt: typeof DZEN1045_PHASE_B.sourceFailedAt;
    expectedProviderId: typeof DZEN1045_PHASE_B.providerId;
    ownerAuthorizationReference: string; idempotencyKey: typeof DZEN1045_PHASE_B.idempotencyKey;
    confirm?: boolean };
function object(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}
function string(value: unknown): string { return typeof value === 'string' ? value : ''; }
function checksum(task: Task): string { const provenance = object(task.selected_asset?.provenance);
    return string(object(provenance.planner_storage).sha256 || provenance.sha256); }
function assertArgs(args: Dzen1045PhaseBArgs): number {
    const actor = /^user:(\d+)$/.exec(args.actorId);
    if (!actor || args.projectId !== 10 || args.taskId !== 1045
        || args.expectedManifestChecksum !== DZEN1045_RECOVERY_MANIFEST
        || args.expectedSourcePhaseAIdempotencyKey !== DZEN1045_PHASE_B.sourceKey
        || args.expectedSourceFailedAt !== DZEN1045_PHASE_B.sourceFailedAt
        || args.expectedProviderId !== DZEN1045_PHASE_B.providerId
        || args.idempotencyKey !== DZEN1045_PHASE_B.idempotencyKey
        || !args.ownerAuthorizationReference.trim()) throw new Error('[DZEN1045_PHASE_B_SCOPE_MISMATCH]');
    return Number(actor[1]);
}
function assertTask(task: Task | null) {
    const delivery = object(object(task?.quality_report).publication_task_delivery);
    if (!task || task.channel_id !== 116 || task.channel?.type !== 'dzen' || !task.channel.is_active
        || task.status !== 'publishing' || task.publication_mode !== 'owner_released'
        || task.content_revision !== 4 || task.accepted_revision !== 4 || task.text_state !== 'accepted'
        || createHash('sha256').update(task.draft_text || '').digest('hex') !== DZEN1045.bodySha
        || task.visual_placement !== 'article_cover' || task.visual_state !== 'APPROVED'
        || task.selected_asset_id !== 129 || checksum(task) !== DZEN1045.assetSha
        || task.publication_fact || task.published_link) throw new Error('[DZEN1045_PHASE_B_TASK_MISMATCH]');
    assertDzen1045PhaseAV2Incident(delivery); return { task, delivery };
}
function preflightFromProbe(probe: Record<string, unknown>): Dzen1045PhaseBPreflight {
    const readiness = object(probe.readiness); const semantics = object(probe.detailSemantics);
    const states = object(semantics.stateFields); const controls = Array.isArray(probe.finalSubmitControls)
        ? probe.finalSubmitControls as Array<Record<string, unknown>> : [];
    const detailStatus = Object.entries(states).find(([key]) => /privateData\.status$/.test(key))?.[1];
    const exactControl = controls.filter(control => control.dataTestId === 'article-publish-btn'
        && control.disabled === false);
    return { providerId: DZEN1045_PHASE_B.providerId,
        exactPackage: probe.exactPackage as true,
        detailStatus: (detailStatus === 'draft' ? 'draft' : String(detailStatus)) as 'draft',
        enabledFinalControls: Number(readiness.enabledFinalSubmitControls) as 1,
        finalSelector: DZEN1045_PHASE_B.finalSelector,
        providerWrites: Array.isArray(probe.blockedWrites) && exactControl.length === 1 ? 0 : -1 as 0 };
}

export async function publishDzenTask1045PhaseB(args: Dzen1045PhaseBArgs) {
    const userId = assertArgs(args); const proofCommand = `${DZEN1045_PHASE_B.command}_proof`;
    const [member, manifest, task, prior] = await Promise.all([
        prisma.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: userId } } }),
        loadAgentWorkspaceManifest(10, userId),
        prisma.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
            include: { channel: true, selected_asset: true, publication_fact: true } }),
        prisma.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
            command: DZEN1045_PHASE_B.command, idempotency_key: DZEN1045_PHASE_B.idempotencyKey } })
    ]);
    if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    await withManualTransportMutation(prisma,args,async()=>undefined);
    if (manifest.checksum !== DZEN1045_RECOVERY_MANIFEST) throw new Error('[STALE_MANIFEST]');
    if (prior) {
        if (task?.publication_fact?.provider_object_id === DZEN1045_PHASE_B.providerId) {
            return { mode: 'published', publication_fact: task.publication_fact, replayed: true };
        }
        throw new Error('[DZEN1045_PHASE_B_ALREADY_CLAIMED] Reconcile exact provider ID; never click again');
    }
    const guarded = assertTask(task);
    const config = resolveEffectiveChannelConfig('dzen', guarded.task.channel!.config || {});
    if (!config.cookies || String(config.channel_id || '') !== DZEN1045.publisherId) {
        throw new Error('[DZEN1045_PHASE_B_CONNECTOR_NOT_READY]');
    }
    let claimed = false;
    try {
        const result = await runDzen1045PhaseB({ confirm: args.confirm === true,
            idempotencyKey: args.idempotencyKey }, {
            inspect: async () => preflightFromProbe(object(await dzenService.probeTask1045ExactEditorState(
                config, guarded.task.draft_text || ''))),
            claim: async preflight => prisma.$transaction(async tx => {
            await lockManualTransportMutation(tx,args);
                const latest = assertTask(await tx.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
                    include: { channel: true, selected_asset: true, publication_fact: true } }));
                const quality = object(latest.task.quality_report);
                const changed = await tx.contentItem.updateMany({ where: { id: 1045, project_id: 10,
                    quality_report: { equals: latest.task.quality_report || {} }, publication_fact: { is: null },
                    published_link: null }, data: { quality_report: { ...quality, publication_task_delivery: {
                        ...latest.delivery, state: 'phase_b_started', phase_b_idempotency_key: DZEN1045_PHASE_B.idempotencyKey,
                        provider_object_id: DZEN1045_PHASE_B.providerId, final_submit_allowed: true,
                        final_submit_count: 0, phase_b_started_at: new Date().toISOString(), retry_via_api: false }
                    } as Prisma.InputJsonValue } });
                if (changed.count !== 1) return false;
                await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
                    actor_id: args.actorId, command: DZEN1045_PHASE_B.command,
                    idempotency_key: DZEN1045_PHASE_B.idempotencyKey,
                    before_state: { source_key: DZEN1045_PHASE_B.sourceKey,
                        source_failed_at: DZEN1045_PHASE_B.sourceFailedAt, preflight } as Prisma.InputJsonValue,
                    after_state: { state: 'phase_b_started', provider_object_id: DZEN1045_PHASE_B.providerId,
                        final_submit_count_max: 1 } as Prisma.InputJsonValue } });
                claimed = true; return true;
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
            submitOnce: () => dzenService.publishTask1045ExistingDraftOnce(config, guarded.task.draft_text || ''),
            record: async publication => {
                const fact = await publicationFactService.record({ projectId: 10, taskId: 1045,
                    actorId: args.actorId, artifactKind: 'article', outcome: 'published',
                    publicUrl: publication.public_url, providerObjectId: publication.provider_object_id,
                    publishedAt: publication.published_at, confirmationMode: 'automatic',
                    evidence: { type: 'public_url', ref: publication.public_url }, utmStatus: 'not_applicable',
                    note: 'Exact one-click Phase B publication of pre-existing Dzen task1045 draft.' });
                await prisma.$transaction(async tx => {
            await lockManualTransportMutation(tx,args);
                    const latest = await tx.contentItem.findFirst({ where: { id: 1045, project_id: 10 } });
                    const quality = object(latest?.quality_report); const delivery = object(quality.publication_task_delivery);
                    await tx.contentItem.update({ where: { id: 1045 }, data: { quality_report: { ...quality,
                        publication_task_delivery: { ...delivery, state: 'phase_b_published',
                            final_submit_allowed: false, final_submit_count: 1,
                            phase_b_completed_at: new Date().toISOString(), publication } } as Prisma.InputJsonValue } });
                    await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
                        actor_id: args.actorId, command: proofCommand,
                        idempotency_key: DZEN1045_PHASE_B.idempotencyKey,
                        after_state: { publication, publication_fact_id: fact.publication_fact.id,
                            final_submit_count: 1 } as Prisma.InputJsonValue } });
                }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
                return fact;
            }
        });
        return { ...result, replayed: false };
    } catch (error: unknown) {
        if (claimed) {
            const current = await prisma.contentItem.findFirst({ where: { id: 1045, project_id: 10 } });
            const quality = object(current?.quality_report); const delivery = object(quality.publication_task_delivery);
            await withManualTransportMutation(prisma,args,tx=>tx.contentItem.update({ where: { id: 1045 }, data: { quality_report: { ...quality,
                publication_task_delivery: { ...delivery, state: 'phase_b_uncertain', final_submit_allowed: false,
                    final_submit_may_have_occurred: true, final_submit_count_max: 1, retry_via_api: false,
                    error: error instanceof Error ? error.message : String(error),
                    phase_b_failed_at: new Date().toISOString() } } as Prisma.InputJsonValue } }));
        }
        throw error;
    }
}

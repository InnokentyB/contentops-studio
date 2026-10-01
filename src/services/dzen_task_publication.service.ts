import { createHash } from 'crypto';
import prisma from '../db';
import dzenService, { isDzenPublishedUrl } from './dzen.service';
import publicationFactService from './publication_fact.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';

const TASKS = {
    958: {
        bodySha256: '78081837cecace18c91c01af0253b21ca502e611b63a016f9d9035567587dfd3',
        decisionId: 147,
        releaseCommand: 'ba_release_approved_dzen_task958',
        verifyCommand: 'ba_verify_dzen_task958_connector', revision: 1, placement: 'feed',
        visualState: 'NO_VISUAL_NEEDED', selectedAssetId: null, publicationType: 'post' as const,
        allowedStatuses: ['ready_for_execution'], assetSha256: null
    },
    962: {
        bodySha256: '15c9b4a2e874439c4952900002ae5677fc3a6b6e8794dd34a0a4ae5f03dba798',
        decisionId: 146,
        releaseCommand: 'ba_release_approved_dzen_task962',
        verifyCommand: 'ba_verify_dzen_task962_connector', revision: 1, placement: 'feed',
        visualState: 'NO_VISUAL_NEEDED', selectedAssetId: null, publicationType: 'post' as const,
        allowedStatuses: ['ready_for_execution'], assetSha256: null
    },
    992: {
        bodySha256: '62af2b8e32d3aabb2b3d6f7029ee2b7ec64a7f9329eef01e52d6c4591e7eb150',
        decisionId: 186,
        releaseCommand: 'ba_release_approved_dzen_task992',
        verifyCommand: 'ba_verify_dzen_task992_connector', revision: 3, placement: 'article_cover',
        visualState: 'APPROVED', selectedAssetId: 97, publicationType: 'article' as const,
        allowedStatuses: ['awaiting_manual_publication', 'ready_for_execution'],
        assetSha256: '6061c4e53210de240d840e85e39990d7af5e496544f0cda4dd010048d33ebe25'
    }
} as const;

function taskSpec(taskId: number) {
    const spec = TASKS[taskId as keyof typeof TASKS];
    if (!spec) throw new Error('[DZEN_TASK_SCOPE_MISMATCH] Exact released Dzen task required');
    return {
        ...spec,
        taskId,
        command: `ba_publish_dzen_task${taskId}`,
        claimCommand: `ba_publish_dzen_task${taskId}_claim`,
        actor: `system:planner-mcp:dzen-task${taskId}`
    };
}

type Args = { projectId: number; taskId: number; dryRun?: boolean; idempotencyKey?: string };
type Dependencies = {
    db: any;
    dzen: {
        publishPost(config: any, text: string, imageUrl?: string, title?: string, type?: 'article' | 'post'): Promise<string>;
        testConnection(config: any): Promise<any>;
    };
    facts: { record(args: any): Promise<any> };
    hashBody?: (body: string) => string;
};

export class DzenTaskPublicationService {
    constructor(private readonly dependencies: Dependencies) {}

    async verifyConnector(args: { projectId: number; taskId: number; actorId: string; idempotencyKey: string }) {
        if (args.projectId !== 10) throw new Error('[DZEN_TASK_SCOPE_MISMATCH]');
        const spec = taskSpec(args.taskId);
        const match = /^user:(\d+)$/.exec(args.actorId);
        if (!match) throw new Error('[OWNER_REQUIRED]');
        const { db, dzen } = this.dependencies;
        const member = await db.projectMember.findUnique({ where: {
            project_id_user_id: { project_id: 10, user_id: Number(match[1]) }
        } });
        if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        const project = await db.project.findUnique({ where: { id: 10 }, select: { slug: true } });
        if (project?.slug !== 'analystcraft-2') throw new Error('[MCP_PROJECT_SCOPE_MISMATCH]');
        const prior = await db.workflowEvent.findFirst({ where: {
            project_id: 10, actor_id: args.actorId,
            command: spec.verifyCommand, idempotency_key: args.idempotencyKey
        } });
        if (prior) return prior.after_state;
        const task = await db.contentItem.findFirst({
            where: { id: spec.taskId, project_id: 10 }, include: { channel: true, selected_asset: true, publication_fact: true }
        });
        const hash = (this.dependencies.hashBody || ((body: string) => createHash('sha256').update(body).digest('hex')))(task?.draft_text || '');
        const assetSha = task?.selected_asset?.provenance?.planner_storage?.sha256
            || task?.selected_asset?.provenance?.sha256 || null;
        if (!task || task.channel_id !== 116 || task.channel?.type !== 'dzen'
            || task.publication_mode !== 'owner_released' || !spec.allowedStatuses.includes(task.status)
            || task.content_revision !== spec.revision || task.accepted_revision !== spec.revision
            || task.visual_placement !== spec.placement || task.visual_state !== spec.visualState
            || task.selected_asset_id !== spec.selectedAssetId
            || (spec.selectedAssetId !== null && (task.selected_asset?.status !== 'approved'
                || task.selected_asset?.content_revision !== spec.revision
                || assetSha !== spec.assetSha256 || !/^https:\/\//.test(task.selected_asset?.file_url || '')))
            || hash !== spec.bodySha256 || task.publication_fact || task.published_link) {
            throw new Error('[DZEN_CONNECTOR_PREFLIGHT_GUARD_FAILED]');
        }
        const config = resolveEffectiveChannelConfig('dzen', task.channel.config || {});
        if (!config.cookies?.trim() || !config.channel_id) throw new Error('[DZEN_CONNECTOR_NOT_READY] Missing authenticated session or channel ID');
        const check = await dzen.testConnection(config);
        if (check?.authenticated !== true || check?.editor_available !== true
            || !String(check?.editor_url || '').includes(`/id/${config.channel_id}`)) {
            throw new Error('[DZEN_CONNECTOR_NOT_READY] Authenticated channel editor was not verified');
        }
        const result = { task_id: spec.taskId, channel_id: 116, body_sha256: hash,
            authenticated: true, editor_available: true, checked_at: new Date().toISOString() };
        await db.workflowEvent.create({ data: {
            project_id: 10, content_item_id: spec.taskId, actor_id: args.actorId,
            command: spec.verifyCommand, idempotency_key: args.idempotencyKey,
            before_state: { task_id: spec.taskId, channel_id: 116, body_sha256: hash },
            after_state: result
        } });
        return result;
    }

    async execute(args: Args) {
        if (args.projectId !== 10) throw new Error('[DZEN_TASK_SCOPE_MISMATCH]');
        const spec = taskSpec(args.taskId);
        const { db, dzen, facts } = this.dependencies;
        const key = args.idempotencyKey?.trim() || null;
        if (!args.dryRun && !key) throw new Error('[IDEMPOTENCY_KEY_REQUIRED]');
        if (key) {
            const cached = await db.workflowEvent.findUnique({ where: {
                project_id_actor_id_command_idempotency_key: {
                    project_id: 10, actor_id: spec.actor, command: spec.command, idempotency_key: key
                }
            } });
            if (cached?.after_state) return { ...cached.after_state, replayed: true };
        }
        const task = await db.contentItem.findFirst({
            where: { id: spec.taskId, project_id: 10 },
            include: { channel: true, selected_asset: true, publication_fact: true }
        });
        if (!task || task.channel_id !== 116 || task.channel?.type !== 'dzen') {
            throw new Error('[DZEN_TASK_MISMATCH]');
        }
        if (task.publication_fact?.outcome === 'published' && task.publication_fact.public_url) {
            return { mode: 'published', task_id: spec.taskId, published_link: task.publication_fact.public_url,
                external_id: task.publication_fact.provider_object_id || null, replayed: true };
        }
        const release = await db.workflowEvent.findFirst({ where: {
            project_id: 10, content_item_id: spec.taskId, command: spec.releaseCommand
        }, orderBy: { id: 'desc' } });
        const proof = release?.after_state as any;
        const bodyHash = (this.dependencies.hashBody || ((body: string) => createHash('sha256').update(body).digest('hex')))(task.draft_text || '');
        const decision = await db.artDirectionDecision.findFirst({ where: {
            id: spec.decisionId, project_id: 10, content_item_id: spec.taskId,
            source_content_revision: spec.revision, channel: 'analystcraft_dzen', placement: spec.placement,
            ...(spec.visualState === 'NO_VISUAL_NEEDED' ? { decision: 'NO_VISUAL_NEEDED' } : {}), status: 'active'
        } });
        const selectedAsset = task.selected_asset;
        const selectedAssetSha = selectedAsset?.provenance?.planner_storage?.sha256
            || selectedAsset?.provenance?.sha256 || null;
        const validSelectedAsset = spec.selectedAssetId === null
            ? task.selected_asset_id === null
            : task.selected_asset_id === spec.selectedAssetId && selectedAsset?.id === spec.selectedAssetId
                && selectedAsset.status === 'approved' && selectedAsset.content_revision === spec.revision
                && /^https:\/\//.test(selectedAsset.file_url || '')
                && selectedAssetSha === spec.assetSha256;
        if (!proof || proof.task_id !== spec.taskId || proof.channel_id !== 116
            || proof.content_revision !== spec.revision || proof.accepted_revision !== spec.revision
            || proof.body_sha256 !== spec.bodySha256 || proof.body_sha256 !== bodyHash
            || proof.visual_decision_id !== spec.decisionId
            || (spec.assetSha256 !== null && proof.asset_sha256 !== spec.assetSha256)
            || proof.schedule_at !== (task.schedule_at ? task.schedule_at.toISOString() : null)
            || proof.publication_mode !== 'owner_released'
            || task.content_revision !== spec.revision || task.accepted_revision !== spec.revision
            || task.text_state !== 'accepted' || task.visual_placement !== spec.placement
            || task.visual_state !== spec.visualState || !validSelectedAsset
            || task.visual_decision_version !== decision?.decision_version
            || task.handoff_state !== 'ready' || task.publication_mode !== 'owner_released'
            || !decision || task.published_link) {
            throw new Error('[DZEN_OWNER_RELEASE_PROOF_MISMATCH]');
        }
        const config = resolveEffectiveChannelConfig('dzen', task.channel.config || {});
        const connectorProof = await db.workflowEvent.findFirst({ where: {
            project_id: 10, content_item_id: spec.taskId,
            command: spec.verifyCommand
        }, orderBy: { id: 'desc' } });
        const verified = connectorProof?.after_state as any;
        const connectorReady = Boolean(config.cookies?.trim()) && Boolean(config.channel_id)
            && verified?.task_id === spec.taskId && verified?.channel_id === 116
            && verified?.body_sha256 === spec.bodySha256 && verified?.authenticated === true
            && verified?.editor_available === true
            && Date.now() - new Date(verified.checked_at || 0).getTime() < 15 * 60_000;
        const preview = { text: task.draft_text, ...(spec.publicationType === 'article' ? { title: task.title } : {}),
            has_image: Boolean(selectedAsset), ...(selectedAsset ? { image_url: selectedAsset.file_url } : {}),
            publication_type: spec.publicationType, channel_id: 116, accepted_revision: spec.revision,
            visual_decision_id: spec.decisionId, ...(selectedAsset ? { selected_asset_id: selectedAsset.id } : {}) };
        if (args.dryRun) return { mode: 'dry_run', task_id: spec.taskId, project_id: 10,
            route_executable: connectorReady && spec.allowedStatuses.includes(task.status),
            connector_ready: connectorReady,
            ...(!connectorReady ? { route_blocker: 'DZEN_CONNECTOR_NOT_READY' }
                : !spec.allowedStatuses.includes(task.status) ? { route_blocker: 'PUBLICATION_ROUTE_NOT_EXECUTABLE' } : {}),
            payload_preview: preview };
        if (!connectorReady) throw new Error('[DZEN_CONNECTOR_NOT_READY] Channel requires enabled API publication and authenticated session');
        if (!spec.allowedStatuses.includes(task.status)) throw new Error('[DZEN_PUBLICATION_STATE_CHANGED]');
        if (task.schedule_at && new Date(task.schedule_at).getTime() > Date.now()) throw new Error('[PUBLICATION_NOT_DUE]');
        const owner = await db.projectMember.findFirst({ where: { project_id: 10, role: 'owner' }, orderBy: { id: 'asc' } });
        if (!owner) throw new Error('[PROJECT_OWNER_REQUIRED]');
        const claimed = await db.$transaction(async (tx: any) => {
            const changed = await tx.contentItem.updateMany({ where: {
                id: spec.taskId, project_id: 10, channel_id: 116,
                status: task.status, publication_mode: 'owner_released',
                content_revision: spec.revision, accepted_revision: spec.revision,
                visual_state: spec.visualState, selected_asset_id: spec.selectedAssetId,
                schedule_at: task.schedule_at
            }, data: {
                status: 'publishing', quality_report: {
                    ...((task.quality_report as any) || {}),
                    publication_task_delivery: { state: 'provider_call_started', channel_type: 'dzen',
                        idempotency_key: key, started_at: new Date().toISOString() }
                }
            } });
            if (changed.count === 1) await tx.workflowEvent.create({ data: {
                project_id: 10, content_item_id: spec.taskId, actor_id: spec.actor,
                command: spec.claimCommand, idempotency_key: key,
                before_state: { status: task.status },
                after_state: { status: 'publishing', channel_id: 116 }
            } });
            return changed.count;
        });
        if (claimed !== 1) throw new Error('[DZEN_PUBLICATION_ALREADY_CLAIMED] Reconcile before retry');
        let url: string;
        try {
            url = await dzen.publishPost(config, task.draft_text,
                selectedAsset?.file_url || undefined, spec.publicationType === 'article' ? task.title : undefined,
                spec.publicationType);
            if (!isDzenPublishedUrl(url)) throw new Error('Provider did not confirm a public Dzen URL');
        } catch (error: any) {
            await db.contentItem.update({ where: { id: spec.taskId }, data: {
                status: 'publishing', quality_report: {
                    ...((task.quality_report as any) || {}),
                    publication_task_delivery: { state: 'provider_result_uncertain', channel_type: 'dzen',
                        idempotency_key: key, retry_via_api: false,
                        error: String(error?.message || error), failed_at: new Date().toISOString() }
                }
            } });
            throw new Error('[DZEN_PUBLICATION_UNCERTAIN] Provider result requires manual reconciliation; do not retry');
        }
        const providerId = new URL(url).pathname.split('/').filter(Boolean).pop()!;
        try {
            await facts.record({ projectId: 10, taskId: spec.taskId, actorId: `user:${owner.user_id}`,
                artifactKind: 'post', outcome: 'published', publishedAt: new Date().toISOString(),
                publicUrl: url, providerObjectId: providerId, confirmationMode: 'automatic',
                evidence: { type: 'public_url', ref: url }, note: 'Published from exact owner-released Dzen task' });
        } catch {
            await db.contentItem.update({ where: { id: spec.taskId }, data: {
                status: 'publishing', quality_report: {
                    ...((task.quality_report as any) || {}),
                    publication_task_delivery: { state: 'provider_confirmed_fact_pending', channel_type: 'dzen',
                        idempotency_key: key, retry_via_api: false,
                        permalink: url, provider_object_id: providerId,
                        failed_at: new Date().toISOString() }
                }
            } });
            throw new Error('[DZEN_FACT_PENDING] Provider URL confirmed but fact write failed; reconcile without sending again');
        }
        const result = { mode: 'published', task_id: spec.taskId, project_id: 10, channel_id: 116,
            accepted_revision: spec.revision, published_link: url, external_id: providerId,
            delivery_method: 'dzen_browser', visual_decision_id: spec.decisionId,
            ...(selectedAsset ? { selected_asset_id: selectedAsset.id } : {}) };
        await db.$transaction(async (tx: any) => {
            await tx.contentItem.update({ where: { id: spec.taskId }, data: {
                status: 'published', publication_mode: 'owner_released', published_link: url,
                quality_report: { ...((task.quality_report as any) || {}),
                    publication_task_delivery: { state: 'provider_confirmed', channel_type: 'dzen',
                        idempotency_key: key, provider_object_id: providerId,
                        permalink: url, completed_at: new Date().toISOString() } }
            } });
            await tx.workflowEvent.create({ data: {
                project_id: 10, content_item_id: spec.taskId, actor_id: spec.actor,
                command: spec.command, idempotency_key: key,
                before_state: { status: task.status }, after_state: result
            } });
        });
        return result;
    }
}

export default new DzenTaskPublicationService({ db: prisma, dzen: dzenService, facts: publicationFactService });

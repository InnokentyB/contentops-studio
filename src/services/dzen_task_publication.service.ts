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
        verifyCommand: 'ba_verify_dzen_task958_connector'
    },
    962: {
        bodySha256: '15c9b4a2e874439c4952900002ae5677fc3a6b6e8794dd34a0a4ae5f03dba798',
        decisionId: 146,
        releaseCommand: 'ba_release_approved_dzen_task962',
        verifyCommand: 'ba_verify_dzen_task962_connector'
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
            where: { id: spec.taskId, project_id: 10 }, include: { channel: true, publication_fact: true }
        });
        const hash = (this.dependencies.hashBody || ((body: string) => createHash('sha256').update(body).digest('hex')))(task?.draft_text || '');
        if (!task || task.channel_id !== 116 || task.channel?.type !== 'dzen'
            || task.publication_mode !== 'owner_released' || task.status !== 'ready_for_execution'
            || task.content_revision !== 1 || task.accepted_revision !== 1
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
            include: { channel: true, publication_fact: true }
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
            source_content_revision: 1, channel: 'analystcraft_dzen', placement: 'feed',
            decision: 'NO_VISUAL_NEEDED', status: 'active'
        } });
        if (!proof || proof.task_id !== spec.taskId || proof.channel_id !== 116
            || proof.content_revision !== 1 || proof.accepted_revision !== 1
            || proof.body_sha256 !== spec.bodySha256 || proof.body_sha256 !== bodyHash
            || proof.visual_decision_id !== spec.decisionId
            || proof.schedule_at !== task.schedule_at?.toISOString()
            || proof.publication_mode !== 'owner_released'
            || task.content_revision !== 1 || task.accepted_revision !== 1
            || task.text_state !== 'accepted' || task.visual_placement !== 'feed'
            || task.visual_state !== 'NO_VISUAL_NEEDED' || task.selected_asset_id !== null
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
        const preview = { text: task.draft_text, has_image: false, publication_type: 'post',
            channel_id: 116, accepted_revision: 1, visual_decision_id: spec.decisionId };
        if (args.dryRun) return { mode: 'dry_run', task_id: spec.taskId, project_id: 10,
            route_executable: connectorReady && task.status === 'ready_for_execution',
            connector_ready: connectorReady,
            ...(!connectorReady ? { route_blocker: 'DZEN_CONNECTOR_NOT_READY' }
                : task.status !== 'ready_for_execution' ? { route_blocker: 'PUBLICATION_ROUTE_NOT_EXECUTABLE' } : {}),
            payload_preview: preview };
        if (!connectorReady) throw new Error('[DZEN_CONNECTOR_NOT_READY] Channel requires enabled API publication and authenticated session');
        if (task.status !== 'ready_for_execution') throw new Error('[DZEN_PUBLICATION_STATE_CHANGED]');
        if (task.schedule_at && new Date(task.schedule_at).getTime() > Date.now()) throw new Error('[PUBLICATION_NOT_DUE]');
        const owner = await db.projectMember.findFirst({ where: { project_id: 10, role: 'owner' }, orderBy: { id: 'asc' } });
        if (!owner) throw new Error('[PROJECT_OWNER_REQUIRED]');
        const claimed = await db.$transaction(async (tx: any) => {
            const changed = await tx.contentItem.updateMany({ where: {
                id: spec.taskId, project_id: 10, channel_id: 116,
                status: 'ready_for_execution', publication_mode: 'owner_released',
                content_revision: 1, accepted_revision: 1,
                visual_state: 'NO_VISUAL_NEEDED', selected_asset_id: null,
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
                before_state: { status: 'ready_for_execution' },
                after_state: { status: 'publishing', channel_id: 116 }
            } });
            return changed.count;
        });
        if (claimed !== 1) throw new Error('[DZEN_PUBLICATION_ALREADY_CLAIMED] Reconcile before retry');
        let url: string;
        try {
            url = await dzen.publishPost(config, task.draft_text, undefined, undefined, 'post');
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
            accepted_revision: 1, published_link: url, external_id: providerId,
            delivery_method: 'dzen_browser', visual_decision_id: spec.decisionId };
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
                before_state: { status: 'ready_for_execution' }, after_state: result
            } });
        });
        return result;
    }
}

export default new DzenTaskPublicationService({ db: prisma, dzen: dzenService, facts: publicationFactService });

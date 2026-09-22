import { createHash } from 'crypto';
import prisma from '../db';
import threadsService from './threads.service';
import publicationFactService from './publication_fact.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';

const BODY_SHA256 = 'e7d8c1f2f9cf4f7e3ca1ad6fb05e55153c2153739b3fcdf280e519f574b7f7a6';
const COMMAND = 'ba_publish_threads_task953';
const ACTOR = 'system:planner-mcp:threads-task953';

export class ThreadsTaskPublicationService {
    constructor(private readonly deps: any) {}
    async execute(args: { projectId: number; taskId: number; dryRun?: boolean; idempotencyKey?: string }) {
        if (args.projectId !== 10 || args.taskId !== 953) throw new Error('[THREADS_953_SCOPE_MISMATCH]');
        const db = this.deps.db;
        const key = args.idempotencyKey?.trim() || null;
        if (!args.dryRun && !key) throw new Error('[IDEMPOTENCY_KEY_REQUIRED]');
        if (key) {
            const prior = await db.workflowEvent.findUnique({ where: {
                project_id_actor_id_command_idempotency_key: {
                    project_id: 10, actor_id: ACTOR, command: COMMAND, idempotency_key: key
                }
            } });
            if (prior?.after_state) return { ...prior.after_state, replayed: true };
        }
        const task = await db.contentItem.findFirst({ where: { id: 953, project_id: 10 },
            include: { channel: true, publication_fact: true } });
        if (!task || task.channel_id !== 138 || task.channel?.type !== 'threads') throw new Error('[THREADS_953_TASK_MISMATCH]');
        if (task.publication_fact?.outcome === 'published' && task.publication_fact.public_url) {
            return { mode: 'published', task_id: 953, published_link: task.publication_fact.public_url, replayed: true };
        }
        const release = await db.workflowEvent.findFirst({ where: {
            project_id: 10, content_item_id: 953, command: 'ba_release_approved_threads_task953'
        }, orderBy: { id: 'desc' } });
        const proof = release?.after_state as any;
        const bodyHash = (this.deps.hashBody || ((body: string) => createHash('sha256').update(body).digest('hex')))(task.draft_text || '');
        const decision = await db.artDirectionDecision.findFirst({ where: {
            id: 149, project_id: 10, content_item_id: 953, source_content_revision: 4,
            channel: 'innokenty_threads', placement: 'feed', decision: 'NO_VISUAL_NEEDED', status: 'active'
        } });
        if (!proof || proof.task_id !== 953 || proof.channel_id !== 138
            || proof.content_revision !== 4 || proof.accepted_revision !== 4
            || proof.body_sha256 !== BODY_SHA256 || proof.body_sha256 !== bodyHash
            || proof.visual_decision_id !== 149 || proof.schedule_at !== task.schedule_at?.toISOString()
            || task.publication_mode !== 'owner_released' || task.status !== 'ready_for_execution'
            || task.content_revision !== 4 || task.accepted_revision !== 4 || task.text_state !== 'accepted'
            || task.visual_state !== 'NO_VISUAL_NEEDED' || task.selected_asset_id !== null
            || task.visual_decision_version !== decision?.decision_version || !decision
            || task.handoff_state !== 'ready' || task.published_link || (task.draft_text?.length || 0) > 500) {
            throw new Error('[THREADS_953_OWNER_RELEASE_PROOF_MISMATCH]');
        }
        const config = resolveEffectiveChannelConfig('threads', task.channel.config || {});
        const connectorReady = Boolean(config.threads_user_id && config.access_token);
        const preview = { text: task.draft_text, character_count: task.draft_text.length,
            has_image: false, channel_id: 138, accepted_revision: 4, visual_decision_id: 149 };
        if (args.dryRun) return { mode: 'dry_run', task_id: 953, project_id: 10,
            route_executable: connectorReady, connector_ready: connectorReady,
            ...(!connectorReady ? { route_blocker: 'THREADS_CONNECTOR_NOT_READY' } : {}),
            payload_preview: preview };
        if (!connectorReady) throw new Error('[THREADS_CONNECTOR_NOT_READY]');
        const owner = await db.projectMember.findFirst({ where: { project_id: 10, role: 'owner' }, orderBy: { id: 'asc' } });
        if (!owner) throw new Error('[PROJECT_OWNER_REQUIRED]');
        const claim = await db.contentItem.updateMany({ where: {
            id: 953, project_id: 10, status: 'ready_for_execution', publication_mode: 'owner_released',
            content_revision: 4, accepted_revision: 4, selected_asset_id: null, schedule_at: task.schedule_at
        }, data: { status: 'publishing' } });
        if (claim.count !== 1) throw new Error('[THREADS_PUBLICATION_ALREADY_CLAIMED]');
        let url: string;
        try {
            url = await this.deps.threads.publishPost(config.threads_user_id, config.access_token, task.draft_text);
            if (!/^https:\/\/(?:www\.)?threads\.net\/post\//.test(url)) throw new Error('Unverified Threads URL');
        } catch (error: any) {
            await db.contentItem.update({ where: { id: 953 }, data: { status: 'publishing',
                quality_report: { ...((task.quality_report as any) || {}), publication_task_delivery: {
                    state: 'provider_result_uncertain', channel_type: 'threads', idempotency_key: key,
                    retry_via_api: false, error: String(error?.message || error), failed_at: new Date().toISOString()
                } } } });
            throw new Error('[THREADS_PUBLICATION_UNCERTAIN] Reconcile before retry');
        }
        const providerId = new URL(url).pathname.split('/').filter(Boolean).pop()!;
        await this.deps.facts.record({ projectId: 10, taskId: 953, actorId: `user:${owner.user_id}`,
            artifactKind: 'post', outcome: 'published', publishedAt: new Date().toISOString(),
            publicUrl: url, providerObjectId: providerId, confirmationMode: 'automatic',
            evidence: { type: 'api', ref: url }, note: 'Published from exact owner-released Threads task' });
        const result = { mode: 'published', task_id: 953, project_id: 10, channel_id: 138,
            accepted_revision: 4, published_link: url, external_id: providerId, delivery_method: 'threads_api' };
        await db.$transaction(async (tx: any) => {
            await tx.contentItem.update({ where: { id: 953 }, data: {
                status: 'published', publication_mode: 'owner_released', published_link: url
            } });
            await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 953,
                actor_id: ACTOR, command: COMMAND, idempotency_key: key,
                before_state: { status: 'ready_for_execution' }, after_state: result } });
        });
        return result;
    }
}

export default new ThreadsTaskPublicationService({ db: prisma, threads: threadsService, facts: publicationFactService });

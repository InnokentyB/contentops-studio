import { createHash } from 'crypto';
import prisma from '../db';
import threadsService from './threads.service';
import publicationFactService from './publication_fact.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';

const TASK_SPECS = {
    953: { revision: 4, bodySha256: 'e7d8c1f2f9cf4f7e3ca1ad6fb05e55153c2153739b3fcdf280e519f574b7f7a6',
        decisionId: 149, releaseCommand: 'ba_release_approved_threads_task953', decisionChannel: 'innokenty_threads', chain: false },
    966: { revision: 1, bodySha256: '83dd0fe0b2b354898b9fd3e5161d5ab05517c4c2b2304862d74c949ce1e2b123',
        decisionId: 142, releaseCommand: 'ba_release_approved_threads_task966', decisionChannel: 'innokenty_threads', chain: false },
    997: { revision: 1, bodySha256: '53abc96f1fc3287ca47ff5be457335fed2e33c0955e11f527dbe23d8299cf94b',
        decisionId: 181, releaseCommand: 'ba_release_approved_threads_task997', decisionChannel: 'threads', chain: true },
    1029: { revision: 3, bodySha256: 'f59a4e27a001c2b6fd297683d626c1f2479125d184896036d91c2e3edae6666e',
        decisionId: 212, releaseCommand: 'ba_release_approved_threads_task1029', decisionChannel: 'threads', chain: false }
} as const;

function splitNativeThread(body: string) {
    return body.split(/\n\s*---\s*\n/).map(post => post.trim()).filter(Boolean);
}

export class ThreadsTaskPublicationService {
    constructor(private readonly deps: any) {}

    async isThreadsTask(args: { projectId: number; taskId: number }): Promise<boolean> {
        const task = await this.deps.db.contentItem.findFirst({
            where: { id: args.taskId, project_id: args.projectId },
            select: { channel: { select: { type: true } } }
        });
        return task?.channel?.type === 'threads';
    }

    async execute(args: { projectId: number; taskId: number; dryRun?: boolean; idempotencyKey?: string }) {
        const spec = TASK_SPECS[args.taskId as keyof typeof TASK_SPECS];
        const db = this.deps.db;
        const task = await db.contentItem.findFirst({ where: { id: args.taskId, project_id: args.projectId },
            include: { channel: true, publication_fact: true } });
        if (!task || task.channel?.type !== 'threads') throw new Error('[THREADS_TASK_MISMATCH]');

        const config = resolveEffectiveChannelConfig('threads', task.channel.config || {});
        const hasToken = Boolean(config.access_token);
        const hasIdentity = Boolean(config.threads_user_id);
        const connectorReady = hasToken && hasIdentity;
        if (args.dryRun) {
            const acceptedRevision = task.accepted_revision;
            if (!Number.isInteger(acceptedRevision) || acceptedRevision < 1
                || task.content_revision !== acceptedRevision || task.text_state !== 'accepted'
                || typeof task.draft_text !== 'string' || !task.draft_text.trim()) {
                throw new Error('[THREADS_TASK_NOT_CANONICAL]');
            }
            const posts = splitNativeThread(task.draft_text);
            const isChain = posts.length > 1;
            const nativeContentReady = isChain
                ? posts.every((post: string) => post.length <= 500)
                : task.draft_text.length <= 500;
            const livePublishSupported = args.projectId === 10 && Boolean(spec) && task.channel_id === 138;
            return {
                mode: 'dry_run', task_id: args.taskId, project_id: args.projectId, channel_id: task.channel_id,
                route_executable: connectorReady && nativeContentReady,
                connector_ready: connectorReady,
                live_publish_supported: livePublishSupported,
                credential_readiness: { access_token: hasToken },
                identity_readiness: { threads_user_id: config.threads_user_id || null, ready: hasIdentity },
                ...(!connectorReady ? { route_blocker: 'THREADS_CONNECTOR_NOT_READY' } : {}),
                ...(connectorReady && !nativeContentReady ? { route_blocker: 'THREADS_CONTENT_NOT_NATIVE' } : {}),
                payload_preview: {
                    ...(isChain ? { posts, post_count: posts.length } : { text: task.draft_text }),
                    character_count: task.draft_text.length,
                    has_image: Boolean(task.selected_asset_id),
                    channel_id: task.channel_id,
                    accepted_revision: acceptedRevision,
                    content_revision: task.content_revision,
                    visual_state: task.visual_state,
                    visual_decision_version: task.visual_decision_version,
                    selected_asset_id: task.selected_asset_id,
                    schedule_at: task.schedule_at?.toISOString() ?? null
                }
            };
        }

        if (args.projectId !== 10 || !spec || task.channel_id !== 138) throw new Error('[THREADS_TASK_SCOPE_MISMATCH]');
        const command = `ba_publish_threads_task${args.taskId}`;
        const actor = `system:planner-mcp:threads-task${args.taskId}`;
        const key = args.idempotencyKey?.trim() || null;
        if (!key) throw new Error('[IDEMPOTENCY_KEY_REQUIRED]');
        const prior = await db.workflowEvent.findUnique({ where: {
            project_id_actor_id_command_idempotency_key: {
                project_id: 10, actor_id: actor, command, idempotency_key: key
            }
        } });
        if (prior?.after_state) return { ...prior.after_state, replayed: true };
        if (task.publication_fact?.outcome === 'published' && task.publication_fact.public_url) {
            return { mode: 'published', task_id: args.taskId, published_link: task.publication_fact.public_url, replayed: true };
        }
        const release = await db.workflowEvent.findFirst({ where: {
            project_id: 10, content_item_id: args.taskId, command: spec.releaseCommand
        }, orderBy: { id: 'desc' } });
        const proof = release?.after_state as any;
        const bodyHash = (this.deps.hashBody || ((body: string) => createHash('sha256').update(body).digest('hex')))(task.draft_text || '');
        const decision = await db.artDirectionDecision.findFirst({ where: {
            id: spec.decisionId, project_id: 10, content_item_id: args.taskId, source_content_revision: spec.revision,
            channel: spec.decisionChannel, placement: 'feed', decision: 'NO_VISUAL_NEEDED', status: 'active'
        } });
        const posts = spec.chain ? splitNativeThread(task.draft_text || '') : [task.draft_text || ''];
        const validNativeChain = !spec.chain || (posts.length === 3
            && posts.every((post, index) => post.startsWith(`${index + 1}/3`) && post.length <= 500));
        if (!proof || proof.task_id !== args.taskId || proof.channel_id !== 138
            || proof.content_revision !== spec.revision || proof.accepted_revision !== spec.revision
            || proof.body_sha256 !== spec.bodySha256 || proof.body_sha256 !== bodyHash
            || proof.visual_decision_id !== spec.decisionId
            || (proof.schedule_at ?? null) !== (task.schedule_at?.toISOString() ?? null)
            || (args.taskId === 997 && (proof.publication_authorized !== true || release?.id !== 1887))
            || task.publication_mode !== 'owner_released' || task.status !== 'ready_for_execution'
            || task.content_revision !== spec.revision || task.accepted_revision !== spec.revision || task.text_state !== 'accepted'
            || task.visual_state !== 'NO_VISUAL_NEEDED' || task.selected_asset_id !== null
            || task.visual_decision_version !== decision?.decision_version || !decision
            || task.handoff_state !== 'ready' || task.published_link || !validNativeChain
            || (!spec.chain && (task.draft_text?.length || 0) > 500)) {
            throw new Error('[THREADS_OWNER_RELEASE_PROOF_MISMATCH]');
        }
        if (!connectorReady) throw new Error('[THREADS_CONNECTOR_NOT_READY]');
        const owner = await db.projectMember.findFirst({ where: { project_id: 10, role: 'owner' }, orderBy: { id: 'asc' } });
        if (!owner) throw new Error('[PROJECT_OWNER_REQUIRED]');
        const claim = await db.contentItem.updateMany({ where: {
            id: args.taskId, project_id: 10, status: 'ready_for_execution', publication_mode: 'owner_released',
            content_revision: spec.revision, accepted_revision: spec.revision, selected_asset_id: null, schedule_at: task.schedule_at
        }, data: { status: 'publishing' } });
        if (claim.count !== 1) throw new Error('[THREADS_PUBLICATION_ALREADY_CLAIMED]');
        let url: string;
        try {
            const published = spec.chain
                ? await this.deps.threads.publishThread(config.threads_user_id, config.access_token, posts)
                : { rootUrl: await this.deps.threads.publishPost(config.threads_user_id, config.access_token, task.draft_text) };
            url = published.rootUrl;
            if (!/^https:\/\/(?:www\.)?threads\.(?:net|com)\/(?:@[^/]+\/)?post\//.test(url)) throw new Error('Unverified Threads URL');
        } catch (error: any) {
            await db.contentItem.update({ where: { id: args.taskId }, data: { status: 'publishing',
                quality_report: { ...((task.quality_report as any) || {}), publication_task_delivery: {
                    state: 'provider_result_uncertain', channel_type: 'threads', idempotency_key: key,
                    retry_via_api: false, error: String(error?.message || error), failed_at: new Date().toISOString()
                } } } });
            throw new Error('[THREADS_PUBLICATION_UNCERTAIN] Reconcile before retry');
        }
        const providerId = new URL(url).pathname.split('/').filter(Boolean).pop()!;
        await this.deps.facts.record({ projectId: 10, taskId: args.taskId, actorId: `user:${owner.user_id}`,
            artifactKind: 'post', outcome: 'published', publishedAt: new Date().toISOString(),
            publicUrl: url, providerObjectId: providerId, confirmationMode: 'automatic',
            evidence: { type: 'api', ref: url }, note: 'Published from exact owner-released Threads task' });
        const result = { mode: 'published', task_id: args.taskId, project_id: 10, channel_id: 138,
            accepted_revision: spec.revision, published_link: url, external_id: providerId, delivery_method: 'threads_api' };
        await db.$transaction(async (tx: any) => {
            await tx.contentItem.update({ where: { id: args.taskId }, data: {
                status: 'published', publication_mode: 'owner_released', published_link: url
            } });
            await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: args.taskId,
                actor_id: actor, command, idempotency_key: key,
                before_state: { status: 'ready_for_execution' }, after_state: result } });
        });
        return result;
    }
}

export default new ThreadsTaskPublicationService({ db: prisma, threads: threadsService, facts: publicationFactService });

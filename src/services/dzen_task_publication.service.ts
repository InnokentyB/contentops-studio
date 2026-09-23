import { createHash } from 'crypto';
import prisma from '../db';
import dzenService, { isDzenPublishedUrl } from './dzen.service';
import publicationFactService from './publication_fact.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';

const BODY_SHA256 = '78081837cecace18c91c01af0253b21ca502e611b63a016f9d9035567587dfd3';
const COMMAND = 'ba_publish_dzen_task958';
const CLAIM_COMMAND = `${COMMAND}_claim`;
const ACTOR = 'system:planner-mcp:dzen-task958';
const CONFIRMED_ABSENT_IDEMPOTENCY_KEYS = new Set([
    'publish-task-958-rev1-20260923',
    'publish-task-958-rev1-resume-20260923-001',
    'publish-task-958-rev1-resume2-20260923-001',
    'publish-task-958-rev1-resume3-20260923-001',
    'publish-task-958-rev1-resume4-20260923-001',
    'publish-task-958-rev1-resume5-20260923-001',
    'publish-task-958-rev1-resume6-20260923-001',
    'publish-task-958-rev1-resume7-20260923-001'
]);
const NEXT_IDEMPOTENCY_BY_PREVIOUS = new Map([
    ['publish-task-958-rev1-20260923', 'publish-task-958-rev1-resume-20260923-001'],
    ['publish-task-958-rev1-resume-20260923-001', 'publish-task-958-rev1-resume2-20260923-001'],
    ['publish-task-958-rev1-resume2-20260923-001', 'publish-task-958-rev1-resume3-20260923-001'],
    ['publish-task-958-rev1-resume3-20260923-001', 'publish-task-958-rev1-resume4-20260923-001'],
    ['publish-task-958-rev1-resume4-20260923-001', 'publish-task-958-rev1-resume5-20260923-001'],
    ['publish-task-958-rev1-resume5-20260923-001', 'publish-task-958-rev1-resume6-20260923-001'],
    ['publish-task-958-rev1-resume6-20260923-001', 'publish-task-958-rev1-resume7-20260923-001'],
    ['publish-task-958-rev1-resume7-20260923-001', 'publish-task-958-rev1-resume8-20260923-001']
]);
const RECONCILE_COMMAND = 'ba_reconcile_dzen_task958_absent';
const RESUME_COMMAND = 'ba_resume_dzen_task958_after_absence';

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

    private async requireOwner(db: any, actorId: string) {
        const match = /^user:(\d+)$/.exec(actorId);
        if (!match) throw new Error('[OWNER_REQUIRED]');
        const member = await db.projectMember.findUnique({ where: {
            project_id_user_id: { project_id: 10, user_id: Number(match[1]) }
        } });
        if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    }

    async reconcileAbsent(args: { projectId: number; taskId: number; channelId: number;
        actorId: string; expectedBodySha256: string; previousIdempotencyKey: string;
        reason: string; idempotencyKey: string }) {
        if (args.projectId !== 10 || args.taskId !== 958 || args.channelId !== 116
            || args.expectedBodySha256 !== BODY_SHA256
            || !CONFIRMED_ABSENT_IDEMPOTENCY_KEYS.has(args.previousIdempotencyKey)
            || args.reason !== 'provider_absence_confirmed_pre_send') {
            throw new Error('[DZEN_958_RECONCILIATION_SCOPE_MISMATCH]');
        }
        const db = this.dependencies.db;
        return db.$transaction(async (tx: any) => {
            const project = await tx.project.findUnique({ where: { id: 10 }, select: { slug: true } });
            if (project?.slug !== 'analystcraft-2') throw new Error('[MCP_PROJECT_SCOPE_MISMATCH]');
            await this.requireOwner(tx, args.actorId);
            const prior = await tx.workflowEvent.findFirst({ where: {
                project_id: 10, actor_id: args.actorId, command: RECONCILE_COMMAND,
                idempotency_key: args.idempotencyKey
            } });
            if (prior) return prior.after_state;
            const task = await tx.contentItem.findFirst({ where: { id: 958, project_id: 10 },
                include: { publication_fact: true } });
            const bodyHash = (this.dependencies.hashBody || ((body: string) => createHash('sha256').update(body).digest('hex')))(task?.draft_text || '');
            const delivery = task?.quality_report?.publication_task_delivery;
            if (!task || task.channel_id !== 116 || task.content_revision !== 1 || task.accepted_revision !== 1
                || bodyHash !== BODY_SHA256 || task.status !== 'publishing' || task.published_link
                || task.publication_fact || delivery?.state !== 'provider_result_uncertain'
                || delivery?.idempotency_key !== args.previousIdempotencyKey) {
                throw new Error('[DZEN_958_RECONCILIATION_GUARD_FAILED]');
            }
            const reconciledAt = new Date().toISOString();
            const qualityReport = { ...(task.quality_report || {}), publication_task_delivery: {
                ...delivery, state: 'reconciled_absent', reason: args.reason,
                retry_via_api: false, reconciled_at: reconciledAt
            } };
            const changed = await tx.contentItem.updateMany({ where: {
                id: 958, project_id: 10, channel_id: 116, status: 'publishing',
                content_revision: 1, accepted_revision: 1, published_link: null
            }, data: { status: 'blocked', quality_report: qualityReport } });
            if (changed.count !== 1) throw new Error('[DZEN_958_RECONCILIATION_CAS_CONFLICT]');
            const result = { task_id: 958, channel_id: 116, status: 'blocked',
                body_sha256: bodyHash, previous_idempotency_key: args.previousIdempotencyKey,
                reason: args.reason, reconciled_at: reconciledAt, published: false };
            await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 958,
                actor_id: args.actorId, command: RECONCILE_COMMAND, idempotency_key: args.idempotencyKey,
                before_state: { status: 'publishing', delivery_state: delivery.state,
                    previous_idempotency_key: args.previousIdempotencyKey }, after_state: result } });
            return result;
        });
    }

    async resumeAfterAbsence(args: { projectId: number; taskId: number; channelId: number;
        actorId: string; expectedBodySha256: string; previousIdempotencyKey: string;
        nextPublicationIdempotencyKey: string; approvalReference: string; idempotencyKey: string }) {
        if (args.projectId !== 10 || args.taskId !== 958 || args.channelId !== 116
            || args.expectedBodySha256 !== BODY_SHA256
            || !CONFIRMED_ABSENT_IDEMPOTENCY_KEYS.has(args.previousIdempotencyKey)
            || !args.nextPublicationIdempotencyKey.trim()
            || args.nextPublicationIdempotencyKey !== NEXT_IDEMPOTENCY_BY_PREVIOUS.get(args.previousIdempotencyKey)) {
            throw new Error('[DZEN_958_RESUME_SCOPE_MISMATCH]');
        }
        const db = this.dependencies.db;
        return db.$transaction(async (tx: any) => {
            const project = await tx.project.findUnique({ where: { id: 10 }, select: { slug: true } });
            if (project?.slug !== 'analystcraft-2') throw new Error('[MCP_PROJECT_SCOPE_MISMATCH]');
            await this.requireOwner(tx, args.actorId);
            const prior = await tx.workflowEvent.findFirst({ where: {
                project_id: 10, actor_id: args.actorId, command: RESUME_COMMAND,
                idempotency_key: args.idempotencyKey
            } });
            if (prior) return prior.after_state;
            const task = await tx.contentItem.findFirst({ where: { id: 958, project_id: 10 },
                include: { publication_fact: true } });
            const bodyHash = (this.dependencies.hashBody || ((body: string) => createHash('sha256').update(body).digest('hex')))(task?.draft_text || '');
            const delivery = task?.quality_report?.publication_task_delivery;
            if (!task || task.channel_id !== 116 || task.content_revision !== 1 || task.accepted_revision !== 1
                || bodyHash !== BODY_SHA256 || task.status !== 'blocked' || task.published_link
                || task.publication_fact || delivery?.state !== 'reconciled_absent'
                || delivery?.idempotency_key !== args.previousIdempotencyKey
                || delivery?.reason !== 'provider_absence_confirmed_pre_send') {
                throw new Error('[DZEN_958_RESUME_GUARD_FAILED]');
            }
            const resumedAt = new Date().toISOString();
            const qualityReport = { ...(task.quality_report || {}), publication_task_delivery: {
                ...delivery, state: 'resumed_for_explicit_send', retry_via_api: false,
                next_publication_idempotency_key: args.nextPublicationIdempotencyKey,
                approval_reference: args.approvalReference, resumed_at: resumedAt
            } };
            const changed = await tx.contentItem.updateMany({ where: {
                id: 958, project_id: 10, channel_id: 116, status: 'blocked',
                content_revision: 1, accepted_revision: 1, published_link: null
            }, data: { status: 'ready_for_execution', quality_report: qualityReport } });
            if (changed.count !== 1) throw new Error('[DZEN_958_RESUME_CAS_CONFLICT]');
            const result = { task_id: 958, channel_id: 116, status: 'ready_for_execution',
                body_sha256: bodyHash, previous_idempotency_key: args.previousIdempotencyKey,
                next_publication_idempotency_key: args.nextPublicationIdempotencyKey,
                explicit_send_required: true, published: false, resumed_at: resumedAt };
            await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 958,
                actor_id: args.actorId, command: RESUME_COMMAND, idempotency_key: args.idempotencyKey,
                before_state: { status: 'blocked', delivery_state: delivery.state,
                    previous_idempotency_key: args.previousIdempotencyKey }, after_state: result } });
            return result;
        });
    }

    async verifyConnector(args: { projectId: number; taskId: number; actorId: string; idempotencyKey: string }) {
        if (args.projectId !== 10 || args.taskId !== 958) throw new Error('[DZEN_958_SCOPE_MISMATCH]');
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
            command: 'ba_verify_dzen_task958_connector', idempotency_key: args.idempotencyKey
        } });
        if (prior) return prior.after_state;
        const task = await db.contentItem.findFirst({
            where: { id: 958, project_id: 10 }, include: { channel: true, publication_fact: true }
        });
        const hash = (this.dependencies.hashBody || ((body: string) => createHash('sha256').update(body).digest('hex')))(task?.draft_text || '');
        if (!task || task.channel_id !== 116 || task.channel?.type !== 'dzen'
            || task.publication_mode !== 'owner_released' || task.status !== 'ready_for_execution'
            || task.content_revision !== 1 || task.accepted_revision !== 1
            || hash !== BODY_SHA256 || task.publication_fact || task.published_link) {
            throw new Error('[DZEN_958_CONNECTOR_PREFLIGHT_GUARD_FAILED]');
        }
        const config = resolveEffectiveChannelConfig('dzen', task.channel.config || {});
        if (!config.cookies?.trim() || !config.channel_id) throw new Error('[DZEN_CONNECTOR_NOT_READY] Missing authenticated session or channel ID');
        const check = await dzen.testConnection(config);
        if (check?.authenticated !== true || check?.editor_available !== true
            || !String(check?.editor_url || '').includes(`/id/${config.channel_id}`)) {
            throw new Error('[DZEN_CONNECTOR_NOT_READY] Authenticated channel editor was not verified');
        }
        const result = { task_id: 958, channel_id: 116, body_sha256: hash,
            authenticated: true, editor_available: true, checked_at: new Date().toISOString() };
        await db.workflowEvent.create({ data: {
            project_id: 10, content_item_id: 958, actor_id: args.actorId,
            command: 'ba_verify_dzen_task958_connector', idempotency_key: args.idempotencyKey,
            before_state: { task_id: 958, channel_id: 116, body_sha256: hash },
            after_state: result
        } });
        return result;
    }

    async execute(args: Args) {
        if (args.projectId !== 10 || args.taskId !== 958) throw new Error('[DZEN_958_SCOPE_MISMATCH]');
        const { db, dzen, facts } = this.dependencies;
        const key = args.idempotencyKey?.trim() || null;
        if (!args.dryRun && !key) throw new Error('[IDEMPOTENCY_KEY_REQUIRED]');
        if (key) {
            const cached = await db.workflowEvent.findUnique({ where: {
                project_id_actor_id_command_idempotency_key: {
                    project_id: 10, actor_id: ACTOR, command: COMMAND, idempotency_key: key
                }
            } });
            if (cached?.after_state) return { ...cached.after_state, replayed: true };
        }
        const task = await db.contentItem.findFirst({
            where: { id: 958, project_id: 10 },
            include: { channel: true, publication_fact: true }
        });
        if (!task || task.channel_id !== 116 || task.channel?.type !== 'dzen') {
            throw new Error('[DZEN_958_TASK_MISMATCH]');
        }
        if (task.publication_fact?.outcome === 'published' && task.publication_fact.public_url) {
            return { mode: 'published', task_id: 958, published_link: task.publication_fact.public_url,
                external_id: task.publication_fact.provider_object_id || null, replayed: true };
        }
        const release = await db.workflowEvent.findFirst({ where: {
            project_id: 10, content_item_id: 958, command: 'ba_release_approved_dzen_task958'
        }, orderBy: { id: 'desc' } });
        const proof = release?.after_state as any;
        const bodyHash = (this.dependencies.hashBody || ((body: string) => createHash('sha256').update(body).digest('hex')))(task.draft_text || '');
        const decision = await db.artDirectionDecision.findFirst({ where: {
            id: 147, project_id: 10, content_item_id: 958,
            source_content_revision: 1, channel: 'analystcraft_dzen', placement: 'feed',
            decision: 'NO_VISUAL_NEEDED', status: 'active'
        } });
        if (!proof || proof.task_id !== 958 || proof.channel_id !== 116
            || proof.content_revision !== 1 || proof.accepted_revision !== 1
            || proof.body_sha256 !== BODY_SHA256 || proof.body_sha256 !== bodyHash
            || proof.visual_decision_id !== 147
            || proof.schedule_at !== task.schedule_at?.toISOString()
            || proof.publication_mode !== 'owner_released'
            || task.content_revision !== 1 || task.accepted_revision !== 1
            || task.text_state !== 'accepted' || task.visual_placement !== 'feed'
            || task.visual_state !== 'NO_VISUAL_NEEDED' || task.selected_asset_id !== null
            || task.visual_decision_version !== decision?.decision_version
            || task.handoff_state !== 'ready' || task.publication_mode !== 'owner_released'
            || !decision || task.published_link) {
            throw new Error('[DZEN_958_OWNER_RELEASE_PROOF_MISMATCH]');
        }
        const config = resolveEffectiveChannelConfig('dzen', task.channel.config || {});
        const connectorProof = await db.workflowEvent.findFirst({ where: {
            project_id: 10, content_item_id: 958,
            command: 'ba_verify_dzen_task958_connector'
        }, orderBy: { id: 'desc' } });
        const verified = connectorProof?.after_state as any;
        const connectorReady = Boolean(config.cookies?.trim()) && Boolean(config.channel_id)
            && verified?.task_id === 958 && verified?.channel_id === 116
            && verified?.body_sha256 === BODY_SHA256 && verified?.authenticated === true
            && verified?.editor_available === true
            && Date.now() - new Date(verified.checked_at || 0).getTime() < 15 * 60_000;
        const preview = { text: task.draft_text, has_image: false, publication_type: 'post',
            channel_id: 116, accepted_revision: 1, visual_decision_id: 147 };
        if (args.dryRun) return { mode: 'dry_run', task_id: 958, project_id: 10,
            route_executable: connectorReady && task.status === 'ready_for_execution',
            connector_ready: connectorReady,
            ...(!connectorReady ? { route_blocker: 'DZEN_CONNECTOR_NOT_READY' }
                : task.status !== 'ready_for_execution' ? { route_blocker: 'PUBLICATION_ROUTE_NOT_EXECUTABLE' } : {}),
            payload_preview: preview };
        if (!connectorReady) throw new Error('[DZEN_CONNECTOR_NOT_READY] Channel requires enabled API publication and authenticated session');
        if (task.status !== 'ready_for_execution') throw new Error('[DZEN_PUBLICATION_STATE_CHANGED]');
        if (task.schedule_at && new Date(task.schedule_at).getTime() > Date.now()) throw new Error('[PUBLICATION_NOT_DUE]');
        const resumedDelivery = task.quality_report?.publication_task_delivery;
        if (resumedDelivery?.state === 'resumed_for_explicit_send'
            && resumedDelivery.next_publication_idempotency_key !== key) {
            throw new Error('[DZEN_958_RESUMED_IDEMPOTENCY_MISMATCH]');
        }
        const owner = await db.projectMember.findFirst({ where: { project_id: 10, role: 'owner' }, orderBy: { id: 'asc' } });
        if (!owner) throw new Error('[PROJECT_OWNER_REQUIRED]');
        const claimed = await db.$transaction(async (tx: any) => {
            const changed = await tx.contentItem.updateMany({ where: {
                id: 958, project_id: 10, channel_id: 116,
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
                project_id: 10, content_item_id: 958, actor_id: ACTOR,
                command: CLAIM_COMMAND, idempotency_key: key,
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
            await db.contentItem.update({ where: { id: 958 }, data: {
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
            await facts.record({ projectId: 10, taskId: 958, actorId: `user:${owner.user_id}`,
                artifactKind: 'post', outcome: 'published', publishedAt: new Date().toISOString(),
                publicUrl: url, providerObjectId: providerId, confirmationMode: 'automatic',
                evidence: { type: 'public_url', ref: url }, note: 'Published from exact owner-released Dzen task' });
        } catch {
            await db.contentItem.update({ where: { id: 958 }, data: {
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
        const result = { mode: 'published', task_id: 958, project_id: 10, channel_id: 116,
            accepted_revision: 1, published_link: url, external_id: providerId,
            delivery_method: 'dzen_browser', visual_decision_id: 147 };
        await db.$transaction(async (tx: any) => {
            await tx.contentItem.update({ where: { id: 958 }, data: {
                status: 'published', publication_mode: 'owner_released', published_link: url,
                quality_report: { ...((task.quality_report as any) || {}),
                    publication_task_delivery: { state: 'provider_confirmed', channel_type: 'dzen',
                        idempotency_key: key, provider_object_id: providerId,
                        permalink: url, completed_at: new Date().toISOString() } }
            } });
            await tx.workflowEvent.create({ data: {
                project_id: 10, content_item_id: 958, actor_id: ACTOR,
                command: COMMAND, idempotency_key: key,
                before_state: { status: 'ready_for_execution' }, after_state: result
            } });
        });
        return result;
    }
}

export default new DzenTaskPublicationService({ db: prisma, dzen: dzenService, facts: publicationFactService });

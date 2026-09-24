import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { calculateVisualReadiness } from './art_direction.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';

const C20_TASK_IDS = [968, 969, 971, 972, 973, 974];
const DZEN_958_BODY_SHA256 = '78081837cecace18c91c01af0253b21ca502e611b63a016f9d9035567587dfd3';
const THREADS_953_BODY_SHA256 = 'e7d8c1f2f9cf4f7e3ca1ad6fb05e55153c2153739b3fcdf280e519f574b7f7a6';
const THREADS_959_BODY_SHA256 = 'c3e7912e4f32aceafae19ea99751ef98f3f7d26554b9dfe160e78222eb64cf39';
const TASK_972_BODY_SHA256 = 'b971d270d3a2deb2d21bbd1cb9e77598340e0426e84c4bf2219ad0a6d926d283';
const TASK_973_BODY_SHA256 = '191ba9f5408ce30e9678cbe35ae5dc5b47168ebdd5069221c43f6a217374e65d';
const TASK_972_TITLE = '@analysts_thinking 23.09 — 202 Accepted is not done';
const TASK_972_BRIEF = 'C20 daily post 3/7. Synthetic S19 access-transfer example: 202 Accepted confirms queue admission, not business completion; follow terminal outcome, partial-result recovery and actual-state reconciliation. No CTA. Exact rev1 accepted; substantive revision-bound APPROVED visual required; no automatic release.';
const TASK_960_BODY_SHA256 = '39791d0315ad8c02d1d71566b4a1b775916f2f26f25ba971051dae8d259c6c43';

type VisualExpectation = {
    taskId: number;
    expectedContentRevision: number;
    expectedAcceptedRevision: number | null;
    expectedStatus: string;
    expectedVisualState: string;
    expectedScheduleAt: string;
};

type TelegramRelease = {
    projectId: number;
    actorId: string;
    taskId: number;
    expectedChannelId: number;
    expectedContentRevision: number;
    expectedAcceptedRevision: number;
    expectedVisualMode: string;
    expectedVisualState: string;
    expectedSelectedAssetId: number | null;
    expectedScheduleAt: string;
    expectedBodySha256: string;
    approvalReference: string;
    idempotencyKey: string;
};

function sha256(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function assertExactC20VisualSet(items: VisualExpectation[]) {
    const ids = items.map(item => item.taskId).sort((a, b) => a - b);
    if (ids.length !== C20_TASK_IDS.length || ids.some((id, index) => id !== C20_TASK_IDS[index])) {
        throw new Error('[C20_TASK_SET_MISMATCH] Exact six C20 tasks are required');
    }
}

export class OwnerPublicationControlsService {
    constructor(private readonly db: any = prisma,
        private readonly hashBody: (body: string) => string = body => createHash('sha256').update(body).digest('hex')) {}

    private async requireOwner(tx: any, projectId: number, actorId: string) {
        const match = /^user:(\d+)$/.exec(actorId);
        if (!match) throw new Error('[OWNER_REQUIRED] Authenticated project-owner user is required');
        const membership = await tx.projectMember.findUnique({ where: {
            project_id_user_id: { project_id: projectId, user_id: Number(match[1]) }
        } });
        if (membership?.role !== 'owner') throw new Error('[OWNER_REQUIRED] Project-owner role is required');
    }

    async requireTask971Visual(args: {
        projectId: number; actorId: string; taskId: number; expectedChannelId: number;
        expectedContentRevision: number; expectedAcceptedRevision: number;
        expectedSelectedAssetId: number; expectedScheduleAt: string;
        expectedStatus: string; expectedVisualState: string; idempotencyKey: string;
    }) {
        if (args.projectId !== 10 || args.taskId !== 971 || args.expectedChannelId !== 111
            || args.expectedContentRevision !== 3 || args.expectedAcceptedRevision !== 3
            || args.expectedSelectedAssetId !== 76) {
            throw new Error('[C20_TASK971_SCOPE_MISMATCH] Exact project/task/channel/revision/asset required');
        }
        const requestHash = sha256(args);
        return this.db.$transaction(async (tx: any) => {
            const project = await tx.project.findUnique({ where: { id: 10 }, select: { slug: true } });
            if (project?.slug !== 'analystcraft-2') throw new Error('[MCP_PROJECT_SCOPE_MISMATCH]');
            await this.requireOwner(tx, 10, args.actorId);
            const command = 'ba_require_task971_publication_visual';
            const prior = await tx.workflowEvent.findFirst({ where: {
                project_id: 10, actor_id: args.actorId, command, idempotency_key: args.idempotencyKey
            } });
            if (prior) {
                if (prior.before_state?.request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
                return prior.after_state;
            }
            const task = await tx.contentItem.findFirst({
                where: { id: 971, project_id: 10 },
                include: { selected_asset: true, publication_fact: true }
            });
            if (!task || task.channel_id !== 111 || task.content_revision !== 3
                || task.accepted_revision !== 3 || task.visual_placement !== 'feed'
                || task.visual_mode !== 'auto_assess' || task.selected_asset_id !== 76
                || task.selected_asset?.status !== 'approved'
                || task.selected_asset?.content_revision !== 3
                || task.publication_mode !== 'approval_required'
                || task.status !== args.expectedStatus || task.visual_state !== args.expectedVisualState
                || task.schedule_at?.toISOString() !== args.expectedScheduleAt
                || task.publication_fact || task.published_link
                || ['published', 'removed', 'cancelled'].includes(task.status)) {
                throw new Error('[C20_TASK971_VISUAL_GUARD_FAILED]');
            }
            const changed = await tx.contentItem.updateMany({
                where: {
                    id: 971, project_id: 10, channel_id: 111,
                    content_revision: 3, accepted_revision: 3,
                    visual_placement: 'feed', visual_mode: 'auto_assess',
                    selected_asset_id: 76, publication_mode: 'approval_required',
                    status: args.expectedStatus, visual_state: args.expectedVisualState,
                    schedule_at: new Date(args.expectedScheduleAt)
                },
                data: { visual_mode: 'required' }
            });
            if (changed.count !== 1) throw new Error('[C20_TASK971_VISUAL_CAS_CONFLICT]');
            const result = { task_id: 971, project_id: 10, channel_id: 111,
                content_revision: 3, accepted_revision: 3, selected_asset_id: 76,
                visual_placement: 'feed', visual_mode: 'required',
                publication_mode: 'approval_required', published: false };
            await tx.workflowEvent.create({ data: {
                project_id: 10, content_item_id: 971, actor_id: args.actorId,
                command, idempotency_key: args.idempotencyKey,
                before_state: { request_hash: requestHash, visual_mode: 'auto_assess',
                    status: task.status, visual_state: task.visual_state,
                    schedule_at: args.expectedScheduleAt }, after_state: result
            } });
            return result;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    async requireTask972Visual(args: {
        projectId: number; actorId: string; taskId: number; expectedChannelId: number;
        expectedContentRevision: number; expectedAcceptedRevision: number;
        expectedSelectedAssetId: number; expectedDecisionId: number;
        expectedScheduleAt: string; expectedBodySha256: string;
        expectedStatus: string; idempotencyKey: string;
    }) {
        if (args.projectId !== 10 || args.taskId !== 972 || args.expectedChannelId !== 111
            || args.expectedContentRevision !== 1 || args.expectedAcceptedRevision !== 1
            || args.expectedSelectedAssetId !== 77 || args.expectedDecisionId !== 152
            || args.expectedBodySha256 !== TASK_972_BODY_SHA256) {
            throw new Error('[TASK972_SCOPE_MISMATCH] Exact task/revision/asset/decision/body required');
        }
        const requestHash = sha256(args);
        return this.db.$transaction(async (tx: any) => {
            const project = await tx.project.findUnique({ where: { id: 10 }, select: { slug: true } });
            if (project?.slug !== 'analystcraft-2') throw new Error('[MCP_PROJECT_SCOPE_MISMATCH]');
            await this.requireOwner(tx, 10, args.actorId);
            const command = 'ba_require_task972_publication_visual';
            const prior = await tx.workflowEvent.findFirst({ where: {
                project_id: 10, actor_id: args.actorId, command, idempotency_key: args.idempotencyKey
            } });
            if (prior) {
                if (prior.before_state?.request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
                return prior.after_state;
            }
            const task = await tx.contentItem.findFirst({ where: { id: 972, project_id: 10 },
                include: { selected_asset: true, publication_fact: true } });
            const decision = await tx.artDirectionDecision.findFirst({ where: {
                id: 152, project_id: 10, content_item_id: 972, source_content_revision: 1,
                channel: 'telegram', placement: 'feed', decision: 'GENERATE', status: 'active'
            } });
            const bodyHash = this.hashBody(task?.draft_text || '');
            if (!task || task.channel_id !== 111 || task.content_revision !== 1
                || task.accepted_revision !== 1 || task.text_state !== 'accepted'
                || task.visual_placement !== 'feed' || task.visual_mode !== 'auto_assess'
                || task.visual_state !== 'APPROVED' || task.selected_asset_id !== 77
                || task.selected_asset?.status !== 'approved' || task.selected_asset?.content_revision !== 1
                || task.visual_decision_version !== decision?.decision_version
                || task.handoff_state !== 'ready' || task.status !== args.expectedStatus
                || task.publication_mode !== 'approval_required'
                || task.schedule_at?.toISOString() !== args.expectedScheduleAt
                || bodyHash !== TASK_972_BODY_SHA256 || !decision
                || task.publication_fact || task.published_link) {
                throw new Error('[TASK972_VISUAL_GUARD_FAILED]');
            }
            const changed = await tx.contentItem.updateMany({ where: {
                id: 972, project_id: 10, channel_id: 111,
                content_revision: 1, accepted_revision: 1, text_state: 'accepted',
                visual_placement: 'feed', visual_mode: 'auto_assess', visual_state: 'APPROVED',
                visual_decision_version: decision.decision_version, selected_asset_id: 77,
                handoff_state: 'ready', status: args.expectedStatus,
                publication_mode: 'approval_required', schedule_at: new Date(args.expectedScheduleAt)
            }, data: { visual_mode: 'required' } });
            if (changed.count !== 1) throw new Error('[TASK972_VISUAL_CAS_CONFLICT]');
            const result = { task_id: 972, project_id: 10, channel_id: 111,
                content_revision: 1, accepted_revision: 1, body_sha256: bodyHash,
                decision_id: 152, selected_asset_id: 77, visual_state: 'APPROVED',
                visual_mode: 'required', status: task.status, handoff_state: 'ready',
                publication_mode: 'approval_required', published: false };
            await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 972,
                actor_id: args.actorId, command, idempotency_key: args.idempotencyKey,
                before_state: { request_hash: requestHash, visual_mode: 'auto_assess',
                    status: task.status, schedule_at: args.expectedScheduleAt }, after_state: result } });
            return result;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    async requireTask973Visual(args: {
        projectId: number; actorId: string; taskId: number; expectedChannelId: number;
        expectedContentRevision: number; expectedAcceptedRevision: number;
        expectedSelectedAssetId: number; expectedDecisionId: number;
        expectedScheduleAt: string; expectedBodySha256: string;
        expectedStatus: string; idempotencyKey: string;
    }) {
        if (args.projectId !== 10 || args.taskId !== 973 || args.expectedChannelId !== 111
            || args.expectedContentRevision !== 1 || args.expectedAcceptedRevision !== 1
            || args.expectedSelectedAssetId !== 80 || args.expectedDecisionId !== 155
            || args.expectedBodySha256 !== TASK_973_BODY_SHA256) {
            throw new Error('[TASK973_SCOPE_MISMATCH] Exact task/revision/asset/decision/body required');
        }
        const requestHash = sha256(args);
        return this.db.$transaction(async (tx: any) => {
            const project = await tx.project.findUnique({ where: { id: 10 }, select: { slug: true } });
            if (project?.slug !== 'analystcraft-2') throw new Error('[MCP_PROJECT_SCOPE_MISMATCH]');
            await this.requireOwner(tx, 10, args.actorId);
            const command = 'ba_require_task973_publication_visual';
            const prior = await tx.workflowEvent.findFirst({ where: {
                project_id: 10, actor_id: args.actorId, command, idempotency_key: args.idempotencyKey
            } });
            if (prior) {
                if (prior.before_state?.request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
                return prior.after_state;
            }
            const task = await tx.contentItem.findFirst({ where: { id: 973, project_id: 10 },
                include: { selected_asset: true, publication_fact: true } });
            const decision = await tx.artDirectionDecision.findFirst({ where: {
                id: 155, project_id: 10, content_item_id: 973, source_content_revision: 1,
                channel: 'telegram', placement: 'feed', decision: 'GENERATE', status: 'active'
            } });
            const bodyHash = this.hashBody(task?.draft_text || '');
            if (!task || task.channel_id !== 111 || task.content_revision !== 1
                || task.accepted_revision !== 1 || task.text_state !== 'accepted'
                || task.visual_placement !== 'feed' || task.visual_mode !== 'auto_assess'
                || task.visual_state !== 'APPROVED' || task.selected_asset_id !== 80
                || task.selected_asset?.status !== 'approved' || task.selected_asset?.content_revision !== 1
                || task.visual_decision_version !== decision?.decision_version
                || task.handoff_state !== 'ready' || task.status !== args.expectedStatus
                || task.publication_mode !== 'approval_required'
                || task.schedule_at?.toISOString() !== args.expectedScheduleAt
                || bodyHash !== TASK_973_BODY_SHA256 || !decision
                || task.publication_fact || task.published_link) {
                throw new Error('[TASK973_VISUAL_GUARD_FAILED]');
            }
            const changed = await tx.contentItem.updateMany({ where: {
                id: 973, project_id: 10, channel_id: 111,
                content_revision: 1, accepted_revision: 1, text_state: 'accepted',
                visual_placement: 'feed', visual_mode: 'auto_assess', visual_state: 'APPROVED',
                visual_decision_version: decision.decision_version, selected_asset_id: 80,
                handoff_state: 'ready', status: args.expectedStatus,
                publication_mode: 'approval_required', schedule_at: new Date(args.expectedScheduleAt)
            }, data: { visual_mode: 'required' } });
            if (changed.count !== 1) throw new Error('[TASK973_VISUAL_CAS_CONFLICT]');
            const result = { task_id: 973, project_id: 10, channel_id: 111,
                content_revision: 1, accepted_revision: 1, body_sha256: bodyHash,
                decision_id: 155, selected_asset_id: 80, visual_state: 'APPROVED',
                visual_mode: 'required', status: task.status, handoff_state: 'ready',
                publication_mode: 'approval_required', published: false };
            await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 973,
                actor_id: args.actorId, command, idempotency_key: args.idempotencyKey,
                before_state: { request_hash: requestHash, visual_mode: 'auto_assess',
                    status: task.status, schedule_at: args.expectedScheduleAt }, after_state: result } });
            return result;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    async repairTask972Metadata(args: {
        projectId: number; actorId: string; taskId: number; expectedChannelId: number;
        expectedContentRevision: number; expectedAcceptedRevision: number;
        expectedSelectedAssetId: number; expectedDecisionId: number;
        expectedScheduleAt: string; expectedBodySha256: string;
        expectedStatus: string; expectedTitle: string; expectedBrief: string;
        idempotencyKey: string;
    }) {
        if (args.projectId !== 10 || args.taskId !== 972 || args.expectedChannelId !== 111
            || args.expectedContentRevision !== 1 || args.expectedAcceptedRevision !== 1
            || args.expectedSelectedAssetId !== 77 || args.expectedDecisionId !== 152
            || args.expectedBodySha256 !== TASK_972_BODY_SHA256) {
            throw new Error('[TASK972_METADATA_SCOPE_MISMATCH]');
        }
        const requestHash = sha256(args);
        return this.db.$transaction(async (tx: any) => {
            const project = await tx.project.findUnique({ where: { id: 10 }, select: { slug: true } });
            if (project?.slug !== 'analystcraft-2') throw new Error('[MCP_PROJECT_SCOPE_MISMATCH]');
            await this.requireOwner(tx, 10, args.actorId);
            const command = 'ba_repair_task972_publication_metadata';
            const prior = await tx.workflowEvent.findFirst({ where: {
                project_id: 10, actor_id: args.actorId, command, idempotency_key: args.idempotencyKey
            } });
            if (prior) {
                if (prior.before_state?.request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
                return prior.after_state;
            }
            const task = await tx.contentItem.findFirst({ where: { id: 972, project_id: 10 },
                include: { selected_asset: true, publication_fact: true } });
            const decision = await tx.artDirectionDecision.findFirst({ where: {
                id: 152, project_id: 10, content_item_id: 972, source_content_revision: 1,
                channel: 'telegram', placement: 'feed', decision: 'GENERATE', status: 'active'
            } });
            const bodyHash = this.hashBody(task?.draft_text || '');
            if (!task || task.channel_id !== 111 || task.content_revision !== 1
                || task.accepted_revision !== 1 || task.text_state !== 'accepted'
                || task.visual_mode !== 'required' || task.visual_state !== 'APPROVED'
                || task.visual_placement !== 'feed' || task.selected_asset_id !== 77
                || task.selected_asset?.status !== 'approved' || task.selected_asset?.content_revision !== 1
                || task.visual_decision_version !== decision?.decision_version
                || task.handoff_state !== 'ready' || task.status !== args.expectedStatus
                || task.publication_mode !== 'approval_required'
                || task.schedule_at?.toISOString() !== args.expectedScheduleAt
                || task.title !== args.expectedTitle || task.brief !== args.expectedBrief
                || bodyHash !== TASK_972_BODY_SHA256 || !decision
                || task.publication_fact || task.published_link) {
                throw new Error('[TASK972_METADATA_GUARD_FAILED]');
            }
            const changed = await tx.contentItem.updateMany({ where: {
                id: 972, project_id: 10, channel_id: 111,
                content_revision: 1, accepted_revision: 1, text_state: 'accepted',
                visual_mode: 'required', visual_state: 'APPROVED', visual_placement: 'feed',
                visual_decision_version: decision.decision_version, selected_asset_id: 77,
                handoff_state: 'ready', status: args.expectedStatus,
                publication_mode: 'approval_required', schedule_at: new Date(args.expectedScheduleAt),
                title: args.expectedTitle, brief: args.expectedBrief
            }, data: { title: TASK_972_TITLE, brief: TASK_972_BRIEF } });
            if (changed.count !== 1) throw new Error('[TASK972_METADATA_CAS_CONFLICT]');
            const result = { task_id: 972, title: TASK_972_TITLE, brief: TASK_972_BRIEF,
                content_revision: 1, accepted_revision: 1, body_sha256: bodyHash,
                decision_id: 152, selected_asset_id: 77, visual_mode: 'required',
                status: task.status, publication_mode: 'approval_required', published: false };
            await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 972,
                actor_id: args.actorId, command, idempotency_key: args.idempotencyKey,
                before_state: { request_hash: requestHash, title: task.title, brief: task.brief },
                after_state: result } });
            return result;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    async bindTask960LinkedinIdentity(args: {
        projectId: number; actorId: string; taskId: number; expectedChannelId: number;
        expectedContentRevision: number; expectedAcceptedRevision: number;
        expectedDecisionId: number; expectedScheduleAt: string;
        expectedBodySha256: string; expectedStatus: string; idempotencyKey: string;
    }) {
        if (args.projectId !== 10 || args.taskId !== 960 || args.expectedChannelId !== 123
            || args.expectedContentRevision !== 1 || args.expectedAcceptedRevision !== 1
            || args.expectedDecisionId !== 151 || args.expectedBodySha256 !== TASK_960_BODY_SHA256) {
            throw new Error('[TASK960_LINKEDIN_SCOPE_MISMATCH]');
        }
        const requestHash = sha256(args);
        return this.db.$transaction(async (tx: any) => {
            const project = await tx.project.findUnique({ where: { id: 10 }, select: { slug: true } });
            if (project?.slug !== 'analystcraft-2') throw new Error('[MCP_PROJECT_SCOPE_MISMATCH]');
            await this.requireOwner(tx, 10, args.actorId);
            const command = 'ba_bind_task960_linkedin_identity';
            const prior = await tx.workflowEvent.findFirst({ where: {
                project_id: 10, actor_id: args.actorId, command, idempotency_key: args.idempotencyKey
            } });
            if (prior) {
                if (prior.before_state?.request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
                return prior.after_state;
            }
            const task = await tx.contentItem.findFirst({ where: { id: 960, project_id: 10 },
                include: { channel: true, publication_fact: true } });
            const decision = await tx.artDirectionDecision.findFirst({ where: {
                id: 151, project_id: 10, content_item_id: 960, source_content_revision: 1,
                channel: 'linkedin', placement: 'feed', decision: 'NO_VISUAL_NEEDED', status: 'active'
            } });
            const bodyHash = this.hashBody(task?.draft_text || '');
            const quality = (task?.quality_report as any) || {};
            const bundle = quality.handoff_bundle;
            if (!task || task.channel_id !== 123 || task.channel?.type !== 'linkedin'
                || task.content_revision !== 1 || task.accepted_revision !== 1
                || task.text_state !== 'accepted' || task.visual_placement !== 'feed'
                || task.visual_state !== 'NO_VISUAL_NEEDED' || task.selected_asset_id !== null
                || task.visual_decision_version !== decision?.decision_version
                || task.handoff_state !== 'ready' || task.status !== args.expectedStatus
                || task.publication_mode !== 'approval_required'
                || task.schedule_at?.toISOString() !== args.expectedScheduleAt
                || bodyHash !== TASK_960_BODY_SHA256 || !decision
                || task.publication_fact || task.published_link
                || bundle?.task?.account_ref !== 'analystcraft_linkedin') {
                throw new Error('[TASK960_LINKEDIN_IDENTITY_GUARD_FAILED]');
            }
            const targetIdentity = { account_ref: 'innokenty_linkedin', profile_url: 'https://www.linkedin.com/in/innokentyb/',
                display_name: 'Innokenty Bodrov', identity_kind: 'personal_founder_profile', channel_id: 123 };
            const nextQuality = { ...quality, handoff_bundle: { ...bundle,
                task: { ...bundle.task, account_ref: 'innokenty_linkedin', target_identity: targetIdentity },
                target_identity: targetIdentity,
                checklist: [
                    'Post from personal profile: Innokenty Bodrov — https://www.linkedin.com/in/innokentyb/',
                    ...((bundle.checklist || []).slice(1))
                ]
            }, identity_binding: { ...targetIdentity, registry_profile_id: 'profile_123',
                registry_account_ref_status: 'UNKNOWN', binding_scope: 'task_960_only' } };
            const changed = await tx.contentItem.updateMany({ where: {
                id: 960, project_id: 10, channel_id: 123, content_revision: 1, accepted_revision: 1,
                text_state: 'accepted', visual_state: 'NO_VISUAL_NEEDED', selected_asset_id: null,
                visual_decision_version: decision.decision_version, handoff_state: 'ready',
                status: args.expectedStatus, publication_mode: 'approval_required',
                schedule_at: new Date(args.expectedScheduleAt), quality_report: task.quality_report
            }, data: { quality_report: nextQuality } });
            if (changed.count !== 1) throw new Error('[TASK960_LINKEDIN_IDENTITY_CAS_CONFLICT]');
            const result = { task_id: 960, channel_id: 123, content_revision: 1,
                accepted_revision: 1, body_sha256: bodyHash, decision_id: 151,
                account_ref: 'innokenty_linkedin', profile_url: targetIdentity.profile_url,
                display_name: targetIdentity.display_name, binding_scope: 'task_960_only',
                registry_drift: 'profile_123 accountRef UNKNOWN', publication_mode: 'approval_required', published: false };
            await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 960,
                actor_id: args.actorId, command, idempotency_key: args.idempotencyKey,
                before_state: { request_hash: requestHash, account_ref: 'analystcraft_linkedin' },
                after_state: result } });
            return result;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    async createTask970T72Checkpoint(args: {
        projectId: number; actorId: string; taskId: number; expectedChannelId: number;
        expectedFactId: number; scheduledFor: string; idempotencyKey: string;
    }) {
        if (args.projectId !== 10 || args.taskId !== 970 || args.expectedChannelId !== 164
            || args.expectedFactId !== 345 || args.scheduledFor !== '2026-09-26T12:55:34.000Z') {
            throw new Error('[TASK970_T72_SCOPE_MISMATCH]');
        }
        return this.db.$transaction(async (tx: any) => {
            const project = await tx.project.findUnique({ where: { id: 10 }, select: { slug: true } });
            if (project?.slug !== 'analystcraft-2') throw new Error('[MCP_PROJECT_SCOPE_MISMATCH]');
            await this.requireOwner(tx, 10, args.actorId);
            const task = await tx.contentItem.findFirst({ where: { id: 970, project_id: 10 },
                include: { publication_fact: true } });
            if (!task || task.channel_id !== 164 || task.status !== 'published'
                || task.publication_fact?.id !== 345 || task.publication_fact.outcome !== 'published'
                || task.publication_fact.published_at?.toISOString() !== '2026-09-23T12:55:34.000Z'
                || task.publication_fact.public_url !== task.published_link) {
                throw new Error('[TASK970_T72_FACT_GUARD_FAILED]');
            }
            const existing = await tx.metricSnapshot.findUnique({ where: {
                project_id_content_item_id_channel_id_checkpoint: {
                    project_id: 10, content_item_id: 970, channel_id: 164, checkpoint: 't72h'
                }
            } });
            if (existing) {
                if (existing.scheduled_for?.toISOString() !== args.scheduledFor
                    || existing.collection_mode !== 'manual' || existing.source !== 'manual') {
                    throw new Error('[TASK970_T72_EXISTING_CONFLICT]');
                }
                return { checkpoint_id: existing.id, task_id: 970, channel_id: 164,
                    fact_id: 345, checkpoint: 't72h', scheduled_for: args.scheduledFor,
                    collection_mode: 'manual', replayed: true };
            }
            const checkpoint = await tx.metricSnapshot.create({ data: {
                project_id: 10, content_item_id: 970, channel_id: 164,
                checkpoint: 't72h', scheduled_for: new Date(args.scheduledFor),
                collection_status: 'pending', collection_mode: 'manual', source: 'manual',
                idempotency_key: args.idempotencyKey, metrics: { schema_version: 1, values: {} }
            } });
            const itemKey = 'metric:970:t72h';
            const existingWork = await tx.workItem.findFirst({ where: { project_id: 10, item_key: itemKey } });
            if (!existingWork) await tx.workItem.create({ data: {
                project_id: 10, week_package_id: task.week_package_id, content_item_id: 970,
                item_key: itemKey, kind: 'metric_capture', state: 'available',
                assignee_role: 'metrics_operator', due_at: new Date(args.scheduledFor),
                result_payload: { checkpoint: 't72h', channel_id: 164, collection_mode: 'manual', fact_id: 345 }
            } });
            const result = { checkpoint_id: checkpoint.id, task_id: 970, channel_id: 164,
                fact_id: 345, checkpoint: 't72h', scheduled_for: args.scheduledFor,
                collection_mode: 'manual', collection_status: 'pending', replayed: false };
            await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 970,
                actor_id: args.actorId, command: 'ba_create_task970_t72_checkpoint',
                idempotency_key: args.idempotencyKey,
                before_state: { fact_id: 345, preserve_checkpoints: ['t24h', 't7d'] },
                after_state: result } });
            return result;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    async requireC20Visuals(args: {
        projectId: number; actorId: string; expected: VisualExpectation[]; idempotencyKey: string;
    }) {
        if (args.projectId !== 10) throw new Error('[C20_PROJECT_MISMATCH] Repair is restricted to project 10');
        assertExactC20VisualSet(args.expected);
        const requestHash = sha256(args.expected.slice().sort((a, b) => a.taskId - b.taskId));
        return this.db.$transaction(async (tx: any) => {
            await this.requireOwner(tx, args.projectId, args.actorId);
            const command = 'ba_require_c20_publication_visuals';
            const prior = await tx.workflowEvent.findFirst({ where: {
                project_id: args.projectId, actor_id: args.actorId,
                command, idempotency_key: args.idempotencyKey
            } });
            if (prior) {
                if (prior.before_state?.request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT] Repair key has another payload');
                return prior.after_state;
            }
            const tasks = await tx.contentItem.findMany({
                where: { project_id: args.projectId, id: { in: C20_TASK_IDS } },
                include: { publication_fact: true }
            });
            if (tasks.length !== C20_TASK_IDS.length) throw new Error('[C20_TASK_SET_MISMATCH] A task is missing');
            for (const expected of args.expected) {
                const task = tasks.find((item: any) => item.id === expected.taskId);
                if (!task || task.channel_id !== 111 || task.publication_mode !== 'approval_required'
                    || task.visual_mode !== 'auto_assess' || task.selected_asset_id !== null
                    || task.handoff_state !== 'blocked' || task.publication_fact
                    || task.published_link || ['published', 'removed', 'cancelled'].includes(task.status)
                    || task.content_revision !== expected.expectedContentRevision
                    || task.accepted_revision !== expected.expectedAcceptedRevision
                    || task.status !== expected.expectedStatus
                    || task.visual_state !== expected.expectedVisualState
                    || task.schedule_at?.toISOString() !== expected.expectedScheduleAt
                    || task.visual_state === 'NO_VISUAL_NEEDED') {
                    throw new Error(`[C20_VISUAL_GUARD_FAILED] Task ${expected.taskId} changed or has release evidence`);
                }
                if (task.content_revision > 0) {
                    const noVisual = await tx.artDirectionDecision.findFirst({ where: {
                        project_id: args.projectId, content_item_id: task.id,
                        source_content_revision: task.content_revision,
                        decision: 'NO_VISUAL_NEEDED', status: 'active'
                    } });
                    if (noVisual) throw new Error(`[C20_NO_VISUAL_DECISION] Task ${task.id} requires audited art recovery`);
                }
            }
            for (const expected of args.expected) {
                const changed = await tx.contentItem.updateMany({
                    where: {
                        id: expected.taskId, project_id: args.projectId, channel_id: 111,
                        publication_mode: 'approval_required', visual_mode: 'auto_assess',
                        visual_state: expected.expectedVisualState,
                        status: expected.expectedStatus,
                        content_revision: expected.expectedContentRevision,
                        accepted_revision: expected.expectedAcceptedRevision,
                        selected_asset_id: null, handoff_state: 'blocked',
                        schedule_at: new Date(expected.expectedScheduleAt)
                    },
                    data: { visual_mode: 'required' }
                });
                if (changed.count !== 1) throw new Error(`[C20_VISUAL_CAS_CONFLICT] Task ${expected.taskId} changed during repair`);
                await tx.workflowEvent.create({ data: {
                    project_id: args.projectId, content_item_id: expected.taskId,
                    actor_id: args.actorId, command: `${command}:task`,
                    idempotency_key: `${args.idempotencyKey}:task:${expected.taskId}`,
                    before_state: { visual_mode: 'auto_assess', ...expected },
                    after_state: { visual_mode: 'required', content_revision: expected.expectedContentRevision,
                        status: expected.expectedStatus, visual_state: expected.expectedVisualState }
                } });
            }
            const result = { task_ids: C20_TASK_IDS, visual_mode: 'required', changed_count: C20_TASK_IDS.length,
                publication_mode: 'approval_required', published_count: 0 };
            await tx.workflowEvent.create({ data: {
                project_id: args.projectId, actor_id: args.actorId, command,
                idempotency_key: args.idempotencyKey,
                before_state: { request_hash: requestHash }, after_state: result
            } });
            return result;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    async releaseTelegramTask(args: TelegramRelease) {
        if (args.projectId !== 10) throw new Error('[OWNER_RELEASE_PROJECT_MISMATCH] Project 10 required');
        if (!args.approvalReference.trim()) throw new Error('[OWNER_APPROVAL_REFERENCE_REQUIRED] Exact owner approval is required');
        const requestHash = sha256(args);
        return this.db.$transaction(async (tx: any) => {
            await this.requireOwner(tx, args.projectId, args.actorId);
            const command = 'ba_release_approved_telegram_task';
            const prior = await tx.workflowEvent.findFirst({ where: {
                project_id: args.projectId, actor_id: args.actorId,
                command, idempotency_key: args.idempotencyKey
            } });
            if (prior) {
                if (prior.before_state?.request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT] Release key has another payload');
                return prior.after_state;
            }
            const task = await tx.contentItem.findFirst({
                where: { id: args.taskId, project_id: args.projectId },
                include: { channel: true, selected_asset: true, publication_fact: true }
            });
            if (!task || task.channel_id !== args.expectedChannelId
                || task.channel?.type !== 'telegram'
                || task.visual_placement !== 'feed'
                || task.status !== 'ready_for_execution'
                || task.publication_mode !== 'approval_required'
                || task.content_revision !== args.expectedContentRevision
                || task.accepted_revision !== args.expectedAcceptedRevision
                || task.content_revision !== task.accepted_revision
                || task.text_state !== 'accepted'
                || task.visual_mode !== args.expectedVisualMode
                || task.visual_state !== args.expectedVisualState
                || task.selected_asset_id !== args.expectedSelectedAssetId
                || task.schedule_at?.toISOString() !== args.expectedScheduleAt
                || task.handoff_state !== 'ready'
                || task.publication_fact || task.published_link || !task.draft_text?.trim()) {
                throw new Error('[OWNER_RELEASE_TASK_MISMATCH] Exact accepted ready Telegram task is required');
            }
            if (task.visual_mode === 'required' && task.visual_state === 'NO_VISUAL_NEEDED') {
                throw new Error('[VISUAL_REQUIRED] Required visual cannot be waived');
            }
            const visual = calculateVisualReadiness({
                enabled: true, textState: task.text_state,
                acceptedRevision: task.accepted_revision, contentRevision: task.content_revision,
                visualMode: task.visual_mode, visualState: task.visual_state,
                selectedAssetRevision: task.selected_asset?.content_revision,
                selectedAssetUrl: task.selected_asset?.file_url
            });
            if (!visual.ready || (task.visual_state === 'APPROVED' && task.selected_asset?.status !== 'approved')) {
                throw new Error(`[VISUAL_NOT_READY] ${visual.reason || 'Selected asset is not approved'}`);
            }
            const bodyHash = createHash('sha256').update(task.draft_text).digest('hex');
            if (bodyHash !== args.expectedBodySha256) throw new Error('[OWNER_APPROVED_BODY_MISMATCH] Draft differs from approved preview');
            const config = resolveEffectiveChannelConfig('telegram', task.channel.config || {});
            if (config.capability_flags?.api_publish !== true || !config.telegram_channel_id) {
                throw new Error('[TELEGRAM_CONNECTOR_NOT_READY] Channel lacks an authorized direct route');
            }
            const attempt = await tx.deliveryAttempt.findFirst({ where: {
                project_id: args.projectId, content_item_id: task.id
            } });
            if (attempt) throw new Error('[DELIVERY_ATTEMPT_EXISTS] Existing attempt requires manual reconciliation');
            const changed = await tx.contentItem.updateMany({
                where: {
                    id: task.id, project_id: args.projectId, channel_id: args.expectedChannelId,
                    status: 'ready_for_execution', publication_mode: 'approval_required',
                    content_revision: args.expectedContentRevision,
                    accepted_revision: args.expectedAcceptedRevision,
                    visual_mode: args.expectedVisualMode,
                    visual_state: args.expectedVisualState,
                    selected_asset_id: args.expectedSelectedAssetId,
                    schedule_at: new Date(args.expectedScheduleAt)
                },
                data: { publication_mode: 'owner_released' }
            });
            if (changed.count !== 1) throw new Error('[OWNER_RELEASE_CAS_CONFLICT] Task changed during release');
            const result = { task_id: task.id, channel_id: task.channel_id,
                content_revision: task.content_revision, accepted_revision: task.accepted_revision,
                schedule_at: args.expectedScheduleAt, body_sha256: bodyHash,
                publication_mode: 'owner_released', explicit_send_required: true,
                published: false };
            await tx.workflowEvent.create({ data: {
                project_id: args.projectId, content_item_id: task.id,
                actor_id: args.actorId, command, idempotency_key: args.idempotencyKey,
                before_state: { request_hash: requestHash, publication_mode: 'approval_required',
                    approval_reference: args.approvalReference }, after_state: result
            } });
            return result;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    async releaseDzenTask958(args: {
        projectId: number; actorId: string; taskId: number; expectedChannelId: number;
        expectedContentRevision: number; expectedAcceptedRevision: number;
        expectedScheduleAt: string; expectedBodySha256: string;
        approvalReference: string; idempotencyKey: string;
    }) {
        if (args.projectId !== 10 || args.taskId !== 958 || args.expectedChannelId !== 116
            || args.expectedContentRevision !== 1 || args.expectedAcceptedRevision !== 1
            || args.expectedBodySha256 !== DZEN_958_BODY_SHA256) {
            throw new Error('[DZEN_958_SCOPE_MISMATCH] Exact task/revision/body required');
        }
        if (!args.approvalReference.trim()) throw new Error('[OWNER_APPROVAL_REFERENCE_REQUIRED]');
        const requestHash = sha256(args);
        return this.db.$transaction(async (tx: any) => {
            const project = await tx.project.findUnique({ where: { id: 10 }, select: { slug: true } });
            if (project?.slug !== 'analystcraft-2') throw new Error('[MCP_PROJECT_SCOPE_MISMATCH]');
            await this.requireOwner(tx, 10, args.actorId);
            const command = 'ba_release_approved_dzen_task958';
            const prior = await tx.workflowEvent.findFirst({ where: {
                project_id: 10, actor_id: args.actorId, command, idempotency_key: args.idempotencyKey
            } });
            if (prior) {
                if (prior.before_state?.request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
                return prior.after_state;
            }
            const task = await tx.contentItem.findFirst({
                where: { id: 958, project_id: 10 },
                include: { channel: true, publication_fact: true }
            });
            const decision = await tx.artDirectionDecision.findFirst({ where: {
                id: 147, project_id: 10, content_item_id: 958,
                source_content_revision: 1, channel: 'analystcraft_dzen', placement: 'feed',
                decision: 'NO_VISUAL_NEEDED', status: 'active'
            } });
            const bodyHash = this.hashBody(task?.draft_text || '');
            if (!task || task.channel_id !== 116 || task.channel?.type !== 'dzen'
                || task.content_revision !== 1 || task.accepted_revision !== 1
                || task.text_state !== 'accepted' || task.visual_placement !== 'feed'
                || task.visual_state !== 'NO_VISUAL_NEEDED' || task.selected_asset_id !== null
                || task.visual_decision_version !== decision?.decision_version
                || task.status !== 'ready_for_execution' || task.handoff_state !== 'ready'
                || task.publication_mode !== 'approval_required'
                || task.schedule_at?.toISOString() !== args.expectedScheduleAt
                || bodyHash !== DZEN_958_BODY_SHA256
                || !decision || task.publication_fact || task.published_link) {
                throw new Error('[DZEN_958_RELEASE_GUARD_FAILED]');
            }
            const attempt = await tx.deliveryAttempt.findFirst({ where: {
                project_id: 10, content_item_id: 958
            } });
            if (attempt) throw new Error('[DELIVERY_ATTEMPT_EXISTS]');
            const changed = await tx.contentItem.updateMany({
                where: {
                    id: 958, project_id: 10, channel_id: 116,
                    content_revision: 1, accepted_revision: 1, text_state: 'accepted',
                    visual_placement: 'feed', visual_state: 'NO_VISUAL_NEEDED',
                    visual_decision_version: decision.decision_version,
                    selected_asset_id: null, status: 'ready_for_execution',
                    handoff_state: 'ready', publication_mode: 'approval_required',
                    schedule_at: new Date(args.expectedScheduleAt)
                }, data: { publication_mode: 'owner_released' }
            });
            if (changed.count !== 1) throw new Error('[DZEN_958_RELEASE_CAS_CONFLICT]');
            const result = { task_id: 958, channel_id: 116, content_revision: 1,
                accepted_revision: 1, body_sha256: bodyHash,
                visual_decision_id: 147, schedule_at: args.expectedScheduleAt,
                publication_mode: 'owner_released', explicit_send_required: true, published: false };
            await tx.workflowEvent.create({ data: {
                project_id: 10, content_item_id: 958, actor_id: args.actorId,
                command, idempotency_key: args.idempotencyKey,
                before_state: { request_hash: requestHash, publication_mode: 'approval_required',
                    approval_reference: args.approvalReference }, after_state: result
            } });
            return result;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    async releaseThreadsTask953(args: {
        projectId: number; actorId: string; taskId: number; expectedChannelId: number;
        expectedContentRevision: number; expectedAcceptedRevision: number;
        expectedScheduleAt: string; expectedBodySha256: string;
        approvalReference: string; idempotencyKey: string;
    }) {
        if (args.projectId !== 10 || args.taskId !== 953 || args.expectedChannelId !== 138
            || args.expectedContentRevision !== 4 || args.expectedAcceptedRevision !== 4
            || args.expectedBodySha256 !== THREADS_953_BODY_SHA256) {
            throw new Error('[THREADS_953_SCOPE_MISMATCH] Exact task/revision/body required');
        }
        if (!args.approvalReference.trim()) throw new Error('[OWNER_APPROVAL_REFERENCE_REQUIRED]');
        const requestHash = sha256(args);
        return this.db.$transaction(async (tx: any) => {
            const project = await tx.project.findUnique({ where: { id: 10 }, select: { slug: true } });
            if (project?.slug !== 'analystcraft-2') throw new Error('[MCP_PROJECT_SCOPE_MISMATCH]');
            await this.requireOwner(tx, 10, args.actorId);
            const command = 'ba_release_approved_threads_task953';
            const prior = await tx.workflowEvent.findFirst({ where: {
                project_id: 10, actor_id: args.actorId, command, idempotency_key: args.idempotencyKey
            } });
            if (prior) {
                if (prior.before_state?.request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
                return prior.after_state;
            }
            const task = await tx.contentItem.findFirst({ where: { id: 953, project_id: 10 },
                include: { channel: true, publication_fact: true } });
            const decision = await tx.artDirectionDecision.findFirst({ where: {
                id: 149, project_id: 10, content_item_id: 953, source_content_revision: 4,
                channel: 'innokenty_threads', placement: 'feed', decision: 'NO_VISUAL_NEEDED', status: 'active'
            } });
            const bodyHash = this.hashBody(task?.draft_text || '');
            if (!task || task.channel_id !== 138 || task.channel?.type !== 'threads'
                || task.content_revision !== 4 || task.accepted_revision !== 4
                || task.text_state !== 'accepted' || task.visual_placement !== 'feed'
                || task.visual_state !== 'NO_VISUAL_NEEDED' || task.selected_asset_id !== null
                || task.visual_decision_version !== decision?.decision_version
                || task.status !== 'ready_for_execution' || task.handoff_state !== 'ready'
                || task.publication_mode !== 'approval_required'
                || task.schedule_at?.toISOString() !== args.expectedScheduleAt
                || bodyHash !== THREADS_953_BODY_SHA256 || (task.draft_text?.length || 0) > 500
                || !decision || task.publication_fact || task.published_link) {
                throw new Error('[THREADS_953_RELEASE_GUARD_FAILED]');
            }
            const changed = await tx.contentItem.updateMany({ where: {
                id: 953, project_id: 10, channel_id: 138, content_revision: 4, accepted_revision: 4,
                text_state: 'accepted', visual_placement: 'feed', visual_state: 'NO_VISUAL_NEEDED',
                visual_decision_version: decision.decision_version, selected_asset_id: null,
                status: 'ready_for_execution', handoff_state: 'ready',
                publication_mode: 'approval_required', schedule_at: new Date(args.expectedScheduleAt)
            }, data: { publication_mode: 'owner_released' } });
            if (changed.count !== 1) throw new Error('[THREADS_953_RELEASE_CAS_CONFLICT]');
            const result = { task_id: 953, channel_id: 138, content_revision: 4,
                accepted_revision: 4, body_sha256: bodyHash, visual_decision_id: 149,
                schedule_at: args.expectedScheduleAt, publication_mode: 'owner_released',
                explicit_send_required: true, published: false };
            await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 953,
                actor_id: args.actorId, command, idempotency_key: args.idempotencyKey,
                before_state: { request_hash: requestHash, publication_mode: 'approval_required',
                    approval_reference: args.approvalReference }, after_state: result } });
            return result;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    async releaseThreadsTask959(args: {
        projectId: number; actorId: string; taskId: number; expectedChannelId: number;
        expectedContentRevision: number; expectedAcceptedRevision: number;
        expectedScheduleAt: string; expectedBodySha256: string;
        approvalReference: string; idempotencyKey: string;
    }) {
        if (args.projectId !== 10 || args.taskId !== 959 || args.expectedChannelId !== 138
            || args.expectedContentRevision !== 2 || args.expectedAcceptedRevision !== 2
            || args.expectedBodySha256 !== THREADS_959_BODY_SHA256) {
            throw new Error('[THREADS_959_SCOPE_MISMATCH] Exact task/revision/body required');
        }
        if (!args.approvalReference.trim()) throw new Error('[OWNER_APPROVAL_REFERENCE_REQUIRED]');
        const requestHash = sha256(args);
        return this.db.$transaction(async (tx: any) => {
            const project = await tx.project.findUnique({ where: { id: 10 }, select: { slug: true } });
            if (project?.slug !== 'analystcraft-2') throw new Error('[MCP_PROJECT_SCOPE_MISMATCH]');
            await this.requireOwner(tx, 10, args.actorId);
            const command = 'ba_release_approved_threads_task959';
            const prior = await tx.workflowEvent.findFirst({ where: {
                project_id: 10, actor_id: args.actorId, command, idempotency_key: args.idempotencyKey
            } });
            if (prior) {
                if (prior.before_state?.request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
                return prior.after_state;
            }
            const task = await tx.contentItem.findFirst({ where: { id: 959, project_id: 10 },
                include: { channel: true, publication_fact: true } });
            const decision = await tx.artDirectionDecision.findFirst({ where: {
                id: 150, project_id: 10, content_item_id: 959, source_content_revision: 2,
                channel: 'innokenty_threads', placement: 'feed', decision: 'NO_VISUAL_NEEDED', status: 'active'
            } });
            const bodyHash = this.hashBody(task?.draft_text || '');
            if (!task || task.channel_id !== 138 || task.channel?.type !== 'threads'
                || task.content_revision !== 2 || task.accepted_revision !== 2
                || task.text_state !== 'accepted' || task.visual_placement !== 'feed'
                || task.visual_state !== 'NO_VISUAL_NEEDED' || task.selected_asset_id !== null
                || task.visual_decision_version !== decision?.decision_version
                || task.status !== 'ready_for_execution' || task.handoff_state !== 'ready'
                || task.publication_mode !== 'approval_required'
                || task.schedule_at?.toISOString() !== args.expectedScheduleAt
                || bodyHash !== THREADS_959_BODY_SHA256 || (task.draft_text?.length || 0) > 500
                || !decision || task.publication_fact || task.published_link) {
                throw new Error('[THREADS_959_RELEASE_GUARD_FAILED]');
            }
            const changed = await tx.contentItem.updateMany({ where: {
                id: 959, project_id: 10, channel_id: 138, content_revision: 2, accepted_revision: 2,
                text_state: 'accepted', visual_placement: 'feed', visual_state: 'NO_VISUAL_NEEDED',
                visual_decision_version: decision.decision_version, selected_asset_id: null,
                status: 'ready_for_execution', handoff_state: 'ready',
                publication_mode: 'approval_required', schedule_at: new Date(args.expectedScheduleAt)
            }, data: { publication_mode: 'owner_released' } });
            if (changed.count !== 1) throw new Error('[THREADS_959_RELEASE_CAS_CONFLICT]');
            const result = { task_id: 959, channel_id: 138, content_revision: 2,
                accepted_revision: 2, body_sha256: bodyHash, visual_decision_id: 150,
                schedule_at: args.expectedScheduleAt, publication_mode: 'owner_released',
                explicit_send_required: true, published: false };
            await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 959,
                actor_id: args.actorId, command, idempotency_key: args.idempotencyKey,
                before_state: { request_hash: requestHash, publication_mode: 'approval_required',
                    approval_reference: args.approvalReference }, after_state: result } });
            return result;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
}

export default new OwnerPublicationControlsService();

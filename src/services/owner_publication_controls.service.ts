import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { calculateVisualReadiness } from './art_direction.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';

const C20_TASK_IDS = [968, 969, 971, 972, 973, 974];

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
    constructor(private readonly db: any = prisma) {}

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
}

export default new OwnerPublicationControlsService();

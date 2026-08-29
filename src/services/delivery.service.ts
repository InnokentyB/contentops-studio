import prisma from '../db';
import publisherService from './publisher.service';
import { requireProjectActorAccess } from './project_access.service';

export interface ExecuteDeliveryArgs {
    projectId: number; actorId: string; contentItemId: number; channelId: number;
    forceAutomatic?: boolean; unapproved?: boolean; simulateFailure?: boolean;
    idempotencyKey?: string; scheduledAt?: string;
}
export interface RecoverDeliveryArgs { projectId: number; actorId: string; deliveryAttemptId: number; }
interface DeliveryServiceDependencies {
    prisma?: any;
    publishTask?: (taskId: number) => Promise<any>;
    requireAccess?: (projectId: number, actorId: string) => Promise<void>;
    requireOwner?: (projectId: number, actorId: string) => Promise<void>;
    now?: () => Date;
}
const iso = (value: Date | null | undefined) => value ? value.toISOString() : null;

export class DeliveryService {
    private readonly db: any;
    private readonly publishTask: (taskId: number) => Promise<any>;
    private readonly requireAccess: (projectId: number, actorId: string) => Promise<void>;
    private readonly requireOwner: (projectId: number, actorId: string) => Promise<void>;
    private readonly now: () => Date;

    constructor(deps: DeliveryServiceDependencies = {}) {
        this.db = deps.prisma || prisma;
        this.publishTask = deps.publishTask || ((taskId) => publisherService.processPublicationTaskNow(taskId));
        this.requireAccess = deps.requireAccess || requireProjectActorAccess;
        this.requireOwner = deps.requireOwner || (async (projectId, actorId) => {
            await requireProjectActorAccess(projectId, actorId);
            const match = /^user:(\d+)$/.exec(actorId);
            if (!match) throw new Error('[Security] Access denied: Project owner is required');
            const membership = await this.db.projectMember.findUnique({
                where: { project_id_user_id: { project_id: projectId, user_id: Number(match[1]) } },
                select: { role: true }
            });
            if (membership?.role !== 'owner') throw new Error('[Security] Access denied: Project owner is required');
        });
        this.now = deps.now || (() => new Date());
    }

    private response(attempt: any, extra: Record<string, unknown> = {}) {
        return {
            attempt_id: attempt.id, mode: attempt.mode, status: attempt.status,
            requires_manual_confirmation: attempt.requires_manual_confirmation,
            scheduled_at: iso(attempt.scheduled_at), actual_published_at: iso(attempt.actual_published_at),
            error_message: attempt.error_message || null, ...extra
        };
    }

    async executeDelivery(args: ExecuteDeliveryArgs) {
        const { projectId, actorId, contentItemId, channelId, forceAutomatic, unapproved, simulateFailure, idempotencyKey, scheduledAt } = args;
        await this.requireAccess(projectId, actorId);
        const task = await this.db.contentItem.findFirst({
            where: { id: contentItemId, project_id: projectId }, include: { publication_fact: true }
        });
        if (!task) throw new Error(`[PUBLICATION_TASK_NOT_FOUND] Task ${contentItemId} does not belong to project ${projectId}`);
        if (task.channel_id !== channelId) throw new Error('[CHANNEL_MISMATCH] Delivery channel does not match the publication task');
        if (unapproved || !task.content_revision || task.accepted_revision !== task.content_revision || task.text_state !== 'accepted') {
            throw new Error('[APPROVAL_REQUIRED] Automatic posting requires the current content revision to be accepted');
        }

        const now = this.now();
        const scheduledDate = scheduledAt ? new Date(scheduledAt) : (task.publish_at || task.schedule_at || now);
        if (Number.isNaN(scheduledDate.getTime())) throw new Error('[INVALID_SCHEDULE] scheduledAt must be a valid timestamp');
        if (scheduledDate.getTime() > now.getTime()) throw new Error('[DELIVERY_NOT_DUE] The publication is scheduled for the future');

        if (idempotencyKey) {
            const existing = await this.db.deliveryAttempt.findFirst({ where: { project_id: projectId, idempotency_key: idempotencyKey } });
            if (existing) {
                const canonicalIdentity = task.publication_fact?.outcome === 'published'
                    && Boolean(task.publication_fact.public_url || task.publication_fact.provider_object_id);
                if (existing.status === 'delivered' && !canonicalIdentity) {
                    const invalidated = await this.db.deliveryAttempt.update({
                        where: { id: existing.id },
                        data: { status: 'invalidated', actual_published_at: null, requires_manual_confirmation: true,
                            error_message: '[FALSE_DELIVERY_WITHOUT_PROVIDER_IDENTITY] Legacy delivery had no canonical provider evidence' }
                    });
                    return this.response(invalidated);
                }
                return this.response(existing, { published_link: task.publication_fact?.public_url || task.published_link || null });
            }
        }

        const mode = forceAutomatic ? 'automatic' : 'assisted';
        const attempt = await this.db.deliveryAttempt.create({
            data: { project_id: projectId, content_item_id: contentItemId, channel_id: channelId, mode, status: 'pending',
                idempotency_key: idempotencyKey || null, scheduled_at: scheduledDate, actual_published_at: null,
                requires_manual_confirmation: mode === 'assisted' }
        });
        if (simulateFailure) {
            const failed = await this.db.deliveryAttempt.update({ where: { id: attempt.id }, data: {
                status: 'failed', requires_manual_confirmation: true, error_message: 'Simulated provider failure'
            } });
            return this.response(failed);
        }

        try {
            const result = await this.publishTask(contentItemId);
            const verifiedTask = await this.db.contentItem.findUnique({
                where: { id: contentItemId }, include: { publication_fact: true }
            });
            const fact = verifiedTask?.publication_fact;
            const publishedLink = fact?.public_url || result?.publishedLink || verifiedTask?.published_link || null;
            const providerIdentity = fact?.public_url || fact?.provider_object_id;
            if (!result?.success || result?.status !== 'published' || fact?.outcome !== 'published' || !providerIdentity) {
                const verificationRequired = await this.db.deliveryAttempt.update({ where: { id: attempt.id }, data: {
                    status: 'verification_required', actual_published_at: null, requires_manual_confirmation: true,
                    error_message: '[PUBLICATION_IDENTITY_MISSING] Provider publication was not confirmed by a canonical fact'
                } });
                const error: any = new Error(verificationRequired.error_message);
                error.deliveryAttempt = this.response(verificationRequired);
                throw error;
            }
            const delivered = await this.db.deliveryAttempt.update({ where: { id: attempt.id }, data: {
                status: 'delivered', actual_published_at: fact.published_at || this.now(),
                requires_manual_confirmation: false, error_message: null
            } });
            return this.response(delivered, { published_link: publishedLink });
        } catch (error: any) {
            if (error?.deliveryAttempt) throw error;
            const failed = await this.db.deliveryAttempt.update({ where: { id: attempt.id }, data: {
                status: 'failed', actual_published_at: null, requires_manual_confirmation: true,
                error_message: String(error?.message || error).slice(0, 2000)
            } });
            const wrapped: any = new Error(error?.message || 'Delivery failed');
            wrapped.deliveryAttempt = this.response(failed);
            throw wrapped;
        }
    }

    async invalidateFalseDeliveries(args: { projectId: number; actorId: string; contentItemId: number; attemptIds: number[]; reason: string; idempotencyKey: string; }) {
        await this.requireOwner(args.projectId, args.actorId);
        const existingAudit = await this.db.event.findFirst?.({
            where: { entity_type: 'content_item', entity_id: args.contentItemId, event_type: 'delivery.false_success_invalidated',
                payload: { path: ['idempotency_key'], equals: args.idempotencyKey } }
        });
        if (existingAudit?.payload?.result) return existingAudit.payload.result;
        const task = await this.db.contentItem.findFirst({
            where: { id: args.contentItemId, project_id: args.projectId }, include: { publication_fact: true }
        });
        if (!task) throw new Error('[PUBLICATION_TASK_NOT_FOUND]');
        if (task.publication_fact?.outcome === 'published' && (task.publication_fact.public_url || task.publication_fact.provider_object_id)) {
            throw new Error('[CANONICAL_PUBLICATION_EXISTS] Confirmed publications cannot have delivery evidence invalidated');
        }
        const attempts = await this.db.deliveryAttempt.findMany({ where: {
            id: { in: args.attemptIds }, project_id: args.projectId, content_item_id: args.contentItemId, status: 'delivered'
        } });
        if (attempts.length !== new Set(args.attemptIds).size) throw new Error('[DELIVERY_ATTEMPT_MISMATCH]');
        const updated = await this.db.deliveryAttempt.updateMany({
            where: { id: { in: args.attemptIds }, project_id: args.projectId, content_item_id: args.contentItemId, status: 'delivered' },
            data: { status: 'invalidated', actual_published_at: null, requires_manual_confirmation: true,
                error_message: `[FALSE_DELIVERY_INVALIDATED] ${args.reason}`.slice(0, 2000) }
        });
        const result = { project_id: args.projectId, content_item_id: args.contentItemId,
            attempt_ids: [...args.attemptIds].sort((a, b) => a - b), invalidated_count: updated.count, status: 'invalidated' };
        await this.db.event.create({ data: { entity_type: 'content_item', entity_id: args.contentItemId,
            event_type: 'delivery.false_success_invalidated', payload: { project_id: args.projectId, actor_id: args.actorId,
                reason: args.reason, idempotency_key: args.idempotencyKey, result } } });
        return result;
    }

    async recoverDelivery(args: RecoverDeliveryArgs): Promise<Record<string, unknown>> {
        await this.requireAccess(args.projectId, args.actorId);
        const attempt = await this.db.deliveryAttempt.findFirst({ where: { id: args.deliveryAttemptId, project_id: args.projectId } });
        if (!attempt) throw new Error(`DeliveryAttempt ${args.deliveryAttemptId} not found`);
        throw new Error('[UNSAFE_RECOVERY_DISABLED] Retry the canonical publication task with a new idempotency key');
    }
}
export const deliveryService = new DeliveryService();
export default deliveryService;

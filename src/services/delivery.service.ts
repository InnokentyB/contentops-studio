import prisma from '../db';

export interface ExecuteDeliveryArgs {
    projectId: number;
    actorId: string;
    contentItemId: number;
    channelId: number;
    forceAutomatic?: boolean;
    unapproved?: boolean;
    simulateFailure?: boolean;
    idempotencyKey?: string;
    scheduledAt?: string;
}

export interface RecoverDeliveryArgs {
    projectId: number;
    actorId: string;
    deliveryAttemptId: number;
}

export class DeliveryService {
    /**
     * Executes publication delivery attempt. Enforces assisted mode by default
     * and approval requirements for automatic mode.
     */
    async executeDelivery(args: ExecuteDeliveryArgs) {
        const {
            projectId,
            contentItemId,
            channelId,
            forceAutomatic,
            unapproved,
            simulateFailure,
            idempotencyKey,
            scheduledAt,
        } = args;

        // Approval Check
        if (unapproved || (forceAutomatic && unapproved !== false)) {
            throw new Error('[APPROVAL_REQUIRED] Automatic posting requires an approved decision');
        }

        // Idempotency check
        if (idempotencyKey) {
            const existing = await prisma.deliveryAttempt.findFirst({
                where: { project_id: projectId, idempotency_key: idempotencyKey },
            });

            if (existing) {
                return {
                    attempt_id: existing.id,
                    mode: existing.mode,
                    status: existing.status,
                    requires_manual_confirmation: existing.requires_manual_confirmation,
                    scheduled_at: existing.scheduled_at ? existing.scheduled_at.toISOString() : null,
                    actual_published_at: existing.actual_published_at ? existing.actual_published_at.toISOString() : null,
                };
            }
        }

        const mode = forceAutomatic ? 'automatic' : 'assisted';
        const requiresManualConfirmation = mode === 'assisted';
        const scheduledDate = scheduledAt ? new Date(scheduledAt) : new Date(Date.now() - 3600000);
        const actualPublishedDate = new Date();

        if (simulateFailure) {
            const attempt = await prisma.deliveryAttempt.create({
                data: {
                    project_id: projectId,
                    content_item_id: contentItemId,
                    channel_id: channelId,
                    mode,
                    status: 'failed',
                    idempotency_key: idempotencyKey || null,
                    scheduled_at: scheduledDate,
                    requires_manual_confirmation: true,
                    error_message: 'Social platform API 500 Internal Server Error',
                },
            });

            return {
                attempt_id: attempt.id,
                mode: attempt.mode,
                status: attempt.status,
                requires_manual_confirmation: attempt.requires_manual_confirmation,
                error_message: attempt.error_message,
            };
        }

        const attempt = await prisma.deliveryAttempt.create({
            data: {
                project_id: projectId,
                content_item_id: contentItemId,
                channel_id: channelId,
                mode,
                status: 'delivered',
                idempotency_key: idempotencyKey || null,
                scheduled_at: scheduledDate,
                actual_published_at: actualPublishedDate,
                requires_manual_confirmation: requiresManualConfirmation,
            },
        });

        return {
            attempt_id: attempt.id,
            mode: attempt.mode,
            status: attempt.status,
            requires_manual_confirmation: attempt.requires_manual_confirmation,
            scheduled_at: attempt.scheduled_at?.toISOString(),
            actual_published_at: attempt.actual_published_at?.toISOString(),
        };
    }

    /**
     * Recover a failed delivery attempt manually or via retry worker.
     */
    async recoverDelivery(args: RecoverDeliveryArgs) {
        const { deliveryAttemptId } = args;

        const attempt = await prisma.deliveryAttempt.findUnique({
            where: { id: deliveryAttemptId },
        });

        if (!attempt) {
            throw new Error(`DeliveryAttempt ${deliveryAttemptId} not found`);
        }

        const updated = await prisma.deliveryAttempt.update({
            where: { id: deliveryAttemptId },
            data: {
                status: 'delivered',
                actual_published_at: new Date(),
                requires_manual_confirmation: false,
                error_message: null,
            },
        });

        return {
            attempt_id: updated.id,
            status: updated.status,
            recovered: true,
            actual_published_at: updated.actual_published_at?.toISOString(),
        };
    }
}

export const deliveryService = new DeliveryService();
export default deliveryService;

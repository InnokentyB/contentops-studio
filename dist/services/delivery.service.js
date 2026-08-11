"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deliveryService = exports.DeliveryService = void 0;
const db_1 = __importDefault(require("../db"));
class DeliveryService {
    /**
     * Executes publication delivery attempt. Enforces assisted mode by default
     * and approval requirements for automatic mode.
     */
    async executeDelivery(args) {
        const { projectId, contentItemId, channelId, forceAutomatic, unapproved, simulateFailure, idempotencyKey, scheduledAt, } = args;
        // Approval Check
        if (unapproved || (forceAutomatic && unapproved !== false)) {
            throw new Error('[APPROVAL_REQUIRED] Automatic posting requires an approved decision');
        }
        // Idempotency check
        if (idempotencyKey) {
            const existing = await db_1.default.deliveryAttempt.findFirst({
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
            const attempt = await db_1.default.deliveryAttempt.create({
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
        const attempt = await db_1.default.deliveryAttempt.create({
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
    async recoverDelivery(args) {
        const { deliveryAttemptId } = args;
        const attempt = await db_1.default.deliveryAttempt.findUnique({
            where: { id: deliveryAttemptId },
        });
        if (!attempt) {
            throw new Error(`DeliveryAttempt ${deliveryAttemptId} not found`);
        }
        const updated = await db_1.default.deliveryAttempt.update({
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
exports.DeliveryService = DeliveryService;
exports.deliveryService = new DeliveryService();
exports.default = exports.deliveryService;

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const delivery_service_1 = require("../services/delivery.service");
function createHarness(overrides = {}) {
    const attempts = new Map();
    let nextId = 1;
    const task = {
        id: 815,
        project_id: 10,
        channel_id: 116,
        content_revision: 1,
        accepted_revision: 1,
        text_state: 'accepted',
        status: 'ready_for_execution',
        publication_mode: 'connector_auto',
        quality_report: {},
        channel: { id: 116, type: 'dzen', config: { workflow_mode: 'auto_publish', cookies: 'session=valid' } },
        publication_fact: null
    };
    const db = {
        contentItem: {
            findFirst: async () => ({ ...task }),
            findUnique: async () => ({ ...task }),
            updateMany: async ({ where, data }) => {
                if (task.id !== where.id || task.project_id !== where.project_id || task.channel_id !== where.channel_id
                    || task.content_revision !== where.content_revision || task.accepted_revision !== where.accepted_revision
                    || task.publication_mode !== where.publication_mode)
                    return { count: 0 };
                Object.assign(task, data);
                return { count: 1 };
            }
        },
        deliveryAttempt: {
            findFirst: async ({ where }) => Array.from(attempts.values()).find((row) => row.project_id === where.project_id
                && (where.id === undefined || row.id === where.id)
                && (where.idempotency_key === undefined || row.idempotency_key === where.idempotency_key)) || null,
            findMany: async () => Array.from(attempts.values()),
            create: async ({ data }) => {
                const row = { id: nextId++, created_at: new Date('2026-08-29T15:00:00Z'), updated_at: new Date('2026-08-29T15:00:00Z'), ...data };
                attempts.set(row.id, row);
                return row;
            },
            update: async ({ where, data }) => {
                const row = { ...attempts.get(where.id), ...data, updated_at: new Date('2026-08-29T15:01:00Z') };
                attempts.set(where.id, row);
                return row;
            },
            updateMany: async ({ where, data }) => {
                let count = 0;
                for (const [id, row] of attempts) {
                    if (where.id?.in?.includes(id) && row.project_id === where.project_id && row.content_item_id === where.content_item_id) {
                        attempts.set(id, { ...row, ...data });
                        count += 1;
                    }
                }
                return { count };
            }
        },
        event: {
            findFirst: async () => null,
            create: async ({ data }) => ({ id: 99, ...data })
        },
        ...overrides.db
    };
    const accessChecks = [];
    const service = new delivery_service_1.DeliveryService({
        prisma: db,
        now: () => new Date('2026-08-29T15:00:00Z'),
        requireAccess: async (projectId, actorId) => { accessChecks.push({ projectId, actorId }); },
        requireOwner: async (projectId, actorId) => { accessChecks.push({ projectId, actorId }); },
        preflightDzen: overrides.preflightDzen || (async () => ({ connected: true })),
        publishTask: overrides.publishTask || (async () => ({ success: true, status: 'published', publishedLink: 'https://dzen.ru/a/real-permalink' }))
    });
    return { service, db, task, attempts, accessChecks };
}
(0, node_test_1.default)('delivery executes the task-native publisher and marks delivered only after a canonical provider fact exists', async () => {
    const h = createHarness({
        publishTask: async () => {
            h.task.status = 'published';
            h.task.publication_fact = { outcome: 'published', public_url: 'https://dzen.ru/a/real-permalink', provider_object_id: null };
            return { success: true, status: 'published', publishedLink: 'https://dzen.ru/a/real-permalink' };
        }
    });
    const result = await h.service.executeDelivery({
        projectId: 10, actorId: 'user:1', contentItemId: 815, channelId: 116,
        forceAutomatic: true, idempotencyKey: 'dzen-815-v3'
    });
    strict_1.default.equal(result.status, 'delivered');
    strict_1.default.equal(result.published_link, 'https://dzen.ru/a/real-permalink');
    strict_1.default.deepEqual(h.accessChecks, [{ projectId: 10, actorId: 'user:1' }]);
});
(0, node_test_1.default)('delivery never reports delivered when the adapter has no canonical publication fact', async () => {
    const h = createHarness();
    await strict_1.default.rejects(h.service.executeDelivery({
        projectId: 10, actorId: 'user:1', contentItemId: 815, channelId: 116,
        forceAutomatic: true, idempotencyKey: 'dzen-815-no-fact'
    }), /PUBLICATION_IDENTITY_MISSING/);
    const [attempt] = Array.from(h.attempts.values());
    strict_1.default.equal(attempt.status, 'verification_required');
    strict_1.default.equal(attempt.actual_published_at, null);
    strict_1.default.equal(attempt.requires_manual_confirmation, true);
});
(0, node_test_1.default)('delivery validates project, channel, accepted revision, and due time before dispatch', async () => {
    const h = createHarness();
    h.task.channel_id = 999;
    await strict_1.default.rejects(h.service.executeDelivery({ projectId: 10, actorId: 'user:1', contentItemId: 815, channelId: 116, forceAutomatic: true }), /CHANNEL_MISMATCH/);
    h.task.channel_id = 116;
    h.task.accepted_revision = null;
    await strict_1.default.rejects(h.service.executeDelivery({ projectId: 10, actorId: 'user:1', contentItemId: 815, channelId: 116, forceAutomatic: true }), /APPROVAL_REQUIRED/);
    h.task.accepted_revision = 1;
    await strict_1.default.rejects(h.service.executeDelivery({ projectId: 10, actorId: 'user:1', contentItemId: 815, channelId: 116, forceAutomatic: true, scheduledAt: '2026-08-29T16:00:00Z' }), /DELIVERY_NOT_DUE/);
});
(0, node_test_1.default)('owner recovery invalidates false delivered attempts and writes an audit event idempotently', async () => {
    const h = createHarness();
    await h.db.deliveryAttempt.create({ data: {
            project_id: 10, content_item_id: 815, channel_id: 116, mode: 'automatic', status: 'delivered',
            idempotency_key: 'false-success', actual_published_at: new Date('2026-08-29T14:36:32Z'), requires_manual_confirmation: false
        } });
    const first = await h.service.invalidateFalseDeliveries({
        projectId: 10, actorId: 'user:1', contentItemId: 815, attemptIds: [1],
        reason: 'No provider publication exists', idempotencyKey: 'invalidate-815-v1'
    });
    const second = await h.service.invalidateFalseDeliveries({
        projectId: 10, actorId: 'user:1', contentItemId: 815, attemptIds: [1],
        reason: 'No provider publication exists', idempotencyKey: 'invalidate-815-v1'
    });
    strict_1.default.equal(first.invalidated_count, 1);
    strict_1.default.deepEqual(second, first);
    strict_1.default.equal(h.attempts.get(1).status, 'invalidated');
    strict_1.default.equal(h.attempts.get(1).actual_published_at, null);
    strict_1.default.equal(h.attempts.get(1).requires_manual_confirmation, true);
});
(0, node_test_1.default)('legacy recovery cannot turn a failed attempt into delivered without provider evidence', async () => {
    const h = createHarness();
    await h.db.deliveryAttempt.create({ data: {
            project_id: 10, content_item_id: 815, channel_id: 116, mode: 'automatic', status: 'failed',
            idempotency_key: 'failed-attempt', actual_published_at: null, requires_manual_confirmation: true
        } });
    await strict_1.default.rejects(h.service.recoverDelivery({ projectId: 10, actorId: 'user:1', deliveryAttemptId: 1 }), /UNSAFE_RECOVERY_DISABLED/);
    strict_1.default.equal(h.attempts.get(1).status, 'failed');
});
(0, node_test_1.default)('Dzen defaults to owner-approved connector auto after a successful cookie preflight', async () => {
    let publishCalls = 0;
    const h = createHarness({
        preflightDzen: async () => ({ connected: true, editor_url: 'https://dzen.ru/profile/editor/id/channel' }),
        publishTask: async () => {
            publishCalls += 1;
            strict_1.default.equal(h.task.publication_mode, 'connector_auto');
            strict_1.default.equal(h.task.status, 'ready_for_execution');
            h.task.status = 'published';
            h.task.publication_fact = { outcome: 'published', public_url: 'https://dzen.ru/a/confirmed', provider_object_id: null };
            return { success: true, status: 'published', publishedLink: 'https://dzen.ru/a/confirmed' };
        }
    });
    h.task.status = 'browser_required';
    h.task.publication_mode = 'browser_required';
    const result = await h.service.executeDelivery({
        projectId: 10, actorId: 'user:1', contentItemId: 815, channelId: 116,
        idempotencyKey: 'dzen-default-auto-v1'
    });
    strict_1.default.equal(result.status, 'delivered');
    strict_1.default.equal(publishCalls, 1);
    strict_1.default.equal(h.accessChecks.length, 2);
});
(0, node_test_1.default)('Dzen delivery preflight uses the rotated top-level session instead of a legacy raw_account snapshot', async () => {
    let preflightConfig = null;
    const h = createHarness({
        preflightDzen: async (config) => {
            preflightConfig = config;
            return { connected: true };
        },
        publishTask: async () => {
            h.task.status = 'published';
            h.task.publication_fact = { outcome: 'published', public_url: 'https://dzen.ru/a/confirmed', provider_object_id: null };
            return { success: true, status: 'published', publishedLink: 'https://dzen.ru/a/confirmed' };
        }
    });
    h.task.status = 'browser_required';
    h.task.publication_mode = 'browser_required';
    h.task.channel.config = {
        workflow_mode: 'auto_publish',
        channel_id: 'current-channel',
        cookies: 'Session_id=current-session; sessionid2=current-session-2',
        raw_account: { platform: 'dzen' }
    };
    await h.service.executeDelivery({
        projectId: 10, actorId: 'user:1', contentItemId: 815, channelId: 116,
        idempotencyKey: 'dzen-rotated-session-v1'
    });
    strict_1.default.equal(preflightConfig.channel_id, 'current-channel');
    strict_1.default.equal(preflightConfig.cookies, 'Session_id=current-session; sessionid2=current-session-2');
});
(0, node_test_1.default)('Dzen preflight failure leaves browser mode unchanged and creates no delivery attempt', async () => {
    const h = createHarness({ preflightDzen: async () => { throw new Error('Dzen authentication failed'); } });
    h.task.status = 'browser_required';
    h.task.publication_mode = 'browser_required';
    await strict_1.default.rejects(h.service.executeDelivery({
        projectId: 10, actorId: 'user:1', contentItemId: 815, channelId: 116,
        idempotencyKey: 'dzen-preflight-fails-v1'
    }), /Dzen authentication failed/);
    strict_1.default.equal(h.task.publication_mode, 'browser_required');
    strict_1.default.equal(h.attempts.size, 0);
});

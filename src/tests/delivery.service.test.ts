import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryService } from '../services/delivery.service';

function createHarness(overrides: Record<string, any> = {}) {
    const attempts = new Map<number, any>();
    let nextId = 1;
    const task: any = {
        id: 815,
        project_id: 10,
        channel_id: 116,
        content_revision: 1,
        accepted_revision: 1,
        text_state: 'accepted',
        status: 'ready_for_execution',
        publication_fact: null as any
    };
    const db: any = {
        contentItem: {
            findFirst: async () => ({ ...task }),
            findUnique: async () => ({ ...task })
        },
        deliveryAttempt: {
            findFirst: async ({ where }: any) => Array.from(attempts.values()).find((row) =>
                row.project_id === where.project_id
                && (where.id === undefined || row.id === where.id)
                && (where.idempotency_key === undefined || row.idempotency_key === where.idempotency_key)
            ) || null,
            findMany: async () => Array.from(attempts.values()),
            create: async ({ data }: any) => {
                const row = { id: nextId++, created_at: new Date('2026-08-29T15:00:00Z'), updated_at: new Date('2026-08-29T15:00:00Z'), ...data };
                attempts.set(row.id, row);
                return row;
            },
            update: async ({ where, data }: any) => {
                const row = { ...attempts.get(where.id), ...data, updated_at: new Date('2026-08-29T15:01:00Z') };
                attempts.set(where.id, row);
                return row;
            },
            updateMany: async ({ where, data }: any) => {
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
            create: async ({ data }: any) => ({ id: 99, ...data })
        },
        ...overrides.db
    };
    const accessChecks: any[] = [];
    const service = new DeliveryService({
        prisma: db,
        now: () => new Date('2026-08-29T15:00:00Z'),
        requireAccess: async (projectId: number, actorId: string) => { accessChecks.push({ projectId, actorId }); },
        requireOwner: async (projectId: number, actorId: string) => { accessChecks.push({ projectId, actorId }); },
        publishTask: overrides.publishTask || (async () => ({ success: true, status: 'published', publishedLink: 'https://dzen.ru/a/real-permalink' }))
    });
    return { service, db, task, attempts, accessChecks };
}

test('delivery executes the task-native publisher and marks delivered only after a canonical provider fact exists', async () => {
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

    assert.equal(result.status, 'delivered');
    assert.equal((result as any).published_link, 'https://dzen.ru/a/real-permalink');
    assert.deepEqual(h.accessChecks, [{ projectId: 10, actorId: 'user:1' }]);
});

test('delivery never reports delivered when the adapter has no canonical publication fact', async () => {
    const h = createHarness();
    await assert.rejects(
        h.service.executeDelivery({
            projectId: 10, actorId: 'user:1', contentItemId: 815, channelId: 116,
            forceAutomatic: true, idempotencyKey: 'dzen-815-no-fact'
        }),
        /PUBLICATION_IDENTITY_MISSING/
    );
    const [attempt] = Array.from(h.attempts.values());
    assert.equal(attempt.status, 'verification_required');
    assert.equal(attempt.actual_published_at, null);
    assert.equal(attempt.requires_manual_confirmation, true);
});

test('delivery validates project, channel, accepted revision, and due time before dispatch', async () => {
    const h = createHarness();
    h.task.channel_id = 999;
    await assert.rejects(
        h.service.executeDelivery({ projectId: 10, actorId: 'user:1', contentItemId: 815, channelId: 116, forceAutomatic: true }),
        /CHANNEL_MISMATCH/
    );

    h.task.channel_id = 116;
    h.task.accepted_revision = null;
    await assert.rejects(
        h.service.executeDelivery({ projectId: 10, actorId: 'user:1', contentItemId: 815, channelId: 116, forceAutomatic: true }),
        /APPROVAL_REQUIRED/
    );

    h.task.accepted_revision = 1;
    await assert.rejects(
        h.service.executeDelivery({ projectId: 10, actorId: 'user:1', contentItemId: 815, channelId: 116, forceAutomatic: true, scheduledAt: '2026-08-29T16:00:00Z' }),
        /DELIVERY_NOT_DUE/
    );
});

test('owner recovery invalidates false delivered attempts and writes an audit event idempotently', async () => {
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

    assert.equal(first.invalidated_count, 1);
    assert.deepEqual(second, first);
    assert.equal(h.attempts.get(1).status, 'invalidated');
    assert.equal(h.attempts.get(1).actual_published_at, null);
    assert.equal(h.attempts.get(1).requires_manual_confirmation, true);
});

test('legacy recovery cannot turn a failed attempt into delivered without provider evidence', async () => {
    const h = createHarness();
    await h.db.deliveryAttempt.create({ data: {
        project_id: 10, content_item_id: 815, channel_id: 116, mode: 'automatic', status: 'failed',
        idempotency_key: 'failed-attempt', actual_published_at: null, requires_manual_confirmation: true
    } });
    await assert.rejects(
        h.service.recoverDelivery({ projectId: 10, actorId: 'user:1', deliveryAttemptId: 1 }),
        /UNSAFE_RECOVERY_DISABLED/
    );
    assert.equal(h.attempts.get(1).status, 'failed');
});

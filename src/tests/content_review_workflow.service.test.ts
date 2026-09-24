import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../db';
import workQueueService from '../services/work_queue.service';

test('reviewer lease submits a revision-bound result for approval and rejects cross-kind reuse', async () => {
    const db = prisma as any;
    const originalTransaction = db.$transaction;
    const item: any = {
        id: 944, project_id: 10, kind: 'content_review',
        assignee_role: 'content_reviewer', state: 'available', result_version: 1,
        content_item_id: 953, content_item: { id: 953, content_revision: 3 },
        lease_token: null, lease_actor_id: null, lease_expires_at: null
    };
    const events: any[] = [];
    const tx = {
        project: { findUnique: async () => ({ id: 10 }) },
        projectMember: { findUnique: async () => ({ id: 1 }) },
        workflowEvent: {
            findFirst: async ({ where }: any) => events.find(event => event.data.command === where.command
                && event.data.idempotency_key === where.idempotency_key)?.data
                ? { after_state: events.find(event => event.data.command === where.command
                    && event.data.idempotency_key === where.idempotency_key).data.after_state }
                : null,
            create: async (event: any) => { events.push(event); return event; }
        },
        workItem: {
            findFirst: async () => ({ ...item }),
            updateMany: async ({ where, data }: any) => {
                if (where.kind !== item.kind || where.assignee_role !== item.assignee_role
                    || where.state !== item.state || where.result_version !== item.result_version
                    || (where.lease_token && where.lease_token !== item.lease_token)) return { count: 0 };
                Object.assign(item, data);
                return { count: 1 };
            }
        }
    };
    db.$transaction = async (callback: any) => callback(tx);
    try {
        const base = { projectId: 10, actorId: 'user:7', workItemId: 944,
            expectedResultVersion: 1, expectedContentRevision: 3 };
        const claim = await workQueueService.claimContentReview({ ...base, idempotencyKey: 'claim-944' });
        assert.equal(item.state, 'claimed');
        assert.equal(events.length, 1);
        const submitted = await workQueueService.submitContentReview({
            ...base, leaseToken: claim.lease_token as string,
            result: { recommendation: 'approve', summary: 'Revision checked' },
            idempotencyKey: 'submit-944'
        });
        assert.deepEqual(submitted.work_item, { id: 944, state: 'waiting_approval', result_version: 2 });
        assert.equal(item.result_payload.summary, 'Revision checked');
        assert.equal(item.lease_token, null);
        assert.equal(events.length, 2);
        const replay = await workQueueService.submitContentReview({
            ...base, leaseToken: claim.lease_token as string,
            result: { recommendation: 'approve', summary: 'Revision checked' },
            idempotencyKey: 'submit-944'
        });
        assert.deepEqual(replay.work_item, submitted.work_item);
        assert.equal(events.length, 2);
        item.kind = 'content_write';
        item.state = 'available';
        await assert.rejects(workQueueService.claimContentReview({
            ...base, idempotencyKey: 'cross-kind'
        }), /CONTENT_REVIEW_ROLE_MISMATCH/);
        assert.equal(events.length, 2);
    } finally {
        db.$transaction = originalTransaction;
    }
});

test('a new claim key atomically recovers an expired content-review lease without changing versions', async () => {
    const db = prisma as any;
    const originalTransaction = db.$transaction;
    const expiredAt = new Date(Date.now() - 60_000);
    const item: any = {
        id: 983, project_id: 10, kind: 'content_review',
        assignee_role: 'content_reviewer', state: 'claimed', result_version: 1,
        content_item_id: 973, content_item: { id: 973, content_revision: 1 },
        lease_token: 'expired-token', lease_actor_id: 'user:7', lease_expires_at: expiredAt
    };
    const events: any[] = [];
    const tx = {
        project: { findUnique: async () => ({ id: 10 }) },
        projectMember: { findUnique: async () => ({ id: 1 }) },
        workflowEvent: {
            findFirst: async () => null,
            create: async (event: any) => { events.push(event); return event; }
        },
        workItem: {
            findFirst: async () => ({ ...item }),
            updateMany: async ({ where, data }: any) => {
                if (where.state !== item.state || where.result_version !== item.result_version
                    || !where.lease_expires_at?.lt || !(item.lease_expires_at < where.lease_expires_at.lt)) {
                    return { count: 0 };
                }
                Object.assign(item, data);
                return { count: 1 };
            }
        }
    };
    db.$transaction = async (callback: any) => callback(tx);
    try {
        const recovered = await workQueueService.claimContentReview({
            projectId: 10,
            actorId: 'user:7',
            workItemId: 983,
            expectedResultVersion: 1,
            expectedContentRevision: 1,
            idempotencyKey: 'task973-review-recover-20260924'
        });

        assert.equal(recovered.content_revision, 1);
        assert.deepEqual(recovered.work_item, { id: 983, state: 'claimed', result_version: 1 });
        assert.notEqual(recovered.lease_token, 'expired-token');
        assert.equal(item.state, 'claimed');
        assert.equal(item.result_version, 1);
        assert.equal(item.lease_actor_id, 'user:7');
        assert.equal(events.length, 1);
        assert.equal(events[0].data.before_state.expired_lease_recovered, true);
        assert.equal(events[0].data.after_state.expired_lease_recovered, true);
    } finally {
        db.$transaction = originalTransaction;
    }
});

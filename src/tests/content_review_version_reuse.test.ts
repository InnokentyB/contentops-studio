import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../db';
import artDirectionService from '../services/art_direction.service';
import { completeWorkItem } from '../services/work_queue/lifecycle_operations';

test('a new writer result reopens review without resetting review version or retaining a lease', async () => {
    const originalTransaction = prisma.$transaction;
    const originalStale = artDirectionService.markRevisionStale;
    let reads = 0;
    let reopened = false;
    const tx = {
        project: { findUnique: async () => ({ id: 10 }) },
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: { findFirst: async () => null, create: async () => ({ id: 1 }) },
        contentItem: { update: async () => ({ id: 1040, content_revision: 4 }) },
        workItem: {
            findFirst: async () => ++reads === 1
                ? { id: 1612, project_id: 10, content_item_id: 1040, kind: 'content_write',
                    result_version: 0, week_package_id: 51, item_key: 'fixture', due_at: null }
                : { id: 1605, result_version: 3 },
            updateMany: async () => ({ count: 1 }),
            update: async ({ data }: { data: Record<string, unknown> }) => {
                assert.equal(data.state, 'available');
                assert.equal('result_version' in data, false);
                assert.equal(data.lease_token, null);
                assert.equal(data.lease_actor_id, null);
                reopened = true;
                return { id: 1605 };
            }
        }
    };
    prisma.$transaction = (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as unknown as typeof prisma.$transaction;
    artDirectionService.markRevisionStale = async () => undefined;
    try {
        await completeWorkItem({ projectId: 10, actorId: 'user:2', workItemId: 1612,
            leaseToken: 'fixture', result: { body: 'Fresh English revision' }, idempotencyKey: 'fixture-complete' });
        assert.equal(reopened, true);
    } finally {
        prisma.$transaction = originalTransaction;
        artDirectionService.markRevisionStale = originalStale;
    }
});

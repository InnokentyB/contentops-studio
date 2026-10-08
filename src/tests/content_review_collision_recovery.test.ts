import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../db';
import { recoverContentReview } from '../services/work_queue/recovery_operations';

test('audited recovery creates fresh revision-bound review rather than accepting an unbound collided payload', async () => {
    const originalTransaction = prisma.$transaction;
    const body = 'Exact current English body';
    const oldPayload = { recommendation: 'approve', summary: 'English review' };
    const review = { id: 1605, result_version: 2, state: 'waiting_approval', result_payload: oldPayload,
        week_package_id: 51, item_key: 'fixture-review' };
    let cached: Record<string, unknown> | null = null;
    let newItems = 0;
    let owner = true;
    const tx = {
        projectMember: { findUnique: async () => ({ role: owner ? 'owner' : 'member' }) },
        contentItem: { findFirst: async () => ({ id: 1040, content_revision: 4, accepted_revision: null,
            text_state: 'draft', draft_text: body }), update: async () => ({ id: 1040 }) },
        workItem: {
            findFirst: async () => review,
            update: async ({ data }: { data: Record<string, unknown> }) => {
                assert.equal(data.state, 'completed');
                assert.equal('result_version' in data, false);
                assert.equal('result_payload' in data, false);
                return review;
            },
            upsert: async ({ create }: { create: Record<string, unknown> }) => {
                newItems++;
                assert.equal(create.input_context_version, 4);
                assert.equal(create.state, 'available');
                return { id: 1700, ...create };
            }
        },
        approvalDecision: {
            findUnique: async () => ({ decision: 'rejected', result_version: 2 }),
            findFirst: async () => ({ result_version: 3 })
        },
        workflowEvent: {
            findFirst: async () => cached ? { after_state: cached } : null,
            create: async ({ data }: { data: { command: string; after_state: Record<string, unknown> } }) => {
                assert.equal(data.command, 'ba_recover_content_review');
                cached = data.after_state;
                return { id: 1 };
            }
        }
    };
    prisma.$transaction = (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as unknown as typeof prisma.$transaction;
    try {
        const args = { projectId: 10, actorId: 'user:2', taskId: 1040, workItemId: 1605,
            expectedContentRevision: 4, idempotencyKey: '1040-review-collision-recovery',
            evidence: 'Fresh English body; historical result version collision' };
        const result = await recoverContentReview(args);
        assert.equal(result.work_item_id, 1700);
        assert.equal(result.superseded_work_item_id, 1605);
        assert.equal(result.content_revision, 4);
        assert.equal(result.accepted_revision, null);
        assert.equal(review.result_version, 2);
        assert.equal(review.result_payload, oldPayload);
        assert.deepEqual(await recoverContentReview(args), result);
        assert.equal(newItems, 1);
        owner = false;
        await assert.rejects(() => recoverContentReview(args), /Project owner role is required/);
    } finally {
        prisma.$transaction = originalTransaction;
    }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { isToolAllowedForProfile } from '../mcp/capabilities';
import prisma from '../db';
import { oct08ReviewRecoverySchema, recoverOct08ContentReview } from '../mcp/tools/oct08_review_recovery';

test('exact October review recovery is exposed to editor, not generic owner recovery', () => {
    assert.equal(isToolAllowedForProfile('editor', 'ba_recover_oct08_content_review'), true);
    assert.equal(isToolAllowedForProfile('editor', 'ba_recover_content_review'), false);
    assert.equal(isToolAllowedForProfile('writer', 'ba_recover_oct08_content_review'), false);
});

test('exact recovery rejects other tenant/task and changed body before mutation', async () => {
    const args = { projectId: 10 as const, taskId: 1040 as const, actorId: 'user:2',
        idempotencyKey: 'test-recovery', evidence: 'Owner-directed review recovery' };
    assert.equal(oct08ReviewRecoverySchema.safeParse({ ...args, projectId: 7 }).success, false);
    assert.equal(oct08ReviewRecoverySchema.safeParse({ ...args, taskId: 1041 }).success, false);
    const original = prisma.contentItem.findFirst;
    prisma.contentItem.findFirst = (async () => ({ content_revision: 4, draft_text: 'changed' })) as unknown as typeof original;
    try {
        await assert.rejects(() => recoverOct08ContentReview(args), /EXACT_REVIEW_RECOVERY_PACKAGE_MISMATCH/);
    } finally {
        prisma.contentItem.findFirst = original;
    }
});

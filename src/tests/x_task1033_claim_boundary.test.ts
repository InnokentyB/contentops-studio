import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../db';
import { claimXBrowserPublication } from '../services/x_task1025_release.service';

test('X claim admits 1033 only inside the existing owner-released tenant/channel boundary', async () => {
    const original = prisma.workItem.findFirst;
    let query: unknown;
    prisma.workItem.findFirst = (async args => { query = args; return null; }) as typeof original;
    try {
        await assert.rejects(claimXBrowserPublication({ projectId: 10, actorId: 'user:2',
            workItemId: 999999, idempotencyKey: 'test-no-claim' }), /X_BROWSER_WORK_ITEM_REQUIRED/);
        const captured = query as { where: { content_item: { id: { in: number[] }; project_id: number;
            channel_id: number; publication_mode: string; publication_fact: null } } };
        assert.ok(captured.where.content_item.id.in.includes(1033));
        assert.equal(captured.where.content_item.project_id, 10);
        assert.equal(captured.where.content_item.channel_id, 164);
        assert.equal(captured.where.content_item.publication_mode, 'browser_required');
        assert.equal(captured.where.content_item.publication_fact, null);
    } finally { prisma.workItem.findFirst = original; }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { holdVkTask1084 } from '../services/vk_task1084_hold.service';
import { derivePublicationGenerationStage } from '../services/publication_generation_stage';

test('an explicit hold takes precedence over the retained browser publication mode', () => {
    assert.equal(derivePublicationGenerationStage({ status: 'blocked', handoffState: 'blocked',
        publicationMode: 'browser_required', textState: 'accepted', visualState: 'APPROVED' }), 'blocked');
});

function harness(active = false, role = 'owner') {
    const writes: Array<Record<string, unknown>> = [];
    const task = { id: 1084, channel_id: 117, channel: { type: 'vk', name: 'analystcraft_vk_group' },
        content_revision: 1, accepted_revision: 1, text_state: 'accepted', visual_state: 'APPROVED',
        visual_placement: 'feed', selected_asset_id: 118, draft_text: 'Accepted body', status: 'browser_required',
        handoff_state: 'ready', updated_at: new Date(), quality_report: { owner_release: { authorized: true } },
        selected_asset: { status: 'approved', content_revision: 1, decision_id: 246, provenance: { planner_storage: {
            mime_type: 'video/mp4', sha256: '8032717b6898e1dd915e585a481aa27696d7aa383b0a51277a4e912f89caeca1'
        } } } };
    const tx = {
        projectMember: { findUnique: async () => ({ role }) },
        contentItem: { findFirst: async () => task, updateMany: async ({ data }: { data: Record<string, unknown> }) => {
            writes.push(data); return { count: 1 };
        } },
        workItem: { findMany: async () => [{ id: 1572, state: 'claimed', lease_expires_at: new Date(active ? Date.now() + 60000 : 0) }] },
        deliveryAttempt: { findMany: async () => [] },
        workflowEvent: { findFirst: async () => null, create: async () => ({}) }
    };
    const database = { $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as Parameters<typeof holdVkTask1084>[1];
    return { database, writes };
}
const args = { projectId: 10, taskId: 1084, actorId: 'user:2', expectedBodySha256:
    createHash('sha256').update('Accepted body').digest('hex'), idempotencyKey: 'hold1084', approvalReference: 'owner safety hold' };
test('hold preview is secret-free and performs no writes', async () => {
    const h = harness();
    const result = await holdVkTask1084(args, h.database);
    assert.equal('attempt_absence_confirmed' in result && result.attempt_absence_confirmed, true);
    assert.equal(h.writes.length, 0);
    assert.equal(JSON.stringify(result).includes('lease_token'), false);
});
test('exact hold preserves accepted records and owner release; never clears leases', async () => {
    const h = harness();
    const result = await holdVkTask1084({ ...args, dryRun: false }, h.database);
    assert.equal('held' in result && result.held, true);
    assert.deepEqual(Object.keys(h.writes[0]).sort(), ['handoff_state', 'quality_report', 'status']);
    assert.deepEqual((h.writes[0].quality_report as Record<string, unknown>).owner_release, { authorized: true });
});
test('active claim and non-owner are refused without writes', async () => {
    for (const [active, role, error] of [[true, 'owner', /OPERATION_ACTIVE/], [false, 'editor', /OWNER_REQUIRED/]] as const) {
        const h = harness(active, role);
        await assert.rejects(holdVkTask1084({ ...args, dryRun: false }, h.database), error);
        assert.equal(h.writes.length, 0);
    }
});

test('prepare cannot silently remove an audited hold', async () => {
    const { default: db } = await import('../db');
    const { preparePublicationTask } = await import('../services/mcp_publication/tasks');
    const original = db.contentItem.findFirst;
    try {
        db.contentItem.findFirst = (async () => ({ id: 1084, status: 'blocked', quality_report: {
            publication_hold: { blockers: ['BROWSER_POLICY_DENIED'] }
        } })) as unknown as typeof original;
        await assert.rejects(preparePublicationTask(10, 1084), /PUBLICATION_HOLD_ACTIVE/);
    } finally {
        db.contentItem.findFirst = original;
    }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { PublicationRetirementService } from '../services/publication_retirement.service';

const checksum = `sha256:${'c'.repeat(64)}`;
function harness() {
    const state: any = { writes: 0, events: [{ id: 2629, project_id: 10, actor_id: 'user:2', command: 'ba_apply_publication_retirement',
        after_state: { result: { retired_task_ids: [854, 984, 1011] } } }], tasks: [854, 984, 1011].map((id) => ({ id, project_id: 10,
        status: 'cancelled', publication_mode: 'retired', publication_fact: null, published_link: null, draft_text: `body-${id}`,
        content_revision: 1, accepted_revision: 1, selected_asset_id: id === 1011 ? 98 : null, assets: { marker: id }, quality_report: { existing: id } })) };
    const tx: any = { projectMember: { findUnique: async () => ({ role: 'owner' }) }, project: { findUnique: async () => ({ id: 10, slug: 'analystcraft-2' }) },
        workflowEvent: { findFirst: async ({ where }: any) => state.events.find((event: any) => where.id
            ? event.id === where.id
            : event.project_id === where.project_id && event.actor_id === where.actor_id && event.command === where.command
                && event.idempotency_key === where.idempotency_key) || null,
            create: async ({ data }: any) => { const event = { id: 2630, ...data }; state.events.push(event); state.writes += 1; return event; } },
        contentItem: { findMany: async () => state.tasks, updateMany: async ({ where, data }: any) => { const task = state.tasks.find((x: any) => x.id === where.id); Object.assign(task, data); state.writes += 1; return { count: task ? 1 : 0 }; } },
        $queryRaw: async () => [] };
    const db: any = { ...tx, $transaction: async (cb: any) => cb(tx) };
    const service = new PublicationRetirementService(db, { loadManifest: async () => ({ checksum }), checkTelegramHistory: async () => ({ status: 'not_found', matches: [] }), now: () => new Date() });
    return { state, service };
}
const params = { projectId: 10 as const, projectSlug: 'analystcraft-2' as const, actorId: 'user:2', expectedManifestChecksum: checksum,
    expectedRetirementAuditId: 2629, approvalReference: 'owner-preserve-provider-uncertainty' };

test('uncertainty projection is exact, preserves protected fields, and is idempotent', async () => {
    const h = harness(); const before = structuredClone(h.state.tasks);
    const preview = await h.service.previewUncertaintyProjection(params);
    assert.deepEqual(preview.affected_task_ids, [854, 984, 1011]); assert.equal(preview.changes.length, 3);
    const args = { ...params, previewHash: preview.preview_hash, reason: 'Preserve the existing uncertain provider outcome explicitly.', idempotencyKey: 'uncertainty-projection-v1' };
    const result = await h.service.applyUncertaintyProjection(args);
    assert.equal(result.audit_id, 2630); assert.ok(h.state.tasks.every((task: any) => task.quality_report.provider_result_uncertain === true));
    for (let index = 0; index < before.length; index += 1) {
        assert.equal(h.state.tasks[index].status, before[index].status); assert.equal(h.state.tasks[index].selected_asset_id, before[index].selected_asset_id);
        assert.deepEqual(h.state.tasks[index].assets, before[index].assets);
    }
    const writes = h.state.writes; const replay = await h.service.applyUncertaintyProjection(args);
    assert.equal(replay.replayed, true); assert.equal(h.state.writes, writes);
});

test('uncertainty projection rejects changed task or wrong retirement audit without writes', async () => {
    const h = harness(); h.state.tasks[0].status = 'published';
    await assert.rejects(h.service.previewUncertaintyProjection(params), /UNCERTAINTY_PROJECTION_TASK_GUARD_FAILED/);
    assert.equal(h.state.writes, 0);
    const h2 = harness();
    await assert.rejects(h2.service.previewUncertaintyProjection({ ...params, expectedRetirementAuditId: 9999 }), /RETIREMENT_AUDIT_GUARD_FAILED/);
    assert.equal(h2.state.writes, 0);
});

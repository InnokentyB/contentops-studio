import assert from 'node:assert/strict';
import test from 'node:test';
import { repairPersonalPublicationLanguage } from '../services/personal_publication_language_repair.service';

const manifest = 'sha256:6ceb5c1c2199d8c1915beeb622a9791ff9c1b877d02649c8e69acd0d173e46d8' as const;
const specs = [
    { taskId: 1107 as const, channelId: 164, type: 'x', name: 'innokenty_x',
        sha: '2029e3fc10296091ba2331bcc2e666d5db895923111d37fb141cbec77171fdd4',
        schedule: '2026-10-12T15:00:00.000Z' },
    { taskId: 1108 as const, channelId: 138, type: 'threads', name: 'innokenty_threads',
        sha: 'b7d8b317537dce0cc347258574101de75f3cc3d5aee131c1d1c62c4e12448feb',
        schedule: '2026-10-12T16:30:00.000Z' }
];

function harness(spec: typeof specs[number]) {
    let qualityReport: Record<string, unknown> = {
        handoff_bundle: { accepted_revision: 1, text: 'English accepted body' }
    };
    const task = { id: spec.taskId, project_id: 10, channel_id: spec.channelId,
        channel: { id: spec.channelId, type: spec.type, name: spec.name, is_active: true },
        type: 'publication', status: 'ready_for_execution', publication_mode: 'approval_required',
        content_revision: 1, accepted_revision: 1, text_state: 'accepted', handoff_state: 'ready',
        visual_state: 'NO_VISUAL_NEEDED', visual_placement: 'feed', selected_asset_id: null,
        title: spec.taskId === 1107 ? 'W42 #04 — Personal X' : 'W42 #05 — Personal Threads',
        draft_text: 'English accepted body', schedule_at: new Date(spec.schedule),
        publish_at: new Date(spec.schedule), published_link: null, publication_fact: null };
    const events: Array<Record<string, unknown>> = [];
    type RepairDb = NonNullable<Parameters<typeof repairPersonalPublicationLanguage>[1]>;
    let db: RepairDb;
    db = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        contentItem: { findFirst: async () => ({ ...task, quality_report: qualityReport }),
            updateMany: async (input: unknown) => {
            const data = (input as { data: { quality_report: Record<string, unknown> } }).data;
            qualityReport = data.quality_report; return { count: 1 };
        } },
        deliveryAttempt: { findFirst: async () => null },
        workflowEvent: { findFirst: async () => null, create: async (input: unknown) => {
            events.push((input as { data: Record<string, unknown> }).data);
        } },
        async $transaction<T>(run: (tx: RepairDb) => Promise<T>) { return run(db); }
    };
    return { db, events, get qualityReport() { return qualityReport; } };
}

for (const spec of specs) test(`task ${spec.taskId} gets an audited English handoff override without release`, async () => {
    const h = harness(spec);
    const base = { projectId: 10 as const, taskId: spec.taskId, actorId: 'user:2',
        expectedManifestChecksum: manifest, expectedBodySha256: spec.sha,
        expectedScheduleAt: spec.schedule, idempotencyKey: `language-${spec.taskId}-v1` };
    const preview = await repairPersonalPublicationLanguage({ ...base, confirm: false }, h.db,
        { hashBody: () => spec.sha, manifestLoader: async () => ({ checksum: manifest }) as never });
    if (!('to' in preview)) throw new Error('preview missing');
    assert.equal(preview.to.content_language, 'en');
    assert.equal(h.qualityReport.content_language, undefined);
    const applied = await repairPersonalPublicationLanguage({ ...base, confirm: true }, h.db,
        { hashBody: () => spec.sha, manifestLoader: async () => ({ checksum: manifest }) as never });
    if (!('release_created' in applied)) throw new Error('apply result missing');
    assert.equal(h.qualityReport.content_language, 'en');
    assert.equal((h.qualityReport.handoff_bundle as Record<string, unknown>).content_language, 'en');
    assert.equal(applied.release_created, false);
    assert.equal(applied.provider_called, false);
    assert.equal(h.events.length, 1);
});

test('language repair aborts on changed accepted bytes with zero writes', async () => {
    const spec = specs[0]; const h = harness(spec);
    await assert.rejects(repairPersonalPublicationLanguage({ projectId: 10, taskId: 1107,
        actorId: 'user:2', expectedManifestChecksum: manifest, expectedBodySha256: spec.sha,
        expectedScheduleAt: spec.schedule, idempotencyKey: 'language-1107-v1', confirm: true }, h.db,
    { hashBody: () => 'changed', manifestLoader: async () => ({ checksum: manifest }) as never }), /GUARD_FAILED/);
    assert.equal(h.events.length, 0);
});

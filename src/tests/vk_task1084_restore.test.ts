import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreVkTask1084, RestoreVkTask1084Args } from '../services/vk_task1084_restore.service';

const MANIFEST = 'sha256:6ceacab82fdacf12565ca62b1359928cd78957ddbc83b6d942f3afcf2cd28ee2';
const BODY = 'LLM может выглядеть как хорошо подготовленный джун, но без рамок быстро уйти не туда. Поэтому постановка должна задавать контекст, ограничения и проверяемый результат. Больше разборов: https://t.me/spherical_analyst';
const args: RestoreVkTask1084Args = {
    projectId: 10, projectSlug: 'analystcraft-2', taskId: 1084, actorId: 'user:2',
    expectedManifestChecksum: MANIFEST, registrySnapshotVersion: 25,
    registrySnapshotHash: 'ba4edd40ffebcf3569d4a4f5d65337aea8331e68ebea286fb836ea49193c7db7',
    expectedRetirementAuditId: 2629,
    expectedBodySha256: '604452f079a35149d6934713f3f30b451d24cd4db726488b4724125a3db14594',
    expectedAssetSha256: '8032717b6898e1dd915e585a481aa27696d7aa383b0a51277a4e912f89caeca1',
    approvalReference: 'Portfolio HQ owner correction: restore exact task 1084',
    reason: 'Task 1084 was active video production and was included in the old batch by mistake.'
};

function harness(options: { activeLease?: boolean; attempts?: ReadonlyArray<unknown>; auditIncludesTask?: boolean;
    prior?: { before_state: unknown; after_state: unknown; id: number } | null } = {}) {
    const writes: Array<Record<string, unknown>> = [];
    const events: Array<Record<string, unknown>> = [];
    const createdWorkItems: Array<Record<string, unknown>> = [];
    const task = {
        id: 1084, project_id: 10, channel_id: 117, channel: { type: 'vk', name: 'analystcraft_vk_group' },
        content_revision: 1, accepted_revision: 1, text_state: 'accepted', visual_state: 'APPROVED',
        visual_placement: 'feed', selected_asset_id: 118, draft_text: BODY, status: 'cancelled',
        publication_mode: 'retired', handoff_state: 'ready', updated_at: new Date('2026-10-08T16:11:11Z'),
        schedule_at: new Date('2026-10-07T15:00:00Z'), week_package_id: null,
        quality_report: { owner_release: { publication_authorized: true } }, publication_fact: null, published_link: null,
        selected_asset: { status: 'approved', content_revision: 1, decision_id: 246, provenance: { planner_storage: {
            mime_type: 'video/mp4', sha256: args.expectedAssetSha256
        } } }
    };
    const tx = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        project: { findUnique: async () => ({ id: 10, slug: 'analystcraft-2' }) },
        contentItem: {
            findFirst: async () => task,
            updateMany: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return { count: 1 }; }
        },
        deliveryAttempt: { findMany: async () => options.attempts || [] },
        workItem: {
            findMany: async () => [{ id: 1572, kind: 'browser_publish', state: 'claimed', dedupe_key: null,
                lease_expires_at: new Date(options.activeLease ? '2099-01-01T00:00:00Z' : '2026-10-07T14:59:59Z') }],
            create: async ({ data }: { data: Record<string, unknown> }) => {
                createdWorkItems.push(data); return { id: 2001, ...data };
            }
        },
        workflowEvent: {
            findFirst: async ({ where }: { where: Record<string, unknown> }) => {
                if (where.id === 2629) return { id: 2629, after_state: { result: {
                    retired_task_ids: options.auditIncludesTask === false ? [1000] : [1000, 1084]
                } } };
                return options.prior || null;
            },
            create: async ({ data }: { data: Record<string, unknown> }) => { events.push(data); return { id: 2700 }; }
        }
    };
    const database = { $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as Parameters<typeof restoreVkTask1084>[1];
    const dependencies = {
        loadManifest: async () => ({ checksum: MANIFEST, project: { id: 10, slug: 'analystcraft-2' } }),
        now: () => new Date('2026-10-08T16:55:00Z')
    };
    return { database, dependencies, writes, events, createdWorkItems };
}

test('preview proves the exact retired package can be restored without writing', async () => {
    const h = harness();
    const result = await restoreVkTask1084(args, h.database, h.dependencies);
    assert.equal('status' in result && result.status, 'blocked');
    assert.equal('publication_mode' in result && result.publication_mode, 'owner_released');
    assert.equal('accepted_revision' in result && result.accepted_revision, 1);
    assert.equal('selected_asset_id' in result && result.selected_asset_id, 118);
    assert.equal('blocker' in result && result.blocker, 'VK_NATIVE_VIDEO_ADAPTER_UNSUPPORTED');
    assert.equal('recovery_schedule_at' in result && result.recovery_schedule_at, null);
    assert.equal(h.writes.length, 0);
    assert.equal(h.events.length, 0);
    assert.equal(h.createdWorkItems.length, 0);
});

test('apply restores only lifecycle fields and records the owner correction plus engineering blocker', async () => {
    const h = harness();
    const result = await restoreVkTask1084({ ...args, dryRun: false, idempotencyKey: 'restore-1084-owner-v1' },
        h.database, h.dependencies);
    assert.equal('status' in result && result.status, 'blocked');
    assert.equal('audit_id' in result && result.audit_id, 2700);
    assert.deepEqual(Object.keys(h.writes[0]).sort(), ['handoff_state', 'publication_mode', 'quality_report', 'status']);
    assert.equal(h.writes[0].publication_mode, 'owner_released');
    assert.deepEqual((h.writes[0].quality_report as Record<string, unknown>).owner_release,
        { publication_authorized: true });
    assert.equal(h.createdWorkItems[0].dedupe_key, 'vk_native_video_transport:10:1084');
    assert.equal(h.createdWorkItems[0].state, 'blocked');
    assert.equal(h.events[0].command, 'ba_restore_vk_task1084_from_erroneous_retirement');
});

test('restore refuses missing audit membership, provider attempts and active leases', async () => {
    for (const [options, error] of [
        [{ auditIncludesTask: false }, /RETIREMENT_AUDIT_GUARD_FAILED/],
        [{ attempts: [{ id: 1 }] }, /DELIVERY_ATTEMPT_EXISTS/],
        [{ activeLease: true }, /PUBLICATION_OPERATION_ACTIVE_OR_UNCERTAIN/]
    ] as const) {
        const h = harness(options);
        await assert.rejects(restoreVkTask1084({ ...args, dryRun: false, idempotencyKey: `guard-${error}` },
            h.database, h.dependencies), error);
        assert.equal(h.writes.length, 0);
    }
});

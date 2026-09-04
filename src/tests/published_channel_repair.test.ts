import assert from 'node:assert/strict';
import test from 'node:test';
import { PublishedChannelRepairService } from '../services/published_channel_repair.service';

const PUBLIC_URL = 'https://dzen.ru/a/aoAqgw3vfB2MGNqS';

function fixture() {
    const state: any = {
        memberRole: 'owner',
        task: {
            id: 753, project_id: 10, week_package_id: 38, channel_id: 139,
            type: 'growth_ops:manual_handoff', layer: 'growth_ops', title: 'Legacy Dzen article', brief: 'Brief',
            draft_text: 'Published body\nbyte-for-byte', source_refs: [{ ref: 'source-a' }],
            content_revision: 1, accepted_revision: null, text_state: 'draft', status: 'published',
            visual_placement: null, publication_mode: 'manual_handoff', published_link: PUBLIC_URL,
            cta: null, schedule_at: new Date('2026-08-15T09:00:00Z'), publish_at: new Date('2026-08-15T09:00:00Z'),
            assets: { account_ref: 'analystcraft_growth', action: { id: 'dzen-manual', channel: 'growth_ops', account_ref: 'analystcraft_growth', action_type: 'manual_handoff', content_files: [{ role: 'post_body', url_ref: 'body' }] } },
            quality_report: { publication_outcome: 'published', handoff_bundle: { mode: 'manual', account: { ref: 'analystcraft_growth', details: { platform: 'growth_ops' } }, task: { id: 'dzen-manual', channel: 'growth_ops', action_type: 'manual_handoff', placement: 'feed' }, publication: { body: 'Published body\nbyte-for-byte' }, placement_contract: { placement: 'feed' }, transport: { materialization: 'feed_post' } } },
            metrics: { account_ref: 'analystcraft_growth', publication_outcome: 'published' }
        },
        channels: [
            { id: 139, project_id: 10, name: 'analystcraft_growth', type: 'growth_ops', is_active: true, config: {} },
            { id: 116, project_id: 10, name: 'analystcraft_dzen', type: 'dzen', is_active: true, config: {} }
        ],
        fact: {
            id: 175, project_id: 10, content_item_id: 753, channel_id: 139, artifact_kind: 'post', outcome: 'published',
            published_at: new Date('2026-08-17T15:46:19.152Z'), public_url: PUBLIC_URL, provider_object_id: null,
            confirmation_mode: 'manual', evidence_type: 'public_url', evidence_ref: PUBLIC_URL, target_url: null,
            utm_status: 'not_applicable', confirmed_by: 'user:2', confirmed_at: new Date('2026-08-17T15:46:19.281Z')
        },
        snapshots: [
            { id: 349, project_id: 10, content_item_id: 753, channel_id: 139, checkpoint: 't24h', scheduled_for: new Date('2026-08-18T15:46:19.152Z'), captured_at: null, collection_mode: 'manual', source: 'manual', collection_status: 'pending', metrics: { schema_version: 1, values: {} }, evidence_ref: null, error_code: null, error_message: null, late: false, window_start: null, window_end: null, idempotency_key: null },
            { id: 350, project_id: 10, content_item_id: 753, channel_id: 139, checkpoint: 't7d', scheduled_for: new Date('2026-08-24T15:46:19.152Z'), captured_at: null, collection_mode: 'manual', source: 'manual', collection_status: 'pending', metrics: { schema_version: 1, values: {} }, evidence_ref: null, error_code: null, error_message: null, late: false, window_start: null, window_end: null, idempotency_key: null }
        ],
        events: [] as any[], deliveries: [] as any[], outbox: [] as any[], failSnapshotId: null as number | null
    };

    const db: any = {
        projectMember: { findUnique: async () => ({ role: state.memberRole }) },
        socialChannel: { findFirst: async ({ where }: any) => structuredClone(state.channels.find((entry: any) => entry.id === where.id && entry.project_id === where.project_id)) },
        contentItem: {
            findFirst: async ({ where }: any) => {
                if (state.task.id !== where.id || state.task.project_id !== where.project_id) return null;
                return structuredClone({ ...state.task, channel: state.channels.find((entry: any) => entry.id === state.task.channel_id), publication_fact: state.fact, metric_snapshots: state.snapshots });
            },
            updateMany: async ({ where, data }: any) => {
                if (state.task.id !== where.id || state.task.project_id !== where.project_id || state.task.channel_id !== where.channel_id) return { count: 0 };
                Object.assign(state.task, structuredClone(data));
                return { count: 1 };
            }
        },
        publicationFact: {
            updateMany: async ({ where, data }: any) => {
                if (state.fact.id !== where.id || state.fact.project_id !== where.project_id || state.fact.content_item_id !== where.content_item_id || state.fact.channel_id !== where.channel_id || state.fact.public_url !== where.public_url) return { count: 0 };
                Object.assign(state.fact, structuredClone(data));
                return { count: 1 };
            }
        },
        metricSnapshot: {
            updateMany: async ({ where, data }: any) => {
                if (state.failSnapshotId === where.id) return { count: 0 };
                const row = state.snapshots.find((entry: any) => entry.id === where.id && entry.project_id === where.project_id && entry.content_item_id === where.content_item_id && entry.channel_id === where.channel_id);
                if (!row) return { count: 0 };
                Object.assign(row, structuredClone(data));
                return { count: 1 };
            }
        },
        workflowEvent: {
            findFirst: async ({ where }: any) => structuredClone(state.events.find((event: any) => event.project_id === where.project_id && event.actor_id === where.actor_id && event.command === where.command && event.idempotency_key === where.idempotency_key) || null),
            create: async ({ data }: any) => {
                const event = { id: state.events.length + 1000, ...structuredClone(data) };
                state.events.push(event);
                return structuredClone(event);
            }
        },
        $queryRaw: async () => [],
        $transaction: async (callback: (tx: any) => Promise<any>) => {
            const before = structuredClone(state);
            try { return await callback(db); }
            catch (error) { Object.keys(state).forEach((key) => delete state[key]); Object.assign(state, before); throw error; }
        }
    };
    return { state, db, service: new PublishedChannelRepairService(db) };
}

const guards = {
    projectId: 10, actorId: 'user:2', taskId: 753, expectedCurrentChannelId: 139, targetChannelId: 116,
    expectedPublicationFactId: 175, expectedPublicUrl: PUBLIC_URL,
    expectedSnapshots: [{ id: 349, channelId: 139 }, { id: 350, channelId: 139 }]
};

test('preview returns the exact bounded Dzen diff without writes', async () => {
    const { state, service } = fixture();
    const before = structuredClone(state);
    const preview = await service.preview(guards);

    assert.equal(preview.dry_run, true);
    assert.equal(preview.target_contract.content_type, 'zen_article');
    assert.equal(preview.target_contract.layer, 'dzen');
    assert.equal(preview.target_contract.placement, 'article_cover');
    assert.deepEqual(preview.affected_ids, { task_id: 753, publication_fact_id: 175, metric_snapshot_ids: [349, 350] });
    assert.deepEqual(preview.changes.filter((entry: any) => entry.path === 'channel_id').map((entry: any) => [entry.entity, entry.from, entry.to]), [
        ['content_item', 139, 116], ['publication_fact', 139, 116], ['metric_snapshot:349', 139, 116], ['metric_snapshot:350', 139, 116]
    ]);
    assert.match(preview.preview_hash, /^[a-f0-9]{64}$/);
    assert.deepEqual(state, before);
});

test('apply is atomic, audited, preserves published identity and replays idempotently', async () => {
    const { state, service } = fixture();
    const protectedTask = structuredClone({ draft_text: state.task.draft_text, source_refs: state.task.source_refs, content_revision: state.task.content_revision, accepted_revision: state.task.accepted_revision, text_state: state.task.text_state, title: state.task.title, brief: state.task.brief, cta: state.task.cta, schedule_at: state.task.schedule_at, publish_at: state.task.publish_at, week_package_id: state.task.week_package_id, publication_mode: state.task.publication_mode, published_link: state.task.published_link });
    const protectedFact = structuredClone({ artifact_kind: state.fact.artifact_kind, outcome: state.fact.outcome, published_at: state.fact.published_at, public_url: state.fact.public_url, provider_object_id: state.fact.provider_object_id, confirmation_mode: state.fact.confirmation_mode, evidence_type: state.fact.evidence_type, evidence_ref: state.fact.evidence_ref, target_url: state.fact.target_url, utm_status: state.fact.utm_status, confirmed_by: state.fact.confirmed_by, confirmed_at: state.fact.confirmed_at });
    const protectedSnapshots = structuredClone(state.snapshots.map(({ channel_id: _channel, ...entry }: any) => entry));
    const preview = await service.preview(guards);
    const params = { ...guards, previewHash: preview.preview_hash, reason: 'Restore published Dzen channel binding', idempotencyKey: 'repair-753-dzen-v1' };

    const applied = await service.apply(params);
    assert.equal(applied.replayed, false);
    assert.equal(state.task.channel_id, 116);
    assert.equal(state.task.type, 'zen_article');
    assert.equal(state.task.layer, 'dzen');
    assert.equal(state.task.visual_placement, 'article_cover');
    assert.equal(state.task.assets.action.action_type, 'dzen_article:publish');
    assert.equal(state.task.quality_report.handoff_bundle.account.ref, 'analystcraft_dzen');
    assert.equal(state.fact.channel_id, 116);
    assert.deepEqual(state.snapshots.map((entry: any) => [entry.id, entry.channel_id]), [[349, 116], [350, 116]]);
    assert.deepEqual({ draft_text: state.task.draft_text, source_refs: state.task.source_refs, content_revision: state.task.content_revision, accepted_revision: state.task.accepted_revision, text_state: state.task.text_state, title: state.task.title, brief: state.task.brief, cta: state.task.cta, schedule_at: state.task.schedule_at, publish_at: state.task.publish_at, week_package_id: state.task.week_package_id, publication_mode: state.task.publication_mode, published_link: state.task.published_link }, protectedTask);
    assert.deepEqual({ artifact_kind: state.fact.artifact_kind, outcome: state.fact.outcome, published_at: state.fact.published_at, public_url: state.fact.public_url, provider_object_id: state.fact.provider_object_id, confirmation_mode: state.fact.confirmation_mode, evidence_type: state.fact.evidence_type, evidence_ref: state.fact.evidence_ref, target_url: state.fact.target_url, utm_status: state.fact.utm_status, confirmed_by: state.fact.confirmed_by, confirmed_at: state.fact.confirmed_at }, protectedFact);
    assert.deepEqual(state.snapshots.map(({ channel_id: _channel, ...entry }: any) => entry), protectedSnapshots);
    assert.equal(state.events.length, 1);
    assert.equal(state.events[0].before_state.reason, params.reason);
    assert.deepEqual(state.deliveries, []);
    assert.deepEqual(state.outbox, []);

    const replay = await service.apply(params);
    assert.equal(replay.replayed, true);
    assert.equal(replay.audit_id, applied.audit_id);
    assert.equal(state.events.length, 1);
    assert.equal(state.snapshots.length, 2);
    assert.equal(applied.authoritative_readback.dzen_metric_collection_eligible, true);
    assert.deepEqual(applied.authoritative_readback.metric_snapshots.map((entry: any) => entry.id), [349, 350]);

    await assert.rejects(service.apply({ ...params, reason: 'Different repair under the same key' }), /IDEMPOTENCY_KEY_CONFLICT/);
    assert.equal(state.events.length, 1);
});

test('wrong expected state aborts with zero writes', async () => {
    const mutations = [
        { expectedCurrentChannelId: 138 },
        { expectedPublicationFactId: 174 },
        { expectedPublicUrl: 'https://dzen.ru/a/wrong' },
        { expectedSnapshots: [{ id: 349, channelId: 139 }, { id: 351, channelId: 139 }] }
    ];
    for (const mutation of mutations) {
        const { state, service } = fixture();
        const before = structuredClone(state);
        await assert.rejects(service.preview({ ...guards, ...mutation } as any));
        assert.deepEqual(state, before);
    }
});

test('apply with a wrong guard aborts with zero writes', async () => {
    const { state, service } = fixture();
    const before = structuredClone(state);
    await assert.rejects(service.apply({
        ...guards,
        expectedPublicationFactId: 174,
        previewHash: '0'.repeat(64),
        reason: 'Repair',
        idempotencyKey: 'wrong-fact-guard'
    }), /PUBLICATION_FACT_CONFLICT/);
    assert.deepEqual(state, before);
});

test('stale preview hash rolls back every write', async () => {
    const { state, service } = fixture();
    const before = structuredClone(state);
    await assert.rejects(service.apply({ ...guards, previewHash: '0'.repeat(64), reason: 'Repair', idempotencyKey: 'stale-preview' }), /PREVIEW_CONFLICT/);
    assert.deepEqual(state, before);
});

test('a late snapshot conflict rolls back prior task and fact writes', async () => {
    const { state, service } = fixture();
    const preview = await service.preview(guards);
    state.failSnapshotId = 350;
    const before = structuredClone(state);
    await assert.rejects(service.apply({ ...guards, previewHash: preview.preview_hash, reason: 'Repair', idempotencyKey: 'late-conflict' }), /METRIC_SNAPSHOT_CONFLICT/);
    assert.deepEqual(state, before);
});

test('preview requires an owner and an active Dzen target', async () => {
    const denied = fixture();
    denied.state.memberRole = 'editor';
    await assert.rejects(denied.service.preview(guards), /Owner access required/);

    const inactive = fixture();
    inactive.state.channels.find((entry: any) => entry.id === 116).is_active = false;
    await assert.rejects(inactive.service.preview(guards), /ACTIVE_DZEN_TARGET_REQUIRED/);

    const wrongType = fixture();
    wrongType.state.channels.find((entry: any) => entry.id === 116).type = 'vk';
    await assert.rejects(wrongType.service.preview(guards), /ACTIVE_DZEN_TARGET_REQUIRED/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { DzenTaskPublicationService } from '../services/dzen_task_publication.service';

const bodySha = '84f8f3ea79c4f252216e7568aa12a84eff08f685f33d4da360b94c8d8073e0fa';
const assetSha = '8cbe7cecab92124712292d4d2b6723cee113d6dadec6d0a3ac6d952aeec925ba';
const incidentKey = 'dzen-1036-publish-20261008T113000Z' as const;
const title = '65% решений автоматизировано. Почему этого мало для оценки системы';
type Publication = { title: string | null; public_url: string | null; provider_object_id: string | null;
    published_at: string | null; state?: 'published' | 'draft' | 'unknown' };

function harness(publications: Publication[], complete = true) {
    const task: any = { id: 1036, project_id: 10, channel_id: 116,
        channel: { id: 116, type: 'dzen', is_active: true,
            config: { channel_id: 'analystcraft_dzen', cookies: 'fixture-session' } },
        status: 'publishing', publication_mode: 'owner_released', content_revision: 2,
        accepted_revision: 2, text_state: 'accepted', handoff_state: 'ready',
        draft_text: `${title}\n\nAccepted body`, title: 'W41 allocation #16 — Dzen',
        visual_state: 'APPROVED', visual_placement: 'article_cover', visual_decision_version: 1,
        selected_asset_id: 122, selected_asset: { id: 122, decision_id: 253, status: 'approved',
            content_revision: 2, file_url: 'https://cdn.test/122.png',
            provenance: { planner_storage: { sha256: assetSha } } },
        schedule_at: new Date('2026-10-08T11:30:00.000Z'),
        publish_at: new Date('2026-10-08T11:30:00.000Z'), publication_fact: null,
        published_link: null, quality_report: { publication_task_delivery: {
            state: 'provider_result_uncertain', failed_at: '2026-10-08T13:02:59.072Z',
            channel_type: 'dzen', retry_via_api: false, idempotency_key: incidentKey
        } } };
    const audit: any[] = [];
    let reads = 0;
    let factCalls = 0;
    const db: any = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        contentItem: { findFirst: async () => task },
        artDirectionDecision: { findFirst: async () => ({ id: 253, decision_version: 1 }) },
        workflowEvent: {
            findUnique: async () => null,
            findFirst: async ({ where }: any) => where.command === 'ba_publish_dzen_task1036_claim'
                ? { id: 2597, actor_id: 'system:planner-mcp:dzen-task1036', command: where.command,
                    idempotency_key: incidentKey, before_state: { status: 'ready_for_execution' },
                    after_state: { status: 'publishing', channel_id: 116 } }
                : null,
            create: async ({ data }: any) => { audit.push(data); return data; }
        },
        metricSnapshot: { findMany: async () => [{ id: 879, checkpoint: 't24h', collection_status: 'pending' },
            { id: 880, checkpoint: 't7d', collection_status: 'pending' }] },
        $transaction: async (run: any) => run(db)
    };
    const service = new DzenTaskPublicationService({
        db, hashBody: () => bodySha,
        dzen: {
            publishPost: async () => { throw new Error('provider write forbidden'); },
            testConnection: async () => { throw new Error('test connection forbidden'); },
            readStudioPublications: async () => {
                reads += 1;
                return { authenticated: true, editor_available: true, editor_url: 'https://dzen.ru/studio',
                    publications_payload_received: true, title_readback_complete: complete,
                    publication_timestamp_readback_complete: complete, state_readback_complete: complete,
                    coverage_complete: complete, publications, checked_at: '2026-10-11T22:00:00.000Z' };
            }
        },
        facts: { record: async () => { factCalls += 1; return { publication_fact: { id: 451 },
            created_checkpoints: 2 }; } }
    });
    const args = { projectId: 10 as const, taskId: 1036 as const, actorId: 'user:2',
        expectedAttemptEventId: 2597 as const, expectedAttemptIdempotencyKey: incidentKey,
        idempotencyKey: 'dzen-1036-reconcile-20261011-v1', confirm: false };
    return { service, args, audit, get reads() { return reads; }, get factCalls() { return factCalls; } };
}

test('Dzen1036 complete exact public readback previews and confirms without any provider write', async () => {
    const publication: Publication = { title, state: 'published', public_url: 'https://dzen.ru/a/exact1036',
        provider_object_id: 'exact1036', published_at: '2026-10-08T13:01:00.000Z' };
    const h = harness([publication]);
    const preview = await h.service.reconcileTask1036(h.args);
    assert.equal(preview.classification, 'exact_published_match');
    assert.equal(preview.provider_writes, 0);
    assert.equal(h.factCalls, 0);
    const applied = await h.service.reconcileTask1036({ ...h.args, confirm: true });
    assert.equal(applied.publication_fact_id, 451);
    assert.deepEqual(applied.checkpoint_ids, [879, 880]);
    assert.equal(h.factCalls, 1);
    assert.equal(h.reads, 2);
});

test('Dzen1036 exact draft, confirmed absence, and incomplete inventory never record a fact', async () => {
    const draft = harness([{ title, state: 'draft', public_url: null,
        provider_object_id: 'draft1036', published_at: null }]);
    assert.equal((await draft.service.reconcileTask1036(draft.args)).classification, 'exact_draft_match');
    const absent = harness([]);
    assert.equal((await absent.service.reconcileTask1036(absent.args)).classification, 'confirmed_absent');
    const incomplete = harness([], false);
    assert.equal((await incomplete.service.reconcileTask1036(incomplete.args)).classification, 'inconclusive');
    assert.equal(draft.factCalls + absent.factCalls + incomplete.factCalls, 0);
});

test('Dzen1036 rejects non-canonical provider identity and never records a fact', async () => {
    const h = harness([{ title, state: 'published', public_url: 'https://dzen.ru/a/exact1036',
        provider_object_id: 'different-object', published_at: '2026-10-08T13:01:00.000Z' }]);
    assert.equal((await h.service.reconcileTask1036(h.args)).classification, 'inconclusive');
    await assert.rejects(h.service.reconcileTask1036({ ...h.args, confirm: true }), /EXACT_PUBLIC_MATCH_REQUIRED/);
    assert.equal(h.factCalls, 0);
});

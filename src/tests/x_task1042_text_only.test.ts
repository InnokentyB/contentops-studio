import test from 'node:test';
import assert from 'node:assert/strict';
import {
    prepareXTask1042TextOnlyPackage,
    recoverXTask1042OverlengthRelease,
    releaseXTask1042TextOnly
} from '../services/x_task1042_text_only.service';

const BODY_SHA = '7d780809a7f6b73494b590cd1fa11ac2f6383fdc0a952f1aca5d09cb4e676c70';
const RELEASE_BODY = `One useful vacancy decision is activation, not retention.\n\nThe real test is a second vacancy or another reason to return. A second click only proves activity.\n\nWe haven't verified second-use events, cohorts, or a baseline.\n\nWhat counts as a genuine second occasion for you?`;
const RELEASE_BODY_SHA = '8ee902b053a244255c4c3d728947e755069e5aca8503f3ed201476bf67f0cfc3';
const MANIFEST = 'sha256:b7ac79159c876d35acd1adfe43d0fb9817b5909bd13371c326d72450b1b6a272';

function fixture() {
    const task = { id: 1042, project_id: 10, channel_id: 164, week_package_id: null, item_key: 'publication-1042',
        channel: { id: 164, type: 'x', name: 'innokenty_x', is_active: true }, status: 'ready_for_execution',
        handoff_state: 'ready', publication_mode: 'approval_required', content_revision: 4, accepted_revision: 4,
        text_state: 'accepted', draft_text: 'same accepted body', visual_state: 'APPROVED', visual_placement: 'feed',
        visual_decision_version: 2, selected_asset_id: 126, selected_asset: { id: 126, status: 'approved', content_revision: 4,
            provenance: { planner_storage: { sha256: 'e5643499e5a16777fd272dbc510946d0c8d55accf6301d9a3b330206f1d7c92b' } } },
        schedule_at: new Date('2026-10-09T15:00:00.000Z'), publish_at: new Date('2026-10-09T15:00:00.000Z'),
        publication_fact: null, published_link: null, telegram_message_id: null, quality_report: {} };
    let event: { before_state: unknown; after_state: unknown; command?: string } | null = null;
    let browserCreates = 0;
    let artInvalidations = 0;
    const review = { id: 1420, kind: 'content_review', state: 'completed', assignee_role: 'content_reviewer',
        input_context_version: 4, result_version: 4, result_payload: { body: task.draft_text, content_revision: 4 } };
    const art = { id: 1800, kind: 'art_direction', state: 'completed', input_context_version: 5, result_version: 3 };
    const tx = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: { findFirst: async () => event, create: async ({ data }: { data: typeof event }) => { event = data; } },
        contentItem: { findFirst: async () => task,
            updateMany: async ({ data }: { data: Partial<typeof task> }) => { Object.assign(task, data); return { count: 1 }; } },
        deliveryAttempt: { findFirst: async () => null },
        approvalDecision: { findUnique: async () => ({ id: 900, decision: 'approved', result_version: 5 }) },
        workItem: { findFirst: async ({ where }: { where: { id?: number; kind?: string } }) => {
            if (where.id === 1420) return review;
            if (where.id === 1800) return art;
            return null;
        }, update: async ({ data }: { data: Partial<typeof review> }) => Object.assign(review, data),
        create: async () => { browserCreates += 1; return { id: 1900 }; } },
        artDirectionDecision: { findFirst: async () => ({ id: 300, decision: 'NO_VISUAL_NEEDED', decision_version: 3,
            source_content_revision: 5, channel: 'x', placement: 'feed', status: 'active' }) }
    };
    const database = { $transaction: async (run: (client: typeof tx) => unknown) => run(tx) };
    const dependencies = { database: database as never, manifestLoader: async () => ({ checksum: MANIFEST }) as never,
        hashBody: (body: string) => body === RELEASE_BODY ? RELEASE_BODY_SHA : BODY_SHA,
        now: () => new Date('2026-10-10T10:00:00Z'),
        markRevisionStale: async () => {
            artInvalidations += 1;
            Object.assign(task, { text_state: 'draft', accepted_revision: null, visual_state: 'STALE',
                handoff_state: 'blocked', selected_asset_id: null, selected_asset: null });
        } };
    return { task, review, tx, dependencies, get browserCreates() { return browserCreates; },
        get artInvalidations() { return artInvalidations; } };
}

test('prepare command creates rev5 review package with identical text through canonical visual invalidation', async () => {
    const f = fixture();
    const result = await prepareXTask1042TextOnlyPackage({ projectId: 10, taskId: 1042, actorId: 'user:2',
        expectedManifestChecksum: MANIFEST, approvalReference: 'owner text-only scope 2026-10-10',
        idempotencyKey: 'prepare-x1042-text-only-r5' }, f.dependencies);
    assert.equal(result.content_revision, 5);
    assert.equal(result.body_sha256, BODY_SHA);
    assert.equal(f.task.draft_text, 'same accepted body');
    assert.equal(f.task.selected_asset_id, null);
    assert.equal(f.review.state, 'available');
    assert.equal(f.review.input_context_version, 5);
    assert.equal(f.review.result_version, 4);
    assert.equal(f.artInvalidations, 1);
    assert.equal(f.task.publication_fact, null);
});

test('text-only release requires accepted rev6, approved review6 and active NO_VISUAL decision4', async () => {
    const f = fixture();
    Object.assign(f.task, { draft_text: RELEASE_BODY, content_revision: 6, accepted_revision: 6, text_state: 'accepted',
        visual_state: 'NO_VISUAL_NEEDED', visual_decision_version: 4, selected_asset_id: null,
        selected_asset: null, handoff_state: 'ready' });
    Object.assign(f.review, { state: 'completed', input_context_version: 6, result_version: 6 });
    f.tx.workItem.findFirst = async ({ where }: { where: { id?: number; kind?: string } }) => {
        if (where.id === 1420) return f.review;
        if (where.id === 1800) return { id: 1800, kind: 'art_direction', state: 'completed',
            input_context_version: 6, result_version: 4 };
        return null;
    };
    f.tx.artDirectionDecision.findFirst = async () => ({ id: 300, decision: 'NO_VISUAL_NEEDED', decision_version: 4,
        source_content_revision: 6, channel: 'x', placement: 'feed', status: 'active' });
    const args = { projectId: 10, taskId: 1042, actorId: 'user:2', expectedManifestChecksum: MANIFEST,
        expectedReviewWorkItemId: 1420, expectedArtWorkItemId: 1800, expectedDecisionId: 300,
        expectedWeightedLength: 273, expectedLimit: 280,
        approvalReference: 'owner text-only release 2026-10-10', idempotencyKey: 'release-x1042-text-only-r6' } as const;
    const first = await releaseXTask1042TextOnly(args, f.dependencies);
    const replay = await releaseXTask1042TextOnly(args, f.dependencies);
    assert.equal(first.selected_asset_id, null);
    assert.equal(first.asset_sha256, null);
    assert.equal(first.content_revision, 6);
    assert.equal(first.body_sha256, RELEASE_BODY_SHA);
    assert.equal(first.browser_work_item_id, 1900);
    assert.equal(replay.replayed, true);
    assert.equal(f.browserCreates, 1);
    assert.equal(f.task.publication_fact, null);
});

test('old image-bound rev4 and overlength rev5 cannot use the revision6 release', async () => {
    const f = fixture();
    f.task.publication_fact = { id: 1 } as never;
    await assert.rejects(prepareXTask1042TextOnlyPackage({ projectId: 10, taskId: 1042, actorId: 'user:2',
        expectedManifestChecksum: MANIFEST, approvalReference: 'owner text-only scope 2026-10-10', idempotencyKey: 'blocked' },
    f.dependencies), /GUARD_FAILED/);
    f.task.publication_fact = null;
    await assert.rejects(releaseXTask1042TextOnly({ projectId: 10, taskId: 1042, actorId: 'user:2',
        expectedManifestChecksum: MANIFEST, expectedReviewWorkItemId: 1420, expectedArtWorkItemId: 1800,
        expectedDecisionId: 300, expectedWeightedLength: 273, expectedLimit: 280,
        approvalReference: 'owner text-only release 2026-10-10', idempotencyKey: 'blocked-release' },
    f.dependencies), /GUARD_FAILED/);
    Object.assign(f.task, { content_revision: 5, accepted_revision: 5, draft_text: 'x'.repeat(365),
        text_state: 'accepted', visual_state: 'NO_VISUAL_NEEDED', visual_decision_version: 3,
        selected_asset_id: null, selected_asset: null, handoff_state: 'ready' });
    await assert.rejects(releaseXTask1042TextOnly({ projectId: 10, taskId: 1042, actorId: 'user:2',
        expectedManifestChecksum: MANIFEST, expectedReviewWorkItemId: 1420, expectedArtWorkItemId: 1800,
        expectedDecisionId: 300, expectedWeightedLength: 273, expectedLimit: 280,
        approvalReference: 'owner text-only release 2026-10-10',
        idempotencyKey: 'blocked-overlength-release' }, f.dependencies), /GUARD_FAILED|X_TEXT_LIMIT_EXCEEDED/);
    assert.equal(f.browserCreates, 0);
});

test('audited recovery cancels only claimed rev5 browser work and reopens Writer without editing copy', async () => {
    const task = { id: 1042, project_id: 10, channel_id: 164, status: 'browser_required',
        publication_mode: 'browser_required', content_revision: 5, accepted_revision: 5, text_state: 'accepted',
        draft_text: 'x'.repeat(365), selected_asset_id: null, visual_state: 'NO_VISUAL_NEEDED',
        selected_asset: null, visual_placement: 'feed', visual_decision_version: 3, handoff_state: 'ready',
        schedule_at: new Date('2026-10-09T15:00:00.000Z'),
        publish_at: new Date('2026-10-09T15:00:00.000Z'), published_link: null, telegram_message_id: null,
        publication_fact: null, quality_report: { owner_release: { content_revision: 5, body_sha256: BODY_SHA } },
        channel: { id: 164, type: 'x', name: 'innokenty_x', is_active: true } };
    const browser = { id: 1689, kind: 'browser_publish', state: 'claimed', input_context_version: 5,
        dedupe_key: 'browser_publish:1042:r5:text-only', lease_actor_id: 'user:2', lease_token: 'lease' };
    const writer = { id: 1308, kind: 'content_write', state: 'completed', input_context_version: 1,
        result_version: 1 };
    const review = { id: 1420, kind: 'content_review', state: 'completed', input_context_version: 5, result_version: 5 };
    const art = { id: 1688, kind: 'art_direction', state: 'completed', input_context_version: 5, result_version: 3 };
    let event: Record<string, unknown> | null = null;
    const tx = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: { findFirst: async () => event, create: async ({ data }: { data: Record<string, unknown> }) => { event = data; } },
        deliveryAttempt: { findFirst: async () => null },
        approvalDecision: { findUnique: async () => ({ id: 312, decision: 'approved', result_version: 5 }) },
        contentItem: { findFirst: async () => task, updateMany: async ({ data }: { data: Record<string, unknown> }) => {
            Object.assign(task, data); return { count: 1 };
        } },
        workItem: {
            findFirst: async ({ where }: { where: { id?: number } }) => where.id === 1689 ? browser
                : where.id === 1308 ? writer : where.id === 1420 ? review : where.id === 1688 ? art : null,
            updateMany: async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
                Object.assign(where.id === 1689 ? browser : writer, data); return { count: 1 };
            }
        },
        artDirectionDecision: { findFirst: async () => ({ id: 271, work_item_id: 1688,
            decision: 'NO_VISUAL_NEEDED', decision_version: 3, source_content_revision: 5, status: 'active' }),
        updateMany: async () => ({ count: 1 }) }
    };
    const database = { $transaction: async (run: (client: typeof tx) => unknown) => run(tx) };
    const result = await recoverXTask1042OverlengthRelease({ projectId: 10, taskId: 1042, actorId: 'user:2',
        expectedManifestChecksum: MANIFEST, expectedBrowserWorkItemId: 1689, expectedWriterWorkItemId: 1308,
        expectedReviewWorkItemId: 1420, expectedArtWorkItemId: 1688, expectedDecisionId: 271,
        expectedWeightedLength: 365, expectedLimit: 280,
        approvalReference: 'X composer rejected rev5 as 85 characters over limit',
        idempotencyKey: 'recover-x1042-overlength-r5' }, {
        database: database as never, manifestLoader: async () => ({ checksum: MANIFEST }) as never,
        hashBody: () => BODY_SHA, now: () => new Date('2026-10-10T10:00:00Z'),
        markRevisionStale: async () => Object.assign(task, { accepted_revision: null, text_state: 'draft',
            visual_state: 'STALE', handoff_state: 'blocked', selected_asset_id: null })
    });
    assert.equal(result.target_content_revision, 6);
    assert.equal(result.writer_work_item_id, 1308);
    assert.equal(browser.state, 'cancelled');
    assert.equal(writer.state, 'available');
    assert.equal(task.draft_text, 'x'.repeat(365));
    assert.equal(task.publication_mode, 'approval_required');
    assert.equal(task.accepted_revision, null);
});

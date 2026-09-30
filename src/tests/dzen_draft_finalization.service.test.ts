import assert from 'node:assert/strict';
import test from 'node:test';
import { DzenDraftFinalizationService } from '../services/dzen_draft_finalization.service';
import { isToolAllowedForProfile } from '../mcp/capabilities';

const BODY_SHA = '62af2b8e32d3aabb2b3d6f7029ee2b7ec64a7f9329eef01e52d6c4591e7eb150';
const ASSET_SHA = '6061c4e53210de240d840e85e39990d7af5e496544f0cda4dd010048d33ebe25';
const DRAFT_URL = 'https://dzen.ru/profile/editor/id/6a8029aba055ec36033bf81c/6abbee89489dee41e9c88d2c/edit';
const PUBLIC_URL = 'https://dzen.ru/a/finalized-task992';

function harness(options: {
    published?: boolean;
    bodyHash?: string;
    matchedDrafts?: number;
    missingPermalink?: boolean;
    revision?: number;
} = {}) {
    const task: any = {
        id: 992,
        project_id: 10,
        channel_id: 116,
        channel: {
            type: 'dzen',
            config: { channel_id: '6a8029aba055ec36033bf81c', cookies: 'session=test' }
        },
        title: 'Почему набор AI-чатов не становится операционной системой',
        draft_text: 'exact accepted body',
        content_revision: options.revision ?? 3,
        accepted_revision: options.revision ?? 3,
        text_state: 'accepted',
        visual_placement: 'article_cover',
        visual_state: 'APPROVED',
        visual_decision_version: 3,
        selected_asset_id: 97,
        selected_asset: {
            id: 97,
            content_revision: 3,
            status: 'approved',
            file_url: `https://assets.test/${ASSET_SHA}.png`,
            provenance: { sha256: ASSET_SHA }
        },
        handoff_state: 'ready',
        status: options.published ? 'published' : 'awaiting_manual_publication',
        publication_mode: 'owner_released',
        published_link: options.published ? PUBLIC_URL : null,
        publication_fact: options.published ? {
            id: 401,
            outcome: 'published',
            public_url: PUBLIC_URL,
            provider_object_id: 'finalized-task992'
        } : null,
        quality_report: {}
    };
    const events: any[] = [];
    let finalizeCalls = 0;
    let publishPostCalls = 0;
    let factCalls = 0;
    const db: any = {
        contentItem: {
            findFirst: async () => task,
            updateMany: async ({ where, data }: any) => {
                if (where.status && task.status !== where.status) return { count: 0 };
                Object.assign(task, data);
                return { count: 1 };
            },
            update: async ({ data }: any) => { Object.assign(task, data); return task; },
            findUniqueOrThrow: async () => task
        },
        workflowEvent: {
            findUnique: async ({ where }: any) => events.find((event) =>
                event.data.command === where.project_id_actor_id_command_idempotency_key.command
                && event.data.idempotency_key === where.project_id_actor_id_command_idempotency_key.idempotency_key
            )?.data || null,
            findFirst: async ({ where }: any) => where.command === 'ba_release_approved_dzen_task992'
                ? { after_state: {
                    task_id: 992,
                    channel_id: 116,
                    content_revision: 3,
                    accepted_revision: 3,
                    body_sha256: BODY_SHA,
                    visual_decision_id: 186,
                    selected_asset_id: 97,
                    asset_sha256: ASSET_SHA,
                    publication_mode: 'owner_released'
                } }
                : null,
            create: async (event: any) => { events.push(event); return event; }
        },
        artDirectionDecision: {
            findFirst: async () => ({
                id: 186,
                decision_version: 3,
                source_content_revision: 3,
                status: 'active'
            })
        },
        $transaction: async (fn: any) => fn(db)
    };
    const service = new DzenDraftFinalizationService({
        db,
        hashBody: () => options.bodyHash ?? BODY_SHA,
        dzen: {
            publishPost: async () => { publishPostCalls += 1; return 'https://dzen.ru/a/forbidden-new-draft'; },
            finalizeExistingDraft: async (_config: any, input: any) => {
                finalizeCalls += 1;
                const matchedDraftCount = options.matchedDrafts ?? 1;
                if (matchedDraftCount !== 1) {
                    throw new Error(`[DZEN_DRAFT_MATCH_COUNT_MISMATCH] Expected one matching draft; found ${matchedDraftCount}`);
                }
                return input.dryRun
                    ? { mode: 'dry_run', matched_draft_count: 1, draft_id: '6abbee89489dee41e9c88d2c', canonical_body_sha256: BODY_SHA }
                    : { mode: 'published', matched_draft_count: 1, draft_id: '6abbee89489dee41e9c88d2c', published_url: options.missingPermalink ? null : PUBLIC_URL };
            }
        },
        facts: {
            record: async () => {
                factCalls += 1;
                task.publication_fact = { id: 402, outcome: 'published', public_url: PUBLIC_URL, provider_object_id: 'finalized-task992' };
                task.published_link = PUBLIC_URL;
                return { publication_fact: task.publication_fact, created_checkpoints: 2, created_metric_work_items: 2 };
            }
        }
    });
    return {
        service,
        task,
        events,
        get finalizeCalls() { return finalizeCalls; },
        get publishPostCalls() { return publishPostCalls; },
        get factCalls() { return factCalls; }
    };
}

test('finalizes the one exact #992 draft without invoking the new-composer publisher', async () => {
    assert.equal(isToolAllowedForProfile('publisher', 'ba_finalize_dzen_task992_draft'), true);
    assert.equal(isToolAllowedForProfile('planner', 'ba_finalize_dzen_task992_draft'), false);
    const h = harness();
    const dry = await h.service.finalizeTask992({
        projectId: 10,
        taskId: 992,
        draftEditorUrl: DRAFT_URL,
        dryRun: true
    });
    assert.equal(dry.route_executable, true);
    assert.equal(dry.matched_draft_count, 1);

    const result = await h.service.finalizeTask992({
        projectId: 10,
        taskId: 992,
        draftEditorUrl: DRAFT_URL,
        idempotencyKey: 'finalize-992'
    });
    assert.equal(result.published_link, PUBLIC_URL);
    assert.equal(result.publication_fact_id, 402);
    assert.equal(result.created_checkpoints, 2);
    assert.equal(result.created_metric_work_items, 2);
    assert.equal(h.publishPostCalls, 0);
    assert.equal(h.finalizeCalls, 3); // dry-run, live preflight, live finalize
    assert.equal(h.factCalls, 1);
    assert.equal(h.task.status, 'published');
});

test('replays an already-published canonical fact without touching the provider', async () => {
    const h = harness({ published: true });
    const result = await h.service.finalizeTask992({
        projectId: 10,
        taskId: 992,
        draftEditorUrl: DRAFT_URL,
        idempotencyKey: 'already-published'
    });
    assert.equal(result.replayed, true);
    assert.equal(result.published_link, PUBLIC_URL);
    assert.equal(h.finalizeCalls, 0);
    assert.equal(h.publishPostCalls, 0);
});

test('refuses duplicate or missing draft matches before any final action', async () => {
    for (const matchedDrafts of [0, 2]) {
        const h = harness({ matchedDrafts });
        await assert.rejects(h.service.finalizeTask992({
            projectId: 10,
            taskId: 992,
            draftEditorUrl: DRAFT_URL,
            idempotencyKey: `matches-${matchedDrafts}`
        }), /DZEN_DRAFT_MATCH_COUNT_MISMATCH/);
        assert.equal(h.task.status, 'awaiting_manual_publication');
        assert.equal(h.factCalls, 0);
        assert.equal(h.publishPostCalls, 0);
    }
});

test('refuses stale revision or body hash before invoking the draft adapter', async () => {
    for (const options of [{ revision: 2 }, { bodyHash: '0'.repeat(64) }]) {
        const h = harness(options);
        await assert.rejects(h.service.finalizeTask992({
            projectId: 10,
            taskId: 992,
            draftEditorUrl: DRAFT_URL,
            idempotencyKey: 'stale-input'
        }), /DZEN_992_FINALIZE_GUARD_FAILED/);
        assert.equal(h.finalizeCalls, 0);
        assert.equal(h.publishPostCalls, 0);
    }
});

test('freezes an unverified provider result and never records a publication fact', async () => {
    const h = harness({ missingPermalink: true });
    await assert.rejects(h.service.finalizeTask992({
        projectId: 10,
        taskId: 992,
        draftEditorUrl: DRAFT_URL,
        idempotencyKey: 'missing-permalink'
    }), /DZEN_DRAFT_FINALIZATION_UNCERTAIN/);
    assert.equal(h.task.status, 'publishing');
    assert.equal(h.task.quality_report.publication_task_delivery.retry_via_api, false);
    assert.equal(h.factCalls, 0);
    assert.equal(h.publishPostCalls, 0);
});

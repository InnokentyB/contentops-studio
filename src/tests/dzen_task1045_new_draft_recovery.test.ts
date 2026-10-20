import test from 'node:test';
import assert from 'node:assert/strict';
import {
    authorizeDzenTask1045NewDraftRetry,
    DZEN1045_AUTHORIZATION_KEY,
    DZEN1045_NEW_DRAFT_COMMAND,
    DZEN1045_RECOVERY_MANIFEST
} from '../services/dzen_task1045_new_draft_recovery.service';
import { DZEN1045 } from '../services/dzen_task1045_resume_contract';

const args = {
    projectId: 10, taskId: 1045, actorId: 'user:2', expectedManifestChecksum: DZEN1045_RECOVERY_MANIFEST,
    expectedChannelId: 116, expectedContentRevision: 4, expectedAcceptedRevision: 4,
    expectedBodySha256: DZEN1045.bodySha, expectedDecisionId: 267, expectedSelectedAssetId: 129,
    expectedAssetSha256: DZEN1045.assetSha, expectedPlacement: 'article_cover',
    expectedOriginalAttemptKey: DZEN1045.originalKey,
    authorizedPublishIdempotencyKey: DZEN1045.retryKey,
    ownerAuthorizationReference: 'source thread 01a0c579 owner confirmation on 2026-10-10',
    idempotencyKey: DZEN1045_AUTHORIZATION_KEY
} as const;

function fixture(options: { draftObjects?: number; publishedMatches?: number } = {}) {
    const priorDelivery = { state: 'provider_result_uncertain', idempotency_key: DZEN1045.originalKey,
        retry_via_api: false, error: 'unknown provider result' };
    const task: any = { id: 1045, project_id: 10, channel_id: 116,
        channel: { type: 'dzen', is_active: true, config: { cookies: 'session=x', channel_id: DZEN1045.publisherId } },
        content_revision: 4, accepted_revision: 4, text_state: 'accepted', draft_text: 'accepted body',
        visual_placement: 'article_cover', visual_state: 'APPROVED', visual_decision_version: 1,
        selected_asset_id: 129, selected_asset: { id: 129, status: 'approved', content_revision: 4,
            file_url: 'https://cdn.test/129.png', provenance: { planner_storage: { sha256: DZEN1045.assetSha } } },
        schedule_at: new Date('2026-10-10T10:00:00.000Z'), publication_mode: 'owner_released',
        status: 'publishing', publication_fact: null, published_link: null,
        quality_report: { publication_task_delivery: priorDelivery } };
    const events: any[] = [];
    let inspections = 0;
    const database: any = {
        $queryRaw: async () => [{id:task.id}],
        publicationFact: {findFirst:async()=>task.publication_fact},
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        contentItem: { findFirst: async () => task, updateMany: async ({ data }: any) => {
            Object.assign(task, data); return { count: 1 };
        } },
        artDirectionDecision: { findFirst: async () => ({ id: 267 }) },
        workflowEvent: {
            findUnique: async ({ where }: any) => {
                const key = where.project_id_actor_id_command_idempotency_key;
                return events.find(event => event.data.command === key.command
                    && event.data.idempotency_key === key.idempotency_key) || null;
            },
            findFirst: async ({ where }: any) => where.command === 'ba_publish_dzen_task1045_claim'
                ? { id: 2045, after_state: { status: 'publishing', channel_id: 116 } } : null,
            create: async ({ data }: any) => { const event = { id: 3000 + events.length, data,
                before_state: data.before_state, after_state: data.after_state }; events.push(event); return event; }
        },
        $transaction: async (run: any) => run(database)
    };
    const deps: any = { database, manifestLoader: async () => ({ checksum: DZEN1045_RECOVERY_MANIFEST }),
        hashBody: () => DZEN1045.bodySha, now: () => new Date('2026-10-10T22:30:00.000Z'),
        dzen: { inspectTask1045Absence: async () => (inspections += 1, {
            authenticated: true, publishedCoverageComplete: true, draftCoverageComplete: true,
            publishedObjects: 12, draftObjects: options.draftObjects || 0,
            relevantPublishedTitleMatches: options.publishedMatches || 0, relevantDraftTitleMatches: 0,
            relevantTitles: [DZEN1045.title, DZEN1045.publicTitle], checkedAt: '2026-10-10T22:29:00.000Z'
        }) } };
    return { task, events, deps, get inspections() { return inspections; } };
}

test('owner authorization atomically records exhaustive absence and enables one exact new-draft key without sending', async () => {
    const h = fixture();
    const result = await authorizeDzenTask1045NewDraftRetry(args, h.deps);
    assert.equal(result.provider_send_performed, false);
    assert.equal(result.authorized_idempotency_key, DZEN1045.retryKey);
    assert.equal(h.task.status, 'ready_for_execution');
    assert.deepEqual(h.task.quality_report.publication_task_delivery.prior_incident,
        { state: 'provider_result_uncertain', idempotency_key: DZEN1045.originalKey,
            retry_via_api: false, error: 'unknown provider result' });
    assert.equal(h.events.filter(event => event.data.command === DZEN1045_NEW_DRAFT_COMMAND).length, 1);
    assert.equal(h.events.filter(event => event.data.command === 'ba_release_approved_dzen_task').length, 1);
    const replay = await authorizeDzenTask1045NewDraftRetry(args, h.deps);
    assert.equal(replay.replayed, true);
    assert.equal(h.inspections, 1);
});

test('a remaining draft or relevant published title aborts with zero writes', async () => {
    for (const options of [{ draftObjects: 1 }, { publishedMatches: 1 }]) {
        const h = fixture(options);
        await assert.rejects(authorizeDzenTask1045NewDraftRetry(args, h.deps), /DZEN1045_ABSENCE_NOT_PROVEN/);
        assert.equal(h.task.status, 'publishing');
        assert.equal(h.events.length, 0);
    }
});

test('stale exact guards abort before inspection and mutation', async () => {
    const h = fixture();
    await assert.rejects(authorizeDzenTask1045NewDraftRetry({ ...args,
        expectedSelectedAssetId: 128 as 129 }, h.deps), /DZEN1045_NEW_DRAFT_GUARD_FAILED/);
    assert.equal(h.inspections, 0);
    assert.equal(h.events.length, 0);
});

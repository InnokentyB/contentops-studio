import assert from 'node:assert/strict';
import test from 'node:test';
import { DzenTaskPublicationService } from '../services/dzen_task_publication.service';
import { isToolAllowedForProfile } from '../mcp/capabilities';
import { isTaskNativeDzenPublication } from '../mcp/tools/task_publication_tools';

const hash = '78081837cecace18c91c01af0253b21ca502e611b63a016f9d9035567587dfd3';
const hash962 = '15c9b4a2e874439c4952900002ae5677fc3a6b6e8794dd34a0a4ae5f03dba798';
const hash992 = '62af2b8e32d3aabb2b3d6f7029ee2b7ec64a7f9329eef01e52d6c4591e7eb150';
const hash1031 = '077cee100dbd11648050febacc6f071a407998753855ae3b2e82551175990b6e';
const hash999 = '78ffd5316ab3ffc4679d67788ec57f39558760917e70522d8ba0647a1f68b130';
const asset999Hash = 'd06c7ce1c3533dc1db76799bda8eff1395a9dde4e05684c593b16bd064479b1c';
const asset992Hash = 'b5eafee417e13a2f1becc14a4b66629f31f11cfd68b4b887a240d3e552b3b944';
const hash1045 = '37b70ca472211b64104168115d435d4c2d4ef6c9fb3c61c9041ec0f9336242f1';
const asset1045Hash = '6b02adaf5ce140d986d85de5cf910a33bed36f65384e166031712fd66a06d76b';
const actual992IncidentKey = 'dzen-992-owner-confirmed-retry-20261001-v2';
const schedule = new Date('2026-09-22T11:00:00.000Z');

function harness(options: { released?: boolean; verified?: boolean; providerError?: boolean;
    taskId?: 958 | 962 | 992 | 999 | 1031 | 1045; studioTitles?: string[]; studioTitleReadbackComplete?: boolean;
    studioPublishedAt?: string | null } = {}) {
    const taskId = options.taskId || 958;
    const taskHash = taskId === 1045 ? hash1045 : taskId === 999 ? hash999 : taskId === 1031 ? hash1031 : taskId === 992 ? hash992 : taskId === 962 ? hash962 : hash;
    const decisionId = taskId === 1045 ? 267 : taskId === 999 ? 241 : taskId === 1031 ? 214 : taskId === 992 ? 186 : taskId === 962 ? 146 : 147;
    const revision = taskId === 1045 ? 4 : taskId === 999 ? 2 : taskId === 1031 || taskId === 992 ? 3 : 1;
    const hasVisual = taskId === 992 || taskId === 999 || taskId === 1045;
    const assetId = taskId === 1045 ? 129 : taskId === 999 ? 114 : 102;
    const assetHash = taskId === 1045 ? asset1045Hash : taskId === 999 ? asset999Hash : asset992Hash;
    const verifyCommand = `ba_verify_dzen_task${taskId}_connector`;
    const task: any = {
        id: taskId, project_id: 10, channel_id: 116,
        channel: { type: 'dzen', config: { channel_id: 'dzen-channel', cookies: 'session=test',
            capability_flags: { api_publish: false } } },
        content_revision: revision, accepted_revision: revision, text_state: 'accepted',
        draft_text: taskId === 1031 ? 'Как проверить новый формат урока без маркетинговой самооценки\n\nexact accepted body' : 'exact accepted body',
        title: taskId === 999 ? 'Почему метрика без контекста ведёт к ложному решению' : taskId === 1031 ? 'W41 allocation #6 — Dzen' : 'Exact accepted title',
        visual_placement: hasVisual || taskId === 1031 ? 'article_cover' : 'feed',
        visual_state: hasVisual ? 'APPROVED' : 'NO_VISUAL_NEEDED', selected_asset_id: hasVisual ? assetId : null,
        selected_asset: hasVisual ? { id: assetId, status: 'approved', content_revision: revision,
            file_url: 'https://cdn.example.test/task992.png',
            provenance: { planner_storage: { sha256: assetHash } } } : null,
        visual_decision_version: taskId === 1045 ? 1 : 2, handoff_state: 'ready',
        status: 'ready_for_execution', publication_mode: 'owner_released',
        schedule_at: taskId === 992 ? null : schedule, published_link: null, publication_fact: null,
        quality_report: {}
    };
    const events: any[] = [];
    let providerCalls = 0;
    let factCalls = 0;
    const db = {
        contentItem: {
            findFirst: async () => task,
            updateMany: async ({ where, data }: any) => {
                if (task.status !== where.status || task.publication_mode !== where.publication_mode) return { count: 0 };
                Object.assign(task, data);
                return { count: 1 };
            },
            update: async ({ data }: any) => { Object.assign(task, data); return task; }
        },
        workflowEvent: {
            findUnique: async ({ where }: any) => events.find(event => event.data.command === where.project_id_actor_id_command_idempotency_key.command
                && event.data.idempotency_key === where.project_id_actor_id_command_idempotency_key.idempotency_key)
                ? { after_state: events.find(event => event.data.command === where.project_id_actor_id_command_idempotency_key.command
                    && event.data.idempotency_key === where.project_id_actor_id_command_idempotency_key.idempotency_key).data.after_state } : null,
            findFirst: async ({ where }: { where: { command: string; idempotency_key?: string } }) => {
                const stored = [...events].reverse().find(event => event.data.command === where.command
                    && (where.idempotency_key === undefined || event.data.idempotency_key === where.idempotency_key));
                if (stored) return { ...stored.data, after_state: stored.data.after_state };
                if (where.command === 'ba_publish_dzen_task992_claim') return where.idempotency_key === actual992IncidentKey
                    ? { id: 1901, actor_id: 'system:planner-mcp:dzen-task992',
                        after_state: { status: 'publishing', channel_id: 116 } }
                    : null;
                return where.command === verifyCommand
                ? options.verified === false ? null : { after_state: {
                    task_id: taskId, channel_id: 116, body_sha256: taskHash,
                    ...(hasVisual ? { selected_asset_id: assetId, asset_sha256: assetHash } : {}),
                    authenticated: true, editor_available: true, checked_at: new Date().toISOString()
                } }
                : options.released === false ? null : { after_state: {
                    task_id: taskId, channel_id: 116, content_revision: revision, accepted_revision: revision,
                    body_sha256: taskHash, visual_decision_id: decisionId,
                    ...(hasVisual ? { selected_asset_id: assetId, asset_sha256: assetHash } : {}),
                    schedule_at: taskId === 992 ? null : schedule.toISOString(), publication_mode: 'owner_released'
                } };
            },
            create: async (event: any) => { events.push(event); return event; }
        },
        artDirectionDecision: { findFirst: async ({ where }: any) => {
            assert.equal(where.channel, hasVisual || taskId === 1031 ? 'dzen' : 'analystcraft_dzen');
            return { id: decisionId, decision_version: taskId === 1045 ? 1 : 2 };
        } },
        projectMember: { findFirst: async () => ({ user_id: 2 }), findUnique: async () => ({ role: 'owner' }) },
        project: { findUnique: async () => ({ slug: 'analystcraft-2' }) },
        $transaction: async (fn: any) => fn(db)
    };
    const service = new DzenTaskPublicationService({
        db, hashBody: () => taskHash,
        dzen: { publishPost: async () => {
            providerCalls += 1;
            if (options.providerError) throw new Error('unknown provider result');
            return `https://dzen.ru/b/approved-task${taskId}`;
        }, testConnection: async () => ({ authenticated: true, editor_available: true,
            editor_url: 'https://dzen.ru/profile/editor/id/dzen-channel' }),
        readStudioPublications: async () => ({
            authenticated: true, editor_available: true,
            editor_url: 'https://dzen.ru/profile/editor/id/dzen-channel/publications',
            publications_payload_received: true,
            title_readback_complete: options.studioTitleReadbackComplete !== false,
            publication_timestamp_readback_complete: options.studioPublishedAt !== null,
            publications: (options.studioTitles || []).map((title, index) => ({
                provider_object_id: `publication-${index + 1}`,
                title,
                public_url: `https://dzen.ru/a/publication-${index + 1}`,
                published_at: options.studioPublishedAt === null
                    ? null
                    : options.studioPublishedAt || '2026-10-01T18:21:55.809Z'
            })),
            checked_at: new Date().toISOString()
        }) },
        facts: { record: async () => { factCalls += 1; return {}; } }
    });
    return { service, task, events, get providerCalls() { return providerCalls; }, get factCalls() { return factCalls; } };
}

test('Dzen release tool is publisher-only and delivery rejects missing owner proof', async () => {
    assert.equal(isToolAllowedForProfile('publisher', 'ba_release_approved_dzen_task958'), true);
    assert.equal(isToolAllowedForProfile('planner', 'ba_release_approved_dzen_task958'), false);
    const h = harness({ released: false });
    await assert.rejects(h.service.execute({ projectId: 10, taskId: 958, dryRun: true }), /OWNER_RELEASE_PROOF_MISMATCH/);
    assert.equal(h.providerCalls, 0);
});

test('Dzen #999 routes only its approved revision-bound cover through generic owner proof', async () => {
    assert.equal(isTaskNativeDzenPublication(10, 999), true);
    assert.equal(isTaskNativeDzenPublication(11, 999), false);
    assert.equal(isToolAllowedForProfile('publisher', 'ba_verify_dzen_task999_connector'), true);
    const h = harness({ taskId: 999 });
    const dry = await h.service.execute({ projectId: 10, taskId: 999, dryRun: true });
    assert.equal(dry.route_executable, true);
    assert.equal(dry.payload_preview.selected_asset_id, 114);
    assert.equal(dry.payload_preview.accepted_revision, 2);
    assert.equal(dry.payload_preview.title, 'Почему метрика без контекста ведёт к ложному решению');
    h.task.title = 'Wrong operational title';
    await assert.rejects(h.service.execute({ projectId: 10, taskId: 999, dryRun: true }), /DZEN_PUBLIC_TITLE_CHANGED/);
    h.task.title = 'Почему метрика без контекста ведёт к ложному решению';
    h.task.selected_asset.provenance.planner_storage.sha256 = 'changed';
    await assert.rejects(h.service.execute({ projectId: 10, taskId: 999, dryRun: true }), /OWNER_RELEASE_PROOF_MISMATCH/);
    assert.equal(h.providerCalls, 0);
});

test('Dzen #1045 exact release proof and connector proof gate the same article-cover payload', async () => {
    assert.equal(isTaskNativeDzenPublication(10, 1045), true);
    assert.equal(isToolAllowedForProfile('publisher', 'ba_release_dzen_task1045'), true);
    assert.equal(isToolAllowedForProfile('publisher', 'ba_verify_dzen_task1045_connector'), true);
    const h = harness({ taskId: 1045 });
    const dry = await h.service.execute({ projectId: 10, taskId: 1045, dryRun: true });
    assert.equal(dry.route_executable, true);
    assert.equal(dry.payload_preview.accepted_revision, 4);
    assert.equal(dry.payload_preview.selected_asset_id, 129);
    assert.equal(dry.payload_preview.image_url, 'https://cdn.example.test/task992.png');
    assert.equal(h.providerCalls, 0);
});

test('Dzen #992 dry-run binds accepted revision, approved remote visual and article payload', async () => {
    assert.equal(isToolAllowedForProfile('publisher', 'ba_verify_dzen_task992_connector'), true);
    const h = harness({ taskId: 992 });
    const dry = await h.service.execute({ projectId: 10, taskId: 992, dryRun: true });
    assert.equal(dry.route_executable, true);
    assert.deepEqual(dry.payload_preview, {
        text: 'exact accepted body', title: 'Exact accepted title', has_image: true,
        image_url: 'https://cdn.example.test/task992.png', publication_type: 'article',
        channel_id: 116, accepted_revision: 3, visual_decision_id: 186, selected_asset_id: 102
    });
});

test('Dzen #992 refuses a stale accepted visual without provider call', async () => {
    const h = harness({ taskId: 992 });
    h.task.selected_asset.content_revision = 2;
    await assert.rejects(h.service.execute({ projectId: 10, taskId: 992, dryRun: true }), /OWNER_RELEASE_PROOF_MISMATCH/);
    assert.equal(h.providerCalls, 0);
});

test('Dzen #962 uses its own release and connector proofs before task-native delivery', async () => {
    assert.equal(isToolAllowedForProfile('publisher', 'ba_release_approved_dzen_task962'), true);
    assert.equal(isToolAllowedForProfile('publisher', 'ba_verify_dzen_task962_connector'), true);
    const h = harness({ taskId: 962 });
    const dry = await h.service.execute({ projectId: 10, taskId: 962, dryRun: true });
    assert.equal(dry.route_executable, true);
    assert.equal(dry.payload_preview.visual_decision_id, 146);
    const sent = await h.service.execute({ projectId: 10, taskId: 962, idempotencyKey: 'task962-dzen-live-20260924' });
    assert.equal(sent.published_link, 'https://dzen.ru/b/approved-task962');
    assert.equal(sent.visual_decision_id, 146);
    assert.equal(h.providerCalls, 1);
    assert.equal(h.factCalls, 1);
});

test('Dzen #1031 uses the generic owner release proof and current article-cover no-visual decision', async () => {
    assert.equal(isTaskNativeDzenPublication(10, 1031), true);
    assert.equal(isTaskNativeDzenPublication(10, 953), false);
    assert.equal(isTaskNativeDzenPublication(11, 1031), false);
    assert.equal(isToolAllowedForProfile('publisher', 'ba_verify_dzen_task1031_connector'), true);
    const h = harness({ taskId: 1031 });
    const dry = await h.service.execute({ projectId: 10, taskId: 1031, dryRun: true });
    assert.equal(dry.route_executable, true);
    assert.equal(dry.payload_preview.visual_decision_id, 214);
    assert.equal(dry.payload_preview.publication_type, 'article');
    assert.equal(dry.payload_preview.has_image, false);
    assert.equal(dry.payload_preview.title, 'Как проверить новый формат урока без маркетинговой самооценки');
});

test('Dzen unverified connector blocks dry-run and live without provider call', async () => {
    const h = harness({ verified: false });
    const dry = await h.service.execute({ projectId: 10, taskId: 958, dryRun: true });
    assert.equal(dry.route_executable, false);
    assert.equal(dry.route_blocker, 'DZEN_CONNECTOR_NOT_READY');
    await assert.rejects(h.service.execute({ projectId: 10, taskId: 958, idempotencyKey: 'send958' }), /DZEN_CONNECTOR_NOT_READY/);
    assert.equal(h.providerCalls, 0);
    assert.equal(h.task.status, 'ready_for_execution');
});

test('Dzen connector probe requires owner and records task-scoped session proof', async () => {
    assert.equal(isToolAllowedForProfile('publisher', 'ba_verify_dzen_task958_connector'), true);
    const h = harness({ verified: false });
    const proof = await h.service.verifyConnector({ projectId: 10, taskId: 958,
        actorId: 'user:2', idempotencyKey: 'verify958' });
    assert.equal(proof.authenticated, true);
    assert.equal(proof.body_sha256, hash);
    assert.equal(h.events.length, 1);
    await assert.rejects(h.service.verifyConnector({ projectId: 10, taskId: 959,
        actorId: 'user:2', idempotencyKey: 'bad' }), /SCOPE_MISMATCH/);
});

test('Dzen exact released task sends once and replays confirmed result', async () => {
    const h = harness();
    const dry = await h.service.execute({ projectId: 10, taskId: 958, dryRun: true });
    assert.equal(dry.route_executable, true);
    const sent = await h.service.execute({ projectId: 10, taskId: 958, idempotencyKey: 'send958' });
    assert.equal(sent.published_link, 'https://dzen.ru/b/approved-task958');
    assert.equal(h.providerCalls, 1);
    assert.equal(h.factCalls, 1);
    assert.equal(h.task.status, 'published');
    const replay = await h.service.execute({ projectId: 10, taskId: 958, idempotencyKey: 'send958' });
    assert.equal(replay.replayed, true);
    assert.equal(h.providerCalls, 1);
});

test('uncertain Dzen result freezes task and never retries provider', async () => {
    const h = harness({ providerError: true });
    await assert.rejects(h.service.execute({ projectId: 10, taskId: 958, idempotencyKey: 'send958' }), /DZEN_PUBLICATION_UNCERTAIN/);
    assert.equal(h.task.status, 'publishing');
    assert.equal(h.task.quality_report.publication_task_delivery.retry_via_api, false);
    await assert.rejects(h.service.execute({ projectId: 10, taskId: 958, idempotencyKey: 'send958' }), /DZEN_PUBLICATION_STATE_CHANGED/);
    assert.equal(h.providerCalls, 1);
    assert.equal(h.factCalls, 0);
});

test('actual durable frozen #992 incident key allows read-only Studio probe without state change or send', async () => {
    const h = harness({ taskId: 992, studioTitles: [], verified: false });
    h.task.status = 'publishing';
    h.task.quality_report = { publication_task_delivery: {
        state: 'provider_result_uncertain', idempotency_key: actual992IncidentKey,
        retry_via_api: false, error: 'detached frame'
    } };

    const result = await h.service.verifyConnector({ projectId: 10, taskId: 992,
        actorId: 'user:2', idempotencyKey: 'dzen-992-frozen-readback-v1' });

    assert.equal(result.reconciliation.classification, 'not_confirmed');
    assert.equal(result.reconciliation.exact_title_matches, 0);
    assert.equal(h.task.status, 'publishing');
    assert.equal(h.providerCalls, 0);
    assert.equal(h.events.some(event => event.data.command === 'reconcile_dzen_task992_uncertain_attempt'), true);
});

test('corrected asset selection may leave #992 ready but still permits only read-only frozen reconciliation', async () => {
    const h = harness({ taskId: 992, studioTitles: [], verified: false });
    h.task.status = 'ready_for_execution';
    h.task.quality_report = { publication_task_delivery: {
        state: 'provider_result_uncertain', idempotency_key: actual992IncidentKey,
        retry_via_api: false, error: 'DZEN_PUBLICATION_REJECTED: Не удалось загрузить изображение'
    } };

    const result = await h.service.verifyConnector({ projectId: 10, taskId: 992,
        actorId: 'user:2', idempotencyKey: 'dzen-992-corrected-asset-readback-v1' });
    assert.equal(result.reconciliation.classification, 'not_confirmed');
    assert.equal(result.reconciliation.selected_asset_id, 102);
    assert.equal(result.reconciliation.asset_sha256, asset992Hash);

    await assert.rejects(h.service.execute({ projectId: 10, taskId: 992,
        idempotencyKey: 'must-not-send-before-recovery' }), /DZEN_RETRY_NOT_AUTHORIZED/);
    assert.equal(h.providerCalls, 0);
    assert.equal(h.task.status, 'ready_for_execution');
});

test('former #992 asset97 binding is rejected by connector without provider interaction', async () => {
    const h = harness({ taskId: 992, studioTitles: [], verified: false });
    h.task.selected_asset_id = 97;
    h.task.selected_asset.id = 97;
    h.task.selected_asset.provenance.planner_storage.sha256 =
        '6061c4e53210de240d840e85e39990d7af5e496544f0cda4dd010048d33ebe25';
    h.task.quality_report = { publication_task_delivery: {
        state: 'provider_result_uncertain', idempotency_key: actual992IncidentKey,
        retry_via_api: false
    } };

    await assert.rejects(h.service.verifyConnector({ projectId: 10, taskId: 992,
        actorId: 'user:2', idempotencyKey: 'dzen-992-stale-asset97-readback-v1'
    }), /DZEN_CONNECTOR_PREFLIGHT_GUARD_FAILED/);
    assert.equal(h.providerCalls, 0);
    assert.equal(h.events.length, 0);
});

test('frozen #992 remains forbidden for live send after a successful read-only probe', async () => {
    const h = harness({ taskId: 992, studioTitles: [], verified: false });
    h.task.status = 'publishing';
    h.task.quality_report = { publication_task_delivery: {
        state: 'provider_result_uncertain', idempotency_key: actual992IncidentKey,
        retry_via_api: false
    } };
    await h.service.verifyConnector({ projectId: 10, taskId: 992,
        actorId: 'user:2', idempotencyKey: 'dzen-992-frozen-readback-v1' });

    await assert.rejects(h.service.execute({ projectId: 10, taskId: 992,
        idempotencyKey: 'forbidden-retry' }), /DZEN_PUBLICATION_STATE_CHANGED/);
    assert.equal(h.providerCalls, 0);
    assert.equal(h.task.status, 'publishing');
});

test('exact-title Studio match keeps frozen #992 blocked from recovery and retry', async () => {
    const h = harness({ taskId: 992, studioTitles: ['Exact accepted title'], verified: false });
    h.task.status = 'publishing';
    h.task.quality_report = { publication_task_delivery: {
        state: 'provider_result_uncertain', idempotency_key: actual992IncidentKey,
        retry_via_api: false
    } };
    const result = await h.service.verifyConnector({ projectId: 10, taskId: 992,
        actorId: 'user:2', idempotencyKey: 'dzen-992-exact-match-v1' });
    assert.equal(result.reconciliation.classification, 'exact_match_found');
    assert.equal(result.reconciliation.exact_title_matches, 1);
    assert.deepEqual(result.reconciliation.matching_published_at, ['2026-10-01T18:21:55.809Z']);

    await assert.rejects(h.service.confirmAbsentAndAuthorizeRetry({
        projectId: 10, taskId: 992, actorId: 'user:2',
        idempotencyKey: 'must-not-recover', resendIdempotencyKey: 'must-not-send',
        evidenceReference: 'authenticated-studio:exact-match-found'
    }), /DZEN_992_PROVIDER_READBACK_REQUIRED/);
    assert.equal(h.task.status, 'publishing');
    assert.equal(h.providerCalls, 0);
});

test('exact-title Studio match without provider publishTime fails closed and never records reconciliation', async () => {
    const h = harness({ taskId: 992, studioTitles: ['Exact accepted title'],
        studioPublishedAt: null, verified: false });
    h.task.status = 'ready_for_execution';
    h.task.quality_report = { publication_task_delivery: {
        state: 'provider_result_uncertain', idempotency_key: actual992IncidentKey,
        retry_via_api: false
    } };

    await assert.rejects(h.service.verifyConnector({ projectId: 10, taskId: 992,
        actorId: 'user:2', idempotencyKey: 'dzen-992-match-without-publish-time-v1'
    }), /DZEN_992_PROVIDER_TIMESTAMP_READBACK_INCOMPLETE/);
    assert.equal(h.events.length, 0);
    assert.equal(h.providerCalls, 0);
});

test('stale hard-coded #992 incident key is rejected when it has no matching durable claim', async () => {
    const h = harness({ taskId: 992, studioTitles: [], verified: false });
    h.task.status = 'publishing';
    h.task.quality_report = { publication_task_delivery: {
        state: 'provider_result_uncertain', idempotency_key: 'dzen-992-prod-20261001-rev3-v1',
        retry_via_api: false
    } };

    await assert.rejects(h.service.verifyConnector({ projectId: 10, taskId: 992,
        actorId: 'user:2', idempotencyKey: 'dzen-992-stale-key-probe-v1'
    }), /DZEN_CONNECTOR_PREFLIGHT_GUARD_FAILED/);
    assert.equal(h.events.length, 0);
    assert.equal(h.providerCalls, 0);
});

test('incomplete Studio title readback cannot be used as zero-match recovery evidence', async () => {
    const h = harness({ taskId: 992, studioTitles: [], studioTitleReadbackComplete: false, verified: false });
    h.task.status = 'publishing';
    h.task.quality_report = { publication_task_delivery: {
        state: 'provider_result_uncertain', idempotency_key: actual992IncidentKey,
        retry_via_api: false
    } };

    await assert.rejects(h.service.verifyConnector({ projectId: 10, taskId: 992,
        actorId: 'user:2', idempotencyKey: 'dzen-992-incomplete-readback-v1'
    }), /DZEN_992_PROVIDER_READBACK_INCOMPLETE/);
    assert.equal(h.events.length, 0);
    assert.equal(h.task.status, 'publishing');
    assert.equal(h.providerCalls, 0);
});

test('zero-match recovery rejects prior-key reuse and authorizes exactly one new #992 claim', async () => {
    const h = harness({ taskId: 992, studioTitles: [], verified: false });
    h.task.status = 'publishing';
    h.task.quality_report = { publication_task_delivery: {
        state: 'provider_result_uncertain', idempotency_key: actual992IncidentKey,
        retry_via_api: false, error: 'detached frame'
    } };

    const readback = await h.service.verifyConnector({ projectId: 10, taskId: 992,
        actorId: 'user:2', idempotencyKey: 'dzen-992-zero-match-v1' });
    assert.equal(readback.reconciliation.exact_title_matches, 0);

    await assert.rejects(h.service.confirmAbsentAndAuthorizeRetry({
        projectId: 10, taskId: 992, actorId: 'user:2',
        idempotencyKey: 'dzen-992-owner-mismatched-key-v1',
        resendIdempotencyKey: actual992IncidentKey,
        evidenceReference: 'owner_provider_readback:2026-10-01:no-new-material'
    }), /DZEN_992_RETRY_KEY_MUST_BE_NEW/);
    assert.equal(h.task.status, 'publishing');

    const recovery = await h.service.confirmAbsentAndAuthorizeRetry({
        projectId: 10, taskId: 992, actorId: 'user:2',
        idempotencyKey: 'dzen-992-owner-absent-20261001-v1',
        resendIdempotencyKey: 'dzen-992-owner-confirmed-retry-20261001-v3',
        evidenceReference: 'owner_provider_readback:2026-10-01:no-new-material'
    });

    assert.equal(recovery.classification, 'confirmed_absent');
    assert.equal(recovery.resend_safe, true);
    assert.equal(h.task.status, 'ready_for_execution');
    assert.equal(h.task.quality_report.publication_task_delivery.authorized_idempotency_key,
        'dzen-992-owner-confirmed-retry-20261001-v3');
    assert.equal(h.events.some(event => event.data.command === 'ba_confirm_dzen_task992_absent_and_authorize_retry'), true);
    const reboundRelease = h.events.find(event => event.data.command === 'ba_release_approved_dzen_task992');
    assert.equal(reboundRelease.data.after_state.selected_asset_id, 102);
    assert.equal(reboundRelease.data.after_state.asset_sha256, asset992Hash);
    await assert.rejects(h.service.execute({ projectId: 10, taskId: 992,
        idempotencyKey: 'another-key' }), /DZEN_RETRY_NOT_AUTHORIZED/);
    assert.equal(h.providerCalls, 0);

    const sent = await h.service.execute({ projectId: 10, taskId: 992,
        idempotencyKey: 'dzen-992-owner-confirmed-retry-20261001-v3' });
    assert.equal(sent.published_link, 'https://dzen.ru/b/approved-task992');
    assert.equal(h.providerCalls, 1);
    assert.equal(h.factCalls, 1);
});

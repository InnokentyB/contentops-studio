import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'crypto';
import { OwnerPublicationControlsService, assertExactC20VisualSet } from '../services/owner_publication_controls.service';
import { isToolAllowedForProfile } from '../mcp/capabilities';

const visualIds = [968, 969, 971, 972, 973, 974];
const schedule = new Date('2026-09-22T09:00:00.000Z');

function visualHarness(options: { owner?: boolean; noVisualId?: number } = {}) {
    const tasks = visualIds.map(id => ({
        id, project_id: 10, channel_id: 111, publication_mode: 'approval_required',
        visual_mode: 'auto_assess', visual_state: id === 968 || id === 969 ? 'BRIEFED' : 'PENDING_ASSESSMENT',
        selected_asset_id: null, handoff_state: 'blocked', publication_fact: null, published_link: null,
        status: id === 968 || id === 969 ? 'approved' : 'planned',
        content_revision: id === 968 || id === 969 ? 1 : 0,
        accepted_revision: id === 968 || id === 969 ? 1 : null,
        schedule_at: schedule, draft_text: null
    }));
    const events: any[] = [];
    const tx = {
        projectMember: { findUnique: async () => ({ role: options.owner === false ? 'member' : 'owner' }) },
        workflowEvent: {
            findFirst: async ({ where }: any) => events.find(event => event.data.command === where.command
                && event.data.idempotency_key === where.idempotency_key)?.data
                ? { before_state: events.find(event => event.data.command === where.command
                    && event.data.idempotency_key === where.idempotency_key).data.before_state,
                    after_state: events.find(event => event.data.command === where.command
                    && event.data.idempotency_key === where.idempotency_key).data.after_state }
                : null,
            create: async (event: any) => { events.push(event); return event; }
        },
        contentItem: {
            findMany: async () => tasks,
            updateMany: async ({ where, data }: any) => {
                const task = tasks.find(item => item.id === where.id);
                if (!task || task.visual_mode !== where.visual_mode || task.status !== where.status) return { count: 0 };
                Object.assign(task, data);
                return { count: 1 };
            }
        },
        artDirectionDecision: { findFirst: async ({ where }: any) => where.content_item_id === options.noVisualId ? { id: 1 } : null }
    };
    const service = new OwnerPublicationControlsService({ $transaction: async (callback: any) => callback(tx) } as any);
    const expected = tasks.map(item => ({ taskId: item.id, expectedContentRevision: item.content_revision,
        expectedAcceptedRevision: item.accepted_revision, expectedStatus: item.status,
        expectedVisualState: item.visual_state, expectedScheduleAt: item.schedule_at.toISOString() }));
    return { tasks, events, service, expected };
}

test('C20 repair is planner-visible but owner-only and requires exact six tasks', () => {
    assert.equal(isToolAllowedForProfile('planner', 'ba_require_c20_publication_visuals'), true);
    assert.equal(isToolAllowedForProfile('strategist', 'ba_require_c20_publication_visuals'), false);
    assert.equal(isToolAllowedForProfile('writer', 'ba_require_c20_publication_visuals'), false);
    assert.throws(() => assertExactC20VisualSet(visualHarness().expected.slice(0, 5)), /C20_TASK_SET_MISMATCH/);
});

test('C20 repair updates only required mode, audits every task, and replays idempotently', async () => {
    const h = visualHarness();
    const before = h.tasks.map(task => ({ ...task }));
    const input = { projectId: 10, actorId: 'user:7', expected: h.expected, idempotencyKey: 'c20-six-visuals' };
    const result = await h.service.requireC20Visuals(input);
    assert.equal(result.changed_count, 6);
    assert.equal(h.events.length, 7);
    for (let i = 0; i < h.tasks.length; i++) {
        assert.deepEqual(h.tasks[i], { ...before[i], visual_mode: 'required' });
    }
    assert.deepEqual(await h.service.requireC20Visuals(input), result);
    assert.equal(h.events.length, 7);
});

test('C20 repair rejects non-owner and NO_VISUAL_NEEDED decision without mutation', async () => {
    for (const options of [{ owner: false }, { noVisualId: 968 }]) {
        const h = visualHarness(options);
        await assert.rejects(h.service.requireC20Visuals({ projectId: 10, actorId: 'user:7',
            expected: h.expected, idempotencyKey: 'c20-blocked' }), /OWNER_REQUIRED|C20_NO_VISUAL_DECISION/);
        assert.equal(h.tasks.every(task => task.visual_mode === 'auto_assess'), true);
        assert.equal(h.events.length, 0);
    }
});

test('task #971 visual repair preserves revision-bound asset and approval gate', async () => {
    assert.equal(isToolAllowedForProfile('planner', 'ba_require_task971_publication_visual'), true);
    assert.equal(isToolAllowedForProfile('strategist', 'ba_require_task971_publication_visual'), false);
    const task: any = {
        id: 971, project_id: 10, channel_id: 111, content_revision: 3,
        accepted_revision: 3, visual_placement: 'feed', visual_mode: 'auto_assess',
        selected_asset_id: 76, selected_asset: { id: 76, status: 'approved', content_revision: 3 },
        publication_mode: 'approval_required', status: 'approved', visual_state: 'APPROVED',
        schedule_at: schedule, publication_fact: null, published_link: null
    };
    const events: any[] = [];
    const tx = {
        project: { findUnique: async () => ({ slug: 'analystcraft-2' }) },
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: { findFirst: async () => null, create: async (args: any) => events.push(args) },
        contentItem: {
            findFirst: async () => task,
            updateMany: async ({ where, data }: any) => {
                if (where.visual_mode !== task.visual_mode || where.selected_asset_id !== task.selected_asset_id) return { count: 0 };
                Object.assign(task, data);
                return { count: 1 };
            }
        }
    };
    const service = new OwnerPublicationControlsService({ $transaction: async (fn: any) => fn(tx) } as any);
    const input = { projectId: 10, actorId: 'user:7', taskId: 971, expectedChannelId: 111,
        expectedContentRevision: 3, expectedAcceptedRevision: 3, expectedSelectedAssetId: 76,
        expectedScheduleAt: schedule.toISOString(), expectedStatus: 'approved',
        expectedVisualState: 'APPROVED', idempotencyKey: '971-visual-rev3' };
    const before = { ...task };
    const result = await service.requireTask971Visual(input);
    assert.equal(result.visual_mode, 'required');
    assert.deepEqual(task, { ...before, visual_mode: 'required' });
    assert.equal(events.length, 1);
    assert.equal(events[0].data.after_state.published, false);
    await assert.rejects(service.requireTask971Visual({ ...input, expectedSelectedAssetId: 77 }), /SCOPE_MISMATCH/);
});

test('task #972 visual repair changes only mode for exact decision and asset', async () => {
    const hash = 'b971d270d3a2deb2d21bbd1cb9e77598340e0426e84c4bf2219ad0a6d926d283';
    const task: any = { id: 972, project_id: 10, channel_id: 111,
        content_revision: 1, accepted_revision: 1, text_state: 'accepted',
        visual_placement: 'feed', visual_mode: 'auto_assess', visual_state: 'APPROVED',
        visual_decision_version: 1, selected_asset_id: 77,
        selected_asset: { id: 77, status: 'approved', content_revision: 1 },
        handoff_state: 'ready', status: 'ready_for_execution', publication_mode: 'approval_required',
        schedule_at: schedule, publication_fact: null, published_link: null, draft_text: 'exact body',
        title: 'old title', brief: 'old brief' };
    const events: any[] = [];
    const tx = {
        project: { findUnique: async () => ({ slug: 'analystcraft-2' }) },
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: { findFirst: async () => null, create: async (e: any) => (events.push(e), e) },
        contentItem: { findFirst: async () => task, updateMany: async ({ where, data }: any) =>
            task.visual_mode === where.visual_mode && task.status === where.status
                ? (Object.assign(task, data), { count: 1 }) : { count: 0 } },
        artDirectionDecision: { findFirst: async ({ where }: any) => {
            assert.equal(where.id, 152); assert.equal(where.decision, 'GENERATE');
            return { id: 152, decision_version: 1 };
        } }
    };
    const service = new OwnerPublicationControlsService({ $transaction: async (fn: any) => fn(tx) } as any, () => hash);
    const before = { ...task };
    const result = await service.requireTask972Visual({ projectId: 10, actorId: 'user:7', taskId: 972,
        expectedChannelId: 111, expectedContentRevision: 1, expectedAcceptedRevision: 1,
        expectedSelectedAssetId: 77, expectedDecisionId: 152,
        expectedScheduleAt: schedule.toISOString(), expectedBodySha256: hash,
        expectedStatus: 'ready_for_execution', idempotencyKey: 'task972-required' });
    assert.equal(result.visual_mode, 'required');
    assert.deepEqual(task, { ...before, visual_mode: 'required' });
    assert.equal(events.length, 1);
    const metadata = await service.repairTask972Metadata({ projectId: 10, actorId: 'user:7', taskId: 972,
        expectedChannelId: 111, expectedContentRevision: 1, expectedAcceptedRevision: 1,
        expectedSelectedAssetId: 77, expectedDecisionId: 152,
        expectedScheduleAt: schedule.toISOString(), expectedBodySha256: hash,
        expectedStatus: 'ready_for_execution', expectedTitle: 'old title', expectedBrief: 'old brief',
        idempotencyKey: 'task972-metadata' });
    assert.equal(metadata.title, '@analysts_thinking 23.09 — 202 Accepted is not done');
    assert.match(metadata.brief, /Synthetic S19 access-transfer/);
    assert.equal(task.draft_text, before.draft_text);
    assert.equal(task.selected_asset_id, 77);
    assert.equal(events.length, 2);
});

test('task #973 visual repair changes only mode for exact decision, asset and accepted body', async () => {
    const hash = '191ba9f5408ce30e9678cbe35ae5dc5b47168ebdd5069221c43f6a217374e65d';
    const task: any = { id: 973, project_id: 10, channel_id: 111,
        content_revision: 1, accepted_revision: 1, text_state: 'accepted',
        visual_placement: 'feed', visual_mode: 'auto_assess', visual_state: 'APPROVED',
        visual_decision_version: 1, selected_asset_id: 80,
        selected_asset: { id: 80, status: 'approved', content_revision: 1 },
        handoff_state: 'ready', status: 'ready_for_execution', publication_mode: 'approval_required',
        schedule_at: schedule, publication_fact: null, published_link: null, draft_text: 'exact body' };
    const events: any[] = [];
    const tx = {
        project: { findUnique: async () => ({ slug: 'analystcraft-2' }) },
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: { findFirst: async () => null, create: async (e: any) => (events.push(e), e) },
        contentItem: { findFirst: async () => task, updateMany: async ({ where, data }: any) =>
            task.visual_mode === where.visual_mode && task.status === where.status
                ? (Object.assign(task, data), { count: 1 }) : { count: 0 } },
        artDirectionDecision: { findFirst: async ({ where }: any) => {
            assert.equal(where.id, 155); assert.equal(where.decision, 'GENERATE');
            return { id: 155, decision_version: 1 };
        } }
    };
    const service = new OwnerPublicationControlsService({ $transaction: async (fn: any) => fn(tx) } as any, () => hash);
    const before = { ...task };
    const result = await service.requireTask973Visual({ projectId: 10, actorId: 'user:7', taskId: 973,
        expectedChannelId: 111, expectedContentRevision: 1, expectedAcceptedRevision: 1,
        expectedSelectedAssetId: 80, expectedDecisionId: 155,
        expectedScheduleAt: schedule.toISOString(), expectedBodySha256: hash,
        expectedStatus: 'ready_for_execution', idempotencyKey: 'task973-required' });
    assert.equal(result.visual_mode, 'required');
    assert.deepEqual(task, { ...before, visual_mode: 'required' });
    assert.equal(events.length, 1);
    assert.equal(events[0].data.after_state.published, false);
    await assert.rejects(service.requireTask973Visual({ projectId: 10, actorId: 'user:7', taskId: 973,
        expectedChannelId: 111, expectedContentRevision: 1, expectedAcceptedRevision: 1,
        expectedSelectedAssetId: 81, expectedDecisionId: 155,
        expectedScheduleAt: schedule.toISOString(), expectedBodySha256: hash,
        expectedStatus: 'ready_for_execution', idempotencyKey: 'wrong-asset' }), /SCOPE_MISMATCH/);
});

function releaseHarness(options: { owner?: boolean; attempt?: boolean; visualState?: string;
    placement?: 'feed' | 'story'; session?: boolean; casConflict?: boolean } = {}) {
    const placement = options.placement || 'feed';
    const task: any = {
        id: placement === 'story' ? 980 : 971, project_id: 10, channel_id: placement === 'story' ? 108 : 111,
        channel: { id: placement === 'story' ? 108 : 111, type: 'telegram', config: {
            capability_flags: { api_publish: placement === 'feed' }, telegram_channel_id: placement === 'story' ? null : '-100123'
        } },
        status: 'ready_for_execution', publication_mode: 'approval_required',
        content_revision: placement === 'story' ? 3 : 2, accepted_revision: placement === 'story' ? 3 : 2, text_state: 'accepted',
        visual_mode: placement === 'story' ? 'auto_assess' : 'required', visual_state: options.visualState || 'APPROVED',
        visual_placement: placement, type: 'publication', selected_asset_id: placement === 'story' ? 87 : 15,
        selected_asset: { id: placement === 'story' ? 87 : 15, status: 'approved', content_revision: placement === 'story' ? 3 : 2,
            file_url: 'https://cdn.example/approved.png' },
        handoff_state: 'ready', schedule_at: schedule,
        draft_text: 'Exact owner-approved copy', publication_fact: null, published_link: null
    };
    const events: any[] = [];
    const tx = {
        projectMember: { findUnique: async () => ({ role: options.owner === false ? 'member' : 'owner' }) },
        workflowEvent: {
            findFirst: async () => null,
            create: async (event: any) => { events.push(event); return event; }
        },
        contentItem: {
            findFirst: async () => task,
            updateMany: async ({ where, data }: any) => {
                assert.equal(where.channel_id, task.channel_id);
                assert.equal(where.content_revision, task.content_revision);
                assert.equal(where.accepted_revision, task.accepted_revision);
                assert.equal(where.selected_asset_id, task.selected_asset_id);
                assert.equal(where.schedule_at.toISOString(), task.schedule_at.toISOString());
                if (options.casConflict || where.publication_mode !== task.publication_mode || where.status !== task.status
                    || where.draft_text !== task.draft_text || where.visual_placement !== task.visual_placement) return { count: 0 };
                Object.assign(task, data);
                return { count: 1 };
            }
        },
        deliveryAttempt: { findFirst: async () => options.attempt ? { id: 1 } : null },
        telegramAccount: { findFirst: async ({ where }: { where: { project_id: number; is_active: boolean } }) => {
            assert.deepEqual(where, { project_id: 10, is_active: true });
            return options.session === false ? null : { id: 5, api_id: 12345,
                api_hash: 'enc:v1:hash', session_string: 'enc:v1:session' };
        } }
    };
    const service = new OwnerPublicationControlsService({ $transaction: async (callback: any) => callback(tx) } as any);
    const input = {
        projectId: 10, actorId: 'user:7', taskId: task.id, expectedChannelId: task.channel_id,
        expectedContentRevision: task.content_revision, expectedAcceptedRevision: task.accepted_revision,
        expectedVisualMode: task.visual_mode, expectedVisualState: task.visual_state,
        expectedPlacement: placement,
        expectedSelectedAssetId: task.selected_asset_id, expectedScheduleAt: schedule.toISOString(),
        expectedBodySha256: createHash('sha256').update(task.draft_text).digest('hex'),
        approvalReference: 'owner-thread:exact-reply-971', idempotencyKey: 'release-971'
    };
    return { task, events, service, input };
}

test('owner release changes only mode, records exact proof, and never sends', async () => {
    assert.equal(isToolAllowedForProfile('publisher', 'ba_release_approved_telegram_task'), true);
    assert.equal(isToolAllowedForProfile('planner', 'ba_release_approved_telegram_task'), false);
    const h = releaseHarness();
    const before = { ...h.task };
    const result = await h.service.releaseTelegramTask(h.input);
    assert.equal(result.publication_mode, 'owner_released');
    assert.equal(result.published, false);
    assert.deepEqual(h.task, { ...before, publication_mode: 'owner_released' });
    assert.equal(h.events.length, 1);
    assert.equal(h.events[0].data.before_state.approval_reference, h.input.approvalReference);
});

test('owner release accepts canonical personal Telegram story without a channel target', async () => {
    const h = releaseHarness({ placement: 'story' });
    const result = await h.service.releaseTelegramTask(h.input);
    assert.equal(result.publication_mode, 'owner_released');
    assert.equal(result.placement, 'story');
    assert.equal(result.delivery_target, 'personal_profile');
    assert.equal(result.selected_asset_id, 87);
    assert.equal(result.published, false);
});

test('Story release requires approved media and exact body CAS; feed retains channel routing', async () => {
    const stale = releaseHarness({ placement: 'story', casConflict: true });
    await assert.rejects(stale.service.releaseTelegramTask(stale.input), /OWNER_RELEASE_CAS_CONFLICT/);
    const noVisual = releaseHarness({ placement: 'story', visualState: 'NO_VISUAL_NEEDED' });
    await assert.rejects(noVisual.service.releaseTelegramTask(noVisual.input), /TELEGRAM_STORY_MEDIA_REQUIRED/);
    const wrongBody = releaseHarness({ placement: 'story' });
    await assert.rejects(wrongBody.service.releaseTelegramTask({ ...wrongBody.input,
        expectedBodySha256: '0'.repeat(64) }), /OWNER_APPROVED_BODY_MISMATCH/);
    const feed = releaseHarness({ placement: 'feed' });
    delete feed.task.channel.config.telegram_channel_id;
    await assert.rejects(feed.service.releaseTelegramTask(feed.input), /TELEGRAM_CONNECTOR_NOT_READY/);
});

test('owner release keeps feed channel guard and requires active MTProto session for story', async () => {
    const feed = releaseHarness();
    delete feed.task.channel.config.telegram_channel_id;
    await assert.rejects(feed.service.releaseTelegramTask(feed.input), /TELEGRAM_CONNECTOR_NOT_READY/);
    const story = releaseHarness({ placement: 'story', session: false });
    delete story.task.channel.config.telegram_channel_id;
    await assert.rejects(story.service.releaseTelegramTask(story.input), /TELEGRAM_PERSONAL_STORY_ROUTE_NOT_READY/);
});

test('owner release rejects non-owner, body drift, existing attempt and required visual waiver', async () => {
    for (const options of [{ owner: false }, { attempt: true }, { visualState: 'NO_VISUAL_NEEDED' }]) {
        const h = releaseHarness(options);
        await assert.rejects(h.service.releaseTelegramTask(h.input), /OWNER_REQUIRED|DELIVERY_ATTEMPT_EXISTS|VISUAL_REQUIRED/);
        assert.equal(h.task.publication_mode, 'approval_required');
        assert.equal(h.events.length, 0);
    }
    const drift = releaseHarness();
    await assert.rejects(drift.service.releaseTelegramTask({ ...drift.input,
        expectedBodySha256: '0'.repeat(64) }), /OWNER_APPROVED_BODY_MISMATCH/);
    assert.equal(drift.task.publication_mode, 'approval_required');
});

test('Dzen #958 owner release is exact, audited and does not send', async () => {
    const hash = '78081837cecace18c91c01af0253b21ca502e611b63a016f9d9035567587dfd3';
    const task: any = {
        id: 958, project_id: 10, channel_id: 116, channel: { type: 'dzen' },
        content_revision: 1, accepted_revision: 1, text_state: 'accepted',
        visual_placement: 'feed', visual_state: 'NO_VISUAL_NEEDED',
        visual_decision_version: 2, selected_asset_id: null,
        status: 'ready_for_execution', handoff_state: 'ready',
        publication_mode: 'approval_required', schedule_at: schedule,
        draft_text: 'exact accepted body', publication_fact: null, published_link: null
    };
    const events: any[] = [];
    const tx = {
        project: { findUnique: async () => ({ slug: 'analystcraft-2' }) },
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: { findFirst: async () => null, create: async (event: any) => { events.push(event); return event; } },
        contentItem: {
            findFirst: async () => task,
            updateMany: async ({ where, data }: any) => {
                if (where.publication_mode !== task.publication_mode || where.status !== task.status) return { count: 0 };
                Object.assign(task, data);
                return { count: 1 };
            }
        },
        artDirectionDecision: { findFirst: async ({ where }: any) => {
            assert.equal(where.channel, 'analystcraft_dzen');
            return { id: 147, decision_version: 2 };
        } },
        deliveryAttempt: { findFirst: async () => null }
    };
    const service = new OwnerPublicationControlsService({ $transaction: async (fn: any) => fn(tx) } as any, () => hash);
    const input = { projectId: 10, actorId: 'user:7', taskId: 958, expectedChannelId: 116,
        expectedContentRevision: 1, expectedAcceptedRevision: 1,
        expectedScheduleAt: schedule.toISOString(), expectedBodySha256: hash,
        approvalReference: 'owner-command:hq-thread', idempotencyKey: 'release-958' };
    const before = { ...task };
    const result = await service.releaseDzenTask958(input);
    assert.equal(result.published, false);
    assert.deepEqual(task, { ...before, publication_mode: 'owner_released' });
    assert.equal(events.length, 1);
    assert.equal(events[0].data.before_state.approval_reference, input.approvalReference);
    await assert.rejects(service.releaseDzenTask958({ ...input, taskId: 959 }), /SCOPE_MISMATCH/);
});

test('Dzen #962 owner release is exact, audited and does not send', async () => {
    const hash = '15c9b4a2e874439c4952900002ae5677fc3a6b6e8794dd34a0a4ae5f03dba798';
    const task: any = {
        id: 962, project_id: 10, channel_id: 116, channel: { type: 'dzen' },
        content_revision: 1, accepted_revision: 1, text_state: 'accepted',
        visual_placement: 'feed', visual_state: 'NO_VISUAL_NEEDED',
        visual_decision_version: 2, selected_asset_id: null,
        status: 'ready_for_execution', handoff_state: 'ready',
        publication_mode: 'approval_required', schedule_at: schedule,
        draft_text: 'exact accepted body', publication_fact: null, published_link: null
    };
    const events: any[] = [];
    const tx = {
        project: { findUnique: async () => ({ slug: 'analystcraft-2' }) },
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: { findFirst: async () => null, create: async (event: any) => { events.push(event); return event; } },
        contentItem: {
            findFirst: async () => task,
            updateMany: async ({ where, data }: any) => {
                if (where.publication_mode !== task.publication_mode || where.status !== task.status) return { count: 0 };
                Object.assign(task, data);
                return { count: 1 };
            }
        },
        artDirectionDecision: { findFirst: async ({ where }: any) => {
            assert.equal(where.id, 146); assert.equal(where.channel, 'analystcraft_dzen');
            return { id: 146, decision_version: 2 };
        } },
        deliveryAttempt: { findFirst: async () => null }
    };
    const service = new OwnerPublicationControlsService({ $transaction: async (fn: any) => fn(tx) } as any, () => hash);
    const input = { projectId: 10, actorId: 'user:7', taskId: 962, expectedChannelId: 116,
        expectedContentRevision: 1, expectedAcceptedRevision: 1,
        expectedScheduleAt: schedule.toISOString(), expectedBodySha256: hash,
        approvalReference: 'owner-command:hq-thread', idempotencyKey: 'release-962' };
    const before = { ...task };
    const result = await service.releaseDzenTask962(input);
    assert.equal(result.published, false);
    assert.deepEqual(task, { ...before, publication_mode: 'owner_released' });
    assert.equal(events.length, 1);
    assert.equal(events[0].data.before_state.approval_reference, input.approvalReference);
    await assert.rejects(service.releaseDzenTask962({ ...input, taskId: 958 }), /SCOPE_MISMATCH/);
});

test('Threads replacement #959 release binds only accepted rev2 and decision 150', async () => {
    const hash = 'c3e7912e4f32aceafae19ea99751ef98f3f7d26554b9dfe160e78222eb64cf39';
    const task: any = { id: 959, project_id: 10, channel_id: 138, channel: { type: 'threads' },
        content_revision: 2, accepted_revision: 2, text_state: 'accepted', draft_text: 'short replacement',
        visual_placement: 'feed', visual_state: 'NO_VISUAL_NEEDED', visual_decision_version: 2,
        selected_asset_id: null, status: 'ready_for_execution', handoff_state: 'ready',
        publication_mode: 'approval_required', schedule_at: schedule,
        publication_fact: null, published_link: null };
    const events: any[] = [];
    const tx = {
        project: { findUnique: async () => ({ slug: 'analystcraft-2' }) },
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: { findFirst: async () => null, create: async (e: any) => (events.push(e), e) },
        contentItem: { findFirst: async () => task, updateMany: async ({ where, data }: any) =>
            task.publication_mode === where.publication_mode ? (Object.assign(task, data), { count: 1 }) : { count: 0 } },
        artDirectionDecision: { findFirst: async ({ where }: any) => {
            assert.equal(where.id, 150); assert.equal(where.channel, 'innokenty_threads');
            return { id: 150, decision_version: 2 };
        } }
    };
    const service = new OwnerPublicationControlsService({ $transaction: async (fn: any) => fn(tx) } as any, () => hash);
    const result = await service.releaseThreadsTask959({ projectId: 10, actorId: 'user:7', taskId: 959,
        expectedChannelId: 138, expectedContentRevision: 2, expectedAcceptedRevision: 2,
        expectedScheduleAt: schedule.toISOString(), expectedBodySha256: hash,
        approvalReference: 'owner-command:portfolio-hq', idempotencyKey: 'release-959-rev2' });
    assert.equal(result.publication_mode, 'owner_released');
    assert.equal(result.published, false);
    assert.equal(task.publication_mode, 'owner_released');
    assert.equal(events.length, 1);
});

test('Threads #966 owner release is exact, audited and never publishes', async () => {
    const hash = '83dd0fe0b2b354898b9fd3e5161d5ab05517c4c2b2304862d74c949ce1e2b123';
    const task: any = { id: 966, project_id: 10, channel_id: 138, channel: { type: 'threads' },
        content_revision: 1, accepted_revision: 1, text_state: 'accepted', draft_text: 'short body',
        visual_placement: 'feed', visual_state: 'NO_VISUAL_NEEDED', visual_decision_version: 1,
        selected_asset_id: null, status: 'ready_for_execution', handoff_state: 'ready',
        publication_mode: 'approval_required', schedule_at: new Date('2026-09-26T18:00:00.000Z'),
        publication_fact: null, published_link: null };
    const events: any[] = [];
    const tx = {
        project: { findUnique: async () => ({ slug: 'analystcraft-2' }) },
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: { findFirst: async () => null, create: async (e: any) => (events.push(e), e) },
        contentItem: { findFirst: async () => task, updateMany: async ({ where, data }: any) =>
            task.publication_mode === where.publication_mode ? (Object.assign(task, data), { count: 1 }) : { count: 0 } },
        artDirectionDecision: { findFirst: async ({ where }: any) => {
            assert.equal(where.id, 142); assert.equal(where.source_content_revision, 1);
            return { id: 142, decision_version: 1 };
        } },
        deliveryAttempt: { findFirst: async () => null }
    };
    const service = new OwnerPublicationControlsService({ $transaction: async (fn: any) => fn(tx) } as any, () => hash);
    const result = await service.releaseThreadsTask966({ projectId: 10, actorId: 'user:7', taskId: 966,
        expectedChannelId: 138, expectedContentRevision: 1, expectedAcceptedRevision: 1,
        expectedScheduleAt: task.schedule_at.toISOString(), expectedBodySha256: hash,
        approvalReference: 'owner-command:portfolio-hq-966', idempotencyKey: 'release-966-rev1' });
    assert.equal(result.publication_mode, 'owner_released');
    assert.equal(result.published, false);
    assert.equal(task.publication_mode, 'owner_released');
    assert.equal(events[0].data.command, 'ba_release_approved_threads_task966');
});

test('task #969 reschedule changes only schedule and refreshes exact owner-release proof', async () => {
    const hash = '43cff698cbb2597144a5fd696013b361961cd9d7c824809d6c4279d45391d1e9';
    const oldSchedule = new Date('2026-09-27T09:00:00.000Z');
    const newSchedule = new Date(Date.now() + 60_000);
    const task: any = { id: 969, project_id: 10, channel_id: 111, channel: { type: 'telegram' },
        content_revision: 1, accepted_revision: 1, text_state: 'accepted', draft_text: 'accepted body',
        visual_placement: 'feed', visual_state: 'APPROVED', selected_asset_id: 88,
        selected_asset: { id: 88, status: 'approved', content_revision: 1, file_url: 'https://cdn.example/88.jpg' },
        status: 'ready_for_execution', handoff_state: 'ready', publication_mode: 'owner_released',
        schedule_at: oldSchedule, publication_fact: null, published_link: null };
    const events: any[] = [];
    const tx = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: { findFirst: async () => null, create: async (e: any) => (events.push(e), e) },
        contentItem: { findFirst: async () => task, updateMany: async ({ where, data }: any) =>
            task.schedule_at.getTime() === where.schedule_at.getTime()
                ? (Object.assign(task, data), { count: 1 }) : { count: 0 } },
        deliveryAttempt: { findFirst: async () => null }
    };
    const service = new OwnerPublicationControlsService({ $transaction: async (fn: any) => fn(tx) } as any, () => hash);
    const result = await service.rescheduleOwnerReleasedTask969({ projectId: 10, actorId: 'user:7', taskId: 969,
        expectedScheduleAt: oldSchedule.toISOString(), newScheduleAt: newSchedule.toISOString(),
        expectedBodySha256: hash, expectedSelectedAssetId: 88,
        approvalReference: 'owner-command:publish-now-969', idempotencyKey: 'reschedule-969-now' });
    assert.equal(task.schedule_at.toISOString(), newSchedule.toISOString());
    assert.equal(task.publication_mode, 'owner_released');
    assert.equal(result.owner_release_refreshed, true);
    assert.deepEqual(events.map(event => event.data.command), [
        'ba_reschedule_owner_released_task969', 'ba_release_approved_telegram_task'
    ]);
});

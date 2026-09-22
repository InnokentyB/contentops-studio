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

function releaseHarness(options: { owner?: boolean; attempt?: boolean; visualState?: string } = {}) {
    const task: any = {
        id: 971, project_id: 10, channel_id: 111,
        channel: { id: 111, type: 'telegram', config: {
            capability_flags: { api_publish: true }, telegram_channel_id: '-100123'
        } },
        status: 'ready_for_execution', publication_mode: 'approval_required',
        content_revision: 2, accepted_revision: 2, text_state: 'accepted',
        visual_mode: 'required', visual_state: options.visualState || 'APPROVED',
        visual_placement: 'feed', selected_asset_id: 15,
        selected_asset: { id: 15, status: 'approved', content_revision: 2,
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
                if (where.publication_mode !== task.publication_mode || where.status !== task.status) return { count: 0 };
                Object.assign(task, data);
                return { count: 1 };
            }
        },
        deliveryAttempt: { findFirst: async () => options.attempt ? { id: 1 } : null }
    };
    const service = new OwnerPublicationControlsService({ $transaction: async (callback: any) => callback(tx) } as any);
    const input = {
        projectId: 10, actorId: 'user:7', taskId: 971, expectedChannelId: 111,
        expectedContentRevision: 2, expectedAcceptedRevision: 2,
        expectedVisualMode: 'required', expectedVisualState: task.visual_state,
        expectedSelectedAssetId: 15, expectedScheduleAt: schedule.toISOString(),
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
        artDirectionDecision: { findFirst: async () => ({ id: 147, decision_version: 2 }) },
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

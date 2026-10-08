import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
    PROJECT_RETIREMENT_TASKS,
    PublicationRetirementService,
    type RetirementTaskGuard
} from '../services/publication_retirement.service';

const manifestChecksum = `sha256:${'c'.repeat(64)}`;

function makeTask(projectId: number, taskId: number): any {
    const is1011 = projectId === 10 && taskId === 1011;
    const is1084 = projectId === 10 && taskId === 1084;
    return {
        id: taskId,
        project_id: projectId,
        status: is1011 ? 'publishing' : is1084 ? 'browser_required' : 'ready_for_execution',
        publication_mode: is1011 ? 'owner_released' : is1084 ? 'browser_required' : 'manual_handoff',
        content_revision: is1011 || is1084 ? 1 : 0,
        accepted_revision: is1011 || is1084 ? 1 : null,
        text_state: is1011 || is1084 ? 'accepted' : 'draft',
        draft_text: is1011 ? 'Exact accepted Telegram revision one' : `Task ${taskId}`,
        selected_asset_id: is1011 ? 98 : is1084 ? 118 : null,
        assets: is1084 ? { approved_video: { asset_id: 118 } } : null,
        quality_report: is1011 ? { provider_result_uncertain: true } : { marker: taskId },
        published_link: null,
        telegram_message_id: null,
        channel_id: is1011 ? 111 : is1084 ? 117 : 1,
        channel: is1011 ? { id: 111, type: 'telegram', name: 'analysts_thinking_tg', config: { channel_username: '@analysts_thinking' } } : null,
        publication_fact: null,
        delivery_attempts: is1011 ? [{ id: 70, status: 'pending', error_message: 'provider_result_uncertain' }] : [],
        work_items: is1084 ? [{ id: 1572, kind: 'browser_publish', state: 'claimed' }] : []
    };
}

function harness(projectId = 10, history: any = { status: 'not_found', matches: [] }) {
    const ids = PROJECT_RETIREMENT_TASKS[projectId as 7 | 10];
    const state: any = {
        project: { id: projectId, slug: projectId === 10 ? 'analystcraft-2' : 'seturon' },
        tasks: ids.map((id: number) => makeTask(projectId, id)),
        facts: [] as Array<Record<string, unknown>>,
        events: [] as Array<Record<string, unknown>>,
        workItems: [] as Array<Record<string, unknown>>,
        writes: 0
    };
    const tx: any = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        project: { findUnique: async () => state.project },
        contentItem: {
            findMany: async ({ where }: any) => state.tasks.filter((task: any) => task.project_id === where.project_id && where.id.in.includes(task.id)),
            updateMany: async ({ where, data }: any) => {
                const task = state.tasks.find((entry: any) => entry.id === where.id && entry.project_id === where.project_id
                    && entry.status === where.status && entry.publication_mode === where.publication_mode);
                if (!task) return { count: 0 };
                Object.assign(task, data); state.writes += 1; return { count: 1 };
            }
        },
        publicationFact: {
            create: async ({ data }: any) => { const fact = { id: 500, ...data }; state.facts.push(fact); state.writes += 1; return fact; }
        },
        deliveryAttempt: { findMany: async () => state.tasks.flatMap((task: any) => task.delivery_attempts || []) },
        workflowEvent: {
            findFirst: async ({ where }: any) => state.events.find((event: any) => event.project_id === where.project_id
                && event.actor_id === where.actor_id && event.command === where.command && event.idempotency_key === where.idempotency_key) || null,
            create: async ({ data }: any) => { const event = { id: 900, ...data }; state.events.push(event); state.writes += 1; return event; }
        },
        workItem: {
            create: async ({ data }: any) => { const item = { id: 901, ...data }; state.workItems.push(item); state.writes += 1; return item; }
        },
        $queryRaw: async () => []
    };
    const db: any = { ...tx, $transaction: async (callback: any) => callback(tx) };
    const service = new PublicationRetirementService(db, {
        loadManifest: async () => ({ checksum: manifestChecksum }),
        checkTelegramHistory: async () => history,
        now: () => new Date('2026-10-08T12:00:00.000Z')
    });
    return { state, service };
}

function guards(h: ReturnType<typeof harness>): RetirementTaskGuard[] {
    return h.state.tasks.map((task: any) => ({ taskId: task.id, expectedStatus: task.status, expectedPublicationMode: task.publication_mode }));
}

function params(h: ReturnType<typeof harness>) {
    return {
        projectId: h.state.project.id,
        projectSlug: h.state.project.slug,
        actorId: 'user:2',
        expectedManifestChecksum: manifestChecksum,
        expectedTasks: guards(h),
        approvalReference: 'owner-approved-retirement-2026-10-08'
    };
}

test('retirement preview is bounded to the exact approved task set and preserves facts, attempts, assets and work items', async () => {
    const h = harness();
    const result = await h.service.preview(params(h));
    assert.deepEqual(result.affected_task_ids, PROJECT_RETIREMENT_TASKS[10]);
    assert.equal(result.changes.length, PROJECT_RETIREMENT_TASKS[10].length * 2);
    assert.equal(result.unchanged_assertions.publication_facts, true);
    assert.equal(result.unchanged_assertions.delivery_attempts, true);
    assert.equal(result.unchanged_assertions.assets_and_selected_asset, true);
    assert.equal(result.unchanged_assertions.existing_work_items, true);
    assert.ok(!result.affected_task_ids.includes(1036));
    assert.ok(!result.affected_task_ids.includes(983));
});

test('apply atomically retires exact tasks and preserves uncertainty plus the VK video engineering obligation', async () => {
    const h = harness();
    const before1011 = structuredClone(h.state.tasks.find((task: any) => task.id === 1011));
    const before1084 = structuredClone(h.state.tasks.find((task: any) => task.id === 1084));
    const preview = await h.service.preview(params(h));
    const result = await h.service.apply({ ...params(h), previewHash: preview.preview_hash,
        reason: 'Owner approved retiring the exact stale publication obligations.', idempotencyKey: 'retire-p10-20261008-v1' });
    assert.equal(result.retired_count, PROJECT_RETIREMENT_TASKS[10].length);
    assert.ok(h.state.tasks.every((task: any) => task.status === 'cancelled' && task.publication_mode === 'retired'));
    const after1011 = h.state.tasks.find((task: any) => task.id === 1011);
    const after1084 = h.state.tasks.find((task: any) => task.id === 1084);
    assert.deepEqual(after1011.quality_report, before1011.quality_report);
    assert.deepEqual(after1011.delivery_attempts, before1011.delivery_attempts);
    assert.equal(after1084.selected_asset_id, 118);
    assert.deepEqual(after1084.assets, before1084.assets);
    assert.deepEqual(after1084.work_items, before1084.work_items);
    assert.equal(h.state.facts.length, 0);
});

test('stale status, task set, slug, manifest or existing fact aborts with zero writes', async () => {
    for (const mutate of [
        (h: any, p: any) => { p.expectedTasks[0].expectedStatus = 'planned'; },
        (h: any, p: any) => { p.expectedTasks.pop(); },
        (h: any, p: any) => { p.projectSlug = 'wrong'; },
        (h: any, p: any) => { p.expectedManifestChecksum = `sha256:${'d'.repeat(64)}`; },
        (h: any) => { h.state.tasks[0].publication_fact = { id: 1 }; }
    ]) {
        const h = harness(); const p: any = params(h); mutate(h, p);
        await assert.rejects(h.service.preview(p));
        assert.equal(h.state.writes, 0);
    }
});

test('idempotency replay returns the original audit without repeating writes', async () => {
    const h = harness(); const preview = await h.service.preview(params(h));
    const apply = { ...params(h), previewHash: preview.preview_hash,
        reason: 'Owner approved retiring the exact stale publication obligations.', idempotencyKey: 'retire-p10-20261008-v1' };
    const first = await h.service.apply(apply); const writes = h.state.writes;
    const second = await h.service.apply(apply);
    assert.equal(second.replayed, true); assert.equal(second.audit_id, first.audit_id); assert.equal(h.state.writes, writes);
});

test('exact Telegram history match reconciles task 1011 instead of retiring or resending it', async () => {
    const history = { status: 'found', matches: [{ messageId: 321, publicUrl: 'https://t.me/analysts_thinking/321',
        publishedAt: '2026-10-01T17:16:00.000Z', textSha256: createHash('sha256').update('Exact accepted Telegram revision one').digest('hex') }] };
    const h = harness(10, history); const preview = await h.service.preview(params(h));
    const result = await h.service.apply({ ...params(h), previewHash: preview.preview_hash,
        reason: 'Owner approved retiring stale obligations and reconciling exact Telegram history.', idempotencyKey: 'retire-p10-found-v1' });
    const task = h.state.tasks.find((entry: any) => entry.id === 1011);
    assert.equal(task.status, 'published'); assert.equal(task.published_link, history.matches[0].publicUrl);
    assert.equal(h.state.facts.length, 1); assert.equal(h.state.facts[0].provider_object_id, '321');
    assert.ok(!result.retired_task_ids.includes(1011));
});

test('unavailable Telegram session retires task 1011 but creates a separate reconciliation blocker', async () => {
    const h = harness(10, { status: 'session_unavailable', reasonCode: 'project_session_missing', matches: [] });
    const preview = await h.service.preview(params(h));
    await h.service.apply({ ...params(h), previewHash: preview.preview_hash,
        reason: 'Owner approved retirement while preserving the unresolved provider result.', idempotencyKey: 'retire-p10-blocker-v1' });
    const task = h.state.tasks.find((entry: any) => entry.id === 1011);
    assert.equal(task.status, 'cancelled'); assert.equal(task.quality_report.provider_result_uncertain, true);
    assert.equal(h.state.workItems.length, 1);
    assert.equal(h.state.workItems[0].kind, 'telegram_history_reconciliation');
    assert.equal(h.state.workItems[0].state, 'blocked');
    assert.equal(h.state.facts.length, 0);
});

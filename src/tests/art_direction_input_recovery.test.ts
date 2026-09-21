import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../db';
import workQueueService from '../services/work_queue.service';

const params = {
    projectId: 10, actorId: 'user:2', taskId: 951,
    expectedChannelId: 117, expectedPlacement: 'feed', expectedRevision: 1,
    oldWorkItemId: 879, oldDecisionId: 131,
    idempotencyKey: 'recover-951-contract-v1'
};

function fixture(overrides: Record<string, unknown> = {}) {
    const calls: string[] = [];
    const task = {
        id: 951, project_id: 10, channel_id: 117, channel: { id: 117, name: 'analystcraft_vk_group', type: 'vk' },
        visual_placement: 'feed', content_revision: 1, accepted_revision: 1,
        text_state: 'accepted', status: 'approved', visual_state: 'BRIEFED', handoff_state: 'blocked',
        selected_asset_id: null, published_link: null, publication_fact: null,
        visual_decision_version: 1, week_package_id: 52, item_key: 'test:951', ...overrides
    };
    let savedEvent: any = null;
    const tx: any = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: {
            findFirst: async () => savedEvent,
            create: async ({ data }: any) => { calls.push('audit'); savedEvent = data; return data; }
        },
        contentItem: {
            findFirst: async () => task,
            updateMany: async () => { calls.push('task-update'); return { count: 1 }; }
        },
        workItem: {
            findFirst: async ({ where }: any) => {
                if (where.id === 879) return { id: 879, state: 'completed', input_context_version: 1, result_version: 1 };
                return null;
            },
            updateMany: async () => { calls.push('old-generator-held'); return { count: 1 }; },
            create: async ({ data }: any) => { calls.push('new-input'); return { id: 900, ...data }; }
        },
        artDirectionDecision: { findFirst: async () => ({ id: 131, decision_version: 1, status: 'active' }) },
        imageAsset: { findFirst: async () => null }
    };
    const database = { $transaction: async (fn: (tx: any) => Promise<any>) => fn(tx) } as unknown as typeof prisma;
    return { database, calls, tx };
}

test('owner recovery creates one fresh revision-bound input, audits it, and holds old generation', async () => {
    const { database, calls } = fixture();
    const result = await workQueueService.recoverArtDirectionInput(params, database);
    assert.equal(result.art_direction_work_item_id, 900);
    assert.equal(result.art_direction_state, 'available');
    assert.equal(result.input_context_version, 1);
    assert.equal(result.result_version, 0);
    assert.equal(result.old_decision_id, 131);
    assert.deepEqual(calls, ['task-update', 'old-generator-held', 'new-input', 'audit']);
    const retry = await workQueueService.recoverArtDirectionInput(params, database);
    assert.deepEqual(retry, result);
    assert.deepEqual(calls, ['task-update', 'old-generator-held', 'new-input', 'audit']);
});

test('recovery rejects published or changed task before any write', async () => {
    for (const overrides of [
        { publication_fact: { outcome: 'blocked' } },
        { accepted_revision: 2 },
        { channel_id: 139 },
        { selected_asset_id: 36 },
        { visual_state: 'APPROVED' }
    ]) {
        const { database, calls } = fixture(overrides);
        await assert.rejects(workQueueService.recoverArtDirectionInput(params, database), /ART_RECOVERY_TASK_CONFLICT/);
        assert.deepEqual(calls, []);
    }
});

test('recovery stops on compare-and-swap race before creating input', async () => {
    const { database, calls } = fixture();
    const transaction = (database as any).$transaction;
    (database as any).$transaction = async (fn: (tx: any) => Promise<any>) => transaction(async (tx: any) => {
        tx.contentItem.updateMany = async () => ({ count: 0 });
        return fn(tx);
    });
    await assert.rejects(workQueueService.recoverArtDirectionInput(params, database), /ART_RECOVERY_RACE/);
    assert.deepEqual(calls, []);
});

test('recovery refuses a newer art input or an active old generator', async () => {
    for (const kind of ['new-input', 'active-generator']) {
        const { database, calls, tx } = fixture();
        const original = tx.workItem.findFirst;
        tx.workItem.findFirst = async ({ where }: any) => {
            if (kind === 'new-input' && where.id?.not === 879) return { id: 901 };
            if (kind === 'active-generator' && where.kind === 'visual_generate' && where.state === 'claimed') return { id: 881 };
            return original({ where });
        };
        await assert.rejects(
            workQueueService.recoverArtDirectionInput(params, database),
            kind === 'new-input' ? /ART_RECOVERY_ALREADY_SUPERSEDED/ : /ART_RECOVERY_GENERATOR_ACTIVE/
        );
        assert.deepEqual(calls, []);
    }
});

test('non-owner cannot start recovery', async () => {
    const { database, calls, tx } = fixture();
    tx.projectMember.findUnique = async () => ({ role: 'editor' });
    await assert.rejects(workQueueService.recoverArtDirectionInput(params, database), /Project owner role is required/);
    assert.deepEqual(calls, []);
});

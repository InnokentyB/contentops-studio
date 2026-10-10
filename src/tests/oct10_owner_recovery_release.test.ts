import test from 'node:test';
import assert from 'node:assert/strict';
import {
    OCT10_MANIFEST_CHECKSUM,
    releaseLinkedInTask1072,
    releaseThreadsTask1043,
    releaseXTask1042
} from '../services/oct10_owner_recovery.service';

const manifest = async () => ({ checksum: OCT10_MANIFEST_CHECKSUM }) as never;

function asset(id: number, checksum: string) {
    return { id, status: 'approved', content_revision: 4, file_url: `https://assets.example/${checksum}.png`,
        provenance: { planner_storage: { sha256: checksum, managed: true } } };
}

function baseTask(id: number, channelId: number, selectedAsset: ReturnType<typeof asset>) {
    return { id, project_id: 10, channel_id: channelId, week_package_id: null, item_key: `publication-${id}`,
        channel: { id: channelId, type: channelId === 164 ? 'x' : channelId === 138 ? 'threads' : 'linkedin',
            name: channelId === 164 ? 'innokenty_x' : channelId === 138 ? 'innokenty_threads' : 'analystcraft_linkedin',
            is_active: true, config: channelId === 138 ? { threads_user_id: '39421253764155091', access_token: 'fixture' } : {} },
        status: 'ready_for_execution', handoff_state: 'ready', publication_mode: 'approval_required',
        content_revision: 4, accepted_revision: 4, text_state: 'accepted', visual_state: 'APPROVED',
        visual_placement: 'feed', visual_decision_version: 2, selected_asset_id: selectedAsset.id,
        selected_asset: selectedAsset, schedule_at: new Date('2026-10-09T15:00:00.000Z'),
        publish_at: new Date('2026-10-09T15:00:00.000Z'), draft_text: 'fixture', quality_report: {},
        publication_fact: null, published_link: null, telegram_message_id: null };
}

function commonTx(task: ReturnType<typeof baseTask>, ids: { review: number; art: number; decision: number }) {
    let event: { before_state: unknown; after_state: unknown } | null = null;
    let workCreates = 0;
    const tx = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: { findFirst: async () => event, create: async ({ data }: { data: typeof event }) => { event = data; } },
        contentItem: { findFirst: async () => task, updateMany: async ({ data }: { data: Partial<typeof task> }) => {
            Object.assign(task, data); return { count: 1 };
        } },
        deliveryAttempt: { findFirst: async () => null },
        workItem: {
            findFirst: async ({ where }: { where: { id?: number; kind?: string } }) => {
                if (where.id === ids.review) return { id: ids.review, kind: 'content_review', state: 'completed', input_context_version: 4, result_version: 4 };
                if (where.id === ids.art) return { id: ids.art, kind: 'art_direction', state: 'completed', input_context_version: 4, result_version: 2 };
                return null;
            },
            create: async () => { workCreates += 1; return { id: 1900 + workCreates }; }
        },
        artDirectionDecision: { findFirst: async () => ({ id: ids.decision, decision: 'GENERATE', decision_version: 2,
            source_content_revision: 4, channel: task.channel.type, placement: 'feed', status: 'active' }) }
    };
    return { tx, get workCreates() { return workCreates; } };
}

test('X1042 release binds exact rev4 asset and creates one replay-safe browser item', async () => {
    const selected = asset(126, 'e5643499e5a16777fd272dbc510946d0c8d55accf6301d9a3b330206f1d7c92b');
    const task = baseTask(1042, 164, selected);
    const f = commonTx(task, { review: 1420, art: 1670, decision: 264 });
    const db = { $transaction: async (run: (tx: typeof f.tx) => unknown) => run(f.tx) };
    const args = { projectId: 10, taskId: 1042, actorId: 'user:2', approvalReference: 'owner recovery 2026-10-10',
        idempotencyKey: 'x1042-r4-recovery' } as const;
    const deps = { database: db as never, manifestLoader: manifest,
        hashBody: () => '7d780809a7f6b73494b590cd1fa11ac2f6383fdc0a952f1aca5d09cb4e676c70', now: () => new Date('2026-10-10T10:00:00Z') };
    const first = await releaseXTask1042(args, deps);
    const replay = await releaseXTask1042(args, deps);
    assert.equal(first.browser_work_item_id, 1901);
    assert.equal(replay.replayed, true);
    assert.equal(f.workCreates, 1);
    assert.equal(task.schedule_at.toISOString(), '2026-10-09T15:00:00.000Z');
    assert.equal(task.selected_asset_id, 126);
    assert.equal(task.publication_fact, null);
});

test('LinkedIn1072 release creates a governed p10 personal route from p7/channel5 and binds only task1072', async () => {
    const selected = asset(127, '3c2c2f95dcdd54784a034216414a8efc6b97fe79167ea3403de9e5e918db1121');
    const task = baseTask(1072, 123, selected);
    const f = commonTx(task, { review: 1394, art: 1671, decision: 265 });
    const personal = { id: 5, project_id: 7, name: 'innokentiy_linkedin', type: 'linkedin', is_active: true,
        config: { profile_ref: 'profile_personal_innokenty_linkedin', identity_ref: 'personal_innokenty',
            account_ref: 'https://www.linkedin.com/in/innokentyb/', channel_url: 'https://www.linkedin.com/in/innokentyb/',
            account_type: 'personal', raw_account: { handle: 'innokentyb', type: 'personal' } } };
    let createdChannel = 0;
    let manifestReads = 0;
    const tx = { ...f.tx,
        projectMember: { findUnique: async ({ where }: { where: { project_id_user_id: { project_id: number } } }) =>
            where.project_id_user_id.project_id === 7 || where.project_id_user_id.project_id === 10 ? { role: 'owner' } : null },
        socialChannel: { findFirst: async ({ where }: { where: { project_id: number; id?: number } }) => {
            if (where.project_id === 7 && where.id === 5) return personal;
            return createdChannel ? { id: createdChannel, project_id: 10, name: 'innokenty_personal_linkedin', type: 'linkedin',
                is_active: true, config: personal.config } : null;
        }, create: async () => { createdChannel = 175; return { id: createdChannel }; } } };
    const db = { $transaction: async (run: (client: typeof tx) => unknown) => run(tx) };
    const releaseArgs = { projectId: 10, taskId: 1072, actorId: 'user:2',
        approvalReference: 'owner recovery 2026-10-10', idempotencyKey: 'linkedin1072-personal-r4' } as const;
    const dependencies = {
        database: db as never, manifestLoader: async () => ({ checksum: ++manifestReads === 1 ? OCT10_MANIFEST_CHECKSUM : 'changed' }) as never,
        hashBody: () => 'd5b88c95e2fbe35cf96e792c775b0e84eff4c261974487d592a8cc24ac44951c',
        now: () => new Date('2026-10-10T10:00:00Z')
    };
    const result = await releaseLinkedInTask1072(releaseArgs, dependencies);
    const replay = await releaseLinkedInTask1072(releaseArgs, dependencies);
    assert.equal(result.source_registry_channel_id, 5);
    assert.equal(result.target_channel_id, 175);
    assert.equal(task.channel_id, 175);
    assert.equal(task.schedule_at.toISOString(), '2026-10-09T15:00:00.000Z');
    assert.equal(task.publication_fact, null);
    assert.equal(replay.replayed, true);
    assert.equal(manifestReads, 1);
});

test('Threads1043 release keeps missed slot, binds asset128 and never calls publish', async () => {
    const selected = asset(128, 'd53fa8809efe40b35577849cdfcd2795ead8127ba77e9e4a604fbfaf94f9d3c3');
    const task = baseTask(1043, 138, selected);
    task.schedule_at = new Date('2026-10-09T16:30:00.000Z'); task.publish_at = new Date(task.schedule_at);
    const f = commonTx(task, { review: 1421, art: 1672, decision: 266 });
    const db = { socialChannel: { findFirst: async () => task.channel }, projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: f.tx.workflowEvent,
        $transaction: async (run: (tx: typeof f.tx) => unknown) => run(f.tx) };
    let sends = 0; let historyReads = 0;
    const releaseArgs = { projectId: 10, taskId: 1043, actorId: 'user:2',
        approvalReference: 'owner recovery 2026-10-10', idempotencyKey: 'threads1043-r4' } as const;
    const dependencies = {
        database: db as never, manifestLoader: manifest,
        hashBody: () => '00813c7d65068bdce2e0b5aa6bb1cc04ca936e42c81ca4a44b2be50a095713fc',
        now: () => new Date('2026-10-10T10:00:00Z'), threads: { testConnection: async () => ({ success: true,
            details: { id: '39421253764155091', username: 'innokentybo' } }), getOwnPosts: async () => {
                historyReads += 1; return { items: [], after: null };
            },
            publishPost: async () => { sends += 1; return ''; } } as never
    };
    const result = await releaseThreadsTask1043(releaseArgs, dependencies);
    const replay = await releaseThreadsTask1043(releaseArgs, dependencies);
    assert.equal(result.publication_mode, 'owner_released');
    assert.equal(result.selected_asset_id, 128);
    assert.equal(task.schedule_at.toISOString(), '2026-10-09T16:30:00.000Z');
    assert.equal(sends, 0);
    assert.equal(replay.replayed, true);
    assert.equal(historyReads, 1);
});

test('all exact releases reject an existing uncertain provider result before writes', async () => {
    const selected = asset(126, 'e5643499e5a16777fd272dbc510946d0c8d55accf6301d9a3b330206f1d7c92b');
    const task = baseTask(1042, 164, selected);
    task.quality_report = { publication_task_delivery: { state: 'provider_result_uncertain' } };
    const f = commonTx(task, { review: 1420, art: 1670, decision: 264 });
    const db = { $transaction: async (run: (tx: typeof f.tx) => unknown) => run(f.tx) };
    await assert.rejects(releaseXTask1042({ projectId: 10, taskId: 1042, actorId: 'user:2',
        approvalReference: 'owner recovery 2026-10-10', idempotencyKey: 'blocked' }, {
        database: db as never, manifestLoader: manifest,
        hashBody: () => '7d780809a7f6b73494b590cd1fa11ac2f6383fdc0a952f1aca5d09cb4e676c70',
        now: () => new Date('2026-10-10T10:00:00Z') }), /UNCERTAIN_ATTEMPT_EXISTS/);
    assert.equal(f.workCreates, 0);
});

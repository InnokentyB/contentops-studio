import assert from 'node:assert/strict';
import test from 'node:test';
import { bindDevtoTask1118 } from '../services/devto_task1118_binding.service';

const manifest = 'sha256:6ceb5c1c2199d8c1915beeb622a9791ff9c1b877d02649c8e69acd0d173e46d8' as const;
const bodySha = '363ef73df900415ff965a77b1a71577354676d95077edbe84cf37ad0fabf3c12';
const schedule = '2026-10-16T09:00:00.000Z';

function harness() {
    const events: Array<Record<string, unknown>> = [];
    const channels: Array<Record<string, unknown>> = [];
    const workItems = [{ id: 1825, project_id: 10, content_item_id: 1118, kind: 'art_direction',
        state: 'available', input_context_version: 1, dedupe_key: 'art-direction:1118:1:feed' }];
    let task = {
        id: 1118, project_id: 10, week_package_id: null, channel_id: null, type: 'publication',
        status: 'approved', publication_mode: 'approval_required', content_revision: 1,
        accepted_revision: 1, text_state: 'accepted', handoff_state: 'blocked',
        visual_state: 'PENDING_ASSESSMENT', visual_mode: 'auto_assess', visual_placement: 'feed',
        visual_decision_version: 0, selected_asset_id: null, draft_text: 'accepted body',
        schedule_at: new Date(schedule), publish_at: new Date(schedule), published_link: null,
        publication_fact: null, quality_report: { content_language: 'ru', handoff_bundle: {
            mode: 'automated', task: { channel: 'operational', action_type: 'operational_feed:publish',
                placement: 'feed', account_ref: null }, publication: { body: 'accepted body' }
        } }
    };
    type Db = NonNullable<Parameters<typeof bindDevtoTask1118>[1]>;
    let nextChannelId = 178;
    let db: Db;
    db = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        socialChannel: {
            findFirst: async (args: unknown) => {
                const where = (args as { where: Record<string, unknown> }).where;
                return channels.find(row => Object.entries(where).every(([key, value]) => row[key] === value)) as never || null;
            },
            create: async (args: unknown) => {
                const row = { id: nextChannelId++, ...(args as { data: Record<string, unknown> }).data,
                    updated_at: new Date('2026-10-12T12:00:00.000Z') };
                channels.push(row); return row as never;
            }
        },
        contentItem: {
            findFirst: async () => task as never,
            updateMany: async (args: unknown) => {
                const data = (args as { data: Record<string, unknown> }).data;
                task = { ...task, ...data } as typeof task; return { count: 1 };
            }
        },
        deliveryAttempt: { findFirst: async () => null },
        artDirectionDecision: { findFirst: async () => null },
        imageAsset: { findFirst: async () => null },
        workItem: {
            findFirst: async () => workItems[0] as never,
            updateMany: async (args: unknown) => {
                Object.assign(workItems[0], (args as { data: Record<string, unknown> }).data); return { count: 1 };
            },
            create: async (args: unknown) => {
                const row = { id: 1826, ...(args as { data: Record<string, unknown> }).data };
                workItems.push(row as never); return row as never;
            }
        },
        workflowEvent: {
            findFirst: async () => null,
            create: async (args: unknown) => { events.push((args as { data: Record<string, unknown> }).data); }
        },
        async $transaction<T>(run: (tx: Db) => Promise<T>) { return run(db); }
    };
    return { db, channels, events, workItems, get task() { return task; } };
}

const base = { projectId: 10 as const, taskId: 1118 as const, actorId: 'user:2',
    expectedManifestChecksum: manifest, expectedAcceptedRevision: 1 as const,
    expectedContentRevision: 1 as const, expectedBodySha256: bodySha,
    expectedScheduleAt: schedule, expectedProfileRef: 'profile_personal_innokenty_dev' as const,
    expectedProfileUrl: 'https://dev.to/innokentyb' as const, expectedHandle: 'innokentyb' as const,
    idempotencyKey: 'bind-devto-1118-v1' };

test('preview performs no writes and apply binds the exact DEV.to identity without release', async () => {
    const h = harness();
    const deps = { hashBody: () => bodySha,
        manifestLoader: async () => ({ checksum: manifest, revision: 'old', channels: [],
            project: { id: 10, slug: 'analystcraft-2' } }) as never };
    const preview = await bindDevtoTask1118({ ...base, confirm: false }, h.db, deps) as Record<string, unknown>;
    assert.equal(preview.profile_url, 'https://dev.to/innokentyb');
    assert.equal(h.channels.length, 0);
    assert.equal(h.events.length, 0);

    const applied = await bindDevtoTask1118({ ...base, confirm: true }, h.db, {
        ...deps, manifestLoader: async () => h.channels.length
            ? ({ checksum: 'sha256:new', revision: '2026-10-12T12:00:00.000Z',
                channels: [{ id: 178, name: 'innokenty_devto', type: 'devto' }],
                project: { id: 10, slug: 'analystcraft-2' } }) as never
            : ({ checksum: manifest, revision: 'old', channels: [],
                project: { id: 10, slug: 'analystcraft-2' } }) as never
    }) as Record<string, unknown>;
    assert.equal(h.channels.length, 1);
    assert.equal(h.channels[0].name, 'innokenty_devto');
    assert.equal(h.task.channel_id, 178);
    assert.equal(h.task.visual_placement, 'article_cover');
    assert.equal(h.task.visual_mode, 'required');
    assert.equal((h.task.quality_report as Record<string, unknown>).content_language, 'en');
    assert.equal(h.workItems[0].state, 'cancelled');
    assert.equal(h.workItems[1].dedupe_key, 'art-direction:1118:1:article_cover');
    assert.equal(applied.manifest_checksum, 'sha256:new');
    assert.equal(applied.release_created, false);
    assert.equal(applied.provider_called, false);
    assert.equal(applied.publication_fact_created, false);
    assert.equal(h.events.length, 1);
});

test('binding rejects changed accepted bytes with zero writes', async () => {
    const h = harness();
    await assert.rejects(bindDevtoTask1118({ ...base, confirm: true }, h.db, {
        hashBody: () => 'changed', manifestLoader: async () => ({ checksum: manifest }) as never
    }), /GUARD_FAILED/);
    assert.equal(h.channels.length, 0);
    assert.equal(h.events.length, 0);
});

test('binding requires a project owner', async () => {
    const h = harness();
    h.db.projectMember.findUnique = async () => ({ role: 'editor' });
    await assert.rejects(bindDevtoTask1118({ ...base, confirm: true }, h.db, {
        hashBody: () => bodySha, manifestLoader: async () => ({ checksum: manifest }) as never
    }), /OWNER_REQUIRED/);
});

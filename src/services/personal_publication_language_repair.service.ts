import { createHash } from 'node:crypto';
import prisma from '../db';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';

const MANIFEST = 'sha256:6ceb5c1c2199d8c1915beeb622a9791ff9c1b877d02649c8e69acd0d173e46d8';
const COMMAND = 'ba_repair_personal_publication_language';
const SPECS = {
    1107: { channelId: 164, channelType: 'x', channelName: 'innokenty_x',
        title: 'W42 #04 — Personal X', bodySha: '2029e3fc10296091ba2331bcc2e666d5db895923111d37fb141cbec77171fdd4',
        schedule: '2026-10-12T15:00:00.000Z' },
    1108: { channelId: 138, channelType: 'threads', channelName: 'innokenty_threads',
        title: 'W42 #05 — Personal Threads', bodySha: 'b7d8b317537dce0cc347258574101de75f3cc3d5aee131c1d1c62c4e12448feb',
        schedule: '2026-10-12T16:30:00.000Z' }
} as const;

type TaskId = keyof typeof SPECS;
type JsonRecord = Record<string, unknown>;
type TaskRecord = {
    id: number; project_id: number; channel_id: number | null; type: string; status: string;
    publication_mode: string | null; content_revision: number; accepted_revision: number | null;
    text_state: string; handoff_state: string; visual_state: string; visual_placement: string | null;
    selected_asset_id: number | null; title: string | null; draft_text: string | null;
    schedule_at: Date | null; publish_at: Date | null; published_link: string | null;
    quality_report: unknown; publication_fact: unknown;
    channel: { id: number; type: string; name: string; is_active: boolean } | null;
};
type DbPort = {
    projectMember: { findUnique(args: unknown): Promise<{ role: string } | null> };
    contentItem: {
        findFirst(args: unknown): Promise<TaskRecord | null>;
        updateMany(args: unknown): Promise<{ count: number }>;
    };
    deliveryAttempt: { findFirst(args: unknown): Promise<{ id: number } | null> };
    workflowEvent: {
        findFirst(args: unknown): Promise<{ before_state: unknown; after_state: unknown } | null>;
        create(args: unknown): Promise<unknown>;
    };
    $transaction<T>(operation: (tx: DbPort) => Promise<T>): Promise<T>;
};
type Args = { projectId: 10; taskId: TaskId; actorId: string; expectedManifestChecksum: typeof MANIFEST;
    expectedBodySha256: string; expectedScheduleAt: string; idempotencyKey: string; confirm?: boolean };
type Dependencies = { hashBody(body: string): string;
    manifestLoader: typeof loadAgentWorkspaceManifest };

const defaults: Dependencies = { hashBody: body => createHash('sha256').update(body).digest('hex'),
    manifestLoader: loadAgentWorkspaceManifest };

function record(value: unknown): JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

async function exactTask(db: DbPort, taskId: TaskId, hashBody: (body: string) => string) {
    const spec = SPECS[taskId];
    const [task, attempt] = await Promise.all([
        db.contentItem.findFirst({ where: { id: taskId, project_id: 10 },
            include: { channel: true, publication_fact: true } }),
        db.deliveryAttempt.findFirst({ where: { project_id: 10, content_item_id: taskId } })
    ]);
    const quality = record(task?.quality_report);
    const handoff = record(quality.handoff_bundle);
    if (!task || task.channel_id !== spec.channelId || task.channel?.id !== spec.channelId
        || task.channel.type !== spec.channelType || task.channel.name !== spec.channelName
        || task.channel.is_active !== true || task.type !== 'publication'
        || task.status !== 'ready_for_execution' || task.publication_mode !== 'approval_required'
        || task.content_revision !== 1 || task.accepted_revision !== 1 || task.text_state !== 'accepted'
        || task.handoff_state !== 'ready' || task.visual_state !== 'NO_VISUAL_NEEDED'
        || task.visual_placement !== 'feed' || task.selected_asset_id !== null
        || task.title !== spec.title || hashBody(task.draft_text || '') !== spec.bodySha
        || task.schedule_at?.toISOString() !== spec.schedule || task.publish_at?.toISOString() !== spec.schedule
        || task.publication_fact || task.published_link || attempt
        || quality.content_language !== undefined || handoff.content_language !== undefined) {
        throw new Error('[PERSONAL_PUBLICATION_LANGUAGE_GUARD_FAILED] Exact accepted package changed');
    }
    return { task, quality, handoff, spec };
}

export async function repairPersonalPublicationLanguage(args: Args,
    database: DbPort = prisma as unknown as DbPort, dependencies: Dependencies = defaults) {
    const spec = SPECS[args.taskId];
    if (args.projectId !== 10 || !spec || args.expectedManifestChecksum !== MANIFEST
        || args.expectedBodySha256 !== spec.bodySha || args.expectedScheduleAt !== spec.schedule
        || !args.idempotencyKey.trim()) throw new Error('[PERSONAL_PUBLICATION_LANGUAGE_SCOPE_MISMATCH]');
    const actor = /^user:(\d+)$/.exec(args.actorId);
    if (!actor) throw new Error('[OWNER_REQUIRED]');
    const member = await database.projectMember.findUnique({ where: { project_id_user_id: {
        project_id: 10, user_id: Number(actor[1])
    } } });
    if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    const requestHash = createHash('sha256').update(JSON.stringify(args)).digest('hex');
    const prior = await database.workflowEvent.findFirst({ where: { project_id: 10,
        actor_id: args.actorId, command: COMMAND, idempotency_key: args.idempotencyKey } });
    if (prior?.after_state) {
        if (record(prior.before_state).request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
        return { ...record(prior.after_state), replayed: true };
    }
    const guarded = await exactTask(database, args.taskId, dependencies.hashBody);
    const preview = { project_id: 10, task_id: args.taskId, channel_id: spec.channelId,
        content_revision: 1, accepted_revision: 1, body_sha256: spec.bodySha,
        schedule_at: spec.schedule, from: { content_language: null }, to: { content_language: 'en' as const },
        handoff_bundle_rematerialized: args.confirm === true, release_created: false,
        provider_called: false, publication_fact_created: false, replayed: false };
    if (!args.confirm) return preview;
    const manifest = await dependencies.manifestLoader(10, Number(actor[1]));
    if (manifest.checksum !== MANIFEST) throw new Error('[STALE_MANIFEST]');
    return database.$transaction(async tx => {
        const current = await exactTask(tx, args.taskId, dependencies.hashBody);
        const nextQuality = { ...current.quality, content_language: 'en',
            handoff_bundle: { ...current.handoff, content_language: 'en' } };
        const changed = await tx.contentItem.updateMany({ where: { id: args.taskId, project_id: 10,
            channel_id: spec.channelId, status: 'ready_for_execution', publication_mode: 'approval_required',
            content_revision: 1, accepted_revision: 1, selected_asset_id: null,
            schedule_at: new Date(spec.schedule), publish_at: new Date(spec.schedule) },
        data: { quality_report: nextQuality } });
        if (changed.count !== 1) throw new Error('[PERSONAL_PUBLICATION_LANGUAGE_CAS_CONFLICT]');
        const result = { ...preview, handoff_bundle_rematerialized: true };
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: args.taskId,
            actor_id: args.actorId, command: COMMAND, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: requestHash, content_language: null,
                status: current.task.status, publication_mode: current.task.publication_mode },
            after_state: result } });
        return result;
    });
}

export const PERSONAL_PUBLICATION_LANGUAGE_MANIFEST = MANIFEST;

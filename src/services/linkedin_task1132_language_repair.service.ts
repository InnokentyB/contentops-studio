import { createHash } from 'node:crypto';
import prisma from '../db';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { classifyPriorAttempt } from './exact_browser_publication_1133_1132.service';

export const LINKEDIN1132_LANGUAGE = {
    projectId: 7,
    taskId: 1132,
    channelId: 5,
    title: 'Personal LinkedIn — discovery: how agents handle paid services',
    bodySha: '2ea7050c4f1a9c70cec7ccf2b7340bbcea4f4d305dbc18008f5fa172665f6632',
    schedule: '2026-10-12T09:00:00.000Z',
    manifest: 'sha256:e6178b5bfa7b08acb91dabfe7e34589e6067ae4b2d6270fbc0be8f983b6ef2bb',
    profileUrl: 'https://www.linkedin.com/in/innokentyb/'
} as const;

const COMMAND = 'ba_repair_linkedin_task1132_language';
type JsonRecord = Record<string, unknown>;
type TaskRecord = {
    id: number; project_id: number; channel_id: number | null; type: string; status: string;
    publication_mode: string | null; content_revision: number; accepted_revision: number | null;
    text_state: string; handoff_state: string; visual_state: string; visual_placement: string | null;
    selected_asset_id: number | null; title: string | null; draft_text: string | null;
    schedule_at: Date | null; publish_at: Date | null; published_link: string | null;
    quality_report: unknown; publication_fact: unknown;
    channel: { id: number; type: string; name: string; is_active: boolean; config: unknown } | null;
};
type DbPort = {
    projectMember: { findUnique(args: unknown): Promise<{ role: string } | null> };
    contentItem: {
        findFirst(args: unknown): Promise<TaskRecord | null>;
        updateMany(args: unknown): Promise<{ count: number }>;
    };
    deliveryAttempt: { findFirst(args: unknown): Promise<{ id: number; status: string;
        requires_manual_confirmation: boolean; error_message: string | null } | null> };
    workItem: { findFirst(args: unknown): Promise<{ id: number } | null> };
    workflowEvent: {
        findFirst(args: unknown): Promise<{ before_state: unknown; after_state: unknown } | null>;
        create(args: unknown): Promise<unknown>;
    };
    $transaction<T>(operation: (tx: DbPort) => Promise<T>): Promise<T>;
};
type Args = {
    projectId: 7; taskId: 1132; actorId: string;
    expectedManifestChecksum: typeof LINKEDIN1132_LANGUAGE.manifest;
    expectedBodySha256: typeof LINKEDIN1132_LANGUAGE.bodySha;
    expectedScheduleAt: typeof LINKEDIN1132_LANGUAGE.schedule;
    idempotencyKey: string; confirm?: boolean;
};
type Dependencies = {
    hashBody(body: string): string;
    manifestLoader: typeof loadAgentWorkspaceManifest;
};

const defaults: Dependencies = {
    hashBody: body => createHash('sha256').update(body).digest('hex'),
    manifestLoader: loadAgentWorkspaceManifest
};

function record(value: unknown): JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonRecord : {};
}

async function exactTask(db: DbPort, hashBody: (body: string) => string) {
    const [task, attempt, browserWorkItem] = await Promise.all([
        db.contentItem.findFirst({
            where: { id: LINKEDIN1132_LANGUAGE.taskId, project_id: LINKEDIN1132_LANGUAGE.projectId },
            include: { channel: true, publication_fact: true }
        }),
        db.deliveryAttempt.findFirst({ where: {
            project_id: LINKEDIN1132_LANGUAGE.projectId,
            content_item_id: LINKEDIN1132_LANGUAGE.taskId
        }, orderBy: { attempt_number: 'desc' } }),
        db.workItem.findFirst({ where: {
            project_id: LINKEDIN1132_LANGUAGE.projectId,
            content_item_id: LINKEDIN1132_LANGUAGE.taskId,
            kind: 'browser_publish', state: { notIn: ['completed', 'cancelled'] }
        } })
    ]);
    const quality = record(task?.quality_report);
    const handoff = record(quality.handoff_bundle);
    const channelConfig = record(task?.channel?.config);
    if (!task || task.channel_id !== LINKEDIN1132_LANGUAGE.channelId
        || task.channel?.id !== LINKEDIN1132_LANGUAGE.channelId
        || task.channel.type !== 'linkedin' || task.channel.name !== 'innokentiy_linkedin'
        || task.channel.is_active !== true
        || channelConfig.account_ref !== LINKEDIN1132_LANGUAGE.profileUrl
        || channelConfig.workflow_mode !== 'browser_required'
        || channelConfig.connector_mode !== 'browser_assisted'
        || task.type !== 'publication' || task.status !== 'ready_for_execution'
        || task.publication_mode !== 'approval_required'
        || task.content_revision !== 1 || task.accepted_revision !== 1
        || task.text_state !== 'accepted' || task.handoff_state !== 'ready'
        || task.visual_state !== 'NO_VISUAL_NEEDED' || task.visual_placement !== 'feed'
        || task.selected_asset_id !== null || task.title !== LINKEDIN1132_LANGUAGE.title
        || hashBody(task.draft_text || '') !== LINKEDIN1132_LANGUAGE.bodySha
        || task.schedule_at?.toISOString() !== LINKEDIN1132_LANGUAGE.schedule
        || task.publish_at?.toISOString() !== LINKEDIN1132_LANGUAGE.schedule
        || task.publication_fact || task.published_link || !classifyPriorAttempt(attempt).retrySafe || browserWorkItem
        || quality.owner_release !== undefined || quality.content_language !== undefined
        || handoff.content_language !== 'ru') {
        throw new Error('[LINKEDIN1132_LANGUAGE_GUARD_FAILED] Exact accepted package changed');
    }
    return { task, quality, handoff };
}

export async function repairLinkedInTask1132Language(
    args: Args,
    database: DbPort = prisma as unknown as DbPort,
    dependencies: Dependencies = defaults
) {
    if (args.projectId !== LINKEDIN1132_LANGUAGE.projectId
        || args.taskId !== LINKEDIN1132_LANGUAGE.taskId
        || args.expectedManifestChecksum !== LINKEDIN1132_LANGUAGE.manifest
        || args.expectedBodySha256 !== LINKEDIN1132_LANGUAGE.bodySha
        || args.expectedScheduleAt !== LINKEDIN1132_LANGUAGE.schedule
        || !args.idempotencyKey.trim()) {
        throw new Error('[LINKEDIN1132_LANGUAGE_SCOPE_MISMATCH]');
    }
    const actor = /^user:(\d+)$/.exec(args.actorId);
    if (!actor) throw new Error('[OWNER_REQUIRED]');
    const member = await database.projectMember.findUnique({ where: { project_id_user_id: {
        project_id: LINKEDIN1132_LANGUAGE.projectId, user_id: Number(actor[1])
    } } });
    if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    const requestHash = createHash('sha256').update(JSON.stringify(args)).digest('hex');
    const prior = await database.workflowEvent.findFirst({ where: {
        project_id: LINKEDIN1132_LANGUAGE.projectId, actor_id: args.actorId,
        command: COMMAND, idempotency_key: args.idempotencyKey
    } });
    if (prior?.after_state) {
        if (record(prior.before_state).request_hash !== requestHash) {
            throw new Error('[IDEMPOTENCY_CONFLICT]');
        }
        return { ...record(prior.after_state), replayed: true };
    }
    await exactTask(database, dependencies.hashBody);
    const preview = {
        project_id: LINKEDIN1132_LANGUAGE.projectId,
        task_id: LINKEDIN1132_LANGUAGE.taskId,
        channel_id: LINKEDIN1132_LANGUAGE.channelId,
        content_revision: 1, accepted_revision: 1,
        body_sha256: LINKEDIN1132_LANGUAGE.bodySha,
        schedule_at: LINKEDIN1132_LANGUAGE.schedule,
        profile_url: LINKEDIN1132_LANGUAGE.profileUrl,
        from: { content_language: 'ru' as const },
        to: { content_language: 'en' as const },
        handoff_bundle_rematerialized: args.confirm === true,
        release_created: false, provider_called: false,
        publication_fact_created: false, replayed: false
    };
    if (!args.confirm) return preview;
    const manifest = await dependencies.manifestLoader(
        LINKEDIN1132_LANGUAGE.projectId, Number(actor[1])
    );
    if (manifest.checksum !== LINKEDIN1132_LANGUAGE.manifest) throw new Error('[STALE_MANIFEST]');
    return database.$transaction(async tx => {
        const current = await exactTask(tx, dependencies.hashBody);
        const nextQuality = {
            ...current.quality,
            content_language: 'en',
            handoff_bundle: { ...current.handoff, content_language: 'en' }
        };
        const changed = await tx.contentItem.updateMany({
            where: {
                id: LINKEDIN1132_LANGUAGE.taskId,
                project_id: LINKEDIN1132_LANGUAGE.projectId,
                channel_id: LINKEDIN1132_LANGUAGE.channelId,
                status: 'ready_for_execution', publication_mode: 'approval_required',
                content_revision: 1, accepted_revision: 1, selected_asset_id: null,
                schedule_at: new Date(LINKEDIN1132_LANGUAGE.schedule),
                publish_at: new Date(LINKEDIN1132_LANGUAGE.schedule)
            },
            data: { quality_report: nextQuality }
        });
        if (changed.count !== 1) throw new Error('[LINKEDIN1132_LANGUAGE_CAS_CONFLICT]');
        const result = { ...preview, handoff_bundle_rematerialized: true };
        await tx.workflowEvent.create({ data: {
            project_id: LINKEDIN1132_LANGUAGE.projectId,
            content_item_id: LINKEDIN1132_LANGUAGE.taskId,
            actor_id: args.actorId, command: COMMAND,
            idempotency_key: args.idempotencyKey,
            before_state: {
                request_hash: requestHash, content_language: 'ru',
                status: current.task.status,
                publication_mode: current.task.publication_mode
            },
            after_state: result
        } });
        return result;
    });
}

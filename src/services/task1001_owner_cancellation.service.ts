import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';

export const TASK1001_MANIFEST_CHECKSUM =
    'sha256:6ceb5c1c2199d8c1915beeb622a9791ff9c1b877d02649c8e69acd0d173e46d8';
export const TASK1001_CANCELLATION_KEY = 'cancel-p10-task1001-portfolio-hq-20261011-v1';
const COMMAND = 'ba_cancel_task1001_owner';
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export type Task1001CancellationArgs = {
    projectId: 10;
    taskId: 1001;
    actorId: string;
    expectedManifestChecksum: typeof TASK1001_MANIFEST_CHECKSUM;
    expectedStatus: 'planned';
    expectedPublicationMode: 'approval_required';
    expectedContentRevision: 0;
    expectedAcceptedRevision: null;
    expectedBodySha256: typeof EMPTY_SHA256;
    expectedSelectedAssetId: null;
    expectedDeliveryAttemptCount: 0;
    expectedContentWriteState: 'available';
    expectedPendingCheckpointCount: 3;
    ownerAuthorizationReference: string;
    idempotencyKey: typeof TASK1001_CANCELLATION_KEY;
};

type Dependencies = {
    database: typeof prisma;
    manifestLoader(projectId: number, userId: number): Promise<{ checksum: string }>;
};

type Task1001CancellationResult = {
    project_id: 10;
    affected_task_ids: number[];
    status: 'cancelled';
    publication_mode: 'retired';
    content_revision: 0;
    accepted_revision: null;
    selected_asset_id: null;
    preserved_content_write_ids: number[];
    preserved_checkpoint_ids: number[];
    publication_sent: false;
    connector_called: false;
    history_preserved: true;
    audit_id: number;
    replayed: boolean;
};

const dependencies: Dependencies = { database: prisma, manifestLoader: loadAgentWorkspaceManifest };

function object(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}

function requestHash(args: Task1001CancellationArgs): string {
    return createHash('sha256').update(JSON.stringify(args)).digest('hex');
}

function assertArgs(args: Task1001CancellationArgs): number {
    const actor = /^user:(\d+)$/.exec(args.actorId);
    if (!actor || args.projectId !== 10 || args.taskId !== 1001
        || args.expectedManifestChecksum !== TASK1001_MANIFEST_CHECKSUM
        || args.expectedStatus !== 'planned' || args.expectedPublicationMode !== 'approval_required'
        || args.expectedContentRevision !== 0 || args.expectedAcceptedRevision !== null
        || args.expectedBodySha256 !== EMPTY_SHA256 || args.expectedSelectedAssetId !== null
        || args.expectedDeliveryAttemptCount !== 0 || args.expectedContentWriteState !== 'available'
        || args.expectedPendingCheckpointCount !== 3 || args.idempotencyKey !== TASK1001_CANCELLATION_KEY
        || !args.ownerAuthorizationReference.trim()) {
        throw new Error('[TASK1001_CANCELLATION_SCOPE_MISMATCH]');
    }
    return Number(actor[1]);
}

async function loadGuardedState(database: typeof prisma) {
    const [task, attemptCount] = await Promise.all([
        database.contentItem.findFirst({ where: { id: 1001, project_id: 10 },
            include: { publication_fact: true, image_assets: true,
                work_items: { orderBy: { id: 'asc' } } } }),
        database.deliveryAttempt.count({ where: { project_id: 10, content_item_id: 1001 } })
    ]);
    const delivery = object(object(task?.quality_report).publication_task_delivery);
    const contentWrites = task?.work_items.filter(item => item.kind === 'content_write') || [];
    const checkpoints = task?.work_items.filter(item => item.kind === 'metric_checkpoint') || [];
    if (!task || task.id !== 1001 || task.project_id !== 10 || task.status !== 'planned'
        || task.publication_mode !== 'approval_required' || task.content_revision !== 0
        || task.accepted_revision !== null
        || createHash('sha256').update(task.draft_text || '').digest('hex') !== EMPTY_SHA256
        || task.selected_asset_id !== null || task.image_assets.length !== 0
        || task.publication_fact || task.published_link || Object.keys(delivery).length !== 0
        || attemptCount !== 0 || contentWrites.length !== 1 || contentWrites[0].state !== 'available'
        || checkpoints.length !== 3 || checkpoints.some(checkpoint => checkpoint.state !== 'pending')) {
        throw new Error('[TASK1001_CANCELLATION_GUARD_FAILED] Exact planned empty task changed');
    }
    return { task, checkpoints };
}

/** Cancel only the exact unused task1001 obligation; never publishes or mutates its history. */
export async function cancelTask1001Owner(args: Task1001CancellationArgs,
    deps: Dependencies = dependencies): Promise<Task1001CancellationResult> {
    const userId = assertArgs(args);
    const hash = requestHash(args);
    const [owner, manifest, existing] = await Promise.all([
        deps.database.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: userId } } }),
        deps.manifestLoader(10, userId),
        deps.database.workflowEvent.findUnique({ where: { project_id_actor_id_command_idempotency_key: {
            project_id: 10, actor_id: args.actorId, command: COMMAND,
            idempotency_key: args.idempotencyKey
        } } })
    ]);
    if (owner?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    if (manifest.checksum !== TASK1001_MANIFEST_CHECKSUM) throw new Error('[STALE_MANIFEST]');
    if (existing) {
        if (object(existing.before_state).request_hash !== hash) throw new Error('[IDEMPOTENCY_KEY_CONFLICT]');
        return { ...object(existing.after_state), audit_id: existing.id,
            replayed: true } as Task1001CancellationResult;
    }
    await loadGuardedState(deps.database);
    return deps.database.$transaction(async tx => {
        const [currentOwner, currentManifest, replay] = await Promise.all([
            tx.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: userId } } }),
            deps.manifestLoader(10, userId),
            tx.workflowEvent.findUnique({ where: { project_id_actor_id_command_idempotency_key: {
                project_id: 10, actor_id: args.actorId, command: COMMAND,
                idempotency_key: args.idempotencyKey
            } } })
        ]);
        if (currentOwner?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        if (currentManifest.checksum !== TASK1001_MANIFEST_CHECKSUM) throw new Error('[STALE_MANIFEST]');
        if (replay) {
            if (object(replay.before_state).request_hash !== hash) throw new Error('[IDEMPOTENCY_KEY_CONFLICT]');
            return { ...object(replay.after_state), audit_id: replay.id,
                replayed: true } as Task1001CancellationResult;
        }
        const state = await loadGuardedState(tx as typeof prisma);
        const changed = await tx.contentItem.updateMany({ where: { id: 1001, project_id: 10,
            status: 'planned', publication_mode: 'approval_required', content_revision: 0,
            accepted_revision: null, selected_asset_id: null, publication_fact: null,
            published_link: null }, data: { status: 'cancelled', publication_mode: 'retired' } });
        if (changed.count !== 1) throw new Error('[TASK1001_CANCELLATION_CAS_CONFLICT]');
        const result: Omit<Task1001CancellationResult, 'audit_id'> = {
            project_id: 10, affected_task_ids: [1001], status: 'cancelled',
            publication_mode: 'retired', content_revision: 0, accepted_revision: null,
            selected_asset_id: null, preserved_content_write_ids: state.task.work_items
                .filter(item => item.kind === 'content_write').map(item => item.id),
            preserved_checkpoint_ids: state.checkpoints.map(checkpoint => checkpoint.id),
            publication_sent: false, connector_called: false, history_preserved: true, replayed: false
        };
        const audit = await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1001,
            actor_id: args.actorId, command: COMMAND, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: hash, approval_reference: args.ownerAuthorizationReference,
                status: state.task.status, publication_mode: state.task.publication_mode,
                content_revision: state.task.content_revision, accepted_revision: state.task.accepted_revision,
                selected_asset_id: state.task.selected_asset_id,
                content_write_ids: result.preserved_content_write_ids,
                checkpoint_ids: result.preserved_checkpoint_ids } as Prisma.InputJsonValue,
            after_state: result as Prisma.InputJsonValue } });
        return { ...result, audit_id: audit.id, replayed: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

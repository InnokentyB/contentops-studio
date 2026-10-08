import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { visualMetadataFromProvenance } from './visual_asset_binding.service';

const PROJECT_ID = 10;
const PROJECT_SLUG = 'analystcraft-2';
const TASK_ID = 1084;
const CHANNEL_ID = 117;
const ASSET_ID = 118;
const RETIREMENT_AUDIT_ID = 2629;
const BODY_SHA = '604452f079a35149d6934713f3f30b451d24cd4db726488b4724125a3db14594';
const ASSET_SHA = '8032717b6898e1dd915e585a481aa27696d7aa383b0a51277a4e912f89caeca1';
const COMMAND = 'ba_restore_vk_task1084_from_erroneous_retirement';
const BLOCKER = 'VK_NATIVE_VIDEO_ADAPTER_UNSUPPORTED';
const ENGINEERING_DEDUPE_KEY = 'vk_native_video_transport:10:1084';

export type RestoreVkTask1084Args = {
    projectId: 10;
    projectSlug: 'analystcraft-2';
    taskId: 1084;
    actorId: string;
    expectedManifestChecksum: string;
    registrySnapshotVersion: number;
    registrySnapshotHash: string;
    expectedRetirementAuditId: 2629;
    expectedBodySha256: string;
    expectedAssetSha256: string;
    approvalReference: string;
    reason: string;
    dryRun?: boolean;
    idempotencyKey?: string;
};

type Dependencies = {
    loadManifest(projectId: number, userId: number): Promise<{ checksum: string; project?: { id?: number; slug?: string } }>;
    now(): Date;
};

function sha256(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function actorUserId(actorId: string) {
    const match = /^user:(\d+)$/.exec(actorId);
    if (!match) throw new Error('[OWNER_REQUIRED]');
    return Number(match[1]);
}

function assertInput(args: RestoreVkTask1084Args) {
    if (args.projectId !== PROJECT_ID || args.projectSlug !== PROJECT_SLUG || args.taskId !== TASK_ID
        || args.expectedRetirementAuditId !== RETIREMENT_AUDIT_ID) throw new Error('[TASK1084_RESTORE_SCOPE_MISMATCH]');
    if (args.expectedBodySha256 !== BODY_SHA || args.expectedAssetSha256 !== ASSET_SHA) {
        throw new Error('[TASK1084_RESTORE_BINDING_MISMATCH]');
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(args.expectedManifestChecksum)
        || !/^[a-f0-9]{64}$/.test(args.registrySnapshotHash) || args.registrySnapshotVersion < 1) {
        throw new Error('[REGISTRY_MANIFEST_EVIDENCE_INVALID]');
    }
    if (args.approvalReference.trim().length < 10 || args.reason.trim().length < 20) {
        throw new Error('[OWNER_RESTORE_DECISION_REQUIRED]');
    }
}

/** Restores only task 1084 from audit 2629. It never publishes or changes its accepted package. */
export async function restoreVkTask1084(
    args: RestoreVkTask1084Args,
    database: typeof prisma = prisma,
    dependencies: Dependencies = { loadManifest: loadAgentWorkspaceManifest, now: () => new Date() }
) {
    assertInput(args);
    const userId = actorUserId(args.actorId);
    return database.$transaction(async tx => {
        const [membership, project, manifest] = await Promise.all([
            tx.projectMember.findUnique({ where: { project_id_user_id: { project_id: PROJECT_ID, user_id: userId } }, select: { role: true } }),
            tx.project.findUnique({ where: { id: PROJECT_ID }, select: { id: true, slug: true } }),
            dependencies.loadManifest(PROJECT_ID, userId)
        ]);
        if (membership?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        if (project?.slug !== PROJECT_SLUG || (manifest.project?.id && manifest.project.id !== PROJECT_ID)
            || (manifest.project?.slug && manifest.project.slug !== PROJECT_SLUG)) throw new Error('[MCP_PROJECT_SCOPE_MISMATCH]');
        if (manifest.checksum !== args.expectedManifestChecksum) throw new Error('[STALE_MANIFEST]');

        const commandWhere = { project_id: PROJECT_ID, actor_id: args.actorId, command: COMMAND,
            idempotency_key: args.idempotencyKey };
        if (args.dryRun === false) {
            if (!args.idempotencyKey?.trim()) throw new Error('[IDEMPOTENCY_KEY_REQUIRED]');
            const prior = await tx.workflowEvent.findFirst({ where: commandWhere });
            if (prior) {
                const before = prior.before_state as { request_hash?: string } | null;
                const requestHash = sha256({ ...args, dryRun: false, idempotencyKey: args.idempotencyKey });
                if (before?.request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
                return { ...(prior.after_state as Record<string, unknown>), replayed: true, audit_id: prior.id };
            }
        }

        const [task, retirementAudit, attempts, workItems] = await Promise.all([
            tx.contentItem.findFirst({ where: { id: TASK_ID, project_id: PROJECT_ID },
                include: { channel: true, selected_asset: true, publication_fact: true } }),
            tx.workflowEvent.findFirst({ where: { id: RETIREMENT_AUDIT_ID, project_id: PROJECT_ID,
                command: 'ba_apply_publication_retirement' } }),
            tx.deliveryAttempt.findMany({ where: { project_id: PROJECT_ID, content_item_id: TASK_ID },
                select: { id: true, status: true, created_at: true, actual_published_at: true } }),
            tx.workItem.findMany({ where: { project_id: PROJECT_ID, content_item_id: TASK_ID },
                select: { id: true, kind: true, state: true, lease_expires_at: true, dedupe_key: true } })
        ]);
        const retiredIds = (retirementAudit?.after_state as { result?: { retired_task_ids?: number[] } } | null)
            ?.result?.retired_task_ids || [];
        if (!retiredIds.includes(TASK_ID)) throw new Error('[RETIREMENT_AUDIT_GUARD_FAILED]');
        const metadata = visualMetadataFromProvenance(task?.selected_asset?.provenance);
        const bodyHash = createHash('sha256').update(task?.draft_text || '').digest('hex');
        if (!task || task.channel_id !== CHANNEL_ID || task.channel?.type !== 'vk'
            || task.channel.name !== 'analystcraft_vk_group' || task.visual_placement !== 'feed'
            || task.content_revision !== 1 || task.accepted_revision !== 1 || task.text_state !== 'accepted'
            || task.visual_state !== 'APPROVED' || task.selected_asset_id !== ASSET_ID
            || task.selected_asset?.status !== 'approved' || task.selected_asset.content_revision !== 1
            || task.selected_asset.decision_id !== 246 || metadata.sha256 !== ASSET_SHA
            || metadata.mime_type !== 'video/mp4' || bodyHash !== BODY_SHA
            || task.status !== 'cancelled' || task.publication_mode !== 'retired'
            || task.publication_fact || task.published_link) throw new Error('[TASK1084_RESTORE_STATE_CHANGED]');
        if (attempts.length > 0) throw new Error('[DELIVERY_ATTEMPT_EXISTS]');
        const activeLease = workItems.some(item => item.state === 'claimed'
            && (!item.lease_expires_at || item.lease_expires_at.getTime() > dependencies.now().getTime()));
        if (activeLease) throw new Error('[PUBLICATION_OPERATION_ACTIVE_OR_UNCERTAIN]');

        const preview = {
            project_id: PROJECT_ID, project_slug: PROJECT_SLUG, task_id: TASK_ID,
            previous_status: 'cancelled', status: 'blocked', previous_publication_mode: 'retired',
            publication_mode: 'owner_released', handoff_state: 'blocked', accepted_revision: 1,
            selected_asset_id: ASSET_ID, body_sha256: BODY_SHA, asset_sha256: ASSET_SHA,
            blocker: BLOCKER, next_owner: 'ContentOps integration owner', retirement_audit_id: RETIREMENT_AUDIT_ID,
            original_schedule_at: task.schedule_at?.toISOString() || null, recovery_schedule_at: null,
            publication_sent: false, fact_created: false, attempts_present: false, active_lease: false
        };
        if (args.dryRun !== false) return { ...preview, dry_run: true, restore_allowed: true };

        const report = (task.quality_report as Record<string, Prisma.InputJsonValue> | null) || {};
        const restoredAt = dependencies.now();
        const changed = await tx.contentItem.updateMany({ where: {
            id: TASK_ID, project_id: PROJECT_ID, updated_at: task.updated_at, channel_id: CHANNEL_ID,
            status: 'cancelled', publication_mode: 'retired', content_revision: 1, accepted_revision: 1,
            selected_asset_id: ASSET_ID, publication_fact: null
        }, data: { status: 'blocked', handoff_state: 'blocked', publication_mode: 'owner_released', quality_report: { ...report,
            owner_restore_decision: { actor_id: args.actorId, approval_reference: args.approvalReference,
                reason: args.reason.trim(), restored_from_audit_id: RETIREMENT_AUDIT_ID,
                restored_at: restoredAt.toISOString(), blocker: BLOCKER,
                original_schedule_at: task.schedule_at?.toISOString() || null, recovery_schedule_required: true }
        } } });
        if (changed.count !== 1) throw new Error('[TASK1084_RESTORE_CAS_CONFLICT]');

        let engineeringWorkItem = workItems.find(item => item.dedupe_key === ENGINEERING_DEDUPE_KEY);
        if (!engineeringWorkItem) {
            engineeringWorkItem = await tx.workItem.create({ data: {
                project_id: PROJECT_ID, week_package_id: task.week_package_id, content_item_id: TASK_ID,
                item_key: 'vk-native-video-transport-1084', kind: 'vk_native_video_transport', state: 'blocked',
                assignee_role: 'publisher', due_at: null, input_context_version: 1,
                reason_code: BLOCKER, note: 'Provide an audited live VK native feed-video transport. Browser bypass is not authorized.',
                missing_resource_refs: [{ type: 'vk_native_video_adapter', channel_id: CHANNEL_ID }],
                result_payload: { publication_task_id: TASK_ID, recovery_schedule_required: true },
                dedupe_key: ENGINEERING_DEDUPE_KEY
            } });
        }
        const requestHash = sha256({ ...args, dryRun: false, idempotencyKey: args.idempotencyKey });
        const result = { ...preview, engineering_work_item_id: engineeringWorkItem.id,
            restored_at: restoredAt.toISOString(), replayed: false };
        const audit = await tx.workflowEvent.create({ data: { project_id: PROJECT_ID, content_item_id: TASK_ID,
            actor_id: args.actorId, command: COMMAND, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: requestHash, approval_reference: args.approvalReference,
                reason: args.reason.trim(), registry_snapshot_version: args.registrySnapshotVersion,
                registry_snapshot_hash: args.registrySnapshotHash, manifest_checksum: args.expectedManifestChecksum,
                retirement_audit_id: RETIREMENT_AUDIT_ID, status: task.status,
                publication_mode: task.publication_mode, schedule_at: task.schedule_at?.toISOString() || null },
            after_state: result } });
        return { ...result, audit_id: audit.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

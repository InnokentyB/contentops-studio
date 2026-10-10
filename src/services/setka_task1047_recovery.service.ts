import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import publicationFactService from './publication_fact.service';
import workQueueService from './work_queue.service';

export const SETKA1047 = {
    projectId: 10, taskId: 1047, channelId: 126, revision: 4, decisionId: 269,
    assetId: 131, bodySha256: '316784004cf66c1ffb3a27f7149327797d2645d401e2a061c79fd3320e9a9d38',
    assetSha256: 'a18ec6bc8adb89444fe26a3e72b1072e9c0b03a77a11c27ec8a8b65d17e29e43',
    schedule: '2026-10-10T14:00:00.000Z',
    manifest: 'sha256:d5970e6b33d5f161a73f6ebc13fb5255f5a24be4f14251e57e5223ea03a2192f',
    accountRef: 'analystcraft_setka', registryProfileId: 'profile_126',
    profileUrl: 'https://setka.ru/users/019c99e2-fb9d-78e0-9876-9c4a360bb4dc'
} as const;

type ReleaseArgs = {
    projectId: 10; taskId: 1047; actorId: string; expectedChannelId: 126;
    expectedContentRevision: 4; expectedAcceptedRevision: 4;
    expectedBodySha256: typeof SETKA1047.bodySha256; expectedDecisionId: 269;
    expectedSelectedAssetId: 131; expectedAssetSha256: typeof SETKA1047.assetSha256;
    expectedScheduleAt: typeof SETKA1047.schedule; expectedManifestChecksum: typeof SETKA1047.manifest;
    expectedRegistryProfileId: 'profile_126'; expectedProfileUrl: typeof SETKA1047.profileUrl;
    approvalReference: string; idempotencyKey: string;
};

type BoundaryArgs = {
    projectId: 10; taskId: 1047; channelId: 126; actorId: string; workItemId: number;
    leaseToken: string; approvalReference: string; idempotencyKey: string;
    contentRevision: 4; textSha256: typeof SETKA1047.bodySha256;
    selectedAssetId: 131; imageSha256: typeof SETKA1047.assetSha256;
};
type ConfirmArgs = BoundaryArgs & { attemptId: number; publicUrl: string; providerObjectId: string;
    publishedAt: string; evidenceSha256: string };
type UncertainArgs = Pick<BoundaryArgs, 'projectId' | 'taskId' | 'actorId' | 'workItemId' | 'leaseToken' | 'idempotencyKey'>
    & { attemptId: number; reasonCode: string };

type Dependencies = {
    transaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
    manifest(projectId: number, userId: number): Promise<{ checksum: string }>;
    now(): Date;
    hashBody(body: string): string;
    recordFact(args: Parameters<typeof publicationFactService.record>[0]): ReturnType<typeof publicationFactService.record>;
};

type ExactTask = Prisma.ContentItemGetPayload<{ include: {
    channel: true; selected_asset: true; publication_fact: true;
} }>;
type LeaseArgs = { workItemId: number; actorId: string; leaseToken: string };

const deps: Dependencies = {
    transaction: callback => prisma.$transaction(tx => callback(tx), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    }),
    manifest: loadAgentWorkspaceManifest,
    now: () => new Date(),
    hashBody: body => createHash('sha256').update(body).digest('hex'),
    recordFact: args => publicationFactService.record(args)
};

function object(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function actorUserId(actorId: string) {
    const match = /^user:(\d+)$/.exec(actorId);
    if (!match) throw new Error('[OWNER_REQUIRED]');
    return Number(match[1]);
}

function requestHash(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function assetHash(task: ExactTask | null) {
    return object(object(task?.selected_asset?.provenance).planner_storage).sha256 || null;
}

function assertExactReleaseArgs(args: ReleaseArgs) {
    if (args.projectId !== SETKA1047.projectId || args.taskId !== SETKA1047.taskId
        || args.expectedChannelId !== SETKA1047.channelId || args.expectedContentRevision !== SETKA1047.revision
        || args.expectedAcceptedRevision !== SETKA1047.revision || args.expectedBodySha256 !== SETKA1047.bodySha256
        || args.expectedDecisionId !== SETKA1047.decisionId || args.expectedSelectedAssetId !== SETKA1047.assetId
        || args.expectedAssetSha256 !== SETKA1047.assetSha256 || args.expectedScheduleAt !== SETKA1047.schedule
        || args.expectedManifestChecksum !== SETKA1047.manifest
        || args.expectedRegistryProfileId !== SETKA1047.registryProfileId
        || args.expectedProfileUrl !== SETKA1047.profileUrl) throw new Error('[SETKA1047_SCOPE_MISMATCH]');
    if (!args.approvalReference.trim()) throw new Error('[OWNER_APPROVAL_REFERENCE_REQUIRED]');
    if (!args.idempotencyKey.trim()) throw new Error('[IDEMPOTENCY_KEY_REQUIRED]');
}

function assertReleasePackage(task: ExactTask | null, decision: { id: number; decision_version: number;
    source_content_revision: number; placement: string | null; decision: string; status: string } | null,
attempt: { id: number } | null, browserWork: { id: number } | null,
hashBody: (body: string) => string): asserts task is ExactTask {
    const storage = object(object(task?.selected_asset?.provenance).planner_storage);
    if (!task || task.channel_id !== 126 || task.channel?.type !== 'setka'
        || task.channel.name !== 'analystcraft_setka' || task.channel.is_active !== true
        || task.status !== 'ready_for_execution' || task.publication_mode !== 'approval_required'
        || task.handoff_state !== 'ready' || task.content_revision !== 4 || task.accepted_revision !== 4
        || task.text_state !== 'accepted' || hashBody(task.draft_text || '') !== SETKA1047.bodySha256
        || task.visual_state !== 'APPROVED' || task.visual_placement !== 'feed'
        || task.visual_decision_version !== 2 || task.selected_asset_id !== 131
        || task.schedule_at?.toISOString() !== SETKA1047.schedule || task.publish_at?.toISOString() !== SETKA1047.schedule
        || task.publication_fact || task.published_link || attempt || browserWork
        || !decision || decision.id !== 269 || decision.decision_version !== 2
        || decision.source_content_revision !== 4 || decision.placement !== 'feed'
        || decision.decision !== 'GENERATE' || decision.status !== 'active'
        || task.selected_asset?.decision_id !== 269 || task.selected_asset.content_revision !== 4
        || task.selected_asset.placement !== 'feed' || task.selected_asset.status !== 'approved'
        || storage.managed !== true || storage.provider !== 'r2' || storage.mime_type !== 'image/png'
        || storage.sha256 !== SETKA1047.assetSha256) throw new Error('[SETKA1047_RELEASE_GUARD_FAILED]');
}

export async function releaseSetkaTask1047(args: ReleaseArgs, dependencies: Dependencies = deps) {
    assertExactReleaseArgs(args);
    const userId = actorUserId(args.actorId);
    const hash = requestHash(args);
    return dependencies.transaction(async tx => {
        const command = 'ba_release_setka_task1047_browser';
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1047,
            command, idempotency_key: args.idempotencyKey, actor_id: args.actorId } });
        if (prior?.after_state) {
            if (object(prior.before_state).request_hash !== hash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...object(prior.after_state), replayed: true };
        }
        const membership = await tx.projectMember.findUnique({ where: { project_id_user_id: {
            project_id: 10, user_id: userId
        } } });
        if (membership?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        if ((await dependencies.manifest(10, userId)).checksum !== SETKA1047.manifest) throw new Error('[STALE_MANIFEST]');
        const [task, decision, attempt, browserWork] = await Promise.all([
            tx.contentItem.findFirst({ where: { id: 1047, project_id: 10 },
                include: { channel: true, selected_asset: true, publication_fact: true } }),
            tx.artDirectionDecision.findUnique({ where: { id: 269 } }),
            tx.deliveryAttempt.findFirst({ where: { project_id: 10, content_item_id: 1047 } }),
            tx.workItem.findFirst({ where: { project_id: 10, content_item_id: 1047, kind: 'browser_publish',
                state: { notIn: ['completed', 'cancelled'] } } })
        ]);
        assertReleasePackage(task, decision, attempt, browserWork, dependencies.hashBody);
        const previousConfig = object(task.channel!.config);
        const identity = { account_ref: SETKA1047.accountRef, profile_url: SETKA1047.profileUrl,
            display_name: 'Innokenty Bodrov', identity_kind: 'owned_personal_profile',
            registry_profile_id: SETKA1047.registryProfileId };
        const nextConfig = { ...previousConfig, ...identity, execution_modes: ['manual'],
            workflow_mode: 'browser_required', connector_mode: 'browser_assisted',
            capability_flags: { ...object(previousConfig.capability_flags), api_publish: false,
                browser_publish: true, manual_handoff: true } };
        const channelChanged = await tx.socialChannel.updateMany({ where: { id: 126, project_id: 10,
            type: 'setka', name: 'analystcraft_setka', is_active: true, updated_at: task.channel!.updated_at },
        data: { config: nextConfig as Prisma.InputJsonValue } });
        if (channelChanged.count !== 1) throw new Error('[SETKA1047_CHANNEL_CAS_CONFLICT]');
        const proof = { publication_authorized: true, actor_id: args.actorId,
            approval_reference: args.approvalReference, content_revision: 4,
            body_sha256: SETKA1047.bodySha256, selected_asset_id: 131,
            asset_sha256: SETKA1047.assetSha256, channel_id: 126, placement: 'feed', ...identity,
            released_at: dependencies.now().toISOString() };
        const quality = object(task.quality_report);
        const changed = await tx.contentItem.updateMany({ where: { id: 1047, project_id: 10, channel_id: 126,
            status: 'ready_for_execution', publication_mode: 'approval_required', handoff_state: 'ready',
            content_revision: 4, accepted_revision: 4, selected_asset_id: 131,
            schedule_at: new Date(SETKA1047.schedule), publish_at: new Date(SETKA1047.schedule) },
        data: { status: 'browser_required', publication_mode: 'browser_required', quality_report: {
            ...quality, publication_route: 'browser_required', target_identity: identity, owner_release: proof
        } as Prisma.InputJsonValue } });
        if (changed.count !== 1) throw new Error('[SETKA1047_RELEASE_CAS_CONFLICT]');
        const work = await tx.workItem.create({ data: { project_id: 10, week_package_id: task.week_package_id,
            content_item_id: 1047, item_key: task.item_key || 'publication-1047', kind: 'browser_publish',
            state: 'available', assignee_role: 'browser_publisher', due_at: task.schedule_at,
            reason_code: 'OWNER_RELEASED_BROWSER_PUBLICATION', input_context_version: 4,
            dedupe_key: 'browser_publish:1047:r4', note: 'Owner released exact Setka task 1047 for one browser/manual publication.',
            result_payload: proof as Prisma.InputJsonValue } });
        const result = { project_id: 10, task_id: 1047, channel_id: 126, content_revision: 4,
            accepted_revision: 4, body_sha256: SETKA1047.bodySha256, selected_asset_id: 131,
            asset_sha256: SETKA1047.assetSha256, schedule_at: SETKA1047.schedule,
            account_ref: SETKA1047.accountRef, profile_url: SETKA1047.profileUrl,
            publication_mode: 'browser_required', browser_work_item_id: work.id,
            published: false, replayed: false };
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1047, work_item_id: work.id,
            actor_id: args.actorId, command, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: hash, manifest_checksum: SETKA1047.manifest,
                status: task.status, publication_mode: task.publication_mode,
                channel_config: previousConfig } as Prisma.InputJsonValue,
            after_state: result as Prisma.InputJsonValue } });
        return result;
    });
}

export async function claimSetkaTask1047(args: { projectId: 10; actorId: string; workItemId: number;
    leaseSeconds?: number; idempotencyKey: string }) {
    const item = await prisma.workItem.findFirst({ where: { id: args.workItemId, project_id: 10,
        kind: 'browser_publish', assignee_role: 'browser_publisher', content_item: { id: 1047,
            channel_id: 126, channel: { type: 'setka' }, status: 'browser_required',
            publication_mode: 'browser_required', publication_fact: null, published_link: null } }, select: { id: true } });
    if (!item) throw new Error('[SETKA1047_BROWSER_WORK_ITEM_REQUIRED]');
    return workQueueService.claimWorkItem(args);
}

function assertLease(work: { id: number; kind: string; assignee_role: string; state: string;
    lease_actor_id: string | null; lease_token: string | null; lease_expires_at: Date | null } | null,
args: LeaseArgs, now: Date): asserts work is { id: number; kind: string; assignee_role: string; state: string;
    lease_actor_id: string | null; lease_token: string | null; lease_expires_at: Date | null } {
    if (!work || work.id !== args.workItemId || work.kind !== 'browser_publish'
        || work.assignee_role !== 'browser_publisher' || work.state !== 'claimed'
        || work.lease_actor_id !== args.actorId || work.lease_token !== args.leaseToken
        || !work.lease_expires_at || new Date(work.lease_expires_at) < now) throw new Error('[SETKA1047_ACTIVE_LEASE_REQUIRED]');
}

function assertBoundary(task: ExactTask | null, work: { result_payload: Prisma.JsonValue | null } | null,
args: BoundaryArgs, statuses: string[], hashBody: (body: string) => string): asserts task is ExactTask {
    const proof = object(work?.result_payload);
    if (!task || task.id !== 1047 || task.project_id !== 10 || task.channel_id !== 126
        || task.channel?.type !== 'setka' || !statuses.includes(task.status)
        || task.publication_mode !== 'browser_required' || task.content_revision !== 4 || task.accepted_revision !== 4
        || task.text_state !== 'accepted' || task.visual_state !== 'APPROVED' || task.visual_placement !== 'feed'
        || task.selected_asset_id !== 131 || task.selected_asset?.status !== 'approved'
        || task.publication_fact || task.published_link || hashBody(task.draft_text || '') !== args.textSha256
        || assetHash(task) !== args.imageSha256 || proof.publication_authorized !== true
        || proof.approval_reference !== args.approvalReference || proof.profile_url !== SETKA1047.profileUrl
        || proof.body_sha256 !== args.textSha256 || proof.asset_sha256 !== args.imageSha256) {
        throw new Error('[SETKA1047_SUBMISSION_GUARD_FAILED]');
    }
}

export async function startSetkaTask1047(args: BoundaryArgs, dependencies: Dependencies = deps) {
    return dependencies.transaction(async tx => {
        const work = await tx.workItem.findUnique({ where: { id: args.workItemId } });
        assertLease(work, args, dependencies.now());
        const task = await tx.contentItem.findFirst({ where: { id: 1047, project_id: 10 },
            include: { channel: true, selected_asset: true, publication_fact: true } });
        const existing = await tx.deliveryAttempt.findFirst({ where: { project_id: 10, content_item_id: 1047 } });
        if (existing) {
            if (existing.idempotency_key !== args.idempotencyKey) throw new Error('[SETKA1047_ATTEMPT_EXISTS] Retry forbidden');
            return { status: 'verification_required' as const, attempt_id: existing.id, retry_allowed: false, replayed: true };
        }
        assertBoundary(task, work, args, ['browser_required'], dependencies.hashBody);
        const attempt = await tx.deliveryAttempt.create({ data: { project_id: 10, content_item_id: 1047,
            channel_id: 126, mode: 'assisted', status: 'pending', attempt_number: 1,
            idempotency_key: args.idempotencyKey, scheduled_at: task.schedule_at,
            requires_manual_confirmation: true } });
        const changed = await tx.contentItem.updateMany({ where: { id: 1047, project_id: 10,
            status: 'browser_required', publication_mode: 'browser_required', content_revision: 4,
            accepted_revision: 4 }, data: { status: 'publishing' } });
        if (changed.count !== 1) throw new Error('[SETKA1047_START_CAS_CONFLICT]');
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1047,
            work_item_id: work.id, actor_id: args.actorId, command: 'ba_start_setka_task1047_browser_submission',
            idempotency_key: args.idempotencyKey, before_state: { status: task.status },
            after_state: { status: 'publishing', delivery_attempt_id: attempt.id } } });
        return { status: 'started' as const, attempt_id: attempt.id, retry_allowed: false, replayed: false };
    });
}

function providerIdentity(args: ConfirmArgs) {
    let url: URL;
    try { url = new URL(args.publicUrl); } catch { throw new Error('[SETKA1047_PROVIDER_IDENTITY_INVALID]'); }
    const match = /^\/posts\/([0-9a-f-]+)\/?$/.exec(url.pathname);
    const published = new Date(args.publishedAt);
    if (url.protocol !== 'https:' || url.hostname !== 'setka.ru' || !match
        || match[1] !== args.providerObjectId || !Number.isFinite(published.getTime())
        || !/^[a-f0-9]{64}$/.test(args.evidenceSha256)) throw new Error('[SETKA1047_PROVIDER_IDENTITY_INVALID]');
    return { publicUrl: `https://setka.ru/posts/${match[1]}`, publishedAt: published.toISOString() };
}

export async function confirmSetkaTask1047(args: ConfirmArgs, dependencies: Dependencies = deps) {
    const checked = await dependencies.transaction(async tx => {
        const work = await tx.workItem.findUnique({ where: { id: args.workItemId } });
        assertLease(work, args, dependencies.now());
        const task = await tx.contentItem.findFirst({ where: { id: 1047, project_id: 10 },
            include: { channel: true, selected_asset: true, publication_fact: true } });
        if (task?.publication_fact?.outcome === 'published' && task.publication_fact.public_url) {
            return { replayedFactId: task.publication_fact.id, identity: providerIdentity(args) };
        }
        assertBoundary(task, work, args, ['publishing', 'browser_required'], dependencies.hashBody);
        const attempt = await tx.deliveryAttempt.findFirst({ where: { id: args.attemptId, project_id: 10,
            content_item_id: 1047, channel_id: 126, idempotency_key: args.idempotencyKey } });
        if (!attempt || attempt.status !== 'pending') throw new Error('[SETKA1047_ATTEMPT_NOT_CONFIRMABLE]');
        return { replayedFactId: null, identity: providerIdentity(args) };
    });
    if (checked.replayedFactId) return { publication_fact_id: checked.replayedFactId, replayed: true };
    const fact = await dependencies.recordFact({ projectId: 10, taskId: 1047, actorId: args.actorId,
        artifactKind: 'post', outcome: 'published', publishedAt: checked.identity.publishedAt,
        publicUrl: checked.identity.publicUrl, providerObjectId: args.providerObjectId,
        confirmationMode: 'reconciled', evidence: { type: 'screenshot', ref: `sha256:${args.evidenceSha256}` },
        utmStatus: 'not_applicable', note: 'Setka browser publication confirmed by exact permalink readback.' });
    const factId = fact.publication_fact.id;
    await dependencies.transaction(async tx => {
        const changed = await tx.deliveryAttempt.updateMany({ where: { id: args.attemptId, project_id: 10,
            content_item_id: 1047, idempotency_key: args.idempotencyKey, status: 'pending' },
        data: { status: 'delivered', actual_published_at: new Date(checked.identity.publishedAt),
            requires_manual_confirmation: false, error_message: null } });
        if (changed.count !== 1) throw new Error('[SETKA1047_CONFIRM_CAS_CONFLICT]');
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1047, work_item_id: args.workItemId,
            actor_id: args.actorId, command: 'ba_confirm_setka_task1047_browser_submission',
            idempotency_key: `${args.idempotencyKey}:confirm`, before_state: { delivery_attempt_id: args.attemptId },
            after_state: { delivery_attempt_id: args.attemptId, status: 'delivered', publication_fact_id: factId } } });
    });
    return { publication_fact_id: factId, public_url: checked.identity.publicUrl, replayed: false };
}

export async function markSetkaTask1047Uncertain(args: UncertainArgs, dependencies: Dependencies = deps) {
    return dependencies.transaction(async tx => {
        const work = await tx.workItem.findUnique({ where: { id: args.workItemId } });
        assertLease(work, args, dependencies.now());
        const changed = await tx.deliveryAttempt.updateMany({ where: { id: args.attemptId, project_id: 10,
            content_item_id: 1047, idempotency_key: args.idempotencyKey, status: 'pending' },
        data: { requires_manual_confirmation: true, error_message: args.reasonCode } });
        if (changed.count !== 1) throw new Error('[SETKA1047_UNCERTAIN_CAS_CONFLICT]');
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1047,
            work_item_id: args.workItemId, actor_id: args.actorId,
            command: 'ba_mark_setka_task1047_browser_submission_uncertain',
            idempotency_key: `${args.idempotencyKey}:uncertain`, before_state: { delivery_attempt_id: args.attemptId },
            after_state: { delivery_attempt_id: args.attemptId, status: 'pending', retry_allowed: false,
                reason_code: args.reasonCode } } });
        return { status: 'verification_required' as const, attempt_id: args.attemptId, retry_allowed: false };
    });
}

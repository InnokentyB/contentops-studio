import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import publicationFactService from './publication_fact.service';
import workQueueService from './work_queue.service';

export const EXACT_BROWSER_PACKAGES = {
    medium: {
        projectId: 10, taskId: 1133, channelId: 172, revision: 2,
        bodySha256: '627b9253d5c6fcabc4505a4bf59cf93cb7fed6cefc310360ca3b5db65ff23430',
        assetId: 145,
        assetSha256: '87528eae6cb2a91280e55608874b7e2709f8055defc1518f2dc2619d076eee60',
        placement: 'article_cover', schedule: '2026-10-12T13:00:00.000Z',
        manifest: 'sha256:8b4a8d3741c0a89889a90c9ee4d3d9c69b36edbc704b9ebc5c1361c67492f76e',
        channelType: 'medium', artifactKind: 'article'
    },
    linkedin: {
        projectId: 7, taskId: 1132, channelId: 5, revision: 1,
        bodySha256: '2ea7050c4f1a9c70cec7ccf2b7340bbcea4f4d305dbc18008f5fa172665f6632',
        assetId: null,
        assetSha256: null,
        placement: 'feed', schedule: '2026-10-12T09:00:00.000Z',
        manifest: 'sha256:e6178b5bfa7b08acb91dabfe7e34589e6067ae4b2d6270fbc0be8f983b6ef2bb',
        channelType: 'linkedin', artifactKind: 'post'
    },
    x: {
        projectId: 10, taskId: 1107, channelId: 164, revision: 1,
        bodySha256: '2029e3fc10296091ba2331bcc2e666d5db895923111d37fb141cbec77171fdd4',
        assetId: null,
        assetSha256: null,
        placement: 'feed', schedule: '2026-10-12T15:00:00.000Z',
        manifest: 'sha256:4bfec7ca8399251c6c8f132a34d9e0952adbf1eef049d29325808cbd9db3975b',
        channelType: 'x', artifactKind: 'post'
    }
} as const;

export type ExactBrowserPlatform = keyof typeof EXACT_BROWSER_PACKAGES;
type ExactPackage = typeof EXACT_BROWSER_PACKAGES[ExactBrowserPlatform];
type AttemptSummary = { id: number; status: string; requires_manual_confirmation: boolean;
    error_message: string | null };
type BoundaryArgs = { platform: ExactBrowserPlatform; projectId: number; taskId: number; channelId: number;
    actorId: string; workItemId: number; leaseToken: string; approvalReference: string;
    idempotencyKey: string; contentRevision: number; textSha256: string;
    selectedAssetId: number | null; imageSha256: string | null };
type ConfirmArgs = BoundaryArgs & { attemptId: number; publicUrl: string; providerObjectId: string;
    publishedAt: string; evidenceSha256: string };
type UncertainArgs = Pick<BoundaryArgs, 'platform' | 'projectId' | 'taskId' | 'actorId' |
    'workItemId' | 'leaseToken' | 'idempotencyKey'> & { attemptId: number; reasonCode: string };

function object(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}
function actorUserId(actorId: string) {
    const match = /^user:(\d+)$/.exec(actorId);
    if (!match) throw new Error('[OWNER_REQUIRED]');
    return Number(match[1]);
}
function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function exact(platform: ExactBrowserPlatform): ExactPackage { return EXACT_BROWSER_PACKAGES[platform]; }
function assetHash(task: { selected_asset?: { provenance: unknown } | null } | null) {
    const provenance = object(task?.selected_asset?.provenance);
    return object(provenance.planner_storage).sha256 || provenance.sha256 || null;
}

export function classifyPriorAttempt(attempt: AttemptSummary | null) {
    if (!attempt) return { classification: 'absent' as const, retrySafe: true };
    const preProvider = attempt.status === 'failed' && attempt.requires_manual_confirmation === false
        && attempt.error_message === '[BROWSER_PRE_PROVIDER_ABORT_CONFIRMED]';
    return preProvider
        ? { classification: 'failed_pre_provider' as const, retrySafe: true, attemptId: attempt.id }
        : { classification: 'provider_or_uncertain' as const, retrySafe: false, attemptId: attempt.id };
}

export function validateProviderIdentity(platform: ExactBrowserPlatform, publicUrl: string,
providerObjectId: string, publishedAt: string) {
    let url: URL;
    try { url = new URL(publicUrl); } catch { throw new Error('[PROVIDER_IDENTITY_INVALID]'); }
    const published = new Date(publishedAt);
    if (!Number.isFinite(published.getTime()) || url.protocol !== 'https:') {
        throw new Error('[PROVIDER_IDENTITY_INVALID]');
    }
    if (platform === 'medium') {
        const match = /^\/@i\.a\.bodrov85\/[a-z0-9-]+-([a-f0-9]{12})\/?$/i.exec(url.pathname);
        if (url.hostname !== 'medium.com' || !match || match[1] !== providerObjectId) {
            throw new Error('[PROVIDER_IDENTITY_INVALID]');
        }
        return { publicUrl: `https://medium.com${url.pathname.replace(/\/$/, '')}`,
            providerObjectId, publishedAt: published.toISOString() };
    }
    if (platform === 'x') {
        const match = /^\/naraHeTc\/status\/(\d+)\/?$/.exec(url.pathname);
        if (url.hostname !== 'x.com' || !match || match[1] !== providerObjectId) {
            throw new Error('[PROVIDER_IDENTITY_INVALID]');
        }
        return { publicUrl: `https://x.com/naraHeTc/status/${providerObjectId}`,
            providerObjectId, publishedAt: published.toISOString() };
    }
    const match = /^\/feed\/update\/(urn:li:activity:\d+)\/?$/.exec(url.pathname);
    if (url.hostname !== 'www.linkedin.com' || !match || match[1] !== providerObjectId) {
        throw new Error('[PROVIDER_IDENTITY_INVALID]');
    }
    return { publicUrl: `https://www.linkedin.com/feed/update/${providerObjectId}/`,
        providerObjectId, publishedAt: published.toISOString() };
}

async function loadTask(tx: Prisma.TransactionClient, pkg: ExactPackage) {
    return tx.contentItem.findFirst({ where: { id: pkg.taskId, project_id: pkg.projectId },
        include: { channel: true, selected_asset: true, publication_fact: true } });
}
async function latestAttempt(tx: Prisma.TransactionClient, pkg: ExactPackage) {
    return tx.deliveryAttempt.findFirst({ where: { project_id: pkg.projectId,
        content_item_id: pkg.taskId }, orderBy: { attempt_number: 'desc' },
    select: { id: true, status: true, requires_manual_confirmation: true, error_message: true,
        attempt_number: true, idempotency_key: true } });
}
function assertPackage(task: Awaited<ReturnType<typeof loadTask>>, pkg: ExactPackage,
statuses: string[], released: boolean) {
    const quality = object(task?.quality_report);
    const handoff = object(quality.handoff_bundle);
    const visualOk = pkg.assetId === null
        ? task?.visual_state === 'NO_VISUAL_NEEDED' && task.selected_asset_id === null
        : task?.visual_state === 'APPROVED' && task.visual_placement === pkg.placement
            && task.selected_asset_id === pkg.assetId && task.selected_asset?.status === 'approved'
            && assetHash(task) === pkg.assetSha256;
    if (!task || task.channel_id !== pkg.channelId || task.channel?.type !== pkg.channelType
        || task.channel.is_active !== true || !statuses.includes(task.status)
        || task.publication_mode !== (released ? 'browser_required' : 'approval_required')
        || task.handoff_state !== 'ready' || task.content_revision !== pkg.revision
        || task.accepted_revision !== pkg.revision || task.text_state !== 'accepted'
        || hash(task.draft_text || '') !== pkg.bodySha256 || !visualOk
        || task.schedule_at?.toISOString() !== pkg.schedule || task.publish_at?.toISOString() !== pkg.schedule
        || task.publication_fact || task.published_link
        || (['linkedin', 'x'].includes(pkg.channelType) && (quality.content_language !== 'en'
            || handoff.content_language !== 'en'))
        || (pkg.channelType === 'x' && (object(task.channel?.config).account_ref !== '@naraHeTc'
            || object(task.channel?.config).channel_url !== 'https://x.com/naraHeTc')))
        throw new Error('[EXACT_BROWSER_PACKAGE_GUARD_FAILED]');
}

export async function diagnoseLinkedInTask1132() {
    const pkg = exact('linkedin');
    const [task, attempt, work] = await Promise.all([
        prisma.$transaction(tx => loadTask(tx, pkg)),
        prisma.deliveryAttempt.findFirst({ where: { project_id: pkg.projectId,
            content_item_id: pkg.taskId }, orderBy: { attempt_number: 'desc' },
        select: { id: true, status: true, requires_manual_confirmation: true, error_message: true } }),
        prisma.workItem.findFirst({ where: { project_id: pkg.projectId, content_item_id: pkg.taskId,
            kind: 'browser_publish', state: { notIn: ['completed', 'cancelled'] } }, select: { id: true, state: true } })
    ]);
    const quality = object(task?.quality_report);
    return { project_id: pkg.projectId, task_id: pkg.taskId, content_revision: task?.content_revision,
        body_sha256: hash(task?.draft_text || ''), content_language: quality.content_language || null,
        handoff_language: object(quality.handoff_bundle).content_language || null,
        attempt: classifyPriorAttempt(attempt), active_browser_work: work || null,
        fact_exists: Boolean(task?.publication_fact), published_link: task?.published_link || null,
        mutates_state: false };
}

export async function releaseExactBrowserTask(platform: ExactBrowserPlatform, args: {
    projectId: number; taskId: number; actorId: string; expectedManifestChecksum: string;
    expectedBodySha256: string; expectedScheduleAt: string; approvalReference: string; idempotencyKey: string;
    duplicateCheckReference?: string }) {
    const pkg = exact(platform);
    if (args.projectId !== pkg.projectId || args.taskId !== pkg.taskId
        || args.expectedManifestChecksum !== pkg.manifest || args.expectedBodySha256 !== pkg.bodySha256
        || args.expectedScheduleAt !== pkg.schedule || !args.approvalReference.trim()
        || !args.idempotencyKey.trim()
        || (platform === 'x' && (!args.duplicateCheckReference || args.duplicateCheckReference.trim().length < 10))) {
        throw new Error('[EXACT_BROWSER_SCOPE_MISMATCH]');
    }
    const userId = actorUserId(args.actorId);
    const requestHash = hash(JSON.stringify({ platform, ...args }));
    return prisma.$transaction(async tx => {
        const command = `ba_release_${platform}_task${pkg.taskId}_browser`;
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: pkg.projectId,
            content_item_id: pkg.taskId, actor_id: args.actorId, command,
            idempotency_key: args.idempotencyKey } });
        if (prior?.after_state) {
            if (object(prior.before_state).request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...object(prior.after_state), replayed: true };
        }
        const member = await tx.projectMember.findUnique({ where: { project_id_user_id: {
            project_id: pkg.projectId, user_id: userId } } });
        if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        if ((await loadAgentWorkspaceManifest(pkg.projectId, userId)).checksum !== pkg.manifest) {
            throw new Error('[STALE_MANIFEST]');
        }
        const [task, attempt, activeWork] = await Promise.all([loadTask(tx, pkg), latestAttempt(tx, pkg),
            tx.workItem.findFirst({ where: { project_id: pkg.projectId, content_item_id: pkg.taskId,
                kind: 'browser_publish', state: { notIn: ['completed', 'cancelled'] } } })]);
        assertPackage(task, pkg, ['ready_for_execution'], false);
        if (!classifyPriorAttempt(attempt).retrySafe) throw new Error('[EXACT_BROWSER_ATTEMPT_UNCERTAIN]');
        if (activeWork) throw new Error('[EXACT_BROWSER_WORK_EXISTS]');
        const proof = { publication_authorized: true, actor_id: args.actorId,
            approval_reference: args.approvalReference, content_revision: pkg.revision,
            body_sha256: pkg.bodySha256, selected_asset_id: pkg.assetId,
            asset_sha256: pkg.assetSha256, channel_id: pkg.channelId,
            placement: pkg.placement, duplicate_check_reference: args.duplicateCheckReference || null,
            released_at: new Date().toISOString() };
        const changed = await tx.contentItem.updateMany({ where: { id: pkg.taskId,
            project_id: pkg.projectId, channel_id: pkg.channelId, status: 'ready_for_execution',
            publication_mode: 'approval_required', content_revision: pkg.revision,
            accepted_revision: pkg.revision, schedule_at: new Date(pkg.schedule) },
        data: { status: 'browser_required', publication_mode: 'browser_required', quality_report: {
            ...object(task!.quality_report), publication_route: 'browser_required', owner_release: proof
        } as Prisma.InputJsonValue } });
        if (changed.count !== 1) throw new Error('[EXACT_BROWSER_RELEASE_CAS_CONFLICT]');
        const work = await tx.workItem.create({ data: { project_id: pkg.projectId,
            week_package_id: task!.week_package_id, content_item_id: pkg.taskId,
            item_key: task!.item_key || `publication-${pkg.taskId}`, kind: 'browser_publish',
            state: 'available', assignee_role: 'browser_publisher', due_at: task!.schedule_at,
            reason_code: 'OWNER_RELEASED_BROWSER_PUBLICATION', input_context_version: pkg.revision,
            dedupe_key: `browser_publish:${pkg.taskId}:r${pkg.revision}`,
            note: `Owner released exact ${platform} task ${pkg.taskId} for one browser publication.`,
            result_payload: proof as Prisma.InputJsonValue } });
        const result = { project_id: pkg.projectId, task_id: pkg.taskId, channel_id: pkg.channelId,
            content_revision: pkg.revision, body_sha256: pkg.bodySha256,
            selected_asset_id: pkg.assetId, asset_sha256: pkg.assetSha256,
            schedule_at: pkg.schedule, publication_mode: 'browser_required',
            browser_work_item_id: work.id, published: false, replayed: false };
        await tx.workflowEvent.create({ data: { project_id: pkg.projectId,
            content_item_id: pkg.taskId, work_item_id: work.id, actor_id: args.actorId,
            command, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: requestHash, status: task!.status,
                prior_attempt: classifyPriorAttempt(attempt) } as Prisma.InputJsonValue,
            after_state: result as Prisma.InputJsonValue } });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function claimExactBrowserTask(platform: ExactBrowserPlatform, args: {
    projectId: number; actorId: string; workItemId: number; leaseSeconds?: number; idempotencyKey: string }) {
    const pkg = exact(platform);
    if (args.projectId !== pkg.projectId) throw new Error('[EXACT_BROWSER_SCOPE_MISMATCH]');
    const item = await prisma.workItem.findFirst({ where: { id: args.workItemId,
        project_id: pkg.projectId, content_item_id: pkg.taskId, kind: 'browser_publish',
        assignee_role: 'browser_publisher', content_item: { channel_id: pkg.channelId,
            status: 'browser_required', publication_mode: 'browser_required', publication_fact: null,
            published_link: null } }, select: { id: true } });
    if (!item) throw new Error('[EXACT_BROWSER_WORK_ITEM_REQUIRED]');
    return workQueueService.claimWorkItem(args);
}

function assertBoundaryArgs(args: BoundaryArgs, pkg: ExactPackage) {
    if (args.projectId !== pkg.projectId || args.taskId !== pkg.taskId || args.channelId !== pkg.channelId
        || args.contentRevision !== pkg.revision || args.textSha256 !== pkg.bodySha256
        || args.selectedAssetId !== pkg.assetId || args.imageSha256 !== pkg.assetSha256
        || !args.approvalReference.trim() || !args.idempotencyKey.trim()) {
        throw new Error('[EXACT_BROWSER_SCOPE_MISMATCH]');
    }
}
async function checkedBoundary(tx: Prisma.TransactionClient, args: BoundaryArgs, statuses: string[]) {
    const pkg = exact(args.platform);
    assertBoundaryArgs(args, pkg);
    const [work, task] = await Promise.all([
        tx.workItem.findFirst({ where: { id: args.workItemId, project_id: pkg.projectId,
            content_item_id: pkg.taskId } }), loadTask(tx, pkg)
    ]);
    if (!work || work.kind !== 'browser_publish' || work.assignee_role !== 'browser_publisher'
        || work.state !== 'claimed' || work.lease_actor_id !== args.actorId
        || work.lease_token !== args.leaseToken || !work.lease_expires_at
        || work.lease_expires_at < new Date()) throw new Error('[EXACT_BROWSER_ACTIVE_LEASE_REQUIRED]');
    assertPackage(task, pkg, statuses, true);
    const proof = object(work.result_payload);
    const ownerProof = object(object(task!.quality_report).owner_release);
    if (proof.publication_authorized !== true || ownerProof.publication_authorized !== true
        || proof.approval_reference !== args.approvalReference
        || ownerProof.approval_reference !== args.approvalReference
        || proof.body_sha256 !== pkg.bodySha256 || ownerProof.body_sha256 !== pkg.bodySha256) {
        throw new Error('[EXACT_BROWSER_RELEASE_PROOF_INVALID]');
    }
    return { pkg, task: task!, work };
}

export async function startExactBrowserSubmission(args: BoundaryArgs) {
    return prisma.$transaction(async tx => {
        const checked = await checkedBoundary(tx, args, ['browser_required']);
        const prior = await latestAttempt(tx, checked.pkg);
        const classification = classifyPriorAttempt(prior);
        if (prior?.idempotency_key === args.idempotencyKey) return { status: 'verification_required',
            attempt_id: prior.id, retry_allowed: false, replayed: true };
        if (!classification.retrySafe) throw new Error('[EXACT_BROWSER_ATTEMPT_UNCERTAIN]');
        const attempt = await tx.deliveryAttempt.create({ data: { project_id: checked.pkg.projectId,
            content_item_id: checked.pkg.taskId, channel_id: checked.pkg.channelId, mode: 'assisted',
            status: 'pending', attempt_number: (prior?.attempt_number || 0) + 1,
            idempotency_key: args.idempotencyKey, scheduled_at: checked.task.schedule_at,
            requires_manual_confirmation: true } });
        const changed = await tx.contentItem.updateMany({ where: { id: checked.pkg.taskId,
            project_id: checked.pkg.projectId, status: 'browser_required', publication_mode: 'browser_required',
            content_revision: checked.pkg.revision }, data: { status: 'publishing' } });
        if (changed.count !== 1) throw new Error('[EXACT_BROWSER_START_CAS_CONFLICT]');
        await tx.workflowEvent.create({ data: { project_id: checked.pkg.projectId,
            content_item_id: checked.pkg.taskId, work_item_id: checked.work.id,
            actor_id: args.actorId, command: `ba_start_${args.platform}_task${checked.pkg.taskId}_browser_submission`,
            idempotency_key: args.idempotencyKey, before_state: { status: checked.task.status,
                prior_attempt: classification } as Prisma.InputJsonValue,
            after_state: { status: 'publishing', delivery_attempt_id: attempt.id } } });
        return { status: 'started', attempt_id: attempt.id, retry_allowed: false, replayed: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function confirmExactBrowserSubmission(args: ConfirmArgs) {
    if (!/^[a-f0-9]{64}$/.test(args.evidenceSha256)) throw new Error('[EVIDENCE_SHA_INVALID]');
    const identity = validateProviderIdentity(args.platform, args.publicUrl, args.providerObjectId, args.publishedAt);
    const checked = await prisma.$transaction(async tx => {
        const boundary = await checkedBoundary(tx, args, ['publishing', 'browser_required']);
        const attempt = await tx.deliveryAttempt.findFirst({ where: { id: args.attemptId,
            project_id: boundary.pkg.projectId, content_item_id: boundary.pkg.taskId,
            channel_id: boundary.pkg.channelId, idempotency_key: args.idempotencyKey } });
        if (!attempt || attempt.status !== 'pending') throw new Error('[EXACT_BROWSER_ATTEMPT_NOT_CONFIRMABLE]');
        return boundary;
    });
    const fact = await publicationFactService.record({ projectId: checked.pkg.projectId,
        taskId: checked.pkg.taskId, actorId: args.actorId, artifactKind: checked.pkg.artifactKind,
        outcome: 'published', publishedAt: identity.publishedAt, publicUrl: identity.publicUrl,
        providerObjectId: identity.providerObjectId, confirmationMode: 'reconciled',
        evidence: { type: 'screenshot', ref: `sha256:${args.evidenceSha256}` },
        utmStatus: 'not_applicable', note: `${args.platform} browser publication confirmed by exact permalink readback.` });
    await prisma.$transaction(async tx => {
        const changed = await tx.deliveryAttempt.updateMany({ where: { id: args.attemptId,
            project_id: checked.pkg.projectId, content_item_id: checked.pkg.taskId,
            idempotency_key: args.idempotencyKey, status: 'pending' }, data: { status: 'delivered',
            actual_published_at: new Date(identity.publishedAt), requires_manual_confirmation: false,
            error_message: null } });
        if (changed.count !== 1) throw new Error('[EXACT_BROWSER_CONFIRM_CAS_CONFLICT]');
        await tx.workflowEvent.create({ data: { project_id: checked.pkg.projectId,
            content_item_id: checked.pkg.taskId, work_item_id: args.workItemId,
            actor_id: args.actorId,
            command: `ba_confirm_${args.platform}_task${checked.pkg.taskId}_browser_submission`,
            idempotency_key: `${args.idempotencyKey}:confirm`,
            before_state: { delivery_attempt_id: args.attemptId },
            after_state: { delivery_attempt_id: args.attemptId, status: 'delivered',
                publication_fact_id: fact.publication_fact.id } } });
    });
    return { publication_fact_id: fact.publication_fact.id, public_url: identity.publicUrl,
        provider_object_id: identity.providerObjectId, replayed: fact.replayed };
}

export async function markExactBrowserSubmissionUncertain(args: UncertainArgs) {
    const pkg = exact(args.platform);
    return prisma.$transaction(async tx => {
        const work = await tx.workItem.findFirst({ where: { id: args.workItemId,
            project_id: pkg.projectId, content_item_id: pkg.taskId } });
        if (!work || work.state !== 'claimed' || work.lease_actor_id !== args.actorId
            || work.lease_token !== args.leaseToken || !work.lease_expires_at
            || work.lease_expires_at < new Date()) throw new Error('[EXACT_BROWSER_ACTIVE_LEASE_REQUIRED]');
        const changed = await tx.deliveryAttempt.updateMany({ where: { id: args.attemptId,
            project_id: pkg.projectId, content_item_id: pkg.taskId,
            idempotency_key: args.idempotencyKey, status: 'pending' },
        data: { requires_manual_confirmation: true, error_message: args.reasonCode } });
        if (changed.count !== 1) throw new Error('[EXACT_BROWSER_UNCERTAIN_CAS_CONFLICT]');
        await tx.workflowEvent.create({ data: { project_id: pkg.projectId, content_item_id: pkg.taskId,
            work_item_id: args.workItemId, actor_id: args.actorId,
            command: `ba_mark_${args.platform}_task${pkg.taskId}_browser_submission_uncertain`,
            idempotency_key: `${args.idempotencyKey}:uncertain`, before_state: { delivery_attempt_id: args.attemptId },
            after_state: { delivery_attempt_id: args.attemptId, status: 'pending', retry_allowed: false,
                reason_code: args.reasonCode } } });
        return { status: 'verification_required', attempt_id: args.attemptId, retry_allowed: false };
    });
}

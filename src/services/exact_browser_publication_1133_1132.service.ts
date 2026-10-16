import { createHash, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import publicationFactService from './publication_fact.service';
import workQueueService from './work_queue.service';

export const EXACT_BROWSER_PACKAGES = {
    linkedin1135: {
        projectId: 10, taskId: 1135, channelId: 179, revision: 2,
        bodySha256: 'b9a402f4b864ef3808f79515ea820d5c337300d521381ad2aea451230309093c',
        assetId: 163, assetSha256: 'b8de74ce57aaf6abc0c4b2c75521e18972caaa39abd0ebc7c60bf337bfc0a838',
        placement: 'feed', schedule: '2026-10-16T10:30:00.000Z',
        manifest: 'sha256:cc2cc620612463792340ae39c2a815f61d603edad17cd01e49cff6f369a50dc7',
        channelType: 'linkedin', artifactKind: 'post', decisionId: 323,
        targetProfileUrl: 'https://www.linkedin.com/company/79633032/', accountType: 'company_page',
        browserProfile: 'Innokenty', duplicateCheckRequired: true
    },
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
    },
    linkedin1088: {
        projectId: 7, taskId: 1088, channelId: 5, revision: 1,
        bodySha256: '8f251f8740f4b84ed1ac873113a0e62d199d650689345f3288efc8fd37bece61',
        assetId: null, assetSha256: null, placement: 'feed',
        schedule: '2026-10-13T09:00:00.000Z',
        manifest: 'sha256:e6178b5bfa7b08acb91dabfe7e34589e6067ae4b2d6270fbc0be8f983b6ef2bb',
        channelType: 'linkedin', artifactKind: 'post', decisionId: 250,
        targetProfileUrl: 'https://www.linkedin.com/in/innokentyb/',
        accountType: 'personal', browserProfile: 'Innokenty', duplicateCheckRequired: true
    },
    linkedin1134: {
        projectId: 10, taskId: 1134, channelId: 179, revision: 1,
        bodySha256: '7b32c597478c683f7001552a3819c198922b3bbdb5a69af4e8ca417c38588d76',
        assetId: 148,
        assetSha256: '0b283963b085b53ee071c95d971c05f6198df65164ab6b435a106d8b5449d86c',
        placement: 'feed', schedule: '2026-10-13T10:00:00.000Z',
        manifest: 'sha256:4bfec7ca8399251c6c8f132a34d9e0952adbf1eef049d29325808cbd9db3975b',
        channelType: 'linkedin', artifactKind: 'post', decisionId: 295,
        targetProfileUrl: 'https://www.linkedin.com/company/79633032/',
        accountType: 'company_page', browserProfile: 'Innokenty', duplicateCheckRequired: true
    }
} as const;

export type ExactBrowserPackageKey = keyof typeof EXACT_BROWSER_PACKAGES;
export type ExactBrowserPlatform = 'medium' | 'linkedin' | 'x';
type ExactPackage = typeof EXACT_BROWSER_PACKAGES[ExactBrowserPackageKey];
type AttemptSummary = { id: number; status: string; requires_manual_confirmation: boolean;
    error_message: string | null };
export type BoundaryArgs = { packageKey: ExactBrowserPackageKey; projectId: number; taskId: number; channelId: number;
    actorId: string; workItemId: number; leaseToken: string; approvalReference: string;
    idempotencyKey: string; contentRevision: number; textSha256: string;
    selectedAssetId: number | null; imageSha256: string | null };
type ConfirmArgs = BoundaryArgs & { attemptId: number; publicUrl: string; providerObjectId: string;
    publishedAt: string; evidenceSha256: string };
type UncertainArgs = Pick<BoundaryArgs, 'packageKey' | 'projectId' | 'taskId' | 'actorId' |
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
function exact(packageKey: ExactBrowserPackageKey): ExactPackage { return EXACT_BROWSER_PACKAGES[packageKey]; }
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

/** Read the canonical package through the caller transaction; no provider access. */
export async function loadTask(tx: Prisma.TransactionClient, pkg: ExactPackage) {
    return tx.contentItem.findFirst({ where: { id: pkg.taskId, project_id: pkg.projectId },
        include: { channel: true, selected_asset: true, publication_fact: true,
            art_direction_decisions: { where: { status: 'active' } } } });
}
async function latestAttempt(tx: Prisma.TransactionClient, pkg: ExactPackage) {
    return tx.deliveryAttempt.findFirst({ where: { project_id: pkg.projectId,
        content_item_id: pkg.taskId }, orderBy: { attempt_number: 'desc' },
    select: { id: true, status: true, requires_manual_confirmation: true, error_message: true,
        attempt_number: true, idempotency_key: true } });
}
/** Shared revision, identity, English copy and approved image boundary. */
export function assertPackage(task: Awaited<ReturnType<typeof loadTask>>, pkg: ExactPackage,
statuses: string[], released: boolean) {
    const quality = object(task?.quality_report);
    const handoff = object(quality.handoff_bundle);
    const visualOk = pkg.assetId === null
        ? task?.visual_state === 'NO_VISUAL_NEEDED' && task.selected_asset_id === null
        : task?.visual_state === 'APPROVED' && task.visual_placement === pkg.placement
            && task.selected_asset_id === pkg.assetId && task.selected_asset?.status === 'approved'
            && assetHash(task) === pkg.assetSha256;
    const config = object(task?.channel?.config);
    const exactDecisionOk = !('decisionId' in pkg) || task?.art_direction_decisions.some(decision =>
        decision.id === pkg.decisionId && decision.source_content_revision === pkg.revision
        && decision.decision_version === task.visual_decision_version && decision.placement === pkg.placement
        && decision.status === 'active'
        && decision.decision === (pkg.assetId === null ? 'NO_VISUAL_NEEDED' : 'GENERATE'));
    const exactIdentityOk = !('targetProfileUrl' in pkg)
        || (config.account_ref === pkg.targetProfileUrl && config.channel_url === pkg.targetProfileUrl
            && config.account_type === pkg.accountType && config.workflow_mode === 'browser_required'
            && object(config.capability_flags).browser_publish === true);
    const storage = object(object(task?.selected_asset?.provenance).planner_storage);
    const current1135Asset = pkg.taskId !== 1135 || (task?.channel?.project_id === 10
        && task.selected_asset?.content_revision === 2 && task.selected_asset.decision_id === 323
        && Boolean(task.selected_asset.file_url?.startsWith('https://')) && storage.managed === true
        && storage.provider === 'r2' && ['image/jpeg','image/png'].includes(String(storage.mime_type)));
    if (!task || task.channel_id !== pkg.channelId || task.channel?.type !== pkg.channelType
        || task.channel.is_active !== true || !statuses.includes(task.status)
        || task.publication_mode !== (released ? 'browser_required' : 'approval_required')
        || task.handoff_state !== 'ready' || task.content_revision !== pkg.revision
        || task.accepted_revision !== pkg.revision || task.text_state !== 'accepted'
        || hash(task.draft_text || '') !== pkg.bodySha256 || !visualOk || !exactDecisionOk || !exactIdentityOk || !current1135Asset
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

export async function releaseExactBrowserTask(packageKey: ExactBrowserPackageKey, args: {
    projectId: number; taskId: number; actorId: string; expectedManifestChecksum: string;
    expectedBodySha256: string; expectedScheduleAt: string; approvalReference: string; idempotencyKey: string;
    duplicateCheckReference?: string }, dependencies = { db: prisma, manifest: loadAgentWorkspaceManifest }) {
    const pkg = exact(packageKey);
    const platform = pkg.channelType as ExactBrowserPlatform;
    if (args.projectId !== pkg.projectId || args.taskId !== pkg.taskId
        || args.expectedManifestChecksum !== pkg.manifest || args.expectedBodySha256 !== pkg.bodySha256
        || args.expectedScheduleAt !== pkg.schedule || !args.approvalReference.trim()
        || !args.idempotencyKey.trim()
        || ((platform === 'x' || ('duplicateCheckRequired' in pkg && pkg.duplicateCheckRequired))
            && (!args.duplicateCheckReference || args.duplicateCheckReference.trim().length < 10))) {
        throw new Error('[EXACT_BROWSER_SCOPE_MISMATCH]');
    }
    const userId = actorUserId(args.actorId);
    const requestHash = hash(JSON.stringify({ packageKey, ...args }));
    const currentManifest = await dependencies.manifest(pkg.projectId, userId);
    return dependencies.db.$transaction(async tx => {
        const member = await tx.projectMember.findUnique({ where: { project_id_user_id: {
            project_id: pkg.projectId, user_id: userId } } });
        if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        const command = `ba_release_${platform}_task${pkg.taskId}_browser`;
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: pkg.projectId,
            content_item_id: pkg.taskId, actor_id: args.actorId, command,
            idempotency_key: args.idempotencyKey } });
        if (prior?.after_state) {
            if (object(prior.before_state).request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...object(prior.after_state), replayed: true };
        }
        if (currentManifest.checksum !== pkg.manifest) {
            throw new Error('[STALE_MANIFEST]');
        }
        const [task, attempt, activeWork] = await Promise.all([loadTask(tx, pkg), latestAttempt(tx, pkg),
            tx.workItem.findFirst({ where: { project_id: pkg.projectId, content_item_id: pkg.taskId,
                kind: 'browser_publish', state: { notIn: ['completed', 'cancelled'] } } })]);
        assertPackage(task, pkg, ['ready_for_execution'], false);
        if (pkg.taskId === 1135 && attempt) throw new Error('[EXACT_BROWSER_ATTEMPT_UNCERTAIN]');
        if (!classifyPriorAttempt(attempt).retrySafe) throw new Error('[EXACT_BROWSER_ATTEMPT_UNCERTAIN]');
        if (activeWork) throw new Error('[EXACT_BROWSER_WORK_EXISTS]');
        const proof = { publication_authorized: true, actor_id: args.actorId,
            approval_reference: args.approvalReference, content_revision: pkg.revision,
            body_sha256: pkg.bodySha256, selected_asset_id: pkg.assetId,
            asset_sha256: pkg.assetSha256, channel_id: pkg.channelId,
            placement: pkg.placement, duplicate_check_reference: args.duplicateCheckReference || null,
            ...(pkg.taskId === 1135 ? { image_url_sha256: hash(task!.selected_asset!.file_url!),
                channel_config_sha256: hash(JSON.stringify(task!.channel!.config)) } : {}),
            ...('targetProfileUrl' in pkg ? { target_profile_url: pkg.targetProfileUrl,
                browser_profile: pkg.browserProfile } : {}),
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

export async function claimExactBrowserTask(packageKey: ExactBrowserPackageKey, args: {
    projectId: number; actorId: string; workItemId: number; leaseSeconds?: number; idempotencyKey: string }) {
    const pkg = exact(packageKey);
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
/** Shared lease/release/package fence used by start, pre-submit and atomic confirmation. */
export async function checkedBoundary(tx: Prisma.TransactionClient, args: BoundaryArgs, statuses: string[]) {
    const pkg = exact(args.packageKey);
    assertBoundaryArgs(args, pkg);
    if (pkg.taskId === 1135 && (await tx.projectMember.findUnique({ where: { project_id_user_id: {
        project_id: 10, user_id: actorUserId(args.actorId) } } }))?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    const [work, task] = await Promise.all([
        tx.workItem.findFirst({ where: { id: args.workItemId, project_id: pkg.projectId,
            content_item_id: pkg.taskId } }), loadTask(tx, pkg)
    ]);
    if (!work || work.kind !== 'browser_publish' || work.assignee_role !== 'browser_publisher'
        || work.state !== 'claimed' || work.lease_actor_id !== args.actorId
        || !equalLease(work.lease_token, args.leaseToken) || !work.lease_expires_at
        || work.lease_expires_at < new Date()) throw new Error('[EXACT_BROWSER_ACTIVE_LEASE_REQUIRED]');
    assertPackage(task, pkg, statuses, true);
    const proof = object(work.result_payload);
    const ownerProof = object(object(task!.quality_report).owner_release);
    if (pkg.taskId === 1135) assertLinkedIn1135ReleaseFingerprint(task!, proof, ownerProof);
    if (proof.publication_authorized !== true || ownerProof.publication_authorized !== true
        || proof.approval_reference !== args.approvalReference
        || ownerProof.approval_reference !== args.approvalReference
        || proof.body_sha256 !== pkg.bodySha256 || ownerProof.body_sha256 !== pkg.bodySha256
        || ('targetProfileUrl' in pkg && (proof.target_profile_url !== pkg.targetProfileUrl
            || ownerProof.target_profile_url !== pkg.targetProfileUrl
            || proof.browser_profile !== pkg.browserProfile || ownerProof.browser_profile !== pkg.browserProfile))) {
        throw new Error('[EXACT_BROWSER_RELEASE_PROOF_INVALID]');
    }
    return { pkg, task: task!, work };
}

/** Reuse the same current-source/identity fingerprint in normal confirmation and expired-lease reconciliation. */
export function assertLinkedIn1135ReleaseFingerprint(task: NonNullable<Awaited<ReturnType<typeof loadTask>>>,
    proof: Record<string, unknown>, ownerProof: Record<string, unknown>): void {
    const image = hash(task.selected_asset?.file_url || ''), config = hash(JSON.stringify(task.channel?.config));
    if ([proof, ownerProof].some(value => value.image_url_sha256 !== image || value.channel_config_sha256 !== config)) {
        throw new Error('[EXACT_BROWSER_RELEASE_PROOF_INVALID]');
    }
}

function equalLease(stored: string | null, supplied: string): boolean {
    if (!stored) return false;
    const a = Buffer.from(stored), b = Buffer.from(supplied);
    return a.length === b.length && timingSafeEqual(a, b);
}

export async function startExactBrowserSubmission(args: BoundaryArgs, database = prisma) {
    return database.$transaction(async tx => {
        const checked = await checkedBoundary(tx, args, ['browser_required']);
        const prior = await latestAttempt(tx, checked.pkg);
        const classification = classifyPriorAttempt(prior);
        if (checked.pkg.taskId === 1135 && prior) throw new Error('[EXACT_BROWSER_ATTEMPT_UNCERTAIN]');
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
            actor_id: args.actorId,
            command: `ba_start_${checked.pkg.channelType}_task${checked.pkg.taskId}_browser_submission`,
            idempotency_key: args.idempotencyKey, before_state: { status: checked.task.status,
                prior_attempt: classification } as Prisma.InputJsonValue,
            after_state: { status: 'publishing', delivery_attempt_id: attempt.id } } });
        return { status: 'started', attempt_id: attempt.id, retry_allowed: false, replayed: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function confirmExactBrowserSubmission(args: ConfirmArgs) {
    if (!/^[a-f0-9]{64}$/.test(args.evidenceSha256)) throw new Error('[EVIDENCE_SHA_INVALID]');
    const pkg = exact(args.packageKey);
    const platform = pkg.channelType as ExactBrowserPlatform;
    const identity = validateProviderIdentity(platform, args.publicUrl, args.providerObjectId, args.publishedAt);
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
        utmStatus: 'not_applicable', note: `${platform} browser publication confirmed by exact permalink readback.` });
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
            command: `ba_confirm_${platform}_task${checked.pkg.taskId}_browser_submission`,
            idempotency_key: `${args.idempotencyKey}:confirm`,
            before_state: { delivery_attempt_id: args.attemptId },
            after_state: { delivery_attempt_id: args.attemptId, status: 'delivered',
                publication_fact_id: fact.publication_fact.id } } });
    });
    return { publication_fact_id: fact.publication_fact.id, public_url: identity.publicUrl,
        provider_object_id: identity.providerObjectId, replayed: fact.replayed };
}

export async function markExactBrowserSubmissionUncertain(args: UncertainArgs) {
    const pkg = exact(args.packageKey);
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
            command: `ba_mark_${pkg.channelType}_task${pkg.taskId}_browser_submission_uncertain`,
            idempotency_key: `${args.idempotencyKey}:uncertain`, before_state: { delivery_attempt_id: args.attemptId },
            after_state: { delivery_attempt_id: args.attemptId, status: 'pending', retry_allowed: false,
                reason_code: args.reasonCode } } });
        return { status: 'verification_required', attempt_id: args.attemptId, retry_allowed: false };
    });
}

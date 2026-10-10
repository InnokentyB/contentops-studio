import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import threadsService from './threads.service';
import workQueueService from './work_queue.service';

export const OCT10_MANIFEST_CHECKSUM = 'sha256:d5970e6b33d5f161a73f6ebc13fb5255f5a24be4f14251e57e5223ea03a2192f';
const RECOVERY_DATE = '2026-10-10';
const PERSONAL_LINKEDIN_URL = 'https://www.linkedin.com/in/innokentyb/';
const PERSONAL_LINKEDIN_PROFILE_REF = 'profile_personal_innokenty_linkedin';

const PACKAGES = {
    1042: { channelId: 164, bodySha256: '7d780809a7f6b73494b590cd1fa11ac2f6383fdc0a952f1aca5d09cb4e676c70',
        assetId: 126, assetSha256: 'e5643499e5a16777fd272dbc510946d0c8d55accf6301d9a3b330206f1d7c92b',
        decisionId: 264, reviewId: 1420, artId: 1670, schedule: '2026-10-09T15:00:00.000Z' },
    1072: { channelId: 123, bodySha256: 'd5b88c95e2fbe35cf96e792c775b0e84eff4c261974487d592a8cc24ac44951c',
        assetId: 127, assetSha256: '3c2c2f95dcdd54784a034216414a8efc6b97fe79167ea3403de9e5e918db1121',
        decisionId: 265, reviewId: 1394, artId: 1671, schedule: '2026-10-09T15:00:00.000Z' },
    1043: { channelId: 138, bodySha256: '00813c7d65068bdce2e0b5aa6bb1cc04ca936e42c81ca4a44b2be50a095713fc',
        assetId: 128, assetSha256: 'd53fa8809efe40b35577849cdfcd2795ead8127ba77e9e4a604fbfaf94f9d3c3',
        decisionId: 266, reviewId: 1421, artId: 1672, schedule: '2026-10-09T16:30:00.000Z' }
} as const;

type ReleaseArgs<TaskId extends number> = {
    projectId: 10; taskId: TaskId; actorId: string; approvalReference: string; idempotencyKey: string;
};

type Dependencies = {
    database: typeof prisma;
    manifestLoader: typeof loadAgentWorkspaceManifest;
    hashBody: (body: string) => string;
    now: () => Date;
};

type ThreadsDependencies = Dependencies & { threads: typeof threadsService };

const baseDependencies: Dependencies = {
    database: prisma,
    manifestLoader: loadAgentWorkspaceManifest,
    hashBody: body => createHash('sha256').update(body).digest('hex'),
    now: () => new Date()
};

function actorUserId(actorId: string) {
    const match = /^user:(\d+)$/.exec(actorId);
    if (!match) throw new Error('[OWNER_REQUIRED]');
    return Number(match[1]);
}

function validateRequest(args: ReleaseArgs<number>, taskId: number) {
    if (args.projectId !== 10 || args.taskId !== taskId) throw new Error(`[TASK${taskId}_RELEASE_SCOPE_MISMATCH]`);
    if (!args.approvalReference?.trim()) throw new Error('[OWNER_APPROVAL_REFERENCE_REQUIRED]');
    if (!args.idempotencyKey?.trim()) throw new Error('[IDEMPOTENCY_KEY_REQUIRED]');
    return actorUserId(args.actorId);
}

function requestHash(args: ReleaseArgs<number>) {
    return createHash('sha256').update(JSON.stringify(args)).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assetChecksum(asset: { provenance: unknown } | null | undefined) {
    if (!isRecord(asset?.provenance)) return null;
    const storage = asset.provenance.planner_storage;
    if (isRecord(storage) && typeof storage.sha256 === 'string') return storage.sha256;
    return typeof asset.provenance.sha256 === 'string' ? asset.provenance.sha256 : null;
}

function hasUncertainResult(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(hasUncertainResult);
    if (!isRecord(value)) return value === 'provider_result_uncertain';
    return Object.values(value).some(hasUncertainResult);
}

async function verifyManifest(dependencies: Dependencies, userId: number) {
    const manifest = await dependencies.manifestLoader(10, userId);
    if (manifest.checksum !== OCT10_MANIFEST_CHECKSUM) throw new Error('[STALE_MANIFEST]');
    return manifest.checksum;
}

function recoveryProof(args: ReleaseArgs<number>, now: Date, schedule: string, bodySha256: string,
    assetId: number, assetSha256: string) {
    return {
        publication_authorized: true, actor_id: args.actorId, approval_reference: args.approvalReference,
        content_revision: 4, body_sha256: bodySha256, selected_asset_id: assetId, asset_sha256: assetSha256,
        released_at: now.toISOString(), missed_schedule_at: schedule, recovery_slot_date: RECOVERY_DATE
    };
}

function exactAssetAndTask(task: {
    content_revision: number; accepted_revision: number | null; text_state: string; visual_state: string;
    visual_placement: string | null; visual_decision_version: number; selected_asset_id: number | null;
    selected_asset: { id: number; status: string; content_revision: number; file_url: string | null; provenance: unknown } | null;
    schedule_at: Date | null; publish_at: Date | null; draft_text: string | null; handoff_state: string;
    status: string; publication_mode: string | null; publication_fact: unknown; published_link: string | null;
    telegram_message_id: number | null; quality_report: unknown;
}, spec: typeof PACKAGES[keyof typeof PACKAGES], hashBody: (body: string) => string) {
    return task.status === 'ready_for_execution' && task.publication_mode === 'approval_required'
        && task.handoff_state === 'ready' && task.content_revision === 4 && task.accepted_revision === 4
        && task.text_state === 'accepted' && task.visual_state === 'APPROVED' && task.visual_placement === 'feed'
        && task.visual_decision_version === 2 && task.selected_asset_id === spec.assetId
        && task.selected_asset?.id === spec.assetId && task.selected_asset.status === 'approved'
        && task.selected_asset.content_revision === 4 && Boolean(task.selected_asset.file_url)
        && assetChecksum(task.selected_asset) === spec.assetSha256
        && task.schedule_at?.toISOString() === spec.schedule && task.publish_at?.toISOString() === spec.schedule
        && hashBody(task.draft_text || '') === spec.bodySha256 && !task.publication_fact && !task.published_link
        && !task.telegram_message_id && !hasUncertainResult(task.quality_report);
}

async function requireReviewAndArt(tx: Prisma.TransactionClient, taskId: number,
    spec: typeof PACKAGES[keyof typeof PACKAGES], channel: string) {
    const [review, art, decision] = await Promise.all([
        tx.workItem.findFirst({ where: { id: spec.reviewId, project_id: 10, content_item_id: taskId,
            kind: 'content_review', state: 'completed', input_context_version: 4, result_version: 4 } }),
        tx.workItem.findFirst({ where: { id: spec.artId, project_id: 10, content_item_id: taskId,
            kind: 'art_direction', state: 'completed', input_context_version: 4, result_version: 2 } }),
        tx.artDirectionDecision.findFirst({ where: { id: spec.decisionId, project_id: 10, content_item_id: taskId,
            source_content_revision: 4, decision_version: 2, decision: 'GENERATE', channel, placement: 'feed', status: 'active' } })
    ]);
    if (!review || !art || !decision) throw new Error(`[TASK${taskId}_RELEASE_GUARD_FAILED] Review or art binding changed`);
}

async function rejectPriorSideEffects(tx: Prisma.TransactionClient, taskId: number, includeBrowserWork: boolean) {
    if (await tx.deliveryAttempt.findFirst({ where: { project_id: 10, content_item_id: taskId } })) {
        throw new Error('[DELIVERY_ATTEMPT_EXISTS]');
    }
    if (includeBrowserWork && await tx.workItem.findFirst({ where: { project_id: 10, content_item_id: taskId,
        kind: 'browser_publish', state: { notIn: ['completed', 'cancelled'] } } })) {
        throw new Error('[BROWSER_PUBLICATION_ALREADY_QUEUED]');
    }
}

export async function releaseXTask1042(args: ReleaseArgs<1042>, dependencies: Dependencies = baseDependencies): Promise<Record<string, unknown>> {
    const userId = validateRequest(args, 1042);
    const spec = PACKAGES[1042];
    const hash = requestHash(args);
    return dependencies.database.$transaction(async tx => {
        const membership = await tx.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: userId } } });
        if (membership?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        const command = 'ba_release_x_task1042_browser';
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: 10, actor_id: args.actorId,
            command, idempotency_key: args.idempotencyKey } });
        if (prior?.after_state) {
            if ((prior.before_state as Record<string, unknown> | null)?.request_hash !== hash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...(prior.after_state as Record<string, unknown>), replayed: true };
        }
        const manifestChecksum = await verifyManifest(dependencies, userId);
        const task = await tx.contentItem.findFirst({ where: { id: 1042, project_id: 10 },
            include: { channel: true, selected_asset: true, publication_fact: true } });
        if (!task || task.channel_id !== 164 || task.channel?.type !== 'x' || task.channel.name !== 'innokenty_x'
            || task.channel.is_active !== true || !exactAssetAndTask(task, spec, dependencies.hashBody)) {
            if (task && hasUncertainResult(task.quality_report)) throw new Error('[UNCERTAIN_ATTEMPT_EXISTS]');
            throw new Error('[TASK1042_RELEASE_GUARD_FAILED] Production package changed');
        }
        await requireReviewAndArt(tx, 1042, spec, 'x');
        await rejectPriorSideEffects(tx, 1042, true);
        const now = dependencies.now();
        const proof = recoveryProof(args, now, spec.schedule, spec.bodySha256, spec.assetId, spec.assetSha256);
        const changed = await tx.contentItem.updateMany({ where: { id: 1042, project_id: 10, channel_id: 164,
            status: 'ready_for_execution', publication_mode: 'approval_required', content_revision: 4,
            accepted_revision: 4, selected_asset_id: 126, schedule_at: new Date(spec.schedule), publish_at: new Date(spec.schedule) },
        data: { status: 'browser_required', publication_mode: 'browser_required', quality_report: {
            ...((task.quality_report as Record<string, unknown> | null) || {}), publication_route: 'browser_required',
            owner_release: proof, recovery_release: proof
        } } });
        if (changed.count !== 1) throw new Error('[TASK1042_RELEASE_CAS_CONFLICT]');
        const work = await tx.workItem.create({ data: { project_id: 10, week_package_id: task.week_package_id,
            content_item_id: 1042, item_key: task.item_key || 'publication-1042', kind: 'browser_publish', state: 'available',
            assignee_role: 'browser_publisher', due_at: now, reason_code: 'OWNER_RELEASED_MISSED_SLOT_RECOVERY',
            note: 'Exact owner-approved recovery of Personal X task 1042; original missed schedule remains on the task.',
            input_context_version: 4, dedupe_key: 'browser_publish:1042:r4', result_payload: {
                ...proof, channel_id: 164, target_account: '@naraHeTc', visual_decision_id: 264
            } as Prisma.InputJsonValue } });
        const result = { project_id: 10, task_id: 1042, channel_id: 164, content_revision: 4, accepted_revision: 4,
            body_sha256: spec.bodySha256, selected_asset_id: 126, asset_sha256: spec.assetSha256,
            schedule_at: spec.schedule, recovery_slot_date: RECOVERY_DATE, publication_mode: 'browser_required' as const,
            browser_work_item_id: work.id, publication_authorized: true as const, published: false as const, replayed: false };
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1042, work_item_id: work.id,
            actor_id: args.actorId, command, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: hash, manifest_checksum: manifestChecksum, status: task.status,
                publication_mode: task.publication_mode, schedule_at: spec.schedule }, after_state: result } });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function personalLinkedInConfig(sourceConfig: unknown): Prisma.InputJsonObject {
    const source = isRecord(sourceConfig) ? sourceConfig : {};
    const raw = isRecord(source.raw_account) ? source.raw_account : {};
    return {
        platform: 'linkedin', role: 'primary_author', profile_ref: PERSONAL_LINKEDIN_PROFILE_REF,
        identity_ref: 'personal_innokenty', account_ref: PERSONAL_LINKEDIN_URL, channel_url: PERSONAL_LINKEDIN_URL,
        account_type: 'personal', workflow_mode: 'browser_required', connector_mode: 'browser_assisted',
        execution_modes: ['manual'], adapter_kind: 'publication_source',
        capability_flags: { api_publish: false, browser_publish: true, manual_handoff: true, analytics_supported: true },
        raw_account: { platform: 'linkedin', type: 'personal', role: 'primary_author', handle: raw.handle || 'innokentyb',
            url: PERSONAL_LINKEDIN_URL, planner_channel_id: 5 }
    };
}

function isPersonalLinkedInChannel(channel: { project_id: number; type: string; name: string; is_active: boolean; config: unknown }) {
    const config = isRecord(channel.config) ? channel.config : {};
    return channel.project_id === 10 && channel.type === 'linkedin' && channel.name === 'innokenty_personal_linkedin'
        && channel.is_active === true && config.profile_ref === PERSONAL_LINKEDIN_PROFILE_REF
        && config.channel_url === PERSONAL_LINKEDIN_URL && config.identity_ref === 'personal_innokenty';
}

export async function releaseLinkedInTask1072(args: ReleaseArgs<1072>, dependencies: Dependencies = baseDependencies): Promise<Record<string, unknown>> {
    const userId = validateRequest(args, 1072);
    const spec = PACKAGES[1072];
    const hash = requestHash(args);
    return dependencies.database.$transaction(async tx => {
        const [p10, p7] = await Promise.all([10, 7].map(projectId => tx.projectMember.findUnique({ where: {
            project_id_user_id: { project_id: projectId, user_id: userId }
        } })));
        if (p10?.role !== 'owner' || p7?.role !== 'owner') throw new Error('[CROSS_PROJECT_OWNER_REQUIRED]');
        const command = 'ba_release_linkedin_task1072_personal_browser';
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: 10, actor_id: args.actorId,
            command, idempotency_key: args.idempotencyKey } });
        if (prior?.after_state) {
            if ((prior.before_state as Record<string, unknown> | null)?.request_hash !== hash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...(prior.after_state as Record<string, unknown>), replayed: true };
        }
        const manifestChecksum = await verifyManifest(dependencies, userId);
        const [source, task] = await Promise.all([
            tx.socialChannel.findFirst({ where: { id: 5, project_id: 7, type: 'linkedin', is_active: true } }),
            tx.contentItem.findFirst({ where: { id: 1072, project_id: 10 },
                include: { channel: true, selected_asset: true, publication_fact: true } })
        ]);
        const sourceConfig = isRecord(source?.config) ? source.config : {};
        if (!source || source.name !== 'innokentiy_linkedin' || sourceConfig.profile_ref !== PERSONAL_LINKEDIN_PROFILE_REF
            || sourceConfig.channel_url !== PERSONAL_LINKEDIN_URL || sourceConfig.identity_ref !== 'personal_innokenty') {
            throw new Error('[PERSONAL_LINKEDIN_REGISTRY_GUARD_FAILED]');
        }
        if (!task || task.channel_id !== 123 || task.channel?.name !== 'analystcraft_linkedin'
            || task.channel.type !== 'linkedin' || !exactAssetAndTask(task, spec, dependencies.hashBody)) {
            if (task && hasUncertainResult(task.quality_report)) throw new Error('[UNCERTAIN_ATTEMPT_EXISTS]');
            throw new Error('[TASK1072_RELEASE_GUARD_FAILED] Production package changed');
        }
        await requireReviewAndArt(tx, 1072, spec, 'linkedin');
        await rejectPriorSideEffects(tx, 1072, true);
        let target = await tx.socialChannel.findFirst({ where: { project_id: 10, name: 'innokenty_personal_linkedin' } });
        if (target && !isPersonalLinkedInChannel(target)) throw new Error('[PERSONAL_LINKEDIN_ROUTE_CONFLICT]');
        if (!target) target = await tx.socialChannel.create({ data: { project_id: 10, type: 'linkedin',
            name: 'innokenty_personal_linkedin', is_active: true, config: personalLinkedInConfig(source.config) } });
        const now = dependencies.now();
        const proof = recoveryProof(args, now, spec.schedule, spec.bodySha256, spec.assetId, spec.assetSha256);
        const changed = await tx.contentItem.updateMany({ where: { id: 1072, project_id: 10, channel_id: 123,
            status: 'ready_for_execution', publication_mode: 'approval_required', content_revision: 4,
            accepted_revision: 4, selected_asset_id: 127, schedule_at: new Date(spec.schedule), publish_at: new Date(spec.schedule) },
        data: { channel_id: target.id, status: 'browser_required', publication_mode: 'browser_required', quality_report: {
            ...((task.quality_report as Record<string, unknown> | null) || {}), publication_route: 'browser_required',
            target_identity: { profile_ref: PERSONAL_LINKEDIN_PROFILE_REF, identity_ref: 'personal_innokenty',
                profile_url: PERSONAL_LINKEDIN_URL, source_registry_channel_id: 5, project_channel_id: target.id },
            owner_release: proof, recovery_release: proof
        } } });
        if (changed.count !== 1) throw new Error('[TASK1072_RELEASE_CAS_CONFLICT]');
        const work = await tx.workItem.create({ data: { project_id: 10, week_package_id: task.week_package_id,
            content_item_id: 1072, item_key: task.item_key || 'publication-1072', kind: 'browser_publish', state: 'available',
            assignee_role: 'browser_publisher', due_at: now, reason_code: 'OWNER_RELEASED_MISSED_SLOT_RECOVERY',
            note: `Publish only to personal LinkedIn profile ${PERSONAL_LINKEDIN_URL}; original missed schedule remains on the task.`,
            input_context_version: 4, dedupe_key: 'browser_publish:1072:r4:personal', result_payload: {
                ...proof, channel_id: target.id, source_registry_channel_id: 5, profile_ref: PERSONAL_LINKEDIN_PROFILE_REF,
                profile_url: PERSONAL_LINKEDIN_URL, visual_decision_id: 265
            } as Prisma.InputJsonValue } });
        const result = { project_id: 10, task_id: 1072, source_registry_channel_id: 5,
            target_channel_id: target.id, target_profile_ref: PERSONAL_LINKEDIN_PROFILE_REF,
            target_profile_url: PERSONAL_LINKEDIN_URL, content_revision: 4, accepted_revision: 4,
            body_sha256: spec.bodySha256, selected_asset_id: 127, asset_sha256: spec.assetSha256,
            schedule_at: spec.schedule, recovery_slot_date: RECOVERY_DATE, publication_mode: 'browser_required' as const,
            browser_work_item_id: work.id, publication_authorized: true as const, published: false as const, replayed: false };
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1072, work_item_id: work.id,
            actor_id: args.actorId, command, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: hash, manifest_checksum: manifestChecksum, channel_id: 123,
                status: task.status, publication_mode: task.publication_mode, schedule_at: spec.schedule }, after_state: result } });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function releaseThreadsTask1043(args: ReleaseArgs<1043>, dependencies: ThreadsDependencies = {
    ...baseDependencies, threads: threadsService
}): Promise<Record<string, unknown>> {
    const userId = validateRequest(args, 1043);
    const command = 'ba_release_threads_task1043_api';
    const hash = requestHash(args);
    const membership = await dependencies.database.projectMember.findUnique({ where: {
        project_id_user_id: { project_id: 10, user_id: userId }
    } });
    if (membership?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    const prior = await dependencies.database.workflowEvent.findFirst({ where: { project_id: 10,
        actor_id: args.actorId, command, idempotency_key: args.idempotencyKey } });
    if (prior?.after_state) {
        if ((prior.before_state as Record<string, unknown> | null)?.request_hash !== hash) throw new Error('[IDEMPOTENCY_CONFLICT]');
        return { ...(prior.after_state as Record<string, unknown>), replayed: true };
    }
    const manifestChecksum = await verifyManifest(dependencies, userId);
    const channel = await dependencies.database.socialChannel.findFirst({ where: {
        id: 138, project_id: 10, name: 'innokenty_threads', type: 'threads', is_active: true
    } });
    if (!channel) throw new Error('[THREADS_CHANNEL_NOT_READY]');
    const config = resolveEffectiveChannelConfig('threads', channel.config) as { access_token?: string; threads_user_id?: string };
    const connection = await dependencies.threads.testConnection(config);
    if (!connection.success || connection.details?.id !== '39421253764155091'
        || connection.details.username !== 'innokentybo') throw new Error('[THREADS_IDENTITY_NOT_VERIFIED]');
    let after: string | undefined;
    for (let page = 0; page < 5; page += 1) {
        const history = await dependencies.threads.getOwnPosts(config.access_token || '', '39421253764155091', after);
        if (history.items.some(item => dependencies.hashBody(item.text || '') === PACKAGES[1043].bodySha256)) {
            throw new Error('[THREADS_PROVIDER_DUPLICATE_FOUND] Reconcile the existing provider post');
        }
        if (!history.after) break;
        if (page === 4) throw new Error('[THREADS_HISTORY_INCOMPLETE]');
        after = history.after;
    }
    const spec = PACKAGES[1043];
    return dependencies.database.$transaction(async tx => {
        const membership = await tx.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: userId } } });
        if (membership?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        const lockedPrior = await tx.workflowEvent.findFirst({ where: { project_id: 10, actor_id: args.actorId,
            command, idempotency_key: args.idempotencyKey } });
        if (lockedPrior?.after_state) {
            if ((lockedPrior.before_state as Record<string, unknown> | null)?.request_hash !== hash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...(lockedPrior.after_state as Record<string, unknown>), replayed: true };
        }
        const task = await tx.contentItem.findFirst({ where: { id: 1043, project_id: 10 },
            include: { channel: true, selected_asset: true, publication_fact: true } });
        if (!task || task.channel_id !== 138 || task.channel?.name !== 'innokenty_threads'
            || task.channel.type !== 'threads' || !exactAssetAndTask(task, spec, dependencies.hashBody)) {
            if (task && hasUncertainResult(task.quality_report)) throw new Error('[UNCERTAIN_ATTEMPT_EXISTS]');
            throw new Error('[TASK1043_RELEASE_GUARD_FAILED] Production package changed');
        }
        await requireReviewAndArt(tx, 1043, spec, 'threads');
        const [historicalApproval, historicalArt, historicalDecision] = await Promise.all([
            tx.approvalDecision.findUnique({ where: { work_item_id_result_version: {
                work_item_id: 1421, result_version: 3
            } } }),
            tx.workItem.findFirst({ where: { id: 1438, project_id: 10, content_item_id: 1043,
                kind: 'art_direction', state: 'completed', input_context_version: 3, result_version: 1 } }),
            tx.artDirectionDecision.findFirst({ where: { id: 217, project_id: 10, content_item_id: 1043,
                work_item_id: 1438, source_content_revision: 3, decision_version: 1,
                decision: 'NO_VISUAL_NEEDED', channel: 'threads', placement: 'feed' } })
        ]);
        const textOnlyBody = task.draft_text?.endsWith('\n') ? task.draft_text.slice(0, -1) : task.draft_text || '';
        const textOnlyBodySha256 = dependencies.hashBody(textOnlyBody);
        if (historicalApproval?.id !== 255 || historicalApproval.decision !== 'approved' || !historicalArt || !historicalDecision
            || textOnlyBodySha256 !== 'c68bd80edc8c866930e06844f1f9bde96ab3c4325cf1bd8d21760f1f8fb691bd') {
            throw new Error('[TASK1043_HISTORICAL_TEXT_ONLY_GUARD_FAILED] Approved revision3 package changed');
        }
        await rejectPriorSideEffects(tx, 1043, true);
        const now = dependencies.now();
        await tx.artDirectionDecision.updateMany({ where: { project_id: 10, content_item_id: 1043, status: 'active' },
            data: { status: 'stale' } });
        const artWork = await tx.workItem.create({ data: { project_id: 10, week_package_id: task.week_package_id,
            content_item_id: 1043, item_key: task.item_key || 'publication-1043', kind: 'art_direction',
            state: 'completed', assignee_role: 'art_director', due_at: now,
            input_context_version: 5, result_version: 3,
            reason_code: 'OWNER_RECOVERED_APPROVED_TEXT_ONLY_PACKAGE',
            note: 'Current revision5 binding for the exact previously approved revision3 text-only Threads package.',
            dedupe_key: 'art_direction:1043:r5:owner-recovery', result_payload: {
                decision: 'NO_VISUAL_NEEDED', source_approval_id: historicalApproval.id,
                source_art_work_item_id: 1438, source_decision_id: 217,
                superseded_asset_id: 128, body_sha256: textOnlyBodySha256
            } as Prisma.InputJsonValue } });
        const decision = await tx.artDirectionDecision.create({ data: { project_id: 10, content_item_id: 1043,
            work_item_id: artWork.id, decision_version: 3, source_content_revision: 5,
            channel: 'threads', placement: 'feed', decision: 'NO_VISUAL_NEEDED',
            reason: 'Owner recovered the exact previously approved text-only package; asset128 remains immutable history.',
            status: 'active', actor_id: args.actorId, evidence_refs: {
                approval_id: historicalApproval.id, historical_art_work_item_id: 1438,
                historical_decision_id: 217, superseded_decision_id: 266, superseded_asset_id: 128
            } as Prisma.InputJsonValue } });
        const proof = { publication_authorized: true, actor_id: args.actorId,
            approval_reference: args.approvalReference, content_revision: 5,
            accepted_revision: 5, body_sha256: textOnlyBodySha256,
            selected_asset_id: null, asset_sha256: null, visual_decision_id: decision.id,
            historical_approval_id: historicalApproval.id, historical_decision_id: 217,
            superseded_asset_id: 128, released_at: now.toISOString(),
            missed_schedule_at: spec.schedule, recovery_slot_date: RECOVERY_DATE };
        const changed = await tx.contentItem.updateMany({ where: { id: 1043, project_id: 10, channel_id: 138,
            status: 'ready_for_execution', publication_mode: 'approval_required', content_revision: 4,
            accepted_revision: 4, selected_asset_id: 128, schedule_at: new Date(spec.schedule), publish_at: new Date(spec.schedule) },
        data: { draft_text: textOnlyBody, content_revision: 5, accepted_revision: 5,
            visual_state: 'NO_VISUAL_NEEDED', visual_decision_version: 3, selected_asset_id: null,
            status: 'ready_for_execution', publication_mode: 'owner_released', quality_report: {
            ...((task.quality_report as Record<string, unknown> | null) || {}), publication_route: 'threads_api',
            owner_release: proof, recovery_release: proof
        } } });
        if (changed.count !== 1) throw new Error('[TASK1043_RELEASE_CAS_CONFLICT]');
        const result = { project_id: 10, task_id: 1043, channel_id: 138, threads_user_id: '39421253764155091',
            content_revision: 5, accepted_revision: 5, body_sha256: textOnlyBodySha256, visual_decision_id: decision.id,
            selected_asset_id: null, asset_sha256: null, superseded_asset_id: 128,
            source_approval_id: historicalApproval.id, source_decision_id: 217,
            schedule_at: spec.schedule, publish_at: spec.schedule,
            recovery_slot_date: RECOVERY_DATE, publication_mode: 'owner_released' as const,
            publication_authorized: true as const, published: false as const, replayed: false };
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1043, actor_id: args.actorId,
            command, idempotency_key: args.idempotencyKey, before_state: { request_hash: hash,
                manifest_checksum: manifestChecksum, status: task.status, publication_mode: task.publication_mode,
                content_revision: 4, accepted_revision: 4, body_sha256: spec.bodySha256,
                selected_asset_id: 128, visual_decision_id: 266, schedule_at: spec.schedule }, after_state: result } });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function claimXTask1042Browser(args: { projectId: 10; actorId: string; workItemId: number;
    leaseSeconds?: number; idempotencyKey: string }) {
    const item = await prisma.workItem.findFirst({ where: { id: args.workItemId, project_id: 10,
        content_item_id: 1042, kind: 'browser_publish', assignee_role: 'browser_publisher',
        content_item: { channel_id: 164, status: 'browser_required', publication_mode: 'browser_required',
            content_revision: 6, accepted_revision: 6, selected_asset_id: null, publication_fact: null, published_link: null } },
    select: { id: true } });
    if (!item) throw new Error('[X1042_BROWSER_WORK_ITEM_REQUIRED]');
    return workQueueService.claimWorkItem(args);
}

export async function claimLinkedInTask1072Browser(args: { projectId: 10; actorId: string; workItemId: number;
    leaseSeconds?: number; idempotencyKey: string }) {
    const item = await prisma.workItem.findFirst({ where: { id: args.workItemId, project_id: 10,
        content_item_id: 1072, kind: 'browser_publish', assignee_role: 'browser_publisher',
        content_item: { channel: { name: 'innokenty_personal_linkedin', type: 'linkedin', is_active: true },
            status: 'browser_required', publication_mode: 'browser_required', content_revision: 4,
            accepted_revision: 4, selected_asset_id: 127, publication_fact: null, published_link: null } },
    select: { id: true } });
    if (!item) throw new Error('[LINKEDIN1072_BROWSER_WORK_ITEM_REQUIRED]');
    return workQueueService.claimWorkItem(args);
}

export const OCT10_TASK_PACKAGES = PACKAGES;

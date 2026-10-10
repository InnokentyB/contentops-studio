import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import artDirectionService from './art_direction.service';
import { assertPublicationTextWithinLimit, measureXWeightedLength } from './publication_text_limit';

const PROJECT_ID = 10;
const TASK_ID = 1042;
const CHANNEL_ID = 164;
const SOURCE_REVISION = 4;
const TEXT_ONLY_REVISION = 5;
const RELEASE_REVISION = 6;
const REVIEW_WORK_ITEM_ID = 1420;
const WRITER_WORK_ITEM_ID = 1308;
const OVERLENGTH_ART_WORK_ITEM_ID = 1688;
const OVERLENGTH_DECISION_ID = 271;
const OVERLENGTH_BROWSER_WORK_ITEM_ID = 1689;
const SOURCE_ASSET_ID = 126;
const SOURCE_DECISION_ID = 264;
const BODY_SHA256 = '7d780809a7f6b73494b590cd1fa11ac2f6383fdc0a952f1aca5d09cb4e676c70';
const RELEASE_BODY_SHA256 = '8ee902b053a244255c4c3d728947e755069e5aca8503f3ed201476bf67f0cfc3';
const SOURCE_ASSET_SHA256 = 'e5643499e5a16777fd272dbc510946d0c8d55accf6301d9a3b330206f1d7c92b';
const SCHEDULE = '2026-10-09T15:00:00.000Z';
export const X1042_TEXT_ONLY_MANIFEST = 'sha256:b7ac79159c876d35acd1adfe43d0fb9817b5909bd13371c326d72450b1b6a272';

export type PrepareX1042TextOnlyArgs = {
    projectId: 10; taskId: 1042; actorId: string; expectedManifestChecksum: typeof X1042_TEXT_ONLY_MANIFEST;
    approvalReference: string; idempotencyKey: string;
};

export type ReleaseX1042TextOnlyArgs = PrepareX1042TextOnlyArgs & {
    expectedReviewWorkItemId: 1420; expectedArtWorkItemId: number; expectedDecisionId: number;
    expectedWeightedLength: 273; expectedLimit: 280;
};

export type RecoverX1042OverlengthArgs = PrepareX1042TextOnlyArgs & {
    expectedBrowserWorkItemId: 1689; expectedWriterWorkItemId: 1308; expectedReviewWorkItemId: 1420;
    expectedArtWorkItemId: 1688; expectedDecisionId: 271; expectedWeightedLength: 365; expectedLimit: 280;
};

type Dependencies = {
    database: typeof prisma;
    manifestLoader: typeof loadAgentWorkspaceManifest;
    hashBody(body: string): string;
    now(): Date;
    markRevisionStale(tx: Prisma.TransactionClient, taskId: number): Promise<void>;
};

const defaults: Dependencies = {
    database: prisma,
    manifestLoader: loadAgentWorkspaceManifest,
    hashBody: body => createHash('sha256').update(body).digest('hex'),
    now: () => new Date(),
    markRevisionStale: (tx, taskId) => artDirectionService.markRevisionStale(tx, taskId)
};

function userId(actorId: string) {
    const match = /^user:(\d+)$/.exec(actorId);
    if (!match) throw new Error('[OWNER_REQUIRED]');
    return Number(match[1]);
}

function validateBase(args: PrepareX1042TextOnlyArgs) {
    if (args.projectId !== PROJECT_ID || args.taskId !== TASK_ID
        || args.expectedManifestChecksum !== X1042_TEXT_ONLY_MANIFEST) {
        throw new Error('[TASK1042_TEXT_ONLY_SCOPE_MISMATCH]');
    }
    if (!args.approvalReference?.trim()) throw new Error('[OWNER_APPROVAL_REFERENCE_REQUIRED]');
    if (!args.idempotencyKey?.trim()) throw new Error('[IDEMPOTENCY_KEY_REQUIRED]');
    return userId(args.actorId);
}

function hashRequest(args: PrepareX1042TextOnlyArgs) {
    return createHash('sha256').update(JSON.stringify(args)).digest('hex');
}

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function assetSha256(asset: { provenance: unknown } | null | undefined) {
    const provenance = record(asset?.provenance);
    const storage = record(provenance?.planner_storage);
    return typeof storage?.sha256 === 'string' ? storage.sha256 : null;
}

function hasUncertainResult(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(hasUncertainResult);
    if (!record(value)) return value === 'provider_result_uncertain';
    return Object.values(value as Record<string, unknown>).some(hasUncertainResult);
}

async function requireManifest(dependencies: Dependencies, actorUserId: number) {
    const manifest = await dependencies.manifestLoader(PROJECT_ID, actorUserId);
    if (manifest.checksum !== X1042_TEXT_ONLY_MANIFEST) throw new Error('[STALE_MANIFEST]');
    return manifest.checksum;
}

async function requireNoDelivery(tx: Prisma.TransactionClient, includeBrowserWork: boolean) {
    if (await tx.deliveryAttempt.findFirst({ where: { project_id: PROJECT_ID, content_item_id: TASK_ID } })) {
        throw new Error('[DELIVERY_ATTEMPT_EXISTS]');
    }
    if (includeBrowserWork && await tx.workItem.findFirst({ where: { project_id: PROJECT_ID, content_item_id: TASK_ID,
        kind: 'browser_publish', state: { notIn: ['completed', 'cancelled'] } } })) {
        throw new Error('[BROWSER_PUBLICATION_ALREADY_QUEUED]');
    }
}

/**
 * Reopens the unchanged accepted body as revision 5 through the canonical revision-stale boundary.
 * The old asset remains immutable; only its selection binding is invalidated by the domain service.
 */
export async function prepareXTask1042TextOnlyPackage(args: PrepareX1042TextOnlyArgs,
    dependencies: Dependencies = defaults): Promise<Record<string, unknown>> {
    const actorUserId = validateBase(args);
    const requestHash = hashRequest(args);
    return dependencies.database.$transaction(async tx => {
        const membership = await tx.projectMember.findUnique({ where: { project_id_user_id: {
            project_id: PROJECT_ID, user_id: actorUserId
        } } });
        if (membership?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        const command = 'ba_prepare_x_task1042_text_only_package';
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: PROJECT_ID, actor_id: args.actorId,
            command, idempotency_key: args.idempotencyKey } });
        if (prior?.after_state) {
            if (record(prior.before_state)?.request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...(prior.after_state as Record<string, unknown>), replayed: true };
        }
        const manifestChecksum = await requireManifest(dependencies, actorUserId);
        const task = await tx.contentItem.findFirst({ where: { id: TASK_ID, project_id: PROJECT_ID },
            include: { channel: true, selected_asset: true, publication_fact: true } });
        const [review, approval, decision] = await Promise.all([
            tx.workItem.findFirst({ where: { id: REVIEW_WORK_ITEM_ID, project_id: PROJECT_ID,
                content_item_id: TASK_ID, kind: 'content_review', state: 'completed',
                input_context_version: SOURCE_REVISION, result_version: SOURCE_REVISION } }),
            tx.approvalDecision.findUnique({ where: { work_item_id_result_version: {
                work_item_id: REVIEW_WORK_ITEM_ID, result_version: SOURCE_REVISION
            } } }),
            tx.artDirectionDecision.findFirst({ where: { id: SOURCE_DECISION_ID, project_id: PROJECT_ID,
                content_item_id: TASK_ID, source_content_revision: SOURCE_REVISION, decision_version: 2,
                decision: 'GENERATE', channel: 'x', placement: 'feed', status: 'active' } })
        ]);
        const exactSource = task && task.channel_id === CHANNEL_ID && task.channel?.name === 'innokenty_x'
            && task.channel.type === 'x' && task.channel.is_active === true
            && task.status === 'ready_for_execution' && task.publication_mode === 'approval_required'
            && task.content_revision === SOURCE_REVISION && task.accepted_revision === SOURCE_REVISION
            && task.text_state === 'accepted' && task.handoff_state === 'ready' && task.visual_state === 'APPROVED'
            && task.visual_placement === 'feed' && task.visual_decision_version === 2
            && task.selected_asset_id === SOURCE_ASSET_ID && task.selected_asset?.id === SOURCE_ASSET_ID
            && task.selected_asset.status === 'approved' && task.selected_asset.content_revision === SOURCE_REVISION
            && assetSha256(task.selected_asset) === SOURCE_ASSET_SHA256
            && task.schedule_at?.toISOString() === SCHEDULE && task.publish_at?.toISOString() === SCHEDULE
            && dependencies.hashBody(task.draft_text || '') === BODY_SHA256 && !task.publication_fact
            && !task.published_link && !task.telegram_message_id && !hasUncertainResult(task.quality_report)
            && review && approval?.decision === 'approved' && decision;
        if (!exactSource) throw new Error('[TASK1042_TEXT_ONLY_PREPARE_GUARD_FAILED] Exact image-bound rev4 package required');
        await requireNoDelivery(tx, true);

        await dependencies.markRevisionStale(tx, TASK_ID);
        const changed = await tx.contentItem.updateMany({ where: { id: TASK_ID, project_id: PROJECT_ID,
            content_revision: SOURCE_REVISION, accepted_revision: null, selected_asset_id: null,
            schedule_at: new Date(SCHEDULE), publish_at: new Date(SCHEDULE) }, data: {
            content_revision: TEXT_ONLY_REVISION, status: 'drafted', text_state: 'draft', accepted_revision: null,
            visual_state: 'STALE', handoff_state: 'blocked', quality_report: {
                ...((task.quality_report as Record<string, unknown> | null) || {}),
                owner_scope_change: { kind: 'x_text_only', actor_id: args.actorId,
                    approval_reference: args.approvalReference, source_revision: SOURCE_REVISION,
                    target_revision: TEXT_ONLY_REVISION, body_sha256: BODY_SHA256,
                    previous_selected_asset_id: SOURCE_ASSET_ID, prepared_at: dependencies.now().toISOString() }
            }
        } });
        if (changed.count !== 1) throw new Error('[TASK1042_TEXT_ONLY_PREPARE_CAS_CONFLICT]');
        await tx.workItem.update({ where: { id: REVIEW_WORK_ITEM_ID }, data: {
            state: 'available', input_context_version: TEXT_ONLY_REVISION, result_version: SOURCE_REVISION,
            result_payload: { body: task.draft_text, content_revision: TEXT_ONLY_REVISION,
                source: 'owner_text_only_scope_change' }, lease_token: null, lease_expires_at: null,
            lease_actor_id: null, note: 'Review unchanged task 1042 body as revision 5 for text-only X publication.'
        } });
        const result = { project_id: PROJECT_ID, task_id: TASK_ID, content_revision: TEXT_ONLY_REVISION,
            accepted_revision: null, body_sha256: BODY_SHA256, selected_asset_id: null,
            previous_selected_asset_id: SOURCE_ASSET_ID, review_work_item_id: REVIEW_WORK_ITEM_ID,
            review_state: 'available', schedule_at: SCHEDULE, published: false, replayed: false };
        await tx.workflowEvent.create({ data: { project_id: PROJECT_ID, content_item_id: TASK_ID,
            work_item_id: REVIEW_WORK_ITEM_ID, actor_id: args.actorId, command, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: requestHash, manifest_checksum: manifestChecksum,
                content_revision: SOURCE_REVISION, selected_asset_id: SOURCE_ASSET_ID }, after_state: result } });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * Supersedes the exact overlength revision-5 browser release and returns the task to the standard Writer queue.
 * It preserves the rejected copy as revision history and never writes replacement copy itself.
 */
export async function recoverXTask1042OverlengthRelease(args: RecoverX1042OverlengthArgs,
    dependencies: Dependencies = defaults): Promise<Record<string, unknown>> {
    const actorUserId = validateBase(args);
    if (args.expectedBrowserWorkItemId !== OVERLENGTH_BROWSER_WORK_ITEM_ID
        || args.expectedWriterWorkItemId !== WRITER_WORK_ITEM_ID || args.expectedReviewWorkItemId !== REVIEW_WORK_ITEM_ID
        || args.expectedArtWorkItemId !== OVERLENGTH_ART_WORK_ITEM_ID || args.expectedDecisionId !== OVERLENGTH_DECISION_ID
        || args.expectedWeightedLength !== 365 || args.expectedLimit !== 280) {
        throw new Error('[TASK1042_OVERLENGTH_RECOVERY_SCOPE_MISMATCH]');
    }
    const requestHash = hashRequest(args);
    return dependencies.database.$transaction(async tx => {
        const membership = await tx.projectMember.findUnique({ where: { project_id_user_id: {
            project_id: PROJECT_ID, user_id: actorUserId
        } } });
        if (membership?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        const command = 'ba_recover_x_task1042_overlength_release';
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: PROJECT_ID, actor_id: args.actorId,
            command, idempotency_key: args.idempotencyKey } });
        if (prior?.after_state) {
            if (record(prior.before_state)?.request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...(prior.after_state as Record<string, unknown>), replayed: true };
        }
        const manifestChecksum = await requireManifest(dependencies, actorUserId);
        const task = await tx.contentItem.findFirst({ where: { id: TASK_ID, project_id: PROJECT_ID },
            include: { channel: true, selected_asset: true, publication_fact: true } });
        const [browser, writer, review, approval, art, decision, attempt] = await Promise.all([
            tx.workItem.findFirst({ where: { id: OVERLENGTH_BROWSER_WORK_ITEM_ID, project_id: PROJECT_ID,
                content_item_id: TASK_ID, kind: 'browser_publish', state: 'claimed',
                input_context_version: TEXT_ONLY_REVISION } }),
            tx.workItem.findFirst({ where: { id: WRITER_WORK_ITEM_ID, project_id: PROJECT_ID,
                content_item_id: TASK_ID, kind: 'content_write', state: 'completed' } }),
            tx.workItem.findFirst({ where: { id: REVIEW_WORK_ITEM_ID, project_id: PROJECT_ID,
                content_item_id: TASK_ID, kind: 'content_review', state: 'completed',
                input_context_version: TEXT_ONLY_REVISION, result_version: TEXT_ONLY_REVISION } }),
            tx.approvalDecision.findUnique({ where: { work_item_id_result_version: {
                work_item_id: REVIEW_WORK_ITEM_ID, result_version: TEXT_ONLY_REVISION
            } } }),
            tx.workItem.findFirst({ where: { id: OVERLENGTH_ART_WORK_ITEM_ID, project_id: PROJECT_ID,
                content_item_id: TASK_ID, kind: 'art_direction', state: 'completed',
                input_context_version: TEXT_ONLY_REVISION, result_version: 3 } }),
            tx.artDirectionDecision.findFirst({ where: { id: OVERLENGTH_DECISION_ID, project_id: PROJECT_ID,
                content_item_id: TASK_ID, work_item_id: OVERLENGTH_ART_WORK_ITEM_ID,
                source_content_revision: TEXT_ONLY_REVISION, decision_version: 3,
                decision: 'NO_VISUAL_NEEDED', channel: 'x', placement: 'feed', status: 'active' } }),
            tx.deliveryAttempt.findFirst({ where: { project_id: PROJECT_ID, content_item_id: TASK_ID } })
        ]);
        const weightedLength = measureXWeightedLength(task?.draft_text || '');
        const release = record(record(task?.quality_report)?.owner_release);
        const exactOverlengthRelease = task && task.channel_id === CHANNEL_ID && task.channel?.name === 'innokenty_x'
            && task.channel.type === 'x' && task.channel.is_active === true
            && task.status === 'browser_required' && task.publication_mode === 'browser_required'
            && task.content_revision === TEXT_ONLY_REVISION && task.accepted_revision === TEXT_ONLY_REVISION
            && task.text_state === 'accepted' && task.handoff_state === 'ready'
            && task.visual_state === 'NO_VISUAL_NEEDED' && task.visual_placement === 'feed'
            && task.visual_decision_version === 3 && task.selected_asset_id === null && task.selected_asset === null
            && task.schedule_at?.toISOString() === SCHEDULE && task.publish_at?.toISOString() === SCHEDULE
            && dependencies.hashBody(task.draft_text || '') === BODY_SHA256 && weightedLength === 365
            && release?.content_revision === TEXT_ONLY_REVISION && release?.body_sha256 === BODY_SHA256
            && !task.publication_fact && !task.published_link && !task.telegram_message_id
            && !hasUncertainResult(task.quality_report) && !attempt
            && browser && browser.dedupe_key === 'browser_publish:1042:r5:text-only'
            && browser.lease_actor_id === args.actorId && writer && review && approval?.decision === 'approved'
            && art && decision;
        if (!exactOverlengthRelease) {
            throw new Error('[TASK1042_OVERLENGTH_RECOVERY_GUARD_FAILED] Exact rejected rev5 release required');
        }

        const cancelled = await tx.workItem.updateMany({ where: { id: OVERLENGTH_BROWSER_WORK_ITEM_ID,
            project_id: PROJECT_ID, content_item_id: TASK_ID, kind: 'browser_publish', state: 'claimed',
            input_context_version: TEXT_ONLY_REVISION, lease_actor_id: args.actorId }, data: {
            state: 'cancelled', lease_token: null, lease_actor_id: null, lease_expires_at: null,
            reason_code: 'SUPERSEDED_OVERLENGTH_X_PAYLOAD',
            note: 'Composer rejected revision 5 at 365/280 weighted characters; superseded before submit.'
        } });
        if (cancelled.count !== 1) throw new Error('[TASK1042_OVERLENGTH_BROWSER_CAS_CONFLICT]');
        await dependencies.markRevisionStale(tx, TASK_ID);
        const quality = record(task.quality_report) || {};
        const { owner_release: _ownerRelease, recovery_release: _recoveryRelease,
            publication_route: _publicationRoute, ...retainedQuality } = quality;
        const changed = await tx.contentItem.updateMany({ where: { id: TASK_ID, project_id: PROJECT_ID,
            channel_id: CHANNEL_ID, status: 'browser_required', publication_mode: 'browser_required',
            content_revision: TEXT_ONLY_REVISION, accepted_revision: null, selected_asset_id: null,
            schedule_at: new Date(SCHEDULE), publish_at: new Date(SCHEDULE) }, data: {
            status: 'drafted', publication_mode: 'approval_required', text_state: 'draft',
            visual_state: 'STALE', handoff_state: 'blocked', quality_report: {
                ...retainedQuality, overlength_recovery: { actor_id: args.actorId,
                    approval_reference: args.approvalReference, source_revision: TEXT_ONLY_REVISION,
                    target_revision: RELEASE_REVISION, weighted_length: weightedLength, limit: 280,
                    superseded_browser_work_item_id: OVERLENGTH_BROWSER_WORK_ITEM_ID,
                    recovered_at: dependencies.now().toISOString() }
            }
        } });
        if (changed.count !== 1) throw new Error('[TASK1042_OVERLENGTH_TASK_CAS_CONFLICT]');
        const reopened = await tx.workItem.updateMany({ where: { id: WRITER_WORK_ITEM_ID, project_id: PROJECT_ID,
            content_item_id: TASK_ID, kind: 'content_write', state: 'completed' }, data: {
            state: 'available', input_context_version: TEXT_ONLY_REVISION, lease_token: null,
            lease_actor_id: null, lease_expires_at: null, reason_code: 'X_TEXT_LIMIT_EXCEEDED',
            note: 'Rewrite accepted revision 5 as an X-native post within the 280 weighted-character limit.'
        } });
        if (reopened.count !== 1) throw new Error('[TASK1042_OVERLENGTH_WRITER_CAS_CONFLICT]');
        const result = { project_id: PROJECT_ID, task_id: TASK_ID, source_content_revision: TEXT_ONLY_REVISION,
            target_content_revision: RELEASE_REVISION, body_sha256: BODY_SHA256, weighted_length: weightedLength,
            character_limit: 280, superseded_browser_work_item_id: OVERLENGTH_BROWSER_WORK_ITEM_ID,
            writer_work_item_id: WRITER_WORK_ITEM_ID, writer_state: 'available', publication_mode: 'approval_required',
            published: false, replayed: false };
        await tx.workflowEvent.create({ data: { project_id: PROJECT_ID, content_item_id: TASK_ID,
            work_item_id: WRITER_WORK_ITEM_ID, actor_id: args.actorId, command,
            idempotency_key: args.idempotencyKey, before_state: { request_hash: requestHash,
                manifest_checksum: manifestChecksum, content_revision: TEXT_ONLY_REVISION,
                browser_work_item_id: OVERLENGTH_BROWSER_WORK_ITEM_ID, weighted_length: weightedLength },
            after_state: result } });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Exact text-only release after standard review approval and an active revision-6 NO_VISUAL_NEEDED decision. */
export async function releaseXTask1042TextOnly(args: ReleaseX1042TextOnlyArgs,
    dependencies: Dependencies = defaults): Promise<Record<string, unknown>> {
    const actorUserId = validateBase(args);
    if (args.expectedReviewWorkItemId !== REVIEW_WORK_ITEM_ID || args.expectedWeightedLength !== 273
        || args.expectedLimit !== 280 || !Number.isInteger(args.expectedArtWorkItemId)
        || args.expectedArtWorkItemId < 1 || !Number.isInteger(args.expectedDecisionId) || args.expectedDecisionId < 1) {
        throw new Error('[TASK1042_TEXT_ONLY_RELEASE_SCOPE_MISMATCH]');
    }
    const requestHash = hashRequest(args);
    return dependencies.database.$transaction(async tx => {
        const membership = await tx.projectMember.findUnique({ where: { project_id_user_id: {
            project_id: PROJECT_ID, user_id: actorUserId
        } } });
        if (membership?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        const command = 'ba_release_x_task1042_browser';
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: PROJECT_ID, actor_id: args.actorId,
            command, idempotency_key: args.idempotencyKey } });
        if (prior?.after_state) {
            if (record(prior.before_state)?.request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...(prior.after_state as Record<string, unknown>), replayed: true };
        }
        const manifestChecksum = await requireManifest(dependencies, actorUserId);
        const task = await tx.contentItem.findFirst({ where: { id: TASK_ID, project_id: PROJECT_ID },
            include: { channel: true, selected_asset: true, publication_fact: true } });
        const [review, approval, art, decision] = await Promise.all([
            tx.workItem.findFirst({ where: { id: REVIEW_WORK_ITEM_ID, project_id: PROJECT_ID,
                content_item_id: TASK_ID, kind: 'content_review', state: 'completed',
                input_context_version: RELEASE_REVISION, result_version: RELEASE_REVISION } }),
            tx.approvalDecision.findUnique({ where: { work_item_id_result_version: {
                work_item_id: REVIEW_WORK_ITEM_ID, result_version: RELEASE_REVISION
            } } }),
            tx.workItem.findFirst({ where: { id: args.expectedArtWorkItemId, project_id: PROJECT_ID,
                content_item_id: TASK_ID, kind: 'art_direction', state: 'completed',
                input_context_version: RELEASE_REVISION, result_version: 4 } }),
            tx.artDirectionDecision.findFirst({ where: { id: args.expectedDecisionId, project_id: PROJECT_ID,
                content_item_id: TASK_ID, work_item_id: args.expectedArtWorkItemId,
                source_content_revision: RELEASE_REVISION, decision_version: 4,
                decision: 'NO_VISUAL_NEEDED', channel: 'x', placement: 'feed', status: 'active' } })
        ]);
        const exactPackage = task && task.channel_id === CHANNEL_ID && task.channel?.name === 'innokenty_x'
            && task.channel.type === 'x' && task.channel.is_active === true
            && task.status === 'ready_for_execution' && task.publication_mode === 'approval_required'
            && task.content_revision === RELEASE_REVISION && task.accepted_revision === RELEASE_REVISION
            && task.text_state === 'accepted' && task.handoff_state === 'ready'
            && task.visual_state === 'NO_VISUAL_NEEDED' && task.visual_placement === 'feed'
            && task.visual_decision_version === 4 && task.selected_asset_id === null && task.selected_asset === null
            && task.schedule_at?.toISOString() === SCHEDULE && task.publish_at?.toISOString() === SCHEDULE
            && dependencies.hashBody(task.draft_text || '') === RELEASE_BODY_SHA256 && !task.publication_fact
            && !task.published_link && !task.telegram_message_id && !hasUncertainResult(task.quality_report)
            && review && approval?.decision === 'approved' && art && decision;
        if (!exactPackage) throw new Error('[TASK1042_TEXT_ONLY_RELEASE_GUARD_FAILED] Exact accepted rev6 X-native text-only package required');
        assertPublicationTextWithinLimit(task.channel!.type, task.draft_text || '', task.channel!.config);
        await requireNoDelivery(tx, true);
        const now = dependencies.now();
        const proof = { publication_authorized: true, actor_id: args.actorId,
            approval_reference: args.approvalReference, content_revision: RELEASE_REVISION,
            body_sha256: RELEASE_BODY_SHA256, selected_asset_id: null, asset_sha256: null,
            visual_decision_id: args.expectedDecisionId, released_at: now.toISOString(),
            missed_schedule_at: SCHEDULE, recovery_slot_date: '2026-10-10' };
        const changed = await tx.contentItem.updateMany({ where: { id: TASK_ID, project_id: PROJECT_ID,
            channel_id: CHANNEL_ID, status: 'ready_for_execution', publication_mode: 'approval_required',
            content_revision: RELEASE_REVISION, accepted_revision: RELEASE_REVISION, selected_asset_id: null,
            schedule_at: new Date(SCHEDULE), publish_at: new Date(SCHEDULE) }, data: {
            status: 'browser_required', publication_mode: 'browser_required', quality_report: {
                ...((task.quality_report as Record<string, unknown> | null) || {}),
                publication_route: 'browser_required', owner_release: proof, recovery_release: proof
            }
        } });
        if (changed.count !== 1) throw new Error('[TASK1042_TEXT_ONLY_RELEASE_CAS_CONFLICT]');
        const resultPayload = { ...proof, channel_id: CHANNEL_ID, target_account: '@naraHeTc',
            review_work_item_id: REVIEW_WORK_ITEM_ID,
            art_work_item_id: args.expectedArtWorkItemId } as Prisma.InputJsonValue;
        const work = await tx.workItem.create({ data: { project_id: PROJECT_ID,
            week_package_id: task.week_package_id, content_item_id: TASK_ID,
            item_key: task.item_key || 'publication-1042', kind: 'browser_publish', state: 'available',
            assignee_role: 'browser_publisher', due_at: now, reason_code: 'OWNER_RELEASED_MISSED_SLOT_RECOVERY',
            note: 'Exact owner-approved X-native text-only Personal X task 1042; do not attach an image.',
            input_context_version: RELEASE_REVISION, dedupe_key: 'browser_publish:1042:r6:text-only',
            result_payload: resultPayload } });
        const result = { project_id: PROJECT_ID, task_id: TASK_ID, channel_id: CHANNEL_ID,
            content_revision: RELEASE_REVISION, accepted_revision: RELEASE_REVISION,
            body_sha256: RELEASE_BODY_SHA256, selected_asset_id: null, asset_sha256: null,
            review_work_item_id: REVIEW_WORK_ITEM_ID, art_work_item_id: args.expectedArtWorkItemId,
            visual_decision_id: args.expectedDecisionId, schedule_at: SCHEDULE,
            recovery_slot_date: '2026-10-10', publication_mode: 'browser_required',
            browser_work_item_id: work.id, publication_authorized: true, published: false, replayed: false };
        await tx.workflowEvent.create({ data: { project_id: PROJECT_ID, content_item_id: TASK_ID,
            work_item_id: work.id, actor_id: args.actorId, command, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: requestHash, manifest_checksum: manifestChecksum,
                status: task.status, publication_mode: task.publication_mode, content_revision: RELEASE_REVISION,
                selected_asset_id: null }, after_state: result } });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

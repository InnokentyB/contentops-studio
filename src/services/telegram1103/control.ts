import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../db';
import { TG1103, video1103Scope, videoHash, videoRecord } from './contract';
import { assertVideo1103Url } from './media';
import { loadAgentWorkspaceManifest } from '../agent_workspace_manifest.service';

type Db = Prisma.TransactionClient;
export type Video1103Task = Prisma.ContentItemGetPayload<{ include: {
    channel: true; publication_fact: true; selected_asset: { include: { decision: true } } } }>;
/** Reuse the existing artifact only after normal Editor and revision-bound Art acceptance. */
export const video1103RebindSchema = video1103Scope.extend({ decisionId: z.number().int().positive() }).strict();
/** Release is separate from dispatch and binds the exact current organization manifest. */
export const video1103ReleaseSchema = video1103Scope.extend({
    expectedManifestChecksum: z.literal(TG1103.manifest) }).strict();
const rebindCommand = 'ba_rebind_telegram_video_task1103_asset';

/** Owner membership is checked inside every mutating transaction, never inferred from an actor label. */
export async function requireVideo1103Owner(db: Pick<Db, 'projectMember'>, actor: string): Promise<void> {
    const owner = await db.projectMember.findUnique({ where: { project_id_user_id: {
        project_id: TG1103.project, user_id: Number(actor.slice(5)) } } });
    if (owner?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
}
/** Common task/revision/caption/date/tenant fence used before release and again before dispatch/finalization. */
export function assertVideo1103Task(task: Video1103Task | null): asserts task is Video1103Task {
    if (!task || task.id !== TG1103.task || task.project_id !== TG1103.project
        || task.channel_id !== TG1103.channel || task.channel?.id !== TG1103.channel
        || task.channel.project_id !== TG1103.project || task.channel.type !== 'telegram'
        || task.content_revision !== 2 || task.accepted_revision !== 2 || task.text_state !== 'accepted'
        || task.visual_placement !== 'video_cover' || videoHash(task.draft_text || '') !== TG1103.bodySha
        || task.schedule_at?.toISOString() !== TG1103.date || task.publish_at?.toISOString() !== TG1103.date
        || task.publication_fact || task.published_link) throw new Error('[TELEGRAM1103_TASK_MISMATCH]');
    const config = videoRecord(task.channel.config), raw = videoRecord(config.raw_account);
    const handle = String(raw.handle ?? config.handle ?? raw.channel_username ?? config.channel_username ?? '').replace(/^@/, '');
    if (handle !== TG1103.username) throw new Error('[TELEGRAM1103_TARGET_MISMATCH]');
}
/** Byte identity and durable storage are required even when the artifact is not selected yet. */
export function assertVideo1103Asset(asset: Video1103Task['selected_asset']): void {
    const p = videoRecord(asset?.provenance), storage = videoRecord(p.planner_storage);
    if (!asset || asset.id !== 142 || asset.project_id !== 10 || asset.content_item_id !== 1103
        || asset.placement !== 'video_cover' || storage.sha256 !== TG1103.assetSha
        || storage.mime_type !== 'video/mp4' || storage.byte_size !== TG1103.bytes
        || storage.managed !== true || storage.provider !== 'r2' || !asset.file_url) {
        throw new Error('[TELEGRAM1103_ASSET_MISMATCH]');
    }
    assertVideo1103Url(asset.file_url);
}
/** Ready publication must have the same artifact approved against the current Art decision. */
export function assertVideo1103Ready(task: Video1103Task | null): asserts task is Video1103Task {
    assertVideo1103Task(task); assertVideo1103Asset(task.selected_asset);
    const asset = task.selected_asset!, decision = asset.decision;
    if (task.selected_asset_id !== 142 || task.visual_state !== 'APPROVED' || task.handoff_state !== 'ready'
        || asset.status !== 'approved' || asset.content_revision !== 2 || !decision
        || decision.project_id !== 10 || decision.content_item_id !== 1103 || decision.status !== 'active'
        || decision.source_content_revision !== 2 || decision.channel !== 'telegram' || decision.placement !== 'video_cover'
        || task.visual_decision_version !== decision.decision_version) throw new Error('[TELEGRAM1103_VISUAL_NOT_READY]');
}
/** Always load the same scoped package with its authoritative visual decision. */
export async function loadVideo1103Task(db: Pick<Db, 'contentItem'>): Promise<Video1103Task | null> {
    return db.contentItem.findFirst({ where: { id: 1103, project_id: 10 }, include: {
        channel: true, publication_fact: true, selected_asset: { include: { decision: true } } } });
}
async function noAttempts(db: Pick<Db, 'deliveryAttempt'>): Promise<void> {
    if (await db.deliveryAttempt.count({ where: { project_id: 10, content_item_id: 1103 } })) {
        throw new Error('[DELIVERY_ATTEMPT_EXISTS]');
    }
}
function eventKey(actor: string, command: string, idempotencyKey: string) {
    return { project_id_actor_id_command_idempotency_key: {
        project_id: 10, actor_id: actor, command, idempotency_key: idempotencyKey } };
}
async function replay(db: Pick<Db, 'workflowEvent'>, actor: string, command: string, key: string, requestHash: string) {
    const old = await db.workflowEvent.findUnique({ where: eventKey(actor, command, key) });
    if (!old) return null;
    if (videoRecord(old.before_state).request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
    return { ...videoRecord(old.after_state), audit_id: old.id, replayed: true };
}

/** Audited forward rebind; no duplicate artifact/upload, no content acceptance, no send. */
export async function rebindTelegram1103Asset(input: z.input<typeof video1103RebindSchema>, database = prisma) {
    const args = video1103RebindSchema.parse(input), { apply, ...binding } = args;
    const requestHash = videoHash(JSON.stringify(binding));
    return database.$transaction(async tx => {
        await requireVideo1103Owner(tx, args.actorId);
        const old = await replay(tx, args.actorId, rebindCommand, args.idempotencyKey, requestHash); if (old) return old;
        const task = await loadVideo1103Task(tx); assertVideo1103Task(task); await noAttempts(tx);
        if (task.publication_mode !== 'approval_required' || task.selected_asset_id !== null
            || ['publishing','published','removed','cancelled'].includes(task.status)) throw new Error('[TELEGRAM1103_REBIND_STATE_MISMATCH]');
        const asset = await tx.imageAsset.findFirst({ where: { id: 142, project_id: 10, content_item_id: 1103 }, include: { decision: true } });
        assertVideo1103Asset(asset);
        if (asset!.content_revision !== 1 || asset!.decision_id !== 285 || asset!.status !== 'approved') throw new Error('[TELEGRAM1103_SOURCE_BINDING_MISMATCH]');
        const decision = await tx.artDirectionDecision.findFirst({ where: { id: args.decisionId, project_id: 10, content_item_id: 1103 } });
        if (!decision || decision.id !== args.decisionId || decision.status !== 'active'
            || decision.source_content_revision !== 2 || decision.channel !== 'telegram' || decision.placement !== 'video_cover'
            || task.visual_decision_version !== decision.decision_version
            || !['SOURCE_REQUIRED','MANUAL_ASSET_REQUIRED'].includes(decision.decision)) throw new Error('[CURRENT_ART_DECISION_REQUIRED]');
        const result = { mode: apply ? 'applied' : 'preview', task_id: 1103, asset_id: 142,
            content_revision: 2, decision_id: decision.id, asset_sha256: TG1103.assetSha,
            visual_review_required: true, publication_authorized: false };
        if (!apply) return result;
        const changed = await tx.imageAsset.updateMany({ where: { id: 142, project_id: 10, content_item_id: 1103,
            content_revision: 1, decision_id: 285, status: 'approved', file_url: asset!.file_url,
            provenance: { equals: asset!.provenance ?? Prisma.JsonNull } }, data: { content_revision: 2,
            decision_id: decision.id, status: 'candidate', provenance: { ...videoRecord(asset!.provenance),
                revision_rebind: { source_content_revision: 1, source_decision_id: 285,
                    target_content_revision: 2, target_decision_id: decision.id, body_sha256: TG1103.bodySha,
                    prior_qa_sha256: videoHash(JSON.stringify(asset!.qa_report)), reason: args.reason } } } });
        if (changed.count !== 1) throw new Error('[TELEGRAM1103_ASSET_CAS_CONFLICT]');
        const review = await tx.workItem.create({ data: { project_id: 10, content_item_id: 1103,
            week_package_id: task.week_package_id, item_key: task.item_key || 'content:1103',
            kind: 'visual_review', state: 'available', assignee_role: 'visual_reviewer', input_context_version: 2,
            dedupe_key: `visual-review-rebind:142:2:${decision.id}`, result_payload: { asset_id: 142, decision_id: decision.id } } });
        const taskChanged = await tx.contentItem.updateMany({ where: { id: 1103, project_id: 10, content_revision: 2,
            accepted_revision: 2, selected_asset_id: null, visual_decision_version: decision.decision_version },
        data: { visual_state: 'IN_REVIEW', handoff_state: 'blocked' } });
        if (taskChanged.count !== 1) throw new Error('[TELEGRAM1103_REBIND_CAS_CONFLICT]');
        const event = await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1103,
            work_item_id: review.id, actor_id: args.actorId, command: rebindCommand, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: requestHash, source_content_revision: 1, source_decision_id: 285,
                source_asset_id: 142, source_asset_version: asset!.asset_version,
                provenance_sha256: videoHash(JSON.stringify(asset!.provenance)), qa_sha256: videoHash(JSON.stringify(asset!.qa_report)) },
            after_state: { ...result, visual_review_work_item_id: review.id } } });
        return { ...result, visual_review_work_item_id: review.id, audit_id: event.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Audited owner release only; scheduler authority is not widened and dispatch remains separate. */
export async function releaseTelegram1103(input: z.input<typeof video1103ReleaseSchema>, database = prisma,
    manifestChecksum = async (actor: string): Promise<string> => (await loadAgentWorkspaceManifest(10, Number(actor.slice(5)))).checksum) {
    const args = video1103ReleaseSchema.parse(input), { apply, ...binding } = args;
    const requestHash = videoHash(JSON.stringify(binding));
    const cached = await database.$transaction(async tx => {
        await requireVideo1103Owner(tx, args.actorId);
        return replay(tx, args.actorId, TG1103.releaseCommand, args.idempotencyKey, requestHash);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (cached) return cached;
    if (await manifestChecksum(args.actorId) !== args.expectedManifestChecksum) throw new Error('[MANIFEST_CHANGED]');
    return database.$transaction(async tx => {
        await requireVideo1103Owner(tx, args.actorId);
        const old = await replay(tx, args.actorId, TG1103.releaseCommand, args.idempotencyKey, requestHash); if (old) return old;
        const task = await loadVideo1103Task(tx); assertVideo1103Ready(task); await noAttempts(tx);
        if (task.status !== 'ready_for_execution' || task.publication_mode !== 'approval_required') throw new Error('[TELEGRAM1103_RELEASE_STATE_MISMATCH]');
        const result = { mode: apply ? 'applied' : 'preview', task_id: 1103, channel_id: 109, content_revision: 2,
            accepted_revision: 2, selected_asset_id: 142, asset_sha256: TG1103.assetSha,
            asset_url_sha256: videoHash(task.selected_asset!.file_url!), asset_metadata_sha256: videoHash(JSON.stringify(task.selected_asset)),
            channel_config_sha256: videoHash(JSON.stringify(task.channel!.config)), body_sha256: TG1103.bodySha,
            schedule_at: TG1103.date, publish_at: TG1103.date, placement: 'video_cover',
            publication_mode: 'owner_released', explicit_send_required: true, published: false };
        if (!apply) return result;
        const changed = await tx.contentItem.updateMany({ where: { id: 1103, project_id: 10, channel_id: 109,
            status: 'ready_for_execution', publication_mode: 'approval_required', content_revision: 2,
            accepted_revision: 2, selected_asset_id: 142, visual_state: 'APPROVED', handoff_state: 'ready',
            visual_decision_version: task.visual_decision_version, draft_text: task.draft_text,
            schedule_at: new Date(TG1103.date), publish_at: new Date(TG1103.date) }, data: { publication_mode: 'owner_released' } });
        if (changed.count !== 1) throw new Error('[TELEGRAM1103_RELEASE_CAS_CONFLICT]');
        const event = await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1103,
            actor_id: args.actorId, command: TG1103.releaseCommand, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: requestHash, approval_reference: args.reason, manifest_checksum: args.expectedManifestChecksum },
            after_state: result } });
        return { ...result, audit_id: event.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

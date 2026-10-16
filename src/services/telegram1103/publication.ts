import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../db';
import publicationFactService, { RecordPublicationFactArgs } from '../publication_fact.service';
import { TG1103, videoHash, videoRecord } from './contract';
import { assertVideo1103Ready, loadVideo1103Task, requireVideo1103Owner, Video1103Task } from './control';
import { loadVideo1103 } from './media';
import { sendVideo1103 } from './adapter';

const actor = 'system:planner:telegram1103';
const schema = z.object({ projectId: z.literal(10), taskId: z.literal(1103), dryRun: z.boolean().optional(),
    idempotencyKey: z.string().min(1).max(160).optional() }).strict();
type Args = z.input<typeof schema>;
type Dependencies = { db: typeof prisma; loadMedia: typeof loadVideo1103; send: typeof sendVideo1103;
    recordFact: (args: RecordPublicationFactArgs) => Promise<unknown> };
const keyWhere = (key: string, command: string = TG1103.publishCommand) => ({
    project_id_actor_id_command_idempotency_key: { project_id: 10, actor_id: actor, command, idempotency_key: key } });
const readyWhere = (task: Video1103Task) => ({ id: 1103, project_id: 10, channel_id: 109,
    status: 'ready_for_execution', publication_mode: 'owner_released', content_revision: 2, accepted_revision: 2,
    selected_asset_id: 142, draft_text: task.draft_text, visual_decision_version: task.visual_decision_version,
    schedule_at: new Date(TG1103.date), publish_at: new Date(TG1103.date) });

async function releaseProof(db: Pick<Prisma.TransactionClient, 'workflowEvent' | 'projectMember'>, task: Video1103Task) {
    const event = await db.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1103,
        command: TG1103.releaseCommand }, orderBy: { id: 'desc' } });
    if (!event) throw new Error('[OWNER_RELEASE_REQUIRED]');
    await requireVideo1103Owner(db, event.actor_id);
    const proof = videoRecord(event.after_state);
    if (proof.task_id !== 1103 || proof.channel_id !== 109 || proof.content_revision !== 2 || proof.accepted_revision !== 2
        || proof.selected_asset_id !== 142 || proof.asset_sha256 !== TG1103.assetSha || proof.body_sha256 !== TG1103.bodySha
        || proof.schedule_at !== TG1103.date || proof.publish_at !== TG1103.date || proof.placement !== 'video_cover'
        || proof.publication_mode !== 'owner_released'
        || proof.channel_config_sha256 !== videoHash(JSON.stringify(task.channel!.config))
        || proof.asset_metadata_sha256 !== videoHash(JSON.stringify(task.selected_asset))
        || proof.asset_url_sha256 !== videoHash(task.selected_asset!.file_url!)) throw new Error('[OWNER_RELEASE_PROOF_MISMATCH]');
    return event;
}

/** Exact #1103 lifecycle: durable serializable claim/attempt, one adapter call, independently read-back fact. */
export class Telegram1103Publication {
    constructor(private readonly deps: Dependencies = { db: prisma, loadMedia: loadVideo1103,
        send: sendVideo1103, recordFact: args => publicationFactService.record(args) }) {}

    async execute(input: Args): Promise<Record<string, unknown>> {
        const args = schema.parse(input), { db } = this.deps;
        if (!args.dryRun && !args.idempotencyKey) throw new Error('[IDEMPOTENCY_KEY_REQUIRED]');
        const task = await loadVideo1103Task(db);
        if (task?.publication_fact) {
            const fact = task.publication_fact;
            if (task.project_id === 10 && task.channel_id === 109 && fact.outcome === 'published'
                && fact.artifact_kind === 'video' && fact.provider_object_id
                && fact.public_url === `https://t.me/${TG1103.username}/${fact.provider_object_id}`) {
                return { mode: 'published', task_id: 1103, publication_fact_id: fact.id,
                    published_link: fact.public_url, external_id: fact.provider_object_id, replayed: true };
            }
            throw new Error('[PUBLICATION_FACT_RECONCILIATION_REQUIRED]');
        }
        if (task?.publication_mode === 'approval_required') throw new Error('[OWNER_RELEASE_REQUIRED]');
        assertVideo1103Ready(task);
        if (task.publication_mode !== 'owner_released') throw new Error('[OWNER_RELEASE_REQUIRED]');
        if (await db.deliveryAttempt.count({ where: { project_id: 10, content_item_id: 1103 } })
            || task.status === 'publishing') throw new Error('[TELEGRAM_VIDEO_ATTEMPT_UNCERTAIN] Reconcile, never resend');
        if (task.status !== 'ready_for_execution') throw new Error('[PUBLICATION_STATE_CHANGED]');
        const release = await releaseProof(db, task);
        const config = videoRecord(task.channel!.config), raw = videoRecord(config.raw_account);
        const target = String(raw.telegram_channel_id ?? config.telegram_channel_id ?? '');
        if (!target) throw new Error('[TELEGRAM_VIDEO_TARGET_REQUIRED]');
        const preview = { task_id: 1103, project_id: 10, channel_id: 109, accepted_revision: 2,
            selected_asset_id: 142, placement: 'video_cover', delivery: 'mtproto_video',
            route_executable: true, direct_execution_supported: true, connector_ready: true,
            payload_preview: { text: task.draft_text, video_url: task.selected_asset!.file_url,
                image_url: null, has_video: true, has_image: false, mime_type: 'video/mp4', sha256: TG1103.assetSha } };
        // R2 read is not a provider send; verify the exact original bytes before claiming publication.
        const media = await this.deps.loadMedia(task.selected_asset!.file_url!);
        if (args.dryRun) return { mode: 'dry_run', ...preview, resource_readback: 'PASS', media: media.metadata };
        const key = args.idempotencyKey!;
        const attempt = await db.$transaction(async tx => {
            const fresh = await loadVideo1103Task(tx); assertVideo1103Ready(fresh);
            if ((await releaseProof(tx, fresh)).id !== release.id) throw new Error('[OWNER_RELEASE_CHANGED]');
            if (await tx.deliveryAttempt.count({ where: { project_id: 10, content_item_id: 1103 } })) throw new Error('[DELIVERY_ATTEMPT_EXISTS]');
            const changed = await tx.contentItem.updateMany({ where: readyWhere(fresh), data: { status: 'publishing' } });
            if (changed.count !== 1) throw new Error('[PUBLICATION_ALREADY_CLAIMED]');
            const a = await tx.deliveryAttempt.create({ data: { project_id: 10, content_item_id: 1103, channel_id: 109,
                mode: 'automatic', status: 'pending', attempt_number: 1, idempotency_key: key, scheduled_at: fresh.schedule_at } });
            await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1103, actor_id: actor,
                command: `${TG1103.publishCommand}:claim`, idempotency_key: key,
                before_state: { status: fresh.status, release_id: release.id },
                after_state: { attempt_id: a.id, status: 'publishing', asset_sha256: TG1103.assetSha,
                    body_sha256: TG1103.bodySha, channel_id: 109, placement: 'video_cover' } } });
            return a;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        try {
            const receipt = await this.deps.send({ caption: task.draft_text!, target, file: media.file,
                metadata: media.metadata, idempotencyKey: key });
            if (receipt.verified !== true || receipt.sha256 !== TG1103.assetSha || receipt.mimeType !== 'video/mp4'
                || !Number.isSafeInteger(receipt.messageId) || receipt.messageId < 1
                || receipt.publicUrl !== `https://t.me/${TG1103.username}/${receipt.messageId}`) throw new Error('[PROVIDER_READBACK_REQUIRED]');
            await db.workflowEvent.create({ data: { project_id: 10, content_item_id: 1103, actor_id: actor,
                command: `${TG1103.publishCommand}:provider`, idempotency_key: key,
                before_state: { attempt_id: attempt.id }, after_state: { ...receipt } } });
            const result = { mode: 'published', task_id: 1103, project_id: 10, channel_id: 109, accepted_revision: 2,
                selected_asset_id: 142, published_link: receipt.publicUrl, external_id: String(receipt.messageId),
                delivery_method: 'mtproto_video', attempt_id: attempt.id };
            const fact = await this.deps.recordFact({ projectId: 10, taskId: 1103, actorId: release.actor_id,
                artifactKind: 'video', outcome: 'published', confirmationMode: 'automatic',
                publishedAt: new Date().toISOString(), publicUrl: receipt.publicUrl, providerObjectId: String(receipt.messageId),
                evidence: { type: 'api', ref: receipt.publicUrl }, note: 'Native MP4; exact owner release and independent MTProto readback',
                beforeWrite: async tx => {
                    const current = await loadVideo1103Task(tx); assertVideo1103Ready(current);
                    if (current.status !== 'publishing' || (await releaseProof(tx, current)).id !== release.id) throw new Error('[PUBLICATION_FINALIZE_STATE_CHANGED]');
                    if (await tx.deliveryAttempt.count({ where: { project_id: 10, content_item_id: 1103 } }) !== 1) throw new Error('[PUBLICATION_ATTEMPT_CHANGED]');
                    const updated = await tx.deliveryAttempt.updateMany({ where: { id: attempt.id, project_id: 10,
                        content_item_id: 1103, status: 'pending', idempotency_key: key },
                    data: { status: 'delivered', actual_published_at: new Date(), requires_manual_confirmation: false } });
                    if (updated.count !== 1) throw new Error('[PUBLICATION_ATTEMPT_CHANGED]');
                    await tx.contentItem.update({ where: { id: 1103 }, data: { telegram_message_id: receipt.messageId } });
                    await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1103, actor_id: actor,
                        command: TG1103.publishCommand, idempotency_key: key,
                        before_state: { attempt_id: attempt.id, release_id: release.id }, after_state: result } });
                } });
            return { ...result, publication_fact: videoRecord(fact).publication_fact, replayed: false };
        } catch {
            await db.deliveryAttempt.updateMany({ where: { id: attempt.id, project_id: 10,
                content_item_id: 1103, status: 'pending' }, data: { error_message: 'TELEGRAM_VIDEO_RESULT_UNCERTAIN', requires_manual_confirmation: true } });
            throw new Error('[TELEGRAM_VIDEO_RESULT_UNCERTAIN] Existing attempt must be reconciled; no resend');
        }
    }
}
export default new Telegram1103Publication();

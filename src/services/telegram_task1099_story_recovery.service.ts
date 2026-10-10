import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { repairMaterializedPublicationProjection } from './publication_metadata_repair';

export const TELEGRAM1099_MANIFEST_CHECKSUM =
    'sha256:d5970e6b33d5f161a73f6ebc13fb5255f5a24be4f14251e57e5223ea03a2192f';

const SPEC = {
    taskId: 1099, initiativeId: 296, channelId: 108, revision: 1,
    bodySha256: 'f46104f5ed4e1b892d07eb1474015890165bc61a3d9bd0c7bce3edc061f2a2be',
    decisionId: 277, decisionVersion: 1, artWorkItemId: 1720, sourceWorkItemId: 1721,
    assetId: 134, sourceTaskId: 1098, sourceAssetId: 133, sourceFactId: 442,
    assetSha256: 'ab299952f375cef3346c9a43dc529db1a74ac281dc16f290ab8de0b6cb796c6c',
    prohibitedRenderJob: '6474ed84-5a6a-494d-a06c-7183e9ace9bb',
    schedule: '2026-10-10T13:30:00.000Z', accountId: 2,
    sourceStoryTaskId: 986, sourceStoryFactId: 363,
    sourceStoryUrl: 'https://t.me/InnokentyB/s/54',
    sourceYoutubeUrl: 'https://www.youtube.com/shorts/c7ubssjGmSA'
} as const;

type BaseArgs = { projectId: 10; taskId: 1099; actorId: string;
    expectedManifestChecksum: typeof TELEGRAM1099_MANIFEST_CHECKSUM; idempotencyKey: string };
type ReleaseArgs = BaseArgs & { approvalReference: string };
type Dependencies = { database: typeof prisma; manifestLoader: typeof loadAgentWorkspaceManifest;
    hashBody: (body: string) => string; now: () => Date };

const dependencies: Dependencies = { database: prisma, manifestLoader: loadAgentWorkspaceManifest,
    hashBody: body => createHash('sha256').update(body).digest('hex'), now: () => new Date() };

function record(value: unknown): Record<string, any> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
}

function requestHash(args: BaseArgs | ReleaseArgs) {
    return createHash('sha256').update(JSON.stringify(args)).digest('hex');
}

function actorUserId(args: BaseArgs) {
    const actor = /^user:(\d+)$/.exec(args.actorId);
    if (args.projectId !== 10 || args.taskId !== 1099) throw new Error('[TELEGRAM1099_SCOPE_MISMATCH]');
    if (!actor) throw new Error('[OWNER_REQUIRED]');
    if (!args.idempotencyKey?.trim()) throw new Error('[IDEMPOTENCY_KEY_REQUIRED]');
    if (args.expectedManifestChecksum !== TELEGRAM1099_MANIFEST_CHECKSUM) throw new Error('[STALE_MANIFEST]');
    return Number(actor[1]);
}

async function verifyManifest(args: BaseArgs, deps: Dependencies, userId: number) {
    const manifest = await deps.manifestLoader(10, userId);
    if (manifest.checksum !== TELEGRAM1099_MANIFEST_CHECKSUM) throw new Error('[STALE_MANIFEST]');
    return manifest.checksum;
}

async function requireOwner(tx: any, userId: number) {
    const [project, owner] = await Promise.all([
        tx.project.findUnique({ where: { id: 10 }, select: { slug: true } }),
        tx.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: userId } } })
    ]);
    if (project?.slug !== 'analystcraft-2') throw new Error('[MCP_PROJECT_SCOPE_MISMATCH]');
    if (owner?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
}

async function loadExactPackage(tx: any, deps: Dependencies, expectedType: string, expectedPlacement: string) {
    const [initiative, task, decision, artWork, sourceWork, sourceAsset, sourceFact, attempt, claim] = await Promise.all([
        tx.initiative.findUnique({ where: { id: SPEC.initiativeId } }),
        tx.contentItem.findFirst({ where: { id: SPEC.taskId, project_id: 10 },
            include: { channel: true, selected_asset: true, publication_fact: true } }),
        tx.artDirectionDecision.findUnique({ where: { id: SPEC.decisionId } }),
        tx.workItem.findUnique({ where: { id: SPEC.artWorkItemId } }),
        tx.workItem.findUnique({ where: { id: SPEC.sourceWorkItemId } }),
        tx.imageAsset.findUnique({ where: { id: SPEC.sourceAssetId } }),
        tx.publicationFact.findUnique({ where: { id: SPEC.sourceFactId } }),
        tx.deliveryAttempt.findFirst({ where: { project_id: 10, content_item_id: SPEC.taskId } }),
        tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: SPEC.taskId,
            command: 'ba_publish_publication_task_claim' } })
    ]);
    if (task?.publication_fact || task?.published_link || task?.telegram_message_id) throw new Error('[PUBLICATION_FACT_EXISTS]');
    if (attempt || claim || record(task?.quality_report)?.publication_task_delivery) {
        throw new Error('[DELIVERY_ATTEMPT_EXISTS]');
    }
    const asset = task?.selected_asset;
    const provenance = record(asset?.provenance);
    const qa = record(asset?.qa_report);
    const sourceStorage = record(sourceAsset?.provenance)?.planner_storage;
    if (!initiative || initiative.project_id !== 10 || initiative.id !== 296
        || initiative.external_key !== 'ANALYSTCRAFT-TG-STORY-20261010-VIDEO-01'
        || initiative.kind !== 'publication' || initiative.subtype !== 'telegram_story'
        || initiative.due_at?.toISOString() !== SPEC.schedule
        || !task || task.channel_id !== SPEC.channelId || task.channel?.type !== 'telegram'
        || task.channel.name !== 'spherical_analyst_tg' || task.channel.is_active !== true
        || record(task.channel.config)?.account_ref !== 'spherical_analyst_tg'
        || task.type !== expectedType || task.visual_placement !== expectedPlacement
        || task.status !== 'ready_for_execution' || task.publication_mode !== 'approval_required'
        || task.content_revision !== 1 || task.accepted_revision !== 1 || task.text_state !== 'accepted'
        || deps.hashBody(task.draft_text || '') !== SPEC.bodySha256 || !task.draft_text?.trim()
        || task.visual_mode !== 'auto_assess' || task.visual_state !== 'APPROVED'
        || task.visual_decision_version !== 1 || task.selected_asset_id !== SPEC.assetId
        || task.handoff_state !== 'ready' || task.schedule_at?.toISOString() !== SPEC.schedule
        || task.publish_at?.toISOString() !== SPEC.schedule
        || !decision || decision.project_id !== 10 || decision.content_item_id !== 1099
        || decision.work_item_id !== 1720 || decision.source_content_revision !== 1
        || decision.decision_version !== 1 || decision.channel !== 'telegram'
        || decision.placement !== 'story' || decision.decision !== 'MANUAL_ASSET_REQUIRED' || decision.status !== 'active'
        || artWork?.content_item_id !== 1099 || artWork.kind !== 'art_direction'
        || artWork.state !== 'completed' || artWork.input_context_version !== 1 || artWork.result_version !== 1
        || sourceWork?.content_item_id !== 1099 || sourceWork.kind !== 'visual_source_collect'
        || sourceWork.state !== 'blocked' || sourceWork.reason_code !== 'MANUAL_ASSET_REQUIRED'
        || sourceWork.input_context_version !== 1
        || !asset || asset.id !== 134 || asset.decision_id !== 277 || asset.content_revision !== 1
        || asset.placement !== 'story' || asset.status !== 'approved' || asset.file_url !== sourceAsset?.file_url
        || provenance?.sha256 !== SPEC.assetSha256 || provenance?.source_task_id !== 1098
        || provenance?.source_asset_id !== 133 || provenance?.source_publication_fact_id !== 442
        || provenance?.personal_story_route !== true || provenance?.prohibited_render_job !== SPEC.prohibitedRenderJob
        || !String(provenance?.owner_uat || '').includes('Прекрасно, можно публиковать')
        || qa?.verdict !== 'PASS' || qa?.full_decode !== 'PASS'
        || qa?.camera_voice_match !== 'accepted by owner' || qa?.file_sha256 !== SPEC.assetSha256
        || qa?.prohibited_render_job !== SPEC.prohibitedRenderJob
        || !sourceAsset || sourceAsset.project_id !== 10 || sourceAsset.content_item_id !== 1098
        || sourceAsset.status !== 'approved' || sourceAsset.file_url !== asset.file_url
        || !record(sourceStorage) || sourceStorage.managed !== true
        || sourceStorage.sha256 !== SPEC.assetSha256 || sourceStorage.mime_type !== 'video/mp4'
        || !sourceFact || sourceFact.project_id !== 10 || sourceFact.content_item_id !== 1098
        || sourceFact.outcome !== 'published' || sourceFact.public_url !== SPEC.sourceYoutubeUrl
        || sourceFact.provider_object_id !== 'c7ubssjGmSA') {
        throw new Error('[TELEGRAM1099_PACKAGE_CHANGED] Exact accepted Story package changed');
    }
    return task;
}

export async function repairTelegramTask1099Story(args: BaseArgs, deps: Dependencies = dependencies): Promise<Record<string, unknown>> {
    const userId = actorUserId(args);
    const manifestChecksum = await verifyManifest(args, deps, userId);
    const hash = requestHash(args);
    return deps.database.$transaction(async tx => {
        await requireOwner(tx, userId);
        const command = 'ba_repair_telegram_task1099_story_placement';
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1099,
            actor_id: args.actorId, command, idempotency_key: args.idempotencyKey } });
        if (prior?.after_state) {
            if (record(prior.before_state)?.request_hash !== hash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...(record(prior.after_state) || {}), replayed: true };
        }
        const task = await loadExactPackage(tx, deps, 'publication', 'feed');
        const projection = repairMaterializedPublicationProjection({ assets: task.assets,
            qualityReport: task.quality_report, metrics: task.metrics, channel: task.channel, placement: 'story' });
        const correction = { actor_id: args.actorId, initiative_id: 296, from_type: 'publication',
            to_type: 'telegram_story', from_placement: 'feed', to_placement: 'story', decision_id: 277,
            selected_asset_id: 134, asset_sha256: SPEC.assetSha256, corrected_at: deps.now().toISOString() };
        const changed = await tx.contentItem.updateMany({ where: { id: 1099, project_id: 10, channel_id: 108,
            type: 'publication', visual_placement: 'feed', content_revision: 1, accepted_revision: 1,
            selected_asset_id: 134, publication_mode: 'approval_required', status: 'ready_for_execution' },
        data: { type: 'telegram_story', visual_placement: 'story',
            assets: projection.assets as Prisma.InputJsonValue,
            quality_report: { ...projection.qualityReport, personal_story_route: true,
                placement_correction: correction } as Prisma.InputJsonValue,
            metrics: projection.metrics as Prisma.InputJsonValue } });
        if (changed.count !== 1) throw new Error('[TELEGRAM1099_REPAIR_CAS_CONFLICT]');
        const result = { project_id: 10, task_id: 1099, channel_id: 108, type: 'telegram_story',
            visual_placement: 'story', content_revision: 1, accepted_revision: 1,
            body_sha256: SPEC.bodySha256, decision_id: 277, selected_asset_id: 134,
            asset_sha256: SPEC.assetSha256, schedule_at: SPEC.schedule, published: false, replayed: false };
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1099, actor_id: args.actorId,
            command, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: hash, manifest_checksum: manifestChecksum,
                type: task.type, visual_placement: task.visual_placement }, after_state: result } });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function releaseTelegramTask1099Story(args: ReleaseArgs, deps: Dependencies = dependencies): Promise<Record<string, unknown>> {
    const userId = actorUserId(args);
    if (!args.approvalReference?.trim()) throw new Error('[OWNER_APPROVAL_REFERENCE_REQUIRED]');
    const manifestChecksum = await verifyManifest(args, deps, userId);
    const hash = requestHash(args);
    return deps.database.$transaction(async tx => {
        await requireOwner(tx, userId);
        const command = 'ba_release_telegram_task1099_personal_story';
        const prior = await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1099,
            actor_id: args.actorId, command, idempotency_key: args.idempotencyKey } });
        if (prior?.after_state) {
            if (record(prior.before_state)?.request_hash !== hash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...(record(prior.after_state) || {}), replayed: true };
        }
        const task = await loadExactPackage(tx, deps, 'telegram_story', 'story');
        const repair = await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1099,
            command: 'ba_repair_telegram_task1099_story_placement' }, orderBy: { id: 'desc' } });
        const repairProof = record(repair?.after_state);
        const [accounts, sourceStory] = await Promise.all([
            tx.telegramAccount.findMany({ where: { project_id: 10, is_active: true }, orderBy: { id: 'asc' },
                select: { id: true, project_id: true, is_active: true } }),
            tx.contentItem.findFirst({ where: { id: SPEC.sourceStoryTaskId, project_id: 10 },
                include: { publication_fact: true } })
        ]);
        const sourceDelivery = record(sourceStory?.quality_report)?.publication_task_delivery;
        if (!repairProof || repairProof.type !== 'telegram_story' || repairProof.visual_placement !== 'story') {
            throw new Error('[TELEGRAM1099_REPAIR_PROOF_REQUIRED]');
        }
        if (accounts.length !== 1 || accounts[0].id !== SPEC.accountId
            || sourceStory?.channel_id !== 108 || sourceStory.type !== 'telegram_story'
            || sourceStory.status !== 'published' || sourceStory.publication_fact?.id !== SPEC.sourceStoryFactId
            || sourceStory.publication_fact.outcome !== 'published'
            || sourceStory.publication_fact.public_url !== SPEC.sourceStoryUrl
            || sourceStory.publication_fact.provider_object_id !== '54'
            || !sourceDelivery || sourceDelivery.state !== 'provider_confirmed'
            || sourceDelivery.delivery !== 'mtproto_personal_story') {
            throw new Error('[TELEGRAM1099_SESSION_BINDING_MISMATCH]');
        }
        const proof = { publication_authorized: true, actor_id: args.actorId,
            approval_reference: args.approvalReference, manifest_checksum: manifestChecksum,
            task_id: 1099, channel_id: 108, content_revision: 1, accepted_revision: 1,
            body_sha256: SPEC.bodySha256, placement: 'story', publication_mode: 'owner_released',
            decision_id: 277, selected_asset_id: 134, asset_sha256: SPEC.assetSha256,
            schedule_at: SPEC.schedule, telegram_account_id: 2,
            source_story_task_id: 986, source_story_fact_id: 363,
            released_at: deps.now().toISOString() };
        const changed = await tx.contentItem.updateMany({ where: { id: 1099, project_id: 10, channel_id: 108,
            type: 'telegram_story', visual_placement: 'story', content_revision: 1, accepted_revision: 1,
            selected_asset_id: 134, status: 'ready_for_execution', publication_mode: 'approval_required',
            schedule_at: new Date(SPEC.schedule), publish_at: new Date(SPEC.schedule) },
        data: { publication_mode: 'owner_released', quality_report: {
            ...(record(task.quality_report) || {}), owner_release: proof
        } as Prisma.InputJsonValue } });
        if (changed.count !== 1) throw new Error('[TELEGRAM1099_RELEASE_CAS_CONFLICT]');
        const result = { ...proof, explicit_send_required: true, published: false, replayed: false };
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1099, actor_id: args.actorId,
            command, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: hash, publication_mode: task.publication_mode,
                manifest_checksum: manifestChecksum }, after_state: result as Prisma.InputJsonValue } });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export const TELEGRAM1099_SPEC = SPEC;

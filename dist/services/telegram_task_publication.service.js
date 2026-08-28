"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelegramTaskPublicationService = void 0;
const db_1 = __importDefault(require("../db"));
const publisher_service_1 = __importDefault(require("./publisher.service"));
const publication_fact_service_1 = __importDefault(require("./publication_fact.service"));
const telegram_delivery_payload_1 = require("./telegram_delivery_payload");
const COMMAND = 'ba_publish_publication_task';
const SYSTEM_ACTOR = 'system:planner-mcp:telegram-publication';
const CLAIMABLE_STATUSES = ['approved', 'ready_for_execution', 'blocked', 'failed'];
function resolveApprovedAsset(task) {
    if (!task.selected_asset_id && !task.selected_asset)
        return null;
    const asset = task.selected_asset;
    if (!asset
        || asset.status !== 'approved'
        || asset.content_revision !== task.accepted_revision) {
        throw new Error('[APPROVED_VISUAL_REQUIRED] Selected visual must be approved for the accepted content revision');
    }
    const fileUrl = typeof asset.file_url === 'string' ? asset.file_url.trim() : '';
    let parsed;
    try {
        parsed = new URL(fileUrl);
    }
    catch {
        throw new Error('[APPROVED_VISUAL_NOT_SERVER_RESOLVABLE] Approved visual must use a durable HTTPS URL');
    }
    if (parsed.protocol !== 'https:') {
        throw new Error('[APPROVED_VISUAL_NOT_SERVER_RESOLVABLE] Approved visual must use a durable HTTPS URL');
    }
    if (['localhost', '0.0.0.0', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase())) {
        throw new Error('[APPROVED_VISUAL_NOT_SERVER_RESOLVABLE] Approved visual URL cannot target a local host');
    }
    return { ...asset, file_url: parsed.toString() };
}
function prepareTaskPayload(task) {
    if (task.channel?.type !== 'telegram') {
        throw new Error('[TELEGRAM_TASK_REQUIRED] Publication task must target a Telegram channel');
    }
    if (!task.accepted_revision
        || task.accepted_revision !== task.content_revision
        || task.text_state !== 'accepted') {
        throw new Error('[ACCEPTED_REVISION_REQUIRED] Telegram publication requires the current accepted text revision');
    }
    const selectedAsset = resolveApprovedAsset(task);
    if (task.visual_state === 'APPROVED' && !selectedAsset) {
        throw new Error('[APPROVED_VISUAL_REQUIRED] Approved visual state requires a selected asset');
    }
    const payload = (0, telegram_delivery_payload_1.normalizeTelegramDeliveryPayload)({
        text: task.draft_text,
        imageUrl: selectedAsset?.file_url
    });
    return { payload, selectedAsset };
}
class TelegramTaskPublicationService {
    constructor(dependencies) {
        this.dependencies = dependencies;
    }
    async execute(args) {
        const { prisma: db, publisher, publicationFacts } = this.dependencies;
        const idempotencyKey = args.idempotencyKey?.trim() || null;
        if (!args.dryRun && !idempotencyKey) {
            throw new Error('[IDEMPOTENCY_KEY_REQUIRED] Live Telegram task publication requires idempotencyKey');
        }
        if (idempotencyKey) {
            const cached = await db.workflowEvent.findUnique({
                where: {
                    project_id_actor_id_command_idempotency_key: {
                        project_id: args.projectId,
                        actor_id: SYSTEM_ACTOR,
                        command: COMMAND,
                        idempotency_key: idempotencyKey
                    }
                }
            });
            if (cached?.after_state) {
                if (cached.content_item_id !== args.taskId) {
                    throw new Error('[IDEMPOTENCY_KEY_CONFLICT] idempotencyKey belongs to another publication task');
                }
                return { ...cached.after_state, replayed: true };
            }
        }
        const task = await db.contentItem.findFirst({
            where: { id: args.taskId, project_id: args.projectId },
            include: { channel: true, selected_asset: true, publication_fact: true }
        });
        if (!task)
            throw new Error('[PUBLICATION_TASK_NOT_FOUND] Publication task was not found in the project');
        if (task.publication_fact?.outcome === 'published'
            && (task.publication_fact.public_url || task.publication_fact.provider_object_id)) {
            return {
                mode: 'published',
                task_id: task.id,
                published_link: task.publication_fact.public_url || task.published_link || null,
                external_id: task.publication_fact.provider_object_id || task.telegram_message_id || null,
                delivery_method: 'mtproto',
                replayed: true
            };
        }
        const { payload, selectedAsset } = prepareTaskPayload(task);
        const preview = {
            text: payload.text,
            image_url: payload.imageUrl,
            has_image: Boolean(payload.imageUrl)
        };
        if (args.dryRun) {
            return {
                mode: 'dry_run',
                task_id: task.id,
                project_id: args.projectId,
                channel_id: task.channel.id,
                accepted_revision: task.accepted_revision,
                selected_asset_id: selectedAsset?.id || null,
                delivery: 'mtproto',
                payload_preview: preview
            };
        }
        const owner = await db.projectMember.findFirst({
            where: { project_id: args.projectId, role: 'owner' },
            orderBy: { id: 'asc' }
        });
        if (!owner)
            throw new Error('[PROJECT_OWNER_REQUIRED] Project has no owner for publication confirmation');
        if (task.status === 'publishing') {
            throw new Error('[PUBLICATION_ATTEMPT_UNCERTAIN] Task already has an unresolved provider attempt');
        }
        const claimed = await db.contentItem.updateMany({
            where: {
                id: task.id,
                project_id: args.projectId,
                status: { in: CLAIMABLE_STATUSES },
                content_revision: task.content_revision,
                accepted_revision: task.accepted_revision,
                selected_asset_id: task.selected_asset_id
            },
            data: {
                status: 'publishing',
                publication_mode: 'connector_auto',
                quality_report: {
                    ...(task.quality_report || {}),
                    telegram_task_publication: {
                        state: 'provider_call_started',
                        delivery: 'mtproto',
                        idempotency_key: idempotencyKey,
                        accepted_revision: task.accepted_revision,
                        selected_asset_id: selectedAsset?.id || null,
                        started_at: new Date().toISOString()
                    }
                }
            }
        });
        if (claimed.count !== 1) {
            throw new Error('[PUBLICATION_ALREADY_CLAIMED] Publication task changed or is already being processed');
        }
        let providerResult;
        try {
            providerResult = await publisher.publishTelegramTaskMtproto({
                projectId: args.projectId,
                taskId: task.id,
                channel: task.channel,
                text: payload.text,
                imageUrl: payload.imageUrl || undefined
            });
        }
        catch (error) {
            await db.contentItem.update({
                where: { id: task.id },
                data: {
                    status: 'publishing',
                    quality_report: {
                        ...(task.quality_report || {}),
                        telegram_task_publication: {
                            state: 'provider_result_uncertain',
                            delivery: 'mtproto',
                            idempotency_key: idempotencyKey,
                            retry_via_api: false,
                            error: String(error?.message || error || 'Unknown MTProto failure'),
                            failed_at: new Date().toISOString()
                        }
                    }
                }
            });
            throw new Error(`[TELEGRAM_PUBLICATION_UNCERTAIN] ${error?.message || error || 'MTProto provider result is unknown'}`);
        }
        const messageId = providerResult.metrics?.telegram_message_id || null;
        const publishedLink = providerResult.publishedLink || null;
        if (!messageId || !publishedLink) {
            await db.contentItem.update({
                where: { id: task.id },
                data: {
                    status: 'publishing',
                    quality_report: {
                        ...(task.quality_report || {}),
                        telegram_task_publication: {
                            state: 'provider_result_uncertain',
                            delivery: 'mtproto',
                            idempotency_key: idempotencyKey,
                            retry_via_api: false,
                            error: 'MTProto did not confirm both message ID and permalink',
                            failed_at: new Date().toISOString()
                        }
                    }
                }
            });
            throw new Error('[TELEGRAM_PUBLICATION_UNCERTAIN] MTProto did not confirm both message ID and permalink');
        }
        const result = {
            mode: 'published',
            task_id: task.id,
            project_id: args.projectId,
            channel_id: task.channel.id,
            accepted_revision: task.accepted_revision,
            selected_asset_id: selectedAsset?.id || null,
            published_link: publishedLink,
            external_id: messageId,
            delivery_method: 'mtproto'
        };
        const publishedAt = new Date().toISOString();
        await publicationFacts.record({
            projectId: args.projectId,
            taskId: task.id,
            actorId: `user:${owner.user_id}`,
            artifactKind: 'post',
            outcome: 'published',
            publishedAt,
            publicUrl: publishedLink,
            providerObjectId: String(messageId),
            confirmationMode: 'automatic',
            evidence: { type: 'api', ref: publishedLink },
            correctionReason: task.publication_fact
                ? `Provider-confirmed MTProto publication supersedes prior ${task.publication_fact.outcome || 'unconfirmed'} outcome`
                : undefined,
            note: 'Published from the canonical publication task via MTProto'
        });
        await db.$transaction(async (tx) => {
            await tx.contentItem.update({
                where: { id: task.id },
                data: {
                    status: 'published',
                    publication_mode: 'connector_auto',
                    published_link: publishedLink,
                    telegram_message_id: messageId,
                    quality_report: {
                        ...(task.quality_report || {}),
                        telegram_task_publication: {
                            state: 'provider_confirmed',
                            delivery: 'mtproto',
                            idempotency_key: idempotencyKey,
                            message_id: messageId,
                            permalink: publishedLink,
                            completed_at: new Date().toISOString()
                        }
                    },
                    metrics: {
                        ...(task.metrics || {}),
                        telegram_message_id: messageId,
                        last_execution_at: new Date().toISOString()
                    }
                }
            });
            await tx.workflowEvent.create({
                data: {
                    project_id: args.projectId,
                    content_item_id: task.id,
                    actor_id: SYSTEM_ACTOR,
                    command: COMMAND,
                    idempotency_key: idempotencyKey,
                    before_state: {
                        status: task.status,
                        publication_fact_outcome: task.publication_fact?.outcome || null
                    },
                    after_state: result
                }
            });
        });
        return result;
    }
}
exports.TelegramTaskPublicationService = TelegramTaskPublicationService;
exports.default = new TelegramTaskPublicationService({
    prisma: db_1.default,
    publisher: publisher_service_1.default,
    publicationFacts: publication_fact_service_1.default
});

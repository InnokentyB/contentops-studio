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
    if (!asset || asset.status !== 'approved' || asset.content_revision !== task.accepted_revision) {
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
function extractVkConfig(channel) {
    const top = channel?.config && typeof channel.config === 'object' ? channel.config : {};
    const raw = top.raw_account && typeof top.raw_account === 'object' ? top.raw_account : {};
    return {
        vkId: raw.vk_id ?? top.vk_id ?? null,
        publishToken: raw.publish_access_token ?? raw.api_key ?? top.publish_access_token ?? top.api_key ?? null
    };
}
function prepareTaskPayload(task) {
    const channelType = task.channel?.type;
    if (!['telegram', 'vk'].includes(channelType)) {
        throw new Error('[SUPPORTED_PUBLICATION_TASK_REQUIRED] Task must target Telegram or VK');
    }
    if (!task.accepted_revision || task.accepted_revision !== task.content_revision || task.text_state !== 'accepted') {
        throw new Error('[ACCEPTED_REVISION_REQUIRED] Publication requires the current accepted text revision');
    }
    if (channelType === 'vk') {
        const config = extractVkConfig(task.channel);
        if (!config.vkId || !config.publishToken) {
            throw new Error('[VK_CONNECTOR_NOT_READY] VK channel requires vk_id and publish_access_token');
        }
    }
    const selectedAsset = resolveApprovedAsset(task);
    if (task.visual_state === 'APPROVED' && !selectedAsset) {
        throw new Error('[APPROVED_VISUAL_REQUIRED] Approved visual state requires a selected asset');
    }
    const text = typeof task.draft_text === 'string' ? task.draft_text.trim() : '';
    if (channelType === 'vk' && !text)
        throw new Error('[VK_TEXT_REQUIRED] VK publication text must not be empty');
    const payload = channelType === 'telegram'
        ? (0, telegram_delivery_payload_1.normalizeTelegramDeliveryPayload)({ text, imageUrl: selectedAsset?.file_url })
        : { text, imageUrl: selectedAsset?.file_url || null };
    return { channelType, payload, selectedAsset };
}
class TelegramTaskPublicationService {
    constructor(dependencies) {
        this.dependencies = dependencies;
    }
    async execute(args) {
        const { prisma: db, publisher, publicationFacts } = this.dependencies;
        const idempotencyKey = args.idempotencyKey?.trim() || null;
        if (!args.dryRun && !idempotencyKey) {
            throw new Error('[IDEMPOTENCY_KEY_REQUIRED] Live task publication requires idempotencyKey');
        }
        if (idempotencyKey) {
            const cached = await db.workflowEvent.findUnique({
                where: { project_id_actor_id_command_idempotency_key: {
                        project_id: args.projectId, actor_id: SYSTEM_ACTOR, command: COMMAND, idempotency_key: idempotencyKey
                    } }
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
        const delivery = task.channel?.type === 'telegram' ? 'mtproto' : task.channel?.type === 'vk' ? 'vk_api' : null;
        if (task.publication_fact?.outcome === 'published'
            && (task.publication_fact.public_url || task.publication_fact.provider_object_id)) {
            return {
                mode: 'published', task_id: task.id,
                published_link: task.publication_fact.public_url || task.published_link || null,
                external_id: task.publication_fact.provider_object_id || task.telegram_message_id || null,
                delivery_method: delivery, replayed: true
            };
        }
        const prepared = prepareTaskPayload(task);
        const { payload, selectedAsset } = prepared;
        const preview = { text: payload.text, image_url: payload.imageUrl, has_image: Boolean(payload.imageUrl) };
        if (args.dryRun) {
            return {
                mode: 'dry_run', task_id: task.id, project_id: args.projectId, channel_id: task.channel.id,
                accepted_revision: task.accepted_revision, selected_asset_id: selectedAsset?.id || null,
                delivery, payload_preview: preview
            };
        }
        const owner = await db.projectMember.findFirst({ where: { project_id: args.projectId, role: 'owner' }, orderBy: { id: 'asc' } });
        if (!owner)
            throw new Error('[PROJECT_OWNER_REQUIRED] Project has no owner for publication confirmation');
        if (task.status === 'publishing')
            throw new Error('[PUBLICATION_ATTEMPT_UNCERTAIN] Task already has an unresolved provider attempt');
        const claimed = await db.contentItem.updateMany({
            where: {
                id: task.id, project_id: args.projectId, status: { in: CLAIMABLE_STATUSES },
                content_revision: task.content_revision, accepted_revision: task.accepted_revision,
                selected_asset_id: task.selected_asset_id
            },
            data: {
                status: 'publishing', publication_mode: 'connector_auto',
                quality_report: {
                    ...(task.quality_report || {}),
                    publication_task_delivery: {
                        state: 'provider_call_started', channel_type: prepared.channelType, delivery,
                        idempotency_key: idempotencyKey, accepted_revision: task.accepted_revision,
                        selected_asset_id: selectedAsset?.id || null, started_at: new Date().toISOString()
                    }
                }
            }
        });
        if (claimed.count !== 1)
            throw new Error('[PUBLICATION_ALREADY_CLAIMED] Publication task changed or is already being processed');
        let providerResult;
        try {
            providerResult = prepared.channelType === 'telegram'
                ? await publisher.publishTelegramTaskMtproto({
                    projectId: args.projectId, taskId: task.id, channel: task.channel,
                    text: payload.text, imageUrl: payload.imageUrl || undefined
                })
                : await publisher.publishVkTask({
                    projectId: args.projectId, taskId: task.id, channel: task.channel,
                    text: payload.text, imageUrl: payload.imageUrl || undefined, idempotencyKey: idempotencyKey
                });
        }
        catch (error) {
            await this.markUncertain(db, task, prepared.channelType, delivery, idempotencyKey, error?.message || error);
            const code = prepared.channelType === 'telegram' ? 'TELEGRAM_PUBLICATION_UNCERTAIN' : 'VK_PUBLICATION_UNCERTAIN';
            throw new Error(`[${code}] ${error?.message || error || 'Provider result is unknown'}`);
        }
        const publishedLink = providerResult.publishedLink || null;
        const telegramMessageId = prepared.channelType === 'telegram' ? providerResult.metrics?.telegram_message_id || null : null;
        const vkOwnerId = prepared.channelType === 'vk' ? String(providerResult.metrics?.vk_owner_id || '') : '';
        const vkPostId = prepared.channelType === 'vk' ? String(providerResult.metrics?.vk_post_id || '') : '';
        const externalId = prepared.channelType === 'telegram'
            ? telegramMessageId
            : /^-\d+$/.test(vkOwnerId) && /^\d+$/.test(vkPostId) ? `wall${vkOwnerId}_${vkPostId}` : null;
        const expectedVkLink = prepared.channelType === 'vk' && externalId
            ? `https://vk.com/${externalId}`
            : null;
        if (!externalId || !publishedLink || (expectedVkLink && publishedLink !== expectedVkLink)) {
            await this.markUncertain(db, task, prepared.channelType, delivery, idempotencyKey, 'Provider did not confirm both object ID and permalink');
            const code = prepared.channelType === 'telegram' ? 'TELEGRAM_PUBLICATION_UNCERTAIN' : 'VK_PUBLICATION_UNCERTAIN';
            throw new Error(`[${code}] Provider did not confirm both object ID and permalink`);
        }
        const result = {
            mode: 'published', task_id: task.id, project_id: args.projectId, channel_id: task.channel.id,
            accepted_revision: task.accepted_revision, selected_asset_id: selectedAsset?.id || null,
            published_link: publishedLink, external_id: externalId, delivery_method: delivery
        };
        await publicationFacts.record({
            projectId: args.projectId, taskId: task.id, actorId: `user:${owner.user_id}`,
            artifactKind: 'post', outcome: 'published', publishedAt: new Date().toISOString(),
            publicUrl: publishedLink, providerObjectId: String(externalId), confirmationMode: 'automatic',
            evidence: { type: 'api', ref: publishedLink },
            correctionReason: task.publication_fact
                ? `Provider-confirmed ${prepared.channelType} publication supersedes prior ${task.publication_fact.outcome || 'unconfirmed'} outcome`
                : undefined,
            note: `Published from the canonical publication task via ${delivery}`
        });
        await db.$transaction(async (tx) => {
            await tx.contentItem.update({
                where: { id: task.id },
                data: {
                    status: 'published', publication_mode: 'connector_auto', published_link: publishedLink,
                    telegram_message_id: telegramMessageId || undefined,
                    quality_report: {
                        ...(task.quality_report || {}),
                        publication_task_delivery: {
                            state: 'provider_confirmed', channel_type: prepared.channelType, delivery,
                            idempotency_key: idempotencyKey, provider_object_id: externalId,
                            permalink: publishedLink, completed_at: new Date().toISOString()
                        }
                    },
                    metrics: { ...(task.metrics || {}), ...(providerResult.metrics || {}), last_execution_at: new Date().toISOString() }
                }
            });
            await tx.workflowEvent.create({ data: {
                    project_id: args.projectId, content_item_id: task.id, actor_id: SYSTEM_ACTOR,
                    command: COMMAND, idempotency_key: idempotencyKey,
                    before_state: { status: task.status, publication_fact_outcome: task.publication_fact?.outcome || null },
                    after_state: result
                } });
        });
        return result;
    }
    async markUncertain(db, task, channelType, delivery, idempotencyKey, error) {
        await db.contentItem.update({
            where: { id: task.id },
            data: {
                status: 'publishing',
                quality_report: {
                    ...(task.quality_report || {}),
                    publication_task_delivery: {
                        state: 'provider_result_uncertain', channel_type: channelType, delivery,
                        idempotency_key: idempotencyKey, retry_via_api: false,
                        error: String(error || 'Unknown provider failure'), failed_at: new Date().toISOString()
                    }
                }
            }
        });
    }
}
exports.TelegramTaskPublicationService = TelegramTaskPublicationService;
exports.default = new TelegramTaskPublicationService({ prisma: db_1.default, publisher: publisher_service_1.default, publicationFacts: publication_fact_service_1.default });

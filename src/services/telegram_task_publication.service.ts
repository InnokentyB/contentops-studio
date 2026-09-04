import prisma from '../db';
import publisherService from './publisher.service';
import publicationFactService from './publication_fact.service';
import { normalizeTelegramDeliveryPayload } from './telegram_delivery_payload';

type PublicationTaskArgs = { projectId: number; taskId: number; dryRun?: boolean; idempotencyKey?: string };
type Dependencies = {
    prisma: any;
    publisher: {
        publishTelegramTaskMtproto(args: { projectId: number; taskId: number; channel: any; text: string; imageUrl?: string }): Promise<any>;
        publishTelegramPersonalStoryMtproto(args: { projectId: number; taskId: number; caption: string; imageUrl: string; idempotencyKey: string }): Promise<any>;
        publishVkPersonalStory(args: { projectId: number; taskId: number; channel: any; imageUrl: string; idempotencyKey: string }): Promise<any>;
        publishVkTask(args: { projectId: number; taskId: number; channel: any; text: string; imageUrl?: string; idempotencyKey: string }): Promise<any>;
    };
    publicationFacts: { record(args: any): Promise<any> };
};

const COMMAND = 'ba_publish_publication_task';
const CLAIM_COMMAND = 'ba_publish_publication_task_claim';
const SYSTEM_ACTOR = 'system:planner-mcp:telegram-publication';
const CLAIMABLE_STATUSES = ['approved', 'ready_for_execution', 'blocked', 'failed'];

function isStoryTask(task: any) {
    return String(task.type || '').toLowerCase().includes('story')
        || String(task.visual_placement || '').toLowerCase() === 'story';
}

function isTelegramStoryTask(task: any) {
    return ['telegram', 'telegram_chat'].includes(task.channel?.type) && (
        String(task.type || '').toLowerCase().includes('story')
        || String(task.visual_placement || '').toLowerCase() === 'story'
    );
}

function isVkPersonalStoryTask(task: any) {
    return task.channel?.type === 'vk' && isStoryTask(task);
}

function resolveApprovedAsset(task: any) {
    if (!task.selected_asset_id && !task.selected_asset) return null;
    const asset = task.selected_asset;
    if (!asset || asset.status !== 'approved' || asset.content_revision !== task.accepted_revision) {
        throw new Error('[APPROVED_VISUAL_REQUIRED] Selected visual must be approved for the accepted content revision');
    }
    const fileUrl = typeof asset.file_url === 'string' ? asset.file_url.trim() : '';
    let parsed: URL;
    try { parsed = new URL(fileUrl); } catch {
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

function extractVkConfig(channel: any) {
    const top = channel?.config && typeof channel.config === 'object' ? channel.config : {};
    const raw = top.raw_account && typeof top.raw_account === 'object' ? top.raw_account : {};
    return {
        vkId: raw.vk_id ?? top.vk_id ?? null,
        publishToken: raw.publish_access_token ?? raw.api_key ?? top.publish_access_token ?? top.api_key ?? null,
        oauthUserId: raw.oauth_user_id ?? top.oauth_user_id ?? null
    };
}

function prepareTaskPayload(task: any, allowUnsupportedDryRun = false) {
    const channelType = task.channel?.type;
    const directSupported = ['telegram', 'vk'].includes(channelType);
    if (!directSupported && !allowUnsupportedDryRun) {
        throw new Error('[SUPPORTED_PUBLICATION_TASK_REQUIRED] Task must target Telegram or VK');
    }
    if (!task.accepted_revision || task.accepted_revision !== task.content_revision || task.text_state !== 'accepted') {
        throw new Error('[ACCEPTED_REVISION_REQUIRED] Publication requires the current accepted text revision');
    }
    let connectorReady = directSupported;
    let connectorReason: string | null = null;
    const isTelegramStory = isTelegramStoryTask(task);
    const isVkPersonalStory = isVkPersonalStoryTask(task);
    const isStory = isTelegramStory || isVkPersonalStory;
    if (channelType === 'vk') {
        const config = extractVkConfig(task.channel);
        const missingCredentials = isVkPersonalStory
            ? !config.publishToken || !config.oauthUserId
            : !config.vkId || !config.publishToken;
        if (missingCredentials) {
            connectorReady = false;
            connectorReason = isVkPersonalStory ? 'vk_personal_oauth_identity_missing' : 'vk_credentials_missing';
            if (!allowUnsupportedDryRun) {
                throw new Error(isVkPersonalStory
                    ? '[VK_PERSONAL_STORY_CONNECTOR_NOT_READY] Personal VK story requires a connected OAuth profile'
                    : '[VK_CONNECTOR_NOT_READY] VK channel requires vk_id and publish_access_token');
            }
        }
    }
    const selectedAsset = resolveApprovedAsset(task);
    if (isStory && !selectedAsset) {
        throw new Error(isVkPersonalStory
            ? '[VK_STORY_MEDIA_REQUIRED] A personal VK story requires an approved image'
            : '[TELEGRAM_STORY_MEDIA_REQUIRED] A personal Telegram story requires an approved image');
    }
    const handoffBundle = (task.quality_report as any)?.handoff_bundle;
    const poll = handoffBundle?.placement_contract?.poll || handoffBundle?.poll;
    if (isStory && poll?.supported === true && poll?.configuration_mode === 'native_manual') {
        throw new Error(isVkPersonalStory
            ? '[VK_STORY_NATIVE_POLL_MANUAL] VK stories with a native poll must use the manual handoff'
            : '[TELEGRAM_STORY_NATIVE_POLL_MANUAL] Stories with a native poll must use the manual handoff');
    }
    if (task.visual_state === 'APPROVED' && !selectedAsset) {
        throw new Error('[APPROVED_VISUAL_REQUIRED] Approved visual state requires a selected asset');
    }
    const text = typeof task.draft_text === 'string' ? task.draft_text.trim() : '';
    if (channelType === 'vk' && !isVkPersonalStory && !text) throw new Error('[VK_TEXT_REQUIRED] VK publication text must not be empty');
    const payload = channelType === 'telegram'
        ? normalizeTelegramDeliveryPayload({ text, imageUrl: selectedAsset?.file_url })
        : { text: isVkPersonalStory ? '' : text, imageUrl: selectedAsset?.file_url || null };
    return {
        channelType, payload, selectedAsset, directSupported, connectorReady, connectorReason,
        isStory, isTelegramStory, isVkPersonalStory
    };
}

export class TelegramTaskPublicationService {
    constructor(private readonly dependencies: Dependencies) {}

    async execute(args: PublicationTaskArgs) {
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
                return { ...(cached.after_state as any), replayed: true };
            }
        }

        const task = await db.contentItem.findFirst({
            where: { id: args.taskId, project_id: args.projectId },
            include: { channel: true, selected_asset: true, publication_fact: true }
        });
        if (!task) throw new Error('[PUBLICATION_TASK_NOT_FOUND] Publication task was not found in the project');
        const isTelegramStory = isTelegramStoryTask(task);
        const isVkPersonalStory = isVkPersonalStoryTask(task);
        const isStory = isTelegramStory || isVkPersonalStory;
        const delivery = isTelegramStory
            ? 'mtproto_personal_story'
            : isVkPersonalStory ? 'vk_api_personal_story'
            : task.channel?.type === 'telegram' ? 'mtproto' : task.channel?.type === 'vk' ? 'vk_api' : null;
        if (task.publication_fact?.outcome === 'published'
            && (task.publication_fact.public_url || task.publication_fact.provider_object_id)) {
            return {
                mode: 'published', task_id: task.id,
                published_link: task.publication_fact.public_url || task.published_link || null,
                external_id: task.publication_fact.provider_object_id || task.telegram_message_id || null,
                delivery_method: delivery, replayed: true
            };
        }

        const prepared = prepareTaskPayload(task, args.dryRun === true);
        const { payload, selectedAsset } = prepared;
        const preview = { text: payload.text, image_url: payload.imageUrl, has_image: Boolean(payload.imageUrl) };
        if (args.dryRun) {
            return {
                mode: 'dry_run', task_id: task.id, project_id: args.projectId, channel_id: task.channel.id,
                accepted_revision: task.accepted_revision, selected_asset_id: selectedAsset?.id || null,
                delivery: delivery || 'validated_handoff',
                ...(prepared.isStory ? { target: 'personal_profile' } : {}),
                direct_execution_supported: prepared.directSupported,
                connector_ready: prepared.connectorReady,
                connector_reason: prepared.connectorReason,
                payload_preview: preview
            };
        }

        const owner = await db.projectMember.findFirst({ where: { project_id: args.projectId, role: 'owner' }, orderBy: { id: 'asc' } });
        if (!owner) throw new Error('[PROJECT_OWNER_REQUIRED] Project has no owner for publication confirmation');
        if (task.status === 'publishing') throw new Error('[PUBLICATION_ATTEMPT_UNCERTAIN] Task already has an unresolved provider attempt');
        if (task.status === 'browser_required' && !prepared.isStory) {
            throw new Error('[PUBLICATION_ROUTE_NOT_EXECUTABLE] Browser-required tasks cannot use this direct publication route');
        }
        const claimableStatuses = prepared.isStory ? [...CLAIMABLE_STATUSES, 'browser_required'] : CLAIMABLE_STATUSES;
        const startedAt = new Date().toISOString();
        const claimed = await db.$transaction(async (tx: any) => {
            const result = await tx.contentItem.updateMany({
                where: {
                    id: task.id, project_id: args.projectId, status: { in: claimableStatuses },
                    content_revision: task.content_revision, accepted_revision: task.accepted_revision,
                    selected_asset_id: task.selected_asset_id
                },
                data: {
                    status: 'publishing', publication_mode: 'connector_auto',
                    quality_report: {
                        ...((task.quality_report as any) || {}),
                        publication_task_delivery: {
                            state: 'provider_call_started', channel_type: prepared.channelType, delivery,
                            idempotency_key: idempotencyKey, accepted_revision: task.accepted_revision,
                            selected_asset_id: selectedAsset?.id || null, started_at: startedAt
                        }
                    }
                }
            });
            if (result.count === 1) {
                await tx.workflowEvent.create({ data: {
                    project_id: args.projectId, content_item_id: task.id, actor_id: SYSTEM_ACTOR,
                    command: CLAIM_COMMAND, idempotency_key: idempotencyKey,
                    before_state: { status: task.status, publication_mode: task.publication_mode || null },
                    after_state: {
                        status: 'publishing', delivery_method: delivery,
                        target: prepared.isStory ? 'personal_profile' : 'configured_channel', started_at: startedAt
                    }
                } });
            }
            return result;
        });
        if (claimed.count !== 1) {
            const latest = await db.contentItem.findFirst({
                where: { id: task.id, project_id: args.projectId }, select: { status: true }
            });
            if (latest?.status === 'publishing') {
                throw new Error('[PUBLICATION_ALREADY_CLAIMED] Another publication attempt claimed this task');
            }
            throw new Error('[PUBLICATION_STATE_CHANGED] Publication task changed before it could be claimed');
        }

        let providerResult: any;
        try {
            providerResult = prepared.isTelegramStory
                ? await publisher.publishTelegramPersonalStoryMtproto({
                    projectId: args.projectId, taskId: task.id,
                    caption: payload.text, imageUrl: payload.imageUrl!, idempotencyKey: idempotencyKey!
                })
                : prepared.isVkPersonalStory ? await publisher.publishVkPersonalStory({
                    projectId: args.projectId, taskId: task.id, channel: task.channel,
                    imageUrl: payload.imageUrl!, idempotencyKey: idempotencyKey!
                })
                : prepared.channelType === 'telegram' ? await publisher.publishTelegramTaskMtproto({
                    projectId: args.projectId, taskId: task.id, channel: task.channel,
                    text: payload.text, imageUrl: payload.imageUrl || undefined
                })
                : await publisher.publishVkTask({
                    projectId: args.projectId, taskId: task.id, channel: task.channel,
                    text: payload.text, imageUrl: payload.imageUrl || undefined, idempotencyKey: idempotencyKey!
                });
        } catch (error: any) {
            await this.markUncertain(db, task, prepared.channelType, delivery, idempotencyKey, error?.message || error);
            const code = prepared.channelType === 'telegram' ? 'TELEGRAM_PUBLICATION_UNCERTAIN' : 'VK_PUBLICATION_UNCERTAIN';
            throw new Error(`[${code}] ${error?.message || error || 'Provider result is unknown'}`);
        }

        const publishedLink = providerResult.publishedLink || null;
        const telegramMessageId = prepared.channelType === 'telegram'
            ? prepared.isTelegramStory ? providerResult.metrics?.telegram_story_id || null : providerResult.metrics?.telegram_message_id || null
            : null;
        const vkOwnerId = prepared.channelType === 'vk' ? String(providerResult.metrics?.vk_owner_id || '') : '';
        const vkPostId = prepared.channelType === 'vk' ? String(providerResult.metrics?.vk_post_id || '') : '';
        const vkStoryOwnerId = prepared.isVkPersonalStory ? String(providerResult.metrics?.vk_story_owner_id || '') : '';
        const vkStoryId = prepared.isVkPersonalStory ? String(providerResult.metrics?.vk_story_id || '') : '';
        const externalId = prepared.channelType === 'telegram'
            ? telegramMessageId
            : prepared.isVkPersonalStory
                ? /^\d+$/.test(vkStoryOwnerId) && /^\d+$/.test(vkStoryId) ? `story${vkStoryOwnerId}_${vkStoryId}` : null
                : /^-\d+$/.test(vkOwnerId) && /^\d+$/.test(vkPostId) ? `wall${vkOwnerId}_${vkPostId}` : null;
        const expectedVkLink = prepared.channelType === 'vk' && externalId
            ? `https://vk.com/${externalId}`
            : null;
        const evidenceRef = providerResult.evidenceRef || publishedLink || null;
        if (!externalId || (!prepared.isStory && !publishedLink) || (prepared.isStory && !evidenceRef) || (expectedVkLink && publishedLink !== expectedVkLink)) {
            await this.markUncertain(db, task, prepared.channelType, delivery, idempotencyKey, 'Provider did not confirm object identity and readback evidence');
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
            artifactKind: prepared.isStory ? 'story' : 'post', outcome: 'published', publishedAt: new Date().toISOString(),
            publicUrl: publishedLink, providerObjectId: String(externalId), confirmationMode: 'automatic',
            evidence: { type: 'api', ref: evidenceRef },
            correctionReason: task.publication_fact
                ? `Provider-confirmed ${prepared.channelType} publication supersedes prior ${task.publication_fact.outcome || 'unconfirmed'} outcome`
                : undefined,
            note: `Published from the canonical publication task via ${delivery}`
        });
        await db.$transaction(async (tx: any) => {
            await tx.contentItem.update({
                where: { id: task.id },
                data: {
                    status: 'published', publication_mode: 'connector_auto', published_link: publishedLink,
                    telegram_message_id: prepared.isStory ? null : telegramMessageId || undefined,
                    quality_report: {
                        ...((task.quality_report as any) || {}),
                        publication_task_delivery: {
                            state: 'provider_confirmed', channel_type: prepared.channelType, delivery,
                            idempotency_key: idempotencyKey, provider_object_id: externalId,
                            permalink: publishedLink, completed_at: new Date().toISOString()
                        }
                    },
                    metrics: { ...((task.metrics as any) || {}), ...(providerResult.metrics || {}), last_execution_at: new Date().toISOString() }
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

    private async markUncertain(db: any, task: any, channelType: string, delivery: string | null, idempotencyKey: string | null, error: unknown) {
        await db.contentItem.update({
            where: { id: task.id },
            data: {
                status: 'publishing',
                quality_report: {
                    ...((task.quality_report as any) || {}),
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

export default new TelegramTaskPublicationService({ prisma, publisher: publisherService, publicationFacts: publicationFactService });

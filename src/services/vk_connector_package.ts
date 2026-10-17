import { z } from 'zod';
import { connectorHash, type ConnectorSnapshot } from './vk_connector_contract';
import { assertApprovedVkClipAsset } from './publication_plan/handoff';
const id = z.number().int().positive();
const hex = z.string().regex(/^[a-f0-9]{64}$/);
// Field order is retained so existing immutable release/package hashes remain readable.
const binding = z.object({ publication_authorized: z.literal(true), placement: z.enum(['feed', 'clip']),
    body_sha256: hex, asset_sha256: hex, content_revision: id, selected_asset_id: id,
    approval_reference: z.string().min(10).max(2048) });
const taskSchema = z.object({ id, project_id: id, channel_id: id, content_revision: id, accepted_revision: id,
    text_state: z.literal('accepted'), visual_placement: z.enum(['feed','clip']), selected_asset_id: id,
    visual_state: z.literal('APPROVED'), status: z.string(), publication_mode: z.string(), handoff_state: z.string(),
    draft_text: z.string(), published_link: z.string().nullable(),
    quality_report: z.object({ owner_release: binding.extend({ actor_id: z.string().regex(/^user:[1-9]\d*$/),
        released_at: z.iso.datetime() }), publication_hold: z.unknown().optional() }),
    channel: z.object({ id, project_id: id, type: z.string(), is_active: z.literal(true),
        config: z.object({ vk_id: z.union([z.string().regex(/^-[1-9]\d*$/), z.number().int().negative()]) }) }),
    selected_asset: z.object({ id, project_id: id, content_item_id: id, content_revision: id, status: z.literal('approved'),
        placement: z.string().optional(), provenance: z.object({ planner_storage: z.object({ sha256: hex }).passthrough() }).passthrough()
    }).passthrough(),
    publication_fact: z.object({ id, project_id: id, content_item_id: id, channel_id: id,
        outcome: z.literal('published'), published_at: z.date(), public_url: z.string() }).nullable()
}).passthrough();
const workSchema = z.object({ id, project_id: id, content_item_id: id,
    kind: z.literal('browser_publish'), assignee_role: z.literal('browser_publisher'), state: z.string(),
    input_context_version: id, result_payload: binding.extend({ channel_id: id }) });
const attemptSchema = z.object({ id, project_id: id, content_item_id: id, channel_id: id, status: z.string() }).nullable();
function invalid(): never { throw new Error('[VK_CONNECTOR_PACKAGE_NOT_READY]'); }
/** Resolve publication authority from mutually consistent tenant-owned canonical records. */
export function buildVkConnectorSnapshot(rawTask: unknown, rawItem: unknown, rawAttempt: unknown): ConnectorSnapshot {
    const t = taskSchema.safeParse(rawTask), w = workSchema.safeParse(rawItem), a = attemptSchema.safeParse(rawAttempt);
    if (!t.success || !w.success || !a.success) invalid();
    const task = t.data, item = w.data, attempt = a.data, release = task.quality_report.owner_release;
    const asset = task.selected_asset, channel = task.channel, fact = task.publication_fact;
    const bodySha = connectorHash(task.draft_text.trim()), communityId = Number(channel.config.vk_id);
    if (!Number.isSafeInteger(communityId) || communityId >= 0 || channel.type.trim().toLowerCase() !== 'vk'
        || channel.id !== task.channel_id || channel.project_id !== task.project_id
        || task.accepted_revision !== task.content_revision || release.content_revision !== task.content_revision
        || release.selected_asset_id !== task.selected_asset_id || release.placement !== task.visual_placement
        || asset.id !== task.selected_asset_id || asset.project_id !== task.project_id || asset.content_item_id !== task.id
        || asset.content_revision !== task.content_revision || (asset.placement !== undefined && asset.placement !== task.visual_placement)
        || item.project_id !== task.project_id || item.content_item_id !== task.id || item.input_context_version !== task.content_revision
        || item.result_payload.channel_id !== channel.id || release.body_sha256 !== bodySha
        || release.asset_sha256 !== asset.provenance.planner_storage.sha256
        || JSON.stringify(binding.parse(release)) !== JSON.stringify(binding.parse(item.result_payload))
        || (attempt && (attempt.project_id !== task.project_id || attempt.content_item_id !== task.id || attempt.channel_id !== channel.id))) invalid();
    if (fact && (fact.project_id !== task.project_id || fact.content_item_id !== task.id || fact.channel_id !== channel.id
        || !new RegExp(`^https://vk\\.(com|ru)/${task.visual_placement === 'clip' ? 'clip' : 'wall'}${communityId}_[1-9]\\d*$`).test(fact.public_url))) invalid();
    if (task.visual_placement === 'clip') {
        try { assertApprovedVkClipAsset(task); } catch { invalid(); }
    }
    return { package: { projectId: task.project_id, taskId: task.id, channelId: channel.id,
        communityId, revision: task.content_revision, selectedAssetId: asset.id, placement: task.visual_placement,
        bodySha256: bodySha, assetSha256: release.asset_sha256, releaseSha256: connectorHash(JSON.stringify(release)) },
        workItemId: item.id, factId: fact?.id || null, publicUrl: fact?.public_url || task.published_link,
        attemptId: attempt?.id || null, attemptStatus: attempt?.status || null,
        eligible: task.status === 'browser_required' && task.publication_mode === 'browser_required'
            && task.handoff_state === 'ready' && !task.quality_report.publication_hold && ['available', 'claimed'].includes(item.state) };
}

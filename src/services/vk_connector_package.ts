import { z } from 'zod';
import { connectorHash, VK_CONNECTOR_SCOPE, type ConnectorSnapshot } from './vk_connector_contract';
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const binding = z.object({ publication_authorized: z.literal(true), placement: z.literal('feed'),
    body_sha256: hex, asset_sha256: hex, content_revision: z.literal(1), selected_asset_id: z.literal(130),
    approval_reference: z.string().min(10).max(2048) });
const taskSchema = z.object({ id: z.literal(1048), project_id: z.literal(10), channel_id: z.literal(117),
    content_revision: z.literal(1), accepted_revision: z.literal(1), text_state: z.literal('accepted'),
    visual_placement: z.literal('feed'), selected_asset_id: z.literal(130), visual_state: z.literal('APPROVED'),
    status: z.string(), publication_mode: z.string(), handoff_state: z.string(), draft_text: z.string(),
    published_link: z.string().nullable(),
    quality_report: z.object({ owner_release: binding.extend({ actor_id: z.literal('user:2'), released_at: z.iso.datetime() }) }),
    channel: z.object({ id: z.literal(117), project_id: z.literal(10), type: z.literal('vk'), is_active: z.literal(true),
        config: z.object({ vk_id: z.literal('-240051152') }) }),
    selected_asset: z.object({ id: z.literal(130), project_id: z.literal(10), content_item_id: z.literal(1048),
        content_revision: z.literal(1), status: z.literal('approved'),
        provenance: z.object({ planner_storage: z.object({ sha256: hex }) }) }),
    publication_fact: z.object({ id: z.number().int().positive(), project_id: z.literal(10), content_item_id: z.literal(1048),
        channel_id: z.literal(117), outcome: z.literal('published'),
        public_url: z.string().regex(/^https:\/\/vk\.(com|ru)\/wall-240051152_\d+$/) }).nullable()
});
const workSchema = z.object({ id: z.literal(1699), project_id: z.literal(10), content_item_id: z.literal(1048),
    kind: z.literal('browser_publish'), assignee_role: z.literal('browser_publisher'), state: z.string(),
    input_context_version: z.literal(1), result_payload: binding.extend({ channel_id: z.literal(117) }) });
const attemptSchema = z.object({ id: z.number().int().positive(), project_id: z.literal(10),
    content_item_id: z.literal(1048), channel_id: z.literal(117), status: z.string() }).nullable();
function invalid(): never { throw new Error('[VK_CONNECTOR_PACKAGE_NOT_READY]'); }
/** Validate canonical database records without projecting their credentials or provider payloads. */
export function buildVkConnectorSnapshot(rawTask: unknown, rawItem: unknown, rawAttempt: unknown): ConnectorSnapshot {
    const t = taskSchema.safeParse(rawTask), w = workSchema.safeParse(rawItem), a = attemptSchema.safeParse(rawAttempt);
    if (!t.success || !w.success || !a.success) invalid();
    const task = t.data, item = w.data, attempt = a.data, release = task.quality_report.owner_release;
    const bodySha = connectorHash(task.draft_text.trim());
    if (release.body_sha256 !== bodySha || release.asset_sha256 !== task.selected_asset.provenance.planner_storage.sha256
        || JSON.stringify(binding.parse(release)) !== JSON.stringify(binding.parse(item.result_payload))) invalid();
    return { package: { ...VK_CONNECTOR_SCOPE, bodySha256: bodySha, assetSha256: release.asset_sha256,
        releaseSha256: connectorHash(JSON.stringify(release)) }, workItemId: item.id,
        factId: task.publication_fact?.id || null, publicUrl: task.publication_fact?.public_url || task.published_link,
        attemptId: attempt?.id || null, attemptStatus: attempt?.status || null,
        eligible: task.status === 'browser_required' && task.publication_mode === 'browser_required'
            && task.handoff_state === 'ready' && ['available', 'claimed'].includes(item.state) };
}

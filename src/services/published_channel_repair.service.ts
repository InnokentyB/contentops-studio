import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { repairMaterializedPublicationProjection } from './publication_metadata_repair';
import { assertCanonicalPublicationPlacement } from './publication_placement_contract';

type SnapshotGuard = { id: number; channelId: number };

export type PublishedChannelRepairGuards = {
    projectId: number;
    actorId: string;
    taskId: number;
    expectedCurrentChannelId: number;
    targetChannelId: number;
    expectedPublicationFactId: number;
    expectedPublicUrl: string;
    expectedSnapshots: SnapshotGuard[];
};

export type ApplyPublishedChannelRepairParams = PublishedChannelRepairGuards & {
    previewHash: string;
    reason: string;
    idempotencyKey: string;
};

const COMMAND = 'ba_apply_published_channel_repair';
const DZEN_TYPES = new Set(['dzen', 'zen', 'zen_article']);
const TARGET_CONTENT_TYPE = 'zen_article';
const TARGET_PLACEMENT = 'article_cover';

function jsonValue(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(jsonValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => [key, jsonValue(entry)]));
    }
    return value ?? null;
}

function stableStringify(value: unknown) {
    return JSON.stringify(jsonValue(value));
}

function sha256(value: unknown) {
    return createHash('sha256').update(typeof value === 'string' ? value : stableStringify(value)).digest('hex');
}

function taskProtectedState(item: any) {
    return jsonValue({
        draft_text: item.draft_text,
        source_refs: item.source_refs,
        content_files: item.assets?.action?.content_files || [],
        handoff_publication: item.quality_report?.handoff_bundle?.publication || null,
        content_revision: item.content_revision,
        accepted_revision: item.accepted_revision,
        text_state: item.text_state,
        title: item.title,
        brief: item.brief,
        key_points: item.key_points,
        cta: item.cta,
        cross_link_to: item.cross_link_to,
        status: item.status,
        published_link: item.published_link,
        schedule_at: item.schedule_at,
        publish_at: item.publish_at,
        week_package_id: item.week_package_id,
        publication_mode: item.publication_mode
    });
}

function factProtectedState(fact: any) {
    return jsonValue({
        id: fact.id,
        artifact_kind: fact.artifact_kind,
        outcome: fact.outcome,
        published_at: fact.published_at,
        public_url: fact.public_url,
        provider_object_id: fact.provider_object_id,
        confirmation_mode: fact.confirmation_mode,
        evidence_type: fact.evidence_type,
        evidence_ref: fact.evidence_ref,
        target_url: fact.target_url,
        utm_status: fact.utm_status,
        confirmed_by: fact.confirmed_by,
        confirmed_at: fact.confirmed_at
    });
}

function snapshotProtectedState(snapshot: any) {
    return jsonValue({
        id: snapshot.id,
        checkpoint: snapshot.checkpoint,
        scheduled_for: snapshot.scheduled_for,
        captured_at: snapshot.captured_at,
        collection_mode: snapshot.collection_mode,
        source: snapshot.source,
        collection_status: snapshot.collection_status,
        metrics: snapshot.metrics,
        evidence_ref: snapshot.evidence_ref,
        error_code: snapshot.error_code,
        error_message: snapshot.error_message,
        late: snapshot.late,
        window_start: snapshot.window_start,
        window_end: snapshot.window_end,
        idempotency_key: snapshot.idempotency_key
    });
}

function guardFingerprint(params: ApplyPublishedChannelRepairParams) {
    return sha256({
        projectId: params.projectId,
        actorId: params.actorId,
        taskId: params.taskId,
        expectedCurrentChannelId: params.expectedCurrentChannelId,
        targetChannelId: params.targetChannelId,
        expectedPublicationFactId: params.expectedPublicationFactId,
        expectedPublicUrl: params.expectedPublicUrl,
        expectedSnapshots: [...params.expectedSnapshots].sort((a, b) => a.id - b.id),
        previewHash: params.previewHash,
        reason: params.reason.trim()
    });
}

function isDzenUrl(value: string) {
    try {
        const hostname = new URL(value).hostname.toLowerCase();
        return hostname === 'dzen.ru' || hostname.endsWith('.dzen.ru');
    } catch {
        return false;
    }
}

function diffValues(entity: string, id: number, path: string, before: unknown, after: unknown): Array<Record<string, unknown>> {
    if (stableStringify(before) === stableStringify(after)) return [];
    const beforeObject = before && typeof before === 'object' && !Array.isArray(before) && !(before instanceof Date);
    const afterObject = after && typeof after === 'object' && !Array.isArray(after) && !(after instanceof Date);
    if (beforeObject && afterObject) {
        const keys = [...new Set([
            ...Object.keys(before as Record<string, unknown>),
            ...Object.keys(after as Record<string, unknown>)
        ])].sort();
        return keys.flatMap((key) => diffValues(
            entity,
            id,
            path ? `${path}.${key}` : key,
            (before as Record<string, unknown>)[key],
            (after as Record<string, unknown>)[key]
        ));
    }
    return [{ entity, id, path, from: jsonValue(before), to: jsonValue(after) }];
}

export class PublishedChannelRepairService {
    constructor(private readonly db: any = prisma) {}

    private async requireOwner(client: any, projectId: number, actorId: string) {
        const match = /^user:(\d+)$/.exec(actorId);
        if (!match) throw new Error('[Security] Owner access required');
        const member = await client.projectMember.findUnique({
            where: { project_id_user_id: { project_id: projectId, user_id: Number(match[1]) } },
            select: { role: true }
        });
        if (member?.role !== 'owner') throw new Error('[Security] Owner access required');
    }

    private async loadAndValidate(client: any, params: PublishedChannelRepairGuards) {
        const expectedSnapshots = [...params.expectedSnapshots].sort((a, b) => a.id - b.id);
        if (!expectedSnapshots.length || new Set(expectedSnapshots.map((entry) => entry.id)).size !== expectedSnapshots.length) {
            throw new Error('[SNAPSHOT_GUARD_INVALID] Expected snapshot IDs must be non-empty and unique');
        }
        const item = await client.contentItem.findFirst({
            where: { id: params.taskId, project_id: params.projectId },
            include: { channel: true, publication_fact: true, metric_snapshots: { orderBy: { id: 'asc' } } }
        });
        if (!item) throw new Error('[PUBLICATION_TASK_NOT_FOUND]');
        const targetChannel = await client.socialChannel.findFirst({
            where: { id: params.targetChannelId, project_id: params.projectId }
        });
        if (!targetChannel || !targetChannel.is_active || !DZEN_TYPES.has(String(targetChannel.type).toLowerCase())) {
            throw new Error('[ACTIVE_DZEN_TARGET_REQUIRED]');
        }
        assertCanonicalPublicationPlacement(targetChannel, TARGET_PLACEMENT);
        if (item.channel_id !== params.expectedCurrentChannelId) throw new Error('[CURRENT_CHANNEL_CONFLICT]');
        if (!item.publication_fact || item.publication_fact.id !== params.expectedPublicationFactId) throw new Error('[PUBLICATION_FACT_CONFLICT]');
        if (item.publication_fact.project_id !== params.projectId
            || item.publication_fact.content_item_id !== params.taskId
            || item.publication_fact.channel_id !== params.expectedCurrentChannelId) {
            throw new Error('[PUBLICATION_FACT_BINDING_CONFLICT]');
        }
        if (item.status !== 'published' || item.publication_fact.outcome !== 'published') {
            throw new Error('[PUBLISHED_TASK_REQUIRED]');
        }
        if (item.published_link !== params.expectedPublicUrl || item.publication_fact.public_url !== params.expectedPublicUrl) {
            throw new Error('[PUBLIC_URL_CONFLICT]');
        }
        if (!isDzenUrl(params.expectedPublicUrl)) throw new Error('[DZEN_PUBLIC_URL_REQUIRED]');

        const snapshots = [...item.metric_snapshots].sort((a: any, b: any) => a.id - b.id);
        if (snapshots.length !== expectedSnapshots.length
            || snapshots.some((snapshot: any, index: number) => snapshot.id !== expectedSnapshots[index].id
                || snapshot.channel_id !== expectedSnapshots[index].channelId
                || snapshot.channel_id !== params.expectedCurrentChannelId
                || snapshot.project_id !== params.projectId
                || snapshot.content_item_id !== params.taskId)) {
            throw new Error('[METRIC_SNAPSHOT_CONFLICT]');
        }
        return { item, targetChannel, snapshots };
    }

    private buildPreview(params: PublishedChannelRepairGuards, loaded: any) {
        const { item, targetChannel, snapshots } = loaded;
        const projection = repairMaterializedPublicationProjection({
            assets: item.assets,
            qualityReport: item.quality_report,
            metrics: item.metrics,
            channel: targetChannel,
            placement: TARGET_PLACEMENT
        });
        const changes = [
            ...diffValues('content_item', item.id, 'channel_id', item.channel_id, targetChannel.id),
            ...diffValues('content_item', item.id, 'type', item.type, TARGET_CONTENT_TYPE),
            ...diffValues('content_item', item.id, 'layer', item.layer, targetChannel.type),
            ...diffValues('content_item', item.id, 'visual_placement', item.visual_placement, TARGET_PLACEMENT),
            ...diffValues('content_item', item.id, 'assets', item.assets || {}, projection.assets),
            ...diffValues('content_item', item.id, 'quality_report', item.quality_report || {}, projection.qualityReport),
            ...diffValues('content_item', item.id, 'metrics', item.metrics || {}, projection.metrics),
            { entity: 'publication_fact', id: item.publication_fact.id, path: 'channel_id', from: item.publication_fact.channel_id, to: targetChannel.id },
            ...snapshots.map((snapshot: any) => ({ entity: `metric_snapshot:${snapshot.id}`, id: snapshot.id, path: 'channel_id', from: snapshot.channel_id, to: targetChannel.id }))
        ];
        const protectedState = {
            task: taskProtectedState(item),
            publication_fact: factProtectedState(item.publication_fact),
            metric_snapshots: snapshots.map(snapshotProtectedState)
        };
        const previewPayload = {
            guards: {
                project_id: params.projectId,
                task_id: params.taskId,
                expected_current_channel_id: params.expectedCurrentChannelId,
                target_channel_id: params.targetChannelId,
                expected_publication_fact_id: params.expectedPublicationFactId,
                expected_public_url: params.expectedPublicUrl,
                expected_snapshots: [...params.expectedSnapshots].sort((a, b) => a.id - b.id)
            },
            target_contract: {
                channel_id: targetChannel.id,
                channel_name: targetChannel.name,
                channel_type: targetChannel.type,
                account_ref: targetChannel.name,
                content_type: TARGET_CONTENT_TYPE,
                layer: targetChannel.type,
                placement: TARGET_PLACEMENT,
                action_type: projection.assets.action.action_type,
                placement_contract: projection.qualityReport.handoff_bundle?.placement_contract || null
            },
            affected_ids: {
                task_id: item.id,
                publication_fact_id: item.publication_fact.id,
                metric_snapshot_ids: snapshots.map((snapshot: any) => snapshot.id)
            },
            changes,
            protected_hashes: {
                body_sha256: sha256(item.draft_text || ''),
                source_resources_sha256: sha256({ source_refs: item.source_refs, content_files: item.assets?.action?.content_files || [] }),
                task_state_sha256: sha256(protectedState.task),
                publication_identity_sha256: sha256(protectedState.publication_fact),
                metric_snapshot_values_sha256: sha256(protectedState.metric_snapshots)
            },
            protected_state: protectedState
        };
        return {
            mode: 'preview',
            dry_run: true,
            ...previewPayload,
            preview_hash: sha256(previewPayload),
            projection
        };
    }

    async preview(params: PublishedChannelRepairGuards): Promise<any> {
        await this.requireOwner(this.db, params.projectId, params.actorId);
        const preview = this.buildPreview(params, await this.loadAndValidate(this.db, params));
        const { projection: _projection, protected_state: _protectedState, ...result } = preview;
        return {
            ...result,
            unchanged_assertions: {
                published_body: 'sha256-bound',
                source_resources: 'sha256-bound',
                revisions_and_text_state: 'value-bound',
                publication_identity_and_timestamps: 'value-bound',
                metric_snapshot_rows: 'ids-and-values-bound',
                delivery_publish_outbox_side_effects: false
            }
        };
    }

    async apply(params: ApplyPublishedChannelRepairParams): Promise<any> {
        if (!params.reason?.trim()) throw new Error('[REPAIR_REASON_REQUIRED]');
        if (!params.idempotencyKey?.trim()) throw new Error('[IDEMPOTENCY_KEY_REQUIRED]');
        const requestFingerprint = guardFingerprint(params);
        return this.db.$transaction(async (tx: any) => {
            await this.requireOwner(tx, params.projectId, params.actorId);
            const replayWhere = {
                project_id: params.projectId,
                actor_id: params.actorId,
                command: COMMAND,
                idempotency_key: params.idempotencyKey
            };
            const replay = async () => {
                const existing = await tx.workflowEvent.findFirst({ where: replayWhere });
                if (!existing) return null;
                const after = existing.after_state as any;
                if (after?.request_fingerprint !== requestFingerprint) throw new Error('[IDEMPOTENCY_KEY_CONFLICT]');
                return { ...after.result, audit_id: existing.id, replayed: true };
            };
            const cached = await replay();
            if (cached) return cached;

            if (typeof tx.$queryRaw === 'function') {
                await tx.$queryRaw(Prisma.sql`SELECT id FROM planner.content_items WHERE project_id = ${params.projectId} AND id = ${params.taskId} FOR UPDATE`);
                await tx.$queryRaw(Prisma.sql`SELECT id FROM planner.publication_facts WHERE project_id = ${params.projectId} AND id = ${params.expectedPublicationFactId} FOR UPDATE`);
                await tx.$queryRaw(Prisma.sql`SELECT id FROM planner.metric_snapshots WHERE project_id = ${params.projectId} AND id IN (${Prisma.join(params.expectedSnapshots.map((entry) => entry.id))}) ORDER BY id FOR UPDATE`);
            }
            const replayAfterLock = await replay();
            if (replayAfterLock) return replayAfterLock;

            const preview = this.buildPreview(params, await this.loadAndValidate(tx, params));
            if (preview.preview_hash !== params.previewHash) throw new Error('[PREVIEW_CONFLICT] Published state changed since preview');

            const itemUpdate = await tx.contentItem.updateMany({
                where: { id: params.taskId, project_id: params.projectId, channel_id: params.expectedCurrentChannelId },
                data: {
                    channel_id: params.targetChannelId,
                    type: preview.target_contract.content_type,
                    layer: preview.target_contract.layer,
                    visual_placement: preview.target_contract.placement,
                    assets: preview.projection.assets as Prisma.InputJsonValue,
                    quality_report: preview.projection.qualityReport as Prisma.InputJsonValue,
                    metrics: preview.projection.metrics as Prisma.InputJsonValue
                }
            });
            if (itemUpdate.count !== 1) throw new Error('[CURRENT_CHANNEL_CONFLICT]');

            const factUpdate = await tx.publicationFact.updateMany({
                where: {
                    id: params.expectedPublicationFactId,
                    project_id: params.projectId,
                    content_item_id: params.taskId,
                    channel_id: params.expectedCurrentChannelId,
                    public_url: params.expectedPublicUrl,
                    outcome: 'published'
                },
                data: { channel_id: params.targetChannelId }
            });
            if (factUpdate.count !== 1) throw new Error('[PUBLICATION_FACT_CONFLICT]');

            for (const snapshot of params.expectedSnapshots) {
                const updated = await tx.metricSnapshot.updateMany({
                    where: { id: snapshot.id, project_id: params.projectId, content_item_id: params.taskId, channel_id: snapshot.channelId },
                    data: { channel_id: params.targetChannelId }
                });
                if (updated.count !== 1) throw new Error('[METRIC_SNAPSHOT_CONFLICT]');
            }

            const afterItem = await tx.contentItem.findFirst({
                where: { id: params.taskId, project_id: params.projectId },
                include: { channel: true, publication_fact: true, metric_snapshots: { orderBy: { id: 'asc' } } }
            });
            if (!afterItem || !afterItem.channel || afterItem.channel_id !== params.targetChannelId
                || afterItem.publication_fact?.channel_id !== params.targetChannelId) {
                throw new Error('[REPAIR_READBACK_FAILED]');
            }
            const afterSnapshots = [...afterItem.metric_snapshots].sort((a: any, b: any) => a.id - b.id);
            if (afterSnapshots.length !== params.expectedSnapshots.length
                || afterSnapshots.some((entry: any, index: number) => entry.id !== [...params.expectedSnapshots].sort((a, b) => a.id - b.id)[index].id || entry.channel_id !== params.targetChannelId)) {
                throw new Error('[REPAIR_READBACK_FAILED]');
            }
            const preserved = {
                task: stableStringify(taskProtectedState(afterItem)) === stableStringify(preview.protected_state.task),
                publication_fact: stableStringify(factProtectedState(afterItem.publication_fact)) === stableStringify(preview.protected_state.publication_fact),
                metric_snapshots: stableStringify(afterSnapshots.map(snapshotProtectedState)) === stableStringify(preview.protected_state.metric_snapshots)
            };
            if (!preserved.task || !preserved.publication_fact || !preserved.metric_snapshots) {
                throw new Error('[PROTECTED_STATE_CHANGED]');
            }
            const result = {
                applied: true,
                replayed: false,
                preview_hash: preview.preview_hash,
                affected_ids: preview.affected_ids,
                changed_fields: preview.changes,
                unchanged_assertions: preserved,
                authoritative_readback: {
                    task: {
                        id: afterItem.id,
                        channel_id: afterItem.channel_id,
                        channel_name: afterItem.channel.name,
                        channel_type: afterItem.channel.type,
                        type: afterItem.type,
                        layer: afterItem.layer,
                        visual_placement: afterItem.visual_placement,
                        account_ref: afterItem.assets?.account_ref || null,
                        action_type: afterItem.assets?.action?.action_type || null,
                        published_link: afterItem.published_link,
                        content_revision: afterItem.content_revision,
                        accepted_revision: afterItem.accepted_revision,
                        text_state: afterItem.text_state
                    },
                    publication_fact: {
                        id: afterItem.publication_fact.id,
                        channel_id: afterItem.publication_fact.channel_id,
                        outcome: afterItem.publication_fact.outcome,
                        published_at: jsonValue(afterItem.publication_fact.published_at),
                        public_url: afterItem.publication_fact.public_url,
                        confirmed_by: afterItem.publication_fact.confirmed_by,
                        confirmed_at: jsonValue(afterItem.publication_fact.confirmed_at)
                    },
                    metric_snapshots: afterSnapshots.map((snapshot: any) => ({
                        id: snapshot.id,
                        channel_id: snapshot.channel_id,
                        checkpoint: snapshot.checkpoint,
                        scheduled_for: jsonValue(snapshot.scheduled_for),
                        collection_status: snapshot.collection_status,
                        metrics: snapshot.metrics,
                        evidence_ref: snapshot.evidence_ref
                    })),
                    dzen_metric_collection_eligible: afterItem.channel.is_active
                        && DZEN_TYPES.has(String(afterItem.channel.type).toLowerCase())
                        && isDzenUrl(afterItem.published_link)
                }
            };
            const audit = await tx.workflowEvent.create({
                data: {
                    project_id: params.projectId,
                    content_item_id: params.taskId,
                    actor_id: params.actorId,
                    command: COMMAND,
                    idempotency_key: params.idempotencyKey,
                    before_state: {
                        reason: params.reason.trim(),
                        preview_hash: preview.preview_hash,
                        affected_ids: preview.affected_ids,
                        changed_fields: preview.changes,
                        protected_hashes: preview.protected_hashes
                    } as Prisma.InputJsonValue,
                    after_state: {
                        reason: params.reason.trim(),
                        request_fingerprint: requestFingerprint,
                        result
                    } as Prisma.InputJsonValue
                }
            });
            return { ...result, audit_id: audit.id };
        });
    }
}

export default new PublishedChannelRepairService();

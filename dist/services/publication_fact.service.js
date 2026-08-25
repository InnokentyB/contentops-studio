"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublicationFactService = void 0;
exports.isActuallyPublished = isActuallyPublished;
const db_1 = __importDefault(require("../db"));
const project_access_service_1 = require("./project_access.service");
const PERMALINK_KINDS = new Set(['post', 'article', 'comment']);
function validDate(value) {
    if (!value)
        return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        throw new Error('INVALID_PUBLISHED_AT');
    return date;
}
function resolveUtmStatus(targetUrl, explicit) {
    if (explicit)
        return explicit;
    if (!targetUrl)
        return 'not_applicable';
    try {
        const url = new URL(targetUrl);
        return url.searchParams.has('utm_source') ? 'pass' : 'missing';
    }
    catch {
        return 'invalid';
    }
}
function isActuallyPublished(fact) {
    if (!fact || fact.outcome !== 'published' || !fact.published_at)
        return false;
    if (PERMALINK_KINDS.has(fact.artifact_kind))
        return Boolean(fact.public_url);
    if (fact.artifact_kind === 'story') {
        return Boolean(fact.provider_object_id && fact.evidence_ref);
    }
    if (fact.artifact_kind === 'email')
        return Boolean(fact.provider_object_id);
    return Boolean(fact.public_url || fact.provider_object_id || fact.evidence_ref);
}
function factsEqual(existing, next) {
    const fields = [
        'artifact_kind', 'outcome', 'public_url', 'provider_object_id', 'confirmation_mode',
        'evidence_type', 'evidence_ref', 'target_url', 'utm_status'
    ];
    return fields.every((field) => (existing[field] ?? null) === (next[field] ?? null))
        && (existing.published_at?.toISOString?.() || null) === (next.published_at?.toISOString?.() || null);
}
function serializeFact(fact) {
    return {
        id: fact.id,
        project_id: fact.project_id,
        content_item_id: fact.content_item_id,
        channel_id: fact.channel_id,
        artifact_kind: fact.artifact_kind,
        outcome: fact.outcome,
        published_at: fact.published_at?.toISOString?.() || null,
        public_url: fact.public_url,
        provider_object_id: fact.provider_object_id,
        confirmation_mode: fact.confirmation_mode,
        evidence: fact.evidence_type ? { type: fact.evidence_type, ref: fact.evidence_ref } : null,
        target_url: fact.target_url,
        utm_status: fact.utm_status,
        confirmed_by: fact.confirmed_by,
        confirmed_at: fact.confirmed_at?.toISOString?.() || null,
        created_at: fact.created_at?.toISOString?.() || null,
        updated_at: fact.updated_at?.toISOString?.() || null
    };
}
class PublicationFactService {
    async record(args) {
        await (0, project_access_service_1.requireProjectActorAccess)(args.projectId, args.actorId);
        const publishedAt = validDate(args.publishedAt);
        if (args.outcome === 'published' && !publishedAt)
            throw new Error('PUBLISHED_AT_REQUIRED');
        if (args.outcome === 'published' && PERMALINK_KINDS.has(args.artifactKind) && !args.publicUrl) {
            throw new Error('PUBLIC_URL_REQUIRED');
        }
        if (args.outcome === 'published' && args.artifactKind === 'story'
            && (!args.providerObjectId || !args.evidence?.ref)) {
            throw new Error('STORY_EVIDENCE_REQUIRED');
        }
        if (args.outcome === 'published' && args.artifactKind === 'email' && !args.providerObjectId) {
            throw new Error('EMAIL_PROVIDER_ID_REQUIRED');
        }
        return db_1.default.$transaction(async (tx) => {
            const item = await tx.contentItem.findFirst({
                where: { id: args.taskId, project_id: args.projectId },
                include: { channel: true, publication_fact: true }
            });
            if (!item || !item.channel_id)
                throw new Error('PUBLICATION_TASK_NOT_FOUND');
            const nextData = {
                project_id: args.projectId,
                content_item_id: item.id,
                channel_id: item.channel_id,
                artifact_kind: args.artifactKind,
                outcome: args.outcome,
                published_at: publishedAt,
                public_url: args.publicUrl || null,
                provider_object_id: args.providerObjectId || null,
                confirmation_mode: args.confirmationMode,
                evidence_type: args.evidence?.type || null,
                evidence_ref: args.evidence?.ref || null,
                target_url: args.targetUrl || null,
                utm_status: resolveUtmStatus(args.targetUrl, args.utmStatus),
                confirmed_by: args.actorId,
                confirmed_at: new Date()
            };
            if (item.publication_fact && factsEqual(item.publication_fact, nextData)) {
                return { publication_fact: serializeFact(item.publication_fact), created_checkpoints: 0, replayed: true };
            }
            if (item.publication_fact && !args.correctionReason?.trim()) {
                throw new Error('PUBLICATION_FACT_CORRECTION_REASON_REQUIRED');
            }
            const before = item.publication_fact ? serializeFact(item.publication_fact) : null;
            const fact = item.publication_fact
                ? await tx.publicationFact.update({ where: { id: item.publication_fact.id }, data: nextData })
                : await tx.publicationFact.create({ data: nextData });
            const quality = item.quality_report || {};
            const metrics = item.metrics || {};
            await tx.contentItem.update({
                where: { id: item.id },
                data: {
                    status: args.outcome === 'published' ? 'published' : item.status,
                    published_link: args.publicUrl || item.published_link,
                    quality_report: {
                        ...quality,
                        publication_outcome: args.outcome,
                        manual_publication_note: args.note || quality.manual_publication_note || null
                    },
                    metrics: {
                        ...metrics,
                        publication_outcome: args.outcome,
                        manual_confirmation_at: fact.confirmed_at.toISOString()
                    }
                }
            });
            if (args.outcome === 'published') {
                await tx.workItem.updateMany({
                    where: {
                        project_id: args.projectId,
                        content_item_id: item.id,
                        kind: 'browser_publish',
                        state: { notIn: ['completed', 'cancelled'] }
                    },
                    data: {
                        state: 'completed',
                        lease_token: null,
                        lease_expires_at: null,
                        lease_actor_id: null,
                        reason_code: null,
                        note: args.note || 'Publication confirmed with a public URL.'
                    }
                });
            }
            let createdCheckpoints = 0;
            let createdMetricWorkItems = 0;
            if (args.outcome === 'published' && publishedAt) {
                const checkpoints = [
                    { checkpoint: 't24h', hours: args.artifactKind === 'story' ? 23 : 24 },
                    { checkpoint: 't7d', hours: 24 * 7 }
                ];
                for (const checkpoint of checkpoints) {
                    const scheduledFor = new Date(publishedAt.getTime() + checkpoint.hours * 60 * 60 * 1000);
                    const existing = await tx.metricSnapshot.findUnique({
                        where: {
                            project_id_content_item_id_channel_id_checkpoint: {
                                project_id: args.projectId,
                                content_item_id: item.id,
                                channel_id: item.channel_id,
                                checkpoint: checkpoint.checkpoint
                            }
                        }
                    });
                    if (!existing) {
                        await tx.metricSnapshot.create({
                            data: {
                                project_id: args.projectId,
                                content_item_id: item.id,
                                channel_id: item.channel_id,
                                checkpoint: checkpoint.checkpoint,
                                scheduled_for: scheduledFor,
                                collection_status: 'pending',
                                collection_mode: item.channel?.type === 'vk' ? 'automatic' : 'manual',
                                source: item.channel?.type === 'vk' ? 'provider_api' : 'manual',
                                metrics: { schema_version: 1, values: {} }
                            }
                        });
                        createdCheckpoints += 1;
                    }
                    if (item.channel?.type !== 'vk') {
                        const itemKey = `metric:${item.id}:${checkpoint.checkpoint}`;
                        const existingWorkItem = await tx.workItem.findFirst({
                            where: { project_id: args.projectId, item_key: itemKey }
                        });
                        if (!existingWorkItem) {
                            await tx.workItem.create({
                                data: {
                                    project_id: args.projectId,
                                    week_package_id: item.week_package_id,
                                    content_item_id: item.id,
                                    item_key: itemKey,
                                    kind: 'metric_capture',
                                    state: 'available',
                                    assignee_role: 'metrics_operator',
                                    due_at: scheduledFor,
                                    result_payload: {
                                        checkpoint: checkpoint.checkpoint,
                                        channel_id: item.channel_id,
                                        collection_mode: 'manual'
                                    }
                                }
                            });
                            createdMetricWorkItems += 1;
                        }
                    }
                }
            }
            await tx.workflowEvent.create({
                data: {
                    project_id: args.projectId,
                    content_item_id: item.id,
                    actor_id: args.actorId,
                    command: item.publication_fact ? 'publication_fact.corrected' : 'publication_fact.created',
                    before_state: before,
                    after_state: serializeFact(fact),
                    idempotency_key: item.publication_fact ? `${fact.id}:${fact.updated_at.toISOString()}` : `fact:${fact.id}`
                }
            });
            return {
                publication_fact: serializeFact(fact),
                created_checkpoints: createdCheckpoints,
                created_metric_work_items: createdMetricWorkItems,
                replayed: false
            };
        });
    }
    async get(projectId, taskId, actorId) {
        await (0, project_access_service_1.requireProjectActorAccess)(projectId, actorId);
        const fact = await db_1.default.publicationFact.findFirst({
            where: { project_id: projectId, content_item_id: taskId }
        });
        if (!fact)
            throw new Error('PUBLICATION_FACT_NOT_FOUND');
        return serializeFact(fact);
    }
    async listCheckpoints(params) {
        await (0, project_access_service_1.requireProjectActorAccess)(params.projectId, params.actorId);
        const snapshots = await db_1.default.metricSnapshot.findMany({
            where: {
                project_id: params.projectId,
                ...(params.status ? { collection_status: params.status } : {}),
                ...(params.channelId ? { channel_id: params.channelId } : {}),
                ...(params.dueBefore ? { scheduled_for: { lte: new Date(params.dueBefore) } } : {})
            },
            orderBy: [{ scheduled_for: 'asc' }, { id: 'asc' }]
        });
        return snapshots.map((snapshot) => ({
            id: snapshot.id,
            content_item_id: snapshot.content_item_id,
            channel_id: snapshot.channel_id,
            checkpoint: snapshot.checkpoint,
            scheduled_for: snapshot.scheduled_for?.toISOString() || null,
            captured_at: snapshot.captured_at?.toISOString() || null,
            collection_mode: snapshot.collection_mode,
            source: snapshot.source,
            collection_status: snapshot.collection_status,
            late: snapshot.late,
            metrics: snapshot.metrics
        }));
    }
}
exports.PublicationFactService = PublicationFactService;
exports.default = new PublicationFactService();

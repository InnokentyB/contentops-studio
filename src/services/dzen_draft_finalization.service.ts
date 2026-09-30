import { createHash } from 'crypto';
import prisma from '../db';
import dzenService, { isDzenPublishedUrl, type DzenDraftFinalizationInput } from './dzen.service';
import publicationFactService from './publication_fact.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';

export const DZEN_992_DRAFT_EDITOR_URL = 'https://dzen.ru/profile/editor/id/6a8029aba055ec36033bf81c/6abbee89489dee41e9c88d2c/edit';
export const DZEN_992_BODY_SHA256 = '62af2b8e32d3aabb2b3d6f7029ee2b7ec64a7f9329eef01e52d6c4591e7eb150';
export const DZEN_992_ASSET_SHA256 = '6061c4e53210de240d840e85e39990d7af5e496544f0cda4dd010048d33ebe25';

type Args = {
    projectId: number;
    taskId: number;
    draftEditorUrl: string;
    dryRun?: boolean;
    idempotencyKey?: string;
};

type Dependencies = {
    db: any;
    dzen: {
        finalizeExistingDraft(config: any, input: DzenDraftFinalizationInput): Promise<any>;
        publishPost?: (...args: any[]) => Promise<string>;
    };
    facts: { record(args: any): Promise<any> };
    hashBody?: (body: string) => string;
};

const SYSTEM_ACTOR = 'system:planner-mcp:dzen-task992-finalize';
const COMMAND = 'ba_finalize_dzen_task992';

export class DzenDraftFinalizationService {
    constructor(private readonly dependencies: Dependencies) {}

    async finalizeTask992(args: Args) {
        if (args.projectId !== 10 || args.taskId !== 992 || args.draftEditorUrl !== DZEN_992_DRAFT_EDITOR_URL) {
            throw new Error('[DZEN_992_FINALIZE_SCOPE_MISMATCH] Exact project, task, and draft editor URL required');
        }
        const key = args.idempotencyKey?.trim() || null;
        if (!args.dryRun && !key) throw new Error('[IDEMPOTENCY_KEY_REQUIRED]');
        const { db, dzen, facts } = this.dependencies;

        if (key) {
            const cached = await db.workflowEvent.findUnique({ where: {
                project_id_actor_id_command_idempotency_key: {
                    project_id: 10,
                    actor_id: SYSTEM_ACTOR,
                    command: COMMAND,
                    idempotency_key: key
                }
            } });
            if (cached?.after_state) return { ...cached.after_state, replayed: true };
        }

        const task = await db.contentItem.findFirst({
            where: { id: 992, project_id: 10 },
            include: { channel: true, selected_asset: true, publication_fact: true }
        });
        if (!task) throw new Error('[DZEN_992_FINALIZE_GUARD_FAILED] Task not found');
        if (task.publication_fact?.outcome === 'published' && task.publication_fact.public_url) {
            return {
                mode: 'published',
                task_id: 992,
                published_link: task.publication_fact.public_url,
                external_id: task.publication_fact.provider_object_id || null,
                publication_fact_id: task.publication_fact.id,
                replayed: true
            };
        }

        const bodyHash = (this.dependencies.hashBody || ((body: string) => createHash('sha256').update(body).digest('hex')))(task.draft_text || '');
        const provenance = task.selected_asset?.provenance as any;
        const assetHash = provenance?.sha256 || provenance?.planner_storage?.sha256 || null;
        const release = await db.workflowEvent.findFirst({ where: {
            project_id: 10,
            content_item_id: 992,
            command: 'ba_release_approved_dzen_task992'
        }, orderBy: { id: 'desc' } });
        const proof = release?.after_state as any;
        const decision = await db.artDirectionDecision.findFirst({ where: {
            id: 186,
            project_id: 10,
            content_item_id: 992,
            source_content_revision: 3,
            status: 'active'
        } });

        const stateEligible = task.status === 'awaiting_manual_publication'
            || task.status === 'ready_for_execution';
        if (!proof
            || proof.task_id !== 992
            || proof.channel_id !== 116
            || proof.content_revision !== 3
            || proof.accepted_revision !== 3
            || proof.body_sha256 !== DZEN_992_BODY_SHA256
            || proof.visual_decision_id !== 186
            || proof.selected_asset_id !== 97
            || proof.asset_sha256 !== DZEN_992_ASSET_SHA256
            || proof.publication_mode !== 'owner_released'
            || task.channel_id !== 116
            || task.channel?.type !== 'dzen'
            || task.content_revision !== 3
            || task.accepted_revision !== 3
            || task.text_state !== 'accepted'
            || task.visual_placement !== 'article_cover'
            || task.visual_state !== 'APPROVED'
            || task.visual_decision_version !== decision?.decision_version
            || task.selected_asset_id !== 97
            || task.selected_asset?.content_revision !== 3
            || task.selected_asset?.status !== 'approved'
            || assetHash !== DZEN_992_ASSET_SHA256
            || task.handoff_state !== 'ready'
            || task.publication_mode !== 'owner_released'
            || !stateEligible
            || bodyHash !== DZEN_992_BODY_SHA256
            || !decision
            || task.published_link) {
            throw new Error('[DZEN_992_FINALIZE_GUARD_FAILED] Exact released revision, visual, and draft state required');
        }

        const config = resolveEffectiveChannelConfig('dzen', task.channel.config || {});
        if (!config.cookies?.trim() || !config.channel_id) throw new Error('[DZEN_CONNECTOR_NOT_READY]');
        const adapterInput: DzenDraftFinalizationInput = {
            draftEditorUrl: args.draftEditorUrl,
            expectedTitle: task.title,
            expectedCanonicalBodySha256: DZEN_992_BODY_SHA256,
            expectedImageUrl: task.selected_asset.file_url,
            dryRun: true
        };
        const preflight = await dzen.finalizeExistingDraft(config, adapterInput);
        if (preflight?.matched_draft_count !== 1
            || preflight?.canonical_body_sha256 !== DZEN_992_BODY_SHA256) {
            throw new Error('[DZEN_DRAFT_PREFLIGHT_MISMATCH] Adapter did not confirm the exact single draft');
        }
        if (args.dryRun) {
            return {
                mode: 'dry_run',
                task_id: 992,
                project_id: 10,
                route_executable: true,
                draft_editor_url: args.draftEditorUrl,
                matched_draft_count: preflight.matched_draft_count,
                draft_id: preflight.draft_id,
                body_sha256: bodyHash,
                selected_asset_id: 97,
                visual_decision_id: 186
            };
        }

        const claimed = await db.$transaction(async (tx: any) => {
            const changed = await tx.contentItem.updateMany({ where: {
                id: 992,
                project_id: 10,
                status: task.status,
                publication_mode: 'owner_released',
                content_revision: 3,
                accepted_revision: 3,
                selected_asset_id: 97,
                visual_state: 'APPROVED',
                handoff_state: 'ready'
            }, data: {
                status: 'publishing',
                quality_report: {
                    ...((task.quality_report as any) || {}),
                    publication_task_delivery: {
                        state: 'existing_draft_finalization_started',
                        channel_type: 'dzen',
                        artifact_kind: 'article',
                        idempotency_key: key,
                        draft_editor_url: args.draftEditorUrl,
                        body_sha256: bodyHash,
                        selected_asset_id: 97,
                        started_at: new Date().toISOString()
                    }
                }
            } });
            if (changed.count === 1) await tx.workflowEvent.create({ data: {
                project_id: 10,
                content_item_id: 992,
                actor_id: SYSTEM_ACTOR,
                command: `${COMMAND}_claim`,
                idempotency_key: key,
                before_state: { status: task.status },
                after_state: { status: 'publishing', draft_editor_url: args.draftEditorUrl }
            } });
            return changed.count;
        });
        if (claimed !== 1) throw new Error('[DZEN_DRAFT_FINALIZATION_ALREADY_CLAIMED]');

        let providerResult: any;
        try {
            providerResult = await dzen.finalizeExistingDraft(config, { ...adapterInput, dryRun: false });
            if (!providerResult?.published_url || !isDzenPublishedUrl(providerResult.published_url)) {
                throw new Error('Provider did not confirm a public Dzen permalink');
            }
        } catch (error: any) {
            const current = await db.contentItem.findUniqueOrThrow({ where: { id: 992 } });
            await db.contentItem.update({ where: { id: 992 }, data: {
                status: 'publishing',
                quality_report: {
                    ...((current.quality_report as any) || {}),
                    publication_task_delivery: {
                        state: 'existing_draft_finalization_uncertain',
                        channel_type: 'dzen',
                        artifact_kind: 'article',
                        idempotency_key: key,
                        draft_editor_url: args.draftEditorUrl,
                        retry_via_api: false,
                        error: String(error?.message || error),
                        failed_at: new Date().toISOString()
                    }
                }
            } });
            throw new Error(`[DZEN_DRAFT_FINALIZATION_UNCERTAIN] ${String(error?.message || error)}`);
        }

        const url = providerResult.published_url;
        const providerId = new URL(url).pathname.split('/').filter(Boolean).pop()!;
        const publishedAt = new Date().toISOString();
        const factResult = await facts.record({
            projectId: 10,
            taskId: 992,
            actorId: 'user:2',
            artifactKind: 'article',
            outcome: 'published',
            publishedAt,
            publicUrl: url,
            providerObjectId: providerId,
            confirmationMode: 'automatic',
            evidence: { type: 'public_url', ref: url },
            targetUrl: 'https://t.me/spherical_analyst/1269',
            utmStatus: 'not_applicable',
            note: 'Finalized the exact owner-released Dzen draft for task #992 revision 3.'
        });
        const current = await db.contentItem.findUniqueOrThrow({ where: { id: 992 } });
        const result = {
            mode: 'published',
            task_id: 992,
            project_id: 10,
            channel_id: 116,
            accepted_revision: 3,
            body_sha256: bodyHash,
            published_link: url,
            external_id: providerId,
            delivery_method: 'dzen_existing_draft_finalize',
            draft_id: providerResult.draft_id,
            visual_decision_id: 186,
            selected_asset_id: 97,
            asset_sha256: DZEN_992_ASSET_SHA256,
            publication_fact_id: factResult.publication_fact?.id || null,
            published_at: publishedAt,
            created_checkpoints: factResult.created_checkpoints || 0,
            created_metric_work_items: factResult.created_metric_work_items || 0
        };
        await db.$transaction(async (tx: any) => {
            await tx.contentItem.update({ where: { id: 992 }, data: {
                status: 'published',
                publication_mode: 'owner_released',
                published_link: url,
                quality_report: {
                    ...((current.quality_report as any) || {}),
                    publication_task_delivery: {
                        state: 'provider_confirmed',
                        channel_type: 'dzen',
                        artifact_kind: 'article',
                        idempotency_key: key,
                        draft_editor_url: args.draftEditorUrl,
                        provider_object_id: providerId,
                        permalink: url,
                        completed_at: new Date().toISOString()
                    }
                }
            } });
            await tx.workflowEvent.create({ data: {
                project_id: 10,
                content_item_id: 992,
                actor_id: SYSTEM_ACTOR,
                command: COMMAND,
                idempotency_key: key,
                before_state: { status: task.status, publication_mode: 'owner_released' },
                after_state: result
            } });
        });
        return result;
    }
}

export default new DzenDraftFinalizationService({
    db: prisma,
    dzen: dzenService,
    facts: publicationFactService
});

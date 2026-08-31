import prisma from '../db';
import { requireProjectActorAccess } from './project_access.service';
import { assertVisualGenerationGate } from './visual_generation_policy';
import path from 'path';
import storageService from './storage.service';
import { decodeVisualBase64, inspectVisualBinary, isServerResolvableVisualUrl } from './visual_asset_binding.service';
import { blockVisualStorageIngest, clearVisualStorageIngestBlock } from './visual_storage_incident.service';

export interface GenerateImageAssetArgs {
    projectId: number;
    actorId: string;
    contentItemId: number;
    prompt: string;
    provider?: string;
    model?: string;
    seed?: number;
    promptVersion?: number;
    altText?: string;
    aspectRatio?: string;
    decisionId?: number;
    contentRevision?: number;
    placement?: string;
    fileUrl?: string;
    fileDataBase64?: string;
    fileName?: string;
    mimeType?: string;
    provenance?: Record<string, unknown>;
}

export interface ReviewImageAssetArgs {
    projectId: number;
    actorId: string;
    assetId: number;
    decision: 'approved' | 'rejected';
    reason?: string;
    qaReport?: Record<string, unknown>;
}

export interface ListImageAssetsArgs {
    projectId: number;
    actorId: string;
    contentItemId: number;
}

export async function cancelSupersededVisualWork(tx: any, asset: {
    id: number;
    project_id: number;
    content_item_id: number;
    content_revision: number;
    placement: string | null;
    decision_id: number | null;
}) {
    return tx.workItem.updateMany({
        where: {
            project_id: asset.project_id,
            content_item_id: asset.content_item_id,
            input_context_version: asset.content_revision,
            kind: { in: ['visual_generate', 'visual_review'] },
            state: { notIn: ['completed', 'cancelled'] },
            OR: [
                { result_payload: { path: ['placement'], equals: asset.placement } },
                { result_payload: { path: ['decision_id'], equals: asset.decision_id } }
            ]
        },
        data: {
            state: 'cancelled',
            reason_code: 'superseded_by_selected_asset',
            note: `Superseded by approved selected asset ${asset.id}`,
            lease_token: null,
            lease_actor_id: null,
            lease_expires_at: null
        }
    });
}

export class ImageAssetService {
    /**
     * Generate an image asset candidate recording prompt, seed, model, provider, altText, and version history.
     */
    async generateImageAsset(args: GenerateImageAssetArgs) {
        const {
            projectId,
            contentItemId,
            prompt,
            provider = 'google',
            model = 'gemini-3.1-flash-lite-image',
            seed = 42,
            promptVersion = 1,
            altText,
            aspectRatio, decisionId, contentRevision, placement,
        } = args;

        await requireProjectActorAccess(projectId, args.actorId);
        const item = await prisma.contentItem.findFirst({
            where: { id: contentItemId, project_id: projectId },
            include: { week_package: true }
        });
        if (!item) throw new Error('[PUBLICATION_TASK_NOT_FOUND] Content item was not found in the project');

        const boundDecision = decisionId ? await prisma.artDirectionDecision.findFirst({
            where: { id: decisionId, project_id: projectId, content_item_id: contentItemId, status: 'active', decision: 'GENERATE' }
        }) : null;
        assertVisualGenerationGate({
            weekPackageId: item.week_package_id,
            weekApprovalStatus: item.week_package?.approval_status,
            textState: item.text_state,
            acceptedRevision: item.accepted_revision,
            contentRevision: item.content_revision,
            decisionType: boundDecision?.decision,
            decisionSourceRevision: boundDecision?.source_content_revision,
            prompt,
            altText
        });
        let fileUrl = args.fileUrl?.trim() || '';
        let provenance = { ...(args.provenance || {}) } as Record<string, unknown>;
        if (args.fileDataBase64) {
            const buffer = decodeVisualBase64(args.fileDataBase64);
            const metadata = inspectVisualBinary(buffer, args.mimeType);
            const extension = metadata.mime_type === 'image/jpeg' ? '.jpg' : `.${metadata.mime_type.split('/')[1]}`;
            const objectKey = `visual-sources/project-${projectId}/content-${contentItemId}/${metadata.sha256}${extension}`;
            try {
                fileUrl = await storageService.uploadFileFromBuffer(buffer, metadata.mime_type, objectKey);
            } catch (error) {
                await blockVisualStorageIngest(projectId, contentItemId, error);
                throw error;
            }
            if (!isServerResolvableVisualUrl(fileUrl)) {
                const error = new Error('[VISUAL_INGEST_NOT_DURABLE] Managed storage did not return a server-resolvable HTTPS URL');
                await blockVisualStorageIngest(projectId, contentItemId, error);
                throw error;
            }
            await clearVisualStorageIngestBlock(projectId);
            provenance = {
                ...provenance,
                planner_storage: {
                    managed: true,
                    provider: storageService.getProvider(),
                    object_key: objectKey,
                    original_file_name: args.fileName ? path.basename(args.fileName) : `source${extension}`,
                    ...metadata
                }
            };
        } else if (!isServerResolvableVisualUrl(fileUrl)) {
            throw new Error('[VISUAL_SOURCE_BYTES_REQUIRED] Local visual sources must be registered with fileDataBase64 for durable ingestion');
        }

        const latestAsset = await prisma.imageAsset.findFirst({
            where: { project_id: projectId, content_item_id: contentItemId },
            orderBy: { asset_version: 'desc' },
        });

        const nextVersion = latestAsset ? latestAsset.asset_version + 1 : 1;

        const asset = await prisma.imageAsset.create({
            data: {
                project_id: projectId,
                content_item_id: contentItemId,
                decision_id: decisionId || null,
                content_revision: boundDecision?.source_content_revision || contentRevision || 0,
                placement: boundDecision?.placement || placement || null,
                asset_version: nextVersion,
                prompt,
                prompt_version: promptVersion,
                provider,
                model,
                seed,
                alt_text: altText || null,
                aspect_ratio: aspectRatio || null,
                file_url: fileUrl,
                provenance: provenance as any,
                status: 'candidate',
            },
        });

        await prisma.$transaction(async (tx) => {
            await tx.contentItem.update({ where: { id: contentItemId }, data: { visual_state: 'IN_REVIEW', handoff_state: 'blocked' } });
            const dedupeKey = `visual-review:${asset.id}:${asset.asset_version}`;
            await tx.workItem.upsert({ where: { dedupe_key: dedupeKey }, update: {}, create: {
                project_id: projectId, week_package_id: item.week_package_id, content_item_id: contentItemId,
                item_key: item.item_key || `content:${contentItemId}`, kind: 'visual_review', state: 'available',
                assignee_role: 'visual_reviewer', input_context_version: boundDecision!.source_content_revision,
                dedupe_key: dedupeKey, result_payload: { asset_id: asset.id, decision_id: boundDecision!.id } as any
            } });
        });

        return {
            asset_id: asset.id,
            asset_version: asset.asset_version,
            content_item_id: asset.content_item_id,
            prompt: asset.prompt,
            prompt_version: asset.prompt_version,
            provider: asset.provider,
            model: asset.model,
            seed: asset.seed,
            alt_text: asset.alt_text,
            aspect_ratio: asset.aspect_ratio,
            file_url: asset.file_url,
            status: asset.status,
        };
    }

    /**
     * Review an image asset candidate (approve or reject).
     */
    async reviewImageAsset(args: ReviewImageAssetArgs) {
        const { projectId, actorId, assetId, decision, reason, qaReport } = args;
        await requireProjectActorAccess(projectId, actorId);

        const asset = await prisma.imageAsset.findFirst({
            where: { id: assetId, project_id: projectId },
            include: { content_item: true, decision: true },
        });

        if (!asset) {
            throw new Error(`ImageAsset ${assetId} not found`);
        }

        if (decision === 'approved' && (!asset.decision || asset.content_revision !== asset.content_item.accepted_revision)) {
            throw new Error('[STALE_VISUAL_ASSET] Asset is not bound to the current accepted decision and revision');
        }
        const updated = await prisma.$transaction(async (tx) => {
            const reviewed = await tx.imageAsset.update({ where: { id: assetId }, data: {
                status: decision, review_reason: reason || null, qa_report: (qaReport || {}) as any,
                reviewed_by: actorId, reviewed_at: new Date()
            } });
            const durable = isServerResolvableVisualUrl(asset.file_url);
            await tx.contentItem.update({ where: { id: asset.content_item_id }, data: decision === 'approved'
                ? { status: durable ? 'ready_for_execution' : asset.content_item.status, selected_asset_id: asset.id, visual_state: 'APPROVED', handoff_state: durable ? 'ready' : 'blocked' }
                : { selected_asset_id: null, visual_state: 'REJECTED', handoff_state: 'blocked' }
            });
            if (decision === 'approved' && durable) await cancelSupersededVisualWork(tx, asset);
            return reviewed;
        });

        return {
            asset_id: updated.id,
            status: updated.status,
            decision,
            reason: reason || null,
            qa_report: qaReport || {},
            handoff_state: decision === 'approved' && isServerResolvableVisualUrl(asset.file_url) ? 'ready' : 'blocked',
        };
    }

    /**
     * List all generated image asset versions for a content item.
     */
    async listImageAssets(args: ListImageAssetsArgs) {
        const { projectId, contentItemId } = args;

        const assets = await prisma.imageAsset.findMany({
            where: { project_id: projectId, content_item_id: contentItemId },
            orderBy: { asset_version: 'desc' },
        });

        return {
            content_item_id: contentItemId,
            assets: assets.map((a) => ({
                asset_id: a.id,
                asset_version: a.asset_version,
                prompt: a.prompt,
                prompt_version: a.prompt_version,
                provider: a.provider,
                model: a.model,
                seed: a.seed,
                alt_text: a.alt_text,
                aspect_ratio: a.aspect_ratio,
                status: a.status,
                created_at: a.created_at.toISOString(),
            })),
        };
    }
}

export const imageAssetService = new ImageAssetService();
export default imageAssetService;

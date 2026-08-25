"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.imageAssetService = exports.ImageAssetService = void 0;
const db_1 = __importDefault(require("../db"));
const project_access_service_1 = require("./project_access.service");
const visual_generation_policy_1 = require("./visual_generation_policy");
class ImageAssetService {
    /**
     * Generate an image asset candidate recording prompt, seed, model, provider, altText, and version history.
     */
    async generateImageAsset(args) {
        const { projectId, contentItemId, prompt, provider = 'google', model = 'gemini-3.1-flash-lite-image', seed = 42, promptVersion = 1, altText, aspectRatio, decisionId, contentRevision, placement, fileUrl, } = args;
        await (0, project_access_service_1.requireProjectActorAccess)(projectId, args.actorId);
        const item = await db_1.default.contentItem.findFirst({
            where: { id: contentItemId, project_id: projectId },
            include: { week_package: true }
        });
        if (!item)
            throw new Error('[PUBLICATION_TASK_NOT_FOUND] Content item was not found in the project');
        const boundDecision = decisionId ? await db_1.default.artDirectionDecision.findFirst({
            where: { id: decisionId, project_id: projectId, content_item_id: contentItemId, status: 'active', decision: 'GENERATE' }
        }) : null;
        (0, visual_generation_policy_1.assertVisualGenerationGate)({
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
        if (!fileUrl?.trim())
            throw new Error('[IMAGE_FILE_REQUIRED] Generated image URL or stored file path is required');
        const latestAsset = await db_1.default.imageAsset.findFirst({
            where: { project_id: projectId, content_item_id: contentItemId },
            orderBy: { asset_version: 'desc' },
        });
        const nextVersion = latestAsset ? latestAsset.asset_version + 1 : 1;
        const asset = await db_1.default.imageAsset.create({
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
                status: 'candidate',
            },
        });
        await db_1.default.$transaction(async (tx) => {
            await tx.contentItem.update({ where: { id: contentItemId }, data: { visual_state: 'IN_REVIEW', handoff_state: 'blocked' } });
            const dedupeKey = `visual-review:${asset.id}:${asset.asset_version}`;
            await tx.workItem.upsert({ where: { dedupe_key: dedupeKey }, update: {}, create: {
                    project_id: projectId, week_package_id: item.week_package_id, content_item_id: contentItemId,
                    item_key: item.item_key || `content:${contentItemId}`, kind: 'visual_review', state: 'available',
                    assignee_role: 'visual_reviewer', input_context_version: boundDecision.source_content_revision,
                    dedupe_key: dedupeKey, result_payload: { asset_id: asset.id, decision_id: boundDecision.id }
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
    async reviewImageAsset(args) {
        const { projectId, actorId, assetId, decision, reason, qaReport } = args;
        const asset = await db_1.default.imageAsset.findFirst({
            where: { id: assetId, project_id: projectId },
            include: { content_item: true, decision: true },
        });
        if (!asset) {
            throw new Error(`ImageAsset ${assetId} not found`);
        }
        if (decision === 'approved' && (!asset.decision || asset.content_revision !== asset.content_item.accepted_revision)) {
            throw new Error('[STALE_VISUAL_ASSET] Asset is not bound to the current accepted decision and revision');
        }
        const updated = await db_1.default.$transaction(async (tx) => {
            const reviewed = await tx.imageAsset.update({ where: { id: assetId }, data: {
                    status: decision, review_reason: reason || null, qa_report: (qaReport || {}),
                    reviewed_by: actorId, reviewed_at: new Date()
                } });
            await tx.contentItem.update({ where: { id: asset.content_item_id }, data: decision === 'approved'
                    ? { status: 'ready_for_execution', selected_asset_id: asset.id, visual_state: 'APPROVED', handoff_state: 'ready' }
                    : { selected_asset_id: null, visual_state: 'REJECTED', handoff_state: 'blocked' }
            });
            return reviewed;
        });
        return {
            asset_id: updated.id,
            status: updated.status,
            decision,
            reason: reason || null,
            qa_report: qaReport || {},
        };
    }
    /**
     * List all generated image asset versions for a content item.
     */
    async listImageAssets(args) {
        const { projectId, contentItemId } = args;
        const assets = await db_1.default.imageAsset.findMany({
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
exports.ImageAssetService = ImageAssetService;
exports.imageAssetService = new ImageAssetService();
exports.default = exports.imageAssetService;

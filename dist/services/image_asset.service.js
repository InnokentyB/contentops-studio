"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.imageAssetService = exports.ImageAssetService = void 0;
const db_1 = __importDefault(require("../db"));
class ImageAssetService {
    /**
     * Generate an image asset candidate recording prompt, seed, model, provider, altText, and version history.
     */
    async generateImageAsset(args) {
        const { projectId, contentItemId, prompt, provider = 'gemini-imagen-3', model = 'imagen-3.0-generate-002', seed = 42, promptVersion = 1, altText, aspectRatio, } = args;
        const latestAsset = await db_1.default.imageAsset.findFirst({
            where: { project_id: projectId, content_item_id: contentItemId },
            orderBy: { asset_version: 'desc' },
        });
        const nextVersion = latestAsset ? latestAsset.asset_version + 1 : 1;
        const asset = await db_1.default.imageAsset.create({
            data: {
                project_id: projectId,
                content_item_id: contentItemId,
                asset_version: nextVersion,
                prompt,
                prompt_version: promptVersion,
                provider,
                model,
                seed,
                alt_text: altText || null,
                aspect_ratio: aspectRatio || null,
                status: 'candidate',
            },
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
            status: asset.status,
        };
    }
    /**
     * Review an image asset candidate (approve or reject).
     */
    async reviewImageAsset(args) {
        const { assetId, decision, reason } = args;
        const asset = await db_1.default.imageAsset.findUnique({
            where: { id: assetId },
        });
        if (!asset) {
            throw new Error(`ImageAsset ${assetId} not found`);
        }
        const updated = await db_1.default.imageAsset.update({
            where: { id: assetId },
            data: {
                status: decision,
            },
        });
        return {
            asset_id: updated.id,
            status: updated.status,
            decision,
            reason: reason || null,
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

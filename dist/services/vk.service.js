"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VKService = void 0;
exports.normalizeVkOwnerId = normalizeVkOwnerId;
exports.parseVkPostIdentity = parseVkPostIdentity;
exports.chunkVkPostIds = chunkVkPostIds;
exports.calculateVkMetricDelta = calculateVkMetricDelta;
const vk_io_1 = require("vk-io");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const VK_API_BASE_URL = 'https://api.vk.com/method';
const VK_API_VERSION = '5.199';
const emptyMetrics = () => ({
    views: null,
    likes: null,
    comments: null,
    reposts: null,
    reachTotal: null,
    reachSubscribers: null,
    reachViral: null,
    reachAds: null,
    linkClicks: null,
    groupClicks: null,
    groupJoins: null,
    hides: null,
    reports: null,
    unsubscribes: null
});
function normalizeVkOwnerId(vkId) {
    const parsed = Number.parseInt(String(vkId), 10);
    if (!Number.isSafeInteger(parsed) || parsed === 0) {
        throw new Error(`Invalid VK community ID: ${vkId}`);
    }
    return String(parsed > 0 ? -parsed : parsed);
}
function parseVkPostIdentity(publishedLink) {
    if (!publishedLink)
        return null;
    const match = publishedLink.match(/wall(-?\d+)_(\d+)/i);
    if (!match)
        return null;
    return {
        ownerId: normalizeVkOwnerId(match[1]),
        postId: match[2]
    };
}
function chunkVkPostIds(postIds, limit = 30) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 30) {
        throw new Error('VK post reach batch size must be between 1 and 30');
    }
    const normalized = postIds.map(String).filter((id) => /^\d+$/.test(id));
    const chunks = [];
    for (let index = 0; index < normalized.length; index += limit) {
        chunks.push(normalized.slice(index, index + limit));
    }
    return chunks;
}
function calculateVkMetricDelta(start, end) {
    if (start === null || start === undefined || end === null || end === undefined)
        return null;
    return end - start;
}
function classifyVkError(error) {
    const code = Number(error?.error_code);
    if (code === 6 || code === 29)
        return 'rate_limited';
    if (code === 15 || code === 7 || code === 5 || code === 27)
        return 'forbidden';
    if (code === 100 || code === 113)
        return 'not_found';
    return 'failed';
}
class VKService {
    async callApi(method, token, params) {
        const query = new URLSearchParams({
            ...params,
            access_token: token,
            v: VK_API_VERSION
        });
        const response = await fetch(`${VK_API_BASE_URL}/${method}?${query.toString()}`);
        if (!response.ok) {
            throw Object.assign(new Error(`VK API HTTP ${response.status}`), {
                vkStatus: response.status === 429 ? 'rate_limited' : 'failed',
                providerCode: String(response.status)
            });
        }
        const payload = await response.json();
        if (payload?.error) {
            throw Object.assign(new Error(payload.error.error_msg || 'VK API error'), {
                vkStatus: classifyVkError(payload.error),
                providerCode: String(payload.error.error_code || 'unknown'),
                providerPayload: payload.error
            });
        }
        return payload?.response;
    }
    /**
     * Publishes a post to a VK community wall.
     * @param vkId The community/page ID (usually starts with '-' if it's a group, e.g., '-123456')
     * @param apiKey The community access token
     * @param text The text content of the post
     * @param imageUrl Optional image URL (local path or remote URL)
     * @returns The generated VK post URL (e.g., https://vk.com/wall-123456_789)
     */
    async publishPost(vkId, apiKey, text, imageUrl) {
        const vk = new vk_io_1.VK({
            token: apiKey
        });
        // Convert string vkId to number, removing any '-' prefix if the user included it or not.
        // VK wall.post owner_id requires negative number for communities.
        const ownerId = Number(normalizeVkOwnerId(vkId));
        let attachmentString;
        if (imageUrl) {
            try {
                let photoSource;
                if (imageUrl.startsWith('data:')) {
                    const base64Data = imageUrl.split(',')[1];
                    photoSource = {
                        value: Buffer.from(base64Data, 'base64')
                    };
                }
                else if (imageUrl.startsWith('/uploads/')) {
                    const filename = imageUrl.split('/').pop();
                    const localPath = path_1.default.join(__dirname, '../../uploads', filename || '');
                    if (fs_1.default.existsSync(localPath)) {
                        photoSource = {
                            value: fs_1.default.createReadStream(localPath)
                        };
                    }
                    else {
                        throw new Error(`Local image file not found: ${localPath}`);
                    }
                }
                else if (imageUrl.startsWith('http')) {
                    // For remote URLs, vk-io upload.wallPhoto supports stream/buffer, so we fetch it first
                    const response = await fetch(imageUrl);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch remote image: ${response.statusText}`);
                    }
                    const buffer = await response.arrayBuffer();
                    photoSource = {
                        value: Buffer.from(buffer)
                    };
                }
                else {
                    throw new Error(`Unsupported image URL format: ${imageUrl}`);
                }
                if (photoSource) {
                    // Upload photo to the wall
                    const photo = await vk.upload.wallPhoto({
                        source: photoSource,
                        group_id: Math.abs(ownerId) // upload.wallPhoto requires positive group_id
                    });
                    attachmentString = photo.toString(); // format: photo{owner_id}_{photo_id}
                }
            }
            catch (err) {
                console.error(`[VKService] Failed to upload image, falling back to text only:`, err);
            }
        }
        // Post to the wall
        const postParams = {
            owner_id: ownerId,
            message: text
        };
        if (attachmentString) {
            postParams.attachments = attachmentString;
        }
        const response = await vk.api.wall.post(postParams);
        // Construct the post URL
        return `https://vk.com/wall${ownerId}_${response.post_id}`;
    }
    /**
     * Fetches metrics (likes, views, comments, reposts) for a given post.
     * @param vkId The community/page ID.
     * @param apiKey The community access token.
     * @param postId The ID of the post.
     */
    async getMetrics(vkId, apiKey, postId) {
        const result = await this.collectPostMetrics(vkId, apiKey, postId);
        if (result.wallStatus !== 'collected')
            return null;
        return {
            views: result.metrics.views,
            likes: result.metrics.likes,
            comments: result.metrics.comments,
            reposts: result.metrics.reposts,
            retrieved_at: result.retrievedAt
        };
    }
    async getPostReach(vkId, statsAccessToken, postIds) {
        if (!postIds.length)
            return [];
        if (postIds.length > 30) {
            throw new Error('stats.getPostReach accepts at most 30 post IDs');
        }
        const ownerId = normalizeVkOwnerId(vkId);
        return await this.callApi('stats.getPostReach', statsAccessToken, {
            owner_id: ownerId,
            post_ids: postIds.join(',')
        }) || [];
    }
    async collectPostMetrics(vkId, publishAccessToken, postId, statsAccessToken) {
        const ownerId = normalizeVkOwnerId(vkId);
        const metrics = emptyMetrics();
        let wallStatus = 'failed';
        let reachStatus = statsAccessToken ? 'failed' : 'unavailable';
        let providerErrorCode = null;
        let providerErrorMessage = null;
        let wallRaw = null;
        let reachRaw = null;
        let postText = null;
        let publishedAt = null;
        try {
            const wallResponse = await this.callApi('wall.getById', publishAccessToken, {
                posts: `${ownerId}_${postId}`
            });
            const post = Array.isArray(wallResponse) ? wallResponse[0] : null;
            wallRaw = post || null;
            if (!post) {
                wallStatus = 'not_found';
            }
            else {
                wallStatus = 'collected';
                metrics.views = post.views?.count ?? null;
                metrics.likes = post.likes?.count ?? null;
                metrics.comments = post.comments?.count ?? null;
                metrics.reposts = post.reposts?.count ?? null;
                postText = typeof post.text === 'string' ? post.text : null;
                publishedAt = post.date ? new Date(Number(post.date) * 1000).toISOString() : null;
            }
        }
        catch (error) {
            wallStatus = error?.vkStatus || 'failed';
            providerErrorCode = error?.providerCode || null;
            providerErrorMessage = error?.message || 'VK wall metrics failed';
        }
        if (statsAccessToken) {
            try {
                const reachResponse = await this.getPostReach(ownerId, statsAccessToken, [postId]);
                const reach = reachResponse.find((entry) => String(entry?.post_id) === String(postId)) || null;
                reachRaw = reach;
                if (!reach) {
                    reachStatus = 'not_found';
                }
                else {
                    reachStatus = 'collected';
                    metrics.reachTotal = reach.reach_total ?? reach.reach_total_count ?? null;
                    metrics.reachSubscribers = reach.reach_subscribers ?? reach.reach_subscribers_count ?? null;
                    metrics.reachViral = reach.reach_viral ?? null;
                    metrics.reachAds = reach.reach_ads ?? null;
                    metrics.linkClicks = reach.links ?? null;
                    metrics.groupClicks = reach.to_group ?? null;
                    metrics.groupJoins = reach.join_group ?? null;
                    metrics.hides = reach.hide ?? null;
                    metrics.reports = reach.report ?? null;
                    metrics.unsubscribes = reach.unsubscribe ?? null;
                }
            }
            catch (error) {
                reachStatus = error?.vkStatus || 'failed';
                providerErrorCode = error?.providerCode || providerErrorCode;
                providerErrorMessage = error?.message || providerErrorMessage || 'VK post reach failed';
            }
        }
        return {
            ownerId,
            postId: String(postId),
            wallStatus,
            reachStatus,
            providerErrorCode,
            providerErrorMessage,
            metrics,
            post: { text: postText, publishedAt },
            raw: { wall: wallRaw, reach: reachRaw },
            retrievedAt: new Date().toISOString()
        };
    }
    async collectPostsMetrics(vkId, publishAccessToken, postIds, statsAccessToken) {
        const uniquePostIds = [...new Set(postIds.map(String).filter((id) => /^\d+$/.test(id)))];
        const results = await Promise.all(uniquePostIds.map((postId) => this.collectPostMetrics(vkId, publishAccessToken, postId, null)));
        if (!statsAccessToken || results.length === 0)
            return results;
        const byPostId = new Map(results.map((result) => [result.postId, result]));
        for (const batch of chunkVkPostIds(uniquePostIds)) {
            try {
                const reachRows = await this.getPostReach(vkId, statsAccessToken, batch);
                const reachByPostId = new Map(reachRows.map((row) => [String(row?.post_id), row]));
                for (const postId of batch) {
                    const result = byPostId.get(postId);
                    if (!result)
                        continue;
                    const reach = reachByPostId.get(postId);
                    if (!reach) {
                        result.reachStatus = 'not_found';
                        continue;
                    }
                    result.reachStatus = 'collected';
                    result.raw.reach = reach;
                    result.metrics.reachTotal = reach.reach_total ?? reach.reach_total_count ?? null;
                    result.metrics.reachSubscribers = reach.reach_subscribers ?? reach.reach_subscribers_count ?? null;
                    result.metrics.reachViral = reach.reach_viral ?? null;
                    result.metrics.reachAds = reach.reach_ads ?? null;
                    result.metrics.linkClicks = reach.links ?? null;
                    result.metrics.groupClicks = reach.to_group ?? null;
                    result.metrics.groupJoins = reach.join_group ?? null;
                    result.metrics.hides = reach.hide ?? null;
                    result.metrics.reports = reach.report ?? null;
                    result.metrics.unsubscribes = reach.unsubscribe ?? null;
                }
            }
            catch (error) {
                for (const postId of batch) {
                    const result = byPostId.get(postId);
                    if (!result)
                        continue;
                    result.reachStatus = error?.vkStatus || 'failed';
                    result.providerErrorCode = error?.providerCode || null;
                    result.providerErrorMessage = error?.message || 'VK post reach failed';
                }
            }
        }
        return results;
    }
}
exports.VKService = VKService;
exports.default = new VKService();

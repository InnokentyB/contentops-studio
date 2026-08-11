import { VK } from 'vk-io';
import fs from 'fs';
import path from 'path';

export type VkCollectionStatus = 'collected' | 'unavailable' | 'forbidden' | 'not_found' | 'rate_limited' | 'failed';

export interface VkNormalizedMetrics {
    views: number | null;
    likes: number | null;
    comments: number | null;
    reposts: number | null;
    reachTotal: number | null;
    reachSubscribers: number | null;
    reachViral: number | null;
    reachAds: number | null;
    linkClicks: number | null;
    groupClicks: number | null;
    groupJoins: number | null;
    hides: number | null;
    reports: number | null;
    unsubscribes: number | null;
}

export interface VkPostMetricsResult {
    ownerId: string;
    postId: string;
    wallStatus: VkCollectionStatus;
    reachStatus: VkCollectionStatus;
    providerErrorCode: string | null;
    providerErrorMessage: string | null;
    metrics: VkNormalizedMetrics;
    post: {
        text: string | null;
        publishedAt: string | null;
    };
    raw: {
        wall: unknown;
        reach: unknown;
    };
    retrievedAt: string;
}

const VK_API_BASE_URL = 'https://api.vk.com/method';
const VK_API_VERSION = '5.199';

const emptyMetrics = (): VkNormalizedMetrics => ({
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

export function normalizeVkOwnerId(vkId: string | number): string {
    const parsed = Number.parseInt(String(vkId), 10);
    if (!Number.isSafeInteger(parsed) || parsed === 0) {
        throw new Error(`Invalid VK community ID: ${vkId}`);
    }
    return String(parsed > 0 ? -parsed : parsed);
}

export function parseVkPostIdentity(publishedLink?: string | null): { ownerId: string; postId: string } | null {
    if (!publishedLink) return null;
    const match = publishedLink.match(/wall(-?\d+)_(\d+)/i);
    if (!match) return null;
    return {
        ownerId: normalizeVkOwnerId(match[1]),
        postId: match[2]
    };
}

export function chunkVkPostIds(postIds: string[], limit = 30): string[][] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 30) {
        throw new Error('VK post reach batch size must be between 1 and 30');
    }
    const normalized = postIds.map(String).filter((id) => /^\d+$/.test(id));
    const chunks: string[][] = [];
    for (let index = 0; index < normalized.length; index += limit) {
        chunks.push(normalized.slice(index, index + limit));
    }
    return chunks;
}

export function calculateVkMetricDelta(start: number | null | undefined, end: number | null | undefined): number | null {
    if (start === null || start === undefined || end === null || end === undefined) return null;
    return end - start;
}

function classifyVkError(error: any): VkCollectionStatus {
    const code = Number(error?.error_code);
    if (code === 6 || code === 29) return 'rate_limited';
    if (code === 15 || code === 7 || code === 5 || code === 27) return 'forbidden';
    if (code === 100 || code === 113) return 'not_found';
    return 'failed';
}

export class VKService {
    private async callApi(method: string, token: string, params: Record<string, string>): Promise<any> {
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
        const payload = await response.json() as any;
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
    async publishPost(vkId: string, apiKey: string, text: string, imageUrl?: string): Promise<string> {
        const vk = new VK({
            token: apiKey
        });

        // Convert string vkId to number, removing any '-' prefix if the user included it or not.
        // VK wall.post owner_id requires negative number for communities.
        const ownerId = Number(normalizeVkOwnerId(vkId));

        let attachmentString: string | undefined;

        if (imageUrl) {
            try {
                let photoSource: any;

                if (imageUrl.startsWith('data:')) {
                    const base64Data = imageUrl.split(',')[1];
                    photoSource = {
                        value: Buffer.from(base64Data, 'base64')
                    };
                } else if (imageUrl.startsWith('/uploads/')) {
                    const filename = imageUrl.split('/').pop();
                    const localPath = path.join(__dirname, '../../uploads', filename || '');
                    if (fs.existsSync(localPath)) {
                        photoSource = {
                            value: fs.createReadStream(localPath)
                        };
                    } else {
                        throw new Error(`Local image file not found: ${localPath}`);
                    }
                } else if (imageUrl.startsWith('http')) {
                    // For remote URLs, vk-io upload.wallPhoto supports stream/buffer, so we fetch it first
                    const response = await fetch(imageUrl);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch remote image: ${response.statusText}`);
                    }
                    const buffer = await response.arrayBuffer();
                    photoSource = {
                        value: Buffer.from(buffer)
                    };
                } else {
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
            } catch (err) {
                console.error(`[VKService] Failed to upload image, falling back to text only:`, err);
            }
        }

        // Post to the wall
        const postParams: any = {
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
    async getMetrics(vkId: string, apiKey: string, postId: string): Promise<any> {
        const result = await this.collectPostMetrics(vkId, apiKey, postId);
        if (result.wallStatus !== 'collected') return null;
        return {
            views: result.metrics.views,
            likes: result.metrics.likes,
            comments: result.metrics.comments,
            reposts: result.metrics.reposts,
            retrieved_at: result.retrievedAt
        };
    }

    async getPostReach(vkId: string, statsAccessToken: string, postIds: string[]): Promise<any[]> {
        if (!postIds.length) return [];
        if (postIds.length > 30) {
            throw new Error('stats.getPostReach accepts at most 30 post IDs');
        }
        const ownerId = normalizeVkOwnerId(vkId);
        return await this.callApi('stats.getPostReach', statsAccessToken, {
            owner_id: ownerId,
            post_ids: postIds.join(',')
        }) || [];
    }

    async collectPostMetrics(
        vkId: string,
        publishAccessToken: string,
        postId: string,
        statsAccessToken?: string | null
    ): Promise<VkPostMetricsResult> {
        const ownerId = normalizeVkOwnerId(vkId);
        const metrics = emptyMetrics();
        let wallStatus: VkCollectionStatus = 'failed';
        let reachStatus: VkCollectionStatus = statsAccessToken ? 'failed' : 'unavailable';
        let providerErrorCode: string | null = null;
        let providerErrorMessage: string | null = null;
        let wallRaw: unknown = null;
        let reachRaw: unknown = null;
        let postText: string | null = null;
        let publishedAt: string | null = null;

        try {
            const wallResponse = await this.callApi('wall.getById', publishAccessToken, {
                posts: `${ownerId}_${postId}`
            });
            const post = Array.isArray(wallResponse) ? wallResponse[0] : null;
            wallRaw = post || null;
            if (!post) {
                wallStatus = 'not_found';
            } else {
                wallStatus = 'collected';
                metrics.views = post.views?.count ?? null;
                metrics.likes = post.likes?.count ?? null;
                metrics.comments = post.comments?.count ?? null;
                metrics.reposts = post.reposts?.count ?? null;
                postText = typeof post.text === 'string' ? post.text : null;
                publishedAt = post.date ? new Date(Number(post.date) * 1000).toISOString() : null;
            }
        } catch (error: any) {
            wallStatus = error?.vkStatus || 'failed';
            providerErrorCode = error?.providerCode || null;
            providerErrorMessage = error?.message || 'VK wall metrics failed';
        }

        if (statsAccessToken) {
            try {
                const reachResponse = await this.getPostReach(ownerId, statsAccessToken, [postId]);
                const reach = reachResponse.find((entry: any) => String(entry?.post_id) === String(postId)) || null;
                reachRaw = reach;
                if (!reach) {
                    reachStatus = 'not_found';
                } else {
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
            } catch (error: any) {
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

    async collectPostsMetrics(
        vkId: string,
        publishAccessToken: string,
        postIds: string[],
        statsAccessToken?: string | null
    ): Promise<VkPostMetricsResult[]> {
        const uniquePostIds = [...new Set(postIds.map(String).filter((id) => /^\d+$/.test(id)))];
        const results = await Promise.all(
            uniquePostIds.map((postId) => this.collectPostMetrics(vkId, publishAccessToken, postId, null))
        );
        if (!statsAccessToken || results.length === 0) return results;

        const byPostId = new Map(results.map((result) => [result.postId, result]));
        for (const batch of chunkVkPostIds(uniquePostIds)) {
            try {
                const reachRows = await this.getPostReach(vkId, statsAccessToken, batch);
                const reachByPostId = new Map(reachRows.map((row: any) => [String(row?.post_id), row]));
                for (const postId of batch) {
                    const result = byPostId.get(postId);
                    if (!result) continue;
                    const reach: any = reachByPostId.get(postId);
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
            } catch (error: any) {
                for (const postId of batch) {
                    const result = byPostId.get(postId);
                    if (!result) continue;
                    result.reachStatus = error?.vkStatus || 'failed';
                    result.providerErrorCode = error?.providerCode || null;
                    result.providerErrorMessage = error?.message || 'VK post reach failed';
                }
            }
        }
        return results;
    }
}

export default new VKService();

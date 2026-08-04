"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class ThreadsService {
    /**
     * Publishes a post to Meta Threads.
     * @param threadsUserId The Threads User ID.
     * @param accessToken The long-lived access token.
     * @param text The text content of the post.
     * @param imageUrl Optional image URL (remote HTTPS URL only).
     * @returns The generated Threads post URL.
     */
    async publishPost(threadsUserId, accessToken, text, imageUrl) {
        // Threads API requires public image URLs. Make sure it starts with http/https.
        let finalImageUrl = imageUrl;
        if (imageUrl && !imageUrl.startsWith('http')) {
            console.warn(`[ThreadsService] Local or relative image URLs are not supported by the Threads API. Image will be skipped: ${imageUrl}`);
            finalImageUrl = undefined;
        }
        // Step 1: Create media container
        const createUrl = `https://graph.threads.net/v1.0/${threadsUserId}/threads`;
        const payload = {
            access_token: accessToken,
            text: text
        };
        if (finalImageUrl) {
            payload.media_type = 'IMAGE';
            payload.image_url = finalImageUrl;
        }
        else {
            payload.media_type = 'TEXT';
        }
        const createRes = await fetch(createUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        if (!createRes.ok) {
            const errBody = await createRes.text();
            throw new Error(`Failed to create Threads container: ${createRes.statusText} - ${errBody}`);
        }
        const createData = (await createRes.json());
        const containerId = createData.id;
        // Step 2: Publish media container
        const publishUrl = `https://graph.threads.net/v1.0/${threadsUserId}/threads_publish`;
        const publishPayload = {
            access_token: accessToken,
            creation_id: containerId
        };
        const publishRes = await fetch(publishUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(publishPayload)
        });
        if (!publishRes.ok) {
            const errBody = await publishRes.text();
            throw new Error(`Failed to publish Threads container: ${publishRes.statusText} - ${errBody}`);
        }
        const publishData = (await publishRes.json());
        return `https://www.threads.net/post/${publishData.id}`;
    }
    /**
     * Fetches post insights (likes, replies, reposts).
     * @param postId The ID of the Threads post/media.
     * @param accessToken The access token.
     */
    async getMetrics(postId, accessToken) {
        try {
            const url = `https://graph.threads.net/v1.0/${postId}/insights?metric=likes,replies,reposts,quotes&access_token=${accessToken}`;
            const response = await fetch(url);
            if (!response.ok) {
                const errBody = await response.text();
                throw new Error(`Threads API response status ${response.status}: ${errBody}`);
            }
            const data = await response.json();
            const metrics = {
                likes: 0,
                comments: 0,
                reposts: 0,
                views: 0
            };
            if (Array.isArray(data.data)) {
                for (const item of data.data) {
                    const val = item.values?.[0]?.value || 0;
                    if (item.name === 'likes')
                        metrics.likes = val;
                    if (item.name === 'replies')
                        metrics.comments = val;
                    if (item.name === 'reposts')
                        metrics.reposts = val;
                }
            }
            metrics.retrieved_at = new Date().toISOString();
            return metrics;
        }
        catch (err) {
            console.error(`[ThreadsService] Failed to get metrics for post ${postId}:`, err);
            return null;
        }
    }
}
exports.default = new ThreadsService();

import fs from 'fs';
import path from 'path';

class ThreadsService {
    /**
     * Publishes a post to Meta Threads.
     * @param threadsUserId The Threads User ID.
     * @param accessToken The long-lived access token.
     * @param text The text content of the post.
     * @param imageUrl Optional image URL (remote HTTPS URL only).
     * @returns The generated Threads post URL.
     */
    async publishPost(threadsUserId: string, accessToken: string, text: string, imageUrl?: string): Promise<string> {
        // Threads API requires public image URLs. Make sure it starts with http/https.
        let finalImageUrl = imageUrl;
        if (imageUrl && !imageUrl.startsWith('http')) {
            console.warn(`[ThreadsService] Local or relative image URLs are not supported by the Threads API. Image will be skipped: ${imageUrl}`);
            finalImageUrl = undefined;
        }

        // Step 1: Create media container
        const createUrl = `https://graph.threads.net/v1.0/${threadsUserId}/threads`;
        const payload: any = {
            access_token: accessToken,
            text: text
        };

        if (finalImageUrl) {
            payload.media_type = 'IMAGE';
            payload.image_url = finalImageUrl;
        } else {
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

        const createData = (await createRes.json()) as { id: string };
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

        const publishData = (await publishRes.json()) as { id: string };
        
        return `https://www.threads.net/post/${publishData.id}`;
    }

    /**
     * Fetches post insights (likes, replies, reposts).
     * @param postId The ID of the Threads post/media.
     * @param accessToken The access token.
     */
    async getMetrics(postId: string, accessToken: string): Promise<any> {
        try {
            const url = `https://graph.threads.net/v1.0/${postId}/insights?metric=likes,replies,reposts,quotes&access_token=${accessToken}`;
            const response = await fetch(url);
            if (!response.ok) {
                const errBody = await response.text();
                throw new Error(`Threads API response status ${response.status}: ${errBody}`);
            }
            const data = await response.json();
            const metrics: any = {
                likes: 0,
                comments: 0,
                reposts: 0,
                views: 0
            };
            if (Array.isArray(data.data)) {
                for (const item of data.data) {
                    const val = item.values?.[0]?.value || 0;
                    if (item.name === 'likes') metrics.likes = val;
                    if (item.name === 'replies') metrics.comments = val;
                    if (item.name === 'reposts') metrics.reposts = val;
                }
            }
            metrics.retrieved_at = new Date().toISOString();
            return metrics;
        } catch (err: any) {
            console.error(`[ThreadsService] Failed to get metrics for post ${postId}:`, err);
            return null;
        }
    }

    /**
     * Tests connection to Meta Threads API with the provided or stored credentials.
     * @param config The channel configuration containing access_token and optional threads_user_id.
     * @returns ThreadsTestConnectionResult with user profile or error description.
     */
    async testConnection(config: { access_token?: string; threads_user_id?: string; user_id?: string }): Promise<ThreadsTestConnectionResult> {
        const token = config.access_token?.trim();
        const expectedUserId = (config.threads_user_id || config.user_id)?.trim();

        if (!token) {
            return { success: false, error: 'Access token is required' };
        }

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);

            const res = await fetch(`https://graph.threads.net/v1.0/me?fields=id,username,name,threads_profile_picture_url&access_token=${encodeURIComponent(token)}`, {
                signal: controller.signal
            });
            clearTimeout(timeout);

            if (!res.ok) {
                const errBody = await res.text();
                return {
                    success: false,
                    error: `Meta Threads API returned status ${res.status}: ${errBody}`
                };
            }

            const data = (await res.json()) as { id: string; username?: string; name?: string; threads_profile_picture_url?: string };

            if (!data.id) {
                return {
                    success: false,
                    error: 'Meta Threads API did not return a valid user profile'
                };
            }

            if (expectedUserId && expectedUserId !== data.id) {
                return {
                    success: false,
                    error: `Threads User ID mismatch: configured "${expectedUserId}", but token belongs to "${data.id}" (@${data.username || 'unknown'})`
                };
            }

            return {
                success: true,
                details: {
                    id: data.id,
                    username: data.username,
                    name: data.name,
                    threads_profile_picture_url: data.threads_profile_picture_url
                }
            };
        } catch (err: unknown) {
            const error = err as Error;
            return {
                success: false,
                error: error.name === 'AbortError' ? 'Connection timed out after 10s' : error.message
            };
        }
    }
}

export interface ThreadsTestConnectionResult {
    success: boolean;
    details?: {
        id: string;
        username?: string;
        name?: string;
        threads_profile_picture_url?: string;
    };
    error?: string;
}

export { ThreadsService };
export default new ThreadsService();

import fs from 'fs';
import path from 'path';

interface VCConfig {
    access_token?: string; // X-Device-Token
    subsite_id?: string;
    webhook_url?: string;
}

interface VCOsnovaResponse {
    result?: {
        id?: number;
        url?: string;
    };
    error?: {
        message?: string;
    };
}

class VCService {
    /**
     * Publishes a post/article to VC.ru via the Osnova API or custom webhook.
     * @param config The VC.ru configuration options (access token, subsite ID, webhook URL)
     * @param text The post content/body text
     * @param imageUrl Optional URL of the image to associate
     * @param title Optional title of the post (defaults to 'Без названия')
     * @returns A promise resolving to the published post URL (or mock URL if direct credentials are not provided)
     * @throws Error if the direct Osnova API request fails when credentials (access token and subsite ID) are provided
     */
    async publishPost(
        config: VCConfig,
        text: string,
        imageUrl?: string,
        title?: string
    ): Promise<string> {
        const postTitle = title || 'Без названия';
        const timestamp = Date.now();
        const mockUrl = `https://vc.ru/mock-${timestamp}`;

        const publicationPayload = {
            title: postTitle,
            text,
            imageUrl: imageUrl || null,
            subsite_id: config.subsite_id || 'personal',
            published_at: new Date().toISOString(),
            mock_url: mockUrl
        };

        // 1. Log locally
        try {
            const logsDir = path.join(process.cwd(), 'logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            const logPath = path.join(logsDir, 'vc_publications.log');
            fs.appendFileSync(logPath, `${JSON.stringify(publicationPayload)}\n---\n`);
        } catch (logErr: unknown) {
            console.error('[VCService] Failed to log publication locally:', logErr);
        }

        // 2. Webhook forwarding
        if (config.webhook_url) {
            try {
                const response = await fetch(config.webhook_url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(publicationPayload)
                });
                if (!response.ok) {
                    console.warn(`[VCService] Webhook returned status ${response.status}: ${await response.text()}`);
                }
            } catch (webhookErr: unknown) {
                console.error('[VCService] Webhook delivery failed:', webhookErr);
            }
        }

        // 3. Attempt direct API request if credentials exist
        if (config.access_token && config.subsite_id) {
            try {
                const response = await fetch('https://api.vc.ru/v1.9/entry/create', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'X-Device-Token': config.access_token,
                        'User-Agent': 'ba-post-planner-app/1.0.0 (Desktop; macOS/15.0; ru; 1920x1080)'
                    },
                    body: new URLSearchParams({
                        title: postTitle,
                        text: text,
                        subsite_id: config.subsite_id
                    }).toString()
                });

                if (response.ok) {
                    const data = (await response.json()) as VCOsnovaResponse;
                    if (data.result?.url) {
                        return data.result.url;
                    }
                    if (data.error?.message) {
                        throw new Error(`Osnova API returned error: ${data.error.message}`);
                    }
                    throw new Error('Osnova API response format is invalid (no result URL)');
                } else {
                    const errText = await response.text();
                    throw new Error(`Osnova API request failed with status ${response.status}: ${errText}`);
                }
            } catch (apiErr: unknown) {
                console.error('[VCService] Failed direct Osnova API post:', apiErr);
                throw apiErr;
            }
        }

        return mockUrl;
    }
}

export default new VCService();

import fs from 'fs';
import path from 'path';

interface HabrConfig {
    api_token?: string;
    webhook_url?: string;
    hub_ids?: string[];
    cookies?: string;
}

class HabrService {
    /**
     * Publishes a post/article to Habr.
     * Since the public write API is closed, this service writes to a local log file,
     * calls Puppeteer if cookies are provided, or forwards to webhook.
     */
    async publishPost(
        config: HabrConfig,
        text: string,
        imageUrl?: string,
        title?: string
    ): Promise<string> {
        const postTitle = title || 'Без названия';
        const timestamp = Date.now();
        const mockUrl = `https://habr.com/ru/post/mock-${timestamp}/`;

        // 0. Use Puppeteer automation if cookies are configured
        if (config.cookies) {
            try {
                const puppeteerPublisherService = require('./puppeteer_publisher.service').default;
                return await puppeteerPublisherService.publishToHabr(
                    { cookies: config.cookies, hub_ids: config.hub_ids },
                    postTitle,
                    text,
                    imageUrl
                );
            } catch (err: any) {
                console.error('[HabrService] Puppeteer publication failed:', err);
                throw err;
            }
        }

        const publicationPayload = {
            title: postTitle,
            body: text,
            imageUrl: imageUrl || null,
            hub_ids: config.hub_ids || [],
            published_at: new Date().toISOString(),
            mock_url: mockUrl
        };

        // 1. Log locally
        try {
            const logsDir = path.join(process.cwd(), 'logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            const logPath = path.join(logsDir, 'habr_publications.log');
            fs.appendFileSync(logPath, `${JSON.stringify(publicationPayload)}\n---\n`);
        } catch (logErr: unknown) {
            console.error('[HabrService] Failed to log publication locally:', logErr);
        }

        // 2. Optional webhook forwarding
        if (config.webhook_url) {
            try {
                const response = await fetch(config.webhook_url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(config.api_token ? { Authorization: `Bearer ${config.api_token}` } : {})
                    },
                    body: JSON.stringify(publicationPayload)
                });
                if (!response.ok) {
                    console.warn(`[HabrService] Webhook call returned status ${response.status}: ${await response.text()}`);
                }
            } catch (webhookErr: unknown) {
                console.error('[HabrService] Failed to forward publication payload to webhook:', webhookErr);
            }
        }

        return mockUrl;
    }
}

export default new HabrService();

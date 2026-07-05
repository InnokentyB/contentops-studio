import fs from 'fs';
import path from 'path';

interface DzenConfig {
    channel_id?: string;
    webhook_url?: string;
    cookies?: string;
}

class DzenService {
    /**
     * Publishes a post/article to Dzen.
     * Since Dzen doesn't provide a direct public API, it logs locally, calls Puppeteer if cookies are provided, or sends to webhooks.
     */
    async publishPost(
        config: DzenConfig,
        text: string,
        imageUrl?: string,
        title?: string
    ): Promise<string> {
        const postTitle = title || 'Без названия';
        const timestamp = Date.now();
        const mockUrl = `https://dzen.ru/media/mock-${timestamp}`;

        // 0. Use Puppeteer automation if cookies are configured
        if (config.cookies) {
            try {
                const puppeteerPublisherService = require('./puppeteer_publisher.service').default;
                return await puppeteerPublisherService.publishToDzen(
                    { cookies: config.cookies, channel_id: config.channel_id },
                    postTitle,
                    text,
                    imageUrl
                );
            } catch (err: any) {
                console.error('[DzenService] Puppeteer publication failed:', err);
                throw err;
            }
        }

        const publicationPayload = {
            title: postTitle,
            text,
            imageUrl: imageUrl || null,
            channel_id: config.channel_id || null,
            published_at: new Date().toISOString(),
            mock_url: mockUrl
        };

        // 1. Log locally
        try {
            const logsDir = path.join(process.cwd(), 'logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            const logPath = path.join(logsDir, 'dzen_publications.log');
            fs.appendFileSync(logPath, `${JSON.stringify(publicationPayload)}\n---\n`);
        } catch (logErr: unknown) {
            console.error('[DzenService] Failed to log publication locally:', logErr);
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
                    console.warn(`[DzenService] Webhook returned status ${response.status}: ${await response.text()}`);
                }
            } catch (webhookErr: unknown) {
                console.error('[DzenService] Webhook delivery failed:', webhookErr);
            }
        }

        return mockUrl;
    }
}

export default new DzenService();

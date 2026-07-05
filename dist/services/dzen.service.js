"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class DzenService {
    /**
     * Publishes a post/article to Dzen.
     * Since Dzen doesn't provide a direct public API, it logs locally, calls Puppeteer if cookies are provided, or sends to webhooks.
     */
    async publishPost(config, text, imageUrl, title) {
        const postTitle = title || 'Без названия';
        const timestamp = Date.now();
        const mockUrl = `https://dzen.ru/media/mock-${timestamp}`;
        // 0. Use Puppeteer automation if cookies are configured
        if (config.cookies) {
            try {
                const puppeteerPublisherService = require('./puppeteer_publisher.service').default;
                return await puppeteerPublisherService.publishToDzen({ cookies: config.cookies, channel_id: config.channel_id }, postTitle, text, imageUrl);
            }
            catch (err) {
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
            const logsDir = path_1.default.join(process.cwd(), 'logs');
            if (!fs_1.default.existsSync(logsDir)) {
                fs_1.default.mkdirSync(logsDir, { recursive: true });
            }
            const logPath = path_1.default.join(logsDir, 'dzen_publications.log');
            fs_1.default.appendFileSync(logPath, `${JSON.stringify(publicationPayload)}\n---\n`);
        }
        catch (logErr) {
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
            }
            catch (webhookErr) {
                console.error('[DzenService] Webhook delivery failed:', webhookErr);
            }
        }
        return mockUrl;
    }
}
exports.default = new DzenService();

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class HabrService {
    /**
     * Publishes a post/article to Habr.
     * Since the public write API is closed, this service writes to a local log file,
     * calls Puppeteer if cookies are provided, or forwards to webhook.
     */
    async publishPost(config, text, imageUrl, title) {
        const postTitle = title || 'Без названия';
        const timestamp = Date.now();
        const mockUrl = `https://habr.com/ru/post/mock-${timestamp}/`;
        // 0. Use Puppeteer automation if cookies are configured
        if (config.cookies) {
            try {
                const puppeteerPublisherService = require('./puppeteer_publisher.service').default;
                return await puppeteerPublisherService.publishToHabr({ cookies: config.cookies, hub_ids: config.hub_ids }, postTitle, text, imageUrl);
            }
            catch (err) {
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
            const logsDir = path_1.default.join(process.cwd(), 'logs');
            if (!fs_1.default.existsSync(logsDir)) {
                fs_1.default.mkdirSync(logsDir, { recursive: true });
            }
            const logPath = path_1.default.join(logsDir, 'habr_publications.log');
            fs_1.default.appendFileSync(logPath, `${JSON.stringify(publicationPayload)}\n---\n`);
        }
        catch (logErr) {
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
            }
            catch (webhookErr) {
                console.error('[HabrService] Failed to forward publication payload to webhook:', webhookErr);
            }
        }
        return mockUrl;
    }
}
exports.default = new HabrService();

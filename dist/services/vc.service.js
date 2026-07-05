"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class VCService {
    /**
     * Publishes a post/article to VC.ru via the Osnova API or custom webhook.
     */
    async publishPost(config, text, imageUrl, title) {
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
            const logsDir = path_1.default.join(process.cwd(), 'logs');
            if (!fs_1.default.existsSync(logsDir)) {
                fs_1.default.mkdirSync(logsDir, { recursive: true });
            }
            const logPath = path_1.default.join(logsDir, 'vc_publications.log');
            fs_1.default.appendFileSync(logPath, `${JSON.stringify(publicationPayload)}\n---\n`);
        }
        catch (logErr) {
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
            }
            catch (webhookErr) {
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
                        'X-Device-Token': config.access_token
                    },
                    body: new URLSearchParams({
                        title: postTitle,
                        text: text,
                        subsite_id: config.subsite_id
                    }).toString()
                });
                if (response.ok) {
                    const data = (await response.json());
                    if (data.result?.url) {
                        return data.result.url;
                    }
                    if (data.error?.message) {
                        console.warn(`[VCService] Osnova API returned error: ${data.error.message}`);
                    }
                }
                else {
                    console.warn(`[VCService] Osnova API request failed: ${await response.text()}`);
                }
            }
            catch (apiErr) {
                console.error('[VCService] Failed direct Osnova API post:', apiErr);
            }
        }
        return mockUrl;
    }
}
exports.default = new VCService();

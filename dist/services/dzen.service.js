"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDzenPublishedUrl = isDzenPublishedUrl;
const puppeteer_publisher_service_1 = __importDefault(require("./puppeteer_publisher.service"));
function isDzenPublishedUrl(value) {
    try {
        const url = new URL(value);
        if (!['dzen.ru', 'www.dzen.ru'].includes(url.hostname))
            return false;
        if (url.pathname.startsWith('/studio') || url.pathname.includes('/editor/'))
            return false;
        if (/\bmock[-_/]/i.test(url.pathname))
            return false;
        return /\/(?:a|b)\//.test(url.pathname) || /\/media\/id\//.test(url.pathname);
    }
    catch {
        return false;
    }
}
class DzenService {
    async publishPost(config, text, imageUrl, title, publicationType = 'article') {
        if (!config.cookies?.trim()) {
            throw new Error('An authenticated Dzen session is required for browser publication');
        }
        if (!text?.trim()) {
            throw new Error('Dzen publication text is required');
        }
        if (publicationType === 'article' && !title?.trim()) {
            throw new Error('Dzen article title is required');
        }
        const authenticatedConfig = { ...config, cookies: config.cookies.trim() };
        const publishedUrl = await puppeteer_publisher_service_1.default.publishToDzen(authenticatedConfig, title?.trim() || '', text.trim(), imageUrl, publicationType);
        if (!isDzenPublishedUrl(publishedUrl)) {
            throw new Error(`Dzen did not return a verifiable public URL: ${publishedUrl || 'empty response'}`);
        }
        return publishedUrl;
    }
    async testConnection(config) {
        if (!config.cookies?.trim()) {
            throw new Error('An authenticated Dzen session is required');
        }
        return puppeteer_publisher_service_1.default.testDzenConnection({ ...config, cookies: config.cookies.trim() });
    }
}
exports.default = new DzenService();

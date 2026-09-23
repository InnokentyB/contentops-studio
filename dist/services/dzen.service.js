"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDzenCompactNumber = parseDzenCompactNumber;
exports.scoreDzenSearchResult = scoreDzenSearchResult;
exports.isDzenPublishedUrl = isDzenPublishedUrl;
const puppeteer_publisher_service_1 = __importDefault(require("./puppeteer_publisher.service"));
function parseDzenCompactNumber(value) {
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string')
        return null;
    const normalized = value.toLowerCase().replace(/\u00a0/g, ' ').trim();
    const match = normalized.match(/(\d[\d\s]*(?:[.,]\d+)?)\s*(тыс\.?|млн|[kкmм])?/i);
    if (!match)
        return null;
    const raw = match[1].replace(/\s/g, '').replace(',', '.');
    const number = Number(raw);
    if (!Number.isFinite(number))
        return null;
    const suffix = (match[2] || '').toLowerCase();
    const multiplier = /тыс|[kк]/.test(suffix) ? 1000 : /млн|[mм]/.test(suffix) ? 1000000 : 1;
    return Math.round(number * multiplier);
}
function scoreDzenSearchResult(query, title, snippet) {
    const terms = Array.from(new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []));
    if (terms.length === 0)
        return { score: 0, matched_terms: [] };
    const titleText = title.toLowerCase();
    const fullText = `${title} ${snippet}`.toLowerCase();
    const matched = terms.filter((term) => fullText.includes(term));
    const titleMatches = terms.filter((term) => titleText.includes(term)).length;
    const score = Math.min(100, Math.round((matched.length / terms.length) * 75 + (titleMatches / terms.length) * 25));
    return { score, matched_terms: matched };
}
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
    async collectPostMetrics(config, postUrl) {
        const raw = await puppeteer_publisher_service_1.default.collectDzenPostMetrics(config, postUrl);
        return {
            url: postUrl,
            captured_at: new Date().toISOString(),
            views: parseDzenCompactNumber(raw.views),
            likes: parseDzenCompactNumber(raw.likes),
            comments: parseDzenCompactNumber(raw.comments),
            impressions: parseDzenCompactNumber(raw.impressions),
            pageViews: parseDzenCompactNumber(raw.pageViews),
            clicks: parseDzenCompactNumber(raw.clicks),
            deepViews: parseDzenCompactNumber(raw.deepViews),
            shares: parseDzenCompactNumber(raw.shares),
            subscriptions: parseDzenCompactNumber(raw.subscriptions),
            sumViewTimeSec: parseDzenCompactNumber(raw.sumViewTimeSec),
            ctr: parseDzenCompactNumber(raw.ctr)
        };
    }
    async searchRelevantPosts(config, query, limit = 10, minScore = 25) {
        const results = await puppeteer_publisher_service_1.default.searchDzenPosts(config, query, Math.min(Math.max(limit * 3, 10), 50));
        return results
            .map((result) => ({ ...result, ...scoreDzenSearchResult(query, result.title, result.snippet) }))
            .filter((result) => result.score >= minScore)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }
    async comment(config, postUrl, text) {
        return puppeteer_publisher_service_1.default.commentOnDzenPost(config, postUrl, text);
    }
    async preflightComment(config, postUrl) {
        return puppeteer_publisher_service_1.default.preflightDzenComment(config, postUrl);
    }
}
exports.default = new DzenService();

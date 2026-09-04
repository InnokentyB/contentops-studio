import puppeteerPublisherService from './puppeteer_publisher.service';

export type DzenPublicationType = 'article' | 'post';

export interface DzenConfig {
    channel_id?: string;
    channel_url?: string;
    cookies?: string;
    article_editor_url?: string;
    post_editor_url?: string;
}

export function parseDzenCompactNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const normalized = value.toLowerCase().replace(/\u00a0/g, ' ').trim();
    const match = normalized.match(/(\d[\d\s]*(?:[.,]\d+)?)\s*(тыс\.?|млн|[kкmм])?/i);
    if (!match) return null;
    const raw = match[1].replace(/\s/g, '').replace(',', '.');
    const number = Number(raw);
    if (!Number.isFinite(number)) return null;
    const suffix = (match[2] || '').toLowerCase();
    const multiplier = /тыс|[kк]/.test(suffix) ? 1_000 : /млн|[mм]/.test(suffix) ? 1_000_000 : 1;
    return Math.round(number * multiplier);
}

export function scoreDzenSearchResult(query: string, title: string, snippet: string) {
    const terms = Array.from(new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []));
    if (terms.length === 0) return { score: 0, matched_terms: [] as string[] };
    const titleText = title.toLowerCase();
    const fullText = `${title} ${snippet}`.toLowerCase();
    const matched = terms.filter((term) => fullText.includes(term));
    const titleMatches = terms.filter((term) => titleText.includes(term)).length;
    const score = Math.min(100, Math.round((matched.length / terms.length) * 75 + (titleMatches / terms.length) * 25));
    return { score, matched_terms: matched };
}

export function isDzenPublishedUrl(value: string): boolean {
    try {
        const url = new URL(value);
        if (!['dzen.ru', 'www.dzen.ru'].includes(url.hostname)) return false;
        if (url.pathname.startsWith('/studio') || url.pathname.includes('/editor/')) return false;
        if (/\bmock[-_/]/i.test(url.pathname)) return false;
        return /\/(?:a|b)\//.test(url.pathname) || /\/media\/id\//.test(url.pathname);
    } catch {
        return false;
    }
}

class DzenService {
    async publishPost(
        config: DzenConfig,
        text: string,
        imageUrl?: string,
        title?: string,
        publicationType: DzenPublicationType = 'article'
    ): Promise<string> {
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
        const publishedUrl = await puppeteerPublisherService.publishToDzen(
            authenticatedConfig,
            title?.trim() || '',
            text.trim(),
            imageUrl,
            publicationType
        );
        if (!isDzenPublishedUrl(publishedUrl)) {
            throw new Error(`Dzen did not return a verifiable public URL: ${publishedUrl || 'empty response'}`);
        }
        return publishedUrl;
    }

    async testConnection(config: DzenConfig) {
        if (!config.cookies?.trim()) {
            throw new Error('An authenticated Dzen session is required');
        }
        return puppeteerPublisherService.testDzenConnection({ ...config, cookies: config.cookies.trim() });
    }

    async collectPostMetrics(config: DzenConfig, postUrl: string) {
        const raw = await puppeteerPublisherService.collectDzenPostMetrics(config, postUrl);
        return {
            url: postUrl,
            captured_at: new Date().toISOString(),
            views: parseDzenCompactNumber(raw.views),
            likes: parseDzenCompactNumber(raw.likes),
            comments: parseDzenCompactNumber(raw.comments)
        };
    }

    async searchRelevantPosts(config: DzenConfig, query: string, limit = 10, minScore = 25) {
        const results = await puppeteerPublisherService.searchDzenPosts(config, query, Math.min(Math.max(limit * 3, 10), 50));
        return results
            .map((result) => ({ ...result, ...scoreDzenSearchResult(query, result.title, result.snippet) }))
            .filter((result) => result.score >= minScore)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    async comment(config: DzenConfig, postUrl: string, text: string) {
        return puppeteerPublisherService.commentOnDzenPost(config, postUrl, text);
    }
}

export default new DzenService();

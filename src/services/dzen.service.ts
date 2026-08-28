import puppeteerPublisherService from './puppeteer_publisher.service';

export type DzenPublicationType = 'article' | 'post';

export interface DzenConfig {
    channel_id?: string;
    cookies?: string;
    article_editor_url?: string;
    post_editor_url?: string;
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
}

export default new DzenService();

import type { Page } from 'puppeteer';
import { canonicalPublicDzenUrl } from './dzen_publication_outcome';

export interface DzenPageMetrics {
    views: number | null;
    likes: number | null;
    comments: number | null;
    impressions?: number | null;
    pageViews?: number | null;
    clicks?: number | null;
    deepViews?: number | null;
    shares?: number | null;
    subscriptions?: number | null;
    sumViewTimeSec?: number | null;
    ctr?: number | null;
}

export interface DzenSearchResult {
    url: string;
    title: string;
    snippet: string;
}

export interface DzenStudioPublication {
    provider_object_id: string | null;
    title: string | null;
    public_url: string | null;
    published_at: string | null;
    state: 'published' | 'draft' | 'unknown';
}

export interface DzenStudioPublicationPayload {
    publications: DzenStudioPublication[];
    title_readback_complete: boolean;
    publication_timestamp_readback_complete: boolean;
    state_readback_complete: boolean;
    coverage_complete: boolean;
}

export type DzenImageUploadOutcome =
    | { kind: 'uploaded' }
    | { kind: 'rejected'; message: string }
    | { kind: 'uncertain'; reason: string };

export interface DzenCommentControlDescriptor {
    tag: string;
    type?: string;
    role?: string;
    text?: string;
    placeholder?: string;
    ariaLabel?: string;
    dataTestId?: string;
    contentEditable?: string;
    context?: string;
    disabled?: boolean;
}

export const COMMENT_WORDS = /коммент|comment|ответ|reply|обсуждени/i;
export const SEND_WORDS = /^(?:отправить|опубликовать|комментировать|ответить|send|publish|reply)$/i;
export const EXCLUDED_EDITOR_WORDS = /поиск|search|заголов|title|описани|description/i;

export function scoreDzenCommentComposer(candidate: DzenCommentControlDescriptor): number {
    const editable = candidate.tag === 'textarea'
        || (candidate.tag === 'input' && (!candidate.type || ['text', 'search'].includes(candidate.type)))
        || candidate.role === 'textbox'
        || candidate.contentEditable === 'true';
    if (!editable || candidate.disabled) return -100;
    const ownText = [candidate.placeholder, candidate.ariaLabel, candidate.dataTestId].filter(Boolean).join(' ');
    const allText = `${ownText} ${candidate.context || ''}`;
    if (EXCLUDED_EDITOR_WORDS.test(ownText) && !COMMENT_WORDS.test(allText)) return -50;
    let score = candidate.tag === 'textarea' ? 4 : candidate.contentEditable === 'true' ? 3 : 1;
    if (candidate.role === 'textbox') score += 2;
    if (COMMENT_WORDS.test(ownText)) score += 12;
    else if (COMMENT_WORDS.test(candidate.context || '')) score += 7;
    if (candidate.dataTestId && /comment|reply/i.test(candidate.dataTestId)) score += 8;
    return score;
}

export function scoreDzenCommentSubmit(candidate: DzenCommentControlDescriptor): number {
    if (candidate.disabled || !['button', 'div', 'span'].includes(candidate.tag)) return -100;
    const ownText = [candidate.text, candidate.ariaLabel, candidate.dataTestId].filter(Boolean).join(' ').trim();
    let score = SEND_WORDS.test(ownText) ? 12 : 0;
    if (candidate.role === 'button' || candidate.tag === 'button') score += 3;
    if (/comment|reply/i.test(candidate.dataTestId || '')) score += 6;
    if (COMMENT_WORDS.test(candidate.context || '')) score += 4;
    return score;
}

export async function navigateDzenInteractionPage(page: Page, url: string, timeout = 30_000) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForFunction(
        () => Boolean(document.body) && document.readyState !== 'loading',
        { timeout: Math.min(timeout, 5_000) }
    );
}

export function extractDzenStudioMetrics(payload: any, postUrl: string): DzenPageMetrics | null {
    let pathname: string;
    try {
        pathname = new URL(postUrl).pathname.replace(/\/$/, '');
    } catch {
        return null;
    }
    const publication = (payload?.publications || []).find((entry: any) =>
        typeof entry?.commonUrl === 'string' && entry.commonUrl.replace(/\/$/, '') === pathname
    );
    if (!publication?.id) return null;
    const counters = (payload?.publicationCounters || []).find((entry: any) => entry?.publicationId === publication.id) || {};
    const social = (payload?.socialCounters || []).find((entry: any) => entry?.publicationId === publication.id) || {};
    const numberOrNull = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
    return {
        views: numberOrNull(counters.views),
        likes: numberOrNull(social.likeCount),
        comments: numberOrNull(social.commentCount),
        impressions: numberOrNull(counters.impressions),
        pageViews: numberOrNull(counters.pageViews),
        clicks: numberOrNull(counters.clicks),
        deepViews: numberOrNull(counters.deepViews),
        shares: numberOrNull(counters.shares),
        subscriptions: numberOrNull(counters.subscriptions),
        sumViewTimeSec: numberOrNull(counters.sumViewTimeSec),
        ctr: numberOrNull(counters.ctr)
    };
}

function recordValue(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

/** Parse the authenticated Studio list without treating missing title fields as proof of absence. */
export function extractDzenStudioPublications(payload: unknown): DzenStudioPublicationPayload | null {
    const root = recordValue(payload);
    if (!root || !Array.isArray(root.publications)) return null;
    const pagination = recordValue(root.pagination) || {};
    const publications = root.publications.map((entry): DzenStudioPublication => {
        const raw = recordValue(entry) || {};
        const content = recordValue(raw.content) || {};
        const preview = recordValue(content.preview) || {};
        const meta = recordValue(raw.meta) || {};
        const titleCandidates = [raw.title, raw.publicationTitle, content.title, preview.title, meta.title];
        const title = titleCandidates.find((candidate): candidate is string =>
            typeof candidate === 'string' && candidate.trim().length > 0
        ) ?? null;
        const urlCandidate = [raw.commonUrl, raw.publicUrl, raw.url]
            .find((candidate): candidate is string => typeof candidate === 'string') || '';
        const providerId = typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id) : null;
        const publishTime = raw.isPublished === true && raw.status === 'published'
            && typeof raw.publishTime === 'number' && Number.isSafeInteger(raw.publishTime)
            ? raw.publishTime
            : null;
        const publishedAt = publishTime !== null && publishTime >= Date.UTC(2000, 0, 1)
            && publishTime < Date.UTC(2100, 0, 1)
            ? new Date(publishTime).toISOString()
            : null;
        const rawStatus = typeof raw.status === 'string' ? raw.status.toLowerCase() : '';
        const state: DzenStudioPublication['state'] = raw.isPublished === true && rawStatus === 'published'
            ? 'published'
            : raw.isPublished === false && ['draft', 'unpublished'].includes(rawStatus)
                ? 'draft'
                : 'unknown';
        return {
            provider_object_id: providerId,
            title,
            public_url: canonicalPublicDzenUrl(urlCandidate),
            published_at: publishedAt,
            state
        };
    });
    const hasMore = [root.hasMore, root.has_more, pagination.hasMore, pagination.has_more]
        .find((value): value is boolean => typeof value === 'boolean');
    const total = [root.total, root.totalCount, root.total_count, pagination.total, pagination.totalCount]
        .find((value): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
    const coverageComplete = hasMore === false || (typeof total === 'number' && total === publications.length);
    return {
        publications,
        title_readback_complete: publications.every((publication) => publication.title !== null),
        publication_timestamp_readback_complete: publications.every((publication) => publication.published_at !== null),
        state_readback_complete: publications.every((publication) => publication.state !== 'unknown'),
        coverage_complete: coverageComplete
    };
}

/** Require both a successful provider response and a rendered editor image before publication. */
export function classifyDzenImageUploadOutcome(observation: {
    responseStatus: number | null;
    insertedImage: boolean;
    pageText: string;
}): DzenImageUploadOutcome {
    const error = observation.pageText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => /не удалось загрузить изображение|загружено с ошибкой|image upload failed|failed to upload image/i.test(line));
    if (error) return { kind: 'rejected', message: error };
    if (observation.responseStatus !== null
        && (observation.responseStatus < 200 || observation.responseStatus >= 300)) {
        return { kind: 'rejected', message: `Dzen image upload returned HTTP ${observation.responseStatus}` };
    }
    if (observation.responseStatus === null) {
        return { kind: 'uncertain', reason: 'Dzen image upload did not return a provider response.' };
    }
    if (!observation.insertedImage) {
        return { kind: 'uncertain', reason: 'Dzen accepted the upload request but did not render the image in the article.' };
    }
    return { kind: 'uploaded' };
}

export type DzenPublicationType = 'article' | 'post';

export const DZEN_EDITOR_SELECTORS = {
    addPublication: '[data-testid="add-publication-button"]',
    articleMenuItem: '[role="button"][aria-label="Написать статью"]',
    postMenuItem: '[role="button"][aria-label="Написать пост"]',
    articleTitle: '[contenteditable="true"][role="textbox"]:has(h1[data-block="true"])',
    articleBody: '[contenteditable="true"][role="textbox"]:has(.zen-editor-block)',
    imageInsertIconFragment: 'add_gallery',
    helpClose: '[class*="help-popup"] [aria-label="Закрыть"]',
    articlePublish: '[data-testid="article-publish-btn"]',
    publicationConfirm: '[data-testid="publish-btn"]'
} as const;

export type BrowserCookie = {
    name: string;
    value: string;
    domain?: string;
    url?: string;
    path: string;
    secure: boolean;
};

export function parseBrowserCookieHeader(cookieStr: string, domain: string): BrowserCookie[] {
    const normalized = cookieStr.trim().replace(/^cookie\s*:\s*/i, '');
    const cookieNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
    const cookieAttributeNames = new Set(['domain', 'expires', 'httponly', 'max-age', 'path', 'samesite', 'secure']);
    const cookies: BrowserCookie[] = [];

    if (normalized.startsWith('[')) {
        let exported: unknown;
        try {
            exported = JSON.parse(normalized);
        } catch {
            throw new Error('Invalid cookie JSON export. Copy it again from the browser cookie exporter.');
        }
        if (!Array.isArray(exported)) throw new Error('Cookie JSON export must be an array.');
        if (domain !== 'dzen.ru') return [];
        const allowedDomains = new Set(['dzen.ru', '.dzen.ru', 'yandex.ru', '.yandex.ru']);
        for (const candidate of exported) {
            if (!candidate || typeof candidate !== 'object') continue;
            const raw = candidate as Record<string, unknown>;
            const name = typeof raw.name === 'string' ? raw.name.trim() : '';
            const value = typeof raw.value === 'string' ? raw.value : '';
            const cookieDomain = typeof raw.domain === 'string' ? raw.domain.trim().toLowerCase() : '';
            if (!cookieNamePattern.test(name)) throw new Error(`Invalid cookie name "${name}" in JSON export.`);
            if (!allowedDomains.has(cookieDomain)) continue;
            if (/[\u0000-\u001F\u007F]/.test(value)) throw new Error(`Invalid value for cookie "${name}" in JSON export.`);
            if (name.startsWith('__Host-')) {
                cookies.push({ name, value, url: `https://${cookieDomain.replace(/^\./, '')}/`, path: '/', secure: true });
            } else {
                cookies.push({ name, value, domain: cookieDomain, path: '/', secure: true });
            }
        }
        return cookies;
    }

    for (const item of normalized.split(';').map((part) => part.trim()).filter(Boolean)) {
        const index = item.indexOf('=');
        if (index === -1) continue;
        const name = item.substring(0, index).trim();
        const value = item.substring(index + 1).trim();
        if (cookieAttributeNames.has(name.toLowerCase())) continue;
        if (!cookieNamePattern.test(name)) {
            throw new Error(`Invalid cookie name "${name}". Copy only the Cookie request-header value from DevTools.`);
        }
        if (/[\u0000-\u001F\u007F]/.test(value)) {
            throw new Error(`Invalid value for cookie "${name}". Copy the Cookie request-header value again.`);
        }
        if (name.startsWith('__Host-')) {
            cookies.push({ name, value, url: `https://${domain.replace(/^\./, '')}/`, path: '/', secure: true });
        } else {
            cookies.push({ name, value, domain, path: '/', secure: true });
        }
    }

    return cookies;
}

export async function typeDzenContentEditableText(element: any, text: string): Promise<void> {
    await element.focus();
    await element.type(text, { delay: 1 });
}

export type DzenStudioLocation = 'studio' | 'public_channel' | 'authentication' | 'unexpected';

export function classifyDzenStudioLocation(value: string): DzenStudioLocation {
    try {
        const url = new URL(value);
        if (url.hostname === 'passport.yandex.ru' || url.pathname.includes('/login')) return 'authentication';
        if (!['dzen.ru', 'www.dzen.ru'].includes(url.hostname)) return 'unexpected';
        if (/^\/profile\/editor\//.test(url.pathname)) return 'studio';
        if (/^\/id\/[^/]+\/?$/.test(url.pathname)) return 'public_channel';
        return 'unexpected';
    } catch {
        return 'unexpected';
    }
}

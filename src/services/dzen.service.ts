import puppeteerPublisherService from './puppeteer_publisher.service';
import type { Dzen1045DraftProof } from './dzen_task1045_resume_contract';
import {
    inspectDzen1045AbsenceInBrowser,
    inspectDzen1045SecondAttemptInBrowserSession,
    restoreDzen1045InBrowserSession,
    inspectDzen1045RestoreIncidentInBrowser,
    createDzen1045DurableDraftPhaseAInBrowser,
    probeDzen1045CreationContractInBrowser,
    probeDzen1045CreationMenuInBrowser,
    createDzen1045DurableDraftPhaseAV2InBrowser,
    inspectDzen1045PhaseAV2IncidentInBrowser,
    probeDzen1045ExactEditorStateInBrowser,
    publishDzen1045ExistingDraftOnceInBrowser,
    probeDzen1045PhaseBDialogInBrowser,
    probeDzen1045EditorControlMapInBrowser,
    previewDzen1045PhaseCInBrowser,
    publishDzen1045PhaseCOnceInBrowser,
    recoverDzen1045SecondAttemptInBrowserSession,
    resumeDzen1045DraftInBrowser
} from './dzen_task1045_browser.service';
import type { Dzen1045SecondAttemptDraftProof } from './dzen_task1045_second_attempt_contract';

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
    async previewTask1045PhaseC(config: DzenConfig, acceptedBody: string) {
        if (!config.cookies?.trim() || config.channel_id?.trim() !== '6a8029aba055ec36033bf81c') {
            throw new Error('[DZEN_CONNECTOR_NOT_READY] Exact authenticated task1045 channel is required');
        }
        return previewDzen1045PhaseCInBrowser({ cookies: config.cookies.trim(),
            channel_id: config.channel_id.trim() }, acceptedBody);
    }
    async publishTask1045PhaseCOnce(config: DzenConfig, acceptedBody: string, expectedDialogFingerprint: string) {
        if (!config.cookies?.trim() || config.channel_id?.trim() !== '6a8029aba055ec36033bf81c') {
            throw new Error('[DZEN_CONNECTOR_NOT_READY] Exact authenticated task1045 channel is required');
        }
        return publishDzen1045PhaseCOnceInBrowser({ cookies: config.cookies.trim(),
            channel_id: config.channel_id.trim() }, acceptedBody, expectedDialogFingerprint);
    }
    async probeTask1045EditorControlMap(config: DzenConfig, acceptedBody: string) {
        if (!config.cookies?.trim() || config.channel_id?.trim() !== '6a8029aba055ec36033bf81c') {
            throw new Error('[DZEN_CONNECTOR_NOT_READY] Exact authenticated task1045 channel is required');
        }
        return probeDzen1045EditorControlMapInBrowser({ cookies: config.cookies.trim(),
            channel_id: config.channel_id.trim() }, acceptedBody);
    }
    async probeTask1045PhaseBDialog(config: DzenConfig, acceptedBody: string) {
        if (!config.cookies?.trim() || config.channel_id?.trim() !== '6a8029aba055ec36033bf81c') {
            throw new Error('[DZEN_CONNECTOR_NOT_READY] Exact authenticated task1045 channel is required');
        }
        return probeDzen1045PhaseBDialogInBrowser({ cookies: config.cookies.trim(),
            channel_id: config.channel_id.trim() }, acceptedBody);
    }
    async publishTask1045ExistingDraftOnce(config: DzenConfig, acceptedBody: string) {
        if (!config.cookies?.trim() || config.channel_id?.trim() !== '6a8029aba055ec36033bf81c') {
            throw new Error('[DZEN_CONNECTOR_NOT_READY] Exact authenticated task1045 channel is required');
        }
        return publishDzen1045ExistingDraftOnceInBrowser({ cookies: config.cookies.trim(),
            channel_id: config.channel_id.trim() }, acceptedBody);
    }
    async probeTask1045ExactEditorState(config: DzenConfig, acceptedBody: string) {
        if (!config.cookies?.trim() || config.channel_id?.trim() !== '6a8029aba055ec36033bf81c') {
            throw new Error('[DZEN_CONNECTOR_NOT_READY] Exact authenticated task1045 channel is required');
        }
        return probeDzen1045ExactEditorStateInBrowser({ cookies: config.cookies.trim(),
            channel_id: config.channel_id.trim() }, acceptedBody);
    }
    async inspectTask1045PhaseAV2Incident(config: DzenConfig, acceptedBody: string) {
        if (!config.cookies?.trim() || config.channel_id?.trim() !== '6a8029aba055ec36033bf81c') {
            throw new Error('[DZEN_CONNECTOR_NOT_READY] Exact authenticated task1045 channel is required');
        }
        return inspectDzen1045PhaseAV2IncidentInBrowser({ cookies: config.cookies.trim(),
            channel_id: config.channel_id.trim() }, acceptedBody);
    }
    async createTask1045DurableDraftPhaseAV2(config: DzenConfig, acceptedBody: string, imageUrl: string) {
        if (!config.cookies?.trim() || config.channel_id?.trim() !== '6a8029aba055ec36033bf81c') {
            throw new Error('[DZEN_CONNECTOR_NOT_READY] Exact authenticated task1045 channel is required');
        }
        return createDzen1045DurableDraftPhaseAV2InBrowser({ cookies: config.cookies.trim(),
            channel_id: config.channel_id.trim() }, acceptedBody, imageUrl);
    }
    async probeTask1045CreationMenu(config: DzenConfig) {
        if (!config.cookies?.trim() || config.channel_id?.trim() !== '6a8029aba055ec36033bf81c') {
            throw new Error('[DZEN_CONNECTOR_NOT_READY] Exact authenticated task1045 channel is required');
        }
        return probeDzen1045CreationMenuInBrowser({ cookies: config.cookies.trim(),
            channel_id: config.channel_id.trim() });
    }
    async probeTask1045CreationContract(config: DzenConfig) {
        if (!config.cookies?.trim() || config.channel_id?.trim() !== '6a8029aba055ec36033bf81c') {
            throw new Error('[DZEN_CONNECTOR_NOT_READY] Exact authenticated task1045 channel is required');
        }
        return probeDzen1045CreationContractInBrowser({ cookies: config.cookies.trim(),
            channel_id: config.channel_id.trim() });
    }
    async createTask1045DurableDraftPhaseA(config: DzenConfig, acceptedBody: string, imageUrl: string) {
        if (!config.cookies?.trim() || config.channel_id?.trim() !== '6a8029aba055ec36033bf81c') {
            throw new Error('[DZEN_CONNECTOR_NOT_READY] Exact authenticated task1045 channel is required');
        }
        return createDzen1045DurableDraftPhaseAInBrowser({ cookies: config.cookies.trim(),
            channel_id: config.channel_id.trim() }, acceptedBody, imageUrl);
    }
    async inspectTask1045RestoreIncident(config: DzenConfig, acceptedBody: string) {
        if (!config.cookies?.trim() || config.channel_id?.trim() !== '6a8029aba055ec36033bf81c') {
            throw new Error('[DZEN_CONNECTOR_NOT_READY] Exact authenticated task1045 channel is required');
        }
        return inspectDzen1045RestoreIncidentInBrowser({ cookies: config.cookies.trim(),
            channel_id: config.channel_id.trim() }, acceptedBody);
    }
    async inspectTask1045ExactObjects(config: DzenConfig, acceptedBody: string) {
        if (!config.cookies?.trim() || config.channel_id?.trim() !== '6a8029aba055ec36033bf81c') {
            throw new Error('[DZEN_CONNECTOR_NOT_READY] Exact authenticated task1045 channel is required');
        }
        return inspectDzen1045SecondAttemptInBrowserSession({ cookies: config.cookies.trim(),
            channel_id: config.channel_id.trim() }, acceptedBody);
    }
    async restoreTask1045(config: DzenConfig, acceptedBody: string, imageUrl: string) {
        if (!config.cookies?.trim() || config.channel_id?.trim() !== '6a8029aba055ec36033bf81c') {
            throw new Error('[DZEN_CONNECTOR_NOT_READY] Exact authenticated task1045 channel is required');
        }
        return restoreDzen1045InBrowserSession(
            { cookies: config.cookies.trim(), channel_id: config.channel_id.trim() },
            acceptedBody,
            imageUrl
        );
    }
    async recoverTask1045SecondAttempt(config: DzenConfig, acceptedBody: string,
        args: { confirm: boolean; idempotencyKey: string },
        claim: (proof: Dzen1045SecondAttemptDraftProof) => Promise<boolean>) {
        if (!config.cookies?.trim() || !config.channel_id?.trim()) {
            throw new Error('[DZEN_CONNECTOR_NOT_READY] Authenticated channel is required');
        }
        return recoverDzen1045SecondAttemptInBrowserSession({
            cookies: config.cookies.trim(), channel_id: config.channel_id.trim()
        }, acceptedBody, args, claim);
    }
    async inspectTask1045Absence(config: DzenConfig) {
        if (!config.cookies?.trim() || !config.channel_id?.trim()) {
            throw new Error('[DZEN_CONNECTOR_NOT_READY] Authenticated channel is required');
        }
        return inspectDzen1045AbsenceInBrowser({ cookies: config.cookies.trim(), channel_id: config.channel_id.trim() });
    }
    async resumeTask1045Draft(config: DzenConfig, acceptedBody: string,
        args: { confirm: boolean; idempotencyKey: string },
        claim: (proof: Dzen1045DraftProof) => Promise<boolean>) {
        if (!config.cookies?.trim() || !config.channel_id?.trim()) {
            throw new Error('[DZEN_CONNECTOR_NOT_READY] Authenticated channel is required');
        }
        return resumeDzen1045DraftInBrowser({ cookies: config.cookies.trim(), channel_id: config.channel_id.trim() },
            acceptedBody, args, claim);
    }
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

    /** Read the authenticated Studio publication list for duplicate-safe incident reconciliation. */
    async readStudioPublications(config: DzenConfig) {
        if (!config.cookies?.trim()) {
            throw new Error('An authenticated Dzen session is required');
        }
        return puppeteerPublisherService.readDzenStudioPublications({ ...config, cookies: config.cookies.trim() });
    }

    async collectPostMetrics(config: DzenConfig, postUrl: string) {
        const raw = await puppeteerPublisherService.collectDzenPostMetrics(config, postUrl);
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

    async preflightComment(config: DzenConfig, postUrl: string) {
        return puppeteerPublisherService.preflightDzenComment(config, postUrl);
    }
}

export default new DzenService();

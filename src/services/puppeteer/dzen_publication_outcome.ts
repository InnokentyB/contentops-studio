import type { ElementHandle, Page } from 'puppeteer';

export type DzenPublicationObservation = {
    currentUrl: string;
    linkedUrls: string[];
    providerUrls: string[];
    previousUrls: string[];
    errorMessages: string[];
    confirmationVisible: boolean;
};

export type DzenPublicationOutcome =
    | { kind: 'published'; permalink: string }
    | { kind: 'rejected'; message: string }
    | { kind: 'uncertain'; reason: string };

const PUBLIC_DZEN_PATH = /\/(?:a|b)\/[^/?#]+|\/media\/id\/[^/?#]+/;
const EXPLICIT_PUBLICATION_ERROR = /не удалось|ошибк|отклон|повторите попытку|failed|error|rejected|could not publish|try again/i;

/** Normalize a candidate provider URL and reject editor, mock, and non-Dzen locations. */
export function canonicalPublicDzenUrl(value: string): string | null {
    try {
        const url = new URL(value, 'https://dzen.ru');
        if (!['dzen.ru', 'www.dzen.ru'].includes(url.hostname)) return null;
        if (url.pathname.startsWith('/studio') || url.pathname.includes('/editor/')) return null;
        if (/\bmock[-_/]/i.test(url.pathname) || !PUBLIC_DZEN_PATH.test(url.pathname)) return null;
        url.protocol = 'https:';
        url.hostname = 'dzen.ru';
        url.search = '';
        url.hash = '';
        return url.toString().replace(/\/$/, '');
    } catch {
        return null;
    }
}

/** Extract public Dzen permalinks from a bounded JSON-like provider response. */
export function extractPublicDzenUrlsFromPayload(payload: unknown): string[] {
    const results = new Set<string>();
    const visited = new Set<object>();

    const visit = (value: unknown, depth: number): void => {
        if (depth > 8 || value === null || value === undefined) return;
        if (typeof value === 'string') {
            const url = canonicalPublicDzenUrl(value);
            if (url) results.add(url);
            return;
        }
        if (typeof value !== 'object' || visited.has(value)) return;
        visited.add(value);
        if (Array.isArray(value)) {
            value.slice(0, 100).forEach((entry) => visit(entry, depth + 1));
            return;
        }
        Object.values(value as Record<string, unknown>)
            .slice(0, 100)
            .forEach((entry) => visit(entry, depth + 1));
    };

    visit(payload, 0);
    return Array.from(results);
}

/** Classify one observed post-submit state without treating modal disappearance as success. */
export function classifyDzenPublicationOutcome(observation: DzenPublicationObservation): DzenPublicationOutcome {
    const previous = new Set(observation.previousUrls
        .map(canonicalPublicDzenUrl)
        .filter((url): url is string => Boolean(url)));
    const candidates = [observation.currentUrl, ...observation.providerUrls, ...observation.linkedUrls]
        .map(canonicalPublicDzenUrl)
        .filter((url): url is string => Boolean(url))
        .filter((url) => !previous.has(url));
    if (candidates.length > 0) return { kind: 'published', permalink: candidates[0] };

    const providerError = observation.errorMessages
        .map((message) => message.trim())
        .find((message) => message.length > 0 && EXPLICIT_PUBLICATION_ERROR.test(message));
    if (providerError) return { kind: 'rejected', message: providerError };

    return observation.confirmationVisible
        ? { kind: 'uncertain', reason: 'Dzen kept the publication dialog open without a confirmed error or permalink.' }
        : { kind: 'uncertain', reason: 'Dzen closed the publication dialog without returning a new public permalink.' };
}

type ConfirmButtonState = { disabled: boolean; ariaDisabled: boolean };

/** Submit the final Dzen dialog through a trusted Puppeteer click after checking readiness. */
export async function clickDzenPublicationConfirm(page: Page, selector: string): Promise<void> {
    const button = await page.waitForSelector(selector, { visible: true, timeout: 15_000 });
    if (!button) throw new Error('[DZEN_CONFIRM_NOT_FOUND] Final publication control was not found');
    const state = await (button as ElementHandle<Element>).evaluate((element): ConfirmButtonState => ({
        disabled: element instanceof HTMLButtonElement ? element.disabled : element.hasAttribute('disabled'),
        ariaDisabled: element.getAttribute('aria-disabled') === 'true'
    }));
    if (state.disabled || state.ariaDisabled) {
        throw new Error('[DZEN_CONFIRM_NOT_READY] Final publication control is disabled');
    }
    await button.click();
}

type DzenPageState = {
    linkedUrls: string[];
    errorMessages: string[];
    confirmationVisible: boolean;
};

async function readDzenPageState(page: Page, confirmSelector: string): Promise<DzenPageState> {
    return page.evaluate((selector): DzenPageState => {
        const isVisible = (element: Element): boolean => {
            const node = element as HTMLElement;
            const style = window.getComputedStyle(node);
            return style.display !== 'none' && style.visibility !== 'hidden'
                && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
        };
        const errorSelectors = [
            '[role="alert"]',
            '[aria-live="assertive"]',
            '[data-testid*="error"]',
            '[class*="Error"]',
            '[class*="error"]',
            '[class*="toast"]'
        ].join(',');
        const errorMessages = Array.from(document.querySelectorAll(errorSelectors))
            .filter(isVisible)
            .map((element) => element.textContent?.trim() || '')
            .filter(Boolean)
            .slice(0, 20);
        const confirmation = document.querySelector(selector);
        return {
            linkedUrls: Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).map((link) => link.href),
            errorMessages,
            confirmationVisible: Boolean(confirmation && isVisible(confirmation))
        };
    }, confirmSelector);
}

/** Poll post-submit UI and provider evidence until success, rejection, or a bounded uncertain result. */
export async function waitForDzenPublicationOutcome(
    page: Page,
    confirmSelector: string,
    previousUrls: readonly string[],
    providerUrls: ReadonlySet<string>,
    timeoutMs = 30_000
): Promise<DzenPublicationOutcome> {
    const deadline = Date.now() + timeoutMs;
    let latest: DzenPublicationOutcome = {
        kind: 'uncertain',
        reason: 'Dzen did not return a confirmed publication result.'
    };
    while (Date.now() < deadline) {
        const state = await readDzenPageState(page, confirmSelector);
        latest = classifyDzenPublicationOutcome({
            currentUrl: page.url(),
            linkedUrls: state.linkedUrls,
            providerUrls: Array.from(providerUrls),
            previousUrls: Array.from(previousUrls),
            errorMessages: state.errorMessages,
            confirmationVisible: state.confirmationVisible
        });
        if (latest.kind !== 'uncertain') return latest;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return latest;
}

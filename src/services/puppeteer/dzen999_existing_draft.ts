import { createHash } from 'crypto';
import type { Page } from 'puppeteer';
import { DZEN_EDITOR_SELECTORS, extractDzenStudioPublications } from './dzen_dom_helpers';
import { clickDzenPublicationConfirm } from './dzen_publication_outcome';
import { DZEN999, normalizeDzen999Body, runDzen999Resume, type Dzen999Proof } from '../dzen_task999_resume_contract';

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}

export async function resumeDzen999InExistingPage(page: Page, acceptedBody: string,
    args: { confirm: boolean; idempotencyKey: string }, claim: (proof: Dzen999Proof) => Promise<boolean>) {
    const listUrl = `https://dzen.ru/profile/editor/id/${DZEN999.publisherId}/publications`;
    async function readPublished() {
        const pending = page.waitForResponse(r => /\/editor-api\/v3\/publications\?/.test(r.url())
            && new URL(r.url()).searchParams.get('state') === 'published' && r.status() === 200,
        { timeout: 30_000 });
        await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        const response = await pending;
        const parsed = extractDzenStudioPublications(await response.json());
        const pageSize = Number(new URL(response.url()).searchParams.get('pageSize'));
        if (!parsed?.title_readback_complete || !Number.isInteger(pageSize) || pageSize < 1
            || parsed.publications.length >= pageSize) throw new Error('[DZEN999_PUBLICATION_LIST_INCOMPLETE]');
        return parsed.publications;
    }
    return runDzen999Resume(args, {
        inspect: async () => {
            const published = await readPublished();
            await page.goto(`${listUrl}?state=draft`, { waitUntil: 'networkidle2', timeout: 30_000 });
            const draftListed = await page.evaluate(id => Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
                .some(a => a.href.endsWith(`/${id}/edit`)), DZEN999.draftId);
            const pending = page.waitForResponse(r => new URL(r.url()).pathname
                === `/editor-api/v2/publisher/${DZEN999.publisherId}/publication/${DZEN999.draftId}`
                && r.status() === 200, { timeout: 30_000 });
            await page.goto(`https://dzen.ru/profile/editor/id/${DZEN999.publisherId}/${DZEN999.draftId}/edit`,
                { waitUntil: 'networkidle2', timeout: 30_000 });
            const native = record(await (await pending).json());
            const publications = Array.isArray(native.publications) ? native.publications : [];
            const draft = record(publications.find(p => record(p).id === DZEN999.draftId));
            const image = record(record(record(draft.content).preview).image);
            const size = record(record(image.sizes).orig);
            const response = await fetch(`https://avatars.dzeninfra.ru/get-zen_doc/271828/pub_${DZEN999.draftId}_${DZEN999.providerImageId}/orig`,
                { redirect: 'error', signal: AbortSignal.timeout(15_000) });
            if (!response.ok) throw new Error('[DZEN999_COVER_READBACK_FAILED]');
            const bytes = Buffer.from(await response.arrayBuffer());
            if (bytes.length > 2_000_000) throw new Error('[DZEN999_COVER_TOO_LARGE]');
            const title = await page.$eval(DZEN_EDITOR_SELECTORS.articleTitle, e => (e as HTMLElement).innerText);
            const body = await page.$eval(DZEN_EDITOR_SELECTORS.articleBody, e => (e as HTMLElement).innerText);
            const help = '[role="dialog"][class*="help-popup"]';
            if (await page.$(help)) {
                await page.click(`${help} [aria-label="Закрыть"]`);
                await page.waitForSelector(help, { hidden: true, timeout: 5_000 });
                await page.waitForFunction(() => !document.querySelector('[class*="help-popup__overlay"]'), { timeout: 5_000 });
            }
            await page.click(DZEN_EDITOR_SELECTORS.articlePublish);
            await page.waitForSelector(DZEN_EDITOR_SELECTORS.publicationConfirm, { visible: true, timeout: 15_000 });
            const finalControlReady = await page.$eval(DZEN_EDITOR_SELECTORS.publicationConfirm, e =>
                e instanceof HTMLButtonElement && !e.disabled && e.getAttribute('aria-disabled') !== 'true');
            return { draftId: String(draft.id || ''), title, bodyMatches: normalizeDzen999Body(body) === normalizeDzen999Body(acceptedBody),
                coverId: String(image.id || ''), coverSha: createHash('sha256').update(bytes).digest('hex'),
                coverWidth: Number(size.width), coverHeight: Number(size.height), draftListed,
                publishedMatches: published.filter(p => p.provider_object_id === DZEN999.draftId || p.title === DZEN999.title).length,
                publicationListComplete: true, finalControlReady };
        },
        claim,
        submit: async () => {
            await clickDzenPublicationConfirm(page, DZEN_EDITOR_SELECTORS.publicationConfirm);
            await new Promise(resolve => setTimeout(resolve, 1500));
            const published = await readPublished();
            const match = published.find(p => p.provider_object_id === DZEN999.draftId && p.title === DZEN999.title);
            if (!match?.public_url || !match.published_at) throw new Error('[DZEN999_RESUME_UNCERTAIN] No exact published object');
            await page.goto(match.public_url, { waitUntil: 'networkidle2', timeout: 30_000 });
            const bodyMatches = await page.evaluate(body => {
                const normalize = (s: string) => s.replace(/^#{1,6}\s+/gm, '').replace(/^[-*]\s+/gm, '').replace(/\s+/g, ' ').trim();
                return normalize(document.body.innerText).includes(normalize(body));
            }, acceptedBody);
            if (!bodyMatches) throw new Error('[DZEN999_PUBLIC_BODY_UNCONFIRMED]');
            return { ...match, public_body_matches: true, checked_at: new Date().toISOString() };
        }
    });
}

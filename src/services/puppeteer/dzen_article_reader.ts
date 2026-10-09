import { z } from 'zod';
import type { DzenConfig } from '../dzen.service';
import { dzenReadUrl, withDzenReadonlyPage } from './dzen_readonly_browser';

const articleSchema = z.object({ title: z.string().min(1).max(2000), text: z.string().min(1).max(100001),
    author: z.string().max(2000).nullable(), published_at: z.string().max(100).nullable(),
    canonical: z.string().nullable(), body_count: z.number().int(), comments_control: z.boolean(),
    restricted: z.boolean(), truncated: z.boolean() });

export interface DzenArticleResult {
    schema_version:number; status:'partial'|'observed'; post_url:string; title:string; text:string; author_name:string|null;
    published_at:string|null; publication_date_status:string; article_body_read:boolean; complete:boolean; text_scope:string;
    comments_control_observed:boolean; comment_permission:string; gaps:string[]; captured_at:string;
    provenance:{source:string;evidence_ref:string;mutation_requests_blocked:boolean;untrusted_content:boolean};
}

/** Normalize only the primary native article block; provider metadata and rendered text are untrusted evidence. */
export function parseDzenArticle(payload: unknown, postUrl: string): DzenArticleResult {
    const parsed = articleSchema.safeParse(payload);
    if (!parsed.success || parsed.data.body_count !== 1 || parsed.data.restricted) throw new Error('DZEN_ARTICLE_INTERFACE_CHANGED');
    const data = parsed.data;
    const url = dzenReadUrl(postUrl);
    if (data.canonical && dzenReadUrl(data.canonical) !== url) throw new Error('DZEN_INBOUND_SCOPE_MISMATCH');
    const date = data.published_at && /^\d{4}-\d{2}-\d{2}T/.test(data.published_at) ? new Date(data.published_at) : null;
    const publishedAt = date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
    return { schema_version: 1, status: data.truncated ? 'partial' as const : 'observed' as const,
        post_url: url, title: data.title, text: data.text, author_name: data.author,
        published_at: publishedAt, publication_date_status: publishedAt ? 'observed' : 'unknown',
        article_body_read: true, complete: !data.truncated, text_scope: 'primary_rendered_article_body',
        comments_control_observed: data.comments_control, comment_permission: 'unknown',
        gaps: [...(data.truncated ? ['article_body_exceeds_100000_characters'] : []),
            ...(!publishedAt ? ['native_publication_date_unavailable'] : [])],
        captured_at: new Date().toISOString(), provenance: { source: 'dzen_native_article_dom', evidence_ref: url,
            mutation_requests_blocked: true, untrusted_content: true } };
}

/** Read a public article inside Planner's isolated authorized browser, without following recommendations or writing. */
export async function readDzenArticle(config: DzenConfig, postUrl: string): Promise<DzenArticleResult> {
    const url = dzenReadUrl(postUrl);
    return withDzenReadonlyPage(config, async page => {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });
        if (dzenReadUrl(page.url()) !== url) throw new Error('DZEN_READ_URL_INVALID');
        await page.waitForSelector('[class*="article-render__container"]', { timeout: 15_000 });
        const result = await page.evaluate(() => {
            // Native content v1.353.3: article render container, not generic <article> recommendation cards.
            const blocks = Array.from(document.querySelectorAll<HTMLElement>('[class*="article-render__container"]'));
            const text = blocks[0]?.innerText.trim() || '';
            const meta = (selector: string) => document.querySelector<HTMLMetaElement>(selector)?.content || null;
            return { title: document.querySelector('h1[class*="article-header__title"]')?.textContent?.trim() || '',
                text: text.slice(0,100001), body_count: blocks.length, author: meta('meta[name="author"]'),
                published_at: meta('meta[property="article:published_time"]'),
                canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || null,
                comments_control: Boolean(document.querySelector('[aria-label="Комментировать"]')),
                restricted: /captcha|капч|подтвердите.*(?:человек|робот)/i.test(document.body.innerText.slice(0,1500)),
                truncated: text.length > 100000 };
        });
        if (result.truncated) result.text = result.text.slice(0,100000);
        return parseDzenArticle(result,url);
    });
}

import type { Page } from 'playwright';

/** Bounded visible-wall observation, not a claim that all historical posts were scanned. */
export interface VkPostBaseline {
    owner_id: string;
    captured_at: string;
    object_ids: string[];
    coverage: 'visible_wall_slice';
}
export interface VkPostReadbackProof {
    public_url: string;
    provider_object_id: string;
    published_at: string;
    provider_timestamp_source: 'provider';
    owner_id: string;
    text: string;
    image_present: boolean;
    post_baseline_captured_at: string;
    post_baseline_object_ids: string[];
    post_submission_started_at: string;
    readback_observed_at: string;
}
interface Candidate { id: string | null; text: string; links: string[]; dates: string[]; image: boolean }
const POST = '[data-testid="post"][data-post-id]';
const LIMIT = 100;
function normalize(text: string): string {
    return text.replace(/\r/g, '').replace(/[\u00a0\u202f]/g, ' ').replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n\n').trim();
}
/** Parse only absolute provider metadata, never relative date labels or the machine clock. */
export function vkPostProviderDate(values: string[]): string | null {
    const dates = values.filter(Boolean).map(value => {
        if (/^\d{10}$/.test(value)) return Number(value) * 1000;
        if (/^\d{13}$/.test(value)) return Number(value);
        return /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
    });
    if (!dates.length || dates.some(value => !Number.isFinite(value) || value <= 0)) return null;
    const unique = new Set(dates);
    return unique.size === 1 ? new Date(dates[0]).toISOString() : null;
}
function wallIdentity(href: string): string | null {
    let url: URL;
    try { url = new URL(href, 'https://vk.com'); } catch { return null; }
    if (url.protocol !== 'https:' || !['vk.com', 'www.vk.com', 'vk.ru', 'www.vk.ru'].includes(url.hostname)
        || url.username || url.password || url.port) return null;
    const route = /^\/wall(-[1-9]\d*_[1-9]\d*)$/.exec(url.pathname);
    const overlay = /^wall(-[1-9]\d*_[1-9]\d*)$/.exec(url.searchParams.get('w') || '');
    if (route && overlay && route[1] !== overlay[1]) return null;
    return route?.[1] || overlay?.[1] || null;
}
async function candidates(page: Page): Promise<Candidate[]> {
    return page.locator(POST).evaluateAll(posts => posts.slice(0, 101).map(post => {
        const textNode = post.querySelector<HTMLElement>('[data-testid="post_text"]');
        const dates = [post.getAttribute('data-date') || '', post.getAttribute('data-post-date') || ''];
        post.querySelectorAll('time[datetime], [data-testid="post_date"][data-time], .post_date[data-time]')
            .forEach(node => dates.push(node.getAttribute('datetime') || node.getAttribute('data-time') || ''));
        const links = Array.from(post.querySelectorAll('a[href]')).map(node => node.getAttribute('href') || '');
        const image = Array.from(post.querySelectorAll<HTMLImageElement>('[data-testid="post-content-container"] img'))
            .some(node => node.complete && node.naturalWidth > 0 && Boolean(node.offsetWidth || node.offsetHeight));
        return { id: post.getAttribute('data-post-id'), text: textNode?.innerText || '', links, dates, image };
    }));
}
/** Captures only known wall IDs before provider mutation; callers must retain this exact baseline. */
export async function captureVkPostBaseline(page: Page, ownerId: string, now = new Date()): Promise<VkPostBaseline> {
    if (!/^-[1-9]\d*$/.test(ownerId)) throw new Error('[VK_POST_BASELINE_UNCONFIRMED] Exact community is required');
    const rows = await candidates(page);
    if (rows.length > LIMIT || rows.some(row => !row.id || !/^-?[1-9]\d*_[1-9]\d*$/.test(row.id))) {
        throw new Error('[VK_POST_BASELINE_UNCONFIRMED] Wall snapshot is incomplete or invalid');
    }
    return { owner_id: ownerId, captured_at: now.toISOString(),
        object_ids: [...new Set(rows.filter(row => row.id?.startsWith(`${ownerId}_`)).map(row => String(row.id)))],
        coverage: 'visible_wall_slice' };
}
/** Requires a unique new provider-timestamped object; absence or ambiguity is explicitly unconfirmed. */
export async function readVkPostProof(page: Page, input: {
    ownerId: string; text: string; baseline: VkPostBaseline; submissionStartedAt: string; observedAt?: Date;
}): Promise<VkPostReadbackProof | null> {
    const observed = input.observedAt || new Date();
    const started = Date.parse(input.submissionStartedAt), baselineTime = Date.parse(input.baseline.captured_at);
    if (!/^-[1-9]\d*$/.test(input.ownerId) || input.baseline.owner_id !== input.ownerId
        || input.baseline.coverage !== 'visible_wall_slice' || input.baseline.object_ids.length > LIMIT
        || ![started, baselineTime, observed.getTime()].every(Number.isFinite)
        || baselineTime > started || started - baselineTime > 300_000 || observed.getTime() < started
        || observed.getTime() - started > 300_000) return null;
    const posts = page.locator(POST);
    if (await posts.count() > LIMIT) return null;
    for (let index = 0; index < await posts.count(); index++) {
        const expand = posts.nth(index).locator('[data-testid="showmoretext-after"]').first();
        if (await expand.count() && await expand.isVisible()) {
            try { await expand.click({ timeout: 2000 }); }
            catch { return null; } // Expansion failure leaves exact-caption evidence unknown.
        }
    }
    const rows = await candidates(page);
    const matches = new Map<string, { candidate: Candidate; date: string }>();
    for (const candidate of rows) {
        if (!candidate.id?.startsWith(`${input.ownerId}_`) || !/^-\d+_[1-9]\d*$/.test(candidate.id)
            || input.baseline.object_ids.includes(candidate.id) || normalize(candidate.text) !== normalize(input.text)) continue;
        const published = vkPostProviderDate(candidate.dates);
        if (!published || !candidate.links.some(link => wallIdentity(link) === candidate.id)) return null;
        // Whole-second provider metadata is compared to the same precision, never fabricated.
        if (Date.parse(published) < Math.floor(started / 1000) * 1000
            || Date.parse(published) > observed.getTime() + 30_000) continue;
        matches.set(candidate.id, { candidate, date: published });
    }
    if (matches.size !== 1) return null;
    const [id, match] = [...matches][0];
    return { public_url: `https://vk.com/wall${id}`, provider_object_id: id, owner_id: input.ownerId,
        published_at: match.date, provider_timestamp_source: 'provider', text: match.candidate.text.trim(),
        image_present: match.candidate.image, post_baseline_captured_at: input.baseline.captured_at,
        post_baseline_object_ids: [...input.baseline.object_ids], post_submission_started_at: input.submissionStartedAt,
        readback_observed_at: observed.toISOString() };
}

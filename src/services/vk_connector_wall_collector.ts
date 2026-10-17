import type { Page } from 'playwright';
import { vkPostProviderDate } from './vk_browser_post_proof';
import type { VkConnectorWallEvidence, VkConnectorWallPost } from './vk_connector_reconciliation';
export interface VkConnectorMediaSource { originalUrl: string; capturedAt: string; postObjectId: string; providerMediaId: string; }
export interface VkConnectorWallCard { objectId: string; publicUrl: string; text: string; dates: string[]; photoIds: string[]; expanded: boolean; }
export interface VkConnectorWallSnapshot { rows: VkConnectorWallCard[]; terminal: boolean; }
export interface VkConnectorWallInventoryPort { snapshot(): Promise<VkConnectorWallSnapshot>; advance(): Promise<boolean>; }
/** This trusted port must verify downloaded provider-photo bytes or direct upload identity, not DOM presence. */
export interface VkConnectorWallMediaVerifier {
    verify(card: VkConnectorWallCard, signal?: AbortSignal): Promise<(NonNullable<VkConnectorWallPost['media']> & { source?: VkConnectorMediaSource }) | null>;
}
/** A terminal provider pagination boundary is required; reaching an old post alone proves nothing about pinned/hidden rows. */
export async function collectVkConnectorWall(port: VkConnectorWallInventoryPort, ownerId: string, releasedAt: string,
    media: VkConnectorWallMediaVerifier, now: () => Date = () => new Date(), signal?: AbortSignal): Promise<VkConnectorWallEvidence> {
    const started = now(); const rows = new Map<string, VkConnectorWallPost>();
    let complete = false; let valid = /^-[1-9]\d*$/.test(ownerId) && Number.isFinite(Date.parse(releasedAt));
    for (let turn = 0; turn < 20 && valid; turn++) {
        if (signal?.aborted || now().getTime() - started.getTime() > 120_000) break;
        const snapshot = await port.snapshot();
        for (const card of snapshot.rows) {
            const publishedAt = vkPostProviderDate(card.dates);
            if (!new RegExp(`^${ownerId}_[1-9]\\d*$`).test(card.objectId)
                || card.publicUrl !== `https://vk.com/wall${card.objectId}` || !publishedAt || !card.expanded) { valid = false; break; }
            const previous = rows.get(card.objectId);
            if (previous && (previous.text !== card.text || previous.publishedAt !== publishedAt)) { valid = false; break; }
            if (!previous) {
                if (rows.size >= 100) { valid = false; break; }
                const acknowledgement = await media.verify(card, signal);
                const verified = acknowledgement && acknowledgement.acknowledged
                    && /^[a-f0-9]{64}$/.test(acknowledgement.assetSha256)
                    && card.photoIds.includes(acknowledgement.providerMediaId)
                    && new RegExp(`^photo${ownerId}_[1-9]\\d*$`).test(acknowledgement.providerMediaId) ? acknowledgement : null;
                rows.set(card.objectId, { objectId: card.objectId, publicUrl: card.publicUrl, publishedAt, text: card.text, media: verified });
            }
        }
        if (!valid || signal?.aborted || now().getTime() - started.getTime() > 120_000) break;
        if (snapshot.terminal) { complete = true; break; }
        if (!await port.advance()) break;
    }
    const capturedAt = now().toISOString();
    return { ownerId, startedAt: started.toISOString(), capturedAt, windowStart: releasedAt, windowEnd: capturedAt,
        coverage: complete && valid ? 'complete_window' : 'partial', exhausted: complete && valid, rows: [...rows.values()] };
}
/** Tentative VK semantic selectors. Production requires trusted action and surface admission; local fixtures only verify extraction. */
export function createVkConnectorWallInventory(page: Page): VkConnectorWallInventoryPort {
    return { snapshot: async () => {
        const cards = page.locator('[data-testid="post"][data-post-id]');
        for (let index = 0; index < Math.min(await cards.count(), 101); index++) {
            const expand = cards.nth(index).locator('[data-testid="showmoretext-after"]');
            if (await expand.count() && await expand.first().isVisible()) await expand.first().click({ timeout: 2000 });
        }
        const rows = await cards.evaluateAll(nodes => nodes.slice(0, 101).map(node => {
            const objectId = node.getAttribute('data-post-id') || '';
            const text = node.querySelector<HTMLElement>('[data-testid="post_text"]')?.innerText || '';
            const links = Array.from(node.querySelectorAll('a[href]')).map(link => link.getAttribute('href') || '');
            const dates = [node.getAttribute('data-date') || '', node.getAttribute('data-post-date') || ''];
            node.querySelectorAll('time[datetime], [data-time]').forEach(date => dates.push(date.getAttribute('datetime') || date.getAttribute('data-time') || ''));
            const photoIds = links.map(link => /(?:^|\/)photo(-[1-9]\d*_[1-9]\d*)(?:[?#]|$)/.exec(link)?.[1]).filter((id): id is string => Boolean(id)).map(id => `photo${id}`);
            return { objectId, publicUrl: links.includes(`/wall${objectId}`) || links.includes(`https://vk.com/wall${objectId}`) ? `https://vk.com/wall${objectId}` : '',
                text, dates: dates.filter(Boolean), photoIds, expanded: !node.querySelector('[data-testid="showmoretext-after"]') };
        }));
        const terminal = await page.locator('[data-testid="wall_feed_end"]').isVisible();
        return { rows, terminal };
    }, advance: async () => {
        const before = await page.locator('[data-testid="post"][data-post-id]').count();
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        try { await page.waitForFunction(count => document.querySelectorAll('[data-testid="post"][data-post-id]').length > count
            || Boolean(document.querySelector('[data-testid="wall_feed_end"]')), before, { timeout: 3000 }); }
        catch { return false; } // A stalled or failed pagination remains explicitly partial.
        return true;
    } };
}

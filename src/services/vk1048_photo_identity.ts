import { readVk1048BoundedImage } from './vk1048_bounded_image';
import { createHash } from 'node:crypto';
import type { Page } from 'playwright';
import type { Vk1048WallMediaVerifier } from './vk1048_wall_collector';
/** Source must bind the original download to the exact provider photo page, not a thumbnail or screenshot. */
export interface Vk1048OriginalPhotoSource {
    loadOriginal(providerMediaId: string, signal?: AbortSignal): Promise<{ providerMediaId: string; bytes: Buffer; originalUrl?: string; capturedAt?: string } | null>;
}
export function createVk1048PhotoDigestVerifier(approvedSha256: string, source: Vk1048OriginalPhotoSource): Vk1048WallMediaVerifier {
    if (!/^[a-f0-9]{64}$/.test(approvedSha256)) throw new Error('[VK1048_ASSET_HASH_INVALID]');
    return { verify: async (card, signal) => {
        if (card.photoIds.length !== 1 || signal?.aborted) return null;
        const identity = card.photoIds[0];
        if (!/^photo-[1-9]\d*_[1-9]\d*$/.test(identity)) return null;
        const downloaded = await source.loadOriginal(identity, signal);
        if (signal?.aborted || !downloaded || downloaded.providerMediaId !== identity
            || downloaded.bytes.length === 0 || downloaded.bytes.length > 20_000_000
            || createHash('sha256').update(downloaded.bytes).digest('hex') !== approvedSha256) return null;
        return { assetSha256: approvedSha256, providerMediaId: identity, acknowledged: true,
            ...(downloaded.originalUrl && downloaded.capturedAt ? { source: { originalUrl: downloaded.originalUrl, capturedAt: downloaded.capturedAt, postObjectId: card.objectId, providerMediaId: identity } } : {}) };
    } };
}
/** Invoked only inside an admitted, owned context. Original-download surface still requires live verification. */
export function createVk1048PlaywrightPhotoSource(wallPage: Page): Vk1048OriginalPhotoSource {
    return { loadOriginal: async (identity, signal) => {
        if (!/^photo-[1-9]\d*_[1-9]\d*$/.test(identity) || signal?.aborted) return null;
        const photoPage = await wallPage.context().newPage();
        try {
            await photoPage.goto(`https://vk.com/${identity}`, { timeout: 30_000, waitUntil: 'domcontentloaded' });
            const current = new URL(photoPage.url());
            if (!['https://vk.com', 'https://vk.ru'].includes(current.origin) || current.pathname !== `/${identity}` || signal?.aborted) return null;
            const original = photoPage.locator('a[data-testid="photo_download_original"][href], a[download][href]');
            if (await original.count() !== 1) return null;
            const href = await original.getAttribute('href');
            if (!href) return null;
            const resource = new URL(href, photoPage.url());
            if (resource.protocol !== 'https:' || resource.username || resource.password || resource.port
                || !/(^|\.)(userapi\.com|vk\.com|vk\.ru)$/.test(resource.hostname)) return null;
            const abort = signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
            const response = await fetch(resource.href, { signal: abort, redirect: 'error' });
            const bytes = await readVk1048BoundedImage(response, abort);
            return bytes ? { providerMediaId: identity, bytes, originalUrl: resource.href, capturedAt: new Date().toISOString() } : null;
        } finally { await photoPage.close(); }
    } };
}

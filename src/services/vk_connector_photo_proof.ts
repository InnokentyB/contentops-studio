import { createHash } from 'node:crypto';
export interface VkConnectorOriginalPhotoProof {
    originalUrl: string; capturedAt: string; postObjectId: string; providerMediaId: string;
}
export type VkConnectorPhotoFetch = (url: string, options: RequestInit) => Promise<Response>;
export type VkConnectorPhotoVerification = { verified: true } | { verified: false; reason: string };
/** Public original-photo bytes only: pinned VK origins, no cookies/auth, no redirects, bounded time/size.
 * Failure returns a fixed diagnostic code, never a URL, response, cookie or network exception.
 */
export async function verifyVkConnectorOriginalPhoto(source: VkConnectorOriginalPhotoProof, expectedSha256: string,
    download: VkConnectorPhotoFetch = fetch): Promise<VkConnectorPhotoVerification> {
    const reject = (reason: string): VkConnectorPhotoVerification => ({ verified: false, reason });
    let url: URL;
    try { url = new URL(source.originalUrl); } catch { return reject('PHOTO_ORIGIN_INVALID'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port
        || !/(^|\.)(userapi\.com|vk\.com|vk\.ru)$/.test(url.hostname)
        || !/^[a-f0-9]{64}$/.test(expectedSha256)) return reject('PHOTO_ORIGIN_INVALID');
    try {
        const response = await download(url.href, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10_000) });
        const length = response.headers.get('content-length');
        if (!response.ok || !/^image\//i.test(response.headers.get('content-type') || '') || !response.body
            || (length !== null && (!/^\d+$/.test(length) || Number(length) > 20_000_000))) {
            await response.body?.cancel(); return reject('PHOTO_RESPONSE_INVALID');
        }
        const reader = response.body.getReader(), hash = createHash('sha256');
        let size = 0;
        try {
            for (;;) {
                const chunk = await reader.read();
                if (chunk.done) break;
                size += chunk.value.byteLength;
                if (size > 20_000_000) { await reader.cancel(); return reject('PHOTO_SIZE_EXCEEDED'); }
                hash.update(chunk.value);
            }
        } finally { reader.releaseLock(); }
        return size > 0 && hash.digest('hex') === expectedSha256 ? { verified: true } : reject('PHOTO_HASH_MISMATCH');
    } catch { return reject('PHOTO_FETCH_FAILED'); }
}

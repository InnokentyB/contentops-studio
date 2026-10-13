/** Stream limit is enforced before accumulation even when Content-Length is absent or dishonest. */
export async function readVk1048BoundedImage(response: Response, signal?: AbortSignal): Promise<Buffer | null> {
    if (!response.ok || !/^image\//.test(response.headers.get('content-type') || '')
        || Number(response.headers.get('content-length') || 0) > 20_000_000 || !response.body) return null;
    const reader = response.body.getReader(); const chunks: Buffer[] = []; let size = 0;
    try {
        while (true) {
            if (signal?.aborted) return null;
            const chunk = await reader.read(); if (chunk.done) break;
            size += chunk.value.byteLength; if (size > 20_000_000) return null;
            chunks.push(Buffer.from(chunk.value));
        }
        return size ? Buffer.concat(chunks) : null;
    } finally { await reader.cancel(); reader.releaseLock(); }
}

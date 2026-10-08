import { z } from 'zod';
import { SearchParams } from './contracts';

const counter = z.object({ count: z.number().int().nonnegative() }).optional();
export const postSchema = z.object({
    id: z.number().int().positive().safe(), owner_id: z.number().int().safe().refine(id => id !== 0),
    from_id: z.number().int().safe().optional(), date: z.number().int().positive().max(253402300799), text: z.string().max(100_000),
    friends_only: z.number().optional(), is_deleted: z.union([z.boolean(), z.number()]).optional(),
    likes: counter, comments: counter, reposts: counter, views: counter
});
export const responseSchema = z.object({
    items: z.array(z.unknown()).max(200), next_from: z.string().max(2000).optional(),
    profiles: z.array(z.object({ id: z.number().int().positive().safe(), first_name: z.string().optional(), last_name: z.string().optional(), is_closed: z.boolean().optional() })).max(1000).default([]),
    groups: z.array(z.object({ id: z.number().int().positive().safe(), name: z.string().optional(), is_closed: z.number().optional() })).max(1000).default([])
});
export const envelopeSchema = z.object({ response: z.unknown().optional(), error: z.object({ error_code: z.number().int() }).optional() });

/** Calls only VK public search; credentials stay in the POST body and errors are sanitized by the service. */
export async function searchVkPublicPosts(token: string, params: SearchParams): Promise<unknown> {
    const body = new URLSearchParams({ access_token: token, v: '5.199' });
    for (const [key, value] of Object.entries(params)) body.set(key, String(value));
    const response = await fetch('https://api.vk.com/method/newsfeed.search', {
        method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error('VK_SEARCH_TRANSPORT_FAILED'); }
    if (!response.body) throw new Error('VK_SEARCH_EMPTY_RESPONSE');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 2 * 1024 * 1024) throw new Error('VK_SEARCH_RESPONSE_TOO_LARGE');
            chunks.push(chunk.value);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } finally {
        await reader.cancel();
        reader.releaseLock();
    }
}

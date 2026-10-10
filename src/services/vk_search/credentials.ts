import { z } from 'zod';

const configSchema = z.object({ search_access_token: z.string().optional(), user_access_token: z.string().optional() });
export type VkSearchCredential = { token: string; field: 'search_access_token' | 'user_access_token'; reason: null }
    | { token: null; field: null; reason: 'VK_SEARCH_API_TOKEN_REQUIRED' | 'VK_SEARCH_TOKEN_KIND_UNSUPPORTED' | 'VK_SEARCH_CHANNEL_CONFIG_INVALID' };

/** Classic VK API user/service tokens only; this cannot establish actual provider permissions. */
export function supportedVkSearchToken(token: string): boolean {
    return token.length > 0 && token.length <= 8192 && !/\s/.test(token) && !/^vk2\.|^enc:/i.test(token) && token !== '******';
}

/** Uses explicit search credentials, then legacy user credentials; never publication or session secrets. */
export function resolveVkSearchCredential(config: unknown): VkSearchCredential {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) return { token: null, field: null, reason: 'VK_SEARCH_CHANNEL_CONFIG_INVALID' };
    const search = parsed.data.search_access_token?.trim();
    const user = parsed.data.user_access_token?.trim();
    const field = search ? 'search_access_token' : 'user_access_token';
    const token = field === 'search_access_token' ? search : user;
    if (!token) return { token: null, field: null, reason: 'VK_SEARCH_API_TOKEN_REQUIRED' };
    if (!supportedVkSearchToken(token)) return { token: null, field: null, reason: 'VK_SEARCH_TOKEN_KIND_UNSUPPORTED' };
    return { token, field, reason: null };
}

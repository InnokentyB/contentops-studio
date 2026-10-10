import { decryptChannelSecret, encryptChannelSecret } from './channel_secrets';
import { supportedVkSearchToken } from '../services/vk_search/credentials';

const DZEN_TYPES = new Set(['zen', 'zen_article', 'dzen']);
const ENCRYPTED_SECRET_FIELDS: Record<string, string[]> = {
    vk: ['search_access_token', 'publish_access_token', 'user_access_token', 'vk_oauth_access_token', 'stats_access_token', 'vk_refresh_token', 'vk_device_id'],
    threads: ['access_token']
};

/** Removes an explicitly cleared search key from current and legacy snapshots only. */
function withoutVkSearchCredential(config: unknown): Record<string, unknown> {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
    const cleared = { ...config as Record<string, unknown> };
    delete cleared.search_access_token;
    delete cleared.search_access_token_encrypted;
    if (cleared.raw_account && typeof cleared.raw_account === 'object') {
        cleared.raw_account = withoutVkSearchCredential(cleared.raw_account);
    }
    return cleared;
}

/**
 * Sanitize channel configuration before returning it to the client by masking secrets.
 */
export function sanitizeChannelConfig(type: string, config: any): any {
    if (!config || typeof config !== 'object') return config;
    const sanitized = { ...config };
    if (sanitized.raw_account && typeof sanitized.raw_account === 'object') {
        sanitized.raw_account = sanitizeChannelConfig(type, sanitized.raw_account);
    }
    
    // Mask sensitive fields
    if (sanitized.api_key) sanitized.api_key = '******';
    if (sanitized.search_access_token) sanitized.search_access_token = '******';
    if (sanitized.publish_access_token) sanitized.publish_access_token = '******';
    if (sanitized.user_access_token) sanitized.user_access_token = '******';
    if (sanitized.vk_oauth_access_token) sanitized.vk_oauth_access_token = '******';
    if (sanitized.stats_access_token) sanitized.stats_access_token = '******';
    if (sanitized.vk_refresh_token) sanitized.vk_refresh_token = '******';
    if (sanitized.vk_device_id) sanitized.vk_device_id = '******';
    if (sanitized.access_token) sanitized.access_token = '******';
    if (sanitized.cookies) sanitized.cookies = '******';
    if (sanitized.cookies_encrypted) {
        sanitized.cookies = '******';
        delete sanitized.cookies_encrypted;
    }
    if (sanitized.application_secret_key) sanitized.application_secret_key = '******';
    for (const field of ENCRYPTED_SECRET_FIELDS[type] || []) {
        const encryptedField = `${field}_encrypted`;
        if (sanitized[encryptedField]) {
            sanitized[field] = '******';
            delete sanitized[encryptedField];
        }
    }
    
    return sanitized;
}

/**
 * Merge incoming configuration with existing channel configuration to preserve masked secrets.
 */
export function mergeChannelConfig(incomingConfig: any, existingConfig: any): any {
    if (!existingConfig || typeof existingConfig !== 'object') return incomingConfig;
    const merged = { ...incomingConfig };

    if (merged.raw_account && existingConfig.raw_account
        && typeof merged.raw_account === 'object' && typeof existingConfig.raw_account === 'object') {
        merged.raw_account = mergeChannelConfig(merged.raw_account, existingConfig.raw_account);
    }
    
    const secretKeys = ['api_key', 'search_access_token', 'publish_access_token', 'user_access_token', 'vk_oauth_access_token', 'stats_access_token', 'vk_refresh_token', 'vk_device_id', 'access_token', 'cookies', 'application_secret_key'];
    for (const key of secretKeys) {
        if (merged[key] === '******' && existingConfig[key]) {
            merged[key] = existingConfig[key];
        }
        const encryptedKey = `${key}_encrypted`;
        if (merged[key] === '******' && existingConfig[encryptedKey]) {
            delete merged[key];
            merged[encryptedKey] = existingConfig[encryptedKey];
        }
    }

    if (merged.cookies === '******' && existingConfig.cookies_encrypted) {
        delete merged.cookies;
        merged.cookies_encrypted = existingConfig.cookies_encrypted;
    }
    for (const field of ENCRYPTED_SECRET_FIELDS.vk) {
        const encryptedField = `${field}_encrypted`;
        if ((merged[field] === '******' || merged[field] === undefined) && existingConfig[encryptedField]) {
            delete merged[field];
            merged[encryptedField] = existingConfig[encryptedField];
        }
    }
    
    if (typeof incomingConfig.search_access_token === 'string' && !incomingConfig.search_access_token.trim()) {
        if (merged.raw_account === undefined && existingConfig.raw_account) merged.raw_account = existingConfig.raw_account;
        return withoutVkSearchCredential(merged);
    }
    return merged;
}

export function prepareChannelConfigForStorage(type: string, config: any): any {
    const prepared = { ...(config || {}) };
    if (type === 'threads') {
        if (prepared.raw_account && typeof prepared.raw_account === 'object') {
            prepared.raw_account = prepareChannelConfigForStorage(type, prepared.raw_account);
        }
        const accessToken = typeof prepared.access_token === 'string' ? prepared.access_token.trim() : '';
        if (accessToken && accessToken !== '******') {
            prepared.access_token_encrypted = encryptChannelSecret(accessToken);
        }
        delete prepared.access_token;
        return prepared;
    }
    if (type === 'vk') {
        if (typeof prepared.search_access_token === 'string' && !prepared.search_access_token.trim()) {
            return prepareChannelConfigForStorage(type, withoutVkSearchCredential(prepared));
        }
        if (prepared.raw_account && typeof prepared.raw_account === 'object') {
            prepared.raw_account = prepareChannelConfigForStorage(type, prepared.raw_account);
        }
        if (prepared.search_access_token !== undefined && typeof prepared.search_access_token !== 'string') {
            throw new Error('[VK_SEARCH_CHANNEL_CONFIG_INVALID] Search credential must be a string');
        }
        const searchToken = typeof prepared.search_access_token === 'string' ? prepared.search_access_token.trim() : '';
        if ((!searchToken || searchToken === '******') && prepared.search_access_token_encrypted !== undefined) {
            let encryptedToken: string;
            try {
                if (typeof prepared.search_access_token_encrypted !== 'string') throw new Error('Invalid encrypted search key');
                encryptedToken = decryptChannelSecret(prepared.search_access_token_encrypted);
            } catch {
                throw new Error('[VK_SEARCH_CHANNEL_CONFIG_INVALID] Encrypted search credential is invalid');
            }
            if (!supportedVkSearchToken(encryptedToken)) {
                throw new Error('[VK_SEARCH_TOKEN_KIND_UNSUPPORTED] Use a classic VK API user or service search credential');
            }
        }
        if (searchToken && searchToken !== '******' && !supportedVkSearchToken(searchToken)) {
            throw new Error('[VK_SEARCH_TOKEN_KIND_UNSUPPORTED] Use a classic VK API user or service search credential');
        }
        for (const field of ['publish_access_token', 'user_access_token']) {
            const value = typeof prepared[field] === 'string' ? prepared[field].trim() : '';
            if (/^vk2\./i.test(value)) {
                throw new Error(`${field} cannot use a VK ID vk2 token; provide a VK API publishing token`);
            }
        }
        for (const field of ENCRYPTED_SECRET_FIELDS.vk) {
            const value = typeof prepared[field] === 'string' ? prepared[field].trim() : '';
            if (value && value !== '******') prepared[`${field}_encrypted`] = encryptChannelSecret(value);
            delete prepared[field];
        }
        return prepared;
    }
    if (!DZEN_TYPES.has(type)) return prepared;

    if (prepared.raw_account && typeof prepared.raw_account === 'object') {
        prepared.raw_account = prepareChannelConfigForStorage(type, prepared.raw_account);
    }

    const cookies = typeof prepared.cookies === 'string' ? prepared.cookies.trim() : '';
    if (cookies && cookies !== '******') {
        prepared.cookies_encrypted = encryptChannelSecret(cookies);
    }
    delete prepared.cookies;
    return prepared;
}

export function resolveChannelConfigSecrets(type: string, config: any): any {
    const resolved = { ...(config || {}) };
    if (type === 'threads') {
        if (resolved.raw_account && typeof resolved.raw_account === 'object') {
            resolved.raw_account = resolveChannelConfigSecrets(type, resolved.raw_account);
        }
        if (!resolved.access_token && typeof resolved.access_token_encrypted === 'string') {
            resolved.access_token = decryptChannelSecret(resolved.access_token_encrypted);
        }
        delete resolved.access_token_encrypted;
        return resolved;
    }
    if (type === 'vk') {
        if (resolved.raw_account && typeof resolved.raw_account === 'object') {
            resolved.raw_account = resolveChannelConfigSecrets(type, resolved.raw_account);
        }
        for (const field of ENCRYPTED_SECRET_FIELDS.vk) {
            const encryptedField = `${field}_encrypted`;
            if (!resolved[field] && typeof resolved[encryptedField] === 'string') {
                resolved[field] = decryptChannelSecret(resolved[encryptedField]);
            }
            delete resolved[encryptedField];
        }
        return resolved;
    }
    if (!DZEN_TYPES.has(type)) return resolved;

    if (resolved.raw_account && typeof resolved.raw_account === 'object') {
        resolved.raw_account = resolveChannelConfigSecrets(type, resolved.raw_account);
        if (!resolved.cookies && resolved.raw_account.cookies) {
            resolved.cookies = resolved.raw_account.cookies;
        }
    }

    if (!resolved.cookies && typeof resolved.cookies_encrypted === 'string') {
        resolved.cookies = decryptChannelSecret(resolved.cookies_encrypted);
    }
    delete resolved.cookies_encrypted;
    return resolved;
}

/**
 * Return the executable channel configuration from both legacy raw_account
 * payloads and current top-level settings. Current settings win so an owner
 * can rotate credentials without leaving workers on a stale nested snapshot.
 */
export function resolveEffectiveChannelConfig(type: string, config: any): any {
    const topLevel = config && typeof config === 'object' ? config : {};
    const rawAccount = topLevel.raw_account && typeof topLevel.raw_account === 'object'
        ? topLevel.raw_account
        : {};
    const { raw_account: _rawAccount, ...currentSettings } = topLevel;

    const searchCredentialOverride = type === 'vk'
        && typeof currentSettings.search_access_token_encrypted === 'string'
        && currentSettings.search_access_token === undefined
        ? { search_access_token: undefined } : {};
    return resolveChannelConfigSecrets(type, {
        ...rawAccount,
        ...searchCredentialOverride,
        ...currentSettings
    });
}

/**
 * Clean up, format, and append hashtags to a post text, ensuring no duplicates or double hashes.
 */
export function cleanAndFormatHashtags(text: string, tags: string[], category?: string): string {
    let fullText = text || '';
    
    // Clean up any existing double hashtags generated by LLM (e.g. ##tag -> #tag)
    fullText = fullText.replace(/#+#/g, '#').replace(/##+/g, '#');

    if (tags && tags.length > 0) {
        const hashtagsToAppend = tags
            .map(t => `#${t.replace(/\s+/g, '').replace(/^#+/, '')}`)
            .filter(tag => {
                // Prevent duplicate addition of tags if already present in body text
                const escapedTag = tag.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                const regex = new RegExp(escapedTag + '\\b', 'i');
                return !regex.test(fullText);
            });

        if (hashtagsToAppend.length > 0) {
            fullText = fullText.trim() + '\n\n' + hashtagsToAppend.join(' ');
        }
    } else if (category) {
        const catTag = `#${category.replace(/\s+/g, '').replace(/^#+/, '')}`;
        const escapedCatTag = catTag.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(escapedCatTag + '\\b', 'i');
        if (!regex.test(fullText)) {
            fullText = fullText.trim() + '\n\n' + catTag;
        }
    }

    // Final sweep to remove any accidental double hashtag artifacts
    fullText = fullText.replace(/#+#/g, '#').replace(/##+/g, '#');
    return fullText;
}

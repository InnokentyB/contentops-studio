import { oauthFailureCopy } from './linkedin-oauth-failure-copy';
export type ConnectionLocale = 'ru' | 'en';
export type LinkedInChannel = { id: number; name: string; type: string; config?: Record<string, unknown> };
export type ConnectionStatus = {
    connected: boolean; expiresAt: string | null; scopes: string[]; accountKind: string | null;
    postReadVerified: boolean; imageReadPermitted: boolean; code: string;
    latestAttempt: { status: string; createdAt: string; code: string | null; expectedAuthorUrn: string | null } | null;
};
const record = (input: unknown): Record<string, unknown> => input !== null && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
export function readConnectionStatus(input: unknown, channelId: number): ConnectionStatus | null {
    const value = record(input);
    if (value.channelId !== channelId || typeof value.connected !== 'boolean' || !Array.isArray(value.scopes)
        || !value.scopes.every(scope => typeof scope === 'string' && /^[A-Za-z0-9_]{1,100}$/.test(scope))
        || value.scopes.length > 100 || typeof value.postReadVerified !== 'boolean' || typeof value.imageReadPermitted !== 'boolean'
        || typeof value.code !== 'string' || !/^LINKEDIN_OAUTH_[A-Z_]{1,80}$/.test(value.code)
        || (value.connected && typeof value.expiresAt !== 'string')
        || (value.expiresAt !== null && (typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))))) return null;
    return { connected: value.connected, expiresAt: value.expiresAt, scopes: value.scopes,
        accountKind: value.accountKind === 'personal' || value.accountKind === 'organization' ? value.accountKind : null,
        postReadVerified: value.postReadVerified, imageReadPermitted: value.imageReadPermitted, code: value.code,
        latestAttempt: readLatestAttempt(value.latestAttempt) };
}
function readLatestAttempt(input: unknown): ConnectionStatus['latestAttempt'] {
    const value = record(input);
    if (typeof value.status !== 'string' || !['pending', 'exchanging', 'completed', 'failed', 'expired'].includes(value.status)
        || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) return null;
    const expected = value.expectedAuthorUrn;
    return { status: value.status, createdAt: value.createdAt,
        code: typeof value.code === 'string' && Object.hasOwn(diagnostics, value.code) ? value.code : null,
        expectedAuthorUrn: typeof expected === 'string' && expected.length <= 200 && /^urn:li:(person:[A-Za-z0-9_-]+|organization:[0-9]+)$/.test(expected) ? expected : null };
}
export function savedAuthor(channel: LinkedInChannel): string {
    const urn = channel.config?.linkedin_urn;
    return typeof urn === 'string' && /^urn:li:(person:[A-Za-z0-9_-]+|organization:[0-9]+)$/.test(urn) ? urn : '';
}
/** Mirror the existing server's saved-profile path; a public slug never becomes a fabricated person URN. */
export function savedPersonalProfile(channel: LinkedInChannel): string {
    if (savedAuthor(channel) || channel.config?.account_type === 'organization') return '';
    let slug = '';
    for (const field of ['profile_url', 'channel_url', 'account_ref']) {
        const value = channel.config?.[field];
        if (typeof value !== 'string') continue;
        let url: URL;
        try { url = new URL(value); } catch { continue; /* Invalid saved URLs cannot establish a profile. */ }
        if (url.protocol !== 'https:' || !['www.linkedin.com', 'linkedin.com'].includes(url.hostname)
            || url.username || url.password || url.search || url.hash) continue;
        const match = url.pathname.match(/^\/in\/([A-Za-z0-9_-]+)\/?$/);
        if (!match) continue;
        if (slug && slug !== match[1]) return '';
        slug = match[1];
    }
    return slug ? `https://www.linkedin.com/in/${slug}/` : '';
}
const diagnostics: Record<string, [string, string]> = {
    ...oauthFailureCopy,
    LINKEDIN_OAUTH_GRANTS_UNKNOWN: ['Planner не подтвердил идентичность, срок действия или выданные права. Подключение не завершено; требуется проверка OAuth.', 'Planner could not verify identity, expiry or permissions. Connection is incomplete; OAuth needs investigation.'],
    LINKEDIN_OAUTH_POST_READ_REQUIRED: ['Аккаунт подключён, но право чтения публикаций не подтверждено. Проверьте разрешения приложения перед публикацией.', 'Account connected, but post-read permission is not verified. Review app permissions before publishing.'],
    LINKEDIN_OAUTH_AUTH_REQUIRED: ['Подключать канал может только владелец проекта. Войдите под его учётной записью.', 'Only the project Owner can connect this channel. Sign in with that account.'],
    LINKEDIN_OAUTH_EXPECTED_IDENTITY_REQUIRED: ['Укажите точный идентификатор профиля или компании для этого канала.', 'Enter the exact profile or organization identifier for this channel.'],
    LINKEDIN_OAUTH_IDENTITY_MISMATCH: ['LinkedIn вернул другой аккаунт. Проверьте выбранный профиль и идентификатор канала.', 'LinkedIn returned a different account. Check the signed-in profile and channel identity.'],
    LINKEDIN_OAUTH_ORGANIZATION_UNVERIFIED: ['Не подтверждено право публиковать от имени компании. Проверьте роль администратора страницы и разрешения приложения.', 'Organization publishing authority was not verified. Check the page administrator role and app permissions.'],
    LINKEDIN_OAUTH_BROWSER_MISMATCH: ['Завершите подключение в том же браузере, где начали, с разрешёнными cookie.', 'Complete connection in the same browser with cookies enabled.'],
    LINKEDIN_OAUTH_STATE_INVALID: ['Запрос подключения истёк или недействителен. Начните новое подключение из карточки канала.', 'Connection request expired or is invalid. Start a new connection from the channel.'],
    LINKEDIN_OAUTH_ALREADY_USED: ['Этот запрос уже использован. Проверьте состояние канала перед новым подключением.', 'This request has already been used. Check channel status before reconnecting.'],
    LINKEDIN_OAUTH_PROVIDER_DENIED: ['Доступ не подтверждён в LinkedIn. Подключите канал заново, если хотите предоставить доступ.', 'Access was not approved in LinkedIn. Reconnect if you want to grant access.'],
    LINKEDIN_OAUTH_CONFIG_REQUIRED: ['Настройки приложения или адрес возврата неполны. Администратору нужно проверить конфигурацию OAuth.', 'Application or callback configuration is incomplete. Ask the administrator to check OAuth settings.'],
    LINKEDIN_OAUTH_CHANNEL_CHANGED: ['Настройки канала изменились во время подключения. Проверьте карточку перед новой попыткой.', 'Channel settings changed during connection. Review the channel before starting again.'],
    LINKEDIN_OAUTH_CONNECTION_UNREADABLE: ['Planner не смог прочитать защищённое подключение. Требуется проверка ключа шифрования администратором.', 'Planner could not read the protected connection. An administrator must check the encryption key.'],
    LINKEDIN_OAUTH_PROVIDER_UNAVAILABLE: ['LinkedIn не вернул ожидаемый ответ. Требуется проверка подключения; публикация не запускалась.', 'LinkedIn did not return an expected response. Connection needs investigation; no publication was started.'],
    LINKEDIN_OAUTH_SAVE_FAILED: ['Подключение не сохранено. Проверьте состояние канала; повторно открывать старую ссылку OAuth нельзя.', 'Connection was not saved. Check channel status; do not reuse the old OAuth URL.'],
};
export function connectionDiagnostic(code: unknown, locale: ConnectionLocale): string {
    const safeCode = typeof code === 'string' && Object.hasOwn(diagnostics, code) ? code : '';
    return diagnostics[safeCode]?.[locale === 'ru' ? 0 : 1]
        || (locale === 'ru' ? 'Не удалось проверить подключение. Обновите состояние канала; если ошибка повторится, нужна проверка интеграции.' : 'Connection could not be checked. Refresh channel status; a repeated error needs integration investigation.');
}
export function responseCode(input: unknown): unknown { return record(input).code; }
export function connectionRedirect(input: unknown): string | null {
    const value = record(input).url;
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname === 'www.linkedin.com' && url.pathname === '/oauth/v2/authorization'
            && !url.username && !url.password && !url.port && !url.hash ? value : null;
    } catch { return null; /* Invalid destinations are never navigated to. */ }
}

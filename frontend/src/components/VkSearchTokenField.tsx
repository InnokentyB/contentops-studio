import type { ReactElement } from 'react';

interface Props {
    id: string;
    locale: 'ru' | 'en';
    value: unknown;
    onChange(value: string): void;
}

/** Separate public-search credential; never replaces the community publishing key. */
export function VkSearchTokenField({ id, locale, value, onChange }: Props): ReactElement {
    const token = typeof value === 'string' ? value : '';
    const saved = token === '******';
    return <div style={{ gridColumn: '1 / -1' }}>
        <label htmlFor={id} style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>
            {locale === 'ru' ? 'Ключ VK API для поиска' : 'VK API search token'}
        </label>
        <input id={id} type="password" autoComplete="new-password" className="w-full"
            aria-describedby={`${id}-help`} value={token}
            onChange={event => onChange(event.target.value)}
            placeholder={locale === 'ru' ? 'Сервисный или классический пользовательский ключ' : 'Service or classic user API token'}
            style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }} />
        <div id={`${id}-help`} className="text-xs text-on-surface-variant mt-1">
            {locale === 'ru'
                ? 'Используйте сервисный ключ вашего приложения VK API или классический пользовательский токен. Ключ сообщества остаётся в поле публикации; подключение VK ID не заполняет ключ поиска. Если поле пустое, поиск использует имеющийся классический пользовательский токен.'
                : 'Use your VK API application service key or a classic user token. Keep the community key in the publishing field; connecting VK ID does not supply a search key. If empty, search uses the existing classic user token.'}
            {saved && (locale === 'ru' ? ' Ключ сохранён; маска сохраняет прежнее значение.' : ' Saved; the mask preserves the existing key.')}
        </div>
    </div>;
}

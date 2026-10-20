import { useEffect, useRef, useState } from 'react';
import { connectionDiagnostic, connectionRedirect, readConnectionStatus, responseCode, savedAuthor, savedPersonalProfile,
    type ConnectionLocale, type ConnectionStatus, type LinkedInChannel } from './linkedin-connection-state';

export function LinkedInConnectionControl({ projectId, token, channel, disabled, locale }: {
    projectId: number; token: string; channel: LinkedInChannel; disabled: boolean; locale: ConnectionLocale;
}) {
    const ru = locale === 'ru';
    const [expectedUrn, setExpectedUrn] = useState(() => savedAuthor(channel));
    const [pending, setPending] = useState(false);
    const [failure, setFailure] = useState('');
    const [status, setStatus] = useState<ConnectionStatus | null>(null);
    const [checking, setChecking] = useState(false);
    const [refresh, setRefresh] = useState(0);
    const connecting = useRef(false);
    const authorEdited = useRef(false);
    const initialAuthor = savedAuthor(channel);
    const personalProfile = savedPersonalProfile(channel);
    const personalChannel = Boolean(personalProfile || channel.config?.account_type === 'personal');
    useEffect(() => { setExpectedUrn(initialAuthor); setFailure(''); connecting.current = false; authorEdited.current = false; setPending(false); }, [projectId, channel.id, initialAuthor, personalProfile]);
    useEffect(() => {
        setStatus(null); setFailure('');
        if (disabled) { setChecking(false); return; }
        const abort = new AbortController();
        setChecking(true);
        async function check(): Promise<void> {
            try {
                const response = await fetch(`/api/auth/linkedin/status?projectId=${projectId}&channelId=${channel.id}`, {
                    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
                });
                const body: unknown = await response.json();
                if (abort.signal.aborted) return;
                const parsed = response.ok ? readConnectionStatus(body, channel.id) : null;
                if (parsed) {
                    setStatus(parsed);
                    const draft = parsed.latestAttempt?.expectedAuthorUrn;
                    if (!initialAuthor && !personalProfile && !authorEdited.current && draft
                        && (!personalChannel || draft.startsWith('urn:li:person:'))) setExpectedUrn(draft);
                }
                else setFailure(connectionDiagnostic(responseCode(body), locale));
            } catch {
                if (!abort.signal.aborted) setFailure(connectionDiagnostic(null, locale));
            } finally { if (!abort.signal.aborted) setChecking(false); }
        }
        void check();
        return () => abort.abort();
    }, [projectId, channel.id, token, disabled, refresh, locale, initialAuthor, personalProfile, personalChannel]);
    const validUrn = /^urn:li:(person:[A-Za-z0-9_-]+|organization:[0-9]+)$/.test(expectedUrn.trim());
    const validIdentity = (validUrn && (!personalChannel || expectedUrn.trim().startsWith('urn:li:person:')))
        || Boolean(personalProfile && !expectedUrn.trim());
    async function connect(): Promise<void> {
        if (disabled || connecting.current || !validIdentity) return;
        connecting.current = true; setPending(true); setFailure('');
        try {
            const authorQuery = expectedUrn.trim() ? `&expectedAuthorUrn=${encodeURIComponent(expectedUrn.trim())}` : '';
            const response = await fetch(`/api/auth/linkedin/connect?projectId=${projectId}&channelId=${channel.id}${authorQuery}`, {
                headers: { Authorization: `Bearer ${token}` }, credentials: 'include', signal: AbortSignal.timeout(15000),
            });
            const body: unknown = await response.json();
            const target = response.ok ? connectionRedirect(body) : null;
            if (!target) { setFailure(connectionDiagnostic(responseCode(body), locale)); connecting.current = false; setPending(false); return; }
            window.location.assign(target);
        } catch { setFailure(connectionDiagnostic(null, locale)); connecting.current = false; setPending(false); }
    }
    const expired = status?.expiresAt ? Date.parse(status.expiresAt) <= Date.now() : false;
    const connected = Boolean(status?.connected && !expired && ['LINKEDIN_OAUTH_CONNECTED', 'LINKEDIN_OAUTH_POST_READ_REQUIRED'].includes(status.code));
    const title = checking ? (ru ? 'Проверяем подключение…' : 'Checking connection…')
        : connected ? (ru ? 'Аккаунт подключён' : 'Account connected')
            : expired ? (ru ? 'Срок доступа истёк' : 'Access expired')
                : status ? (ru ? 'Подключение не завершено' : 'Connection incomplete')
                    : (ru ? 'Подключение не проверено' : 'Connection not checked');
    const yesNo = (value: boolean) => value ? (ru ? 'Подтверждено' : 'Verified') : (ru ? 'Не подтверждено' : 'Not verified');
    const authorId = `linkedin-author-${channel.id}`;
    const attemptLabels: Record<string, string> = { failed: ru ? 'Ошибка' : 'Failed', completed: ru ? 'Завершена' : 'Completed', pending: ru ? 'Ожидает возврата из LinkedIn' : 'Awaiting return from LinkedIn', exchanging: ru ? 'Проверка доступа начата' : 'Verification started', expired: ru ? 'Запрос истёк' : 'Request expired' };
    return <section className="linkedin-connection sm:col-span-2" aria-labelledby={`linkedin-heading-${channel.id}`}>
        <header className="linkedin-connection__heading">
            <div><h3 id={`linkedin-heading-${channel.id}`}>{ru ? 'Подключение LinkedIn' : 'LinkedIn connection'}</h3>
                <p>{ru ? 'Аккаунт и права для этого канала' : 'Account and permissions for this channel'}</p></div>
            <span className={`linkedin-connection__status ${connected ? 'linkedin-connection__status--connected' : ''}`} role="status">{title}</span>
        </header>
        {disabled && <p className="linkedin-connection__notice">{connectionDiagnostic('LINKEDIN_OAUTH_AUTH_REQUIRED', locale)}</p>}
        <div className="linkedin-connection__identity">
            <label htmlFor={authorId}>{personalProfile ? (ru ? 'Личный профиль' : 'Personal profile') : (ru ? 'Идентификатор профиля или компании' : 'Profile or organization identifier')}</label>
            <input id={authorId} value={personalProfile || expectedUrn} onChange={event => { authorEdited.current = true; setExpectedUrn(event.target.value); }}
                placeholder="urn:li:organization:…" autoComplete="off" spellCheck={false}
                readOnly={Boolean(initialAuthor || personalProfile)} disabled={disabled || pending}
                aria-describedby={`${authorId}-help`} aria-invalid={Boolean(expectedUrn && !validIdentity)} />
            <p id={`${authorId}-help`}>{personalProfile
                ? (ru ? 'Подключаем сохранённый личный профиль. LinkedIn подтвердит его ID при входе; идентификатор компании здесь не нужен.' : 'Connect the saved personal profile. LinkedIn will verify its ID during sign-in; no organization identifier is needed here.')
                : initialAuthor
                ? (ru ? 'Сохранённая привязка этого канала. Смена аккаунта требует отдельной проверки.' : 'Saved channel identity. Changing the account requires a separate review.')
                : status?.latestAttempt?.expectedAuthorUrn === expectedUrn
                    ? (ru ? 'Ожидаемый аккаунт из прошлой попытки. Это черновик, а не подтверждённая привязка: проверьте его перед подключением.' : 'Expected account from the previous attempt. This is a draft, not a verified binding; check it before connecting.')
                    : (ru ? 'Для компании: urn:li:organization:числовой ID. Для профиля: urn:li:person:ID. Привязка сохранится после успешного OAuth.' : 'Company: urn:li:organization:numeric ID. Profile: urn:li:person:ID. Identity is saved after successful OAuth.')}</p>
        </div>
        {personalChannel && expectedUrn.trim().startsWith('urn:li:organization:') && <p className="linkedin-connection__notice" role="alert">{ru ? 'Это личный канал. Идентификатор компании нельзя использовать для подключения личного профиля.' : 'This is a personal channel. An organization identifier cannot connect a personal profile.'}</p>}
        {failure && <p className="linkedin-connection__notice" role="alert">{failure}</p>}
        {status && !checking && <>
            {status.latestAttempt && <div className="linkedin-connection__notice" aria-label={ru ? 'Последняя попытка подключения' : 'Latest connection attempt'}>
                <h4>{ru ? 'Последняя попытка подключения' : 'Latest connection attempt'}</h4>
                <p>{new Date(status.latestAttempt.createdAt).toLocaleString(ru ? 'ru-RU' : 'en-GB')}{' · '}
                    {attemptLabels[status.latestAttempt.status]}</p>
                {status.latestAttempt.code && <><p>{connectionDiagnostic(status.latestAttempt.code, locale)}</p><code className="break-all text-xs">{status.latestAttempt.code}</code></>}
                {status.latestAttempt.code === 'LINKEDIN_OAUTH_GRANTS_UNKNOWN' && <p>{ru ? 'Это прежняя общая ошибка. Её точную причину восстановить нельзя; новая попытка сохранит отдельный код причины.' : 'This is a previous generic error. Its exact cause cannot be recovered; a new attempt will retain a specific reason.'}</p>}
            </div>}
            {status.code !== 'LINKEDIN_OAUTH_CONNECTED' && <p className="linkedin-connection__notice">{connectionDiagnostic(status.code, locale)}</p>}
            <dl className="linkedin-connection__facts">
                <div><dt>{ru ? 'Тип аккаунта' : 'Account type'}</dt><dd>{status.accountKind === 'organization' ? (ru ? 'Страница компании' : 'Company page') : status.accountKind === 'personal' ? (ru ? 'Личный профиль' : 'Personal profile') : '—'}</dd></div>
                <div><dt>{ru ? 'Доступ действует до' : 'Access expires'}</dt><dd>{status.expiresAt ? new Date(status.expiresAt).toLocaleString(ru ? 'ru-RU' : 'en-GB') : '—'}</dd></div>
                <div><dt>{ru ? 'Чтение публикаций' : 'Post reading'}</dt><dd>{yesNo(status.postReadVerified && connected)}</dd></div>
                <div><dt>{ru ? 'Право чтения изображений' : 'Image-read permission'}</dt><dd>{yesNo(status.imageReadPermitted && connected)}</dd></div>
            </dl>
            <div className="linkedin-connection__grants"><h4>{ru ? 'Выданные права LinkedIn' : 'Granted LinkedIn permissions'}</h4>
                {status.scopes.length ? <ul>{status.scopes.map(scope => <li key={scope}><code>{scope}</code></li>)}</ul>
                    : <p>{ru ? 'Подтверждённые права пока не сохранены.' : 'No verified permissions have been saved yet.'}</p>}</div>
        </>}
        <footer className="linkedin-connection__footer">
            <div className="linkedin-connection__actions">
                <button type="button" className="linkedin-connection__primary" onClick={() => void connect()} disabled={disabled || pending || !validIdentity}>
                    {pending ? (ru ? 'Открываем LinkedIn…' : 'Opening LinkedIn…') : connected ? (ru ? 'Переподключить LinkedIn' : 'Reconnect LinkedIn') : (ru ? 'Подключить LinkedIn' : 'Connect LinkedIn')}</button>
                <button type="button" onClick={() => setRefresh(value => value + 1)} disabled={disabled || checking || pending}>
                    {checking ? (ru ? 'Проверяем…' : 'Checking…') : (ru ? 'Проверить подключение' : 'Check connection')}</button>
            </div>
            <p>{ru ? 'Проверка читает сохранённое состояние в Planner. Подключение не включает публикации; доступ к конкретному изображению проверяется при подготовке поста.' : 'The check reads saved Planner state. Connecting does not enable publishing; access to the exact image is checked during post preparation.'}</p>
        </footer>
    </section>;
}

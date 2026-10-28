type ChannelConfig = Record<string, unknown>;
function record(value: unknown): value is ChannelConfig {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validDomain(value: string): boolean {
    return value.length <= 253 && value.split('.').length >= 2
        && value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
        && /[a-z]/i.test(value.split('.').at(-1) || '');
}
/** Existing full-config Owner save; this editor changes no field unless its control is edited. */
export function TildaChannelEditor({ channelId, name, config, locale, disabled, saving, onName, onConfig, onSave, onClose }: {
    channelId: number; name: string; config: ChannelConfig; locale: 'ru' | 'en'; disabled: boolean; saving: boolean;
    onName(value: string): void; onConfig(value: ChannelConfig): void; onSave(): void; onClose(): void;
}) {
    const ru = locale === 'ru', prefix = `tilda-${channelId}`, locked = disabled || saving;
    const raw = record(config.raw_account) ? config.raw_account : null;
    const domain = typeof raw?.domain === 'string' ? raw.domain : '';
    const conflict = typeof config.domain === 'string' && config.domain !== domain;
    const domainValid = raw !== null && !conflict && validDomain(domain);
    const workflow = typeof config.workflow_mode === 'string' ? config.workflow_mode : '';
    const language = typeof config.content_language === 'string' ? config.content_language : '';
    const knownWorkflow = ['prepare_only', 'manual_handoff', 'approval_required', 'auto_publish'].includes(workflow);
    const knownLanguage = ['ru', 'en'].includes(language);
    return <section className="rounded-xl border border-outline-variant bg-surface-container-low p-4">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold">{ru ? 'Настройки Tilda' : 'Tilda settings'}</h3>
            <button type="button" data-action="close" className="btn-secondary" disabled={saving} onClick={onClose}>{ru ? 'Отмена' : 'Cancel'}</button>
        </header>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><label htmlFor={`${prefix}-name`}>{ru ? 'Название канала' : 'Channel name'}</label>
                <input id={`${prefix}-name`} value={name} disabled={locked} onChange={event => onName(event.target.value)} /></div>
            <div><label htmlFor={`${prefix}-domain`}>{ru ? 'Домен сайта' : 'Site domain'}</label>
                <input id={`${prefix}-domain`} name="tilda-domain" value={domain} maxLength={253} autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    aria-invalid={!domainValid} aria-describedby={`${prefix}-domain-help`} disabled={locked || raw === null || conflict}
                    onChange={event => { if (raw) onConfig({ ...config, raw_account: { ...raw, domain: event.target.value } }); }} />
                <p id={`${prefix}-domain-help`} role={domainValid ? undefined : 'alert'} className="mt-1 text-xs leading-5 text-on-surface-variant">
                    {domainValid
                        ? (ru ? 'Только домен, без https:// и пути. Это не включает публикацию.' : 'Hostname only, without https:// or a path. This does not enable publishing.')
                        : (ru ? 'Нужен корректный hostname. При отсутствующей или конфликтующей конфигурации обновите настройки и обратитесь к администратору.' : 'Enter a valid hostname. If configuration is missing or conflicting, refresh settings and contact the administrator.')}</p></div>
            <div><label htmlFor={`${prefix}-workflow`}>{ru ? 'Режим работы' : 'Workflow'}</label>
                <select id={`${prefix}-workflow`} name="workflow-mode" value={workflow} disabled={locked} onChange={event => onConfig({ ...config, workflow_mode: event.target.value })}>
                    {!knownWorkflow && <option value={workflow} disabled>{workflow || (ru ? 'Не задан — сохраняется без изменений' : 'Unset — preserved unchanged')}</option>}
                    <option value="prepare_only">{ru ? 'Только подготовка' : 'Prepare only'}</option>
                    <option value="manual_handoff">{ru ? 'Ручная публикация' : 'Manual handoff'}</option>
                    <option value="approval_required">{ru ? 'После одобрения' : 'After approval'}</option>
                    <option value="auto_publish">{ru ? 'Автопубликация' : 'Auto-publish'}</option>
                </select></div>
            <div><label htmlFor={`${prefix}-language`}>{ru ? 'Язык контента' : 'Content language'}</label>
                <select id={`${prefix}-language`} value={language} disabled={locked} onChange={event => onConfig({ ...config, content_language: event.target.value })}>
                    {!knownLanguage && <option value={language} disabled>{language || (ru ? 'Не задан — сохраняется без изменений' : 'Unset — preserved unchanged')}</option>}
                    <option value="ru">{ru ? 'Русский' : 'Russian'}</option><option value="en">{ru ? 'Английский' : 'English'}</option>
                </select></div>
        </div>
        <button type="button" data-action="save-settings" className="btn-primary mt-4" disabled={locked || !name.trim() || !domainValid}
            onClick={() => { if (!locked && name.trim() && domainValid) onSave(); }}>{saving ? (ru ? 'Сохраняем…' : 'Saving…') : (ru ? 'Сохранить настройки' : 'Save settings')}</button>
    </section>;
}

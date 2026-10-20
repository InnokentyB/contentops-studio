import { LinkedInConnectionControl } from './LinkedInConnectionControl';
import type { ConnectionLocale, LinkedInChannel } from './linkedin-connection-state';

export function LinkedInChannelEditor({ projectId, token, channel, locale, disabled, name, config, saving, onName, onConfig, onSave, onClose }: {
    projectId: number; token: string; channel: LinkedInChannel; locale: ConnectionLocale; disabled: boolean;
    name: string; config: Record<string, unknown>; saving: boolean;
    onName(value: string): void; onConfig(value: Record<string, unknown>): void; onSave(): void; onClose(): void;
}) {
    const ru = locale === 'ru';
    const prefix = `channel-${channel.id}`;
    const workflow = typeof config.workflow_mode === 'string' ? config.workflow_mode : 'approval_required';
    return <section className="channel-editor rounded-xl bg-surface-container-low p-4 sm:p-6" aria-labelledby={`${prefix}-heading`}>
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h3 id={`${prefix}-heading`} className="min-w-0 break-words text-lg font-bold">{channel.name}</h3>
            <button type="button" className="rounded-lg px-3 py-2 text-sm font-semibold text-primary hover:bg-surface-container-high" onClick={onClose} disabled={saving}>{ru ? 'Закрыть' : 'Close'}</button>
        </header>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><label htmlFor={`${prefix}-name`}>{ru ? 'Название канала' : 'Channel name'}</label>
                <input id={`${prefix}-name`} value={name} onChange={event => onName(event.target.value)} disabled={disabled || saving} /></div>
            <div><label htmlFor={`${prefix}-workflow`}>{ru ? 'Режим работы' : 'Workflow'}</label>
                <select id={`${prefix}-workflow`} value={workflow} onChange={event => onConfig({ ...config, workflow_mode: event.target.value })} disabled={disabled || saving}>
                    <option value="prepare_only">{ru ? 'Только подготовка' : 'Prepare only'}</option>
                    <option value="approval_required">{ru ? 'Публикация после одобрения' : 'Publish after approval'}</option>
                    <option value="auto_publish">{ru ? 'Автопубликация' : 'Auto-publish'}</option>
                </select></div>
            <div><label htmlFor={`${prefix}-language`}>{ru ? 'Язык контента' : 'Content language'}</label>
                <select id={`${prefix}-language`} value={config.content_language === 'en' ? 'en' : 'ru'} onChange={event => onConfig({ ...config, content_language: event.target.value })} disabled={disabled || saving}>
                    <option value="ru">{ru ? 'Русский' : 'Russian'}</option><option value="en">{ru ? 'Английский' : 'English'}</option>
                </select></div>
            <div className="flex flex-wrap items-end gap-3">
                <button type="button" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-on-primary-fixed-variant disabled:opacity-50" onClick={onSave} disabled={disabled || saving || !name.trim()}>
                    {saving ? (ru ? 'Сохраняем…' : 'Saving…') : (ru ? 'Сохранить настройки' : 'Save settings')}</button>
                <p className="text-xs leading-5 text-on-surface-variant">{ru ? 'Название, режим и язык сохраняются отдельно от подключения аккаунта.' : 'Name, workflow and language are saved separately from account connection.'}</p>
            </div>
            <LinkedInConnectionControl key={`${projectId}:${channel.id}`} projectId={projectId} token={token} channel={channel} disabled={disabled} locale={locale} />
        </div>
    </section>;
}

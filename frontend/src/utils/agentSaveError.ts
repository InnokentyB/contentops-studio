import { ApiRequestError } from '../api';

/** Fixed localized guidance; no raw exception, key, prompt, URL or provider payload. */
export function agentSaveError(error: unknown, locale: 'ru' | 'en') {
    const known=error instanceof ApiRequestError &&
        ['SETTINGS_CACHE_SYNC_UNAVAILABLE','SETTINGS_SAVED_CACHE_SYNC_PENDING','AGENT_SETTINGS_SAVE_UNKNOWN'].includes(error.code || '');
    const state=known ? error.saveState : 'unknown';
    const ru=locale==='ru';
    const titles:Record<string,string>=ru ? {
        not_saved:'Настройки агента не сохранены', partially_saved:'Настройки агента сохранены частично',
        synchronization_pending:'Сохранение остановлено: ожидается синхронизация', unknown:'Результат сохранения настроек неизвестен'
    } : {
        not_saved:'Agent settings were not saved', partially_saved:'Agent settings were partially saved',
        synchronization_pending:'Save stopped: synchronization pending', unknown:'Agent settings save result is unknown'
    };
    const labels:Record<string,string>=ru ? {prompt:'Промпт',api_key:'Ключ API',model:'Модель'} : {prompt:'Prompt',api_key:'API key',model:'Model'};
    const outcomes:Record<string,string>=ru ? {saved:'сохранён',not_saved:'не сохранён',not_attempted:'не отправлялся',synchronization_pending:'сохранён; ожидается синхронизация',unknown:'результат неизвестен'} :
        {saved:'saved',not_saved:'not saved',not_attempted:'not attempted',synchronization_pending:'saved; synchronization pending',unknown:'result unknown'};
    const fields=known && error.fields ? Object.entries(error.fields).map(([field,outcome])=>`${labels[field]}: ${outcomes[outcome]}`).join('. ') : '';
    const guidance=state==='not_saved' ? (ru ? 'Синхронизация недоступна. Восстановите подключение Redis у приложения и MCP, затем повторите сохранение.' :
        'Synchronization is unavailable. Restore Redis connectivity for the app and MCP, then retry saving.') :
        (ru ? 'Не повторяйте сохранение вслепую. Проверьте сохранённые поля, сохранив черновик отдельно. При ошибке синхронизации восстановите Redis у приложения и MCP и проверьте очередь синхронизации настроек.' :
        'Do not repeat the save blindly. Check stored fields after keeping a separate copy of your draft. For synchronization errors, restore Redis for the app and MCP and check pending settings synchronization.');
    return {message:titles[state || 'unknown'] || titles.unknown,details:[fields,guidance].filter(Boolean).join('. ')};
}

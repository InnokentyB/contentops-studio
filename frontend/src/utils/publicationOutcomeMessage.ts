type Translate = (ru: string, en: string) => string

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Distinguishes a diagnostic or workflow handoff from provider publication; never renders raw fallback errors. */
export function publicationOutcomeMessage(value: unknown, tr: Translate): string {
    const outcome = record(value)
    if (typeof outcome.code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(outcome.code)
        && typeof outcome.message === 'string' && Array.isArray(outcome.reasons)) {
        const actions = outcome.reasons.flatMap(reason => {
            const action = record(reason).action
            return typeof action === 'string' ? [action] : []
        })
        return `[${outcome.code}] ${outcome.message} ${[...new Set(actions)].join(' ')}`
    }
    if (outcome.success === false || outcome.blocked === true) return tr(
        'Публикация не выполнена. Проверьте причины блокировки и существующие попытки; при неопределённом результате сначала выполните сверку, без повторной отправки.',
        'Publication was not completed. Inspect the blocker and existing attempts; reconcile an uncertain outcome before any resend.')
    if (outcome.browserRequired === true || outcome.manualFallback === true) return tr(
        'Публикация не подтверждена. Продолжите согласованный workflow через зарегистрированный адаптер и проверьте существующую попытку.',
        'Publication is not confirmed. Continue the approved workflow through the registered adapter and inspect the existing attempt.')
    return tr('Запрос обработан. Проверьте состояние задачи и подтверждённый факт публикации.',
        'The request was processed. Inspect the task state and confirmed publication fact.')
}

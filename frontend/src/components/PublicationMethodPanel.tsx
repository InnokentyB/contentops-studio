import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCurrentTime } from '../hooks/useCurrentTime'
import { publicationTasksApi } from '../api'

interface AdapterStatus {
    manualRecordAllowed: boolean
    state: string
    blocker: string | null
    connection: string
    observedAt: string
    admissionReason?: string
}
function parseStatus(value: unknown): AdapterStatus {
    if (!value || typeof value !== 'object') throw new Error('Invalid adapter status')
    const row = value as Record<string, unknown>
    if (typeof row.manualRecordAllowed !== 'boolean' || typeof row.state !== 'string'
        || typeof row.connection !== 'string' || typeof row.observedAt !== 'string'
        || !(row.blocker === null || typeof row.blocker === 'string')
        || !Number.isFinite(Date.parse(row.observedAt))) throw new Error('Invalid adapter status')
    return { manualRecordAllowed: row.manualRecordAllowed, state: row.state,
        connection: row.connection, observedAt: row.observedAt, blocker: row.blocker,
        admissionReason: row.admissionReason === 'ACTION_TIME_ADMISSION_UNAVAILABLE' ? row.admissionReason : undefined }
}
interface Props {
    taskId: number
    projectId: number
    isVk: boolean
    published: boolean
    actionTitle: string
    canPublish: boolean
    busy: boolean
    locale: string
    onPublish: () => void
    children: ReactNode
}

/** Presentation selection only. Canonical publication mode and release remain untouched. */
export default function PublicationMethodPanel(props: Props) {
    const { taskId, projectId, isVk, published, canPublish, busy, locale, onPublish, children } = props
    const now = useCurrentTime(1000)
    const ru = locale === 'ru'
    const [method, setMethod] = useState(published || (!isVk && !canPublish) ? 'record' : 'adapter')
    const status = useQuery({
        queryKey: ['publication_adapter_status', projectId, taskId],
        queryFn: async () => parseStatus(await publicationTasksApi.getAdapterStatus(taskId)),
        enabled: isVk, retry: false, staleTime: 0
    })
    const fresh = Boolean(status.data && now - Date.parse(status.data.observedAt) < 30000)
    const manualBlocked = isVk && (status.isFetching || status.isError || !fresh || !status.data?.manualRecordAllowed)
    return (
        <section className="space-y-4">
            <label className="block text-sm font-bold text-on-surface">
                {ru ? 'Способ публикации' : 'Publication method'}
                <select value={method} onChange={event => setMethod(event.target.value)} disabled={busy}
                    className="mt-2 w-full min-w-0 rounded-xl border border-outline-variant bg-surface-container-low p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                    <option value="adapter">{ru ? 'Через адаптер' : 'Through adapter'}</option>
                    <option value="record">{ru ? 'Зафиксировать опубликованное' : 'Record existing publication'}</option>
                </select>
            </label>
            {method === 'adapter' ? (
                <div className="space-y-3" aria-live="polite">
                    {isVk ? <>
                        <p className="text-sm">{ru ? 'Независимый VK-адаптер' : 'Independent VK adapter'}</p>
                        {status.isFetching ? <p>{ru ? 'Проверяем состояние…' : 'Checking status…'}</p>
                            : status.isError || !fresh ? <p role="status">{ru ? 'Состояние недоступно или устарело. Обновите проверку.' : 'Status unavailable or stale. Refresh the check.'}</p>
                                : <>
                                    <p>{ru ? 'Подключение' : 'Connection'}: {status.data?.connection === 'online'
                                        ? (ru ? 'онлайн' : 'online') : (ru ? 'недоступно' : 'unavailable')}</p>
                                    <p>{ru ? 'Задание' : 'Job'}: {status.data?.state === 'blocked' ? (ru ? 'заблокировано' : 'blocked') : status.data?.state}</p>
                                    {status.data?.blocker === 'PROVIDER_PERMISSION_UNVERIFIED' && <p className="text-sm">{ru ? 'Допуск к публикации в ВК ещё не подтверждён.' : 'Permission to publish to VK has not been verified.'}</p>}
                                    {status.data?.blocker && <p className="break-words text-sm" role="status">{status.data.blocker}</p>}
                                    {status.data?.admissionReason && <div className="space-y-1 text-sm" role="status">
                                        <p>{ru ? 'Внутренняя проверка допуска недоступна. Вход в ВК и права сообщества ещё не проверены; это не отказ ВК.' : 'Internal action admission is unavailable. VK login and community rights have not been checked; this is not a VK rejection.'}</p>
                                        <p className="break-words">{status.data.admissionReason}</p>
                                    </div>}
                                    <p className="text-sm text-on-surface-variant">{ru ? 'Для отправки нужен подтверждённый допуск адаптера. Онлайн не означает готовность к публикации.' : 'Sending requires verified adapter permission. Online does not mean ready to publish.'}</p>
                                </>}
                        <button type="button" onClick={() => status.refetch()} disabled={status.isFetching}
                            className="rounded-xl border border-outline-variant px-4 py-2 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50">
                            {ru ? 'Обновить состояние' : 'Refresh status'}
                        </button>
                    </> : <p className="text-sm text-on-surface-variant">{canPublish
                        ? (ru ? 'Публикация через подключённый адаптер.' : 'Publish through the connected adapter.')
                        : (ru ? 'Публикация через адаптер сейчас недоступна.' : 'Adapter publication is currently unavailable.')}</p>}
                    <button type="button" onClick={onPublish} title={props.actionTitle} disabled={isVk || !canPublish || busy || published}
                        className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 disabled:opacity-50">
                        {busy ? (ru ? 'Публикуем…' : 'Publishing…') : (ru ? 'Опубликовать через адаптер' : 'Publish through adapter')}
                    </button>
                </div>
            ) : <>
                <p className="text-sm text-on-surface-variant">{ru ? 'Запись результата уже состоявшейся публикации. Эта форма ничего не отправляет.' : 'Record an existing publication result. This form does not send content.'}</p>
                {manualBlocked && <p role="status" className="text-sm">{ru ? 'Результат активного задания адаптера нужно подтвердить через его проверку. Ручная запись пока недоступна.' : 'The active adapter job owns its result. Manual recording is unavailable until reconciliation.'}</p>}
                <fieldset disabled={manualBlocked || busy} className="min-w-0 space-y-4">{children}</fieldset>
            </>}
        </section>
    )
}

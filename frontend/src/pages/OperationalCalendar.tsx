import { useMemo, useState } from 'react'
import { addDays, format, startOfDay } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

type InitiativeKind = 'publication' | 'event' | 'campaign' | 'infrastructure'

type Readiness = {
    dependencies_status: 'dependencies_unknown' | 'confirmed' | 'none'
    readiness: 'unknown' | 'blocked' | 'ready'
    is_ready: boolean
    is_blocked: boolean
    blockers: Array<{ external_key: string; title: string; status: string; due_at?: string | null }>
}

type CalendarItem = {
    id: number
    external_key: string
    kind: InitiativeKind
    subtype?: string | null
    title: string
    status: string
    date_type: string
    date: string
    readiness: Readiness
    publication_task?: {
        id: number
        status: string
        mode: 'manual_handoff' | 'approval_required' | 'automatic'
        has_draft: boolean
        published_link?: string | null
        channel_id?: number | null
        workspace_path: string
    } | null
}

type OperationalCalendarResponse = {
    range: { from: string; to: string }
    items: CalendarItem[]
    overdue_initiatives: Array<{
        external_key: string
        title: string
        kind: InitiativeKind
        status: string
        due_at: string
        downstream_impact: Array<{ external_key: string; title: string; kind: InitiativeKind }>
    }>
    summary: {
        total: number
        in_range: number
        overdue: number
        dependencies_unknown: number
        by_kind: Partial<Record<InitiativeKind, number>>
    }
}

const KINDS: Array<{ id: InitiativeKind; label: string; icon: string }> = [
    { id: 'publication', label: 'Публикации', icon: 'article' },
    { id: 'event', label: 'События', icon: 'event' },
    { id: 'campaign', label: 'Кампании', icon: 'campaign' },
    { id: 'infrastructure', label: 'Инфраструктура', icon: 'settings_ethernet' },
]

const DATE_LABELS: Record<string, string> = {
    due_at: 'Дедлайн',
    start_at: 'Старт',
    end_at: 'Завершение',
    decision_at: 'Решение',
    event_at: 'Событие',
    measurement_at: 'Замер метрик',
}

function formatDay(value: string) {
    return new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(value))
}

function readinessLabel(item: CalendarItem) {
    if (item.readiness.dependencies_status === 'dependencies_unknown') return 'Зависимости не подтверждены'
    if (item.readiness.is_blocked) return 'Заблокировано'
    if (item.status === 'completed') return 'Готово'
    return 'В работе'
}

export default function OperationalCalendar() {
    const navigate = useNavigate()
    const { currentProject } = useAuth()
    const today = startOfDay(new Date())
    const [fromDate, setFromDate] = useState(format(today, 'yyyy-MM-dd'))
    const [toDate, setToDate] = useState(format(addDays(today, 13), 'yyyy-MM-dd'))
    const [activeKinds, setActiveKinds] = useState<Set<InitiativeKind>>(new Set(KINDS.map((kind) => kind.id)))
    const [selectedKey, setSelectedKey] = useState<string | null>(null)

    const calendarQuery = useQuery<OperationalCalendarResponse>({
        queryKey: ['operational-calendar', currentProject?.id, fromDate, toDate],
        queryFn: () => api.get(`/api/projects/${currentProject?.id}/operational-calendar?fromDate=${fromDate}&toDate=${toDate}`),
        enabled: !!currentProject && fromDate <= toDate,
    })

    const visibleItems = useMemo(
        () => (calendarQuery.data?.items || []).filter((item) => activeKinds.has(item.kind)),
        [calendarQuery.data?.items, activeKinds],
    )
    const selected = visibleItems.find((item) => item.external_key === selectedKey) || visibleItems[0] || null

    const toggleKind = (kind: InitiativeKind) => {
        setActiveKinds((current) => {
            const next = new Set(current)
            if (next.has(kind)) next.delete(kind)
            else next.add(kind)
            return next
        })
    }

    if (!currentProject) {
        return <div className="p-6 text-on-surface-variant">Выберите проект, чтобы открыть операционный план.</div>
    }

    return (
        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
            <div className="mx-auto max-w-[1560px]">
                <header className="border-b border-outline-variant/15 pb-6">
                    <div className="flex flex-col gap-5 2xl:flex-row 2xl:items-end 2xl:justify-between">
                        <div>
                            <h1 className="text-3xl font-black tracking-tight text-on-surface sm:text-4xl">Что должно случиться и что этому мешает</h1>
                            <p className="mt-2 max-w-3xl text-sm leading-6 text-on-surface-variant">Публикации, события, кампании и инфраструктура на одной временной шкале.</p>
                        </div>
                        <div className="flex flex-wrap items-end gap-3">
                            <label className="text-xs font-bold text-on-surface-variant">
                                <span className="mb-1 block">С</span>
                                <input className="h-11 rounded-xl border border-outline-variant/25 bg-surface-container-lowest px-3 text-base text-on-surface sm:text-sm" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
                            </label>
                            <label className="text-xs font-bold text-on-surface-variant">
                                <span className="mb-1 block">По</span>
                                <input className="h-11 rounded-xl border border-outline-variant/25 bg-surface-container-lowest px-3 text-base text-on-surface sm:text-sm" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
                            </label>
                        </div>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2" aria-label="Фильтр по слоям">
                        {KINDS.map((kind) => {
                            const active = activeKinds.has(kind.id)
                            return (
                                <button key={kind.id} type="button" aria-pressed={active} onClick={() => toggleKind(kind.id)} className={`min-h-11 rounded-xl px-4 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${active ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'}`}>
                                    <span className="material-symbols-outlined mr-2 align-middle text-lg" aria-hidden="true">{kind.icon}</span>
                                    {kind.label}
                                </button>
                            )
                        })}
                    </div>
                </header>

                {fromDate > toDate && <div role="alert" className="mt-6 rounded-xl border border-error/20 bg-error-container/30 px-4 py-3 text-sm text-error">Дата начала должна быть раньше даты окончания.</div>}

                <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                    {calendarQuery.isLoading ? 'Загрузка операционного плана' : calendarQuery.data ? `Операционный план загружен: ${visibleItems.length} инициатив` : ''}
                </div>

                <div className="mt-6">
                    {calendarQuery.isLoading && (
                        <div className="space-y-3" aria-label="Загрузка операционного плана">
                            {[1, 2, 3].map((key) => <div key={key} className="h-20 animate-pulse rounded-2xl bg-surface-container-high" />)}
                        </div>
                    )}

                    {calendarQuery.isError && (
                        <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-error/20 bg-error-container/30 px-5 py-4">
                            <div><strong className="block text-on-surface">Не удалось загрузить операционный план</strong><span className="text-sm text-on-surface-variant">Проверьте соединение и повторите запрос.</span></div>
                            <button type="button" onClick={() => calendarQuery.refetch()} className="min-h-11 rounded-xl bg-on-surface px-4 text-sm font-bold text-white">Повторить</button>
                        </div>
                    )}

                    {calendarQuery.data && (
                        <>
                            <section aria-label="Сводка" className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-outline-variant/15 sm:grid-cols-4">
                                {[
                                    ['В периоде', calendarQuery.data.summary.in_range],
                                    ['Просрочено', calendarQuery.data.summary.overdue],
                                    ['Неизвестные зависимости', calendarQuery.data.summary.dependencies_unknown],
                                    ['Всего инициатив', calendarQuery.data.summary.total],
                                ].map(([label, value]) => <div key={String(label)} className="bg-surface-container-lowest px-4 py-4"><div className="text-2xl font-black tabular-nums text-on-surface">{value}</div><div className="mt-1 text-xs font-bold text-on-surface-variant">{label}</div></div>)}
                            </section>

                            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
                                <section aria-label="Временная шкала">
                                    {visibleItems.length === 0 ? (
                                        <div className="border-y border-outline-variant/15 py-12 text-center"><span className="material-symbols-outlined text-3xl text-on-surface-variant" aria-hidden="true">event_busy</span><h2 className="mt-3 text-lg font-black">В выбранном периоде ничего нет</h2><p className="mt-1 text-sm text-on-surface-variant">Расширьте даты или включите дополнительные слои.</p></div>
                                    ) : visibleItems.map((item) => {
                                        const isSelected = selected?.external_key === item.external_key
                                        const isOverdue = calendarQuery.data.overdue_initiatives.some((entry) => entry.external_key === item.external_key)
                                        return (
                                            <button key={`${item.external_key}-${item.date_type}`} type="button" onClick={() => setSelectedKey(item.external_key)} aria-pressed={isSelected} className={`grid min-h-[76px] w-full grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3 border-b border-outline-variant/15 px-2 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:grid-cols-[8rem_minmax(0,1fr)_auto] ${isSelected ? 'bg-primary/5' : 'hover:bg-surface-container-low'}`}>
                                                <div><div className="text-sm font-black text-on-surface">{formatDay(item.date)}</div><div className="mt-1 text-xs text-on-surface-variant">{DATE_LABELS[item.date_type] || item.date_type}</div></div>
                                                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-black text-primary">{item.external_key}</span><span className="text-xs font-bold text-on-surface-variant">{KINDS.find((kind) => kind.id === item.kind)?.label}</span></div><div className="mt-1 truncate text-sm font-bold text-on-surface">{item.title}</div></div>
                                                <div className={`col-start-2 w-fit rounded-lg px-2.5 py-1 text-xs font-black sm:col-start-auto ${isOverdue ? 'bg-error/10 text-error' : item.readiness.is_blocked ? 'bg-warning-container text-on-warning-container' : 'bg-surface-container-high text-on-surface-variant'}`}><span className="material-symbols-outlined mr-1 align-middle text-base" aria-hidden="true">{isOverdue ? 'warning' : item.readiness.is_blocked ? 'block' : 'schedule'}</span>{isOverdue ? 'Просрочено' : readinessLabel(item)}</div>
                                            </button>
                                        )
                                    })}
                                </section>

                                <aside aria-label="Детали инициативы" className="h-fit rounded-2xl border border-outline-variant/20 bg-surface-container-lowest px-5 py-5 shadow-sm xl:sticky xl:top-24">
                                    {selected ? <><div className="flex items-start justify-between gap-4"><div><span className="text-xs font-black text-primary">{selected.external_key}</span><h2 className="mt-1 text-xl font-black leading-tight">{selected.title}</h2></div><span className="material-symbols-outlined text-on-surface-variant" aria-hidden="true">account_tree</span></div><dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm"><dt className="text-on-surface-variant">Состояние</dt><dd className="font-bold">{readinessLabel(selected)}</dd><dt className="text-on-surface-variant">Контроль</dt><dd className="font-bold">{DATE_LABELS[selected.date_type] || selected.date_type}, {formatDay(selected.date)}</dd></dl><div className="mt-6 border-t border-outline-variant/15 pt-5"><h3 className="text-xs font-black uppercase tracking-widest text-on-surface-variant">Блокеры</h3>{selected.readiness.blockers.length > 0 ? <ul className="mt-3 space-y-3">{selected.readiness.blockers.map((blocker) => <li key={blocker.external_key} className="rounded-xl bg-warning-container/45 px-3 py-2"><div className="text-sm font-black text-on-warning-container">{blocker.external_key} · {blocker.title}</div><div className="mt-1 text-xs text-on-surface-variant">Статус: {blocker.status}{blocker.due_at ? ` · срок ${formatDay(blocker.due_at)}` : ''}</div></li>)}</ul> : <p className="mt-3 text-sm text-on-surface-variant">{selected.readiness.dependencies_status === 'dependencies_unknown' ? 'Зависимости не подтверждены. Агенту нужно проверить источник перед запуском.' : 'Подтверждённых активных блокеров нет.'}</p>}</div>{selected.kind === 'publication' && <div className="mt-6 border-t border-outline-variant/15 pt-5">{selected.publication_task ? <><div className="text-xs font-black uppercase tracking-widest text-on-surface-variant">Рабочая публикация</div><div className="mt-2 text-sm text-on-surface-variant">{selected.publication_task.has_draft ? 'Текст подготовлен' : 'Текст ещё не подготовлен'} · {selected.publication_task.mode === 'automatic' ? 'автопостинг' : selected.publication_task.mode === 'approval_required' ? 'с подтверждением' : 'ручная публикация'}</div><button type="button" onClick={() => navigate(selected.publication_task!.workspace_path)} className="mt-4 min-h-11 w-full rounded-xl bg-on-surface px-4 text-sm font-black text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Открыть публикацию <span className="material-symbols-outlined ml-1 align-middle text-lg" aria-hidden="true">arrow_forward</span></button></> : <p className="text-sm text-on-surface-variant">Рабочая карточка ещё не создана. Агент должен материализовать публикацию через MCP.</p>}</div>}</> : <p className="text-sm text-on-surface-variant">Выберите инициативу на временной шкале.</p>}
                                </aside>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}

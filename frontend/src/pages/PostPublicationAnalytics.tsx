import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { publicationTasksApi } from '../api'
import { useAuth } from '../context/AuthContext'
import { useLocale } from '../i18n/LocaleContext'

type JsonRecord = Record<string, any>

type PublicationTask = {
    id: number
    type: string
    title?: string | null
    status: string
    published_link?: string | null
    schedule_at?: string | null
    metrics?: JsonRecord | null
    quality_report?: JsonRecord | null
    channel?: {
        id: number
        name: string
        type: string
    } | null
}

function normalizeMetric(value: unknown) {
    if (typeof value === 'number') return value
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : 0
    }
    return 0
}

export default function PostPublicationAnalytics() {
    const { currentProject } = useAuth()
    const { locale } = useLocale()
    const copy = locale === 'ru' ? {
        unknownChannel: 'Неизвестный канал', eyebrow: 'Метрики проекта', title: 'Метрики и результаты после публикации', intro: 'Эта рабочая область собирает эффективность каналов, недостающие метрики и негативные исходы, чтобы проект сохранял операционную память после выхода контента.', publications: 'Открыть публикации', back: 'Назад к обзору', published: 'Опубликовано', views: 'Просмотры', clicks: 'Клики', comments: 'Комментарии', noMetrics: 'Нет метрик', byChannel: 'По каналам', performance: 'Карта эффективности', publishedLower: 'опубликовано', noData: 'Нет данных', empty: 'Здесь появится опубликованный контент с метриками, как только проект начнёт подтверждать live URL.', followUp: 'Требует follow-up', noFollowUp: 'Сейчас нет опубликованных задач без сохранённого снимка метрик.', negative: 'Негативные исходы', noNegative: 'Здесь будут появляться заблокированные, удалённые и ограниченные публикации для дальнейшей разборки.', loading: 'Загружаем метрики...'
    } : {
        unknownChannel: 'Unknown channel', eyebrow: 'Project metrics', title: 'Post-publication metrics and outcomes', intro: 'This workspace brings together channel performance, missing measurements, and negative outcomes so the project retains operational memory after content goes live.', publications: 'Open publications', back: 'Back to overview', published: 'Published', views: 'Views', clicks: 'Clicks', comments: 'Comments', noMetrics: 'Missing metrics', byChannel: 'By channel', performance: 'Performance map', publishedLower: 'published', noData: 'No data', empty: 'Published content and metrics will appear here after the project starts confirming live URLs.', followUp: 'Needs follow-up', noFollowUp: 'Every published task currently has a saved metric snapshot.', negative: 'Negative outcomes', noNegative: 'Blocked, removed, and restricted publications will appear here for follow-up.', loading: 'Loading metrics...'
    }

    const { data: tasks, isLoading, error } = useQuery<PublicationTask[]>({
        queryKey: ['post_publication_analytics', currentProject?.id],
        queryFn: () => publicationTasksApi.list({ manualOnly: false }),
        enabled: !!currentProject
    })

    const publishedTasks = useMemo(() => (tasks || []).filter((task) => task.status === 'published'), [tasks])

    const totals = useMemo(() => {
        return publishedTasks.reduce((acc, task) => {
            const metrics = (task.metrics?.collected_metrics || task.metrics || {}) as JsonRecord
            acc.views += normalizeMetric(metrics.views)
            acc.clicks += normalizeMetric(metrics.clicks)
            acc.comments += normalizeMetric(metrics.comments)
            acc.missingMetrics += task.metrics?.collected_metrics ? 0 : 1

            const outcome = String(task.quality_report?.publication_outcome || task.metrics?.publication_outcome || 'published')
            if (outcome !== 'published') {
                acc.negativeOutcomes += 1
            }

            return acc
        }, {
            views: 0,
            clicks: 0,
            comments: 0,
            missingMetrics: 0,
            negativeOutcomes: 0
        })
    }, [publishedTasks])

    const byChannel = useMemo(() => {
        const grouped = new Map<string, {
            key: string
            channelName: string
            channelType: string
            published: number
            views: number
            clicks: number
            comments: number
            missingMetrics: number
        }>()

        for (const task of publishedTasks) {
            const key = String(task.channel?.id || task.channel?.name || task.type)
            const current = grouped.get(key) || {
                key,
                channelName: task.channel?.name || copy.unknownChannel,
                channelType: task.channel?.type || 'unknown',
                published: 0,
                views: 0,
                clicks: 0,
                comments: 0,
                missingMetrics: 0
            }

            const metrics = (task.metrics?.collected_metrics || task.metrics || {}) as JsonRecord
            current.published += 1
            current.views += normalizeMetric(metrics.views)
            current.clicks += normalizeMetric(metrics.clicks)
            current.comments += normalizeMetric(metrics.comments)
            current.missingMetrics += task.metrics?.collected_metrics ? 0 : 1
            grouped.set(key, current)
        }

        return [...grouped.values()].sort((left, right) => right.published - left.published)
    }, [publishedTasks, copy.unknownChannel])

    const missingMetricsTasks = useMemo(() => {
        return publishedTasks.filter((task) => !task.metrics?.collected_metrics).slice(0, 6)
    }, [publishedTasks])

    const negativeOutcomeTasks = useMemo(() => {
        return publishedTasks
            .filter((task) => String(task.quality_report?.publication_outcome || task.metrics?.publication_outcome || 'published') !== 'published')
            .slice(0, 6)
    }, [publishedTasks])

    return (
        <div className="flex-1 w-full p-8 lg:p-10 overflow-y-auto">
            <div className="max-w-[1600px] mx-auto space-y-8">
                <section className="rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm p-8 lg:p-10">
                    <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-8">
                        <div className="max-w-4xl">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">{copy.eyebrow}</div>
                            <h1 className="mt-3 text-4xl lg:text-5xl font-headline font-black tracking-tight text-on-surface">
                                {copy.title}
                            </h1>
                            <p className="mt-4 text-sm leading-7 text-on-surface-variant max-w-3xl">
                                {copy.intro}
                            </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-[320px]">
                            <Link to="/publication-tasks" className="rounded-2xl ai-gradient text-white px-5 py-4 text-sm font-black text-center shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all">
                                {copy.publications}
                            </Link>
                            <Link to="/projects" className="rounded-2xl bg-surface-container-high px-5 py-4 text-sm font-black text-on-surface text-center hover:bg-primary/10 hover:text-primary transition-all">
                                {copy.back}
                            </Link>
                        </div>
                    </div>
                </section>

                <section className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                    {[
                        { label: copy.published, value: publishedTasks.length },
                        { label: copy.views, value: totals.views },
                        { label: copy.clicks, value: totals.clicks },
                        { label: copy.comments, value: totals.comments },
                        { label: copy.noMetrics, value: totals.missingMetrics }
                    ].map((card) => (
                        <div key={card.label} className="rounded-[1.5rem] bg-white border border-outline-variant/10 shadow-sm p-6">
                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">{card.label}</div>
                            <div className="mt-4 text-4xl font-headline font-black text-on-surface">{card.value}</div>
                        </div>
                    ))}
                </section>

                <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,1fr)] gap-6">
                    <div className="rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm overflow-hidden">
                        <div className="p-6 border-b border-outline-variant/10">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">{copy.byChannel}</div>
                            <h2 className="mt-2 text-2xl font-headline font-black text-on-surface">{copy.performance}</h2>
                        </div>
                        <div className="p-6 space-y-4">
                            {byChannel.length > 0 ? byChannel.map((row) => (
                                <div key={row.key} className="rounded-[1.5rem] bg-surface-container-low p-5">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">{row.channelType}</div>
                                            <div className="mt-2 text-xl font-headline font-black text-on-surface">{row.channelName}</div>
                                        </div>
                                        <span className="px-3 py-1 rounded-full bg-white text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                                            {row.published} {copy.publishedLower}
                                        </span>
                                    </div>
                                    <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
                                        <div className="rounded-2xl bg-white px-4 py-3">
                                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-primary/60">{copy.views}</div>
                                            <div className="mt-2 text-lg font-black text-on-surface">{row.views}</div>
                                        </div>
                                        <div className="rounded-2xl bg-white px-4 py-3">
                                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-primary/60">{copy.clicks}</div>
                                            <div className="mt-2 text-lg font-black text-on-surface">{row.clicks}</div>
                                        </div>
                                        <div className="rounded-2xl bg-white px-4 py-3">
                                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-primary/60">{copy.comments}</div>
                                            <div className="mt-2 text-lg font-black text-on-surface">{row.comments}</div>
                                        </div>
                                        <div className="rounded-2xl bg-white px-4 py-3">
                                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-primary/60">{copy.noData}</div>
                                            <div className="mt-2 text-lg font-black text-on-surface">{row.missingMetrics}</div>
                                        </div>
                                    </div>
                                </div>
                            )) : (
                                <div className="rounded-[1.5rem] bg-surface-container-low p-5 text-sm text-on-surface-variant">
                                    {copy.empty}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm p-6">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">{copy.followUp}</div>
                            <div className="mt-4 space-y-3">
                                {missingMetricsTasks.length > 0 ? missingMetricsTasks.map((task) => (
                                    <div key={task.id} className="rounded-2xl bg-surface-container-low px-4 py-4">
                                        <div className="font-bold text-on-surface">{task.title || task.type}</div>
                                        <div className="mt-2 text-sm text-on-surface-variant">{task.channel?.name || copy.unknownChannel}</div>
                                    </div>
                                )) : (
                                    <div className="rounded-2xl bg-surface-container-low px-4 py-4 text-sm text-on-surface-variant">
                                        {copy.noFollowUp}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm p-6">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">{copy.negative}</div>
                            <div className="mt-4 space-y-3">
                                {negativeOutcomeTasks.length > 0 ? negativeOutcomeTasks.map((task) => (
                                    <div key={task.id} className="rounded-2xl bg-surface-container-low px-4 py-4">
                                        <div className="font-bold text-on-surface">{task.title || task.type}</div>
                                        <div className="mt-2 text-sm text-on-surface-variant">
                                            {String(task.quality_report?.publication_outcome || task.metrics?.publication_outcome)}
                                        </div>
                                    </div>
                                )) : (
                                    <div className="rounded-2xl bg-surface-container-low px-4 py-4 text-sm text-on-surface-variant">
                                        {copy.noNegative}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </section>

                {(isLoading || error) && (
                    <section className="rounded-[2rem] bg-white border border-outline-variant/10 shadow-sm p-6 text-sm text-on-surface-variant">
                        {isLoading ? copy.loading : (error as Error)?.message}
                    </section>
                )}
            </div>
        </div>
    )
}

import { useDeferredValue, useMemo, useState } from 'react'
import type { ApiJson } from '../types/api-json'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { parserApi } from '../api'
import { useAuth } from '../context/auth'
import { useLocale } from '../i18n/locale'

type JsonRecord = Record<string, ApiJson>

type ParserSource = 'reddit' | 'indie_hackers'

type ParserPost = {
    id: string
    title: string
    body: string
    author: string
    community: string
    url: string
    createdAt: string | null
    score: number
    comments: number
    raw: JsonRecord
}

type InsightRow = {
    key: string
    label: string
    count: number
    examples: string[]
}

type ScoreWeights = {
    relevance: number
    engagement: number
    freshness: number
    discussion: number
}

const SOURCE_OPTIONS: Array<{
    id: ParserSource
    label: string
    eyebrow: string
    hint: string
    communityLabel: string
    placeholder: string
}> = [
    {
        id: 'reddit',
        label: 'Reddit',
        eyebrow: 'Открытые обсуждения',
        hint: 'Запускай discovery по нескольким сабреддитам, ранжируй треды и вытаскивай повторяющиеся боли и возражения.',
        communityLabel: 'Сабреддиты',
        placeholder: 'instructionaldesign, onlinecourses, Entrepreneur'
    },
    {
        id: 'indie_hackers',
        label: 'Indie Hackers',
        eyebrow: 'Сообщества фаундеров',
        hint: 'Следи за группами, продуктовыми постами и разговорами фаундеров, где ссылки и самопромоушен требуют большей осторожности.',
        communityLabel: 'Группы / ленты',
        placeholder: 'Bootstrappers, Creators, Solopreneurs'
    }
]

const DEFAULT_WEIGHTS: ScoreWeights = {
    relevance: 0.4,
    engagement: 0.25,
    freshness: 0.2,
    discussion: 0.15
}

function splitList(input: string) {
    return input
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
}

function normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
}

function normalizeNumber(value: unknown) {
    if (typeof value === 'number') return value
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : 0
    }
    return 0
}

function parsePostRecords(payload: ApiJson): ParserPost[] {
    const records = payload?.parser_response?.data
        || payload?.parser_response?.posts
        || payload?.data
        || payload?.posts
        || []

    if (!Array.isArray(records)) {
        return []
    }

    return records.map((item: JsonRecord, index: number) => ({
        id: String(
            item.reddit_post_id
            || item.post_id
            || item.id
            || item.uuid
            || `parser-post-${index}`
        ),
        title: normalizeText(item.title || item.headline || item.subject || 'Untitled result'),
        body: normalizeText(item.body || item.selftext || item.content || item.text || item.snippet || ''),
        author: normalizeText(item.author || item.author_name || 'unknown'),
        community: normalizeText(item.subreddit || item.group_name || item.community || item.source_name || 'unknown'),
        url: normalizeText(item.url || item.permalink || item.link_url || item.target_url || ''),
        createdAt: normalizeText(item.created_at || item.createdAt || item.posted_at || item.ts || '') || null,
        score: normalizeNumber(item.score || item.rank_score || item.upvotes),
        comments: normalizeNumber(item.comments_count || item.num_comments || item.comment_count),
        raw: item
    }))
}

function parseTemplates(payload: ApiJson) {
    const templates = payload?.parser_response?.templates
        || payload?.parser_response?.data
        || payload?.templates
        || payload?.data
        || []

    return Array.isArray(templates) ? templates : []
}

function parseInsights(payload: ApiJson): InsightRow[] {
    const groups = payload?.parser_response?.groups || payload?.groups || {}
    if (!groups || typeof groups !== 'object') {
        return []
    }

    return Object.entries(groups).map(([key, value]: [string, ApiJson]) => {
        const items = Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : []
        const examples = items
            .slice(0, 3)
            .map((entry: ApiJson) => normalizeText(entry.label || entry.title || entry.text || entry.example || entry.name))
            .filter(Boolean)

        return {
            key,
            label: key.replace(/_/g, ' '),
            count: items.length || normalizeNumber(value?.count),
            examples
        }
    })
}

function formatRelativeDate(value: string | null, locale: 'en' | 'ru') {
    if (!value) return locale === 'ru' ? 'Без даты' : 'No date'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value

    const deltaMs = Date.now() - date.getTime()
    const deltaDays = Math.max(0, Math.floor(deltaMs / (1000 * 60 * 60 * 24)))

    if (deltaDays === 0) return locale === 'ru' ? 'Сегодня' : 'Today'
    if (deltaDays === 1) return locale === 'ru' ? '1 день назад' : '1 day ago'
    if (deltaDays < 30) return locale === 'ru' ? `${deltaDays} дн. назад` : `${deltaDays} days ago`
    const deltaMonths = Math.floor(deltaDays / 30)
    if (deltaMonths <= 1) return locale === 'ru' ? '1 месяц назад' : '1 month ago'
    return locale === 'ru' ? `${deltaMonths} мес. назад` : `${deltaMonths} months ago`
}

function computeResultScore(post: ParserPost, query: string, weights: ScoreWeights) {
    const normalizedQuery = query.trim().toLowerCase()
    const haystack = `${post.title} ${post.body}`.toLowerCase()
    const relevance = normalizedQuery
        ? Math.min(1, normalizedQuery.split(/\s+/).filter(Boolean).filter((token) => haystack.includes(token)).length / Math.max(1, normalizedQuery.split(/\s+/).filter(Boolean).length))
        : 0.6
    const engagement = Math.min(1, (post.score + post.comments * 2) / 250)

    const createdAt = post.createdAt ? new Date(post.createdAt) : null
    const ageDays = createdAt && !Number.isNaN(createdAt.getTime())
        ? Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24)))
        : 30
    const freshness = Math.max(0, 1 - ageDays / 30)
    const discussion = Math.min(1, post.comments / 80)

    const total = (
        relevance * weights.relevance
        + engagement * weights.engagement
        + freshness * weights.freshness
        + discussion * weights.discussion
    ) * 100

    return {
        total: Math.round(total),
        breakdown: {
            relevance: Math.round(relevance * 100),
            engagement: Math.round(engagement * 100),
            freshness: Math.round(freshness * 100),
            discussion: Math.round(discussion * 100)
        }
    }
}

function getResultTone(score: number) {
    if (score >= 75) return 'bg-emerald-500/15 text-emerald-900'
    if (score >= 55) return 'bg-amber-300/25 text-amber-950'
    return 'bg-rose-300/20 text-rose-950'
}

export default function Parsers() {
    const { locale } = useLocale()
    const tr = (ru: string, en: string) => locale === 'ru' ? ru : en
    const copy = locale === 'ru' ? {
        chooseProject: 'Сначала выбери проект', addQuery: 'Сначала добавь запрос для исследования', noActiveJob: 'Не выбрана активная исследовательская задача', lab: 'Исследовательская лаборатория', title: 'Исследования, скоринг и разведка источников для каждого канала проекта.', intro: 'Выбери источник, задай критерии включения и исключения, запусти исследование, а затем оцени сырые результаты и fit score со стороны планнера, прежде чем превращать находки в посты, брифы или задачи канала.', project: 'Проект', notSelected: 'не выбран', activeJob: 'Активная задача', rankedResults: 'результатов в ранжировании', operationalStatus: 'Операционный статус', integration: 'Состояние интеграции', problem: 'Проблема', ready: 'Готово', integrationError: 'Связка с исследовательским сервисом доступна из планнера, но верхний parser endpoint вернул ошибку.', integrationReady: 'Планнер может разговаривать со слоем исследовательских интеграций. Здесь удобно запускать discovery до того, как контент попадёт в каналы.', source: 'Источник', scoring: 'Скоринг', fitScore: 'Fit score планнера', threshold: 'Порог', criteria: 'Лаборатория критериев', criteriaTitle: 'Опиши исследованию, что именно искать', refreshing: 'Обновляем...', refresh: 'Обновить задачу', launching: 'Запускаем...', launch: 'Запустить исследование', searchQuery: 'Поисковый запрос', queryPlaceholder: 'Какой именно разговор или сигнал мы хотим поймать?', intent: 'Интент', cluster: 'Кластер', workspaceDoes: 'Что делает эта рабочая область', workspaceBullets: ['Задаёт source-specific критерии поиска и quality gates.', 'Показывает сырые результаты исследования до попадания в publishing network.', 'Применяет fit score со стороны планнера, чтобы ранжировать сильнейшие контентные сигналы.'], sourceEyebrows: ['Открытые обсуждения', 'Сообщества фаундеров'], sourceHints: ['Запускай discovery по нескольким сабреддитам, ранжируй треды и вытаскивай повторяющиеся боли и возражения.', 'Следи за группами, продуктовыми постами и разговорами фаундеров, где ссылки и самопромоушен требуют большей осторожности.'], communityLabels: ['Сабреддиты', 'Группы / ленты'], scoreLabels: ['Совпадение с запросом', 'Вовлечённость', 'Свежесть', 'Глубина обсуждения'], minimumFit: 'Минимальный fit score', communityHelp: 'Используй список сообществ или лент через запятую, чтобы сузить источник без правки parser config.', mustInclude: 'Должно содержать хотя бы одно', excludeContains: 'Исключить, если содержит', excludeRegex: 'Исключающие regex', limit: 'Лимит', minimumRaw: 'Минимальный raw score', includeComments: 'Включать комментарии', enrich: 'Обогащать метаданные', results: 'Результаты', rankedSignals: 'Ранжированные сигналы источников', visible: 'видимых', unknownSource: 'Неизвестный источник', noPreview: 'Сервис не вернул body-preview для этого результата.', comments: 'комментариев', openThread: 'Открыть исходный тред', copyCard: 'Скопировать research card', noResults: 'Запусти исследование или снизь порог fit score, чтобы здесь появились подходящие результаты.', runMonitoring: 'Мониторинг запуска', currentJob: 'Текущая parser-задача', status: 'Статус', jobId: 'ID задачи', noJob: 'Нет активной задачи', insights: 'Инсайты', groupedSignals: 'Сгруппированные сигналы', noInsights: 'Группы инсайтов появятся здесь после того, как у исследования будет достаточно сырого материала для summary.', templates: 'Шаблоны', savedRecipes: 'Сохранённые parser recipes', back: 'Назад к обзору', template: 'Исследовательский шаблон', run: 'Запустить', noTemplates: 'Для этого проекта пока не найдено исследовательских шаблонов.'
    } : {
        chooseProject: 'Choose a project first', addQuery: 'Add a research query first', noActiveJob: 'No active research job selected', lab: 'Research lab', title: 'Research, scoring, and source intelligence for every project channel.', intro: 'Choose a source, define inclusion and exclusion criteria, run the research job, then review raw results and planner fit scores before promoting findings into posts, briefs, or channel tasks.', project: 'Project', notSelected: 'not selected', activeJob: 'Active job', rankedResults: 'ranked results', operationalStatus: 'Operational status', integration: 'Integration status', problem: 'Issue', ready: 'Ready', integrationError: 'The planner can reach the research integration layer, but the upstream parser endpoint returned an error.', integrationReady: 'The planner is connected to the research integration layer. Run discovery here before content enters production channels.', source: 'Source', scoring: 'Scoring', fitScore: 'Planner fit score', threshold: 'Threshold', criteria: 'Criteria lab', criteriaTitle: 'Describe exactly what the research job should find', refreshing: 'Refreshing...', refresh: 'Refresh job', launching: 'Launching...', launch: 'Run research', searchQuery: 'Search query', queryPlaceholder: 'Which conversation or signal should this job capture?', intent: 'Intent', cluster: 'Cluster', workspaceDoes: 'What this workspace does', workspaceBullets: ['Defines source-specific search criteria and quality gates.', 'Shows raw research results before they enter the publishing network.', 'Applies planner-side fit scoring to rank the strongest content signals.'], sourceEyebrows: ['Open discussions', 'Founder communities'], sourceHints: ['Run discovery across several subreddits, rank threads, and extract recurring pains and objections.', 'Monitor groups, product posts, and founder conversations where links and self-promotion require extra care.'], communityLabels: ['Subreddits', 'Groups / feeds'], scoreLabels: ['Query relevance', 'Engagement', 'Freshness', 'Discussion depth'], minimumFit: 'Minimum fit score', communityHelp: 'Use a comma-separated list of communities or feeds to narrow the source without editing parser configuration.', mustInclude: 'Must include at least one', excludeContains: 'Exclude when containing', excludeRegex: 'Exclusion regex', limit: 'Limit', minimumRaw: 'Minimum raw score', includeComments: 'Include comments', enrich: 'Enrich metadata', results: 'Results', rankedSignals: 'Ranked source signals', visible: 'visible', unknownSource: 'Unknown source', noPreview: 'The service did not return a body preview for this result.', comments: 'comments', openThread: 'Open source thread', copyCard: 'Copy research card', noResults: 'Run research or lower the fit-score threshold to see matching results.', runMonitoring: 'Run monitoring', currentJob: 'Current parser job', status: 'Status', jobId: 'Job ID', noJob: 'No active job', insights: 'Insights', groupedSignals: 'Grouped signals', noInsights: 'Insight groups will appear after the research job has enough raw material to summarize.', templates: 'Templates', savedRecipes: 'Saved parser recipes', back: 'Back to overview', template: 'Research template', run: 'Run', noTemplates: 'No research templates have been found for this project.'
    }
    const sourceOptions = SOURCE_OPTIONS.map((option, index) => ({ ...option, eyebrow: copy.sourceEyebrows[index], hint: copy.sourceHints[index], communityLabel: copy.communityLabels[index] }))
    const queryClient = useQueryClient()
    const { currentProject } = useAuth()

    const [source, setSource] = useState<ParserSource>('reddit')
    const [query, setQuery] = useState('')
    const [communityInput, setCommunityInput] = useState('')
    const [intent, setIntent] = useState('pain points')
    const [cluster, setCluster] = useState('')
    const [mustIncludeInput, setMustIncludeInput] = useState('')
    const [excludeInput, setExcludeInput] = useState('')
    const [excludeRegexInput, setExcludeRegexInput] = useState('')
    const [limit, setLimit] = useState(25)
    const [minScore, setMinScore] = useState(10)
    const [includeComments, setIncludeComments] = useState(true)
    const [enrich, setEnrich] = useState(true)
    const [activeJobId, setActiveJobId] = useState<string | null>(null)
    const [resultFloor, setResultFloor] = useState(55)
    const [weights, setWeights] = useState<ScoreWeights>(DEFAULT_WEIGHTS)
    const [jobMessage, setJobMessage] = useState<string | null>(null)

    const selectedSource = sourceOptions.find((option) => option.id === source) || sourceOptions[0]
    const deferredQuery = useDeferredValue(query)

    const parserHealth = useQuery({
        queryKey: ['parser_health', currentProject?.id],
        queryFn: () => parserApi.health(currentProject!.id),
        enabled: !!currentProject
    })

    const templatesQuery = useQuery({
        queryKey: ['parser_templates', currentProject?.id],
        queryFn: () => parserApi.listTemplates(currentProject!.id),
        enabled: !!currentProject
    })

    const postsQuery = useQuery({
        queryKey: ['parser_posts', currentProject?.id],
        queryFn: () => parserApi.listPosts(currentProject!.id, { limit: 20 }),
        enabled: !!currentProject,
        staleTime: 60_000
    })

    const searchJobQuery = useQuery({
        queryKey: ['parser_job', currentProject?.id, activeJobId],
        queryFn: () => parserApi.getSearchJob(currentProject!.id, activeJobId!),
        enabled: !!currentProject && !!activeJobId,
        refetchInterval: (query) => {
            const status = query.state.data?.parser_response?.status || query.state.data?.status
            return status && !String(status).toLowerCase().includes('complete') ? 10000 : false
        },
        staleTime: 5_000
    })

    const summaryQuery = useQuery({
        queryKey: ['parser_summary', currentProject?.id, activeJobId],
        queryFn: () => parserApi.getSummary(currentProject!.id, activeJobId!),
        enabled: !!currentProject && !!activeJobId,
        staleTime: 60_000
    })

    const insightsQuery = useQuery({
        queryKey: ['parser_insights', currentProject?.id, activeJobId],
        queryFn: () => parserApi.getInsights(currentProject!.id, { limit: 25, jobId: activeJobId || undefined }),
        enabled: !!currentProject && !!activeJobId,
        staleTime: 60_000
    })

    const createSearchJob = useMutation({
        mutationFn: () => {
            if (!currentProject?.id) {
                throw new Error(copy.chooseProject)
            }
            if (!query.trim()) {
                throw new Error(copy.addQuery)
            }

            return parserApi.createSearchJob(currentProject.id, {
                source,
                query,
                subreddit: source === 'reddit' ? splitList(communityInput)[0] : undefined,
                subreddits: splitList(communityInput),
                intent: intent || undefined,
                cluster: cluster || undefined,
                matchMustIncludeAny: splitList(mustIncludeInput),
                excludeIfContains: splitList(excludeInput),
                excludeRegexes: splitList(excludeRegexInput),
                limit,
                minScore,
                includeComments,
                enrich
            })
        },
        onSuccess: (result: ApiJson) => {
            const jobId = result?.parser_response?.job_id || result?.job_id
            const runId = result?.parser_response?.run_id || result?.run_id
            setActiveJobId(jobId || null)
            setJobMessage(locale === 'ru'
                ? `Поиск поставлен в очередь${jobId ? ` как ${jobId}` : ''}${runId ? ` • запуск ${runId}` : ''}.`
                : `Research queued${jobId ? ` as ${jobId}` : ''}${runId ? ` • run ${runId}` : ''}.`)
            queryClient.invalidateQueries({ queryKey: ['parser_posts', currentProject?.id] })
            queryClient.invalidateQueries({ queryKey: ['parser_insights', currentProject?.id] })
        }
    })

    const refreshJob = useMutation({
        mutationFn: () => {
            if (!currentProject?.id || !activeJobId) {
            throw new Error(copy.noActiveJob)
            }
            return parserApi.refreshSearchJob(currentProject.id, activeJobId)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['parser_job', currentProject?.id, activeJobId] })
            queryClient.invalidateQueries({ queryKey: ['parser_posts', currentProject?.id] })
            queryClient.invalidateQueries({ queryKey: ['parser_insights', currentProject?.id] })
        }
    })

    const runTemplate = useMutation({
        mutationFn: (templateId: string) => {
            if (!currentProject?.id) {
                throw new Error(copy.chooseProject)
            }
            return parserApi.runTemplate(currentProject.id, templateId)
        },
        onSuccess: (result: ApiJson) => {
            const jobId = result?.parser_response?.job_id || result?.job_id
            setActiveJobId(jobId || null)
            setJobMessage(locale === 'ru'
                ? `Запуск шаблона начат${jobId ? ` • задача ${jobId}` : ''}.`
                : `Template run started${jobId ? ` • job ${jobId}` : ''}.`)
        }
    })

    const posts = useMemo(() => parsePostRecords(postsQuery.data), [postsQuery.data])
    const insights = useMemo(() => parseInsights(insightsQuery.data), [insightsQuery.data])
    const templates = useMemo(() => parseTemplates(templatesQuery.data), [templatesQuery.data])

    const scoredResults = useMemo(() => {
        return posts
            .map((post) => ({
                post,
                score: computeResultScore(post, deferredQuery, weights)
            }))
            .filter((item) => item.score.total >= resultFloor)
            .sort((left, right) => right.score.total - left.score.total)
    }, [posts, deferredQuery, weights, resultFloor])

    const topResult = scoredResults[0]?.post || null

    return (
        <div className="flex-1 w-full overflow-y-auto p-8 lg:p-10">
            <div className="mx-auto max-w-[1680px] space-y-8">
                <section className="overflow-hidden rounded-[2.25rem] border border-outline-variant/10 bg-white shadow-sm">
                    <div className="grid grid-cols-1 gap-0 xl:grid-cols-[minmax(0,1.15fr)_420px]">
                        <div className="px-8 py-9 lg:px-10 lg:py-10">
                            <div className="text-[10px] font-black uppercase tracking-[0.32em] text-primary/60">{copy.lab}</div>
                            <h1 className="mt-3 max-w-4xl text-4xl font-headline font-black tracking-tight text-on-surface lg:text-5xl">
                                {copy.title}
                            </h1>
                            <p className="mt-4 max-w-3xl text-sm leading-7 text-on-surface-variant">
                                {copy.intro}
                            </p>

                            <div className="mt-7 flex flex-wrap gap-3">
                                <span className="rounded-full bg-surface-container-high px-3 py-1 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                                    {copy.project}: {currentProject?.name || copy.notSelected}
                                </span>
                                {activeJobId && (
                                    <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-primary">
                                        {copy.activeJob}: {activeJobId}
                                    </span>
                                )}
                                <span className="rounded-full bg-surface-container-high px-3 py-1 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                                    {scoredResults.length} {copy.rankedResults}
                                </span>
                            </div>

                            {jobMessage && (
                                <div className="mt-6 rounded-2xl bg-success/10 px-4 py-3 text-sm font-medium text-success">
                                    {jobMessage}
                                </div>
                            )}
                            {createSearchJob.error instanceof Error && (
                                <div className="mt-6 rounded-2xl bg-error-container/30 px-4 py-3 text-sm font-medium text-error">
                                    {createSearchJob.error.message}
                                </div>
                            )}
                        </div>

                        <div className="border-t border-outline-variant/10 bg-[#f7f8fc] px-8 py-9 xl:border-l xl:border-t-0">
                            <div className="text-[10px] font-black uppercase tracking-[0.32em] text-primary/60">{copy.operationalStatus}</div>
                            <div className="mt-5 space-y-4">
                                <div className="rounded-[1.5rem] bg-white px-5 py-5">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-sm font-bold text-on-surface">{copy.integration}</span>
                                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${parserHealth.isError ? 'bg-error-container/40 text-error' : 'bg-success/10 text-success'}`}>
                                            {parserHealth.isError ? copy.problem : copy.ready}
                                        </span>
                                    </div>
                                    <p className="mt-3 text-sm leading-6 text-on-surface-variant">
                                        {parserHealth.isError
                                            ? copy.integrationError
                                            : copy.integrationReady}
                                    </p>
                                </div>

                                <div className="rounded-[1.5rem] bg-white px-5 py-5">
                                    <div className="text-sm font-bold text-on-surface">{copy.workspaceDoes}</div>
                                    <ul className="mt-3 space-y-2 text-sm leading-6 text-on-surface-variant">
                                        {copy.workspaceBullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="grid grid-cols-1 gap-6 xl:grid-cols-[420px_minmax(0,1fr)_380px]">
                    <div className="space-y-6">
                        <div className="rounded-[2rem] border border-outline-variant/10 bg-white p-6 shadow-sm">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">{copy.source}</div>
                            <div className="mt-4 space-y-3">
                                {sourceOptions.map((option) => (
                                    <button
                                        key={option.id}
                                        onClick={() => setSource(option.id)}
                                        className={`w-full rounded-[1.5rem] px-5 py-5 text-left transition-all ${source === option.id ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'bg-surface-container-low text-on-surface hover:bg-primary/5'}`}
                                    >
                                        <div className={`text-[10px] font-black uppercase tracking-[0.25em] ${source === option.id ? 'text-white/70' : 'text-primary/60'}`}>
                                            {option.eyebrow}
                                        </div>
                                        <div className="mt-2 text-xl font-headline font-black">{option.label}</div>
                                        <div className={`mt-3 text-sm leading-6 ${source === option.id ? 'text-white/85' : 'text-on-surface-variant'}`}>
                                            {option.hint}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="rounded-[2rem] border border-outline-variant/10 bg-white p-6 shadow-sm">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">{copy.scoring}</div>
                                    <h2 className="mt-2 text-xl font-headline font-black text-on-surface">{copy.fitScore}</h2>
                                </div>
                                <span className="rounded-full bg-surface-container-high px-3 py-1 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                                    {copy.threshold} {resultFloor}
                                </span>
                            </div>

                            <div className="mt-5 space-y-4">
                                {([
                                    ['relevance', copy.scoreLabels[0]],
                                    ['engagement', copy.scoreLabels[1]],
                                    ['freshness', copy.scoreLabels[2]],
                                    ['discussion', copy.scoreLabels[3]]
                                ] as const).map(([key, label]) => (
                                    <div key={key}>
                                        <div className="mb-2 flex items-center justify-between text-sm">
                                            <span className="font-bold text-on-surface">{label}</span>
                                            <span className="text-on-surface-variant">{Math.round(weights[key] * 100)}%</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max="0.7"
                                            step="0.05"
                                            value={weights[key]}
                                            onChange={(event) => setWeights((current) => ({ ...current, [key]: Number(event.target.value) }))}
                                            className="w-full accent-primary"
                                        />
                                    </div>
                                ))}

                                <div>
                                    <div className="mb-2 flex items-center justify-between text-sm">
                                        <span className="font-bold text-on-surface">{copy.minimumFit}</span>
                                        <span className="text-on-surface-variant">{resultFloor}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        step="5"
                                        value={resultFloor}
                                        onChange={(event) => setResultFloor(Number(event.target.value))}
                                        className="w-full accent-primary"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="rounded-[2rem] border border-outline-variant/10 bg-white p-7 shadow-sm">
                            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">{copy.criteria}</div>
                                    <h2 className="mt-2 text-2xl font-headline font-black text-on-surface">{copy.criteriaTitle}</h2>
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => refreshJob.mutate()}
                                        disabled={!activeJobId || refreshJob.isPending}
                                        className="rounded-2xl bg-surface-container-high px-4 py-3 text-sm font-black text-on-surface transition-all hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {refreshJob.isPending ? copy.refreshing : copy.refresh}
                                    </button>
                                    <button
                                        onClick={() => createSearchJob.mutate()}
                                        disabled={createSearchJob.isPending || !currentProject}
                                        className="rounded-2xl ai-gradient px-5 py-3 text-sm font-black text-white shadow-lg shadow-primary/20 transition-all hover:scale-[1.01] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {createSearchJob.isPending ? copy.launching : copy.launch}
                                    </button>
                                </div>
                            </div>

                            <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
                                <label className="block">
                                    <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.22em] text-primary/60">{copy.searchQuery}</span>
                                    <textarea
                                        value={query}
                                        onChange={(event) => setQuery(event.target.value)}
                                        rows={4}
                                        className="w-full rounded-[1.35rem] border border-outline-variant/10 bg-surface-container-low px-4 py-3 text-sm leading-6 text-on-surface outline-none transition-all focus:border-primary/30 focus:bg-white"
                                        placeholder={copy.queryPlaceholder}
                                    />
                                </label>

                                <div className="rounded-[1.35rem] bg-surface-container-low px-5 py-5">
                                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-primary/60">{selectedSource.communityLabel}</div>
                                    <p className="mt-2 text-sm leading-6 text-on-surface-variant">
                                        {copy.communityHelp}
                                    </p>
                                    <input
                                        value={communityInput}
                                        onChange={(event) => setCommunityInput(event.target.value)}
                                        className="mt-4 w-full rounded-2xl border border-outline-variant/10 bg-white px-4 py-3 text-sm text-on-surface outline-none transition-all focus:border-primary/30"
                                        placeholder={selectedSource.placeholder}
                                    />
                                </div>

                                <label className="block">
                                    <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.22em] text-primary/60">{copy.intent}</span>
                                    <input
                                        value={intent}
                                        onChange={(event) => setIntent(event.target.value)}
                                        className="w-full rounded-[1.35rem] border border-outline-variant/10 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none transition-all focus:border-primary/30 focus:bg-white"
                                        placeholder="pain points, objections, product demand..."
                                    />
                                </label>

                                <label className="block">
                                    <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.22em] text-primary/60">{copy.cluster}</span>
                                    <input
                                        value={cluster}
                                        onChange={(event) => setCluster(event.target.value)}
                                        className="w-full rounded-[1.35rem] border border-outline-variant/10 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none transition-all focus:border-primary/30 focus:bg-white"
                                        placeholder="course-building, founder-content..."
                                    />
                                </label>

                                <label className="block">
                                    <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.22em] text-primary/60">{copy.mustInclude}</span>
                                    <input
                                        value={mustIncludeInput}
                                        onChange={(event) => setMustIncludeInput(event.target.value)}
                                        className="w-full rounded-[1.35rem] border border-outline-variant/10 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none transition-all focus:border-primary/30 focus:bg-white"
                                        placeholder="adaptive learning, course builder"
                                    />
                                </label>

                                <label className="block">
                                    <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.22em] text-primary/60">{copy.excludeContains}</span>
                                    <input
                                        value={excludeInput}
                                        onChange={(event) => setExcludeInput(event.target.value)}
                                        className="w-full rounded-[1.35rem] border border-outline-variant/10 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none transition-all focus:border-primary/30 focus:bg-white"
                                        placeholder="hiring, meme, giveaway"
                                    />
                                </label>

                                <label className="block lg:col-span-2">
                                    <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.22em] text-primary/60">{copy.excludeRegex}</span>
                                    <input
                                        value={excludeRegexInput}
                                        onChange={(event) => setExcludeRegexInput(event.target.value)}
                                        className="w-full rounded-[1.35rem] border border-outline-variant/10 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none transition-all focus:border-primary/30 focus:bg-white"
                                        placeholder="^\\[hiring\\], discount\\s+code"
                                    />
                                </label>
                            </div>

                            <div className="mt-6 grid grid-cols-2 gap-5 xl:grid-cols-4">
                                <label className="block">
                                    <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.22em] text-primary/60">{copy.limit}</span>
                                    <input
                                        type="number"
                                        min="1"
                                        max="100"
                                        value={limit}
                                        onChange={(event) => setLimit(Number(event.target.value) || 25)}
                                        className="w-full rounded-[1.35rem] border border-outline-variant/10 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none transition-all focus:border-primary/30 focus:bg-white"
                                    />
                                </label>

                                <label className="block">
                                    <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.22em] text-primary/60">{copy.minimumRaw}</span>
                                    <input
                                        type="number"
                                        min="0"
                                        value={minScore}
                                        onChange={(event) => setMinScore(Number(event.target.value) || 0)}
                                        className="w-full rounded-[1.35rem] border border-outline-variant/10 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none transition-all focus:border-primary/30 focus:bg-white"
                                    />
                                </label>

                                <label className="flex items-center gap-3 rounded-[1.35rem] bg-surface-container-low px-4 py-3">
                                    <input
                                        type="checkbox"
                                        checked={includeComments}
                                        onChange={(event) => setIncludeComments(event.target.checked)}
                                        className="accent-primary"
                                    />
                                    <span className="text-sm font-bold text-on-surface">{copy.includeComments}</span>
                                </label>

                                <label className="flex items-center gap-3 rounded-[1.35rem] bg-surface-container-low px-4 py-3">
                                    <input
                                        type="checkbox"
                                        checked={enrich}
                                        onChange={(event) => setEnrich(event.target.checked)}
                                        className="accent-primary"
                                    />
                                    <span className="text-sm font-bold text-on-surface">{copy.enrich}</span>
                                </label>
                            </div>
                        </div>

                        <div className="rounded-[2rem] border border-outline-variant/10 bg-white p-7 shadow-sm">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">{copy.results}</div>
                                    <h2 className="mt-2 text-2xl font-headline font-black text-on-surface">{copy.rankedSignals}</h2>
                                </div>
                                <div className="rounded-full bg-surface-container-high px-3 py-1 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                                    {scoredResults.length} {copy.visible}
                                </div>
                            </div>

                            <div className="mt-6 space-y-4">
                                {scoredResults.map(({ post, score }) => (
                                    <article key={post.id} className="rounded-[1.5rem] border border-outline-variant/10 bg-surface-container-low px-5 py-5">
                                        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-primary/60">
                                                    <span>{post.community || copy.unknownSource}</span>
                                                    <span className="text-on-surface-variant">{formatRelativeDate(post.createdAt, locale)}</span>
                                                </div>
                                                <h3 className="mt-3 text-xl font-headline font-black text-on-surface">
                                                    {post.title}
                                                </h3>
                                                <p className="mt-3 line-clamp-4 text-sm leading-7 text-on-surface-variant">
                                                    {post.body || copy.noPreview}
                                                </p>
                                            </div>

                                            <div className="flex flex-col items-start gap-3 xl:items-end">
                                                <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${getResultTone(score.total)}`}>
                                                    Fit score {score.total}
                                                </span>
                                                <div className="text-right text-xs leading-5 text-on-surface-variant">
                                                    <div>raw {post.score}</div>
                                                    <div>{post.comments} {copy.comments}</div>
                                                    <div>{post.author}</div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
                                            {Object.entries(score.breakdown).map(([key, value]) => (
                                                <div key={key} className="rounded-2xl bg-white px-3 py-3">
                                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/60">
                                                        {key}
                                                    </div>
                                                    <div className="mt-1 text-lg font-black text-on-surface">{value}</div>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="mt-5 flex flex-wrap gap-3">
                                            {post.url && (
                                                <a
                                                    href={post.url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-primary transition-all hover:bg-primary hover:text-white"
                                                >
                                                    {copy.openThread}
                                                </a>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => navigator.clipboard.writeText(`${post.title}\n${post.url}`.trim())}
                                                className="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-on-surface transition-all hover:bg-surface-container-high"
                                            >
                                                {copy.copyCard}
                                            </button>
                                        </div>
                                    </article>
                                ))}

                                {!scoredResults.length && (
                                    <div className="rounded-[1.5rem] bg-surface-container-low px-5 py-8 text-sm leading-7 text-on-surface-variant">
                                        {copy.noResults}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="rounded-[2rem] border border-outline-variant/10 bg-white p-6 shadow-sm">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">{copy.runMonitoring}</div>
                            <h2 className="mt-2 text-xl font-headline font-black text-on-surface">{copy.currentJob}</h2>

                            <div className="mt-5 space-y-3 text-sm leading-7 text-on-surface-variant">
                                <div className="rounded-[1.35rem] bg-surface-container-low px-4 py-4">
                                    <span className="font-bold text-on-surface">{copy.status}:</span>{' '}
                                    {searchJobQuery.data?.parser_response?.status || searchJobQuery.data?.status || (activeJobId ? 'queued' : 'idle')}
                                </div>
                                <div className="rounded-[1.35rem] bg-surface-container-low px-4 py-4">
                                    <span className="font-bold text-on-surface">{copy.jobId}:</span>{' '}
                                    {activeJobId || copy.noJob}
                                </div>
                                {summaryQuery.data && (
                                    <div className="rounded-[1.35rem] bg-surface-container-low px-4 py-4">
                                        <span className="font-bold text-on-surface">{tr('Снимок summary', 'Summary snapshot')}:</span>{' '}
                                        {(summaryQuery.data?.parser_response?.generated_from_posts || summaryQuery.data?.generated_from_posts || 0)} {tr('постов синтезировано', 'posts synthesized')}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="rounded-[2rem] border border-outline-variant/10 bg-white p-6 shadow-sm">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">{copy.insights}</div>
                                    <h2 className="mt-2 text-xl font-headline font-black text-on-surface">{copy.groupedSignals}</h2>
                                </div>
                                <span className="rounded-full bg-surface-container-high px-3 py-1 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                                    {insights.length}
                                </span>
                            </div>

                            <div className="mt-5 space-y-3">
                                {insights.map((group) => (
                                    <div key={group.key} className="rounded-[1.35rem] bg-surface-container-low px-4 py-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="text-sm font-bold capitalize text-on-surface">{group.label}</div>
                                            <div className="text-xs font-bold text-primary">{group.count}</div>
                                        </div>
                                        {group.examples.length > 0 && (
                                            <div className="mt-3 space-y-2 text-sm leading-6 text-on-surface-variant">
                                                {group.examples.map((example) => (
                                                    <div key={example}>{example}</div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}

                                {!insights.length && (
                                    <div className="rounded-[1.35rem] bg-surface-container-low px-4 py-5 text-sm leading-6 text-on-surface-variant">
                                        {copy.noInsights}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="rounded-[2rem] border border-outline-variant/10 bg-white p-6 shadow-sm">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">{copy.templates}</div>
                                    <h2 className="mt-2 text-xl font-headline font-black text-on-surface">{copy.savedRecipes}</h2>
                                </div>
                                <Link
                                    to="/projects"
                                    className="rounded-2xl bg-surface-container-high px-4 py-3 text-sm font-black text-on-surface transition-all hover:bg-primary/10 hover:text-primary"
                                >
                                    {copy.back}
                                </Link>
                            </div>

                            <div className="mt-5 space-y-3">
                                {templates.map((template: ApiJson, index: number) => {
                                    const templateId = String(template.id || template.template_id || `template-${index}`)
                                    const label = template.display_name || template.name || template.query || templateId
                                    const detail = template.intent || template.cluster || template.source || copy.template

                                    return (
                                        <div key={templateId} className="rounded-[1.35rem] bg-surface-container-low px-4 py-4">
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="min-w-0">
                                                    <div className="text-sm font-bold text-on-surface">{label}</div>
                                                    <div className="mt-1 text-sm leading-6 text-on-surface-variant">{detail}</div>
                                                </div>
                                                <button
                                                    onClick={() => runTemplate.mutate(templateId)}
                                                    disabled={runTemplate.isPending}
                                                    className="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-primary transition-all hover:bg-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                    {copy.run}
                                                </button>
                                            </div>
                                        </div>
                                    )
                                })}

                                {!templates.length && (
                                    <div className="rounded-[1.35rem] bg-surface-container-low px-4 py-5 text-sm leading-6 text-on-surface-variant">
                                        {copy.noTemplates}
                                    </div>
                                )}
                            </div>
                        </div>

                        {topResult && (
                            <div className="rounded-[2rem] border border-outline-variant/10 bg-white p-6 shadow-sm">
                                <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">{tr('Лучший текущий сигнал', 'Strongest current signal')}</div>
                                <h2 className="mt-2 text-xl font-headline font-black text-on-surface">{topResult.title}</h2>
                                <p className="mt-4 text-sm leading-7 text-on-surface-variant">
                                    {tr('Сейчас это результат с самым высоким score по твоей модели fit. Это самый безопасный кандидат, чтобы следующим шагом превратить его в brief, черновик поста или задачу канала.', 'This result currently has the highest score under your fit model. It is the safest candidate to turn into a brief, post draft, or channel task next.')}
                                </p>
                            </div>
                        )}
                    </div>
                </section>
            </div>
        </div>
    )
}

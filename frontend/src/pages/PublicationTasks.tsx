import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { projectsApi, publicationTasksApi } from '../api'
import { useAuth } from '../context/AuthContext'
import ContentMarkupRenderer from '../components/ContentMarkupRenderer'
import ResourcePreviewCard from '../components/ResourcePreviewCard'
import { useLocale } from '../i18n/LocaleContext'

type JsonRecord = Record<string, any>

interface PublicationTask {
    id: number
    item_key?: string | null
    type: string
    layer?: string | null
    title?: string | null
    brief?: string | null
    key_points?: JsonRecord[] | null
    status: string
    is_active?: boolean
    publication_outcome?: PublicationOutcome | null
    schedule_at?: string | null
    published_link?: string | null
    draft_text?: string | null
    content_state?: 'empty' | 'ready' | 'published'
    content_revision?: number
    generation_stage?: string
    publication_mode?: string | null
    visual_placement?: string | null
    week_package_id?: number | null
    publication_fact?: PublicationFact | null
    metric_checkpoints?: MetricCheckpoint[]
    quality_report?: JsonRecord | null
    metrics?: JsonRecord | null
    assets?: JsonRecord | null
    channel?: {
        id: number
        name: string
        type: string
        config?: JsonRecord | null
    } | null
    project_context?: {
        glossary_available?: boolean
        glossary_yaml?: string | null
        content_policy_matrix_yaml?: string | null
        atoma_files_description?: string | null
        atoma_files_payload?: JsonRecord | JsonRecord[] | null
    } | null
    workspace_context?: {
        plan_item_ref?: string | null
        target_resource_url?: string | null
        target_resource_label?: string | null
        source_content?: string | null
        source_file_name?: string | null
        voice_profile?: string | null
        platform_type?: string | null
    } | null
}

type ArtifactKind = 'post' | 'article' | 'story' | 'email' | 'comment' | 'other'

type PublicationFact = {
    id: number
    artifact_kind: ArtifactKind
    outcome: PublicationOutcome
    published_at?: string | null
    public_url?: string | null
    provider_object_id?: string | null
    confirmation_mode: string
    evidence_type?: string | null
    evidence_ref?: string | null
    target_url?: string | null
    utm_status?: string | null
    confirmed_by?: string | null
    confirmed_at?: string | null
}

type MetricCheckpoint = {
    id: number
    checkpoint: 't24h' | 't7d' | string
    scheduled_for?: string | null
    captured_at?: string | null
    collection_mode?: string
    source?: string
    collection_status?: string
    late?: boolean
    metrics?: JsonRecord
}

type WeekPackageOption = {
    id: number
    week_start: string
    week_end: string
    week_theme?: string | null
    _count?: { content_items?: number }
}

type ContentEditHistoryEntry = {
    edited_at?: string
    previous_body?: string
    next_body?: string
}

type PublicationOutcome = 'published' | 'blocked' | 'removed' | 'restricted'

type TaskQueueGroupKind = 'overdue' | 'scheduled' | 'unscheduled' | 'inactive' | 'completed'

type TaskQueueGroup = {
    key: string
    kind: TaskQueueGroupKind
    date?: string
    tasks: PublicationTask[]
}

type VkMetricSnapshot = {
    id: number
    logical_date: string
    captured_at: string
    wall_status: string
    reach_status: string
    views: number | null
    likes: number | null
    comments: number | null
    reposts: number | null
    reach_total: number | null
    reach_subscribers: number | null
    reach_viral: number | null
    reach_ads: number | null
    link_clicks: number | null
    group_clicks: number | null
    group_joins: number | null
    hides: number | null
    reports: number | null
    unsubscribes: number | null
}

type CriticReview = {
    checked_at?: string
    overall_score?: number
    dictionary?: {
        valid?: boolean
        score?: number
        findings?: Array<{
            severity?: 'error' | 'warning' | 'info'
            message?: string
            matched?: string
            suggestion?: string
        }>
    }
    llm_critic?: {
        score?: number
        critique?: string
        dimensions?: Record<string, number>
        strengths?: string[]
        issues?: string[]
        rewrite_instructions?: string[]
    } | null
    policy_matrix?: {
        score?: number
        dimensions?: Record<string, number>
        findings?: Array<{
            severity?: 'error' | 'warning' | 'info'
            message?: string
            matched?: string
            suggestion?: string
            source?: string
            dimension?: string
        }>
        derived_policy?: JsonRecord
    } | null
    scoring_dimensions?: Record<string, number> | null
    llm_error?: string | null
    glossary_available?: boolean
    content_policy_matrix_available?: boolean
    content_policy_matrix_yaml?: string | null
    atoma_files_description?: string | null
    atoma_files_payload?: JsonRecord | JsonRecord[] | null
}

const PUBLICATION_PLAN_TEMPLATE = `{
  "meta": {
    "plan_id": "distribution-cycle-2026-04-24",
    "cycle_start": "2026-04-24",
    "cycle_end": "2026-05-01",
    "timezone_default": "Europe/Lisbon"
  },
  "accounts": {
    "reddit_main": {
      "platform": "reddit",
      "subreddit": "artificial"
    }
  },
  "assets": {},
  "actions": []
}`

function formatDate(value?: string | null) {
    if (!value) return 'Not scheduled'

    try {
        return format(new Date(value), 'MMM d, HH:mm')
    } catch {
        return value
    }
}

function localDateKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return `${values.year}-${values.month}-${values.day}`
}

function resolveCurrentWeekPackageId(weeks: WeekPackageOption[], today = localDateKey()): number | 'all' {
    const currentWeek = weeks.find((week) => {
        const start = week.week_start.slice(0, 10)
        const end = week.week_end.slice(0, 10)
        return start <= today && today <= end
    })

    return currentWeek?.id || 'all'
}

function inclusiveWeekRange(week?: WeekPackageOption) {
    if (!week) return null
    const end = new Date(week.week_end)
    end.setUTCDate(end.getUTCDate() + 1)
    end.setUTCMilliseconds(end.getUTCMilliseconds() - 1)
    return { from: week.week_start, to: end.toISOString() }
}

function taskMatchesStatusFilter(task: PublicationTask, status: string) {
    if (status === 'all') return true
    if (status === 'active') return task.is_active === true
    if (status === 'published') return taskContentState(task) === 'published'
    if (status === 'blocked' || status === 'removed' || status === 'restricted') {
        return task.publication_outcome === status
    }
    return task.status === status
}

function taskMatchesManualFilter(task: PublicationTask, manualOnly: boolean) {
    if (!manualOnly) return true
    const executionMode = task.quality_report?.execution_mode
    return task.publication_mode === 'browser_required'
        || executionMode === 'manual'
        || executionMode === 'browser'
}

function isTerminalPublicationTask(task: PublicationTask) {
    return task.status === 'cancelled'
        || taskContentState(task) === 'published'
        || ['blocked', 'removed', 'restricted'].includes(task.publication_outcome || '')
}

function taskScheduleTime(task: PublicationTask) {
    const parsed = task.schedule_at ? new Date(task.schedule_at).getTime() : Number.NaN
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}

function isActiveQueueTask(task: PublicationTask) {
    return task.is_active === true && !isTerminalPublicationTask(task)
}

function isOverduePublicationTask(task: PublicationTask, now = Date.now()) {
    return isActiveQueueTask(task) && taskScheduleTime(task) < now
}

function comparePublicationTasks(a: PublicationTask, b: PublicationTask, now: number) {
    const aActive = isActiveQueueTask(a)
    const bActive = isActiveQueueTask(b)
    const aTerminal = isTerminalPublicationTask(a)
    const bTerminal = isTerminalPublicationTask(b)
    const aTime = taskScheduleTime(a)
    const bTime = taskScheduleTime(b)
    const aOverdue = aActive && aTime < now
    const bOverdue = bActive && bTime < now
    const aRank = aOverdue ? 0 : aActive ? 1 : aTerminal ? 3 : 2
    const bRank = bOverdue ? 0 : bActive ? 1 : bTerminal ? 3 : 2

    if (aRank !== bRank) return aRank - bRank
    if (Number.isFinite(aTime) !== Number.isFinite(bTime)) return Number.isFinite(aTime) ? -1 : 1
    if (aTime !== bTime) {
        return aTerminal && bTerminal ? bTime - aTime : aTime - bTime
    }
    return a.id - b.id
}

function groupPublicationTasks(tasks: PublicationTask[], now: number): TaskQueueGroup[] {
    const overdue: PublicationTask[] = []
    const scheduled = new Map<string, PublicationTask[]>()
    const unscheduled: PublicationTask[] = []
    const inactive: PublicationTask[] = []
    const completed: PublicationTask[] = []

    for (const task of tasks) {
        if (isOverduePublicationTask(task, now)) {
            overdue.push(task)
            continue
        }

        if (isActiveQueueTask(task)) {
            const scheduledDate = task.schedule_at?.slice(0, 10)
            if (scheduledDate) {
                const bucket = scheduled.get(scheduledDate) || []
                bucket.push(task)
                scheduled.set(scheduledDate, bucket)
            } else {
                unscheduled.push(task)
            }
            continue
        }

        if (isTerminalPublicationTask(task)) {
            completed.push(task)
        } else {
            inactive.push(task)
        }
    }

    const byScheduleAscending = (a: PublicationTask, b: PublicationTask) => taskScheduleTime(a) - taskScheduleTime(b) || a.id - b.id
    const byScheduleDescending = (a: PublicationTask, b: PublicationTask) => taskScheduleTime(b) - taskScheduleTime(a) || b.id - a.id
    const groups: TaskQueueGroup[] = []

    if (overdue.length) groups.push({ key: 'overdue', kind: 'overdue', tasks: overdue.sort(byScheduleAscending) })
    for (const [date, dateTasks] of Array.from(scheduled.entries()).sort(([a], [b]) => a.localeCompare(b))) {
        groups.push({ key: `scheduled:${date}`, kind: 'scheduled', date, tasks: dateTasks.sort(byScheduleAscending) })
    }
    if (unscheduled.length) groups.push({ key: 'unscheduled', kind: 'unscheduled', tasks: unscheduled.sort((a, b) => a.id - b.id) })
    if (inactive.length) groups.push({ key: 'inactive', kind: 'inactive', tasks: inactive.sort(byScheduleDescending) })
    if (completed.length) groups.push({ key: 'completed', kind: 'completed', tasks: completed.sort(byScheduleDescending) })

    return groups
}

function prettyJson(value: unknown) {
    if (value == null) return ''
    return JSON.stringify(value, null, 2)
}

function formatMetricValue(value: number | null | undefined) {
    return typeof value === 'number' ? new Intl.NumberFormat('ru-RU').format(value) : 'Нет доступа'
}

const VK_PUBLIC_METRICS: Array<[keyof VkMetricSnapshot, string]> = [
    ['views', 'Просмотры'],
    ['likes', 'Лайки'],
    ['comments', 'Комментарии'],
    ['reposts', 'Репосты']
]

const VK_REACH_METRICS: Array<[keyof VkMetricSnapshot, string]> = [
    ['reach_total', 'Общий охват'],
    ['reach_subscribers', 'Охват подписчиков'],
    ['reach_viral', 'Вирусный охват'],
    ['reach_ads', 'Рекламный охват'],
    ['link_clicks', 'Переходы по ссылкам'],
    ['group_clicks', 'Переходы в сообщество'],
    ['group_joins', 'Вступления'],
    ['hides', 'Скрытия'],
    ['reports', 'Жалобы'],
    ['unsubscribes', 'Отписки']
]

function summarizeAtomaContext(description?: string | null, payload?: unknown) {
    const summary: string[] = [
        'ATOMA context explains which source fragments and editorial rules the critic should use when checking the publication text.'
    ]

    if (description?.trim()) {
        summary.push(description.trim())
    }

    if (Array.isArray(payload)) {
        summary.push(`Payload contains ${payload.length} structured ATOMA item${payload.length === 1 ? '' : 's'}.`)
    } else if (payload && typeof payload === 'object') {
        const record = payload as JsonRecord
        const sourceMap = Array.isArray(record.source_map) ? record.source_map.length : 0
        const editorialRules = Array.isArray(record.editorial_rules) ? record.editorial_rules.length : 0
        const topLevelKeys = Object.keys(record)

        if (sourceMap > 0) {
            summary.push(`Source map includes ${sourceMap} linked fragment${sourceMap === 1 ? '' : 's'} from the original materials.`)
        }

        if (editorialRules > 0) {
            summary.push(`Editorial rules include ${editorialRules} machine-readable instruction${editorialRules === 1 ? '' : 's'} for the editor and critic.`)
        }

        if (sourceMap === 0 && editorialRules === 0 && topLevelKeys.length > 0) {
            summary.push(`Payload is present with ${topLevelKeys.length} top-level field${topLevelKeys.length === 1 ? '' : 's'}: ${topLevelKeys.join(', ')}.`)
        }
    }

    return summary.join('\n\n')
}

function executionModeLabel(mode: string) {
    if (mode === 'manual') return 'Вручную'
    if (mode === 'browser' || mode === 'browser_required') return 'Через браузер'
    if (mode === 'automatic' || mode === 'auto') return 'Автоматически'
    return mode.replaceAll('_', ' ')
}

function taskContentState(task: PublicationTask | null | undefined): 'empty' | 'ready' | 'published' {
    if (!task) return 'empty'
    if (task.content_state) return task.content_state
    if (task.status === 'published' || task.published_link) return 'published'
    if (task.draft_text?.trim() || task.quality_report?.handoff_bundle?.publication?.body?.trim()) return 'ready'
    return 'empty'
}

function contentStateLabel(state: 'empty' | 'ready' | 'published') {
    if (state === 'published') return 'Опубликовано'
    if (state === 'ready') return 'Текст готов'
    return 'Нужен текст'
}

function contentStateTone(state: 'empty' | 'ready' | 'published') {
    if (state === 'published') return 'bg-success text-white'
    if (state === 'ready') return 'bg-primary text-white'
    return 'bg-surface-container-high text-on-surface-variant'
}

function contentStateIcon(state: 'empty' | 'ready' | 'published') {
    if (state === 'published') return 'check_circle'
    if (state === 'ready') return 'draft'
    return 'edit_note'
}

function generationStageLabel(stage?: string) {
    const labels: Record<string, string> = {
        topic_approval: 'Тема на утверждении',
        writing: 'Генерация текста',
        content_review: 'Проверка текста',
        visual_production: 'Подготовка визуала',
        ready_for_publication: 'Готово к публикации',
        publishing: 'Публикуется',
        browser_required: 'Нужен браузер',
        published: 'Опубликовано',
        failed: 'Ошибка'
    }
    return labels[stage || ''] || stage || ''
}

function taskChannel(task: PublicationTask) {
    return task.channel?.name || task.layer || task.type
}

function inferArtifactKind(task: PublicationTask | null | undefined): ArtifactKind {
    const type = String(task?.type || '').toLowerCase()
    if (type.includes('story')) return 'story'
    if (type.includes('article')) return 'article'
    if (type.includes('email')) return 'email'
    if (type.includes('comment')) return 'comment'
    if (type.includes('post')) return 'post'
    return 'other'
}

function checkpointLabel(value: string) {
    if (value === 't24h') return 'T+24 часа'
    if (value === 't7d') return 'T+7 дней'
    return value
}

function checkpointStatusLabel(value?: string) {
    const labels: Record<string, string> = {
        pending: 'Ожидает сбора', collected: 'Собран', partial: 'Частично', unknown: 'Нет данных',
        not_supported: 'Не поддерживается', failed: 'Ошибка', overdue: 'Просрочен'
    }
    return labels[value || ''] || value || 'Ожидает'
}

function taskPlanReference(task: PublicationTask | null | undefined) {
    if (!task) return ''

    return task.item_key
        || task.workspace_context?.plan_item_ref
        || (task.assets as JsonRecord | undefined)?.action?.id
        || (task.metrics as JsonRecord | undefined)?.task_id
        || ''
}

function taskIdentifierLabel(task: PublicationTask) {
    const stableRef = taskPlanReference(task)
    return stableRef ? `#${task.id} · ${stableRef}` : `#${task.id}`
}

function taskMatchesSearch(task: PublicationTask, query: string) {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return true

    const planRef = taskPlanReference(task)
    const haystack = [
        task.title || '',
        task.type || '',
        task.layer || '',
        task.channel?.name || '',
        task.channel?.type || '',
        task.brief || '',
        planRef,
        String(task.id)
    ].join(' ').toLowerCase()

    if (haystack.includes(normalizedQuery)) {
        return true
    }

    if (/^\d+$/.test(normalizedQuery)) {
        const numericTokens = Array.from(
            `${task.id} ${planRef} ${task.title || ''} ${task.type || ''}`.matchAll(/\d+/g)
        ).map((match) => match[0])

        return numericTokens.includes(normalizedQuery)
    }

    return false
}

function supportsAutoMetrics(task: PublicationTask | null | undefined) {
    if (!task) return false

    if (task.channel?.type === 'reddit' || task.channel?.type === 'linkedin' || task.channel?.type === 'google_search_console') {
        return true
    }

    if (task.channel?.type === 'tilda') {
        return Boolean(task.metrics?.monitoring?.needs_analytics_collection)
    }

    return false
}

function supportsDirectPlannerPublish(task: PublicationTask | null | undefined) {
    const type = task?.channel?.type
    if (!type) return false
    return ['telegram', 'vk', 'linkedin', 'reddit', 'tilda', 'ok', 'odnoklassniki', 'habr', 'habr_article', 'vc', 'vc_article', 'zen', 'zen_article', 'dzen'].includes(type)
}

function isOperationalWorkflowTask(task: PublicationTask | null | undefined) {
    if (!task) return false

    const type = String(task.type || '').toLowerCase()
    const layer = String(task.layer || '').toLowerCase()
    const channelType = String(task.channel?.type || '').toLowerCase()
    const channelName = String(task.channel?.name || '').toLowerCase()

    return type.includes('manual_handoff')
        || type.includes('weekly_metrics')
        || layer.includes('growth')
        || channelType.includes('growth')
        || channelName.includes('growth')
}

function formatUiError(error: unknown, fallback: string) {
    if (!(error instanceof Error)) return fallback

    const message = error.message?.trim()
    if (!message) return fallback

    if (message === 'Bad Request') {
        return `${fallback} Сервер вернул 400 — проверь настройки канала, доступ адаптера и обязательные поля публикации.`
    }

    return message
}

function assetInlineContent(entry: JsonRecord | null | undefined) {
    if (!entry) return ''
    if (typeof entry.content === 'string' && entry.content.trim()) return entry.content
    if (typeof entry.asset?.content === 'string' && entry.asset.content.trim()) return entry.asset.content
    return ''
}

function asJsonRecordArray(value: unknown): JsonRecord[] {
    if (!Array.isArray(value)) return []
    return value.filter((entry): entry is JsonRecord => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
}

function mergeSourceFiles(task: PublicationTask | null | undefined) {
    const handoffFiles = asJsonRecordArray((task?.quality_report?.handoff_bundle as JsonRecord | undefined)?.resource_files)
    const resolvedAssets = asJsonRecordArray(task?.assets?.resolved_assets)
    const merged = new Map<string, JsonRecord>()

    const score = (entry: JsonRecord) => {
        let total = 0
        if (assetInlineContent(entry)) total += 10
        if (entry.exists === true) total += 5
        if (entry.relative_path || entry.asset?.path) total += 3
        if (entry.file_name || entry.ref) total += 1
        return total
    }

    ;[...handoffFiles, ...resolvedAssets].forEach((entry, index) => {
        const key = String(entry?.ref || entry?.file_name || entry?.asset?.path || `fallback-${index}`)
        const current = merged.get(key)
        if (!current || score(entry) > score(current)) {
            merged.set(key, entry)
        }
    })

    return Array.from(merged.values())
}

function resolvePrimarySourceContent(task: PublicationTask | null | undefined, sourceFiles: JsonRecord[]) {
    if (typeof task?.workspace_context?.source_content === 'string' && task.workspace_context.source_content.trim()) {
        return task.workspace_context.source_content
    }

    const handoffBody = (task?.quality_report?.handoff_bundle as JsonRecord | undefined)?.publication?.body
    if (typeof handoffBody === 'string' && handoffBody.trim()) {
        return handoffBody
    }

    for (const entry of sourceFiles) {
        const content = assetInlineContent(entry)
        if (content) return content
    }

    const keyPoints = asJsonRecordArray(task?.key_points)
    for (const entry of keyPoints) {
        const content = assetInlineContent(entry)
        if (content) return content
    }

    return ''
}

function resolvePrimarySourceEntry(task: PublicationTask | null | undefined, sourceFiles: JsonRecord[]) {
    if (!task) return null

    const preferred = sourceFiles.find((entry) => {
        const content = assetInlineContent(entry)
        const url = entry?.preview_url || entry?.url || entry?.asset?.url || entry?.asset?.target_url
        return Boolean(content || url)
    })

    if (preferred) return preferred

    const content = resolvePrimarySourceContent(task, sourceFiles)
    if (!content) return null

    return {
        file_name: task.workspace_context?.source_file_name || 'source-content',
        content,
        content_type: 'text/markdown'
    }
}

export default function PublicationTasks() {
    const { locale } = useLocale()
    const copy = locale === 'ru' ? {
        title: 'Задачи на публикацию', project: 'Проект', chooseProject: 'Выбери или импортируй проект с планом публикаций.', tasks: 'задач', importPlan: 'Импортировать или обновить план публикаций',
        searchPlaceholder: 'Номер #760, название или канал', searchLabel: 'Поиск по задачам', weekLabel: 'Неделя публикаций', allWeeks: 'Все недели / история', statusLabel: 'Статус задач',
        allStatuses: 'Все статусы', active: 'Активные', planned: 'Запланированные', awaitingManual: 'Ждут ручной публикации', ready: 'Готовы', browser: 'Нужна публикация через браузер', deferred: 'Отложенные', publishedPlural: 'Опубликованные', blockedPlural: 'Заблокированные', removedPlural: 'Удалённые с площадки', restricted: 'Ограниченные', cancelledPlural: 'Отменённые', failed: 'С ошибкой',
        manualOnly: 'Только ручные', allModes: 'Все режимы', textReadiness: 'Готовность текста', packageState: 'Состояние пакета', noText: 'Без текста', textReady: 'Текст готов', published: 'Опубликовано', packageContents: 'Состав недельного пакета', blocked: 'Заблокировано', removed: 'Удалено', cancelled: 'Отменено',
        noResults: 'По выбранным условиям задач не найдено.', reset: 'Сбросить фильтры', importFirst: 'Сначала импортируй план публикаций, а затем выбери проект для работы с очередью задач.',
        queueOverdue: 'Просроченные активные', queueUnscheduled: 'Активные без даты', queueInactive: 'Вне активной очереди', queueCompleted: 'Опубликованные и завершённые',
        taskMaterial: 'Рабочий материал задачи', publicationText: 'Текст публикации', resultPreview: 'Предпросмотр результата', publicationPreview: 'Предпросмотр публикации', executionContext: 'Контекст выполнения', publicationContext: 'Контекст публикации', resultLink: 'Ссылка на результат задачи', postLink: 'Ссылка на сам пост', buildTaskPackage: 'Собрать пакет задачи', prepareDraft: 'Подготовить черновик',
        openWeekPlan: 'Открыть план недели', preparing: 'Собираем...', publishing: 'Публикуем...', publishChannel: 'Опубликовать в канал', publishNow: 'Опубликовать сейчас', publicationStages: 'Этапы публикации', slotCreated: 'Слот создан',
        readerView: 'как увидит читатель', emptyPublication: 'Текст публикации пока пуст.', publication: 'Публикация', resultRecorded: 'Результат уже зафиксирован.', publishAndSave: 'Опубликуйте текст и сохраните ссылку на пост.', channel: 'Канал', mode: 'Режим', placementType: 'Тип размещения', post: 'Пост', article: 'Статья', story: 'Story без постоянной ссылки', email: 'Email-рассылка', comment: 'Комментарий', otherArtifact: 'Другой артефакт', publicLinkOptional: 'Публичная ссылка, если есть', permalinkRequired: 'Permalink обязателен для этого типа.', linkOptional: 'Для story и email ссылка может отсутствовать.', providerId: 'ID у площадки', placementEvidence: 'Доказательство размещения', targetLink: 'Целевая ссылка / UTM', publicationResult: 'Результат публикации', publishedNormally: 'Опубликовано нормально', blockedWithUrl: 'Заблокировано, но URL есть', removedWithUrl: 'Удалено, но URL есть', restrictedVisibility: 'Ограниченная видимость', publicationNote: 'Заметка о публикации', optionalNote: 'Необязательная заметка о публикации', saving: 'Сохраняем...', saveCorrection: 'Сохранить исправление факта', recordFact: 'Зафиксировать факт публикации', factConfirmed: 'Факт подтверждён', actor: 'Актор', materialsContext: 'Материалы и контекст', planItem: 'Пункт плана', sourceResource: 'Исходный ресурс', notLinked: 'Не привязано', notFound: 'Не найден', openResource: 'Открыть рабочий ресурс', metricSnapshots: 'Контрольные снимки', metricSnapshotsHelp: 'T+24h и T+7d хранятся раздельно; неизвестное значение не считается нулём.', collectedLate: 'Собран поздно', due: 'Срок', metricsJson: 'Метрики JSON v1', savingSnapshot: 'Сохраняем снимок...', saveSnapshot: 'Сохранить', postImage: 'Изображение к посту', visualGateHelp: 'Генерация откроется после утверждения недельных тем, принятия текущей версии текста и решения арт-директора «Создать визуал» с готовым alt-текстом.', generating: 'Генерируем...', draftEconomy: 'Черновик · экономно', preparingVisual: 'Подготовка...', finalStandard: 'Финал · стандарт', flagshipFull: 'Флагман · полный цикл', flagshipHelp: 'Полная агентная цепочка и повторная отрисовка — только для ключевых публикаций', imageCandidate: 'Кандидат изображения к публикации', noGeneratedImage: 'Сгенерированное изображение пока не добавлено.', technicalDetails: 'Технические детали', technicalDetailsHelp: 'Мониторинг и служебные поля спрятаны сюда, чтобы не занимать первый экран.'
    } : {
        title: 'Publication tasks', project: 'Project', chooseProject: 'Choose or import a project with a publication plan.', tasks: 'tasks', importPlan: 'Import or update publication plan',
        searchPlaceholder: 'Task #760, title, or channel', searchLabel: 'Search tasks', weekLabel: 'Publication week', allWeeks: 'All weeks / history', statusLabel: 'Task status',
        allStatuses: 'All statuses', active: 'Active', planned: 'Planned', awaitingManual: 'Awaiting manual publication', ready: 'Ready', browser: 'Browser publication required', deferred: 'Deferred', publishedPlural: 'Published', blockedPlural: 'Blocked', removedPlural: 'Removed from channel', restricted: 'Restricted', cancelledPlural: 'Cancelled', failed: 'Failed',
        manualOnly: 'Manual only', allModes: 'All modes', textReadiness: 'Content readiness', packageState: 'Package state', noText: 'No content', textReady: 'Content ready', published: 'Published', packageContents: 'Weekly package contents', blocked: 'Blocked', removed: 'Removed', cancelled: 'Cancelled',
        noResults: 'No tasks match the selected filters.', reset: 'Reset filters', importFirst: 'Import a publication plan, then choose a project to work with its task queue.',
        queueOverdue: 'Overdue active tasks', queueUnscheduled: 'Active tasks without a date', queueInactive: 'Outside the active queue', queueCompleted: 'Published and completed',
        taskMaterial: 'Task working material', publicationText: 'Publication content', resultPreview: 'Result preview', publicationPreview: 'Publication preview', executionContext: 'Execution context', publicationContext: 'Publication context', resultLink: 'Task result link', postLink: 'Live post link', buildTaskPackage: 'Build task package', prepareDraft: 'Prepare draft',
        openWeekPlan: 'Open weekly plan', preparing: 'Preparing...', publishing: 'Publishing...', publishChannel: 'Publish to channel', publishNow: 'Publish now', publicationStages: 'Publication stages', slotCreated: 'Slot created',
        readerView: 'reader view', emptyPublication: 'Publication content is empty.', publication: 'Publication', resultRecorded: 'The result has already been recorded.', publishAndSave: 'Publish the content and save its live link.', channel: 'Channel', mode: 'Mode', placementType: 'Placement type', post: 'Post', article: 'Article', story: 'Story without a permanent link', email: 'Email campaign', comment: 'Comment', otherArtifact: 'Other artifact', publicLinkOptional: 'Public link, if available', permalinkRequired: 'A permalink is required for this placement.', linkOptional: 'Stories and email campaigns may not have a public link.', providerId: 'Provider object ID', placementEvidence: 'Placement evidence', targetLink: 'Target link / UTM', publicationResult: 'Publication outcome', publishedNormally: 'Published successfully', blockedWithUrl: 'Blocked, URL available', removedWithUrl: 'Removed, URL available', restrictedVisibility: 'Restricted visibility', publicationNote: 'Publication note', optionalNote: 'Optional publication note', saving: 'Saving...', saveCorrection: 'Save fact correction', recordFact: 'Record publication fact', factConfirmed: 'Fact confirmed', actor: 'Actor', materialsContext: 'Materials and context', planItem: 'Plan item', sourceResource: 'Source resource', notLinked: 'Not linked', notFound: 'Not found', openResource: 'Open working resource', metricSnapshots: 'Metric checkpoints', metricSnapshotsHelp: 'T+24h and T+7d are stored separately; an unknown value is not treated as zero.', collectedLate: 'Collected late', due: 'Due', metricsJson: 'Metrics JSON v1', savingSnapshot: 'Saving snapshot...', saveSnapshot: 'Save', postImage: 'Publication image', visualGateHelp: 'Generation unlocks after weekly topics are approved, the current content revision is accepted, and the art director chooses “Generate visual” with approved alt text.', generating: 'Generating...', draftEconomy: 'Draft · economy', preparingVisual: 'Preparing...', finalStandard: 'Final · standard', flagshipFull: 'Flagship · full pipeline', flagshipHelp: 'Full agent pipeline and rerendering are reserved for key publications', imageCandidate: 'Publication image candidate', noGeneratedImage: 'No generated image has been added.', technicalDetails: 'Technical details', technicalDetailsHelp: 'Monitoring and system fields are collapsed so the main workspace stays focused.'
    }
    const queryClient = useQueryClient()
    const { currentProject, projects, createProject, setCurrentProject } = useAuth()
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const urlTaskId = searchParams.get('taskId')

    const [statusFilter, setStatusFilter] = useState('all')
    const [manualOnly, setManualOnly] = useState(false)
    const [contentStateFilter, setContentStateFilter] = useState<'all' | 'empty' | 'ready' | 'published'>('all')
    const [taskSearch, setTaskSearch] = useState('')
    const [showTaskFilterDetails, setShowTaskFilterDetails] = useState(false)
    const [weekPackageId, setWeekPackageId] = useState<number | 'all' | null>(null)
    const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
    const [mobileTaskOpen, setMobileTaskOpen] = useState(false)
    const [planJson, setPlanJson] = useState(PUBLICATION_PLAN_TEMPLATE)
    const [planMessage, setPlanMessage] = useState<string | null>(null)
    const [taskMessage, setTaskMessage] = useState<string | null>(null)
    const [showPlanModal, setShowPlanModal] = useState(false)

    const [publishedLink, setPublishedLink] = useState('')
    const [publicationNote, setPublicationNote] = useState('')
    const [publicationOutcome, setPublicationOutcome] = useState<PublicationOutcome>('published')
    const [artifactKind, setArtifactKind] = useState<ArtifactKind>('post')
    const [providerObjectId, setProviderObjectId] = useState('')
    const [evidenceRef, setEvidenceRef] = useState('')
    const [targetUrl, setTargetUrl] = useState('')
    const [selectedCheckpoint, setSelectedCheckpoint] = useState<'t24h' | 't7d'>('t24h')
    const [publicationBody, setPublicationBody] = useState('')
    const [metricsJson, setMetricsJson] = useState('{\n  "schema_version": 1,\n  "values": {\n    "views": { "value": 0, "status": "observed" },\n    "reactions": { "value": 0, "status": "observed" },\n    "platform_clicks": { "value": null, "status": "unknown" }\n  }\n}')
    const [commentAuthor, setCommentAuthor] = useState('')
    const [commentUrl, setCommentUrl] = useState('')
    const [commentText, setCommentText] = useState('')
    const [criticReport, setCriticReport] = useState<CriticReview | null>(null)
    const workspaceRef = useRef<HTMLElement | null>(null)
    const initializedWeekProjectIdRef = useRef<number | null>(null)

    const { data: weekPackages } = useQuery<WeekPackageOption[]>({
        queryKey: ['publication_task_weeks', currentProject?.id],
        queryFn: () => publicationTasksApi.listWeeks(),
        enabled: !!currentProject
    })

    useEffect(() => {
        if (!currentProject || !weekPackages) return
        if (initializedWeekProjectIdRef.current === currentProject.id && weekPackageId !== null) return

        setWeekPackageId(urlTaskId ? 'all' : resolveCurrentWeekPackageId(weekPackages))
        initializedWeekProjectIdRef.current = currentProject.id
    }, [currentProject, urlTaskId, weekPackageId, weekPackages])

    const selectedWeekPackage = typeof weekPackageId === 'number'
        ? weekPackages?.find((week) => week.id === weekPackageId)
        : undefined
    const selectedWeekRange = inclusiveWeekRange(selectedWeekPackage)

    const { data: tasks, isLoading, error } = useQuery<PublicationTask[]>({
        queryKey: ['publication_tasks', currentProject?.id, 'all', weekPackageId],
        queryFn: () => publicationTasksApi.list({
            status: 'all',
            weekPackageId: typeof weekPackageId === 'number' ? weekPackageId : undefined
        }),
        enabled: !!currentProject && weekPackageId !== null
    })

    const { data: datedWeekTasks } = useQuery<PublicationTask[]>({
        queryKey: ['publication_tasks_by_date', currentProject?.id, weekPackageId, selectedWeekRange?.from, selectedWeekRange?.to],
        queryFn: () => publicationTasksApi.list({
            status: 'all',
            from: selectedWeekRange?.from,
            to: selectedWeekRange?.to
        }),
        enabled: !!currentProject && typeof weekPackageId === 'number' && !!selectedWeekRange
    })

    const crossPackageTasks = useMemo(
        () => typeof weekPackageId === 'number'
            ? (datedWeekTasks || []).filter((task) => task.week_package_id !== weekPackageId)
            : [],
        [datedWeekTasks, weekPackageId]
    )

    const taskPool = useMemo(() => {
        const byId = new Map<number, PublicationTask>()
        ;[...(tasks || []), ...crossPackageTasks].forEach((task) => byId.set(task.id, task))
        return Array.from(byId.values())
    }, [tasks, crossPackageTasks])

    const filteredTasks = useMemo(
        () => {
            const now = Date.now()
            return taskPool
                .filter((task) => taskMatchesStatusFilter(task, statusFilter))
                .filter((task) => taskMatchesManualFilter(task, manualOnly))
                .filter((task) => contentStateFilter === 'all' || taskContentState(task) === contentStateFilter)
                .filter((task) => taskMatchesSearch(task, taskSearch))
                .sort((a, b) => comparePublicationTasks(a, b, now))
        },
        [taskPool, statusFilter, manualOnly, contentStateFilter, taskSearch]
    )

    const taskQueueGroups = useMemo(
        () => groupPublicationTasks(filteredTasks, Date.now()),
        [filteredTasks]
    )

    const taskQueueGroupLabel = (group: TaskQueueGroup) => {
        if (group.kind === 'scheduled' && group.date) return formatDate(group.date)
        if (group.kind === 'overdue') return copy.queueOverdue
        if (group.kind === 'unscheduled') return copy.queueUnscheduled
        if (group.kind === 'inactive') return copy.queueInactive
        return copy.queueCompleted
    }

    const statusCounts = useMemo(() => ({
        active: (tasks || []).filter((task) => task.is_active === true).length,
        published: (tasks || []).filter((task) => taskContentState(task) === 'published').length,
        blocked: (tasks || []).filter((task) => task.publication_outcome === 'blocked').length,
        removed: (tasks || []).filter((task) => task.publication_outcome === 'removed').length,
        cancelled: (tasks || []).filter((task) => task.status === 'cancelled').length
    }), [tasks])

    const dateMismatchIds = useMemo(() => {
        if (!selectedWeekPackage) return new Set<number>()
        const start = selectedWeekPackage.week_start.slice(0, 10)
        const end = selectedWeekPackage.week_end.slice(0, 10)
        return new Set((tasks || [])
            .filter((task) => {
                const date = task.schedule_at?.slice(0, 10)
                return Boolean(date && (date < start || date > end))
            })
            .map((task) => task.id))
    }, [tasks, selectedWeekPackage])

    const crossPackageIds = useMemo(
        () => new Set(crossPackageTasks.map((task) => task.id)),
        [crossPackageTasks]
    )
    const packageRecordCount = selectedWeekPackage?._count?.content_items || 0
    const nonPublicationRecordCount = Math.max(0, packageRecordCount - (tasks?.length || 0))

    const selectStatusFilter = (nextStatus: string) => {
        setStatusFilter(nextStatus)
        if (nextStatus === 'published') {
            setContentStateFilter('published')
        } else if (contentStateFilter === 'published') {
            setContentStateFilter('all')
        }
    }

    const toggleContentStateFilter = (nextState: 'empty' | 'ready' | 'published') => {
        if (contentStateFilter === nextState) {
            setContentStateFilter('all')
            if (nextState === 'published') setStatusFilter('all')
            return
        }

        setContentStateFilter(nextState)
        setStatusFilter(nextState === 'published' ? 'published' : (statusFilter === 'published' ? 'all' : statusFilter))
    }

    const resetTaskFilters = () => {
        setStatusFilter('all')
        setManualOnly(false)
        setContentStateFilter('all')
        setTaskSearch('')
    }

    const selectedFromList = useMemo(
        () => filteredTasks.find((task) => task.id === selectedTaskId) || null,
        [filteredTasks, selectedTaskId]
    )

    const { data: selectedTask, isFetching: isLoadingTask } = useQuery<PublicationTask>({
        queryKey: ['publication_task_detail', currentProject?.id, selectedTaskId],
        queryFn: () => publicationTasksApi.get(selectedTaskId as number),
        enabled: !!selectedTaskId && !!currentProject
    })

    useEffect(() => {
        if (urlTaskId && selectedTask?.status === 'published') {
            setStatusFilter('published')
            setContentStateFilter('published')
        }
    }, [urlTaskId, selectedTask?.status])

    useEffect(() => {
        if (urlTaskId) {
            const idNum = parseInt(urlTaskId)
            if (!isNaN(idNum)) {
                setSelectedTaskId(idNum)
                setMobileTaskOpen(true)
            }
        } else {
            setSelectedTaskId(null)
            setMobileTaskOpen(false)
        }
    }, [urlTaskId, currentProject?.id])

    const openTask = (taskId: number) => {
        setSelectedTaskId(taskId)
        setMobileTaskOpen(true)
        window.requestAnimationFrame(() => {
            workspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
    }

    const closeMobileTask = () => {
        setMobileTaskOpen(false)
        window.requestAnimationFrame(() => {
            workspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
    }

    useEffect(() => {
        if (!filteredTasks.length) {
            if (!isLoading && !urlTaskId) {
                setSelectedTaskId(null)
            }
            return
        }

        const exists = filteredTasks.some((task) => task.id === selectedTaskId)
        if (!exists) {
            const urlIdNum = urlTaskId ? parseInt(urlTaskId) : null
            const hasUrlTaskInFiltered = urlIdNum ? filteredTasks.some((task) => task.id === urlIdNum) : false

            if (urlIdNum && hasUrlTaskInFiltered) {
                setSelectedTaskId(urlIdNum)
            } else if (!urlIdNum || (!isLoading && !hasUrlTaskInFiltered)) {
                setSelectedTaskId(filteredTasks[0].id)
            }
        }
    }, [filteredTasks, selectedTaskId, urlTaskId, isLoading])

    useEffect(() => {
        const nextBody = ((selectedTask?.quality_report?.handoff_bundle as JsonRecord | undefined)?.publication?.body
            || selectedTask?.draft_text
            || selectedTask?.workspace_context?.source_content
            || '') as string
        setPublicationBody(nextBody)
        setPublishedLink(selectedTask?.published_link || '')
        setPublicationNote(selectedTask?.quality_report?.manual_publication_note || '')
        setPublicationOutcome((selectedTask?.publication_fact?.outcome || selectedTask?.quality_report?.publication_outcome || selectedTask?.metrics?.publication_outcome || 'published') as PublicationOutcome)
        setArtifactKind(selectedTask?.publication_fact?.artifact_kind || inferArtifactKind(selectedTask))
        setProviderObjectId(selectedTask?.publication_fact?.provider_object_id || '')
        setEvidenceRef(selectedTask?.publication_fact?.evidence_ref || '')
        setTargetUrl(selectedTask?.publication_fact?.target_url || '')
        setMetricsJson(prettyJson(selectedTask?.metric_checkpoints?.find((entry) => entry.checkpoint === selectedCheckpoint)?.metrics || {
            schema_version: 1,
            values: {
                views: { value: 0, status: 'observed' },
                reactions: { value: 0, status: 'observed' },
                platform_clicks: { value: null, status: 'unknown' }
            }
        }))
        setCriticReport((selectedTask?.quality_report?.critic_review as CriticReview | undefined) || null)
        setCommentAuthor('')
        setCommentUrl('')
        setCommentText('')
        setTaskMessage(null)
    }, [selectedTask?.id, selectedCheckpoint])

    const refreshTasks = () => {
        queryClient.invalidateQueries({ queryKey: ['publication_tasks'] })
        queryClient.invalidateQueries({ queryKey: ['publication_task_detail'] })
    }

    const importPlan = useMutation({
        mutationFn: () => projectsApi.importPublicationPlan(planJson),
        onSuccess: (result: any) => {
            const project = result?.project
            const imported = result?.imported
            setPlanMessage(`Plan synced: ${imported?.actions || 0} actions, ${imported?.accounts || 0} adapters, ${imported?.updatedExistingProject ? 'existing project updated' : 'new project created'}.`)

            if (!project) {
                refreshTasks()
                return
            }

            if (currentProject?.id === project.id) {
                refreshTasks()
                return
            }

            const existingProject = projects.find((entry) => entry.id === project.id)
            if (existingProject) {
                setCurrentProject(existingProject)
                return
            }

            createProject({ id: project.id, name: project.name })
        }
    })

    const prepareHandoff = useMutation({
        mutationFn: (taskId: number) => publicationTasksApi.prepareHandoff(taskId),
        onSuccess: () => {
            setTaskMessage('Handoff-пакет подготовлен.')
            refreshTasks()
        }
    })

    const activeTask = selectedTask || selectedFromList
    const activeTaskId = activeTask?.id ?? selectedTaskId
    const { data: visualReadiness } = useQuery<any>({
        queryKey: ['publication_task_visual_readiness', currentProject?.id, activeTaskId],
        queryFn: () => publicationTasksApi.getVisualReadiness(activeTaskId as number),
        enabled: !!activeTaskId && !!currentProject
    })
    const isVkTask = activeTask?.channel?.type === 'vk'
    const { data: vkMetricsHistory, isFetching: isLoadingVkMetrics } = useQuery<{ snapshots: VkMetricSnapshot[] }>({
        queryKey: ['vk_metrics_history', currentProject?.id, activeTaskId],
        queryFn: () => publicationTasksApi.getMetricsHistory(activeTaskId as number),
        enabled: !!activeTaskId && !!currentProject && isVkTask && activeTask?.status === 'published'
    })

    const saveTaskContent = useMutation({
        mutationFn: () => {
            if (!activeTaskId) throw new Error('Задача не выбрана')
            return publicationTasksApi.saveContent(activeTaskId, {
                body: publicationBody
            })
        },
        onSuccess: () => {
            setTaskMessage('Текст публикации сохранён.')
            refreshTasks()
        }
    })

    const confirmPublication = useMutation({
        mutationFn: () => {
            if (!activeTaskId) throw new Error('Задача не выбрана')
            return publicationTasksApi.recordPublicationFact(activeTaskId, {
                artifactKind,
                outcome: publicationOutcome,
                publishedAt: new Date().toISOString(),
                publicUrl: publishedLink.trim() || null,
                providerObjectId: providerObjectId.trim() || null,
                confirmationMode: 'manual',
                evidence: evidenceRef.trim()
                    ? { type: 'screenshot', ref: evidenceRef.trim() }
                    : publishedLink.trim()
                        ? { type: 'public_url', ref: publishedLink.trim() }
                        : null,
                targetUrl: targetUrl.trim() || null,
                note: publicationNote || undefined,
                correctionReason: activeTask?.publication_fact ? publicationNote || 'Исправление оператором' : undefined
            })
        },
        onSuccess: () => {
            setTaskMessage(publicationOutcome === 'published'
                ? 'Публикация подтверждена. Теперь можно подтянуть метрики из канала или сохранить их вручную.'
                : `Ссылка на публикацию сохранена с исходом: ${publicationOutcome}. Задача остаётся подтверждённой, даже если пост заблокирован или ограничен.`)
            refreshTasks()
        }
    })

    const publishTaskNow = useMutation({
        mutationFn: () => {
            if (!activeTaskId) throw new Error('Задача не выбрана')
            return publicationTasksApi.publishNow(activeTaskId)
        },
        onSuccess: (result: any) => {
            const outcome = result?.result
            if (outcome?.manualFallback) {
                setTaskMessage(`Автопубликация потребовала ручного шага${outcome?.reason ? `. ${outcome.reason}` : '.'}`)
            } else {
                setTaskMessage(`Публикация запущена через адаптер${outcome?.adapter ? `: ${outcome.adapter}` : ''}.`)
            }
            refreshTasks()
            queryClient.invalidateQueries({ queryKey: ['vk_metrics_history', currentProject?.id, activeTaskId] })
        }
    })

    const runCriticCheck = useMutation({
        mutationFn: () => {
            if (!activeTaskId) throw new Error('Задача не выбрана')
            const reviewText = (selectedTask?.quality_report?.handoff_bundle as JsonRecord | undefined)?.publication?.body
                || selectedTask?.workspace_context?.source_content
                || ''
            return publicationTasksApi.criticCheck(activeTaskId, { text: reviewText })
        },
        onSuccess: (result: CriticReview) => {
            setCriticReport(result)
            setTaskMessage('Проверка критиком завершена. Отчёт обновлён.')
            refreshTasks()
        }
    })

    const runCriticFixer = useMutation({
        mutationFn: () => {
            if (!activeTaskId) throw new Error('Задача не выбрана')
            const reviewText = publicationBody || selectedTask?.workspace_context?.source_content || ''
            return publicationTasksApi.fixWithCritic(activeTaskId, { text: reviewText })
        },
        onSuccess: (result: any) => {
            if (typeof result?.updated_text === 'string') {
                setPublicationBody(result.updated_text)
            }
            if (result?.critic_review) {
                setCriticReport(result.critic_review)
            }
            setTaskMessage('Фиксер применил замечания критика и обновил текст публикации.')
            refreshTasks()
        }
    })

    const generateTaskImage = useMutation({
        mutationFn: (provider: 'preview' | 'final' | 'flagship' = 'preview') => {
            if (!activeTaskId) throw new Error('Задача не выбрана')
            return publicationTasksApi.generateImage(activeTaskId, { provider })
        },
        onSuccess: () => {
            setTaskMessage('Кандидат изображения создан и передан на визуальное ревью.')
            refreshTasks()
        },
        onError: (error: Error) => {
            setTaskMessage(error.message)
        }
    })

    const collectMetrics = useMutation({
        mutationFn: () => {
            if (!activeTaskId) throw new Error('Задача не выбрана')
            return publicationTasksApi.collectMetrics(activeTaskId)
        },
        onSuccess: (result: any) => {
            setTaskMessage(result?.updated
                ? `Метрики получены из канала${result?.reason ? `. ${result.reason}` : '.'}`
                : (result?.reason || 'Метрики не были обновлены.'))
            refreshTasks()
            queryClient.invalidateQueries({ queryKey: ['vk_metrics_history', currentProject?.id, activeTaskId] })
        }
    })

    const recordMetrics = useMutation({
        mutationFn: () => {
            if (!activeTaskId) throw new Error('Задача не выбрана')
            const checkpoint = activeTask?.metric_checkpoints?.find((entry) => entry.checkpoint === selectedCheckpoint)
            if (!activeTask?.channel?.id) throw new Error('У задачи не указан канал')
            return publicationTasksApi.recordMetricCheckpoint(activeTaskId, selectedCheckpoint, {
                channelId: activeTask.channel.id,
                metrics: JSON.parse(metricsJson),
                scheduledFor: checkpoint?.scheduled_for || undefined,
                capturedAt: new Date().toISOString(),
                collectionMode: 'manual',
                source: 'manual',
                collectionStatus: 'collected',
                idempotencyKey: `manual:${activeTaskId}:${selectedCheckpoint}:${Date.now()}`
            })
        },
        onSuccess: () => {
            setTaskMessage('Снимок метрик сохранён вручную.')
            refreshTasks()
        }
    })

    const sendCommentAlert = useMutation({
        mutationFn: () => {
            if (!activeTaskId) throw new Error('Задача не выбрана')
            return publicationTasksApi.externalCommentAlert(activeTaskId, {
                author: commentAuthor || undefined,
                commentUrl: commentUrl || undefined,
                text: commentText || undefined
            })
        },
        onSuccess: () => {
            setCommentAuthor('')
            setCommentUrl('')
            setCommentText('')
            setTaskMessage('Внешний алерт по комментарию сохранён.')
            refreshTasks()
        }
    })

    useEffect(() => {
        prepareHandoff.reset()
        saveTaskContent.reset()
        confirmPublication.reset()
        publishTaskNow.reset()
        runCriticCheck.reset()
        generateTaskImage.reset()
        collectMetrics.reset()
        recordMetrics.reset()
        sendCommentAlert.reset()
    }, [activeTaskId, currentProject?.id])

    const handoffBundle = activeTask?.quality_report?.handoff_bundle as JsonRecord | undefined
    const sourceFiles = mergeSourceFiles(activeTask)
    const primarySourceEntry = resolvePrimarySourceEntry(activeTask, sourceFiles)
    const executionMode = activeTask?.publication_mode === 'browser_required'
        ? 'browser_required'
        : handoffBundle?.mode || activeTask?.quality_report?.execution_mode || 'manual'
    const activeOutcome = (activeTask?.publication_fact?.outcome || activeTask?.quality_report?.publication_outcome || activeTask?.metrics?.publication_outcome || 'published') as PublicationOutcome
    const publicationFact = activeTask?.publication_fact || null
    const metricCheckpoints = activeTask?.metric_checkpoints || []
    const isTaskOverdue = activeTask ? isOverduePublicationTask(activeTask) : false
    const visualGateOpen = visualReadiness?.ready !== false
    const canGenerateVisual = visualReadiness?.text_state === 'accepted'
        && visualReadiness?.accepted_revision === visualReadiness?.content_revision
        && visualReadiness?.decision?.decision === 'GENERATE'
        && visualReadiness?.decision?.source_content_revision === visualReadiness?.accepted_revision
        && Boolean(visualReadiness?.decision?.alt_text)
    const canPrepareHandoff = !!activeTask && !['published', 'skipped'].includes(activeTask.status) && visualGateOpen
    const canPublishNow = !!activeTask
        && supportsDirectPlannerPublish(activeTask)
        && visualGateOpen
        && activeTask.status !== 'browser_required'
        && ['planned', 'ready_for_execution', 'awaiting_manual_publication', 'failed'].includes(activeTask.status)
    const canFetchMetrics = taskContentState(activeTask) === 'published' && supportsAutoMetrics(activeTask)
    const vkSnapshots = vkMetricsHistory?.snapshots || []
    const latestVkSnapshot = vkSnapshots[vkSnapshots.length - 1]
    const targetResourceUrl = activeTask?.workspace_context?.target_resource_url || handoffBundle?.publication?.link_url || ''
    const planItemRef = activeTask?.workspace_context?.plan_item_ref || (activeTask?.assets as JsonRecord | undefined)?.action?.id || (activeTask?.metrics as JsonRecord | undefined)?.task_id || ''
    const glossaryAvailable = activeTask?.project_context?.glossary_available === true
    const glossaryYaml = activeTask?.project_context?.glossary_yaml || ''
    const atomaDescription = activeTask?.project_context?.atoma_files_description || ''
    const atomaPayload = activeTask?.project_context?.atoma_files_payload
    const atomaSummary = summarizeAtomaContext(atomaDescription, atomaPayload)
    const generatedVisualCandidates = ((activeTask?.assets as JsonRecord | undefined)?.generated_visuals as JsonRecord[] | undefined) || []
    const latestGeneratedImage = generatedVisualCandidates.find((entry) => Boolean(entry?.asset_id))
    const currentPublicationBody = (handoffBundle?.publication?.body || '') as string
    const isPublicationBodyDirty = publicationBody !== currentPublicationBody
    const hasPublicationText = publicationBody.trim().length > 0
    const contentEditHistory = (((activeTask?.quality_report as JsonRecord | undefined)?.content_edit_history as ContentEditHistoryEntry[] | undefined) || [])
    const isOperationalTask = isOperationalWorkflowTask(activeTask)
    const primaryBodyTitle = isOperationalTask ? copy.taskMaterial : copy.publicationText
    const previewTitle = isOperationalTask ? copy.resultPreview : copy.publicationPreview
    const sourceContextTitle = isOperationalTask ? copy.executionContext : copy.publicationContext
    const sourceLinkLabel = isOperationalTask ? copy.resultLink : copy.postLink
    const sourceLinkPlaceholder = isOperationalTask ? 'https://... ссылка на документ, таблицу, пост или другой итоговый артефакт' : 'https://...'
    const prepareButtonLabel = isOperationalTask ? copy.buildTaskPackage : copy.prepareDraft
    const publishButtonDisabled = publishTaskNow.isPending || prepareHandoff.isPending || isLoadingTask || (!isOperationalTask && !hasPublicationText)
    const publicationActionTitle = !hasPublicationText
        ? 'Сначала подготовьте текст публикации: нажмите «Подготовить черновик» или напишите текст вручную.'
        : 'Опубликуйте текст в подключённый канал, затем вставьте ссылку на пост справа.'
    const requiresPermalink = publicationOutcome === 'published' && ['post', 'article', 'comment'].includes(artifactKind)
    const requiresStoryEvidence = publicationOutcome === 'published' && artifactKind === 'story'
    const publicationFactReady = (!requiresPermalink || publishedLink.trim().length > 0)
        && (!requiresStoryEvidence || (providerObjectId.trim().length > 0 && evidenceRef.trim().length > 0))

    return (
        <div className="flex-1 w-full p-4 sm:p-6 lg:p-10 space-y-8 overflow-y-auto">
            <section ref={workspaceRef} className="grid grid-cols-1 xl:grid-cols-[minmax(360px,400px)_minmax(0,1fr)] gap-6 items-start scroll-mt-4">
                    <div className={`${mobileTaskOpen ? 'hidden xl:block' : 'block'} -mx-4 sm:mx-0 bg-white rounded-none sm:rounded-[2rem] border-y sm:border border-outline-variant/10 shadow-sm overflow-hidden xl:sticky xl:top-6`}>
                        <div className="p-4 sm:p-5 border-b border-outline-variant/10 space-y-3">
                            <div className="flex items-center justify-between gap-4">
                                <div className="min-w-0">
                                    <h2 className="text-lg font-headline font-black text-on-surface">{copy.title}</h2>
                                    <p className="text-xs text-on-surface-variant mt-1 break-words">
                                        {currentProject ? `${copy.project}: ${currentProject.name}` : copy.chooseProject}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <div className="text-xs tabular-nums text-on-surface-variant whitespace-nowrap">
                                        {filteredTasks.length} {copy.tasks}
                                    </div>
                                <button
                                        onClick={() => setShowPlanModal(true)}
                                        className="w-11 h-11 rounded-2xl ai-gradient text-white flex items-center justify-center shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all"
                                        title={copy.importPlan}
                                    >
                                        <span className="material-symbols-outlined text-xl">hub</span>
                                    </button>
                                </div>
                            </div>

                            <div className="relative">
                                <span className="material-symbols-outlined pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-xl text-on-surface-variant/70" aria-hidden="true">search</span>
                                <input
                                    value={taskSearch}
                                    onChange={(event) => setTaskSearch(event.target.value)}
                                    placeholder={copy.searchPlaceholder}
                                    aria-label={copy.searchLabel}
                                    className="w-full bg-surface-container-low border-none rounded-xl py-2.5 pl-11 pr-4 text-sm font-medium text-on-surface placeholder:text-on-surface-variant/70 focus:ring-2 focus:ring-primary/20 outline-none"
                                />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <select
                                    value={weekPackageId ?? ''}
                                    onChange={(event) => setWeekPackageId(event.target.value === 'all' ? 'all' : Number(event.target.value))}
                                    aria-label={copy.weekLabel}
                                    className="w-full bg-surface-container-low border-none rounded-xl px-3 py-2.5 text-base sm:text-sm font-bold focus:ring-2 focus:ring-primary/20 outline-none sm:col-span-2"
                                >
                                    {(weekPackages || []).map((week) => (
                                        <option key={week.id} value={week.id}>
                                            {formatDate(week.week_start)} — {formatDate(week.week_end)} · {week._count?.content_items || 0}
                                        </option>
                                    ))}
                                    <option value="all">{copy.allWeeks}</option>
                                </select>
                                <select
                                    value={statusFilter}
                                    onChange={(event) => selectStatusFilter(event.target.value)}
                                    aria-label={copy.statusLabel}
                                    className="w-full bg-surface-container-low border-none rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-primary/20 outline-none"
                                >
                                    <option value="all">{copy.allStatuses}</option>
                                    <option value="active">{copy.active}</option>
                                    <option value="planned">{copy.planned}</option>
                                    <option value="awaiting_manual_publication">{copy.awaitingManual}</option>
                                    <option value="ready_for_execution">{copy.ready}</option>
                                    <option value="browser_required">{copy.browser}</option>
                                    <option value="deferred">{copy.deferred}</option>
                                    <option value="published">{copy.publishedPlural}</option>
                                    <option value="blocked">{copy.blockedPlural}</option>
                                    <option value="removed">{copy.removedPlural}</option>
                                    <option value="restricted">{copy.restricted}</option>
                                    <option value="cancelled">{copy.cancelledPlural}</option>
                                    <option value="failed">{copy.failed}</option>
                                </select>

                                    <button
                                        onClick={() => setManualOnly((value) => !value)}
                                        aria-pressed={manualOnly}
                                        className={`min-h-10 rounded-xl px-3 py-2.5 text-sm font-black transition-all ${manualOnly ? 'bg-primary text-white' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'}`}
                                    >
                                        {manualOnly ? copy.manualOnly : copy.allModes}
                                    </button>
                                </div>

                            <div className="flex items-center justify-between gap-3">
                                <span className="text-xs font-bold text-on-surface-variant">{copy.textReadiness}</span>
                                <button
                                    type="button"
                                    onClick={() => setShowTaskFilterDetails((value) => !value)}
                                    aria-expanded={showTaskFilterDetails}
                                    aria-controls="task-package-summary"
                                    className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-black text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                                >
                                    {copy.packageState}
                                    <span className="material-symbols-outlined text-base" aria-hidden="true">{showTaskFilterDetails ? 'expand_less' : 'expand_more'}</span>
                                </button>
                            </div>

                            <div className="grid grid-cols-3 gap-2" aria-label={copy.textReadiness}>
                                {([
                                    ['empty', copy.noText],
                                    ['ready', copy.textReady],
                                    ['published', copy.published]
                                ] as const).map(([value, label]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => toggleContentStateFilter(value)}
                                        aria-pressed={contentStateFilter === value}
                                        className={`min-h-9 rounded-xl px-2 text-[11px] font-black transition-colors ${contentStateFilter === value ? 'bg-primary text-white' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'}`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            {showTaskFilterDetails && (
                                <div id="task-package-summary" className="grid grid-cols-2 gap-2 pt-1" aria-label={copy.packageContents}>
                                    {([
                                        ['active', copy.active, statusCounts.active],
                                        ['published', copy.published, statusCounts.published],
                                        ['blocked', copy.blocked, statusCounts.blocked],
                                        ['removed', copy.removed, statusCounts.removed],
                                        ['cancelled', copy.cancelled, statusCounts.cancelled]
                                    ] as const).map(([value, label, count]) => (
                                        <button
                                            key={value}
                                            type="button"
                                            onClick={() => selectStatusFilter(value)}
                                            aria-pressed={statusFilter === value}
                                            className={`flex min-h-10 items-center justify-between gap-2 rounded-xl px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${value === 'cancelled' ? 'col-span-2' : ''} ${statusFilter === value ? 'bg-primary text-white' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'}`}
                                        >
                                            <span className="truncate text-xs font-bold" title={label}>{label}</span>
                                            <span className="shrink-0 text-sm font-black tabular-nums">{count}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="max-h-[720px] overflow-y-auto">
                            {typeof weekPackageId === 'number' && (nonPublicationRecordCount > 0 || dateMismatchIds.size > 0 || crossPackageTasks.length > 0) && (
                                <div className="border-b border-outline-variant/10 bg-surface-container-low px-4 py-4 text-xs leading-relaxed text-on-surface-variant" role="status">
                                    {nonPublicationRecordCount > 0 && (
                                        <p>В селекторе учтено <strong className="text-on-surface">{packageRecordCount}</strong> записей: публикационных задач — <strong className="text-on-surface">{tasks?.length || 0}</strong>, служебных — {nonPublicationRecordCount}.</p>
                                    )}
                                    {dateMismatchIds.size > 0 && (
                                        <p className={nonPublicationRecordCount > 0 ? 'mt-1' : ''}><strong className="text-on-surface">{dateMismatchIds.size}</strong> задач в пакете имеют дату за пределами выбранной недели.</p>
                                    )}
                                    {crossPackageTasks.length > 0 && (
                                        <p className={nonPublicationRecordCount > 0 || dateMismatchIds.size > 0 ? 'mt-1' : ''}><strong className="text-on-surface">{crossPackageTasks.length}</strong> задач датированы этой неделей, но привязаны к другому пакету. Они добавлены в список с отметкой.</p>
                                    )}
                                </div>
                            )}
                            {!currentProject && (
                                <div className="p-8 text-sm text-on-surface-variant">
                                    {copy.importFirst}
                                </div>
                            )}

                            {currentProject && isLoading && (
                                <div className="p-8 flex items-center justify-center">
                                    <div className="w-10 h-10 border-4 border-outline-variant border-t-primary rounded-full animate-spin"></div>
                                </div>
                            )}

                            {currentProject && error && (
                                <div className="p-8 text-sm text-error font-medium">
                                    {(error as Error).message}
                                </div>
                            )}

                            {currentProject && !isLoading && !filteredTasks.length && (
                                <div className="p-8 text-sm text-on-surface-variant leading-relaxed" role="status">
                                    <p>{copy.noResults}</p>
                                    <button
                                        type="button"
                                        onClick={resetTaskFilters}
                                        className="mt-4 min-h-11 rounded-xl bg-surface-container-high px-4 font-black text-on-surface transition-colors hover:bg-primary hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                                    >
                                        {copy.reset}
                                    </button>
                                </div>
                            )}

                            {taskQueueGroups.map((group) => (
                                <section key={group.key} aria-label={taskQueueGroupLabel(group)}>
                                    <div className={`sticky top-0 z-10 flex min-h-10 items-center justify-between gap-3 border-b border-outline-variant/10 px-4 sm:px-5 py-2 text-xs font-black ${group.kind === 'overdue' ? 'bg-error-container/50 text-error' : group.kind === 'completed' ? 'bg-surface-container-low text-on-surface-variant' : 'bg-white text-on-surface-variant'}`}>
                                        <span>{taskQueueGroupLabel(group)}</span>
                                        <span className="rounded-full bg-white/70 px-2 py-0.5 tabular-nums text-[10px] text-on-surface-variant">{group.tasks.length}</span>
                                    </div>
                                    {group.tasks.map((task) => {
                                const isSelected = task.id === activeTask?.id
                                const mode = task.publication_mode === 'browser_required'
                                    ? 'browser_required'
                                    : task.quality_report?.execution_mode || 'manual'
                                const contentState = taskContentState(task)
                                const isCancelled = task.status === 'cancelled'
                                const listStateLabel = isCancelled ? copy.cancelled : contentState === 'empty' ? copy.noText : contentState === 'ready' ? copy.textReady : copy.published
                                const listStateIcon = isCancelled ? 'event_busy' : contentStateIcon(contentState)
                                const listStateTone = isCancelled
                                    ? 'bg-surface-container-high text-on-surface-variant'
                                    : contentStateTone(contentState)
                                const isOverdue = isOverduePublicationTask(task)
                                const hasPackageDateMismatch = dateMismatchIds.has(task.id)
                                const comesFromAnotherPackage = crossPackageIds.has(task.id)

                                return (
                                    <button
                                        key={task.id}
                                        type="button"
                                        onClick={() => openTask(task.id)}
                                        aria-label={`Открыть задачу #${task.id}: ${task.title || task.type}`}
                                        className={`group w-full min-h-24 touch-manipulation text-left px-4 sm:px-5 py-4 border-b transition-colors focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 active:bg-primary/10 ${
                                            isOverdue
                                                ? isSelected
                                                    ? 'bg-error-container/35 border-error/20'
                                                    : 'bg-error-container/20 border-error/10 hover:bg-error-container/30'
                                                : isSelected
                                                    ? 'bg-primary/5 border-outline-variant/10'
                                                    : 'border-outline-variant/10 hover:bg-surface-container-lowest'
                                        }`}
                                    >
                                        <div className="min-w-0">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex min-w-0 items-center gap-2">
                                                    <span className="inline-flex shrink-0 select-all items-center rounded-lg bg-primary/10 px-2 py-1 text-xs font-black tabular-nums text-primary" title={`Номер задачи ${task.id}`}>
                                                        #{task.id}
                                                    </span>
                                                    <span className="truncate text-[10px] font-black uppercase tracking-[0.18em] text-primary/60" title={taskChannel(task)}>
                                                        {taskChannel(task)}
                                                    </span>
                                                </div>
                                                <span className={`max-w-[58%] inline-flex items-center gap-1 truncate px-2.5 py-1 rounded-full text-[10px] font-black ${listStateTone}`} title={listStateLabel}>
                                                    <span className="material-symbols-outlined text-[14px]" aria-hidden="true">{listStateIcon}</span>
                                                    {listStateLabel}
                                                </span>
                                            </div>
                                            <div className="font-bold text-sm text-on-surface mt-2 line-clamp-2 leading-snug transition-colors group-hover:text-primary">
                                                {task.title || task.type}
                                            </div>
                                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant mt-2">
                                                <span>{formatDate(task.schedule_at)}</span>
                                                <span>{executionModeLabel(mode)}</span>
                                                {task.generation_stage && (
                                                    <span className="font-bold text-primary">{generationStageLabel(task.generation_stage)}</span>
                                                )}
                                                {isOverdue && (
                                                    <span className="font-black text-error">
                                                        Просрочено
                                                    </span>
                                                )}
                                                {hasPackageDateMismatch && (
                                                    <span className="font-black text-error" title="Дата задачи находится за пределами выбранного недельного пакета">
                                                        Дата вне недели
                                                    </span>
                                                )}
                                                {comesFromAnotherPackage && (
                                                    <span className="font-black text-primary" title={`Задача привязана к пакету №${task.week_package_id || '—'}`}>
                                                        Из пакета №{task.week_package_id || '—'}
                                                    </span>
                                                )}
                                            </div>
                                            {taskPlanReference(task) && (
                                                <div className="mt-2 truncate text-xs font-medium text-on-surface-variant/80" title={taskPlanReference(task)}>
                                                    План: {taskPlanReference(task)}
                                                </div>
                                            )}
                                        </div>
                                    </button>
                                )
                                    })}
                                </section>
                            ))}
                        </div>
                    </div>

                    <div className={`${mobileTaskOpen ? 'block' : 'hidden xl:block'} -mx-4 sm:mx-0 bg-white rounded-none sm:rounded-[2rem] border-y sm:border border-outline-variant/10 shadow-sm overflow-hidden`}>
                        {mobileTaskOpen && (
                            <div className="xl:hidden p-3 border-b border-outline-variant/10 bg-white sticky top-0 z-20">
                                <button
                                    type="button"
                                    onClick={closeMobileTask}
                                    className="min-h-11 inline-flex items-center gap-2 rounded-xl px-3 text-sm font-black text-primary active:bg-primary/10 touch-manipulation"
                                >
                                    <span className="material-symbols-outlined text-xl" aria-hidden="true">arrow_back</span>
                                    Ко всем задачам
                                </button>
                            </div>
                        )}
                        {!activeTask && (
                                <div className="min-h-[560px] flex items-center justify-center p-6 sm:p-10 text-center">
                                <div className="max-w-md space-y-4">
                                    <div className="w-16 h-16 mx-auto rounded-3xl bg-surface-container-high flex items-center justify-center text-primary">
                                        <span className="material-symbols-outlined text-3xl">task_alt</span>
                                    </div>
                                    <h3 className="text-2xl font-headline font-black">Select a task</h3>
                                    <p className="text-sm text-on-surface-variant leading-relaxed">
                                        Pick a publication task to inspect the ready-to-publish bundle, confirm the live URL, and collect follow-up analytics.
                                    </p>
                                </div>
                            </div>
                        )}

                        {activeTask && (
                            <div>
                                <div className="p-4 sm:p-6 border-b border-outline-variant/10">
                                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] gap-5 items-start">
                                        <div className="space-y-4 min-w-0">
                                            <div className="flex flex-wrap items-center gap-3">
                                                <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">
                                                    {taskChannel(activeTask)}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => navigator.clipboard?.writeText(taskPlanReference(activeTask) || String(activeTask.id))}
                                                    className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-surface-container-high px-2.5 text-[11px] font-black text-on-surface-variant hover:text-primary"
                                                    title="Скопировать идентификатор задачи"
                                                >
                                                    <span className="material-symbols-outlined text-sm" aria-hidden="true">content_copy</span>
                                                    {taskIdentifierLabel(activeTask)}
                                                </button>
                                            </div>
                                            <h2 className="text-xl sm:text-2xl font-headline font-black tracking-tight text-on-surface break-words">
                                                {activeTask.title || activeTask.type}
                                            </h2>
                                            <div className="flex flex-wrap gap-2">
                                                {activeTask.generation_stage && (
                                                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-black bg-primary/10 text-primary">
                                                        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">account_tree</span>
                                                        {generationStageLabel(activeTask.generation_stage)}
                                                    </span>
                                                )}
                                                <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-black ${contentStateTone(taskContentState(activeTask))}`}>
                                                    <span className="material-symbols-outlined text-[14px]" aria-hidden="true">{contentStateIcon(taskContentState(activeTask))}</span>
                                                    {contentStateLabel(taskContentState(activeTask))}
                                                </span>
                                                {isTaskOverdue && (
                                                    <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-error text-white">
                                                        overdue
                                                    </span>
                                                )}
                                                <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-surface-container-high text-on-surface-variant">
                                                    {executionMode}
                                                </span>
                                                <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-surface-container-high text-on-surface-variant">
                                                    {formatDate(activeTask.schedule_at)}
                                                </span>
                                                {activeTask.published_link && activeOutcome !== 'published' && (
                                                    <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-yellow-200 text-yellow-950">
                                                        {activeOutcome}
                                                    </span>
                                                )}
                                            </div>
                                            {activeTask.brief && (
                                                <p className="text-sm text-on-surface-variant max-w-3xl leading-relaxed">
                                                    {activeTask.brief}
                                                </p>
                                            )}
                                            {activeTask.published_link && (
                                                <a href={activeTask.published_link} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary/5 px-3 text-sm font-bold text-primary hover:underline">
                                                    <span className="material-symbols-outlined text-base" aria-hidden="true">open_in_new</span>
                                                    Открыть опубликованный пост
                                                </a>
                                            )}
                                            {visualReadiness?.enabled && (
                                                <div className={`rounded-2xl px-4 py-3 text-sm ${visualGateOpen ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-950'}`}>
                                                    <div className="font-black">Визуальный допуск: {visualReadiness.visual_state}</div>
                                                    <div className="mt-1 text-xs opacity-80">
                                                        {visualGateOpen
                                                            ? (visualReadiness.visual_state === 'NO_VISUAL_NEEDED' ? 'Арт-директор подтвердил, что визуал не нужен.' : 'Одобренный визуал соответствует текущей версии текста.')
                                                            : visualReadiness.reason === 'visual_stale'
                                                                ? 'Текст изменился: визуал нужно проверить заново.'
                                                                : visualReadiness.visual_state === 'SOURCE_REQUIRED'
                                                                    ? 'Нужен реальный источник или доказательный материал.'
                                                                    : visualReadiness.visual_state === 'MANUAL_ASSET_REQUIRED'
                                                                        ? 'Нужно вручную приложить исходный визуал.'
                                                                        : 'Публикация ждёт решения арт-директора или ревью визуала.'}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex flex-col sm:flex-row xl:flex-col xl:items-stretch sm:flex-wrap items-stretch sm:items-center gap-3 w-full xl:w-[16rem] sm:w-auto">
                                            {activeTask.week_package_id && activeTask.channel?.id && (
                                                <button
                                                    type="button"
                                                    onClick={() => navigate(`/channels/${activeTask.channel!.id}?weekPackageId=${activeTask.week_package_id}`)}
                                                    className="w-full border border-primary/20 bg-primary/5 text-primary font-black text-sm px-5 py-3 rounded-2xl hover:bg-primary/10 transition-all"
                                                >
                                                    {copy.openWeekPlan}
                                                </button>
                                            )}
                                            {canPrepareHandoff && (
                                                <button
                                                    onClick={() => prepareHandoff.mutate(activeTask.id)}
                                                    disabled={prepareHandoff.isPending || isLoadingTask || publishTaskNow.isPending}
                                                    className="w-full bg-primary text-white font-black text-sm px-5 py-3 rounded-2xl shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50"
                                                >
                                                    {prepareHandoff.isPending ? copy.preparing : prepareButtonLabel}
                                                </button>
                                            )}
                                            {canPublishNow && (
                                                <button
                                                    onClick={() => publishTaskNow.mutate()}
                                                    disabled={publishButtonDisabled}
                                                    className="w-full ai-gradient text-white font-black text-sm px-5 py-3 rounded-2xl shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 inline-flex items-center justify-center gap-2"
                                                    title={executionMode === 'manual'
                                                        ? publicationActionTitle
                                                        : 'Запустить публикацию через подключённый адаптер'}
                                                >
                                                    <span className="material-symbols-outlined text-base">send</span>
                                                    {publishTaskNow.isPending ? copy.publishing : (executionMode === 'manual' ? copy.publishChannel : copy.publishNow)}
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="mt-6 grid grid-cols-3 gap-2" aria-label={copy.publicationStages}>
                                        {([
                                            ['empty', copy.slotCreated, 'calendar_add_on'],
                                            ['ready', copy.textReady, 'draft'],
                                            ['published', copy.published, 'check_circle']
                                        ] as const).map(([state, label, icon], index) => {
                                            const currentRank = { empty: 0, ready: 1, published: 2 }[taskContentState(activeTask)]
                                            const reached = index <= currentRank
                                            const current = index === currentRank
                                            return (
                                                <div key={state} className={`min-h-16 rounded-xl px-3 py-3 flex items-center gap-2 ${current ? 'bg-primary text-white' : reached ? 'bg-primary/10 text-primary' : 'bg-surface-container-low text-on-surface-variant'}`}>
                                                    <span className="material-symbols-outlined text-lg" aria-hidden="true">{reached && !current ? 'check' : icon}</span>
                                                    <span className="text-xs font-black leading-tight">{label}</span>
                                                </div>
                                            )
                                        })}
                                    </div>

                                    {taskMessage && (
                                        <div className="mt-4 rounded-2xl bg-success/10 text-success px-4 py-3 text-sm font-medium">
                                            {taskMessage}
                                        </div>
                                    )}

                                    {(prepareHandoff.error || publishTaskNow.error || saveTaskContent.error || confirmPublication.error || collectMetrics.error || recordMetrics.error || sendCommentAlert.error) && (
                                        <div className="mt-4 rounded-2xl bg-error-container/30 text-error px-4 py-3 text-sm font-medium">
                                            {prepareHandoff.error ? formatUiError(prepareHandoff.error, 'Не удалось подготовить handoff.') :
                                                publishTaskNow.error ? formatUiError(publishTaskNow.error, 'Не удалось отправить публикацию в канал.') :
                                                    saveTaskContent.error ? formatUiError(saveTaskContent.error, 'Не удалось сохранить текст публикации.') :
                                                        confirmPublication.error ? formatUiError(confirmPublication.error, 'Не удалось подтвердить публикацию.') :
                                                            collectMetrics.error ? formatUiError(collectMetrics.error, 'Не удалось получить метрики.') :
                                                                recordMetrics.error ? formatUiError(recordMetrics.error, 'Не удалось сохранить метрики.') :
                                                                    sendCommentAlert.error ? formatUiError(sendCommentAlert.error, 'Не удалось сохранить комментарий.') :
                                                                        'Произошла ошибка.'}
                                        </div>
                                    )}
                                </div>

                                <div className="p-5 sm:p-7 space-y-7">
                                    {isOperationalTask ? (
                                        <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_420px] gap-6 items-start">
                                            <div className="space-y-6">
                                                <div className="rounded-[1.5rem] bg-surface-container-low p-5 border border-outline-variant/10">
                                                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Операционная задача</div>
                                                    <h3 className="mt-3 text-2xl font-headline font-black text-on-surface">Не публикация, а рабочий контур выполнения</h3>
                                                    <p className="mt-3 text-sm leading-7 text-on-surface-variant max-w-3xl">
                                                        Для таких задач важнее чеклист, рабочий материал, ссылка на итоговый артефакт и заметки по результату. Поэтому экран собран как операционная рабочая зона, а не как форма публикации поста.
                                                    </p>
                                                    <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
                                                        <div className="rounded-2xl bg-white px-4 py-4">
                                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Плановый пункт</div>
                                                            <div className="mt-2 text-sm font-bold text-on-surface break-words">{planItemRef || 'Не привязано'}</div>
                                                        </div>
                                                        <div className="rounded-2xl bg-white px-4 py-4">
                                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Исходный ресурс</div>
                                                            <div className="mt-2 text-sm font-bold text-on-surface break-words">{activeTask?.workspace_context?.source_file_name || sourceFiles[0]?.file_name || sourceFiles[0]?.relative_path || 'Не найден'}</div>
                                                        </div>
                                                        <div className="rounded-2xl bg-white px-4 py-4">
                                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Формат результата</div>
                                                            <div className="mt-2 text-sm font-bold text-on-surface">{activeTask.published_link ? 'Результат зафиксирован' : 'Нужен итоговый артефакт'}</div>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">{primaryBodyTitle}</div>
                                                        <span className="text-xs text-on-surface-variant">{publicationBody.length} chars</span>
                                                    </div>
                                                    <textarea
                                                        value={publicationBody}
                                                        onChange={(event) => setPublicationBody(event.target.value)}
                                                        rows={18}
                                                        className="w-full bg-white border-none rounded-2xl p-4 text-sm leading-6 focus:ring-2 focus:ring-primary/20 outline-none resize-y min-h-[24rem]"
                                                    />
                                                    <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center justify-between gap-3">
                                                        <div className="text-xs text-on-surface-variant">
                                                            Здесь можно вести чеклист, заметки, гипотезы и промежуточные выводы. Этот текст сохраняется в задачу и остаётся частью handoff и проверки.
                                                        </div>
                                                        <div className="flex w-full sm:w-auto items-center gap-3">
                                                            <button
                                                                onClick={() => setPublicationBody(currentPublicationBody)}
                                                                disabled={!isPublicationBodyDirty || saveTaskContent.isPending}
                                                                className="flex-1 sm:flex-none rounded-2xl bg-surface-container-highest text-on-surface font-black text-xs px-4 py-3 hover:bg-primary/10 hover:text-primary transition-all disabled:opacity-50"
                                                            >
                                                                Сбросить
                                                            </button>
                                                            <button
                                                                onClick={() => saveTaskContent.mutate()}
                                                                disabled={!isPublicationBodyDirty || saveTaskContent.isPending}
                                                                className="flex-1 sm:flex-none rounded-2xl bg-primary text-white font-black text-xs px-4 py-3 shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50"
                                                            >
                                                                {saveTaskContent.isPending ? 'Сохраняем...' : 'Сохранить материал'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">{previewTitle}</div>
                                                        <span className="text-xs text-on-surface-variant">Markdown / HTML</span>
                                                    </div>
                                                    <ContentMarkupRenderer
                                                        content={publicationBody}
                                                        title={`publication-task-preview-${activeTask.id}`}
                                                        emptyMessage="Рабочий материал пока пуст."
                                                        className="min-h-[18rem]"
                                                        platform={activeTask.channel?.type || activeTask.type}
                                                        postTitle={activeTask.title || undefined}
                                                        postTags={Array.isArray(activeTask.key_points) ? (activeTask.key_points as unknown as string[]) : undefined}
                                                        authorName={activeTask.channel?.name || undefined}
                                                    />
                                                </div>

                                                <section className="grid grid-cols-1 xl:grid-cols-[minmax(320px,0.78fr)_minmax(0,1.22fr)] gap-6 items-start">
                                                    <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Чеклист выполнения</div>
                                                        <div className="space-y-3">
                                                            {(handoffBundle?.manual_checklist || ['Собери пакет задачи, чтобы увидеть чеклист по этому workflow.']).map((item: string, index: number) => (
                                                                <div key={`${item}-${index}`} className="flex items-start gap-3 text-sm text-on-surface-variant">
                                                                    <span className="w-6 h-6 rounded-full bg-white text-primary flex items-center justify-center font-black text-xs shrink-0">{index + 1}</span>
                                                                    <span className="leading-6">{item}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Исходные файлы и контекст</div>
                                                        <ResourcePreviewCard
                                                            entry={primarySourceEntry}
                                                            title={activeTask?.workspace_context?.source_file_name || 'source-content'}
                                                            emptyMessage={handoffBundle
                                                                ? 'Не нашли читаемый текст или предпросматриваемый ресурс в связанных файлах.'
                                                                : 'Собери пакет задачи, чтобы подтянуть связанный текст, файл или превью артефакта.'}
                                                        />
                                                    </div>
                                                </section>
                                            </div>

                                            <aside className="space-y-5 xl:sticky xl:top-6">
                                                <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4 border border-outline-variant/10">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div>
                                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">{sourceContextTitle}</div>
                                                            <div className="mt-1 text-xs text-on-surface-variant leading-5">
                                                                Здесь зафиксированы рабочая ссылка, целевой ресурс и то, куда должен лечь финальный результат этой задачи.
                                                            </div>
                                                        </div>
                                                        <div className="rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-on-surface-variant shadow-sm">
                                                            {activeTask.channel?.type || activeTask.layer || 'channel'}
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-wrap gap-2">
                                                        <span className="rounded-full bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-on-surface-variant shadow-sm">
                                                            Канал: {activeTask.channel?.name || activeTask.channel?.type || activeTask.layer || 'не указан'}
                                                        </span>
                                                        {activeTask.visual_placement && (
                                                            <span className="rounded-full bg-primary/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-primary">
                                                                Размещение: {activeTask.visual_placement === 'article_cover' ? 'обложка статьи' : activeTask.visual_placement}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="space-y-4">
                                                        <div>
                                                            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Ресурс для выполнения</div>
                                                            {targetResourceUrl ? (
                                                                <a
                                                                    href={targetResourceUrl}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    className="mt-2 inline-flex items-center gap-2 text-sm font-bold text-primary break-all hover:underline"
                                                                >
                                                                    <span className="material-symbols-outlined text-base">open_in_new</span>
                                                                    {targetResourceUrl}
                                                                </a>
                                                            ) : (
                                                                <div className="mt-2 text-sm text-on-surface-variant">Не указан в плане.</div>
                                                            )}
                                                        </div>

                                                        <div>
                                                            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Ссылка на пункт плана</div>
                                                            <div className="mt-2 rounded-2xl bg-white px-4 py-3 text-sm font-bold text-on-surface shadow-sm">
                                                                {planItemRef || 'Не привязано'}
                                                            </div>
                                                        </div>

                                                        <div>
                                                            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Исходный ресурс</div>
                                                            <div className="mt-2 rounded-2xl bg-white px-4 py-3 text-sm text-on-surface shadow-sm">
                                                                {activeTask?.workspace_context?.source_file_name || sourceFiles[0]?.file_name || sourceFiles[0]?.relative_path || 'Не найден'}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="rounded-[1.5rem] bg-white p-5 space-y-4 border border-primary/10 shadow-sm">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div>
                                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Фиксация результата</div>
                                                            <div className="mt-1 text-xs text-on-surface-variant leading-5">
                                                                Сохрани ссылку на итоговый артефакт и коротко опиши, чем закончилась задача.
                                                            </div>
                                                        </div>
                                                        <span className="material-symbols-outlined text-primary">task_alt</span>
                                                    </div>
                                                    <div className="rounded-2xl bg-surface-container-low px-4 py-3 text-xs leading-6 text-on-surface-variant">
                                                        Это может быть пост, страница, таблица, документ, отчёт или любой другой результат. Главное — оставить рабочий permalink, чтобы потом было легко вернуться к итогу.
                                                    </div>
                                                    <div>
                                                        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-on-surface-variant">{sourceLinkLabel}</div>
                                                        <input
                                                            type="url"
                                                            value={publishedLink}
                                                            onChange={(event) => setPublishedLink(event.target.value)}
                                                            placeholder={sourceLinkPlaceholder}
                                                            className="mt-2 w-full bg-surface-container-low border-none rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                                        />
                                                    </div>
                                                    <select
                                                        value={publicationOutcome}
                                                        onChange={(event) => setPublicationOutcome(event.target.value as PublicationOutcome)}
                                                        className="w-full bg-surface-container-low border-none rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                                    >
                                                        <option value="published">Выполнено нормально</option>
                                                        <option value="blocked">Заблокировано / упёрлось в ограничение</option>
                                                        <option value="removed">Отменено / убрано после выполнения</option>
                                                        <option value="restricted">Ограниченный результат</option>
                                                    </select>
                                                    <textarea
                                                        value={publicationNote}
                                                        onChange={(event) => setPublicationNote(event.target.value)}
                                                        rows={4}
                                                        className="w-full bg-surface-container-low border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                                        placeholder="Короткая заметка: что проверили, что изменили, что решили оставить на следующую неделю"
                                                    />
                                                    <button
                                                        onClick={() => confirmPublication.mutate()}
                                                        disabled={!publishedLink.trim() || confirmPublication.isPending}
                                                        className="w-full bg-primary text-white font-black text-sm px-5 py-3 rounded-2xl shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50"
                                                    >
                                                        {confirmPublication.isPending ? 'Сохраняем...' : 'Зафиксировать результат задачи'}
                                                    </button>
                                                </div>
                                            </aside>
                                        </section>
                                    ) : (
                                        <section className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
                                            <div className="space-y-6">
                                                <div className="flex items-start gap-3 rounded-2xl bg-primary/5 px-4 py-3 text-sm text-on-surface-variant">
                                                    <span className="material-symbols-outlined text-xl text-primary" aria-hidden="true">
                                                        {hasPublicationText ? 'rate_review' : 'edit_note'}
                                                    </span>
                                                    <p className="leading-6">
                                                        {hasPublicationText
                                                            ? 'Проверьте текст. Затем опубликуйте его и сохраните ссылку в правой колонке.'
                                                            : 'Подготовьте черновик или напишите текст вручную — после этого станет доступна публикация.'}
                                                    </p>
                                                </div>

                                                <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4 border border-outline-variant/10">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <h3 className="text-lg font-headline font-black text-on-surface">{primaryBodyTitle}</h3>
                                                        <span className="text-xs tabular-nums text-on-surface-variant">{publicationBody.length} знаков</span>
                                                    </div>
                                                    <textarea
                                                        value={publicationBody}
                                                        onChange={(event) => setPublicationBody(event.target.value)}
                                                        rows={16}
                                                        placeholder="Соберите черновик из контекста задачи или напишите пост вручную."
                                                        className="w-full bg-white border-none rounded-2xl p-4 text-sm leading-6 focus:ring-2 focus:ring-primary/20 outline-none resize-y min-h-[22rem]"
                                                    />
                                                    <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center justify-between gap-3">
                                                        <div className="text-xs text-on-surface-variant">
                                                            Правки сохраняются в задачу и используются для проверки и публикации.
                                                        </div>
                                                        <div className="flex w-full sm:w-auto items-center gap-3">
                                                            <button
                                                                onClick={() => setPublicationBody(currentPublicationBody)}
                                                                disabled={!isPublicationBodyDirty || saveTaskContent.isPending}
                                                                className="flex-1 sm:flex-none rounded-2xl bg-surface-container-highest text-on-surface font-black text-xs px-4 py-3 hover:bg-primary/10 hover:text-primary transition-all disabled:opacity-50"
                                                            >
                                                                Сбросить
                                                            </button>
                                                            <button
                                                                onClick={() => saveTaskContent.mutate()}
                                                                disabled={!isPublicationBodyDirty || saveTaskContent.isPending}
                                                                className="flex-1 sm:flex-none rounded-2xl bg-primary text-white font-black text-xs px-4 py-3 shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50"
                                                            >
                                                                {saveTaskContent.isPending ? 'Сохраняем текст...' : 'Сохранить текст'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>

                                                <details className="group rounded-[1.5rem] bg-surface-container-low border border-outline-variant/10">
                                                    <summary className="list-none cursor-pointer flex min-h-14 items-center justify-between gap-3 px-5 py-4">
                                                        <div>
                                                            <span className="font-black text-on-surface">{previewTitle}</span>
                                                            <span className="ml-2 text-xs text-on-surface-variant">{copy.readerView}</span>
                                                        </div>
                                                        <span className="material-symbols-outlined text-on-surface-variant transition-transform group-open:rotate-180">expand_more</span>
                                                    </summary>
                                                    <div className="border-t border-outline-variant/10 p-5">
                                                        <ContentMarkupRenderer
                                                            content={publicationBody}
                                                            title={`publication-task-preview-${activeTask.id}`}
                                                            emptyMessage={copy.emptyPublication}
                                                            platform={activeTask.channel?.type || activeTask.type}
                                                            postTitle={activeTask.title || undefined}
                                                            postTags={Array.isArray(activeTask.key_points) ? (activeTask.key_points as unknown as string[]) : undefined}
                                                            imageUrl={latestGeneratedImage?.url ? String(latestGeneratedImage.url) : undefined}
                                                            authorName={activeTask.channel?.name || undefined}
                                                        />
                                                    </div>
                                                </details>
                                            </div>

                                            <aside className="space-y-4 2xl:sticky 2xl:top-6">
                                                <div className="rounded-[1.5rem] bg-white p-5 space-y-4 border border-primary/15 shadow-sm">
                                                    <div>
                                                        <h3 className="text-lg font-headline font-black text-on-surface">{copy.publication}</h3>
                                                        <p className="mt-1 text-xs text-on-surface-variant leading-5">
                                                            {activeTask.published_link ? copy.resultRecorded : copy.publishAndSave}
                                                        </p>
                                                    </div>
                                                    <dl className="grid grid-cols-2 gap-3 text-sm">
                                                        <div><dt className="text-xs text-on-surface-variant">{copy.channel}</dt><dd className="mt-1 font-bold break-words">{activeTask.channel?.name || taskChannel(activeTask)}</dd></div>
                                                        <div><dt className="text-xs text-on-surface-variant">{copy.mode}</dt><dd className="mt-1 font-bold">{executionMode}</dd></div>
                                                    </dl>
                                                    <label className="block">
                                                        <span className="text-sm font-bold text-on-surface">{copy.placementType}</span>
                                                        <select
                                                            value={artifactKind}
                                                            onChange={(event) => setArtifactKind(event.target.value as ArtifactKind)}
                                                            className="mt-2 w-full bg-surface-container-low border-none rounded-2xl px-4 py-3 text-base sm:text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                                        >
                                                            <option value="post">{copy.post}</option>
                                                            <option value="article">{copy.article}</option>
                                                            <option value="story">{copy.story}</option>
                                                            <option value="email">{copy.email}</option>
                                                            <option value="comment">{copy.comment}</option>
                                                            <option value="other">{copy.otherArtifact}</option>
                                                        </select>
                                                    </label>
                                                    <label className="block">
                                                        <span className="text-sm font-bold text-on-surface">
                                                            {artifactKind === 'story' || artifactKind === 'email' ? copy.publicLinkOptional : sourceLinkLabel}
                                                        </span>
                                                        <input
                                                            type="url"
                                                            value={publishedLink}
                                                            onChange={(event) => setPublishedLink(event.target.value)}
                                                            placeholder={sourceLinkPlaceholder}
                                                            required={requiresPermalink}
                                                            aria-describedby="publication-link-hint"
                                                            className="mt-2 w-full bg-surface-container-low border-none rounded-2xl px-4 py-3 text-base sm:text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                                        />
                                                        <span id="publication-link-hint" className="mt-2 block text-xs leading-5 text-on-surface-variant">
                                                            {requiresPermalink ? copy.permalinkRequired : copy.linkOptional}
                                                        </span>
                                                    </label>
                                                    {(artifactKind === 'story' || artifactKind === 'email') && (
                                                        <label className="block">
                                                            <span className="text-sm font-bold text-on-surface">{copy.providerId}</span>
                                                            <input
                                                                value={providerObjectId}
                                                                onChange={(event) => setProviderObjectId(event.target.value)}
                                                                placeholder={artifactKind === 'story' ? 'story:channel:timestamp' : 'campaign-id'}
                                                                className="mt-2 w-full bg-surface-container-low border-none rounded-2xl px-4 py-3 text-base sm:text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                                            />
                                                        </label>
                                                    )}
                                                    {artifactKind === 'story' && (
                                                        <label className="block">
                                                            <span className="text-sm font-bold text-on-surface">{copy.placementEvidence}</span>
                                                            <input
                                                                value={evidenceRef}
                                                                onChange={(event) => setEvidenceRef(event.target.value)}
                                                                placeholder="asset://... или ссылка на скриншот"
                                                                className="mt-2 w-full bg-surface-container-low border-none rounded-2xl px-4 py-3 text-base sm:text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                                            />
                                                        </label>
                                                    )}
                                                    <label className="block">
                                                        <span className="text-sm font-bold text-on-surface">{copy.targetLink}</span>
                                                        <input
                                                            type="url"
                                                            value={targetUrl}
                                                            onChange={(event) => setTargetUrl(event.target.value)}
                                                            placeholder="https://...utm_source=..."
                                                            className="mt-2 w-full bg-surface-container-low border-none rounded-2xl px-4 py-3 text-base sm:text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                                        />
                                                    </label>
                                                    <select
                                                        aria-label={copy.publicationResult}
                                                        value={publicationOutcome}
                                                        onChange={(event) => setPublicationOutcome(event.target.value as PublicationOutcome)}
                                                        className="w-full bg-surface-container-low border-none rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                                    >
                                                        <option value="published">{copy.publishedNormally}</option>
                                                        <option value="blocked">{copy.blockedWithUrl}</option>
                                                        <option value="removed">{copy.removedWithUrl}</option>
                                                        <option value="restricted">{copy.restrictedVisibility}</option>
                                                    </select>
                                                    <textarea
                                                        aria-label={copy.publicationNote}
                                                        value={publicationNote}
                                                        onChange={(event) => setPublicationNote(event.target.value)}
                                                        rows={3}
                                                        className="w-full bg-surface-container-low border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                                        placeholder={copy.optionalNote}
                                                    />
                                                    <button
                                                        onClick={() => confirmPublication.mutate()}
                                                        disabled={!publicationFactReady || confirmPublication.isPending}
                                                        className="w-full bg-primary text-white font-black text-sm px-5 py-3 rounded-2xl shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50"
                                                    >
                                                        {confirmPublication.isPending ? copy.saving : publicationFact ? copy.saveCorrection : copy.recordFact}
                                                    </button>
                                                    {publicationFact && (
                                                        <div className="pt-4 border-t border-outline-variant/15 text-xs leading-5 text-on-surface-variant">
                                                            <div className="font-bold text-on-surface">{copy.factConfirmed}</div>
                                                            <div>{formatDate(publicationFact.published_at)} · {publicationFact.confirmation_mode}</div>
                                                            <div>UTM: {publicationFact.utm_status || 'unknown'}</div>
                                                            {publicationFact.confirmed_by && <div className="break-words">{copy.actor}: {publicationFact.confirmed_by}</div>}
                                                        </div>
                                                    )}
                                                </div>

                                                {publicationFact && (
                                                    <section className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4 border border-outline-variant/10" aria-label={copy.metricSnapshots}>
                                                        <div>
                                                            <h3 className="text-lg font-headline font-black text-on-surface">{copy.metricSnapshots}</h3>
                                                            <p className="mt-1 text-xs leading-5 text-on-surface-variant">{copy.metricSnapshotsHelp}</p>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-2">
                                                            {(['t24h', 't7d'] as const).map((checkpointName) => {
                                                                const checkpoint = metricCheckpoints.find((entry) => entry.checkpoint === checkpointName)
                                                                const selected = selectedCheckpoint === checkpointName
                                                                return (
                                                                    <button
                                                                        key={checkpointName}
                                                                        type="button"
                                                                        onClick={() => setSelectedCheckpoint(checkpointName)}
                                                                        className={`min-w-0 rounded-2xl px-3 py-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selected ? 'bg-primary text-white' : 'bg-white text-on-surface hover:bg-primary/5'}`}
                                                                    >
                                                                        <span className="block text-sm font-black">{checkpointLabel(checkpointName)}</span>
                                                                        <span className={`mt-1 block text-xs break-words ${selected ? 'text-white/80' : 'text-on-surface-variant'}`}>{checkpointStatusLabel(checkpoint?.collection_status)}</span>
                                                                        {checkpoint?.late && <span className="mt-1 block text-xs font-black">{copy.collectedLate}</span>}
                                                                    </button>
                                                                )
                                                            })}
                                                        </div>
                                                        <div className="text-xs leading-5 text-on-surface-variant">
                                                            {copy.due}: {formatDate(metricCheckpoints.find((entry) => entry.checkpoint === selectedCheckpoint)?.scheduled_for)}
                                                        </div>
                                                        <label className="block">
                                                            <span className="text-sm font-bold text-on-surface">{copy.metricsJson}</span>
                                                            <textarea
                                                                value={metricsJson}
                                                                onChange={(event) => setMetricsJson(event.target.value)}
                                                                rows={10}
                                                                spellCheck={false}
                                                                className="mt-2 w-full bg-white border-none rounded-2xl p-4 font-mono text-sm leading-6 focus:ring-2 focus:ring-primary/20 outline-none resize-y"
                                                            />
                                                        </label>
                                                        <button
                                                            type="button"
                                                            onClick={() => recordMetrics.mutate()}
                                                            disabled={recordMetrics.isPending}
                                                            className="w-full rounded-2xl bg-on-surface px-5 py-3 text-sm font-black text-white transition-colors hover:bg-primary disabled:opacity-50"
                                                        >
                                                            {recordMetrics.isPending ? copy.savingSnapshot : `${copy.saveSnapshot} ${checkpointLabel(selectedCheckpoint)}`}
                                                        </button>
                                                    </section>
                                                )}

                                                <details className="group rounded-[1.5rem] bg-surface-container-low border border-outline-variant/10">
                                                    <summary className="list-none cursor-pointer flex min-h-14 items-center justify-between gap-3 px-5 py-4">
                                                        <span className="font-black text-on-surface">{copy.postImage}</span>
                                                        <span className="material-symbols-outlined text-on-surface-variant transition-transform group-open:rotate-180">expand_more</span>
                                                    </summary>
                                                    <div className="border-t border-outline-variant/10 p-5 space-y-4">
                                                    {!canGenerateVisual && (
                                                        <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
                                                            {copy.visualGateHelp}
                                                        </div>
                                                    )}
                                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                                        <button
                                                            onClick={() => generateTaskImage.mutate('preview')}
                                                            disabled={generateTaskImage.isPending || !canGenerateVisual}
                                                            className="w-full bg-primary text-white font-black text-sm px-5 py-3 rounded-2xl shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50"
                                                        >
                                                            {generateTaskImage.isPending ? copy.generating : copy.draftEconomy}
                                                        </button>
                                                        <button
                                                            onClick={() => generateTaskImage.mutate('final')}
                                                            disabled={generateTaskImage.isPending || !canGenerateVisual}
                                                            className="w-full bg-surface-container-highest text-on-surface font-black text-sm px-5 py-3 rounded-2xl hover:bg-primary/10 hover:text-primary transition-all disabled:opacity-50"
                                                        >
                                                            {generateTaskImage.isPending ? copy.preparingVisual : copy.finalStandard}
                                                        </button>
                                                        <button
                                                            onClick={() => generateTaskImage.mutate('flagship')}
                                                            disabled={generateTaskImage.isPending || !canGenerateVisual}
                                                            className="w-full bg-on-surface text-white font-black text-sm px-5 py-3 rounded-2xl hover:bg-primary transition-all disabled:opacity-50"
                                                            title={copy.flagshipHelp}
                                                        >
                                                            {generateTaskImage.isPending ? copy.preparingVisual : copy.flagshipFull}
                                                        </button>
                                                    </div>
                                                    {latestGeneratedImage?.url ? (
                                                        <div className="space-y-3">
                                                            <img
                                                                src={String(latestGeneratedImage.url)}
                                                                alt={String(latestGeneratedImage.alt_text || copy.imageCandidate)}
                                                                className="w-full rounded-2xl border border-outline-variant/10 bg-white object-cover"
                                                            />
                                                            <div className="rounded-2xl bg-white px-4 py-3 text-xs leading-6 text-on-surface-variant">
                                                                <div><span className="font-bold text-on-surface">Provider:</span> {String(latestGeneratedImage.provider || 'n/a')}</div>
                                                                {latestGeneratedImage.alt_text && (
                                                                    <div className="mt-2"><span className="font-bold text-on-surface">Alt:</span> {String(latestGeneratedImage.alt_text)}</div>
                                                                )}
                                                                {latestGeneratedImage.prompt && (
                                                                    <div className="mt-2 whitespace-pre-wrap break-words">{String(latestGeneratedImage.prompt)}</div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="rounded-2xl bg-white px-4 py-3 text-sm text-on-surface-variant shadow-sm">
                                                            {copy.noGeneratedImage}
                                                        </div>
                                                    )}
                                                    </div>
                                                </details>

                                                <details className="group rounded-[1.5rem] bg-surface-container-low border border-outline-variant/10">
                                                    <summary className="list-none cursor-pointer flex min-h-14 items-center justify-between gap-3 px-5 py-4">
                                                        <span className="font-black text-on-surface">{copy.materialsContext}</span>
                                                        <span className="material-symbols-outlined text-on-surface-variant transition-transform group-open:rotate-180">expand_more</span>
                                                    </summary>
                                                    <div className="border-t border-outline-variant/10 p-5 space-y-4 text-sm">
                                                        <div><div className="text-xs text-on-surface-variant">{copy.planItem}</div><div className="mt-1 font-bold break-words">{planItemRef || copy.notLinked}</div></div>
                                                        <div><div className="text-xs text-on-surface-variant">{copy.sourceResource}</div><div className="mt-1 break-words">{activeTask?.workspace_context?.source_file_name || sourceFiles[0]?.file_name || sourceFiles[0]?.relative_path || copy.notFound}</div></div>
                                                        {targetResourceUrl && <a href={targetResourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 font-bold text-primary break-all hover:underline"><span className="material-symbols-outlined text-base">open_in_new</span>{copy.openResource}</a>}
                                                    </div>
                                                </details>
                                            </aside>
                                        </section>
                                    )}

                                    <section className="rounded-[1.5rem] bg-surface-container-low p-5">
                                        <details className="group">
                                            <summary className="list-none cursor-pointer flex items-center justify-between gap-3">
                                                <div>
                                                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">{copy.technicalDetails}</div>
                                                    <div className="mt-1 text-sm text-on-surface-variant">
                                                        {copy.technicalDetailsHelp}
                                                    </div>
                                                </div>
                                                <span className="material-symbols-outlined text-on-surface-variant transition-transform group-open:rotate-180">expand_more</span>
                                            </summary>
                                            <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
                                                <div className="rounded-2xl bg-white p-4 space-y-2">
                                                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Task Context</div>
                                                    <div className="text-sm text-on-surface-variant space-y-2">
                                                        <div><span className="font-bold text-on-surface">Type:</span> {activeTask.type}</div>
                                                        <div><span className="font-bold text-on-surface">Adapter:</span> {activeTask.channel?.type || activeTask.layer || 'n/a'}</div>
                                                        <div><span className="font-bold text-on-surface">Account:</span> {activeTask.channel?.name || activeTask.metrics?.account_ref || 'n/a'}</div>
                                                        <div><span className="font-bold text-on-surface">Published:</span> {activeTask.published_link ? 'yes' : 'no'}</div>
                                                        {activeTask.published_link && (
                                                            <div><span className="font-bold text-on-surface">Outcome:</span> {activeOutcome}</div>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="rounded-2xl bg-white p-4 space-y-2">
                                                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Monitoring</div>
                                                    <pre className="text-xs font-mono whitespace-pre-wrap break-words text-on-surface-variant leading-6">
                                                        {prettyJson(activeTask.metrics?.monitoring || {})}
                                                    </pre>
                                                </div>
                                            </div>
                                        </details>
                                    </section>

                                    <section className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">История правок текста</div>
                                            <span className="text-xs text-on-surface-variant">{contentEditHistory.length} saved revisions</span>
                                        </div>
                                        {contentEditHistory.length === 0 ? (
                                            <div className="rounded-2xl bg-white px-4 py-3 text-sm text-on-surface-variant">
                                                После первого сохранения здесь появятся предыдущие версии текста.
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {contentEditHistory.map((entry, index) => (
                                                    <div key={`${entry.edited_at || 'revision'}-${index}`} className="rounded-2xl bg-white p-4 space-y-3">
                                                        <div className="text-xs font-black uppercase tracking-[0.18em] text-primary/60">
                                                            {entry.edited_at ? formatDate(entry.edited_at) : `Revision ${index + 1}`}
                                                        </div>
                                                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                                                            <div className="space-y-2">
                                                                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-on-surface-variant">Было</div>
                                                                <textarea
                                                                    readOnly
                                                                    value={entry.previous_body || ''}
                                                                    rows={6}
                                                                    className="w-full bg-surface-container-low border-none rounded-2xl p-3 text-xs leading-5 resize-none"
                                                                />
                                                            </div>
                                                            <div className="space-y-2">
                                                                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-on-surface-variant">Стало</div>
                                                                <textarea
                                                                    readOnly
                                                                    value={entry.next_body || ''}
                                                                    rows={6}
                                                                    className="w-full bg-surface-container-low border-none rounded-2xl p-3 text-xs leading-5 resize-none"
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </section>

                                    {!isOperationalTask && (
                                    <section className="grid grid-cols-1 xl:grid-cols-[minmax(320px,0.72fr)_minmax(0,1.28fr)] gap-6 items-start">
                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Чеклист публикации</div>
                                            <div className="space-y-3">
                                                {(handoffBundle?.manual_checklist || ['Подготовьте черновик, чтобы увидеть чеклист для этого канала.']).map((item: string, index: number) => (
                                                    <div key={`${item}-${index}`} className="flex items-start gap-3 text-sm text-on-surface-variant">
                                                        <span className="w-6 h-6 rounded-full bg-white text-primary flex items-center justify-center font-black text-xs shrink-0">{index + 1}</span>
                                                        <span className="leading-6">{item}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Исходные файлы</div>
                                            <div className="space-y-3">
                                                {sourceFiles.length > 0 ? sourceFiles.map((entry, index) => {
                                                    const fileName = entry.file_name || entry.asset?.path?.split('/').pop() || entry.ref || `asset-${index + 1}`
                                                    const relativePath = entry.relative_path || entry.asset?.path || null
                                                    const sectionMarker = entry.section_marker || entry.asset?.section_marker || null
                                                    const exists = typeof entry.exists === 'boolean' ? entry.exists : null
                                                    const purpose = entry.purpose || null
                                                    const role = entry.role || null
                                                    const url = entry.url || null
                                                    const inlineContent = assetInlineContent(entry)

                                                    return (
                                                        <div key={`${entry.ref || fileName}-${index}`} className="rounded-2xl bg-white px-4 py-3 text-sm space-y-1">
                                                            <div className="font-bold text-on-surface">{fileName}</div>
                                                            {role && (
                                                                <div className="text-xs text-on-surface-variant">Role: {role}</div>
                                                            )}
                                                            {relativePath && (
                                                                <div className="text-xs text-on-surface-variant break-all">{relativePath}</div>
                                                            )}
                                                            {url && (
                                                                <div className="text-xs text-on-surface-variant break-all">{url}</div>
                                                            )}
                                                            {sectionMarker && (
                                                                <div className="text-xs text-on-surface-variant">Section: {sectionMarker}</div>
                                                            )}
                                                            {purpose && (
                                                                <div className="text-xs text-on-surface-variant">{purpose}</div>
                                                            )}
                                                            {exists === false && !inlineContent && !url && (
                                                                <div className="text-xs font-bold text-error">File not found from pipeline root.</div>
                                                            )}
                                                            {(inlineContent || url) && (
                                                                <ResourcePreviewCard
                                                                    entry={entry}
                                                                    title={fileName}
                                                                    className="mt-3"
                                                                />
                                                            )}
                                                        </div>
                                                    )
                                                }) : (
                                                    <div className="rounded-2xl bg-white px-4 py-3 text-sm text-on-surface-variant">
                                                        К этой задаче не прикреплены исходные файлы.
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4 xl:col-start-2 xl:row-span-2">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Исходный контент</div>
                                                {!primarySourceEntry && !handoffBundle && (
                                                    <span className="text-xs text-on-surface-variant">Подготовьте черновик, чтобы загрузить контент</span>
                                                )}
                                            </div>
                                            <ResourcePreviewCard
                                                entry={primarySourceEntry}
                                                title={activeTask?.workspace_context?.source_file_name || 'source-content'}
                                                emptyMessage={handoffBundle
                                                    ? 'В связанных файлах не найден читаемый текст или ресурс для предпросмотра.'
                                                    : 'Подготовьте черновик, чтобы подтянуть текст или предпросмотр связанного ресурса.'}
                                            />
                                        </div>
                                    </section>
                                    )}

                                    <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] gap-6 items-start">
                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Критик и правила</div>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => runCriticCheck.mutate()}
                                                        disabled={runCriticCheck.isPending}
                                                        className="bg-primary text-white font-black text-xs px-4 py-2 rounded-2xl shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50"
                                                    >
                                                        {runCriticCheck.isPending ? 'Проверяем...' : 'Проверить критиком'}
                                                    </button>
                                                    <button
                                                        onClick={() => runCriticFixer.mutate()}
                                                        disabled={runCriticFixer.isPending || !publicationBody.trim()}
                                                        className="bg-white text-primary font-black text-xs px-4 py-2 rounded-2xl border border-primary/15 shadow-sm hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50"
                                                    >
                                                        {runCriticFixer.isPending ? 'Исправляем...' : 'Исправить по отчёту'}
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                                                <div className="rounded-2xl bg-white px-4 py-3">
                                                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Глоссарий</div>
                                                    <div className="mt-2 text-sm font-bold text-on-surface">{glossaryAvailable ? 'Подключён' : 'Не загружен'}</div>
                                                </div>
                                                <div className="rounded-2xl bg-white px-4 py-3">
                                                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Policy Matrix</div>
                                                    <div className="mt-2 text-sm font-bold text-on-surface">{criticReport?.content_policy_matrix_available ? 'Подключена' : 'Не загружена'}</div>
                                                </div>
                                                <div className="rounded-2xl bg-white px-4 py-3">
                                                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Atoma</div>
                                                    <div className="mt-2 text-sm font-bold text-on-surface">{atomaDescription ? 'Контекст есть' : 'Не загружен'}</div>
                                                </div>
                                                <div className="rounded-2xl bg-white px-4 py-3">
                                                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Итоговый score</div>
                                                    <div className="mt-2 text-sm font-bold text-on-surface">{criticReport?.overall_score ?? '—'}</div>
                                                </div>
                                            </div>

                                            {criticReport ? (
                                                <div className="space-y-4">
                                                    <div className="rounded-2xl bg-white px-4 py-3 text-sm text-on-surface-variant">
                                                        <div><span className="font-bold text-on-surface">Dictionary score:</span> {criticReport.dictionary?.score ?? '—'}</div>
                                                        {criticReport.policy_matrix?.score !== undefined && (
                                                            <div className="mt-1"><span className="font-bold text-on-surface">Policy matrix score:</span> {criticReport.policy_matrix.score}</div>
                                                        )}
                                                        {criticReport.llm_critic?.score !== undefined && (
                                                            <div className="mt-1"><span className="font-bold text-on-surface">LLM critic score:</span> {criticReport.llm_critic.score}</div>
                                                        )}
                                                        {criticReport.checked_at && (
                                                            <div className="mt-1"><span className="font-bold text-on-surface">Проверено:</span> {formatDate(criticReport.checked_at)}</div>
                                                        )}
                                                    </div>

                                                    {criticReport.scoring_dimensions && (
                                                        <div className="grid grid-cols-2 gap-2">
                                                            {Object.entries(criticReport.scoring_dimensions).map(([key, value]) => (
                                                                <div key={key} className="rounded-2xl bg-white px-4 py-3 text-sm">
                                                                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-on-surface-variant">{key}</div>
                                                                    <div className="mt-2 font-bold text-on-surface">{String(value)}</div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {criticReport.llm_critic?.critique && (
                                                        <div className="rounded-2xl bg-white px-4 py-3 text-sm leading-6 text-on-surface whitespace-pre-wrap">
                                                            {criticReport.llm_critic.critique}
                                                        </div>
                                                    )}

                                                    {Array.isArray(criticReport.llm_critic?.rewrite_instructions) && criticReport.llm_critic?.rewrite_instructions?.length > 0 && (
                                                        <div className="rounded-2xl bg-white px-4 py-3 text-sm text-on-surface">
                                                            <div className="font-bold">Инструкции для фикса</div>
                                                            <div className="mt-2 space-y-2">
                                                                {criticReport.llm_critic.rewrite_instructions.map((instruction, index) => (
                                                                    <div key={`${instruction}-${index}`} className="text-on-surface-variant">{index + 1}. {instruction}</div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {criticReport.llm_error && (
                                                        <div className="rounded-2xl bg-error-container/30 px-4 py-3 text-sm text-error">
                                                            {criticReport.llm_error}
                                                        </div>
                                                    )}

                                                    <div className="space-y-2">
                                                        {[...(criticReport.dictionary?.findings || []), ...(criticReport.policy_matrix?.findings || [])].length === 0 ? (
                                                            <div className="rounded-2xl bg-white px-4 py-3 text-sm text-on-surface-variant">
                                                                По словарю, policy matrix и обязательным правилам замечаний нет.
                                                            </div>
                                                        ) : (
                                                            [...(criticReport.dictionary?.findings || []), ...(criticReport.policy_matrix?.findings || [])].map((finding, index) => (
                                                                <div key={`${finding.message}-${index}`} className="rounded-2xl bg-white px-4 py-3 text-sm">
                                                                    <div className="font-bold text-on-surface">{finding.message}</div>
                                                                    {(finding.matched || finding.suggestion) && (
                                                                        <div className="mt-2 text-xs text-on-surface-variant">
                                                                            {finding.matched && <div>Найдено: {finding.matched}</div>}
                                                                            {finding.suggestion && <div>Предлагается: {finding.suggestion}</div>}
                                                                            {('source' in finding && (finding as any).source) && <div>Источник правила: {(finding as any).source}</div>}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ))
                                                        )}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="rounded-2xl bg-white px-4 py-3 text-sm text-on-surface-variant">
                                                    Запусти критика, чтобы проверить текст по глоссарию, atoma-контексту и агентной критике.
                                                </div>
                                            )}
                                        </div>

                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Глоссарий и atoma-контекст</div>
                                                <button
                                                    type="button"
                                                    onClick={() => navigate('/settings?tab=dictionary')}
                                                    className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-primary transition hover:scale-[1.01] active:scale-95"
                                                >
                                                    <span className="material-symbols-outlined text-base">menu_book</span>
                                                    <span>Content Dictionary</span>
                                                </button>
                                            </div>
                                            <div className="grid grid-cols-1 gap-4">
                                                <div>
                                                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Глоссарий проекта</div>
                                                    <textarea
                                                        readOnly
                                                        value={glossaryYaml || 'Глоссарий не загружен вместе с планом или через настройки проекта.'}
                                                        rows={8}
                                                        className="mt-2 w-full bg-white border-none rounded-2xl p-4 text-xs leading-6 focus:outline-none resize-none"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">ATOMA Context</div>
                                                <button
                                                    type="button"
                                                    onClick={() => navigate('/settings?tab=dictionary')}
                                                    className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-primary transition hover:scale-[1.01] active:scale-95"
                                                >
                                                    <span className="material-symbols-outlined text-base">tune</span>
                                                    <span>Edit Context</span>
                                                </button>
                                            </div>

                                            <div>
                                                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Что это значит</div>
                                                <textarea
                                                    readOnly
                                                    value={atomaSummary}
                                                    rows={7}
                                                    className="mt-2 w-full bg-white border-none rounded-2xl p-4 text-xs leading-6 focus:outline-none resize-none"
                                                />
                                            </div>

                                            <div className="grid grid-cols-1 gap-4">
                                                <div>
                                                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Описание atoma files</div>
                                                    <textarea
                                                        readOnly
                                                        value={atomaDescription || 'Описание atoma files не загружено.'}
                                                        rows={4}
                                                        className="mt-2 w-full bg-white border-none rounded-2xl p-4 text-xs leading-6 focus:outline-none resize-none"
                                                    />
                                                </div>
                                                <div>
                                                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Atoma payload</div>
                                                    <textarea
                                                        readOnly
                                                        value={prettyJson(atomaPayload || {})}
                                                        rows={8}
                                                        className="mt-2 w-full bg-white border-none rounded-2xl p-4 text-xs font-mono leading-6 focus:outline-none resize-none"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </section>

                                    <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-3">
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Verification Rules</div>
                                            <pre className="text-xs font-mono whitespace-pre-wrap break-words text-on-surface-variant leading-6">
                                                {prettyJson(handoffBundle?.verification || activeTask.quality_report?.verification || [])}
                                            </pre>
                                        </div>

                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-3">
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Post Actions</div>
                                            <pre className="text-xs font-mono whitespace-pre-wrap break-words text-on-surface-variant leading-6">
                                                {prettyJson(handoffBundle?.post_actions || activeTask.quality_report?.post_actions || [])}
                                            </pre>
                                        </div>

                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-3">
                                            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Ассеты и визуалы</div>
                                            <pre className="text-xs font-mono whitespace-pre-wrap break-words text-on-surface-variant leading-6">
                                                {prettyJson({
                                                    visuals: handoffBundle?.publication?.visuals || [],
                                                    html_bundle: handoffBundle?.publication?.html_bundle || []
                                                })}
                                            </pre>
                                        </div>
                                    </section>

                                    <section>
                                        <div className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                            <h3 className="text-lg font-headline font-black text-on-surface">Автоматические метрики канала</h3>
                                            <div className="rounded-2xl bg-white px-4 py-3 text-xs leading-6 text-on-surface-variant">
                                                {activeTask.channel?.type === 'linkedin'
                                                    ? 'Для LinkedIn мы подтягиваем аналитику из подключённого канала. Если токен был выдан до нового analytics scope, сначала переподключи LinkedIn.'
                                                    : activeTask.channel?.type === 'tilda'
                                                        ? 'Tilda не отдаёт постовую аналитику напрямую через этот интерфейс. Автоматический сбор сработает только если у проекта также привязана Google Search Console property для опубликованного URL.'
                                                    : 'Используй сбор из канала, если адаптер поддерживает аналитику, или сохраняй ручной снимок, если площадка работает только вручную.'}
                                            </div>
                                            {isVkTask && (
                                                <div className="space-y-4">
                                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                                        <div className="flex flex-wrap gap-2 text-[11px] font-bold">
                                                            <span className={`rounded-full px-3 py-1.5 ${latestVkSnapshot?.wall_status === 'collected' ? 'bg-success/15 text-success' : 'bg-surface-container-high text-on-surface-variant'}`}>
                                                                Публичные метрики: {latestVkSnapshot?.wall_status === 'collected' ? 'получены' : 'нет снимка'}
                                                            </span>
                                                            <span className={`rounded-full px-3 py-1.5 ${latestVkSnapshot?.reach_status === 'collected' ? 'bg-success/15 text-success' : 'bg-yellow-100 text-yellow-900'}`}>
                                                                Расширенная статистика: {latestVkSnapshot?.reach_status === 'collected' ? 'получена' : 'нет доступа'}
                                                            </span>
                                                        </div>
                                                        <span className="text-xs text-on-surface-variant">
                                                            {isLoadingVkMetrics
                                                                ? 'Обновляем историю...'
                                                                : latestVkSnapshot
                                                                    ? `Снимок: ${formatDate(latestVkSnapshot.captured_at)}`
                                                                    : 'Снимков пока нет'}
                                                        </span>
                                                    </div>

                                                    {latestVkSnapshot && (
                                                        <>
                                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                                                {VK_PUBLIC_METRICS.map(([field, label]) => (
                                                                    <div key={field} className="rounded-2xl bg-white p-4">
                                                                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-on-surface-variant">{label}</div>
                                                                        <div className="mt-2 text-xl font-black text-on-surface">{formatMetricValue(latestVkSnapshot[field] as number | null)}</div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
                                                                {VK_REACH_METRICS.map(([field, label]) => (
                                                                    <div key={field} className="rounded-2xl bg-white p-3">
                                                                        <div className="text-[10px] font-bold text-on-surface-variant">{label}</div>
                                                                        <div className="mt-1 text-base font-black text-on-surface">{formatMetricValue(latestVkSnapshot[field] as number | null)}</div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                            <div className="rounded-2xl bg-white p-4">
                                                                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-on-surface-variant">Последние замеры</div>
                                                                <div className="mt-3 flex flex-wrap gap-2">
                                                                    {vkSnapshots.slice(-7).reverse().map((snapshot) => (
                                                                        <span key={snapshot.id} className="rounded-xl bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant">
                                                                            {formatDate(snapshot.logical_date)} · {formatMetricValue(snapshot.views)} просмотров · {formatMetricValue(snapshot.reach_total)} охват
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                            <div>
                                                <button
                                                    onClick={() => collectMetrics.mutate()}
                                                    disabled={collectMetrics.isPending || !canFetchMetrics}
                                                    className="w-full sm:w-auto bg-primary text-white font-black text-sm px-5 py-3 rounded-2xl shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50"
                                                >
                                                    {collectMetrics.isPending ? 'Получаем...' : 'Получить из канала'}
                                                </button>
                                            </div>
                                        </div>
                                    </section>

                                    <section className="rounded-[1.5rem] bg-surface-container-low p-5 space-y-4">
                                        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/60">Внешний алерт по комментарию</div>
                                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                                            <input
                                                type="text"
                                                value={commentAuthor}
                                                onChange={(event) => setCommentAuthor(event.target.value)}
                                                placeholder="Автор"
                                                className="w-full bg-white border-none rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                            />
                                            <input
                                                type="url"
                                                value={commentUrl}
                                                onChange={(event) => setCommentUrl(event.target.value)}
                                                placeholder="URL комментария"
                                                className="w-full bg-white border-none rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                            />
                                            <button
                                                onClick={() => sendCommentAlert.mutate()}
                                                disabled={sendCommentAlert.isPending || !commentText.trim()}
                                                className="bg-primary text-white font-black text-sm px-5 py-3 rounded-2xl shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50"
                                            >
                                                {sendCommentAlert.isPending ? 'Сохраняем...' : 'Записать алерт по комментарию'}
                                            </button>
                                        </div>
                                        <textarea
                                            value={commentText}
                                            onChange={(event) => setCommentText(event.target.value)}
                                            rows={4}
                                            className="w-full bg-white border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                            placeholder="Вставь текст комментария или заметку модерации"
                                        />
                                    </section>
                                </div>
                            </div>
                        )}
                    </div>
            </section>

            {showPlanModal && (
                <div className="fixed inset-0 z-50 bg-black/35 backdrop-blur-sm flex items-center justify-center p-6">
                    <div className="w-full max-w-4xl bg-white rounded-[2rem] border border-outline-variant/10 shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-outline-variant/10 flex items-start justify-between gap-4">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Импорт плана</div>
                                <h2 className="text-2xl font-headline font-black tracking-tight text-on-surface mt-2">Синхронизировать план публикаций</h2>
                                <p className="text-sm text-on-surface-variant mt-2 leading-relaxed">
                                    Загрузи или обнови внешний `publication-plan.json`, не занимая место на основной рабочей странице.
                                </p>
                            </div>
                            <button
                                onClick={() => setShowPlanModal(false)}
                                className="w-11 h-11 rounded-2xl bg-surface-container-low text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition-all"
                            >
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        <div className="p-6 space-y-5">
                            <textarea
                                value={planJson}
                                onChange={(event) => setPlanJson(event.target.value)}
                                rows={18}
                                spellCheck={false}
                                className="w-full bg-surface-container-low border-none rounded-[1.5rem] p-5 text-xs font-mono leading-6 focus:ring-4 focus:ring-primary/10 transition-all outline-none"
                                placeholder="Вставь сюда publication-plan.json"
                            />

                            {planMessage && (
                                <div className="rounded-2xl bg-success/10 text-success px-4 py-3 text-sm font-medium">
                                    {planMessage}
                                </div>
                            )}

                            {importPlan.error && (
                                <div className="rounded-2xl bg-error-container/30 text-error px-4 py-3 text-sm font-medium">
                                    {(importPlan.error as Error).message}
                                </div>
                            )}

                            <div className="flex flex-wrap gap-3 justify-between items-center">
                                <div className="text-xs text-on-surface-variant">
                                    {currentProject ? `Текущий проект: ${currentProject.name}` : 'Импорт создаст или обновит связанный проект.'}
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setShowPlanModal(false)}
                                        className="bg-surface-container-high text-on-surface font-black text-sm px-5 py-3 rounded-2xl hover:bg-surface-container-highest transition-all"
                                    >
                                        Закрыть
                                    </button>
                                    <button
                                        onClick={() => {
                                            setPlanMessage(null)
                                            importPlan.mutate()
                                        }}
                                        disabled={!planJson.trim() || importPlan.isPending}
                                        className="bg-primary text-white font-black text-sm px-6 py-3 rounded-2xl shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50"
                                    >
                                        {importPlan.isPending ? 'Синхронизируем план...' : 'Синхронизировать план публикаций'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

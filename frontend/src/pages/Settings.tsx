import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiJson } from '../types/api-json'
import { useState, useEffect, useRef } from 'react'
import { api, presetsApi, keysApi, modelsApi, projectsApi, skillConnectionsApi, contentDictionaryApi, contentPolicyMatrixApi, atomaContextApi } from '../api'
import { useAuth } from '../context/auth'
import { useToast } from '../components/toast'
import { useLocale } from '../i18n/locale'

interface AgentConfig {
    role: string
    prompt: string
    apiKey: string
    model: string
    provider?: string
}

interface ModelUsageSummary {
    period_days: number
    total_calls: number
    exact_cost_coverage: number
    total_estimated_cost_usd: number
    by_model: Array<{
        provider: string | null
        model: string | null
        calls: number
        failed_calls: number
        input_tokens: number
        output_tokens: number
        estimated_cost_usd: number | null
        avg_latency_ms: number | null
    }>
}

interface PromptPreset {
    id: number
    name: string
    role: string
    prompt_text: string
}

interface ProviderKey {
    id: number
    name: string
    key: string
    provider: string
}

interface SkillConnection {
    id: string
    name: string
    provider: string
    model: string
    providerKeyId?: number | null
    endpointType?: string
    skillMode?: string
    enabledSkills: string[]
    systemPrompt?: string
    notes?: string
    enabled: boolean
    supportsSkills: boolean
}

interface SocialChannel {
    id: number;
    type: string;
    name: string;
    config: ApiJson;
    is_active: boolean;
}

interface AtomaContextResponse {
    description: string
    payload: ApiJson
    payload_text: string
    updated_at: string | null
}

interface ContentPolicyMatrixResponse {
    yaml: string
    parsed: ApiJson
    updated_at: string | null
}

interface McpStatus {
    status: 'online' | 'degraded' | 'offline'
    endpoint: string
    bearer_required: boolean | null
    transport?: string | null
    uptime_s?: number
    active_sessions?: number
    checked_at: string
    message?: string
    capability_endpoints?: {
        planner: { endpoint: string; configured: boolean; bound_project_id?: number | null }
        writer: { endpoint: string; configured: boolean; bound_project_id?: number | null }
        art_director?: { endpoint: string; configured: boolean; bound_project_id?: number | null }
    }
}

interface McpAccess {
    id: number
    profile: 'planner' | 'writer' | 'art_director'
    label: string
    expires_at: string | null
    revoked_at: string | null
    last_used_at: string | null
    user: { id: number; name: string; email: string }
}

const AGENT_ROLES = [
    {
        group: 'Content Creation',
        roles: [
            { id: 'post_creator', label: 'Post Creator', icon: 'edit_note' },
            { id: 'post_critic', label: 'Post Critic', icon: 'rate_review' },
            { id: 'post_fixer', label: 'Post Fixer', icon: 'build_circle' },
        ]
    },
    {
        group: 'Topic Generation',
        roles: [
            { id: 'topic_creator', label: 'Topic Creator', icon: 'lightbulb' },
            { id: 'topic_critic', label: 'Topic Critic', icon: 'psychology' },
            { id: 'topic_fixer', label: 'Topic Fixer', icon: 'auto_fix_high' },
        ]
    },
    {
        group: 'Visual Synthesis (V2)',
        roles: [
            { id: 'visual_architect', label: 'Visual Architect', icon: 'architecture' },
            { id: 'structural_critic', label: 'Structural Critic', icon: 'grid_view' },
            { id: 'precision_fixer', label: 'Precision Fixer', icon: 'precision_manufacturing' },
            { id: 'image_critic', label: 'Image Critic', icon: 'image_search' },
        ]
    },
    {
        group: 'Legacy Generators',
        roles: [
            { id: 'gpt_image_gen', label: 'GPT-Image Prompt', icon: 'palette' },
            { id: 'nano_image_gen', label: 'Nano Banana Prompt', icon: 'imagesmode' },
        ]
    }
]

function AgentSettingsRow({ 
    roleId, 
    label, 
    icon, 
    config, 
    keys, 
    onSave, 
    isUpdating,
    loadModels
}: { 
    roleId: string, 
    label: string, 
    icon: string, 
    config?: AgentConfig, 
    keys?: ProviderKey[], 
    onSave: (data: ApiJson) => void,
    isUpdating: boolean,
    loadModels: (apiKey: string) => Promise<string[]>
}) {
    const { showToast } = useToast()
    const [isExpanded, setIsExpanded] = useState(false)
    const [prompt, setPrompt] = useState(config?.prompt || '')
    const [apiKey, setApiKey] = useState(config?.apiKey || '')
    const [model, setModel] = useState(config?.model || '')
    const [availableModels, setAvailableModels] = useState<string[]>([])
    const [isLoadingModels, setIsLoadingModels] = useState(false)

    useEffect(() => {
        if (config) {
            setPrompt(config.prompt)
            setApiKey(config.apiKey)
            setModel(config.model)
        }
    }, [config])

    const handleLoadModels = async () => {
        if (!apiKey) return
        setIsLoadingModels(true)
        try {
            const models = await loadModels(apiKey)
            setAvailableModels(models)
        } catch (e: ApiJson) {
            showToast('Failed to load models', 'error', e.message)
        } finally {
            setIsLoadingModels(false)
        }
    }

    return (
        <div className={`transition-all duration-300 ${isExpanded ? 'bg-surface-container-low' : 'hover:bg-surface-container-lowest'}`}>
            <div 
                className="flex items-center justify-between p-4 cursor-pointer" 
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${isExpanded ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant'}`}>
                        <span className="material-symbols-outlined">{icon}</span>
                    </div>
                    <div>
                        <h4 className="font-bold text-on-surface m-0 leading-tight">{label}</h4>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/60">{roleId}</span>
                            {config?.model && (
                                <span className="badge py-0.5 px-1.5 text-[10px]">{config.model}</span>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {isUpdating && <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>}
                    <span className={`material-symbols-outlined transition-transform duration-300 ${isExpanded ? 'rotate-180 text-primary' : 'text-on-surface-variant'}`}>
                        expand_more
                    </span>
                </div>
            </div>
            
            {isExpanded && (
                <div className="p-6 pt-0 border-t border-outline-variant/5">
                    <div className="space-y-4 pt-4">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">System Prompt</label>
                            <textarea 
                                value={prompt} 
                                onChange={e => setPrompt(e.target.value)} 
                                rows={6} 
                                className="w-full bg-surface-container-high border-none rounded-2xl p-4 text-sm font-mono focus:ring-2 focus:ring-primary/20 transition-all"
                                placeholder="Enter system instructions for this agent..."
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">API Provider / Key</label>
                                <select 
                                    className="w-full bg-surface-container-high border-none rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                                    value={apiKey.startsWith('pk_') ? apiKey : 'custom'}
                                    onChange={e => {
                                        if (e.target.value === 'custom') setApiKey('')
                                        else setApiKey(e.target.value)
                                    }}
                                >
                                    {keys?.map(k => (
                                        <option key={k.id} value={`pk_${k.id}`}>{k.name} ({k.provider})</option>
                                    ))}
                                    <option value="custom">Use Custom Raw Key...</option>
                                </select>
                                {!apiKey.startsWith('pk_') && (
                                    <input 
                                        type="password" 
                                        value={apiKey} 
                                        onChange={e => setApiKey(e.target.value)} 
                                        placeholder="Paste raw API key..." 
                                        className="w-full mt-2 bg-surface-container-high border-none rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                                    />
                                )}
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Model Selection</label>
                                <div className="flex gap-2">
                                    <input 
                                        type="text" 
                                        value={model} 
                                        onChange={e => setModel(e.target.value)} 
                                        className="flex-1 bg-surface-container-high border-none rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                                        list={`models-${roleId}`} 
                                        placeholder="e.g. gpt-4o"
                                    />
                                    <button 
                                        className="bg-surface-container-highest hover:bg-primary/10 text-on-surface-variant hover:text-primary p-3 rounded-xl transition-all disabled:opacity-50"
                                        onClick={handleLoadModels} 
                                        disabled={!apiKey || isLoadingModels}
                                        title="Load available models"
                                    >
                                        <span className={`material-symbols-outlined text-xl ${isLoadingModels ? 'animate-spin' : ''}`}>
                                            {isLoadingModels ? 'progress_activity' : 'search'}
                                        </span>
                                    </button>
                                </div>
                                <datalist id={`models-${roleId}`}>
                                    {availableModels.map(m => <option key={m} value={m} />)}
                                </datalist>
                            </div>
                        </div>

                        <div className="pt-4 flex justify-end">
                            <button 
                                className="bg-primary text-white font-bold py-3 px-8 rounded-xl shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2"
                                onClick={() => onSave({ role: roleId, prompt, apiKey, model })} 
                                disabled={isUpdating}
                            >
                                <span className="material-symbols-outlined text-lg">save</span>
                                <span>Save Changes</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

function ChannelConnectionGuide({
    title,
    fieldsComplete,
    completeLabel,
    missingLabel,
    steps,
    note
}: {
    title: string
    fieldsComplete: boolean
    completeLabel: string
    missingLabel: string
    steps: string[]
    note: string
}) {
    return (
        <details
            open={!fieldsComplete}
            className="rounded-xl border border-primary/20 bg-primary/5"
            style={{ gridColumn: '1 / -1' }}
        >
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="flex min-w-0 items-center gap-2 font-black text-on-surface">
                    <span className="material-symbols-outlined text-xl text-primary" aria-hidden="true">link</span>
                    {title}
                </span>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${fieldsComplete ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
                    {fieldsComplete ? completeLabel : missingLabel}
                </span>
            </summary>
            <div className="border-t border-primary/15 px-4 pb-4 pt-3 text-sm leading-6 text-on-surface-variant">
                <ol className="m-0 grid gap-2 pl-5">
                    {steps.map((step, index) => <li key={`${title}-${index}`}>{step}</li>)}
                </ol>
                <div className="mt-3 flex gap-2 rounded-lg bg-white/70 px-3 py-2 text-xs leading-5">
                    <span className="material-symbols-outlined mt-0.5 text-base text-primary" aria-hidden="true">shield_lock</span>
                    <span>{note}</span>
                </div>
            </div>
        </details>
    )
}

function VkConnectionGuide({ locale, vkId, publicationToken }: { locale: 'ru' | 'en'; vkId: unknown; publicationToken: unknown }) {
    const hasVkId = Boolean(String(vkId || '').trim())
    const hasPublicationToken = Boolean(String(publicationToken || '').trim())
    const missing = [
        !hasVkId ? (locale === 'ru' ? 'ID сообщества' : 'community ID') : null,
        !hasPublicationToken ? (locale === 'ru' ? 'токен публикации' : 'publication token') : null
    ].filter(Boolean).join(locale === 'ru' ? ' и ' : ' and ')

    return <ChannelConnectionGuide
        title={locale === 'ru' ? 'Как подключить VK' : 'How to connect VK'}
        fieldsComplete={hasVkId && hasPublicationToken}
        completeLabel={locale === 'ru' ? 'Поля заполнены' : 'Fields filled'}
        missingLabel={locale === 'ru' ? `Не хватает: ${missing}` : `Missing: ${missing}`}
        steps={locale === 'ru' ? [
            'Откройте нужное сообщество VK под аккаунтом администратора: Управление → Работа с API → Ключи доступа.',
            'Скопируйте числовой ID сообщества. В Планнере укажите его со знаком минус, например −123456789.',
            'Создайте ключ доступа для публикации. Разрешите управление сообществом и доступ к фотографиям, чтобы Планнер мог отправлять текст и визуал.',
            'Вставьте ключ в поле «Токен публикации» и сохраните канал. Токен статистики нужен только для расширенных охватов и не обязателен для публикации.'
        ] : [
            'Open the VK community as an administrator: Manage → API access → Access tokens.',
            'Copy the numeric community ID. In Planner, enter it with a minus sign, for example −123456789.',
            'Create an access token for publishing. Allow community management and photo access so Planner can send both copy and visuals.',
            'Paste the key into Publication token and save the channel. The statistics token is only needed for extended reach metrics and is not required for publishing.'
        ]}
        note={locale === 'ru'
            ? 'Планнер не показывает сохранённый токен повторно. Не отправляйте его в чат и не добавляйте в репозиторий. Подготовка черновика может работать без коннекта, но реальная публикация останется заблокированной, пока оба обязательных поля не заполнены.'
            : 'Planner never reveals a saved token again. Do not send it in chat or commit it to the repository. Draft preparation can work without a connector, but live publishing remains blocked until both required fields are filled.'}
    />
}

function TelegramConnectionGuide({ locale, channelId }: { locale: 'ru' | 'en'; channelId: unknown }) {
    const hasChannelId = Boolean(String(channelId || '').trim())
    return <ChannelConnectionGuide
        title={locale === 'ru' ? 'Как подключить Telegram' : 'How to connect Telegram'}
        fieldsComplete={hasChannelId}
        completeLabel={locale === 'ru' ? 'ID указан' : 'ID filled'}
        missingLabel={locale === 'ru' ? 'Не хватает: ID канала' : 'Missing: channel ID'}
        steps={locale === 'ru' ? [
            'Создайте бота через @BotFather командой /newbot или используйте уже подключённого к Планнеру бота.',
            'Добавьте бота администраторам нужного канала и разрешите ему публиковать сообщения. Для последующего редактирования публикаций дайте также право редактировать сообщения.',
            'Укажите числовой ID канала в формате −100…, а для публичного канала дополнительно заполните @username, чтобы Планнер формировал прямые ссылки на публикации.',
            'Bot Token задаётся один раз на сервере как TELEGRAM_BOT_TOKEN для planner-app и planner-mcp. В карточку канала токен вставлять не нужно.'
        ] : [
            'Create a bot with the /newbot command in @BotFather, or use the bot already connected to Planner.',
            'Add the bot as an administrator of the target channel and allow it to post messages. Also grant edit-message permission if Planner should edit posts later.',
            'Enter the numeric channel ID in the −100… format. For a public channel, also add its @username so Planner can build direct publication links.',
            'The Bot Token is configured once on the server as TELEGRAM_BOT_TOKEN for planner-app and planner-mcp. Do not paste it into the channel card.'
        ]}
        note={locale === 'ru'
            ? 'Bot Token является паролем от бота: не отправляйте его в чат и не храните в репозитории. Статус «ID указан» подтверждает только заполнение карточки; публикация заработает, когда серверный токен настроен, а бот остаётся администратором канала.'
            : 'The Bot Token is the bot password: never send it in chat or commit it to the repository. “ID filled” only confirms the channel card; publishing works when the server token is configured and the bot remains a channel administrator.'}
    />
}

function DzenConnectionGuide({ locale, channelId, session }: { locale: 'ru' | 'en'; channelId: unknown; session: unknown }) {
    const hasChannelId = Boolean(String(channelId || '').trim())
    const hasSession = Boolean(String(session || '').trim())
    const missing = [
        !hasChannelId ? (locale === 'ru' ? 'ID канала' : 'channel ID') : null,
        !hasSession ? (locale === 'ru' ? 'авторизованная сессия' : 'authorized session') : null
    ].filter(Boolean).join(locale === 'ru' ? ' и ' : ' and ')

    return <ChannelConnectionGuide
        title={locale === 'ru' ? 'Как подключить Дзен' : 'How to connect Zen'}
        fieldsComplete={hasChannelId && hasSession}
        completeLabel={locale === 'ru' ? 'Поля заполнены' : 'Fields filled'}
        missingLabel={locale === 'ru' ? `Не хватает: ${missing}` : `Missing: ${missing}`}
        steps={locale === 'ru' ? [
            'Войдите в dzen.ru под аккаунтом, который может публиковать в нужном канале, и откройте редактор этого канала.',
            'Скопируйте ID из адреса канала или редактора: часть после /id/ либо /profile/editor/id/.',
            'Откройте инструменты разработчика браузера → Network, обновите страницу Дзена, выберите запрос к dzen.ru и скопируйте только значение заголовка Cookie.',
            'Вставьте значение в «Авторизованная сессия», сохраните канал и нажмите «Проверить подключение к Дзену». Успешная проверка должна подтвердить доступ к редактору.'
        ] : [
            'Sign in to dzen.ru with an account that can publish to the target channel, then open that channel’s editor.',
            'Copy the ID from the channel or editor URL: the part after /id/ or /profile/editor/id/.',
            'Open browser developer tools → Network, reload Zen, select a request to dzen.ru, and copy only the Cookie request-header value.',
            'Paste it into Authorized session, save the channel, and click Test Zen connection. A successful check must confirm editor access.'
        ]}
        note={locale === 'ru'
            ? 'Сессия даёт доступ к аккаунту Дзена. Планнер шифрует её и после сохранения показывает только маску. Не отправляйте Cookie в чат; если проверка перестала проходить, войдите в Дзен заново и замените сессию.'
            : 'The session grants access to the Zen account. Planner encrypts it and only shows a mask after saving. Never send the Cookie in chat; if the check stops passing, sign in to Zen again and replace the session.'}
    />
}

type SettingsTab = 'general' | 'channels' | 'mcp' | 'keys' | 'agents' | 'skills' | 'dictionary' | 'presets' | 'team' | 'history'

const SETTINGS_TABS: SettingsTab[] = ['general', 'channels', 'mcp', 'keys', 'agents', 'skills', 'dictionary', 'presets', 'team', 'history']

const SETTINGS_GROUPS: Array<{ label: string; tabs: Array<{ id: SettingsTab; label: string; hint: string; icon: string }> }> = [
    { label: 'Рабочий контур', tabs: [
        { id: 'general', label: 'Проект', hint: 'Название и поведение', icon: 'tune' },
        { id: 'channels', label: 'Каналы', hint: 'Площадки и режимы', icon: 'campaign' },
        { id: 'mcp', label: 'MCP', hint: 'Подключение агентов', icon: 'hub' }
    ] },
    { label: 'Интеллект', tabs: [
        { id: 'keys', label: 'Ключи моделей', hint: 'Провайдеры AI', icon: 'key' },
        { id: 'agents', label: 'Агенты', hint: 'Роли и модели', icon: 'smart_toy' },
        { id: 'skills', label: 'Навыки', hint: 'Skill-подключения', icon: 'extension' }
    ] },
    { label: 'Контент', tabs: [
        { id: 'dictionary', label: 'Правила', hint: 'Словарь и ATOMA', icon: 'menu_book' },
        { id: 'presets', label: 'Пресеты', hint: 'Шаблоны промптов', icon: 'text_snippet' }
    ] },
    { label: 'Управление', tabs: [
        { id: 'team', label: 'Команда', hint: 'Участники и роли', icon: 'group' },
        { id: 'history', label: 'История', hint: 'Запуски и ошибки', icon: 'history' }
    ] }
]

export default function Settings() {
    const queryClient = useQueryClient()
    const { showToast } = useToast()
    const { currentProject, user, token } = useAuth()
    const { locale } = useLocale()
    const copy = locale === 'ru' ? {
        title: 'Настройки проекта', intro: 'Управляйте рабочим контуром проекта', owner: 'Владелец', readOnly: 'Только просмотр',
        ownerOnly: 'Изменять настройки может только владелец проекта. Вы можете посмотреть текущую конфигурацию без секретных значений.',
        settingsSection: 'Раздел настроек', settingsSections: 'Разделы настроек', project: 'Проект', projectHelp: 'Основные данные и поведение планировщика для этого проекта.',
        projectName: 'Название проекта', description: 'Описание', descriptionPlaceholder: 'Что производит этот проект и для какой аудитории', saving: 'Сохраняем…', save: 'Сохранить изменения',
        scheduling: 'Планирование публикаций', nativeTelegram: 'Использовать отложенные сообщения Telegram', nativeTelegramHelp: 'Будущие публикации попадут в очередь Telegram и выйдут, даже если планировщик временно выключен.',
        artDirection: 'Проверять визуальную необходимость до публикации', artDirectionHelp: 'Арт-директор решит, нужен ли визуал, запросит реальный источник или отправит изображение на ревью. До явного допуска handoff и публикация будут заблокированы.',
        planningHq: 'Штаб планирования', planningHqHelp: 'Управляет слотами, каналами, темами и расписанием. Не редактирует текст публикации.',
        contentAgent: 'Контент-агент', contentAgentHelp: 'Читает готовые слоты и заполняет только текст. Не может менять дату, канал, тему или статус.',
        artDirector: 'Арт-директор', artDirectorHelp: 'Оценивает необходимость визуала, формирует brief, принимает источники и проводит визуальное ревью. Не может переписывать посты.',
        mcpTitle: 'Подключение MCP', mcpHelp: 'Дайте Codex, Claude или другому агенту доступ к плану, очереди работ и публикациям проекта.',
        mcpOnline: 'MCP работает', mcpOffline: 'MCP недоступен', checking: 'Проверяем MCP', check: 'Проверить', configured: 'Настроен', notConfigured: 'Не настроен',
        copyConfig: 'Копировать конфигурацию', copied: 'Конфигурация скопирована', tokenHelp: 'Каждый агент получает отдельный endpoint и отдельный токен. В конфигурации ниже показан безопасный шаблон, а не настоящий секрет. Вставьте токен, который владелец проекта только что выпустил для этого пользователя и профиля.',
        actorId: 'Actor ID владельца', retryMcp: 'Запустите локальный MCP-сервис и повторите проверку.', bindingHelp: 'Project ID и пользователь фиксируются на сервере вместе с токеном. Агент не может подменить их в вызове инструмента.',
        workspaceSync: 'Синхронизация структуры чатов', workspaceSyncHelp: 'Агент получает актуальные роли, handoff-связи и bootstrap конкретного чата. В начале сессии он сравнивает checksum и обновляет инструкции только при изменении проекта.',
        workspaceRoles: 'Штаб · Автор · Главред · Арт-директор · Публикатор · Аналитик',
        mcpSetup: 'Как подключить Claude', mcpSetupFirst: 'Выберите профиль: «Штаб» для планирования, «Контент-агент» для текста или «Арт-директор» для визуала.', mcpSetupSecond: 'Скопируйте конфигурацию нужного профиля и вставьте настоящий токен вместо безопасного шаблона.', mcpSetupThird: 'В Claude откройте Settings → Connectors → Add custom connector, вставьте URL и токен. После подключения попросите агента прочитать workspace bootstrap.', mcpStarter: 'Первое сообщение агенту',
        publicationChannels: 'Каналы публикации', publicationChannelsHelp: 'Подключайте площадки и выбирайте, сколько контроля оставлять владельцу перед публикацией.',
        workflowMode: 'Режим работы', contentLanguage: 'Язык контента', russian: 'Русский', english: 'English', contentLanguageHelp: 'Язык применяется к генерации, редакторской проверке и исправлению публикаций этого канала.', prepareOnly: 'Только подготовка', approvalRequired: 'Публикация после одобрения', autoPublish: 'Автопубликация',
        prepareOnlyHelp: 'Агент готовит текст, публикация остаётся ручной.', approvalRequiredHelp: 'Агент ждёт решения владельца перед отправкой.', autoPublishHelp: 'Одобренный план может публиковаться без ручного шага.',
        afterApproval: 'После одобрения', defaultPublicationType: 'Тип публикации по умолчанию', article: 'Статья', shortPost: 'Короткий пост', channelUrl: 'URL канала', authorizedSession: 'Авторизованная сессия',
        modelCosts: 'Расходы моделей · 30 дней', calls: 'вызовов', knownCost: 'стоимость известна для', automaticTracking: 'Новые вызовы учитываются автоматически', model: 'Модель', errors: 'Ошибки', tokens: 'Токены', estimate: 'Оценка', unknownModel: 'Не зафиксирована', noRate: 'нет тарифа', noTelemetry: 'Телеметрия появится после первого вызова модели на новой версии.'
    } : {
        title: 'Project settings', intro: 'Manage the operating workspace for project', owner: 'Owner', readOnly: 'Read only',
        ownerOnly: 'Only the project owner can change settings. You can inspect the current configuration without secret values.',
        settingsSection: 'Settings section', settingsSections: 'Settings sections', project: 'Project', projectHelp: 'Core project data and planner behavior.',
        projectName: 'Project name', description: 'Description', descriptionPlaceholder: 'What this project produces and who it serves', saving: 'Saving…', save: 'Save changes',
        scheduling: 'Publication scheduling', nativeTelegram: 'Use Telegram scheduled messages', nativeTelegramHelp: 'Future publications are queued in Telegram and can go live while the planner is temporarily offline.',
        artDirection: 'Review visual need before publication', artDirectionHelp: 'The art director decides whether a visual is needed, requests a real source or sends the image to review. Handoff and publication remain blocked until explicit clearance.',
        planningHq: 'Planning HQ', planningHqHelp: 'Manages slots, channels, themes and schedule. Cannot edit publication copy.',
        contentAgent: 'Content agent', contentAgentHelp: 'Reads ready slots and fills only the copy. Cannot change dates, channels, themes or status.',
        artDirector: 'Art director', artDirectorHelp: 'Assesses visual need, creates briefs, accepts sources and reviews visuals. Cannot rewrite posts.',
        mcpTitle: 'MCP connection', mcpHelp: 'Give Codex, Claude or another agent access to the project plan, work queue and publications.',
        mcpOnline: 'MCP online', mcpOffline: 'MCP unavailable', checking: 'Checking MCP', check: 'Check', configured: 'Configured', notConfigured: 'Not configured',
        copyConfig: 'Copy configuration', copied: 'Configuration copied', tokenHelp: 'Each agent receives a separate endpoint and token. The configuration below is a safe template, not a real secret. Insert the token the project owner just issued for this user and profile.',
        actorId: 'Owner actor ID', retryMcp: 'Start the local MCP service and retry the check.', bindingHelp: 'Project ID and user identity are bound to the token on the server. Agents cannot override them in tool calls.',
        workspaceSync: 'Chat workspace synchronization', workspaceSyncHelp: 'Agents receive current roles, handoff edges and chat-specific bootstrap instructions. At session start they compare the checksum and update only when project configuration changed.',
        workspaceRoles: 'Planning HQ · Writer · Chief Editor · Art Director · Publisher · Analyst',
        mcpSetup: 'Connect Claude', mcpSetupFirst: 'Choose a profile: Planning HQ for planning, Content agent for copy, or Art director for visuals.', mcpSetupSecond: 'Copy the configuration for that profile and replace the safe template with the real token.', mcpSetupThird: 'In Claude open Settings → Connectors → Add custom connector, then provide the URL and token. After connecting, ask the agent to read the workspace bootstrap.', mcpStarter: 'First message to the agent',
        publicationChannels: 'Publishing channels', publicationChannelsHelp: 'Connect destinations and choose how much control the owner retains before publication.',
        workflowMode: 'Workflow mode', contentLanguage: 'Content language', russian: 'Russian', english: 'English', contentLanguageHelp: 'This language is used for generation, editorial review, and publication fixes for this channel.', prepareOnly: 'Prepare only', approvalRequired: 'Publish after approval', autoPublish: 'Auto-publish',
        prepareOnlyHelp: 'The agent prepares content; publishing remains manual.', approvalRequiredHelp: 'The agent waits for owner approval before sending.', autoPublishHelp: 'An approved plan may be published without another manual step.',
        afterApproval: 'After approval', defaultPublicationType: 'Default publication type', article: 'Article', shortPost: 'Short post', channelUrl: 'Channel URL', authorizedSession: 'Authorized session',
        modelCosts: 'Model costs · 30 days', calls: 'calls', knownCost: 'cost known for', automaticTracking: 'New calls are tracked automatically', model: 'Model', errors: 'Errors', tokens: 'Tokens', estimate: 'Estimate', unknownModel: 'Not recorded', noRate: 'rate unavailable', noTelemetry: 'Telemetry will appear after the first model call on the new version.'
    }
    const settingsGroups = locale === 'ru' ? SETTINGS_GROUPS : [
        { label: 'Workspace', tabs: [{ id: 'general' as const, label: 'Project', hint: 'Name and behavior', icon: 'tune' }, { id: 'channels' as const, label: 'Channels', hint: 'Platforms and modes', icon: 'campaign' }, { id: 'mcp' as const, label: 'MCP', hint: 'Agent connections', icon: 'hub' }] },
        { label: 'Intelligence', tabs: [{ id: 'keys' as const, label: 'Model keys', hint: 'AI providers', icon: 'key' }, { id: 'agents' as const, label: 'Agents', hint: 'Roles and models', icon: 'smart_toy' }, { id: 'skills' as const, label: 'Skills', hint: 'Skill connections', icon: 'extension' }] },
        { label: 'Content', tabs: [{ id: 'dictionary' as const, label: 'Rules', hint: 'Dictionary and ATOMA', icon: 'menu_book' }, { id: 'presets' as const, label: 'Presets', hint: 'Prompt templates', icon: 'text_snippet' }] },
        { label: 'Governance', tabs: [{ id: 'team' as const, label: 'Team', hint: 'Members and roles', icon: 'group' }, { id: 'history' as const, label: 'History', hint: 'Runs and errors', icon: 'history' }] }
    ]
    const queryParams = new URLSearchParams(window.location.search)
    const linkedinError = queryParams.get('error')
    const requestedTab = queryParams.get('tab')
    const initialTab: SettingsTab = requestedTab && SETTINGS_TABS.includes(requestedTab as SettingsTab)
        ? (requestedTab as SettingsTab)
        : 'general'
    const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)

    // Project State
    const [projectName, setProjectName] = useState('')
    const [projectDesc, setProjectDesc] = useState('')
    const [nativeScheduling, setNativeScheduling] = useState(false)

    // Channel State
    const [editingChannelId, setEditingChannelId] = useState<number | null>(null)
    const [editingChannelName, setEditingChannelName] = useState('')
    const [editingChannelConfig, setEditingChannelConfig] = useState<ApiJson>({})
    const [newChannelType, setNewChannelType] = useState<'telegram' | 'vk' | 'linkedin' | 'ok' | 'habr' | 'vc' | 'zen' | 'threads'>('telegram')
    const [newChannelName, setNewChannelName] = useState('')
    const [newChannelId, setNewChannelId] = useState('')
    const [newChannelUsername, setNewChannelUsername] = useState('')
    const [newChannelApiKey, setNewChannelApiKey] = useState('')
    const [newChannelWorkflowMode, setNewChannelWorkflowMode] = useState<'prepare_only' | 'approval_required' | 'auto_publish'>('approval_required')
    const [newChannelContentLanguage, setNewChannelContentLanguage] = useState<'ru' | 'en'>('ru')
    const [linkedinConnecting, setLinkedinConnecting] = useState(false)
    const [newVkStatsToken, setNewVkStatsToken] = useState('')
    const [okAppKey, setOkAppKey] = useState('')
    const [okAppSecret, setOkAppSecret] = useState('')
    const [webhookUrl, setWebhookUrl] = useState('')
    const [hubIds, setHubIds] = useState('')
    const [sessionCookies, setSessionCookies] = useState('')


    // Key State
    const [newKeyName, setNewKeyName] = useState('')
    const [newKeyValue, setNewKeyValue] = useState('')
    const [dictionaryYaml, setDictionaryYaml] = useState('')
    const [contentPolicyMatrixYaml, setContentPolicyMatrixYaml] = useState('')
    const dictionaryFileInputRef = useRef<HTMLInputElement | null>(null)
    const [atomaDescription, setAtomaDescription] = useState('')
    const [atomaPayloadText, setAtomaPayloadText] = useState('')

    const [skillConnectionName, setSkillConnectionName] = useState('')
    const [skillConnectionProvider, setSkillConnectionProvider] = useState('Anthropic')
    const [skillConnectionModel, setSkillConnectionModel] = useState('')
    const [skillConnectionKeyId, setSkillConnectionKeyId] = useState('')
    const [skillConnectionEndpointType, setSkillConnectionEndpointType] = useState('native')
    const [skillConnectionMode, setSkillConnectionMode] = useState('native_skills')
    const [skillConnectionSkills, setSkillConnectionSkills] = useState('')
    const [skillConnectionPrompt, setSkillConnectionPrompt] = useState('')
    const [skillConnectionNotes, setSkillConnectionNotes] = useState('')
    const [skillConnectionEnabled, setSkillConnectionEnabled] = useState(true)
    const [editingSkillConnectionId, setEditingSkillConnectionId] = useState<string | null>(null)

    // Member State
    const [inviteEmail, setInviteEmail] = useState('')
    const [inviteRole, setInviteRole] = useState('viewer')
    const [mcpAccessUserId, setMcpAccessUserId] = useState('')
    const [mcpAccessProfile, setMcpAccessProfile] = useState<'planner' | 'writer' | 'art_director'>('writer')
    const [mcpAccessLabel, setMcpAccessLabel] = useState('')
    const [issuedMcpToken, setIssuedMcpToken] = useState('')

    // Preset State
    const [presetName, setPresetName] = useState('')
    const [presetRole, setPresetRole] = useState('post_creator')
    const [presetPrompt, setPresetPrompt] = useState('')
    const [editingPresetId, setEditingPresetId] = useState<number | null>(null)

    // Queries
    const { data: projectData } = useQuery({
        queryKey: ['project', currentProject?.id],
        queryFn: () => api.get(`/api/projects/${currentProject?.id}`),
        enabled: !!currentProject
    })

    const defaultChannelId = (projectData as ApiJson)?.settings?.find((s: ApiJson) => s.key === 'default_channel_id')?.value;
    const artDirectionEnabled = (projectData as ApiJson)?.settings?.find((s: ApiJson) => s.key === 'art_direction_pipeline_enabled')?.value === 'true'
    const currentMembership = (projectData as ApiJson)?.members?.find((member: ApiJson) => member.user_id === user?.id || member.user?.id === user?.id)
    const isOwner = currentMembership?.role === 'owner'

    const { data: agents } = useQuery<AgentConfig[]>({
        queryKey: ['agents', currentProject?.id],
        queryFn: () => api.get('/api/settings/agents'),
        enabled: !!currentProject && activeTab === 'agents'
    })

    const { data: modelUsage } = useQuery<ModelUsageSummary>({
        queryKey: ['model-usage', currentProject?.id, 30],
        queryFn: () => api.get('/api/settings/model-usage?days=30'),
        enabled: !!currentProject && activeTab === 'agents'
    })

    const { data: keys } = useQuery<ProviderKey[]>({
        queryKey: ['keys', currentProject?.id],
        queryFn: () => keysApi.getAll(),
        enabled: !!currentProject && (activeTab === 'keys' || activeTab === 'agents' || activeTab === 'skills')
    })

    const { data: skillConnections } = useQuery<SkillConnection[]>({
        queryKey: ['skill-connections', currentProject?.id],
        queryFn: () => skillConnectionsApi.getAll(),
        enabled: !!currentProject && activeTab === 'skills'
    })

    const { data: contentDictionary } = useQuery<{ yaml: string; parsed: ApiJson; updated_at: string | null }>({
        queryKey: ['content-dictionary', currentProject?.id],
        queryFn: () => contentDictionaryApi.get(),
        enabled: !!currentProject && activeTab === 'dictionary'
    })

    const { data: contentPolicyMatrix } = useQuery<ContentPolicyMatrixResponse>({
        queryKey: ['content-policy-matrix', currentProject?.id],
        queryFn: () => contentPolicyMatrixApi.get(),
        enabled: !!currentProject && activeTab === 'dictionary'
    })

    const { data: atomaContext } = useQuery<AtomaContextResponse>({
        queryKey: ['atoma-context', currentProject?.id],
        queryFn: () => atomaContextApi.get(),
        enabled: !!currentProject && activeTab === 'dictionary'
    })

    const { data: presets } = useQuery<PromptPreset[]>({
        queryKey: ['presets', currentProject?.id],
        queryFn: () => presetsApi.getAll(),
        enabled: !!currentProject && activeTab === 'presets'
    })

    const { data: mcpStatus, isFetching: isCheckingMcp, refetch: checkMcp } = useQuery<McpStatus>({
        queryKey: ['mcp-status', currentProject?.id],
        queryFn: () => api.get(`/api/projects/${currentProject!.id}/mcp/status`),
        enabled: !!currentProject && activeTab === 'mcp',
        refetchInterval: activeTab === 'mcp' ? 15000 : false
    })

    const { data: mcpAccesses } = useQuery<{ accesses: McpAccess[] }>({
        queryKey: ['mcp-accesses', currentProject?.id],
        queryFn: () => api.get(`/api/projects/${currentProject!.id}/mcp/access-tokens`),
        enabled: !!currentProject && activeTab === 'mcp' && isOwner
    })

    const createMcpAccess = useMutation({
        mutationFn: () => api.post(`/api/projects/${currentProject!.id}/mcp/access-tokens`, {
            userId: Number(mcpAccessUserId), profile: mcpAccessProfile, label: mcpAccessLabel
        }),
        onSuccess: (result: ApiJson) => {
            setIssuedMcpToken(result.token)
            queryClient.invalidateQueries({ queryKey: ['mcp-accesses', currentProject?.id] })
        }
    })

    const revokeMcpAccess = useMutation({
        mutationFn: (tokenId: number) => api.delete(`/api/projects/${currentProject!.id}/mcp/access-tokens/${tokenId}`),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mcp-accesses', currentProject?.id] })
    })

    // Mutations
    const updateProject = useMutation({
        mutationFn: (data: { name: string; description: string }) => projectsApi.update(currentProject!.id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['project'] })
            showToast('Project updated successfully', 'success')
        }
    })

    const updateSetting = useMutation({
        mutationFn: (data: { key: string; value: string }) => api.post(`/api/projects/${currentProject!.id}/settings`, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['project'] })
        }
    })

    const resetChannelForm = () => {
        setEditingChannelId(null)
        setEditingChannelName('')
        setEditingChannelConfig({})
        setNewChannelName('')
        setNewChannelId('')
        setNewChannelUsername('')
        setNewChannelApiKey('')
        setNewVkStatsToken('')
        setSessionCookies('')
        setHubIds('')
        setWebhookUrl('')
        setOkAppKey('')
        setOkAppSecret('')
        setNewChannelWorkflowMode('approval_required')
        setNewChannelContentLanguage('ru')
    }

    const addChannel = useMutation({
        mutationFn: (data: { type: string, name: string, config: ApiJson }) => api.post(`/api/projects/${currentProject!.id}/channels`, data),
        onSuccess: () => {
            resetChannelForm()
            queryClient.invalidateQueries({ queryKey: ['project'] })
            showToast('Channel added successfully', 'success')
        },
        onError: (err: ApiJson) => showToast('Failed to add channel', 'error', err.message)
    })

    const editChannel = useMutation({
        mutationFn: (data: { id: number, name: string, config: ApiJson }) => api.put(`/api/projects/${currentProject!.id}/channels/${data.id}`, { name: data.name, config: data.config }),
        onSuccess: () => {
            resetChannelForm()
            queryClient.invalidateQueries({ queryKey: ['project'] })
            showToast('Channel updated successfully', 'success')
        },
        onError: (err: ApiJson) => showToast('Failed to update channel', 'error', err.message)
    })

    const deleteChannel = useMutation({
        mutationFn: (channelId: number) => api.delete(`/api/projects/${currentProject!.id}/channels/${channelId}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['project'] })
            showToast('Channel deleted successfully', 'success')
        },
        onError: (err: ApiJson) => showToast('Failed to delete channel', 'error', err.message)
    })

    const testChannelConnection = useMutation({
        mutationFn: (channelId: number) => projectsApi.testChannelConnection(currentProject!.id, channelId),
        onSuccess: () => showToast(locale === 'ru' ? 'Сессия Дзена активна, редактор доступен' : 'Zen session is active and the editor is available', 'success'),
        onError: (err: ApiJson) => showToast(locale === 'ru' ? 'Не удалось подключиться к Дзену' : 'Could not connect to Zen', 'error', err.message)
    })

    // Note: Delete channel endpoint might need to be added or we just hide it?
    // Reviewing api routes: we don't have a specific delete channel route in project.routes.ts...
    // Wait, let's check if we can delete. 
    // We didn't add a delete route in project.routes.ts.
    // I should probably add it or just allow adding for now.
    // The user asked for "visual binding", adding is most important. 
    // I can add delete logic to `project.routes.ts` quickly if needed, but let's stick to adding first.

    const addKey = useMutation({
        mutationFn: (data: { name: string; key: string }) => keysApi.create(data),
        onSuccess: () => {
            setNewKeyName('')
            setNewKeyValue('')
            queryClient.invalidateQueries({ queryKey: ['keys'] })
        }
    })

    const deleteKey = useMutation({
        mutationFn: (id: number) => keysApi.delete(id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['keys'] })
    })

    const saveSkillConnections = useMutation({
        mutationFn: (connections: SkillConnection[]) => skillConnectionsApi.saveAll(connections),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['skill-connections'] })
            showToast('Skill connections saved successfully', 'success')
        },
        onError: (err: ApiJson) => showToast('Failed to save skill connections', 'error', err.message)
    })

    const saveContentDictionary = useMutation({
        mutationFn: (yaml: string) => contentDictionaryApi.save(yaml),
        onSuccess: (result: ApiJson) => {
            setDictionaryYaml(result.yaml)
            queryClient.invalidateQueries({ queryKey: ['content-dictionary'] })
            showToast('Content dictionary saved successfully', 'success')
        },
        onError: (err: ApiJson) => showToast('Failed to save content dictionary', 'error', err.message)
    })

    const saveContentPolicyMatrix = useMutation({
        mutationFn: (yaml: string) => contentPolicyMatrixApi.save(yaml),
        onSuccess: (result: ApiJson) => {
            setContentPolicyMatrixYaml(result.yaml)
            queryClient.invalidateQueries({ queryKey: ['content-policy-matrix'] })
            showToast('Content policy matrix saved successfully', 'success')
        },
        onError: (err: ApiJson) => showToast('Failed to save content policy matrix', 'error', err.message)
    })

    const saveAtomaContext = useMutation({
        mutationFn: (data: { description: string; payloadText: string }) => atomaContextApi.save(data),
        onSuccess: (result: AtomaContextResponse) => {
            setAtomaDescription(result.description || '')
            setAtomaPayloadText(result.payload_text || '')
            queryClient.invalidateQueries({ queryKey: ['atoma-context'] })
            showToast('ATOMA context saved successfully', 'success')
        },
        onError: (err: ApiJson) => showToast('Failed to save ATOMA context', 'error', err.message)
    })

    const updateAgent = useMutation({
        mutationFn: (data: { role: string; prompt: string; apiKey: string; model: string }) =>
            api.put(`/api/settings/agents/${data.role}`, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['agents'] })
            showToast('Agent configuration saved successfully', 'success')
        }
    })

    const addMember = useMutation({
        mutationFn: (data: { email: string; role: string }) => projectsApi.addMember(currentProject!.id, data.email, data.role),
        onSuccess: () => {
            setInviteEmail('')
            queryClient.invalidateQueries({ queryKey: ['project'] })
            showToast('Member added successfully', 'success')
        },
        onError: (err: ApiJson) => showToast('Failed to add member', 'error', err.message)
    })

    const removeMember = useMutation({
        mutationFn: (userId: number) => projectsApi.removeMember(currentProject!.id, userId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['project'] })
            showToast('Member removed successfully', 'success')
        }
    })

    const createPreset = useMutation({
        mutationFn: (data: { name: string; role: string; prompt_text: string }) => presetsApi.create(data),
        onSuccess: () => {
            setPresetName('')
            setPresetPrompt('')
            queryClient.invalidateQueries({ queryKey: ['presets'] })
        }
    })

    const updatePreset = useMutation({
        mutationFn: (data: { id: number; name: string; role: string; prompt_text: string }) =>
            presetsApi.update(data.id, { name: data.name, role: data.role, prompt_text: data.prompt_text }),
        onSuccess: () => {
            setEditingPresetId(null)
            setPresetName('')
            setPresetPrompt('')
            queryClient.invalidateQueries({ queryKey: ['presets'] })
        }
    })

    const deletePreset = useMutation({
        mutationFn: (id: number) => presetsApi.delete(id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['presets'] })
    })

    // Effects
    useEffect(() => {
        if (projectData && activeTab === 'general') {
            setProjectName(projectData.name)
            setProjectDesc(projectData.description || '')
            const settings = (projectData as ApiJson).settings || []
            const native = settings.find((s: ApiJson) => s.key === 'telegram_native_scheduling')
            setNativeScheduling(native?.value === 'true')
        }
    }, [projectData, activeTab])

    useEffect(() => {
        if (contentDictionary && activeTab === 'dictionary') {
            setDictionaryYaml(contentDictionary.yaml || '')
        }
    }, [contentDictionary, activeTab])

    useEffect(() => {
        if (contentPolicyMatrix && activeTab === 'dictionary') {
            setContentPolicyMatrixYaml(contentPolicyMatrix.yaml || '')
        }
    }, [contentPolicyMatrix, activeTab])

    useEffect(() => {
        if (atomaContext && activeTab === 'dictionary') {
            setAtomaDescription(atomaContext.description || '')
            setAtomaPayloadText(atomaContext.payload_text || '')
        }
    }, [atomaContext, activeTab])



    const handleSavePreset = () => {
        if (!presetName || !presetPrompt) return
        if (editingPresetId) {
            updatePreset.mutate({ id: editingPresetId, name: presetName, role: presetRole, prompt_text: presetPrompt })
        } else {
            createPreset.mutate({ name: presetName, role: presetRole, prompt_text: presetPrompt })
        }
    }

    const startEditPreset = (p: PromptPreset) => {
        setEditingPresetId(p.id)
        setPresetName(p.name)
        setPresetRole(p.role)
        setPresetPrompt(p.prompt_text)
    }

    const cancelEditPreset = () => {
        setEditingPresetId(null)
        setPresetName('')
        setPresetPrompt('')
    }

    const handleDictionaryFileUpload = (file: File | null) => {
        if (!file) return

        const normalizedName = file.name.toLowerCase()
        if (!normalizedName.endsWith('.yaml') && !normalizedName.endsWith('.yml')) {
            showToast('Choose a .yaml or .yml glossary file', 'warning')
            return
        }

        const reader = new FileReader()
        reader.onload = () => {
            const text = typeof reader.result === 'string' ? reader.result : ''
            setDictionaryYaml(text)
        }
        reader.onerror = () => {
            showToast('Failed to read glossary file', 'error')
        }
        reader.readAsText(file)
    }


    const handleLinkedInConnect = async () => {
        if (!currentProject?.id || !token) return showToast('Authentication required', 'error')
        setLinkedinConnecting(true)
        try {
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3003'
            const response = await fetch(`${apiBase}/api/auth/linkedin/connect?projectId=${currentProject.id}`, {
                headers: { Authorization: `Bearer ${token}` }
            })
            const result = await response.json()
            if (!response.ok || !result.url) throw new Error(result.error || 'LinkedIn connection failed')
            window.location.assign(result.url)
        } catch (error) {
            showToast(
                locale === 'ru' ? 'Не удалось начать подключение LinkedIn' : 'Could not start LinkedIn connection',
                'error',
                error instanceof Error ? error.message : undefined
            )
            setLinkedinConnecting(false)
        }
    }

    const handleAddChannel = () => {
        if (!newChannelName) return showToast('Channel Name is required', 'warning');
        if (newChannelType !== 'habr' && !newChannelId) return showToast('Channel ID is required', 'warning');

        const config: ApiJson = { workflow_mode: newChannelWorkflowMode, content_language: newChannelContentLanguage };
        if (newChannelType === 'telegram') {
            config.telegram_channel_id = newChannelId;
            if (newChannelUsername) {
                config.channel_username = newChannelUsername.startsWith('@')
                    ? newChannelUsername
                    : `@${newChannelUsername}`;
            }
        } else if (newChannelType === 'vk') {
            if (!newChannelApiKey) return showToast('VK requires a publication access token', 'warning');
            config.vk_id = newChannelId;
            config.publish_access_token = newChannelApiKey;
            if (newVkStatsToken) config.stats_access_token = newVkStatsToken;
            config.analytics_enabled = Boolean(newVkStatsToken);
            config.api_version = '5.199';
        } else if (newChannelType === 'ok') {
            if (!newChannelApiKey) return showToast('Access Token is required', 'warning');
            if (!okAppKey) return showToast('Application Key is required', 'warning');
            if (!okAppSecret) return showToast('Application Secret Key is required', 'warning');
            config.group_id = newChannelId;
            config.access_token = newChannelApiKey;
            config.application_key = okAppKey;
            config.application_secret_key = okAppSecret;
        } else if (newChannelType === 'habr') {
            config.hub_ids = hubIds ? hubIds.split(',').map((s: string) => s.trim()) : [];
            if (newChannelApiKey) config.api_token = newChannelApiKey;
            if (webhookUrl) config.webhook_url = webhookUrl;
            if (sessionCookies) config.cookies = sessionCookies;
            config.telegram_channel_id = newChannelId || 'habr-channel';
        } else if (newChannelType === 'vc') {
            config.subsite_id = newChannelId;
            if (newChannelApiKey) config.access_token = newChannelApiKey;
            if (webhookUrl) config.webhook_url = webhookUrl;
            config.vk_id = newChannelId;
        } else if (newChannelType === 'zen') {
            config.channel_id = newChannelId;
            if (sessionCookies) config.cookies = sessionCookies;
            config.default_publication_type = 'article';
            config.vk_id = newChannelId;
        } else if (newChannelType === 'threads') {
            if (!newChannelApiKey) return showToast('Access Token is required', 'warning');
            config.threads_user_id = newChannelId;
            config.access_token = newChannelApiKey;
        }

        addChannel.mutate({
            type: newChannelType,
            name: newChannelName,
            config
        });
    }

    const handleStartEditChannel = (channel: ApiJson) => {
        setEditingChannelId(channel.id);
        setEditingChannelName(channel.name);
        setEditingChannelConfig(channel.config ? JSON.parse(JSON.stringify(channel.config)) : {});
    }

    const resetSkillConnectionForm = () => {
        setEditingSkillConnectionId(null)
        setSkillConnectionName('')
        setSkillConnectionProvider('Anthropic')
        setSkillConnectionModel('')
        setSkillConnectionKeyId('')
        setSkillConnectionEndpointType('native')
        setSkillConnectionMode('native_skills')
        setSkillConnectionSkills('')
        setSkillConnectionPrompt('')
        setSkillConnectionNotes('')
        setSkillConnectionEnabled(true)
    }

    const handleSaveSkillConnection = () => {
        if (!skillConnectionName || !skillConnectionModel) return

        const nextConnection: SkillConnection = {
            id: editingSkillConnectionId || `skill-${Date.now()}`,
            name: skillConnectionName,
            provider: skillConnectionProvider,
            model: skillConnectionModel,
            providerKeyId: skillConnectionKeyId ? parseInt(skillConnectionKeyId, 10) : null,
            endpointType: skillConnectionEndpointType,
            skillMode: skillConnectionMode,
            enabledSkills: skillConnectionSkills
                .split(',')
                .map(skill => skill.trim())
                .filter(Boolean),
            systemPrompt: skillConnectionPrompt,
            notes: skillConnectionNotes,
            enabled: skillConnectionEnabled,
            supportsSkills: true
        }

        const nextConnections = editingSkillConnectionId
            ? (skillConnections || []).map(connection => connection.id === editingSkillConnectionId ? nextConnection : connection)
            : [...(skillConnections || []), nextConnection]

        saveSkillConnections.mutate(nextConnections)
        resetSkillConnectionForm()
    }

    const handleEditSkillConnection = (connection: SkillConnection) => {
        setEditingSkillConnectionId(connection.id)
        setSkillConnectionName(connection.name)
        setSkillConnectionProvider(connection.provider)
        setSkillConnectionModel(connection.model)
        setSkillConnectionKeyId(connection.providerKeyId ? String(connection.providerKeyId) : '')
        setSkillConnectionEndpointType(connection.endpointType || 'native')
        setSkillConnectionMode(connection.skillMode || 'native_skills')
        setSkillConnectionSkills((connection.enabledSkills || []).join(', '))
        setSkillConnectionPrompt(connection.systemPrompt || '')
        setSkillConnectionNotes(connection.notes || '')
        setSkillConnectionEnabled(connection.enabled !== false)
    }

    const handleDeleteSkillConnection = (id: string) => {
        const nextConnections = (skillConnections || []).filter(connection => connection.id !== id)
        saveSkillConnections.mutate(nextConnections)
    }

    const { data: runs } = useQuery<ApiJson[]>({
        queryKey: ['runs', currentProject?.id],
        queryFn: () => api.get('/api/settings/runs'),
        enabled: !!currentProject && activeTab === 'history'
    })

    const RunRow = ({ run }: { run: ApiJson }) => {
        const [expanded, setExpanded] = useState(false)
        return (
            <div style={{ borderBottom: '1px solid var(--border)', padding: '1rem 0' }}>
                <div className="flex-between mb-1" style={{ cursor: 'pointer' }} onClick={() => setExpanded(!expanded)}>
                    <div>
                        <span className={`badge badge-${run.status === 'success' ? 'generated' : 'error'}`} style={{ marginRight: '0.5rem' }}>
                            {run.status || 'unknown'}
                        </span>
                        <strong>{run.agent_role || run.type || 'Unknown Agent'}</strong>
                        <span className="text-muted ml-1" style={{ fontSize: '0.8rem' }}>
                            {new Date(run.created_at).toLocaleString()}
                        </span>
                    </div>
                    <div className="text-muted" style={{ fontSize: '1.2rem' }}>{expanded ? '−' : '+'}</div>
                </div>
                {expanded && (
                    <div className="grid-2 mt-2" style={{ gap: '1rem', background: 'var(--bg-tertiary)', padding: '1rem', borderRadius: '8px' }}>
                        <div>
                            <strong>Input / Prompt</strong>
                            <div style={{
                                whiteSpace: 'pre-wrap',
                                fontFamily: 'monospace',
                                fontSize: '0.8rem',
                                maxHeight: '300px',
                                overflowY: 'auto',
                                background: 'var(--bg-secondary)',
                                padding: '0.5rem',
                                borderRadius: '4px'
                            }}>
                                {run.input || run.prompt || '(No input logged)'}
                            </div>
                        </div>
                        <div>
                            <strong>Output / Response</strong>
                            <div style={{
                                whiteSpace: 'pre-wrap',
                                fontFamily: 'monospace',
                                fontSize: '0.8rem',
                                maxHeight: '300px',
                                overflowY: 'auto',
                                background: 'var(--bg-secondary)',
                                padding: '0.5rem',
                                borderRadius: '4px'
                            }}>
                                {run.output || run.error || '(No output logged)'}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        )
    }

    if (!currentProject) {
        return (
            <div className="container">
                <div className="card text-center p-3">
                    <h2>No Project Selected</h2>
                    <p className="text-muted">Please select a project to configure settings.</p>
                </div>
            </div>
        )
    }

    return (
        <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
            <div className="mb-7 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-3xl font-headline font-black tracking-tight text-on-surface">{copy.title}</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-on-surface-variant">
                        {copy.intro} “{currentProject.name}”.
                    </p>
                </div>
                <span className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black ${isOwner ? 'bg-success/10 text-success' : 'bg-surface-container-high text-on-surface-variant'}`}>
                    <span className="material-symbols-outlined text-base" aria-hidden="true">{isOwner ? 'verified_user' : 'visibility'}</span>
                    {isOwner ? copy.owner : copy.readOnly}
                </span>
            </div>

            {!isOwner && projectData && (
                <div className="mb-5 rounded-2xl bg-surface-container-low px-4 py-3 text-sm leading-6 text-on-surface-variant">
                    {copy.ownerOnly}
                </div>
            )}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
                <label className="block lg:hidden">
                    <span className="mb-2 block text-sm font-bold text-on-surface">{copy.settingsSection}</span>
                    <select className="w-full" value={activeTab} onChange={(event) => setActiveTab(event.target.value as SettingsTab)}>
                        {settingsGroups.flatMap((group) => group.tabs).map((tab) => <option key={tab.id} value={tab.id}>{tab.label} — {tab.hint}</option>)}
                    </select>
                </label>
                <nav aria-label={copy.settingsSections} className="hidden rounded-2xl bg-surface-container-low p-2 lg:sticky lg:top-6 lg:block">
                    {settingsGroups.map((group) => (
                        <div key={group.label} className="mb-3 last:mb-0">
                            <div className="px-3 pb-1 pt-2 text-[11px] font-black uppercase tracking-[0.16em] text-on-surface-variant">{group.label}</div>
                            {group.tabs.map((tab) => (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setActiveTab(tab.id)}
                                    aria-current={activeTab === tab.id ? 'page' : undefined}
                                    className={`mb-1 flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${activeTab === tab.id ? 'bg-white text-primary shadow-sm' : 'text-on-surface hover:bg-white/70'}`}
                                >
                                    <span className="material-symbols-outlined text-xl" aria-hidden="true">{tab.icon}</span>
                                    <span className="min-w-0"><span className="block text-sm font-black">{tab.label}</span><span className="block truncate text-xs font-normal text-on-surface-variant">{tab.hint}</span></span>
                                </button>
                            ))}
                        </div>
                    ))}
                </nav>

                <fieldset disabled={!isOwner} className="min-w-0 border-0 p-0 disabled:opacity-75">

            {activeTab === 'general' && (
                <div className="rounded-2xl bg-white p-5 shadow-sm sm:p-7">
                    <div className="mb-6">
                        <h2 className="text-2xl font-headline font-black text-on-surface">{copy.project}</h2>
                        <p className="mt-2 text-sm leading-6 text-on-surface-variant">{copy.projectHelp}</p>
                    </div>
                    <div className="max-w-2xl space-y-5">
                        <label className="block">
                            <span className="text-sm font-bold text-on-surface">{copy.projectName}</span>
                            <input className="mt-2 w-full" value={projectName} onChange={e => setProjectName(e.target.value)} />
                        </label>
                        <label className="block">
                            <span className="text-sm font-bold text-on-surface">{copy.description}</span>
                            <textarea className="mt-2 w-full" value={projectDesc} onChange={e => setProjectDesc(e.target.value)} rows={4} placeholder={copy.descriptionPlaceholder} />
                        </label>
                        <button className="btn-primary" onClick={() => updateProject.mutate({ name: projectName, description: projectDesc })} disabled={!projectName.trim() || updateProject.isPending}>
                            {updateProject.isPending ? copy.saving : copy.save}
                        </button>
                    </div>

                    <div className="mt-8 border-t border-outline-variant/10 pt-6">
                        <h3 className="text-lg font-black text-on-surface">{copy.scheduling}</h3>
                        <label htmlFor="nativeScheduling" className="mt-4 flex max-w-2xl cursor-pointer items-start gap-3 rounded-2xl bg-surface-container-low p-4">
                            <input
                                type="checkbox"
                                id="nativeScheduling"
                                checked={nativeScheduling}
                                onChange={e => {
                                    setNativeScheduling(e.target.checked)
                                    updateSetting.mutate({ key: 'telegram_native_scheduling', value: e.target.checked.toString() })
                                }}
                                className="mt-1 h-5 w-5 accent-primary"
                            />
                            <span>
                                <strong className="block text-sm text-on-surface">{copy.nativeTelegram}</strong>
                                <p className="mt-1 text-sm leading-6 text-on-surface-variant">
                                    {copy.nativeTelegramHelp}
                                </p>
                            </span>
                        </label>
                        <label htmlFor="artDirectionPipeline" className="mt-4 flex max-w-2xl cursor-pointer items-start gap-3 rounded-2xl bg-surface-container-low p-4">
                            <input
                                type="checkbox"
                                id="artDirectionPipeline"
                                checked={artDirectionEnabled}
                                onChange={event => updateSetting.mutate({ key: 'art_direction_pipeline_enabled', value: String(event.target.checked) })}
                                className="mt-1 h-5 w-5 accent-primary"
                            />
                            <span>
                                <strong className="block text-sm text-on-surface">{copy.artDirection}</strong>
                                <p className="mt-1 text-sm leading-6 text-on-surface-variant">
                                    {copy.artDirectionHelp}
                                </p>
                            </span>
                        </label>
                    </div>
                </div>
            )}

            {activeTab === 'mcp' && (() => {
                const mcpUrl = mcpStatus?.endpoint || import.meta.env.VITE_MCP_URL || 'http://127.0.0.1:8080/mcp'
                const capabilityCards = [
                    {
                        id: 'planner',
                        title: copy.planningHq,
                        description: copy.planningHqHelp,
                        icon: 'calendar_month',
                        endpoint: mcpStatus?.capability_endpoints?.planner.endpoint || `${mcpUrl}/planner`,
                        configured: mcpStatus?.capability_endpoints?.planner.configured ?? false,
                        token: '<MCP_PLANNER_AUTH_TOKEN>'
                    },
                    {
                        id: 'writer',
                        title: copy.contentAgent,
                        description: copy.contentAgentHelp,
                        icon: 'edit_note',
                        endpoint: mcpStatus?.capability_endpoints?.writer.endpoint || `${mcpUrl}/writer`,
                        configured: mcpStatus?.capability_endpoints?.writer.configured ?? false,
                        token: '<MCP_WRITER_AUTH_TOKEN>'
                    },
                    {
                        id: 'art-director',
                        title: copy.artDirector,
                        description: copy.artDirectorHelp,
                        icon: 'art_track',
                        endpoint: mcpStatus?.capability_endpoints?.art_director?.endpoint || `${mcpUrl}/art-director`,
                        configured: mcpStatus?.capability_endpoints?.art_director?.configured ?? false,
                        token: '<MCP_ART_DIRECTOR_AUTH_TOKEN>'
                    }
                ]
                const isMcpOnline = mcpStatus?.status === 'online'
                return (
                    <div className="rounded-2xl bg-white p-5 shadow-sm sm:p-7">
                        <div className="flex flex-col gap-4 border-b border-outline-variant/10 pb-6 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <h2 className="text-2xl font-headline font-black text-on-surface">{copy.mcpTitle}</h2>
                                <p className="mt-2 max-w-2xl text-sm leading-6 text-on-surface-variant">{copy.mcpHelp}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black ${isMcpOnline ? 'bg-success/10 text-success' : 'bg-error-container/40 text-error'}`}><span className={`h-2 w-2 rounded-full ${isMcpOnline ? 'bg-success' : 'bg-error'}`} />{isMcpOnline ? copy.mcpOnline : mcpStatus ? copy.mcpOffline : copy.checking}</span>
                                <button type="button" className="btn-secondary" onClick={() => checkMcp()} disabled={isCheckingMcp}>{isCheckingMcp ? `${copy.checking}…` : copy.check}</button>
                            </div>
                        </div>

                        <div className="mt-6 space-y-6">
                            {isOwner && (
                                <section className="rounded-2xl bg-surface-container-low p-4 sm:p-5">
                                    <h3 className="font-black text-on-surface">{locale === 'ru' ? 'Персональные доступы' : 'Personal access'}</h3>
                                    <p className="mt-1 text-sm text-on-surface-variant">{locale === 'ru' ? 'Выдавайте и отзывайте доступ без изменения Railway.' : 'Issue and revoke access without changing Railway.'}</p>
                                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                                        <select value={mcpAccessUserId} onChange={event => setMcpAccessUserId(event.target.value)}>
                                            <option value="">{locale === 'ru' ? 'Участник проекта' : 'Project member'}</option>
                                            {(projectData as ApiJson)?.members?.map((member: ApiJson) => <option key={member.user_id} value={member.user_id}>{member.user?.name || member.user?.email}</option>)}
                                        </select>
                                        <select value={mcpAccessProfile} onChange={event => setMcpAccessProfile(event.target.value as typeof mcpAccessProfile)}>
                                            <option value="planner">Planner</option><option value="writer">Writer</option><option value="art_director">Art director</option>
                                        </select>
                                        <input value={mcpAccessLabel} onChange={event => setMcpAccessLabel(event.target.value)} placeholder={locale === 'ru' ? 'Например: Claude на ноутбуке' : 'For example: Claude on laptop'} />
                                    </div>
                                    <button type="button" className="btn-primary mt-3" disabled={!mcpAccessUserId || createMcpAccess.isPending} onClick={() => createMcpAccess.mutate()}>{locale === 'ru' ? 'Создать доступ' : 'Create access'}</button>
                                    {issuedMcpToken && <div className="mt-4 rounded-xl border border-warning/30 bg-white p-3"><div className="text-xs font-black text-warning">{locale === 'ru' ? 'Скопируйте сейчас: повторно токен не показывается' : 'Copy now: this token will not be shown again'}</div><code className="mt-2 block break-all text-xs">{issuedMcpToken}</code><button className="btn-secondary mt-2" onClick={() => navigator.clipboard.writeText(issuedMcpToken)}>{copy.copyConfig}</button></div>}
                                    <div className="mt-4 space-y-2">
                                        {(mcpAccesses?.accesses || []).map(access => <div key={access.id} className="flex items-center justify-between gap-3 rounded-xl bg-white p-3"><div><div className="text-sm font-bold">{access.label} · {access.profile}</div><div className="text-xs text-on-surface-variant">{access.user.name || access.user.email}{access.revoked_at ? ` · ${locale === 'ru' ? 'отозван' : 'revoked'}` : ''}</div></div>{!access.revoked_at && <button className="text-xs font-bold text-error" onClick={() => revokeMcpAccess.mutate(access.id)}>{locale === 'ru' ? 'Отозвать' : 'Revoke'}</button>}</div>)}
                                    </div>
                                </section>
                            )}
                            <section className="rounded-2xl border border-primary/15 bg-primary/5 p-4 sm:p-5">
                                <div className="flex items-start gap-3">
                                    <span className="material-symbols-outlined text-primary" aria-hidden="true">rocket_launch</span>
                                    <div>
                                        <h3 className="font-black text-on-surface">{copy.mcpSetup}</h3>
                                        <ol className="mt-3 space-y-2 text-sm leading-6 text-on-surface-variant">
                                            <li>1. {copy.mcpSetupFirst}</li>
                                            <li>2. {copy.mcpSetupSecond}</li>
                                            <li>3. {copy.mcpSetupThird}</li>
                                        </ol>
                                        <div className="mt-4 rounded-xl bg-white p-3">
                                            <div className="text-xs font-black uppercase tracking-wider text-primary">{copy.mcpStarter}</div>
                                            <p className="mt-1 text-sm leading-6 text-on-surface-variant">{locale === 'ru' ? 'Прочитай bootstrap рабочей области, назови доступные инструменты и предложи следующий безопасный шаг для проекта.' : 'Read the workspace bootstrap, list your available tools, and propose the next safe step for this project.'}</p>
                                        </div>
                                    </div>
                                </div>
                            </section>
                            <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
                                {capabilityCards.map((capability) => {
                                    const config = JSON.stringify({
                                        mcpServers: {
                                            [`contentops-studio-${capability.id}`]: {
                                                url: capability.endpoint,
                                                headers: { Authorization: `Bearer ${capability.token}` }
                                            }
                                        }
                                    }, null, 2)
                                    return (
                                        <section key={capability.id} className="rounded-2xl bg-surface-container-low p-4 sm:p-5">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex min-w-0 items-start gap-3">
                                                    <span className="material-symbols-outlined mt-0.5 text-primary" aria-hidden="true">{capability.icon}</span>
                                                    <div>
                                                        <h3 className="font-black text-on-surface">{capability.title}</h3>
                                                        <p className="mt-1 text-xs leading-5 text-on-surface-variant">{capability.description}</p>
                                                    </div>
                                                </div>
                                                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${capability.configured ? 'bg-success/10 text-success' : 'bg-surface-container-high text-on-surface-variant'}`}>
                                                    {capability.configured ? copy.configured : copy.notConfigured}
                                                </span>
                                            </div>
                                            <pre className="mt-4 max-h-52 overflow-auto rounded-xl bg-[#17181a] p-3 text-xs leading-5 text-white"><code>{config}</code></pre>
                                            <button type="button" className="btn-secondary mt-3 w-full" onClick={() => navigator.clipboard.writeText(config).then(() => showToast(`${copy.copied}: ${capability.title}`, 'success'))}>{copy.copyConfig}</button>
                                        </section>
                                    )
                                })}
                                <p className="text-xs leading-5 text-on-surface-variant lg:col-span-2">{copy.tokenHelp}</p>
                            </div>
                            <section className="rounded-2xl border border-primary/15 bg-primary/5 p-4 sm:p-5">
                                <div className="flex items-start gap-3">
                                    <span className="material-symbols-outlined text-primary" aria-hidden="true">account_tree</span>
                                    <div>
                                        <h3 className="font-black text-on-surface">{copy.workspaceSync}</h3>
                                        <p className="mt-1 text-sm leading-6 text-on-surface-variant">{copy.workspaceSyncHelp}</p>
                                        <p className="mt-3 text-xs font-bold text-primary">{copy.workspaceRoles}</p>
                                    </div>
                                </div>
                                <div className="mt-4 grid gap-2 text-xs font-mono text-on-surface sm:grid-cols-3">
                                    <code className="rounded-xl bg-white px-3 py-2">ba_get_agent_workspace_manifest</code>
                                    <code className="rounded-xl bg-white px-3 py-2">ba_get_agent_workspace_updates</code>
                                    <code className="rounded-xl bg-white px-3 py-2">ba_get_agent_chat_bootstrap</code>
                                </div>
                            </section>
                            <div className="grid grid-cols-1 gap-4 rounded-2xl bg-surface-container-low p-4 sm:grid-cols-2 xl:grid-cols-4">
                                <div><div className="text-xs text-on-surface-variant">{copy.project}</div><div className="mt-1 font-black text-on-surface">{currentProject.name}</div></div>
                                <div><div className="text-xs text-on-surface-variant">Project ID</div><div className="mt-1 font-black tabular-nums text-on-surface">{currentProject.id}</div></div>
                                <div><div className="text-xs text-on-surface-variant">{copy.actorId}</div><div className="mt-1 font-black text-on-surface">user:{user?.id}</div></div>
                                <div><div className="text-xs text-on-surface-variant">Endpoint</div><div className="mt-1 break-all text-sm font-bold text-on-surface">{mcpUrl}</div></div>
                                {mcpStatus?.message && <div className="rounded-xl bg-error-container/30 p-3 text-xs leading-5 text-error sm:col-span-2 xl:col-span-4">{mcpStatus.message}. {copy.retryMcp}</div>}
                                <div className="border-t border-outline-variant/10 pt-4 text-xs leading-5 text-on-surface-variant sm:col-span-2 xl:col-span-4">{copy.bindingHelp}</div>
                            </div>
                        </div>
                    </div>
                )
            })()}

            {activeTab === 'channels' && (
                <div className="rounded-2xl bg-white p-5 shadow-sm sm:p-7">
                    <h2 className="text-2xl font-headline font-black text-on-surface">{copy.publicationChannels}</h2>
                    <p className="mb-6 mt-2 text-sm leading-6 text-on-surface-variant">{copy.publicationChannelsHelp}</p>

                    <div className="mb-3 p-2" style={{ border: '1px solid var(--border)', borderRadius: '8px' }}>
                        <div className="flex-between mb-3">
                            <h3 style={{ margin: 0 }}>Add Channel</h3>
                            <select value={newChannelType} onChange={(e: ApiJson) => {
                                const nextType = e.target.value;
                                setNewChannelType(nextType);
                                if (nextType === 'zen') setNewChannelWorkflowMode('auto_publish');
                            }}>
                                <option value="telegram">Telegram</option>
                                <option value="vk">VKontakte (VK)</option>
                                <option value="linkedin">LinkedIn</option>
                                <option value="ok">Odnoklassniki (OK)</option>
                                <option value="habr">Habr</option>
                                <option value="vc">VC.ru</option>
                                <option value="zen">Zen (Dzen)</option>
                                <option value="threads">Threads</option>
                            </select>
                        </div>

                        <div className="grid-2" style={{ gap: '1rem' }}>
                            <div>
                                <label>Channel Name (Internal)</label>
                                <input
                                    placeholder="e.g. My Tech Blog"
                                    value={newChannelName}
                                    onChange={e => setNewChannelName(e.target.value)}
                                />
                            </div>
                            <div>
                                <label>{copy.workflowMode}</label>
                                <select value={newChannelWorkflowMode} onChange={(e) => setNewChannelWorkflowMode(e.target.value as typeof newChannelWorkflowMode)}>
                                    <option value="prepare_only">{copy.prepareOnly}</option>
                                    <option value="approval_required">{copy.approvalRequired}</option>
                                    <option value="auto_publish">{copy.autoPublish}</option>
                                </select>
                                <p className="mt-1 text-xs leading-5 text-on-surface-variant">
                                    {newChannelWorkflowMode === 'prepare_only' ? copy.prepareOnlyHelp : newChannelWorkflowMode === 'approval_required' ? copy.approvalRequiredHelp : copy.autoPublishHelp}
                                </p>
                            </div>
                            <div>
                                <label>{copy.contentLanguage}</label>
                                <select value={newChannelContentLanguage} onChange={(e) => setNewChannelContentLanguage(e.target.value as 'ru' | 'en')}>
                                    <option value="ru">{copy.russian}</option>
                                    <option value="en">{copy.english}</option>
                                </select>
                                <p className="mt-1 text-xs leading-5 text-on-surface-variant">{copy.contentLanguageHelp}</p>
                            </div>

                            {newChannelType === 'telegram' ? (
                                <>
                                    <div>
                                        <label>Channel ID (starts with -100) or Chat ID</label>
                                        <input
                                            placeholder="-100..."
                                            value={newChannelId}
                                            onChange={e => setNewChannelId(e.target.value)}
                                        />
                                        {newChannelId && !newChannelId.startsWith('-100') && (
                                            <div className="text-xs text-rose-500 mt-1 font-semibold">
                                                ⚠️ Telegram channel IDs usually start with -100
                                            </div>
                                        )}
                                    </div>
                                    <div>
                                        <label>Username (Optional, for links)</label>
                                        <input
                                            placeholder="my_channel"
                                            value={newChannelUsername}
                                            onChange={e => setNewChannelUsername(e.target.value)}
                                        />
                                        {newChannelUsername && !newChannelUsername.startsWith('@') && (
                                            <div className="text-xs text-amber-500 mt-1 font-semibold">
                                                💡 Will be auto-normalized to include @ prefix
                                            </div>
                                        )}
                                    </div>
                                    <TelegramConnectionGuide locale={locale} channelId={newChannelId} />
                                </>
                            ) : newChannelType === 'vk' ? (
                                <>
                                    <div>
                                        <label>VK Group/Community ID</label>
                                        <input
                                            placeholder="-123456789"
                                            value={newChannelId}
                                            onChange={e => setNewChannelId(e.target.value)}
                                            title="Use negative number for communities. Find it in group URL or settings."
                                        />
                                        {newChannelId && !newChannelId.startsWith('-') && (
                                            <div className="text-xs text-rose-500 mt-1 font-semibold">
                                                ⚠️ VK Group IDs must be negative (start with -)
                                            </div>
                                        )}
                                    </div>
                                    <div>
                                        <label>Community publication token</label>
                                        <input
                                            type="password"
                                            placeholder="vk1.a.xxxx..."
                                            value={newChannelApiKey}
                                            onChange={e => setNewChannelApiKey(e.target.value)}
                                        />
                                        <div className="text-xs text-on-surface-variant mt-1">
                                            {locale === 'ru' ? 'Используется для публикации и чтения публичных счётчиков записи.' : 'Used for publishing and reading public post counters.'}
                                        </div>
                                    </div>
                                    <div style={{ gridColumn: '1 / -1' }}>
                                        <label>User statistics token (Optional)</label>
                                        <input
                                            type="password"
                                            placeholder={locale === 'ru' ? 'Токен пользователя с доступом к статистике сообщества' : 'User token with access to community statistics'}
                                            value={newVkStatsToken}
                                            onChange={e => setNewVkStatsToken(e.target.value)}
                                        />
                                        <div className="text-xs text-on-surface-variant mt-1">
                                            {locale === 'ru' ? 'Нужен для охватов, переходов, вступлений, скрытий, жалоб и отписок через stats.getPostReach.' : 'Required for reach, clicks, joins, hides, reports, and unfollows through stats.getPostReach.'}
                                        </div>
                                    </div>
                                    <VkConnectionGuide
                                        locale={locale}
                                        vkId={newChannelId}
                                        publicationToken={newChannelApiKey}
                                    />
                                </>
                            ) : newChannelType === 'ok' ? (
                                <>
                                    <div>
                                        <label>OK Group ID</label>
                                        <input
                                            placeholder="e.g. 523456789"
                                            value={newChannelId}
                                            onChange={e => setNewChannelId(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label>Access Token</label>
                                        <input
                                            type="password"
                                            placeholder="Token..."
                                            value={newChannelApiKey}
                                            onChange={e => setNewChannelApiKey(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label>Application Key (App Key)</label>
                                        <input
                                            placeholder="CBAxxxx..."
                                            value={okAppKey}
                                            onChange={e => setOkAppKey(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label>Application Secret Key</label>
                                        <input
                                            type="password"
                                            placeholder="Secret..."
                                            value={okAppSecret}
                                            onChange={e => setOkAppSecret(e.target.value)}
                                        />
                                    </div>
                                </>
                            ) : newChannelType === 'habr' ? (
                                <>
                                    <div>
                                        <label>Hub IDs (comma-separated, optional)</label>
                                        <input
                                            placeholder="e.g. dev, pm"
                                            value={hubIds}
                                            onChange={e => setHubIds(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label>API Token / Key (Optional)</label>
                                        <input
                                            type="password"
                                            placeholder="Habr API Token..."
                                            value={newChannelApiKey}
                                            onChange={e => setNewChannelApiKey(e.target.value)}
                                        />
                                    </div>
                                    <div style={{ gridColumn: '1 / -1' }}>
                                        <label>Webhook URL (Optional, for publishing automation)</label>
                                        <input
                                            placeholder="https://..."
                                            value={webhookUrl}
                                            onChange={e => setWebhookUrl(e.target.value)}
                                        />
                                    </div>
                                    <div style={{ gridColumn: '1 / -1' }}>
                                        <label>Session Cookies (for automated Puppeteer publishing)</label>
                                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted, #8a8fa8)', margin: '0 0 6px' }}>
                                            {locale === 'ru' ? <>Войдите в Habr в браузере, откройте DevTools → Network → скопируйте значение заголовка <code>Cookie</code> из любого запроса к habr.com и вставьте сюда.</> : <>Sign in to Habr, open DevTools → Network, copy the <code>Cookie</code> header from any habr.com request, and paste it here.</>}
                                        </p>
                                        <textarea
                                            rows={3}
                                            placeholder="session_id=abc123; csrftoken=xyz..."
                                            value={sessionCookies}
                                            onChange={e => setSessionCookies(e.target.value)}
                                            style={{ fontFamily: 'monospace', fontSize: '0.75rem', resize: 'vertical' }}
                                        />
                                    </div>
                                </>
                            ) : newChannelType === 'vc' ? (
                                <>
                                    <div>
                                        <label>Subsite ID / User ID</label>
                                        <input
                                            placeholder="e.g. 12345 or 'personal'"
                                            value={newChannelId}
                                            onChange={e => setNewChannelId(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label>Device Token (X-Device-Token, optional)</label>
                                        <input
                                            type="password"
                                            placeholder="Token..."
                                            value={newChannelApiKey}
                                            onChange={e => setNewChannelApiKey(e.target.value)}
                                        />
                                    </div>
                                    <div style={{ gridColumn: '1 / -1' }}>
                                        <label>Webhook URL (Optional)</label>
                                        <input
                                            placeholder="https://..."
                                            value={webhookUrl}
                                            onChange={e => setWebhookUrl(e.target.value)}
                                        />
                                    </div>
                                </>
                            ) : newChannelType === 'zen' ? (
                                <>
                                    <div>
                                        <label>{locale === 'ru' ? 'ID или slug канала в Дзене' : 'Zen channel ID or slug'}</label>
                                        <input
                                            placeholder="e.g. channel_id..."
                                            value={newChannelId}
                                            onChange={e => setNewChannelId(e.target.value)}
                                        />
                                    </div>
                                    <div style={{ gridColumn: '1 / -1' }}>
                                        <label>{locale === 'ru' ? 'Авторизованная сессия Дзена' : 'Authorized Zen session'}</label>
                                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted, #8a8fa8)', margin: '0 0 6px' }}>
                                            {locale === 'ru' ? 'После сохранения сессия шифруется и больше не показывается.' : 'After saving, the session is encrypted and no longer displayed.'}
                                        </p>
                                        <textarea
                                            rows={3}
                                            placeholder="Session_id=abc123; yandexuid=xyz..."
                                            value={sessionCookies}
                                            onChange={e => setSessionCookies(e.target.value)}
                                            style={{ fontFamily: 'monospace', fontSize: '0.75rem', resize: 'vertical' }}
                                        />
                                    </div>
                                    <DzenConnectionGuide locale={locale} channelId={newChannelId} session={sessionCookies} />
                                </>
                            ) : newChannelType === 'threads' ? (
                                <>
                                    <div>
                                        <label>Threads User ID</label>
                                        <input
                                            placeholder="e.g. 123456789012345"
                                            value={newChannelId}
                                            onChange={e => setNewChannelId(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label>Access Token (Long-Lived)</label>
                                        <input
                                            type="password"
                                            placeholder="Token..."
                                            value={newChannelApiKey}
                                            onChange={e => setNewChannelApiKey(e.target.value)}
                                        />
                                    </div>
                                </>
                            ) : (
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label>Connect to LinkedIn</label>
                                    <p className="text-muted" style={{ fontSize: '0.8rem', marginBottom: '1rem' }}>
                                        Connect LinkedIn via OAuth for publishing. After Community Management approval, reconnect once to issue a token with `r_member_postAnalytics`.
                                    </p>
                                    {linkedinError && (
                                        <div className="mb-2 p-2" style={{ background: 'rgba(255,0,0,0.08)', color: '#b42318', borderRadius: '8px', fontSize: '0.8rem' }}>
                                            LinkedIn OAuth returned: {linkedinError}
                                        </div>
                                    )}
                                    <button
                                        className="btn-secondary"
                                        onClick={handleLinkedInConnect}
                                        disabled={linkedinConnecting || currentProject?.role !== 'owner' || user?.is_demo}
                                        style={{ width: '100%' }}
                                    >
                                        {linkedinConnecting ? 'Connecting…' : 'Connect / Reconnect LinkedIn'}
                                    </button>
                                </div>
                            )}
                            {newChannelType !== 'linkedin' && (
                                <div style={{ display: 'flex', alignItems: 'flex-end', gridColumn: '1 / -1' }}>
                                    <button
                                        className="btn-primary"
                                        onClick={handleAddChannel}
                                        disabled={
                                            !newChannelName ||
                                            (newChannelType !== 'habr' && !newChannelId) ||
                                            (newChannelType === 'vk' && !newChannelApiKey) ||
                                            (newChannelType === 'ok' && (!newChannelApiKey || !okAppKey || !okAppSecret)) ||
                                            addChannel.isPending
                                        }
                                        style={{ width: '100%' }}
                                    >
                                        {addChannel.isPending ? 'Adding...' : 'Add Channel'}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="grid">
                        {(projectData as ApiJson)?.channels?.map((channel: SocialChannel) => {
                            if (editingChannelId === channel.id) {
                                return (
                                    <div key={channel.id} className="mb-3 p-3 border rounded-xl bg-surface-container-low" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', gridColumn: '1 / -1' }}>
                                        <div className="flex-between">
                                            <span className="badge" style={{ textTransform: 'uppercase', background: 'var(--primary-container)', color: 'var(--on-primary-container)', fontWeight: 'bold' }}>
                                                Editing {channel.type}
                                            </span>
                                            <div className="flex" style={{ gap: '0.5rem' }}>
                                                <button
                                                    className="btn-primary"
                                                    style={{ fontSize: '0.8rem', padding: '0.25rem 0.75rem', height: 'auto' }}
                                                    onClick={() => {
                                                        if (!editingChannelName) return showToast('Channel Name is required', 'warning');
                                                        const finalConfig = { ...editingChannelConfig };
                                                        if (channel.type === 'telegram' && finalConfig.channel_username) {
                                                            finalConfig.channel_username = finalConfig.channel_username.startsWith('@')
                                                                ? finalConfig.channel_username
                                                                : `@${finalConfig.channel_username}`;
                                                        }
                                                        editChannel.mutate({
                                                            id: channel.id,
                                                            name: editingChannelName,
                                                            config: finalConfig
                                                        });
                                                    }}
                                                    disabled={editChannel.isPending}
                                                >
                                                    {editChannel.isPending ? 'Saving...' : 'Save'}
                                                </button>
                                                <button
                                                    className="btn-secondary"
                                                    style={{ fontSize: '0.8rem', padding: '0.25rem 0.75rem', height: 'auto' }}
                                                    onClick={() => setEditingChannelId(null)}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                        
                                        <div className="grid-2" style={{ gap: '0.75rem' }}>
                                            <div>
                                                <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Channel Name (Internal)</label>
                                                <input
                                                    className="w-full"
                                                    value={editingChannelName}
                                                    onChange={e => setEditingChannelName(e.target.value)}
                                                    placeholder="Channel Name"
                                                    style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>{copy.workflowMode}</label>
                                                <select
                                                    className="w-full"
                                                    value={editingChannelConfig.workflow_mode || 'approval_required'}
                                                    onChange={e => setEditingChannelConfig({ ...editingChannelConfig, workflow_mode: e.target.value })}
                                                >
                                                    <option value="prepare_only">{copy.prepareOnly}</option>
                                                    <option value="approval_required">{copy.afterApproval}</option>
                                                    <option value="auto_publish">{copy.autoPublish}</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>{copy.contentLanguage}</label>
                                                <select
                                                    className="w-full"
                                                    value={editingChannelConfig.content_language || 'ru'}
                                                    onChange={e => setEditingChannelConfig({ ...editingChannelConfig, content_language: e.target.value })}
                                                >
                                                    <option value="ru">{copy.russian}</option>
                                                    <option value="en">{copy.english}</option>
                                                </select>
                                                <p className="mt-1 text-xs leading-5 text-on-surface-variant">{copy.contentLanguageHelp}</p>
                                            </div>

                                            {channel.type === 'telegram' && (
                                                <>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Telegram Channel ID</label>
                                                        <input
                                                            className="w-full"
                                                            value={editingChannelConfig.telegram_channel_id || ''}
                                                            onChange={e => setEditingChannelConfig({ ...editingChannelConfig, telegram_channel_id: e.target.value })}
                                                            placeholder="-100xxxxxxxxx"
                                                            style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}
                                                        />
                                                        {editingChannelConfig.telegram_channel_id && !editingChannelConfig.telegram_channel_id.startsWith('-100') && (
                                                            <div className="text-xs text-rose-500 mt-1 font-semibold">
                                                                ⚠️ Telegram channel IDs usually start with -100
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div style={{ gridColumn: '1 / -1' }}>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Channel Username/Handle (Optional)</label>
                                                        <input
                                                            className="w-full"
                                                            value={editingChannelConfig.channel_username || ''}
                                                            onChange={e => setEditingChannelConfig({ ...editingChannelConfig, channel_username: e.target.value })}
                                                            placeholder="@channelname"
                                                            style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}
                                                        />
                                                        {editingChannelConfig.channel_username && !editingChannelConfig.channel_username.startsWith('@') && (
                                                            <div className="text-xs text-amber-500 mt-1 font-semibold">
                                                                💡 Will be auto-normalized to include @ prefix
                                                            </div>
                                                        )}
                                                    </div>
                                                    <TelegramConnectionGuide
                                                        locale={locale}
                                                        channelId={editingChannelConfig.telegram_channel_id}
                                                    />
                                                </>
                                            )}

                                            {channel.type === 'vk' && (
                                                <>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>VK Group/Community ID</label>
                                                        <input
                                                            className="w-full"
                                                            value={editingChannelConfig.vk_id || ''}
                                                            onChange={e => setEditingChannelConfig({ ...editingChannelConfig, vk_id: e.target.value })}
                                                            placeholder="VK ID"
                                                            style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}
                                                        />
                                                        {editingChannelConfig.vk_id && !editingChannelConfig.vk_id.startsWith('-') && (
                                                            <div className="text-xs text-rose-500 mt-1 font-semibold">
                                                                ⚠️ VK Group IDs must be negative (start with -)
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Community publication token</label>
                                                        <input
                                                            type="password"
                                                            className="w-full"
                                                            value={editingChannelConfig.publish_access_token || editingChannelConfig.api_key || ''}
                                                            onChange={e => setEditingChannelConfig({ ...editingChannelConfig, publish_access_token: e.target.value })}
                                                            placeholder="Publication access token"
                                                            style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}
                                                        />
                                                    </div>
                                                    <div style={{ gridColumn: '1 / -1' }}>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>User statistics token (Optional)</label>
                                                        <input
                                                            type="password"
                                                            className="w-full"
                                                            value={editingChannelConfig.stats_access_token || ''}
                                                            onChange={e => setEditingChannelConfig({
                                                                ...editingChannelConfig,
                                                                stats_access_token: e.target.value,
                                                                analytics_enabled: Boolean(e.target.value && e.target.value !== '******'),
                                                                api_version: '5.199'
                                                            })}
                                                            placeholder="Statistics access token"
                                                            style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}
                                                        />
                                                        <div className="text-xs text-on-surface-variant mt-1">
                                                            {locale === 'ru' ? 'Отдельный пользовательский токен для stats.getPostReach. Существующее значение остаётся сохранённым, пока поле замаскировано.' : 'A separate user token for stats.getPostReach. The existing value remains saved while the field is masked.'}
                                                        </div>
                                                    </div>
                                                    <VkConnectionGuide
                                                        locale={locale}
                                                        vkId={editingChannelConfig.vk_id}
                                                        publicationToken={editingChannelConfig.publish_access_token || editingChannelConfig.api_key}
                                                    />
                                                </>
                                            )}

                                            {channel.type === 'ok' && (
                                                <>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>OK Group ID</label>
                                                        <input
                                                            className="w-full"
                                                            value={editingChannelConfig.group_id || ''}
                                                            onChange={e => setEditingChannelConfig({ ...editingChannelConfig, group_id: e.target.value })}
                                                            placeholder="OK Group ID"
                                                            style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Access Token</label>
                                                        <input
                                                            className="w-full"
                                                            value={editingChannelConfig.access_token || ''}
                                                            onChange={e => setEditingChannelConfig({ ...editingChannelConfig, access_token: e.target.value })}
                                                            placeholder="Access Token"
                                                            style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Application Key</label>
                                                        <input
                                                            className="w-full"
                                                            value={editingChannelConfig.application_key || ''}
                                                            onChange={e => setEditingChannelConfig({ ...editingChannelConfig, application_key: e.target.value })}
                                                            placeholder="App Key"
                                                            style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Application Secret Key</label>
                                                        <input
                                                            className="w-full"
                                                            value={editingChannelConfig.application_secret_key || ''}
                                                            onChange={e => setEditingChannelConfig({ ...editingChannelConfig, application_secret_key: e.target.value })}
                                                            placeholder="App Secret Key"
                                                            style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}
                                                        />
                                                    </div>
                                                </>
                                            )}

                                            {channel.type === 'habr' && (
                                                <>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>API Token</label>
                                                        <input
                                                            className="w-full"
                                                            value={editingChannelConfig.api_token || ''}
                                                            onChange={e => setEditingChannelConfig({ ...editingChannelConfig, api_token: e.target.value })}
                                                            placeholder="API Token"
                                                            style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Channel ID (Optional)</label>
                                                        <input
                                                            className="w-full"
                                                            value={editingChannelConfig.telegram_channel_id || ''}
                                                            onChange={e => setEditingChannelConfig({ ...editingChannelConfig, telegram_channel_id: e.target.value })}
                                                            placeholder="Channel ID"
                                                            style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Hub IDs (comma-separated)</label>
                                                        <input
                                                            className="w-full"
                                                            value={Array.isArray(editingChannelConfig.hub_ids) ? editingChannelConfig.hub_ids.join(', ') : (editingChannelConfig.hub_ids || '')}
                                                            onChange={e => setEditingChannelConfig({ ...editingChannelConfig, hub_ids: e.target.value.split(',').map((s: string) => s.trim()) })}
                                                            placeholder="e.g. dev, design"
                                                            style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Webhook URL</label>
                                                        <input
                                                            className="w-full"
                                                            value={editingChannelConfig.webhook_url || ''}
                                                            onChange={e => setEditingChannelConfig({ ...editingChannelConfig, webhook_url: e.target.value })}
                                                            placeholder="Webhook URL"
                                                            style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}
                                                        />
                                                    </div>
                                                    <div style={{ gridColumn: '1 / -1' }}>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Cookies (Raw JSON/String)</label>
                                                        <textarea
                                                            className="w-full"
                                                            value={editingChannelConfig.cookies || ''}
                                                            onChange={e => setEditingChannelConfig({ ...editingChannelConfig, cookies: e.target.value })}
                                                            placeholder="Cookies for parser"
                                                            rows={2}
                                                            style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}
                                                        />
                                                    </div>
                                                </>
                                            )}

                                            {channel.type === 'vc' && (
                                                <>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Subsite ID / User ID</label>
                                                        <input
                                                            className="w-full"
                                                            value={editingChannelConfig.subsite_id || ''}
                                                            onChange={e => setEditingChannelConfig({ ...editingChannelConfig, subsite_id: e.target.value })}
                                                            placeholder="Subsite ID"
                                                            style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Access Token (API Key)</label>
                                                        <input
                                                            className="w-full"
                                                            value={editingChannelConfig.access_token || ''}
                                                            onChange={e => setEditingChannelConfig({ ...editingChannelConfig, access_token: e.target.value })}
                                                            placeholder="Access Token"
                                                            style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}
                                                        />
                                                    </div>
                                                    <div style={{ gridColumn: '1 / -1' }}>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Webhook URL</label>
                                                        <input
                                                            className="w-full"
                                                            value={editingChannelConfig.webhook_url || ''}
                                                            onChange={e => setEditingChannelConfig({ ...editingChannelConfig, webhook_url: e.target.value })}
                                                            placeholder="Webhook URL"
                                                            style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}
                                                        />
                                                    </div>
                                                </>
                                            )}

                                            {['zen', 'dzen', 'zen_article'].includes(channel.type) && (
                                                <>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Zen Channel ID</label>
                                                        <input
                                                            className="w-full"
                                                            value={editingChannelConfig.channel_id || ''}
                                                            onChange={e => setEditingChannelConfig({ ...editingChannelConfig, channel_id: e.target.value })}
                                                            placeholder="Channel ID"
                                                            style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>{copy.defaultPublicationType}</label>
                                                        <select
                                                            className="w-full"
                                                            value={editingChannelConfig.default_publication_type || 'article'}
                                                            onChange={e => setEditingChannelConfig({ ...editingChannelConfig, default_publication_type: e.target.value })}
                                                        >
                                                            <option value="article">{copy.article}</option>
                                                            <option value="post">{copy.shortPost}</option>
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>{copy.channelUrl}</label>
                                                        <input
                                                            className="w-full"
                                                            value={editingChannelConfig.channel_url || ''}
                                                            onChange={e => setEditingChannelConfig({ ...editingChannelConfig, channel_url: e.target.value })}
                                                            placeholder="https://dzen.ru/id/..."
                                                            style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}
                                                        />
                                                    </div>
                                                    <div style={{ gridColumn: '1 / -1' }}>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>{copy.authorizedSession}</label>
                                                        <textarea
                                                            className="w-full"
                                                            value={editingChannelConfig.cookies || ''}
                                                            onChange={e => setEditingChannelConfig({ ...editingChannelConfig, cookies: e.target.value })}
                                                            placeholder={locale === 'ru' ? 'Сохранённая сессия скрыта. Вставьте новое значение только для замены.' : 'The saved session is hidden. Paste a new value only to replace it.'}
                                                            rows={2}
                                                            style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}
                                                        />
                                                        <div className="text-xs text-on-surface-variant mt-1">
                                                            {locale === 'ru' ? 'Сначала сохраните изменения, затем запустите проверку подключения.' : 'Save changes first, then test the connection.'}
                                                        </div>
                                                    </div>
                                                    <DzenConnectionGuide
                                                        locale={locale}
                                                        channelId={editingChannelConfig.channel_id || editingChannelConfig.channel_url}
                                                        session={editingChannelConfig.cookies}
                                                    />
                                                    <div style={{ gridColumn: '1 / -1' }}>
                                                        <button
                                                            type="button"
                                                            className="btn-secondary w-full"
                                                            disabled={testChannelConnection.isPending}
                                                            onClick={() => testChannelConnection.mutate(channel.id)}
                                                        >
                                                            {testChannelConnection.isPending ? (locale === 'ru' ? 'Проверяем Дзен…' : 'Checking Zen...') : (locale === 'ru' ? 'Проверить подключение к Дзену' : 'Test Zen connection')}
                                                        </button>
                                                    </div>
                                                </>
                                            )}

                                            {channel.type === 'threads' && (
                                                <>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Threads User ID</label>
                                                        <input
                                                            className="w-full"
                                                            value={editingChannelConfig.threads_user_id || ''}
                                                            onChange={e => setEditingChannelConfig({ ...editingChannelConfig, threads_user_id: e.target.value })}
                                                            placeholder="Threads User ID"
                                                            style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Access Token</label>
                                                        <input
                                                            className="w-full"
                                                            value={editingChannelConfig.access_token || ''}
                                                            onChange={e => setEditingChannelConfig({ ...editingChannelConfig, access_token: e.target.value })}
                                                            placeholder="Access Token"
                                                            style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}
                                                        />
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                );
                            }

                            return (
                                <div key={channel.id} className="flex-between p-2" style={{ background: 'var(--bg-tertiary)', borderRadius: '6px', marginBottom: '0.5rem' }}>
                                    <div>
                                        <div className="flex-center">
                                            <strong>{channel.name}</strong>
                                            <span className="badge" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>{channel.type}</span>
                                            <span className="badge" style={{ fontSize: '0.7rem' }}>
                                                {channel.config?.workflow_mode === 'auto_publish' ? copy.autoPublish : channel.config?.workflow_mode === 'prepare_only' ? copy.prepareOnly : copy.afterApproval}
                                            </span>
                                            {channel.type === 'linkedin' && (
                                                <span className="badge ml-1" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>
                                                    {channel.config?.analytics_scope_enabled ? 'analytics ready' : 'reconnect for analytics'}
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                                            ID: {channel.config?.telegram_channel_id || channel.config?.vk_id || channel.config?.linkedin_urn || channel.config?.group_id || channel.config?.channel_id || channel.config?.subsite_id}
                                            {channel.config?.channel_username && ` • @${channel.config.channel_username}`}
                                        </div>
                                        {channel.type === 'linkedin' && (
                                            <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                                                {channel.config?.analytics_scope_enabled
                                                    ? 'This channel token is ready for member post analytics.'
                                                    : 'Reconnect this channel after approval to enable LinkedIn post analytics.'}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-center" style={{ gap: '0.5rem' }}>
                                        {defaultChannelId === String(channel.id) ? (
                                            <span className="badge" style={{ background: '#027a48', color: '#ffffff', fontSize: '0.75rem', fontWeight: 'bold' }}>Default</span>
                                        ) : (
                                            <button
                                                className="btn-secondary"
                                                style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', height: 'auto' }}
                                                onClick={() => {
                                                    if (confirm(`Set ${channel.name} as the default channel? This will also update all existing unpublished posts to this channel.`)) {
                                                        updateSetting.mutate({ key: 'default_channel_id', value: String(channel.id) });
                                                    }
                                                }}
                                            >
                                                Set as Default
                                            </button>
                                        )}
                                        <button
                                            className="btn-secondary"
                                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', height: 'auto', background: 'var(--bg-secondary-container, #e1e0ff)' }}
                                            onClick={() => handleStartEditChannel(channel)}
                                        >
                                            Edit
                                        </button>
                                        <button
                                            className="btn-danger"
                                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', height: 'auto', background: 'var(--error, #ba1a1a)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                            onClick={() => {
                                                if (confirm(`Are you sure you want to delete ${channel.name}?`)) {
                                                    deleteChannel.mutate(channel.id);
                                                }
                                            }}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                        {(!projectData || !(projectData as ApiJson).channels?.length) && (
                            <p className="text-muted">No channels connected.</p>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'keys' && (
                <div className="card">
                    <h2>Provider Keys</h2>
                    <p className="text-muted mb-2">Manage API keys for AI providers (OpenAI, Anthropic, Gemini). Keys are stored securely and can be reused.</p>

                    <div className="mb-3 p-2" style={{ border: '1px solid var(--border)', borderRadius: '8px' }}>
                        <h3>Add New Key</h3>
                        <div className="grid-2" style={{ gap: '1rem' }}>
                            <input
                                placeholder="Key Name (e.g. My OpenAI Key)"
                                value={newKeyName}
                                onChange={e => setNewKeyName(e.target.value)}
                            />
                            <div className="flex">
                                <input
                                    type="password"
                                    placeholder="sk-..."
                                    value={newKeyValue}
                                    onChange={e => setNewKeyValue(e.target.value)}
                                    style={{ flex: 1, marginRight: '0.5rem' }}
                                />
                                <button
                                    className="btn-primary"
                                    onClick={() => addKey.mutate({ name: newKeyName, key: newKeyValue })}
                                    disabled={!newKeyName || !newKeyValue}
                                >
                                    Add
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="grid">
                        {keys?.map(key => (
                            <div key={key.id} className="flex-between p-2" style={{ background: 'var(--bg-tertiary)', borderRadius: '6px', marginBottom: '0.5rem' }}>
                                <div>
                                    <strong>{key.name}</strong>
                                    <span className="badge ml-1" style={{ fontSize: '0.8rem' }}>{key.provider}</span>
                                    <div className="text-muted" style={{ fontSize: '0.8rem' }}>{key.key}</div>
                                </div>
                                <button className="btn-danger" onClick={() => deleteKey.mutate(key.id)}>Delete</button>
                            </div>
                        ))}
                        {keys?.length === 0 && <p className="text-muted">No keys found.</p>}
                    </div>
                </div>
            )}

            {activeTab === 'dictionary' && (
                <div className="card">
                    <h2>Content Dictionary & ATOMA Context</h2>
                    <p className="text-muted mb-2">Manage both terminology rules and atomized source context used by the critic, editor and publication workflow.</p>

                    <div className="mb-4 p-2" style={{ background: 'var(--bg-tertiary)', borderRadius: '8px' }}>
                        <strong>What is ATOMA context?</strong>
                        <div className="text-muted" style={{ fontSize: '0.9rem', marginTop: '0.5rem', lineHeight: 1.5 }}>
                            This is structured source context for the editor and critic. The description explains in plain language how to use the atomized materials, while the payload stores the machine-readable JSON with source fragments, mappings and editorial rules.
                        </div>
                    </div>

                    <div className="grid-2" style={{ gap: '1.5rem', alignItems: 'start' }}>
                        <div>
                            <p className="text-muted mb-2">Upload or edit a YAML dictionary for project terminology, forbidden variants and style rules. This dictionary is used to validate content consistency.</p>

                            <div className="flex mb-2" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                                <input
                                    ref={dictionaryFileInputRef}
                                    type="file"
                                    accept=".yaml,.yml,text/yaml,application/yaml"
                                    style={{ display: 'none' }}
                                    onChange={(event) => {
                                        handleDictionaryFileUpload(event.target.files?.[0] || null)
                                        event.target.value = ''
                                    }}
                                />
                                <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() => dictionaryFileInputRef.current?.click()}
                                >
                                    Upload YAML File
                                </button>
                                <span className="text-muted" style={{ alignSelf: 'center', fontSize: '0.85rem' }}>
                                    Supports .yaml and .yml glossary files
                                </span>
                            </div>

                            <div className="mb-2">
                                <label>Dictionary YAML</label>
                                <textarea
                                    value={dictionaryYaml}
                                    onChange={e => setDictionaryYaml(e.target.value)}
                                    rows={22}
                                    spellCheck={false}
                                    style={{ fontFamily: 'monospace' }}
                                    placeholder={'terms:\n  - canonical: "system analysis"'}
                                />
                            </div>

                            <div className="flex" style={{ gap: '0.5rem', marginBottom: '1rem' }}>
                                <button className="btn-primary" onClick={() => saveContentDictionary.mutate(dictionaryYaml)} disabled={!dictionaryYaml.trim() || saveContentDictionary.isPending}>
                                    {saveContentDictionary.isPending ? 'Saving...' : 'Save Dictionary'}
                                </button>
                                {contentDictionary?.updated_at && (
                                    <span className="text-muted" style={{ alignSelf: 'center', fontSize: '0.85rem' }}>
                                        Updated: {new Date(contentDictionary.updated_at).toLocaleString()}
                                    </span>
                                )}
                            </div>

                            {contentDictionary?.parsed && (
                                <div className="p-2" style={{ background: 'var(--bg-tertiary)', borderRadius: '8px' }}>
                                    <strong>Quick Summary</strong>
                                    <div className="text-muted" style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>
                                        Terms: {contentDictionary.parsed.terms?.length || 0}
                                        {' • '}
                                        Required phrases: {contentDictionary.parsed.style_rules?.required_phrases?.length || 0}
                                        {' • '}
                                        Forbidden phrases: {contentDictionary.parsed.style_rules?.forbidden_phrases?.length || 0}
                                    </div>
                                </div>
                            )}

                            <div className="mt-4">
                                <p className="text-muted mb-2">Define the platform × tone-of-voice matrix used by the publication critic and fixer.</p>

                                <div className="mb-2">
                                    <label>Content Policy Matrix YAML</label>
                                    <textarea
                                        value={contentPolicyMatrixYaml}
                                        onChange={e => setContentPolicyMatrixYaml(e.target.value)}
                                        rows={18}
                                        spellCheck={false}
                                        style={{ fontFamily: 'monospace' }}
                                        placeholder={locale === 'ru'
                                            ? 'voices:\n  founder:\n    preferred_traits:\n      - "позиция"\nplatforms:\n  telegram:\n    min_chars: 700\nmatrix:\n  telegram:\n    founder:\n      preferred_traits:\n        - "живой конфликт"'
                                            : 'voices:\n  founder:\n    preferred_traits:\n      - "clear position"\nplatforms:\n  telegram:\n    min_chars: 700\nmatrix:\n  telegram:\n    founder:\n      preferred_traits:\n        - "real conflict"'}
                                    />
                                </div>

                                <div className="flex" style={{ gap: '0.5rem', marginBottom: '1rem' }}>
                                    <button className="btn-primary" onClick={() => saveContentPolicyMatrix.mutate(contentPolicyMatrixYaml)} disabled={!contentPolicyMatrixYaml.trim() || saveContentPolicyMatrix.isPending}>
                                        {saveContentPolicyMatrix.isPending ? 'Saving...' : 'Save Policy Matrix'}
                                    </button>
                                    {contentPolicyMatrix?.updated_at && (
                                        <span className="text-muted" style={{ alignSelf: 'center', fontSize: '0.85rem' }}>
                                            Updated: {new Date(contentPolicyMatrix.updated_at).toLocaleString()}
                                        </span>
                                    )}
                                </div>

                                {contentPolicyMatrix?.parsed && (
                                    <div className="p-2" style={{ background: 'var(--bg-tertiary)', borderRadius: '8px' }}>
                                        <strong>Quick Summary</strong>
                                        <div className="text-muted" style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>
                                            Voices: {Object.keys(contentPolicyMatrix.parsed.voices || {}).length}
                                            {' • '}
                                            Platforms: {Object.keys(contentPolicyMatrix.parsed.platforms || {}).length}
                                            {' • '}
                                            Matrix pairs: {Object.values(contentPolicyMatrix.parsed.matrix || {}).reduce((total: number, entry: ApiJson) => total + Object.keys(entry || {}).length, 0)}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div>
                            <p className="text-muted mb-2">Edit the human explanation and the raw JSON payload that describe atomized source files, mappings and rules for the publication pipeline.</p>

                            <div className="mb-2">
                                <label>ATOMA Description</label>
                                <textarea
                                    value={atomaDescription}
                                    onChange={e => setAtomaDescription(e.target.value)}
                                    rows={8}
                                    spellCheck={false}
                                    placeholder="Explain in plain language what these source files contain and how the editor/critic should use them."
                                />
                            </div>

                            <div className="mb-2">
                                <label>ATOMA Payload JSON</label>
                                <textarea
                                    value={atomaPayloadText}
                                    onChange={e => setAtomaPayloadText(e.target.value)}
                                    rows={14}
                                    spellCheck={false}
                                    style={{ fontFamily: 'monospace' }}
                                    placeholder={'{\n  "source_map": [],\n  "editorial_rules": []\n}'}
                                />
                            </div>

                            <div className="flex" style={{ gap: '0.5rem', marginBottom: '1rem' }}>
                                <button
                                    className="btn-primary"
                                    onClick={() => saveAtomaContext.mutate({ description: atomaDescription, payloadText: atomaPayloadText })}
                                    disabled={saveAtomaContext.isPending}
                                >
                                    {saveAtomaContext.isPending ? 'Saving...' : 'Save ATOMA Context'}
                                </button>
                                {atomaContext?.updated_at && (
                                    <span className="text-muted" style={{ alignSelf: 'center', fontSize: '0.85rem' }}>
                                        Updated: {new Date(atomaContext.updated_at).toLocaleString()}
                                    </span>
                                )}
                            </div>

                            <div className="p-2" style={{ background: 'var(--bg-tertiary)', borderRadius: '8px' }}>
                                <strong>Quick Summary</strong>
                                <div className="text-muted" style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>
                                    Description: {atomaContext?.description?.trim() ? 'configured' : 'empty'}
                                    {' • '}
                                    Payload: {atomaContext?.payload ? 'configured' : 'empty'}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'skills' && (
                <div className="card">
                    <h2>Skill-Capable LLM Connections</h2>
                    <p className="text-muted mb-2">Configure Claude and other LLM connections that can work with project skills, tools or MCP-style capabilities.</p>

                    <div className="mb-3 p-2" style={{ border: '1px solid var(--border)', borderRadius: '8px' }}>
                        <h3>{editingSkillConnectionId ? 'Edit Connection' : 'Add Connection'}</h3>
                        <div className="grid-2" style={{ gap: '1rem' }}>
                            <div>
                                <label>Connection Name</label>
                                <input value={skillConnectionName} onChange={e => setSkillConnectionName(e.target.value)} placeholder="Claude Skills" />
                            </div>
                            <div>
                                <label>Provider</label>
                                <select value={skillConnectionProvider} onChange={e => setSkillConnectionProvider(e.target.value)}>
                                    <option value="Anthropic">Anthropic</option>
                                    <option value="OpenAI">OpenAI</option>
                                    <option value="Gemini">Gemini</option>
                                    <option value="Other">Other</option>
                                </select>
                            </div>
                            <div>
                                <label>Model</label>
                                <input value={skillConnectionModel} onChange={e => setSkillConnectionModel(e.target.value)} placeholder="claude-3-7-sonnet-latest" />
                            </div>
                            <div>
                                <label>Provider Key</label>
                                <select value={skillConnectionKeyId} onChange={e => setSkillConnectionKeyId(e.target.value)}>
                                    <option value="">No linked key</option>
                                    {keys?.map(key => (
                                        <option key={key.id} value={key.id}>{key.name} ({key.provider})</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label>Endpoint Type</label>
                                <select value={skillConnectionEndpointType} onChange={e => setSkillConnectionEndpointType(e.target.value)}>
                                    <option value="native">Native API</option>
                                    <option value="openai_compatible">OpenAI Compatible</option>
                                    <option value="custom">Custom</option>
                                </select>
                            </div>
                            <div>
                                <label>Skill Mode</label>
                                <select value={skillConnectionMode} onChange={e => setSkillConnectionMode(e.target.value)}>
                                    <option value="native_skills">Native Skills</option>
                                    <option value="tools">Tools</option>
                                    <option value="mcp">MCP</option>
                                </select>
                            </div>
                            <div style={{ gridColumn: '1 / -1' }}>
                                <label>Enabled Skills</label>
                                <input value={skillConnectionSkills} onChange={e => setSkillConnectionSkills(e.target.value)} placeholder="planning, research, project_bootstrap" />
                            </div>
                            <div style={{ gridColumn: '1 / -1' }}>
                                <label>System Prompt / Guidance</label>
                                <textarea value={skillConnectionPrompt} onChange={e => setSkillConnectionPrompt(e.target.value)} rows={4} placeholder="When to use skills, how to combine them, safety constraints..." />
                            </div>
                            <div style={{ gridColumn: '1 / -1' }}>
                                <label>Notes</label>
                                <textarea value={skillConnectionNotes} onChange={e => setSkillConnectionNotes(e.target.value)} rows={2} placeholder="Operational notes for this LLM connection" />
                            </div>
                        </div>

                        <div className="flex-center mt-2" style={{ justifyContent: 'space-between' }}>
                            <label className="flex-center" style={{ gap: '0.5rem' }}>
                                <input type="checkbox" checked={skillConnectionEnabled} onChange={e => setSkillConnectionEnabled(e.target.checked)} />
                                <span>Connection enabled</span>
                            </label>
                            <div className="flex" style={{ gap: '0.5rem' }}>
                                {editingSkillConnectionId && (
                                    <button className="btn-secondary" onClick={resetSkillConnectionForm}>Cancel</button>
                                )}
                                <button className="btn-primary" onClick={handleSaveSkillConnection} disabled={!skillConnectionName || !skillConnectionModel || saveSkillConnections.isPending}>
                                    {saveSkillConnections.isPending ? 'Saving...' : (editingSkillConnectionId ? 'Update Connection' : 'Add Connection')}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="grid">
                        {skillConnections?.map(connection => (
                            <div key={connection.id} className="p-2" style={{ background: 'var(--bg-tertiary)', borderRadius: '6px', marginBottom: '0.5rem' }}>
                                <div className="flex-between mb-1">
                                    <div>
                                        <strong>{connection.name}</strong>
                                        <span className="badge ml-1" style={{ fontSize: '0.75rem' }}>{connection.provider}</span>
                                        <span className="badge ml-1" style={{ fontSize: '0.75rem' }}>{connection.skillMode || 'native_skills'}</span>
                                        {!connection.enabled && <span className="badge ml-1" style={{ fontSize: '0.75rem' }}>disabled</span>}
                                    </div>
                                    <div className="flex" style={{ gap: '0.5rem' }}>
                                        <button className="btn-secondary" onClick={() => handleEditSkillConnection(connection)}>Edit</button>
                                        <button className="btn-danger" onClick={() => handleDeleteSkillConnection(connection.id)}>Delete</button>
                                    </div>
                                </div>
                                <div className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '0.4rem' }}>
                                    Model: {connection.model}
                                    {connection.endpointType ? ` • ${connection.endpointType}` : ''}
                                    {connection.providerKeyId ? ` • key #${connection.providerKeyId}` : ''}
                                </div>
                                <div style={{ fontSize: '0.9rem', marginBottom: '0.4rem' }}>
                                    Skills: {(connection.enabledSkills || []).length ? connection.enabledSkills.join(', ') : 'No skills selected'}
                                </div>
                                {(connection.systemPrompt || connection.notes) && (
                                    <div className="text-muted" style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>
                                        {[connection.systemPrompt, connection.notes].filter(Boolean).join('\n\n')}
                                    </div>
                                )}
                            </div>
                        ))}
                        {skillConnections?.length === 0 && <p className="text-muted">No skill-capable LLM connections configured yet.</p>}
                    </div>
                </div>
            )}

            {activeTab === 'team' && (
                <div className="card">
                    <h2>Team Members</h2>
                    <p className="text-muted mb-2">Invite users to collaborate on this project.</p>

                    <div className="mb-3 p-2" style={{ border: '1px solid var(--border)', borderRadius: '8px' }}>
                        <h3>Invite Member</h3>
                        <div className="flex">
                            <input
                                type="email"
                                placeholder="User Email"
                                value={inviteEmail}
                                onChange={e => setInviteEmail(e.target.value)}
                                style={{ flex: 1, marginRight: '0.5rem' }}
                            />
                            <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} style={{ marginRight: '0.5rem' }}>
                                <option value="viewer">Viewer</option>
                                <option value="editor">Editor</option>
                                <option value="owner">Owner</option>
                            </select>
                            <button
                                className="btn-primary"
                                onClick={() => addMember.mutate({ email: inviteEmail, role: inviteRole })}
                                disabled={!inviteEmail}
                            >
                                Invite
                            </button>
                        </div>
                    </div>

                    <div className="grid">
                        {(projectData as ApiJson)?.members?.map((m: ApiJson) => (
                            <div key={m.id} className="flex-between p-2" style={{ background: 'var(--bg-tertiary)', borderRadius: '6px', marginBottom: '0.5rem' }}>
                                <div>
                                    <strong>{m.user?.name || m.user?.email || 'Unknown'}</strong>
                                    <div className="text-muted" style={{ fontSize: '0.8rem' }}>{m.role} • {m.user?.email}</div>
                                </div>
                                {m.role !== 'owner' && (
                                    <button className="btn-danger" onClick={() => removeMember.mutate(m.user_id)}>Remove</button>
                                )}
                            </div>
                        ))}
                        {!(projectData as ApiJson)?.members && <p>Loading members...</p>}
                    </div>
                </div>
            )}

            {activeTab === 'agents' && (
                <div className="space-y-6">
                    <div className="card space-y-4">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-widest text-primary">{copy.modelCosts}</div>
                                <h3 className="mt-2 text-2xl font-black text-on-surface">
                                    ${Number(modelUsage?.total_estimated_cost_usd || 0).toFixed(2)}
                                </h3>
                                <p className="mt-1 text-sm text-on-surface-variant">
                                    {modelUsage?.total_calls || 0} {copy.calls} · {copy.knownCost} {modelUsage?.exact_cost_coverage || 0}
                                </p>
                            </div>
                            <span className="rounded-full bg-surface-container-high px-3 py-1 text-xs font-bold text-on-surface-variant">
                                {copy.automaticTracking}
                            </span>
                        </div>
                        {modelUsage?.by_model?.length ? (
                            <div className="overflow-x-auto rounded-2xl border border-outline-variant/10">
                                <table className="w-full min-w-[620px] text-left text-sm">
                                    <thead className="bg-surface-container-low text-xs uppercase tracking-wider text-on-surface-variant">
                                        <tr><th className="p-3">{copy.model}</th><th className="p-3">{copy.calls}</th><th className="p-3">{copy.errors}</th><th className="p-3">{copy.tokens}</th><th className="p-3">{copy.estimate}</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-outline-variant/10">
                                        {modelUsage.by_model.map((row, index) => (
                                            <tr key={`${row.provider}-${row.model}-${index}`}>
                                                <td className="p-3 font-bold">{row.model || copy.unknownModel}<div className="text-xs font-normal text-on-surface-variant">{row.provider || 'n/a'}</div></td>
                                                <td className="p-3">{row.calls}</td>
                                                <td className={`p-3 ${row.failed_calls ? 'text-error font-bold' : ''}`}>{row.failed_calls}</td>
                                                <td className="p-3">{(row.input_tokens + row.output_tokens).toLocaleString('ru-RU')}</td>
                                                <td className="p-3 font-bold">{row.estimated_cost_usd === null ? copy.noRate : `$${row.estimated_cost_usd.toFixed(4)}`}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="rounded-2xl bg-surface-container-low p-4 text-sm text-on-surface-variant">{copy.noTelemetry}</div>
                        )}
                    </div>
                    {AGENT_ROLES.map(group => (
                        <div key={group.group} className="card p-0 overflow-hidden">
                            <div className="bg-surface-container-low px-4 py-3 border-b flex-between">
                                <h3 className="text-sm font-black uppercase tracking-widest text-primary m-0">{group.group}</h3>
                            </div>
                            <div className="divide-y">
                                {group.roles.map(role => (
                                    <AgentSettingsRow
                                        key={role.id}
                                        roleId={role.id}
                                        label={role.label}
                                        icon={role.icon}
                                        config={agents?.find(a => a.role === role.id)}
                                        keys={keys}
                                        onSave={(data) => updateAgent.mutate(data)}
                                        isUpdating={updateAgent.isPending && updateAgent.variables?.role === role.id}
                                        loadModels={async (key) => {
                                            const params: ApiJson = {}
                                            if (key.startsWith('pk_')) params.keyId = key.substring(3)
                                            else params.key = key
                                            const res = await modelsApi.fetch(params)
                                            return res.models
                                        }}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {activeTab === 'presets' && (
                <div className="card">
                    <h2>Style Presets</h2>
                    <div className="card" style={{ background: 'var(--bg-tertiary)', marginBottom: '1rem' }}>
                        <h3 style={{ fontSize: '1rem' }}>{editingPresetId ? 'Edit Preset' : 'New Preset'}</h3>
                        <div className="grid-2 mb-2">
                            <div>
                                <label>Name</label>
                                <input value={presetName} onChange={e => setPresetName(e.target.value)} placeholder="e.g. LinkedIn Professional" />
                            </div>
                            <div>
                                <label>Role</label>
                                <select value={presetRole} onChange={e => setPresetRole(e.target.value)}>
                                    <option value="post_creator">Post Creator</option>
                                    <option value="topic_creator">Topic Creator</option>
                                </select>
                            </div>
                        </div>
                        <div className="mb-2">
                            <label>System Prompt</label>
                            <textarea value={presetPrompt} onChange={e => setPresetPrompt(e.target.value)} rows={4} placeholder="You are an expert..." />
                        </div>
                        <div className="flex">
                            <button className="btn-primary" onClick={handleSavePreset} disabled={!presetName || !presetPrompt}>
                                {editingPresetId ? 'Update' : 'Create'}
                            </button>
                            {editingPresetId && <button className="btn-secondary" onClick={cancelEditPreset}>Cancel</button>}
                        </div>
                    </div>
                    <div className="grid" style={{ gap: '1rem' }}>
                        {presets?.map(p => (
                            <div key={p.id} style={{ border: '1px solid var(--border)', padding: '1rem', borderRadius: '8px' }}>
                                <div className="flex-between mb-1">
                                    <strong>{p.name} <span className="text-muted" style={{ fontWeight: 'normal' }}>({p.role})</span></strong>
                                    <div>
                                        <button className="btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', marginRight: '0.5rem' }} onClick={() => startEditPreset(p)}>Edit</button>
                                        <button className="btn-danger" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }} onClick={() => deletePreset.mutate(p.id)}>Delete</button>
                                    </div>
                                </div>
                                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', maxHeight: '100px', overflow: 'hidden' }}>
                                    {p.prompt_text}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {activeTab === 'history' && (
                <div className="card">
                    <h2>Prompt History</h2>
                    <p className="text-muted mb-3">View the log of agent interactions for this project.</p>
                    {runs && runs.length === 0 && <p>No history found.</p>}
                    <div>
                        {runs?.map(run => (
                            <RunRow key={run.id} run={run} />
                        ))}
                    </div>
                </div>
            )}
                </fieldset>
            </div>
        </div>
    )
}

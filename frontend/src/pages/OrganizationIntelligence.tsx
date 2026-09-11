import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { organizationIntelligenceApi } from '../api'
import { useLocale } from '../i18n/locale'

/* API payloads preserve source-specific metadata, so this boundary remains intentionally open. */
/* eslint-disable @typescript-eslint/no-explicit-any */
type RecordValue = Record<string, any>
const rows = (value: any, keys: string[]) => {
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key]
  if (Array.isArray(value)) return value
  return []
}

export default function OrganizationIntelligence() {
  // Intelligence Hub marks all imported excerpts as untrusted_external_content.
  const { locale } = useLocale()
  const ru = locale === 'ru'
  const [organization, setOrganization] = useState<RecordValue | null>(null)
  const [context, setContext] = useState<RecordValue | null>(null)
  const [signals, setSignals] = useState<RecordValue[]>([])
  const [runs, setRuns] = useState<RecordValue[]>([])
  const [query, setQuery] = useState('')
  const [sources, setSources] = useState(['reddit', 'indie_hackers'])
  const [busy, setBusy] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [run, setRun] = useState<RecordValue | null>(null)
  const [acting, setActing] = useState('')
  const [editingProject, setEditingProject] = useState<RecordValue | null>(null)
  const [profileDraft, setProfileDraft] = useState<Record<string, string>>({})

  const refreshSignals = async (organizationId: number) => {
    const response: any = await organizationIntelligenceApi.listSignals(organizationId)
    setSignals(rows(response?.data ?? response, ['signals', 'items']))
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const orgResponse: any = await organizationIntelligenceApi.listOrganizations()
        const org = rows(orgResponse?.data ?? orgResponse, ['organizations', 'items'])[0]
        if (!org || !active) return
        setOrganization(org)
        const [contextResponse, signalResponse, runsResponse]: any[] = await Promise.all([
          organizationIntelligenceApi.getContext(org.id),
          organizationIntelligenceApi.listSignals(org.id),
          organizationIntelligenceApi.listRuns(org.id)
        ])
        if (!active) return
        setContext(contextResponse?.data ?? contextResponse)
        setSources(rows(contextResponse?.data ?? contextResponse, ['sources']).filter((source: any) => source.is_active).map((source: any) => source.source_type))
        setSignals(rows(signalResponse?.data ?? signalResponse, ['signals', 'items']))
        setRuns(rows(runsResponse?.data ?? runsResponse, ['runs', 'items']))
      } catch (e: any) {
        if (active) setError(e?.response?.data?.error || e?.message || (ru ? 'Не удалось загрузить разведку.' : 'Could not load intelligence.'))
      } finally { if (active) setBusy(false) }
    })()
    return () => { active = false }
  }, [ru])

  const projects = useMemo(() => rows(context, ['projects', 'activeProjects']), [context])
  const partial = run?.state === 'partial' || run?.status === 'partial'
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!organization || !query.trim() || sources.length === 0) return
    setRunning(true); setError('')
    try {
      const response: any = await organizationIntelligenceApi.search(organization.id, {
        query: query.trim(), sources, projectIds: projects.map((project: any) => project.id), idempotencyKey: crypto.randomUUID()
      })
      const next = response?.data ?? response
      setRun(next)
      setSignals(rows(next, ['signals', 'items']))
      const runsResponse: any = await organizationIntelligenceApi.listRuns(organization.id)
      setRuns(rows(runsResponse?.data ?? runsResponse, ['runs', 'items']))
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || (ru ? 'Поиск не запустился.' : 'Search could not start.'))
    } finally { setRunning(false) }
  }

  const route = async (signal: RecordValue, assessment: RecordValue) => {
    if (!organization) return
    const key = `${signal.id}:${assessment.project_id}`
    setActing(key); setError('')
    try {
      await organizationIntelligenceApi.routeSignal(organization.id, signal.id, assessment.project_id, assessment.revision)
      await refreshSignals(organization.id)
    } catch (e: any) { setError(e?.message || (ru ? 'Не удалось направить сигнал.' : 'Could not route signal.')) }
    finally { setActing('') }
  }

  const toggleSource = async (source: RecordValue) => {
    if (!organization || context?.role !== 'owner') return
    const key = `source:${source.id}`
    setActing(key); setError('')
    try {
      await organizationIntelligenceApi.setSourceActive(organization.id, source.id, !source.is_active)
      const response: any = await organizationIntelligenceApi.getContext(organization.id)
      setContext(response?.data ?? response)
      setSources(current => source.is_active ? current.filter(item => item !== source.source_type) : [...new Set([...current, source.source_type])])
    } catch (e: any) { setError(e?.message || (ru ? 'Не удалось обновить источник.' : 'Could not update source.')) }
    finally { setActing('') }
  }

  const promote = async (signal: RecordValue, projectId: number) => {
    if (!organization) return
    const key = `promote:${signal.id}:${projectId}`
    setActing(key); setError('')
    try {
      await organizationIntelligenceApi.promoteSignal(organization.id, signal.id, projectId, 'initiative')
      await refreshSignals(organization.id)
    } catch (e: any) { setError(e?.message || (ru ? 'Не удалось создать инициативу.' : 'Could not create initiative.')) }
    finally { setActing('') }
  }

  const editProfile = (project: RecordValue) => {
    const profile = project.research_profile || {}
    setEditingProject(project)
    setProfileDraft(Object.fromEntries(['audience', 'problems', 'themes', 'products', 'include_terms', 'exclude_terms'].map(key => [key, (profile[key] || []).join(', ')])))
  }

  const saveProfile = async () => {
    if (!organization || !editingProject) return
    setActing(`profile:${editingProject.id}`); setError('')
    try {
      await organizationIntelligenceApi.updateProjectProfile(organization.id, editingProject.id, Object.fromEntries(Object.entries(profileDraft).map(([key, value]) => [key, value.split(',').map(item => item.trim()).filter(Boolean)])))
      const response: any = await organizationIntelligenceApi.getContext(organization.id)
      setContext(response?.data ?? response); setEditingProject(null)
      await refreshSignals(organization.id)
    } catch (e: any) { setError(e?.message || (ru ? 'Не удалось сохранить профиль.' : 'Could not save profile.')) }
    finally { setActing('') }
  }

  if (busy) return <div role="status" className="p-8 text-on-surface-variant">{ru ? 'Загружаем пространство разведки…' : 'Loading intelligence workspace…'}</div>
  if (!organization) return <div className="mx-auto max-w-xl p-8 text-center"><span className="material-symbols-outlined text-5xl text-primary/30">domain_disabled</span><h1 className="mt-3 text-2xl font-black">{ru ? 'Организация не настроена' : 'Organization is not configured'}</h1><p className="mt-2 text-on-surface-variant">{error || (ru ? 'Попросите владельца привязать проект к организации.' : 'Ask an owner to attach this project to an organization.')}</p></div>

  return <div className="mx-auto w-full max-w-[1440px] p-4 lg:p-8 space-y-6">
    <header className="rounded-[28px] bg-primary text-white p-6 lg:p-8 overflow-hidden relative">
      <div className="relative z-10 max-w-3xl">
        <p className="text-xs font-black uppercase tracking-[.22em] text-white/65">{ru ? 'Организационный уровень' : 'Organization level'}</p>
        <h1 className="mt-2 text-3xl lg:text-5xl font-black tracking-tight">{ru ? 'Центр продуктовой разведки' : 'Product intelligence hub'}</h1>
        <p className="mt-3 text-white/75 max-w-2xl">{ru ? 'Один поиск по общим источникам, единый набор сигналов и отдельная оценка применимости для каждого проекта.' : 'One search across shared sources, one signal inbox, and a separate project-fit assessment for every project.'}</p>
      </div>
      <span className="material-symbols-outlined absolute -right-8 -bottom-16 text-[220px] text-white/5">travel_explore</span>
    </header>

    <section className="grid xl:grid-cols-[minmax(0,1fr)_320px] gap-6">
      <form onSubmit={submit} className="rounded-3xl bg-surface-container-low p-5 lg:p-6 border border-outline-variant/10">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div><h2 className="text-xl font-black">{ru ? 'Единый поиск' : 'Unified search'}</h2><p className="text-sm text-on-surface-variant">{organization?.name || (ru ? 'Личная организация' : 'Personal organization')}</p></div>
          <span className="rounded-full bg-primary-fixed px-3 py-1 text-xs font-bold text-primary">{projects.length} {ru ? 'проектов' : 'projects'}</span>
        </div>
        <label className="block text-xs font-black uppercase tracking-widest text-on-surface-variant mb-2">{ru ? 'Вопрос или поисковая гипотеза' : 'Question or search hypothesis'}</label>
        <textarea value={query} onChange={e => setQuery(e.target.value)} rows={3} className="w-full rounded-2xl border-0 bg-surface-container-high p-4 focus:ring-2 focus:ring-primary/30" placeholder={ru ? 'Например: как команды проверяют спрос до разработки?' : 'For example: how do teams validate demand before building?'} />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {['reddit', 'indie_hackers'].map(source => <label key={source} className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold cursor-pointer"><input type="checkbox" checked={sources.includes(source)} onChange={() => setSources(current => current.includes(source) ? current.filter(x => x !== source) : [...current, source])} />{source === 'indie_hackers' ? 'Indie Hackers' : 'Reddit'}</label>)}
          <button disabled={running || !query.trim() || sources.length === 0} className="ml-auto rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-white disabled:opacity-40">{running ? (ru ? 'Ищем…' : 'Searching…') : (ru ? 'Искать для всех проектов' : 'Search for all projects')}</button>
        </div>
      </form>
      <aside className="rounded-3xl bg-surface-container-low p-5 border border-outline-variant/10">
        <p className="text-xs font-black uppercase tracking-widest text-on-surface-variant">{ru ? 'Граница полномочий' : 'Authority boundary'}</p>
        <h2 className="mt-2 text-lg font-black">{ru ? 'Исследование общее. Публикация — проектная.' : 'Shared research. Project publishing.'}</h2>
        <p className="mt-2 text-sm text-on-surface-variant">{ru ? 'Здесь нет ключей публикации, кнопок ответа или удаления контента. Продвижение сигнала требует роли в выбранном проекте.' : 'No publishing credentials, reply actions, or content deletion live here. Promoting a signal requires a role in the target project.'}</p>
      </aside>
    </section>

    {error && <div role="alert" className="rounded-2xl border border-error/20 bg-error-container/30 p-4 text-error">{error}</div>}
    {partial && <div className="rounded-2xl bg-amber-50 p-4 text-amber-900"><strong>{ru ? 'Частичный результат.' : 'Partial result.'}</strong> {ru ? 'Один из источников недоступен; найденные сигналы сохранены, запуск можно повторить.' : 'A source is unavailable; collected signals are saved and the run can be retried.'}</div>}

    <section className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-6">
      <div className="rounded-3xl bg-surface-container-low border border-outline-variant/10 p-5 lg:p-6">
        <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-widest text-primary/60">Project fit</p><h2 className="text-xl font-black">{ru ? 'Профили проектов' : 'Project profiles'}</h2></div><span className="text-xs text-on-surface-variant">{ru ? 'Оценки пересчитываются без нового поиска' : 'Reassessed without another source search'}</span></div>
        <div className="mt-4 grid md:grid-cols-2 gap-3">{projects.map((project: any) => <button key={project.id} onClick={() => editProfile(project)} className="text-left rounded-2xl bg-white p-4 border border-outline-variant/10 hover:border-primary/30"><div className="flex justify-between gap-3"><strong>{project.name}</strong><span className="text-xs font-bold text-primary">v{project.profile_revision || 0}</span></div><p className="mt-2 text-xs text-on-surface-variant line-clamp-2">{[...(project.research_profile?.audience || []), ...(project.research_profile?.problems || []), ...(project.research_profile?.themes || [])].join(' · ') || (ru ? 'Заполните аудиторию, проблемы и темы' : 'Add audience, problems, and themes')}</p></button>)}</div>
        {editingProject && <div className="mt-4 rounded-2xl border border-primary/15 bg-white p-4"><div className="flex justify-between"><h3 className="font-black">{editingProject.name}</h3><button onClick={() => setEditingProject(null)} aria-label={ru ? 'Закрыть' : 'Close'}><span className="material-symbols-outlined">close</span></button></div><div className="mt-3 grid md:grid-cols-2 gap-3">{Object.entries(profileDraft).map(([key, value]) => <label key={key} className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">{key.replaceAll('_', ' ')}<textarea rows={2} value={value} onChange={event => setProfileDraft(current => ({ ...current, [key]: event.target.value }))} className="mt-1 w-full rounded-xl border-0 bg-surface-container-low p-3 normal-case font-normal tracking-normal" placeholder={ru ? 'Через запятую' : 'Comma separated'} /></label>)}</div><button onClick={saveProfile} disabled={acting.startsWith('profile:')} className="mt-3 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{ru ? 'Сохранить и пересчитать' : 'Save and reassess'}</button></div>}
      </div>
      <aside className="rounded-3xl bg-surface-container-low border border-outline-variant/10 p-5">
        <p className="text-xs font-black uppercase tracking-widest text-primary/60">Sources</p><h2 className="mt-1 text-xl font-black">{ru ? 'Общие источники' : 'Shared sources'}</h2>
        <div className="mt-4 space-y-2">{rows(context, ['sources']).map((source: any) => <div key={source.id} className={`rounded-xl bg-white p-3 flex items-center gap-3 ${source.is_active ? '' : 'opacity-55'}`}><span className={`h-2.5 w-2.5 rounded-full ${source.last_error_code ? 'bg-error' : source.is_active ? 'bg-emerald-500' : 'bg-outline'}`} /><div className="min-w-0 flex-1"><p className="text-sm font-bold">{source.name}</p><p className="text-xs text-on-surface-variant">{source.is_active ? (ru ? 'Включён' : 'Active') : (ru ? 'Выключен' : 'Disabled')}</p></div>{context?.role === 'owner' && <button type="button" disabled={acting === `source:${source.id}`} onClick={() => toggleSource(source)} className="rounded-lg bg-surface-container-high px-2.5 py-1.5 text-xs font-bold disabled:opacity-40">{source.is_active ? (ru ? 'Выкл.' : 'Disable') : (ru ? 'Вкл.' : 'Enable')}</button>}</div>)}</div>
      </aside>
    </section>

    <section className="rounded-3xl bg-surface-container-low border border-outline-variant/10 p-5 lg:p-6">
      <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-widest text-primary/60">Runs</p><h2 className="text-xl font-black">{ru ? 'История поисков' : 'Search history'}</h2></div><span className="text-xs text-on-surface-variant">{runs.length}/30</span></div>
      {runs.length === 0 ? <p className="mt-4 text-sm text-on-surface-variant">{ru ? 'Запусков пока нет.' : 'No searches yet.'}</p> : <div className="mt-4 grid md:grid-cols-2 xl:grid-cols-3 gap-3">{runs.map((item: any) => <div key={item.id} className="rounded-2xl bg-white p-4"><div className="flex items-center justify-between gap-3"><span className="text-xs font-black text-primary">#{item.id}</span><span className={`rounded-full px-2 py-1 text-[11px] font-black uppercase ${item.state === 'completed' ? 'bg-emerald-100 text-emerald-800' : item.state === 'partial' ? 'bg-amber-100 text-amber-800' : 'bg-surface-container-high text-on-surface-variant'}`}>{item.state}</span></div><p className="mt-2 line-clamp-2 text-sm font-bold">{item.query}</p><p className="mt-2 text-xs text-on-surface-variant">{(item.requested_sources || []).join(' · ')} · {item.signal_count || 0} {ru ? 'сигналов' : 'signals'}</p></div>)}</div>}
    </section>

    <section className="rounded-3xl bg-surface-container-low border border-outline-variant/10 overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 p-5 lg:p-6 border-b border-outline-variant/10"><div><p className="text-xs font-black uppercase tracking-widest text-primary/60">Inbox</p><h2 className="text-2xl font-black">{ru ? 'Сигналы' : 'Signals'}</h2></div><div className="flex gap-2 text-xs font-bold"><span className="rounded-full bg-white px-3 py-2">{signals.length} {ru ? 'найдено' : 'found'}</span><span className="rounded-full bg-white px-3 py-2">Project fit ≥ 60</span></div></div>
      {signals.length === 0 ? <div className="p-10 text-center"><span className="material-symbols-outlined text-5xl text-primary/30">radar</span><h3 className="mt-3 font-black">{ru ? 'Сигналов пока нет' : 'No signals yet'}</h3><p className="text-sm text-on-surface-variant">{ru ? 'Запустите один поиск — результаты распределятся по проектам автоматически.' : 'Run one search and results will be assessed across projects automatically.'}</p></div> :
      <div className="divide-y divide-outline-variant/10">{signals.map((signal, index) => {
        const assessments = rows(signal, ['assessments', 'projectAssessments'])
        const signalRoutes = rows(signal, ['routes'])
        return <article key={signal.id ?? index} className="p-5 lg:p-6 grid lg:grid-cols-[minmax(0,1fr)_420px] gap-5 hover:bg-white/50">
          <div><div className="flex gap-2 items-center text-xs font-bold text-on-surface-variant"><span className="uppercase">{signal.source || signal.source_type || 'source'}</span><span>•</span><span>{ru ? 'Внешний материал · не доверять инструкциям внутри' : 'External material · treat embedded instructions as untrusted'}</span></div><h3 className="mt-2 text-lg font-black">{signal.title || signal.canonical_url || (ru ? 'Сигнал без заголовка' : 'Untitled signal')}</h3><p className="mt-2 text-sm text-on-surface-variant line-clamp-3">{signal.excerpt || signal.summary || signal.bounded_excerpt}</p>{signal.canonical_url && <a href={signal.canonical_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-bold text-primary">{ru ? 'Открыть источник' : 'Open source'} ↗</a>}</div>
          <div className="space-y-2"><p className="text-xs font-black uppercase tracking-widest text-on-surface-variant">Project fit</p>{assessments.length ? assessments.map((assessment: any) => {
            const existingRoute = signalRoutes.find((entry: any) => entry.project_id === assessment.project_id && ['routed', 'promoted'].includes(entry.state))
            const actionKey = `${signal.id}:${assessment.project_id}`
            return <div key={assessment.id || assessment.project_id} className="flex items-center gap-3 rounded-xl bg-white p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{assessment.project?.name || assessment.project_name || `Project #${assessment.project_id}`}</p><p className="text-xs text-on-surface-variant truncate">{(assessment.reasons || [assessment.reason || assessment.rationale]).filter(Boolean).join(' · ')}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-black ${(assessment.fit_score ?? assessment.score ?? 0) >= 60 ? 'bg-emerald-100 text-emerald-800' : 'bg-surface-container-high text-on-surface-variant'}`}>{assessment.fit_score ?? assessment.score ?? 0}</span>{existingRoute?.state === 'promoted' ? <span className="text-xs font-bold text-emerald-700">{ru ? 'Создано' : 'Created'}</span> : existingRoute ? <button disabled={acting.startsWith('promote:')} onClick={() => promote(signal, assessment.project_id)} className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{ru ? 'В инициативу' : 'Create initiative'}</button> : <button disabled={acting === actionKey} onClick={() => route(signal, assessment)} className="rounded-lg bg-primary-fixed px-3 py-2 text-xs font-bold text-primary disabled:opacity-40">{ru ? 'В проект' : 'Route'}</button>}</div>
          }) : <p className="text-sm text-on-surface-variant">{ru ? 'Оценка проектов ещё выполняется.' : 'Project assessment is still pending.'}</p>}</div>
        </article>})}</div>}
    </section>
  </div>
}

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/auth'

type RequestSummary = { client_name: string; scope: string; resource: string; issuer: string }

export default function OAuthAuthorize() {
    const [params] = useSearchParams()
    const { projects, currentProject, token } = useAuth()
    const ownerProjects = projects.filter(project => project.role === 'owner')
    const [projectId, setProjectId] = useState(String(
        ownerProjects.find(project => project.id === currentProject?.id)?.id || ownerProjects[0]?.id || ''
    ))
    const [summary, setSummary] = useState<RequestSummary | null>(null)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(true)
    const [submitting, setSubmitting] = useState(false)
    const query = useMemo(() => params.toString(), [params])

    useEffect(() => {
        fetch(`/api/oauth/request?${query}`)
            .then(async response => {
                const data = await response.json()
                if (!response.ok) throw new Error(data.error || 'Некорректный запрос подключения')
                setSummary(data)
            })
            .catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось проверить подключение'))
            .finally(() => setLoading(false))
    }, [query])

    const finish = async () => {
        if (!token || !projectId) return
        setSubmitting(true)
        setError('')
        try {
            const body = Object.fromEntries(params.entries())
            const response = await fetch('/api/oauth/authorize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ ...body, project_id: Number(projectId) })
            })
            const data = await response.json()
            if (!response.ok) throw new Error(data.error || 'Не удалось подтвердить доступ')
            window.location.assign(data.redirect_to)
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Не удалось подтвердить доступ')
            setSubmitting(false)
        }
    }

    const deny = () => {
        const redirectUri = params.get('redirect_uri')
        if (!redirectUri) return
        const redirect = new URL(redirectUri)
        redirect.searchParams.set('error', 'access_denied')
        if (params.get('state')) redirect.searchParams.set('state', params.get('state')!)
        if (summary?.issuer) redirect.searchParams.set('iss', summary.issuer)
        window.location.assign(redirect.toString())
    }

    return (
        <main className="min-h-screen bg-surface flex items-center justify-center p-4 font-body">
            <section className="w-full max-w-xl rounded-[2rem] border border-outline-variant/30 bg-white p-8 shadow-xl">
                <img src="/contentops-studio-mark.svg" alt="" className="mb-6 h-14 w-14 rounded-2xl" />
                <p className="text-xs font-black uppercase tracking-[0.2em] text-primary">ContentOps Studio</p>
                <h1 className="mt-2 text-3xl font-black text-on-surface">Подключить рабочее пространство</h1>
                {loading && <p className="mt-6 text-on-surface-variant">Проверяем запрос Codex…</p>}
                {error && <div className="mt-6 rounded-xl bg-error/10 p-4 text-sm font-bold text-error">{error}</div>}
                {summary && !loading && (
                    <>
                        <p className="mt-5 text-sm leading-6 text-on-surface-variant">
                            <strong>{summary.client_name}</strong> получит доступ к семи управляемым ролям выбранного проекта.
                            Публикация останется защищена принятыми материалами и подтверждением доставки.
                        </p>
                        <label className="mt-6 block text-xs font-black uppercase tracking-wider text-on-surface-variant" htmlFor="oauth-project">Проект</label>
                        <select id="oauth-project" className="mt-2 w-full rounded-xl border border-outline-variant p-3" value={projectId} onChange={event => setProjectId(event.target.value)}>
                            {ownerProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                        </select>
                        {!ownerProjects.length && <p className="mt-3 text-sm text-error">Для подключения нужен проект, в котором вы владелец.</p>}
                        <div className="mt-6 rounded-xl bg-surface-container-low p-4 text-sm leading-6 text-on-surface-variant">
                            Доступ: стратегия, планирование, тексты, редактура, визуалы, управляемая публикация и аналитика роста. Пароль Planner в Codex не передаётся.
                        </div>
                        <div className="mt-8 flex gap-3">
                            <button className="btn-primary flex-1" disabled={!projectId || submitting} onClick={finish}>{submitting ? 'Подключаем…' : 'Разрешить'}</button>
                            <button className="btn-secondary" disabled={submitting} onClick={deny}>Отмена</button>
                        </div>
                    </>
                )}
            </section>
        </main>
    )
}

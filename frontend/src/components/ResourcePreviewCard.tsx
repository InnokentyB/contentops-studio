import ContentMarkupRenderer from './ContentMarkupRenderer'
import type { ApiJson } from '../types/api-json'
import { useLocale } from '../i18n/locale'

type JsonRecord = Record<string, ApiJson>

type ResourcePreviewCardProps = {
    entry?: JsonRecord | null
    title?: string
    className?: string
    emptyMessage?: string
}

function resolveContent(entry?: JsonRecord | null) {
    if (!entry) return ''
    if (typeof entry.content === 'string' && entry.content.trim()) return entry.content
    if (typeof entry.asset?.content === 'string' && entry.asset.content.trim()) return entry.asset.content
    return ''
}

function resolveUrl(entry?: JsonRecord | null) {
    if (!entry) return ''
    const candidates = [
        entry.preview_url,
        entry.url,
        entry.asset?.url,
        entry.asset?.target_url,
        entry.asset?.public_url
    ]

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim()
        }
    }

    return ''
}

function resolveName(entry: JsonRecord | null | undefined, fallback: string) {
    if (!entry) return fallback
    return entry.file_name
        || entry.asset?.path?.split('/')?.pop()
        || entry.relative_path
        || entry.url
        || entry.ref
        || fallback
}

function inferContentType(entry?: JsonRecord | null) {
    const explicit = entry?.content_type || entry?.asset?.content_type || entry?.mime_type || entry?.asset?.mime_type
    if (typeof explicit === 'string' && explicit.trim()) {
        return explicit.toLowerCase()
    }

    const hint = String(
        entry?.file_name
        || entry?.relative_path
        || entry?.url
        || entry?.preview_url
        || entry?.asset?.path
        || entry?.asset?.url
        || entry?.asset?.target_url
        || ''
    ).toLowerCase()

    if (/\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/.test(hint)) return 'image/*'
    if (/\.(md|markdown)(\?|$)/.test(hint)) return 'text/markdown'
    if (/\.(html|htm)(\?|$)/.test(hint)) return 'text/html'
    if (/\.(txt|log)(\?|$)/.test(hint)) return 'text/plain'
    if (/\.(json)(\?|$)/.test(hint)) return 'application/json'
    if (/\.(ya?ml)(\?|$)/.test(hint)) return 'application/yaml'
    if (/\.(pdf)(\?|$)/.test(hint)) return 'application/pdf'

    const content = resolveContent(entry)
    if (content.startsWith('data:image/')) return 'image/*'
    if (/<[a-z][\s\S]*>/i.test(content)) return 'text/html'
    if (content.trim()) return 'text/markdown'
    return 'application/octet-stream'
}

function isImageType(contentType: string, url: string, content: string) {
    return contentType.startsWith('image/')
        || contentType === 'image/*'
        || /\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i.test(url)
        || content.startsWith('data:image/')
}

function isTextRenderable(contentType: string, content: string) {
    if (!content.trim()) return false
    return contentType.startsWith('text/')
        || contentType.includes('json')
        || contentType.includes('yaml')
}

export default function ResourcePreviewCard({
    entry,
    title,
    className = '',
    emptyMessage
}: ResourcePreviewCardProps) {
    const { locale } = useLocale()
    const resolvedEmptyMessage = emptyMessage || (locale === 'ru' ? 'Ресурс пока недоступен.' : 'Resource is currently unavailable.')
    const content = resolveContent(entry)
    const url = resolveUrl(entry)
    const contentType = inferContentType(entry)
    const name = title || resolveName(entry, locale === 'ru' ? 'Ресурс' : 'Resource')

    if (!entry) {
        return (
            <div className={`rounded-2xl bg-white px-4 py-4 text-sm text-on-surface-variant ${className}`}>
                {resolvedEmptyMessage}
            </div>
        )
    }

    if (isImageType(contentType, url, content) && (url || content.startsWith('data:image/'))) {
        const imageSrc = url || content
        return (
            <div className={`space-y-3 ${className}`}>
                <div className="rounded-2xl overflow-hidden border border-outline-variant/10 bg-white">
                    <img src={imageSrc} alt={name} className="w-full h-auto object-contain bg-white" />
                </div>
                <div className="rounded-2xl bg-white px-4 py-3 text-xs leading-6 text-on-surface-variant">
                    <div className="font-bold text-on-surface">{name}</div>
                    {url && (
                        <a href={url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-2 text-primary hover:underline break-all">
                            <span className="material-symbols-outlined text-sm">open_in_new</span>
                            {locale === 'ru' ? 'Открыть изображение' : 'Open image'}
                        </a>
                    )}
                </div>
            </div>
        )
    }

    if (isTextRenderable(contentType, content)) {
        return (
            <ContentMarkupRenderer
                content={content}
                contentType={contentType.includes('html') ? 'html' : 'auto'}
                title={name}
                emptyMessage={emptyMessage}
                className={className}
            />
        )
    }

    if (url) {
        return (
            <div className={`rounded-2xl bg-white px-4 py-4 text-sm space-y-3 ${className}`}>
                <div className="font-bold text-on-surface">{name}</div>
                <div className="text-xs text-on-surface-variant">
                    {locale === 'ru' ? 'Тип' : 'Type'}: {contentType}
                </div>
                <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline break-all"
                >
                    <span className="material-symbols-outlined text-base">open_in_new</span>
                    {locale === 'ru' ? 'Открыть файл' : 'Open file'}
                </a>
            </div>
        )
    }

    return (
        <div className={`rounded-2xl bg-white px-4 py-4 text-sm text-on-surface-variant ${className}`}>
            {emptyMessage}
        </div>
    )
}

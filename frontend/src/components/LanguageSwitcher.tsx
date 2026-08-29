import { useLocale } from '../i18n/LocaleContext'

export default function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useLocale()
  return (
    <div className={`inline-flex rounded-full border border-outline-variant/20 bg-white/80 p-1 shadow-sm ${compact ? 'text-[10px]' : 'text-xs'}`} role="group" aria-label="Interface language">
      {(['en', 'ru'] as const).map((item) => (
        <button key={item} type="button" onClick={() => setLocale(item)} aria-pressed={locale === item}
          className={`rounded-full px-2.5 py-1.5 font-black transition-colors ${locale === item ? 'bg-primary text-white' : 'text-on-surface-variant hover:text-primary'}`}>
          {item.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

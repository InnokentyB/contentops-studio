import { createContext, useContext } from 'react'

export type Locale = 'en' | 'ru'
export type LocaleContextValue = { locale: Locale; setLocale: (locale: Locale) => void; t: (key: string) => string }

export const LocaleContext = createContext<LocaleContextValue | null>(null)
export const defaultLocale: Locale = 'en'

export function useLocale() {
  const value = useContext(LocaleContext)
  if (!value) throw new Error('useLocale must be used inside LocaleProvider')
  return value
}

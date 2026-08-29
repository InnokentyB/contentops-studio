import { createContext, useContext, useEffect, useMemo, useState } from 'react'

export type Locale = 'en' | 'ru'
type Messages = Record<string, string>

const messages: Record<Locale, Messages> = {
  en: {
    workspaceSubtitle: 'Content operations workspace', currentProject: 'Current project',
    overview: 'Overview', operationalPlan: 'Operational plan', metrics: 'Metrics', research: 'Research',
    templates: 'Templates', publicationPlan: 'Publication plan', help: 'Help', projectSettings: 'Project settings',
    newPost: 'New post', signOut: 'Sign out', user: 'User', workspaceAccess: 'Workspace access',
    assistant: 'Operations assistant', search: 'Search…', publications: 'Publications', calendar: 'Calendar',
    openOverview: 'Open overview', openNavigation: 'Open navigation', closeNavigation: 'Close navigation', collapseSidebar: 'Collapse sidebar', expandSidebar: 'Expand sidebar',
    email: 'Email', password: 'Password', signIn: 'Sign in', signingIn: 'Signing in…',
    signInError: 'Unable to sign in', noAccess: 'Need access?', requestAccess: 'Request access',
    accessRequest: 'Request access', accountSubtitle: 'Create a workspace account', createPassword: 'Create password',
    createAccount: 'Create account', creatingAccount: 'Creating account…', registerError: 'Unable to create the account',
    alreadyHaveAccess: 'Already have access?'
  },
  ru: {
    workspaceSubtitle: 'Рабочая область контентных операций', currentProject: 'Текущий проект',
    overview: 'Обзор', operationalPlan: 'Операционный план', metrics: 'Метрики', research: 'Исследования',
    templates: 'Шаблоны', publicationPlan: 'План публикаций', help: 'Справка', projectSettings: 'Настройки проекта',
    newPost: 'Новый пост', signOut: 'Выйти', user: 'Пользователь', workspaceAccess: 'Рабочий доступ',
    assistant: 'Когнитивный помощник', search: 'Поиск…', publications: 'Публикации', calendar: 'Календарь',
    openOverview: 'Открыть обзор', openNavigation: 'Открыть навигацию', closeNavigation: 'Закрыть навигацию', collapseSidebar: 'Свернуть боковое меню', expandSidebar: 'Развернуть боковое меню',
    email: 'Почта', password: 'Пароль', signIn: 'Войти', signingIn: 'Входим…',
    signInError: 'Не удалось войти', noAccess: 'Нет доступа?', requestAccess: 'Запросить доступ',
    accessRequest: 'Запрос доступа', accountSubtitle: 'Создание рабочей учётной записи', createPassword: 'Создать пароль',
    createAccount: 'Создать учётную запись', creatingAccount: 'Создаём учётную запись…', registerError: 'Не удалось зарегистрироваться',
    alreadyHaveAccess: 'Уже есть доступ?'
  }
}

type LocaleContextValue = { locale: Locale; setLocale: (locale: Locale) => void; t: (key: string) => string }
const LocaleContext = createContext<LocaleContextValue | null>(null)
export const defaultLocale: Locale = 'en'

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const stored = localStorage.getItem('planner-locale')
    return stored === 'ru' || stored === 'en' ? stored : defaultLocale
  })
  const setLocale = (next: Locale) => {
    localStorage.setItem('planner-locale', next)
    setLocaleState(next)
  }
  useEffect(() => { document.documentElement.lang = locale }, [locale])
  const value = useMemo(() => ({ locale, setLocale, t: (key: string) => messages[locale][key] || messages.en[key] || key }), [locale])
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale() {
  const value = useContext(LocaleContext)
  if (!value) throw new Error('useLocale must be used inside LocaleProvider')
  return value
}

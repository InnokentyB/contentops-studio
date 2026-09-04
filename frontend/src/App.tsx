import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext'
import { useAuth } from './context/auth'
import Login from './pages/Login'
import Register from './pages/Register'
import OAuthAuthorize from './pages/OAuthAuthorize'
import Landing from './pages/Landing'
import './index.css'

import Layout from './components/Layout'
import { LocaleProvider } from './i18n/LocaleContext'
import { useLocale } from './i18n/locale'

const queryClient = new QueryClient()
const WeekDetail = lazy(() => import('./pages/WeekDetail'))
const PostEditor = lazy(() => import('./pages/PostEditor'))
const Settings = lazy(() => import('./pages/Settings'))
const V2Dashboard = lazy(() => import('./pages/V2Dashboard'))
const V2WeekDetail = lazy(() => import('./pages/V2WeekDetail'))
const Guide = lazy(() => import('./pages/Guide'))
const PublicationTasks = lazy(() => import('./pages/PublicationTasks'))
const ProjectWorkspace = lazy(() => import('./pages/ProjectWorkspace'))
const Parsers = lazy(() => import('./pages/Parsers'))
const ChannelWorkspace = lazy(() => import('./pages/ChannelWorkspace'))
const PostPublicationAnalytics = lazy(() => import('./pages/PostPublicationAnalytics'))
const SavedRecipesLibrary = lazy(() => import('./pages/SavedRecipesLibrary'))
const OperationalCalendar = lazy(() => import('./pages/OperationalCalendar'))


function AppContent() {
  const { isAuthenticated } = useAuth();
  const { locale } = useLocale();
  const location = useLocation();

  if (location.pathname === '/product') {
    return <Landing />
  }

  if (!isAuthenticated) {
    const oauthReturnTo = `${window.location.pathname}${window.location.search}`
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/oauth/authorize" element={<Navigate to={`/login?returnTo=${encodeURIComponent(oauthReturnTo)}`} replace />} />
        <Route path="/" element={<Landing />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Suspense fallback={<div role="status" className="p-6 text-on-surface-variant">{locale === 'ru' ? 'Загрузка рабочей области…' : 'Loading workspace…'}</div>}>
        <Routes>
        <Route path="/projects" element={<ProjectWorkspace />} />
        <Route path="/channels/:channelId" element={<ChannelWorkspace />} />
        <Route path="/parsers" element={<Parsers />} />
        <Route path="/recipes" element={<SavedRecipesLibrary />} />
        <Route path="/analytics" element={<PostPublicationAnalytics />} />

        {/* V2 Orchestrator Routes */}
        <Route path="/orchestrator" element={<V2Dashboard />} />
        <Route path="/v2/weeks/:id" element={<V2WeekDetail />} />

        {/* V1 Routes */}
        <Route path="/" element={<Navigate to="/projects" />} />
        <Route path="/weeks/:id" element={<WeekDetail />} />
        <Route path="/posts/:id" element={<PostEditor />} />

        <Route path="/settings" element={<Settings />} />
        <Route path="/oauth/authorize" element={<OAuthAuthorize />} />
        <Route path="/publication-tasks" element={<PublicationTasks />} />
        <Route path="/guide" element={<Guide />} />
        <Route path="/calendar" element={<Suspense fallback={<div role="status" className="p-6 text-on-surface-variant">{locale === 'ru' ? 'Загрузка операционного плана…' : 'Loading operational plan…'}</div>}><OperationalCalendar /></Suspense>} />
        <Route path="/weeks" element={<Navigate to="/publication-tasks" replace />} />
        <Route path="*" element={<Navigate to="/projects" />} />
        </Routes>
      </Suspense>
    </Layout>
  )
}

import { ToastProvider } from './components/ToastContainer'

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <BrowserRouter>
          <AuthProvider>
            <ToastProvider>
              <AppContent />
            </ToastProvider>
          </AuthProvider>
        </BrowserRouter>
      </LocaleProvider>
    </QueryClientProvider>
  )
}

export default App

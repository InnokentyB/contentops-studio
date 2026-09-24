import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext'
import { useAuth } from './context/auth'
import Layout from './components/Layout'
import { LocaleProvider } from './i18n/LocaleContext'
import { useLocale } from './i18n/locale'
import { ToastProvider } from './components/ToastContainer'
import './index.css'

const queryClient = new QueryClient()

// Lazy-loaded pages for optimal bundle splitting and fast initial page loads
const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const ProjectWorkspace = lazy(() => import('./pages/ProjectWorkspace'))
const ChannelWorkspace = lazy(() => import('./pages/ChannelWorkspace'))
const Parsers = lazy(() => import('./pages/Parsers'))
const OrganizationIntelligence = lazy(() => import('./pages/OrganizationIntelligence'))
const SavedRecipesLibrary = lazy(() => import('./pages/SavedRecipesLibrary'))
const PostPublicationAnalytics = lazy(() => import('./pages/PostPublicationAnalytics'))
const V2Dashboard = lazy(() => import('./pages/V2Dashboard'))
const V2WeekDetail = lazy(() => import('./pages/V2WeekDetail'))
const WeekDetail = lazy(() => import('./pages/WeekDetail'))
const PostEditor = lazy(() => import('./pages/PostEditor'))
const Settings = lazy(() => import('./pages/Settings'))
const PublicationTasks = lazy(() => import('./pages/PublicationTasks'))
const Guide = lazy(() => import('./pages/Guide'))
const OperationalCalendar = lazy(() => import('./pages/OperationalCalendar'))

function PageLoadingFallback() {
  const { locale } = useLocale()
  return (
    <div role="status" className="min-h-[50vh] flex flex-col items-center justify-center gap-3 p-6 text-on-surface-variant">
      <div className="w-8 h-8 border-3 border-primary/20 border-t-primary rounded-full animate-spin" />
      <span className="text-sm font-medium">
        {locale === 'ru' ? 'Загрузка страницы…' : 'Loading page…'}
      </span>
    </div>
  )
}

function AppContent() {
  const { isAuthenticated } = useAuth();
  const { locale } = useLocale();

  if (!isAuthenticated) {
    return (
      <Suspense fallback={<PageLoadingFallback />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="*" element={<Navigate to="/login" />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <Layout>
      <Suspense fallback={<PageLoadingFallback />}>
        <Routes>
          <Route path="/projects" element={<ProjectWorkspace />} />
          <Route path="/channels/:channelId" element={<ChannelWorkspace />} />
          <Route path="/parsers" element={<Parsers />} />
          <Route path="/intelligence" element={<OrganizationIntelligence />} />
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
          <Route path="/publication-tasks" element={<PublicationTasks />} />
          <Route path="/guide" element={<Guide />} />
          <Route 
            path="/calendar" 
            element={
              <Suspense fallback={<div role="status" className="p-6 text-on-surface-variant">{locale === 'ru' ? 'Загрузка операционного плана…' : 'Loading operational plan…'}</div>}>
                <OperationalCalendar />
              </Suspense>
            } 
          />
          <Route path="/weeks" element={<Navigate to="/publication-tasks" replace />} />
          <Route path="*" element={<Navigate to="/projects" />} />
        </Routes>
      </Suspense>
    </Layout>
  )
}

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

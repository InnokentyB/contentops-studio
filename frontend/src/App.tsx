import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './context/AuthContext'
import WeekDetail from './pages/WeekDetail'
import PostEditor from './pages/PostEditor'
import Settings from './pages/Settings'
import Login from './pages/Login'
import Register from './pages/Register'
import V2Dashboard from './pages/V2Dashboard'
import V2WeekDetail from './pages/V2WeekDetail'
import Guide from './pages/Guide'
import PublicationTasks from './pages/PublicationTasks'
import ProjectWorkspace from './pages/ProjectWorkspace'
import Parsers from './pages/Parsers'
import ChannelWorkspace from './pages/ChannelWorkspace'
import PostPublicationAnalytics from './pages/PostPublicationAnalytics'
import SavedRecipesLibrary from './pages/SavedRecipesLibrary'
import './index.css'

import Layout from './components/Layout'
import { LocaleProvider } from './i18n/LocaleContext'

const queryClient = new QueryClient()
const OperationalCalendar = lazy(() => import('./pages/OperationalCalendar'))


function AppContent() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    );
  }

  return (
    <Layout>
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
        <Route path="/publication-tasks" element={<PublicationTasks />} />
        <Route path="/guide" element={<Guide />} />
        <Route path="/calendar" element={<Suspense fallback={<div role="status" className="p-6 text-on-surface-variant">Загрузка операционного плана…</div>}><OperationalCalendar /></Suspense>} />
        <Route path="/weeks" element={<Navigate to="/publication-tasks" replace />} />
        <Route path="*" element={<Navigate to="/projects" />} />
      </Routes>
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

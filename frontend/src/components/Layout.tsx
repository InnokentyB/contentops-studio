import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../i18n/LocaleContext';
import LanguageSwitcher from './LanguageSwitcher';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { user, projects, currentProject, setCurrentProject, logout } = useAuth();
  const { t, locale } = useLocale();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const savedPreference = localStorage.getItem('planner-sidebar-collapsed');

    if (savedPreference !== null) {
      return savedPreference === 'true';
    }

    // Keep the task workspace usable on laptop-sized screens by default.
    return window.matchMedia('(max-width: 1535px)').matches;
  });

  useEffect(() => {
    localStorage.setItem('planner-sidebar-collapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const isActive = (path: string) => {
    if (path === '/projects') {
      return location.pathname === '/projects' || location.pathname.startsWith('/channels/');
    }

    return location.pathname === path;
  };

  const navItems = [
    { label: t('overview'), path: '/projects', icon: 'folder_open' },
    { label: t('operationalPlan'), path: '/calendar', icon: 'calendar_month' },
    { label: t('metrics'), path: '/analytics', icon: 'monitoring' },
    { label: t('research'), path: '/parsers', icon: 'hub' },
    { label: t('templates'), path: '/recipes', icon: 'book_2' },
    { label: t('publicationPlan'), path: '/publication-tasks', icon: 'publish' },
    { label: t('help'), path: '/guide', icon: 'help_outline' },
    { label: t('projectSettings'), path: '/settings', icon: 'settings' },
  ];

  const renderSidebar = (isMobile = false) => {
      const compact = !isMobile && sidebarCollapsed;

      return (
      <aside
        className={`bg-surface-container-low flex flex-col border-r-0 border-outline-variant/10 transition-[width,padding] duration-200 ease-out ${isMobile ? 'h-full w-full py-6 px-4' : compact ? 'w-20 h-full py-6 px-2' : 'w-64 h-full py-8 px-4'}`}
      >
        <div className={`${compact ? 'mb-8 flex flex-col items-center' : 'mb-10 px-2 space-y-4'}`}>
          <Link
            to="/projects"
            className={`${compact ? 'w-11 h-11 rounded-2xl bg-primary-fixed text-primary flex items-center justify-center' : 'block hover:opacity-80'} transition-opacity`}
            aria-label={compact ? 'Project Alpha' : undefined}
            title={compact ? 'Project Alpha' : undefined}
          >
            {compact ? (
              <span className="material-symbols-outlined" aria-hidden="true">dashboard</span>
            ) : (
              <>
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-primary/60">Workspace</div>
                <h1 className="mt-2 text-2xl font-black text-primary tracking-tighter font-headline">Project Alpha</h1>
                <p className="text-xs text-on-surface-variant font-label mt-1">{t('workspaceSubtitle')}</p>
              </>
            )}
          </Link>
          
          {/* Project Switcher */}
          {projects.length > 0 && !compact && (
            <div className="relative group">
              <div className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant">{t('currentProject')}</div>
              <select
                className="w-full appearance-none bg-surface-container-high hover:bg-surface-container-highest border border-outline-variant/10 rounded-xl py-3 pl-4 pr-10 text-sm font-bold text-on-surface cursor-pointer focus:ring-2 focus:ring-primary/20 transition-all outline-none shadow-sm group-hover:shadow-md"
                value={currentProject?.id || ''}
                onChange={(e) => {
                  const selectedId = parseInt(e.target.value);
                  const selectedProject = projects.find(p => p.id === selectedId);
                  if (selectedProject) {
                    setCurrentProject(selectedProject);
                    setMobileNavOpen(false);
                  }
                }}
              >
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none group-hover:text-primary transition-colors text-lg">
                expand_more
              </span>
            </div>
          )}
        </div>
        
        <nav className="flex-1 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center rounded-lg transition-all duration-200 group ${compact ? 'justify-center px-2 py-3' : 'gap-3 px-4 py-3'} ${
                isActive(item.path)
                  ? 'bg-primary-fixed text-on-primary-fixed font-bold'
                  : 'text-on-surface-variant hover:text-primary hover:bg-surface-container-high'
              }`}
              aria-label={compact ? item.label : undefined}
              title={compact ? item.label : undefined}
              onClick={isMobile ? () => setMobileNavOpen(false) : undefined}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              {!compact && <span className="font-label">{item.label}</span>}
            </Link>
          ))}
        </nav>

        <div className="mt-auto space-y-1">
          <button 
            className={`w-full ai-gradient-bg text-white font-bold rounded-xl mb-6 shadow-lg flex items-center justify-center hover:opacity-90 transition-opacity ${compact ? 'p-3' : 'py-4 gap-2'}`}
            onClick={() => {/* TODO: Global New Post Trigger */}}
            aria-label={compact ? t('newPost') : undefined}
            title={compact ? t('newPost') : undefined}
          >
            <span className="material-symbols-outlined">add</span>
            {!compact && <span className="font-headline tracking-tight">{t('newPost')}</span>}
          </button>

          <button
            onClick={logout}
            className={`w-full flex items-center rounded-lg text-on-surface-variant hover:text-error hover:bg-error-container/10 transition-all duration-200 ${compact ? 'justify-center px-2 py-3' : 'gap-3 px-4 py-3'}`}
            aria-label={compact ? t('signOut') : undefined}
            title={compact ? t('signOut') : undefined}
          >
            <span className="material-symbols-outlined">logout</span>
            {!compact && <span className="font-label">{t('signOut')}</span>}
          </button>

          <div className={`mt-8 pt-6 border-t border-outline-variant/15 flex items-center px-2 ${compact ? 'justify-center' : 'gap-3'}`} title={compact ? user?.name || user?.email || t('user') : undefined}>
            <div className="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center text-primary font-bold">
              {user?.name?.[0] || user?.email?.[0] || 'U'}
            </div>
            {!compact && <div className="overflow-hidden">
              <p className="text-sm font-bold truncate">{user?.name || t('user')}</p>
              <p className="text-xs text-on-surface-variant truncate">{t('workspaceAccess')}</p>
            </div>
            }
          </div>
        </div>
      </aside>
      );
  };

  return (
    <div className="bg-surface font-body text-on-surface flex min-h-screen overflow-hidden">
      {mobileNavOpen && <div
        id="mobile-navigation"
        className="fixed inset-0 z-50 lg:hidden opacity-100"
      >
        <button
          aria-label={locale === 'ru' ? 'Закрыть навигацию' : 'Close navigation'}
          className="absolute inset-0 bg-black/35 backdrop-blur-sm"
          onClick={() => setMobileNavOpen(false)}
        />
        <div className={`absolute inset-y-0 left-0 w-[min(22rem,calc(100vw-2rem))] transition-transform duration-300 ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="relative h-full shadow-2xl shadow-black/20">
            <button
              onClick={() => setMobileNavOpen(false)}
              className="absolute right-4 top-4 z-10 w-10 h-10 rounded-2xl bg-white/90 text-on-surface flex items-center justify-center shadow-sm"
              aria-label={locale === 'ru' ? 'Закрыть меню' : 'Close menu'}
            >
              <span className="material-symbols-outlined">close</span>
            </button>
            {renderSidebar(true)}
          </div>
        </div>
      </div>}

      <div className="hidden lg:flex shrink-0">
        {renderSidebar()}
      </div>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-surface relative overflow-y-auto overflow-x-hidden">
        {/* TopNavBar */}
        <header className="flex justify-between items-center w-full px-4 lg:px-8 h-16 lg:h-20 sticky top-0 bg-surface/80 backdrop-blur-xl z-30 border-b border-outline-variant/5">
          <div className="flex items-center gap-3 lg:gap-8 min-w-0">
            <button
              onClick={() => setMobileNavOpen(true)}
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-navigation"
              className="lg:hidden w-11 h-11 rounded-2xl bg-surface-container-low text-on-surface flex items-center justify-center shrink-0"
              aria-label={t('openNavigation')}
            >
              <span className="material-symbols-outlined">menu</span>
            </button>
            <button
              onClick={() => setSidebarCollapsed((current) => !current)}
              aria-expanded={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? t('expandSidebar') : t('collapseSidebar')}
              title={sidebarCollapsed ? t('expandSidebar') : t('collapseSidebar')}
              className="hidden lg:flex w-10 h-10 rounded-xl bg-surface-container-low text-on-surface-variant items-center justify-center shrink-0 hover:text-primary hover:bg-primary-fixed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors"
            >
              <span className="material-symbols-outlined" aria-hidden="true">{sidebarCollapsed ? 'left_panel_open' : 'left_panel_close'}</span>
            </button>
            <div className="min-w-0">
              <span className="block text-lg lg:text-xl font-bold text-primary font-headline truncate">{t('assistant')}</span>
              {currentProject && (
                <span className="block lg:hidden text-[11px] text-on-surface-variant truncate">{currentProject.name}</span>
              )}
            </div>
            <div className="relative hidden lg:block">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm">search</span>
              <input 
                className="bg-surface-container-low border-none rounded-full py-2 pl-10 pr-4 text-sm w-64 focus:ring-2 focus:ring-primary/20" 
                placeholder={t('search')}
                type="text"
              />
            </div>
          </div>
          <nav className="flex items-center gap-3 lg:gap-8 h-full shrink-0">
            <div className="hidden xl:flex items-center gap-8 h-full">
              <Link to="/projects" className="text-on-surface-variant hover:text-primary font-label text-sm transition-opacity">{t('overview')}</Link>
              <Link to="/publication-tasks" className="text-on-surface-variant hover:text-primary font-label text-sm transition-opacity">{t('publications')}</Link>
              <Link to="/analytics" className="text-on-surface-variant hover:text-primary font-label text-sm transition-opacity">{t('metrics')}</Link>
              <Link to="/recipes" className="text-on-surface-variant hover:text-primary font-label text-sm transition-opacity">{t('templates')}</Link>
              <Link to="/calendar" className="text-on-surface-variant hover:text-primary font-label text-sm transition-opacity">{t('calendar')}</Link>
            </div>
            <div className="flex items-center gap-2 lg:gap-4 lg:ml-4">
              <LanguageSwitcher compact />
              <button className="p-2 text-on-surface-variant hover:opacity-80 transition-opacity">
                <span className="material-symbols-outlined">notifications_active</span>
              </button>
              <Link to="/projects" className="bg-primary text-white px-4 lg:px-5 py-2 rounded-full font-bold text-xs lg:text-sm shadow-sm hover:opacity-90 transition-opacity whitespace-nowrap">
                <span className="hidden sm:inline">{t('openOverview')}</span>
                <span className="sm:hidden">{t('overview')}</span>
              </Link>
            </div>
          </nav>
        </header>

        {/* Dynamic Content */}
        <div className="flex-1 w-full flex flex-col overflow-hidden">
           {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from 'react-router-dom';
import { applyTelegramTheme } from './lib/telegram';
import { api } from './lib/api';
import { TabBar, type Tab } from './components/TabBar';
import { Onboarding } from './components/Onboarding';
import { OfflineBanner } from './components/OfflineBanner';
import { UpdatePrompt } from './components/UpdatePrompt';
import { AuthGate } from './components/AuthGate';
import { PushPermissionPrompt } from './components/PushPermissionPrompt';
import { InstallPrompt } from './components/InstallPrompt';
import { LoginPage } from './pages/Login';
import { HomePage } from './pages/Home';
import { AddPage } from './pages/Add';
import { BudgetPage } from './pages/Budget';
import { CapitalPage } from './pages/Capital';
import { AnalyticsPage } from './pages/Analytics';
import { SettingsPage } from './pages/Settings';
import { CategoryEditorPage } from './pages/CategoryEditor';
import { IncomeSourceEditorPage } from './pages/IncomeSourceEditor';

// Single source of truth mapping a tab id to its URL.
const TAB_PATH: Record<Tab, string> = {
  home: '/',
  budget: '/budget',
  add: '/add',
  capital: '/capital',
  analytics: '/analytics',
  settings: '/settings',
};

// Paths that show the bottom tab bar (settings + sub-pages hide it).
const TABBAR_PATHS = new Set(['/', '/budget', '/add', '/capital', '/analytics']);

function pathToTab(pathname: string): Tab {
  switch (pathname) {
    case '/budget':
      return 'budget';
    case '/add':
      return 'add';
    case '/capital':
      return 'capital';
    case '/analytics':
      return 'analytics';
    case '/settings':
      return 'settings';
    default:
      return 'home';
  }
}

/**
 * App shell rendered inside the Router. Owns navigation, background prefetch,
 * and the onboarding overlay. Pages keep their original callback-prop
 * interfaces — we just supply the callbacks from here via useNavigate, so the
 * individual page files don't need to know about routing.
 */
function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [forcedOnboarding, setForcedOnboarding] = useState(false);

  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 60_000 });

  useEffect(() => {
    applyTelegramTheme();
  }, []);

  // Keep the PWA and the Telegram Mini App in sync. They're separate webviews
  // reading the same Neon DB, each with its own persisted cache. When either
  // surface becomes visible again (reopened / brought to foreground), pull the
  // latest server data so the numbers can't drift apart between the two. The
  // Telegram webview doesn't always fire window 'focus', so we also listen to
  // 'visibilitychange'.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        qc.invalidateQueries();
      }
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [qc]);

  // Background prefetch on first mount — keeps the first tab switch instant.
  // Skipped on the login screen, where requests would 401 anyway.
  useEffect(() => {
    if (location.pathname === '/login') return;
    let cancelled = false;
    const queue = async () => {
      await new Promise((r) => setTimeout(r, 50));
      if (cancelled) return;
      qc.prefetchQuery({ queryKey: ['budget', 'current'], queryFn: () => api.budget(), staleTime: 15_000 });
      qc.prefetchQuery({ queryKey: ['capital'], queryFn: api.capital, staleTime: 15_000 });
      qc.prefetchQuery({ queryKey: ['cats', 'expense'], queryFn: api.expenseCategories, staleTime: 5 * 60_000 });
      qc.prefetchQuery({ queryKey: ['sources'], queryFn: api.incomeSources, staleTime: 5 * 60_000 });
      qc.prefetchQuery({ queryKey: ['accounts'], queryFn: () => api.accounts(), staleTime: 60_000 });
    };
    queue();
    return () => {
      cancelled = true;
    };
  }, [qc]);

  const prefetchForTab = (next: Tab) => {
    if (next === 'budget')
      qc.prefetchQuery({ queryKey: ['budget', 'current'], queryFn: () => api.budget(), staleTime: 15_000 });
    if (next === 'capital')
      qc.prefetchQuery({ queryKey: ['capital'], queryFn: api.capital, staleTime: 15_000 });
    if (next === 'analytics') {
      const now = new Date();
      const from = new Date(now.getTime() - 30 * 86400000).toISOString();
      const to = now.toISOString();
      qc.prefetchQuery({ queryKey: ['analytics', 'summary', '30d'], queryFn: () => api.analyticsSummary(from, to) });
      qc.prefetchQuery({ queryKey: ['analytics', 'byCategory', '30d'], queryFn: () => api.analyticsByCategory(from, to, 12) });
    }
    if (next === 'settings') qc.prefetchQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 60_000 });
  };

  const goTab = (next: Tab) => {
    prefetchForTab(next);
    navigate(TAB_PATH[next]);
  };

  const showTabBar = TABBAR_PATHS.has(location.pathname);
  const activeTab = pathToTab(location.pathname);
  // Onboarding shows as a fullscreen overlay for new users, or when re-opened
  // from Settings.
  const showOnboarding = forcedOnboarding || (me.data && !me.data.onboardingCompleted);

  return (
    <div className="min-h-full max-w-md mx-auto">
      <OfflineBanner />
      <UpdatePrompt />

      <Routes>
        {/* Public — reachable without a session. */}
        <Route path="/login" element={<LoginPage />} />

        {/* Everything else requires auth (session cookie or Telegram initData). */}
        <Route element={<AuthGate />}>
          <Route path="/" element={<HomePage onGoTo={goTab} />} />
          <Route path="/add" element={<AddPage onDone={() => navigate('/')} />} />
          <Route path="/budget" element={<BudgetPage />} />
          <Route path="/capital" element={<CapitalPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route
            path="/settings"
            element={
              <SettingsPage
                onBack={() => navigate('/')}
                onOpenCategories={() => navigate('/settings/categories')}
                onOpenIncomeSources={() => navigate('/settings/income-sources')}
                onReplayOnboarding={() => setForcedOnboarding(true)}
                onOpenAdmin={() => navigate('/admin')}
              />
            }
          />
          <Route
            path="/settings/categories"
            element={<CategoryEditorPage onBack={() => navigate('/settings')} />}
          />
          <Route
            path="/settings/income-sources"
            element={<IncomeSourceEditorPage onBack={() => navigate('/settings')} />}
          />
          {/* Демо: админ-панель владельца в публичную копию не входит (у демо-пользователя isOwner=false). */}
          {/* Unknown path → home. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>

      {showTabBar && <TabBar active={activeTab} onChange={goTab} />}

      {location.pathname !== '/login' && (
        <>
          <InstallPrompt />
          <PushPermissionPrompt />
        </>
      )}

      <Onboarding
        open={!!showOnboarding}
        onClose={() => {
          setForcedOnboarding(false);
          qc.invalidateQueries({ queryKey: ['me'] });
        }}
      />
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

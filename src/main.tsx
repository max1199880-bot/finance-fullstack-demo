// Данные приходят с настоящего бэкенда (Supabase): см. src/lib/api.ts.
// Демо-сервер из прошлой версии остался только как двойник для тестов (src/demo/).
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { registerMutationDefaults } from './lib/mutationDefaults';
import { IconThemeProvider } from './lib/iconTheme';
import { API_BASE } from './lib/api';
import { initAnalytics } from './lib/analytics';
import { initErrorReporting } from './lib/errorReporting';
import { bindCacheToSession } from './lib/session';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 'offlineFirst' = serve cached data first, then revalidate. The persisted
      // cache gives an instant app-open (even offline); the settings below make
      // sure that cached view is replaced with fresh server data quickly, so the
      // PWA and the Telegram Mini App (two separate webviews reading the SAME
      // Neon DB) don't drift apart.
      networkMode: 'offlineFirst',
      retry: 1,
      // Re-fetch whenever the app regains focus / is reopened from the
      // background. This is the key fix for "different numbers in PWA vs
      // Telegram": each surface pulls the latest data the moment you look at it.
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      // Always revalidate on mount instead of trusting a stale snapshot — the
      // cached value still renders instantly, but a background refetch corrects
      // it within a moment.
      refetchOnMount: 'always',
      // Short staleness window so money data is considered fresh only briefly.
      staleTime: 5_000,
      // Keep cached data for a week after last use — fits a finance app's
      // sporadic usage pattern.
      gcTime: 1000 * 60 * 60 * 24 * 7,
    },
    mutations: {
      // 'online' = pause when offline, auto-resume when network returns.
      // Combined with mutationKey + setMutationDefaults registered below,
      // paused mutations are persisted to localStorage and replayed on next
      // app open or reconnect — the user can record operations in airplane
      // mode and they'll sync as soon as TG / VPN reconnects.
      networkMode: 'online',
      // Retry once with exponential backoff so a flaky reconnect doesn't
      // drop the operation.
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
    },
  },
});

// IMPORTANT: defaults must be registered BEFORE the persister hydrates so
// that paused mutations rehydrating from localStorage find their mutationFn.
registerMutationDefaults(queryClient);

const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'finance-bot-query-cache-v1',
  throttleTime: 1000,
});

// Кеш данных живёт ровно столько, сколько сессия пользователя (см. lib/session.ts).
bindCacheToSession(queryClient, persister);
initErrorReporting(API_BASE);
initAnalytics();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: 1000 * 60 * 60 * 24 * 7,
          // Bump this when the JS bundle's data shape diverges from older
          // persisted snapshots. Mismatches cause "white screen" crashes
          // because React tries to render new components against old data.
          buster: 'v6-2026-06-04-vm',
          // Persist both queries AND mutations. The default does both, but
          // we name it explicitly so it's clear that paused mutations survive.
          dehydrateOptions: {
            shouldDehydrateMutation: () => true,
            shouldDehydrateQuery: () => true,
          },
        }}
        onSuccess={() => {
          // Purge stale pending mutations from a previous session.
          // Any mutation still in 'pending' status after more than 5 minutes
          // (or with no timestamp at all) will never complete — it's a ghost
          // left by a crashed/closed session. We remove it BEFORE resuming so
          // the OfflineBanner never shows "Отправляю…" for dead writes.
          // Note: we check status === 'pending', NOT isPaused, because a mutation
          // can be pending with isPaused: false when it was executing at the time
          // the app was closed and its state was serialised to localStorage.
          const mc = queryClient.getMutationCache();
          const FIVE_MIN = 5 * 60 * 1000;
          const now = Date.now();
          mc.getAll().forEach((m) => {
            if (m.state.status !== 'pending') return;
            const submittedAt = (m.state as { submittedAt?: number }).submittedAt ?? 0;
            // Remove if: no timestamp (legacy / corrupted) OR older than 5 min.
            if (submittedAt === 0 || now - submittedAt > FIVE_MIN) {
              mc.remove(m);
            }
          });
          // Resume only the fresh paused mutations that survived the purge.
          queryClient.resumePausedMutations();
        }}
      >
        <IconThemeProvider>
          <App />
        </IconThemeProvider>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

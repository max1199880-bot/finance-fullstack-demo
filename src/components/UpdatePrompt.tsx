import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Surfaces a "new version available" toast when the service worker has fetched
 * an update. Because vite.config.ts uses `registerType: 'prompt'`, the new SW
 * waits until the user taps "Обновить" — this avoids rendering freshly-shipped
 * components against an older persisted query snapshot.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('[sw] registration failed', error);
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="fixed inset-x-3 bottom-24 z-50 flex items-center justify-between gap-3 rounded-ios-lg bg-ios-accent px-4 py-3 text-white shadow-card">
      <span className="text-sm font-medium">Доступна новая версия</span>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setNeedRefresh(false)} className="text-sm opacity-80">
          Позже
        </button>
        <button
          type="button"
          onClick={() => updateServiceWorker(true)}
          className="rounded-ios bg-white/20 px-3 py-1 text-sm font-semibold active:bg-white/30"
        >
          Обновить
        </button>
      </div>
    </div>
  );
}

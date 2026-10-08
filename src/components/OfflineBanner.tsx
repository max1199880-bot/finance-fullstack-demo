import { useEffect, useState } from 'react';
import { useIsMutating, useQueryClient } from '@tanstack/react-query';
import { useOnline } from '../hooks/useOnline';

/**
 * Top strip shown when:
 *  - we're offline (orange) — explains cached data + queued writes
 *  - just came back online (emerald, brief) — confirmation
 *  - queued mutations are still pending (amber) — visible until drain
 *
 * Old stuck mutations (> 10 min) are purged automatically at startup in
 * main.tsx before this component ever mounts, so the "sending" state
 * should only appear for genuinely fresh in-flight requests.
 *
 * The ✕ dismiss button is a last-resort safety valve: tapping it clears
 * the entire mutation cache (query data is preserved).
 */
export function OfflineBanner() {
  const online = useOnline();
  const qc = useQueryClient();
  const [reconnected, setReconnected] = useState(false);
  const [hasBeenOffline, setHasBeenOffline] = useState(false);

  // useIsMutating: count of mutations in 'pending' status (includes paused).
  const pending = useIsMutating();

  useEffect(() => {
    if (!online) {
      setHasBeenOffline(true);
      setReconnected(false);
    } else if (hasBeenOffline) {
      setReconnected(true);
      qc.resumePausedMutations();
      const t = setTimeout(() => setReconnected(false), 2200);
      return () => clearTimeout(t);
    }
  }, [online, hasBeenOffline, qc]);

  if (online && !reconnected && pending === 0) return null;

  let color = 'bg-orange-600';
  let icon = '⚠️';
  let text = 'Без сети — записи сохраняются локально и отправятся позже';

  if (online && reconnected) {
    color = 'bg-emerald-600';
    icon = '✓';
    text = pending > 0 ? `Связь восстановлена · отправляю ${pending} записей…` : 'Связь восстановлена';
  } else if (online && pending > 0) {
    color = 'bg-amber-600';
    icon = '↻';
    text = `Отправляю ${pending} ${pending === 1 ? 'запись' : 'записи'}…`;
  } else if (!online && pending > 0) {
    text = `${pending} ${pending === 1 ? 'запись ждёт' : 'записей ждут'} сети`;
  }

  const dismiss = () => {
    // 1. Clear in-memory mutation cache → useIsMutating() drops to 0 → banner hides.
    qc.getMutationCache().clear();
    // 2. Also wipe the persisted localStorage key synchronously — bypasses the
    //    1-second throttle of the persister. Without this, a quick reload would
    //    rehydrate the old mutation from localStorage and the banner would return.
    localStorage.removeItem('finance-bot-query-cache-v1');
  };

  return (
    <div
      className={`fixed top-0 inset-x-0 z-[70] text-white text-xs font-medium flex items-center justify-between px-3 select-none-ui transition-colors ${color}`}
      style={{
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 6px)',
        paddingBottom: 6,
      }}
    >
      <span className="flex-1 text-center">{icon} {text}</span>
      {/* Dismiss button: clears mutation cache, hides banner immediately */}
      <button
        type="button"
        onClick={dismiss}
        className="ml-2 shrink-0 opacity-70 hover:opacity-100 text-base leading-none"
        aria-label="Закрыть"
      >
        ✕
      </button>
    </div>
  );
}

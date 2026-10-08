import { useEffect, useState } from 'react';
import { enablePush, pushPermission, pushSupported } from '../lib/push';
import { isInsideTelegram, haptic } from '../lib/telegram';

const DISMISS_KEY = 'push-prompt-dismissed-v1';

/**
 * Soft prompt asking the user to enable push notifications. Deliberately NOT
 * shown on first paint — it appears a few seconds in, only when:
 *   - push is supported,
 *   - permission hasn't been decided yet ('default'),
 *   - we're not inside Telegram (the bot already notifies there),
 *   - the user hasn't dismissed it before.
 */
export function PushPermissionPrompt() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isInsideTelegram()) return;
    if (!pushSupported()) return;
    if (pushPermission() !== 'default') return;
    if (localStorage.getItem(DISMISS_KEY)) return;

    // Let the user settle into the app before asking.
    const t = setTimeout(() => setVisible(true), 4000);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  };

  const enable = async () => {
    setBusy(true);
    haptic('select');
    const ok = await enablePush();
    setBusy(false);
    // Either way we stop nagging — granted, denied, or unsupported.
    localStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
    if (ok) haptic('success');
  };

  return (
    <div className="fixed inset-x-3 bottom-24 z-40 rounded-ios-lg bg-ios-surface p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span className="text-2xl">🔔</span>
        <div className="flex-1">
          <div className="font-semibold text-sm">Включить уведомления?</div>
          <div className="text-xs text-ios-hint mt-0.5 leading-snug">
            Напоминания о расходах и важные события прямо на экран.
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={dismiss}
          className="flex-1 rounded-ios bg-ios-surface2 py-2 text-sm font-medium"
        >
          Не сейчас
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={enable}
          className="flex-[2] rounded-ios bg-ios-accent py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? '…' : 'Включить'}
        </button>
      </div>
    </div>
  );
}

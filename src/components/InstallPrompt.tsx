import { useEffect, useState } from 'react';
import { isInsideTelegram } from '../lib/telegram';

const DISMISS_KEY = 'install-prompt-dismissed-v1';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * "Add to Home Screen" affordance.
 *  - Android/Chrome: capture beforeinstallprompt and offer a one-tap install.
 *  - iOS Safari: there's no programmatic install, so show a short instruction
 *    (Share → На экран «Домой»).
 * Hidden when already installed, inside Telegram, or previously dismissed.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (isInsideTelegram() || isStandalone()) return;
    if (localStorage.getItem(DISMISS_KEY)) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // iOS never fires beforeinstallprompt — show the manual hint instead.
    if (isIos()) {
      const t = setTimeout(() => setShowIosHint(true), 6000);
      return () => {
        clearTimeout(t);
        window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      };
    }

    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDeferred(null);
    setShowIosHint(false);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    // Баннер прячем только после ответа пользователя: и «установить», и «отмена» закрывают его.
    await deferred.userChoice;
    dismiss();
  };

  if (deferred) {
    return (
      <Banner onDismiss={dismiss}>
        <div className="flex-1">
          <div className="text-sm font-semibold">Установить приложение</div>
          <div className="text-xs text-ios-hint mt-0.5">Быстрый доступ с домашнего экрана.</div>
        </div>
        <button
          type="button"
          onClick={install}
          className="shrink-0 rounded-ios bg-ios-accent px-3 py-1.5 text-sm font-semibold text-white"
        >
          Установить
        </button>
      </Banner>
    );
  }

  if (showIosHint) {
    return (
      <Banner onDismiss={dismiss}>
        <div className="flex-1 text-xs leading-snug">
          <span className="font-semibold">Установить на iPhone:</span> нажми <span aria-hidden>⎙</span>{' '}
          «Поделиться» → «На экран „Домой“».
        </div>
      </Banner>
    );
  }

  return null;
}

function Banner({ children, onDismiss }: { children: React.ReactNode; onDismiss: () => void }) {
  return (
    <div className="fixed inset-x-3 bottom-24 lg:left-auto lg:right-6 lg:bottom-6 lg:w-96 z-40 flex items-center gap-3 rounded-ios-lg bg-ios-surface p-3 shadow-card">
      {children}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Закрыть"
        className="shrink-0 text-ios-hint text-lg leading-none px-1"
      >
        ✕
      </button>
    </div>
  );
}

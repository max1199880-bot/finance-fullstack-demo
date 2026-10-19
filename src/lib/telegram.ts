/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string; last_name?: string; username?: string } };
  themeParams: Record<string, string>;
  colorScheme: 'light' | 'dark';
  ready(): void;
  expand(): void;
  close(): void;
  HapticFeedback: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  MainButton: {
    setText(t: string): void;
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
    enable(): void;
    disable(): void;
    showProgress(leaveActive?: boolean): void;
    hideProgress(): void;
  };
  BackButton: {
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
  showAlert(message: string, cb?: () => void): void;
  showConfirm(message: string, cb?: (ok: boolean) => void): void;
  showPopup(p: { title?: string; message: string; buttons?: any[] }, cb?: (id: string) => void): void;
  // Opens a t.me link inside Telegram; for tg:// deep links use openLink.
  openTelegramLink(url: string): void;
  // Opens any URL in an external browser (or native handler for tg://).
  openLink(url: string, options?: { try_instant_view?: boolean }): void;
}

export const tg: TelegramWebApp | null =
  typeof window !== 'undefined' ? (window.Telegram?.WebApp ?? null) : null;

export function tgInitData(): string {
  return tg?.initData ?? '';
}

/**
 * True when the app is actually running inside Telegram. The Telegram SDK
 * script loads in standalone PWA mode too, so `window.Telegram` alone is not
 * enough — only a non-empty `initData` proves a real Mini App launch. The PWA
 * AuthGate uses this to decide between the legacy initData path and the
 * cookie-session login flow.
 */
export function isInsideTelegram(): boolean {
  return tgInitData().length > 0;
}

export function haptic(
  kind: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'select',
): void {
  // Inside Telegram: use the rich native haptic engine.
  if (tg?.HapticFeedback) {
    try {
      if (kind === 'success' || kind === 'warning' || kind === 'error') {
        tg.HapticFeedback.notificationOccurred(kind);
      } else if (kind === 'select') {
        tg.HapticFeedback.selectionChanged();
      } else {
        tg.HapticFeedback.impactOccurred(kind);
      }
      return;
    } catch {
      /* fall through to the Web fallback */
    }
  }
  // Standalone PWA: approximate with the Vibration API where available
  // (Android Chrome). iOS Safari ignores navigator.vibrate — harmless no-op.
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    const pattern =
      kind === 'success'
        ? [10, 30, 10]
        : kind === 'warning'
          ? [20, 40, 20]
          : kind === 'error'
            ? [40]
            : kind === 'select'
              ? [5]
              : [10];
    try {
      navigator.vibrate(pattern);
    } catch {
      /* ignore */
    }
  }
}

export function applyTelegramTheme(): void {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    const t = tg.themeParams;
    const root = document.documentElement.style;
    if (t.bg_color) root.setProperty('--ios-bg', t.bg_color);
    if (t.secondary_bg_color) root.setProperty('--ios-surface', t.secondary_bg_color);
    if (t.text_color) root.setProperty('--ios-text', t.text_color);
    if (t.hint_color) root.setProperty('--ios-hint', t.hint_color);
    if (t.button_color) root.setProperty('--ios-accent', t.button_color);
  } catch {
    /* ignore */
  }
}

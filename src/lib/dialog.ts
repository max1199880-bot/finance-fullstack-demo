import { isInsideTelegram, tg } from './telegram';

/**
 * Platform-agnostic confirm/alert. Inside Telegram we use the native
 * showConfirm/showAlert (themed, modal); in the standalone PWA we fall back to
 * the browser's window.confirm/alert. Both return a Promise so call sites read
 * the same regardless of platform.
 *
 * IMPORTANT: gate on `isInsideTelegram()`, NOT on `typeof tg.showConfirm`.
 * The Telegram SDK is now self-hosted, so `window.Telegram.WebApp` (and its
 * showConfirm/showAlert methods) exist even in the standalone PWA — but there
 * those methods are silent no-ops (no Telegram client renders the modal, the
 * callback never fires). Gating on method existence made delete/confirm
 * dialogs hang forever in the PWA. A non-empty initData is the only reliable
 * proof we're really inside Telegram.
 */

export function confirmDialog(message: string): Promise<boolean> {
  // Capture into a local const so the non-null narrowing survives inside the
  // Promise executor closure (TS won't narrow the imported binding there).
  const t = tg;
  if (isInsideTelegram() && t && typeof t.showConfirm === 'function') {
    return new Promise((resolve) => {
      t.showConfirm(message, (ok) => resolve(!!ok));
    });
  }
  return Promise.resolve(typeof window !== 'undefined' ? window.confirm(message) : false);
}

export function alertDialog(message: string): Promise<void> {
  const t = tg;
  if (isInsideTelegram() && t && typeof t.showAlert === 'function') {
    return new Promise((resolve) => {
      t.showAlert(message, () => resolve());
    });
  }
  if (typeof window !== 'undefined') window.alert(message);
  return Promise.resolve();
}

/**
 * Safe replacement for direct `tg.showPopup(...)` calls. In the standalone PWA
 * the self-hosted Telegram SDK REJECTS showPopup with
 * `Error('WebAppMethodUnsupported')` (no Telegram client → version gate fails),
 * which used to crash onSuccess handlers AFTER the server had already applied
 * the mutation — the sheet stayed open and the user retried a succeeded write.
 * Never call tg.showPopup directly; always go through here.
 */
export function popupDialog(p: { title?: string; message: string }): void {
  const t = tg;
  if (isInsideTelegram() && t && typeof t.showPopup === 'function') {
    try {
      t.showPopup({ title: p.title, message: p.message });
      return;
    } catch {
      /* fall through to the browser alert */
    }
  }
  if (typeof window !== 'undefined') {
    window.alert(p.title ? `${p.title}\n\n${p.message}` : p.message);
  }
}

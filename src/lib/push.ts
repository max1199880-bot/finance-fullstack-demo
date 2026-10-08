import { api } from './api';

/**
 * Web Push helpers for the standalone PWA.
 *
 * Flow: ask for Notification permission → grab the active service-worker
 * registration → subscribe with the server's VAPID public key → POST the
 * subscription to the backend. All steps degrade gracefully on unsupported
 * browsers (older iOS Safari without Home-Screen install, etc.).
 */

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission;
}

/** Convert a base64url VAPID key into the Uint8Array pushManager expects. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Request permission and register a push subscription. Returns true on
 * success. Safe to call repeatedly — subscribe() is idempotent and the backend
 * upserts by endpoint.
 */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) {
    // eslint-disable-next-line no-console
    console.log('[push] not supported on this browser');
    return false;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      // eslint-disable-next-line no-console
      console.log('[push] permission not granted', { permission });
      return false;
    }
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api.vapidPublicKey();
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast: TS 5.7 types Uint8Array as Uint8Array<ArrayBufferLike>, which
        // the DOM lib's BufferSource union doesn't structurally accept yet.
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      }));
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      // eslint-disable-next-line no-console
      console.error('[push] subscription missing fields', json);
      return false;
    }
    await api.pushSubscribe({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    });
    // eslint-disable-next-line no-console
    console.log('[push] subscribed');
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[push] enable failed', e);
    return false;
  }
}

/** Unsubscribe locally and tell the backend to drop the row. */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api.pushUnsubscribe(sub.endpoint).catch(() => {});
      await sub.unsubscribe();
      // eslint-disable-next-line no-console
      console.log('[push] unsubscribed');
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[push] disable failed', e);
  }
}

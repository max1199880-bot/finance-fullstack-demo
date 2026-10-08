/* eslint-disable no-undef */
// Web Push handlers, appended to the generated Workbox service worker via
// `workbox.importScripts: ['push-sw.js']` in vite.config.ts.
//
// Phase 3 ships this as a no-op-safe skeleton so the SW import resolves.
// Phase 5 fills in the real push + notificationclick logic.

self.addEventListener('push', (event) => {
  let data = { title: 'Финансы', body: '', url: '/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/pwa-192x192.png',
      badge: '/badge-72.png',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Focus an existing window if one is already open, else open a new one.
      for (const client of allClients) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(targetUrl);
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
    })(),
  );
});

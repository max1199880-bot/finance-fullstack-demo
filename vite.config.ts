/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'autoUpdate': a new SW skips waiting + claims clients, so a fresh deploy
      // applies on the next app open WITHOUT a manual "Обновить" tap. We switched
      // away from 'prompt' because the prompt was easy to miss — installed copies
      // kept serving a stale cached index.html, so server-side fixes "didn't
      // arrive" until a full reinstall. The persisted query cache is guarded by a
      // version `buster` (see main.tsx), bumped on shipping, so new components
      // never render against an old snapshot.
      registerType: 'autoUpdate',
      injectRegister: null, // we register manually via virtual:pwa-register/react
      includeAssets: ['favicon.svg', 'apple-touch-icon-180.png'],
      manifest: {
        name: 'Финансы',
        short_name: 'Финансы',
        description: 'Личные финансы: расходы, бюджет, капитал, аналитика',
        lang: 'ru',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        // Push handler lives in public/push-sw.js and is appended to the
        // generated SW (added in Phase 5). Listed here so the import is wired
        // from the start.
        importScripts: ['push-sw.js'],
        navigateFallback: '/index.html',
        // Запросы к API идут на домен Supabase, а не на свой — подменять их
        // закешированной страницей нельзя.
        navigateFallbackDenylist: [/^\/api\//, /\/functions\/v1\//],
        runtimeCaching: [
          {
            // Чтение данных: сначала сеть, при недоступности — последний ответ из кеша.
            // Адрес сменился на домен Supabase, поэтому правило смотрит на путь функции.
            urlPattern: ({ url }) =>
              url.pathname.includes('/functions/v1/api/') &&
              !url.pathname.includes('/api/auth') &&
              !url.pathname.includes('/api/push'),
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 7, maxEntries: 200 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Вход и подписки на уведомления всегда идут в сеть: закешированный
            // ответ о сессии — прямой путь к «вошёл под чужим аккаунтом».
            urlPattern: ({ url }) =>
              url.pathname.includes('/auth/v1/') || url.pathname.includes('/api/auth'),
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: {
        // Keep the SW off during `vite dev` to avoid caching surprises while
        // developing. It's fully active in the production build.
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
    // Прокси не нужен: фронтенд обращается к Supabase по полному адресу из
    // VITE_SUPABASE_URL, а доступ с этого адреса разрешён настройкой CORS бэкенда.
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
  },
  // Демо: автотесты (Vitest + Testing Library) в том же конфиге, что и сборка.
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
    // Интеграционные тесты API живут отдельно (vitest.api.config.ts): им нужен
    // запущенный Supabase, а этому прогону — только браузерное окружение.
    exclude: ['src/test/api/**'],
  },
});

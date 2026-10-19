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
        // Ответы API сервис-воркер НЕ кеширует. Ключом такого кеша был бы только адрес,
        // без пользователя: после выхода данные оставались бы в Cache Storage, а при
        // медленной сети их получил бы следующий вошедший. Офлайн-режим даёт кеш
        // TanStack Query, и он стирается при выходе (lib/session.ts).
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
    // Без host: true — дев-сервер слушает только этот компьютер. Открытый в локальную
    // сеть сервер отдавал бы исходники всем в той же Wi-Fi.
    // Прокси не нужен: фронтенд обращается к Supabase по полному адресу из
    // VITE_SUPABASE_URL, а доступ с этого адреса разрешён настройкой CORS бэкенда.
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
    rollupOptions: {
      output: {
        // Библиотеки — отдельными файлами: они меняются редко, и после очередного
        // деплоя браузер берёт их из кеша, скачивая заново только код приложения.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: [
            '@tanstack/react-query',
            '@tanstack/react-query-persist-client',
            '@tanstack/query-sync-storage-persister',
          ],
          auth: ['@supabase/auth-js'],
        },
      },
    },
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

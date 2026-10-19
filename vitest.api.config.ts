import { defineConfig } from 'vitest/config';

// Отдельный прогон для интеграционных тестов API: им не нужен jsdom, зато нужен
// настоящий сервер. Поэтому они не смешиваются с тестами экранов (vite.config.ts).
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/test/api/**/*.test.ts'],
    // Запросы идут в живой Supabase: даём запас по времени на холодный старт функции.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Файлы делят одну базу — параллельный прогон сделал бы проверки счётчиков шаткими.
    fileParallelism: false,
  },
});

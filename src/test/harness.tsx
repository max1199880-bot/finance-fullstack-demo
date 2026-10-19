// Обвязка тестов: настоящие экраны прода поверх демо-сервера.
// fetch подменяется на прямой вызов демо-сервера (без задержек), QueryClient настроен как в
// main.tsx прода, но без автоповторов — иначе тест ошибки ждал бы повтора с бэкоффом.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { handleApiRequest } from '../demo/server';
import { DemoStore, type KeyValueStorage } from '../demo/store';
import { IconThemeProvider } from '../lib/iconTheme';
import { registerMutationDefaults } from '../lib/mutationDefaults';

/** Фиксированный «сегодня» для всех тестов: 22 сентября 2026, 14:30. */
export const TODAY = new Date(2026, 8, 22, 14, 30);

export function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/**
 * Заморозить дату. Подменяем только Date, а таймеры оставляем настоящими:
 * иначе ожидания Testing Library (findBy*, waitFor) перестали бы тикать.
 */
export function freezeClock(at: Date = TODAY): void {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(at);
}

export interface Network {
  /** true — каждый запрос к API падает, как при недоступном сервере. */
  down: boolean;
  /** Если задан — /api/auth/me отвечает этим HTTP-статусом (401 — сессия отозвана, 500 — сбой сервера). */
  authStatus?: number;
}

/** Новый демо-сервер на памяти + перехват fetch, как в браузере (src/demo/server.ts). */
export function installTestServer(network: Network = { down: false }): DemoStore {
  const store = DemoStore.open(memoryStorage(), () => new Date());
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (network.down) throw new TypeError('Failed to fetch');
    // Приложение ходит на полный адрес функции; демо-серверу нужен путь вида /api/...
    const raw = new URL(String(input), 'http://localhost');
    const path = raw.pathname.replace('/functions/v1/api', '/api');
    const url = new URL(`${path}${raw.search}`, 'http://localhost');
    if (network.authStatus && url.pathname === '/api/auth/me') {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: network.authStatus });
    }
    return handleApiRequest(store, init?.method ?? 'GET', url, init?.body);
  });
  return store;
}

export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false, networkMode: 'always' },
    },
  });
}

/** client можно передать заранее заполненным — так имитируется кеш, восстановленный из localStorage. */
export function renderScreen(ui: ReactElement, client: QueryClient = testQueryClient()) {
  // Как в main.tsx прода: без этого у мутаций экрана «Добавить» не будет mutationFn.
  registerMutationDefaults(client);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <IconThemeProvider>{ui}</IconThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** fmtRub прода ставит неразрывные пробелы между разрядами — нормализуем для сравнений. */
export const norm = (s: string | null | undefined) =>
  (s ?? '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

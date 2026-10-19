// Демо-сервер в браузере. Перехватывает fetch('/api/…') — единственную точку, через
// которую фронтенд прода (src/lib/api.ts → call()) ходит в сеть, — и отвечает теми же JSON,
// что сервер прода, но на вымышленных данных. Код экранов при этом не меняется ни на строку.
//
// Управление демо — через адресную строку (интерфейс не трогаем, он как в проде):
//   ?latency=1500   — задержка ответа, мс (по умолчанию 350)
//   ?fail=1         — все запросы к API завершаются ошибкой сети (?fail=0 — выключить)
//   ?reset=1        — вернуть исходные демо-данные
// Значения запоминаются в sessionStorage до закрытия вкладки.

import { HttpError } from './errors';
import { route } from './routes';
import { DemoStore } from './store';

export interface DemoOptions {
  latencyMs: number;
  fail: boolean;
}

const SESSION_KEY = 'finance-demo:options';

function readOptions(): DemoOptions {
  const defaults: DemoOptions = { latencyMs: 350, fail: false };
  let saved: Partial<DemoOptions> = {};
  try {
    saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}') as Partial<DemoOptions>;
  } catch {
    // sessionStorage недоступен — просто берём значения по умолчанию
  }
  const q = new URLSearchParams(window.location.search);
  const next: DemoOptions = {
    latencyMs: q.has('latency')
      ? Math.max(0, Number(q.get('latency')) || 0)
      : (saved.latencyMs ?? defaults.latencyMs),
    fail: q.has('fail') ? q.get('fail') === '1' : (saved.fail ?? defaults.fail),
  };
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
  } catch {
    // не сохранилось — действует до перезагрузки
  }
  return next;
}

/**
 * Обработать один запрос к API. Вынесено из перехватчика, чтобы тесты вызывали
 * сервер напрямую — без window и без задержек.
 */
export async function handleApiRequest(
  store: DemoStore,
  method: string,
  url: URL,
  rawBody: unknown,
): Promise<Response> {
  let body: unknown = undefined;
  if (typeof rawBody === 'string' && rawBody.length > 0) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json(400, { error: 'Некорректный JSON в теле запроса' });
    }
  }
  try {
    const result = route(store, method.toUpperCase(), url, body);
    return json(200, result);
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    console.error('[demo] необработанная ошибка', e);
    return json(500, { error: 'Внутренняя ошибка демо-сервера' });
  }
}

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Подключить демо-сервер. Вызывается один раз в main.tsx до первого рендера. */
export function installDemoServer(): DemoStore {
  const options = readOptions();
  const store = DemoStore.open(window.localStorage);
  if (new URLSearchParams(window.location.search).get('reset') === '1') store.reset();

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      window.location.origin,
    );
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/'))
      return realFetch(input, init);

    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    // Настоящий офлайн (DevTools → Offline, авиарежим): демо-сервер «недоступен», как и реальный.
    // Так работает офлайн-режим прода без изменений в его коде: баннер «Без сети» и очередь записей.
    if (!navigator.onLine) throw new TypeError('Failed to fetch');
    if (options.latencyMs > 0) await new Promise((r) => setTimeout(r, options.latencyMs));
    // Сбой сервера при живой сети: fetch отклоняется с TypeError, как при недоступном хосте.
    if (options.fail) throw new TypeError('Failed to fetch (демо: включён ?fail=1)');
    return handleApiRequest(store, method, url, init?.body);
  };
  return store;
}

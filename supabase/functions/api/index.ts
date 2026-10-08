// HTTP-вход бэкенда «Финансы»: один Edge Function на все эндпоинты.
//
// Почему один, а не функция на эндпоинт: приложение ходит по 50+ путям, а холодный
// старт у каждой функции свой. Один вход — один прогрев и одно место для CORS,
// логов и обработки ошибок.
//
// Путь запроса: /functions/v1/api/<что-то> → внутри роутера это /<что-то>.

import { buildContext } from './lib/context.ts';
import { corsHeaders, HttpError, json } from './lib/http.ts';
import { routes } from './routes/index.ts';

// Снаружи адрес выглядит как /functions/v1/api/..., а внутрь рантайма попадает
// /api/... — отрезаем оба варианта, чтобы маршруты описывались одинаково.
const PREFIXES = ['/functions/v1/api', '/api'];

function stripPrefix(pathname: string): string {
  for (const prefix of PREFIXES) {
    if (pathname === prefix) return '/';
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  }
  return pathname;
}

/** Сопоставление пути с шаблоном вида /accounts/:id/history. */
function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

Deno.serve(async (req) => {
  const started = Date.now();
  const url = new URL(req.url);
  const origin = req.headers.get('Origin');
  const path = stripPrefix(url.pathname);

  // Предполётный запрос браузера: отвечаем заголовками и ничего не выполняем.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // Проверка живости — без входа: по ней мониторинг видит, что функция поднялась.
  if (path === '/health') {
    return json({ ok: true, time: new Date().toISOString() }, 200, origin);
  }

  try {
    for (const route of routes) {
      if (route.method !== req.method) continue;
      const params = match(route.path, path);
      if (!params) continue;

      const ctx = await buildContext(req, url, params);
      const body = await route.handler(ctx);
      // Логи уходят в Supabase Logs: строка на запрос, без тел и токенов —
      // в теле бывают суммы и комментарии пользователя.
      console.log(JSON.stringify({
        level: 'info', method: req.method, path, status: 200, ms: Date.now() - started, user: ctx.userId,
      }));
      return json(body, 200, origin);
    }

    console.log(JSON.stringify({ level: 'warn', method: req.method, path, status: 404, ms: Date.now() - started }));
    return json({ error: `Нет обработчика ${req.method} ${path}` }, 404, origin);
  } catch (e) {
    if (e instanceof HttpError) {
      console.log(JSON.stringify({
        level: 'warn', method: req.method, path, status: e.status, ms: Date.now() - started, error: e.message,
      }));
      return json({ error: e.message }, e.status, origin);
    }
    // Неожиданная ошибка: наружу — общий текст, в логи — подробности со стеком.
    console.error(JSON.stringify({
      level: 'error', method: req.method, path, status: 500, ms: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    }));
    return json({ error: 'Внутренняя ошибка сервера' }, 500, origin);
  }
});

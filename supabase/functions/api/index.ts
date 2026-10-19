// HTTP-вход бэкенда «Финансы»: один Edge Function на все эндпоинты.
//
// Почему один, а не функция на эндпоинт: приложение ходит по 50+ путям, а холодный
// старт у каждой функции свой. Один вход — один прогрев и одно место для CORS,
// логов и обработки ошибок.
//
// Путь запроса: /functions/v1/api/<что-то> → внутри роутера это /<что-то>.

import { buildContext } from './lib/context.ts';
import { healthReport } from './lib/health.ts';
import { clientRequestIdOf, log, requestIdOf, safeErrorText } from './lib/log.ts';
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

/** Ответ с id запроса в заголовке: по нему пользователь и поддержка находят строку в логах. */
function withRequestId(res: Response, requestId: string): Response {
  res.headers.set('x-request-id', requestId);
  res.headers.append('Access-Control-Expose-Headers', 'x-request-id');
  return res;
}

const MAX_CLIENT_ERROR_BYTES = 4096;

/**
 * Ограничения базы → понятные ошибки ввода. Длину текста и диапазоны проверяет сама
 * база (так их не обойти прямым запросом к таблице), а здесь нарушение превращается
 * из «внутренней ошибки» в 400 с текстом для пользователя. Одно место на все маршруты.
 */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  comment_len: 'Комментарий длиннее 500 символов',
  name_len: 'Название — от 1 до 60 символов',
  emoji_len: 'Слишком длинный значок',
  message_len: 'Сообщение длиннее 2000 символов',
  display_name_len: 'Имя длиннее 100 символов',
  credit_rate_range: 'Ставка — от 0 до 999%',
};

function constraintError(e: unknown): HttpError | null {
  const msg = e instanceof Error ? e.message : '';
  const name = /violates check constraint "([a-z_]+)"/.exec(msg)?.[1];
  return name && CONSTRAINT_MESSAGES[name] ? new HttpError(400, CONSTRAINT_MESSAGES[name]) : null;
}

/**
 * Ограничение частоты для отчётов из браузера: не больше 20 в минуту с одного адреса.
 * Счётчик живёт в памяти экземпляра функции, поэтому это заслон от случайного цикла
 * ошибок и простого спама, а не от распределённой атаки — для неё нужен общий счётчик
 * (Redis или таблица). Сверх лимита отвечаем так же 204, но ничего не пишем.
 */
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, { count: number; resetAt: number }>();

/**
 * Адрес клиента — ПОСЛЕДНИЙ элемент X-Forwarded-For: его дописал шлюз Supabase.
 * Первый элемент задаёт сам клиент, и лимит по нему обходился новым значением
 * на каждый запрос.
 */
function clientIp(req: Request): string {
  const chain =
    req.headers
      .get('x-forwarded-for')
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  return chain.at(-1) ?? req.headers.get('x-real-ip') ?? 'unknown';
}

function allowClientReport(req: Request): boolean {
  const ip = clientIp(req);
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt < now) {
    // Память экземпляра ограничена: вытесняем самую старую запись, а не сбрасываем всех —
    // сброс обнулял бы лимит и тем, кто как раз шлёт поток.
    if (hits.size >= 10_000) hits.delete(hits.keys().next().value!);
    hits.delete(ip);
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT;
}
const cut = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined);

/**
 * Ошибки из браузера. Приходят без входа: падение экрана входа — тоже ошибка, которую
 * надо увидеть. Поэтому принимаем немного и строго: размер тела ограничен, поля обрезаны,
 * из адреса берём только путь — в query могут оказаться данные пользователя.
 */
async function clientError(req: Request, requestId: string): Promise<void> {
  if (!allowClientReport(req)) return;
  // Размер проверяем до чтения тела: иначе огромное тело всё равно было бы прочитано в память.
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_CLIENT_ERROR_BYTES) return;
  const raw = await req.text();
  if (raw.length > MAX_CLIENT_ERROR_BYTES) return;
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw);
  } catch {
    return;
  }
  let page: string | undefined;
  try {
    page = typeof body.url === 'string' ? new URL(body.url).pathname : undefined;
  } catch {
    page = undefined;
  }
  // warn, а не error: отчёт может прислать кто угодно без входа, и алерты на error
  // не должны срабатывать от чужого спама. Разбор логов смотрит client_error отдельно.
  log('warn', 'client_error', {
    request_id: requestId,
    client_request_id: clientRequestIdOf(req),
    source: 'browser',
    error: cut(body.message, 500),
    stack: cut(body.stack, 2000),
    page,
    kind: cut(body.kind, 40),
    release: cut(body.release, 40),
    user_agent: cut(req.headers.get('user-agent'), 200),
  });
}

Deno.serve(async (req) => {
  const started = Date.now();
  const url = new URL(req.url);
  const origin = req.headers.get('Origin');
  const path = stripPrefix(url.pathname);
  const requestId = requestIdOf(req);
  const base = { request_id: requestId, client_request_id: clientRequestIdOf(req), method: req.method, path };

  // Предполётный запрос браузера: отвечаем заголовками и ничего не выполняем.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // Проверка живости — без входа: по ней мониторинг видит, что функция поднялась.
  if (path === '/health') {
    const { httpStatus, body, errors } = await healthReport();
    if (httpStatus !== 200) log('error', 'health_degraded', { ...base, status: httpStatus, errors });
    return withRequestId(json({ ok: httpStatus === 200, ...body }, httpStatus, origin), requestId);
  }

  if (path === '/client-errors' && req.method === 'POST') {
    await clientError(req, requestId);
    return withRequestId(new Response(null, { status: 204, headers: corsHeaders(origin) }), requestId);
  }

  try {
    for (const route of routes) {
      if (route.method !== req.method) continue;
      const params = match(route.path, path);
      if (!params) continue;

      const ctx = await buildContext(req, url, params);
      // Общий демо-аккаунт открыт всем: удаление в нём выключено, чтобы один посетитель
      // не стёр данные для остальных. В базе стоит такой же запрет — это первый рубеж
      // с понятным текстом вместо молча не удалённой строки.
      if (ctx.isDemo && req.method === 'DELETE') {
        throw new HttpError(
          403,
          'В демо-аккаунте удаление отключено. Зарегистрируйтесь, чтобы вести свои данные',
        );
      }
      const body = await route.handler(ctx);
      log('info', 'request', { ...base, status: 200, ms: Date.now() - started, user: ctx.userId });
      return withRequestId(json(body, 200, origin), requestId);
    }

    log('warn', 'request', { ...base, status: 404, ms: Date.now() - started });
    return withRequestId(json({ error: `Нет обработчика ${req.method} ${path}` }, 404, origin), requestId);
  } catch (caught) {
    const e = constraintError(caught) ?? caught;
    if (e instanceof HttpError) {
      // 4xx — ошибка клиента, а не сервера: warn, чтобы алерты на error не срабатывали
      // от каждой опечатки в сумме.
      log('warn', 'request', { ...base, status: e.status, ms: Date.now() - started, error: e.message });
      return withRequestId(json({ error: e.message }, e.status, origin), requestId);
    }
    // Неожиданная ошибка: наружу — общий текст и id запроса, в логи — подробности со стеком.
    log('error', 'request', {
      ...base,
      status: 500,
      ms: Date.now() - started,
      error: safeErrorText(e),
      stack: e instanceof Error ? e.stack?.slice(0, 2000) : undefined,
    });
    return withRequestId(json({ error: 'Внутренняя ошибка сервера', requestId }, 500, origin), requestId);
  }
});

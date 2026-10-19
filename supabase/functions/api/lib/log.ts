// Структурные логи: одна строка JSON на событие. Supabase складывает вывод функции
// в Logs → Edge Functions, где по полям можно фильтровать и считать.
//
// Правила, которые держит этот модуль, а не каждый обработчик:
//   • уровни только info / warn / error — по ним строятся выборки и алерты;
//   • request_id в каждой строке — по нему собирается вся история одного запроса,
//     а пользователь может назвать его поддержке (он приходит в заголовке ответа);
//   • никаких тел запросов, токенов и сумм: в логи не должно попадать то, что нельзя
//     показать человеку, разбирающему инцидент.

export type Level = 'info' | 'warn' | 'error';

export interface LogFields {
  request_id?: string;
  method?: string;
  path?: string;
  status?: number;
  ms?: number;
  user?: string;
  error?: string;
  stack?: string;
  [key: string]: unknown;
}

/** Ключи, значения которых никогда не пишутся, даже если их передали по ошибке. */
const REDACTED = new Set([
  'authorization',
  'token',
  'access_token',
  'password',
  'apikey',
  'amount',
  'comment',
]);

/**
 * Токены в свободном тексте (сообщение ошибки, стек, присланный браузером отчёт).
 * Ключ поля не помогает, если токен оказался внутри строки.
 */
const SECRET_PATTERNS: RegExp[] = [
  /eyJ[\w-]+\.[\w-]+(\.[\w-]+)?/g, // JWT
  /Bearer\s+\S+/gi,
  /sb_(secret|publishable)_[\w-]+/g, // ключи Supabase нового формата
];

function scrubText(v: string): string {
  return SECRET_PATTERNS.reduce((acc, re) => acc.replace(re, '[скрыто]'), v);
}

function scrub(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    out[k] = REDACTED.has(k.toLowerCase()) ? '[скрыто]' : typeof v === 'string' ? scrubText(v) : v;
  }
  return out;
}

export function log(level: Level, event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...scrub(fields) });
  // error идёт в stderr — так Supabase помечает строку как ошибку и её видно в фильтре.
  if (level === 'error') console.error(line);
  else console.log(line);
}

/** Свой id запроса — всегда новый: присланному клиентом верить нельзя. */
export function requestIdOf(_req: Request): string {
  return crypto.randomUUID();
}

/**
 * id, присланный клиентом (для склейки с логами фронтенда), — отдельным полем.
 * В request_id его класть нельзя: подставив чужой id, можно запутать разбор инцидента.
 * Принимается, только если похож на id, — иначе через заголовок подделали бы строку лога.
 */
export function clientRequestIdOf(req: Request): string | undefined {
  const incoming = req.headers.get('x-request-id');
  return incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : undefined;
}

/** Сообщение ошибки для лога: без query (там бывают данные запроса) и не длиннее 300 символов. */
export function safeErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/\?[^\s"]*/g, '?…').slice(0, 300);
}

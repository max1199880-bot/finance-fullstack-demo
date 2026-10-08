// Общие правила HTTP-слоя: конверт ошибки, CORS и коды состояния.
// Текст ошибки показывается пользователю как есть, поэтому тексты — часть контракта
// и совпадают с текстами действующего приложения.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const unauthorized = (m = 'Требуется вход') => new HttpError(401, m);
export const notFound = (m: string) => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);

/**
 * Какие сайты могут обращаться к API. Прод-домен демо и локальная разработка;
 * всё остальное браузер отклонит. Список задаётся переменной ALLOWED_ORIGINS,
 * чтобы адрес деплоя не лежал в коде.
 */
const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function corsHeaders(origin: string | null): Record<string, string> {
  // Отвечаем конкретным адресом, а не «*»: с «*» браузер не пропускает заголовок
  // Authorization вместе с учётными данными.
  const allow = origin && allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function json(data: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

/** Тело запроса как объект. Неразборчивый JSON — ошибка клиента, а не сбой сервера. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw badRequest('Некорректный JSON в теле запроса');
  }
}

// Ошибки браузера → в логи сервера (POST /client-errors).
//
// Без этого падение экрана видно только пользователю: в Supabase Logs его нет, и о нём
// узнаёшь, когда напишут. Теперь ошибка JS попадает в те же логи, что и ошибки API,
// и разбирается тем же скриптом.
//
// Ограничения, чтобы отчёты об ошибках сами не стали проблемой:
//   • не больше 5 отчётов за загрузку страницы — цикл ошибок не завалит логи;
//   • одинаковые ошибки отправляются один раз;
//   • текст и стек обрезаны, адрес — без query и hash;
//   • sendBeacon: отчёт уходит даже при закрытии вкладки и не ждёт ответа.

const MAX_REPORTS = 5;
const sent = new Set<string>();

let endpoint = '';

type Kind = 'error' | 'unhandledrejection' | 'react';

export function reportError(error: unknown, kind: Kind = 'error'): void {
  if (!endpoint || sent.size >= MAX_REPORTS) return;

  const err = error instanceof Error ? error : new Error(String(error));
  const key = `${kind}|${err.message}`;
  if (sent.has(key)) return;
  sent.add(key);

  const payload = JSON.stringify({
    kind,
    message: err.message.slice(0, 500),
    stack: err.stack?.slice(0, 2000),
    url: `${location.origin}${location.pathname}`,
    release: import.meta.env.VITE_APP_VERSION ?? 'dev',
  });

  // sendBeacon не умеет заголовки — сервер принимает этот маршрут без входа,
  // поэтому токен не нужен. Тип text/plain не вызывает предполётный CORS-запрос.
  const blob = new Blob([payload], { type: 'text/plain' });
  if (!navigator.sendBeacon?.(endpoint, blob)) {
    void fetch(endpoint, { method: 'POST', body: payload, keepalive: true }).catch(() => {});
  }
}

/** Подключает перехват глобальных ошибок. apiBase — адрес функции API. */
export function initErrorReporting(apiBase: string): void {
  if (!import.meta.env.PROD) return; // в разработке ошибки и так видны в консоли
  endpoint = `${apiBase}/client-errors`;
  window.addEventListener('error', (e) => reportError(e.error ?? e.message, 'error'));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'unhandledrejection'));
}

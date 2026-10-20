import type { FetchStatus } from '@tanstack/react-query';

/** Почему у запроса нет данных: сервер ответил ошибкой/не достучались или запрос ждёт сеть. */
export type LoadFailure = 'error' | 'offline';

/**
 * Решает, показывать ли вместо экрана заглушку «не загрузилось».
 * Порядок важен: ошибка и приостановленный офлайн-запрос тоже означают «данных нет»,
 * поэтому без этой проверки экран висел бы на скелетоне вечно. Если данные уже есть
 * (кеш или прошлая удачная загрузка), фоновый сбой их не прячет — возвращаем null.
 */
export function loadFailure(q: {
  data: unknown;
  isError: boolean;
  fetchStatus: FetchStatus;
}): LoadFailure | null {
  if (q.data !== undefined) return null;
  if (q.isError) return 'error';
  if (q.fetchStatus === 'paused') return 'offline';
  return null;
}

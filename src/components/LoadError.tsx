import type { FetchStatus } from '@tanstack/react-query';
import { loadFailure } from '../lib/queryState';
import { haptic } from '../lib/telegram';

/** Часть UseQueryResult, которой хватает заглушке: подойдёт любой useQuery. */
export interface FailedQuery {
  data: unknown;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  fetchStatus: FetchStatus;
  refetch: () => unknown;
}

/**
 * Заглушка вместо экрана/блока, когда запрос не вернул данных: «Не удалось загрузить»
 * с кнопкой «Повторить» или «Нет сети» (офлайн без кеша). `compact` — для шторок и
 * карточек внутри экрана, где полноэкранные отступы не нужны.
 */
export function LoadError({
  query,
  title = 'Не удалось загрузить данные',
  compact = false,
}: {
  query: FailedQuery;
  title?: string;
  compact?: boolean;
}) {
  const offline = loadFailure(query) === 'offline';
  // TypeError — это fetch, не достучавшийся до сервера; текст сервера пользователю не нужен.
  const text = offline
    ? 'Данные появятся, как только вернётся связь.'
    : query.error instanceof TypeError
      ? 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.'
      : ((query.error as Error | null)?.message ?? 'Что-то пошло не так.');

  return (
    <div className={compact ? 'px-6 py-10 text-center' : 'pb-28 px-6 pt-24 text-center'} role="alert">
      <div className={compact ? 'text-4xl' : 'text-5xl'}>📡</div>
      <div className="mt-3 text-lg font-semibold">{offline ? 'Нет сети' : title}</div>
      <p className="mt-1.5 text-sm text-ios-hint leading-snug">{text}</p>
      <button
        type="button"
        onClick={() => {
          haptic('light');
          query.refetch();
        }}
        disabled={query.isFetching}
        className="mt-5 px-6 py-3 rounded-ios bg-ios-accent text-white font-semibold active:opacity-80 disabled:opacity-60 select-none-ui"
      >
        {query.isFetching ? 'Повторяю…' : 'Повторить'}
      </button>
    </div>
  );
}

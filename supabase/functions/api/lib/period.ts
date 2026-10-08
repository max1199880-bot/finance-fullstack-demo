// Месяц пользователя. У приложения месяц не обязательно календарный: при
// month_start_day = 25 «октябрь» идёт с 25 октября по 24 ноября. От этого зависят
// сводка, бюджет и все месячные итоги, поэтому границы считаются в одном месте.

export const MONTH_RE = /^\d{4}-\d{2}$/;

/** Месяц, который пользователь считает текущим: до дня начала это ещё прошлый. */
export function currentMonth(startDay: number, now = new Date()): string {
  const d = new Date(now);
  if (d.getDate() < startDay) d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Границы месяца «YYYY-MM»: полуоткрытый интервал [from, to). */
export function monthRange(month: string, startDay: number): { from: Date; to: Date } {
  const [y, m] = month.split('-').map(Number);
  return {
    from: new Date(y, m - 1, startDay),
    to: new Date(y, m, startDay),
  };
}

/** Месяц из query или тела запроса; мусор и пропуск — текущий месяц. */
export function resolveMonth(value: unknown, startDay: number): string {
  return typeof value === 'string' && MONTH_RE.test(value) ? value : currentMonth(startDay);
}

/** Сдвиг месяца на n вперёд: '2026-10' + 3 → '2027-01'. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

import { isIconRef, iconRefKey, ICON_EMOJI } from './categoryIcons';

export function fmtRub(v: string | number, opts: { signed?: boolean; compact?: boolean } = {}): string {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n)) return '— ₽';
  const negative = n < 0;
  const abs = Math.abs(n);

  if (opts.compact && abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}М ₽`;
  if (opts.compact && abs >= 100_000) return `${Math.round(abs / 1000)}К ₽`;

  const intPart = Math.trunc(abs).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const fracPart = (Math.round((abs - Math.trunc(abs)) * 100)).toString().padStart(2, '0');
  const tail = fracPart === '00' ? '' : `,${fracPart}`;
  const sign = negative ? '−' : opts.signed ? '+' : '';
  return `${sign}${intPart}${tail} ₽`;
}

export function fmtMonth(month: string): string {
  const ru = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const [y, m] = month.split('-').map(Number);
  return `${ru[m - 1]} ${y}`;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) +
    ' ' +
    d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/** Local day key (year-month-day) for grouping transactions into day sections. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Day-separator label with weekday, e.g. "02.07.2026 Пт". */
export function fmtDayHeader(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  // 'short' weekday → "пт" (some ICU builds add a trailing dot); capitalize → "Пт".
  const wd = d.toLocaleDateString('ru-RU', { weekday: 'short' }).replace(/\.$/, '');
  return `${date} ${wd.charAt(0).toUpperCase()}${wd.slice(1)}`;
}

export const STATUS_COLOR: Record<'ok' | 'warning' | 'over' | 'no_plan', string> = {
  ok: 'text-ios-green',
  warning: 'text-ios-orange',
  over: 'text-ios-red',
  no_plan: 'text-ios-hint',
};

export const STATUS_BAR: Record<'ok' | 'warning' | 'over' | 'no_plan', string> = {
  ok: 'bg-ios-green',
  warning: 'bg-ios-orange',
  over: 'bg-ios-red',
  no_plan: 'bg-ios-gray',
};

/**
 * Resolve the emoji to display for a category.
 *
 * Precedence: explicit user-set emoji → name-based auto-mapping → bullet.
 *
 * Most call sites pass just the name (because they have a string label
 * like tx.categoryName). Pass the second argument when you have the
 * full category object so the user's choice wins.
 */
export function categoryEmoji(name: string, custom?: string | null): string {
  // A pinned icon ("ic:<key>") maps to a representative emoji in sticker mode.
  if (isIconRef(custom)) return ICON_EMOJI[iconRefKey(custom as string)];
  if (custom && custom.trim().length > 0) return custom;
  const map: Record<string, string> = {
    'Продукты': '🛒',
    'Еда вне дома': '🍽',
    'Транспорт': '🚗',
    'Дом/связь': '🏠',
    'Развлечения': '🎬',
    'Покупки': '🛍',
    'Кредит': '💳',
    'Мед/спорт': '🏋️',
    'Девушки': '🌹',
    'Ремонт/инструменты': '🔧',
    'Зарплата': '💰',
    'Подработка': '💼',
    'Прочее': '✨',
  };
  return map[name] ?? '•';
}

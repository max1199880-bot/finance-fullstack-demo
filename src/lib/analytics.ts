// Яндекс.Метрика: просмотры экранов и цели на ключевые действия.
//
// Что сознательно НЕ отправляется. Это приложение личных финансов, поэтому:
//   • вебвизор выключен — он записывал бы экран целиком, вместе с суммами и комментариями;
//   • карта кликов выключена по той же причине;
//   • в параметрах целей только тип действия ('expense', 'google'), никаких сумм, имён
//     категорий, комментариев и идентификаторов;
//   • в адресе страницы отрезаются query и hash — туда могут попасть данные формы.
//
// Счётчик подключается только в собранном приложении и только если задан его номер:
// в разработке и тестах Метрика не грузится и данных не искажает.

declare global {
  interface Window {
    ym?: (id: number, method: string, ...args: unknown[]) => void;
  }
}

const COUNTER_ID = Number(import.meta.env.VITE_YM_ID ?? 0);

/** Цели, которые приложение отправляет. Их же нужно завести в Метрике как «JavaScript-событие». */
export const GOALS = {
  login: 'auth_login',
  signup: 'auth_signup',
  logout: 'auth_logout',
  loginFailed: 'auth_login_failed',
  txCreate: 'tx_create',
  txEdit: 'tx_edit',
  txDelete: 'tx_delete',
  budgetPlanSet: 'budget_plan_set',
  accountCreate: 'account_create',
  creditPayment: 'credit_payment',
  assetPurchase: 'asset_purchase',
} as const;

export type Goal = (typeof GOALS)[keyof typeof GOALS];

/**
 * Параметры цели — только значения из этого списка. Тип закрыт намеренно: строка
 * произвольного вида пропустила бы в Метрику сумму или комментарий, а здесь это
 * ошибка компиляции.
 */
export type GoalLabel =
  | 'password'
  | 'google'
  | 'demo'
  | 'expense'
  | 'income'
  | 'transfer_to_investment'
  | 'transfer_between_accounts'
  | 'credit_payment'
  | 'asset_revaluation'
  | 'loss'
  | 'cash'
  | 'bank'
  | 'investment'
  | 'other_asset'
  | 'credit'
  | 'category'
  | 'global'
  | 'propagate';
type GoalParams = Partial<Record<'method' | 'type' | 'scope', GoalLabel>>;

let enabled = false;

function respectsDoNotTrack(): boolean {
  return navigator.doNotTrack === '1' || (window as { doNotTrack?: string }).doNotTrack === '1';
}

/** Адрес без query и hash: в них бывают данные формы и токены возврата после входа. */
function cleanUrl(path: string = location.pathname): string {
  return `${location.origin}${path.split(/[?#]/)[0]}`;
}

export function initAnalytics(): void {
  if (enabled || !COUNTER_ID || !import.meta.env.PROD || respectsDoNotTrack()) return;

  // Официальный загрузчик счётчика: очередь вызовов до загрузки скрипта.
  const queue: unknown[][] = [];
  window.ym =
    window.ym ??
    ((...args: unknown[]) => {
      queue.push(args);
    });
  Object.assign(window.ym, { a: queue, l: Date.now() });

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://mc.yandex.ru/metrika/tag.js';
  document.head.appendChild(script);

  window.ym(COUNTER_ID, 'init', {
    defer: true, // просмотры отправляем сами при смене экрана — у нас SPA
    webvisor: false,
    clickmap: false,
    trackLinks: true,
    accurateTrackBounce: true,
    url: cleanUrl(),
    referrer: document.referrer ? document.referrer.split(/[?#]/)[0] : undefined,
  });
  enabled = true;
}

/** Просмотр экрана. Вызывается при каждой смене маршрута. */
export function trackPageView(path: string): void {
  if (!enabled || !window.ym) return;
  window.ym(COUNTER_ID, 'hit', cleanUrl(path), { title: document.title });
}

/** Цель на ключевое действие. Параметры — только метки из GoalLabel. */
export function trackGoal(goal: Goal, params?: GoalParams): void {
  if (!enabled || !window.ym) return;
  window.ym(COUNTER_ID, 'reachGoal', goal, params);
}

export const analyticsEnabled = () => enabled;

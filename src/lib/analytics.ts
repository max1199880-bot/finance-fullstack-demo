// Google Analytics 4: просмотры экранов и события на ключевые действия.
//
// Что сознательно НЕ отправляется. Это приложение личных финансов, поэтому:
//   • «улучшенная статистика» GA выключена в настройках потока — она сама слала бы
//     просмотры с полным адресом (включая одноразовый ?code= после входа через Google)
//     и взаимодействия с формами;
//   • рекламные сигналы и Google Signals выключены, согласие на рекламное хранилище — «нет»;
//   • в параметрах событий только тип действия ('expense', 'google'), никаких сумм, имён
//     категорий, комментариев и идентификаторов — тип GoalParams это гарантирует;
//   • в адресе страницы отрезаются query и hash.
//
// Тег подключается только в собранном приложении и только если задан идентификатор:
// в разработке и тестах аналитика не грузится и данных не искажает.
//
// Историческое название функции trackGoal оставлено: события те же, что в первой версии
// на Яндекс.Метрике (её интерфейс оказался недоступен через VPN, см. integration_documentation.md).

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const MEASUREMENT_ID = (import.meta.env.VITE_GA_ID as string | undefined) ?? '';

/** События, которые отправляет приложение. В GA их можно отметить как ключевые. */
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
 * Параметры события — только значения из этого списка. Тип закрыт намеренно: строка
 * произвольного вида пропустила бы в аналитику сумму или комментарий, а здесь это
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

/** Адрес без query и hash: в них бывают данные формы и одноразовые коды возврата после входа. */
function cleanUrl(path: string = location.pathname): string {
  return `${location.origin}${path.split(/[?#]/)[0]}`;
}

export function initAnalytics(): void {
  if (enabled || !MEASUREMENT_ID || !import.meta.env.PROD || respectsDoNotTrack()) return;

  window.dataLayer = window.dataLayer ?? [];
  // gtag обязан класть в очередь именно объект arguments — так устроен загрузчик Google.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };

  // Рекламное хранилище и персонализация — запрещены; разрешена только статистика.
  window.gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'granted',
  });
  window.gtag('js', new Date());
  window.gtag('config', MEASUREMENT_ID, {
    send_page_view: false, // у нас SPA: просмотры отправляем сами, с очищенным адресом
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    page_location: cleanUrl(),
    page_referrer: document.referrer ? document.referrer.split(/[?#]/)[0] : undefined,
  });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`;
  document.head.appendChild(script);
  enabled = true;
}

/** Просмотр экрана. Вызывается при каждой смене маршрута. */
export function trackPageView(path: string): void {
  if (!enabled || !window.gtag) return;
  window.gtag('event', 'page_view', { page_location: cleanUrl(path), page_title: document.title });
}

/** Событие на ключевое действие. Параметры — только метки из GoalLabel. */
export function trackGoal(goal: Goal, params?: GoalParams): void {
  if (!enabled || !window.gtag) return;
  window.gtag('event', goal, params ?? {});
}

export const analyticsEnabled = () => enabled;

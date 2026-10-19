// Вход, регистрация и выход. Пароли проверяет Supabase Auth: приложение их не видит
// и не хранит — в браузере остаётся только токен доступа.

import { supabase } from './supabase';

/**
 * Учётная запись для просмотра демо: заполнена вымышленными данными за полгода.
 * Домен example.com зарезервирован стандартом и никому не принадлежит: письма
 * восстановления пароля на него никто не получит (раньше был свободный домен,
 * купив который, можно было перехватить демо).
 */
export const DEMO_EMAIL = 'demo@example.com';
export const DEMO_PASSWORD =
  (import.meta.env.VITE_DEMO_PASSWORD as string | undefined) ?? 'demo-password-2026';

/** Сообщения Supabase приходят по-английски — переводим то, что видит пользователь. */
function humanize(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Неверная почта или пароль';
  if (m.includes('user already registered')) return 'Такая почта уже зарегистрирована';
  if (m.includes('password should be at least')) return 'Пароль короче 6 символов';
  if (m.includes('unable to validate email')) return 'Проверьте адрес почты';
  if (m.includes('email rate limit') || m.includes('too many requests')) {
    return 'Слишком много попыток, подождите минуту';
  }
  return message;
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(humanize(error.message));
}

export async function signUp(email: string, password: string, displayName: string): Promise<void> {
  const { error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    // Имя попадает в профиль: его забирает триггер базы при создании пользователя.
    options: { data: { display_name: displayName.trim() } },
  });
  if (error) throw new Error(humanize(error.message));
}

export const signInDemo = () => signIn(DEMO_EMAIL, DEMO_PASSWORD);

/** Метка «вход через Google начат»: после возврата от провайдера по ней понятно, откуда пришёл вход. */
export const OAUTH_PENDING_KEY = 'oauth-pending';

/**
 * Вход через Google (OAuth2 Authorization Code + PKCE).
 *   1. Supabase Auth уводит на страницу Google с одноразовым state и code_challenge.
 *   2. Google возвращает в Supabase код, Supabase проверяет его своим Client Secret.
 *   3. Пользователь попадает обратно на /login с одноразовым кодом приложения,
 *      supabase-js меняет его на сессию (detectSessionInUrl).
 * Client Secret хранится только в Supabase — в браузер он не попадает.
 */
export async function signInWithGoogle(): Promise<void> {
  try {
    sessionStorage.setItem(OAUTH_PENDING_KEY, 'google');
  } catch {
    /* без sessionStorage вход работает, просто не отметим источник в аналитике */
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/login`,
      // Окно выбора аккаунта Google каждый раз: на общем устройстве иначе молча
      // подставился бы аккаунт предыдущего человека.
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw new Error(humanize(error.message));
}

/** Ошибка, с которой провайдер вернул пользователя (отказ, отмена, неверная настройка). */
export function oauthErrorFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const code = params.get('error') ?? hash.get('error');
  if (!code) return null;
  const description = params.get('error_description') ?? hash.get('error_description') ?? '';
  if (code === 'access_denied') return 'Вход через Google отменён';
  if (/provider is not enabled/i.test(description)) return 'Вход через Google сейчас недоступен';
  return `Не удалось войти через Google${description ? `: ${description}` : ''}`;
}

export async function signOut(): Promise<void> {
  // Только это устройство: глобальный выход (по умолчанию в supabase-js) отзывает
  // сессии везде, и один посетитель демо выкидывал бы всех остальных.
  await supabase.auth.signOut({ scope: 'local' });
}

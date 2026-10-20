// Вход, регистрация и выход. Пароли проверяет Supabase Auth: приложение их не видит
// и не хранит — в браузере остаётся только токен доступа.

import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from './supabase';

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
  if (m.includes('password should be at least')) return 'Пароль — не короче 8 символов';
  if (m.includes('password should contain')) return 'В пароле нужны и буквы, и цифры';
  if (m.includes('demo') || m.includes('изменить нельзя')) return 'Пароль демо-аккаунта изменить нельзя';
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

/**
 * Включён ли вход через Google в настройках Supabase Auth.
 *
 * Пока провайдер выключен, кнопка неактивна с подсказкой — иначе вход падал бы с
 * непонятной ошибкой. Настройки публичные, их отдаёт `/auth/v1/settings` по анонимному
 * ключу. `null` — ответа нет (офлайн, сбой): тогда кнопку не блокируем, ошибку покажет вход.
 */
export async function googleSignInEnabled(): Promise<boolean | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_ANON_KEY },
    });
    if (!res.ok) return null;
    const settings = (await res.json()) as { external?: { google?: boolean } };
    return settings.external?.google === true;
  } catch {
    return null;
  }
}

/**
 * Вход по ID-токену Google (поток — в lib/googleIdentity.ts). Supabase Auth сам проверяет
 * подпись токена, адресата (наш Client ID) и nonce; приложение токену не доверяет.
 */
export async function signInWithGoogleIdToken(idToken: string, nonce: string): Promise<void> {
  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken, nonce });
  if (!error) return;
  const m = error.message.toLowerCase();
  if (m.includes('not enabled') || m.includes('unsupported provider')) {
    throw new Error('Вход через Google сейчас недоступен');
  }
  if (m.includes('nonce')) throw new Error('Вход через Google устарел, попробуйте ещё раз');
  throw new Error(`Не удалось войти через Google: ${humanize(error.message)}`);
}

export async function signOut(): Promise<void> {
  // Только это устройство: глобальный выход (по умолчанию в supabase-js) отзывает
  // сессии везде, и один посетитель демо выкидывал бы всех остальных.
  await supabase.auth.signOut({ scope: 'local' });
}

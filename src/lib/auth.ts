// Вход, регистрация и выход. Пароли проверяет Supabase Auth: приложение их не видит
// и не хранит — в браузере остаётся только токен доступа.

import { supabase } from './supabase';

/** Учётная запись для просмотра демо: заполнена вымышленными данными за полгода. */
export const DEMO_EMAIL = 'demo@finance-demo.app';
export const DEMO_PASSWORD = (import.meta.env.VITE_DEMO_PASSWORD as string | undefined) ?? 'demo-password';

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

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

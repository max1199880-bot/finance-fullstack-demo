// Вход, выход и хранение токена. Данные приложение берёт не отсюда, а через свой API
// (lib/api.ts) — так бизнес-правила живут на сервере, а не размазаны по экранам.
//
// Подключён только модуль авторизации (@supabase/auth-js), а не весь supabase-js:
// клиенты базы, хранилища, realtime и функций фронтенду не нужны, а весили 58 КБ gzip —
// треть стартовой загрузки.

import { AuthClient } from '@supabase/auth-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !key) {
  // Падаем сразу и понятно: без адреса проекта приложение всё равно работать не сможет,
  // а «тихий» вариант дал бы россыпь непонятных ошибок сети на каждом экране.
  throw new Error(
    'Не заданы VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY. Скопируйте .env.example в .env.local.',
  );
}

const auth = new AuthClient({
  url: `${url}/auth/v1`,
  headers: { apikey: key, Authorization: `Bearer ${key}` },
  // Тот же ключ хранилища, что использует supabase-js: уже вошедшие пользователи
  // не вылетят после обновления.
  storageKey: `sb-${new URL(url).hostname.split('.')[0]}-auth-token`,
  // Токен хранится в localStorage и сам обновляется по refresh-токену,
  // поэтому вход переживает перезагрузку страницы и запуск PWA с экрана.
  persistSession: true,
  autoRefreshToken: true,
  // PKCE для входа через Google: провайдер возвращает в приложение одноразовый код,
  // а не токены. Код без секрета из этого браузера бесполезен, а токен в адресе
  // страницы попал бы в историю браузера, логи и аналитику.
  flowType: 'pkce',
  detectSessionInUrl: true,
});

/** Та же форма, что у клиента supabase-js (`supabase.auth.*`), — остальной код не менялся. */
export const supabase = { auth };

/** Публичный ключ anon не секрет: доступ к данным ограничивает RLS, а не он. */
export const SUPABASE_URL = url;
export const SUPABASE_ANON_KEY = key;

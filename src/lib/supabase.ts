// Клиент Supabase: им занимается только вход, выход и хранение токена.
// Данные приложение берёт не отсюда, а через свой API (lib/api.ts) — так бизнес-правила
// живут на сервере, а не размазаны по экранам.

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !key) {
  // Падаем сразу и понятно: без адреса проекта приложение всё равно работать не сможет,
  // а «тихий» вариант дал бы россыпь непонятных ошибок сети на каждом экране.
  throw new Error(
    'Не заданы VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY. Скопируйте .env.example в .env.local.',
  );
}

export const supabase = createClient(url, key, {
  auth: {
    // Токен хранится в localStorage и сам обновляется по refresh-токену,
    // поэтому вход переживает перезагрузку страницы и запуск PWA с экрана.
    persistSession: true,
    autoRefreshToken: true,
  },
});

/** Публичный ключ anon не секрет: доступ к данным ограничивает RLS, а не он. */
export const SUPABASE_URL = url;
export const SUPABASE_ANON_KEY = key;

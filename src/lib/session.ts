// Данные пользователя в браузере живут ровно столько, сколько его сессия.
//
// Приложение кеширует ответы API в localStorage, чтобы открываться мгновенно и работать
// офлайн. Обратная сторона: после выхода в браузере оставались балансы и операции,
// а следующий вошедший на том же устройстве видел их до первого ответа сервера.
// Поэтому кеш стирается при ЛЮБОМ выходе (кнопка, просроченный токен, выход с другого
// устройства) и при входе другого пользователя.

import type { QueryClient } from '@tanstack/react-query';
import type { Persister } from '@tanstack/react-query-persist-client';
import { supabase } from './supabase';

/** Ключи с данными конкретного пользователя. Настройки оформления — общие, их не трогаем. */
const USER_KEYS = ['pref-exp-account-id'];
const LAST_USER_KEY = 'last-user-id';

function safeStorage(fn: () => void): void {
  try {
    fn();
  } catch {
    /* хранилище недоступно (приватный режим) — стирать нечего */
  }
}

export async function wipeUserData(queryClient: QueryClient, persister: Persister): Promise<void> {
  queryClient.cancelQueries();
  queryClient.clear();
  await persister.removeClient();
  safeStorage(() => USER_KEYS.forEach((k) => localStorage.removeItem(k)));
  // Кеш ответов сервис-воркера из прошлых версий приложения: в нём тоже могли остаться данные.
  if ('caches' in window) {
    const names = await caches.keys().catch(() => [] as string[]);
    await Promise.all(names.filter((n) => n.includes('api')).map((n) => caches.delete(n)));
  }
}

/** Подписка на смену сессии: выход — стереть, вход другого человека — тоже стереть. */
export function bindCacheToSession(queryClient: QueryClient, persister: Persister): void {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      void wipeUserData(queryClient, persister);
      safeStorage(() => localStorage.removeItem(LAST_USER_KEY));
      return;
    }
    if (event === 'SIGNED_IN' && session) {
      let previous: string | null = null;
      safeStorage(() => {
        previous = localStorage.getItem(LAST_USER_KEY);
      });
      if (previous && previous !== session.user.id) void wipeUserData(queryClient, persister);
      safeStorage(() => localStorage.setItem(LAST_USER_KEY, session.user.id));
    }
  });
}

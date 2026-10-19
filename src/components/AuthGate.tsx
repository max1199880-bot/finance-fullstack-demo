import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import type { Session } from '@supabase/auth-js';
import { supabase } from '../lib/supabase';

/**
 * Пропускает в приложение только с действующей сессией.
 *
 * Сессия читается из хранилища браузера, а не запросом к серверу. Поэтому
 * приложение открывается мгновенно и работает офлайн: сервер недоступен —
 * показываем сохранённые данные, а не экран входа. Просроченный токен отсечёт
 * сам API ответом 401, и тогда запрос вернёт пользователя на вход.
 */
export function AuthGate() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    // Вход и выход происходят на других экранах — следим за ними, чтобы
    // переход случался сразу, без перезагрузки страницы.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center gap-3">
        <div className="text-5xl">₽</div>
        <div className="flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-ios-hint animate-pulse" />
          <span className="h-2 w-2 rounded-full bg-ios-hint animate-pulse [animation-delay:150ms]" />
          <span className="h-2 w-2 rounded-full bg-ios-hint animate-pulse [animation-delay:300ms]" />
        </div>
      </div>
    );
  }

  if (session === null) return <Navigate to="/login" replace />;
  return <Outlet />;
}

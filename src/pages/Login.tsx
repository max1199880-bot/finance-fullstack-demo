import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  OAUTH_PENDING_KEY,
  googleSignInEnabled,
  oauthErrorFromUrl,
  signIn,
  signInDemo,
  signInWithGoogle,
  signUp,
} from '../lib/auth';
import { supabase } from '../lib/supabase';
import { GOALS, trackGoal, type GoalLabel } from '../lib/analytics';

/**
 * Экран входа. Пароль уходит в Supabase Auth напрямую, минуя наш API: приложение
 * не видит и не хранит пароли, в браузере остаётся только токен доступа.
 *
 * Кнопка «Посмотреть демо» открывает готовый аккаунт с вымышленными данными —
 * чтобы приложение можно было оценить, не регистрируясь.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<'form' | 'demo' | 'google' | null>(null);
  const [googleAvailable, setGoogleAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void googleSignInEnabled().then((v) => alive && setGoogleAvailable(v));
    return () => {
      alive = false;
    };
  }, []);
  // Ошибку от провайдера читаем сразу при открытии: Google вернул пользователя сюда
  // с ?error=… (например, он нажал «Отмена»).
  const [error, setError] = useState(() => oauthErrorFromUrl() ?? '');

  // Возврат от Google. Код из адреса меняет на сессию сам supabase-js; здесь —
  // дождаться этого, убрать служебные параметры из адреса и войти в приложение.
  useEffect(() => {
    const pending = (() => {
      try {
        return sessionStorage.getItem(OAUTH_PENDING_KEY);
      } catch {
        return null;
      }
    })();
    const finish = () => {
      try {
        sessionStorage.removeItem(OAUTH_PENDING_KEY);
      } catch {
        /* нечего убирать */
      }
    };

    if (oauthErrorFromUrl()) {
      if (pending) trackGoal(GOALS.loginFailed, { method: 'google' });
      finish();
      window.history.replaceState(null, '', '/login');
      return;
    }

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_IN' || !pending) return;
      finish();
      trackGoal(GOALS.login, { method: 'google' });
      qc.clear();
      navigate('/', { replace: true });
    });
    return () => data.subscription.unsubscribe();
  }, [navigate, qc]);

  async function enter(
    action: () => Promise<void>,
    who: 'form' | 'demo',
    goal: 'login' | 'signup' = 'login',
  ) {
    setBusy(who);
    setError('');
    const method: GoalLabel = who === 'demo' ? 'demo' : 'password';
    try {
      await action();
      trackGoal(goal === 'signup' ? GOALS.signup : GOALS.login, { method });
      // Чужой кеш из прошлой сессии не должен попасть в новый аккаунт: не помечаем
      // устаревшим, а стираем — иначе экраны успели бы показать данные прошлого человека.
      qc.clear();
      navigate('/', { replace: true });
    } catch (e) {
      trackGoal(GOALS.loginFailed, { method });
      setError((e as Error).message || 'Не удалось войти');
    } finally {
      setBusy(null);
    }
  }

  async function enterWithGoogle() {
    setBusy('google');
    setError('');
    try {
      // Страница уходит на Google — busy снимать не нужно, сюда вернутся уже с кодом.
      await signInWithGoogle();
    } catch (e) {
      trackGoal(GOALS.loginFailed, { method: 'google' });
      setError((e as Error).message || 'Не удалось начать вход через Google');
      setBusy(null);
    }
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Заполните почту и пароль');
      return;
    }
    void enter(
      () => (mode === 'signin' ? signIn(email, password) : signUp(email, password, name || 'Без имени')),
      'form',
      mode === 'signin' ? 'login' : 'signup',
    );
  };

  const tab = (value: 'signin' | 'signup', label: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(value);
        setError('');
      }}
      className={`flex-1 py-2 rounded-xl text-[15px] font-medium transition-colors ${
        mode === value ? 'bg-ios-surface shadow-sm' : 'text-ios-hint'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-full flex flex-col items-center justify-center px-8">
      <div className="text-6xl mb-4">₽</div>
      <h1 className="text-2xl font-bold mb-1">Финансы</h1>
      <p className="text-ios-hint text-sm mb-8 text-center">
        Личные финансы: расходы, бюджет, капитал и аналитика.
      </p>

      <div className="w-full max-w-xs">
        <div className="flex gap-1 p-1 mb-4 rounded-2xl bg-ios-surface2">
          {tab('signin', 'Вход')}
          {tab('signup', 'Регистрация')}
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-2">
          {mode === 'signup' && (
            <input
              className="w-full px-4 py-3 rounded-xl bg-ios-surface text-[17px] outline-none"
              placeholder="Имя"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          <input
            className="w-full px-4 py-3 rounded-xl bg-ios-surface text-[17px] outline-none"
            placeholder="Почта"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="w-full px-4 py-3 rounded-xl bg-ios-surface text-[17px] outline-none"
            placeholder="Пароль"
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy !== null}
            className="mt-2 w-full py-3 rounded-xl bg-ios-accent text-white text-[17px] font-medium disabled:opacity-50"
          >
            {busy === 'form' ? 'Входим…' : mode === 'signin' ? 'Войти' : 'Создать аккаунт'}
          </button>
        </form>

        <div className="flex items-center gap-3 my-4 text-ios-hint text-[13px]">
          <div className="h-px flex-1 bg-ios-divider" />
          или
          <div className="h-px flex-1 bg-ios-divider" />
        </div>

        <button
          type="button"
          onClick={() => void enterWithGoogle()}
          disabled={busy !== null || googleAvailable === false}
          aria-describedby={googleAvailable === false ? 'google-off' : undefined}
          className="w-full py-3 rounded-xl bg-ios-surface text-[17px] flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <svg aria-hidden width="18" height="18" viewBox="0 0 48 48">
            <path
              fill="#FFC107"
              d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
            />
            <path
              fill="#FF3D00"
              d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
            />
            <path
              fill="#4CAF50"
              d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
            />
            <path
              fill="#1976D2"
              d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
            />
          </svg>
          {busy === 'google' ? 'Переходим в Google…' : 'Войти через Google'}
        </button>
        {googleAvailable === false && (
          <div id="google-off" className="mt-1 text-ios-hint text-[13px] text-center">
            Вход через Google пока не включён на сервере
          </div>
        )}

        <button
          type="button"
          onClick={() => void enter(signInDemo, 'demo')}
          disabled={busy !== null}
          className="mt-3 w-full py-3 rounded-xl bg-ios-surface text-[17px] disabled:opacity-50"
        >
          {busy === 'demo' ? 'Открываем…' : 'Посмотреть демо'}
        </button>

        {error && <div className="mt-4 text-ios-red text-sm text-center">{error}</div>}

        <p className="mt-8 text-[11px] text-ios-hint leading-snug text-center">
          Демо-аккаунт открыт для всех: данные в нём вымышленные, и их видят все, кто зашёл по этой кнопке.
          Для своих расходов заведите отдельный аккаунт.{' '}
          <a href="/privacy.html" className="underline">
            Политика конфиденциальности
          </a>
        </p>
      </div>
    </div>
  );
}

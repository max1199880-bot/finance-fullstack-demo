import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { signIn, signInDemo, signUp } from '../lib/auth';

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
  const [busy, setBusy] = useState<'form' | 'demo' | null>(null);
  const [error, setError] = useState('');

  async function enter(action: () => Promise<void>, who: 'form' | 'demo') {
    setBusy(who);
    setError('');
    try {
      await action();
      // Чужой кеш из прошлой сессии не должен попасть в новый аккаунт.
      await qc.invalidateQueries();
      navigate('/', { replace: true });
    } catch (e) {
      setError((e as Error).message || 'Не удалось войти');
    } finally {
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
    );
  };

  const tab = (value: 'signin' | 'signup', label: string) => (
    <button
      type="button"
      onClick={() => { setMode(value); setError(''); }}
      className={`flex-1 py-2 rounded-xl text-[15px] font-medium transition-colors ${
        mode === value ? 'bg-ios-card shadow-sm' : 'text-ios-hint'
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
        <div className="flex gap-1 p-1 mb-4 rounded-2xl bg-ios-bg-secondary">
          {tab('signin', 'Вход')}
          {tab('signup', 'Регистрация')}
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-2">
          {mode === 'signup' && (
            <input
              className="w-full px-4 py-3 rounded-xl bg-ios-card text-[17px] outline-none"
              placeholder="Имя"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          <input
            className="w-full px-4 py-3 rounded-xl bg-ios-card text-[17px] outline-none"
            placeholder="Почта"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="w-full px-4 py-3 rounded-xl bg-ios-card text-[17px] outline-none"
            placeholder="Пароль"
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy !== null}
            className="mt-2 w-full py-3 rounded-xl bg-ios-blue text-white text-[17px] font-medium disabled:opacity-50"
          >
            {busy === 'form' ? 'Входим…' : mode === 'signin' ? 'Войти' : 'Создать аккаунт'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => void enter(signInDemo, 'demo')}
          disabled={busy !== null}
          className="mt-3 w-full py-3 rounded-xl bg-ios-card text-[17px] disabled:opacity-50"
        >
          {busy === 'demo' ? 'Открываем…' : 'Посмотреть демо'}
        </button>

        {error && <div className="mt-4 text-ios-red text-sm text-center">{error}</div>}

        <p className="mt-8 text-[11px] text-ios-hint leading-snug text-center">
          Демо-аккаунт открыт для всех: данные в нём вымышленные, и их видят все, кто
          зашёл по этой кнопке. Для своих расходов заведите отдельный аккаунт.
        </p>
      </div>
    </div>
  );
}

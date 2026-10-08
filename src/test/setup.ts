import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Тесты экранов работают против демо-сервера в памяти, но модуль lib/supabase требует
// адрес проекта ещё при импорте — подставляем значения-заглушки.
vi.stubEnv('VITE_SUPABASE_URL', 'http://supabase.test');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');

// Вход в тестах уже выполнен: подменяем только работу с сессией, остальной
// код приложения (экраны, запросы, кеш) остаётся настоящим.
vi.mock('../lib/supabase', () => {
  const session = { access_token: 'test-token', user: { id: 'demo-user' } };
  return {
    SUPABASE_URL: 'http://supabase.test',
    SUPABASE_ANON_KEY: 'test-anon-key',
    supabase: {
      auth: {
        getSession: async () => ({ data: { session }, error: null }),
        signOut: async () => ({ error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});


// Node 25 объявляет собственный экспериментальный глобальный localStorage; без флага
// --localstorage-file это заглушка без методов, и в jsdom она перекрывает нормальное
// хранилище («localStorage.clear is not a function»). Экраны прода пользуются localStorage
// (любимый счёт списания, тема иконок), поэтому ставим полноценное хранилище в памяти.
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
}
for (const name of ['localStorage', 'sessionStorage'] as const) {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, name, { value: storage, configurable: true });
  Object.defineProperty(window, name, { value: storage, configurable: true });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

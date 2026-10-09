// Обвязка интеграционных тестов API: они ходят в НАСТОЯЩИЙ бэкенд — локальный Supabase
// с применёнными миграциями и запущенной функцией `api`.
//
// Почему не моки: смысл этих тестов в том, что сходится связка «политики RLS + SQL-функции
// + обработчики». Мок проверял бы только наши ожидания от самих себя.
//
// Запуск: npx supabase start && npx supabase functions serve api  → npm run test:api

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const API_BASE = `${SUPABASE_URL}/functions/v1/api`;

export interface Client {
  token: string;
  userId: string;
  email: string;
}

/** Новый пользователь на каждый тест-файл: чужие данные не мешают и видно работу RLS. */
export async function createUser(prefix = 'test'): Promise<Client> {
  // Домен example.com зарезервирован стандартом под примеры: Supabase в облаке
  // отвергает выдуманные зоны вроде .local, а на этот адрес письма никому не уйдут.
  const email = `${prefix}-${crypto.randomUUID()}@example.com`;
  const supabase = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.signUp({ email, password: 'test-password-123' });
  if (error) throw new Error(`Регистрация не удалась: ${error.message}`);
  if (!data.session) throw new Error('Supabase не выдал сессию: включено подтверждение почты?');
  return { token: data.session.access_token, userId: data.user!.id, email };
}

export async function signInDemo(): Promise<Client> {
  const supabase = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'demo@finance-demo.app',
    password: process.env.VITE_DEMO_PASSWORD ?? 'demo-password',
  });
  if (error) throw new Error(`Вход в демо не удался (запускали npm run seed:demo?): ${error.message}`);
  return { token: data.session!.access_token, userId: data.user!.id, email: data.user!.email! };
}

export interface ApiResponse<T> {
  status: number;
  body: T;
}

/** Запрос к API от имени пользователя. Ошибки не бросаются: статус — часть проверки. */
export async function api<T = Record<string, unknown>>(
  client: Client | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      apikey: ANON_KEY,
      ...(client ? { Authorization: `Bearer ${client.token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

/** Короткая форма для успешных запросов: падает сразу, если статус не 200. */
export async function ok<T = Record<string, unknown>>(
  client: Client,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await api<T>(client, method, path, body);
  if (res.status !== 200) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

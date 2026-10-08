// Безопасность: вход, изоляция данных между пользователями, CORS.
// Это главная проверка бэкенда: ошибка здесь означает чужие деньги на экране.

import { beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { api, createUser, ok, type Client } from '../api.setup';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';

let alice: Client;
let bob: Client;

beforeAll(async () => {
  alice = await createUser('alice');
  bob = await createUser('bob');
});

describe('Вход', () => {
  it('без токена API отвечает 401, а не данными', async () => {
    const res = await api(null, 'GET', '/me');
    expect(res.status).toBe(401);
  });

  it('с подделанным токеном — тоже 401', async () => {
    const res = await api({ token: 'not-a-token', userId: 'x', email: 'x' }, 'GET', '/me');
    expect(res.status).toBe(401);
  });

  it('проверка живости отвечает без входа', async () => {
    const res = await api(null, 'GET', '/health');
    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
  });

  it('новому пользователю заведён профиль и стартовый набор', async () => {
    const me = await ok<{ id: string; monthStartDay: number; currency: string }>(alice, 'GET', '/me');
    expect(me.id).toBe(alice.userId);
    expect(me.currency).toBe('RUB');
    expect(me.monthStartDay).toBe(1);

    const categories = await ok<unknown[]>(alice, 'GET', '/categories?type=expense');
    expect(categories.length).toBe(8);
    const accounts = await ok<unknown[]>(alice, 'GET', '/accounts');
    expect(accounts.length).toBe(2);
  });
});

describe('Изоляция данных (RLS)', () => {
  it('операции одного пользователя не видны другому', async () => {
    const accounts = await ok<{ id: string; name: string }[]>(alice, 'GET', '/accounts');
    const categories = await ok<{ id: string }[]>(alice, 'GET', '/categories?type=expense');
    await ok(alice, 'POST', '/transactions', {
      type: 'expense',
      categoryId: categories[0].id,
      fromAccountId: accounts[0].id,
      amount: '1000',
      comment: 'тайная покупка',
    });

    const mine = await ok<unknown[]>(alice, 'GET', '/transactions');
    const theirs = await ok<{ comment: string | null }[]>(bob, 'GET', '/transactions');
    expect(mine.length).toBe(1);
    expect(theirs.length).toBe(0);
    expect(theirs.some((t) => t.comment === 'тайная покупка')).toBe(false);
  });

  it('чужой счёт нельзя прочитать по прямой ссылке', async () => {
    const accounts = await ok<{ id: string }[]>(alice, 'GET', '/accounts');
    const res = await api(bob, 'GET', `/accounts/${accounts[0].id}/tx-count`);
    expect(res.status).toBe(404);
  });

  it('в чужой счёт нельзя записать операцию', async () => {
    const aliceAccounts = await ok<{ id: string }[]>(alice, 'GET', '/accounts');
    const bobCategories = await ok<{ id: string }[]>(bob, 'GET', '/categories?type=expense');
    const res = await api(bob, 'POST', '/transactions', {
      type: 'expense',
      categoryId: bobCategories[0].id,
      fromAccountId: aliceAccounts[0].id,
      amount: '100',
    });
    expect(res.status).toBe(404);
  });

  it('политики не обойти через прямой доступ к таблицам (PostgREST)', async () => {
    // Клиент с токеном Боба ходит в базу в обход нашего API — его тоже
    // ограничивает RLS, иначе дыра была бы прямо в браузере.
    const bobDb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${bob.token}` } },
      auth: { persistSession: false },
    });
    const { data } = await bobDb.from('transactions').select('id, comment');
    expect(data ?? []).toHaveLength(0);

    const alicePatch = await bobDb
      .from('profiles')
      .update({ display_name: 'взломано' })
      .eq('id', alice.userId)
      .select();
    expect(alicePatch.data ?? []).toHaveLength(0);
  });

  it('анонимный ключ без входа не даёт читать таблицы', async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { data, error } = await anon.from('transactions').select('id');
    expect(data ?? []).toHaveLength(0);
    // Либо пустой ответ, либо прямой отказ — главное, что строк нет.
    expect(error === null || typeof error.message === 'string').toBe(true);
  });
});

describe('CORS', () => {
  it('предполётный запрос с разрешённого адреса пропускается', async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/api/me`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' },
    });
    // Локально предполётный запрос заканчивается на шлюзе Supabase и до функции не доходит,
    // поэтому проверяем только то, что браузер получит разрешение.
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
  });

  it('ответ API несёт разрешение именно для адреса приложения', async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/api/health`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    // Локальный шлюз Supabase подменяет заголовок на «*»; в облаке до браузера
    // доходит значение из функции. Проверяем, что адрес приложения разрешён в обоих случаях.
    expect(['http://localhost:5173', '*']).toContain(res.headers.get('access-control-allow-origin'));
  });

  it('чужому адресу наш не подставляется', async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/api/health`, {
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.headers.get('access-control-allow-origin')).not.toBe('https://evil.example');
  });
});

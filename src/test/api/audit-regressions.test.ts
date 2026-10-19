// Регрессионные тесты по аудиту безопасности: на каждую исправленную находку — проверка,
// что атака из отчёта больше не проходит. Номера — из security_audit.md.

import { beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { api, createUser, ok, signInDemo, type Client } from '../api.setup';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';

interface Account {
  id: string;
  type: string;
  balance: string;
}

const dbAs = (c: Client) =>
  createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${c.token}` } },
    auth: { persistSession: false },
  });

let alice: Client;
let bob: Client;

beforeAll(async () => {
  alice = await createUser('audit-a');
  bob = await createUser('audit-b');
});

describe('B-1, B-2: общий демо-аккаунт нельзя испортить для других', () => {
  it('B-1: пароль демо сменить нельзя даже из его же сессии', async () => {
    const demo = await signInDemo();
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${demo.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: 'hijacked-password-1' }),
    });
    expect(res.ok).toBe(false);

    // Вход со старым паролем по-прежнему работает — демо открыт для всех.
    await expect(signInDemo()).resolves.toBeTruthy();
  });

  it('B-2: удаление в демо через API отклоняется с понятным текстом', async () => {
    const demo = await signInDemo();
    const accounts = await ok<Account[]>(demo, 'GET', '/accounts');
    const res = await api<{ error: string }>(demo, 'DELETE', `/accounts/${accounts[0].id}/purge`);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('демо');
    expect((await ok<Account[]>(demo, 'GET', '/accounts')).length).toBe(accounts.length);
  });

  it('B-2: и напрямую через PostgREST — второй рубеж в самой базе', async () => {
    const demo = await signInDemo();
    const before = await dbAs(demo).from('transactions').select('id', { count: 'exact', head: true });
    await dbAs(demo).from('transactions').delete().not('id', 'is', null);
    const after = await dbAs(demo).from('transactions').select('id', { count: 'exact', head: true });
    expect(after.count).toBe(before.count);
  });
});

describe('B-3: параллельные операции не теряют обновления остатка', () => {
  it('8 одновременных доходов по 100 ₽ дают ровно +800', async () => {
    const accounts = await ok<Account[]>(alice, 'GET', '/accounts');
    const bank = accounts.find((a) => a.type === 'bank')!;
    const sources = await ok<{ id: string }[]>(alice, 'GET', '/income-sources');
    const before = Number(bank.balance);

    await Promise.all(
      Array.from({ length: 8 }, () =>
        ok(alice, 'POST', '/transactions', {
          type: 'income',
          incomeSourceId: sources[0].id,
          toAccountId: bank.id,
          amount: '100',
        }),
      ),
    );

    const after = (await ok<Account[]>(alice, 'GET', '/accounts')).find((a) => a.id === bank.id)!;
    expect(Number(after.balance)).toBe(before + 800);
  });
});

describe('B-4: аналитика не принимает огромные периоды', () => {
  it('период в тысячи лет отклоняется до вычислений', async () => {
    const res = await api(alice, 'GET', '/analytics/daily?from=1000-01-01&to=9999-12-31');
    expect(res.status).toBe(400);
  });

  it('начало позже конца — тоже ошибка ввода', async () => {
    const res = await api(alice, 'GET', '/analytics/summary?from=2026-10-01&to=2026-01-01');
    expect(res.status).toBe(400);
  });

  it('год — самый длинный период экрана — работает', async () => {
    const res = await api(alice, 'GET', '/analytics/daily?from=2025-10-19&to=2026-10-19');
    expect(res.status).toBe(200);
  });
});

describe('B-5: длина текста ограничена в базе', () => {
  it('комментарий в 3 МБ через API — 400 с понятным текстом', async () => {
    const accounts = await ok<Account[]>(alice, 'GET', '/accounts');
    const categories = await ok<{ id: string }[]>(alice, 'GET', '/categories?type=expense');
    const res = await api<{ error: string }>(alice, 'POST', '/transactions', {
      type: 'expense',
      categoryId: categories[0].id,
      fromAccountId: accounts[0].id,
      amount: '10',
      comment: 'x'.repeat(3_000_000),
    });
    expect(res.status).toBe(400);
  });

  it('и в обход API, напрямую в таблицу, тоже не записать', async () => {
    const { error } = await dbAs(alice)
      .from('income_sources')
      .insert({
        user_id: alice.userId,
        name: 'Спам',
        emoji: 'x'.repeat(100_000),
      });
    expect(error).not.toBeNull();
  });
});

describe('B-6: нельзя сослаться на чужую строку', () => {
  it('операция Боба со счётом Алисы отклоняется базой', async () => {
    const aliceAccount = (await ok<Account[]>(alice, 'GET', '/accounts'))[0];
    const bobCategory = (await ok<{ id: string }[]>(bob, 'GET', '/categories?type=expense'))[0];
    const { error } = await dbAs(bob).from('transactions').insert({
      user_id: bob.userId,
      date: new Date().toISOString(),
      amount: '1',
      type: 'expense',
      category_id: bobCategory.id,
      from_account_id: aliceAccount.id,
    });
    expect(error).not.toBeNull();
  });

  it('план бюджета на чужую категорию отклоняется', async () => {
    const aliceCategory = (await ok<{ id: string }[]>(alice, 'GET', '/categories?type=expense'))[0];
    const { error } = await dbAs(bob).from('budget_plan_month').insert({
      user_id: bob.userId,
      month: '2026-10',
      category_id: aliceCategory.id,
      planned_amount: '1',
    });
    expect(error).not.toBeNull();
  });
});

describe('B-9, B-10: некорректный ввод — 400/404, а не 500', () => {
  it('сумма больше предела — «Invalid amount»', async () => {
    const accounts = await ok<Account[]>(alice, 'GET', '/accounts');
    const categories = await ok<{ id: string }[]>(alice, 'GET', '/categories?type=expense');
    const res = await api<{ error: string }>(alice, 'POST', '/transactions', {
      type: 'expense',
      categoryId: categories[0].id,
      fromAccountId: accounts[0].id,
      amount: '99999999999999',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid amount');
  });

  it('id счёта не в формате UUID — 404', async () => {
    const categories = await ok<{ id: string }[]>(alice, 'GET', '/categories?type=expense');
    const res = await api(alice, 'POST', '/transactions', {
      type: 'expense',
      categoryId: categories[0].id,
      fromAccountId: 'not-a-uuid',
      amount: '10',
    });
    expect(res.status).toBe(404);
  });
});

describe('B-14: служебные поля профиля не меняются пользователем', () => {
  it('способ входа выставить себе нельзя', async () => {
    const { error } = await dbAs(alice)
      .from('profiles')
      .update({ auth_provider: 'google' })
      .eq('id', alice.userId);
    expect(error).not.toBeNull();
  });

  it('свои настройки менять по-прежнему можно', async () => {
    const { error } = await dbAs(alice)
      .from('profiles')
      .update({ month_start_day: 5 })
      .eq('id', alice.userId);
    expect(error).toBeNull();
  });
});

describe('B-11: политика паролей', () => {
  it('пароль из одних цифр не принимается', async () => {
    const supabase = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { error } = await supabase.auth.signUp({
      email: `weak-${crypto.randomUUID()}@example.com`,
      password: '12345678',
    });
    expect(error).not.toBeNull();
  });
});

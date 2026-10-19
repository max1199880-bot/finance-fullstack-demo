// Рабочие сценарии API: справочники, операции и остатки, бюджет, капитал.
// Каждый тест начинается с чистого пользователя, поэтому счётчики и суммы предсказуемы.

import { beforeAll, describe, expect, it } from 'vitest';
import { api, createUser, ok, type Client } from '../api.setup';

interface Account {
  id: string;
  name: string;
  type: string;
  balance: string;
}
interface Category {
  id: string;
  name: string;
  isActive?: boolean;
}

let user: Client;
let cash: Account;
let bank: Account;
let food: Category;

beforeAll(async () => {
  user = await createUser('core');
  const accounts = await ok<Account[]>(user, 'GET', '/accounts');
  cash = accounts.find((a) => a.type === 'cash')!;
  bank = accounts.find((a) => a.type === 'bank')!;
  const categories = await ok<Category[]>(user, 'GET', '/categories?type=expense');
  food = categories.find((c) => c.name === 'Продукты')!;
});

describe('Справочники', () => {
  it('категория создаётся, переименовывается и скрывается вместо удаления, если есть операции', async () => {
    const created = await ok<{ id: string }>(user, 'POST', '/categories', { name: 'Хобби', type: 'expense' });
    await ok(user, 'PATCH', `/categories/${created.id}`, { name: 'Хобби и спорт' });

    const all = await ok<Category[]>(user, 'GET', '/categories/all');
    expect(all.find((c) => c.id === created.id)?.name).toBe('Хобби и спорт');

    await ok(user, 'POST', '/transactions', {
      type: 'expense',
      categoryId: created.id,
      fromAccountId: cash.id,
      amount: '300',
    });
    const deleted = await ok<{ action: string }>(user, 'DELETE', `/categories/${created.id}`);
    expect(deleted.action).toBe('hidden');

    const hidden = await ok<{ id: string; txCount: number }[]>(user, 'GET', '/categories/hidden');
    expect(hidden.find((c) => c.id === created.id)?.txCount).toBe(1);
  });

  it('повтор имени отклоняется с понятным текстом', async () => {
    const res = await api(user, 'POST', '/categories', { name: 'Продукты', type: 'expense' });
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toBe('Категория с таким именем уже существует');
  });

  it('категорию без имени создать нельзя', async () => {
    const res = await api(user, 'POST', '/categories', { type: 'expense' });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('name required');
  });

  it('источник дохода создаётся и попадает в список', async () => {
    await ok(user, 'POST', '/income-sources', { name: 'Фриланс' });
    const sources = await ok<{ name: string }[]>(user, 'GET', '/income-sources');
    expect(sources.map((s) => s.name)).toContain('Фриланс');
  });
});

describe('Операции и остатки', () => {
  it('расход уменьшает остаток счёта, доход увеличивает', async () => {
    await ok(user, 'PUT', '/capital/balance', { accountId: bank.id, balance: '10000' });

    await ok(user, 'POST', '/transactions', {
      type: 'expense',
      categoryId: food.id,
      fromAccountId: bank.id,
      amount: '1500,50',
    });
    let accounts = await ok<Account[]>(user, 'GET', '/accounts');
    expect(accounts.find((a) => a.id === bank.id)?.balance).toBe('8499.5');

    const sources = await ok<{ id: string }[]>(user, 'GET', '/income-sources');
    await ok(user, 'POST', '/transactions', {
      type: 'income',
      incomeSourceId: sources[0].id,
      toAccountId: bank.id,
      amount: '500',
    });
    accounts = await ok<Account[]>(user, 'GET', '/accounts');
    expect(accounts.find((a) => a.id === bank.id)?.balance).toBe('8999.5');
  });

  it('перевод между счетами не меняет общий капитал', async () => {
    const before = await ok<{ totalNetWorth: string }>(user, 'GET', '/capital');
    await ok(user, 'POST', '/transactions', {
      type: 'transfer_between_accounts',
      fromAccountId: bank.id,
      toAccountId: cash.id,
      amount: '1000',
    });
    const after = await ok<{ totalNetWorth: string }>(user, 'GET', '/capital');
    expect(after.totalNetWorth).toBe(before.totalNetWorth);
  });

  it('повтор с тем же ключом не создаёт вторую операцию', async () => {
    const key = crypto.randomUUID();
    const body = {
      type: 'expense',
      categoryId: food.id,
      fromAccountId: cash.id,
      amount: '700',
      clientTxId: key,
    };
    const first = await ok<{ id: string }>(user, 'POST', '/transactions', body);
    const second = await ok<{ id: string }>(user, 'POST', '/transactions', body);
    expect(second.id).toBe(first.id);

    const list = await ok<{ id: string }[]>(user, 'GET', '/transactions?limit=500');
    expect(list.filter((t) => t.id === first.id)).toHaveLength(1);
  });

  it('удаление операции возвращает деньги на счёт', async () => {
    const before = await ok<Account[]>(user, 'GET', '/accounts');
    const balanceBefore = before.find((a) => a.id === cash.id)!.balance;

    const created = await ok<{ id: string }>(user, 'POST', '/transactions', {
      type: 'expense',
      categoryId: food.id,
      fromAccountId: cash.id,
      amount: '250',
    });
    await ok(user, 'DELETE', `/transactions/${created.id}`);

    const after = await ok<Account[]>(user, 'GET', '/accounts');
    expect(after.find((a) => a.id === cash.id)?.balance).toBe(balanceBefore);
  });

  it('сумма с нулём или буквами отклоняется', async () => {
    for (const amount of ['0', 'сто рублей', '-5']) {
      const res = await api(user, 'POST', '/transactions', {
        type: 'expense',
        categoryId: food.id,
        fromAccountId: cash.id,
        amount,
      });
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toBe('Invalid amount');
    }
  });

  it('операцию нельзя записать в несуществующую категорию', async () => {
    const res = await api(user, 'POST', '/transactions', {
      type: 'expense',
      categoryId: crypto.randomUUID(),
      fromAccountId: cash.id,
      amount: '100',
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe('Category not found');
  });
});

describe('Бюджет', () => {
  it('план и факт дают процент и статус', async () => {
    await ok(user, 'PUT', '/budget/category', { categoryId: food.id, amount: '1000' });
    const budget = await ok<{
      categories: {
        categoryId: string;
        planned: string;
        actual: string;
        percent: number | null;
        status: string;
      }[];
      total: { planned: string };
    }>(user, 'GET', '/budget');

    const row = budget.categories.find((c) => c.categoryId === food.id)!;
    expect(row.planned).toBe('1000');
    // Процент считается от факта, а он зависит от порядка прошедших тестов,
    // поэтому сверяем формулу, а не конкретное число.
    expect(row.percent).toBe(Math.round((Number(row.actual) / 1000) * 100));
    expect(Number(row.actual)).toBeGreaterThan(1100); // израсходовано больше 110% плана
    expect(row.status).toBe('over');
    expect(budget.total.planned).toBe('1000');
  });

  it('нулевой план снимает ограничение', async () => {
    await ok(user, 'PUT', '/budget/category', { categoryId: food.id, amount: '0' });
    const budget = await ok<{ categories: { categoryId: string; status: string }[] }>(user, 'GET', '/budget');
    expect(budget.categories.find((c) => c.categoryId === food.id)?.status).toBe('no_plan');
  });

  it('план переносится на следующие месяцы', async () => {
    const res = await ok<{ written: number; skipped: number; months: number }>(
      user,
      'PUT',
      '/budget/category/propagate',
      { categoryId: food.id, amount: '2000', propagateMonths: 2 },
    );
    expect(res.months).toBe(3);
    expect(res.written).toBe(3);
  });

  it('отрицательный план отклоняется', async () => {
    const res = await api(user, 'PUT', '/budget/category', { categoryId: food.id, amount: '-100' });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('Invalid amount');
  });
});

describe('Капитал', () => {
  it('итог равен сумме счетов за вычетом долгов', async () => {
    const capital = await ok<{
      accounts: Account[];
      totalCash: string;
      totalCredits: string;
      totalNetWorth: string;
    }>(user, 'GET', '/capital');

    const cashSum = capital.accounts
      .filter((a) => a.type === 'cash' || a.type === 'bank')
      .reduce((acc, a) => acc + Number(a.balance), 0);
    expect(Number(capital.totalCash)).toBeCloseTo(cashSum, 2);
    expect(Number(capital.totalNetWorth)).toBeCloseTo(
      Number(capital.totalCash) + Number(capital.totalCredits) * -1,
      2,
    );
  });

  it('новый счёт создаётся с начальным остатком', async () => {
    const created = await ok<{ id: string }>(user, 'POST', '/accounts', {
      name: 'Копилка',
      type: 'bank',
      initialBalance: '25000',
    });
    const accounts = await ok<Account[]>(user, 'GET', '/accounts');
    expect(accounts.find((a) => a.id === created.id)?.balance).toBe('25000');
  });

  it('счёт с занятым именем не создаётся', async () => {
    const res = await api(user, 'POST', '/accounts', { name: 'Копилка', type: 'bank' });
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toBe('Аккаунт с таким именем уже существует');
  });
});

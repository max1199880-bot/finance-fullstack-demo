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

describe('Поиск и фильтры операций', () => {
  interface Tx {
    id: string;
    comment: string | null;
    categoryId: string | null;
    categoryName: string | null;
    incomeSourceName: string | null;
  }
  let me: Client;
  let stranger: Client;
  let cafe: Category;
  let transport: Category;
  let milk: Tx;
  let discount: Tx;
  let taxi: Tx;
  let salary: Tx;

  // Без limit по умолчанию отдаётся 20 операций — для четырёх записей этого хватает.
  const find = (client: Client, query: string) => ok<Tx[]>(client, 'GET', `/transactions?${query}`);
  const ids = (list: Tx[]) => list.map((t) => t.id).sort();

  beforeAll(async () => {
    me = await createUser('search');
    stranger = await createUser('stranger');
    const accounts = await ok<Account[]>(me, 'GET', '/accounts');
    const wallet = accounts.find((a) => a.type === 'cash')!;
    cafe = {
      id: (await ok<{ id: string }>(me, 'POST', '/categories', { name: 'Кофейни', type: 'expense' })).id,
      name: 'Кофейни',
    };
    transport = (await ok<Category[]>(me, 'GET', '/categories?type=expense')).find(
      (c) => c.name === 'Транспорт',
    )!;
    const source = await ok<{ id: string }>(me, 'POST', '/income-sources', { name: 'Зарплата Альфа' });

    const expense = (categoryId: string, comment: string | null) =>
      ok<Tx>(me, 'POST', '/transactions', {
        type: 'expense',
        categoryId,
        fromAccountId: wallet.id,
        amount: '100',
        comment,
      });
    milk = await expense(cafe.id, 'Молоко и хлеб');
    discount = await expense(cafe.id, 'Скидка 50% по карте');
    taxi = await expense(transport.id, 'такси домой');
    salary = await ok<Tx>(me, 'POST', '/transactions', {
      type: 'income',
      incomeSourceId: source.id,
      toAccountId: wallet.id,
      amount: '5000',
    });

    // Чужая операция с тем же словом: ни в какой выдаче «меня» её быть не должно.
    const otherAccounts = await ok<Account[]>(stranger, 'GET', '/accounts');
    const otherCats = await ok<Category[]>(stranger, 'GET', '/categories?type=expense');
    await ok(stranger, 'POST', '/transactions', {
      type: 'expense',
      categoryId: otherCats[0].id,
      fromAccountId: otherAccounts.find((a) => a.type === 'cash')!.id,
      amount: '100',
      comment: 'Молоко соседа',
    });
  });

  it('q ищет по комментарию без учёта регистра', async () => {
    expect(ids(await find(me, `q=${encodeURIComponent('МОЛОКО')}`))).toEqual([milk.id]);
    expect(ids(await find(me, `q=${encodeURIComponent('такси')}`))).toEqual([taxi.id]);
  });

  it('q ищет и по названию категории, и по названию источника дохода', async () => {
    expect(ids(await find(me, `q=${encodeURIComponent('кофей')}`))).toEqual(ids([milk, discount]));
    expect(ids(await find(me, `q=${encodeURIComponent('альфа')}`))).toEqual([salary.id]);
  });

  it('% и _ в q — обычные символы, а не подстановочные знаки', async () => {
    // Без экранирования «%» совпал бы с каждой операцией, а «_» — с любой непустой строкой.
    expect(ids(await find(me, `q=${encodeURIComponent('%')}`))).toEqual([discount.id]);
    expect(ids(await find(me, `q=${encodeURIComponent('50%')}`))).toEqual([discount.id]);
    expect(await find(me, `q=${encodeURIComponent('_')}`)).toEqual([]);
    expect(await find(me, `q=${encodeURIComponent('\\')}`)).toEqual([]);
  });

  it('запятые, скобки и кавычки в q не ломают запрос', async () => {
    for (const q of ['a,b', 'x)', '(y', '"z"', 'c.eq.1', 'comment.ilike.%,id.neq.0']) {
      const res = await api<Tx[]>(me, 'GET', `/transactions?q=${encodeURIComponent(q)}`);
      expect(res.status, q).toBe(200);
      expect(res.body, q).toEqual([]);
    }
  });

  it('чужие операции не находятся', async () => {
    const mine = await find(me, `q=${encodeURIComponent('молоко')}`);
    expect(mine.map((t) => t.comment)).toEqual(['Молоко и хлеб']);
    const theirs = await find(stranger, `q=${encodeURIComponent('молоко')}`);
    expect(theirs.map((t) => t.comment)).toEqual(['Молоко соседа']);
  });

  it('q не длиннее 100 символов: 100 принимается, 101 — 400', async () => {
    expect((await api(me, 'GET', `/transactions?q=${'я'.repeat(100)}`)).status).toBe(200);
    const res = await api(me, 'GET', `/transactions?q=${'я'.repeat(101)}`);
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('Поиск не длиннее 100 символов');
  });

  it('пустой q (одни пробелы) — как будто параметра нет', async () => {
    const all = await find(me, '');
    expect(ids(await find(me, 'q=%20%20'))).toEqual(ids(all));
  });

  it('categoryId оставляет операции только этой категории', async () => {
    expect(ids(await find(me, `categoryId=${cafe.id}`))).toEqual(ids([milk, discount]));
    expect(ids(await find(me, `categoryId=${transport.id}`))).toEqual([taxi.id]);
  });

  it('categoryId вместе с q и type сужает выдачу, а не расширяет', async () => {
    const q = encodeURIComponent('молоко');
    expect(ids(await find(me, `categoryId=${cafe.id}&q=${q}&type=expense`))).toEqual([milk.id]);
    expect(await find(me, `categoryId=${transport.id}&q=${q}`)).toEqual([]);
    expect(await find(me, `categoryId=${cafe.id}&type=income`)).toEqual([]);

    // Период тоже сужает поисковую выдачу: фильтры навешиваются поверх результата поиска.
    const future = encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString());
    expect(await find(me, `q=${q}&from=${future}`)).toEqual([]);
    expect(ids(await find(me, `q=${q}&to=${future}`))).toEqual([milk.id]);
  });

  it('чужая или несуществующая категория даёт пустой список, а не чужие данные', async () => {
    const theirCats = await ok<Category[]>(stranger, 'GET', '/categories?type=expense');
    expect(await find(me, `categoryId=${theirCats[0].id}`)).toEqual([]);
    expect(await find(me, `categoryId=${crypto.randomUUID()}`)).toEqual([]);
  });

  it('невалидный categoryId — 400', async () => {
    for (const bad of ['abc', '123', `${cafe.id}x`, `${cafe.id},id.neq.0`, '']) {
      const res = await api(me, 'GET', `/transactions?categoryId=${encodeURIComponent(bad)}`);
      expect(res.status, bad).toBe(400);
      expect((res.body as { error: string }).error).toBe('Invalid categoryId');
    }
  });

  it('offset листает страницы без повторов и пропусков, в том числе с поиском', async () => {
    const all = await find(me, '');
    expect(all).toHaveLength(4);

    const first = await find(me, 'limit=3');
    const second = await find(me, 'limit=3&offset=3');
    expect(second).toHaveLength(1);
    expect([...first, ...second].map((t) => t.id)).toEqual(all.map((t) => t.id));
    expect(await find(me, 'limit=3&offset=4')).toEqual([]);

    const q = encodeURIComponent('кофе');
    const p1 = await find(me, `q=${q}&limit=1`);
    const p2 = await find(me, `q=${q}&limit=1&offset=1`);
    expect(ids([...p1, ...p2])).toEqual(ids([milk, discount]));
    expect(await find(me, `q=${q}&limit=1&offset=2`)).toEqual([]);
  });

  it('offset: мусор и отрицательное значение не ломают запрос', async () => {
    const all = await find(me, '');
    expect((await find(me, 'offset=-5')).map((t) => t.id)).toEqual(all.map((t) => t.id));
    expect((await find(me, 'offset=abc')).map((t) => t.id)).toEqual(all.map((t) => t.id));
  });
});

// Контракт демо-сервера: он должен отвечать так же, как сервер прода, — иначе экраны прода
// показали бы на демо-данных не то, что показывают на настоящих.

import { beforeEach, describe, expect, it } from 'vitest';
import type { BudgetDTO, CapitalDTO, MonthSummaryDTO } from '../lib/api';
import { memoryStorage, TODAY } from '../test/harness';
import { handleApiRequest } from './server';
import { DemoStore } from './store';

let store: DemoStore;

async function call<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await handleApiRequest(
    store,
    method,
    new URL(path, 'http://localhost'),
    body === undefined ? undefined : JSON.stringify(body),
  );
  return { status: res.status, data: (await res.json()) as T };
}

const balanceOf = async (name: string) => {
  const { data } = await call<CapitalDTO>('GET', '/api/capital');
  return data.accounts.find((a) => a.name === name)?.balance;
};

beforeEach(() => {
  store = DemoStore.open(memoryStorage(), () => TODAY);
});

describe('бюджет: статусы и порядок как у budgetService прода', () => {
  it('пороги 90/110%: перерасход, предупреждение, норма и «без плана»', async () => {
    const { data } = await call<BudgetDTO>('GET', '/api/budget');
    const row = (name: string) => data.categories.find((c) => c.name === name);
    expect(row('Транспорт')).toMatchObject({ planned: '4000', actual: '4850', percent: 121, status: 'over' });
    expect(row('Еда вне дома')).toMatchObject({ percent: 94, status: 'warning' });
    expect(row('Продукты')).toMatchObject({ status: 'ok' });
    expect(row('Покупки')).toMatchObject({ planned: '0', percent: null, status: 'no_plan' });
  });

  it('сортировка: over → warning → ok → no_plan, внутри статуса — по факту по убыванию', async () => {
    const { data } = await call<BudgetDTO>('GET', '/api/budget');
    const order = { over: 0, warning: 1, ok: 2, no_plan: 3 };
    const statuses = data.categories.map((c) => order[c.status]);
    expect(statuses).toEqual([...statuses].sort((a, b) => a - b));
    expect(data.categories[0]?.name).toBe('Транспорт');
  });

  it('лимит категории сохраняется и пересчитывает статус', async () => {
    const { data: before } = await call<BudgetDTO>('GET', '/api/budget');
    const transport = before.categories.find((c) => c.name === 'Транспорт');
    expect(
      (await call('PUT', '/api/budget/category', { categoryId: transport?.categoryId, amount: '10 000' }))
        .status,
    ).toBe(200);
    const { data: after } = await call<BudgetDTO>('GET', '/api/budget');
    expect(after.categories.find((c) => c.name === 'Транспорт')).toMatchObject({
      planned: '10000',
      percent: 49,
      status: 'ok',
    });
  });
});

describe('операции: проводки по балансам и ошибки как у сервера прода', () => {
  it('расход со счёта уменьшает баланс; сумма принимается строкой с запятой', async () => {
    const before = Number(await balanceOf('Тинькофф'));
    const { data: cats } = await call<Array<{ id: string; name: string }>>(
      'GET',
      '/api/categories?type=expense',
    );
    const food = cats.find((c) => c.name === 'Продукты');
    const tinkoff = (await call<CapitalDTO>('GET', '/api/capital')).data.accounts.find(
      (a) => a.name === 'Тинькофф',
    );

    const res = await call('POST', '/api/transactions', {
      type: 'expense',
      amount: '1250,5',
      categoryId: food?.id,
      fromAccountId: tinkoff?.id,
    });
    expect(res.status).toBe(200);
    expect(Number(await balanceOf('Тинькофф'))).toBeCloseTo(before - 1250.5, 2);
  });

  it('расход без счёта — как в проде: операция есть, балансы не меняются', async () => {
    const capitalBefore = (await call<CapitalDTO>('GET', '/api/capital')).data.totalCash;
    const { data: cats } = await call<Array<{ id: string }>>('GET', '/api/categories?type=expense');
    await call('POST', '/api/transactions', { type: 'expense', amount: 500, categoryId: cats[0]?.id });
    expect((await call<CapitalDTO>('GET', '/api/capital')).data.totalCash).toBe(capitalBefore);
    const { data: summary } = await call<MonthSummaryDTO>('GET', '/api/month-summary');
    expect(summary.totalExpenses).toBeDefined();
  });

  it.each([
    [{ type: 'expense', amount: 0, categoryId: 'cat-0' }, 400, 'Invalid amount'],
    [{ type: 'expense', amount: -5, categoryId: 'cat-0' }, 400, 'Invalid amount'],
    [{ type: 'expense', amount: 100 }, 400, 'categoryId required'],
    [{ type: 'expense', amount: 100, categoryId: 'nope' }, 404, 'Category not found'],
    [
      { type: 'expense', amount: 100, categoryId: 'cat-0', fromAccountId: 'acc-invest' },
      400,
      'Account must be cash or bank',
    ],
    [{ type: 'income', amount: 100 }, 400, 'incomeSourceId required'],
    [
      { type: 'transfer_between_accounts', amount: 100, fromAccountId: 'acc-sber', toAccountId: 'acc-sber' },
      400,
      'Source and destination must differ',
    ],
  ])('ошибка валидации %j → %i «%s»', async (body, status, error) => {
    expect(await call('POST', '/api/transactions', body)).toEqual({ status, data: { error } });
  });

  it('повтор с тем же clientTxId не создаёт дубль (офлайн-очередь прода шлёт повторы)', async () => {
    const body = {
      type: 'income',
      amount: 1000,
      incomeSourceId: 'src-0',
      toAccountId: 'acc-sber',
      clientTxId: 'abc-1',
    };
    const first = await call<{ id: string }>('POST', '/api/transactions', body);
    const second = await call<{ id: string }>('POST', '/api/transactions', body);
    expect(second.data.id).toBe(first.data.id);
  });

  it('удаление расхода возвращает деньги на счёт', async () => {
    const before = await balanceOf('Наличные');
    const { data } = await call<{ id: string }>('POST', '/api/transactions', {
      type: 'expense',
      amount: 700,
      categoryId: 'cat-0',
      fromAccountId: 'acc-cash',
    });
    expect(await balanceOf('Наличные')).not.toBe(before);
    await call('DELETE', `/api/transactions/${data.id}`);
    expect(await balanceOf('Наличные')).toBe(before);
  });

  it('неизвестный эндпоинт — 404 с понятным текстом, битый JSON — 400', async () => {
    expect(await call('GET', '/api/nope')).toEqual({
      status: 404,
      data: { error: 'В демо-версии нет обработчика GET /api/nope' },
    });
    const res = await handleApiRequest(store, 'POST', new URL('/api/feedback', 'http://localhost'), '{oops');
    expect(res.status).toBe(400);
  });
});

describe('капитал, кредит и аналитика', () => {
  it('Net Worth = деньги + инвестиции + прочее − кредиты (формула capitalService прода)', async () => {
    const { data } = await call<CapitalDTO>('GET', '/api/capital');
    const n = (s: string) => Number(s);
    expect(n(data.totalNetWorth)).toBeCloseTo(
      n(data.totalCash) +
        n(data.totalInvestments) +
        n(data.totalOther) +
        n(data.totalCreditBuffers) -
        n(data.totalCredits),
      2,
    );
    // Демо-данные сбалансированы: ни один счёт не ушёл в минус.
    expect(data.accounts.filter((a) => a.type !== 'credit').every((a) => n(a.balance) >= 0)).toBe(true);
  });

  it('платёж по кредиту: сначала проценты за месяц, остальное — в тело долга', async () => {
    const {
      data: [credit],
    } = await call<Array<{ id: string; currentPrincipal: string; rate: string }>>('GET', '/api/credits');
    const debt = Number(credit?.currentPrincipal);
    const { data } = await call<{ interest: string; principal: string; newPrincipal: string }>(
      'POST',
      `/api/credits/${credit?.id}/pay`,
      {
        fromAccountId: 'acc-sber',
        categoryId: 'cat-7',
        amount: 10_000,
      },
    );
    const interest = Math.round(((debt * Number(credit?.rate)) / 12 / 100) * 100) / 100;
    expect(Number(data.interest)).toBeCloseTo(interest, 2);
    expect(Number(data.principal)).toBeCloseTo(10_000 - interest, 2);
    expect(Number(data.newPrincipal)).toBeCloseTo(debt - (10_000 - interest), 2);
  });

  it('by-category: share в процентах 0..100 (не доля), сумма долей ≈ 100', async () => {
    const { data } = await call<{ items: Array<{ share: number }> }>('GET', '/api/analytics/by-category');
    const total = data.items.reduce((a, i) => a + i.share, 0);
    expect(data.items[0]?.share).toBeGreaterThan(1);
    expect(total).toBeGreaterThan(99);
    expect(total).toBeLessThan(101);
  });

  it('daily: все дни диапазона, пустые — «0», непустые — формат Postgres «1250.50»', async () => {
    const from = new Date(2026, 8, 1).toISOString();
    const to = new Date(2026, 8, 8).toISOString();
    const { data } = await call<{ days: Array<{ day: string; expense: string }> }>(
      'GET',
      `/api/analytics/daily?from=${from}&to=${to}`,
    );
    expect(data.days.map((d) => d.day)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
    ]);
    expect(data.days.find((d) => d.day === '2026-09-02')?.expense).toBe('2180.00');
    expect(data.days.some((d) => d.expense === '0')).toBe(true);
  });
});

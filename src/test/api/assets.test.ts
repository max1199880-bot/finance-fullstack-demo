// Активы и кредиты: покупка, переоценка, продажа, платёж по кредиту.
// Здесь деньги переходят между счетами несколькими шагами, поэтому проверяем
// не только ответ, но и остатки после операции.

import { beforeAll, describe, expect, it } from 'vitest';
import { api, createUser, ok, type Client } from '../api.setup';

interface Account {
  id: string;
  name: string;
  type: string;
  balance: string;
}

let user: Client;
let bank: Account;

const accounts = () => ok<Account[]>(user, 'GET', '/accounts');
const balanceOf = async (id: string) =>
  Number(
    (await ok<{ accounts: Account[] }>(user, 'GET', '/capital')).accounts.find((a) => a.id === id)?.balance ??
      0,
  );

beforeAll(async () => {
  user = await createUser('assets');
  bank = (await accounts()).find((a) => a.type === 'bank')!;
  await ok(user, 'PUT', '/capital/balance', { accountId: bank.id, balance: '500000' });
});

describe('Активы', () => {
  it('покупка списывает деньги и заводит актив на ту же сумму', async () => {
    const before = await balanceOf(bank.id);
    const res = await ok<{ accountId: string; transactionId: string }>(user, 'POST', '/assets/purchase', {
      fromAccountId: bank.id,
      name: 'Велосипед',
      assetType: 'other_asset',
      amount: '80000',
    });

    expect(await balanceOf(bank.id)).toBe(before - 80000);
    expect(await balanceOf(res.accountId)).toBe(80000);
  });

  it('переоценка меняет стоимость актива, не трогая деньги', async () => {
    const asset = (await accounts()).find((a) => a.name === 'Велосипед')!;
    const cashBefore = await balanceOf(bank.id);

    const res = await ok<{ delta: string; direction: string; previousValue: string; newValue: string }>(
      user,
      'POST',
      `/assets/${asset.id}/revalue`,
      { newValue: '65000' },
    );
    expect(res.direction).toBe('loss');
    // Дельта возвращается со знаком: минус — актив подешевел.
    expect(Number(res.delta)).toBe(-15000);
    expect(await balanceOf(asset.id)).toBe(65000);
    expect(await balanceOf(bank.id)).toBe(cashBefore);
  });

  it('стоимость без изменения отклоняется', async () => {
    const asset = (await accounts()).find((a) => a.name === 'Велосипед')!;
    const res = await api(user, 'POST', `/assets/${asset.id}/revalue`, { newValue: '65000' });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('Стоимость не изменилась');
  });

  it('продажа дороже стоимости даёт доход и закрывает актив', async () => {
    const asset = (await accounts()).find((a) => a.name === 'Велосипед')!;
    const cashBefore = await balanceOf(bank.id);

    const res = await ok<{
      cost: string;
      salePrice: string;
      profit: string;
      incomeTransactionId: string | null;
    }>(user, 'POST', `/assets/${asset.id}/sell`, { toAccountId: bank.id, salePrice: '72000' });
    expect(Number(res.cost)).toBe(65000);
    expect(Number(res.profit)).toBe(7000);
    expect(res.incomeTransactionId).not.toBeNull();

    // На счёт пришла себестоимость переводом, прибыль — отдельной операцией дохода.
    expect(await balanceOf(bank.id)).toBe(cashBefore + 72000);
    const open = (await accounts()).find((a) => a.id === asset.id);
    expect(open).toBeUndefined(); // проданный актив уходит из активных
  });

  it('проданный актив нельзя продать второй раз', async () => {
    const hidden = await ok<{ id: string; name: string }[]>(user, 'GET', '/accounts/hidden');
    const sold = hidden.find((a) => a.name === 'Велосипед')!;
    const res = await api(user, 'POST', `/assets/${sold.id}/sell`, {
      toAccountId: bank.id,
      salePrice: '1000',
    });
    expect([400, 409]).toContain(res.status);
  });

  it('вложения в актив показывают покупку и расходы по нему', async () => {
    const created = await ok<{ accountId: string }>(user, 'POST', '/assets/purchase', {
      fromAccountId: bank.id,
      name: 'Мотоцикл',
      assetType: 'other_asset',
      amount: '300000',
    });
    const categories = await ok<{ id: string; name: string }[]>(user, 'GET', '/categories?type=expense');
    await ok(user, 'POST', '/transactions', {
      type: 'expense',
      categoryId: categories[0].id,
      fromAccountId: bank.id,
      amount: '20000',
      linkedAssetId: created.accountId,
      comment: 'Ремонт',
    });

    const info = await ok<{ purchase: string; invested: string; total: string; items: unknown[] }>(
      user,
      'GET',
      `/assets/${created.accountId}/investments`,
    );
    expect(Number(info.purchase)).toBe(300000);
    expect(Number(info.invested)).toBe(20000);
    expect(Number(info.total)).toBe(320000);
    expect(info.items).toHaveLength(1);
  });
});

describe('Кредиты', () => {
  let creditId: string;

  it('кредит создаётся с долгом и графиком платежа', async () => {
    const created = await ok<{ id: string }>(user, 'POST', '/credits', {
      name: 'Автокредит',
      originalAmount: '250000',
      rate: '16,9',
      termMonths: 36,
      startDate: new Date().toISOString(),
      paymentDay: 15,
    });
    creditId = created.id;

    const credits = await ok<
      {
        id: string;
        currentPrincipal: string;
        scheduledPayment: string;
        remainingMonths: number;
        nextDueDate: string | null;
      }[]
    >(user, 'GET', '/credits');
    const credit = credits.find((c) => c.id === creditId)!;

    expect(Number(credit.currentPrincipal)).toBe(250000);
    expect(credit.remainingMonths).toBe(36);
    // Аннуитет для 250 000 ₽ под 16,9% на 36 месяцев — 8 900,74 ₽.
    expect(credit.scheduledPayment).toBe('8900.74');
    expect(credit.nextDueDate).not.toBeNull();
  });

  it('платёж делится на проценты и тело долга', async () => {
    const categories = await ok<{ id: string; name: string }[]>(user, 'GET', '/categories?type=expense');
    const creditCategory = categories.find((c) => c.name === 'Кредит')!;
    const cashBefore = await balanceOf(bank.id);

    const res = await ok<{ interest: string; principal: string; newPrincipal: string; overpayment: string }>(
      user,
      'POST',
      `/credits/${creditId}/pay`,
      { fromAccountId: bank.id, categoryId: creditCategory.id, amount: '8900.74' },
    );

    // Проценты за месяц: 250 000 × 16,9% / 12 = 3 520,83 ₽, остальное гасит долг.
    expect(res.interest).toBe('3520.83');
    expect(Number(res.principal)).toBeCloseTo(8900.74 - 3520.83, 2);
    expect(Number(res.newPrincipal)).toBeCloseTo(250000 - (8900.74 - 3520.83), 2);
    expect(Number(res.overpayment)).toBe(0);
    expect(await balanceOf(bank.id)).toBeCloseTo(cashBefore - 8900.74, 2);
  });

  it('долг уменьшает капитал', async () => {
    const capital = await ok<{
      totalCredits: string;
      totalNetWorth: string;
      totalCash: string;
      totalOther: string;
    }>(user, 'GET', '/capital');
    expect(Number(capital.totalCredits)).toBeGreaterThan(0);
    expect(Number(capital.totalNetWorth)).toBeCloseTo(
      Number(capital.totalCash) + Number(capital.totalOther) - Number(capital.totalCredits),
      2,
    );
  });

  it('платёж с чужого счёта отклоняется понятным текстом', async () => {
    const other = await createUser('other');
    const theirAccounts = await ok<Account[]>(other, 'GET', '/accounts');
    const categories = await ok<{ id: string; name: string }[]>(user, 'GET', '/categories?type=expense');

    const res = await api(user, 'POST', `/credits/${creditId}/pay`, {
      fromAccountId: theirAccounts[0].id,
      categoryId: categories[0].id,
      amount: '1000',
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('Source account not found');
  });
});

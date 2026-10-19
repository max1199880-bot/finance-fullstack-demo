// Две сводки, которые нужны сразу нескольким экранам: итог месяца и итоги капитала.
// Лежат отдельно, чтобы главная, бюджет и «Капитал» считали их одинаково.

import type { Ctx } from './context.ts';
import { fromDb, type Kopecks, rub } from './money.ts';
import { monthRange } from './period.ts';
import { ACCOUNT_FIELDS, type AccountRow, balancesOf, planFact, rowsOf, sumAmounts } from './shared.ts';

export interface MonthTotals {
  income: Kopecks;
  expenses: Kopecks;
  investments: Kopecks;
  plannedExpenses: Kopecks | null;
  plannedIncome: Kopecks | null;
  plannedInvestments: Kopecks | null;
}

/** Суммы месяца и планы на него. Планы: глобальный, иначе сумма планов категорий. */
export async function monthTotals(ctx: Ctx, month: string): Promise<MonthTotals> {
  const { month_start_day } = await ctx.profile();
  const { from, to } = monthRange(month, month_start_day);

  const [tx, global, perCategory] = await Promise.all([
    ctx.db
      .from('transactions')
      .select('amount, type')
      .gte('date', from.toISOString())
      .lt('date', to.toISOString()),
    ctx.db
      .from('budget_plan_global')
      .select('planned_total_expenses, planned_total_income, planned_investments')
      .eq('month', month)
      .maybeSingle(),
    ctx.db.from('budget_plan_month').select('planned_amount').eq('month', month),
  ]);
  if (tx.error) throw new Error(tx.error.message);

  const rows = rowsOf<{ amount: string; type: string }>(tx.data);
  const sumOf = (type: string) => sumAmounts(rows.filter((r) => r.type === type));

  const categorySum = rowsOf<{ planned_amount: string }>(perCategory.data).reduce(
    (acc, r) => acc + fromDb(r.planned_amount),
    0,
  );
  const g = global.data as {
    planned_total_expenses: string | null;
    planned_total_income: string | null;
    planned_investments: string | null;
  } | null;

  const plannedExpenses =
    g?.planned_total_expenses != null
      ? fromDb(g.planned_total_expenses)
      : categorySum > 0
        ? categorySum
        : null;

  return {
    income: sumOf('income'),
    expenses: sumOf('expense'),
    investments: sumOf('transfer_to_investment'),
    plannedExpenses,
    plannedIncome: g?.planned_total_income != null ? fromDb(g.planned_total_income) : null,
    plannedInvestments: g?.planned_investments != null ? fromDb(g.planned_investments) : null,
  };
}

/** Сводка месяца в том виде, в каком её ждут главная и экран бюджета. */
export async function monthSummaryDTO(ctx: Ctx, month: string) {
  const t = await monthTotals(ctx, month);
  return {
    month,
    totalIncome: rub(t.income),
    totalExpenses: rub(t.expenses),
    totalInvestments: rub(t.investments),
    remainder: rub(t.income - t.expenses - t.investments),
    incomePF: planFact(t.plannedIncome, t.income),
    expensePF: planFact(t.plannedExpenses, t.expenses),
    investmentsPF: planFact(t.plannedInvestments, t.investments),
  };
}

/**
 * Итоги капитала по активным счетам.
 * Net Worth = деньги + инвестиции + прочее имущество + подушки под кредиты − долги.
 * Подушка считается своими деньгами: она просто отложена на будущие платежи.
 */
export async function capitalTotals(
  ctx: Ctx,
): Promise<{ accounts: AccountRow[]; balances: Map<string, Kopecks>; totals: Record<string, string> }> {
  const { data, error } = await ctx.db.from('accounts').select(ACCOUNT_FIELDS).eq('is_active', true);
  if (error) throw new Error(error.message);
  const accounts = rowsOf<AccountRow>(data);
  const balances = await balancesOf(
    ctx,
    accounts.map((a) => a.id),
  );

  let cash = 0,
    investments = 0,
    other = 0,
    credits = 0,
    buffers = 0;
  for (const a of accounts) {
    const b = balances.get(a.id) ?? 0;
    if (a.type === 'cash' || a.type === 'bank') cash += b;
    else if (a.type === 'investment') investments += b;
    else if (a.type === 'credit') credits += b;
    else if (a.type === 'credit_buffer') buffers += b;
    else other += b;
  }

  return {
    accounts,
    balances,
    totals: {
      totalCash: rub(cash),
      totalInvestments: rub(investments),
      totalOther: rub(other),
      totalCredits: rub(credits),
      totalCreditBuffers: rub(buffers),
      totalNetWorth: rub(cash + investments + other + buffers - credits),
    },
  };
}

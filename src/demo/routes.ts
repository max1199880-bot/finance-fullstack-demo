// Маршруты демо-сервера: те же пути, тела и формы ответов, что у сервера прода
// (src/api/*Routes.ts в finance-bot). Типы ответов — DTO фронтенда прода (../lib/api),
// поэтому расхождение с тем, что ждут экраны, ловит компилятор.
//
// Тексты ошибок — как у сервера прода: экраны показывают их пользователю как есть.

import type {
  AccountDTO,
  BootstrapDTO,
  BudgetDTO,
  CapitalDTO,
  CategoryDTO,
  CreditSummaryDTO,
  IncomeSourceDTO,
  MeDTO,
  MonthSummaryDTO,
  TransactionDTO,
} from '../lib/api';
import {
  adjust,
  annuity,
  applyTx,
  balanceOf,
  currentMonthKey,
  findAccount,
  inRange,
  monthRange,
  nextDueDate,
  remainingMonths,
  revertTx,
  setBalance,
  splitPayment,
} from './ledger';
import { parseMoney, rub, type Kopecks } from './money';
import { planFact } from './planFact';
import { HttpError } from './errors';
import type { DemoStore } from './store';
import type { Account, AccountType, DemoDb, Transaction, TxType } from './types';

type Body = Record<string, unknown>;
interface Ctx {
  store: DemoStore;
  db: DemoDb;
  q: URLSearchParams;
  body: Body;
  params: string[];
  now: Date;
}
type Handler = (ctx: Ctx) => unknown;

const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};

// ── разбор тела ─────────────────────────────────────────────────────────────

const str = (b: Body, key: string): string | undefined =>
  typeof b[key] === 'string' ? (b[key] as string) : undefined;
const trimmed = (b: Body, key: string): string => (str(b, key) ?? '').trim();
/** Положительная сумма, как parseAmount сервера прода: ноль и отрицательные — ошибка. */
const amountOf = (b: Body, key = 'amount'): Kopecks | null => {
  const v = parseMoney(b[key]);
  return v !== null && v > 0 ? v : null;
};
const commentOf = (b: Body): string | null => {
  const c = str(b, 'comment')?.trim();
  return c ? c : null;
};

// ── общие выборки ───────────────────────────────────────────────────────────

const ACCOUNT_ORDER: AccountType[] = ['cash', 'bank', 'investment', 'other_asset', 'credit', 'credit_buffer'];
const sortAccounts = (list: Account[]) =>
  [...list].sort(
    (a, b) =>
      ACCOUNT_ORDER.indexOf(a.type) - ACCOUNT_ORDER.indexOf(b.type) || a.name.localeCompare(b.name, 'ru'),
  );

const isCashOrBank = (a: Account | undefined) => a?.type === 'cash' || a?.type === 'bank';

function accountDTO(db: DemoDb, a: Account): AccountDTO {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    balance: rub(balanceOf(db, a.id)),
    quantity: null,
    ...(a.type === 'investment' || a.type === 'other_asset' ? { liability: a.liability ?? false } : {}),
  };
}

function txDTO(db: DemoDb, t: Transaction): TransactionDTO {
  return {
    id: t.id,
    date: t.date,
    amount: rub(t.amount),
    type: t.type,
    categoryId: t.categoryId,
    categoryName: db.categories.find((c) => c.id === t.categoryId)?.name ?? null,
    incomeSourceName: db.incomeSources.find((s) => s.id === t.incomeSourceId)?.name ?? null,
    fromAccountId: t.fromAccountId,
    toAccountId: t.toAccountId,
    fromAccountName: findAccount(db, t.fromAccountId)?.name ?? null,
    toAccountName: findAccount(db, t.toAccountId)?.name ?? null,
    comment: t.comment,
  };
}

const byDateDesc = (a: Transaction, b: Transaction) => b.date.localeCompare(a.date);
const sum = (list: Transaction[]) => list.reduce((acc, t) => acc + t.amount, 0);

function monthParam(ctx: Ctx): string {
  const m = ctx.q.get('month') ?? str(ctx.body, 'month');
  return m && /^\d{4}-\d{2}$/.test(m) ? m : currentMonthKey(ctx.now, ctx.db.user.monthStartDay);
}

function txInMonth(db: DemoDb, month: string, type?: TxType): Transaction[] {
  const { from, to } = monthRange(month, db.user.monthStartDay);
  return db.transactions.filter((t) => inRange(t.date, from, to) && (!type || t.type === type));
}

function meDTO(db: DemoDb, now: Date): MeDTO {
  const u = db.user;
  return {
    id: u.id,
    currency: u.currency,
    monthStartDay: u.monthStartDay,
    timezone: u.timezone,
    remindersEnabled: u.remindersEnabled,
    onboardingCompleted: u.onboardingCompleted,
    isOwner: false,
    currentMonth: currentMonthKey(now, u.monthStartDay),
  };
}

function monthSummary(db: DemoDb, month: string): MonthSummaryDTO {
  const list = txInMonth(db, month);
  const income = sum(list.filter((t) => t.type === 'income'));
  const expenses = sum(list.filter((t) => t.type === 'expense'));
  const investments = sum(list.filter((t) => t.type === 'transfer_to_investment'));
  const global = db.globalPlans.find((g) => g.month === month);
  const catPlans = db.categoryPlans.filter((p) => p.month === month).reduce((acc, p) => acc + p.amount, 0);
  const expensePlan = global?.plannedTotalExpenses ?? (catPlans === 0 ? null : catPlans);
  return {
    month,
    totalIncome: rub(income),
    totalExpenses: rub(expenses),
    totalInvestments: rub(investments),
    remainder: rub(income - expenses - investments),
    incomePF: planFact(global?.plannedTotalIncome ?? null, income),
    expensePF: planFact(expensePlan, expenses),
    investmentsPF: planFact(global?.plannedInvestments ?? null, investments),
  };
}

function capital(db: DemoDb): CapitalDTO {
  const active = sortAccounts(db.accounts.filter((a) => a.isActive));
  let cash = 0;
  let inv = 0;
  let other = 0;
  let credits = 0;
  let buffers = 0;
  for (const a of active) {
    const b = balanceOf(db, a.id);
    if (a.type === 'cash' || a.type === 'bank') cash += b;
    else if (a.type === 'investment') inv += b;
    else if (a.type === 'credit') credits += b;
    else if (a.type === 'credit_buffer') buffers += b;
    else other += b;
  }
  return {
    accounts: active.map((a) => accountDTO(db, a)),
    totalCash: rub(cash),
    totalInvestments: rub(inv),
    totalOther: rub(other),
    totalCredits: rub(credits),
    totalCreditBuffers: rub(buffers),
    totalNetWorth: rub(cash + inv + other + buffers - credits),
  };
}

function creditDTO(db: DemoDb, id: string, now: Date): CreditSummaryDTO {
  const c = db.credits.find((x) => x.id === id);
  const acc = findAccount(db, id);
  if (!c || !acc) return fail(404, 'Credit not found');
  const principal = balanceOf(db, id);
  const months = remainingMonths(c, now);
  return {
    id,
    name: acc.name,
    currentPrincipal: rub(principal),
    originalAmount: rub(c.originalAmount),
    rate: String(c.rate),
    termMonths: c.termMonths,
    remainingMonths: months,
    scheduledPayment: rub(annuity(principal, c.rate, months)),
    nextDueDate: nextDueDate(c, now),
    startDate: c.startDate,
    paymentDay: c.paymentDay,
  };
}

/**
 * Создать операцию и провести её по балансам. clientTxId (ключ идемпотентности) относится к
 * основной операции запроса; вторичные проводки (например, доход с прибыли при продаже)
 * передают primary=false — иначе они «нашли» бы основную по тому же ключу и не создались.
 */
function book(ctx: Ctx, t: Omit<Transaction, 'id'>, primary = true): Transaction {
  const clientTxId = primary ? str(ctx.body, 'clientTxId') : undefined;
  if (clientTxId) {
    const existing = ctx.db.transactions.find((x) => x.clientTxId === clientTxId);
    if (existing) return existing;
  }
  const tx: Transaction = { ...t, id: ctx.store.nextId('tx'), ...(clientTxId ? { clientTxId } : {}) };
  ctx.db.transactions.push(tx);
  applyTx(ctx.db, tx);
  return tx;
}

function periodOf(ctx: Ctx): { from: Date; to: Date } {
  const to = ctx.q.get('to') ? new Date(ctx.q.get('to') as string) : ctx.now;
  const from = ctx.q.get('from')
    ? new Date(ctx.q.get('from') as string)
    : new Date(ctx.now.getTime() - 30 * 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) fail(400, 'Invalid date');
  return { from, to };
}

function totalsIn(db: DemoDb, from: Date, to: Date) {
  const list = db.transactions.filter((t) => inRange(t.date, from, to));
  const by = (type: TxType) => sum(list.filter((t) => t.type === type));
  const reval = list
    .filter((t) => t.type === 'asset_revaluation')
    .reduce((acc, t) => acc + (t.toAccountId ? t.amount : -t.amount), 0);
  return {
    income: rub(by('income')),
    expense: rub(by('expense')),
    investment: rub(by('transfer_to_investment')),
    // В проде это поле считается через toFixed(2) — сохраняем формат.
    revaluation: (reval / 100).toFixed(2),
    txCount: list.length,
  };
}

const LIMIT_EXPENSE_MAX = 12;
const LIMIT_EXPENSE_MIN = 6;
const activeExpenseCount = (db: DemoDb) =>
  db.categories.filter((c) => c.type === 'expense' && c.isActive).length;

// ── таблица маршрутов ───────────────────────────────────────────────────────

const ROUTES: Array<[method: string, pattern: RegExp, handler: Handler]> = [
  // Пользователь и авторизация
  [
    'GET',
    /^\/api\/auth\/me$/,
    ({ db }) => ({ id: db.user.id, firstName: db.user.firstName, telegramUserId: db.user.telegramUserId }),
  ],
  ['GET', /^\/api\/auth\/widget-config$/, () => ({ botUsername: '' })],
  ['POST', /^\/api\/auth\/logout$/, () => ({ ok: true })],
  ['POST', /^\/api\/auth\/telegram-login$/, () => fail(401, 'В демо-версии вход не нужен')],
  ['GET', /^\/api\/me$/, ({ db, now }) => meDTO(db, now)],
  [
    'PUT',
    /^\/api\/me$/,
    ({ db, body }) => {
      const day = body.monthStartDay;
      if (typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 28)
        db.user.monthStartDay = day;
      if (typeof body.remindersEnabled === 'boolean') db.user.remindersEnabled = body.remindersEnabled;
      if (typeof body.onboardingCompleted === 'boolean')
        db.user.onboardingCompleted = body.onboardingCompleted;
      const u = db.user;
      return {
        ok: true,
        monthStartDay: u.monthStartDay,
        remindersEnabled: u.remindersEnabled,
        onboardingCompleted: u.onboardingCompleted,
      };
    },
  ],
  [
    'GET',
    /^\/api\/bootstrap$/,
    ({ db, q, now }): BootstrapDTO => {
      const limit = Math.min(Number.parseInt(q.get('txLimit') ?? '5', 10) || 5, 50);
      const month = currentMonthKey(now, db.user.monthStartDay);
      const { accounts: _accounts, ...capitalTotals } = capital(db);
      return {
        me: meDTO(db, now),
        summary: monthSummary(db, month),
        capitalTotals,
        recentTransactions: [...db.transactions]
          .sort(byDateDesc)
          .slice(0, limit)
          .map((t) => txDTO(db, t)),
      };
    },
  ],
  ['GET', /^\/api\/month-summary$/, (ctx) => monthSummary(ctx.db, monthParam(ctx))],

  // Категории
  [
    'GET',
    /^\/api\/categories$/,
    ({ db, q }): CategoryDTO[] => {
      const type = q.get('type') === 'income' ? 'income' : 'expense';
      // Категорий доходов в демо нет (как и у нового пользователя прода: доходы идут через источники).
      return db.categories
        .filter((c) => c.type === type && c.isActive)
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'))
        .map(({ id, name, type: t, isActive, emoji }) => ({ id, name, type: t, isActive, emoji }));
    },
  ],
  [
    'GET',
    /^\/api\/categories\/all$/,
    ({ db }) =>
      [...db.categories]
        .sort(
          (a, b) =>
            (a.type === b.type ? 0 : a.type === 'expense' ? -1 : 1) ||
            a.order - b.order ||
            a.name.localeCompare(b.name, 'ru'),
        )
        .map(({ id, name, type, isActive, order, emoji }) => ({ id, name, type, isActive, order, emoji })),
  ],
  [
    'GET',
    /^\/api\/categories\/hidden$/,
    ({ db }) =>
      db.categories
        .filter((c) => !c.isActive)
        .map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          emoji: c.emoji,
          txCount: db.transactions.filter((t) => t.categoryId === c.id).length,
        })),
  ],
  [
    'POST',
    /^\/api\/categories$/,
    ({ db, body, store }) => {
      const name = trimmed(body, 'name');
      const type = body.type === 'income' ? 'income' : 'expense';
      if (!name) fail(400, 'name required');
      const dup = db.categories.find((c) => c.type === type && c.name.toLowerCase() === name.toLowerCase());
      if (dup)
        fail(
          409,
          dup.isActive
            ? 'Категория с таким именем уже существует'
            : 'Категория с таким именем была скрыта. Восстановить или удалить навсегда?',
        );
      if (type === 'expense' && activeExpenseCount(db) >= LIMIT_EXPENSE_MAX)
        fail(400, `Максимум ${LIMIT_EXPENSE_MAX} активных категорий расходов`);
      const order = Math.max(-1, ...db.categories.filter((c) => c.type === type).map((c) => c.order)) + 1;
      const id = store.nextId('cat');
      db.categories.push({ id, name, type, isActive: true, order, emoji: str(body, 'emoji') ?? null });
      return { ok: true, id, action: 'created' };
    },
  ],
  [
    'PUT',
    /^\/api\/categories\/reorder$/,
    ({ db, body }) => {
      const list = body.ids;
      if (!Array.isArray(list)) fail(400, 'ids array required');
      const ids = list as unknown[];
      const cats = ids.map((id) => db.categories.find((c) => c.id === id));
      if (cats.some((c) => !c)) fail(404, 'one or more categories not found');
      cats.forEach((c, i) => {
        if (c) c.order = i;
      });
      return { ok: true, reordered: ids.length };
    },
  ],
  [
    'PATCH',
    /^\/api\/categories\/([^/]+)$/,
    ({ db, body, params }) => {
      const c = db.categories.find((x) => x.id === params[0]) ?? fail(404, 'Category not found');
      if (typeof body.name === 'string' && body.name.trim()) c.name = body.name.trim();
      if (body.emoji === null || typeof body.emoji === 'string')
        c.emoji = (body.emoji as string | null) || null;
      if (typeof body.isActive === 'boolean') {
        if (
          !body.isActive &&
          c.isActive &&
          c.type === 'expense' &&
          activeExpenseCount(db) <= LIMIT_EXPENSE_MIN
        ) {
          fail(400, `Должно остаться минимум ${LIMIT_EXPENSE_MIN} активных категорий расходов`);
        }
        c.isActive = body.isActive;
      }
      return { ok: true };
    },
  ],
  [
    'DELETE',
    /^\/api\/categories\/([^/]+)\/purge$/,
    ({ db, params }) => {
      const c = db.categories.find((x) => x.id === params[0]) ?? fail(404, 'Category not found');
      if (c.isActive && c.type === 'expense' && activeExpenseCount(db) <= LIMIT_EXPENSE_MIN)
        fail(400, `Должно остаться минимум ${LIMIT_EXPENSE_MIN} активных категорий расходов`);
      const before = db.transactions.length;
      db.transactions = db.transactions.filter((t) => t.categoryId !== c.id);
      db.categories = db.categories.filter((x) => x.id !== c.id);
      return { ok: true, deletedTransactions: before - db.transactions.length };
    },
  ],
  [
    'DELETE',
    /^\/api\/categories\/([^/]+)$/,
    ({ db, params }) => {
      const c = db.categories.find((x) => x.id === params[0]) ?? fail(404, 'Category not found');
      if (c.isActive && c.type === 'expense' && activeExpenseCount(db) <= LIMIT_EXPENSE_MIN)
        fail(400, `Должно остаться минимум ${LIMIT_EXPENSE_MIN} активных категорий расходов`);
      if (db.transactions.some((t) => t.categoryId === c.id)) {
        c.isActive = false;
        return { ok: true, action: 'hidden', reason: 'has_transactions' };
      }
      db.categories = db.categories.filter((x) => x.id !== c.id);
      return { ok: true, action: 'deleted' };
    },
  ],

  // Источники дохода
  [
    'GET',
    /^\/api\/income-sources$/,
    ({ db }): IncomeSourceDTO[] =>
      db.incomeSources
        .filter((s) => s.isActive)
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
        .map(({ id, name, emoji }) => ({ id, name, emoji })),
  ],
  [
    'GET',
    /^\/api\/income-sources\/hidden$/,
    ({ db }) =>
      db.incomeSources
        .filter((s) => !s.isActive)
        .map((s) => ({
          id: s.id,
          name: s.name,
          emoji: s.emoji,
          txCount: db.transactions.filter((t) => t.incomeSourceId === s.id).length,
        })),
  ],
  [
    'POST',
    /^\/api\/income-sources$/,
    ({ db, body, store }) => {
      const name = trimmed(body, 'name');
      if (!name) fail(400, 'name required');
      const dup = db.incomeSources.find((s) => s.name.toLowerCase() === name.toLowerCase());
      if (dup)
        fail(
          409,
          dup.isActive
            ? 'Источник с таким именем уже существует'
            : 'Источник с таким именем был скрыт. Восстановить или удалить навсегда?',
        );
      const id = store.nextId('src');
      db.incomeSources.push({ id, name, emoji: str(body, 'emoji') ?? null, isActive: true });
      return { ok: true, id };
    },
  ],
  [
    'PATCH',
    /^\/api\/income-sources\/([^/]+)$/,
    ({ db, body, params }) => {
      const s = db.incomeSources.find((x) => x.id === params[0]) ?? fail(404, 'Source not found');
      if (typeof body.name === 'string' && body.name.trim()) s.name = body.name.trim();
      if (body.emoji === null || typeof body.emoji === 'string')
        s.emoji = (body.emoji as string | null) || null;
      if (typeof body.isActive === 'boolean') s.isActive = body.isActive;
      return { ok: true };
    },
  ],
  [
    'DELETE',
    /^\/api\/income-sources\/([^/]+)\/purge$/,
    ({ db, params }) => {
      const s = db.incomeSources.find((x) => x.id === params[0]) ?? fail(404, 'Source not found');
      const before = db.transactions.length;
      db.transactions = db.transactions.filter((t) => t.incomeSourceId !== s.id);
      db.incomeSources = db.incomeSources.filter((x) => x.id !== s.id);
      return { ok: true, deletedTransactions: before - db.transactions.length };
    },
  ],
  [
    'DELETE',
    /^\/api\/income-sources\/([^/]+)$/,
    ({ db, params }) => {
      const s = db.incomeSources.find((x) => x.id === params[0]) ?? fail(404, 'Source not found');
      if (db.transactions.some((t) => t.incomeSourceId === s.id)) {
        s.isActive = false;
        return { ok: true, action: 'hidden', reason: 'has_transactions' };
      }
      db.incomeSources = db.incomeSources.filter((x) => x.id !== s.id);
      return { ok: true, action: 'deleted' };
    },
  ],

  // Операции
  [
    'GET',
    /^\/api\/transactions$/,
    ({ db, q }): TransactionDTO[] => {
      const limit = Math.min(Number.parseInt(q.get('limit') ?? '20', 10) || 20, 500);
      const type = q.get('type');
      const accountId = q.get('accountId');
      const accountType = q.get('accountType');
      const from = q.get('from') ? new Date(q.get('from') as string) : null;
      const to = q.get('to') ? new Date(q.get('to') as string) : null;
      const typeOf = (id: string | null) => findAccount(db, id)?.type;
      return [...db.transactions]
        .filter((t) => !from || new Date(t.date) >= from)
        .filter((t) => !to || new Date(t.date) < to)
        .filter((t) => !type || t.type === type)
        .filter((t) =>
          accountId
            ? t.fromAccountId === accountId || t.toAccountId === accountId
            : !accountType ||
              typeOf(t.fromAccountId) === accountType ||
              typeOf(t.toAccountId) === accountType,
        )
        .sort(byDateDesc)
        .slice(0, limit)
        .map((t) => txDTO(db, t));
    },
  ],
  [
    'POST',
    /^\/api\/transactions$/,
    (ctx) => {
      const { db, body, now } = ctx;
      const amount = amountOf(body) ?? fail(400, 'Invalid amount');
      const type = str(body, 'type') as TxType | undefined;
      const date = now.toISOString();
      const comment = commentOf(body);
      const base = {
        date,
        amount,
        comment,
        categoryId: null,
        incomeSourceId: null,
        fromAccountId: null,
        toAccountId: null,
      };

      if (type === 'expense') {
        const categoryId = str(body, 'categoryId') ?? fail(400, 'categoryId required');
        const cat = db.categories.find((c) => c.id === categoryId);
        if (!cat || cat.type !== 'expense') fail(404, 'Category not found');
        const fromAccountId = str(body, 'fromAccountId') ?? null;
        if (fromAccountId) {
          const acc = findAccount(db, fromAccountId) ?? fail(404, 'Account not found');
          if (!isCashOrBank(acc)) fail(400, 'Account must be cash or bank');
        }
        const linkedAssetId = str(body, 'linkedAssetId');
        if (linkedAssetId) {
          const asset = findAccount(db, linkedAssetId) ?? fail(404, 'Asset not found');
          if (asset.type !== 'investment' && asset.type !== 'other_asset')
            fail(400, 'Можно привязать только к технике/активу');
        }
        const tx = book(ctx, {
          ...base,
          type,
          categoryId,
          fromAccountId,
          ...(linkedAssetId ? { linkedAssetId } : {}),
        });
        return { ok: true, id: tx.id };
      }
      if (type === 'income') {
        const incomeSourceId = str(body, 'incomeSourceId') ?? fail(400, 'incomeSourceId required');
        if (!db.incomeSources.some((s) => s.id === incomeSourceId)) fail(404, 'Source not found');
        const toAccountId = str(body, 'toAccountId') ?? null;
        if (toAccountId) {
          const acc = findAccount(db, toAccountId) ?? fail(404, 'Account not found');
          if (!isCashOrBank(acc)) fail(400, 'Account must be cash or bank');
        }
        const tx = book(ctx, { ...base, type, incomeSourceId, toAccountId });
        return { ok: true, id: tx.id };
      }
      if (type === 'transfer_to_investment' || type === 'transfer_between_accounts') {
        const fromAccountId = str(body, 'fromAccountId');
        const toAccountId = str(body, 'toAccountId');
        if (!fromAccountId || !toAccountId) fail(400, 'fromAccountId and toAccountId required');
        if (fromAccountId === toAccountId) fail(400, 'Source and destination must differ');
        findAccount(db, fromAccountId) ?? fail(404, 'Account not found');
        const dest = findAccount(db, toAccountId) ?? fail(404, 'Account not found');
        if (type === 'transfer_to_investment' && dest.type !== 'investment')
          fail(400, 'transfer_to_investment requires destination of type investment');
        if (type === 'transfer_between_accounts' && dest.type === 'investment')
          fail(400, 'Use transfer_to_investment for transfers to investment accounts');
        const tx = book(ctx, {
          ...base,
          type,
          fromAccountId: fromAccountId ?? null,
          toAccountId: toAccountId ?? null,
        });
        return { ok: true, id: tx.id };
      }
      return fail(400, 'Invalid type');
    },
  ],
  [
    'PATCH',
    /^\/api\/transactions\/([^/]+)$/,
    ({ db, body, params, now }) => {
      const tx = db.transactions.find((t) => t.id === params[0]) ?? fail(404, 'Transaction not found');
      const date = now.toISOString();
      const next: Transaction = { ...tx };
      if (body.amount !== undefined) next.amount = amountOf(body) ?? fail(400, 'Invalid amount');
      if ('comment' in body)
        next.comment = typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim() : null;
      if (tx.type === 'expense' && typeof body.categoryId === 'string') {
        if (!db.categories.some((c) => c.id === body.categoryId && c.type === 'expense'))
          fail(404, 'Category not found');
        next.categoryId = body.categoryId;
      }
      if (tx.type === 'income' && typeof body.incomeSourceId === 'string') {
        if (!db.incomeSources.some((s) => s.id === body.incomeSourceId)) fail(404, 'Source not found');
        next.incomeSourceId = body.incomeSourceId;
      }
      if (tx.type === 'income' && 'toAccountId' in body) {
        const id = typeof body.toAccountId === 'string' ? body.toAccountId : null;
        if (id && !isCashOrBank(findAccount(db, id) ?? fail(404, 'Account not found')))
          fail(400, 'Account must be cash or bank');
        next.toAccountId = id;
      }
      // Откат старой проводки и проводка новой — как в transactionService прода.
      revertTx(db, tx, date);
      applyTx(db, { ...next, date });
      Object.assign(tx, next);
      return { ok: true };
    },
  ],
  [
    'DELETE',
    /^\/api\/transactions\/([^/]+)$/,
    ({ db, params, now }) => {
      const tx = db.transactions.find((t) => t.id === params[0]) ?? fail(404, 'Transaction not found');
      revertTx(db, tx, now.toISOString());
      db.transactions = db.transactions.filter((t) => t.id !== tx.id);
      return { ok: true };
    },
  ],
  [
    'POST',
    /^\/api\/loss$/,
    (ctx) => {
      const { db, body, now, store } = ctx;
      const amount = amountOf(body) ?? fail(400, 'Invalid amount');
      const fromAccountId = str(body, 'fromAccountId') ?? fail(400, 'fromAccountId required');
      if (!isCashOrBank(findAccount(db, fromAccountId) ?? fail(404, 'Account not found')))
        fail(400, 'Account must be cash or bank');
      let cat = db.categories.find((c) => c.type === 'expense' && c.name === 'Убыток');
      if (!cat) {
        cat = {
          id: store.nextId('cat'),
          name: 'Убыток',
          type: 'expense',
          isActive: true,
          order: 99,
          emoji: '🔻',
        };
        db.categories.push(cat);
      }
      const tx = book(ctx, {
        date: now.toISOString(),
        type: 'expense',
        amount,
        categoryId: cat.id,
        incomeSourceId: null,
        fromAccountId,
        toAccountId: null,
        comment: commentOf(body),
      });
      return { ok: true, id: tx.id, categoryId: cat.id };
    },
  ],

  // Бюджет
  [
    'GET',
    /^\/api\/budget$/,
    (ctx): BudgetDTO => {
      const { db } = ctx;
      const month = monthParam(ctx);
      const list = txInMonth(db, month);
      const order = { over: 0, warning: 1, ok: 2, no_plan: 3 } as const;
      const rows = db.categories
        .filter((c) => c.type === 'expense' && c.isActive)
        .map((c) => {
          const planned =
            db.categoryPlans.find((p) => p.month === month && p.categoryId === c.id)?.amount ?? 0;
          const actual = sum(list.filter((t) => t.type === 'expense' && t.categoryId === c.id));
          return { categoryId: c.id, name: c.name, actualK: actual, ...planFact(planned, actual) };
        })
        // Порядок как в budgetService прода: over → warning → ok → no_plan, внутри — по факту убыв.
        .sort((a, b) => order[a.status] - order[b.status] || b.actualK - a.actualK)
        .map(({ actualK: _a, ...row }) => row);
      const global = db.globalPlans.find((g) => g.month === month);
      const plannedTotal =
        global?.plannedTotalExpenses ??
        db.categoryPlans.filter((p) => p.month === month).reduce((a, p) => a + p.amount, 0);
      const actualTotal = sum(
        list.filter(
          (t) => t.type === 'expense' && db.categories.some((c) => c.id === t.categoryId && c.isActive),
        ),
      );
      return {
        month,
        categories: rows,
        total: planFact(plannedTotal, actualTotal),
        totalIncome: rub(sum(list.filter((t) => t.type === 'income'))),
        plannedIncome: global?.plannedTotalIncome ? rub(global.plannedTotalIncome) : null,
        totalInvestments: rub(sum(list.filter((t) => t.type === 'transfer_to_investment'))),
        plannedInvestments: global?.plannedInvestments ? rub(global.plannedInvestments) : null,
      };
    },
  ],
  [
    'PUT',
    /^\/api\/budget\/category$/,
    (ctx) => {
      const { db, body } = ctx;
      const month = monthParam(ctx);
      const amount = parseMoney(body.amount);
      if (amount === null || amount < 0) fail(400, 'Invalid amount');
      const categoryId = str(body, 'categoryId');
      if (!db.categories.some((c) => c.id === categoryId)) fail(404, 'Category not found');
      db.categoryPlans = db.categoryPlans.filter((p) => !(p.month === month && p.categoryId === categoryId));
      if (amount && amount > 0 && categoryId) db.categoryPlans.push({ month, categoryId, amount });
      return { ok: true };
    },
  ],
  [
    'PUT',
    /^\/api\/budget\/category\/propagate$/,
    (ctx) => {
      const { db, body } = ctx;
      const start = monthParam(ctx);
      const amount = parseMoney(body.amount);
      if (amount === null || amount < 0) fail(400, 'Invalid amount');
      const categoryId = str(body, 'categoryId') ?? '';
      if (!db.categories.some((c) => c.id === categoryId)) fail(404, 'Category not found');
      const extra =
        typeof body.propagateMonths === 'number' ? Math.min(36, Math.max(0, body.propagateMonths)) : 11;
      const onlyEmpty = body.onlyEmpty !== false;
      let written = 0;
      let skipped = 0;
      const [y = 1970, m = 1] = start.split('-').map(Number);
      for (let i = 0; i <= extra; i++) {
        const d = new Date(y, m - 1 + i, 1);
        const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const exists = db.categoryPlans.some((p) => p.month === month && p.categoryId === categoryId);
        // Стартовый месяц перезаписывается всегда, остальные — только пустые (при onlyEmpty).
        if (i > 0 && onlyEmpty && exists) {
          skipped++;
          continue;
        }
        db.categoryPlans = db.categoryPlans.filter(
          (p) => !(p.month === month && p.categoryId === categoryId),
        );
        if (amount) db.categoryPlans.push({ month, categoryId, amount });
        written++;
      }
      return { ok: true, written, skipped, months: extra + 1 };
    },
  ],
  [
    'PUT',
    /^\/api\/budget\/global$/,
    (ctx) => {
      const { db, body } = ctx;
      const month = monthParam(ctx);
      let g = db.globalPlans.find((x) => x.month === month);
      if (!g) {
        g = { month };
        db.globalPlans.push(g);
      }
      for (const key of ['plannedTotalExpenses', 'plannedTotalIncome', 'plannedInvestments'] as const) {
        if (body[key] === undefined) continue;
        g[key] = amountOf(body, key) ?? fail(400, `Invalid ${key}`);
      }
      return { ok: true };
    },
  ],

  // Капитал и счета
  ['GET', /^\/api\/capital$/, ({ db }) => capital(db)],
  [
    'PUT',
    /^\/api\/capital\/balance$/,
    ({ db, body, now }) => {
      const acc = findAccount(db, str(body, 'accountId')) ?? fail(404, 'Account not found');
      const balance = amountOf(body, 'balance') ?? fail(400, 'Invalid balance');
      setBalance(db, acc.id, balance, now.toISOString());
      return { ok: true };
    },
  ],
  [
    'GET',
    /^\/api\/accounts$/,
    ({ db, q }): AccountDTO[] => {
      const onlyCashOrBank = q.get('type') === 'cash_or_bank';
      return sortAccounts(db.accounts.filter((a) => a.isActive && (!onlyCashOrBank || isCashOrBank(a)))).map(
        (a) => accountDTO(db, a),
      );
    },
  ],
  [
    'GET',
    /^\/api\/accounts\/hidden$/,
    ({ db }) =>
      sortAccounts(db.accounts.filter((a) => !a.isActive)).map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        txCount: db.transactions.filter((t) => t.fromAccountId === a.id || t.toAccountId === a.id).length,
      })),
  ],
  [
    'POST',
    /^\/api\/accounts$/,
    ({ db, body, now, store }) => {
      const name = trimmed(body, 'name');
      if (!name) fail(400, 'name required');
      const type = str(body, 'type');
      if (type !== 'cash' && type !== 'bank' && type !== 'investment' && type !== 'other_asset')
        fail(400, 'type must be cash, bank, investment, or other_asset');
      if (db.accounts.some((a) => a.name.toLowerCase() === name.toLowerCase()))
        fail(409, 'Аккаунт с таким именем уже существует');
      const id = store.nextId('acc');
      db.accounts.push({ id, name, type: type as AccountType, isActive: true });
      const initial = parseMoney(body.initialBalance);
      if (initial) setBalance(db, id, initial, now.toISOString());
      return { ok: true, id };
    },
  ],
  [
    'GET',
    /^\/api\/accounts\/([^/]+)\/tx-count$/,
    ({ db, params }) => {
      findAccount(db, params[0]) ?? fail(404, 'Account not found');
      return {
        count: db.transactions.filter((t) => t.fromAccountId === params[0] || t.toAccountId === params[0])
          .length,
      };
    },
  ],
  [
    'GET',
    /^\/api\/accounts\/([^/]+)\/history$/,
    ({ db, params }) => {
      findAccount(db, params[0]) ?? fail(404, 'Account not found');
      return db.snapshots
        .filter((s) => s.accountId === params[0])
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((s) => ({ date: s.date, balance: rub(s.balance) }));
    },
  ],
  [
    'DELETE',
    /^\/api\/accounts\/([^/]+)\/purge$/,
    ({ db, params }) => {
      const acc = findAccount(db, params[0]) ?? fail(404, 'Account not found');
      const touches = (t: Transaction) => t.fromAccountId === acc.id || t.toAccountId === acc.id;
      const deletedTransactions = db.transactions.filter(touches).length;
      const deletedBalances = db.snapshots.filter((s) => s.accountId === acc.id).length;
      db.transactions = db.transactions.filter((t) => !touches(t));
      db.snapshots = db.snapshots.filter((s) => s.accountId !== acc.id);
      db.accounts = db.accounts.filter((a) => a.id !== acc.id);
      db.credits = db.credits.filter((c) => c.id !== acc.id);
      return { ok: true, deletedTransactions, deletedBalances };
    },
  ],
  [
    'PATCH',
    /^\/api\/accounts\/([^/]+)$/,
    ({ db, body, params }) => {
      const acc = findAccount(db, params[0]) ?? fail(404, 'Account not found');
      if (typeof body.name === 'string' && body.name.trim()) {
        const name = body.name.trim();
        if (db.accounts.some((a) => a.id !== acc.id && a.name.toLowerCase() === name.toLowerCase()))
          fail(409, 'Имя занято другим счётом');
        acc.name = name;
      }
      if (typeof body.isActive === 'boolean') acc.isActive = body.isActive;
      return { ok: true, account: { id: acc.id, name: acc.name, isActive: acc.isActive } };
    },
  ],
  [
    'DELETE',
    /^\/api\/accounts\/([^/]+)$/,
    ({ db, params }) => {
      const acc = findAccount(db, params[0]) ?? fail(404, 'Account not found');
      if (db.transactions.some((t) => t.fromAccountId === acc.id || t.toAccountId === acc.id)) {
        acc.isActive = false;
        return { ok: true, action: 'hidden', reason: 'has_transactions' };
      }
      db.accounts = db.accounts.filter((a) => a.id !== acc.id);
      db.snapshots = db.snapshots.filter((s) => s.accountId !== acc.id);
      return { ok: true, action: 'deleted' };
    },
  ],

  // Кредиты
  [
    'GET',
    /^\/api\/credits$/,
    ({ db, now }) =>
      db.credits
        .filter((c) => findAccount(db, c.id)?.isActive)
        .map((c) => creditDTO(db, c.id, now))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
  ],
  [
    'GET',
    /^\/api\/credits\/([^/]+)\/recalc$/,
    ({ db, params, now }) => {
      const c = creditDTO(db, params[0] ?? '', now);
      return {
        remainingPrincipal: c.currentPrincipal,
        remainingMonths: c.remainingMonths,
        newMonthlyPayment: c.scheduledPayment,
      };
    },
  ],
  [
    'POST',
    /^\/api\/credits$/,
    ({ db, body, now, store }) => {
      const name = trimmed(body, 'name');
      if (!name) fail(400, 'name required');
      const originalAmount = amountOf(body, 'originalAmount') ?? fail(400, 'invalid originalAmount');
      const rate = Number(String(body.rate ?? '').replace(',', '.'));
      if (!Number.isFinite(rate)) fail(400, 'invalid rate');
      if (rate < 0) fail(400, 'rate must be >= 0');
      const termMonths = Number(body.termMonths);
      if (!Number.isInteger(termMonths) || termMonths <= 0) fail(400, 'termMonths must be a positive number');
      const startDate = typeof body.startDate === 'string' ? new Date(body.startDate) : now;
      if (Number.isNaN(startDate.getTime())) fail(400, 'invalid startDate');
      if (db.accounts.some((a) => a.name.toLowerCase() === name.toLowerCase()))
        fail(409, 'Аккаунт с таким именем уже существует');
      const day = Number(body.paymentDay);
      const id = store.nextId('acc');
      db.accounts.push({ id, name, type: 'credit', isActive: true });
      db.credits.push({
        id,
        originalAmount,
        rate,
        termMonths,
        startDate: startDate.toISOString(),
        paymentDay: Number.isInteger(day) && day >= 1 && day <= 28 ? day : null,
      });
      setBalance(db, id, originalAmount, startDate.toISOString());
      return { ok: true, id };
    },
  ],
  [
    'POST',
    /^\/api\/credits\/([^/]+)\/pay$/,
    (ctx) => {
      const { db, body, params, now } = ctx;
      const credit = db.credits.find((c) => c.id === params[0]) ?? fail(404, 'Credit not found');
      const amount = amountOf(body) ?? fail(400, 'invalid amount');
      const fromAccountId = str(body, 'fromAccountId') ?? fail(400, 'fromAccountId required');
      const categoryId = str(body, 'categoryId') ?? fail(400, 'categoryId required');
      if (!db.categories.some((c) => c.id === categoryId)) fail(400, 'Category not found');
      const from = findAccount(db, fromAccountId) ?? fail(400, 'Source account not found');
      if (!isCashOrBank(from)) fail(400, 'Source must be cash or bank');
      const debt = balanceOf(db, credit.id);
      const { interest, principal, overpayment } = splitPayment(debt, credit.rate, amount);
      const name = findAccount(db, credit.id)?.name ?? '';
      const tx = book(ctx, {
        date: typeof body.date === 'string' ? new Date(body.date).toISOString() : now.toISOString(),
        type: 'expense',
        amount,
        categoryId,
        incomeSourceId: null,
        fromAccountId,
        toAccountId: credit.id,
        comment: commentOf(body) ?? `Платёж по кредиту: ${name}`,
        principalPart: principal,
        interestPart: interest,
      });
      return {
        ok: true,
        transactionId: tx.id,
        executedAmount: rub(amount),
        interest: rub(interest),
        principal: rub(principal),
        overpayment: rub(overpayment),
        newPrincipal: rub(balanceOf(db, credit.id)),
      };
    },
  ],

  // Активы
  [
    'POST',
    /^\/api\/assets\/purchase$/,
    (ctx) => {
      const { db, body, store } = ctx;
      const name = trimmed(body, 'name');
      if (!name) fail(400, 'name required');
      const assetType = str(body, 'assetType');
      if (assetType !== 'investment' && assetType !== 'other_asset')
        fail(400, 'assetType must be investment or other_asset');
      const unit = amountOf(body) ?? fail(400, 'invalid amount');
      const qty =
        Number.isInteger(body.quantity) && (body.quantity as number) > 0 ? (body.quantity as number) : 1;
      const from = findAccount(db, str(body, 'fromAccountId')) ?? fail(404, 'source account not found');
      if (!isCashOrBank(from)) fail(400, 'source account must be cash or bank');
      if (db.accounts.some((a) => a.name.toLowerCase() === name.toLowerCase()))
        fail(409, 'Аккаунт с таким именем уже существует');
      const id = store.nextId('acc');
      db.accounts.push({
        id,
        name,
        type: assetType as AccountType,
        isActive: true,
        purchasePrice: unit,
        liability: false,
      });
      const total = unit * qty;
      const tx = book(ctx, {
        date: ctx.now.toISOString(),
        type: assetType === 'investment' ? 'transfer_to_investment' : 'transfer_between_accounts',
        amount: total,
        categoryId: null,
        incomeSourceId: null,
        fromAccountId: from.id,
        toAccountId: id,
        comment:
          commentOf(body) ?? (qty > 1 ? `Покупка: ${name} (${qty} шт × ${rub(unit)})` : `Покупка: ${name}`),
      });
      return { ok: true, accountId: id, transactionId: tx.id, newSourceBalance: rub(balanceOf(db, from.id)) };
    },
  ],
  ['POST', /^\/api\/assets\/([^/]+)\/restock$/, () => fail(400, 'Not a lot-based resale position')],
  ['POST', /^\/api\/assets\/([^/]+)\/sell-units$/, () => fail(400, 'Not a lot-based resale position')],
  [
    'POST',
    /^\/api\/assets\/([^/]+)\/sell$/,
    (ctx) => {
      const { db, body, params, now } = ctx;
      const asset = findAccount(db, params[0]) ?? fail(404, 'Asset not found');
      if (!asset.isActive) fail(409, 'Актив уже продан');
      if (asset.type !== 'investment' && asset.type !== 'other_asset')
        fail(400, 'Only investments and other assets can be sold');
      const to = findAccount(db, str(body, 'toAccountId')) ?? fail(404, 'Destination account not found');
      if (!isCashOrBank(to)) fail(400, 'Destination must be cash or bank');
      const salePrice = amountOf(body, 'salePrice') ?? fail(400, 'Invalid sale price');
      const cost = balanceOf(db, asset.id);
      const date = now.toISOString();
      const transfer = book(ctx, {
        date,
        type: 'transfer_between_accounts',
        amount: Math.min(cost, salePrice),
        categoryId: null,
        incomeSourceId: null,
        fromAccountId: asset.id,
        toAccountId: to.id,
        comment: `Продажа: ${asset.name}`,
      });
      setBalance(db, asset.id, 0, date);
      let incomeId: string | null = null;
      const profit = salePrice - cost;
      if (profit > 0) {
        let src = db.incomeSources.find((s) => s.name === 'Прочее');
        if (!src) {
          src = { id: ctx.store.nextId('src'), name: 'Прочее', emoji: null, isActive: true };
          db.incomeSources.push(src);
        }
        incomeId = book(
          ctx,
          {
            date,
            type: 'income',
            amount: profit,
            categoryId: null,
            incomeSourceId: src.id,
            fromAccountId: null,
            toAccountId: to.id,
            comment: `Прибыль с продажи: ${asset.name}`,
          },
          false,
        ).id;
      } else if (salePrice < cost) {
        // Transfer покрыл только salePrice — остаток цены ушёл в убыток, баланс актива уже обнулён.
      }
      asset.isActive = false;
      return {
        ok: true,
        transferTransactionId: transfer.id,
        incomeTransactionId: incomeId,
        cost: rub(cost),
        salePrice: rub(salePrice),
        profit: rub(profit),
      };
    },
  ],
  [
    'POST',
    /^\/api\/assets\/([^/]+)\/prepayment$/,
    (ctx) => {
      const { db, body, params, now } = ctx;
      const asset = findAccount(db, params[0]) ?? fail(404, 'Asset not found');
      const to = findAccount(db, str(body, 'toAccountId')) ?? fail(404, 'Destination account not found');
      if (!isCashOrBank(to)) fail(400, 'Destination must be cash or bank');
      const amount = amountOf(body) ?? fail(400, 'invalid amount');
      const rest = balanceOf(db, asset.id);
      const principal = Math.min(amount, rest);
      const date = now.toISOString();
      const fullySold = rest - principal <= 0;
      const transfer = book(ctx, {
        date,
        type: 'transfer_between_accounts',
        amount: principal,
        categoryId: null,
        incomeSourceId: null,
        fromAccountId: asset.id,
        toAccountId: to.id,
        comment: `${fullySold ? 'Продажа' : 'Предоплата'}: ${asset.name}`,
      });
      const profit = amount - principal;
      if (profit > 0) adjust(db, to.id, profit, date);
      if (fullySold) asset.isActive = false;
      return {
        ok: true,
        transferTransactionId: transfer.id,
        incomeTransactionId: null,
        received: rub(amount),
        principal: rub(principal),
        profit: rub(profit),
        newAssetBalance: rub(balanceOf(db, asset.id)),
        fullySold,
      };
    },
  ],
  [
    'POST',
    /^\/api\/assets\/([^/]+)\/revalue$/,
    (ctx) => {
      const { db, body, params, now, store } = ctx;
      const asset = findAccount(db, params[0]) ?? fail(404, 'Asset not found');
      if (!asset.isActive) fail(409, 'Актив закрыт');
      const next = parseMoney(body.newValue);
      if (next === null) fail(400, 'invalid newValue');
      if ((next as number) < 0) fail(400, 'Стоимость не может быть отрицательной');
      const prev = balanceOf(db, asset.id);
      const value = next as number;
      if (value === prev) fail(400, 'Стоимость не изменилась');
      const date = now.toISOString();
      setBalance(db, asset.id, value, date);
      const gain = value > prev;
      const tx: Transaction = {
        id: store.nextId('tx'),
        date,
        type: 'asset_revaluation',
        amount: Math.abs(value - prev),
        categoryId: null,
        incomeSourceId: null,
        fromAccountId: gain ? null : asset.id,
        toAccountId: gain ? asset.id : null,
        comment: commentOf(body) ?? `Переоценка: ${asset.name}`,
      };
      db.transactions.push(tx);
      return {
        ok: true,
        revalTransactionId: tx.id,
        previousValue: rub(prev),
        newValue: rub(value),
        delta: rub(value - prev),
        direction: gain ? 'gain' : 'loss',
      };
    },
  ],
  [
    'GET',
    /^\/api\/assets\/([^/]+)\/investments$/,
    ({ db, params }) => {
      const asset = findAccount(db, params[0]) ?? fail(404, 'Asset not found');
      const items = db.transactions
        .filter((t) => t.type === 'expense' && t.linkedAssetId === asset.id)
        .sort(byDateDesc);
      const current = balanceOf(db, asset.id);
      const purchase = asset.purchasePrice ?? current;
      const invested = sum(items);
      return {
        assetId: asset.id,
        name: asset.name,
        liability: asset.liability ?? false,
        purchase: rub(purchase),
        invested: rub(invested),
        total: rub(purchase + invested),
        currentValue: rub(current),
        marginNow: rub(current - (purchase + invested)),
        items: items.map((t) => ({
          id: t.id,
          date: t.date,
          amount: rub(t.amount),
          category: db.categories.find((c) => c.id === t.categoryId)?.name ?? null,
          comment: t.comment,
        })),
      };
    },
  ],
  [
    'PATCH',
    /^\/api\/assets\/([^/]+)\/classification$/,
    ({ db, body, params, now, store }) => {
      const asset = findAccount(db, params[0]) ?? fail(404, 'Asset not found');
      const liability = body.liability === true;
      let purchaseExpenseId: string | null = null;
      if (liability && !asset.liability) {
        // Переход актив → пассив: разовая запись «Покупка (пассив)» в категорию «Покупки», балансы не трогаются.
        let cat = db.categories.find((c) => c.type === 'expense' && c.name === 'Покупки');
        if (!cat) {
          cat = {
            id: store.nextId('cat'),
            name: 'Покупки',
            type: 'expense',
            isActive: true,
            order: 99,
            emoji: null,
          };
          db.categories.push(cat);
        }
        const tx: Transaction = {
          id: store.nextId('tx'),
          date: now.toISOString(),
          type: 'expense',
          amount: asset.purchasePrice ?? balanceOf(db, asset.id),
          categoryId: cat.id,
          incomeSourceId: null,
          fromAccountId: null,
          toAccountId: null,
          comment: `Покупка (пассив): ${asset.name}`,
          linkedAssetId: asset.id,
        };
        db.transactions.push(tx);
        purchaseExpenseId = tx.id;
        setBalance(db, asset.id, 0, now.toISOString());
      }
      asset.liability = liability;
      return { ok: true, liability, purchaseExpenseId };
    },
  ],

  // Аналитика
  [
    'GET',
    /^\/api\/analytics\/summary$/,
    (ctx) => {
      const { from, to } = periodOf(ctx);
      const len = to.getTime() - from.getTime();
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        current: totalsIn(ctx.db, from, to),
        previous: totalsIn(ctx.db, new Date(from.getTime() - len), from),
      };
    },
  ],
  [
    'GET',
    /^\/api\/analytics\/by-category$/,
    (ctx) => {
      const { db, q } = ctx;
      const { from, to } = periodOf(ctx);
      const limit = Math.min(Number.parseInt(q.get('limit') ?? '20', 10) || 20, 50);
      const expenses = db.transactions.filter((t) => t.type === 'expense' && inRange(t.date, from, to));
      const total = sum(expenses);
      const byCat = new Map<string, Kopecks>();
      for (const t of expenses)
        if (t.categoryId) byCat.set(t.categoryId, (byCat.get(t.categoryId) ?? 0) + t.amount);
      const items = [...byCat.entries()]
        .map(([categoryId, amount]) => ({
          categoryId,
          name: db.categories.find((c) => c.id === categoryId)?.name ?? 'Без категории',
          amount: rub(amount),
          // В проде share — проценты 0..100 с одним знаком, а не доля 0..1.
          share: total > 0 ? Math.round((amount / total) * 1000) / 10 : 0,
          k: amount,
        }))
        .sort((a, b) => b.k - a.k)
        .slice(0, limit)
        .map(({ k: _k, ...item }) => item);
      return { from: from.toISOString(), to: to.toISOString(), total: rub(total), items };
    },
  ],
  [
    'GET',
    /^\/api\/analytics\/by-income-source$/,
    (ctx) => {
      const { db, q } = ctx;
      const { from, to } = periodOf(ctx);
      const limit = Math.min(Number.parseInt(q.get('limit') ?? '20', 10) || 20, 50);
      const incomes = db.transactions.filter((t) => t.type === 'income' && inRange(t.date, from, to));
      const total = sum(incomes);
      const bySrc = new Map<string, Kopecks>();
      for (const t of incomes)
        bySrc.set(t.incomeSourceId ?? '', (bySrc.get(t.incomeSourceId ?? '') ?? 0) + t.amount);
      const items = [...bySrc.entries()]
        .map(([sourceId, amount]) => ({
          sourceId,
          name: db.incomeSources.find((s) => s.id === sourceId)?.name ?? 'Неизвестный источник',
          amount: rub(amount),
          share: total > 0 ? Math.round((amount / total) * 1000) / 10 : 0,
          k: amount,
        }))
        .sort((a, b) => b.k - a.k)
        .slice(0, limit)
        .map(({ k: _k, ...item }) => item);
      return { from: from.toISOString(), to: to.toISOString(), total: rub(total), items };
    },
  ],
  [
    'GET',
    /^\/api\/analytics\/daily$/,
    (ctx) => {
      const { db } = ctx;
      const { from, to } = periodOf(ctx);
      const pad = (n: number) => String(n).padStart(2, '0');
      const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const acc = new Map<string, { income: number; expense: number; investment: number }>();
      for (const t of db.transactions) {
        if (!inRange(t.date, from, to)) continue;
        const key = localDay(new Date(t.date));
        const row = acc.get(key) ?? { income: 0, expense: 0, investment: 0 };
        if (t.type === 'income') row.income += t.amount;
        if (t.type === 'expense') row.expense += t.amount;
        if (t.type === 'transfer_to_investment') row.investment += t.amount;
        acc.set(key, row);
      }
      // В проде суммы здесь — текст Postgres SUM(...)::text: «1250.50», а пустые дни — «0».
      const pg = (k: number) => (k === 0 ? '0' : (k / 100).toFixed(2));
      const days: Array<{ day: string; income: string; expense: string; investment: string }> = [];
      for (
        let d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
        d < to;
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
      ) {
        const row = acc.get(localDay(d)) ?? { income: 0, expense: 0, investment: 0 };
        days.push({
          day: localDay(d),
          income: pg(row.income),
          expense: pg(row.expense),
          investment: pg(row.investment),
        });
      }
      return { from: from.toISOString(), to: to.toISOString(), days };
    },
  ],
  [
    'GET',
    /^\/api\/analytics\/networth-history$/,
    ({ db, q, now }) => {
      const weeks = Math.min(156, Math.max(4, Number.parseInt(q.get('weeks') ?? '26', 10) || 26));
      const type = q.get('type');
      // История по всем счетам, включая скрытые; кредиты вычитаются.
      const accounts = db.accounts.filter((a) => !type || a.type === type);
      if (accounts.length === 0) return { weeks: [], totalNow: '0' };
      const totalAt = (iso?: string) =>
        accounts.reduce((acc, a) => {
          const b = balanceOf(db, a.id, iso);
          return a.type === 'credit' ? acc - b : acc + b;
        }, 0);
      const points = [];
      for (let w = weeks - 1; w >= 0; w--) {
        const weekEnd = new Date(now.getTime() - w * 7 * 86_400_000).toISOString();
        points.push({ weekEnd, total: rub(totalAt(weekEnd)) });
      }
      return { weeks: points, totalNow: rub(totalAt()) };
    },
  ],
  ['GET', /^\/api\/analytics\/sold-assets$/, () => ({ items: [] })],

  // Прочее
  [
    'POST',
    /^\/api\/feedback$/,
    ({ db, body, now, store }) => {
      const message = trimmed(body, 'message');
      if (!message) fail(400, 'Пустое сообщение');
      if (message.length > 2000) fail(400, 'Слишком длинное (макс 2000 символов)');
      const id = store.nextId('fb');
      db.feedback.push({ id, message, createdAt: now.toISOString() });
      return { ok: true, id };
    },
  ],
  ['GET', /^\/api\/push\/vapid-public-key$/, () => fail(503, 'Push notifications are not configured')],
  ['POST', /^\/api\/push\/subscribe$/, () => fail(503, 'Push notifications are not configured')],
  ['POST', /^\/api\/push\/unsubscribe$/, () => ({ ok: true })],
];

/** Найти обработчик и выполнить. Изменения сохраняются в хранилище только при успехе. */
export function route(store: DemoStore, method: string, url: URL, body: unknown): unknown {
  for (const [m, pattern, handler] of ROUTES) {
    if (m !== method) continue;
    const match = pattern.exec(url.pathname);
    if (!match) continue;
    const ctx: Ctx = {
      store,
      db: store.db,
      q: url.searchParams,
      body: body && typeof body === 'object' && !Array.isArray(body) ? (body as Body) : {},
      params: match.slice(1).map(decodeURIComponent),
      now: store.now(),
    };
    if (method === 'GET') return handler(ctx);
    // Изменяющий запрос: если обработчик упадёт на середине (например, 400 после первой
    // проводки), откатываемся к копии — данные не остаются полуизменёнными, как в транзакции БД.
    const snapshot = structuredClone(store.db);
    try {
      const result = handler(ctx);
      store.save();
      return result;
    } catch (e) {
      store.db = snapshot;
      throw e;
    }
  }
  return fail(404, `В демо-версии нет обработчика ${method} ${url.pathname}`);
}

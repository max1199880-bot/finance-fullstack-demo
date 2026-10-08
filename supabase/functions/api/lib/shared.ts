// Общие кирпичи обработчиков: типы строк базы, перевод строк в DTO приложения,
// остатки счетов, план/факт. Всё, что нужно больше чем одному домену, живёт здесь —
// иначе формат ответа начинает расходиться между экранами.

import type { Ctx } from './context.ts';
import { badRequest, notFound } from './http.ts';
import { fromDb, type Kopecks, rub } from './money.ts';

export type AccountType = 'cash' | 'bank' | 'investment' | 'other_asset' | 'credit' | 'credit_buffer';
export type TxType =
  | 'income' | 'expense' | 'transfer_to_investment'
  | 'transfer_between_accounts' | 'credit_payment' | 'asset_revaluation';

export interface AccountRow {
  id: string;
  name: string;
  type: AccountType;
  is_active: boolean;
  purchase_price: string | null;
  credit_rate: string | null;
  credit_term_months: number | null;
  credit_original_amount: string | null;
  credit_start_date: string | null;
  credit_payment_day: number | null;
  linked_credit_account_id: string | null;
  liability: boolean;
}

export const ACCOUNT_FIELDS =
  'id, name, type, is_active, purchase_price, credit_rate, credit_term_months, ' +
  'credit_original_amount, credit_start_date, credit_payment_day, linked_credit_account_id, liability';

export interface TxRow {
  id: string;
  date: string;
  amount: string;
  type: TxType;
  category_id: string | null;
  income_source_id: string | null;
  from_account_id: string | null;
  to_account_id: string | null;
  linked_asset_id: string | null;
  principal_part: string | null;
  interest_part: string | null;
  comment: string | null;
}

export const TX_FIELDS =
  'id, date, amount, type, category_id, income_source_id, from_account_id, to_account_id, ' +
  'linked_asset_id, principal_part, interest_part, comment';

/** Порядок счетов на экране: сначала деньги, потом имущество, в конце долги. */
const TYPE_ORDER: Record<AccountType, number> = {
  cash: 0, bank: 1, investment: 2, other_asset: 3, credit: 4, credit_buffer: 5,
};

/**
 * Приведение ответа supabase-js к нашим типам. Поля в запросах мы собираем строкой
 * (ACCOUNT_FIELDS и подобные), и клиент не может вывести их тип — поэтому приводим
 * явно, через unknown. Один хелпер на все домены, чтобы приведение не расползалось.
 */
export const rowsOf = <T>(data: unknown): T[] => (data ?? []) as unknown as T[];
export const rowOf = <T>(data: unknown): T => data as unknown as T;

export function sortAccounts<T extends { type: AccountType; name: string }>(rows: T[]): T[] {
  return rows.sort((a, b) =>
    TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.name.localeCompare(b.name, 'ru'));
}

export const byNameRu = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'ru');

/**
 * Остатки нескольких счетов одним запросом. Остаток — последняя запись истории,
 * поэтому берём все записи нужных счетов и оставляем свежую: так вместо N запросов
 * к базе получается один.
 */
export async function balancesOf(ctx: Ctx, accountIds: string[]): Promise<Map<string, Kopecks>> {
  const out = new Map<string, Kopecks>();
  if (!accountIds.length) return out;
  const { data, error } = await ctx.db
    .from('account_balances')
    .select('account_id, date, balance')
    .in('account_id', accountIds)
    .order('date', { ascending: false });
  if (error) throw new Error(error.message);
  for (const row of rowsOf<{ account_id: string; balance: string }>(data)) {
    if (!out.has(row.account_id)) out.set(row.account_id, fromDb(row.balance));
  }
  for (const id of accountIds) if (!out.has(id)) out.set(id, 0);
  return out;
}

/** Остаток счёта на дату — для истории капитала. */
export async function balanceAt(ctx: Ctx, accountId: string, at: Date): Promise<Kopecks> {
  const { data, error } = await ctx.db
    .from('account_balances')
    .select('balance')
    .eq('account_id', accountId)
    .lte('date', at.toISOString())
    .order('date', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.length ? fromDb(data[0].balance) : 0;
}

export function accountDTO(row: AccountRow, balance: Kopecks, quantity: number | null = null) {
  const isAsset = row.type === 'investment' || row.type === 'other_asset';
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    balance: rub(balance),
    quantity,
    ...(isAsset ? { liability: row.liability } : {}),
  };
}

export interface NameMaps {
  categories: Map<string, string>;
  sources: Map<string, string>;
  accounts: Map<string, string>;
}

/** Имена для списка операций: по одному запросу на справочник, без N+1. */
export async function nameMaps(ctx: Ctx): Promise<NameMaps> {
  const [cats, srcs, accs] = await Promise.all([
    ctx.db.from('categories').select('id, name'),
    ctx.db.from('income_sources').select('id, name'),
    ctx.db.from('accounts').select('id, name'),
  ]);
  const toMap = (rows: { id: string; name: string }[] | null) =>
    new Map((rows ?? []).map((r) => [r.id, r.name]));
  return {
    categories: toMap(cats.data),
    sources: toMap(srcs.data),
    accounts: toMap(accs.data),
  };
}

export function txDTO(row: TxRow, names: NameMaps) {
  return {
    id: row.id,
    date: new Date(row.date).toISOString(),
    amount: rub(fromDb(row.amount)),
    type: row.type,
    categoryId: row.category_id,
    categoryName: row.category_id ? names.categories.get(row.category_id) ?? null : null,
    incomeSourceName: row.income_source_id ? names.sources.get(row.income_source_id) ?? null : null,
    fromAccountId: row.from_account_id,
    toAccountId: row.to_account_id,
    fromAccountName: row.from_account_id ? names.accounts.get(row.from_account_id) ?? null : null,
    toAccountName: row.to_account_id ? names.accounts.get(row.to_account_id) ?? null : null,
    comment: row.comment,
  };
}

/**
 * План/факт одной строки бюджета. Пороги те же, что в приложении:
 * до 90% — норма, до 110% — предупреждение, выше — перерасход.
 */
export function planFact(planned: Kopecks | null, actual: Kopecks) {
  const status = planned === null || planned === 0
    ? 'no_plan'
    : (() => {
      const p = Math.round((actual / planned) * 100);
      return p <= 90 ? 'ok' : p <= 110 ? 'warning' : 'over';
    })();
  return {
    planned: rub(planned ?? 0),
    actual: rub(actual),
    delta: rub(actual - (planned ?? 0)),
    percent: planned ? Math.round((actual / planned) * 100) : null,
    status,
  };
}

/** Счёт пользователя по id. RLS уже отсекает чужие строки — пустой ответ значит «нет такого». */
export async function requireAccount(ctx: Ctx, id: string, message = 'Account not found'): Promise<AccountRow> {
  const { data, error } = await ctx.db.from('accounts').select(ACCOUNT_FIELDS).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw notFound(message);
  return rowOf<AccountRow>(data);
}

export async function requireCashOrBank(ctx: Ctx, id: string, notFoundMsg = 'Account not found'): Promise<AccountRow> {
  const acc = await requireAccount(ctx, id, notFoundMsg);
  if (acc.type !== 'cash' && acc.type !== 'bank') throw badRequest('Account must be cash or bank');
  return acc;
}

/** Сумма операций: фильтры собирает вызывающий, здесь только сложение. */
export function sumAmounts(rows: { amount: string }[]): Kopecks {
  return rows.reduce((acc, r) => acc + fromDb(r.amount), 0);
}

/** Диапазон дат из query: [from, to). Мусор — 400, как в приложении. */
export function dateRange(url: URL): { from: Date; to: Date } {
  const toRaw = url.searchParams.get('to');
  const fromRaw = url.searchParams.get('from');
  const to = toRaw ? new Date(toRaw) : new Date();
  const from = fromRaw ? new Date(fromRaw) : new Date(to.getTime() - 30 * 24 * 3600 * 1000);
  if (Number.isNaN(to.getTime()) || Number.isNaN(from.getTime())) throw badRequest('Invalid date');
  return { from, to };
}

/** Число из query с границами: limit, weeks и подобные. */
export function clampedInt(raw: string | null, def: number, min: number, max: number): number {
  // Пустое значение — это «параметр не передан», а не ноль: Number(null) даёт 0,
  // и без этой проверки значение по умолчанию было бы недостижимо.
  if (raw === null || raw.trim() === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

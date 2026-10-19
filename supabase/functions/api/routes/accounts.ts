// Счета и капитал: список счетов, итоги по типам, журнал остатков и жизненный цикл
// счёта (создание, переименование, скрытие, удаление).
//
// Остаток счёта нигде не хранится отдельным полем: он равен последней по дате строке
// журнала account_balances. Поэтому «поменять остаток» — это дописать строку, а не
// обновить её: история остаётся целой, и по ней рисуется график капитала.

import type { Ctx } from '../lib/context.ts';
import { capitalTotals } from '../lib/aggregates.ts';
import { badRequest, conflict, notFound, readJson } from '../lib/http.ts';
import { fromDb, type Kopecks, parseMoney, rub, toDb } from '../lib/money.ts';
import type { Route } from '../lib/route.ts';
import {
  ACCOUNT_FIELDS,
  type AccountRow,
  accountDTO,
  balancesOf,
  requireAccount,
  sortAccounts,
} from '../lib/shared.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Строки счетов из ответа базы. ACCOUNT_FIELDS — собранная строка, типы postgrest
 * её не разбирают и выводят тип ошибки, поэтому приводим к своему типу через unknown.
 */
const asAccounts = (data: unknown): AccountRow[] => (data ?? []) as AccountRow[];

/**
 * Счёт по идентификатору из пути. Форму uuid проверяем до запроса: на мусорной
 * строке Postgres ответил бы ошибкой запроса, и клиент увидел бы 500 вместо
 * понятного «нет такого счёта».
 */
async function account(ctx: Ctx, id: string): Promise<AccountRow> {
  if (!UUID_RE.test(id)) throw notFound('Account not found');
  return await requireAccount(ctx, id);
}

/**
 * Занято ли имя. Сравниваем без учёта регистра: уникальный индекс базы регистр
 * различает, а приложение считает «Наличные» и «наличные» одним счётом. Сравнение
 * идёт в коде, а не через ilike, потому что в имени счёта законно встречаются
 * «%» и «_» — для LIKE это подстановочные знаки.
 */
async function nameTaken(ctx: Ctx, name: string, exceptId?: string): Promise<boolean> {
  const { data, error } = await ctx.db.from('accounts').select('id, name');
  if (error) throw new Error(error.message);
  const lower = name.toLowerCase();
  return ((data ?? []) as { id: string; name: string }[]).some(
    (r) => r.id !== exceptId && r.name.toLowerCase() === lower,
  );
}

/** Условие «операция касается счёта»: он мог быть источником, получателем или привязанным активом. */
const touchesAccount = (id: string, withAsset = false) =>
  [
    `from_account_id.eq.${id}`,
    `to_account_id.eq.${id}`,
    ...(withAsset ? [`linked_asset_id.eq.${id}`] : []),
  ].join(',');

/** Сколько операций у счёта. Считает база: тела операций здесь не нужны. */
async function txCount(ctx: Ctx, id: string, withAsset = false): Promise<number> {
  const { count, error } = await ctx.db
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .or(touchesAccount(id, withAsset));
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Новая строка журнала остатков. user_id у таблицы нет — право наследуется от счёта (RLS). */
async function snapshot(ctx: Ctx, accountId: string, balance: Kopecks): Promise<void> {
  const { error } = await ctx.db
    .from('account_balances')
    .insert({ account_id: accountId, date: new Date().toISOString(), balance: toDb(balance) });
  if (error) throw new Error(error.message);
}

export const routes: Route[] = [
  // Экран «Капитал»: счета и итоги по типам одним ответом.
  {
    method: 'GET',
    path: '/capital',
    handler: async (ctx) => {
      const { accounts, balances, totals } = await capitalTotals(ctx);
      return {
        accounts: sortAccounts(accounts).map((a) => accountDTO(a, balances.get(a.id) ?? 0)),
        ...totals,
      };
    },
  },

  // Сверка остатка вручную: пользователь вводит реальную сумму со счёта.
  // Порядок проверок важен — сначала счёт, потом сумма: так клиент видит
  // ту же ошибку, что и в действующем приложении.
  {
    method: 'PUT',
    path: '/capital/balance',
    handler: async (ctx) => {
      const body = await readJson(ctx.req);
      const acc = await account(ctx, typeof body.accountId === 'string' ? body.accountId : '');
      const balance = parseMoney(body.balance);
      if (balance === null || balance <= 0) throw badRequest('Invalid balance');
      await snapshot(ctx, acc.id, balance);
      return { ok: true };
    },
  },

  // Список для выпадающих полей. type=cash_or_bank нужен формам расхода и дохода:
  // платить и получать можно только на деньги, не на инвестиции или имущество.
  {
    method: 'GET',
    path: '/accounts',
    handler: async (ctx) => {
      const onlyCashOrBank = ctx.url.searchParams.get('type') === 'cash_or_bank';
      const base = ctx.db.from('accounts').select(ACCOUNT_FIELDS).eq('is_active', true);
      const { data, error } = await (onlyCashOrBank ? base.in('type', ['cash', 'bank']) : base);
      if (error) throw new Error(error.message);

      const rows = asAccounts(data);
      const balances = await balancesOf(
        ctx,
        rows.map((r) => r.id),
      );
      return sortAccounts(rows).map((r) => accountDTO(r, balances.get(r.id) ?? 0));
    },
  },

  // Корзина: скрытые счёта с числом операций. По нему пользователь решает,
  // восстановить счёт или удалить вместе с историей.
  {
    method: 'GET',
    path: '/accounts/hidden',
    handler: async (ctx) => {
      const { data, error } = await ctx.db.from('accounts').select(ACCOUNT_FIELDS).eq('is_active', false);
      if (error) throw new Error(error.message);

      const rows = asAccounts(data);
      if (!rows.length) return [];

      // Один запрос на все скрытые счёта вместо запроса на каждый: при десятке
      // счетов в корзине это разница между 1 и 10 обращениями к базе.
      const ids = rows.map((r) => r.id);
      const list = ids.join(',');
      const tx = await ctx.db
        .from('transactions')
        .select('from_account_id, to_account_id')
        .or(`from_account_id.in.(${list}),to_account_id.in.(${list})`);
      if (tx.error) throw new Error(tx.error.message);

      const counts = new Map<string, number>(ids.map((id) => [id, 0]));
      for (const r of (tx.data ?? []) as { from_account_id: string | null; to_account_id: string | null }[]) {
        // Set убирает двойной счёт, когда у перевода источник и получатель — один счёт.
        for (const id of new Set([r.from_account_id, r.to_account_id])) {
          if (id && counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }

      return sortAccounts(rows).map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        txCount: counts.get(r.id) ?? 0,
      }));
    },
  },

  {
    method: 'POST',
    path: '/accounts',
    handler: async (ctx) => {
      const body = await readJson(ctx.req);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) throw badRequest('name required');

      const type = body.type;
      // Кредиты и подушки создаются своими эндпоинтами: им нужны ставка и срок.
      if (type !== 'cash' && type !== 'bank' && type !== 'investment' && type !== 'other_asset') {
        throw badRequest('type must be cash, bank, investment, or other_asset');
      }
      if (await nameTaken(ctx, name)) throw conflict('Аккаунт с таким именем уже существует');

      const { data, error } = await ctx.db
        .from('accounts')
        .insert({ user_id: ctx.userId, name, type, is_active: true })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      const id = (data as { id: string }).id;

      // Нулевой остаток не записываем: пустой журнал уже означает ноль.
      const initial = parseMoney(body.initialBalance);
      if (initial) await snapshot(ctx, id, initial);

      return { ok: true, id };
    },
  },

  // Приложение спрашивает это перед удалением, чтобы предупредить про историю.
  {
    method: 'GET',
    path: '/accounts/:id/tx-count',
    handler: async (ctx) => {
      const acc = await account(ctx, ctx.params.id);
      return { count: await txCount(ctx, acc.id) };
    },
  },

  // График остатка по счёту: журнал целиком, по возрастанию даты.
  {
    method: 'GET',
    path: '/accounts/:id/history',
    handler: async (ctx) => {
      const acc = await account(ctx, ctx.params.id);
      const { data, error } = await ctx.db
        .from('account_balances')
        .select('date, balance')
        .eq('account_id', acc.id)
        .order('date', { ascending: true });
      if (error) throw new Error(error.message);

      return ((data ?? []) as { date: string; balance: string }[]).map((r) => ({
        date: new Date(r.date).toISOString(),
        balance: rub(fromDb(r.balance)),
      }));
    },
  },

  // Полная очистка из корзины: счёт вместе с операциями и журналом остатков.
  // Отдельный путь от DELETE /accounts/:id, потому что это необратимо и
  // подтверждается пользователем отдельно.
  {
    method: 'DELETE',
    path: '/accounts/:id/purge',
    handler: async (ctx) => {
      const acc = await account(ctx, ctx.params.id);

      // Считаем до удаления: после него считать уже нечего, а числа уходят в ответ.
      const deletedTransactions = await txCount(ctx, acc.id, true);
      const balances = await ctx.db
        .from('account_balances')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', acc.id);
      if (balances.error) throw new Error(balances.error.message);
      const deletedBalances = balances.count ?? 0;

      const txDel = await ctx.db.from('transactions').delete().or(touchesAccount(acc.id, true));
      if (txDel.error) throw new Error(txDel.error.message);
      // Журнал чистим раньше счёта: право на его строки RLS выводит из строки счёта,
      // а после удаления счёта проверка перестанет пропускать.
      const balDel = await ctx.db.from('account_balances').delete().eq('account_id', acc.id);
      if (balDel.error) throw new Error(balDel.error.message);
      const accDel = await ctx.db.from('accounts').delete().eq('id', acc.id);
      if (accDel.error) throw new Error(accDel.error.message);

      return { ok: true, deletedTransactions, deletedBalances };
    },
  },

  // Переименование и скрытие/восстановление. Один эндпоинт на оба действия:
  // клиент шлёт только изменённое поле.
  {
    method: 'PATCH',
    path: '/accounts/:id',
    handler: async (ctx) => {
      const acc = await account(ctx, ctx.params.id);
      const body = await readJson(ctx.req);

      const patch: Record<string, unknown> = {};
      let name = acc.name;
      let isActive = acc.is_active;

      if (typeof body.name === 'string' && body.name.trim()) {
        name = body.name.trim();
        if (await nameTaken(ctx, name, acc.id)) throw conflict('Имя занято другим счётом');
        patch.name = name;
      }
      if (typeof body.isActive === 'boolean') {
        isActive = body.isActive;
        patch.is_active = isActive;
      }

      if (Object.keys(patch).length) {
        const { error } = await ctx.db.from('accounts').update(patch).eq('id', acc.id);
        if (error) throw new Error(error.message);
      }
      return { ok: true, account: { id: acc.id, name, isActive } };
    },
  },

  // Удаление из обычного списка. Счёт с операциями не удаляем: иначе у операций
  // пропадёт источник и суммы месяца перестанут сходиться. Такой счёт прячем,
  // а добить его можно через purge из корзины.
  {
    method: 'DELETE',
    path: '/accounts/:id',
    handler: async (ctx) => {
      const acc = await account(ctx, ctx.params.id);

      if ((await txCount(ctx, acc.id)) > 0) {
        const { error } = await ctx.db.from('accounts').update({ is_active: false }).eq('id', acc.id);
        if (error) throw new Error(error.message);
        return { ok: true, action: 'hidden', reason: 'has_transactions' };
      }

      const balDel = await ctx.db.from('account_balances').delete().eq('account_id', acc.id);
      if (balDel.error) throw new Error(balDel.error.message);
      const accDel = await ctx.db.from('accounts').delete().eq('id', acc.id);
      if (accDel.error) throw new Error(accDel.error.message);
      return { ok: true, action: 'deleted' };
    },
  },
];

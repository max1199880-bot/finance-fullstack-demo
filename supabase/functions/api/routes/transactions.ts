// Операции: список, создание, правка, удаление и быстрый расход «Убыток».
//
// Запись операции всегда идёт через RPC post_transaction, а не через insert:
// операция и остатки двух счётов меняются в одной транзакции базы, поэтому обрыв
// связи посередине не оставит остатки расходящимися с операциями. Там же живёт
// идемпотентность по client_tx_id — повтор запроса возвращает прежнюю операцию.
//
// Правка и удаление такой защиты не имеют: post_transaction умеет только создавать.
// Здесь проводка откатывается и применяется заново вручную — несколькими запросами,
// поэтому порядок выбран так, чтобы падение на первом шаге не портило остатки.

import type { Ctx } from '../lib/context.ts';
import { badRequest, notFound, readJson } from '../lib/http.ts';
import { fromDb, type Kopecks, parseMoney, toDb } from '../lib/money.ts';
import type { Route } from '../lib/route.ts';
import {
  type AccountType,
  clampedInt,
  nameMaps,
  requireAccount,
  requireCashOrBank,
  TX_FIELDS,
  txDTO,
  type TxRow,
  type TxType,
} from '../lib/shared.ts';

/** Служебная категория быстрого списания: создаётся при первом обращении к POST /loss. */
const LOSS_CATEGORY = 'Убыток';

// Значения перечислений базы. Нужны, чтобы мусор из query не доходил до Postgres:
// неизвестное значение enum там даёт ошибку запроса, а приложение ждёт пустой список.
const TX_TYPES: readonly TxType[] = [
  'income',
  'expense',
  'transfer_to_investment',
  'transfer_between_accounts',
  'credit_payment',
  'asset_revaluation',
];
const ACCOUNT_TYPES: readonly AccountType[] = [
  'cash',
  'bank',
  'investment',
  'other_asset',
  'credit',
  'credit_buffer',
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Клиент базы работает без сгенерированных типов и не выводит форму строки из
// перечисления полей. Приведение собрано в двух функциях, чтобы не рассыпать его по файлу.
const asTxRow = (data: unknown): TxRow => data as TxRow;
const asTxRows = (data: unknown): TxRow[] => (data ?? []) as TxRow[];

// ── разбор входа ────────────────────────────────────────────────────────────

const str = (body: Record<string, unknown>, key: string): string | null =>
  typeof body[key] === 'string' ? (body[key] as string) : null;

/** Сумма операции: ноль и отрицательные не проводим — так же, как в приложении. */
function positiveAmount(raw: unknown): Kopecks {
  const amount = parseMoney(raw);
  if (amount === null || amount <= 0) throw badRequest('Invalid amount');
  return amount;
}

/** Границы периода из query. Обе необязательны: [from, to), сравнение по дате операции. */
function dateParam(url: URL, key: string): string | null {
  const raw = url.searchParams.get(key);
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw badRequest('Invalid date');
  return d.toISOString();
}

// ── проверки справочников ──────────────────────────────────────────────────

/**
 * Категория расхода по id. Категория дохода с точки зрения расхода не существует,
 * поэтому несовпадение типа — тоже «не найдено», как в приложении.
 */
async function requireExpenseCategory(ctx: Ctx, id: string): Promise<void> {
  if (!UUID.test(id)) throw notFound('Category not found');
  const { data, error } = await ctx.db
    .from('categories')
    .select('id')
    .eq('id', id)
    .eq('type', 'expense')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw notFound('Category not found');
}

async function requireSource(ctx: Ctx, id: string): Promise<void> {
  if (!UUID.test(id)) throw notFound('Source not found');
  const { data, error } = await ctx.db.from('income_sources').select('id').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw notFound('Source not found');
}

/** Привязка расхода: вложения считаются только по технике и прочему имуществу. */
async function requireAsset(ctx: Ctx, id: string): Promise<void> {
  if (!UUID.test(id)) throw notFound('Asset not found');
  const asset = await requireAccount(ctx, id, 'Asset not found');
  if (asset.type !== 'investment' && asset.type !== 'other_asset') {
    throw badRequest('Можно привязать только к технике/активу');
  }
}

/** Операция пользователя по id. Чужие строки отсекает RLS, поэтому пусто = «нет такой». */
async function requireTx(ctx: Ctx, id: string): Promise<TxRow> {
  if (!UUID.test(id)) throw notFound('Transaction not found');
  const { data, error } = await ctx.db.from('transactions').select(TX_FIELDS).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw notFound('Transaction not found');
  return asTxRow(data);
}

// ── запись операции ────────────────────────────────────────────────────────

/** Параметры post_transaction: имена с префиксом p_, суммы — строкой numeric. */
interface PostArgs {
  p_type: TxType;
  p_amount: string;
  p_date: string;
  p_category_id?: string | null;
  p_income_source_id?: string | null;
  p_from_account_id?: string | null;
  p_to_account_id?: string | null;
  p_linked_asset_id?: string | null;
  p_comment?: string | null;
  p_client_tx_id?: string | null;
}

/** Создать операцию и провести её по остаткам. Возвращает id — новой или уже существующей. */
async function postTransaction(ctx: Ctx, args: PostArgs): Promise<string> {
  const { data, error } = await ctx.db.rpc('post_transaction', args);
  if (error) throw new Error(error.message);
  return data as string;
}

// ── пересчёт остатков при правке и удалении ────────────────────────────────

type Deltas = Map<string, Kopecks>;

/**
 * Как операция двигает остатки: со счёта-источника сумма уходит, на счёт-получатель
 * приходит. sign = 1 — проводка, sign = -1 — её откат.
 *
 * Платёж по кредиту и переоценку не трогаем: их остатки ведут свои обработчики.
 * Правка не меняет ни тип операции, ни тело платежа, поэтому откат и повторная
 * проводка такой операции дали бы нулевую разницу.
 */
function applyEffects(deltas: Deltas, tx: TxRow, sign: 1 | -1): void {
  const amount = fromDb(tx.amount) * sign;
  const add = (id: string | null, delta: Kopecks) => {
    if (!id || delta === 0) return;
    deltas.set(id, (deltas.get(id) ?? 0) + delta);
  };
  switch (tx.type) {
    case 'income':
      add(tx.to_account_id, amount);
      break;
    case 'expense':
      add(tx.from_account_id, -amount);
      break;
    case 'transfer_to_investment':
    case 'transfer_between_accounts':
      add(tx.from_account_id, -amount);
      add(tx.to_account_id, amount);
      break;
    default:
      break;
  }
}

/**
 * Сдвинуть остатки счётов на накопленные дельты. История остатков только растёт:
 * на каждый счёт дописывается новая точка «текущий остаток + дельта», а не правится
 * старая, — иначе график капитала задним числом менял бы форму.
 */
async function shiftBalances(ctx: Ctx, deltas: Deltas, date: string): Promise<void> {
  for (const [accountId, delta] of deltas) {
    if (delta === 0) continue;
    // Сдвиг делает функция базы: она блокирует счёт на время чтения и записи.
    // Прочитать остаток здесь и записать отдельным запросом нельзя — параллельный
    // запрос успел бы вклиниться между ними, и одно из изменений потерялось бы.
    const { error } = await ctx.db.rpc('bump_balance', {
      p_account_id: accountId,
      p_delta: toDb(delta),
      p_date: date,
    });
    if (error) throw new Error(error.message);
  }
}

/** Категория «Убыток»: ищем свою, при отсутствии создаём — пользователь её не заводит руками. */
async function lossCategoryId(ctx: Ctx): Promise<string> {
  const find = () =>
    ctx.db.from('categories').select('id').eq('type', 'expense').eq('name', LOSS_CATEGORY).maybeSingle();

  const found = await find();
  if (found.error) throw new Error(found.error.message);
  if (found.data) return found.data.id as string;

  const created = await ctx.db
    .from('categories')
    .insert({ user_id: ctx.userId, name: LOSS_CATEGORY, type: 'expense', order: 99, emoji: '🔻' })
    .select('id')
    .maybeSingle();
  if (created.data) return created.data.id as string;

  // Параллельный запрос мог создать категорию первым: уникальность (user_id, name, type)
  // не даст дубль, поэтому читаем его строку, а не отвечаем ошибкой.
  const retry = await find();
  if (retry.data) return retry.data.id as string;
  throw new Error(created.error?.message ?? `Не удалось создать категорию «${LOSS_CATEGORY}»`);
}

export const routes: Route[] = [
  // Список операций: лента на главной, история счёта и выгрузки за период.
  {
    method: 'GET',
    path: '/transactions',
    handler: async (ctx) => {
      const limit = clampedInt(ctx.url.searchParams.get('limit'), 20, 1, 500);
      const from = dateParam(ctx.url, 'from');
      const to = dateParam(ctx.url, 'to');
      const type = ctx.url.searchParams.get('type');
      const accountId = ctx.url.searchParams.get('accountId');
      const accountType = ctx.url.searchParams.get('accountType');

      if (type && !TX_TYPES.includes(type as TxType)) return [];

      let q = ctx.db.from('transactions').select(TX_FIELDS);
      if (from) q = q.gte('date', from);
      if (to) q = q.lt('date', to);
      if (type) q = q.eq('type', type);

      if (accountId) {
        // Счёт подходит и как источник, и как получатель: в истории счёта нужны обе стороны.
        // Значение подставляется в текст фильтра, поэтому пускаем только настоящий uuid.
        if (!UUID.test(accountId)) return [];
        q = q.or(`from_account_id.eq.${accountId},to_account_id.eq.${accountId}`);
      } else if (accountType) {
        if (!ACCOUNT_TYPES.includes(accountType as AccountType)) return [];
        const accs = await ctx.db.from('accounts').select('id').eq('type', accountType);
        if (accs.error) throw new Error(accs.error.message);
        const ids = ((accs.data ?? []) as { id: string }[]).map((a) => a.id);
        if (!ids.length) return [];
        q = q.or(`from_account_id.in.(${ids.join(',')}),to_account_id.in.(${ids.join(',')})`);
      }

      const [rows, names] = await Promise.all([
        q.order('date', { ascending: false }).limit(limit),
        nameMaps(ctx),
      ]);
      if (rows.error) throw new Error(rows.error.message);
      return asTxRows(rows.data).map((r) => txDTO(r, names));
    },
  },

  // Создание операции. Три формы в одном эндпоинте: так их видит приложение —
  // расход, доход и перевод приходят с одного экрана ввода.
  {
    method: 'POST',
    path: '/transactions',
    handler: async (ctx) => {
      const body = await readJson(ctx.req);
      // Сумму проверяем раньше типа: при пустой форме пользователю важнее узнать про сумму.
      const amount = positiveAmount(body.amount);
      const type = str(body, 'type');
      const base = {
        p_amount: toDb(amount),
        // Дата операции — момент записи: экран ввода даты не предлагает.
        p_date: new Date().toISOString(),
        p_comment: str(body, 'comment'),
        p_client_tx_id: str(body, 'clientTxId'),
      };

      if (type === 'expense') {
        const categoryId = str(body, 'categoryId');
        if (!categoryId) throw badRequest('categoryId required');
        await requireExpenseCategory(ctx, categoryId);

        // Счёт списания необязателен: расход можно записать и «мимо счетов».
        const fromAccountId = str(body, 'fromAccountId');
        if (fromAccountId) await requireCashOrBank(ctx, fromAccountId);

        const linkedAssetId = str(body, 'linkedAssetId');
        if (linkedAssetId) await requireAsset(ctx, linkedAssetId);

        const id = await postTransaction(ctx, {
          ...base,
          p_type: 'expense',
          p_category_id: categoryId,
          p_from_account_id: fromAccountId,
          p_linked_asset_id: linkedAssetId,
        });
        return { ok: true, id };
      }

      if (type === 'income') {
        const incomeSourceId = str(body, 'incomeSourceId');
        if (!incomeSourceId) throw badRequest('incomeSourceId required');
        await requireSource(ctx, incomeSourceId);

        const toAccountId = str(body, 'toAccountId');
        if (toAccountId) await requireCashOrBank(ctx, toAccountId);

        const id = await postTransaction(ctx, {
          ...base,
          p_type: 'income',
          p_income_source_id: incomeSourceId,
          p_to_account_id: toAccountId,
        });
        return { ok: true, id };
      }

      if (type === 'transfer_to_investment' || type === 'transfer_between_accounts') {
        const fromAccountId = str(body, 'fromAccountId');
        const toAccountId = str(body, 'toAccountId');
        if (!fromAccountId || !toAccountId) throw badRequest('fromAccountId and toAccountId required');
        if (fromAccountId === toAccountId) throw badRequest('Source and destination must differ');

        await requireAccount(ctx, fromAccountId);
        const dest = await requireAccount(ctx, toAccountId);
        // Разделение двух переводов — не формальность: вложения попадают в итог месяца
        // как инвестиции, а перекладывание между своими счетами там быть не должно.
        if (type === 'transfer_to_investment' && dest.type !== 'investment') {
          throw badRequest('transfer_to_investment requires destination of type investment');
        }
        if (type === 'transfer_between_accounts' && dest.type === 'investment') {
          throw badRequest('Use transfer_to_investment for transfers to investment accounts');
        }

        const id = await postTransaction(ctx, {
          ...base,
          p_type: type,
          p_from_account_id: fromAccountId,
          p_to_account_id: toAccountId,
        });
        return { ok: true, id };
      }

      throw badRequest('Invalid type');
    },
  },

  // Правка операции. Меняются только те поля, которые есть в теле; остальное
  // остаётся прежним. Категория имеет смысл у расхода, источник и счёт зачисления —
  // у дохода, поэтому чужие для типа поля молча пропускаются, как в приложении.
  {
    method: 'PATCH',
    path: '/transactions/:id',
    handler: async (ctx) => {
      const tx = await requireTx(ctx, ctx.params.id);
      const body = await readJson(ctx.req);

      // next — операция после правки: по ней считается новая проводка.
      const next: TxRow = { ...tx };
      const patch: Record<string, unknown> = {};

      if (body.amount !== undefined) {
        const amount = toDb(positiveAmount(body.amount));
        patch.amount = amount;
        next.amount = amount;
      }
      if ('comment' in body) {
        const comment = (str(body, 'comment') ?? '').trim();
        patch.comment = comment || null;
      }
      if (tx.type === 'expense' && typeof body.categoryId === 'string') {
        await requireExpenseCategory(ctx, body.categoryId);
        patch.category_id = body.categoryId;
      }
      if (tx.type === 'income' && typeof body.incomeSourceId === 'string') {
        await requireSource(ctx, body.incomeSourceId);
        patch.income_source_id = body.incomeSourceId;
      }
      if (tx.type === 'income' && 'toAccountId' in body) {
        // Нестроковое значение (в том числе null) означает «отвязать от счёта».
        const toAccountId = str(body, 'toAccountId');
        if (toAccountId) await requireCashOrBank(ctx, toAccountId);
        patch.to_account_id = toAccountId;
        next.to_account_id = toAccountId;
      }

      // Сначала правим саму операцию, потом остатки: ограничения базы сработают
      // на первом шаге, и неудачная правка не оставит сдвинутых остатков.
      if (Object.keys(patch).length) {
        const { error } = await ctx.db.from('transactions').update(patch).eq('id', tx.id);
        if (error) throw new Error(error.message);
      }

      const deltas: Deltas = new Map();
      applyEffects(deltas, tx, -1);
      applyEffects(deltas, next, 1);
      await shiftBalances(ctx, deltas, new Date().toISOString());

      return { ok: true };
    },
  },

  // Удаление операции: сначала откат проводки, потом удаление строки.
  // Порядок важен: по удалённой операции дельту уже не посчитать.
  {
    method: 'DELETE',
    path: '/transactions/:id',
    handler: async (ctx) => {
      const tx = await requireTx(ctx, ctx.params.id);

      const deltas: Deltas = new Map();
      applyEffects(deltas, tx, -1);
      await shiftBalances(ctx, deltas, new Date().toISOString());

      const { error } = await ctx.db.from('transactions').delete().eq('id', tx.id);
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  },

  // Быстрое списание убытка: пропажа, порча, недостача. Это обычный расход,
  // но категорию выбирать не нужно — приложение вызывает один эндпоинт с суммой и счётом.
  {
    method: 'POST',
    path: '/loss',
    handler: async (ctx) => {
      const body = await readJson(ctx.req);
      const amount = positiveAmount(body.amount);
      const fromAccountId = str(body, 'fromAccountId');
      if (!fromAccountId) throw badRequest('fromAccountId required');
      await requireCashOrBank(ctx, fromAccountId);

      const categoryId = await lossCategoryId(ctx);
      const id = await postTransaction(ctx, {
        p_type: 'expense',
        p_amount: toDb(amount),
        p_date: new Date().toISOString(),
        p_category_id: categoryId,
        p_from_account_id: fromAccountId,
        p_comment: str(body, 'comment'),
        p_client_tx_id: str(body, 'clientTxId'),
      });
      return { ok: true, id, categoryId };
    },
  },
];

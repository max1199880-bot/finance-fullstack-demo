// Активы и кредиты. Самый тонкий домен приложения: здесь деньги меняют не только
// остаток счёта, но и остаток долга, себестоимость партий и классификацию имущества.
//
// Три правила, из которых вырос весь файл:
//   1. Остаток — последняя по дате запись в account_balances. Две записи на один счёт
//      с одинаковой датой читаются в непредсказуемом порядке (account_balance сортирует
//      по date desc, id desc, а id — случайный uuid). Поэтому второй сдвиг того же счёта
//      в рамках одного запроса всегда идёт на миллисекунду позже.
//   2. post_transaction двигает остатки сам. Значит через него проходят только те
//      операции, у которых движение денег совпадает с правилом «со счёта-источника
//      списали, на счёт-получатель начислили».
//   3. Тексты ошибок — часть контракта: экраны показывают их пользователю как есть.

import type { Ctx } from '../lib/context.ts';
import { badRequest, conflict, HttpError, notFound, readJson } from '../lib/http.ts';
import { fromDb, type Kopecks, parseMoney, rub, toDb } from '../lib/money.ts';
import type { Route } from '../lib/route.ts';
import {
  ACCOUNT_FIELDS,
  type AccountRow,
  balancesOf,
  byNameRu,
  requireAccount,
  TX_FIELDS,
  type TxRow,
  type TxType,
} from '../lib/shared.ts';

type Body = Record<string, unknown>;

// ── разбор тела запроса ─────────────────────────────────────────────────────

function str(b: Body, key: string): string | undefined {
  const v = b[key];
  return typeof v === 'string' ? v : undefined;
}

const trimmed = (b: Body, key: string): string => (str(b, key) ?? '').trim();

/** Положительная сумма: ноль и минус — ошибка клиента, как в действующем приложении. */
function amountOf(b: Body, key = 'amount'): Kopecks | null {
  const v = parseMoney(b[key]);
  return v !== null && v > 0 ? v : null;
}

const commentOf = (b: Body): string | null => {
  const c = str(b, 'comment')?.trim();
  return c ? c : null;
};

/** Целое количество единиц. Для покупки мусор значит «одна штука», для партий — ошибка ввода. */
function quantityOf(b: Body, key = 'quantity', fallback = 1): number {
  const v = b[key];
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : fallback;
}

const clientTxIdOf = (b: Body): string | null => str(b, 'clientTxId') ?? null;

/** Дата операции: клиент может проводить задним числом; мусор — ошибка, а не 500. */
function dateOf(b: Body, now: Date): Date {
  const raw = str(b, 'date');
  if (!raw) return now;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw badRequest('Invalid date');
  return d;
}

/** Дата-строка для колонки типа date: берём локальные части, чтобы день не «уехал». */
const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Сдвиг на миллисекунду — см. правило 1 в шапке файла. */
const justAfter = (d: Date): Date => new Date(d.getTime() + 1);

// ── работа с базой ──────────────────────────────────────────────────────────

interface PostTx {
  type: TxType;
  amount: Kopecks;
  date: Date;
  categoryId?: string | null;
  incomeSourceId?: string | null;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  linkedAssetId?: string | null;
  comment?: string | null;
  clientTxId?: string | null;
}

/**
 * Единая точка записи операции: сама операция и остатки двух счётов меняются
 * одной транзакцией базы. Повтор с тем же clientTxId возвращает прежний id и
 * ничего не пишет — двойное нажатие не создаёт дубль.
 */
async function post(ctx: Ctx, t: PostTx): Promise<string> {
  const { data, error } = await ctx.db.rpc('post_transaction', {
    p_type: t.type,
    p_amount: toDb(t.amount),
    p_date: t.date.toISOString(),
    p_category_id: t.categoryId ?? null,
    p_income_source_id: t.incomeSourceId ?? null,
    p_from_account_id: t.fromAccountId ?? null,
    p_to_account_id: t.toAccountId ?? null,
    p_linked_asset_id: t.linkedAssetId ?? null,
    p_principal_part: null,
    p_interest_part: null,
    p_comment: t.comment ?? null,
    p_client_tx_id: t.clientTxId ?? null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

async function balanceOf(ctx: Ctx, accountId: string): Promise<Kopecks> {
  const { data, error } = await ctx.db.rpc('account_balance', { p_account_id: accountId });
  if (error) throw new Error(error.message);
  return fromDb(data);
}

/** Сдвинуть остаток на delta: база сама посчитает новую точку истории. */
async function bump(ctx: Ctx, accountId: string, delta: Kopecks, date: Date): Promise<void> {
  if (delta === 0) return;
  const { error } = await ctx.db.rpc('bump_balance', {
    p_account_id: accountId,
    p_delta: toDb(delta),
    p_date: date.toISOString(),
  });
  if (error) throw new Error(error.message);
}

/** Выставить остаток в конкретное значение (переоценка, закрытие актива). */
async function setBalance(ctx: Ctx, accountId: string, value: Kopecks, date: Date): Promise<void> {
  const { error } = await ctx.db
    .from('account_balances')
    .insert({ account_id: accountId, date: date.toISOString(), balance: toDb(value) });
  if (error) throw new Error(error.message);
}

/**
 * Уже записанная операция этого запроса. Нужна там, где мы пишем операцию не через
 * post_transaction: повтор запроса не должен второй раз двигать остатки.
 */
async function existingTx(ctx: Ctx, clientTxId: string | null): Promise<TxRow | null> {
  if (!clientTxId) return null;
  const { data, error } = await ctx.db
    .from('transactions')
    .select(TX_FIELDS)
    .eq('client_tx_id', clientTxId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as TxRow | null;
}

/**
 * Имя счёта занято? Сравниваем без учёта регистра, как действующее приложение:
 * «Квартира» и «квартира» для пользователя — один и тот же объект. Счётов у человека
 * десятки, поэтому дешевле забрать имена, чем экранировать шаблон для ilike.
 */
async function nameTaken(ctx: Ctx, name: string): Promise<boolean> {
  const { data, error } = await ctx.db.from('accounts').select('name');
  if (error) throw new Error(error.message);
  const lower = name.toLowerCase();
  return ((data ?? []) as { name: string }[]).some((r) => r.name.toLowerCase() === lower);
}

/** Источник дохода по имени, с созданием: у старых аккаунтов «Прочее» может не быть. */
async function ensureIncomeSource(ctx: Ctx, name: string): Promise<string> {
  const found = await ctx.db.from('income_sources').select('id').eq('name', name).maybeSingle();
  if (found.error) throw new Error(found.error.message);
  if (found.data) return String(found.data.id);
  const { data, error } = await ctx.db
    .from('income_sources')
    .insert({ user_id: ctx.userId, name })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return String(data.id);
}

/** Категория расхода по имени, с созданием. Порядок 99 — в конец списка. */
async function ensureExpenseCategory(ctx: Ctx, name: string): Promise<string> {
  const found = await ctx.db
    .from('categories')
    .select('id')
    .eq('name', name)
    .eq('type', 'expense')
    .maybeSingle();
  if (found.error) throw new Error(found.error.message);
  if (found.data) return String(found.data.id);
  const { data, error } = await ctx.db
    .from('categories')
    .insert({ user_id: ctx.userId, name, type: 'expense', order: 99 })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return String(data.id);
}

// ── кредитная математика (перенос из src/demo/ledger.ts) ────────────────────

/** Полных месяцев от даты старта; если день месяца ещё не наступил — минус один. */
function monthsElapsed(start: Date, now: Date): number {
  let m = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) m -= 1;
  return Math.max(0, m);
}

/**
 * Аннуитетный платёж с округлением до копейки. При нулевой ставке делим долг на
 * число месяцев: формула аннуитета там даёт деление на ноль.
 */
function annuity(principal: Kopecks, ratePercent: number, months: number): Kopecks {
  if (months <= 0 || principal <= 0) return 0;
  const r = ratePercent / 12 / 100;
  if (r === 0) return Math.round(principal / months);
  return Math.round((principal * r) / (1 - Math.pow(1 + r, -months)));
}

/** Ближайшая будущая дата платежа: этот месяц, а если день прошёл или сегодня — следующий. */
function nextDueDate(paymentDay: number | null, now: Date): string | null {
  if (!paymentDay) return null;
  let d = new Date(now.getFullYear(), now.getMonth(), paymentDay);
  if (d.getTime() <= new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
    d = new Date(now.getFullYear(), now.getMonth() + 1, paymentDay);
  }
  return d.toISOString();
}

/**
 * Кредит для экрана «Кредиты». Платёж пересчитывается от ТЕКУЩЕГО долга и остатка
 * срока, а не берётся из первоначального графика: после досрочного погашения
 * старый платёж уже не соответствует долгу.
 */
function creditDTO(row: AccountRow, principal: Kopecks, now: Date) {
  const start = row.credit_start_date ? new Date(row.credit_start_date) : now;
  const termMonths = row.credit_term_months ?? 0;
  const rate = Number(row.credit_rate ?? 0);
  const months = Math.max(0, termMonths - monthsElapsed(start, now));
  return {
    id: row.id,
    name: row.name,
    currentPrincipal: rub(principal),
    originalAmount: rub(fromDb(row.credit_original_amount)),
    // Ставка уходит строкой, но без хвостовых нулей numeric(7,4): "12.5", не "12.5000".
    rate: String(rate),
    termMonths,
    remainingMonths: months,
    scheduledPayment: rub(annuity(principal, rate, months)),
    nextDueDate: nextDueDate(row.credit_payment_day, now),
    startDate: start.toISOString(),
    paymentDay: row.credit_payment_day,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Счёт по id. Идентификатор, не похожий на uuid, база отвергла бы ошибкой типа,
 * то есть пятисоткой. Для экрана это обычное «не найдено», поэтому проверяем форму сами.
 */
async function accountById(ctx: Ctx, id: string | undefined, message: string): Promise<AccountRow> {
  if (!id || !UUID_RE.test(id)) throw notFound(message);
  return await requireAccount(ctx, id, message);
}

/** Кредит по id. Активы и обычные счёта сюда не подходят — для экрана это «нет такого». */
async function requireCredit(ctx: Ctx, id: string): Promise<AccountRow> {
  const row = await accountById(ctx, id, 'Credit not found');
  if (row.type !== 'credit') throw notFound('Credit not found');
  return row;
}

// ── активы ──────────────────────────────────────────────────────────────────

interface LotRow {
  id: string;
  quantity: number;
  remaining_quantity: number;
  unit_cost: string;
  purchased_at: string;
}

const LOT_FIELDS = 'id, quantity, remaining_quantity, unit_cost, purchased_at';

/** Партии актива старейшими вперёд: в этом же порядке их списывает продажа (FIFO). */
async function lotsOf(ctx: Ctx, assetId: string): Promise<LotRow[]> {
  const { data, error } = await ctx.db
    .from('asset_lots')
    .select(LOT_FIELDS)
    .eq('account_id', assetId)
    .order('purchased_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as LotRow[];
}

const remainingUnits = (lots: LotRow[]): number => lots.reduce((acc, l) => acc + l.remaining_quantity, 0);

/** Себестоимость нераспроданного остатка: сколько денег ещё «лежит» в партиях. */
const remainingCost = (lots: LotRow[]): Kopecks =>
  lots.reduce((acc, l) => acc + l.remaining_quantity * fromDb(l.unit_cost), 0);

/** Тип проводки покупки: вложение видно в итогах месяца, прочее имущество — нет. */
const purchaseTxType = (assetType: AccountRow['type']): TxType =>
  assetType === 'investment' ? 'transfer_to_investment' : 'transfer_between_accounts';

/** Счёт-источник покупки. Тексты ошибок здесь в нижнем регистре — так их ждёт экран. */
async function requirePurchaseSource(ctx: Ctx, id: string | undefined): Promise<AccountRow> {
  const acc = await accountById(ctx, id, 'source account not found');
  if (acc.type !== 'cash' && acc.type !== 'bank') throw badRequest('source account must be cash or bank');
  return acc;
}

/** Счёт-получатель продажи. */
async function requireDestination(ctx: Ctx, id: string | undefined): Promise<AccountRow> {
  const acc = await accountById(ctx, id, 'Destination account not found');
  if (acc.type !== 'cash' && acc.type !== 'bank') throw badRequest('Destination must be cash or bank');
  return acc;
}

/**
 * Прибыль с продажи — отдельная операция дохода в источник «Прочее».
 * Два замечания, оба про идемпотентность и порядок:
 *   • ключ clientTxId сюда не передаём — по нему post_transaction нашёл бы основную
 *     операцию запроса и вернул её id вместо создания дохода;
 *   • дата на миллисекунду позже перевода: счёт-получатель получает вторую запись
 *     истории, и с одинаковой датой итоговый остаток читался бы случайно (правило 1).
 */
async function bookProfit(ctx: Ctx, assetName: string, toAccountId: string, profit: Kopecks, date: Date) {
  const sourceId = await ensureIncomeSource(ctx, 'Прочее');
  return await post(ctx, {
    type: 'income',
    amount: profit,
    date: justAfter(date),
    incomeSourceId: sourceId,
    toAccountId,
    comment: `Прибыль с продажи: ${assetName}`,
  });
}

/** Закрыть распроданный актив: он уходит с экрана капитала и не участвует в Net Worth. */
async function closeAsset(ctx: Ctx, assetId: string): Promise<void> {
  const { error } = await ctx.db.from('accounts').update({ is_active: false }).eq('id', assetId);
  if (error) throw new Error(error.message);
}

export const routes: Route[] = [
  // ── Кредиты ───────────────────────────────────────────────────────────────

  {
    method: 'GET',
    path: '/credits',
    handler: async (ctx) => {
      const now = new Date();
      const { data, error } = await ctx.db
        .from('accounts')
        .select(ACCOUNT_FIELDS)
        .eq('type', 'credit')
        .eq('is_active', true);
      if (error) throw new Error(error.message);
      // Список колонок собран конкатенацией, поэтому его форму выводим сами.
      const rows = (data ?? []) as unknown as AccountRow[];
      // Остатки долга — одним запросом на все кредиты, иначе N запросов на экран.
      const balances = await balancesOf(ctx, rows.map((r) => r.id));
      return rows
        .map((r) => creditDTO(r, balances.get(r.id) ?? 0, now))
        .sort(byNameRu);
    },
  },

  // Пересчёт после досрочного платежа: экран показывает новый платёж до перезагрузки списка.
  {
    method: 'GET',
    path: '/credits/:id/recalc',
    handler: async (ctx) => {
      const row = await requireCredit(ctx, ctx.params.id);
      const dto = creditDTO(row, await balanceOf(ctx, row.id), new Date());
      return {
        remainingPrincipal: dto.currentPrincipal,
        remainingMonths: dto.remainingMonths,
        newMonthlyPayment: dto.scheduledPayment,
      };
    },
  },

  {
    method: 'POST',
    path: '/credits',
    handler: async (ctx) => {
      const body = await readJson(ctx.req);
      const now = new Date();

      const name = trimmed(body, 'name');
      if (!name) throw badRequest('name required');
      const originalAmount = amountOf(body, 'originalAmount');
      if (originalAmount === null) throw badRequest('invalid originalAmount');
      // Ставку вводят руками, поэтому запятая вместо точки — норма, а не ошибка.
      const rate = Number(String(body.rate ?? '').replace(',', '.'));
      if (!Number.isFinite(rate)) throw badRequest('invalid rate');
      if (rate < 0) throw badRequest('rate must be >= 0');
      const termMonths = Number(body.termMonths);
      if (!Number.isInteger(termMonths) || termMonths <= 0) {
        throw badRequest('termMonths must be a positive number');
      }
      const startDate = typeof body.startDate === 'string' ? new Date(body.startDate) : now;
      if (Number.isNaN(startDate.getTime())) throw badRequest('invalid startDate');
      if (await nameTaken(ctx, name)) throw conflict('Аккаунт с таким именем уже существует');
      // День платежа ограничен 28-м: 29–31 есть не в каждом месяце.
      const day = Number(body.paymentDay);
      const paymentDay = Number.isInteger(day) && day >= 1 && day <= 28 ? day : null;

      const { data, error } = await ctx.db
        .from('accounts')
        .insert({
          user_id: ctx.userId,
          name,
          type: 'credit',
          credit_rate: String(rate),
          credit_term_months: termMonths,
          credit_original_amount: toDb(originalAmount),
          credit_start_date: ymd(startDate),
          credit_payment_day: paymentDay,
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);

      // Первый снимок долга на дату выдачи: остаток кредита — это баланс его счёта.
      await setBalance(ctx, String(data.id), originalAmount, startDate);
      return { ok: true, id: String(data.id) };
    },
  },

  {
    method: 'POST',
    path: '/credits/:id/pay',
    handler: async (ctx) => {
      const body = await readJson(ctx.req);
      const credit = await requireCredit(ctx, ctx.params.id);

      const amount = amountOf(body);
      if (amount === null) throw badRequest('invalid amount');
      const fromAccountId = str(body, 'fromAccountId');
      if (!fromAccountId) throw badRequest('fromAccountId required');
      const categoryId = str(body, 'categoryId');
      if (!categoryId) throw badRequest('categoryId required');
      // Пропавшая категория и пропавший счёт — ошибки ввода на экране платежа, поэтому
      // 400, а не 404: экран подсвечивает поле, а не показывает «не найдено».
      if (!UUID_RE.test(categoryId)) throw badRequest('Category not found');
      const category = await ctx.db.from('categories').select('id').eq('id', categoryId).maybeSingle();
      if (category.error) throw new Error(category.error.message);
      if (!category.data) throw badRequest('Category not found');
      if (!UUID_RE.test(fromAccountId)) throw badRequest('Source account not found');
      const from = await requireAccount(ctx, fromAccountId, 'Source account not found').catch((e: unknown) => {
        if (e instanceof HttpError && e.status === 404) throw badRequest('Source account not found');
        throw e;
      });
      if (from.type !== 'cash' && from.type !== 'bank') throw badRequest('Source must be cash or bank');

      const date = dateOf(body, new Date());
      const clientTxId = clientTxIdOf(body);
      const debt = await balanceOf(ctx, credit.id);

      // Раскладку считает база: проценты за месяц от текущего долга, остальное — тело.
      const split = await ctx.db.rpc('split_credit_payment', {
        p_account_id: credit.id,
        p_amount: toDb(amount),
      });
      if (split.error) throw new Error(split.error.message);
      const splitRow = (split.data ?? [])[0] as { principal_part: string; interest_part: string } | undefined;
      const principal = Math.max(0, fromDb(splitRow?.principal_part ?? 0));
      // В строку операции идут части, сумма которых равна платежу: это проверяет
      // ограничение credit_parts_sum. Переплата поэтому лежит внутри interest_part.
      const interestPart = amount - principal;

      // Пользователю же показываем переплату отдельно: проценты за месяц — это одно,
      // а деньги сверх долга — другое.
      const monthlyInterest = debt > 0
        ? Math.min(amount, Math.round((debt * Number(credit.credit_rate ?? 0)) / 12 / 100))
        : 0;
      const overpayment = amount - principal - monthlyInterest;

      const comment = commentOf(body) ?? `Платёж по кредиту: ${credit.name}`;
      const already = await existingTx(ctx, clientTxId);
      let transactionId: string;
      if (already) {
        transactionId = already.id;
      } else {
        // Почему не через post_transaction: для типа 'expense' он начисляет сумму на
        // счёт-получатель, то есть УВЕЛИЧИЛ бы долг на весь платёж. А тип менять нельзя —
        // платёж по кредиту должен попадать в расходы месяца и в план/факт категории.
        // Поэтому строку пишем сами, а остатки двигаем двумя точными сдвигами.
        const ins = await ctx.db
          .from('transactions')
          .insert({
            user_id: ctx.userId,
            date: date.toISOString(),
            amount: toDb(amount),
            type: 'expense',
            category_id: categoryId,
            from_account_id: from.id,
            to_account_id: credit.id,
            principal_part: toDb(principal),
            interest_part: toDb(interestPart),
            comment,
            client_tx_id: clientTxId,
          })
          .select('id')
          .single();
        if (ins.error) throw new Error(ins.error.message);
        transactionId = String(ins.data.id);
        // Со счёта ушёл весь платёж, долг уменьшился только на тело: проценты — плата банку.
        await bump(ctx, from.id, -amount, date);
        await bump(ctx, credit.id, -principal, date);
      }

      return {
        ok: true,
        transactionId,
        executedAmount: rub(amount),
        interest: rub(monthlyInterest),
        principal: rub(principal),
        overpayment: rub(overpayment),
        newPrincipal: rub(await balanceOf(ctx, credit.id)),
      };
    },
  },

  // ── Активы ────────────────────────────────────────────────────────────────

  {
    method: 'POST',
    path: '/assets/purchase',
    handler: async (ctx) => {
      const body = await readJson(ctx.req);
      const now = new Date();

      const name = trimmed(body, 'name');
      if (!name) throw badRequest('name required');
      const assetType = str(body, 'assetType');
      if (assetType !== 'investment' && assetType !== 'other_asset') {
        throw badRequest('assetType must be investment or other_asset');
      }
      const unit = amountOf(body);
      if (unit === null) throw badRequest('invalid amount');
      const qty = quantityOf(body);
      const from = await requirePurchaseSource(ctx, str(body, 'fromAccountId'));
      if (await nameTaken(ctx, name)) throw conflict('Аккаунт с таким именем уже существует');

      const created = await ctx.db
        .from('accounts')
        .insert({
          user_id: ctx.userId,
          name,
          type: assetType,
          // Цена покупки за единицу: по ней считается прибыль и «вложено» в карточке актива.
          purchase_price: toDb(unit),
          liability: false,
        })
        .select('id')
        .single();
      if (created.error) throw new Error(created.error.message);
      const accountId = String(created.data.id);

      const total = unit * qty;
      const comment = commentOf(body) ??
        (qty > 1 ? `Покупка: ${name} (${qty} шт × ${rub(unit)})` : `Покупка: ${name}`);
      const transactionId = await post(ctx, {
        type: purchaseTxType(assetType),
        amount: total,
        date: now,
        fromAccountId: from.id,
        toAccountId: accountId,
        comment,
        clientTxId: clientTxIdOf(body),
      });

      // Покупка больше одной единицы — позиция на перепродажу: партия нужна, чтобы
      // продажа части списывала себестоимость по FIFO, а не «в среднем».
      if (qty > 1) {
        const { error } = await ctx.db.from('asset_lots').insert({
          account_id: accountId,
          quantity: qty,
          remaining_quantity: qty,
          unit_cost: toDb(unit),
          purchased_at: now.toISOString(),
        });
        if (error) throw new Error(error.message);
      }

      return {
        ok: true,
        accountId,
        transactionId,
        newSourceBalance: rub(await balanceOf(ctx, from.id)),
      };
    },
  },

  {
    method: 'POST',
    path: '/assets/:id/restock',
    handler: async (ctx) => {
      const body = await readJson(ctx.req);
      const now = new Date();
      const asset = await accountById(ctx, ctx.params.id, 'Asset not found');

      const quantity = quantityOf(body, 'quantity', 0);
      if (quantity <= 0) throw badRequest('invalid quantity');
      const unitPrice = amountOf(body, 'unitPrice');
      if (unitPrice === null) throw badRequest('invalid unitPrice');
      const from = await requirePurchaseSource(ctx, str(body, 'fromAccountId'));

      // Докупать можно только позицию на перепродажу: у обычного актива партий нет,
      // и «количество» для него не определено.
      const lots = await lotsOf(ctx, asset.id);
      if (!lots.length) throw badRequest('Not a lot-based resale position');

      const total = quantity * unitPrice;
      const transactionId = await post(ctx, {
        type: purchaseTxType(asset.type),
        amount: total,
        date: now,
        fromAccountId: from.id,
        toAccountId: asset.id,
        comment: `Докупка: ${asset.name} (${quantity} шт × ${rub(unitPrice)})`,
        clientTxId: clientTxIdOf(body),
      });

      // Новая партия идёт в конец очереди FIFO: своя цена, своя дата.
      const { error } = await ctx.db.from('asset_lots').insert({
        account_id: asset.id,
        quantity,
        remaining_quantity: quantity,
        unit_cost: toDb(unitPrice),
        purchased_at: now.toISOString(),
      });
      if (error) throw new Error(error.message);

      return {
        ok: true,
        transactionId,
        newQuantity: remainingUnits(lots) + quantity,
        newCostBasis: rub(remainingCost(lots) + total),
      };
    },
  },

  {
    method: 'POST',
    path: '/assets/:id/sell-units',
    handler: async (ctx) => {
      const body = await readJson(ctx.req);
      const now = new Date();
      const asset = await accountById(ctx, ctx.params.id, 'Asset not found');

      const lots = await lotsOf(ctx, asset.id);
      if (!lots.length) throw badRequest('Not a lot-based resale position');
      const available = remainingUnits(lots);
      const quantity = quantityOf(body, 'quantity', 0);
      if (quantity <= 0 || quantity > available) throw badRequest('invalid quantity');

      const to = await requireDestination(ctx, str(body, 'toAccountId'));
      const saleAmount = amountOf(body, 'saleAmount');
      if (saleAmount === null) throw badRequest('Invalid sale price');

      // FIFO: сначала уходят самые старые единицы. Так себестоимость проданного
      // соответствует реально потраченным деньгам, а не средней цене по складу.
      let need = quantity;
      let costBasis = 0;
      const taken: { id: string; remaining: number }[] = [];
      for (const lot of lots) {
        if (need <= 0) break;
        const take = Math.min(lot.remaining_quantity, need);
        if (take <= 0) continue;
        costBasis += take * fromDb(lot.unit_cost);
        taken.push({ id: lot.id, remaining: lot.remaining_quantity - take });
        need -= take;
      }
      for (const t of taken) {
        const { error } = await ctx.db
          .from('asset_lots')
          .update({ remaining_quantity: t.remaining })
          .eq('id', t.id);
        if (error) throw new Error(error.message);
      }

      // С актива уходит только себестоимость: прибыль на нём никогда не лежала.
      const transferTransactionId = await post(ctx, {
        type: 'transfer_between_accounts',
        amount: Math.min(costBasis, saleAmount),
        date: now,
        fromAccountId: asset.id,
        toAccountId: to.id,
        comment: `Продажа: ${asset.name} (${quantity} шт)`,
        clientTxId: clientTxIdOf(body),
      });

      const profit = saleAmount - costBasis;
      const incomeTransactionId = profit > 0
        ? await bookProfit(ctx, asset.name, to.id, profit, now)
        : null;

      const remainingQuantity = available - quantity;
      const closed = remainingQuantity === 0;
      if (closed) {
        // Единиц не осталось: остаток актива обнуляем на миллисекунду позже перевода,
        // иначе две записи истории с одной датой читаются в случайном порядке.
        await setBalance(ctx, asset.id, 0, justAfter(now));
        await closeAsset(ctx, asset.id);
      }

      return {
        ok: true,
        transferTransactionId,
        incomeTransactionId,
        quantity,
        saleAmount: rub(saleAmount),
        costBasis: rub(costBasis),
        profit: rub(profit),
        remainingQuantity,
        closed,
      };
    },
  },

  {
    method: 'POST',
    path: '/assets/:id/sell',
    handler: async (ctx) => {
      const body = await readJson(ctx.req);
      const now = new Date();
      const asset = await accountById(ctx, ctx.params.id, 'Asset not found');
      if (!asset.is_active) throw conflict('Актив уже продан');
      if (asset.type !== 'investment' && asset.type !== 'other_asset') {
        throw badRequest('Only investments and other assets can be sold');
      }
      const to = await requireDestination(ctx, str(body, 'toAccountId'));
      const salePrice = amountOf(body, 'salePrice');
      if (salePrice === null) throw badRequest('Invalid sale price');

      // Себестоимость — текущая стоимость актива: именно столько денег в нём лежит.
      const cost = await balanceOf(ctx, asset.id);
      const transferTransactionId = await post(ctx, {
        type: 'transfer_between_accounts',
        amount: Math.min(cost, salePrice),
        date: now,
        fromAccountId: asset.id,
        toAccountId: to.id,
        comment: `Продажа: ${asset.name}`,
        clientTxId: clientTxIdOf(body),
      });
      // Актив закрыт: остаток обнуляем целиком. Если продали дешевле себестоимости,
      // разница — убыток, а не «остаток имущества». Миллисекунда позже перевода нужна,
      // чтобы последняя запись истории читалась однозначно (правило 1).
      await setBalance(ctx, asset.id, 0, justAfter(now));

      const profit = salePrice - cost;
      const incomeTransactionId = profit > 0
        ? await bookProfit(ctx, asset.name, to.id, profit, now)
        : null;
      await closeAsset(ctx, asset.id);

      return {
        ok: true,
        transferTransactionId,
        incomeTransactionId,
        cost: rub(cost),
        salePrice: rub(salePrice),
        profit: rub(profit),
      };
    },
  },

  {
    method: 'POST',
    path: '/assets/:id/prepayment',
    handler: async (ctx) => {
      const body = await readJson(ctx.req);
      const now = new Date();
      const asset = await accountById(ctx, ctx.params.id, 'Asset not found');
      const to = await requireDestination(ctx, str(body, 'toAccountId'));
      const amount = amountOf(body);
      if (amount === null) throw badRequest('invalid amount');

      const rest = await balanceOf(ctx, asset.id);
      // Телом считаем только то, что реально было в активе; остальное — прибыль.
      const principal = Math.min(amount, rest);
      const fullySold = rest - principal <= 0;

      const transferTransactionId = await post(ctx, {
        type: 'transfer_between_accounts',
        amount: principal,
        date: now,
        fromAccountId: asset.id,
        toAccountId: to.id,
        comment: `${fullySold ? 'Продажа' : 'Предоплата'}: ${asset.name}`,
        clientTxId: clientTxIdOf(body),
      });

      const profit = amount - principal;
      if (profit > 0) {
        // Превышение зачисляем корректировкой остатка, без операции дохода: по предоплате
        // прибыль ещё не зафиксирована, и в итогах месяца её быть не должно.
        // Отсюда и incomeTransactionId: null в ответе.
        await bump(ctx, to.id, profit, justAfter(now));
      }
      if (fullySold) await closeAsset(ctx, asset.id);

      return {
        ok: true,
        transferTransactionId,
        incomeTransactionId: null,
        received: rub(amount),
        principal: rub(principal),
        profit: rub(profit),
        newAssetBalance: rub(await balanceOf(ctx, asset.id)),
        fullySold,
      };
    },
  },

  {
    method: 'POST',
    path: '/assets/:id/revalue',
    handler: async (ctx) => {
      const body = await readJson(ctx.req);
      const now = new Date();
      const asset = await accountById(ctx, ctx.params.id, 'Asset not found');
      if (!asset.is_active) throw conflict('Актив закрыт');

      const next = parseMoney(body.newValue);
      if (next === null) throw badRequest('invalid newValue');
      if (next < 0) throw badRequest('Стоимость не может быть отрицательной');

      const clientTxId = clientTxIdOf(body);
      const already = await existingTx(ctx, clientTxId);
      if (already) {
        // Повтор запроса: переоценка уже применена, восстанавливаем ответ по записи.
        const delta = already.to_account_id ? fromDb(already.amount) : -fromDb(already.amount);
        const current = await balanceOf(ctx, asset.id);
        return {
          ok: true,
          revalTransactionId: already.id,
          previousValue: rub(current - delta),
          newValue: rub(current),
          delta: rub(delta),
          direction: delta > 0 ? 'gain' : 'loss',
        };
      }

      const previous = await balanceOf(ctx, asset.id);
      if (next === previous) throw badRequest('Стоимость не изменилась');
      const gain = next > previous;

      // Переоценка не двигает деньги: стоимость квартиры выросла — с банковского счёта
      // ничего не ушло. post_transaction здесь не подходит, он сдвинул бы остаток актива
      // ещё раз, уже поверх нового значения. Поэтому строку пишем сами, а остаток
      // выставляем ровно в новое значение.
      const ins = await ctx.db
        .from('transactions')
        .insert({
          user_id: ctx.userId,
          date: now.toISOString(),
          amount: toDb(Math.abs(next - previous)),
          type: 'asset_revaluation',
          from_account_id: gain ? null : asset.id,
          to_account_id: gain ? asset.id : null,
          comment: commentOf(body) ?? `Переоценка: ${asset.name}`,
          client_tx_id: clientTxId,
        })
        .select('id')
        .single();
      if (ins.error) throw new Error(ins.error.message);
      await setBalance(ctx, asset.id, next, now);

      return {
        ok: true,
        revalTransactionId: String(ins.data.id),
        previousValue: rub(previous),
        newValue: rub(next),
        delta: rub(next - previous),
        direction: gain ? 'gain' : 'loss',
      };
    },
  },

  // Карточка «вложено в объект»: покупка плюс все расходы, привязанные к активу.
  // По ней видно, отбил ли объект вложения (marginNow).
  {
    method: 'GET',
    path: '/assets/:id/investments',
    handler: async (ctx) => {
      const asset = await accountById(ctx, ctx.params.id, 'Asset not found');
      const [txs, current] = await Promise.all([
        ctx.db
          .from('transactions')
          .select(TX_FIELDS)
          .eq('type', 'expense')
          .eq('linked_asset_id', asset.id)
          .order('date', { ascending: false }),
        balanceOf(ctx, asset.id),
      ]);
      if (txs.error) throw new Error(txs.error.message);
      const items = (txs.data ?? []) as unknown as TxRow[];

      // Имена категорий одним запросом: иначе на каждую строку свой запрос.
      const categoryIds = [...new Set(items.map((t) => t.category_id).filter((id): id is string => !!id))];
      const names = new Map<string, string>();
      if (categoryIds.length) {
        const cats = await ctx.db.from('categories').select('id, name').in('id', categoryIds);
        if (cats.error) throw new Error(cats.error.message);
        for (const c of (cats.data ?? []) as { id: string; name: string }[]) names.set(c.id, c.name);
      }

      // Цена покупки известна не всегда (актив могли завести вручную) — тогда за базу
      // берём текущую стоимость: иначе вложения выглядели бы как чистый убыток.
      const purchase = asset.purchase_price != null ? fromDb(asset.purchase_price) : current;
      const invested = items.reduce((acc, t) => acc + fromDb(t.amount), 0);
      return {
        assetId: asset.id,
        name: asset.name,
        liability: asset.liability,
        purchase: rub(purchase),
        invested: rub(invested),
        total: rub(purchase + invested),
        currentValue: rub(current),
        marginNow: rub(current - (purchase + invested)),
        items: items.map((t) => ({
          id: t.id,
          date: new Date(t.date).toISOString(),
          amount: rub(fromDb(t.amount)),
          category: t.category_id ? names.get(t.category_id) ?? null : null,
          comment: t.comment,
        })),
      };
    },
  },

  // Классификация по Кийосаки: актив работает на тебя, пассив требует трат.
  {
    method: 'PATCH',
    path: '/assets/:id/classification',
    handler: async (ctx) => {
      const body = await readJson(ctx.req);
      const now = new Date();
      const asset = await accountById(ctx, ctx.params.id, 'Asset not found');
      const liability = body.liability === true;

      let purchaseExpenseId: string | null = null;
      if (liability && !asset.liability) {
        // Переход актив → пассив: вещь перестаёт быть вложением, её стоимость
        // становится разовым расходом. Деньги при этом не двигаются — они ушли
        // ещё при покупке, поэтому операция без счётов, только с категорией.
        const categoryId = await ensureExpenseCategory(ctx, 'Покупки');
        const amount = asset.purchase_price != null
          ? fromDb(asset.purchase_price)
          : await balanceOf(ctx, asset.id);
        purchaseExpenseId = await post(ctx, {
          type: 'expense',
          amount,
          date: now,
          categoryId,
          linkedAssetId: asset.id,
          comment: `Покупка (пассив): ${asset.name}`,
        });
        // Стоимость пассива в капитал не входит: иначе расход и остаток считались бы дважды.
        await setBalance(ctx, asset.id, 0, now);
      }

      const { error } = await ctx.db.from('accounts').update({ liability }).eq('id', asset.id);
      if (error) throw new Error(error.message);
      return { ok: true, liability, purchaseExpenseId };
    },
  },
];

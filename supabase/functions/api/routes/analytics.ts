// Аналитика: сводка периода, разрезы по категориям и источникам, дневной ряд,
// история капитала и проданные активы.
//
// Главное правило домена: за период делается ОДИН запрос, а группировка идёт
// в памяти. Запрос на каждый день или на каждую неделю превращает один экран
// в десятки обращений к базе, а ряды здесь короткие — максимум операции
// пользователя за период.

import type { Ctx } from '../lib/context.ts';
import { fixed2, fromDb, type Kopecks, rub } from '../lib/money.ts';
import type { Route } from '../lib/route.ts';
import {
  ACCOUNT_FIELDS,
  type AccountRow,
  type AccountType,
  clampedInt,
  dateRange,
  sumAmounts,
  type TxType,
} from '../lib/shared.ts';

const DAY_MS = 24 * 3600 * 1000;

/**
 * PostgREST отдаёт не больше max_rows строк за запрос (в config.toml — 1000).
 * Аналитика складывает суммы сама, поэтому обрезанный ответ дал бы молча
 * неверные числа. Читаем страницами до короткой страницы; порядок задаёт
 * вызывающий, иначе строки на стыке страниц могут повториться или пропасть.
 */
interface Pageable<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
}

async function selectAll<T>(make: () => Pageable<T>, page = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0;; offset += page) {
    const { data, error } = await make().range(offset, offset + page - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < page) return out;
  }
}

// ── строки базы, которые нужны этому домену ─────────────────────────────────

interface PeriodTxRow {
  date: string;
  amount: string;
  type: TxType;
  to_account_id: string | null;
}
const PERIOD_TX_FIELDS = 'date, amount, type, to_account_id';

interface GroupedTxRow {
  amount: string;
  category_id: string | null;
  income_source_id: string | null;
}
const GROUPED_TX_FIELDS = 'amount, category_id, income_source_id';

interface BalanceRow {
  account_id: string;
  date: string;
  balance: string;
}

/** Остатки указанных счетов целиком, в порядке возрастания даты: по ним считаются точки истории. */
function balanceRows(ctx: Ctx, accountIds: string[]): Promise<BalanceRow[]> {
  return selectAll<BalanceRow>(() =>
    ctx.db
      .from('account_balances')
      .select('account_id, date, balance')
      .in('account_id', accountIds)
      .order('date', { ascending: true })
      .order('id', { ascending: true })
  );
}

/** Операции полуинтервала [from, to). Порядок по id — для постраничного чтения. */
function periodTx(ctx: Ctx, from: Date, to: Date): Promise<PeriodTxRow[]> {
  return selectAll<PeriodTxRow>(() =>
    ctx.db
      .from('transactions')
      .select(PERIOD_TX_FIELDS)
      .gte('date', from.toISOString())
      .lt('date', to.toISOString())
      .order('id', { ascending: true })
  );
}

// ── сводка периода ──────────────────────────────────────────────────────────

/**
 * Переоценки со знаком: рост стоимости приложение пишет активом в to_account_id,
 * падение — активом в from_account_id. Сумма amount без знака обнулила бы разрезы.
 */
function revaluationOf(rows: PeriodTxRow[]): Kopecks {
  return rows
    .filter((r) => r.type === 'asset_revaluation')
    .reduce((acc, r) => acc + (r.to_account_id ? fromDb(r.amount) : -fromDb(r.amount)), 0);
}

function totalsIn(rows: PeriodTxRow[]) {
  const by = (type: TxType) => sumAmounts(rows.filter((r) => r.type === type));
  return {
    income: rub(by('income')),
    expense: rub(by('expense')),
    investment: rub(by('transfer_to_investment')),
    // Это поле приложение ждёт всегда с двумя знаками, в отличие от остальных сумм.
    revaluation: fixed2(revaluationOf(rows)),
    txCount: rows.length,
  };
}

// ── разрезы с долями ────────────────────────────────────────────────────────

/** Сгруппированные суммы в элементы ответа: имя из справочника, доля, срез по limit. */
function shareItems(
  idField: 'categoryId' | 'sourceId',
  groups: Map<string, Kopecks>,
  names: Map<string, string>,
  unknownName: string,
  total: Kopecks,
  limit: number,
) {
  return [...groups.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, amount]) => ({
      [idField]: id,
      name: names.get(id) ?? unknownName,
      amount: rub(amount),
      // share — проценты 0..100 с одним знаком, а не доля 0..1: так их рисует приложение.
      share: total > 0 ? Math.round((amount / total) * 1000) / 10 : 0,
    }));
}

/** Справочник id → имя одним запросом: без него пришлось бы спрашивать имя на каждую группу. */
async function nameMap(ctx: Ctx, table: 'categories' | 'income_sources'): Promise<Map<string, string>> {
  const rows = await selectAll<{ id: string; name: string }>(() =>
    ctx.db.from(table).select('id, name').order('id', { ascending: true })
  );
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * Число из query с границами. Напрямую clampedInt здесь не годится: для
 * отсутствующего и пустого параметра Number(null) и Number('') дают 0, и вместо
 * значения по умолчанию получился бы min (limit = 1 вместо 20). Поэтому пустое
 * значение подменяем на значение по умолчанию до разбора.
 */
function intParam(ctx: Ctx, name: string, def: number, min: number, max: number): number {
  const raw = ctx.url.searchParams.get(name);
  return clampedInt(raw && raw.trim() ? raw : String(def), def, min, max);
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Календарный день в зоне сервера: ряд строится по локальным датам, как на экране. */
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const ACCOUNT_TYPES = new Set<string>(
  ['cash', 'bank', 'investment', 'other_asset', 'credit', 'credit_buffer'] satisfies AccountType[],
);

/** Переводы: продажа актива уходит деньгами со счёта-актива на счёт получателя. */
const TRANSFER_TYPES: TxType[] = ['transfer_between_accounts', 'transfer_to_investment'];

export const routes: Route[] = [
  // Сводка за период и равный период перед ним — для стрелок «больше/меньше» на экране.
  {
    method: 'GET',
    path: '/analytics/summary',
    handler: async (ctx) => {
      const { from, to } = dateRange(ctx.url);
      const length = to.getTime() - from.getTime();
      const previousFrom = new Date(from.getTime() - length);
      // Предыдущий период лежит вплотную перед from, поэтому оба периода — это
      // один непрерывный отрезок [previousFrom, to). Берём его одним запросом
      // и делим ряд по границе from в памяти.
      const rows = await periodTx(ctx, previousFrom, to);
      const fromMs = from.getTime();
      const isCurrent = (r: PeriodTxRow) => new Date(r.date).getTime() >= fromMs;
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        current: totalsIn(rows.filter(isCurrent)),
        previous: totalsIn(rows.filter((r) => !isCurrent(r))),
      };
    },
  },

  // Расходы по категориям: куда ушли деньги за период.
  {
    method: 'GET',
    path: '/analytics/by-category',
    handler: async (ctx) => {
      const { from, to } = dateRange(ctx.url);
      const limit = intParam(ctx, 'limit', 20, 1, 50);
      const [rows, names] = await Promise.all([
        selectAll<GroupedTxRow>(() =>
          ctx.db
            .from('transactions')
            .select(GROUPED_TX_FIELDS)
            .eq('type', 'expense')
            .gte('date', from.toISOString())
            .lt('date', to.toISOString())
            .order('id', { ascending: true })
        ),
        nameMap(ctx, 'categories'),
      ]);
      const total = sumAmounts(rows);
      const groups = new Map<string, Kopecks>();
      for (const r of rows) {
        // Расход без категории попадает в total, но своей строки не получает:
        // группировать нечего, а приложение показывает такой остаток как разницу.
        if (!r.category_id) continue;
        groups.set(r.category_id, (groups.get(r.category_id) ?? 0) + fromDb(r.amount));
      }
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        total: rub(total),
        items: shareItems('categoryId', groups, names, 'Без категории', total, limit),
      };
    },
  },

  // Доходы по источникам. В отличие от расходов, доход без источника — отдельная
  // строка «Неизвестный источник»: приложение показывает её в том же списке.
  {
    method: 'GET',
    path: '/analytics/by-income-source',
    handler: async (ctx) => {
      const { from, to } = dateRange(ctx.url);
      const limit = intParam(ctx, 'limit', 20, 1, 50);
      const [rows, names] = await Promise.all([
        selectAll<GroupedTxRow>(() =>
          ctx.db
            .from('transactions')
            .select(GROUPED_TX_FIELDS)
            .eq('type', 'income')
            .gte('date', from.toISOString())
            .lt('date', to.toISOString())
            .order('id', { ascending: true })
        ),
        nameMap(ctx, 'income_sources'),
      ]);
      const total = sumAmounts(rows);
      const groups = new Map<string, Kopecks>();
      for (const r of rows) {
        const key = r.income_source_id ?? '';
        groups.set(key, (groups.get(key) ?? 0) + fromDb(r.amount));
      }
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        total: rub(total),
        items: shareItems('sourceId', groups, names, 'Неизвестный источник', total, limit),
      };
    },
  },

  // Дневной ряд для графика. Ряд плотный: день без операций тоже строка, иначе
  // график сжимает пропуски и врёт про темп трат.
  {
    method: 'GET',
    path: '/analytics/daily',
    handler: async (ctx) => {
      const { from, to } = dateRange(ctx.url);
      const rows = await periodTx(ctx, from, to);

      const acc = new Map<string, { income: Kopecks; expense: Kopecks; investment: Kopecks }>();
      for (const r of rows) {
        const key = localDay(new Date(r.date));
        const day = acc.get(key) ?? { income: 0, expense: 0, investment: 0 };
        const amount = fromDb(r.amount);
        if (r.type === 'income') day.income += amount;
        else if (r.type === 'expense') day.expense += amount;
        else if (r.type === 'transfer_to_investment') day.investment += amount;
        acc.set(key, day);
      }

      // Формат сумм повторяет ответ действующего сервера: текст SUM(...) с двумя
      // знаками, а ноль — короткая строка «0».
      const amount = (k: Kopecks) => (k === 0 ? '0' : fixed2(k));
      const days = [];
      for (
        let d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
        d < to;
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
      ) {
        const day = acc.get(localDay(d)) ?? { income: 0, expense: 0, investment: 0 };
        days.push({
          day: localDay(d),
          income: amount(day.income),
          expense: amount(day.expense),
          investment: amount(day.investment),
        });
      }
      return { from: from.toISOString(), to: to.toISOString(), days };
    },
  },

  // История капитала по неделям. Здесь считаются ВСЕ счета, включая скрытые, —
  // экран «Капитал» берёт только активные, а график должен показывать историю
  // целиком, иначе закрытый счёт задним числом меняет прошлое.
  {
    method: 'GET',
    path: '/analytics/networth-history',
    handler: async (ctx) => {
      const now = new Date();
      const weeks = intParam(ctx, 'weeks', 26, 4, 156);
      const type = ctx.url.searchParams.get('type');
      // Неизвестный тип счёта — пустая история, а не ошибка: enum в базе такого
      // значения не знает и запрос упал бы пятисоткой.
      if (type && !ACCOUNT_TYPES.has(type)) return { weeks: [], totalNow: '0' };

      const accounts = await selectAll<{ id: string; type: AccountType }>(() => {
        // Запрос собирается заново на каждую страницу: один и тот же построитель
        // накапливал бы фильтры между вызовами.
        const q = ctx.db.from('accounts').select('id, type').order('id', { ascending: true });
        return type ? q.eq('type', type) : q;
      });
      if (!accounts.length) return { weeks: [], totalNow: '0' };

      // balanceAt спрашивает базу про один счёт на одну дату: для графика это
      // weeks × accounts запросов (до 156 × N). Вместо этого берём всю историю
      // остатков один раз и идём по ней одним проходом — ряд уже отсортирован
      // по дате, а точки графика тоже растут, поэтому возврат назад не нужен.
      const rows = await balanceRows(ctx, accounts.map((a) => a.id));
      const creditIds = new Set(accounts.filter((a) => a.type === 'credit').map((a) => a.id));
      const balance = new Map<string, Kopecks>();
      let total = 0;
      let i = 0;
      const apply = (row: BalanceRow) => {
        // Долг вычитается из капитала, остальные типы прибавляются.
        const sign = creditIds.has(row.account_id) ? -1 : 1;
        const next = fromDb(row.balance);
        total += sign * (next - (balance.get(row.account_id) ?? 0));
        balance.set(row.account_id, next);
      };

      const points = [];
      for (let w = weeks - 1; w >= 0; w--) {
        const weekEnd = new Date(now.getTime() - w * 7 * DAY_MS);
        while (i < rows.length && new Date(rows[i].date).getTime() <= weekEnd.getTime()) apply(rows[i++]);
        points.push({ weekEnd: weekEnd.toISOString(), total: rub(total) });
      }
      // Остаток ряда — записи с датой позже последней точки: totalNow показывает
      // самые свежие остатки, как их видит экран «Капитал».
      while (i < rows.length) apply(rows[i++]);

      return { weeks: points, totalNow: rub(total) };
    },
  },

  // Карточка «Куплено и продано»: закрытые активы и результат по ним.
  {
    method: 'GET',
    path: '/analytics/sold-assets',
    handler: async (ctx) => {
      // Проданный актив — это закрытый счёт имущества: продажа снимает is_active.
      const accounts = await selectAll<AccountRow & { created_at: string }>(() =>
        ctx.db
          .from('accounts')
          .select(`${ACCOUNT_FIELDS}, created_at`)
          .in('type', ['investment', 'other_asset'])
          .eq('is_active', false)
          .order('id', { ascending: true })
      );
      if (!accounts.length) return { items: [] };

      const ids = accounts.map((a) => a.id);
      const [balances, sales] = await Promise.all([
        balanceRows(ctx, ids),
        // Продажа — перевод, где актив был источником денег.
        selectAll<{ date: string; amount: string; from_account_id: string | null }>(() =>
          ctx.db
            .from('transactions')
            .select('date, amount, from_account_id')
            .in('from_account_id', ids)
            .in('type', TRANSFER_TYPES)
            .order('id', { ascending: true })
        ),
      ]);

      // Первая запись истории — постановка на учёт, последняя — остаток после продажи.
      const firstSeen = new Map<string, string>();
      const lastBalance = new Map<string, Kopecks>();
      for (const row of balances) {
        if (!firstSeen.has(row.account_id)) firstSeen.set(row.account_id, row.date);
        lastBalance.set(row.account_id, fromDb(row.balance));
      }

      // Продаж может быть несколько (предоплаты): берём последнюю по дате.
      const lastSale = new Map<string, { date: string; amount: string }>();
      for (const s of sales) {
        if (!s.from_account_id) continue;
        const kept = lastSale.get(s.from_account_id);
        if (!kept || new Date(s.date).getTime() >= new Date(kept.date).getTime()) {
          lastSale.set(s.from_account_id, { date: s.date, amount: s.amount });
        }
      }

      const items = [];
      for (const a of accounts) {
        const sale = lastSale.get(a.id);
        // Без операции продажи считать нечего: счёт просто закрыли вручную.
        if (!sale) continue;
        const purchasePrice = fromDb(a.purchase_price);
        const salePrice = fromDb(sale.amount);
        items.push({
          id: a.id,
          name: a.name,
          type: a.type as 'investment' | 'other_asset',
          // Эмодзи есть у категорий и источников, у счетов такого поля нет.
          emoji: null,
          purchaseDate: new Date(firstSeen.get(a.id) ?? a.created_at).toISOString(),
          purchasePrice: rub(purchasePrice),
          saleDate: new Date(sale.date).toISOString(),
          salePrice: rub(salePrice),
          pnl: rub(salePrice - purchasePrice),
          // Остался ненулевой остаток — продали часть, результат ещё не итоговый.
          partial: (lastBalance.get(a.id) ?? 0) !== 0,
        });
      }
      return { items };
    },
  },
];

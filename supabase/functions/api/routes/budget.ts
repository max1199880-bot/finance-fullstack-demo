// Бюджет: план/факт по расходным категориям месяца и правка планов —
// по категории, с переносом на будущие месяцы и глобальные планы месяца.

import { monthTotals } from '../lib/aggregates.ts';
import type { Ctx } from '../lib/context.ts';
import { badRequest, notFound, readJson } from '../lib/http.ts';
import { fromDb, type Kopecks, parseMoney, rub, toDb } from '../lib/money.ts';
import { addMonths, monthRange, resolveMonth } from '../lib/period.ts';
import type { Route } from '../lib/route.ts';
import { planFact, sumAmounts } from '../lib/shared.ts';

// Порядок строк на экране: сначала то, где уже перерасход. Ключ — строка, потому что
// planFact отдаёт status как string; у незнакомого значения вес был бы undefined,
// поэтому ниже берём его через statusWeight.
const STATUS_ORDER: Record<string, number> = { over: 0, warning: 1, ok: 2, no_plan: 3 };
const statusWeight = (status: string): number => STATUS_ORDER[status] ?? 9;

/** Имена колонок глобального плана: клиент присылает camelCase, база хранит snake_case. */
const GLOBAL_COLUMNS = {
  plannedTotalExpenses: 'planned_total_expenses',
  plannedTotalIncome: 'planned_total_income',
  plannedInvestments: 'planned_investments',
} as const;

// id категории проверяем шаблоном до запроса: на строке, не похожей на uuid, Postgres
// отвечает ошибкой типа (это стало бы 500), а приложение ждёт обычную «не найдено».
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PlanRow {
  category_id: string;
  planned_amount: string;
}

interface ExpenseRow {
  amount: string;
  category_id: string | null;
}

/** Месяц запроса: сначала query, потом тело; мусор и пропуск — текущий месяц пользователя. */
async function monthOf(ctx: Ctx, body: Record<string, unknown> = {}): Promise<string> {
  const { month_start_day } = await ctx.profile();
  return resolveMonth(ctx.url.searchParams.get('month') ?? body.month, month_start_day);
}

/** Сумма плана: число не меньше нуля. Ноль законен — он снимает план с категории. */
function planAmount(v: unknown): Kopecks {
  const k = parseMoney(v);
  if (k === null || k < 0) throw badRequest('Invalid amount');
  return k;
}

/** Категория пользователя по id. RLS отсекает чужие строки, пустой ответ значит «нет такой». */
async function requireCategory(ctx: Ctx, id: unknown): Promise<string> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw notFound('Category not found');
  const { data, error } = await ctx.db.from('categories').select('id').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw notFound('Category not found');
  return id;
}

/**
 * Записать один и тот же план категории на перечисленные месяцы.
 * Ноль означает «плана нет», и строка удаляется: нулевая строка дала бы статус no_plan,
 * но при переносе считалась бы заполненным месяцем и блокировала onlyEmpty.
 */
async function savePlans(ctx: Ctx, months: string[], categoryId: string, amount: Kopecks): Promise<void> {
  if (!months.length) return;
  if (amount === 0) {
    const { error } = await ctx.db
      .from('budget_plan_month')
      .delete()
      .eq('category_id', categoryId)
      .in('month', months);
    if (error) throw new Error(error.message);
    return;
  }
  // user_id указываем явно: политика RLS на вставке сверяет его с владельцем сессии.
  const rows = months.map((month) => ({
    user_id: ctx.userId,
    month,
    category_id: categoryId,
    planned_amount: toDb(amount),
  }));
  const { error } = await ctx.db
    .from('budget_plan_month')
    .upsert(rows, { onConflict: 'user_id,month,category_id' });
  if (error) throw new Error(error.message);
}

async function budgetDTO(ctx: Ctx) {
  const month = await monthOf(ctx);
  const { month_start_day } = await ctx.profile();
  const { from, to } = monthRange(month, month_start_day);

  const [cats, plans, tx, totals] = await Promise.all([
    ctx.db.from('categories').select('id, name').eq('type', 'expense').eq('is_active', true),
    ctx.db.from('budget_plan_month').select('category_id, planned_amount').eq('month', month),
    ctx.db.from('transactions').select('amount, category_id').eq('type', 'expense')
      .gte('date', from.toISOString()).lt('date', to.toISOString()),
    // Планы месяца и суммы по доходам с инвестициями считает общая сводка —
    // чтобы бюджет и главная не разошлись в цифрах.
    monthTotals(ctx, month),
  ]);
  if (cats.error) throw new Error(cats.error.message);
  if (plans.error) throw new Error(plans.error.message);
  if (tx.error) throw new Error(tx.error.message);

  const planned = new Map<string, Kopecks>(
    ((plans.data ?? []) as PlanRow[]).map((p) => [p.category_id, fromDb(p.planned_amount)]),
  );
  const expenses = (tx.data ?? []) as ExpenseRow[];

  const rows = ((cats.data ?? []) as { id: string; name: string }[])
    .map((c) => {
      const actual = sumAmounts(expenses.filter((t) => t.category_id === c.id));
      return { categoryId: c.id, name: c.name, actual, pf: planFact(planned.get(c.id) ?? 0, actual) };
    })
    .sort((a, b) => statusWeight(a.pf.status) - statusWeight(b.pf.status) || b.actual - a.actual);

  // Осознанное расхождение со сводкой месяца: здесь факт итога — сумма показанных строк,
  // то есть только активные категории. В сводке тот же расход берётся целиком, включая
  // операции скрытых категорий. Иначе итог на экране не сходился бы со списком под ним.
  const activeActual = rows.reduce((acc, r) => acc + r.actual, 0);

  return {
    month,
    categories: rows.map((r) => ({ categoryId: r.categoryId, name: r.name, ...r.pf })),
    total: planFact(totals.plannedExpenses, activeActual),
    totalIncome: rub(totals.income),
    plannedIncome: totals.plannedIncome ? rub(totals.plannedIncome) : null,
    totalInvestments: rub(totals.investments),
    plannedInvestments: totals.plannedInvestments ? rub(totals.plannedInvestments) : null,
  };
}

export const routes: Route[] = [
  { method: 'GET', path: '/budget', handler: budgetDTO },

  {
    method: 'PUT',
    path: '/budget/category',
    handler: async (ctx) => {
      const body = await readJson(ctx.req);
      const month = await monthOf(ctx, body);
      // Сумму проверяем раньше категории: так клиент получает ту же ошибку,
      // что и в действующем приложении, когда неверны оба поля.
      const amount = planAmount(body.amount);
      const categoryId = await requireCategory(ctx, body.categoryId);
      await savePlans(ctx, [month], categoryId, amount);
      return { ok: true };
    },
  },

  // Перенос плана вперёд: пользователь задаёт сумму один раз на год, а не двенадцать раз.
  {
    method: 'PUT',
    path: '/budget/category/propagate',
    handler: async (ctx) => {
      const body = await readJson(ctx.req);
      const start = await monthOf(ctx, body);
      const amount = planAmount(body.amount);
      const categoryId = await requireCategory(ctx, body.categoryId);

      // Горизонт ограничен тремя годами: дальше планы всё равно не живут,
      // а запрос перестаёт быть дешёвым.
      const extra = typeof body.propagateMonths === 'number' && Number.isFinite(body.propagateMonths)
        ? Math.min(36, Math.max(0, Math.trunc(body.propagateMonths)))
        : 11;
      const onlyEmpty = body.onlyEmpty !== false;
      const months = Array.from({ length: extra + 1 }, (_, i) => addMonths(start, i));

      // Занятые месяцы узнаём одним запросом, а не запросом на месяц.
      const { data, error } = await ctx.db
        .from('budget_plan_month')
        .select('month')
        .eq('category_id', categoryId)
        .in('month', months);
      if (error) throw new Error(error.message);
      const taken = new Set(((data ?? []) as { month: string }[]).map((r) => r.month));

      // Стартовый месяц перезаписывается всегда: его пользователь правит прямо сейчас.
      // Дальше при onlyEmpty уже заполненные месяцы не трогаем — там свои решения.
      const target = months.filter((m, i) => i === 0 || !onlyEmpty || !taken.has(m));
      await savePlans(ctx, target, categoryId, amount);

      // Снятие плана (amount = 0) тоже считается записью: для клиента месяц обработан.
      return {
        ok: true,
        written: target.length,
        skipped: months.length - target.length,
        months: months.length,
      };
    },
  },

  {
    method: 'PUT',
    path: '/budget/global',
    handler: async (ctx) => {
      const body = await readJson(ctx.req);
      const month = await monthOf(ctx, body);

      const patch: Record<string, string> = {};
      for (const [key, column] of Object.entries(GLOBAL_COLUMNS)) {
        if (body[key] === undefined) continue;
        const k = parseMoney(body[key]);
        // Здесь ноль запрещён в отличие от плана категории: глобальный план снимают
        // не нулём, а отдельной правкой, и ноль почти всегда означает опечатку.
        if (k === null || k <= 0) throw badRequest(`Invalid ${key}`);
        patch[column] = toDb(k);
      }

      // Правим поля по отдельности: в строке месяца три независимых плана,
      // и запись одного не должна стирать два других.
      const existing = await ctx.db
        .from('budget_plan_global')
        .select('id')
        .eq('month', month)
        .maybeSingle();
      if (existing.error) throw new Error(existing.error.message);

      if (existing.data) {
        if (Object.keys(patch).length) {
          const { error } = await ctx.db
            .from('budget_plan_global')
            .update(patch)
            .eq('id', existing.data.id);
          if (error) throw new Error(error.message);
        }
      } else {
        const { error } = await ctx.db
          .from('budget_plan_global')
          .insert({ user_id: ctx.userId, month, ...patch });
        if (error) throw new Error(error.message);
      }
      return { ok: true };
    },
  },
];

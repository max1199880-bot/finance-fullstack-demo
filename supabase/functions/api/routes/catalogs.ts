// Справочники: категории расходов/доходов и источники дохода.
//
// Два правила этого домена, из-за которых здесь больше кода, чем кажется нужным:
//   • Удаление мягкое. Если на справочник ссылаются операции, строку нельзя убрать —
//     иначе из истории пропадёт название. Такую строку скрываем (is_active = false),
//     а «удалить навсегда» — отдельный путь /purge, который сносит и операции.
//   • Категорий расходов должно быть от 6 до 12. Границы держат экран бюджета
//     читаемым: меньше шести — не на что делить траты, больше двенадцати — список
//     не влезает в один экран.
// Сортировки считаются в коде, а не в SQL: порядок букв русского алфавита зависит
// от collation базы, а приложение ждёт правила localeCompare('ru').

import type { Ctx } from '../lib/context.ts';
import { badRequest, conflict, notFound, readJson } from '../lib/http.ts';
import type { Route } from '../lib/route.ts';
import { byNameRu } from '../lib/shared.ts';

type CategoryType = 'expense' | 'income';

interface CategoryRow {
  id: string;
  name: string;
  type: CategoryType;
  is_active: boolean;
  order: number;
  emoji: string | null;
}

interface SourceRow {
  id: string;
  name: string;
  is_active: boolean;
  emoji: string | null;
}

const CATEGORY_FIELDS = 'id, name, type, is_active, order, emoji';
const SOURCE_FIELDS = 'id, name, is_active, emoji';

const MAX_ACTIVE_EXPENSE = 12;
const MIN_ACTIVE_EXPENSE = 6;

/** Столбец операции, которым она ссылается на справочник. */
type TxLink = 'category_id' | 'income_source_id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Всё, кроме явного 'income', приложение считает расходом — так же и в клиенте. */
const categoryType = (raw: unknown): CategoryType => (raw === 'income' ? 'income' : 'expense');

const trimmedName = (body: Record<string, unknown>): string =>
  typeof body.name === 'string' ? body.name.trim() : '';

/** Эмодзи приходит строкой или null; пустая строка значит «снять». */
const emojiOf = (raw: unknown): string | null => (typeof raw === 'string' ? raw || null : null);

/** В шаблоне ilike '%' и '_' — подстановочные знаки, а имя мы ищем целиком. */
const likePattern = (name: string): string => name.replace(/[\\%_]/g, (ch) => `\\${ch}`);

function rowsOf<T>(data: unknown): T[] {
  return (data ?? []) as T[];
}

/**
 * Тёзка без учёта регистра. ilike сужает выборку на стороне базы, но PostgREST
 * превращает '*' в шаблоне в '%', поэтому совпадение подтверждаем ещё и здесь.
 */
async function twinByName<T extends { name: string }>(
  ctx: Ctx,
  table: 'categories' | 'income_sources',
  fields: string,
  name: string,
  type?: CategoryType,
): Promise<T | undefined> {
  let q = ctx.db.from(table).select(fields).ilike('name', likePattern(name));
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const lower = name.toLowerCase();
  return rowsOf<T>(data).find((r) => r.name.toLowerCase() === lower);
}

/** Сколько активных категорий расходов есть сейчас. Считает база, строки не нужны. */
async function activeExpenseCount(ctx: Ctx): Promise<number> {
  const { count, error } = await ctx.db
    .from('categories')
    .select('id', { count: 'exact', head: true })
    .eq('type', 'expense')
    .eq('is_active', true);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Нижняя граница 6: проверяем перед любым исчезновением категории с экрана. */
async function guardMinActiveExpense(ctx: Ctx, cat: CategoryRow): Promise<void> {
  if (!cat.is_active || cat.type !== 'expense') return;
  if ((await activeExpenseCount(ctx)) <= MIN_ACTIVE_EXPENSE) {
    throw badRequest(`Должно остаться минимум ${MIN_ACTIVE_EXPENSE} активных категорий расходов`);
  }
}

/** Новая категория встаёт в конец своего типа. */
async function nextOrder(ctx: Ctx, type: CategoryType): Promise<number> {
  const { data, error } = await ctx.db
    .from('categories')
    .select('order')
    .eq('type', type)
    .order('order', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const rows = rowsOf<{ order: number }>(data);
  return rows.length ? rows[0].order + 1 : 0;
}

/**
 * Строка справочника по id. RLS отсекает чужие строки, поэтому пустой ответ — это
 * «нет такой». Неправильный id ловим до запроса: для uuid-столбца мусор был бы
 * ошибкой базы, а приложение ждёт 404.
 */
async function requireRow<T>(
  ctx: Ctx,
  table: 'categories' | 'income_sources',
  fields: string,
  id: string,
  message: string,
): Promise<T> {
  if (!UUID.test(id)) throw notFound(message);
  const { data, error } = await ctx.db.from(table).select(fields).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw notFound(message);
  return data as T;
}

const requireCategory = (ctx: Ctx, id: string) =>
  requireRow<CategoryRow>(ctx, 'categories', CATEGORY_FIELDS, id, 'Category not found');

const requireSource = (ctx: Ctx, id: string) =>
  requireRow<SourceRow>(ctx, 'income_sources', SOURCE_FIELDS, id, 'Source not found');

/** Сколько операций ссылается на справочник: решает, скрывать строку или удалять. */
async function linkedTxCount(ctx: Ctx, link: TxLink, id: string): Promise<number> {
  const { count, error } = await ctx.db
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq(link, id);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Счётчики операций для списка скрытых строк: один запрос вместо запроса на строку. */
async function linkedTxCounts(ctx: Ctx, link: TxLink, ids: string[]): Promise<Map<string, number>> {
  const out = new Map(ids.map((id) => [id, 0]));
  if (!ids.length) return out;
  const { data, error } = await ctx.db.from('transactions').select(link).in(link, ids);
  if (error) throw new Error(error.message);
  for (const row of rowsOf<Record<string, string | null>>(data)) {
    const id = row[link];
    if (id !== null && out.has(id)) out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

/** Скрыть строку вместо удаления. */
async function hide(ctx: Ctx, table: 'categories' | 'income_sources', id: string): Promise<void> {
  const { error } = await ctx.db.from(table).update({ is_active: false }).eq('id', id);
  if (error) throw new Error(error.message);
}

async function dropRow(ctx: Ctx, table: 'categories' | 'income_sources', id: string): Promise<void> {
  const { error } = await ctx.db.from(table).delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Удаление навсегда: сначала операции, потом сама строка. Ссылка в операции объявлена
 * как «on delete set null», так что без явного удаления операции остались бы без категории.
 * Возвращает число снесённых операций — его показывает подтверждение на экране.
 */
async function purgeWithTransactions(
  ctx: Ctx,
  table: 'categories' | 'income_sources',
  link: TxLink,
  id: string,
): Promise<number> {
  const { data, error } = await ctx.db.from('transactions').delete().eq(link, id).select('id');
  if (error) throw new Error(error.message);
  await dropRow(ctx, table, id);
  return rowsOf<{ id: string }>(data).length;
}

const categoryDTO = (r: CategoryRow) => ({
  id: r.id,
  name: r.name,
  type: r.type,
  isActive: r.is_active,
  emoji: r.emoji,
});

export const routes: Route[] = [
  // Категории
  // Списки с постоянными путями стоят выше шаблонных: вход берёт первый совпавший маршрут.
  {
    method: 'GET',
    path: '/categories',
    handler: async (ctx) => {
      const type = categoryType(ctx.url.searchParams.get('type'));
      const { data, error } = await ctx.db
        .from('categories')
        .select(CATEGORY_FIELDS)
        .eq('type', type)
        .eq('is_active', true);
      if (error) throw new Error(error.message);
      return rowsOf<CategoryRow>(data)
        .sort((a, b) => a.order - b.order || byNameRu(a, b))
        .map(categoryDTO);
    },
  },

  // Экран настройки категорий: видит и скрытые, поэтому отдаём order для перетаскивания.
  {
    method: 'GET',
    path: '/categories/all',
    handler: async (ctx) => {
      const { data, error } = await ctx.db.from('categories').select(CATEGORY_FIELDS);
      if (error) throw new Error(error.message);
      return rowsOf<CategoryRow>(data)
        .sort(
          (a, b) =>
            (a.type === b.type ? 0 : a.type === 'expense' ? -1 : 1) || a.order - b.order || byNameRu(a, b),
        )
        .map((r) => ({ ...categoryDTO(r), order: r.order }));
    },
  },

  {
    method: 'GET',
    path: '/categories/hidden',
    handler: async (ctx) => {
      const { data, error } = await ctx.db
        .from('categories')
        .select(CATEGORY_FIELDS)
        .eq('is_active', false)
        .order('created_at');
      if (error) throw new Error(error.message);
      const rows = rowsOf<CategoryRow>(data);
      const counts = await linkedTxCounts(
        ctx,
        'category_id',
        rows.map((r) => r.id),
      );
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        emoji: r.emoji,
        txCount: counts.get(r.id) ?? 0,
      }));
    },
  },

  {
    method: 'POST',
    path: '/categories',
    handler: async (ctx) => {
      const body = await readJson(ctx.req);
      const name = trimmedName(body);
      const type = categoryType(body.type);
      if (!name) throw badRequest('name required');

      // Тёзка среди скрытых — не ошибка ввода, а предложение восстановить строку,
      // поэтому текст у неё свой.
      const twin = await twinByName<CategoryRow>(ctx, 'categories', CATEGORY_FIELDS, name, type);
      if (twin) {
        throw conflict(
          twin.is_active
            ? 'Категория с таким именем уже существует'
            : 'Категория с таким именем была скрыта. Восстановить или удалить навсегда?',
        );
      }
      if (type === 'expense' && (await activeExpenseCount(ctx)) >= MAX_ACTIVE_EXPENSE) {
        throw badRequest(`Максимум ${MAX_ACTIVE_EXPENSE} активных категорий расходов`);
      }

      const { data, error } = await ctx.db
        .from('categories')
        .insert({
          user_id: ctx.userId,
          name,
          type,
          order: await nextOrder(ctx, type),
          emoji: typeof body.emoji === 'string' ? body.emoji : null,
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id, action: 'created' };
    },
  },

  // Перетаскивание списка: клиент присылает итоговый порядок целиком.
  {
    method: 'PUT',
    path: '/categories/reorder',
    handler: async (ctx) => {
      const body = await readJson(ctx.req);
      if (!Array.isArray(body.ids)) throw badRequest('ids array required');
      const raw: unknown[] = body.ids;
      const notFoundMsg = 'one or more categories not found';
      if (!raw.every((v): v is string => typeof v === 'string' && UUID.test(v))) {
        throw notFound(notFoundMsg);
      }
      const ids: string[] = raw;

      // Порядок меняем только когда весь список свой: иначе часть строк уже сдвинулась,
      // а запрос всё равно провалился.
      const { data, error } = await ctx.db.from('categories').select('id').in('id', ids);
      if (error) throw new Error(error.message);
      const found = new Set(rowsOf<{ id: string }>(data).map((r) => r.id));
      if (ids.some((id) => !found.has(id))) throw notFound(notFoundMsg);

      const results = await Promise.all(
        ids.map((id, i) => ctx.db.from('categories').update({ order: i }).eq('id', id)),
      );
      for (const r of results) if (r.error) throw new Error(r.error.message);
      return { ok: true, reordered: ids.length };
    },
  },

  {
    method: 'PATCH',
    path: '/categories/:id',
    handler: async (ctx) => {
      const cat = await requireCategory(ctx, ctx.params.id);
      const body = await readJson(ctx.req);
      const patch: Record<string, unknown> = {};

      // Пустое имя — промах интерфейса (пользователь стёр поле), а не команда очистить.
      const name = trimmedName(body);
      if (name) patch.name = name;
      if (body.emoji === null || typeof body.emoji === 'string') patch.emoji = emojiOf(body.emoji);
      if (typeof body.isActive === 'boolean') {
        if (!body.isActive) await guardMinActiveExpense(ctx, cat);
        patch.is_active = body.isActive;
      }

      if (Object.keys(patch).length) {
        const { error } = await ctx.db.from('categories').update(patch).eq('id', cat.id);
        if (error) throw new Error(error.message);
      }
      return { ok: true };
    },
  },

  // Путь длиннее шаблонного, поэтому не спорит с DELETE /categories/:id.
  {
    method: 'DELETE',
    path: '/categories/:id/purge',
    handler: async (ctx) => {
      const cat = await requireCategory(ctx, ctx.params.id);
      await guardMinActiveExpense(ctx, cat);
      const deleted = await purgeWithTransactions(ctx, 'categories', 'category_id', cat.id);
      return { ok: true, deletedTransactions: deleted };
    },
  },

  {
    method: 'DELETE',
    path: '/categories/:id',
    handler: async (ctx) => {
      const cat = await requireCategory(ctx, ctx.params.id);
      await guardMinActiveExpense(ctx, cat);
      if ((await linkedTxCount(ctx, 'category_id', cat.id)) > 0) {
        await hide(ctx, 'categories', cat.id);
        return { ok: true, action: 'hidden', reason: 'has_transactions' };
      }
      await dropRow(ctx, 'categories', cat.id);
      return { ok: true, action: 'deleted' };
    },
  },

  // Источники дохода. Та же механика скрытия, но без границ 6/12: доходов бывает
  // и один, и двадцать, список на экране не фиксирован.
  {
    method: 'GET',
    path: '/income-sources',
    handler: async (ctx) => {
      const { data, error } = await ctx.db.from('income_sources').select(SOURCE_FIELDS).eq('is_active', true);
      if (error) throw new Error(error.message);
      return rowsOf<SourceRow>(data)
        .sort(byNameRu)
        .map((r) => ({ id: r.id, name: r.name, emoji: r.emoji }));
    },
  },

  {
    method: 'GET',
    path: '/income-sources/hidden',
    handler: async (ctx) => {
      const { data, error } = await ctx.db
        .from('income_sources')
        .select(SOURCE_FIELDS)
        .eq('is_active', false)
        .order('created_at');
      if (error) throw new Error(error.message);
      const rows = rowsOf<SourceRow>(data);
      const counts = await linkedTxCounts(
        ctx,
        'income_source_id',
        rows.map((r) => r.id),
      );
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        emoji: r.emoji,
        txCount: counts.get(r.id) ?? 0,
      }));
    },
  },

  {
    method: 'POST',
    path: '/income-sources',
    handler: async (ctx) => {
      const body = await readJson(ctx.req);
      const name = trimmedName(body);
      if (!name) throw badRequest('name required');

      const twin = await twinByName<SourceRow>(ctx, 'income_sources', SOURCE_FIELDS, name);
      if (twin) {
        throw conflict(
          twin.is_active
            ? 'Источник с таким именем уже существует'
            : 'Источник с таким именем был скрыт. Восстановить или удалить навсегда?',
        );
      }

      const { data, error } = await ctx.db
        .from('income_sources')
        .insert({
          user_id: ctx.userId,
          name,
          emoji: typeof body.emoji === 'string' ? body.emoji : null,
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    },
  },

  {
    method: 'PATCH',
    path: '/income-sources/:id',
    handler: async (ctx) => {
      const src = await requireSource(ctx, ctx.params.id);
      const body = await readJson(ctx.req);
      const patch: Record<string, unknown> = {};

      const name = trimmedName(body);
      if (name) patch.name = name;
      if (body.emoji === null || typeof body.emoji === 'string') patch.emoji = emojiOf(body.emoji);
      if (typeof body.isActive === 'boolean') patch.is_active = body.isActive;

      if (Object.keys(patch).length) {
        const { error } = await ctx.db.from('income_sources').update(patch).eq('id', src.id);
        if (error) throw new Error(error.message);
      }
      return { ok: true };
    },
  },

  {
    method: 'DELETE',
    path: '/income-sources/:id/purge',
    handler: async (ctx) => {
      const src = await requireSource(ctx, ctx.params.id);
      const deleted = await purgeWithTransactions(ctx, 'income_sources', 'income_source_id', src.id);
      return { ok: true, deletedTransactions: deleted };
    },
  },

  {
    method: 'DELETE',
    path: '/income-sources/:id',
    handler: async (ctx) => {
      const src = await requireSource(ctx, ctx.params.id);
      if ((await linkedTxCount(ctx, 'income_source_id', src.id)) > 0) {
        await hide(ctx, 'income_sources', src.id);
        return { ok: true, action: 'hidden', reason: 'has_transactions' };
      }
      await dropRow(ctx, 'income_sources', src.id);
      return { ok: true, action: 'deleted' };
    },
  },
];

// Профиль пользователя, стартовая загрузка приложения и обратная связь.
// Эталон стиля для остальных доменов: тонкий обработчик, вся общая механика — в lib/.

import { monthSummaryDTO, capitalTotals } from '../lib/aggregates.ts';
import type { Ctx } from '../lib/context.ts';
import { badRequest } from '../lib/http.ts';
import { readJson } from '../lib/http.ts';
import { currentMonth } from '../lib/period.ts';
import type { Route } from '../lib/route.ts';
import { clampedInt, nameMaps, rowsOf, TX_FIELDS, txDTO, type TxRow } from '../lib/shared.ts';

async function meDTO(ctx: Ctx) {
  const p = await ctx.profile();
  return {
    id: p.id,
    currency: p.currency,
    monthStartDay: p.month_start_day,
    timezone: p.timezone,
    remindersEnabled: p.reminders_enabled,
    onboardingCompleted: p.onboarding_completed,
    // Админ-панель владельца в демо не публикуется, поэтому прав владельца ни у кого нет.
    isOwner: false,
    currentMonth: currentMonth(p.month_start_day),
  };
}

export const routes: Route[] = [
  // Проверка сессии: приложение зовёт её на старте, чтобы решить — показывать экран входа или нет.
  {
    method: 'GET',
    path: '/auth/me',
    handler: async (ctx) => {
      const p = await ctx.profile();
      return { id: p.id, firstName: p.display_name, telegramUserId: null };
    },
  },
  // Выход выполняет клиент: он стирает токен у себя. Серверу остаётся подтвердить.
  { method: 'POST', path: '/auth/logout', handler: () => Promise.resolve({ ok: true }) },

  { method: 'GET', path: '/me', handler: meDTO },

  {
    method: 'PUT',
    path: '/me',
    handler: async (ctx) => {
      const body = await readJson(ctx.req);
      const patch: Record<string, unknown> = {};

      if (typeof body.monthStartDay === 'number') {
        const d = Math.trunc(body.monthStartDay);
        if (d < 1 || d > 28) throw badRequest('monthStartDay должен быть от 1 до 28');
        patch.month_start_day = d;
      }
      if (typeof body.remindersEnabled === 'boolean') patch.reminders_enabled = body.remindersEnabled;
      if (typeof body.onboardingCompleted === 'boolean')
        patch.onboarding_completed = body.onboardingCompleted;

      if (Object.keys(patch).length) {
        const { error } = await ctx.db.from('profiles').update(patch).eq('id', ctx.userId);
        if (error) throw new Error(error.message);
      }
      const p = await ctx.db
        .from('profiles')
        .select('month_start_day, reminders_enabled, onboarding_completed')
        .eq('id', ctx.userId)
        .single();
      return {
        ok: true,
        monthStartDay: p.data?.month_start_day,
        remindersEnabled: p.data?.reminders_enabled,
        onboardingCompleted: p.data?.onboarding_completed,
      };
    },
  },

  // Один запрос вместо четырёх на старте приложения: профиль, итог месяца,
  // итоги капитала и последние операции. Главная рисуется с первого ответа.
  {
    method: 'GET',
    path: '/bootstrap',
    handler: async (ctx) => {
      const txLimit = clampedInt(ctx.url.searchParams.get('txLimit'), 5, 1, 50);
      const me = await meDTO(ctx);
      const [summary, capital, recent, names] = await Promise.all([
        monthSummaryDTO(ctx, me.currentMonth),
        capitalTotals(ctx),
        ctx.db.from('transactions').select(TX_FIELDS).order('date', { ascending: false }).limit(txLimit),
        nameMaps(ctx),
      ]);
      if (recent.error) throw new Error(recent.error.message);
      return {
        me,
        summary,
        capitalTotals: capital.totals,
        recentTransactions: rowsOf<TxRow>(recent.data).map((r) => txDTO(r, names)),
      };
    },
  },

  {
    method: 'GET',
    path: '/month-summary',
    handler: async (ctx) => {
      const p = await ctx.profile();
      const raw = ctx.url.searchParams.get('month');
      const month = raw && /^\d{4}-\d{2}$/.test(raw) ? raw : currentMonth(p.month_start_day);
      return monthSummaryDTO(ctx, month);
    },
  },

  {
    method: 'POST',
    path: '/feedback',
    handler: async (ctx) => {
      const body = await readJson(ctx.req);
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (!message) throw badRequest('Пустое сообщение');
      if (message.length > 2000) throw badRequest('Слишком длинное (макс 2000 символов)');
      const { data, error } = await ctx.db
        .from('feedback')
        .insert({ user_id: ctx.userId, message })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    },
  },
];

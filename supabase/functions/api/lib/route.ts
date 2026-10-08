// Описание одного маршрута. Домены экспортируют массив таких записей, вход их собирает.
import type { Ctx } from './context.ts';

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Шаблон пути, параметры через двоеточие: /accounts/:id/history */
  path: string;
  /** Возвращает тело ответа; ошибки бросает через HttpError. */
  handler: (ctx: Ctx) => Promise<unknown>;
}

// Реестр маршрутов: домены подключаются здесь, порядок значения не имеет —
// конкретный путь всегда совпадает только с одним шаблоном.
import type { Route } from '../lib/route.ts';
import { routes as profile } from './profile.ts';
import { routes as catalogs } from './catalogs.ts';
import { routes as transactions } from './transactions.ts';
import { routes as budget } from './budget.ts';
import { routes as accounts } from './accounts.ts';
import { routes as assets } from './assets.ts';
import { routes as analytics } from './analytics.ts';

export const routes: Route[] = [
  ...profile,
  ...catalogs,
  ...transactions,
  ...budget,
  ...accounts,
  ...assets,
  ...analytics,
];

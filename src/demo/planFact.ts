// План/факт — перенос функции planFact сервера прода (src/utils/format.ts):
// процент округляется до целого; до 90% — ok, до 110% — warning, выше — over; без плана — no_plan.

import type { FactStatus, PlanFactDTO } from '../lib/api';
import { rub, type Kopecks } from './money';

export function planFact(planned: Kopecks | null | undefined, actual: Kopecks): PlanFactDTO {
  const p = planned ?? 0;
  let percent: number | null = null;
  let status: FactStatus = 'no_plan';
  if (p !== 0) {
    percent = Math.round((actual / p) * 100);
    if (percent <= 90) status = 'ok';
    else if (percent <= 110) status = 'warning';
    else status = 'over';
  }
  return { planned: rub(p), actual: rub(actual), delta: rub(actual - p), percent, status };
}

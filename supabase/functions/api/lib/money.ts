// Деньги. В базе — numeric(14,2), по сети — строка рублей в том же формате, что
// отдаёт действующее приложение: "450", "1250.5", "-38000". Внутри считаем в целых
// копейках: сложение float даёт 0.1 + 0.2 = 0.30000000000000004, а на деньгах это
// расхождение копится.

export type Kopecks = number;

/** Строка/число из тела запроса → копейки. null, если это не число (обработчик ответит 400). */
export function parseMoney(v: unknown): Kopecks | null {
  if (typeof v === 'number') return Number.isFinite(v) ? parseMoney(String(v)) : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const [int = '0', frac = ''] = s.replace('-', '').split('.');
  const k = Number(int) * 100 + Number((frac + '00').slice(0, 2));
  return s.startsWith('-') ? -k : k;
}

/** numeric из Postgres (приходит строкой "1250.50") → копейки. */
export function fromDb(v: unknown): Kopecks {
  return parseMoney(v ?? 0) ?? 0;
}

/** Копейки → строка рублей для JSON: без хвостовых нулей, как Decimal.toString(). */
export function rub(k: Kopecks): string {
  const sign = k < 0 ? '-' : '';
  const abs = Math.abs(Math.round(k));
  const int = Math.trunc(abs / 100);
  const frac = abs % 100;
  if (frac === 0) return `${sign}${int}`;
  return `${sign}${int}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

/** Копейки → строка для numeric-поля базы: всегда два знака. */
export function toDb(k: Kopecks): string {
  const sign = k < 0 ? '-' : '';
  const abs = Math.abs(Math.round(k));
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Формат сумм в аналитике: там приложение ждёт два знака всегда ("0", "1250.00"). */
export function fixed2(k: Kopecks): string {
  return (Math.round(k) / 100).toFixed(2);
}

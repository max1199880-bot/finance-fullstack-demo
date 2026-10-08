// Деньги в демо-сервере хранятся в целых копейках — так нет ошибок округления float.
// Наружу (в JSON) уходят строки рублей в том же формате, что у сервера прода:
// Decimal.toString() → "450", "1250.5", "-38000".

export type Kopecks = number;

/** Копейки → строка рублей как у Decimal.toString(): без лишних нулей. */
export function rub(k: Kopecks): string {
  const sign = k < 0 ? '-' : '';
  const abs = Math.abs(Math.round(k));
  const int = Math.trunc(abs / 100);
  const frac = abs % 100;
  if (frac === 0) return `${sign}${int}`;
  return `${sign}${int}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

/**
 * Сумма из тела запроса (строка или число, «1 250,5» / "1250.50" / 450) → копейки.
 * null — если это не число: обработчик ответит 400, как сервер прода.
 */
export function parseMoney(v: unknown): Kopecks | null {
  // Число — через строку: 1.005 * 100 во float даёт 100.49999…, а нужно 100 копеек и 0,5.
  if (typeof v === 'number') return Number.isFinite(v) ? parseMoney(String(v)) : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const [int = '0', frac = ''] = s.replace('-', '').split('.');
  const k = Number(int) * 100 + Number((frac + '00').slice(0, 2));
  return s.startsWith('-') ? -k : k;
}

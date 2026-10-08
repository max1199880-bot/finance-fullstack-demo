// Чистые функции демо-сервера: деньги, план/факт, кредитная математика.

import { describe, expect, it } from 'vitest';
import { annuity, monthsElapsed, splitPayment } from './ledger';
import { parseMoney, rub } from './money';
import { planFact } from './planFact';

describe('money: копейки ↔ строки рублей в формате Decimal.toString() прода', () => {
  it.each([
    [0, '0'],
    [45_000, '450'],
    [125_050, '1250.5'],
    [125_055, '1250.55'],
    [1, '0.01'],
    [-3_800_000, '-38000'],
  ])('rub(%i) → «%s»', (k, s) => expect(rub(k)).toBe(s));

  it.each([
    ['450', 45_000],
    ['1 250,5', 125_050],
    ['1250.50', 125_050],
    [1250.5, 125_050],
    [0.1, 10],
    ['-5', -500],
  ])('parseMoney(%j) → %i', (v, k) => expect(parseMoney(v)).toBe(k));

  it('мусор — null (обработчик ответит 400)', () => {
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(parseMoney(Number.NaN)).toBeNull();
  });
});

describe('planFact: пороги сервера прода (≤90 ok, ≤110 warning, >110 over)', () => {
  const plan = 100_000;
  it.each([
    [90_000, 90, 'ok'],
    [90_400, 90, 'ok'], // 90,4% округляется до 90 — ещё норма
    [90_600, 91, 'warning'],
    [110_000, 110, 'warning'],
    [110_600, 111, 'over'],
  ] as const)('факт %i из 100 000 → %i%% %s', (actual, percent, status) => {
    expect(planFact(plan, actual)).toMatchObject({ percent, status });
  });

  it('без плана — no_plan и percent null; delta = факт − план', () => {
    expect(planFact(0, 5_000)).toEqual({ planned: '0', actual: '50', delta: '50', percent: null, status: 'no_plan' });
    expect(planFact(10_000, 12_500).delta).toBe('25');
  });
});

describe('кредит', () => {
  it('аннуитет 250 000 ₽ на 36 мес под 16,9% = 8 900,74 ₽', () => {
    // Сверка по формуле: P·r / (1 − (1+r)^−n) = 3 520,83 / 0,39557 ≈ 8 900,74 ₽.
    expect(annuity(25_000_000, 16.9, 36)).toBe(890_074);
  });

  it('нулевая ставка — долг делится поровну', () => {
    expect(annuity(120_000, 0, 12)).toBe(10_000);
  });

  it('раскладка платежа: проценты, тело, переплата сверх долга', () => {
    expect(splitPayment(1_200_000, 12, 100_000)).toEqual({ interest: 12_000, principal: 88_000, overpayment: 0 });
    expect(splitPayment(50_000, 12, 100_000)).toEqual({ interest: 500, principal: 50_000, overpayment: 49_500 });
    expect(splitPayment(0, 12, 100_000)).toEqual({ interest: 0, principal: 0, overpayment: 100_000 });
  });

  it('полных месяцев с даты старта: если день не наступил — месяц не засчитан', () => {
    expect(monthsElapsed(new Date(2026, 0, 15), new Date(2026, 8, 14))).toBe(7);
    expect(monthsElapsed(new Date(2026, 0, 15), new Date(2026, 8, 15))).toBe(8);
  });
});

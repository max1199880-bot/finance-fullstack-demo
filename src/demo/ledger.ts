// Бухгалтерия демо-сервера: балансы счетов, проводки операций и кредитная математика.
// Правила перенесены с сервера прода (transactionService, creditService, capitalService);
// источники указаны у каждой функции.

import type { Kopecks } from './money';
import type { Account, Credit, DemoDb, Transaction } from './types';

// ── месяцы ──────────────────────────────────────────────────────────────────

/** Ключ месяца YYYY-MM в локальной зоне (в проде — МСК; для демо этого достаточно). */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Диапазон месяца [from, to) с учётом дня начала месяца (monthRange сервера прода). */
export function monthRange(month: string, startDay = 1): { from: Date; to: Date } {
  const [y = 1970, m = 1] = month.split('-').map(Number);
  return { from: new Date(y, m - 1, startDay), to: new Date(y, m, startDay) };
}

/** Текущий месяц с учётом monthStartDay (currentMonthKey сервера прода). */
export function currentMonthKey(now: Date, startDay = 1): string {
  const d = now.getDate() < startDay ? new Date(now.getFullYear(), now.getMonth() - 1, 1) : now;
  return monthKey(d);
}

export function inRange(iso: string, from: Date, to: Date): boolean {
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t < to.getTime();
}

// ── балансы ─────────────────────────────────────────────────────────────────

/** Последний снимок баланса на момент `at` (по умолчанию — вообще последний). */
export function balanceOf(db: DemoDb, accountId: string, at?: string): Kopecks {
  let best: { date: string; balance: Kopecks } | null = null;
  for (const s of db.snapshots) {
    if (s.accountId !== accountId) continue;
    if (at && s.date > at) continue;
    if (!best || s.date >= best.date) best = s;
  }
  return best?.balance ?? 0;
}

/** Дописать снимок (журнал только растёт — как AccountBalance в проде). */
export function setBalance(db: DemoDb, accountId: string, balance: Kopecks, date: string): void {
  db.snapshots.push({ accountId, date, balance });
}

export function adjust(db: DemoDb, accountId: string | null, delta: Kopecks, date: string): void {
  if (!accountId || delta === 0) return;
  setBalance(db, accountId, balanceOf(db, accountId) + delta, date);
}

export function findAccount(db: DemoDb, id: string | null | undefined): Account | undefined {
  return id ? db.accounts.find((a) => a.id === id) : undefined;
}

/** Проводка операции по балансам — эффекты POST /api/transactions прода. */
export function applyTx(db: DemoDb, tx: Transaction): void {
  switch (tx.type) {
    case 'income':
      adjust(db, tx.toAccountId, tx.amount, tx.date);
      break;
    case 'expense':
      adjust(db, tx.fromAccountId, -tx.amount, tx.date);
      // Платёж по кредиту — расход, у которого toAccount = кредит: долг уменьшается на тело.
      if (tx.toAccountId && tx.principalPart) {
        const debt = balanceOf(db, tx.toAccountId);
        setBalance(db, tx.toAccountId, Math.max(0, debt - tx.principalPart), tx.date);
      }
      break;
    case 'transfer_to_investment':
    case 'transfer_between_accounts':
      adjust(db, tx.fromAccountId, -tx.amount, tx.date);
      adjust(db, tx.toAccountId, tx.amount, tx.date);
      break;
    default:
      // asset_revaluation и credit_payment двигают балансы в своих обработчиках.
      break;
  }
}

/** Откат проводки — эффекты DELETE /api/transactions/:id прода. */
export function revertTx(db: DemoDb, tx: Transaction, date: string): void {
  switch (tx.type) {
    case 'income':
      adjust(db, tx.toAccountId, -tx.amount, date);
      break;
    case 'expense':
      adjust(db, tx.fromAccountId, tx.amount, date);
      if (tx.toAccountId && tx.principalPart) adjust(db, tx.toAccountId, tx.principalPart, date);
      break;
    case 'transfer_to_investment':
    case 'transfer_between_accounts':
      adjust(db, tx.fromAccountId, tx.amount, date);
      adjust(db, tx.toAccountId, -tx.amount, date);
      break;
    default:
      break;
  }
}

// ── кредиты (creditService прода) ───────────────────────────────────────────

/** Полных месяцев от даты старта; если день ещё не наступил — минус один. */
export function monthsElapsed(start: Date, now: Date): number {
  let m = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) m -= 1;
  return Math.max(0, m);
}

/** Аннуитетный платёж, округление до копейки. При нулевой ставке — долг / число месяцев. */
export function annuity(principal: Kopecks, ratePercent: number, months: number): Kopecks {
  if (months <= 0 || principal <= 0) return 0;
  const r = ratePercent / 12 / 100;
  if (r === 0) return Math.round(principal / months);
  return Math.round((principal * r) / (1 - Math.pow(1 + r, -months)));
}

export function remainingMonths(credit: Credit, now: Date): number {
  return Math.max(0, credit.termMonths - monthsElapsed(new Date(credit.startDate), now));
}

/** Ближайшая будущая дата платежа (этот или следующий месяц). */
export function nextDueDate(credit: Credit, now: Date): string | null {
  if (!credit.paymentDay) return null;
  let d = new Date(now.getFullYear(), now.getMonth(), credit.paymentDay);
  if (d.getTime() <= new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
    d = new Date(now.getFullYear(), now.getMonth() + 1, credit.paymentDay);
  }
  return d.toISOString();
}

/** Раскладка платежа: сначала проценты за месяц, остальное — тело; сверх долга — переплата. */
export function splitPayment(debt: Kopecks, ratePercent: number, amount: Kopecks) {
  if (debt <= 0) return { interest: 0, principal: 0, overpayment: amount };
  let interest = Math.round((debt * ratePercent) / 12 / 100);
  let principal: Kopecks;
  let overpayment = 0;
  if (interest > amount) {
    interest = amount;
    principal = 0;
  } else {
    principal = amount - interest;
    if (principal > debt) {
      overpayment = principal - debt;
      principal = debt;
    }
  }
  return { interest, principal, overpayment };
}

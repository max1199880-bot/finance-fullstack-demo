// Модель данных демо-сервера. Повторяет устройство базы прода настолько, насколько это нужно
// экранам: балансы — журнал снимков (как таблица AccountBalance), суммы — в копейках.

import type { Kopecks } from './money';

export type AccountType = 'cash' | 'bank' | 'investment' | 'other_asset' | 'credit' | 'credit_buffer';

export type TxType =
  | 'income'
  | 'expense'
  | 'transfer_to_investment'
  | 'transfer_between_accounts'
  | 'credit_payment'
  | 'asset_revaluation';

export interface DemoUser {
  id: string;
  firstName: string;
  telegramUserId: string;
  currency: string;
  monthStartDay: number;
  timezone: string;
  remindersEnabled: boolean;
  onboardingCompleted: boolean;
}

export interface Category {
  id: string;
  name: string;
  type: 'expense' | 'income';
  isActive: boolean;
  order: number;
  emoji: string | null;
}

export interface IncomeSource {
  id: string;
  name: string;
  emoji: string | null;
  isActive: boolean;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  isActive: boolean;
  /** Цена покупки актива (для «Вложено» и маржи). */
  purchasePrice?: Kopecks;
  /** Классификация актива по Кийосаки: true — пассив (личная вещь). */
  liability?: boolean;
}

/** Снимок баланса: текущий баланс счёта — последний снимок по дате. */
export interface BalanceSnapshot {
  accountId: string;
  date: string;
  balance: Kopecks;
}

export interface Transaction {
  id: string;
  date: string;
  amount: Kopecks;
  type: TxType;
  categoryId: string | null;
  incomeSourceId: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  comment: string | null;
  clientTxId?: string;
  linkedAssetId?: string;
  /** Для платежа по кредиту: часть, ушедшая в погашение тела долга. */
  principalPart?: Kopecks;
  interestPart?: Kopecks;
}

export interface Credit {
  /** id совпадает с id кредитного счёта (как в проде: кредит — это счёт типа credit). */
  id: string;
  originalAmount: Kopecks;
  /** Годовая ставка, % (например 16.9). */
  rate: number;
  termMonths: number;
  startDate: string;
  paymentDay: number | null;
}

export interface CategoryPlan {
  month: string;
  categoryId: string;
  amount: Kopecks;
}

export interface GlobalPlan {
  month: string;
  plannedTotalExpenses?: Kopecks;
  plannedTotalIncome?: Kopecks;
  plannedInvestments?: Kopecks;
}

export interface DemoDb {
  version: 2;
  user: DemoUser;
  categories: Category[];
  incomeSources: IncomeSource[];
  accounts: Account[];
  snapshots: BalanceSnapshot[];
  transactions: Transaction[];
  credits: Credit[];
  categoryPlans: CategoryPlan[];
  globalPlans: GlobalPlan[];
  feedback: Array<{ id: string; message: string; createdAt: string }>;
  nextId: number;
}

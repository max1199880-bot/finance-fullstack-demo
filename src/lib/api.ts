import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from './supabase';

export interface MeDTO {
  id: string;
  currency: string;
  monthStartDay: number;
  timezone: string;
  remindersEnabled: boolean;
  onboardingCompleted: boolean;
  isOwner: boolean;
  currentMonth: string;
}

export interface AdminUserRow {
  id: string;
  telegramUserId: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  isOwner: boolean;
  createdAt: string;
  lastTxDate: string | null;
  txTotal: number;
  accountCount: number;
  thisMonth: {
    income: string;
    expense: string;
    investment: string;
    incomeCount: number;
    expenseCount: number;
  };
  capital: {
    totalCash: string;
    totalInvestments: string;
    totalOther: string;
    totalNetWorth: string;
  };
}

export interface AdminAggregateDTO {
  from: string;
  to: string;
  income: string;
  expense: string;
  investment: string;
  txCount: number;
  activeUsers: number;
}

export interface FeedbackRow {
  id: string;
  message: string;
  createdAt: string;
  resolved: boolean;
  telegramUserId: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
}

export interface BootstrapDTO {
  me: MeDTO;
  summary: MonthSummaryDTO;
  capitalTotals: {
    totalCash: string;
    totalInvestments: string;
    totalOther: string;
    totalCredits: string;
    totalCreditBuffers: string;
    totalNetWorth: string;
  };
  recentTransactions: TransactionDTO[];
}

export interface CategoryDTO {
  id: string;
  name: string;
  type: 'expense' | 'income';
  isActive: boolean;
  emoji?: string | null;
}
export interface IncomeSourceDTO { id: string; name: string; emoji?: string | null }
export interface AccountDTO {
  id: string;
  name: string;
  type: 'cash' | 'bank' | 'investment' | 'other_asset' | 'credit' | 'credit_buffer';
  balance: string;
  // Remaining unit count for lot-based resale positions; null for regular assets.
  quantity?: number | null;
  // Kiyosaki classification (assets only): false = asset (margin view),
  // true = liability (personal item — cost of ownership).
  liability?: boolean;
}

export interface CreditSummaryDTO {
  id: string;
  name: string;
  currentPrincipal: string;
  originalAmount: string;
  rate: string;             // annual %
  termMonths: number;
  remainingMonths: number;
  scheduledPayment: string;
  nextDueDate: string | null;
  startDate: string;
  paymentDay: number | null;
}

export type FactStatus = 'ok' | 'warning' | 'over' | 'no_plan';

export interface PlanFactDTO {
  planned: string;
  actual: string;
  delta: string;
  percent: number | null;
  status: FactStatus;
}

export interface BudgetCategoryRow extends PlanFactDTO {
  categoryId: string;
  name: string;
}

export interface BudgetDTO {
  month: string;
  categories: BudgetCategoryRow[];
  total: PlanFactDTO;
  totalIncome: string;
  plannedIncome: string | null;
  totalInvestments: string;
  plannedInvestments: string | null;
}

export interface MonthSummaryDTO {
  month: string;
  totalIncome: string;
  totalExpenses: string;
  totalInvestments: string;
  remainder: string;
  incomePF: PlanFactDTO;
  expensePF: PlanFactDTO;
  investmentsPF: PlanFactDTO;
}

export interface CapitalDTO {
  accounts: AccountDTO[];
  totalCash: string;
  totalInvestments: string;
  totalOther: string;
  totalCredits: string;
  totalCreditBuffers: string;
  totalNetWorth: string;
}

export interface TransactionDTO {
  id: string;
  date: string;
  amount: string;
  type:
    | 'income'
    | 'expense'
    | 'transfer_to_investment'
    | 'transfer_between_accounts'
    | 'credit_payment'
    | 'asset_revaluation';
  categoryId?: string | null;
  categoryName: string | null;
  incomeSourceName: string | null;
  // Account ids the money moved on. Populated by GET /api/transactions; used to
  // decide the +/− sign relative to a specific account in its history view.
  fromAccountId?: string | null;
  toAccountId?: string | null;
  fromAccountName: string | null;
  toAccountName: string | null;
  comment: string | null;
}

/**
 * HTTP error from our API — carries the status so callers can tell "you're not
 * logged in" (401/403) apart from "the server/network is down". Extends Error,
 * so existing `(e as Error).message` call sites keep working unchanged.
 * Network failures (no response at all) still surface as the browser's TypeError.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** True only for a real auth rejection — not for outages, timeouts or offline. */
export function isAuthError(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 401 || e.status === 403);
}

/**
 * Адрес бэкенда: Edge Function `api` в Supabase. Пути в коде остались прежними
 * («/api/transactions»), поэтому экраны не переписывались — здесь подставляется
 * базовый адрес функции и срезается префикс /api.
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  `${SUPABASE_URL}/functions/v1/api`;

/**
 * Гасим сессию при отказе сервера — но только если отказали именно тому токену,
 * с которым пошёл запрос. Иначе запоздавший ответ на старый токен выбрасывал бы
 * пользователя сразу после успешного входа.
 */
async function handleRejectedToken(usedToken: string | undefined): Promise<void> {
  if (!usedToken) return;
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token === usedToken) await supabase.auth.signOut();
}

async function call<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Токен берётся из сессии Supabase: клиент сам обновляет его по refresh-токену,
  // поэтому долгая работа приложения не заканчивается внезапным 401.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  // Без сессии идти в сеть незачем: ответ заведомо 401. Экран входа открывается
  // без единого отказа в журнале, а запросы не тратятся впустую.
  if (!token) throw new ApiError('Требуется вход', 401);

  const headers: Record<string, string> = {
    // apikey обязателен для шлюза Supabase, Authorization — для нашей функции.
    apikey: SUPABASE_ANON_KEY,
    Authorization: token ? `Bearer ${token}` : '',
    ...((options.headers as Record<string, string> | undefined) ?? {}),
  };
  // Content-Type объявляем, только когда тело действительно есть: иначе сервер
  // будет ждать тело у GET и DELETE и отвечать ошибкой разбора.
  const hasBody = options.body !== undefined && options.body !== null;
  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path.replace(/^\/api/, '')}`, { ...options, headers });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = (j as { error?: string }).error ?? msg;
    } catch {
      /* ignore */
    }
    // Сервер отказал в доступе: токен просрочен или пользователя больше нет.
    // AuthGate увидит погасшую сессию и покажет экран входа, вместо того чтобы
    // оставлять приложение с ошибкой на каждом экране.
    if (res.status === 401) void handleRejectedToken(token);
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

export const api = {
  bootstrap: (txLimit = 5) => call<BootstrapDTO>(`/api/bootstrap?txLimit=${txLimit}`),
  me: () => call<MeDTO>('/api/me'),
  updateMe: (body: {
    monthStartDay?: number;
    remindersEnabled?: boolean;
    onboardingCompleted?: boolean;
  }) =>
    call<{ ok: true; onboardingCompleted?: boolean }>('/api/me', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  expenseCategories: () => call<CategoryDTO[]>('/api/categories?type=expense'),
  incomeCategories: () => call<CategoryDTO[]>('/api/categories?type=income'),
  allCategories: () =>
    call<
      {
        id: string;
        name: string;
        type: 'expense' | 'income';
        isActive: boolean;
        order: number;
        emoji?: string | null;
      }[]
    >('/api/categories/all'),
  createCategory: (b: { name: string; type: 'expense' | 'income'; emoji?: string }) =>
    call<{ ok: true; id: string; action: 'created' | 'restored' }>('/api/categories', {
      method: 'POST',
      body: JSON.stringify(b),
    }),
  renameCategory: (id: string, name: string) =>
    call<{ ok: true }>(`/api/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  setCategoryActive: (id: string, isActive: boolean) =>
    call<{ ok: true }>(`/api/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }),
  setCategoryEmoji: (id: string, emoji: string | null) =>
    call<{ ok: true }>(`/api/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ emoji }),
    }),
  deleteCategory: (id: string) =>
    call<{ ok: true; action: 'deleted' | 'hidden' }>(`/api/categories/${id}`, { method: 'DELETE' }),
  purgeCategory: (id: string) =>
    call<{ ok: true; deletedTransactions: number }>(
      `/api/categories/${id}/purge`,
      { method: 'DELETE' },
    ),
  hiddenCategories: () =>
    call<
      {
        id: string;
        name: string;
        type: 'expense' | 'income';
        emoji?: string | null;
        txCount: number;
      }[]
    >('/api/categories/hidden'),
  reorderCategories: (ids: string[]) =>
    call<{ ok: true }>('/api/categories/reorder', {
      method: 'PUT',
      body: JSON.stringify({ ids }),
    }),
  incomeSources: () => call<IncomeSourceDTO[]>('/api/income-sources'),
  createIncomeSource: (b: { name: string; emoji?: string | null }) =>
    call<{ ok: true; id: string }>('/api/income-sources', {
      method: 'POST',
      body: JSON.stringify(b),
    }),
  renameIncomeSource: (id: string, name: string) =>
    call<{ ok: true }>(`/api/income-sources/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  setIncomeSourceEmoji: (id: string, emoji: string | null) =>
    call<{ ok: true }>(`/api/income-sources/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ emoji }),
    }),
  setIncomeSourceActive: (id: string, isActive: boolean) =>
    call<{ ok: true }>(`/api/income-sources/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }),
  deleteIncomeSource: (id: string) =>
    call<{ ok: true; action: 'deleted' | 'hidden'; reason?: string }>(
      `/api/income-sources/${id}`,
      { method: 'DELETE' },
    ),
  purgeIncomeSource: (id: string) =>
    call<{ ok: true; deletedTransactions: number }>(
      `/api/income-sources/${id}/purge`,
      { method: 'DELETE' },
    ),
  hiddenIncomeSources: () =>
    call<{ id: string; name: string; emoji?: string | null; txCount: number }[]>(
      '/api/income-sources/hidden',
    ),
  accounts: (kind?: 'cash_or_bank') =>
    call<AccountDTO[]>(`/api/accounts${kind ? `?type=${kind}` : ''}`),

  // `clientTxId` is an idempotency key — a stable UUID generated once per
  // logical operation. It survives retries and offline-replay (stored in the
  // mutation variables), so the server de-duplicates repeat submissions.
  addExpense: (b: {
    categoryId: string;
    amount: string | number;
    comment?: string;
    fromAccountId?: string;
    linkedAssetId?: string;
    clientTxId?: string;
  }) =>
    call<{ ok: true; id: string }>('/api/transactions', {
      method: 'POST',
      body: JSON.stringify({ ...b, type: 'expense' }),
    }),
  addIncome: (b: {
    incomeSourceId: string;
    amount: string | number;
    comment?: string;
    toAccountId?: string;
    clientTxId?: string;
  }) =>
    call<{ ok: true; id: string }>('/api/transactions', {
      method: 'POST',
      body: JSON.stringify({ ...b, type: 'income' }),
    }),
  addTransfer: (b: {
    fromAccountId: string;
    toAccountId: string;
    amount: string | number;
    comment?: string;
    type: 'transfer_to_investment' | 'transfer_between_accounts';
    clientTxId?: string;
  }) =>
    call<{ ok: true; id: string }>('/api/transactions', {
      method: 'POST',
      body: JSON.stringify(b),
    }),
  // Record a loss (e.g. refunding a buyer the profit from a sale). Booked as an
  // expense under the dedicated server-side "Убыток" category, which deducts
  // the chosen cash/bank account.
  recordLoss: (b: {
    fromAccountId: string;
    amount: string | number;
    comment?: string;
    clientTxId?: string;
  }) =>
    call<{ ok: true; id: string; categoryId: string }>('/api/loss', {
      method: 'POST',
      body: JSON.stringify(b),
    }),
  transactions: (params?: {
    limit?: number;
    from?: string;
    to?: string;
    type?: string;
    accountId?: string;
    accountType?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.type) qs.set('type', params.type);
    if (params?.accountId) qs.set('accountId', params.accountId);
    if (params?.accountType) qs.set('accountType', params.accountType);
    return call<TransactionDTO[]>(`/api/transactions?${qs}`);
  },
  updateTransaction: (
    id: string,
    b: {
      amount?: string | number;
      categoryId?: string;
      incomeSourceId?: string;
      toAccountId?: string | null;
      comment?: string | null;
    },
  ) =>
    call<{ ok: true }>(`/api/transactions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(b),
    }),
  deleteTransaction: (id: string) =>
    call<{ ok: true }>(`/api/transactions/${id}`, { method: 'DELETE' }),

  budget: (month?: string) => call<BudgetDTO>(`/api/budget${month ? `?month=${month}` : ''}`),
  setCategoryPlan: (b: { month?: string; categoryId: string; amount: string | number }) =>
    call<{ ok: true }>('/api/budget/category', { method: 'PUT', body: JSON.stringify(b) }),
  setGlobalPlan: (b: {
    month?: string;
    plannedTotalExpenses?: string | number;
    plannedTotalIncome?: string | number;
    plannedInvestments?: string | number;
  }) => call<{ ok: true }>('/api/budget/global', { method: 'PUT', body: JSON.stringify(b) }),

  monthSummary: (month?: string) =>
    call<MonthSummaryDTO>(`/api/month-summary${month ? `?month=${month}` : ''}`),

  capital: () => call<CapitalDTO>('/api/capital'),
  setBalance: (accountId: string, balance: string | number) =>
    call<{ ok: true }>('/api/capital/balance', {
      method: 'PUT',
      body: JSON.stringify({ accountId, balance }),
    }),

  purchaseAsset: (b: {
    fromAccountId: string;
    name: string;
    assetType: 'investment' | 'other_asset';
    amount: string | number; // price per unit
    quantity?: number; // units bought (default 1; ≥2 → lot-based resale position)
    comment?: string;
    clientTxId?: string;
  }) =>
    call<{ ok: true; accountId: string; transactionId: string }>('/api/assets/purchase', {
      method: 'POST',
      body: JSON.stringify(b),
    }),
  // Докупить — append a new FIFO lot at a (possibly different) unit price.
  restockAsset: (
    id: string,
    b: { quantity: number; unitPrice: string | number; fromAccountId: string; clientTxId?: string },
  ) =>
    call<{ ok: true; transactionId: string; newQuantity: number; newCostBasis: string }>(
      `/api/assets/${id}/restock`,
      { method: 'POST', body: JSON.stringify(b) },
    ),
  // Продать N шт — lump saleAmount for the chosen quantity; profit via FIFO.
  sellUnits: (
    id: string,
    b: { quantity: number; saleAmount: string | number; toAccountId: string; clientTxId?: string },
  ) =>
    call<{
      ok: true;
      transferTransactionId: string;
      incomeTransactionId: string | null;
      quantity: number;
      saleAmount: string;
      costBasis: string;
      profit: string;
      remainingQuantity: number;
      closed: boolean;
    }>(`/api/assets/${id}/sell-units`, { method: 'POST', body: JSON.stringify(b) }),

  // Account / bank CRUD
  // Create any account type (bank, cash, investment, other_asset). The name
  // kept as createBank for back-compat with older callers, but the body now
  // accepts the full AccountType union.
  createBank: (b: {
    name: string;
    type: 'cash' | 'bank' | 'investment' | 'other_asset';
    initialBalance?: string | number;
  }) =>
    call<{ ok: true; id: string }>('/api/accounts', {
      method: 'POST',
      body: JSON.stringify(b),
    }),
  renameAccount: (id: string, name: string) =>
    call<{ ok: true }>(`/api/accounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  setAccountActive: (id: string, isActive: boolean) =>
    call<{ ok: true }>(`/api/accounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }),
  // Smart delete — backend tries hard-delete, falls back to soft-hide when the
  // account has transaction history. Result includes which path was taken.
  deleteAccount: (id: string) =>
    call<{ ok: true; action: 'deleted' | 'hidden'; reason?: string }>(
      `/api/accounts/${id}`,
      { method: 'DELETE' },
    ),
  // Backwards-compat alias
  hideAccount: (id: string) =>
    call<{ ok: true; action: 'deleted' | 'hidden' }>(`/api/accounts/${id}`, { method: 'DELETE' }),

  // ── credits / loans ────────────────────────────────────────────────
  credits: () => call<CreditSummaryDTO[]>('/api/credits'),
  createCredit: (b: {
    name: string;
    originalAmount: string | number;
    rate: string | number;
    termMonths: number;
    startDate?: string;
    paymentDay?: number;
  }) =>
    call<{ ok: true; id: string }>('/api/credits', {
      method: 'POST',
      body: JSON.stringify(b),
    }),
  creditRecalc: (id: string) =>
    call<{ remainingPrincipal: string; remainingMonths: number; newMonthlyPayment: string }>(
      `/api/credits/${id}/recalc`,
    ),
  // One-step payment: cash/bank → debt, recorded as an expense in the given
  // category (the "Кредит" tile on the Add page). Body/interest split is done
  // server-side; only the principal part reduces the debt.
  creditPay: (
    id: string,
    b: {
      fromAccountId: string;
      categoryId: string;
      amount: string | number;
      date?: string;
      comment?: string;
      clientTxId?: string;
    },
  ) =>
    call<{
      ok: true;
      transactionId: string;
      executedAmount: string;
      interest: string;
      principal: string;
      overpayment: string;
      newPrincipal: string;
    }>(`/api/credits/${id}/pay`, {
      method: 'POST',
      body: JSON.stringify(b),
    }),

  hiddenAccounts: () =>
    call<
      {
        id: string;
        name: string;
        type: 'cash' | 'bank' | 'investment' | 'other_asset';
        txCount: number;
      }[]
    >('/api/accounts/hidden'),
  restoreAccount: (id: string) =>
    call<{ ok: true }>(`/api/accounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: true }),
    }),
  purgeAccount: (id: string) =>
    call<{ ok: true; deletedTransactions: number; deletedBalances: number }>(
      `/api/accounts/${id}/purge`,
      { method: 'DELETE' },
    ),
  accountTxCount: (id: string) =>
    call<{ count: number }>(`/api/accounts/${id}/tx-count`),

  sellAsset: (
    id: string,
    b: { toAccountId: string; salePrice: string | number; comment?: string; clientTxId?: string },
  ) =>
    call<{
      ok: true;
      transferTransactionId: string;
      incomeTransactionId: string | null;
      cost: string;
      salePrice: string;
      profit: string;
    }>(`/api/assets/${id}/sell`, {
      method: 'POST',
      body: JSON.stringify(b),
    }),

  // Partial sale / down-payment: receive part of the asset's value now; the
  // asset stays open until its remaining balance reaches zero.
  prepaymentAsset: (
    id: string,
    b: { toAccountId: string; amount: string | number; comment?: string; clientTxId?: string },
  ) =>
    call<{
      ok: true;
      transferTransactionId: string;
      incomeTransactionId: string | null;
      received: string;
      principal: string;
      profit: string;
      newAssetBalance: string;
      fullySold: boolean;
    }>(`/api/assets/${id}/prepayment`, {
      method: 'POST',
      body: JSON.stringify(b),
    }),

  revalueAsset: (
    id: string,
    b: { newValue: string | number; comment?: string; clientTxId?: string },
  ) =>
    call<{
      ok: true;
      revalTransactionId: string;
      previousValue: string;
      newValue: string;
      delta: string;
      direction: 'loss' | 'gain';
    }>(`/api/assets/${id}/revalue`, {
      method: 'POST',
      body: JSON.stringify(b),
    }),

  assetInvestments: (id: string) =>
    call<{
      assetId: string;
      name: string;
      liability: boolean;
      purchase: string;
      invested: string;
      total: string;
      currentValue: string;
      marginNow: string;
      items: Array<{
        id: string;
        date: string;
        amount: string;
        category: string | null;
        comment: string | null;
      }>;
    }>(`/api/assets/${id}/investments`),

  setAssetClassification: (id: string, liability: boolean) =>
    call<{ ok: true; liability: boolean }>(`/api/assets/${id}/classification`, {
      method: 'PATCH',
      body: JSON.stringify({ liability }),
    }),

  accountHistory: (id: string) =>
    call<Array<{ date: string; balance: string }>>(`/api/accounts/${id}/history`),

  // Budget propagation
  setCategoryPlanPropagate: (b: {
    month?: string;
    categoryId: string;
    amount: string | number;
    propagateMonths?: number;
    onlyEmpty?: boolean;
  }) =>
    call<{ ok: true; written: number; skipped: number; months: number }>(
      '/api/budget/category/propagate',
      { method: 'PUT', body: JSON.stringify(b) },
    ),

  // Feedback — saved to DB and forwarded to bot owner
  sendFeedback: (message: string) =>
    call<{ ok: true; id: string }>('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  // Admin (owner-only). Returns 403 to non-owners.
  adminUsers: () =>
    call<{ totalUsers: number; users: AdminUserRow[] }>('/api/admin/users'),
  adminAggregate: (from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    return call<AdminAggregateDTO>(`/api/admin/aggregate${qs.toString() ? '?' + qs : ''}`);
  },
  adminFeedback: (unresolvedOnly = false) =>
    call<FeedbackRow[]>(`/api/admin/feedback${unresolvedOnly ? '?unresolved=true' : ''}`),
  adminMarkFeedbackResolved: (id: string, resolved: boolean) =>
    call<{ ok: true }>(`/api/admin/feedback/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ resolved }),
    }),
  adminUserTransactions: (
    userId: string,
    params?: { limit?: number; from?: string; to?: string; type?: string },
  ) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.type) qs.set('type', params.type);
    return call<TransactionDTO[]>(`/api/admin/users/${userId}/transactions?${qs}`);
  },

  // Analytics
  analyticsSummary: (from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    return call<{
      from: string;
      to: string;
      current: { income: string; expense: string; investment: string; txCount: number };
      previous: { income: string; expense: string; investment: string; txCount: number };
    }>(`/api/analytics/summary${qs.toString() ? '?' + qs : ''}`);
  },
  analyticsByCategory: (from?: string, to?: string, limit = 20) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    qs.set('limit', String(limit));
    return call<{
      from: string;
      to: string;
      total: string;
      items: { categoryId: string; name: string; amount: string; share: number }[];
    }>(`/api/analytics/by-category?${qs}`);
  },
  analyticsDaily: (from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    return call<{
      from: string;
      to: string;
      days: { day: string; income: string; expense: string; investment: string }[];
    }>(`/api/analytics/daily${qs.toString() ? '?' + qs : ''}`);
  },
  analyticsByIncomeSource: (from?: string, to?: string, limit = 20) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    qs.set('limit', String(limit));
    return call<{
      from: string;
      to: string;
      total: string;
      items: { sourceId: string; name: string; amount: string; share: number }[];
    }>(`/api/analytics/by-income-source?${qs}`);
  },
  analyticsNetworthHistory: (weeks = 26, type?: 'investment' | 'cash' | 'bank' | 'other_asset') => {
    const qs = new URLSearchParams();
    qs.set('weeks', String(weeks));
    if (type) qs.set('type', type);
    return call<{
      weeks: { weekEnd: string; total: string }[];
      totalNow: string;
    }>(`/api/analytics/networth-history?${qs}`);
  },
  // Sold/closed assets with realized P&L — drives the "Куплено и продано"
  // card on the Analytics page.
  analyticsSoldAssets: () =>
    call<{
      items: {
        id: string;
        name: string;
        type: 'other_asset' | 'investment';
        emoji: string;
        purchaseDate: string;
        purchasePrice: string;
        saleDate: string | null;
        salePrice: string;
        pnl: string;
        partial: boolean;
      }[];
    }>('/api/analytics/sold-assets'),

  // ── PWA auth (Telegram Login Widget → cookie session) ────────────────────
  telegramLogin: (payload: TelegramLoginPayload) =>
    call<{ ok: true; user: { id: string; firstName: string | null } }>(
      '/api/auth/telegram-login',
      { method: 'POST', body: JSON.stringify(payload) },
    ),
  logout: () => call<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  authMe: () =>
    call<{ id: string; firstName: string | null; telegramUserId: string }>('/api/auth/me'),
  authWidgetConfig: () => call<{ botUsername: string }>('/api/auth/widget-config'),

  // ── Web Push ─────────────────────────────────────────────────────────────
  vapidPublicKey: () => call<{ key: string }>('/api/push/vapid-public-key'),
  pushSubscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    call<{ ok: true }>('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub) }),
  pushUnsubscribe: (endpoint: string) =>
    call<{ ok: true }>('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) }),
};

// Payload delivered by the Telegram Login Widget `data-onauth` callback.
export interface TelegramLoginPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

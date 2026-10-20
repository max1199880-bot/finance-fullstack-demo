import type { QueryClient } from '@tanstack/react-query';
import { GOALS, trackGoal, type GoalLabel } from './analytics';
import { api } from './api';

/**
 * Register mutation defaults for offline-capable writes.
 *
 * When a mutation is fired offline, TanStack Query (with networkMode='online')
 * pauses it. The paused mutation gets persisted to localStorage by
 * PersistQueryClientProvider. On next app open / online event, the persister
 * rehydrates and replays each paused mutation by its mutationKey — at which
 * point the mutationFn registered here is invoked with the original variables.
 *
 * Components must use the matching mutationKey AND pass all required state in
 * the variables (closure references won't survive serialization).
 */

// Every variant carries `clientTxId` — a UUID generated ONCE when the user
// submits. It lives in the mutation variables, so it's identical across a
// retry and across an offline-replay (variables are serialized to
// localStorage). That stable key is what lets the server de-duplicate.
export type AddTxVariables =
  | {
      kind: 'expense';
      categoryId: string;
      amount: string | number;
      comment?: string;
      fromAccountId?: string;
      // Optional link to the asset (technique) this expense was spent on.
      linkedAssetId?: string;
      clientTxId: string;
    }
  | {
      kind: 'income';
      incomeSourceId: string;
      amount: string | number;
      comment?: string;
      toAccountId?: string;
      clientTxId: string;
    }
  | {
      kind: 'transfer';
      fromAccountId: string;
      toAccountId: string;
      amount: string | number;
      type: 'transfer_to_investment' | 'transfer_between_accounts';
      comment?: string;
      clientTxId: string;
    }
  | {
      kind: 'purchase';
      fromAccountId: string;
      name: string;
      assetType: 'investment' | 'other_asset';
      amount: string | number;
      quantity?: number;
      comment?: string;
      clientTxId: string;
    }
  | {
      // Direct credit payment via the "Кредит" expense tile: expense +
      // debt reduction (principal/interest split) in one server call.
      kind: 'credit_payment';
      creditId: string;
      fromAccountId: string;
      categoryId: string;
      amount: string | number;
      comment?: string;
      clientTxId: string;
    };

/** Generate a fresh idempotency key. Call once per user submit. */
export function newClientTxId(): string {
  // crypto.randomUUID is available in all PWA-capable browsers; fall back just
  // in case (older WebView).
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function runAddTx(v: AddTxVariables) {
  switch (v.kind) {
    case 'expense':
      return api.addExpense({
        categoryId: v.categoryId,
        amount: v.amount,
        comment: v.comment,
        fromAccountId: v.fromAccountId,
        linkedAssetId: v.linkedAssetId,
        clientTxId: v.clientTxId,
      });
    case 'income':
      return api.addIncome({
        incomeSourceId: v.incomeSourceId,
        amount: v.amount,
        comment: v.comment,
        toAccountId: v.toAccountId,
        clientTxId: v.clientTxId,
      });
    case 'transfer':
      return api.addTransfer({
        fromAccountId: v.fromAccountId,
        toAccountId: v.toAccountId,
        amount: v.amount,
        type: v.type,
        comment: v.comment,
        clientTxId: v.clientTxId,
      });
    case 'purchase':
      return api.purchaseAsset({
        fromAccountId: v.fromAccountId,
        name: v.name,
        assetType: v.assetType,
        amount: v.amount,
        quantity: v.quantity,
        comment: v.comment,
        clientTxId: v.clientTxId,
      });
    case 'credit_payment':
      return api.creditPay(v.creditId, {
        fromAccountId: v.fromAccountId,
        categoryId: v.categoryId,
        amount: v.amount,
        comment: v.comment,
        clientTxId: v.clientTxId,
      });
  }
}

export type SetBalanceVariables = { accountId: string; balance: string | number };
export type UpdateTxVariables = {
  id: string;
  patch: {
    amount?: string | number;
    categoryId?: string;
    incomeSourceId?: string;
    toAccountId?: string | null;
    comment?: string | null;
  };
};
export type DeleteTxVariables = { id: string };

export const MUTATION_KEYS = {
  addTx: ['add-tx'] as const,
  setBalance: ['set-balance'] as const,
  updateTx: ['update-tx'] as const,
  deleteTx: ['delete-tx'] as const,
};

export function registerMutationDefaults(qc: QueryClient): void {
  // Shared invalidation set — every transactional mutation touches all of
  // these (capital balances, budget plan/fact, transaction lists, account
  // metadata cache for Add page). Keeping them centralised prevents the
  // "I added a mutation but forgot to invalidate X" class of bugs.
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['bootstrap'] });
    qc.invalidateQueries({ queryKey: ['budget'] });
    qc.invalidateQueries({ queryKey: ['txs-all'] });
    qc.invalidateQueries({ queryKey: ['capital'] });
    qc.invalidateQueries({ queryKey: ['accounts'] });
    qc.invalidateQueries({ queryKey: ['credits'] });
    // Prefix-invalidate every asset's "invested in it" view: an expense linked
    // to an asset (or the deletion/edit of one) changes its invested total.
    qc.invalidateQueries({ queryKey: ['asset-investments'] });
  };

  // События аналитики — только после успеха и только тип действия: сумма, категория
  // и комментарий в аналитику не уходят (см. lib/analytics.ts).
  //
  // Событие отправляется внутри mutationFn, а не в onSuccess. Страницы передают в
  // useMutation свой onSuccess, и TanStack Query им ЗАМЕНЯЕТ onSuccess из этих настроек.
  // В первой версии события из-за этого уходили только у офлайн-операций, досланных позже.
  qc.setMutationDefaults(MUTATION_KEYS.addTx, {
    mutationFn: async (v: AddTxVariables) => {
      const result = await runAddTx(v);
      if (v.kind === 'credit_payment') trackGoal(GOALS.creditPayment);
      else if (v.kind === 'purchase') trackGoal(GOALS.assetPurchase, { type: v.assetType as GoalLabel });
      else trackGoal(GOALS.txCreate, { type: (v.kind === 'transfer' ? v.type : v.kind) as GoalLabel });
      return result;
    },
    onSettled: invalidateAll,
  });

  qc.setMutationDefaults(MUTATION_KEYS.setBalance, {
    mutationFn: (v: SetBalanceVariables) => api.setBalance(v.accountId, v.balance),
    onSettled: invalidateAll,
  });

  qc.setMutationDefaults(MUTATION_KEYS.updateTx, {
    mutationFn: async (v: UpdateTxVariables) => {
      const result = await api.updateTransaction(v.id, v.patch);
      trackGoal(GOALS.txEdit);
      return result;
    },
    onSettled: invalidateAll,
  });

  qc.setMutationDefaults(MUTATION_KEYS.deleteTx, {
    mutationFn: async (v: DeleteTxVariables) => {
      const result = await api.deleteTransaction(v.id);
      trackGoal(GOALS.txDelete);
      return result;
    },
    onSettled: invalidateAll,
  });
}

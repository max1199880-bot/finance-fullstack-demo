// События аналитики по операциям должны уходить, даже когда экран передаёт в useMutation
// свой onSuccess. Так устроены все три экрана с операциями (Add, Capital, TransactionEditor),
// а TanStack Query в этом случае заменяет onSuccess из setMutationDefaults. Первая версия
// отправляла события именно там — и на проде ни одного tx_create не дошло (20.10.2026).

import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./analytics')>()),
  trackGoal: vi.fn(),
}));
vi.mock('./api', () => ({
  api: {
    updateTransaction: vi.fn(async () => ({ ok: true })),
    deleteTransaction: vi.fn(async () => ({ ok: true })),
  },
}));

import { trackGoal } from './analytics';
import { api } from './api';
import { MUTATION_KEYS, registerMutationDefaults } from './mutationDefaults';

function client(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  registerMutationDefaults(qc);
  return qc;
}

describe('события аналитики по операциям', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tx_edit уходит, хотя у экрана свой onSuccess', async () => {
    const screenOnSuccess = vi.fn();
    const m = new MutationObserver(client(), {
      mutationKey: MUTATION_KEYS.updateTx,
      onSuccess: screenOnSuccess,
    });
    await m.mutate({ id: 't1', patch: { comment: 'x' } } as never);
    expect(screenOnSuccess).toHaveBeenCalledOnce();
    expect(trackGoal).toHaveBeenCalledWith('tx_edit');
  });

  it('tx_delete уходит, хотя у экрана свой onSuccess', async () => {
    const m = new MutationObserver(client(), { mutationKey: MUTATION_KEYS.deleteTx, onSuccess: vi.fn() });
    await m.mutate({ id: 't1' } as never);
    expect(trackGoal).toHaveBeenCalledWith('tx_delete');
  });

  it('при ошибке сервера событие не отправляется', async () => {
    vi.mocked(api.deleteTransaction).mockRejectedValueOnce(new Error('500'));
    const m = new MutationObserver(client(), { mutationKey: MUTATION_KEYS.deleteTx, onError: vi.fn() });
    await m.mutate({ id: 't1' } as never).catch(() => undefined);
    expect(trackGoal).not.toHaveBeenCalled();
  });
});

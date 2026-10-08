import { useEffect, useState } from 'react';
import { alertDialog, confirmDialog, popupDialog } from '../lib/dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type TransactionDTO, type AccountDTO } from '../lib/api';
import {
  MUTATION_KEYS,
  type DeleteTxVariables,
  type UpdateTxVariables,
} from '../lib/mutationDefaults';
import { Sheet } from './Sheet';
import { AmountKeypad } from './AmountKeypad';
import { fmtRub, fmtDate, categoryEmoji } from '../lib/format';
import { haptic } from '../lib/telegram';

type View = 'menu' | 'amount' | 'category' | 'source' | 'account' | 'comment';

export function TransactionEditor({
  tx,
  onClose,
}: {
  tx: TransactionDTO | null;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>('menu');
  const qc = useQueryClient();

  // Reset to main menu whenever a different (or freshly opened) transaction
  // is passed in — otherwise the previous sub-view stays visible on reopen.
  useEffect(() => {
    setView('menu');
  }, [tx?.id]);

  const expCats = useQuery({
    queryKey: ['cats', 'expense'],
    queryFn: api.expenseCategories,
    enabled: view === 'category' && tx?.type === 'expense',
    staleTime: 5 * 60_000,
  });
  const sources = useQuery({
    queryKey: ['sources'],
    queryFn: api.incomeSources,
    enabled: view === 'source' && tx?.type === 'income',
    staleTime: 5 * 60_000,
  });
  const cashBankAccounts = useQuery({
    queryKey: ['accounts', 'cash_or_bank'],
    queryFn: () => api.accounts('cash_or_bank'),
    enabled: view === 'account' && tx?.type === 'income',
    staleTime: 60_000,
  });

  // Offline-capable: variables-only payload + global mutationKey, so paused
  // mutations get persisted to localStorage and replayed when network returns.
  const update = useMutation<unknown, Error, UpdateTxVariables>({
    mutationKey: MUTATION_KEYS.updateTx,
    onSuccess: () => {
      qc.invalidateQueries();
      haptic('success');
      onClose();
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });
  const fireUpdate = (patch: UpdateTxVariables['patch']) => {
    if (!tx) return;
    update.mutate({ id: tx.id, patch });
  };

  const remove = useMutation<unknown, Error, DeleteTxVariables>({
    mutationKey: MUTATION_KEYS.deleteTx,
    onSuccess: () => {
      qc.invalidateQueries();
      haptic('warning');
      onClose();
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });
  const fireRemove = () => {
    if (!tx) return;
    remove.mutate({ id: tx.id });
  };

  // Treat paused (offline) mutations as queued — close, notify, reset state.
  useEffect(() => {
    if (update.isPaused) {
      popupDialog({ message: '📌 Изменения сохранены локально — отправятся когда вернётся сеть' });
      onClose();
      update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update.isPaused]);
  useEffect(() => {
    if (remove.isPaused) {
      popupDialog({ message: '📌 Удаление сохранено локально — применится когда вернётся сеть' });
      onClose();
      remove.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remove.isPaused]);

  if (!tx) return null;

  const target =
    tx.categoryName ??
    tx.incomeSourceName ??
    ([tx.fromAccountName, tx.toAccountName].filter(Boolean).join(' → ') || '—');
  const sign = tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : '';

  return (
    <Sheet open onClose={onClose} title="Операция">
      <div className="px-4 pb-4">
        <div className="bg-ios-surface rounded-ios-lg p-4 mb-3">
          <div className="text-sm text-ios-hint">{fmtDate(tx.date)}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl">{categoryEmoji(target)}</span>
            <span className="font-medium text-base">{target}</span>
          </div>
          <div className="mt-1 text-2xl font-rounded font-bold tabular-nums">
            {sign}
            {fmtRub(tx.amount)}
          </div>
          {tx.type === 'income' && tx.toAccountName && (
            <div className="mt-1 text-sm text-ios-hint">→ {tx.toAccountName}</div>
          )}
          {tx.comment && <div className="mt-1 text-sm text-ios-subtext">{tx.comment}</div>}
        </div>

        {view === 'menu' && (
          <div className="space-y-1.5">
            <ActionBtn icon="💰" label="Изменить сумму" onClick={() => setView('amount')} />
            {tx.type === 'expense' && (
              <ActionBtn icon="🗂" label="Изменить категорию" onClick={() => setView('category')} />
            )}
            {tx.type === 'income' && (
              <ActionBtn icon="🗂" label="Изменить источник" onClick={() => setView('source')} />
            )}
            {tx.type === 'income' && (
              <ActionBtn
                icon="🏦"
                label={tx.toAccountName ? `Счёт: ${tx.toAccountName}` : 'Привязать счёт зачисления'}
                onClick={() => setView('account')}
              />
            )}
            <ActionBtn
              icon="💬"
              label={tx.comment ? 'Изменить комментарий' : 'Добавить комментарий'}
              onClick={() => setView('comment')}
            />
            <ActionBtn
              icon="🗑"
              label="Удалить"
              danger
              onClick={() => {
                confirmDialog('Удалить операцию? Действие необратимо.').then((ok) => {
                  if (ok) fireRemove();
                });
              }}
            />
          </div>
        )}

        {view === 'amount' && (
          <AmountKeypad
            initial={tx.amount.replace('.', ',')}
            onSubmit={(v) => fireUpdate({ amount: v })}
            submitLabel="Сохранить"
            busy={update.isPending}
            onBack={() => setView('menu')}
          />
        )}

        {view === 'category' && (
          <div>
            <div className="text-xs text-ios-hint mb-2 px-1">Новая категория:</div>
            <div className="grid grid-cols-3 gap-2">
              {(expCats.data ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => fireUpdate({ categoryId: c.id })}
                  className="aspect-square bg-ios-surface rounded-ios p-2 flex flex-col items-center justify-center active:scale-95 transition"
                >
                  <span className="text-2xl">{categoryEmoji(c.name)}</span>
                  <span className="text-[11px] font-medium mt-1 text-center line-clamp-2">{c.name}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setView('menu')}
              className="w-full mt-3 bg-ios-surface rounded-ios py-3 font-medium"
            >
              Назад
            </button>
          </div>
        )}

        {view === 'source' && (
          <div>
            <div className="text-xs text-ios-hint mb-2 px-1">Новый источник:</div>
            <div className="grid grid-cols-2 gap-2">
              {(sources.data ?? []).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => fireUpdate({ incomeSourceId: s.id })}
                  className="bg-ios-surface rounded-ios px-3 py-3.5 font-medium active:scale-95 transition"
                >
                  {s.name}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setView('menu')}
              className="w-full mt-3 bg-ios-surface rounded-ios py-3 font-medium"
            >
              Назад
            </button>
          </div>
        )}

        {view === 'account' && (
          <AccountPicker
            accounts={cashBankAccounts.data ?? []}
            loading={cashBankAccounts.isLoading}
            current={tx.toAccountName}
            onPick={(id) => fireUpdate({ toAccountId: id })}
            onClear={() => fireUpdate({ toAccountId: null })}
            onBack={() => setView('menu')}
          />
        )}

        {view === 'comment' && <CommentEditor initial={tx.comment ?? ''} onCancel={() => setView('menu')} onSave={(c) => fireUpdate({ comment: c || null })} busy={update.isPending} />}
      </div>
    </Sheet>
  );
}

function CommentEditor({
  initial,
  onCancel,
  onSave,
  busy,
}: {
  initial: string;
  onCancel: () => void;
  onSave: (v: string) => void;
  busy?: boolean;
}) {
  const [v, setV] = useState(initial);
  return (
    <div>
      <div className="bg-ios-surface rounded-ios-lg p-3">
        <textarea
          autoFocus
          value={v}
          onChange={(e) => setV(e.target.value)}
          rows={3}
          placeholder="Комментарий"
          className="w-full bg-transparent outline-none resize-none"
        />
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={onCancel} className="flex-1 bg-ios-surface rounded-ios py-3 font-medium">
          Назад
        </button>
        <button
          onClick={() => onSave(v.trim())}
          disabled={busy}
          className="flex-[2] bg-ios-accent text-white rounded-ios py-3 font-semibold disabled:opacity-50"
        >
          {busy ? '…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  bank: '🏦 Банк',
  cash: '💵 Наличные',
};

function AccountPicker({
  accounts,
  loading,
  current,
  onPick,
  onClear,
  onBack,
}: {
  accounts: AccountDTO[];
  loading?: boolean;
  current?: string | null;
  onPick: (id: string) => void;
  onClear: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <div className="text-xs text-ios-hint mb-2 px-1">
        {current ? `Текущий счёт: ${current}` : 'Выберите счёт зачисления:'}
      </div>
      {loading ? (
        <div className="text-ios-hint text-center py-6">Загрузка…</div>
      ) : accounts.length === 0 ? (
        <div className="text-ios-hint text-center py-6 text-sm">
          Нет счетов наличных или банка. Заведи их в Капитале.
        </div>
      ) : (
        <div className="space-y-1.5">
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onPick(a.id)}
              className={`w-full flex items-center justify-between rounded-ios px-4 py-3.5 active:bg-ios-surface2 transition ${
                current === a.name ? 'bg-ios-accentSoft text-ios-accent' : 'bg-ios-surface'
              }`}
            >
              <div className="flex flex-col items-start">
                <span className="font-medium">{a.name}</span>
                <span className="text-xs text-ios-hint mt-0.5">{ACCOUNT_TYPE_LABEL[a.type]}</span>
              </div>
              <span className="text-sm text-ios-hint tabular-nums">{fmtRub(a.balance, { compact: true })}</span>
            </button>
          ))}
          {current && (
            <button
              type="button"
              onClick={onClear}
              className="w-full text-left rounded-ios px-4 py-3.5 bg-ios-surface text-ios-hint active:bg-ios-surface2 transition"
            >
              — Убрать привязку к счёту
            </button>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={onBack}
        className="w-full mt-3 bg-ios-surface rounded-ios py-3 font-medium"
      >
        Назад
      </button>
    </div>
  );
}

function ActionBtn({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-ios bg-ios-surface active:bg-ios-surface2 transition select-none-ui ${danger ? 'text-ios-red' : ''}`}
    >
      <span className="text-xl">{icon}</span>
      <span className="font-medium">{label}</span>
    </button>
  );
}

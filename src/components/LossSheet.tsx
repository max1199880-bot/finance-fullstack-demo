import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AccountDTO } from '../lib/api';
import { newClientTxId } from '../lib/mutationDefaults';
import { Sheet } from './Sheet';
import { AmountKeypad } from './AmountKeypad';
import { fmtRub } from '../lib/format';
import { alertDialog } from '../lib/dialog';
import { haptic } from '../lib/telegram';

// Sale profits are booked by the sell/prepayment flows with this comment prefix.
// We surface them so the user can "return" a specific profit in one tap — the
// loss amount is pre-filled and the comment is set to reference the deal.
const SALE_PROFIT_PREFIX = 'Прибыль с продажи:';

/**
 * Self-contained "record a loss" bottom sheet. A loss = an expense under the
 * server-side "Убыток" category that deducts a cash/bank account. Used both as
 * the 🔻 Убыток entry on the Add screen and as an action in Capital.
 *
 * Accounting: the loss does NOT remove the original sale profit (income); it
 * sits next to it as an offsetting expense, so net P&L on the deal = 0 while the
 * full history (sale + refund) stays visible.
 */
export function LossSheet({
  open,
  onClose,
  defaultComment,
}: {
  open: boolean;
  onClose: () => void;
  defaultComment?: string;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<'pick' | 'amount'>('pick');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accountName, setAccountName] = useState('');
  const [prefillAmount, setPrefillAmount] = useState('');
  const [linkedSaleName, setLinkedSaleName] = useState<string | null>(null);
  // Free-text comment (managed by the keypad). Starts empty so AmountKeypad's
  // mount effect doesn't wipe anything; the sale link / defaultComment are
  // applied at submit time instead.
  const [comment, setComment] = useState('');

  const accounts = useQuery({
    queryKey: ['accounts', 'cash_or_bank'],
    queryFn: () => api.accounts('cash_or_bank'),
    enabled: open,
    staleTime: 60_000,
  });
  const recentIncome = useQuery({
    queryKey: ['loss', 'sale-profits'],
    queryFn: () => api.transactions({ type: 'income', limit: 100 }),
    enabled: open,
    staleTime: 30_000,
  });

  const reset = () => {
    setStep('pick');
    setAccountId(null);
    setAccountName('');
    setPrefillAmount('');
    setLinkedSaleName(null);
    setComment('');
  };

  const close = () => {
    reset();
    onClose();
  };

  const m = useMutation({
    mutationFn: (amount: string) => {
      const finalComment =
        comment.trim() ||
        (linkedSaleName ? `Возврат прибыли: ${linkedSaleName}` : defaultComment?.trim()) ||
        undefined;
      return api.recordLoss({
        fromAccountId: accountId!,
        amount,
        comment: finalComment,
        clientTxId: newClientTxId(),
      });
    },
    onSuccess: () => {
      haptic('warning');
      qc.invalidateQueries({ queryKey: ['capital'] });
      qc.invalidateQueries({ queryKey: ['bootstrap'] });
      qc.invalidateQueries({ queryKey: ['txs-all'] });
      qc.invalidateQueries({ queryKey: ['budget'] });
      qc.invalidateQueries({ queryKey: ['acct-history'] });
      reset();
      onClose();
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  if (!open) return null;

  const cashBank = (accounts.data ?? []) as AccountDTO[];
  const saleProfits = (recentIncome.data ?? []).filter((t) =>
    (t.comment ?? '').startsWith(SALE_PROFIT_PREFIX),
  );

  return (
    <Sheet open onClose={close} title="Зафиксировать убыток">
      {step === 'pick' && (
        <div className="px-4 pb-4 pt-2 space-y-4">
          <div className="text-sm text-ios-hint leading-snug">
            Деньги спишутся со счёта как убыток (расход). Если возвращаешь прибыль
            с продажи — выбери её ниже, сумма подставится.
          </div>

          {saleProfits.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase text-ios-hint tracking-wider mb-2">
                Связать с продажей (необязательно)
              </div>
              <div className="space-y-1.5">
                {saleProfits.map((p) => {
                  const name = (p.comment ?? '').slice(SALE_PROFIT_PREFIX.length).trim();
                  const picked = linkedSaleName === name && prefillAmount === p.amount;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        if (picked) {
                          setLinkedSaleName(null);
                          setPrefillAmount('');
                        } else {
                          setLinkedSaleName(name || 'Продажа');
                          setPrefillAmount(p.amount);
                        }
                        haptic('select');
                      }}
                      className={`w-full flex items-center justify-between rounded-ios px-4 py-3 transition ${
                        picked ? 'bg-ios-accent text-white' : 'bg-ios-surface active:bg-ios-surface2'
                      }`}
                    >
                      <span className="font-medium truncate mr-2">🔻 {name || 'Продажа'}</span>
                      <span className="tabular-nums text-sm shrink-0">{fmtRub(p.amount)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div className="text-xs font-semibold uppercase text-ios-hint tracking-wider mb-2">
              Списать со счёта
            </div>
            {accounts.isLoading ? (
              <div className="space-y-1.5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-14 bg-ios-surface rounded-ios animate-pulse" />
                ))}
              </div>
            ) : cashBank.length === 0 ? (
              <p className="text-center text-ios-hint py-6 text-sm">
                Нет счетов наличных или банка. Создай их в Капитале.
              </p>
            ) : (
              <div className="space-y-1.5">
                {cashBank.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setAccountId(a.id);
                      setAccountName(a.name);
                      setStep('amount');
                      haptic('select');
                    }}
                    className="w-full flex items-center justify-between bg-ios-surface rounded-ios px-4 py-3.5 active:bg-ios-surface2 transition"
                  >
                    <span className="font-medium">{a.name}</span>
                    <span className="text-sm text-ios-hint tabular-nums">{fmtRub(a.balance)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {step === 'amount' && (
        <AmountKeypad
          initial={prefillAmount ? prefillAmount.replace('.', ',') : ''}
          onSubmit={(v) => m.mutate(v)}
          submitLabel={`Убыток · ${accountName}`}
          busy={m.isPending}
          hint={
            linkedSaleName
              ? `Возврат прибыли: ${linkedSaleName}`
              : defaultComment || `спишется с «${accountName}»`
          }
          onBack={() => setStep('pick')}
          comment={comment}
          onCommentChange={setComment}
        />
      )}
    </Sheet>
  );
}

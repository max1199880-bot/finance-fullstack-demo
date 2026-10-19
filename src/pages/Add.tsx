import { useEffect, useState } from 'react';
import { alertDialog, popupDialog } from '../lib/dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { MUTATION_KEYS, newClientTxId, type AddTxVariables } from '../lib/mutationDefaults';
import { Header } from '../components/Header';
import { AmountKeypad } from '../components/AmountKeypad';
import { LossSheet } from '../components/LossSheet';
import { CategoryTile, AddTile } from '../components/CategoryTile';
import { CategoryQuickEdit, AddCategorySheet, type QuickCategory } from '../components/CategoryQuickEdit';
import { fmtRub } from '../lib/format';
import { CategoryIcon } from '../lib/iconTheme';
import { haptic } from '../lib/telegram';

const MAX_EXPENSE_CATEGORIES = 12;

type Mode = 'expense' | 'income' | 'transfer' | 'purchase';
type Step = 'pick' | 'asset_meta' | 'amount';

type AssetType = 'investment' | 'other_asset';

const MODE_LABELS: Record<Mode, string> = {
  expense: '🛒 Расход',
  income: '💵 Доход',
  transfer: '🔁 Перевод',
  purchase: '🆕 Покупка',
};

const MODE_TITLES: Record<Mode, string> = {
  expense: 'Расход',
  income: 'Доход',
  transfer: 'Перевод',
  purchase: 'Покупка',
};

const PREF_EXP_ACCOUNT_KEY = 'pref-exp-account-id';

function loadPreferredExpenseAccount(): string | null {
  try {
    return localStorage.getItem(PREF_EXP_ACCOUNT_KEY);
  } catch {
    return null;
  }
}
function savePreferredExpenseAccount(id: string): void {
  try {
    localStorage.setItem(PREF_EXP_ACCOUNT_KEY, id);
  } catch {
    /* noop */
  }
}

/**
 * A "credit" expense category routes through the direct credit-payment flow
 * (pick credit → pick source account → amount → expense + debt reduction)
 * instead of the plain expense flow. Matched by name — the user's category is
 * literally called "Кредит".
 */
function isCreditCategoryName(name: string): boolean {
  return name.toLowerCase().includes('кредит');
}

export function AddPage({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>('expense');
  // 🔻 Убыток is not a step-flow mode — it opens a self-contained sheet so the
  // multi-step expense/income/transfer flow stays untouched.
  const [lossOpen, setLossOpen] = useState(false);
  const [step, setStep] = useState<Step>('pick');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [pickedName, setPickedName] = useState<string>('');
  const [secondaryId, setSecondaryId] = useState<string | null>(null);
  const [secondaryName, setSecondaryName] = useState<string>('');
  // Optional: link an expense to an asset (technique) — tracks "invested in it".
  const [linkedAssetId, setLinkedAssetId] = useState<string | null>(null);

  // Credit-payment flow state (expense mode, "Кредит" category).
  const [creditId, setCreditId] = useState<string | null>(null);
  const [creditName, setCreditName] = useState<string>('');

  // Purchase-only state
  const [assetName, setAssetName] = useState<string>('');
  const [assetType, setAssetType] = useState<AssetType>('other_asset');
  // Purchase quantity (default 1). ≥2 on an other_asset → lot-based resale position.
  const [assetQty, setAssetQty] = useState<number>(1);

  // Optional comment, off by default. AmountKeypad shows the toggle.
  const [comment, setComment] = useState<string>('');

  // Preferred account for expense deduction (persisted in localStorage).
  const [preferredExpAccountId, setPreferredExpAccountId] = useState<string | null>(
    loadPreferredExpenseAccount,
  );

  const expCats = useQuery({
    queryKey: ['cats', 'expense'],
    queryFn: api.expenseCategories,
    enabled: mode === 'expense',
    staleTime: 5 * 60_000,
  });
  const sources = useQuery({
    queryKey: ['sources'],
    queryFn: api.incomeSources,
    enabled: mode === 'income',
    staleTime: 5 * 60_000,
  });
  const accounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.accounts(),
    // Also enabled for expense so account picker is ready when needed.
    enabled: mode === 'transfer' || mode === 'purchase' || mode === 'income' || mode === 'expense',
    staleTime: 60_000,
  });

  // Credit list — only fetched once the user tapped the "Кредит" category.
  const isCreditCat = mode === 'expense' && !!pickedId && isCreditCategoryName(pickedName);
  const credits = useQuery({
    queryKey: ['credits'],
    queryFn: api.credits,
    enabled: isCreditCat,
    staleTime: 30_000,
  });
  const pickedCredit = credits.data?.find((c) => c.id === creditId) ?? null;

  // Auto-select when there's exactly one credit — the user taps "Кредит" and
  // lands straight on the source-account step, no credit picker in between.
  useEffect(() => {
    if (isCreditCat && !creditId && credits.isSuccess && credits.data.length === 1) {
      const only = credits.data[0];
      setCreditId(only.id);
      setCreditName(only.name);
    }
  }, [isCreditCat, creditId, credits.isSuccess, credits.data]);

  const qc = useQueryClient();

  // mutationKey + variables-driven payload allow this mutation to be
  // persisted by PersistQueryClientProvider when the user fires it offline.
  // Closure-only state (mode, pickedId etc.) wouldn't survive serialization,
  // so we shape the payload as a discriminated union and rebuild it on demand.
  const addMutation = useMutation<unknown, Error, AddTxVariables>({
    mutationKey: MUTATION_KEYS.addTx,
    onSuccess: (data, variables) => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['bootstrap'] });
      qc.invalidateQueries({ queryKey: ['budget'] });
      qc.invalidateQueries({ queryKey: ['txs-all'] });
      qc.invalidateQueries({ queryKey: ['capital'] });
      qc.invalidateQueries({ queryKey: ['credits'] });
      if (variables.kind === 'credit_payment') {
        const r = data as {
          executedAmount: string;
          interest: string;
          principal: string;
          newPrincipal: string;
        };
        popupDialog({
          title: 'Платёж по кредиту',
          message:
            `Платёж: ${fmtRub(r.executedAmount)}\n` +
            `  • тело: ${fmtRub(r.principal)}\n` +
            `  • проценты банку: ${fmtRub(r.interest)}\n\n` +
            `Остаток долга: ${fmtRub(r.newPrincipal)}`,
        });
      }
      reset();
      onDone();
    },
    onError: (e) => {
      haptic('error');
      alertDialog(`Не удалось сохранить: ${(e as Error).message}`);
    },
  });

  // When offline, mutate() leaves the mutation in `paused` status. Treat
  // that as "queued OK" — user gets feedback, form closes, sync happens
  // automatically as soon as the network comes back.
  useEffect(() => {
    if (addMutation.isPaused) {
      haptic('success');
      popupDialog({
        message: '📌 Сохранено локально — отправится когда вернётся сеть',
      });
      reset();
      onDone();
      addMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addMutation.isPaused]);

  function fire(amount: string) {
    const trimmedComment = comment.trim() || undefined;
    // One idempotency key per submit. Reused automatically on retry / offline
    // replay (it travels inside the mutation variables), so the server can
    // de-duplicate a repeated send instead of recording it twice.
    const clientTxId = newClientTxId();
    if (mode === 'expense' && creditId) {
      // "Кредит" tile: one server call = expense + debt reduction with the
      // principal/interest split (same math as the Capital credit flow).
      addMutation.mutate({
        kind: 'credit_payment',
        creditId,
        fromAccountId: secondaryId!,
        categoryId: pickedId!,
        amount,
        comment: trimmedComment,
        clientTxId,
      });
    } else if (mode === 'expense') {
      addMutation.mutate({
        kind: 'expense',
        categoryId: pickedId!,
        amount,
        comment: trimmedComment,
        // secondaryId holds the chosen "from account" (may be null = no deduction)
        fromAccountId: secondaryId ?? undefined,
        linkedAssetId: linkedAssetId ?? undefined,
        clientTxId,
      });
    } else if (mode === 'income') {
      addMutation.mutate({
        kind: 'income',
        incomeSourceId: pickedId!,
        amount,
        comment: trimmedComment,
        toAccountId: secondaryId ?? undefined,
        clientTxId,
      });
    } else if (mode === 'transfer') {
      const to = accounts.data?.find((a) => a.id === secondaryId);
      const type = to?.type === 'investment' ? 'transfer_to_investment' : 'transfer_between_accounts';
      addMutation.mutate({
        kind: 'transfer',
        fromAccountId: pickedId!,
        toAccountId: secondaryId!,
        amount,
        type,
        comment: trimmedComment,
        clientTxId,
      });
    } else {
      addMutation.mutate({
        kind: 'purchase',
        fromAccountId: pickedId!,
        name: assetName.trim(),
        assetType,
        amount,
        quantity: assetType === 'other_asset' ? assetQty : 1,
        comment: trimmedComment,
        clientTxId,
      });
    }
  }

  const reset = () => {
    setStep('pick');
    setPickedId(null);
    setPickedName('');
    setSecondaryId(null);
    setSecondaryName('');
    setLinkedAssetId(null);
    setCreditId(null);
    setCreditName('');
    setAssetName('');
    setAssetType('other_asset');
    setAssetQty(1);
    setComment('');
  };

  // Back out of a chosen credit. With a single credit there's no picker to
  // return to (it was auto-selected), so leave the credit category entirely —
  // clearing pickedId flips isCreditCat off and stops the auto-select effect
  // from immediately re-picking it.
  const backFromCredit = () => {
    if (credits.data?.length === 1) {
      setPickedId(null);
      setPickedName('');
    }
    setCreditId(null);
    setCreditName('');
    setSecondaryId(null);
    setSecondaryName('');
  };

  const switchMode = (m: Mode) => {
    haptic('select');
    setMode(m);
    reset();
  };

  // Header back behavior depends on current step.
  const headerBack = (() => {
    if (step === 'pick') {
      // Credit flow: back from the source-account step returns to the credit
      // picker (or to categories when the single credit was auto-selected).
      if (mode === 'expense' && creditId) {
        return { label: '‹ Назад', onClick: backFromCredit };
      }
      // Expense: after category is picked, we show account picker in the same
      // 'pick' step. Back from there resets the category selection.
      if (mode === 'expense' && pickedId) {
        return {
          label: '‹ Назад',
          onClick: () => {
            setPickedId(null);
            setPickedName('');
            setSecondaryId(null);
            setSecondaryName('');
          },
        };
      }
      // On the first step there's nothing to go back to within this flow —
      // user can switch tab via the bar; offer "Закрыть" to bail out.
      return { label: '✕', onClick: onDone };
    }
    if (step === 'asset_meta') {
      return {
        label: '‹ Назад',
        onClick: () => {
          setStep('pick');
          setPickedId(null);
          setPickedName('');
        },
      };
    }
    // amount step
    return {
      label: '‹ Назад',
      onClick: () => {
        if (mode === 'purchase') {
          setStep('asset_meta');
        } else if (mode === 'transfer') {
          // back to "to" picker (with "from" already chosen) — reset secondary
          setSecondaryId(null);
          setSecondaryName('');
          setStep('pick');
        } else if (mode === 'income') {
          // back to account picker (with source still chosen) — reset secondary
          setSecondaryId(null);
          setSecondaryName('');
          setStep('pick');
        } else if (mode === 'expense') {
          // back to the account picker (credit flow keeps its chosen credit)
          setSecondaryId(null);
          setSecondaryName('');
          setStep('pick');
        } else {
          setStep('pick');
          setPickedId(null);
          setPickedName('');
        }
      },
    };
  })();

  // Subtitle reflects what we're picking / entering right now.
  const subtitle = (() => {
    if (step === 'pick') {
      if (mode === 'transfer' && pickedId) return 'Куда переводим?';
      if (mode === 'transfer') return 'Откуда переводим?';
      if (mode === 'purchase') return 'Откуда оплачиваем?';
      if (mode === 'income' && pickedId) return 'На какой счёт?';
      if (mode === 'expense' && creditId) return 'Откуда списать платёж?';
      if (mode === 'expense' && pickedId && isCreditCat) return 'Какой кредит?';
      if (mode === 'expense' && pickedId) return 'Откуда списать?';
      if (mode === 'expense') return 'Выберите категорию';
      return 'Выберите источник';
    }
    if (step === 'asset_meta') return `Из «${pickedName}»`;
    if (mode === 'purchase') return `${pickedName} → ${assetName || 'актив'}`;
    if (mode === 'transfer') return `${pickedName} → ${secondaryName}`;
    if (mode === 'income' && secondaryName) return `${pickedName} → ${secondaryName}`;
    if (mode === 'expense' && creditId) return `${creditName} · из ${secondaryName}`;
    if (mode === 'expense' && secondaryName) return `${pickedName} · из ${secondaryName}`;
    return pickedName;
  })();

  return (
    <div className="pb-28">
      <Header
        title={MODE_TITLES[mode]}
        subtitle={subtitle}
        right={
          <button
            type="button"
            onClick={headerBack.onClick}
            className="text-ios-accent text-base font-medium select-none-ui"
          >
            {headerBack.label}
          </button>
        }
      />

      {/* Mode switcher — 2x2 grid */}
      <div className="px-4">
        <div className="bg-ios-surface2 dark:bg-ios-surface rounded-ios p-1 grid grid-cols-2 gap-1">
          {(['expense', 'income', 'transfer', 'purchase'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`py-2 text-sm font-medium rounded-[10px] transition ${
                mode === m ? 'bg-ios-surface shadow-sm' : 'text-ios-hint'
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              haptic('light');
              setLossOpen(true);
            }}
            className="col-span-2 py-2 text-sm font-medium rounded-[10px] text-ios-hint active:bg-ios-surface transition"
          >
            🔻 Убыток
          </button>
        </div>
      </div>

      {step === 'pick' && (
        <div className="mt-4 px-4">
          {mode === 'expense' && !pickedId && (
            <ExpensePicker
              loading={expCats.isLoading}
              items={(expCats.data ?? []).map((c) => ({ id: c.id, name: c.name, emoji: c.emoji }))}
              onPick={(id, name) => {
                setPickedId(id);
                setPickedName(name);
                // Stay in 'pick' to show expense account picker next.
                // If accounts haven't loaded or there are none, we'll advance
                // to 'amount' in the ExpenseAccountPicker component.
                haptic('select');
              }}
            />
          )}
          {/* "Кредит" category → pick WHICH credit first (skipped when the
              user has no credit accounts — falls back to a plain expense). */}
          {mode === 'expense' && pickedId && isCreditCat && !creditId && credits.isLoading && (
            <div className="text-ios-hint text-center py-10">Загрузка кредитов…</div>
          )}
          {mode === 'expense' &&
            pickedId &&
            isCreditCat &&
            !creditId &&
            credits.isSuccess &&
            (credits.data.length > 0 ? (
              <CreditPicker
                credits={credits.data}
                categoryName={pickedName}
                onPick={(id, name) => {
                  setCreditId(id);
                  setCreditName(name);
                  haptic('select');
                }}
                onReset={() => {
                  setPickedId(null);
                  setPickedName('');
                }}
              />
            ) : (
              <p className="text-xs text-ios-hint text-center mb-3 leading-snug px-2">
                Кредитов в Капитале нет — запишется как обычный расход. Заведи кредит в Капитале, чтобы
                платежи уменьшали тело долга.
              </p>
            ))}
          {mode === 'expense' &&
            pickedId &&
            (!isCreditCat || creditId || (credits.isSuccess && credits.data.length === 0)) && (
              <ExpenseAccountPicker
                accounts={(accounts.data ?? []).filter((a) => a.type === 'cash' || a.type === 'bank')}
                loading={accounts.isLoading}
                categoryName={creditId ? `${pickedName} · ${creditName}` : pickedName}
                preferredId={preferredExpAccountId}
                allowNoAccount={!creditId}
                onPick={(id, name) => {
                  if (id) {
                    setPreferredExpAccountId(id);
                    savePreferredExpenseAccount(id);
                  }
                  setSecondaryId(id);
                  setSecondaryName(name);
                  setStep('amount');
                  haptic('medium');
                }}
                onReset={() => {
                  if (creditId) {
                    backFromCredit();
                  } else {
                    setPickedId(null);
                    setPickedName('');
                    setSecondaryId(null);
                    setSecondaryName('');
                  }
                }}
              />
            )}
          {mode === 'income' && (
            <IncomePicker
              sourcesLoading={sources.isLoading}
              accountsLoading={accounts.isLoading}
              sources={(sources.data ?? []).map((s) => ({ id: s.id, name: s.name, emoji: s.emoji }))}
              accounts={(accounts.data ?? []).filter((a) => a.type === 'cash' || a.type === 'bank')}
              sourceId={pickedId}
              onPickSource={(id, name) => {
                setPickedId(id);
                setPickedName(name);
                haptic('select');
              }}
              onPickAccount={(id, name) => {
                setSecondaryId(id);
                setSecondaryName(name);
                setStep('amount');
                haptic('medium');
              }}
              onResetSource={() => {
                setPickedId(null);
                setPickedName('');
                setSecondaryId(null);
                setSecondaryName('');
              }}
            />
          )}
          {mode === 'transfer' && (
            <TransferPicker
              accounts={accounts.data ?? []}
              loading={accounts.isLoading}
              fromId={pickedId}
              onPickFrom={(id, name) => {
                setPickedId(id);
                setPickedName(name);
                haptic('select');
              }}
              onPickTo={(id, name) => {
                setSecondaryId(id);
                setSecondaryName(name);
                setStep('amount');
                haptic('medium');
              }}
              onResetFrom={() => {
                setPickedId(null);
                setPickedName('');
              }}
            />
          )}
          {mode === 'purchase' && (
            <SourcePicker
              accounts={(accounts.data ?? []).filter((a) => a.type === 'cash' || a.type === 'bank')}
              loading={accounts.isLoading}
              onPick={(id, name) => {
                setPickedId(id);
                setPickedName(name);
                setStep('asset_meta');
                haptic('medium');
              }}
            />
          )}
        </div>
      )}

      {step === 'asset_meta' && mode === 'purchase' && (
        <AssetMetaForm
          name={assetName}
          assetType={assetType}
          quantity={assetQty}
          onChangeName={setAssetName}
          onChangeType={setAssetType}
          onChangeQuantity={setAssetQty}
          onBack={() => {
            setStep('pick');
            setPickedId(null);
            setPickedName('');
          }}
          onNext={() => {
            if (!assetName.trim()) {
              alertDialog('Введите название актива');
              return;
            }
            haptic('medium');
            setStep('amount');
          }}
        />
      )}

      {step === 'amount' &&
        mode === 'expense' &&
        (() => {
          // Only physical things ("техника") — brokerage/crypto `investment`
          // accounts are not something you spend repairs on, and they only
          // cluttered the picker (six identical «Инвестиции» rows).
          const assetChoices = (accounts.data ?? []).filter((a) => a.type === 'other_asset');
          if (assetChoices.length === 0) return null;
          return (
            <div className="px-4 pb-2">
              <div className="text-[12px] text-ios-hint mb-1.5">
                Для техники (необязательно) — посчитается «вложено»
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setLinkedAssetId(null)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-[13px] font-medium select-none-ui ${
                    !linkedAssetId ? 'bg-ios-accent text-white' : 'bg-ios-surface text-ios-subtext'
                  }`}
                >
                  Нет
                </button>
                {assetChoices.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setLinkedAssetId(a.id)}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-[13px] font-medium select-none-ui max-w-[60vw] truncate ${
                      linkedAssetId === a.id ? 'bg-ios-accent text-white' : 'bg-ios-surface text-ios-subtext'
                    }`}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

      {step === 'amount' && (
        <AmountKeypad
          hint={
            mode === 'purchase'
              ? assetType === 'other_asset' && assetQty >= 2
                ? `🚗 ${assetName} · цена за штуку (× ${assetQty} шт)`
                : `${assetType === 'investment' ? '📈 Инвестиция' : '🚗 Прочий актив'} · ${assetName}`
              : creditId && pickedCredit
                ? `платёж по графику ${fmtRub(pickedCredit.scheduledPayment)} · долг ${fmtRub(pickedCredit.currentPrincipal)}`
                : undefined
          }
          comment={comment}
          onCommentChange={setComment}
          // Single tap → save. Goes through fire() so the variables match the
          // discriminated union expected by the registered mutation default.
          onSubmit={(v) => fire(v)}
          submitLabel="Сохранить"
          busy={addMutation.isPending}
          onBack={headerBack.onClick}
        />
      )}

      <LossSheet open={lossOpen} onClose={() => setLossOpen(false)} />
    </div>
  );
}

/**
 * Expense category picker. Tap a tile to pick the category. Hold (≥500ms) to
 * open rename/delete actions for that category. The "+ Добавить" tile at the
 * end appears whenever you have room for more (max 12 active expense cats).
 *
 * Long-press is the same gesture Telegram uses for message context menus, so
 * users immediately understand it without explicit UI hints.
 */
function ExpensePicker({
  items,
  onPick,
  loading,
}: {
  items: { id: string; name: string; emoji?: string | null }[];
  onPick: (id: string, name: string) => void;
  loading?: boolean;
}) {
  const [editing, setEditing] = useState<QuickCategory | null>(null);
  const [adding, setAdding] = useState(false);

  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-square bg-ios-surface rounded-ios animate-pulse" />
        ))}
      </div>
    );
  }

  const canAdd = items.length < MAX_EXPENSE_CATEGORIES;

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        {items.map((c) => (
          <CategoryTile
            key={c.id}
            id={c.id}
            name={c.name}
            emoji={c.emoji}
            onPick={() => onPick(c.id, c.name)}
            onLongPress={() => setEditing({ id: c.id, name: c.name, emoji: c.emoji })}
          />
        ))}
        {canAdd && <AddTile onClick={() => setAdding(true)} />}
      </div>

      <p className="text-[11px] text-ios-hint text-center mt-3 leading-snug">
        Тап — выбрать · Удержание — редактировать
      </p>

      <CategoryQuickEdit cat={editing} totalActive={items.length} onClose={() => setEditing(null)} />
      <AddCategorySheet open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function IncomePicker({
  sources,
  accounts,
  sourcesLoading,
  accountsLoading,
  sourceId,
  onPickSource,
  onPickAccount,
  onResetSource,
}: {
  sources: { id: string; name: string; emoji?: string | null }[];
  accounts: { id: string; name: string; type: string; balance: string }[];
  sourcesLoading?: boolean;
  accountsLoading?: boolean;
  sourceId: string | null;
  onPickSource: (id: string, name: string) => void;
  onPickAccount: (id: string | null, name: string) => void;
  onResetSource: () => void;
}) {
  if (!sourceId) {
    if (sourcesLoading) {
      return (
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-square bg-ios-surface rounded-ios animate-pulse" />
          ))}
        </div>
      );
    }
    return (
      <div className="grid grid-cols-3 gap-3">
        {sources.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onPickSource(c.id, c.name)}
            className="aspect-square bg-ios-surface rounded-ios p-3 flex flex-col items-center justify-center text-center active:scale-[0.97] transition shadow-card"
          >
            <CategoryIcon name={c.name} emoji={c.emoji} size={46} />
            <span className="text-[12px] font-medium mt-1.5 line-clamp-2">{c.name}</span>
          </button>
        ))}
      </div>
    );
  }

  if (accountsLoading) {
    return <div className="text-ios-hint text-center py-10">Загрузка…</div>;
  }

  const sourceName = sources.find((s) => s.id === sourceId)?.name ?? '';

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={onResetSource}
        className="w-full text-left bg-ios-accentSoft text-ios-accent rounded-ios px-4 py-3 font-medium active:opacity-80"
      >
        ← Источник: {sourceName}
      </button>
      {accounts.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onPickAccount(a.id, a.name)}
          className="w-full flex items-center justify-between bg-ios-surface rounded-ios px-4 py-3.5 active:bg-ios-surface2 transition"
        >
          <div className="flex flex-col items-start">
            <span className="font-medium">{a.name}</span>
            <span className="text-xs text-ios-hint mt-0.5">{ACCOUNT_TYPE_LABEL[a.type]}</span>
          </div>
          <span className="text-sm text-ios-hint tabular-nums">{fmtRub(a.balance, { compact: true })}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={() => onPickAccount(null, '')}
        className="w-full text-left bg-ios-surface rounded-ios px-4 py-3.5 text-ios-hint active:bg-ios-surface2 transition"
      >
        — Без счёта (только запись операции)
      </button>
      {accounts.length === 0 && (
        <p className="text-xs text-ios-hint text-center mt-3 leading-snug">
          Нет счетов наличных или банка. Заведи их в Капитале, чтобы зачислять зарплату.
        </p>
      )}
    </div>
  );
}

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  bank: '🏦 Банк',
  cash: '💵 Наличные',
  investment: '📈 Инвестиции',
  other_asset: '🚗 Прочие',
};

function SourcePicker({
  accounts,
  loading,
  onPick,
}: {
  accounts: { id: string; name: string; type: string; balance: string }[];
  loading?: boolean;
  onPick: (id: string, name: string) => void;
}) {
  if (loading) return <div className="text-ios-hint text-center py-10">Загрузка…</div>;
  if (accounts.length === 0)
    return (
      <div className="text-ios-hint text-center py-10">
        Нет счетов для оплаты. Заведи Сбербанк/Тинькофф/Наличные в Капитале.
      </div>
    );
  return (
    <div className="space-y-1.5">
      {accounts.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onPick(a.id, a.name)}
          className="w-full flex items-center justify-between bg-ios-surface rounded-ios px-4 py-3.5 active:bg-ios-surface2 transition"
        >
          <div className="flex flex-col items-start">
            <span className="font-medium">{a.name}</span>
            <span className="text-xs text-ios-hint mt-0.5">{ACCOUNT_TYPE_LABEL[a.type]}</span>
          </div>
          <span className="text-sm text-ios-hint tabular-nums">{fmtRub(a.balance, { compact: true })}</span>
        </button>
      ))}
    </div>
  );
}

function TransferPicker({
  accounts,
  loading,
  fromId,
  onPickFrom,
  onPickTo,
  onResetFrom,
}: {
  accounts: { id: string; name: string; type: string }[];
  loading?: boolean;
  fromId: string | null;
  onPickFrom: (id: string, name: string) => void;
  onPickTo: (id: string, name: string) => void;
  onResetFrom: () => void;
}) {
  if (loading) return <div className="text-ios-hint text-center py-10">Загрузка…</div>;
  if (!fromId) {
    const from = accounts.filter((a) => a.type === 'cash' || a.type === 'bank');
    return (
      <div className="space-y-1.5">
        {from.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onPickFrom(a.id, a.name)}
            className="w-full flex items-center justify-between bg-ios-surface rounded-ios px-4 py-3.5 active:bg-ios-surface2 transition"
          >
            <span className="font-medium">{a.name}</span>
            <span className="text-ios-hint text-sm">{ACCOUNT_TYPE_LABEL[a.type]}</span>
          </button>
        ))}
      </div>
    );
  }
  const to = accounts.filter((a) => a.id !== fromId);
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={onResetFrom}
        className="w-full text-left bg-ios-accentSoft text-ios-accent rounded-ios px-4 py-3 font-medium active:opacity-80"
      >
        ← Откуда: {accounts.find((a) => a.id === fromId)?.name}
      </button>
      {to.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onPickTo(a.id, a.name)}
          className="w-full flex items-center justify-between bg-ios-surface rounded-ios px-4 py-3.5 active:bg-ios-surface2 transition"
        >
          <span className="font-medium">{a.name}</span>
          <span className="text-ios-hint text-sm">{ACCOUNT_TYPE_LABEL[a.type]}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Expense account picker — shown after the user picks an expense category.
 * Lets them choose which cash/bank account to deduct from, with the last-used
 * account pre-highlighted. "Без счёта" skips the deduction (just records the
 * expense without touching account balances).
 */
function ExpenseAccountPicker({
  accounts,
  loading,
  categoryName,
  preferredId,
  allowNoAccount = true,
  onPick,
  onReset,
}: {
  accounts: { id: string; name: string; type: string; balance: string }[];
  loading?: boolean;
  categoryName: string;
  preferredId: string | null;
  // false for credit payments — the money must leave a real account.
  allowNoAccount?: boolean;
  onPick: (id: string | null, name: string) => void;
  onReset: () => void;
}) {
  if (loading && accounts.length === 0) {
    return <div className="text-ios-hint text-center py-10">Загрузка…</div>;
  }

  // Sort: preferred first, then alphabetical.
  const sorted = [...accounts].sort((a, b) => {
    if (a.id === preferredId) return -1;
    if (b.id === preferredId) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-1.5">
      {/* Breadcrumb back to category */}
      <button
        type="button"
        onClick={onReset}
        className="w-full text-left bg-ios-accentSoft text-ios-accent rounded-ios px-4 py-3 font-medium active:opacity-80"
      >
        ← Категория: {categoryName}
      </button>

      {sorted.length === 0 ? (
        <>
          <p className="text-xs text-ios-hint text-center mt-3 leading-snug px-2">
            Нет счетов наличных или банка. Создай их в Капитале, чтобы списывать расходы.
          </p>
          <button
            type="button"
            onClick={() => onPick(null, '')}
            className="w-full text-left bg-ios-surface rounded-ios px-4 py-3.5 text-ios-hint active:bg-ios-surface2 transition"
          >
            — Записать без списания
          </button>
        </>
      ) : (
        <>
          {sorted.map((a) => {
            const isPreferred = a.id === preferredId;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onPick(a.id, a.name)}
                className={`w-full flex items-center justify-between rounded-ios px-4 py-3.5 active:opacity-80 transition ${
                  isPreferred ? 'bg-ios-accentSoft text-ios-accent' : 'bg-ios-surface active:bg-ios-surface2'
                }`}
              >
                <div className="flex flex-col items-start">
                  <span className="font-medium">{a.name}</span>
                  <span className={`text-xs mt-0.5 ${isPreferred ? 'text-ios-accent/70' : 'text-ios-hint'}`}>
                    {ACCOUNT_TYPE_LABEL[a.type]}
                    {isPreferred && ' · приоритетный'}
                  </span>
                </div>
                <span
                  className={`text-sm tabular-nums ${isPreferred ? 'text-ios-accent/80' : 'text-ios-hint'}`}
                >
                  {fmtRub(a.balance, { compact: true })}
                </span>
              </button>
            );
          })}
          {allowNoAccount && (
            <button
              type="button"
              onClick={() => onPick(null, '')}
              className="w-full text-left bg-ios-surface rounded-ios px-4 py-3.5 text-ios-hint active:bg-ios-surface2 transition"
            >
              — Без счёта (только запись операции)
            </button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Credit picker for the "Кредит" expense tile — shows every active credit with
 * its remaining debt and the scheduled monthly payment. Mirrors the info the
 * Capital tab shows so either entry point feels the same.
 */
function CreditPicker({
  credits,
  categoryName,
  onPick,
  onReset,
}: {
  credits: {
    id: string;
    name: string;
    currentPrincipal: string;
    scheduledPayment: string;
  }[];
  categoryName: string;
  onPick: (id: string, name: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={onReset}
        className="w-full text-left bg-ios-accentSoft text-ios-accent rounded-ios px-4 py-3 font-medium active:opacity-80"
      >
        ← Категория: {categoryName}
      </button>
      {credits.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(c.id, c.name)}
          className="w-full flex items-center justify-between bg-ios-surface rounded-ios px-4 py-3.5 active:bg-ios-surface2 transition"
        >
          <div className="flex flex-col items-start">
            <span className="font-medium">💳 {c.name}</span>
            <span className="text-xs text-ios-hint mt-0.5">
              платёж/мес {fmtRub(c.scheduledPayment, { compact: true })}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-sm text-ios-red tabular-nums">
              −{fmtRub(c.currentPrincipal, { compact: true })}
            </span>
            <span className="text-[11px] text-ios-hint">долг</span>
          </div>
        </button>
      ))}
      <p className="text-[11px] text-ios-hint text-center mt-2 leading-snug px-2">
        Платёж спишется со счёта в расходы: тело уменьшит долг, проценты — плата банку.
      </p>
    </div>
  );
}

function AssetMetaForm({
  name,
  assetType,
  quantity,
  onChangeName,
  onChangeType,
  onChangeQuantity,
  onBack,
  onNext,
}: {
  name: string;
  assetType: AssetType;
  quantity: number;
  onChangeName: (v: string) => void;
  onChangeType: (v: AssetType) => void;
  onChangeQuantity: (v: number) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const examples = ['Часы Tag Heuer', 'Honda Civic', 'iPhone 17 Pro', 'Облигации ОФЗ', 'Золото 50г'];
  return (
    <div className="px-4 mt-4 space-y-4">
      <div className="bg-ios-surface rounded-ios-lg p-4">
        <label className="block text-xs font-semibold uppercase text-ios-hint tracking-wider">
          Название актива
        </label>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => onChangeName(e.target.value)}
          placeholder="например, iPhone 17 Pro"
          className="w-full bg-transparent outline-none text-lg mt-2 placeholder:text-ios-hint"
        />
      </div>

      <div>
        <div className="text-xs font-semibold uppercase text-ios-hint tracking-wider px-4 mb-1.5">Тип</div>
        <div className="bg-ios-surface rounded-ios-lg p-1 grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={() => onChangeType('other_asset')}
            className={`py-3 rounded-[10px] font-medium transition flex items-center justify-center gap-2 ${
              assetType === 'other_asset' ? 'bg-ios-accent text-white' : 'text-ios-subtext'
            }`}
          >
            🚗 Прочий
          </button>
          <button
            type="button"
            onClick={() => onChangeType('investment')}
            className={`py-3 rounded-[10px] font-medium transition flex items-center justify-center gap-2 ${
              assetType === 'investment' ? 'bg-ios-accent text-white' : 'text-ios-subtext'
            }`}
          >
            📈 Инвестиция
          </button>
        </div>
        <p className="text-xs text-ios-hint mt-2 px-4 leading-snug">
          {assetType === 'investment'
            ? 'Будет учитываться в строке «Инвестиции» и в плане инвестиций за месяц.'
            : 'Считается в Net Worth как «Прочие активы». В план инвестиций не пойдёт.'}
        </p>
      </div>

      {assetType === 'other_asset' && (
        <div className="bg-ios-surface rounded-ios-lg p-4">
          <label className="block text-xs font-semibold uppercase text-ios-hint tracking-wider">
            Количество шт
          </label>
          <div className="flex items-center gap-3 mt-2">
            <button
              type="button"
              onClick={() => onChangeQuantity(Math.max(1, quantity - 1))}
              className="w-11 h-11 rounded-ios bg-ios-surface2 dark:bg-black/30 text-2xl font-semibold leading-none active:scale-95 transition"
            >
              −
            </button>
            <input
              type="text"
              inputMode="numeric"
              value={String(quantity)}
              onChange={(e) => {
                const n = parseInt(e.target.value.replace(/[^\d]/g, ''), 10);
                onChangeQuantity(Number.isFinite(n) && n >= 1 ? n : 1);
              }}
              className="flex-1 bg-transparent outline-none text-xl text-center tabular-nums font-rounded"
            />
            <button
              type="button"
              onClick={() => onChangeQuantity(quantity + 1)}
              className="w-11 h-11 rounded-ios bg-ios-surface2 dark:bg-black/30 text-2xl font-semibold leading-none active:scale-95 transition"
            >
              ＋
            </button>
          </div>
          <p className="text-[11px] text-ios-hint mt-2 leading-snug">
            {quantity >= 2
              ? 'Партия на перепродажу: дальше введи цену за штуку. Появятся «Докупить» и продажа по N шт (прибыль по FIFO).'
              : 'Оставь 1 для обычного актива. Для перепродажи поставь 2+.'}
          </p>
        </div>
      )}

      {!name && (
        <div className="bg-ios-surface rounded-ios-lg p-3">
          <div className="text-[11px] font-semibold uppercase text-ios-hint tracking-wider mb-1.5">
            Примеры
          </div>
          <div className="flex flex-wrap gap-1.5">
            {examples.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => onChangeName(ex)}
                className="text-xs bg-ios-surface2 dark:bg-black/30 text-ios-subtext rounded-full px-3 py-1.5 active:scale-95 transition"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={onBack} className="flex-1 bg-ios-surface rounded-ios py-3 font-medium">
          Назад
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!name.trim()}
          className="flex-[2] bg-ios-accent text-white rounded-ios py-3 font-semibold active:opacity-90 disabled:opacity-50"
        >
          Далее
        </button>
      </div>
    </div>
  );
}

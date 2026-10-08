import { Fragment, useEffect, useRef, useState } from 'react';
import { alertDialog, popupDialog } from '../lib/dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AccountDTO } from '../lib/api';
import { MUTATION_KEYS, newClientTxId, type SetBalanceVariables, type AddTxVariables } from '../lib/mutationDefaults';
import { Header } from '../components/Header';
import { Card, ListRow } from '../components/Card';
import { Sheet } from '../components/Sheet';
import { AmountKeypad } from '../components/AmountKeypad';
import { Achievement } from '../components/Achievement';
import { LossSheet } from '../components/LossSheet';
import { DateDivider } from '../components/DateDivider';
import { fmtRub, fmtDate, categoryEmoji, dayKey } from '../lib/format';
import { haptic } from '../lib/telegram';
import { AppIcon, TintedIcon, TYPE_TINT, type IconName } from '../components/AppIcon';

const TYPE_LABEL: Record<string, { ru: string; icon: IconName }> = {
  bank: { ru: 'Банк', icon: 'bank' },
  cash: { ru: 'Наличные', icon: 'cash' },
  investment: { ru: 'Инвестиции', icon: 'investment' },
  other_asset: { ru: 'Прочие активы', icon: 'other_asset' },
  credit: { ru: 'Кредиты', icon: 'credit' },
  credit_buffer: { ru: 'Взнос по кредиту', icon: 'credit_buffer' },
};

type Modal =
  | { kind: 'menu'; account: AccountDTO }
  | { kind: 'history'; account: AccountDTO }
  | { kind: 'loss'; account: AccountDTO }
  | { kind: 'revalue'; account: AccountDTO }
  | { kind: 'investments'; account: AccountDTO }
  | { kind: 'restock'; account: AccountDTO }
  | { kind: 'sellUnits'; account: AccountDTO }
  | { kind: 'balance'; account: AccountDTO }
  | { kind: 'rename'; account: AccountDTO }
  | { kind: 'sell'; account: AccountDTO }
  | { kind: 'prepayment'; account: AccountDTO }
  | { kind: 'topUp'; account: AccountDTO }
  | { kind: 'confirmDelete'; account: AccountDTO }
  | { kind: 'addBank' }
  | { kind: 'addCredit' };

/** Swap the space before "₽" for a no-break space so the sign never wraps alone. */
function glueRub(s: string): string {
  return s.replace(/ ₽$/, '\u00a0₽');
}

export function CapitalPage() {
  const cap = useQuery({ queryKey: ['capital'], queryFn: api.capital, staleTime: 15_000 });
  const [modal, setModal] = useState<Modal | null>(null);
  const [achievement, setAchievement] = useState<{ amount: string; total?: string; title?: string } | null>(null);
  // Default headline = gross assets (WITHOUT debts). Tap the «Кредиты» tile to
  // switch to net worth WITH debts subtracted.
  const [showWithDebts, setShowWithDebts] = useState(false);

  if (cap.isLoading || !cap.data)
    return (
      <div className="p-4 space-y-4">
        <div className="h-8 w-32 bg-ios-surface rounded-md animate-pulse" />
        <div className="h-40 bg-ios-surface rounded-ios-lg animate-pulse" />
      </div>
    );

  const c = cap.data;
  // Debts are stored as a positive total and subtracted inside totalNetWorth, so
  // gross assets (net worth ignoring credits) = net worth + credits back.
  const hasDebts = parseFloat(c.totalCredits) > 0;
  const grossAssets = parseFloat(c.totalNetWorth) + parseFloat(c.totalCredits);
  const groups = new Map<string, AccountDTO[]>();
  for (const a of c.accounts) {
    const arr = groups.get(a.type) ?? [];
    arr.push(a);
    groups.set(a.type, arr);
  }
  const orderedTypes = ['bank', 'cash', 'investment', 'other_asset', 'credit', 'credit_buffer'].filter(
    (t) => groups.has(t),
  );

  return (
    <div className="pb-28">
      <Header
        title="Капитал"
        right={
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                haptic('light');
                setModal({ kind: 'addCredit' });
              }}
              className="text-ios-accent text-base font-medium select-none-ui"
            >
              ＋ Кредит
            </button>
            <button
              onClick={() => {
                haptic('light');
                setModal({ kind: 'addBank' });
              }}
              className="text-ios-accent text-base font-medium select-none-ui"
            >
              ＋ Счёт
            </button>
          </div>
        }
      />

      <div className="px-4">
        <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 text-white rounded-ios-lg p-5 shadow-lg">
          <div className="text-sm opacity-80">{hasDebts && showWithDebts ? 'С учётом кредитов' : 'Net Worth'}</div>
          {/* Fluid size: exactly text-4xl (36px) from 375px wide, a bit smaller on
              narrower phones so a 7-digit amount fits on one line; ₽ is glued to
              the number so it never wraps onto a line of its own. */}
          <div className="text-[length:clamp(1.75rem,9.6vw,2.25rem)] leading-10 font-rounded font-bold mt-1 tabular-nums">
            {glueRub(fmtRub(hasDebts && showWithDebts ? c.totalNetWorth : grossAssets))}
          </div>
          {hasDebts && showWithDebts && (
            <div className="text-[12px] opacity-80 mt-1">без кредитов — {fmtRub(grossAssets, { compact: true })}</div>
          )}
          <div className={`mt-3 grid gap-2 text-[12px] ${hasDebts ? 'grid-cols-2 min-[360px]:grid-cols-4' : 'grid-cols-3'}`}>
            <div className="bg-white/15 rounded-md px-2 py-1.5">
              <div className="opacity-80">Деньги</div>
              <div className="font-semibold tabular-nums mt-0.5 whitespace-nowrap">{fmtRub(c.totalCash, { compact: true })}</div>
            </div>
            <div className="bg-white/15 rounded-md px-2 py-1.5">
              <div className="opacity-80">Инвест.</div>
              <div className="font-semibold tabular-nums mt-0.5 whitespace-nowrap">{fmtRub(c.totalInvestments, { compact: true })}</div>
            </div>
            <div className="bg-white/15 rounded-md px-2 py-1.5">
              <div className="opacity-80">Прочие</div>
              <div className="font-semibold tabular-nums mt-0.5 whitespace-nowrap">{fmtRub(c.totalOther, { compact: true })}</div>
            </div>
            {hasDebts && (
              <button
                type="button"
                onClick={() => {
                  haptic('light');
                  setShowWithDebts((v) => !v);
                }}
                className={`rounded-md px-2 py-1.5 text-left transition select-none-ui ${
                  showWithDebts ? 'bg-white/90 text-rose-700 ring-2 ring-white' : 'bg-rose-500/30'
                }`}
              >
                <div className="opacity-80">Кредиты</div>
                <div className="font-semibold tabular-nums mt-0.5 whitespace-nowrap">−{fmtRub(c.totalCredits, { compact: true })}</div>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5">
        {orderedTypes.map((t) => {
          const list = groups.get(t)!;
          const groupTotal = list.reduce((s, a) => s + parseFloat(a.balance || '0'), 0);
          const meta = TYPE_LABEL[t];
          return (
            <Card key={t} title={meta.ru}>
              {list.map((a, i) => (
                <ListRow
                  key={a.id}
                  divider={i !== list.length - 1}
                  onClick={() => {
                    haptic('light');
                    setModal({ kind: 'menu', account: a });
                  }}
                  left={
                    <div className="flex items-center gap-3">
                      <TintedIcon name={meta.icon} tint={TYPE_TINT[t] ?? 'accent'} size={34} />
                      <div>
                        <div className="font-medium">{a.name}</div>
                        {a.quantity != null && (
                          <div className="text-[11px] text-ios-hint mt-0.5">{a.quantity} шт</div>
                        )}
                        {a.type === 'credit_buffer' && (
                          <div className="text-[11px] text-ios-hint mt-0.5">
                            накоплено к платежу
                          </div>
                        )}
                      </div>
                    </div>
                  }
                  right={
                    <span
                      className={`tabular-nums ${
                        a.type === 'credit'
                          ? 'text-ios-red'
                          : a.type === 'credit_buffer'
                            ? 'text-ios-green'
                            : 'text-ios-text'
                      }`}
                    >
                      {a.type === 'credit' ? `−${fmtRub(a.balance)}` : fmtRub(a.balance)}
                    </span>
                  }
                />
              ))}
              {list.length > 1 && (
                <div className="px-4 py-2 flex justify-between text-sm border-t border-ios-divider">
                  <span className="text-ios-hint">Подытог</span>
                  <span className="tabular-nums font-medium">{fmtRub(groupTotal)}</span>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <ActionMenu
        modal={modal}
        onClose={() => setModal(null)}
        onPick={(next) => setModal(next)}
      />
      <AccountHistorySheet modal={modal} onClose={() => setModal(null)} />
      <LossSheet
        open={modal?.kind === 'loss'}
        onClose={() => setModal(null)}
        defaultComment={modal?.kind === 'loss' ? `Убыток: ${modal.account.name}` : undefined}
      />
      <RestockSheet modal={modal} onClose={() => setModal(null)} accounts={c.accounts} />
      <SellUnitsSheet modal={modal} onClose={() => setModal(null)} accounts={c.accounts} />
      <BalanceEditor
        modal={modal}
        onClose={() => setModal(null)}
        onAchievement={(payload) => setAchievement(payload)}
        accounts={c.accounts}
      />
      <RenameEditor modal={modal} onClose={() => setModal(null)} />
      <RevalueEditor modal={modal} onClose={() => setModal(null)} />
      <InvestmentsSheet modal={modal} onClose={() => setModal(null)} />
      <SellEditor modal={modal} onClose={() => setModal(null)} accounts={c.accounts} />
      <PrepaymentEditor modal={modal} onClose={() => setModal(null)} accounts={c.accounts} />
      <TopUpEditor
        modal={modal}
        onClose={() => setModal(null)}
        accounts={c.accounts}
        onAchievement={(payload) => setAchievement(payload)}
      />
      <ConfirmDelete modal={modal} onClose={() => setModal(null)} />
      <AddBankSheet modal={modal} onClose={() => setModal(null)} />
      <AddCreditSheet modal={modal} onClose={() => setModal(null)} />

      <Achievement
        open={!!achievement}
        onClose={() => setAchievement(null)}
        amount={achievement?.amount ?? '0'}
        totalAfter={achievement?.total}
        title={achievement?.title ?? 'Прирост инвестиций!'}
        emoji="📈"
      />
    </div>
  );
}

// ─── Action menu (rename / sell / hide / set balance) ────────────────────

function ActionMenu({
  modal,
  onClose,
  onPick,
}: {
  modal: Modal | null;
  onClose: () => void;
  onPick: (next: Modal) => void;
}) {
  const qc = useQueryClient();
  const menuAccount = modal?.kind === 'menu' ? modal.account : null;
  const classify = useMutation({
    mutationFn: (liability: boolean) => api.setAssetClassification(menuAccount!.id, liability),
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['capital'] });
      qc.invalidateQueries({ queryKey: ['asset-investments', menuAccount?.id] });
    },
  });

  if (modal?.kind !== 'menu') return null;
  const a = modal.account;
  const isAsset = a.type === 'investment' || a.type === 'other_asset';
  const isCredit = a.type === 'credit';
  const isCreditBuffer = a.type === 'credit_buffer';
  // Lot-based resale position (bought in quantities) — has a unit count.
  const isLotPosition = a.quantity != null;

  return (
    <Sheet open onClose={onClose} title={a.name}>
      <div className="px-4 py-2">
        <div className="text-center text-sm text-ios-hint mb-3">
          {TYPE_LABEL[a.type]?.ru} · {isCredit ? `−${fmtRub(a.balance)}` : fmtRub(a.balance)}
          {isAsset && (a.liability ? ' · 🔴 Пассив' : ' · 🟢 Актив')}
        </div>
        <div className="flex flex-col gap-1.5">
          <ActionBtn
            icon="📜"
            label="Движения по счёту"
            onClick={() => onPick({ kind: 'history', account: a })}
          />
          {isCredit && (
            <div className="text-center text-xs text-ios-hint px-4 py-2 leading-snug">
              Платёж по кредиту вносится через ➕ → «Кредит»: спишется со счёта в
              расходы, тело долга уменьшится, проценты уйдут банку.
            </div>
          )}
          {!isCredit && !isCreditBuffer && !isLotPosition && (
            <ActionBtn
              icon="💰"
              label="Обновить остаток"
              onClick={() => onPick({ kind: 'balance', account: a })}
            />
          )}
          {!isCreditBuffer && (
            <ActionBtn
              icon="✏️"
              label="Переименовать"
              onClick={() => onPick({ kind: 'rename', account: a })}
            />
          )}
          {a.type === 'investment' && (
            <ActionBtn
              icon="📥"
              label="Пополнить"
              onClick={() => onPick({ kind: 'topUp', account: a })}
            />
          )}
          {isLotPosition && (
            <ActionBtn
              icon="➕"
              label="Докупить"
              onClick={() => onPick({ kind: 'restock', account: a })}
            />
          )}
          {isLotPosition && (
            <ActionBtn
              icon="💱"
              label={`Продать (${a.quantity} шт)`}
              onClick={() => onPick({ kind: 'sellUnits', account: a })}
            />
          )}
          {isAsset && !isLotPosition && (
            <ActionBtn
              icon="💱"
              label="Продать"
              onClick={() => onPick({ kind: 'sell', account: a })}
            />
          )}
          {isAsset && !isLotPosition && (
            <ActionBtn
              icon="💸"
              label="Получить предоплату"
              onClick={() => onPick({ kind: 'prepayment', account: a })}
            />
          )}
          {isAsset && (
            <ActionBtn
              icon={a.liability ? '🔴' : '🟢'}
              label={a.liability ? 'Пассив → сделать Активом' : 'Актив → сделать Пассивом'}
              onClick={() => {
                classify.mutate(!a.liability);
                onClose();
              }}
            />
          )}
          {isAsset && (
            <ActionBtn
              icon="🧰"
              label="Вложения в технику"
              onClick={() => onPick({ kind: 'investments', account: a })}
            />
          )}
          {isAsset && !isLotPosition && (
            <ActionBtn
              icon="📊"
              label="Переоценка стоимости"
              onClick={() => onPick({ kind: 'revalue', account: a })}
            />
          )}
          {isAsset && (
            <ActionBtn
              icon="🔻"
              label="Зафиксировать убыток"
              onClick={() => onPick({ kind: 'loss', account: a })}
            />
          )}
          {!isCreditBuffer && (
            <ActionBtn
              icon="🗑"
              label="Удалить"
              danger
              onClick={() => onPick({ kind: 'confirmDelete', account: a })}
            />
          )}
          {isCreditBuffer && (
            <div className="text-center text-xs text-ios-hint px-4 py-3 leading-snug">
              Это вспомогательный счёт для платежей по кредиту. Удалить можно
              только сам кредит — взнос исчезнет вместе с ним.
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}

// ─── Account movement history (transactions touching this account) ───────

function AccountHistorySheet({
  modal,
  onClose,
}: {
  modal: Modal | null;
  onClose: () => void;
}) {
  const acct = modal?.kind === 'history' ? modal.account : null;

  // Movements = all transactions where this account is the source or the
  // destination. The backend filters by accountId; we only decide the sign
  // here (money IN if the account is the destination, OUT if it's the source).
  const q = useQuery({
    queryKey: ['acct-history', acct?.id],
    queryFn: () => api.transactions({ accountId: acct!.id, limit: 300 }),
    enabled: modal?.kind === 'history' && !!acct,
    staleTime: 15_000,
  });

  if (modal?.kind !== 'history' || !acct) return null;
  const items = q.data ?? [];

  return (
    <Sheet open onClose={onClose} title={`Движения: ${acct.name}`}>
      <div className="pb-4">
        {/* Header with the account-type icon so it's instantly clear which
            kind of account (bank / cash / investment / credit…) we're looking at. */}
        <div className="px-4 py-3 flex items-center gap-3 border-b border-ios-divider">
          <TintedIcon
            name={TYPE_LABEL[acct.type]?.icon ?? 'credit'}
            tint={TYPE_TINT[acct.type] ?? 'accent'}
            size={38}
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{TYPE_LABEL[acct.type]?.ru ?? 'Счёт'}</div>
            <div className="text-[12px] text-ios-hint tabular-nums">
              {acct.type === 'credit' ? `Долг: −${fmtRub(acct.balance)}` : `Текущий остаток: ${fmtRub(acct.balance)}`}
            </div>
          </div>
        </div>

        {q.isLoading ? (
          <div className="px-4 pt-3 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 bg-ios-surface rounded animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-ios-hint text-sm">
            Движений по счёту пока нет
          </div>
        ) : (
          items.map((t, i) => {
            // Sign is relative to THIS account: + when the money landed here
            // (account is the destination), − when it left (account is source).
            const incoming = t.toAccountId === acct.id;
            // The "other side" of the movement: category for an expense, source
            // for an income, the counterpart account for a transfer.
            const label =
              (t.type === 'asset_revaluation'
                ? incoming
                  ? 'Прирост стоимости'
                  : 'Обесценивание'
                : null) ??
              t.categoryName ??
              t.incomeSourceName ??
              (incoming ? t.fromAccountName : t.toAccountName) ??
              '—';
            const showHeader = i === 0 || dayKey(t.date) !== dayKey(items[i - 1].date);
            return (
              <Fragment key={t.id}>
                {showHeader && <DateDivider iso={t.date} />}
                <div
                  className={`flex items-center gap-3 px-4 py-3 ${
                    i !== items.length - 1 ? 'border-b border-ios-divider' : ''
                  }`}
                >
                  <span className="text-xl shrink-0">{categoryEmoji(label)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{label}</div>
                    <div className="text-[11px] text-ios-hint">
                      {fmtDate(t.date)}
                      {t.comment ? ` · ${t.comment}` : ''}
                    </div>
                  </div>
                  <span
                    className={`text-sm font-semibold tabular-nums shrink-0 ${
                      incoming ? 'text-ios-green' : ''
                    }`}
                  >
                    {incoming ? '+' : '−'}
                    {fmtRub(t.amount, { compact: true })}
                  </span>
                </div>
              </Fragment>
            );
          })
        )}
      </div>
    </Sheet>
  );
}

// ─── Quantity stepper (used by restock / sell-units) ────────────────────

function QtyStepper({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max?: number;
}) {
  const clamp = (n: number) => Math.max(1, Math.min(max ?? Number.MAX_SAFE_INTEGER, n));
  return (
    <div className="bg-ios-surface rounded-ios-lg p-4">
      <label className="block text-xs font-semibold uppercase text-ios-hint tracking-wider">{label}</label>
      <div className="flex items-center gap-3 mt-2">
        <button
          type="button"
          onClick={() => onChange(clamp(value - 1))}
          className="w-11 h-11 rounded-ios bg-ios-surface2 dark:bg-black/30 text-2xl font-semibold leading-none active:scale-95 transition"
        >
          −
        </button>
        <input
          type="text"
          inputMode="numeric"
          value={String(value)}
          onChange={(e) => {
            const n = parseInt(e.target.value.replace(/[^\d]/g, ''), 10);
            onChange(Number.isFinite(n) ? clamp(n) : 1);
          }}
          className="flex-1 bg-transparent outline-none text-xl text-center tabular-nums font-rounded"
        />
        <button
          type="button"
          onClick={() => onChange(clamp(value + 1))}
          className="w-11 h-11 rounded-ios bg-ios-surface2 dark:bg-black/30 text-2xl font-semibold leading-none active:scale-95 transition"
        >
          ＋
        </button>
      </div>
      {max != null && <p className="text-[11px] text-ios-hint mt-2">Доступно: {max} шт</p>}
    </div>
  );
}

// ─── Restock ("докупить"): add a new lot to a resale position ────────────

function RestockSheet({
  modal,
  onClose,
  accounts,
}: {
  modal: Modal | null;
  onClose: () => void;
  accounts: AccountDTO[];
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<'pickSource' | 'amount'>('pickSource');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [qty, setQty] = useState(1);
  const txIdRef = useRef<string>('');

  const m = useMutation({
    onMutate: () => {
      txIdRef.current = newClientTxId();
    },
    mutationFn: (unitPrice: string) => {
      if (modal?.kind !== 'restock' || !sourceId) throw new Error('no params');
      return api.restockAsset(modal.account.id, {
        quantity: qty,
        unitPrice,
        fromAccountId: sourceId,
        clientTxId: txIdRef.current,
      });
    },
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['capital'] });
      qc.invalidateQueries({ queryKey: ['bootstrap'] });
      qc.invalidateQueries({ queryKey: ['txs-all'] });
      reset();
      onClose();
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  const reset = () => {
    setStep('pickSource');
    setSourceId(null);
    setSourceName('');
    setQty(1);
  };

  if (modal?.kind !== 'restock') return null;
  const pos = modal.account;
  const cashAccounts = accounts.filter((x) => x.type === 'cash' || x.type === 'bank');

  return (
    <Sheet open onClose={() => { reset(); onClose(); }} title={`Докупить: ${pos.name}`}>
      {step === 'pickSource' && (
        <div className="px-4 pb-4 pt-2 space-y-4">
          <div className="text-sm text-ios-hint leading-snug">
            Новая партия добавится к позиции (можно по другой цене). Деньги спишутся со счёта.
          </div>
          <QtyStepper label="Количество шт" value={qty} onChange={setQty} />
          <div>
            <div className="text-xs font-semibold uppercase text-ios-hint tracking-wider mb-2">Откуда оплачиваем</div>
            {cashAccounts.length === 0 ? (
              <p className="text-center text-ios-hint py-6 text-sm">Нет счетов наличных или банка.</p>
            ) : (
              <div className="space-y-1.5">
                {cashAccounts.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => {
                      setSourceId(x.id);
                      setSourceName(x.name);
                      setStep('amount');
                      haptic('select');
                    }}
                    className="w-full flex items-center justify-between bg-ios-surface rounded-ios px-4 py-3.5 active:bg-ios-surface2 transition"
                  >
                    <span className="font-medium">{x.name}</span>
                    <span className="text-sm text-ios-hint tabular-nums">{fmtRub(x.balance)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {step === 'amount' && (
        <AmountKeypad
          onSubmit={(v) => m.mutate(v)}
          submitLabel={`Докупить ${qty} шт`}
          busy={m.isPending}
          hint={`цена за штуку · ${qty} шт из «${sourceName}»`}
          onBack={() => setStep('pickSource')}
        />
      )}
    </Sheet>
  );
}

// ─── Sell units by FIFO from a resale position ───────────────────────────

function SellUnitsSheet({
  modal,
  onClose,
  accounts,
}: {
  modal: Modal | null;
  onClose: () => void;
  accounts: AccountDTO[];
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<'form' | 'amount'>('form');
  const [destId, setDestId] = useState<string | null>(null);
  const [destName, setDestName] = useState('');
  const [qty, setQty] = useState(1);
  const txIdRef = useRef<string>('');

  const available = modal?.kind === 'sellUnits' ? modal.account.quantity ?? 0 : 0;
  const posId = modal?.kind === 'sellUnits' ? modal.account.id : null;

  // Default the quantity to the whole remaining stock when the sheet opens.
  useEffect(() => {
    if (modal?.kind === 'sellUnits') setQty(Math.max(1, modal.account.quantity ?? 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posId]);

  const m = useMutation({
    onMutate: () => {
      txIdRef.current = newClientTxId();
    },
    mutationFn: (saleAmount: string) => {
      if (modal?.kind !== 'sellUnits' || !destId) throw new Error('no params');
      return api.sellUnits(modal.account.id, {
        quantity: qty,
        saleAmount,
        toAccountId: destId,
        clientTxId: txIdRef.current,
      });
    },
    onSuccess: (res) => {
      haptic('success');
      qc.invalidateQueries();
      const profit = parseFloat(res.profit);
      alertDialog(
        `Продано ${res.quantity} шт «${pos.name}»\n` +
          `Выручка: ${fmtRub(res.saleAmount)}\n` +
          `Себестоимость (FIFO): ${fmtRub(res.costBasis)}\n` +
          (profit > 0
            ? `Прибыль: +${fmtRub(profit)}`
            : profit < 0
              ? `Убыток: ${fmtRub(profit)}`
              : 'Без прибыли') +
          (res.closed ? '\nПозиция закрыта ✅' : `\nОстаток: ${res.remainingQuantity} шт`),
      );
      reset();
      onClose();
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  const reset = () => {
    setStep('form');
    setDestId(null);
    setDestName('');
  };

  if (modal?.kind !== 'sellUnits') return null;
  const pos = modal.account;
  const cashAccounts = accounts.filter((x) => x.type === 'cash' || x.type === 'bank');

  return (
    <Sheet open onClose={() => { reset(); onClose(); }} title={`Продать: ${pos.name}`}>
      {step === 'form' && (
        <div className="px-4 pb-4 pt-2 space-y-4">
          <div className="text-sm text-ios-hint leading-snug">
            Прибыль считается по FIFO — сначала списываются ранние партии. Сколько штук и на какой счёт?
          </div>
          <QtyStepper label="Сколько продать" value={qty} onChange={setQty} max={available} />
          <div>
            <div className="text-xs font-semibold uppercase text-ios-hint tracking-wider mb-2">Куда зачислить</div>
            {cashAccounts.length === 0 ? (
              <p className="text-center text-ios-hint py-6 text-sm">Нет счетов наличных или банка.</p>
            ) : (
              <div className="space-y-1.5">
                {cashAccounts.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => {
                      setDestId(x.id);
                      setDestName(x.name);
                      setStep('amount');
                      haptic('select');
                    }}
                    className="w-full flex items-center justify-between bg-ios-surface rounded-ios px-4 py-3.5 active:bg-ios-surface2 transition"
                  >
                    <span className="font-medium">{x.name}</span>
                    <span className="text-sm text-ios-hint tabular-nums">{fmtRub(x.balance)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {step === 'amount' && (
        <AmountKeypad
          onSubmit={(v) => m.mutate(v)}
          submitLabel={`Продать ${qty} шт → ${destName}`}
          busy={m.isPending}
          hint={`общая выручка за ${qty} шт`}
          onBack={() => setStep('form')}
        />
      )}
    </Sheet>
  );
}

// ─── Top-up investment account (transfer cash/bank → investment) ─────────

function TopUpEditor({
  modal,
  onClose,
  accounts,
  onAchievement,
}: {
  modal: Modal | null;
  onClose: () => void;
  accounts: AccountDTO[];
  onAchievement: (a: { amount: string; total?: string; title?: string }) => void;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<'pickSource' | 'amount'>('pickSource');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState<string>('');

  // Reuse the offline-capable addTx mutation key — transfers are persisted and
  // replayed on reconnect just like expenses/income from the Add page.
  const m = useMutation<unknown, Error, AddTxVariables>({
    mutationKey: MUTATION_KEYS.addTx,
    onSuccess: (_data, vars) => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['capital'] });
      qc.invalidateQueries({ queryKey: ['bootstrap'] });
      qc.invalidateQueries({ queryKey: ['txs-all'] });

      if (modal?.kind === 'topUp' && vars.kind === 'transfer') {
        const investTotal = accounts
          .filter((a) => a.type === 'investment')
          .reduce((s, a) => s + parseFloat(a.balance || '0'), 0);
        onAchievement({
          amount: String(vars.amount),
          total: String(investTotal + parseFloat(String(vars.amount))),
          title: `Пополнение "${modal.account.name}"`,
        });
      }
      reset();
      onClose();
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  useEffect(() => {
    if (m.isPaused) {
      haptic('success');
      popupDialog({
        message: '📌 Сохранено локально — отправится когда вернётся сеть',
      });
      reset();
      onClose();
      m.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.isPaused]);

  const reset = () => {
    setStep('pickSource');
    setSourceId(null);
    setSourceName('');
  };

  if (modal?.kind !== 'topUp') return null;
  const investment = modal.account;
  const cashAccounts = accounts.filter((a) => a.type === 'cash' || a.type === 'bank');

  return (
    <Sheet
      open
      onClose={() => { reset(); onClose(); }}
      title={`Пополнить "${investment.name}"`}
    >
      {step === 'pickSource' && (
        <div className="px-4 pb-4 pt-2">
          <div className="text-sm text-ios-hint mb-3">
            Откуда переводим? Деньги спишутся со счёта и прибавятся к инвестициям.
          </div>
          {cashAccounts.length === 0 ? (
            <p className="text-center text-ios-hint py-6 text-sm">
              Нет счетов наличных или банка. Создай их в Капитале.
            </p>
          ) : (
            <div className="space-y-1.5">
              {cashAccounts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setSourceId(a.id);
                    setSourceName(a.name);
                    setStep('amount');
                    haptic('select');
                  }}
                  className="w-full flex items-center justify-between bg-ios-surface rounded-ios px-4 py-3.5 active:bg-ios-surface2 transition"
                >
                  <div className="flex flex-col items-start">
                    <span className="font-medium">{a.name}</span>
                    <span className="text-xs text-ios-hint mt-0.5">{TYPE_LABEL[a.type]?.ru}</span>
                  </div>
                  <span className="text-sm text-ios-hint tabular-nums">{fmtRub(a.balance)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {step === 'amount' && (
        <AmountKeypad
          onSubmit={(v) => {
            if (!sourceId) return;
            m.mutate({
              kind: 'transfer',
              fromAccountId: sourceId,
              toAccountId: investment.id,
              amount: v,
              type: 'transfer_to_investment',
              clientTxId: newClientTxId(),
            });
          }}
          submitLabel={`${sourceName} → ${investment.name}`}
          busy={m.isPending}
          hint={`из «${sourceName}» в «${investment.name}»`}
          onBack={() => setStep('pickSource')}
        />
      )}
    </Sheet>
  );
}

// ─── Inline confirm view inside the bottom-sheet (no tg.showConfirm) ────

function ConfirmDelete({
  modal,
  onClose,
}: {
  modal: Modal | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  // Look up the number of transactions BEFORE the user picks an action. This
  // way they see what's at stake AND we can route a clean account through
  // hard-delete without an extra prompt. Fetches only when the dialog opens.
  const txCount = useQuery({
    queryKey: ['accounts', modal?.kind === 'confirmDelete' ? modal.account.id : null, 'tx-count'],
    queryFn: () => {
      if (modal?.kind !== 'confirmDelete') throw new Error('no modal');
      return api.accountTxCount(modal.account.id);
    },
    enabled: modal?.kind === 'confirmDelete',
    staleTime: 5_000,
  });

  // Optimistic removal from all account-related caches — runs both for
  // soft-delete and for purge.
  const optimisticRemove = (deletedId: string) => {
    qc.setQueryData<{
      accounts: AccountDTO[];
      totalCash: string;
      totalInvestments: string;
      totalOther: string;
      totalCredits: string;
      totalCreditBuffers: string;
      totalNetWorth: string;
    } | undefined>(['capital'], (prev) => {
      if (!prev) return prev;
      return { ...prev, accounts: prev.accounts.filter((a) => a.id !== deletedId) };
    });
    qc.setQueryData<AccountDTO[] | undefined>(['accounts'], (prev) => {
      if (!prev) return prev;
      return prev.filter((a) => a.id !== deletedId);
    });
    qc.setQueryData<
      { id: string; name: string; type: string; txCount: number }[] | undefined
    >(['accounts', 'hidden'], (prev) => {
      if (!prev) return prev;
      return prev.filter((a) => a.id !== deletedId);
    });
  };

  const refetchAll = () =>
    Promise.all([
      qc.refetchQueries({ queryKey: ['capital'] }),
      qc.refetchQueries({ queryKey: ['bootstrap'] }),
      qc.refetchQueries({ queryKey: ['accounts'] }),
      qc.refetchQueries({ queryKey: ['accounts', 'hidden'] }),
      qc.refetchQueries({ queryKey: ['txs-all'] }),
      qc.refetchQueries({ queryKey: ['budget'] }),
    ]);

  // Smart delete (hard-delete if no tx, soft-hide if has tx). Used for clean
  // accounts AND as a deliberate "hide for now" option when there are tx.
  const softDelete = useMutation({
    mutationFn: () => {
      if (modal?.kind !== 'confirmDelete') throw new Error('no account');
      return api.deleteAccount(modal.account.id);
    },
    onSuccess: async (res) => {
      haptic('warning');
      if (modal?.kind === 'confirmDelete') optimisticRemove(modal.account.id);
      await refetchAll();
      onClose();
      if (res.action === 'hidden') {
        alertDialog(
          'Счёт скрыт. История сохранена. Если нужно стереть навсегда — вернись и выбери «Удалить навсегда».',
        );
      }
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  // Purge — atomic nuke of the account AND every linked transaction.
  // This is now the recommended path when the user explicitly confirms
  // deletion of an account that has history — prevents the
  // "deleted account silently reappears" perception entirely.
  const purge = useMutation({
    mutationFn: () => {
      if (modal?.kind !== 'confirmDelete') throw new Error('no account');
      return api.purgeAccount(modal.account.id);
    },
    onSuccess: async (res) => {
      haptic('warning');
      if (modal?.kind === 'confirmDelete') optimisticRemove(modal.account.id);
      await refetchAll();
      onClose();
      alertDialog(
        res.deletedTransactions > 0
          ? `Счёт и ${res.deletedTransactions} операций удалены навсегда.`
          : 'Счёт удалён.',
      );
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  if (modal?.kind !== 'confirmDelete') return null;
  const a = modal.account;
  const n = txCount.data?.count ?? null;
  const loading = txCount.isLoading;
  const busy = softDelete.isPending || purge.isPending;
  const hasTransactions = n !== null && n > 0;

  return (
    <Sheet open onClose={onClose} title="Удалить счёт?">
      <div className="px-4 pb-4 pt-1 space-y-3">
        <div className="bg-ios-surface rounded-ios-lg p-4 text-center">
          <div className="flex justify-center mb-2">
            <TintedIcon
              name={TYPE_LABEL[a.type]?.icon ?? 'credit'}
              tint={TYPE_TINT[a.type] ?? 'accent'}
              size={44}
            />
          </div>
          <div className="font-medium text-base">{a.name}</div>
          <div className="text-sm text-ios-hint mt-0.5">{fmtRub(a.balance)}</div>
          {loading ? (
            <div className="text-xs text-ios-hint mt-2">Считаю операции…</div>
          ) : hasTransactions ? (
            <div className="text-xs text-ios-hint mt-2">
              Связано <span className="font-semibold text-ios-text">{n}</span>{' '}
              {n === 1 ? 'операция' : 'операций'}
            </div>
          ) : (
            <div className="text-xs text-ios-hint mt-2">Операций нет</div>
          )}
        </div>

        {/* When there are no transactions, a single Delete button is enough.
            Otherwise we ALWAYS offer purge as the prominent option so the
            user gets exactly what they asked for, and keep "Скрыть" as a
            secondary opt-in instead of the silent default. */}
        {!loading && !hasTransactions && (
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-ios-surface rounded-ios py-3 font-medium"
            >
              Отмена
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => softDelete.mutate()}
              className="flex-[2] bg-ios-red text-white rounded-ios py-3 font-semibold disabled:opacity-60"
            >
              {busy ? '…' : 'Удалить'}
            </button>
          </div>
        )}

        {!loading && hasTransactions && (
          <div className="space-y-2">
            <div className="text-sm text-ios-subtext leading-snug px-1">
              Выбери, что сделать со счётом и его историей:
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => purge.mutate()}
              className="w-full bg-ios-red text-white rounded-ios py-3 font-semibold active:opacity-90 disabled:opacity-60"
            >
              🗑 Удалить навсегда вместе с {n} операциями
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => softDelete.mutate()}
              className="w-full bg-ios-surface text-ios-subtext rounded-ios py-3 font-medium active:bg-ios-surface2 disabled:opacity-60"
            >
              Скрыть (история сохранится, можно вернуть)
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-full text-ios-accent text-sm font-medium py-2"
            >
              Отмена
            </button>
          </div>
        )}
      </div>
    </Sheet>
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

// ─── Balance editor (with achievement on investment top-up) ──────────────

function BalanceEditor({
  modal,
  onClose,
  onAchievement,
  accounts,
}: {
  modal: Modal | null;
  onClose: () => void;
  onAchievement: (a: { amount: string; total?: string; title?: string }) => void;
  accounts: AccountDTO[];
}) {
  const qc = useQueryClient();

  // Offline-capable via mutationKey + setMutationDefaults. variables stays
  // serializable so paused mutation can rehydrate from localStorage.
  const m = useMutation<unknown, Error, SetBalanceVariables>({
    mutationKey: MUTATION_KEYS.setBalance,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['capital'] });
      qc.invalidateQueries({ queryKey: ['bootstrap'] });
    },
  });

  // Achievement (investment top-up celebration) handled separately because
  // it depends on derived state that doesn't survive offline replay.
  const onSubmit = (amountInput: string) => {
    if (modal?.kind !== 'balance') return;
    const a = modal.account;
    const previousBalance = parseFloat(a.balance || '0');
    const newBalance = parseFloat(amountInput.replace(',', '.'));
    const delta = newBalance - previousBalance;

    // Optimistically update Capital in cache so the user sees the new value
    // immediately (works whether online, offline, or replaying).
    qc.setQueryData<{
      accounts: AccountDTO[];
      totalCash: string;
      totalInvestments: string;
      totalOther: string;
      totalNetWorth: string;
    } | undefined>(['capital'], (prev) => {
      if (!prev) return prev;
      const nextAccs = prev.accounts.map((acc) =>
        acc.id === a.id ? { ...acc, balance: amountInput } : acc,
      );
      const sumBy = (t: string) =>
        nextAccs.filter((x) => x.type === t).reduce((s, x) => s + parseFloat(x.balance || '0'), 0);
      const cash = sumBy('cash') + sumBy('bank');
      const invest = sumBy('investment');
      const other = sumBy('other_asset');
      return {
        ...prev,
        accounts: nextAccs,
        totalCash: String(cash),
        totalInvestments: String(invest),
        totalOther: String(other),
        totalNetWorth: String(cash + invest + other),
      };
    });

    m.mutate({ accountId: a.id, balance: amountInput });

    if (a.type === 'investment' && delta > 0) {
      const newInvestTotal = accounts
        .filter((x) => x.type === 'investment')
        .reduce((s, x) => s + (x.id === a.id ? newBalance : parseFloat(x.balance || '0')), 0);
      onAchievement({
        amount: String(delta),
        total: String(newInvestTotal),
        title: `Капитал в "${a.name}" вырос!`,
      });
    } else {
      haptic('success');
    }
    onClose();
  };

  // Offline ack — when paused, we've already optimistically updated the cache
  // and the form is closed, so just briefly notify the user.
  useEffect(() => {
    if (m.isPaused) {
      popupDialog({
        message: '📌 Сохранено локально — отправится когда вернётся сеть',
      });
      m.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.isPaused]);

  if (modal?.kind !== 'balance') return null;
  const a = modal.account;
  return (
    <Sheet open onClose={onClose} title={`Остаток: ${a.name}`}>
      <AmountKeypad
        initial={(a.balance && a.balance !== '0' ? a.balance : '').replace('.', ',')}
        onSubmit={onSubmit}
        submitLabel="Сохранить"
        busy={m.isPending}
        hint={
          a.type === 'investment'
            ? 'Любое увеличение засчитается как прирост 📈'
            : 'новый текущий остаток'
        }
      />
    </Sheet>
  );
}

// ─── Rename ──────────────────────────────────────────────────────────────

function RenameEditor({ modal, onClose }: { modal: Modal | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(modal?.kind === 'rename' ? modal.account.name : '');
  useEffect(() => {
    if (modal?.kind === 'rename') setName(modal.account.name);
  }, [modal]);
  const m = useMutation({
    mutationFn: async () => {
      if (modal?.kind !== 'rename') throw new Error('no account');
      return api.renameAccount(modal.account.id, name.trim());
    },
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['capital'] });
      qc.invalidateQueries({ queryKey: ['bootstrap'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      onClose();
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });
  if (modal?.kind !== 'rename') return null;
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Переименовать "${modal.account.name}"`}
    >
      <div className="px-4 pb-4 pt-2">
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="новое имя"
          className="w-full bg-ios-surface rounded-ios-lg px-4 py-3.5 text-base outline-none"
        />
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 bg-ios-surface rounded-ios py-3 font-medium"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={!name.trim() || m.isPending}
            onClick={() => m.mutate()}
            className="flex-[2] bg-ios-accent text-white rounded-ios py-3 font-semibold disabled:opacity-50"
          >
            Сохранить
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ─── Revalue: change an asset's value with a recorded loss/gain, no cash ────
function RevalueEditor({ modal, onClose }: { modal: Modal | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState('');
  useEffect(() => {
    if (modal?.kind === 'revalue') {
      setValue((modal.account.balance ?? '').replace('.', ','));
    }
  }, [modal]);

  const m = useMutation({
    mutationFn: async (newValue: string) => {
      if (modal?.kind !== 'revalue') throw new Error('no account');
      return api.revalueAsset(modal.account.id, { newValue, clientTxId: newClientTxId() });
    },
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['capital'] });
      qc.invalidateQueries({ queryKey: ['bootstrap'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      onClose();
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  if (modal?.kind !== 'revalue') return null;
  const a = modal.account;
  const current = parseFloat(a.balance || '0');
  const nv = parseFloat(value.replace(',', '.'));
  const delta = Number.isFinite(nv) ? nv - current : NaN;
  const valid = Number.isFinite(nv) && nv >= 0 && Number.isFinite(delta) && delta !== 0;
  const isLoss = delta < 0;

  return (
    <Sheet open onClose={onClose} title={`Переоценка: ${a.name}`}>
      <div className="px-4 pb-4 pt-2 space-y-3">
        <div className="bg-ios-surface rounded-ios-lg p-4">
          <div className="text-[13px] text-ios-hint">Текущая стоимость</div>
          <div className="text-lg font-semibold tabular-nums mt-0.5">{fmtRub(a.balance)}</div>
        </div>

        <div className="bg-ios-surface rounded-ios-lg p-4">
          <label className="block text-xs font-semibold uppercase tracking-wider text-ios-hint">
            Новая стоимость
          </label>
          <input
            autoFocus
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ''))}
            placeholder="например, 80000"
            className="w-full bg-transparent outline-none text-lg mt-2 placeholder:text-ios-hint tabular-nums"
          />
        </div>

        {valid && (
          <div
            className={`rounded-ios-lg p-4 ${
              isLoss ? 'bg-ios-red/10 text-ios-red' : 'bg-ios-green/10 text-ios-green'
            }`}
          >
            <div className="text-[13px] opacity-80">
              {isLoss ? 'Обесценивание' : 'Прирост стоимости'}
            </div>
            <div className="text-lg font-bold tabular-nums mt-0.5">
              {isLoss ? '−' : '+'}
              {fmtRub(Math.abs(delta))}
            </div>
            <div className="text-[12px] opacity-80 mt-1">
              Станет {fmtRub(nv)} · деньги не тронутся, {isLoss ? 'убыток' : 'прирост'} уйдёт в
              «Переоценку активов»
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 bg-ios-surface rounded-ios py-3 font-medium"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={!valid || m.isPending}
            onClick={() => m.mutate(value.replace(',', '.'))}
            className="flex-[2] bg-ios-accent text-white rounded-ios py-3 font-semibold disabled:opacity-50"
          >
            {m.isPending ? '…' : 'Зафиксировать'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ─── Investments in an asset (purchase + linked expenses) ──────────────────
function InvestmentsSheet({ modal, onClose }: { modal: Modal | null; onClose: () => void }) {
  const qc = useQueryClient();
  const assetId = modal?.kind === 'investments' ? modal.account.id : null;
  const q = useQuery({
    queryKey: ['asset-investments', assetId],
    queryFn: () => api.assetInvestments(assetId!),
    enabled: modal?.kind === 'investments' && !!assetId,
    // Always refetch when the sheet opens — the user typically comes here right
    // after linking a new expense, and a stale total is the whole complaint.
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const classify = useMutation({
    mutationFn: (v: boolean) => api.setAssetClassification(assetId!, v),
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['asset-investments', assetId] });
      qc.invalidateQueries({ queryKey: ['capital'] });
    },
  });

  if (modal?.kind !== 'investments') return null;
  const d = q.data;
  const isLiability = d?.liability ?? modal.account.liability ?? false;
  const margin = d ? parseFloat(d.marginNow) : 0;

  return (
    <Sheet open onClose={onClose} title={`Вложения: ${modal.account.name}`}>
      <div className="px-4 pb-4 pt-1 space-y-3">
        {/* Asset vs Liability (Kiyosaki) segmented switch */}
        <div className="bg-ios-surface rounded-ios-lg p-3">
          <div className="text-[12px] text-ios-hint mb-2 px-0.5">Тип по Кийосаки</div>
          <div className="grid grid-cols-2 gap-1 bg-ios-surface2 dark:bg-black/30 rounded-ios p-1">
            <button
              type="button"
              disabled={classify.isPending}
              onClick={() => classify.mutate(false)}
              className={`py-2 rounded-[9px] text-sm font-semibold transition select-none-ui ${
                !isLiability ? 'bg-ios-green text-white' : 'text-ios-subtext'
              }`}
            >
              🟢 Актив
            </button>
            <button
              type="button"
              disabled={classify.isPending}
              onClick={() => classify.mutate(true)}
              className={`py-2 rounded-[9px] text-sm font-semibold transition select-none-ui ${
                isLiability ? 'bg-ios-red text-white' : 'text-ios-subtext'
              }`}
            >
              🔴 Пассив
            </button>
          </div>
          <div className="text-[11px] text-ios-hint mt-2 px-0.5 leading-snug">
            {isLiability
              ? 'Личная вещь — тратишь на неё. Считаем стоимость владения. В капитале как имущество.'
              : 'Работает на тебя (перепродажа/инвестиция). Считаем маржу.'}
          </div>
        </div>

        {q.isLoading || !d ? (
          <div className="h-24 bg-ios-surface rounded-ios-lg animate-pulse" />
        ) : (
          <>
            {/* Totals */}
            <div className="bg-ios-surface rounded-ios-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-ios-hint">Покупка</span>
                <span className="tabular-nums">{fmtRub(d.purchase)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ios-hint">Вложено сверху (ремонты и пр.)</span>
                <span className="tabular-nums">{fmtRub(d.invested)}</span>
              </div>
              <div className="flex justify-between font-semibold pt-2 border-t border-ios-divider">
                <span>{isLiability ? 'Стоимость владения' : 'Итого вложено'}</span>
                <span className="tabular-nums">{fmtRub(d.total)}</span>
              </div>
              {!isLiability && (
                <div className="flex justify-between text-sm pt-2 border-t border-ios-divider">
                  <span className="text-ios-hint">
                    Маржа при текущей оценке ({fmtRub(d.currentValue)})
                  </span>
                  <span className={`tabular-nums font-semibold ${margin < 0 ? 'text-ios-red' : 'text-ios-green'}`}>
                    {margin < 0 ? '−' : '+'}
                    {fmtRub(Math.abs(margin), { compact: true })}
                  </span>
                </div>
              )}
            </div>

            {/* Linked expenses list */}
            {d.items.length > 0 ? (
              <div className="bg-ios-surface rounded-ios-lg overflow-hidden">
                {d.items.map((it, i) => (
                  <div
                    key={it.id}
                    className={`px-4 py-3 flex items-center justify-between gap-3 ${
                      i !== d.items.length - 1 ? 'border-b border-ios-divider' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{it.category ?? 'Расход'}</div>
                      <div className="text-[11px] text-ios-hint">
                        {fmtDate(it.date)}
                        {it.comment ? ` · ${it.comment}` : ''}
                      </div>
                    </div>
                    <span className="text-sm tabular-nums shrink-0">−{fmtRub(it.amount, { compact: true })}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-ios-hint text-[13px] py-4">
                Пока нет привязанных расходов. При добавлении расхода выбери эту технику в
                «Для техники».
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

// ─── Sell asset ──────────────────────────────────────────────────────────

function SellEditor({
  modal,
  onClose,
  accounts,
}: {
  modal: Modal | null;
  onClose: () => void;
  accounts: AccountDTO[];
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<'pickDest' | 'amount'>('pickDest');
  const [destId, setDestId] = useState<string | null>(null);
  const [destName, setDestName] = useState<string>('');

  const txIdRef = useRef<string>('');
  const m = useMutation({
    onMutate: () => {
      txIdRef.current = newClientTxId();
    },
    mutationFn: async (salePrice: string) => {
      if (modal?.kind !== 'sell' || !destId) throw new Error('no params');
      return api.sellAsset(modal.account.id, {
        toAccountId: destId,
        salePrice,
        clientTxId: txIdRef.current,
      });
    },
    onSuccess: (res) => {
      haptic('success');
      qc.invalidateQueries();
      const profit = parseFloat(res.profit);
      // Universal confirmation — tg.showPopup only works inside Telegram; in
      // the standalone PWA the user would otherwise see nothing and might tap
      // "Продать" again (which is exactly how the duplicate-sale bug happened).
      alertDialog(
        `Продано «${asset.name}»\n` +
          `Цена: ${fmtRub(res.salePrice)}\n` +
          `Себестоимость: ${fmtRub(res.cost)}\n` +
          (profit > 0
            ? `Прибыль: +${fmtRub(profit)} (засчитана в доход)`
            : profit < 0
              ? `Убыток: ${fmtRub(profit)}`
              : 'Без прибыли/убытка'),
      );
      reset();
      onClose();
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  const reset = () => {
    setStep('pickDest');
    setDestId(null);
    setDestName('');
  };

  if (modal?.kind !== 'sell') return null;
  const asset = modal.account;
  const cashAccounts = accounts.filter((a) => a.type === 'cash' || a.type === 'bank');

  return (
    <Sheet
      open
      onClose={() => {
        reset();
        onClose();
      }}
      title={`Продажа "${asset.name}"`}
    >
      {step === 'pickDest' && (
        <div className="px-4 pb-4 pt-2">
          <div className="text-sm text-ios-hint mb-3">
            Куда зачислить деньги? Прибыль (цена продажи минус себестоимость) попадёт в доход.
          </div>
          <div className="space-y-1.5">
            {cashAccounts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  setDestId(a.id);
                  setDestName(a.name);
                  setStep('amount');
                  haptic('select');
                }}
                className="w-full flex items-center justify-between bg-ios-surface rounded-ios px-4 py-3.5 active:bg-ios-surface2"
              >
                <span className="font-medium">{a.name}</span>
                <span className="text-ios-hint text-sm">{TYPE_LABEL[a.type]?.ru}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {step === 'amount' && (
        <AmountKeypad
          onSubmit={(v) => m.mutate(v)}
          submitLabel={`Продать → ${destName}`}
          busy={m.isPending}
          hint={`себестоимость: ${fmtRub(asset.balance)}`}
          onBack={() => setStep('pickDest')}
        />
      )}
    </Sheet>
  );
}

// ─── Prepayment / partial sale ────────────────────────────────────────────
// Receive PART of an asset's value now. The asset's remaining balance drops by
// the recovered cost; it auto-closes once it reaches zero. Profit is realized
// only when a payment exceeds what's left of the cost.
function PrepaymentEditor({
  modal,
  onClose,
  accounts,
}: {
  modal: Modal | null;
  onClose: () => void;
  accounts: AccountDTO[];
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<'pickDest' | 'amount'>('pickDest');
  const [destId, setDestId] = useState<string | null>(null);
  const [destName, setDestName] = useState<string>('');
  const txIdRef = useRef<string>('');

  const m = useMutation({
    onMutate: () => {
      txIdRef.current = newClientTxId();
    },
    mutationFn: async (amount: string) => {
      if (modal?.kind !== 'prepayment' || !destId) throw new Error('no params');
      return api.prepaymentAsset(modal.account.id, {
        toAccountId: destId,
        amount,
        clientTxId: txIdRef.current,
      });
    },
    onSuccess: (res) => {
      haptic('success');
      qc.invalidateQueries();
      const profit = parseFloat(res.profit);
      alertDialog(
        `Получено по «${asset.name}»: ${fmtRub(res.received)}\n` +
          (res.fullySold
            ? 'Актив продан полностью ✅'
            : `Осталось получить: ${fmtRub(res.newAssetBalance)}`) +
          (profit > 0 ? `\nПрибыль: +${fmtRub(profit)} (засчитана в доход)` : ''),
      );
      reset();
      onClose();
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  const reset = () => {
    setStep('pickDest');
    setDestId(null);
    setDestName('');
  };

  if (modal?.kind !== 'prepayment') return null;
  const asset = modal.account;
  const cashAccounts = accounts.filter((a) => a.type === 'cash' || a.type === 'bank');

  return (
    <Sheet
      open
      onClose={() => {
        reset();
        onClose();
      }}
      title={`Предоплата по "${asset.name}"`}
    >
      {step === 'pickDest' && (
        <div className="px-4 pb-4 pt-2">
          <div className="text-sm text-ios-hint mb-3">
            Куда зачислить полученную часть? Остаток по активу уменьшится; когда он
            дойдёт до нуля — актив закроется. Прибыль засчитается, если получишь больше
            остаточной стоимости.
          </div>
          <div className="space-y-1.5">
            {cashAccounts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  setDestId(a.id);
                  setDestName(a.name);
                  setStep('amount');
                  haptic('select');
                }}
                className="w-full flex items-center justify-between bg-ios-surface rounded-ios px-4 py-3.5 active:bg-ios-surface2"
              >
                <span className="font-medium">{a.name}</span>
                <span className="text-ios-hint text-sm">{TYPE_LABEL[a.type]?.ru}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {step === 'amount' && (
        <AmountKeypad
          onSubmit={(v) => m.mutate(v)}
          submitLabel={`Получить → ${destName}`}
          busy={m.isPending}
          hint={`осталось по активу: ${fmtRub(asset.balance)}`}
          onBack={() => setStep('pickDest')}
        />
      )}
    </Sheet>
  );
}

// ─── Add bank/cash ───────────────────────────────────────────────────────

type NewAccountType = 'bank' | 'cash' | 'investment' | 'other_asset';

const NEW_ACCOUNT_TYPES: { id: NewAccountType; icon: IconName; label: string; placeholder: string; hint: string }[] = [
  { id: 'bank', icon: 'bank', label: 'Банк', placeholder: 'например, ВТБ', hint: 'Дебетовый/кредитный счёт в банке' },
  { id: 'cash', icon: 'cash', label: 'Наличные', placeholder: 'например, Карман', hint: 'Кэш на руках' },
  { id: 'investment', icon: 'investment', label: 'Инвестиция', placeholder: 'например, Сбер вклад 12%', hint: 'Вклад, брокерский счёт, ОФЗ — увеличение учитывается как прирост капитала' },
  { id: 'other_asset', icon: 'other_asset', label: 'Прочий актив', placeholder: 'например, Машина', hint: 'Имущество, ценности — учитывается в Net Worth, но не в инвестициях' },
];

function AddBankSheet({ modal, onClose }: { modal: Modal | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState<NewAccountType>('bank');
  const [balance, setBalance] = useState('');

  const m = useMutation({
    mutationFn: () =>
      api.createBank({
        name: name.trim(),
        type,
        initialBalance: balance.trim() ? balance : undefined,
      }),
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['capital'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['bootstrap'] });
      reset();
      onClose();
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  const reset = () => {
    setName('');
    setType('bank');
    setBalance('');
  };

  if (modal?.kind !== 'addBank') return null;

  const meta = NEW_ACCOUNT_TYPES.find((t) => t.id === type)!;

  return (
    <Sheet open onClose={() => { reset(); onClose(); }} title="Новый счёт">
      <div className="px-4 pb-4 pt-2 space-y-3">
        {/* 2x2 type picker — investment and other_asset are first-class
            citizens here, not buried in a "Покупка" flow */}
        <div className="bg-ios-surface rounded-ios-lg p-1 grid grid-cols-2 gap-1">
          {NEW_ACCOUNT_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setType(t.id)}
              className={`py-2.5 rounded-[10px] font-medium transition flex items-center justify-center gap-1.5 ${
                type === t.id ? 'bg-ios-accent text-white' : 'text-ios-subtext'
              }`}
            >
              <AppIcon name={t.icon} size={18} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <div className="text-[11px] text-ios-hint leading-snug px-1">{meta.hint}</div>

        <div className="bg-ios-surface rounded-ios-lg p-4">
          <label className="block text-xs font-semibold uppercase text-ios-hint tracking-wider">
            Название
          </label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={meta.placeholder}
            className="w-full bg-transparent outline-none text-lg mt-2 placeholder:text-ios-hint"
          />
        </div>

        <div className="bg-ios-surface rounded-ios-lg p-4">
          <label className="block text-xs font-semibold uppercase text-ios-hint tracking-wider">
            Стартовый остаток (необязательно)
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={balance}
            onChange={(e) => setBalance(e.target.value.replace(/[^\d.,]/g, ''))}
            placeholder="0"
            className="w-full bg-transparent outline-none text-lg mt-2 placeholder:text-ios-hint tabular-nums"
          />
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => { reset(); onClose(); }}
            className="flex-1 bg-ios-surface rounded-ios py-3 font-medium"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={!name.trim() || m.isPending}
            onClick={() => m.mutate()}
            className="flex-[2] bg-ios-accent text-white rounded-ios py-3 font-semibold disabled:opacity-50"
          >
            {m.isPending ? '…' : 'Создать'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ─── Add credit (loan) ──────────────────────────────────────────────────

function AddCreditSheet({ modal, onClose }: { modal: Modal | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [originalAmount, setOriginalAmount] = useState('');
  const [rate, setRate] = useState('');
  const [termMonths, setTermMonths] = useState('');
  const [paymentDay, setPaymentDay] = useState('');

  const m = useMutation({
    mutationFn: () =>
      api.createCredit({
        name: name.trim(),
        originalAmount,
        rate,
        termMonths: parseInt(termMonths, 10),
        paymentDay: paymentDay ? parseInt(paymentDay, 10) : undefined,
      }),
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['capital'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['bootstrap'] });
      qc.invalidateQueries({ queryKey: ['credits'] });
      reset();
      onClose();
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  const reset = () => {
    setName('');
    setOriginalAmount('');
    setRate('');
    setTermMonths('');
    setPaymentDay('');
  };

  if (modal?.kind !== 'addCredit') return null;

  // Empty rate means 0% (interest-free / рассрочка) — treat blank as valid zero.
  const rateNum = rate.trim() === '' ? 0 : parseFloat(rate.replace(',', '.'));
  const valid =
    name.trim().length > 0 &&
    parseFloat(originalAmount.replace(',', '.')) > 0 &&
    rateNum >= 0 &&
    parseInt(termMonths, 10) > 0;

  // Preview the scheduled payment so the user sees what they're signing up for
  // before saving. Mirrors the backend formula (rounded for display).
  const preview = (() => {
    const p = parseFloat(originalAmount.replace(',', '.'));
    const r = rate.trim() === '' ? 0 : parseFloat(rate.replace(',', '.'));
    const n = parseInt(termMonths, 10);
    if (!p || !n || Number.isNaN(r) || r < 0) return null;
    if (r === 0) return p / n;
    const monthly = r / 12 / 100;
    const pow = Math.pow(1 + monthly, n);
    return (p * monthly * pow) / (pow - 1);
  })();

  return (
    <Sheet open onClose={() => { reset(); onClose(); }} title="Новый кредит">
      <div className="px-4 pb-4 pt-2 space-y-3">
        <div className="bg-ios-surface rounded-ios-lg p-4">
          <label className="block text-xs font-semibold uppercase text-ios-hint tracking-wider">
            Название
          </label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="например, Сбер потребкредит"
            className="w-full bg-transparent outline-none text-lg mt-2 placeholder:text-ios-hint"
          />
        </div>

        <div className="bg-ios-surface rounded-ios-lg p-4">
          <label className="block text-xs font-semibold uppercase text-ios-hint tracking-wider">
            Сумма кредита, ₽
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={originalAmount}
            onChange={(e) => setOriginalAmount(e.target.value.replace(/[^\d.,]/g, ''))}
            placeholder="500000"
            className="w-full bg-transparent outline-none text-lg mt-2 placeholder:text-ios-hint tabular-nums"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="bg-ios-surface rounded-ios-lg p-4">
            <label className="block text-xs font-semibold uppercase text-ios-hint tracking-wider">
              Ставка % годовых
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value.replace(/[^\d.,]/g, ''))}
              placeholder="18.5 (0 — беспроцентный)"
              className="w-full bg-transparent outline-none text-lg mt-2 placeholder:text-ios-hint tabular-nums"
            />
          </div>
          <div className="bg-ios-surface rounded-ios-lg p-4">
            <label className="block text-xs font-semibold uppercase text-ios-hint tracking-wider">
              Срок, мес
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={termMonths}
              onChange={(e) => setTermMonths(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="24"
              className="w-full bg-transparent outline-none text-lg mt-2 placeholder:text-ios-hint tabular-nums"
            />
          </div>
        </div>

        <div className="bg-ios-surface rounded-ios-lg p-4">
          <label className="block text-xs font-semibold uppercase text-ios-hint tracking-wider">
            День платежа (1–28, опционально)
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={paymentDay}
            onChange={(e) =>
              setPaymentDay(e.target.value.replace(/[^\d]/g, '').slice(0, 2))
            }
            placeholder="15"
            className="w-full bg-transparent outline-none text-lg mt-2 placeholder:text-ios-hint tabular-nums"
          />
        </div>

        {preview !== null && (
          <div className="bg-ios-accentSoft text-ios-accent rounded-ios-lg p-3 text-sm text-center">
            Ежемесячный платёж: <span className="font-semibold tabular-nums">{fmtRub(preview)}</span>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => { reset(); onClose(); }}
            className="flex-1 bg-ios-surface rounded-ios py-3 font-medium"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={!valid || m.isPending}
            onClick={() => m.mutate()}
            className="flex-[2] bg-ios-accent text-white rounded-ios py-3 font-semibold disabled:opacity-50"
          >
            {m.isPending ? '…' : 'Создать'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

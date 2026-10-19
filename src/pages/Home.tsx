import { Fragment, useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type TransactionDTO } from '../lib/api';
import { Header } from '../components/Header';
import { Card, ListRow } from '../components/Card';
import { Sheet } from '../components/Sheet';
import { ProgressBar } from '../components/ProgressBar';
import { TransactionEditor } from '../components/TransactionEditor';
import { DateDivider } from '../components/DateDivider';
import { fmtRub, fmtMonth, fmtDate, categoryEmoji, dayKey } from '../lib/format';
import { haptic } from '../lib/telegram';

// The account a transaction moved money on: the SOURCE account for an expense
// (where the money was debited from) and the DESTINATION account for an income
// (where it landed). Transfers/investments already spell out "from → to" in
// their title, so we don't repeat the account for them. Returns null when the
// operation was recorded without an account.
function txAccount(t: TransactionDTO): string | null {
  if (t.type === 'expense') return t.fromAccountName;
  if (t.type === 'income') return t.toAccountName;
  return null;
}

export function HomePage({
  onGoTo,
}: {
  onGoTo: (tab: 'budget' | 'capital' | 'add' | 'analytics' | 'settings') => void;
}) {
  const boot = useQuery({
    queryKey: ['bootstrap'],
    queryFn: () => api.bootstrap(8),
    staleTime: 15_000,
  });
  const [editingTx, setEditingTx] = useState<TransactionDTO | null>(null);
  const [showAllTxs, setShowAllTxs] = useState(false);

  // Order matters: an error (or a paused offline fetch) also means "no data",
  // so these checks must run before the skeleton — otherwise the screen stays
  // on the skeleton forever when the server can't be reached and there's no
  // cached snapshot yet. With cached data we keep showing it instead.
  if (!boot.data) {
    if (boot.isError) {
      return (
        <LoadError
          title="Не удалось загрузить данные"
          text={
            boot.error instanceof TypeError
              ? 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.'
              : (boot.error as Error).message
          }
          retrying={boot.isFetching}
          onRetry={() => boot.refetch()}
        />
      );
    }
    if (boot.fetchStatus === 'paused') {
      return (
        <LoadError
          title="Нет сети"
          text="Данные появятся, как только вернётся связь."
          retrying={false}
          onRetry={() => boot.refetch()}
        />
      );
    }
    return <Skeleton />;
  }

  const s = boot.data.summary;
  const cap = boot.data.capitalTotals;
  const txs = boot.data.recentTransactions;
  // First-time user — no transactions yet. Show a friendly onboarding panel
  // explaining the three main flows. Disappears the moment they record
  // anything.
  const isEmpty =
    txs.length === 0 &&
    parseFloat(s.totalExpenses) === 0 &&
    parseFloat(s.totalIncome) === 0 &&
    parseFloat(s.totalInvestments) === 0;

  // Hero card focuses purely on monthly expenses.
  // expensePF.planned now falls back to sum of category plans (server-side fix).
  const actualExpense = parseFloat(s.totalExpenses) || 0;
  const plannedExpense = parseFloat(s.expensePF.planned) || 0;
  const remaining = plannedExpense - actualExpense;

  return (
    <div className="pb-28">
      <Header
        title="Финансы"
        subtitle={fmtMonth(s.month)}
        right={
          <button
            type="button"
            onClick={() => onGoTo('settings')}
            className="text-2xl select-none-ui active:opacity-60"
            aria-label="Настройки"
          >
            ⚙️
          </button>
        }
      />

      {isEmpty && (
        <div className="px-4 mt-2">
          <div className="bg-ios-surface rounded-ios-lg p-4 shadow-card">
            <div className="text-2xl mb-2">👋 Привет!</div>
            <div className="text-sm text-ios-subtext leading-snug">
              Это твоя личная книга финансов. Все данные хранятся за тобой, никто другой их не видит.
            </div>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex gap-2.5">
                <span className="shrink-0 w-6 h-6 bg-ios-accent text-white rounded-full flex items-center justify-center text-xs font-bold">
                  1
                </span>
                <div>
                  <span className="font-medium">Внеси текущие остатки</span> по банкам и наличным —{' '}
                  <button
                    type="button"
                    onClick={() => onGoTo('capital')}
                    className="text-ios-accent underline"
                  >
                    Капитал
                  </button>
                </div>
              </div>
              <div className="flex gap-2.5">
                <span className="shrink-0 w-6 h-6 bg-ios-accent text-white rounded-full flex items-center justify-center text-xs font-bold">
                  2
                </span>
                <div>
                  <span className="font-medium">Задай план расходов</span> по категориям на месяц —{' '}
                  <button
                    type="button"
                    onClick={() => onGoTo('budget')}
                    className="text-ios-accent underline"
                  >
                    Бюджет
                  </button>
                </div>
              </div>
              <div className="flex gap-2.5">
                <span className="shrink-0 w-6 h-6 bg-ios-accent text-white rounded-full flex items-center justify-center text-xs font-bold">
                  3
                </span>
                <div>
                  <span className="font-medium">Записывай операции</span> кнопкой
                  <button
                    type="button"
                    onClick={() => onGoTo('add')}
                    className="ml-1 inline-flex items-center justify-center w-6 h-6 bg-ios-accent text-white rounded-full text-sm align-middle"
                  >
                    ＋
                  </button>{' '}
                  внизу
                </div>
              </div>
              <div className="flex gap-2.5">
                <span className="shrink-0 w-6 h-6 bg-ios-accent text-white rounded-full flex items-center justify-center text-xs font-bold">
                  4
                </span>
                <div>
                  Через пару записей появятся{' '}
                  <button
                    type="button"
                    onClick={() => onGoTo('analytics')}
                    className="text-ios-accent underline"
                  >
                    графики и аналитика
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hero card: expenses only */}
      <div className="px-4 mt-2">
        <button
          type="button"
          onClick={() => onGoTo('budget')}
          className="w-full text-left bg-gradient-to-br from-ios-accent to-[#5856D6] text-white rounded-ios-lg p-5 shadow-lg active:scale-[0.99] transition-transform"
        >
          <div className="text-sm opacity-80">Расход за {fmtMonth(s.month)}</div>
          <div className="text-4xl font-rounded font-bold mt-1 tabular-nums">{fmtRub(s.totalExpenses)}</div>

          <div className="mt-3">
            <ProgressBar percent={s.expensePF.percent} status={s.expensePF.status} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
            <div className="bg-white/15 rounded-md px-2.5 py-2 backdrop-blur-sm">
              <div className="opacity-80">План</div>
              <div className="font-semibold tabular-nums mt-0.5 text-[15px]">
                {plannedExpense > 0 ? fmtRub(s.expensePF.planned, { compact: true }) : '—'}
              </div>
            </div>
            <div className="bg-white/15 rounded-md px-2.5 py-2 backdrop-blur-sm">
              <div className="opacity-80">{remaining >= 0 ? 'Остаток' : 'Перерасход'}</div>
              <div className="font-semibold tabular-nums mt-0.5 text-[15px]">
                {plannedExpense > 0 ? fmtRub(Math.abs(remaining), { compact: true }) : '—'}
              </div>
            </div>
          </div>
        </button>
      </div>

      <div className="mt-5">
        {/* Capital: Money → Investments → Other assets → Total (Капитал) */}
        <Card title="Капитал">
          <ListRow
            left={<span>💵 Деньги</span>}
            right={<span className="tabular-nums">{fmtRub(cap.totalCash)}</span>}
            divider
            onClick={() => onGoTo('capital')}
          />
          <ListRow
            left={<span>📈 Инвестиции</span>}
            right={<span className="tabular-nums">{fmtRub(cap.totalInvestments)}</span>}
            divider
            onClick={() => onGoTo('capital')}
          />
          <ListRow
            left={<span>🚗 Прочие активы</span>}
            right={<span className="tabular-nums">{fmtRub(cap.totalOther)}</span>}
            divider
            onClick={() => onGoTo('capital')}
          />
          {/* Credit buffer (escrow toward a loan) — still the user's money, so
              it's part of net worth; show it so the breakdown reconciles. */}
          {parseFloat(cap.totalCreditBuffers) > 0 && (
            <ListRow
              left={<span>💰 Взнос по кредиту</span>}
              right={<span className="tabular-nums text-ios-green">{fmtRub(cap.totalCreditBuffers)}</span>}
              divider
              onClick={() => onGoTo('capital')}
            />
          )}
          {/* Debt is SUBTRACTED from net worth. Without this line the visible
              rows didn't add up to «Капитал» — the credit looked "unaccounted for". */}
          {parseFloat(cap.totalCredits) > 0 && (
            <ListRow
              left={<span>💳 Кредиты</span>}
              right={<span className="tabular-nums text-ios-red">−{fmtRub(cap.totalCredits)}</span>}
              divider
              onClick={() => onGoTo('capital')}
            />
          )}
          <ListRow
            left={<span className="font-semibold">Капитал</span>}
            right={
              <span className="tabular-nums font-semibold text-base text-ios-green">
                {fmtRub(cap.totalNetWorth)}
              </span>
            }
            divider={false}
          />
        </Card>

        <section className="mb-5">
          <div className="px-4 mb-1.5 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ios-hint">
              Последние операции
            </h2>
            <button
              type="button"
              onClick={() => {
                haptic('light');
                setShowAllTxs(true);
              }}
              className="text-ios-accent text-sm font-medium"
            >
              Все →
            </button>
          </div>
          <div className="bg-ios-surface rounded-ios-lg overflow-hidden shadow-card">
            {txs.length > 0 ? (
              txs.map((t, i) => {
                const target =
                  t.categoryName ??
                  t.incomeSourceName ??
                  ([t.fromAccountName, t.toAccountName].filter(Boolean).join(' → ') || '—');
                const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
                const acc = txAccount(t);
                const color =
                  t.type === 'income' ? 'text-ios-green' : t.type === 'expense' ? '' : 'text-ios-accent';
                const showHeader = i === 0 || dayKey(t.date) !== dayKey(txs[i - 1].date);
                return (
                  <Fragment key={t.id}>
                    {showHeader && <DateDivider iso={t.date} />}
                    <ListRow
                      divider={i !== txs.length - 1}
                      onClick={() => {
                        haptic('light');
                        setEditingTx(t);
                      }}
                      left={
                        <div>
                          <div className="font-medium truncate">
                            <span className="mr-1.5">{categoryEmoji(target)}</span>
                            {target}
                          </div>
                          <div className="text-xs text-ios-hint mt-0.5">
                            {fmtDate(t.date)}
                            {acc ? ` · 💳 ${acc}` : ''}
                            {t.comment ? ` · ${t.comment}` : ''}
                          </div>
                        </div>
                      }
                      right={
                        <span className={`tabular-nums font-medium ${color}`}>
                          {sign}
                          {fmtRub(t.amount)}
                        </span>
                      }
                    />
                  </Fragment>
                );
              })
            ) : (
              <div className="px-4 py-6 text-center text-ios-hint">Операций пока нет.</div>
            )}
          </div>
        </section>

        <div className="px-4 mt-3 grid grid-cols-2 gap-3">
          <button
            onClick={() => onGoTo('analytics')}
            className="bg-ios-surface rounded-ios-lg p-4 text-left active:scale-[0.98] transition"
          >
            <div className="text-sm text-ios-hint">Аналитика</div>
            <div className="text-lg font-rounded font-semibold mt-1">📈 Графики</div>
          </button>
          <button
            onClick={() => onGoTo('add')}
            className="bg-ios-accent text-white rounded-ios-lg p-4 text-left active:scale-[0.98] transition"
          >
            <div className="text-sm opacity-80">Быстрая запись</div>
            <div className="text-lg font-rounded font-semibold mt-1">＋ Расход</div>
          </button>
        </div>
      </div>

      <TransactionEditor tx={editingTx} onClose={() => setEditingTx(null)} />
      {showAllTxs && <AllTransactionsSheet onClose={() => setShowAllTxs(false)} />}
    </div>
  );
}

// ─── All transactions sheet ──────────────────────────────────────────────

type TxPeriod = '7d' | 'cur' | 'prev' | '3m' | 'all' | 'custom';
type TxTypeFilter = 'all' | 'expense' | 'income' | 'investment' | 'other_asset';

const TYPE_LABEL: Record<TxTypeFilter, string> = {
  all: 'Все',
  expense: 'Расходы',
  income: 'Доходы',
  investment: 'Инвест.',
  other_asset: 'Прочие активы',
};

function monthName(offset = 0): string {
  const d = new Date();
  if (offset) d.setMonth(d.getMonth() + offset);
  const s = d.toLocaleDateString('ru-RU', { month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const PERIOD_CHIPS: { value: TxPeriod; label: string }[] = [
  { value: '7d', label: '7 дней' },
  { value: 'cur', label: monthName(0) },
  { value: 'prev', label: monthName(-1) },
  { value: '3m', label: '3 мес.' },
  { value: 'all', label: 'Всё' },
  { value: 'custom', label: 'Период' },
];

function periodApiDates(p: TxPeriod, from: string, to: string): { from?: string; to?: string } {
  const now = new Date();
  if (p === '7d') return { from: new Date(Date.now() - 7 * 86_400_000).toISOString() };
  if (p === '3m') return { from: new Date(Date.now() - 90 * 86_400_000).toISOString() };
  if (p === 'all') return {};
  if (p === 'cur')
    return {
      from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      to: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
    };
  if (p === 'prev')
    return {
      from: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(),
      to: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
    };
  if (p === 'custom' && from && to) {
    const toDate = new Date(to);
    toDate.setDate(toDate.getDate() + 1);
    return { from: new Date(from).toISOString(), to: toDate.toISOString() };
  }
  return {};
}

function AllTransactionsSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [period, setPeriod] = useState<TxPeriod>('cur');
  const [txType, setTxType] = useState<TxTypeFilter>('all');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [editingTx, setEditingTx] = useState<TransactionDTO | null>(null);

  const apiParams = useMemo(() => {
    const dates = periodApiDates(period, customFrom, customTo);
    const p: Parameters<typeof api.transactions>[0] = { limit: 300 };
    if (dates.from) p.from = dates.from;
    if (dates.to) p.to = dates.to;
    if (txType === 'investment') p.type = 'transfer_to_investment';
    else if (txType === 'other_asset') p.accountType = 'other_asset';
    else if (txType !== 'all') p.type = txType;
    return p;
  }, [period, txType, customFrom, customTo]);

  const txQuery = useQuery({
    queryKey: ['txs-all', apiParams],
    queryFn: () => api.transactions(apiParams),
    enabled: period !== 'custom' || (!!customFrom && !!customTo),
    staleTime: 30_000,
  });

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const tx of txQuery.data ?? []) {
      if (tx.categoryId && tx.categoryName) map.set(tx.categoryId, tx.categoryName);
    }
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [txQuery.data]);

  useEffect(() => {
    setCategoryId(null);
  }, [txType]);

  const displayed = useMemo(() => {
    const all = txQuery.data ?? [];
    return categoryId ? all.filter((tx) => tx.categoryId === categoryId) : all;
  }, [txQuery.data, categoryId]);

  const totals = useMemo(() => {
    let income = 0,
      expense = 0;
    for (const tx of displayed) {
      if (tx.type === 'income') income += parseFloat(tx.amount);
      else if (tx.type === 'expense') expense += parseFloat(tx.amount);
    }
    return { income, expense };
  }, [displayed]);

  return (
    <>
      <Sheet open onClose={onClose} title="История операций">
        <div className="pb-6">
          {/* Sticky filters */}
          <div className="sticky top-0 bg-ios-bg z-10 px-4 pt-1 pb-3 space-y-2 border-b border-ios-divider">
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
              {PERIOD_CHIPS.map((c) => (
                <TxFilterChip key={c.value} active={period === c.value} onClick={() => setPeriod(c.value)}>
                  {c.label}
                </TxFilterChip>
              ))}
            </div>
            {period === 'custom' && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="flex-1 bg-ios-surface rounded-ios px-3 py-2 text-sm text-ios-text"
                />
                <span className="text-ios-hint text-sm shrink-0">—</span>
                <input
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="flex-1 bg-ios-surface rounded-ios px-3 py-2 text-sm text-ios-text"
                />
              </div>
            )}
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
              {(['all', 'expense', 'income', 'investment', 'other_asset'] as TxTypeFilter[]).map((t) => (
                <TxFilterChip key={t} active={txType === t} onClick={() => setTxType(t)}>
                  {TYPE_LABEL[t]}
                </TxFilterChip>
              ))}
            </div>
            {txType === 'expense' && categories.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                <TxFilterChip active={categoryId === null} onClick={() => setCategoryId(null)}>
                  Все
                </TxFilterChip>
                {categories.map((c) => (
                  <TxFilterChip key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(c.id)}>
                    {categoryEmoji(c.name)} {c.name}
                  </TxFilterChip>
                ))}
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="px-4 py-2.5 flex items-center gap-3 text-sm text-ios-hint border-b border-ios-divider">
            {period === 'custom' && (!customFrom || !customTo) ? (
              <span>Выберите даты периода</span>
            ) : txQuery.isLoading ? (
              <span>Загрузка…</span>
            ) : (
              <>
                <span>{displayed.length} операций</span>
                {totals.income > 0 && (
                  <span className="text-ios-green">+{fmtRub(String(totals.income), { compact: true })}</span>
                )}
                {totals.expense > 0 && (
                  <span className="text-ios-red">−{fmtRub(String(totals.expense), { compact: true })}</span>
                )}
              </>
            )}
          </div>

          {/* List */}
          {txQuery.isLoading ? (
            <div className="px-4 pt-3 space-y-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-10 bg-ios-surface rounded animate-pulse" />
              ))}
            </div>
          ) : displayed.length === 0 ? (
            <div className="py-12 text-center text-ios-hint text-sm">Операций нет</div>
          ) : (
            <div>
              {displayed.map((tx, i) => {
                const target =
                  tx.categoryName ??
                  tx.incomeSourceName ??
                  ([tx.fromAccountName, tx.toAccountName].filter(Boolean).join(' → ') || '—');
                const sign = tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : '';
                const acc = txAccount(tx);
                const color =
                  tx.type === 'income' ? 'text-ios-green' : tx.type === 'expense' ? '' : 'text-ios-accent';
                const showHeader = i === 0 || dayKey(tx.date) !== dayKey(displayed[i - 1].date);
                return (
                  <Fragment key={tx.id}>
                    {showHeader && <DateDivider iso={tx.date} />}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        haptic('light');
                        setEditingTx(tx);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setEditingTx(tx);
                      }}
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer active:bg-black/5 dark:active:bg-white/5 select-none ${
                        i !== displayed.length - 1 ? 'border-b border-ios-divider' : ''
                      }`}
                    >
                      <span className="text-xl shrink-0">{categoryEmoji(target)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{target}</div>
                        <div className="text-[11px] text-ios-hint">
                          {fmtDate(tx.date)}
                          {acc ? ` · 💳 ${acc}` : ''}
                          {tx.comment ? ` · ${tx.comment}` : ''}
                        </div>
                      </div>
                      <span className={`text-sm font-semibold tabular-nums shrink-0 ${color}`}>
                        {sign}
                        {fmtRub(tx.amount, { compact: true })}
                      </span>
                    </div>
                  </Fragment>
                );
              })}
            </div>
          )}
        </div>
      </Sheet>

      <TransactionEditor
        tx={editingTx}
        onClose={() => {
          setEditingTx(null);
          qc.invalidateQueries({ queryKey: ['txs-all'] });
        }}
      />
    </>
  );
}

function TxFilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic('select');
        onClick();
      }}
      className={`shrink-0 text-[12px] px-3 py-1.5 rounded-full font-medium transition ${
        active ? 'bg-ios-accent text-white' : 'bg-ios-surface text-ios-subtext'
      }`}
    >
      {children}
    </button>
  );
}

function LoadError({
  title,
  text,
  retrying,
  onRetry,
}: {
  title: string;
  text: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="pb-28 px-6 pt-24 text-center">
      <div className="text-5xl">📡</div>
      <div className="mt-3 text-lg font-semibold">{title}</div>
      <p className="mt-1.5 text-sm text-ios-hint leading-snug">{text}</p>
      <button
        type="button"
        onClick={() => {
          haptic('light');
          onRetry();
        }}
        disabled={retrying}
        className="mt-5 px-6 py-3 rounded-ios bg-ios-accent text-white font-semibold active:opacity-80 disabled:opacity-60 select-none-ui"
      >
        {retrying ? 'Повторяю…' : 'Повторить'}
      </button>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="pb-28">
      <div className="px-4 pt-6 pb-3">
        <div className="h-9 w-40 bg-ios-surface rounded-md animate-pulse" />
        <div className="h-4 w-20 bg-ios-surface rounded-md animate-pulse mt-2" />
      </div>
      <div className="px-4 space-y-4">
        <div className="h-44 bg-ios-surface rounded-ios-lg animate-pulse" />
        <div className="h-32 bg-ios-surface rounded-ios-lg animate-pulse" />
        <div className="h-44 bg-ios-surface rounded-ios-lg animate-pulse" />
      </div>
    </div>
  );
}

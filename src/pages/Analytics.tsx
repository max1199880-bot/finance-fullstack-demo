import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { LineChart, BarChart, CategoryBars, CategoryDonut } from '../components/charts';
import { fmtRub, fmtDayHeader } from '../lib/format';
import { haptic } from '../lib/telegram';

type Preset = '7d' | '30d' | 'thisMonth' | 'prevMonth' | '90d' | '180d' | '1y';

const PRESETS: { id: Preset; label: string }[] = [
  { id: '7d', label: '7 дней' },
  { id: '30d', label: '30 дней' },
  { id: 'thisMonth', label: 'Этот месяц' },
  { id: 'prevMonth', label: 'Прошлый' },
  { id: '90d', label: '3 мес' },
  { id: '180d', label: '6 мес' },
  { id: '1y', label: 'Год' },
];

function rangeFor(preset: Preset): { from: Date; to: Date; label: string } {
  const now = new Date();
  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

  switch (preset) {
    case '7d':
      return {
        from: startOfDay(new Date(now.getTime() - 7 * 86400000)),
        to: now,
        label: 'Последние 7 дней',
      };
    case '30d':
      return {
        from: startOfDay(new Date(now.getTime() - 30 * 86400000)),
        to: now,
        label: 'Последние 30 дней',
      };
    case 'thisMonth':
      return { from: monthStart(now), to: now, label: 'Этот месяц' };
    case 'prevMonth': {
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { from: prev, to: monthStart(now), label: 'Прошлый месяц' };
    }
    case '90d':
      return {
        from: startOfDay(new Date(now.getTime() - 90 * 86400000)),
        to: now,
        label: 'Последние 3 месяца',
      };
    case '180d':
      return {
        from: startOfDay(new Date(now.getTime() - 180 * 86400000)),
        to: now,
        label: 'Последние 6 месяцев',
      };
    case '1y':
      return {
        from: startOfDay(new Date(now.getTime() - 365 * 86400000)),
        to: now,
        label: 'Последний год',
      };
  }
}

export function AnalyticsPage() {
  const [preset, setPreset] = useState<Preset>('30d');
  const range = useMemo(() => rangeFor(preset), [preset]);

  const summary = useQuery({
    queryKey: ['analytics', 'summary', preset],
    queryFn: () => api.analyticsSummary(range.from.toISOString(), range.to.toISOString()),
    staleTime: 30_000,
  });
  const byCat = useQuery({
    queryKey: ['analytics', 'byCategory', preset],
    queryFn: () => api.analyticsByCategory(range.from.toISOString(), range.to.toISOString(), 12),
    staleTime: 30_000,
  });
  const daily = useQuery({
    queryKey: ['analytics', 'daily', preset],
    queryFn: () => api.analyticsDaily(range.from.toISOString(), range.to.toISOString()),
    staleTime: 30_000,
  });
  const incomeBySource = useQuery({
    queryKey: ['analytics', 'incomeBySource', preset],
    queryFn: () => api.analyticsByIncomeSource(range.from.toISOString(), range.to.toISOString()),
    staleTime: 30_000,
  });
  const nwHistory = useQuery({
    queryKey: ['analytics', 'nwHistory'],
    queryFn: () => api.analyticsNetworthHistory(26),
    staleTime: 60_000,
  });
  // Current capital composition (cash / investments / assets / debts) — reuses
  // the shared ['capital'] cache the app prefetches, so it's usually instant.
  const capital = useQuery({
    queryKey: ['capital'],
    queryFn: api.capital,
    staleTime: 15_000,
  });
  const investHistory = useQuery({
    queryKey: ['analytics', 'investHistory'],
    queryFn: () => api.analyticsNetworthHistory(26, 'investment'),
    staleTime: 60_000,
  });
  // Sold-assets history — moved here from Settings on user request.
  // Independent of the preset date range: shows ALL historical sales.
  const soldAssets = useQuery({
    queryKey: ['analytics', 'soldAssets'],
    queryFn: () => api.analyticsSoldAssets(),
    // Money data: keep the staleness window short so a just-made sale shows on
    // the next mount / focus (sale mutations also invalidate all queries).
    staleTime: 5_000,
  });

  return (
    <div className="pb-28">
      <Header title="Аналитика" subtitle={range.label} />

      {/* Preset selector — horizontal scroll, no overflow visible */}
      {/* px-3 (not "px-4 -mx-1"): the negative margin made this wrapper 8px wider
          than the screen, so on phones the whole page could be dragged sideways by
          4px. px-3 keeps the chips at the same 16px inset and the same width. */}
      <div className="px-3">
        <div
          className="flex gap-1.5 overflow-x-auto pb-1 px-1 scroll-smooth select-none-ui"
          style={{ scrollbarWidth: 'none' }}
        >
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                haptic('select');
                setPreset(p.id);
              }}
              className={`px-3.5 py-1.5 rounded-full whitespace-nowrap text-sm font-medium transition shrink-0 ${
                preset === p.id
                  ? 'bg-ios-accent text-white'
                  : 'bg-ios-surface text-ios-subtext active:bg-ios-surface2'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary card with comparison */}
      <div className="px-4 mt-4">
        {summary.isLoading || !summary.data ? (
          <div className="h-32 bg-ios-surface rounded-ios-lg animate-pulse" />
        ) : (
          <SummaryCard current={summary.data.current} previous={summary.data.previous} />
        )}
      </div>

      <Card title="Расходы по дням">
        <div className="px-4 py-3">
          {daily.data ? (
            <BarChart
              bars={daily.data.days.map((d) => ({
                label: d.day.slice(8), // DD
                value: parseFloat(d.expense),
                color: 'var(--ios-accent)',
              }))}
              height={130}
            />
          ) : (
            <div className="h-32 bg-ios-surface2 rounded-md animate-pulse" />
          )}
        </div>
      </Card>

      {/* Источники дохода */}
      {incomeBySource.data && incomeBySource.data.items.length > 0 && (
        <Card title="Источники дохода">
          <div className="px-4 pb-3 space-y-2">
            {incomeBySource.data.items.map((item) => (
              <div key={item.sourceId}>
                <div className="flex justify-between text-sm mb-0.5">
                  <span>{item.name}</span>
                  <span className="font-medium tabular-nums">{fmtRub(item.amount)}</span>
                </div>
                <div className="w-full bg-ios-separator rounded-full h-1">
                  <div
                    className="h-1 rounded-full bg-green-500 transition-all"
                    style={{ width: `${item.share}%` }}
                  />
                </div>
                <div className="text-[11px] text-ios-hint text-right">{item.share}%</div>
              </div>
            ))}
          </div>
          <div className="px-4 pb-3 text-xs text-ios-hint">Всего: {fmtRub(incomeBySource.data.total)}</div>
        </Card>
      )}

      <Card title="Куда ушли деньги">
        <div className="px-4 py-4">
          {byCat.data ? (
            <CategoryDonut items={byCat.data.items} total={byCat.data.total} />
          ) : (
            <div className="h-56 bg-ios-surface2 rounded-md animate-pulse" />
          )}
        </div>
      </Card>

      <Card title="Топ категорий расходов">
        <div className="px-4 py-3">
          {byCat.data ? (
            <CategoryBars items={byCat.data.items} total={byCat.data.total} />
          ) : (
            <div className="h-40 bg-ios-surface2 rounded-md animate-pulse" />
          )}
        </div>
      </Card>

      {nwHistory.data ? (
        <NetWorthCard history={nwHistory.data} capital={capital.data} />
      ) : (
        <Card title="💰 Мой капитал">
          <div className="px-4 py-3">
            <div className="h-52 bg-ios-surface2 rounded-md animate-pulse" />
          </div>
        </Card>
      )}

      {soldAssets.data && soldAssets.data.items.length > 0 && (
        <SoldAssetsCard items={soldAssets.data.items} />
      )}

      <Card title="📈 Инвестиции — динамика">
        <div className="px-4 py-3">
          {investHistory.data ? (
            <>
              <div className="flex justify-between items-end mb-2">
                <div className="text-sm text-ios-hint">Текущая стоимость</div>
                <div className="font-rounded font-bold tabular-nums text-ios-accent">
                  {fmtRub(investHistory.data.totalNow)}
                </div>
              </div>
              <LineChart
                points={investHistory.data.weeks.map((w) => ({
                  x: w.weekEnd,
                  y: parseFloat(w.total),
                }))}
                height={150}
                color="var(--ios-accent)"
              />
              <div className="text-[11px] text-ios-hint mt-2 text-center">
                по неделям; обновлять остаток в Капитале → каждое пополнение виден на графике
              </div>
            </>
          ) : (
            <div className="h-40 bg-ios-surface2 rounded-md animate-pulse" />
          )}
        </div>
      </Card>
    </div>
  );
}

// ─── Summary card with comparison badges ─────────────────────────────────

function SummaryCard({
  current,
  previous,
}: {
  current: { income: string; expense: string; investment: string; revaluation?: string; txCount: number };
  previous: { income: string; expense: string; investment: string; revaluation?: string; txCount: number };
}) {
  const reval = parseFloat(current.revaluation ?? '0');
  const blocks = [
    { label: 'Расход', cur: current.expense, prev: previous.expense, color: 'text-ios-red', up: 'bad' },
    { label: 'Доход', cur: current.income, prev: previous.income, color: 'text-ios-green', up: 'good' },
    {
      label: 'Инвест.',
      cur: current.investment,
      prev: previous.investment,
      color: 'text-ios-accent',
      up: 'good',
    },
  ] as const;

  return (
    <div className="bg-ios-surface rounded-ios-lg p-4">
      <div className="grid grid-cols-3 gap-3">
        {blocks.map((b) => {
          const cur = parseFloat(b.cur);
          const prev = parseFloat(b.prev);
          const delta = cur - prev;
          const pct = prev > 0 ? Math.round((delta / prev) * 100) : null;
          const isPositive = delta > 0;
          // "good" up means going up is good (income, investment); "bad" means down is good (expense)
          const goodChange = b.up === 'good' ? isPositive : !isPositive;
          const noChange = Math.abs(delta) < 0.01;

          return (
            <div key={b.label}>
              <div className="text-xs text-ios-hint">{b.label}</div>
              <div className={`mt-0.5 font-rounded font-semibold tabular-nums text-[15px] ${b.color}`}>
                {fmtRub(b.cur, { compact: true })}
              </div>
              {!noChange && pct !== null && (
                <div
                  className={`mt-1 inline-flex items-center text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${
                    goodChange ? 'bg-ios-green/15 text-ios-green' : 'bg-ios-red/15 text-ios-red'
                  }`}
                >
                  {isPositive ? '↑' : '↓'} {Math.abs(pct)}%
                </div>
              )}
              {noChange && <div className="mt-1 inline-flex text-[10px] text-ios-hint">— vs прошлый</div>}
            </div>
          );
        })}
      </div>
      {Math.abs(reval) >= 0.01 && (
        <div className="mt-3 pt-3 border-t border-ios-divider flex items-center justify-between">
          <span className="text-xs text-ios-hint">Переоценка активов</span>
          <span
            className={`text-[15px] font-rounded font-semibold tabular-nums ${
              reval < 0 ? 'text-ios-red' : 'text-ios-green'
            }`}
          >
            {reval < 0 ? '−' : '+'}
            {fmtRub(Math.abs(reval), { compact: true })}
          </span>
        </div>
      )}
      <div className="mt-3 pt-3 border-t border-ios-divider text-xs text-ios-hint flex justify-between">
        <span>Операций: {current.txCount}</span>
        <span>Прошлый период: {previous.txCount} оп.</span>
      </div>
    </div>
  );
}

// ─── Net Worth ("Мой капитал") card ──────────────────────────────────────

/**
 * "Мой капитал" = everything you own (cash + bank + investments + other
 * assets) minus what you owe (credit debt). The line shows how that number
 * moved week by week over the last ~6 months; the breakdown below shows what
 * makes it up right now.
 */
function NetWorthCard({
  history,
  capital,
}: {
  history: { weeks: { weekEnd: string; total: string }[]; totalNow: string };
  capital?: {
    totalCash: string;
    totalInvestments: string;
    totalOther: string;
    totalCredits: string;
    totalNetWorth: string;
  };
}) {
  const weeks = history.weeks;
  const startVal = weeks.length ? parseFloat(weeks[0].total) : 0;
  // Prefer the authoritative capital figure; fall back to the history tail.
  const nowVal = capital ? parseFloat(capital.totalNetWorth) : parseFloat(history.totalNow);
  const delta = nowVal - startVal;
  const pct = startVal !== 0 ? Math.round((delta / Math.abs(startVal)) * 100) : null;
  const up = delta >= 0;

  const shortDate = (iso: string) =>
    new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace(/\.$/, '');

  // Composition rows (skip zero lines so the card stays tight).
  const rows = capital
    ? (
        [
          {
            label: '💵 Деньги',
            hint: 'наличные и на картах',
            value: parseFloat(capital.totalCash),
            neg: false,
          },
          {
            label: '📈 Инвестиции',
            hint: 'брокер, крипта',
            value: parseFloat(capital.totalInvestments),
            neg: false,
          },
          {
            label: '🚗 Активы',
            hint: 'мото, техника и пр.',
            value: parseFloat(capital.totalOther),
            neg: false,
          },
          {
            label: '💳 Долги',
            hint: 'остаток по кредитам',
            value: parseFloat(capital.totalCredits),
            neg: true,
          },
        ] as const
      ).filter((r) => Math.abs(r.value) > 0.005)
    : [];

  return (
    <Card title="💰 Мой капитал">
      <div className="px-4 py-3">
        {/* Headline: current value + change over the whole window */}
        <div className="flex justify-between items-start mb-1">
          <div>
            <div className="text-sm text-ios-hint">Сейчас</div>
            <div className="font-rounded font-bold text-2xl tabular-nums mt-0.5">{fmtRub(nowVal)}</div>
          </div>
          {weeks.length > 1 && (
            <div className="text-right">
              <div
                className={`inline-flex items-center gap-1 text-[13px] font-semibold rounded-full px-2 py-0.5 ${
                  up ? 'bg-ios-green/15 text-ios-green' : 'bg-ios-red/15 text-ios-red'
                }`}
              >
                {up ? '↑' : '↓'} {fmtRub(Math.abs(delta), { compact: true })}
                {pct !== null && (
                  <span className="opacity-80">
                    ({up ? '+' : '−'}
                    {Math.abs(pct)}%)
                  </span>
                )}
              </div>
              <div className="text-[11px] text-ios-hint mt-1">за 6 месяцев</div>
            </div>
          )}
        </div>

        <div className="mt-3">
          <LineChart
            points={weeks.map((w) => ({ x: w.weekEnd, y: parseFloat(w.total) }))}
            height={150}
            color={up ? '#34C759' : '#FF3B30'}
            baseline={startVal}
            xStartLabel={weeks.length ? shortDate(weeks[0].weekEnd) : undefined}
            xEndLabel="сейчас"
          />
          <div className="text-[11px] text-ios-hint mt-1 text-center leading-snug">
            Пунктир — уровень {shortDate(weeks[0]?.weekEnd ?? new Date().toISOString())}. Точка на линии =
            капитал на конец недели.
          </div>
        </div>

        {/* Composition breakdown — what the number is made of right now */}
        {rows.length > 0 && capital && (
          <div className="mt-4 pt-3 border-t border-ios-divider space-y-2">
            <div className="text-[11px] font-semibold uppercase text-ios-hint tracking-wider">
              Из чего складывается
            </div>
            {rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-sm">{r.label}</span>
                  <span className="text-[11px] text-ios-hint">{r.hint}</span>
                </div>
                <span
                  className={`tabular-nums text-sm font-medium ${r.neg ? 'text-ios-red' : 'text-ios-text'}`}
                >
                  {r.neg ? '−' : ''}
                  {fmtRub(r.value)}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between pt-2 mt-1 border-t border-ios-divider">
              <span className="text-sm font-semibold">= Чистый капитал</span>
              <span className="tabular-nums text-sm font-bold">{fmtRub(capital.totalNetWorth)}</span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Sold assets card ─────────────────────────────────────────────────────

function SoldAssetsCard({
  items,
}: {
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
}) {
  // Filter:
  //  • "Все"          — everything.
  //  • "Выкупленные"  — only fully closed deals (buyer paid in full); excludes
  //                     still-open partial positions.
  //  • "Займ и убытки" — deals with no earnings: losses, break-even, AND open
  //                     positions with a partial payment (money in, not fully
  //                     recovered yet).
  // Both the aggregate row and the list follow the current filter.
  type Filter = 'all' | 'completed' | 'loss';
  const [filter, setFilter] = useState<Filter>('all');
  const shown = items.filter((it) => {
    if (filter === 'completed') return !it.partial && it.saleDate != null;
    if (filter === 'loss') return it.partial || parseFloat(it.pnl) <= 0;
    return true;
  });

  // Aggregates across the shown sales — gives the user a one-glance bottom line.
  const totals = shown.reduce(
    (acc, it) => {
      acc.invested += parseFloat(it.purchasePrice);
      acc.returned += parseFloat(it.salePrice);
      acc.pnl += parseFloat(it.pnl);
      return acc;
    },
    { invested: 0, returned: 0, pnl: 0 },
  );

  // Same day format as the transaction history ("02.07.2026 Пт", with weekday).
  const fmtDate = (iso: string | null) => (iso ? fmtDayHeader(iso) : '—');

  // Month bucket for the divider rows: sales are grouped by the month of the
  // sale (fallback to the purchase month for never-sold rows). Items arrive
  // sorted by saleDate desc, so consecutive rows share a month.
  const MONTHS = [
    'Январь',
    'Февраль',
    'Март',
    'Апрель',
    'Май',
    'Июнь',
    'Июль',
    'Август',
    'Сентябрь',
    'Октябрь',
    'Ноябрь',
    'Декабрь',
  ];
  const monthLabel = (it: { saleDate: string | null; purchaseDate: string }) => {
    const d = new Date(it.saleDate ?? it.purchaseDate);
    return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  };

  return (
    <Card title="🚗 Куплено и продано">
      <div className="px-4 pb-3">
        {/* Filter toggle */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {(
            [
              { id: 'all', label: 'Все' },
              { id: 'completed', label: 'Выкупленные' },
              { id: 'loss', label: 'Займ и убытки' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                haptic('select');
                setFilter(opt.id);
              }}
              className={`px-3 py-1 rounded-full text-[12px] font-medium transition ${
                filter === opt.id
                  ? 'bg-ios-accent text-white'
                  : 'bg-ios-surface2 text-ios-subtext active:bg-ios-surface'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Aggregate row at the top */}
        <div className="grid grid-cols-3 gap-3 mb-3 pb-3 border-b border-ios-divider">
          <div>
            <div className="text-[11px] text-ios-hint">Вложено</div>
            <div className="font-rounded font-semibold tabular-nums text-[14px]">
              {fmtRub(totals.invested, { compact: true })}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-ios-hint">Получено</div>
            <div className="font-rounded font-semibold tabular-nums text-[14px]">
              {fmtRub(totals.returned, { compact: true })}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-ios-hint">P&amp;L</div>
            <div
              className={`font-rounded font-semibold tabular-nums text-[14px] ${
                totals.pnl > 0 ? 'text-ios-green' : totals.pnl < 0 ? 'text-ios-red' : 'text-ios-subtext'
              }`}
            >
              {totals.pnl > 0 ? '+' : ''}
              {fmtRub(totals.pnl, { compact: true })}
            </div>
          </div>
        </div>

        {/* Item list — grouped by month with divider rows */}
        <div className="space-y-3">
          {shown.map((it, i) => {
            const month = monthLabel(it);
            const isNewMonth = i === 0 || month !== monthLabel(shown[i - 1]);
            const pnlNum = parseFloat(it.pnl);
            // Partial (still-open) positions: pnl is the amount still owed to
            // you, not a realized loss — show it amber, not red.
            const outstanding = parseFloat(it.purchasePrice) - parseFloat(it.salePrice);
            const pnlColor = it.partial
              ? 'text-amber-500'
              : pnlNum > 0
                ? 'text-ios-green'
                : pnlNum < 0
                  ? 'text-ios-red'
                  : 'text-ios-subtext';
            const pnlBg = it.partial
              ? 'bg-amber-500/15'
              : pnlNum > 0
                ? 'bg-ios-green/15'
                : pnlNum < 0
                  ? 'bg-ios-red/15'
                  : 'bg-ios-surface2';
            const sign = pnlNum > 0 ? '+' : '';
            return (
              <div key={it.id}>
                {isNewMonth && (
                  <div className={`flex items-center gap-2 ${i === 0 ? '' : 'mt-4'} mb-2`}>
                    <span className="text-[12px] font-semibold text-ios-subtext whitespace-nowrap">
                      {month}
                    </span>
                    <div className="flex-1 h-px bg-ios-separator" />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span>{it.emoji}</span>
                      <span className="truncate font-medium">{it.name}</span>
                      {it.partial && (
                        <span className="shrink-0 text-[10px] font-semibold text-amber-500 bg-amber-500/15 rounded px-1.5 py-0.5">
                          частично
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-ios-hint mt-0.5">
                      {fmtDate(it.purchaseDate)}
                      {it.saleDate && (
                        <>
                          {' '}
                          <span className="text-ios-subtext">→</span> {fmtDate(it.saleDate)}
                          {it.partial && ' (предоплата)'}
                        </>
                      )}
                    </div>
                    <div className="text-[11px] text-ios-hint mt-0.5 tabular-nums">
                      {it.partial ? 'вложено ' : ''}
                      {fmtRub(it.purchasePrice)} <span className="text-ios-subtext">→</span>{' '}
                      {it.partial ? 'получено ' : ''}
                      {fmtRub(it.salePrice)}
                    </div>
                    {it.partial && (
                      <div className="text-[11px] text-amber-500 mt-0.5 tabular-nums">
                        осталось получить {fmtRub(outstanding)}
                      </div>
                    )}
                  </div>
                  <div
                    className={`shrink-0 ml-3 px-2 py-1 rounded-md text-[12px] font-semibold tabular-nums ${pnlBg} ${pnlColor}`}
                  >
                    {sign}
                    {fmtRub(pnlNum, { compact: true })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {shown.length === 0 && (
          <p className="text-center text-ios-hint text-sm py-4">Нет записей под фильтр</p>
        )}
      </div>
    </Card>
  );
}

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type BudgetCategoryRow, type FactStatus } from '../lib/api';
import { Header } from '../components/Header';
import { Card, ListRow } from '../components/Card';
import { ProgressBar } from '../components/ProgressBar';
import { Sheet } from '../components/Sheet';
import { AmountKeypad } from '../components/AmountKeypad';
import { IncomeSourceList } from '../components/IncomeSourceList';
import { fmtRub, fmtMonth, categoryEmoji, STATUS_COLOR } from '../lib/format';
import { haptic } from '../lib/telegram';

export function BudgetPage() {
  // No /api/me waterfall — server picks current month from user.monthStartDay.
  const budget = useQuery({
    queryKey: ['budget', 'current'],
    queryFn: () => api.budget(),
    staleTime: 15_000,
  });

  const [editing, setEditing] = useState<{ kind: 'category' | 'global_expense' | 'global_income' | 'investments'; row?: BudgetCategoryRow } | null>(null);

  if (budget.isLoading || !budget.data)
    return (
      <div className="p-4 space-y-4">
        <div className="h-8 w-32 bg-ios-surface rounded-md animate-pulse" />
        <div className="h-72 bg-ios-surface rounded-ios-lg animate-pulse" />
      </div>
    );

  const b = budget.data;

  return (
    <div className="pb-28">
      <Header title="Бюджет" subtitle={fmtMonth(b.month)} />

      {/* Total card */}
      <div className="px-4">
        <button
          type="button"
          onClick={() => setEditing({ kind: 'global_expense' })}
          className="w-full text-left bg-ios-surface rounded-ios-lg p-5 shadow-card active:scale-[0.99]"
        >
          <div className="text-sm text-ios-hint">Расход за {fmtMonth(b.month)}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-rounded font-bold tabular-nums">
              {fmtRub(b.total.actual)}
            </span>
            <span className="text-ios-hint tabular-nums">
              из {fmtRub(b.total.planned)}
            </span>
          </div>
          <div className="mt-3">
            <ProgressBar percent={b.total.percent} status={b.total.status} />
          </div>
          <div className={`mt-2 text-sm ${STATUS_COLOR[b.total.status]}`}>
            {b.total.percent !== null
              ? `${b.total.percent}% · ${parseFloat(b.total.delta) > 0 ? 'превышение' : 'остаток'} ${fmtRub(Math.abs(parseFloat(b.total.delta)))}`
              : 'План не задан — нажмите, чтобы задать'}
          </div>
        </button>
      </div>

      <div className="mt-5">
        <Card title="Категории">
          {b.categories.map((row, i) => (
            <ListRow
              key={row.categoryId}
              divider={i !== b.categories.length - 1}
              onClick={() => {
                haptic('light');
                setEditing({ kind: 'category', row });
              }}
              left={
                <div>
                  <div className="font-medium flex items-center gap-2">
                    <span className="text-lg">{categoryEmoji(row.name)}</span>
                    <span>{row.name}</span>
                    {row.percent !== null && (
                      <span className={`text-xs font-semibold ${STATUS_COLOR[row.status]}`}>
                        {row.percent}%
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 max-w-[260px]">
                    <ProgressBar percent={row.percent} status={row.status} />
                  </div>
                  <div className="mt-1 text-xs text-ios-hint tabular-nums">
                    {row.percent === null
                      ? `${fmtRub(row.actual)} (план не задан)`
                      : `${fmtRub(row.actual)} / ${fmtRub(row.planned)}`}
                  </div>
                </div>
              }
            />
          ))}
        </Card>

        <Card title="Источники дохода">
          <div className="px-3 py-2">
            <IncomeSourceList compact />
          </div>
        </Card>

        <Card title="Доходы и инвестиции">
          {/* Доходы */}
          <ListRow
            onClick={() => setEditing({ kind: 'global_income' })}
            left={
              <div className="w-full">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm">Доходы</span>
                  <div className="text-right">
                    <span className="font-medium tabular-nums">{fmtRub(b.totalIncome)}</span>
                    {b.plannedIncome && (
                      <span className="text-xs text-ios-hint ml-1 tabular-nums">
                        / {fmtRub(b.plannedIncome)}
                      </span>
                    )}
                  </div>
                </div>
                {b.plannedIncome ? (() => {
                  const pct = Math.round(
                    (parseFloat(b.totalIncome) / parseFloat(b.plannedIncome)) * 100,
                  );
                  const status: FactStatus = pct >= 100 ? 'ok' : pct >= 50 ? 'warning' : 'no_plan';
                  return <ProgressBar percent={pct} status={status} />;
                })() : (
                  <div className="text-[11px] text-ios-hint">план не задан</div>
                )}
              </div>
            }
          />
          {/* Инвестиции */}
          <ListRow
            onClick={() => setEditing({ kind: 'investments' })}
            divider={false}
            left={
              <div className="w-full">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm">Инвестиции</span>
                  <div className="text-right">
                    <span className="font-medium tabular-nums">{fmtRub(b.totalInvestments)}</span>
                    {b.plannedInvestments && (
                      <span className="text-xs text-ios-hint ml-1 tabular-nums">
                        / {fmtRub(b.plannedInvestments)}
                      </span>
                    )}
                  </div>
                </div>
                {b.plannedInvestments ? (() => {
                  const pct = Math.round(
                    (parseFloat(b.totalInvestments) / parseFloat(b.plannedInvestments)) * 100,
                  );
                  const status: FactStatus = pct >= 100 ? 'ok' : 'warning';
                  return <ProgressBar percent={pct} status={status} />;
                })() : (
                  <div className="text-[11px] text-ios-hint">план не задан</div>
                )}
              </div>
            }
          />
        </Card>
      </div>

      <PlanEditor
        open={!!editing}
        onClose={() => setEditing(null)}
        editing={editing}
        month={b.month}
      />
    </div>
  );
}

function PlanEditor({
  open,
  onClose,
  editing,
  month,
}: {
  open: boolean;
  onClose: () => void;
  editing: { kind: 'category' | 'global_expense' | 'global_income' | 'investments'; row?: BudgetCategoryRow } | null;
  month: string;
}) {
  const qc = useQueryClient();
  const [propagate, setPropagate] = useState(true);

  const setCat = useMutation({
    mutationFn: (amount: string) =>
      propagate
        ? api.setCategoryPlanPropagate({
            month,
            categoryId: editing!.row!.categoryId,
            amount,
            propagateMonths: 11,
            onlyEmpty: true,
          })
        : api.setCategoryPlan({ month, categoryId: editing!.row!.categoryId, amount }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget'] });
      qc.invalidateQueries({ queryKey: ['bootstrap'] });
      haptic('success');
      onClose();
    },
  });
  const setGlobal = useMutation({
    mutationFn: (amount: string) => {
      if (editing?.kind === 'global_expense') {
        return api.setGlobalPlan({ month, plannedTotalExpenses: amount });
      } else if (editing?.kind === 'global_income') {
        return api.setGlobalPlan({ month, plannedTotalIncome: amount });
      } else if (editing?.kind === 'investments') {
        return api.setGlobalPlan({ month, plannedInvestments: amount });
      }
      return Promise.reject(new Error('Unknown'));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget'] });
      qc.invalidateQueries({ queryKey: ['bootstrap'] });
      haptic('success');
      onClose();
    },
  });

  if (!editing) return null;
  const title =
    editing.kind === 'category'
      ? `План: ${editing.row?.name}`
      : editing.kind === 'global_expense'
        ? 'Общий план расходов'
        : editing.kind === 'global_income'
          ? 'План дохода'
          : 'План инвестиций';

  const initial =
    editing.kind === 'category'
      ? (editing.row?.planned && editing.row.planned !== '0' ? editing.row.planned : '')
      : '';

  const submit = (v: string) => {
    if (editing.kind === 'category') setCat.mutate(v);
    else setGlobal.mutate(v);
  };

  // "Propagate to future months" toggle — only shown for category plans
  // (global plans are explicitly per-month).
  const showPropagateToggle = editing.kind === 'category';

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {showPropagateToggle && (
        <div className="px-4 pt-1">
          <button
            type="button"
            onClick={() => setPropagate(!propagate)}
            className="w-full flex items-center justify-between bg-ios-surface rounded-ios px-4 py-3 active:bg-ios-surface2"
          >
            <div className="text-left">
              <div className="text-sm font-medium">Применить к следующим месяцам</div>
              <div className="text-xs text-ios-hint mt-0.5">
                {propagate
                  ? 'будет проставлен на 12 месяцев вперёд там, где плана нет'
                  : 'только этот месяц'}
              </div>
            </div>
            <span
              className={`w-12 h-7 rounded-full relative transition ${propagate ? 'bg-ios-green' : 'bg-ios-divider'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${propagate ? 'translate-x-5' : ''}`}
              />
            </span>
          </button>
        </div>
      )}
      <AmountKeypad
        initial={initial.replace('.', ',')}
        onSubmit={submit}
        submitLabel="Сохранить план"
        busy={setCat.isPending || setGlobal.isPending}
        hint={`на ${fmtMonth(month)}`}
      />
    </Sheet>
  );
}

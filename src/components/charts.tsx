/**
 * Hand-rolled SVG charts. Tiny, no dependencies, theme-aware.
 *
 * The point is to avoid pulling in recharts (~80 KB gzip) for what is ultimately
 * a few lines and rectangles. We render at a fixed viewBox and let CSS scale.
 */

import { useMemo } from 'react';
import { fmtRub } from '../lib/format';

// ─── Line chart (single + dual-line) ─────────────────────────────────────

export interface LinePoint {
  x: string; // label, e.g. '2026-04-01'
  y: number;
}

export function LineChart({
  points,
  height = 160,
  color = 'var(--ios-accent)',
  fillUnder = true,
  yFormatter = (v: number) => fmtRub(v, { compact: true }),
  // When set, a faint dashed horizontal line is drawn at this value — used as
  // the "where you started" reference so gains/losses read at a glance.
  baseline,
  // Optional date captions for the two ends of the X axis. When provided they
  // replace the plain min/max Y labels at the bottom (dates are far more
  // meaningful than a bare value range for a time series). The Y scale is then
  // surfaced as faint left-edge labels instead.
  xStartLabel,
  xEndLabel,
}: {
  points: LinePoint[];
  height?: number;
  color?: string;
  fillUnder?: boolean;
  yFormatter?: (v: number) => string;
  baseline?: number;
  xStartLabel?: string;
  xEndLabel?: string;
}) {
  const W = 400;
  const H = height;
  const PAD_X = 8;
  const PAD_TOP = 12;
  const PAD_BOTTOM = 22;

  const { path, area, ymin, ymax, lastPoint, baselineY } = useMemo(() => {
    if (points.length === 0) {
      return { path: '', area: '', ymin: 0, ymax: 0, lastPoint: null as { x: number; y: number } | null, baselineY: null as number | null };
    }
    const ys = points.map((p) => p.y);
    // Include the baseline in the range so its dashed line is always visible.
    if (baseline != null) ys.push(baseline);
    let yminVal = Math.min(...ys);
    let ymaxVal = Math.max(...ys);
    if (yminVal === ymaxVal) {
      ymaxVal = yminVal + 1;
    }
    // Add a small headroom so peaks don't touch the top edge
    const span = ymaxVal - yminVal;
    yminVal = yminVal - span * 0.05;
    ymaxVal = ymaxVal + span * 0.05;

    const innerW = W - PAD_X * 2;
    const innerH = H - PAD_TOP - PAD_BOTTOM;
    const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
    const px = (i: number) => PAD_X + i * stepX;
    const py = (v: number) => PAD_TOP + innerH - ((v - yminVal) / (ymaxVal - yminVal)) * innerH;

    const linePath = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(i).toFixed(2)} ${py(p.y).toFixed(2)}`)
      .join(' ');
    const areaPath = `${linePath} L ${px(points.length - 1).toFixed(2)} ${(PAD_TOP + innerH).toFixed(2)} L ${PAD_X.toFixed(2)} ${(PAD_TOP + innerH).toFixed(2)} Z`;
    const last = { x: px(points.length - 1), y: py(points[points.length - 1].y) };

    return {
      path: linePath,
      area: areaPath,
      ymin: yminVal,
      ymax: ymaxVal,
      lastPoint: last,
      baselineY: baseline != null ? py(baseline) : null,
    };
  }, [points, W, H, baseline]);

  if (points.length === 0)
    return <div className="text-center py-8 text-ios-hint text-sm">Нет данных</div>;

  const showDates = xStartLabel != null || xEndLabel != null;

  return (
    <div className="w-full">
      {/* With dates on the X axis, surface the Y scale as faint edge labels so
          the reader still knows the vertical range. */}
      <div className="relative">
        {showDates && (
          <>
            <span className="absolute left-1 top-0 text-[10px] text-ios-hint/70 tabular-nums pointer-events-none">
              {yFormatter(ymax)}
            </span>
            <span className="absolute left-1 bottom-0 text-[10px] text-ios-hint/70 tabular-nums pointer-events-none">
              {yFormatter(ymin)}
            </span>
          </>
        )}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="w-full"
          style={{ height: `${H}px`, display: 'block' }}
        >
          <defs>
            <linearGradient id="line-fill-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.3" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {baselineY != null && (
            <line
              x1={PAD_X}
              y1={baselineY}
              x2={W - PAD_X}
              y2={baselineY}
              stroke="var(--ios-hint)"
              strokeWidth={1}
              strokeDasharray="4 4"
              opacity={0.5}
            />
          )}
          {fillUnder && <path d={area} fill="url(#line-fill-grad)" />}
          <path d={path} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
          {lastPoint && (
            <circle cx={lastPoint.x} cy={lastPoint.y} r={4} fill={color} stroke="var(--ios-surface)" strokeWidth={2} />
          )}
        </svg>
      </div>
      <div className="flex justify-between text-[10px] text-ios-hint mt-1 px-1">
        <span>{showDates ? xStartLabel : yFormatter(ymin)}</span>
        <span>{showDates ? xEndLabel : yFormatter(ymax)}</span>
      </div>
    </div>
  );
}

// ─── Bar chart (vertical bars, single series) ────────────────────────────

export interface BarPoint {
  label: string;
  value: number;
  color?: string;
}

export function BarChart({
  bars,
  height = 140,
  yFormatter = (v: number) => fmtRub(v, { compact: true }),
}: {
  bars: BarPoint[];
  height?: number;
  yFormatter?: (v: number) => string;
}) {
  const W = 400;
  const H = height;
  const PAD_X = 8;
  const PAD_TOP = 8;
  const PAD_BOTTOM = 22;

  if (bars.length === 0)
    return <div className="text-center py-8 text-ios-hint text-sm">Нет данных</div>;

  const max = Math.max(...bars.map((b) => b.value), 1);
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_TOP - PAD_BOTTOM;
  const gap = 2;
  const barW = (innerW - gap * (bars.length - 1)) / bars.length;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: `${H}px`, display: 'block' }}
      >
        {bars.map((b, i) => {
          const h = (b.value / max) * innerH;
          const x = PAD_X + i * (barW + gap);
          const y = PAD_TOP + innerH - h;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={Math.max(barW, 1)}
                height={Math.max(h, 0.5)}
                fill={b.color ?? 'var(--ios-accent)'}
                rx={1.5}
              />
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-ios-hint mt-1 px-1">
        <span>{bars[0]?.label ?? ''}</span>
        <span>max: {yFormatter(max)}</span>
        <span>{bars[bars.length - 1]?.label ?? ''}</span>
      </div>
    </div>
  );
}

// ─── Horizontal category list with proportional bars (top-N expense view) ──

/**
 * Slice colours for the spend donut. A short, deliberately distinct set —
 * the donut only ever shows a handful of slices, so these read apart at a
 * glance instead of the long chart palette below, where neighbouring hues
 * are fine because each bar is labelled.
 */
const DONUT_COLORS = ['#F2427A', '#6C48F5', '#00BFA5', '#F0A500'];

/**
 * Spend split as a donut with a legend. Drawn with a conic-gradient — no chart
 * library. Everything past the top slices folds into "Прочее" so the legend
 * stays readable instead of listing twenty 1% rows.
 */
export function CategoryDonut({
  items,
  total,
  maxSlices = 4,
}: {
  items: { name: string; amount: string; share: number }[];
  total: string;
  maxSlices?: number;
}) {
  if (items.length === 0)
    return <div className="text-center py-8 text-ios-hint text-sm">Нет данных за период</div>;

  const top = items.slice(0, maxSlices);
  const rest = items.slice(maxSlices);
  const restShare = rest.reduce((acc, i) => acc + i.share, 0);
  const restAmount = rest.reduce((acc, i) => acc + (parseFloat(i.amount) || 0), 0);

  const slices = [
    ...top.map((it, i) => ({ ...it, color: DONUT_COLORS[i % DONUT_COLORS.length] })),
    ...(restShare > 0
      ? [
          {
            name: 'Прочее',
            amount: String(restAmount),
            share: Math.round(restShare * 10) / 10,
            color: 'var(--ios-divider)',
          },
        ]
      : []),
  ];

  let acc = 0;
  const stops = slices
    .map((sl) => {
      const from = acc;
      acc += sl.share;
      return `${sl.color} ${from}% ${acc}%`;
    })
    .join(', ');

  return (
    <div>
      <div className="flex justify-center">
        <div
          className="relative w-[168px] h-[168px] rounded-full"
          style={{ background: `conic-gradient(${stops})` }}
        >
          {/* Punch-out centre, filled with the card colour so the ring reads
              as a ring in both themes. */}
          <div className="absolute inset-[34px] rounded-full bg-ios-surface grid place-items-center text-center">
            <div>
              <div className="text-[17px] font-bold tabular-nums">{fmtRub(total)}</div>
              <div className="text-[11px] text-ios-hint">всего трат</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {slices.map((sl) => (
          <div key={sl.name} className="flex items-center gap-2.5 text-[13px]">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: sl.color }} />
            <span className="flex-1 truncate font-medium">{sl.name}</span>
            <span className="text-ios-hint tabular-nums shrink-0">
              {sl.share}% · {fmtRub(sl.amount, { compact: true })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CategoryBars({
  items,
  total,
}: {
  items: { name: string; amount: string; share: number }[];
  total: string;
}) {
  if (items.length === 0)
    return <div className="text-center py-8 text-ios-hint text-sm">Нет данных за период</div>;

  const COLORS = [
    '#FF3B30', '#FF9F0A', '#FFD60A', '#34C759',
    '#5AC8FA', '#007AFF', '#5856D6', '#AF52DE',
    '#FF2D55', '#A2845E', '#8E8E93', '#34C759',
  ];

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-ios-hint px-1">
        <span>{items.length} категорий</span>
        <span className="tabular-nums">всего: {fmtRub(total)}</span>
      </div>
      {items.map((it, i) => (
        <div key={it.name} className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex justify-between text-sm">
              <span className="truncate font-medium">{it.name}</span>
              <span className="tabular-nums text-ios-subtext shrink-0 ml-2">{fmtRub(it.amount)}</span>
            </div>
            <div className="h-1.5 mt-1 bg-ios-divider rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${it.share}%`, backgroundColor: COLORS[i % COLORS.length] }}
              />
            </div>
          </div>
          <span className="text-[11px] text-ios-hint w-9 text-right tabular-nums">{it.share}%</span>
        </div>
      ))}
    </div>
  );
}

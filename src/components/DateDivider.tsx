import { fmtDayHeader } from '../lib/format';

/**
 * Day separator rendered above each day's group in a transaction list.
 * Left-aligned header (e.g. "02.07.2026 Пт") that heads the rows below it.
 */
export function DateDivider({ iso }: { iso: string }) {
  return (
    <div className="px-4 pt-3 pb-1.5 text-[12px] font-semibold text-ios-hint select-none">
      {fmtDayHeader(iso)}
    </div>
  );
}

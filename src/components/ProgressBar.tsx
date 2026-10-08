import { STATUS_BAR } from '../lib/format';
import type { FactStatus } from '../lib/api';

export function ProgressBar({
  percent,
  status,
}: {
  percent: number | null;
  status: FactStatus;
}) {
  const pct = Math.min(Math.max(percent ?? 0, 0), 130); // clamp visual to 130%
  const overflow = (percent ?? 0) > 100;
  return (
    <div className="h-1.5 w-full bg-ios-divider rounded-full overflow-hidden">
      <div
        className={`h-full ${STATUS_BAR[status]} ${overflow ? 'animate-pulse' : ''} transition-all`}
        style={{ width: `${(pct / 130) * 100}%` }}
      />
    </div>
  );
}

import { type ReactNode } from 'react';

export function Header({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <header
      className="px-4 pt-4 pb-3 flex items-end justify-between"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
    >
      <div className="min-w-0">
        <h1 className="text-3xl font-rounded font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-ios-hint mt-0.5 text-sm">{subtitle}</p>}
      </div>
      {right && <div className="shrink-0 ml-3">{right}</div>}
    </header>
  );
}

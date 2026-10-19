import { type ReactNode } from 'react';

export function Card({
  children,
  className = '',
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <section className={`mb-5 ${className}`}>
      {title && (
        <h2 className="px-4 mb-1.5 text-[13px] font-semibold uppercase tracking-wider text-ios-hint">
          {title}
        </h2>
      )}
      <div className="bg-ios-surface rounded-ios-lg overflow-hidden shadow-card">{children}</div>
    </section>
  );
}

export function ListRow({
  left,
  right,
  bottom,
  onClick,
  divider = true,
  active = false,
}: {
  left: ReactNode;
  right?: ReactNode;
  bottom?: ReactNode;
  onClick?: () => void;
  divider?: boolean;
  active?: boolean;
}) {
  const interactive = !!onClick;
  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : -1}
      onClick={onClick}
      onKeyDown={(e) => {
        if (interactive && (e.key === 'Enter' || e.key === ' ')) onClick?.();
      }}
      className={`relative px-4 py-3 flex items-center justify-between gap-3 select-none-ui ${
        interactive ? 'active:bg-black/5 dark:active:bg-white/5 cursor-pointer' : ''
      } ${active ? 'bg-ios-accentSoft' : ''}`}
    >
      <div className="flex-1 min-w-0">{left}</div>
      {right && <div className="text-right text-ios-hint shrink-0">{right}</div>}
      {bottom}
      {divider && <div className="absolute left-4 right-0 bottom-0 h-px bg-ios-divider last:hidden" />}
    </div>
  );
}

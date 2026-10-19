import { type ReactNode, useEffect } from 'react';

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40 animate-[fadeIn_0.18s_ease-out]" onClick={onClose} />
      <div
        className="relative w-full max-w-md bg-ios-bg rounded-t-3xl shadow-2xl pb-4 animate-[slideUp_0.22s_ease-out]"
        style={{ paddingBottom: 'calc(var(--safe-bottom) + 1rem)' }}
        role="dialog"
      >
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-9 h-1 rounded-full bg-ios-divider" />
        </div>
        {title && (
          <div className="px-5 pt-2 pb-3 flex items-center justify-between">
            <h3 className="text-lg font-semibold">{title}</h3>
            <button onClick={onClose} className="text-ios-accent text-base font-medium select-none-ui">
              Готово
            </button>
          </div>
        )}
        <div className="max-h-[80vh] overflow-y-auto">{children}</div>
      </div>
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
      `}</style>
    </div>
  );
}

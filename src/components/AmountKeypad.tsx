import { useEffect, useRef, useState } from 'react';
import { haptic } from '../lib/telegram';

interface Props {
  initial?: string;
  onSubmit: (value: string) => void;
  submitLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  hint?: string;
  onBack?: () => void;
  /**
   * When provided, renders a "Добавить комментарий" checkbox above the keypad.
   * Off by default — tapping it expands a textarea inline. Caller manages the
   * comment string in its own state.
   */
  comment?: string;
  onCommentChange?: (v: string) => void;
}

const KEYS: (string | 'back' | 'sep')[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'sep', '0', 'back'];

export function AmountKeypad({
  initial = '',
  onSubmit,
  submitLabel = 'Сохранить',
  busy,
  disabled,
  hint,
  onBack,
  comment,
  onCommentChange,
}: Props) {
  const [val, setVal] = useState(initial);
  const [commentOpen, setCommentOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setVal(initial), [initial]);

  // When user opens the comment, autofocus the textarea so the OS keyboard
  // appears immediately and they can type. Closing wipes the comment so we
  // don't accidentally submit a stale value.
  useEffect(() => {
    if (commentOpen) {
      taRef.current?.focus();
    } else if (onCommentChange && comment) {
      onCommentChange('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentOpen]);

  const press = (k: string | 'back' | 'sep') => {
    haptic('light');
    setVal((cur) => {
      if (k === 'back') return cur.slice(0, -1);
      if (k === 'sep') {
        if (cur.includes(',')) return cur;
        return cur === '' ? '0,' : cur + ',';
      }
      if (/^0$/.test(cur) && k !== ',') return k;
      if (cur.includes(',')) {
        const [, frac = ''] = cur.split(',');
        if (frac.length >= 2) return cur;
      }
      return cur + k;
    });
  };

  const numericValue = parseFloat(val.replace(',', '.') || '0');
  const canSubmit = !disabled && !busy && numericValue > 0;
  const showCommentSection = onCommentChange !== undefined;

  return (
    <div className="flex flex-col">
      <div className="text-center px-6 py-6">
        <div className="text-5xl font-rounded font-semibold tabular-nums tracking-tight">
          {val ? val.replace('.', ',') : '0'} <span className="text-ios-hint">₽</span>
        </div>
        {hint && <div className="mt-2 text-sm text-ios-hint">{hint}</div>}
      </div>

      {showCommentSection && (
        <div className="px-3 mb-2 select-none-ui">
          {!commentOpen ? (
            <button
              type="button"
              onClick={() => {
                haptic('select');
                setCommentOpen(true);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-ios bg-ios-surface active:bg-ios-surface2 transition"
            >
              <span className="w-5 h-5 rounded-md border-2 border-ios-divider shrink-0" />
              <span className="text-sm text-ios-subtext">Добавить комментарий</span>
            </button>
          ) : (
            <div className="bg-ios-surface rounded-ios px-3 py-2">
              <div className="flex items-center gap-2.5 pb-1.5">
                <button
                  type="button"
                  onClick={() => {
                    haptic('select');
                    setCommentOpen(false);
                  }}
                  className="w-5 h-5 rounded-md bg-ios-accent flex items-center justify-center shrink-0 active:opacity-70"
                  aria-label="Снять отметку"
                >
                  <svg viewBox="0 0 12 12" className="w-3.5 h-3.5">
                    <path
                      d="M2 6 L5 9 L10 3"
                      stroke="white"
                      strokeWidth="2"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <span className="text-xs text-ios-hint flex-1">Комментарий к операции</span>
              </div>
              <textarea
                ref={taRef}
                value={comment ?? ''}
                onChange={(e) => onCommentChange?.(e.target.value)}
                rows={2}
                placeholder="например, перекрёсток"
                className="w-full bg-transparent outline-none resize-none text-sm placeholder:text-ios-hint"
              />
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 px-3 select-none-ui">
        {KEYS.map((k) => {
          if (k === 'sep') {
            return (
              <button
                key="sep"
                type="button"
                onClick={() => press('sep')}
                className="bg-ios-surface rounded-ios py-4 text-2xl active:bg-ios-surface2 transition-colors"
              >
                ,
              </button>
            );
          }
          if (k === 'back') {
            return (
              <button
                key="back"
                type="button"
                onClick={() => press('back')}
                className="bg-ios-surface rounded-ios py-4 text-2xl active:bg-ios-surface2 transition-colors"
                aria-label="Стереть"
              >
                ⌫
              </button>
            );
          }
          return (
            <button
              key={k}
              type="button"
              onClick={() => press(k)}
              className="bg-ios-surface rounded-ios py-4 text-2xl font-medium active:bg-ios-surface2 transition-colors"
            >
              {k}
            </button>
          );
        })}
      </div>

      <div className="px-3 mt-3 mb-4 flex gap-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex-1 bg-ios-surface rounded-ios py-4 text-base font-medium active:bg-ios-surface2"
          >
            Назад
          </button>
        )}
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => {
            haptic('success');
            onSubmit(val.replace(',', '.'));
          }}
          className={`flex-[2] rounded-ios py-4 text-base font-semibold transition ${
            canSubmit ? 'bg-ios-accent text-white active:opacity-90' : 'bg-ios-surface text-ios-hint'
          }`}
        >
          {busy ? '…' : submitLabel}
        </button>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Sheet } from './Sheet';
import { haptic } from '../lib/telegram';
import { CategoryIcon } from '../lib/iconTheme';
import { CATEGORY_ICON_ORDER, makeIconRef, isIconRef, iconRefKey } from '../lib/categoryIcons';

/**
 * Curated emoji set, grouped roughly by spending domain so the user can find
 * something appropriate without scrolling forever. ~70 entries fits two
 * screens on a small phone without feeling sparse.
 */
const POPULAR_EMOJIS: string[] = [
  // Food & groceries
  '🛒',
  '🍕',
  '🍔',
  '🍞',
  '🥗',
  '🥦',
  '🍣',
  '🍜',
  '🍱',
  '☕️',
  '🍺',
  '🍷',
  // Transport
  '🚗',
  '🚕',
  '🚌',
  '🚇',
  '✈️',
  '⛽️',
  '🅿️',
  '🚲',
  '🛴',
  '🚤',
  // Home & bills
  '🏠',
  '💡',
  '🚿',
  '📱',
  '💻',
  '📺',
  '🛋',
  '🪑',
  '🧺',
  '🧹',
  // Entertainment
  '🎬',
  '🎮',
  '🎵',
  '🎤',
  '🍿',
  '🎫',
  '🎲',
  '📚',
  '🎨',
  '🎯',
  // Shopping
  '🛍',
  '👕',
  '👟',
  '👜',
  '💎',
  '🎁',
  '👶',
  '🐶',
  '🐱',
  // Health & sport
  '💊',
  '🏋️',
  '🏥',
  '🦷',
  '⚕️',
  '💆',
  '🧘',
  '⚽️',
  '🏃',
  '🚴',
  // Money & income
  '💰',
  '💳',
  '💵',
  '🏦',
  '📈',
  '📊',
  '💼',
  '🎓',
  // Misc
  '🌹',
  '✨',
  '🎉',
  '🔧',
  '✂️',
  '📦',
  '🌿',
  '🔥',
  '⭐️',
];

interface Props {
  open: boolean;
  onClose: () => void;
  current?: string | null;
  onPick: (emoji: string | null) => void;
  busy?: boolean;
}

/**
 * Bottom-sheet picker. Tap an emoji from the curated grid, type a custom
 * one, or tap "Сбросить" to revert to the auto-mapping by category name.
 */
export function EmojiPicker({ open, onClose, current, onPick, busy }: Props) {
  const [custom, setCustom] = useState('');
  // Default to whichever kind the category already uses.
  const [tab, setTab] = useState<'icons' | 'emoji'>(isIconRef(current) ? 'icons' : 'emoji');

  useEffect(() => {
    if (open) {
      setCustom('');
      setTab(isIconRef(current) ? 'icons' : 'emoji');
    }
  }, [open, current]);

  if (!open) return null;

  const currentKey = isIconRef(current) ? iconRefKey(current as string) : null;

  const submitCustom = () => {
    const v = custom.trim().slice(0, 8);
    if (!v) return;
    haptic('select');
    onPick(v);
  };

  return (
    <Sheet open onClose={onClose} title="Эмодзи категории">
      <div className="px-4 pb-4 pt-1 space-y-3">
        {/* Icons vs emoji tabs */}
        <div className="flex gap-1 bg-ios-surface2 dark:bg-black/30 rounded-ios p-1">
          {(['icons', 'emoji'] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex-1 py-2 rounded-[9px] text-sm font-semibold transition select-none-ui ${
                tab === id ? 'bg-ios-accent text-white' : 'text-ios-subtext'
              }`}
            >
              {id === 'icons' ? 'Иконки' : 'Эмодзи'}
            </button>
          ))}
        </div>

        {tab === 'icons' ? (
          <div className="grid grid-cols-6 gap-2 max-h-[42vh] overflow-y-auto">
            {CATEGORY_ICON_ORDER.map((k) => (
              <button
                key={k}
                type="button"
                disabled={busy}
                onClick={() => {
                  haptic('select');
                  onPick(makeIconRef(k));
                }}
                className={`aspect-square rounded-ios flex items-center justify-center active:scale-90 transition select-none-ui ${
                  k === currentKey
                    ? 'bg-ios-accent/20 ring-2 ring-ios-accent'
                    : 'bg-ios-surface2 dark:bg-black/30'
                }`}
              >
                <CategoryIcon keyOverride={k} style="icons" size={38} />
              </button>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-8 gap-1.5 max-h-[42vh] overflow-y-auto">
            {POPULAR_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                disabled={busy}
                onClick={() => {
                  haptic('select');
                  onPick(e);
                }}
                className={`aspect-square rounded-md text-2xl flex items-center justify-center active:scale-90 transition select-none-ui ${
                  e === current
                    ? 'bg-ios-accent/20 ring-2 ring-ios-accent'
                    : 'bg-ios-surface2 dark:bg-black/30'
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        )}

        <div className="bg-ios-surface rounded-ios-lg p-3">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-ios-hint">
            Свой эмодзи
          </label>
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              maxLength={8}
              placeholder="например: 🌮"
              className="flex-1 bg-transparent outline-none text-2xl text-center placeholder:text-ios-hint placeholder:text-base"
            />
            <button
              type="button"
              disabled={!custom.trim() || busy}
              onClick={submitCustom}
              className="bg-ios-accent text-white rounded-ios px-4 text-sm font-medium disabled:opacity-50"
            >
              ОК
            </button>
          </div>
          <div className="text-[11px] text-ios-hint mt-1.5">
            Откроется системная клавиатура с эмодзи на телефоне.
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onPick(null)}
            className="flex-1 bg-ios-surface rounded-ios py-3 font-medium disabled:opacity-50"
          >
            Сбросить
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 bg-ios-surface rounded-ios py-3 font-medium"
          >
            Закрыть
          </button>
        </div>
      </div>
    </Sheet>
  );
}

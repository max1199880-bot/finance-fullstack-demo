import { useLongPress } from '../hooks/useLongPress';
import { CategoryIcon } from '../lib/iconTheme';

interface Props {
  id: string;
  name: string;
  emoji?: string | null;
  onPick: () => void;
  onLongPress: () => void;
}

/**
 * Square tile used in the expense picker. Tap = pick, hold ≥500ms = open
 * action menu (rename / change emoji / delete). The hold gesture matches
 * Telegram's own message-context pattern, so no extra UI hint is needed.
 */
export function CategoryTile({ name, emoji, onPick, onLongPress }: Props) {
  // wrapClick is a helper, not a DOM prop — keep it out of the spread, otherwise
  // React warns "does not recognize the wrapClick prop on a DOM element".
  const { wrapClick, ...pressHandlers } = useLongPress(onLongPress);
  return (
    <button
      type="button"
      {...pressHandlers}
      onClick={wrapClick(onPick)}
      className="aspect-square bg-ios-surface rounded-ios p-3 flex flex-col items-center justify-center text-center active:scale-[0.97] transition shadow-card select-none-ui"
    >
      <span className="pointer-events-none">
        <CategoryIcon name={name} emoji={emoji} size={46} />
      </span>
      <span className="text-[12px] font-medium mt-1.5 line-clamp-2 pointer-events-none">{name}</span>
    </button>
  );
}

/**
 * "+ New" tile at the end of the grid, visually distinct from real categories.
 */
export function AddTile({ onClick, label = 'Добавить' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="aspect-square bg-ios-accentSoft text-ios-accent rounded-ios p-3 flex flex-col items-center justify-center text-center active:scale-[0.97] transition border-2 border-dashed border-ios-accent/40 select-none-ui"
    >
      <span className="text-3xl leading-none pointer-events-none">＋</span>
      <span className="text-[12px] font-medium mt-1.5 line-clamp-2 pointer-events-none">{label}</span>
    </button>
  );
}

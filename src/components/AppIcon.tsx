// App icon set — solid SVG glyphs that replace the emoji used across the app
// (tab bar, Capital sections, expense categories). Duotone treatment: a filled
// glyph inside a tinted rounded square, one hue per domain. Geometry is shared
// so the tab bar (monochrome, accent/hint) and the lists (tinted chips) stay
// visually consistent.

export type IconName =
  | 'home'
  | 'budget'
  | 'add'
  | 'capital'
  | 'analytics'
  | 'bank'
  | 'cash'
  | 'investment'
  | 'other_asset'
  | 'credit'
  | 'credit_buffer';

// Filled 24×24 paths (fill-rule: evenodd for cut-outs like the briefcase slot).
const PATHS: Record<IconName, string> = {
  home:
    'M12 3 2.6 10.9a1 1 0 0 0 .64 1.77H4.6v7.1a1 1 0 0 0 1 1H9.2v-5.2a2.8 2.8 0 0 1 5.6 0v5.2h3.6a1 1 0 0 0 1-1v-7.1h1.36a1 1 0 0 0 .64-1.77Z',
  budget: 'M3.6 19.2h16.8v1.6H3.6z M5.2 12.4h3v7h-3z M10.5 5.6h3v13.8h-3z M15.8 14h3v5.4h-3z',
  add:
    'M12 4.2a1.3 1.3 0 0 1 1.3 1.3v5.2h5.2a1.3 1.3 0 0 1 0 2.6h-5.2v5.2a1.3 1.3 0 0 1-2.6 0v-5.2H5.5a1.3 1.3 0 0 1 0-2.6h5.2V5.5A1.3 1.3 0 0 1 12 4.2z',
  capital:
    'M9.8 4.4a2.2 2.2 0 0 0-2.2 2.2v1.6H3.6a1.6 1.6 0 0 0-1.6 1.6v2.4h20v-2.4a1.6 1.6 0 0 0-1.6-1.6H16.4V6.6a2.2 2.2 0 0 0-2.2-2.2Zm-.6 4V6.8a.6.6 0 0 1 .6-.6h4.4a.6.6 0 0 1 .6.6v1.6ZM2 14v5a1.6 1.6 0 0 0 1.6 1.6h16.8A1.6 1.6 0 0 0 22 19v-5h-8.4v1.2a1.6 1.6 0 0 1-3.2 0V14Z',
  analytics:
    'M3.2 3.6a1.2 1.2 0 0 1 1.2 1.2v13.8h15.2a1.2 1.2 0 0 1 0 2.4H4.4A2 2 0 0 1 2.4 19V4.8a1.2 1.2 0 0 1 1.2-1.2z M19.5 5.3a1.15 1.15 0 0 1 1.7 1.5l-4.6 5.4a1.15 1.15 0 0 1-1.6.16l-2.9-2.35-2.6 2.9a1.15 1.15 0 1 1-1.7-1.54l3.3-3.7a1.15 1.15 0 0 1 1.58-.15l2.86 2.32Z',
  bank:
    'M12 3.2 2.8 8.9a1 1 0 0 0 .53 1.85h17.34a1 1 0 0 0 .53-1.85Zm-6.2 8.3v6.1h1.9v-6.1Zm4.2 0v6.1H12v-6.1Zm4.2 0v6.1h1.9v-6.1ZM3.6 19.2v1.4a.9.9 0 0 0 .9.9h15a.9.9 0 0 0 .9-.9v-1.4Z',
  cash:
    'M2.8 6.4A1.4 1.4 0 0 0 1.4 7.8v8.4A1.4 1.4 0 0 0 2.8 17.6h18.4a1.4 1.4 0 0 0 1.4-1.4V7.8a1.4 1.4 0 0 0-1.4-1.4Zm2.6 3a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2ZM12 8.9a3.1 3.1 0 1 1 0 6.2 3.1 3.1 0 0 1 0-6.2Zm6.6 3.3a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2Z',
  investment:
    'M20 6.2a1.2 1.2 0 0 1 1.2 1.2v5.4a1.2 1.2 0 0 1-2.4 0v-2.5l-5.35 5.35a1.2 1.2 0 0 1-1.7 0l-3.35-3.35-4.55 4.55a1.2 1.2 0 0 1-1.7-1.7l5.4-5.4a1.2 1.2 0 0 1 1.7 0l3.35 3.35 4.5-4.5H14.6a1.2 1.2 0 0 1 0-2.4Z',
  other_asset:
    'M7.76 5.6a3.2 3.2 0 0 0-2.98 2.05L3.2 11.7A2.4 2.4 0 0 0 2 13.8v3.4a1.2 1.2 0 0 0 1.2 1.2h.6a2.1 2.1 0 0 1 4.05 0h8.3a2.1 2.1 0 0 1 4.05 0h.6A1.2 1.2 0 0 0 22 17.2v-3.4a2.4 2.4 0 0 0-1.2-2.1l-1.58-4.05A3.2 3.2 0 0 0 16.24 5.6Zm0 2.2h8.48a1 1 0 0 1 .93.65l1.2 3.05H5.63l1.2-3.05a1 1 0 0 1 .93-.65ZM5.8 16.2a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6Zm12.4 0a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6Z',
  credit:
    'M2.6 5.6A1.6 1.6 0 0 0 1 7.2v1.4h22V7.2a1.6 1.6 0 0 0-1.6-1.6Zm-1.6 5.8v6A1.6 1.6 0 0 0 2.6 19h18.8A1.6 1.6 0 0 0 23 17.4v-6Zm4.6 3.2h4.2a.9.9 0 0 1 0 1.8H5.6a.9.9 0 0 1 0-1.8Z',
  credit_buffer:
    'M12 4.8c-4.2 0-7.7 1.2-7.7 3.2S7.8 11.2 12 11.2s7.7-1.2 7.7-3.2S16.2 4.8 12 4.8Zm-7.7 5.3v1.9c0 2 3.5 3.2 7.7 3.2s7.7-1.2 7.7-3.2v-1.9c-1.5 1.35-4.5 2-7.7 2s-6.2-.65-7.7-2Zm0 3.9v1.9c0 2 3.5 3.2 7.7 3.2s7.7-1.2 7.7-3.2v-1.9c-1.5 1.35-4.5 2-7.7 2s-6.2-.65-7.7-2Z',
};

/** Bare filled glyph. Colour comes from `currentColor`. */
export function AppIcon({
  name,
  size = 24,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

// One tint per domain. CSS vars (defined in index.css) adapt to light/dark.
export type Tint = 'blue' | 'green' | 'purple' | 'orange' | 'red' | 'teal' | 'accent';

/** Account type → tint, so a section's colour is stable across the app. */
export const TYPE_TINT: Record<string, Tint> = {
  bank: 'blue',
  cash: 'green',
  investment: 'purple',
  other_asset: 'orange',
  credit: 'red',
  credit_buffer: 'teal',
};

// Deterministic tint for expense categories (which have no fixed type) — hash
// the name so a category keeps the same colour every render.
const CATEGORY_TINTS: Tint[] = ['blue', 'green', 'purple', 'orange', 'red', 'teal'];
export function tintForName(name: string): Tint {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CATEGORY_TINTS[h % CATEGORY_TINTS.length];
}

/**
 * Duotone chip: filled content inside a tinted rounded square. Pass an
 * IconName to render an SVG glyph, or `emoji` to keep a user-chosen emoji
 * (expense categories) in the same tinted frame for a consistent look.
 */
export function TintedIcon({
  name,
  emoji,
  tint,
  size = 30,
}: {
  name?: IconName;
  emoji?: string | null;
  tint: Tint;
  size?: number;
}) {
  return (
    <span
      className="inline-grid place-items-center shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        background: `var(--t-${tint}-bg)`,
        color: `var(--t-${tint})`,
      }}
    >
      {name ? (
        <AppIcon name={name} size={Math.round(size * 0.62)} />
      ) : (
        <span style={{ fontSize: Math.round(size * 0.5), lineHeight: 1 }}>{emoji}</span>
      )}
    </span>
  );
}

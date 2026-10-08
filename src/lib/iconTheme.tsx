import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  CATEGORY_GLYPHS,
  CATEGORY_COLORS,
  categoryIconKey,
  type CategoryIconKey,
} from './categoryIcons';
import { categoryEmoji } from './format';

// Two independent choices, both persisted on the device:
//   style — WHAT to draw: our reworked icons, or plain emoji stickers
//   theme — HOW to draw the icons: solid disc / outline / soft chip
export type IconStyle = 'icons' | 'emoji';
export type IconTheme = 'solid' | 'outline' | 'soft';

export const ICON_STYLES: { id: IconStyle; label: string; hint: string }[] = [
  { id: 'icons', label: 'Иконки', hint: 'Переработанные значки' },
  { id: 'emoji', label: 'Эмодзи', hint: 'Обычные стикеры' },
];

export const ICON_THEMES: { id: IconTheme; label: string; hint: string }[] = [
  { id: 'solid', label: 'Заливка', hint: 'Контур на ярком круге' },
  { id: 'outline', label: 'Контур', hint: 'Значок без фона' },
  { id: 'soft', label: 'Мягкая', hint: 'Значок на плашке' },
];

const STYLE_KEY = 'iconStyle';
const THEME_KEY = 'iconTheme';
const DEFAULT_STYLE: IconStyle = 'icons';
const DEFAULT_THEME: IconTheme = 'solid';

function readStyle(): IconStyle {
  try {
    const v = window.localStorage.getItem(STYLE_KEY);
    if (v === 'icons' || v === 'emoji') return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_STYLE;
}
function readTheme(): IconTheme {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    if (v === 'solid' || v === 'outline' || v === 'soft') return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME;
}

const IconThemeContext = createContext<{
  style: IconStyle;
  setStyle: (s: IconStyle) => void;
  theme: IconTheme;
  setTheme: (t: IconTheme) => void;
}>({ style: DEFAULT_STYLE, setStyle: () => {}, theme: DEFAULT_THEME, setTheme: () => {} });

export function IconThemeProvider({ children }: { children: ReactNode }) {
  const [style, setStyleState] = useState<IconStyle>(readStyle);
  const [theme, setThemeState] = useState<IconTheme>(readTheme);

  const setStyle = (s: IconStyle) => {
    setStyleState(s);
    try {
      window.localStorage.setItem(STYLE_KEY, s);
    } catch {
      /* ignore */
    }
  };
  const setTheme = (t: IconTheme) => {
    setThemeState(t);
    try {
      window.localStorage.setItem(THEME_KEY, t);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STYLE_KEY) setStyleState(readStyle());
      if (e.key === THEME_KEY) setThemeState(readTheme());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return (
    <IconThemeContext.Provider value={{ style, setStyle, theme, setTheme }}>
      {children}
    </IconThemeContext.Provider>
  );
}

export function useIconTheme() {
  return useContext(IconThemeContext);
}

function hexAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function Glyph({ d, stroke, sw = 1.9 }: { d: string; stroke: string; sw?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

/**
 * Renders a category icon in the user's current style/theme (or an explicit
 * override, used by the Settings previews).
 *   style 'emoji' → the user's emoji (or name-based fallback), as a sticker
 *   style 'icons' → our line glyph, drawn per the theme
 */
export function CategoryIcon({
  name,
  emoji,
  keyOverride,
  style,
  theme,
  size = 50,
}: {
  name?: string;
  emoji?: string | null;
  keyOverride?: CategoryIconKey;
  style?: IconStyle;
  theme?: IconTheme;
  size?: number;
}) {
  const ctx = useIconTheme();
  const s = style ?? ctx.style;
  const t = theme ?? ctx.theme;

  const box: React.CSSProperties = { width: size, height: size, display: 'grid', placeItems: 'center' };

  if (s === 'emoji') {
    return (
      <span style={{ ...box, fontSize: Math.round(size * 0.62), lineHeight: 1 }} aria-hidden="true">
        {categoryEmoji(name ?? '', emoji)}
      </span>
    );
  }

  const key = keyOverride ?? categoryIconKey(name ?? '', emoji);
  const color = CATEGORY_COLORS[key];
  const d = CATEGORY_GLYPHS[key];
  const glyphSize = Math.round(size * 0.56);
  const svgStyle: React.CSSProperties = { width: glyphSize, height: glyphSize, display: 'block' };

  if (t === 'solid') {
    return (
      <span style={{ ...box, background: color, borderRadius: '50%', boxShadow: '0 3px 8px rgba(0,0,0,0.18)' }}>
        <span style={svgStyle}>
          <Glyph d={d} stroke="#fff" />
        </span>
      </span>
    );
  }
  if (t === 'soft') {
    return (
      <span style={{ ...box, background: hexAlpha(color, 0.16), borderRadius: Math.round(size * 0.3), color }}>
        <span style={svgStyle}>
          <Glyph d={d} stroke={color} />
        </span>
      </span>
    );
  }
  // outline — no background
  return (
    <span style={{ ...box, color }}>
      <span style={svgStyle}>
        <Glyph d={d} stroke={color} />
      </span>
    </span>
  );
}

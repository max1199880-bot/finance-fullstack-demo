import { AppIcon, type IconName } from './AppIcon';
import type { Tab } from './TabBar';

// Навигация для широкого экрана (от 1024 px): боковая панель вместо нижних вкладок.
// Концепция — макет «Финансы — десктоп» в Figma (docs/process/03-desktop-concept.md):
// главное действие «Добавить операцию» всегда на виду, разделы списком, настройки внизу
// списка. На телефоне её нет — там остаётся привычная нижняя панель (TabBar).

const ITEMS: { id: Tab; label: string; icon: IconName | 'settings' }[] = [
  { id: 'home', label: 'Главная', icon: 'home' },
  { id: 'budget', label: 'Бюджет', icon: 'budget' },
  { id: 'capital', label: 'Капитал', icon: 'capital' },
  { id: 'analytics', label: 'Аналитика', icon: 'analytics' },
  { id: 'settings', label: 'Настройки', icon: 'settings' },
];

function SettingsIcon() {
  // Ползунки: в AppIcon нет иконки настроек, а нижняя панель на телефоне без неё обходится.
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}

export function SideNav({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav
      aria-label="Разделы"
      className="hidden lg:flex fixed inset-y-0 left-0 z-30 w-64 flex-col gap-1 border-r border-ios-divider bg-ios-surface/60 px-4 py-6 backdrop-blur-xl"
    >
      <div className="mb-5 flex items-center gap-2.5 px-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-ios-accent text-lg font-bold text-white">
          ₽
        </span>
        <span className="text-lg font-rounded font-bold">Финансы</span>
      </div>

      <button
        type="button"
        onClick={() => onChange('add')}
        className="mb-4 flex items-center justify-center gap-2 rounded-xl bg-ios-accent py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.98]"
      >
        <AppIcon name="add" size={20} />
        Добавить операцию
      </button>

      <ul className="flex flex-col gap-1">
        {ITEMS.map((it) => {
          const isActive = active === it.id;
          return (
            <li key={it.id}>
              <button
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onChange(it.id)}
                className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-[15px] font-medium transition-colors ${
                  isActive ? 'bg-ios-accentSoft text-ios-accent' : 'text-ios-subtext hover:bg-ios-surface2'
                }`}
              >
                <span className={isActive ? 'text-ios-accent' : 'text-ios-hint'}>
                  {it.icon === 'settings' ? <SettingsIcon /> : <AppIcon name={it.icon} size={22} />}
                </span>
                {it.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

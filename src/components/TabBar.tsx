import { haptic } from '../lib/telegram';
import { AppIcon, type IconName } from './AppIcon';

export type Tab = 'home' | 'budget' | 'add' | 'capital' | 'analytics' | 'settings';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Главная', icon: 'home' },
  { id: 'budget', label: 'Бюджет', icon: 'budget' },
  { id: 'add', label: '', icon: 'add' },
  { id: 'capital', label: 'Капитал', icon: 'capital' },
  { id: 'analytics', label: 'Аналитика', icon: 'analytics' },
];

export function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-30 bg-ios-surface/85 backdrop-blur-xl border-t border-ios-divider"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
    >
      <ul className="grid grid-cols-5 max-w-md mx-auto">
        {TABS.map((t) => {
          const isAdd = t.id === 'add';
          const isActive = active === t.id;
          return (
            <li key={t.id} className="flex justify-center">
              <button
                type="button"
                onClick={() => {
                  haptic('select');
                  onChange(t.id);
                }}
                className="select-none-ui flex flex-col items-center justify-center w-full py-2"
              >
                {isAdd ? (
                  <span
                    className={`flex items-center justify-center w-12 h-12 rounded-full text-white shadow-lg active:scale-95 transition-transform ${
                      isActive ? 'bg-ios-accent ring-4 ring-ios-accentSoft' : 'bg-ios-accent'
                    }`}
                    aria-label="Добавить"
                  >
                    <AppIcon name="add" size={26} />
                  </span>
                ) : (
                  <>
                    <span className={`transition-colors ${isActive ? 'text-ios-accent' : 'text-ios-hint'}`}>
                      <AppIcon name={t.icon} size={25} />
                    </span>
                    <span className={`mt-0.5 text-[10px] font-medium ${isActive ? 'text-ios-accent' : 'text-ios-hint'}`}>
                      {t.label}
                    </span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

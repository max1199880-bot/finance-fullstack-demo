import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { haptic } from '../lib/telegram';

interface Step {
  emoji: string;
  badge?: string;
  title: string;
  body: ReactNode;
  cta: string;
  accent?: string; // gradient color override
}

const STEPS: Step[] = [
  {
    emoji: '👋',
    title: 'Финансы под контролем',
    body: (
      <>
        Этот бот поможет считать расходы, ставить планы и видеть, куда уходят
        деньги.
        <br />
        <br />
        <b>Все данные хранятся за тобой</b> — никто другой их не видит.
      </>
    ),
    cta: 'Дальше',
  },
  {
    emoji: '💼',
    badge: 'Шаг 1',
    title: 'Внеси остатки',
    body: (
      <>
        Открой <b>Капитал</b> в нижнем баре и проставь текущие суммы по своим
        счетам — Сбербанк, Тинькофф, Наличные, Инвестиции.
        <br />
        <br />
        Если у тебя есть банк, которого нет в списке — кнопкой <b>＋ Банк</b>{' '}
        справа в шапке.
      </>
    ),
    cta: 'Дальше',
  },
  {
    emoji: '📊',
    badge: 'Шаг 2',
    title: 'Задай план на месяц',
    body: (
      <>
        Вкладка <b>Бюджет</b> → тапни на категорию (например, Продукты) → введи
        сумму, которую готов потратить.
        <br />
        <br />
        Включи <b>«Применить к следующим месяцам»</b> — план уйдёт на 12
        месяцев вперёд, не нужно вбивать каждый раз.
      </>
    ),
    cta: 'Дальше',
  },
  {
    emoji: '＋',
    badge: 'Шаг 3',
    title: 'Записывай в 3 тапа',
    body: (
      <>
        Большая <b>＋</b> внизу → выбираешь тип (Расход / Доход / Перевод /
        Покупка) → категория → сумма → готово.
        <br />
        <br />
        Ошибся? На <b>Главной</b> тапни на любую операцию — откроется редактор:
        правка суммы, категории, удаление.
      </>
    ),
    cta: 'Дальше',
  },
  {
    emoji: '📈',
    badge: 'Шаг 4',
    title: 'Смотри прогресс',
    body: (
      <>
        Вкладка <b>Аналитика</b>: графики расходов по дням, топ категорий,
        динамика капитала за 26 недель.
        <br />
        <br />
        Сравнение с прошлым периодом — стрелочки <span className="text-ios-green">↑</span>{' '}
        / <span className="text-ios-red">↓</span> с процентами.
      </>
    ),
    cta: 'Поехали!',
    accent: 'from-emerald-500 to-emerald-700',
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Full-screen multi-step onboarding. Swipe horizontally or tap "Дальше".
 * "Пропустить" in the top right. Saves onboardingCompleted=true on finish.
 */
export function Onboarding({ open, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const startX = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      setStep(0);
      setVisible(true);
    }
  }, [open]);

  const finish = useMutation({
    mutationFn: () => api.updateMe({ onboardingCompleted: true }),
    onSuccess: () => {
      setVisible(false);
      setTimeout(onClose, 200);
    },
  });

  if (!open) return null;

  const next = () => {
    haptic('light');
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      haptic('success');
      finish.mutate();
    }
  };
  const prev = () => {
    if (step === 0) return;
    haptic('light');
    setStep((s) => s - 1);
  };

  // Touch swipe for fluid mobile UX. We commit when horizontal delta > 50px.
  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (startX.current == null) return;
    const dx = e.changedTouches[0].clientX - startX.current;
    startX.current = null;
    if (dx < -50) next();
    else if (dx > 50) prev();
  };

  const skip = () => {
    haptic('select');
    finish.mutate();
  };

  const cur = STEPS[step];

  return (
    <div
      className={`fixed inset-0 z-[80] bg-ios-bg flex flex-col transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Skip button */}
      <div className="absolute top-0 right-0 z-10" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)', paddingRight: 16 }}>
        <button
          type="button"
          onClick={skip}
          className="text-ios-hint text-sm font-medium px-3 py-1.5 select-none-ui"
        >
          Пропустить
        </button>
      </div>

      {/* Hero gradient panel with emoji */}
      <div
        className={`flex-1 flex flex-col items-center justify-center text-white px-8 bg-gradient-to-br ${cur.accent ?? 'from-ios-accent to-[#5856D6]'}`}
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 60px)' }}
      >
        {cur.badge && (
          <div className="text-xs uppercase tracking-widest font-semibold opacity-80 mb-2">
            {cur.badge}
          </div>
        )}
        <div
          key={step}
          className="text-[120px] leading-none mb-6 select-none-ui"
          style={{ animation: 'pop 0.4s ease-out' }}
        >
          {cur.emoji}
        </div>
        <div className="text-3xl font-rounded font-bold text-center">{cur.title}</div>
      </div>

      {/* Body + dots + CTA */}
      <div
        className="bg-ios-surface rounded-t-3xl px-6 pt-6 pb-6 shadow-2xl"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.25rem)' }}
      >
        <div className="text-base text-ios-subtext leading-relaxed min-h-[110px]">
          {cur.body}
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-2 my-5 select-none-ui">
          {STEPS.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                haptic('select');
                setStep(i);
              }}
              className={`h-2 rounded-full transition-all ${
                i === step ? 'w-6 bg-ios-accent' : 'w-2 bg-ios-divider'
              }`}
              aria-label={`Шаг ${i + 1}`}
            />
          ))}
        </div>

        <div className="flex gap-2">
          {step > 0 && (
            <button
              type="button"
              onClick={prev}
              className="flex-1 bg-ios-surface2 dark:bg-black/20 rounded-ios py-3.5 font-medium"
            >
              Назад
            </button>
          )}
          <button
            type="button"
            onClick={next}
            disabled={finish.isPending}
            className="flex-[2] bg-ios-accent text-white rounded-ios py-3.5 font-semibold active:opacity-90 disabled:opacity-60"
          >
            {finish.isPending ? '…' : cur.cta}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes pop {
          0% { transform: scale(0.6); opacity: 0; }
          60% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

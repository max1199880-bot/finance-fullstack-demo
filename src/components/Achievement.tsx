import { useEffect, useState } from 'react';
import { fmtRub } from '../lib/format';
import { haptic } from '../lib/telegram';

interface Props {
  open: boolean;
  onClose: () => void;
  amount: string | number;
  totalAfter?: string | number;
  title?: string;
  subtitle?: string;
  emoji?: string;
}

/**
 * Celebratory full-screen overlay shown when the user adds to investments.
 * Auto-dismisses after 2.4 s; tappable anywhere to dismiss earlier.
 */
export function Achievement({
  open,
  onClose,
  amount,
  totalAfter,
  title = 'Прирост капитала!',
  subtitle,
  emoji = '🎉',
}: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setVisible(true);
      haptic('success');
      const timer = setTimeout(() => {
        setVisible(false);
        setTimeout(onClose, 200);
      }, 2400);
      return () => clearTimeout(timer);
    }
  }, [open, onClose]);

  if (!open) return null;

  const dismiss = () => {
    setVisible(false);
    setTimeout(onClose, 180);
  };

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
      onClick={dismiss}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <Confetti />
      <div
        className={`relative bg-ios-surface rounded-ios-lg p-7 mx-6 text-center shadow-2xl max-w-xs w-full transition-transform duration-300 ${visible ? 'scale-100' : 'scale-90'}`}
      >
        <div className="text-6xl mb-3 inline-block animate-bounce-slow" style={{ animationDuration: '1.2s' }}>
          {emoji}
        </div>
        <div className="text-lg font-rounded font-bold">{title}</div>
        <div className="mt-3 text-3xl font-rounded font-bold tabular-nums text-ios-green">
          +{fmtRub(amount)}
        </div>
        {totalAfter !== undefined && (
          <div className="mt-2 text-sm text-ios-hint">
            всего: <span className="text-ios-text font-medium tabular-nums">{fmtRub(totalAfter)}</span>
          </div>
        )}
        {subtitle && <div className="mt-2 text-sm text-ios-hint">{subtitle}</div>}
        <button
          type="button"
          onClick={dismiss}
          className="mt-5 bg-ios-accent text-white rounded-ios px-6 py-2 font-medium active:opacity-80 text-sm"
        >
          Спасибо
        </button>
      </div>
      <style>{`
        @keyframes bounce-slow { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-12px); } }
        .animate-bounce-slow { animation: bounce-slow 1.2s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

/** Lightweight confetti — 24 colored squares falling from top with random horizontal drift. */
function Confetti() {
  const pieces = Array.from({ length: 28 }).map((_, i) => {
    const colors = ['#FF3B30', '#FF9F0A', '#FFD60A', '#34C759', '#007AFF', '#5856D6', '#FF2D55', '#AF52DE'];
    const left = Math.random() * 100;
    const drift = (Math.random() - 0.5) * 60;
    const duration = 1.5 + Math.random() * 1.5;
    const delay = Math.random() * 0.4;
    const size = 6 + Math.random() * 8;
    return (
      <span
        key={i}
        aria-hidden
        style={{
          position: 'absolute',
          left: `${left}%`,
          top: '-30px',
          width: size,
          height: size,
          backgroundColor: colors[i % colors.length],
          transform: 'rotate(0deg)',
          animation: `fall-${i} ${duration}s linear ${delay}s forwards`,
        }}
      />
    );
  });
  return (
    <>
      {pieces}
      <style>{`
        ${Array.from({ length: 28 })
          .map(
            (_, i) => `
          @keyframes fall-${i} {
            0% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
            100% { transform: translate(${(Math.random() - 0.5) * 200}px, 110vh) rotate(${Math.random() * 720}deg); opacity: 0.4; }
          }`,
          )
          .join('\n')}
      `}</style>
    </>
  );
}

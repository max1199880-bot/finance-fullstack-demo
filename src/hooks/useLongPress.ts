import { useRef, type TouchEvent, type MouseEvent } from 'react';
import { haptic } from '../lib/telegram';

/**
 * 500ms-hold detection for touch and mouse. Fires `onLongPress` once when
 * the timer elapses and the finger hasn't moved or lifted. Triggers a medium
 * haptic at fire time so users get the same feedback as Telegram's own
 * long-press menu.
 *
 * Returns props you spread onto the target. If you want a normal click in
 * addition, pass `onClick` separately on the same element — it'll fire only
 * when the long-press didn't.
 */
export function useLongPress(onLongPress: () => void, ms = 500) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);

  const start = () => {
    fired.current = false;
    timer.current = setTimeout(() => {
      fired.current = true;
      haptic('medium');
      onLongPress();
    }, ms);
  };
  const cancel = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  return {
    onTouchStart: (_e: TouchEvent) => start(),
    onTouchEnd: (_e: TouchEvent) => cancel(),
    onTouchMove: (_e: TouchEvent) => cancel(),
    onTouchCancel: (_e: TouchEvent) => cancel(),
    onMouseDown: (_e: MouseEvent) => start(),
    onMouseUp: (_e: MouseEvent) => cancel(),
    onMouseLeave: (_e: MouseEvent) => cancel(),
    onContextMenu: (e: React.SyntheticEvent) => e.preventDefault(),
    /**
     * Wrap your onClick with this so it skips firing right after a long-press.
     * `wrapClick(handler)(event)`.
     */
    wrapClick: (handler: () => void) => (_e: MouseEvent | TouchEvent) => {
      if (fired.current) return;
      handler();
    },
  };
}

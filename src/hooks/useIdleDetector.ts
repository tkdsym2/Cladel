import { useEffect, useRef, useCallback } from "react";

/**
 * Detects user inactivity on the document.
 * Calls `onIdle()` after `idleSeconds` of no user interaction.
 * Resets the timer on mouse, keyboard, scroll, and touch events.
 */
export function useIdleDetector(
  idleSeconds: number,
  enabled: boolean,
  onIdle: () => void,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  const resetTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    if (!enabled) return;

    timerRef.current = setTimeout(() => {
      onIdleRef.current();
    }, idleSeconds * 1000);
  }, [idleSeconds, enabled]);

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const events = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "wheel",
    ] as const;

    const handler = () => resetTimer();

    for (const event of events) {
      document.addEventListener(event, handler, { passive: true });
    }

    // Start the initial timer
    resetTimer();

    return () => {
      for (const event of events) {
        document.removeEventListener(event, handler);
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, resetTimer]);
}

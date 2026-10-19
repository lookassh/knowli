import { useEffect, useRef } from "react";
import { shouldIgnoreKeyboardShortcut } from "../exercises/useChoiceKeyboard";

/**
 * Obsługa fokusu, cooldownu (300 ms) i ochrony przed event.repeat dla przycisków
 * w ekranach feedbacku i ujawnienia.
 */
export function useFeedbackCooldown<T extends HTMLButtonElement = HTMLButtonElement>(
  onAction: () => void,
  deps: unknown[] = [],
) {
  const buttonRef = useRef<T>(null);
  const mountTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    mountTimeRef.current = Date.now();
    buttonRef.current?.focus({ preventScroll: true });
  }, deps);

  // Obsługa Enter i Space na poziomie przycisku: blokada repeat i cooldownu < 300 ms
  const onKeyDown = (event: React.KeyboardEvent<T>) => {
    if (event.key === "Enter" || event.key === " " || event.code === "Space") {
      if (event.repeat || Date.now() - mountTimeRef.current < 300) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
  };

  // Obsługa Enter na poziomie okna, gdy fokus przypadkowo znalazł się poza przyciskiem
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreKeyboardShortcut(event)) return;
      if (buttonRef.current?.disabled) return;

      if (event.key === "Enter") {
        if (event.repeat || Date.now() - mountTimeRef.current < 300) {
          event.preventDefault();
          return;
        }
        const active = typeof document !== "undefined" ? document.activeElement : null;
        if (active?.tagName === "BUTTON") {
          return;
        }
        if (active !== buttonRef.current) {
          event.preventDefault();
          onAction();
        }
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [onAction, ...deps]);

  return { buttonRef, onKeyDown };
}

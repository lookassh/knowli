import { useEffect, useRef } from "react";

export interface UseChoiceKeyboardOptions {
  options: Array<{ id: string }>;
  busy: boolean;
  onChoice: (optionId: string) => void;
  onPlay?: () => void;
}

export function shouldIgnoreKeyboardShortcut(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey) return true;
  const target = event.target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!target) return false;
  const tagName = target.tagName?.toUpperCase();
  if (tagName === "INPUT" || tagName === "TEXTAREA" || target.isContentEditable === true) {
    return true;
  }
  return false;
}

/**
 * Obsługa klawiszy cyfr 1..4, strzałek góra/dół oraz Spacji w zadaniach wyboru.
 * W zadaniach słuchowych Spacja ponawia odsłuch bez aktywacji opcji.
 */
export function useChoiceKeyboard({ options, busy, onChoice, onPlay }: UseChoiceKeyboardOptions) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    // Tniemy do rzeczywistej liczby opcji, ale NIE czyścimy wpisów: refy
    // inline uzupełniają tablicę dopiero przy kolejnym renderze, więc wyczyszczenie
    // po montażu unieruchamia strzałki do pierwszego re-renderu.
    optionRefs.current.length = options.length;
  }, [options]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreKeyboardShortcut(event)) return;

      // Słuchowe: klawisz Spacji ponawia odsłuch audio i nie aktywuje zaznaczonej opcji
      if (onPlay && (event.key === " " || event.code === "Space")) {
        if (event.repeat) return;
        event.preventDefault();
        if (!busy) {
          onPlay();
        }
        return;
      }

      // Cyfry 1..4 (or 1..options.length)
      if (event.key >= "1" && event.key <= "9") {
        if (event.repeat) return;
        const index = parseInt(event.key, 10) - 1;
        if (index >= 0 && index < options.length) {
          event.preventDefault();
          if (!busy) {
            onChoice(options[index].id);
          }
        }
        return;
      }

      // Strzałki góra/dół
      if (event.key === "ArrowDown") {
        if (options.length === 0) return;
        const active = typeof document !== "undefined" ? document.activeElement : null;
        const currentIndex = optionRefs.current.findIndex((btn) => btn && btn === active);
        if (currentIndex === -1) return;
        event.preventDefault();
        const nextIndex = (currentIndex + 1) % options.length;
        optionRefs.current[nextIndex]?.focus({ preventScroll: true });
        return;
      }

      if (event.key === "ArrowUp") {
        if (options.length === 0) return;
        const active = typeof document !== "undefined" ? document.activeElement : null;
        const currentIndex = optionRefs.current.findIndex((btn) => btn && btn === active);
        if (currentIndex === -1) return;
        event.preventDefault();
        const prevIndex = (currentIndex - 1 + options.length) % options.length;
        optionRefs.current[prevIndex]?.focus({ preventScroll: true });
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [options, busy, onChoice, onPlay]);

  return optionRefs;
}

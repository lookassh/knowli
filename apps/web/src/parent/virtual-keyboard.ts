"use client";

import { useEffect, useState } from "react";

/** Pola, które na telefonie otwierają klawiaturę ekranową (data i lista wyboru otwierają własny selektor). */
const TEXT_INPUT_TYPES = new Set(["", "text", "search", "email", "number", "tel", "url", "password"]);

/** Ubytek widocznego obszaru, od którego uznajemy, że klawiatura jest otwarta. */
export const KEYBOARD_MIN_SHRINK_PX = 150;

export function isTextEntry(element: Element | null): boolean {
  if (!element || !(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
  if (element instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(element.getAttribute("type")?.toLowerCase() ?? "") && !element.readOnly && !element.disabled;
  }
  return false;
}

/** Widoczny obszar mniejszy od okna o co najmniej {@link KEYBOARD_MIN_SHRINK_PX}, bez powiększenia gestem. */
export function viewportShrunk(innerHeight: number, visualViewport: { height: number; scale?: number } | null): boolean {
  if (!visualViewport || !Number.isFinite(visualViewport.height) || !Number.isFinite(innerHeight)) return false;
  if (typeof visualViewport.scale === "number" && visualViewport.scale > 1.01) return false;
  return innerHeight - visualViewport.height >= KEYBOARD_MIN_SHRINK_PX;
}

/**
 * Czy klawiatura ekranowa zasłania dół ekranu. Fokus w polu tekstowym jest
 * warunkiem koniecznym. Zmniejszony widoczny obszar rozstrzyga od razu. Bez
 * niego na dotykowym telefonie zakładamy klawiaturę (wysuwa się, zanim obszar
 * się zmieni, a część przeglądarek go nie zmienia) — chyba że obszar już się
 * zmniejszył przy tym polu i wrócił do pełnej wysokości (`dismissed`): wtedy
 * rodzic schował klawiaturę, a fokus został w polu.
 */
export function virtualKeyboardOpen({
  textEntryFocused,
  coarsePointer,
  shrunk,
  dismissed,
}: {
  textEntryFocused: boolean;
  coarsePointer: boolean;
  shrunk: boolean;
  dismissed: boolean;
}): boolean {
  if (!textEntryFocused) return false;
  return shrunk || (coarsePointer && !dismissed);
}

/**
 * Stan klawiatury ekranowej dla ramy panelu (tylko przy `enabled`: wąski albo
 * niski ekran): przypięte elementy dołu ekranu chowają się na czas pisania,
 * żeby nie zasłaniały edytowanego pola.
 */
export function useVirtualKeyboardOpen(enabled: boolean): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      return;
    }
    const pointer = window.matchMedia("(pointer: coarse)");
    const viewport = window.visualViewport;
    // stan klawiatury przy bieżącym polu: czy obszar się zmniejszył i czy potem wrócił
    let keyboardSeen = false;
    let dismissed = false;
    let frame = 0;
    const update = () => {
      const shrunk = viewportShrunk(window.innerHeight, viewport ? { height: viewport.height, scale: viewport.scale } : null);
      if (shrunk) {
        keyboardSeen = true;
        dismissed = false;
      } else if (keyboardSeen) {
        dismissed = true;
      }
      setOpen(virtualKeyboardOpen({
        textEntryFocused: isTextEntry(document.activeElement),
        coarsePointer: pointer.matches,
        shrunk,
        dismissed,
      }));
    };
    const focused = () => {
      // nowe pole: klawiatura wysunie się na nowo (albo zostaje otwarta — wtedy obszar jest już zmniejszony)
      keyboardSeen = false;
      dismissed = false;
      update();
    };
    // przejście fokusu między polami daje focusout przed focusin — sprawdzamy po klatce, bez mignięcia paska
    const deferred = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    document.addEventListener("focusin", focused);
    document.addEventListener("focusout", deferred);
    viewport?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    pointer.addEventListener("change", update);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", focused);
      document.removeEventListener("focusout", deferred);
      viewport?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
      pointer.removeEventListener("change", update);
    };
  }, [enabled]);

  return open;
}

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

/**
 * Widoczny obszar mniejszy od okna o co najmniej {@link KEYBOARD_MIN_SHRINK_PX}.
 * `null` — pomiar nieporównywalny z oknem: brak `visualViewport` albo
 * powiększenie gestem (powiększony obszar jest mniejszy bez klawiatury).
 */
export function viewportShrunk(innerHeight: number, visualViewport: { height: number; scale?: number } | null): boolean | null {
  if (!visualViewport || !Number.isFinite(visualViewport.height) || !Number.isFinite(innerHeight)) return null;
  if (typeof visualViewport.scale === "number" && visualViewport.scale > 1.01) return null;
  return innerHeight - visualViewport.height >= KEYBOARD_MIN_SHRINK_PX;
}

/** Stan klawiatury przy bieżącym polu: obszar zmniejszony, czy się zmniejszył i czy potem wrócił. */
export interface KeyboardTracking {
  shrunk: boolean;
  keyboardSeen: boolean;
  dismissed: boolean;
}

/** Nowe pole: klawiatura wysunie się na nowo (albo zostaje otwarta — wtedy pomiar od razu to pokaże). */
export const NEW_FIELD_TRACKING: KeyboardTracking = { shrunk: false, keyboardSeen: false, dismissed: false };

/**
 * Kolejny pomiar widocznego obszaru. Powrót do pełnej wysokości po wcześniejszym
 * zmniejszeniu oznacza schowaną klawiaturę; pomiar nieporównywalny (powiększenie
 * gestem przy otwartej klawiaturze) niczego nie zmienia.
 */
export function trackViewport(state: KeyboardTracking, shrunk: boolean | null): KeyboardTracking {
  if (shrunk === null) return state;
  if (shrunk) return { shrunk: true, keyboardSeen: true, dismissed: false };
  return { shrunk: false, keyboardSeen: state.keyboardSeen, dismissed: state.keyboardSeen };
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
    let tracking = NEW_FIELD_TRACKING;
    let frame = 0;
    const update = () => {
      tracking = trackViewport(tracking, viewportShrunk(window.innerHeight, viewport ? { height: viewport.height, scale: viewport.scale } : null));
      setOpen(virtualKeyboardOpen({
        textEntryFocused: isTextEntry(document.activeElement),
        coarsePointer: pointer.matches,
        shrunk: tracking.shrunk,
        dismissed: tracking.dismissed,
      }));
    };
    const focused = () => {
      tracking = NEW_FIELD_TRACKING;
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

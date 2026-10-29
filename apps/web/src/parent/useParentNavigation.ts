"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SECTION, PARENT_ROOT, sectionFromPath, sectionPath, type ParentSection } from "./parent-routes";
import type { EditorLeaveState } from "./useParentLeaveGuard";

interface LeaveGuard {
  current(): EditorLeaveState;
  requestLeave(action: () => void | Promise<void>): void;
}

/**
 * Sekcja panelu w adresie (plan §4.1) nad History API, nie nawigacją App
 * Routera: App Router nie pozwala zatrzymać przejścia, a „wstecz” przy
 * niezapisanych zmianach musi zapytać o zgodę. Przeglądarka nie pozwala
 * anulować `popstate`, więc przy zablokowanym edytorze przywracamy adres
 * bieżącej sekcji i dopiero po „Wyjdź bez zapisywania” przechodzimy dalej.
 */
export function useParentNavigation(guard: LeaveGuard) {
  const [section, setSection] = useState<ParentSection>(DEFAULT_SECTION);
  const currentPath = useRef(sectionPath(DEFAULT_SECTION));
  // obiekt guard powstaje przy każdym renderze; nasłuch historii rejestrujemy raz
  const guardRef = useRef(guard);
  useEffect(() => {
    guardRef.current = guard;
  });

  const show = useCallback((next: ParentSection) => {
    currentPath.current = sectionPath(next);
    setSection(next);
  }, []);

  useEffect(() => {
    const initial = sectionFromPath(window.location.pathname);
    if (initial === null) {
      window.history.replaceState(window.history.state, "", sectionPath(DEFAULT_SECTION));
    }
    show(initial ?? DEFAULT_SECTION);

    const onPopState = () => {
      // Panel jest osobnym dokumentem: wchodzi się do niego zwykłym linkiem
      // (Kid UI) i wychodzi przez `window.location`, więc w historii tego
      // dokumentu są tylko wpisy sekcji. Wpis spoza /parent należałby do
      // routera Next — nie przywracamy go własnym pushState (stan Next
      // pochodziłby z obcego wpisu); wyjście z dokumentu chroni `beforeunload`.
      if (!window.location.pathname.startsWith(PARENT_ROOT)) return;
      const target = sectionFromPath(window.location.pathname) ?? DEFAULT_SECTION;
      const editor = guardRef.current.current();
      if (!editor.dirty && !editor.busy) {
        show(target);
        return;
      }
      window.history.pushState(null, "", currentPath.current);
      guardRef.current.requestLeave(() => {
        window.history.pushState(null, "", sectionPath(target));
        show(target);
      });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [show]);

  /** Przejście do sekcji z nawigacji panelu — przez leave guard, z nowym wpisem historii. */
  const navigate = useCallback(
    (next: ParentSection) => {
      if (sectionPath(next) === currentPath.current) return;
      guardRef.current.requestLeave(() => {
        window.history.pushState(null, "", sectionPath(next));
        show(next);
      });
    },
    [show],
  );

  return { section, navigate };
}

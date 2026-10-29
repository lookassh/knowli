"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_ROUTE, PARENT_ROOT, routeFromPath, routePath, type ParentRoute } from "./parent-routes";
import type { EditorLeaveState } from "./useParentLeaveGuard";

interface LeaveGuard {
  current(): EditorLeaveState;
  requestLeave(action: () => void | Promise<void>): void;
}

/**
 * Widok panelu w adresie (plan §4.1) nad History API, nie nawigacją App
 * Routera: App Router nie pozwala zatrzymać przejścia, a „wstecz” przy
 * niezapisanych zmianach musi zapytać o zgodę. Przeglądarka nie pozwala
 * anulować `popstate`, więc przy zablokowanym edytorze przywracamy adres
 * bieżącego widoku i dopiero po „Wyjdź bez zapisywania” przechodzimy dalej.
 */
export function useParentNavigation(guard: LeaveGuard) {
  const [route, setRoute] = useState<ParentRoute>(DEFAULT_ROUTE);
  const currentPath = useRef(routePath(DEFAULT_ROUTE));
  // „Wyjdź bez zapisywania” po zablokowanym „wstecz”: następny popstate przechodzi bez pytania
  const bypassNextPop = useRef(false);
  // obiekt guard powstaje przy każdym renderze; nasłuch historii rejestrujemy raz
  const guardRef = useRef(guard);
  useEffect(() => {
    guardRef.current = guard;
  });

  const show = useCallback((next: ParentRoute) => {
    currentPath.current = routePath(next);
    setRoute(next);
  }, []);

  useEffect(() => {
    const initial = routeFromPath(window.location.pathname);
    if (initial === null) {
      window.history.replaceState(window.history.state, "", routePath(DEFAULT_ROUTE));
    }
    show(initial ?? DEFAULT_ROUTE);

    const onPopState = () => {
      // Panel jest osobnym dokumentem: wchodzi się do niego zwykłym linkiem
      // (Kid UI) i wychodzi przez `window.location`, więc w historii tego
      // dokumentu są tylko wpisy panelu. Wpis spoza /parent należałby do
      // routera Next — nie przywracamy go własnym pushState (stan Next
      // pochodziłby z obcego wpisu); wyjście z dokumentu chroni `beforeunload`.
      if (!window.location.pathname.startsWith(PARENT_ROOT)) return;
      const target = routeFromPath(window.location.pathname) ?? DEFAULT_ROUTE;
      if (bypassNextPop.current) {
        bypassNextPop.current = false;
        show(target);
        return;
      }
      const editor = guardRef.current.current();
      if (!editor.dirty && !editor.busy) {
        show(target);
        return;
      }
      window.history.pushState(null, "", currentPath.current);
      // po zgodzie cofamy się na ten sam wpis, zamiast dopisywać nowy —
      // kolejne „wstecz” prowadzi dalej w historii, a nie z powrotem do edytora
      guardRef.current.requestLeave(() => {
        bypassNextPop.current = true;
        window.history.back();
      });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [show]);

  /** Przejście do widoku z panelu — przez leave guard, z nowym wpisem historii. */
  const navigate = useCallback(
    (next: ParentRoute) => {
      if (routePath(next) === currentPath.current) return;
      guardRef.current.requestLeave(() => {
        window.history.pushState(null, "", routePath(next));
        show(next);
      });
    },
    [show],
  );

  return { route, navigate };
}

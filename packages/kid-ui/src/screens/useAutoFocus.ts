import React, { useEffect, useRef, type RefObject } from "react";

function hasReactDispatcher(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  return Boolean(internals?.H);
}

/**
 * Bezpieczny fokus początkowy na elemencie z preventScroll: true.
 * Działa w runtime Reacta, a w testach wywołujących komponenty jako czyste funkcje
 * (np. textNodes bez renderera) nie rzuca błędu braku dispatchera.
 */
export function useAutoFocus<T extends HTMLElement = HTMLButtonElement>(
  enabled = true,
  deps: unknown[] = [],
): RefObject<T | null> {
  const dummyRef: RefObject<T | null> = { current: null };
  if (!hasReactDispatcher()) {
    return dummyRef;
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const ref = useRef<T>(null);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (enabled) {
      ref.current?.focus({ preventScroll: true });
    }
  }, [enabled, ...deps]);

  return ref;
}

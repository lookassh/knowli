import { KID_FINE_POINTER_QUERY } from "../layout/viewport";

/** Replaces `window.matchMedia` so only the fine-pointer query matches, and lets a test flip it. */
export function stubFinePointer(initial: boolean) {
  let fine = initial;
  const listeners = new Set<EventListener>();
  window.matchMedia = ((query: string) => {
    const fineQuery = query === KID_FINE_POINTER_QUERY;
    return {
      get matches() {
        return fineQuery && fine;
      },
      media: query,
      onchange: null,
      addEventListener: (type: string, listener: EventListener) => {
        if (fineQuery && type === "change") listeners.add(listener);
      },
      removeEventListener: (type: string, listener: EventListener) => {
        if (fineQuery && type === "change") listeners.delete(listener);
      },
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    };
  }) as typeof window.matchMedia;
  return {
    listeners,
    setFine(next: boolean) {
      fine = next;
      for (const listener of [...listeners]) listener(new Event("change"));
    },
  };
}

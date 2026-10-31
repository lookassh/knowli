import { createContext, createElement, useContext, useState, type ReactNode } from "react";
import { useIsomorphicLayoutEffect } from "./isomorphic-layout-effect";

// Layout scale of a large window (spec 2026-10-30-kid-ui-large-screens §3.4): the child UI is designed
// for an 840 x 900 window and grows proportionally, up to KID_SCALE_MAX, only where a fine pointer exists.
export const KID_SCALE_REFERENCE_WIDTH = 840;
export const KID_SCALE_REFERENCE_HEIGHT = 900;
export const KID_SCALE_MAX = 1.6;
// Phones and tablets stay at 1: the on-screen keyboard resizes the window and the scale would jump on every keystroke.
export const KID_FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

export function computeKidLayoutScale({
  width,
  height,
  finePointer,
}: {
  width: number;
  height: number;
  finePointer: boolean;
}): number {
  if (!finePointer || !Number.isFinite(width) || !Number.isFinite(height)) return 1;
  const fit = Math.min(width / KID_SCALE_REFERENCE_WIDTH, height / KID_SCALE_REFERENCE_HEIGHT, KID_SCALE_MAX);
  if (fit <= 1) return 1;
  // Round down to 0.01 (the epsilon absorbs floating-point error, e.g. 949.2 / 840 = 1.13) so the inner window never drops below 840 x 900.
  return Math.floor(fit * 100 + 1e-9) / 100;
}

export interface KidViewportMeasurement {
  height: number;
  offsetTop: number;
  zoomed: boolean;
}

export function computeKidViewport({
  innerHeight,
  visualViewport,
}: {
  innerHeight: number;
  visualViewport: { height: number; offsetTop: number; scale?: number } | null;
}): KidViewportMeasurement {
  const safeInnerHeight = Number.isFinite(innerHeight) ? Math.max(0, innerHeight) : 0;
  const scale = visualViewport?.scale;
  // Only gesture (pinch) zoom switches the session frame to natural flow.
  // Enlarged browser text is no longer a supported special case (owner decision, 2026-10-26).
  const zoomed = typeof scale === "number" && Number.isFinite(scale) && scale > 1.01;
  if (zoomed) return { height: safeInnerHeight, offsetTop: 0, zoomed: true };

  if (
    visualViewport === null ||
    !Number.isFinite(visualViewport.height) || visualViewport.height <= 0 ||
    !Number.isFinite(visualViewport.offsetTop) || visualViewport.offsetTop < 0
  ) {
    return { height: safeInnerHeight, offsetTop: 0, zoomed: false };
  }
  const availableHeight = Math.max(0, safeInnerHeight - visualViewport.offsetTop);
  return {
    height: Math.min(visualViewport.height, availableHeight),
    offsetTop: visualViewport.offsetTop,
    zoomed: false,
  };
}

export interface KidViewport {
  width: number | null;
  height: number | null;
  offsetTop: number;
  zoomed: boolean;
  scale: number;
}

const SERVER_VIEWPORT: KidViewport = { width: null, height: null, offsetTop: 0, zoomed: false, scale: 1 };

const KidViewportContext = createContext<KidViewport>(SERVER_VIEWPORT);

export function KidViewportProvider({ viewport, children }: { viewport: KidViewport; children: ReactNode }) {
  return createElement(KidViewportContext.Provider, { value: viewport }, children);
}

export function useKidPageViewport(): KidViewport {
  return useContext(KidViewportContext);
}

export function useKidViewport(): KidViewport {
  const [viewport, setViewport] = useState<KidViewport>(SERVER_VIEWPORT);

  // Measuring in a layout effect sets the scale before the first paint of a client-side mount. A full server-rendered
  // page load still paints the server markup (the loading screen) at scale 1 before hydration and then jumps to the
  // scale. On the server useLayoutEffect would only warn.
  useIsomorphicLayoutEffect(() => {
    const visualViewport = window.visualViewport;
    const finePointerQuery = typeof window.matchMedia === "function" ? window.matchMedia(KID_FINE_POINTER_QUERY) : null;
    const update = () => {
      setViewport({
        width: Number.isFinite(window.innerWidth) ? Math.max(0, window.innerWidth) : 0,
        ...computeKidViewport({
          innerHeight: window.innerHeight,
          visualViewport: visualViewport == null ? null : {
            height: visualViewport.height,
            offsetTop: visualViewport.offsetTop,
            scale: visualViewport.scale,
          },
        }),
        scale: computeKidLayoutScale({
          width: window.innerWidth,
          height: window.innerHeight,
          finePointer: finePointerQuery?.matches ?? false,
        }),
      });
    };
    update();
    window.addEventListener("resize", update);
    finePointerQuery?.addEventListener("change", update);
    visualViewport?.addEventListener("resize", update);
    visualViewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      finePointerQuery?.removeEventListener("change", update);
      visualViewport?.removeEventListener("resize", update);
      visualViewport?.removeEventListener("scroll", update);
    };
  }, []);

  return viewport;
}

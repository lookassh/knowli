import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";

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
}

const SERVER_VIEWPORT: KidViewport = { width: null, height: null, offsetTop: 0, zoomed: false };

const KidViewportContext = createContext<KidViewport>(SERVER_VIEWPORT);

export function KidViewportProvider({ viewport, children }: { viewport: KidViewport; children: ReactNode }) {
  return createElement(KidViewportContext.Provider, { value: viewport }, children);
}

export function useKidPageViewport(): KidViewport {
  return useContext(KidViewportContext);
}

export function useKidViewport(): KidViewport {
  const [viewport, setViewport] = useState<KidViewport>(SERVER_VIEWPORT);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    const update = () => {
      setViewport({
        width: Number.isFinite(window.innerWidth) ? Math.max(0, window.innerWidth) : 0,
        ...computeKidViewport({
          innerHeight: window.innerHeight,
          visualViewport: visualViewport === null ? null : {
            height: visualViewport.height,
            offsetTop: visualViewport.offsetTop,
            scale: visualViewport.scale,
          },
        }),
      });
    };
    update();
    window.addEventListener("resize", update);
    visualViewport?.addEventListener("resize", update);
    visualViewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      visualViewport?.removeEventListener("resize", update);
      visualViewport?.removeEventListener("scroll", update);
    };
  }, []);

  return viewport;
}

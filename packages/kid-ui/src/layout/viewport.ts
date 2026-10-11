import { useEffect, useState } from "react";

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
  height: number | null;
  offsetTop: number;
  zoomed: boolean;
}

const SERVER_VIEWPORT: KidViewport = { height: null, offsetTop: 0, zoomed: false };

export function useKidViewport(): KidViewport {
  const [viewport, setViewport] = useState<KidViewport>(SERVER_VIEWPORT);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    const update = () => {
      setViewport(computeKidViewport({
        innerHeight: window.innerHeight,
        visualViewport: visualViewport === null ? null : {
          height: visualViewport.height,
          offsetTop: visualViewport.offsetTop,
          scale: visualViewport.scale,
        },
      }));
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

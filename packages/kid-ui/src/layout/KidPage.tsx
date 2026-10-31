import type { CSSProperties, ReactNode } from "react";
import { KidViewportProvider, useKidViewport } from "./viewport";

export function KidPage({
  mode,
  children,
}: {
  mode: "flow" | "session";
  children: ReactNode;
}) {
  const viewport = useKidViewport();
  const zoomed = mode === "session" && viewport.zoomed;
  const session = mode === "session" && !zoomed;
  const { scale } = viewport;
  // A large window zooms the whole page (spec 2026-10-30-kid-ui-large-screens §4.1). --kid-zoom has to sit on
  // this element: it carries .kid-ui, which declares the window-unit tokens that divide by it (styles.css).
  const zoom = scale > 1 ? { zoom: scale, "--kid-zoom": scale } : undefined;
  // zoom multiplies inline lengths, so the frame is sized in inner pixels to cover exactly the visible window.
  const frame = session && viewport.height !== null
    ? { height: `${viewport.height / scale}px`, top: `${viewport.offsetTop / scale}px` }
    : undefined;
  const style = zoom || frame ? ({ ...zoom, ...frame } as CSSProperties) : undefined;

  return (
    <KidViewportProvider viewport={{ width: viewport.width, height: viewport.height, offsetTop: viewport.offsetTop, zoomed: viewport.zoomed, scale }}>
      <div
        className={["kid-ui", "kid-page", session ? "kid-page--session" : "kid-page--flow"]
          .filter(Boolean)
          .join(" ")}
        data-testid={mode === "session" ? "kid-session-frame" : undefined}
        data-zoomed={zoomed ? "true" : "false"}
        data-kid-scale={scale}
        // Thresholds use the real window height; with a scale above 1 it exceeds 900 px, so neither applies.
        data-viewport-short={session && viewport.height !== null && viewport.height <= 700 ? "true" : undefined}
        data-viewport-very-short={session && viewport.height !== null && viewport.height <= 479 ? "true" : undefined}
        style={style}
      >
        {children}
      </div>
    </KidViewportProvider>
  );
}
